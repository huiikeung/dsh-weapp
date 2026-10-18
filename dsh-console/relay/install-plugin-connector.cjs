'use strict';
// Explicit opt-in only; never touches identity, credentials, settings or processes.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { customizeClient, customizeSupervisor, customizeGatewayMetadata } = require('./plugin-customization.cjs');
function install(root) {
  if (!root || !path.isAbsolute(root)) throw new Error('请输入已安装 dsh-plugin-weapp-gateway 的绝对目录');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  if (manifest.name !== 'dsh-plugin-weapp-gateway') throw new Error('目标不是 dsh-plugin-weapp-gateway 插件，未修改');
  const target = path.join(root, 'relay/agent-connector.js');
  const current = fs.readFileSync(target, 'utf8');
  const source = fs.readFileSync(path.join(__dirname, 'agent-connector.js'), 'utf8');
  if (!current.includes('dsh-weapp-e2ee-v1') || !current.includes('MGMT_URL') && !current.includes('/mgw/relay')) throw new Error('无法识别原连接器，未覆盖');
  const edits = [{ target, current, source }];
  for (const [relative, transform] of [['lib/client.js', customizeClient], ['lib/relay-connector.mjs', customizeSupervisor], ['lib/index.mjs', customizeGatewayMetadata]]) {
    const file = path.join(root, relative);
    if (!fs.existsSync(file)) continue; // Connector-only packages remain supported.
    const old = fs.readFileSync(file, 'utf8');
    edits.push({ target: file, current: old, source: transform(old) });
  }
  // Validate every known source before writing anything. Back up all changed
  // files before replacement, and restore already replaced files on failure.
  const changed = edits.filter(edit => edit.current !== edit.source);
  if (!changed.length) { console.log('安全公网连接器及插件面板已是当前版本。'); return; }
  for (const edit of changed) {
    edit.backup = edit.target + '.before-public-access-' + crypto.randomUUID();
    fs.copyFileSync(edit.target, edit.backup, fs.constants.COPYFILE_EXCL);
  }
  const applied = [];
  try {
    for (const edit of changed) {
      edit.temp = edit.target + '.' + crypto.randomUUID() + '.tmp';
      fs.writeFileSync(edit.temp, edit.source, { flag: 'wx', mode: fs.statSync(edit.target).mode & 0o777 });
      fs.renameSync(edit.temp, edit.target);
      applied.push(edit);
    }
  } catch (error) {
    for (const edit of applied.reverse()) fs.copyFileSync(edit.backup, edit.target);
    throw error;
  } finally {
    for (const edit of changed) if (edit.temp && fs.existsSync(edit.temp)) fs.unlinkSync(edit.temp);
  }
  for (const edit of changed) console.log('已更新 ' + path.relative(root, edit.target) + '，备份：' + edit.backup);
  console.log('身份、设备凭据和局域网网关未修改；公网入口自动配置，面板只显示服务名称和设备 ID。');
  console.log('请在任务结束后正常重启 DSH 并刷新插件面板；不需要 connector.json。');
}
if (require.main === module) { try { install(process.argv[2]); } catch (e) { console.error(e.message); process.exitCode = 1; } }
module.exports = { install };
