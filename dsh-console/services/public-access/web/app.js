'use strict';
const $ = id => document.getElementById(id);
let csrf = '', initialized = false, overview = null, currentTab = 'overview', timer;
const titles = { overview: '连接，从这里开始', wechat: '微信与管理员', nodes: '高级 · 托管节点与配对', pairings: '高级 · 限时设备配对', codes: '兑换码管理', security: '安全设置' };
titles.share = '分享活动';
titles.announcements = '开发者公告';
let announcementEditing = null, sharingEnabled = false;
let resultCodeId = '';
let pairingSyncBusy = false, pairingNodes = [], pairingIssuing = false;
const pairingStatuses = { issuing: '生成中', pending: '待配对', active: '使用中', expired: '已到期', revoking: '等待电脑确认停用', revoked: '已停用', superseded: '已被新配对替换', failed: '生成失败' };
function notice(message, error = false) { clearTimeout(timer); $('notice').textContent = message; $('notice').dataset.error = String(error); $('notice').hidden = false; timer = setTimeout(() => { $('notice').hidden = true; }, 7000); }
async function api(route, data) {
  const response = await fetch('/console/api' + route, { method: data === undefined ? 'GET' : 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(data === undefined ? {} : { 'X-CSRF-Token': csrf }) },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }), signal: AbortSignal.timeout(30000) });
  const result = await response.json();
  if (!response.ok) { if (response.status === 401 && !['/login', '/setup'].includes(route)) await boot(); throw new Error(result.message || '请求失败，请重试'); }
  return result;
}
function element(tag, className, text) { const e = document.createElement(tag); if (className) e.className = className; if (text !== undefined) e.textContent = text; return e; }
function button(label, action, className = 'secondary') { const b = element('button', className, label); b.type = 'button'; b.addEventListener('click', () => busy(b, action)); return b; }
async function busy(b, action) { if (b.disabled) return; b.disabled = true; const label = b.textContent; b.textContent = '处理中…'; try { await action(); } catch (error) { notice(error.message || '服务连接失败', true); } finally { b.disabled = false; b.textContent = label; if (b.closest('#pairing-form')) updatePairingReady(); } }
function form(id, action) { $(id).addEventListener('submit', e => { e.preventDefault(); busy(e.submitter || $(id).querySelector('button'), action); }); }
function empty(container, text) { container.replaceChildren(element('p', 'empty', text)); }
function date(value) { return new Date(value).toLocaleString('zh-CN', { hour12: false }); }
function row(title, description, actions = []) { const r = element('div', 'list-row'), copy = element('div', 'row-content'), buttons = element('div', 'row-actions'); copy.append(element('strong', '', title), element('p', '', description)); buttons.append(...actions); r.append(copy, buttons); return r; }
function result(title, description, value, image, codeId = '') { resultCodeId = codeId; $('delete-result').hidden = !codeId; $('result-title').textContent = title; $('result-description').textContent = description; $('result-value').value = value; $('pair-qr').hidden = !image; if (image) $('pair-qr').src = image; else $('pair-qr').removeAttribute('src'); $('result-dialog').showModal(); }
function confirmAction(title, description) { return new Promise(resolve => { const d = $('confirm-dialog'); $('confirm-title').textContent = title; $('confirm-description').textContent = description;
  const done = value => { d.close(); $('confirm-ok').onclick = null; $('confirm-cancel').onclick = null; d.oncancel = null; resolve(value); };
  $('confirm-ok').onclick = () => done(true); $('confirm-cancel').onclick = () => done(false); d.oncancel = e => { e.preventDefault(); done(false); }; d.showModal(); }); }
async function tab(name) { if (!titles[name]) name = 'overview'; currentTab = name; if (name === 'nodes' || name === 'pairings') $('advanced-nav').open = true; $('page-title').textContent = titles[name]; document.querySelectorAll('.panel').forEach(p => { p.hidden = p.id !== 'panel-' + name; }); document.querySelectorAll('[data-tab]').forEach(b => { b.classList.toggle('active', b.dataset.tab === name); b.setAttribute('aria-current', b.dataset.tab === name ? 'page' : 'false'); }); if (name === 'codes') await loadCodes(); if (name === 'pairings') await loadPairings(); if (name === 'share') await loadShare(); if (name === 'announcements') await loadAnnouncements(); }
async function boot() {
  csrf = ''; overview = null; $('dashboard').hidden = true; $('gate').hidden = false;
  resetAnnouncement(); $('announcements-list').replaceChildren();
  for (const id of ['password', 'setup-token', 'app-secret', 'grant-token', 'old-password', 'new-password']) $(id).value = '';
  if ($('result-dialog').open) $('result-dialog').close();
  if ($('confirm-dialog').open) $('confirm-cancel').click();
  try {
    const status = await api('/status'); initialized = status.initialized; csrf = status.csrf;
    $('gate-title').textContent = initialized ? '欢迎回来' : '初始化管理台';
    $('gate-description').textContent = initialized ? '使用你设置的管理密码进入私有后台。' : '使用服务器初始化密钥，设置唯一的管理密码。';
    $('setup-fields').hidden = initialized; $('setup-token').required = !initialized;
    $('auth-submit').textContent = initialized ? '登录管理台' : '创建管理密码'; $('auth-form').hidden = false;
    if (status.authenticated) { await refresh(); $('gate').hidden = true; $('dashboard').hidden = false; await tab(currentTab); }
  } catch (error) { $('gate-title').textContent = '暂时无法连接'; $('gate-description').textContent = '请检查服务运行状态后刷新页面。'; notice(error.message, true); }
}
async function refresh() {
  overview = await api('/overview');
  $('stat-nodes').textContent = overview.nodes.filter(n => !n.disabled).length;
  $('stat-online').textContent = overview.nodes.filter(n => n.online).length;
  $('stat-admins').textContent = overview.admins.length;
  $('server-origin').textContent = overview.origin;
  $('app-id').value = overview.settings.appId; $('app-id').readOnly = !!overview.settings.appId;
  $('wechat-status').textContent = overview.settings.secretConfigured ? 'AppSecret 已加密保存。更换时填写新值，留空则保留。' : '尚未配置微信凭据。节点配对与网页管理可独立使用。';
  $('grant-url').value = overview.settings.grantUrl || '';
  $('checklist').replaceChildren();
  for (const [i, item] of [
    ['配置小程序', overview.settings.secretConfigured ? '微信凭据已保存' : '填写 AppID 与 AppSecret，启用微信身份核验', 'wechat'],
    ['绑定管理员', overview.admins.length ? '已绑定 ' + overview.admins.length + ' 个微信身份' : '复制小程序 WX- 设备 ID，在网页核实并绑定', 'wechat'],
    ['分发公网有效期', '生成兑换码，用户兑换后扫描自己 DSH 插件的二维码', 'codes']
  ].entries()) { const r = element('div', 'check-row'), copy = element('div'); copy.append(element('strong', '', item[0]), element('p', '', item[1])); r.append(element('span', 'check-number', String(i + 1).padStart(2, '0')), copy, button('查看 →', () => tab(item[2]), 'quiet')); $('checklist').append(r); }
  $('admins').replaceChildren(); if (!overview.admins.length) empty($('admins'), '还没有绑定微信管理员');
  for (const admin of overview.admins) $('admins').append(row(admin.label, admin.deviceId ? '设备ID：' + admin.deviceId : '设备ID待同步，请本人打开新版小程序设置', admin.source === 'environment' ? [element('span', 'tag', '环境配置')] : [button('移除权限', async () => { if (await confirmAction('移除管理员？', '此微信将立即失去管理权限，网页管理密码不受影响。')) { await api('/admins/remove', { openid: admin.openid }); await refresh(); } }, 'quiet danger')]));
  $('nodes').replaceChildren(); $('code-node').replaceChildren();
  const globalScope = element('option', '', '鲸尾公网服务（用户自己的设备）'); globalScope.value = ''; $('code-node').append(globalScope);
  if (!overview.nodes.length) empty($('nodes'), '还没有节点。先添加一台运行 DSH 的电脑。');
  for (const node of overview.nodes) {
    const card = element('article', 'card'), head = element('div', 'section-head'), actions = element('div', 'node-actions');
    head.append(element('h2', '', node.name), element('span', 'tag', node.disabled ? '已停用' : node.online ? '在线' : '离线'));
    card.append(head, element('p', 'muted', node.message), element('p', 'node-meta', '公网 ID：' + (node.relayNodeId || '等待连接器注册')), element('p', 'node-meta', '在线连接数：' + node.connectedDevices + (node.lastSeenAt ? ' · 最近心跳 ' + date(node.lastSeenAt) : '')));
    const pair = button('限时配对', async () => { await tab('pairings'); $('pair-node').value = node.id; updatePairingReady(); }); pair.disabled = node.disabled;
    actions.append(pair, button('重置连接器', async () => { if (await confirmAction('重置连接器凭据？', '旧连接器将失效，需要在电脑端更新配置；已配对的网关设备不会被撤销。')) { showConnector(await api('/nodes/' + node.id + '/rotate', {})); await refresh(); } }, 'quiet'));
    if (!node.disabled) actions.append(button('停用', async () => { if (await confirmAction('停用此连接器？', '停用后无法从网页生成新配对码，不会停止 DSH，也不会撤销既有设备。')) { await api('/nodes/' + node.id + '/disable', {}); await refresh(); } }, 'quiet danger'));
    card.append(actions); $('nodes').append(card);
    if (overview.settings.grantUrl && !node.disabled && node.relayNodeId) { const option = element('option', '', '旧版节点授权：' + node.name); option.value = node.relayNodeId; $('code-node').append(option); }
  }
  if (!$('code-node').options.length) { const option = element('option', '', '先接入公网节点'); option.value = ''; $('code-node').append(option); }
}
function showConnector(data) { result('电脑端连接器配置', '将以下内容保存到电脑端 connector.json（仅本人可读）。connector.cjs 与 durations.cjs 放在同一目录，gateway 改为 DSH WebUI 端口，再运行：node connector.cjs /绝对路径/connector.json。限时功能还需安装网关扩展。凭据只显示一次。', JSON.stringify({ server: data.server, token: data.token, gateway: 'http://127.0.0.1:填入DSH端口' }, null, 2)); }
function updatePairingReady() {
  const node = pairingNodes.find(n => n.id === $('pair-node').value);
  $('pairing-form').querySelector('button').disabled = pairingIssuing || !node?.managedPairingReady;
  $('pair-readiness').textContent = !node ? '请先在「节点与配对」添加电脑并运行连接器。' : !node.online ? '节点离线，等待电脑端连接器上线。' : !node.managedPairingReady ? '节点未就绪：请启用中继模式并安装限时配对扩展。' : '节点已就绪，可签发限时配对码。';
}
async function loadPairings() {
  if (pairingSyncBusy) return; pairingSyncBusy = true;
  try {
    const state = await api('/pairings');
    if ($('dashboard').hidden) return;
    pairingNodes = state.nodes.filter(n => !n.disabled);
    const nodeId = $('pair-node').value, days = $('pair-days').value || '30';
    $('pair-node').replaceChildren();
    for (const node of pairingNodes) { const o = element('option', '', node.name + (node.managedPairingReady ? ' · 可签发' : node.online ? ' · 未就绪' : ' · 离线')); o.value = node.id; $('pair-node').append(o); }
    if (!$('pair-node').options.length) { const o = element('option', '', '先在节点管理添加电脑'); o.value = ''; $('pair-node').append(o); }
    if ([...$('pair-node').options].some(o => o.value === nodeId)) $('pair-node').value = nodeId;
    $('pair-days').replaceChildren(); for (const duration of state.durations) { const o = element('option', '', duration.label); o.value = duration.days; $('pair-days').append(o); }
    $('pair-days').value = days;
    updatePairingReady();
    $('pair-sync').textContent = '每 10 秒同步 · ' + date(state.syncedAt);
    $('pairing-records').replaceChildren();
    if (!state.items.length) empty($('pairing-records'), '暂无限时配对记录；网页或小程序签发后都会显示在这里。');
    for (const record of state.items) {
      const description = (record.source === 'weapp' ? '小程序签发' : '网页签发') + ' · ' + date(record.createdAt) + '\n访问到期：' + (record.accessExpiresAt ? date(record.accessExpiresAt) : '待确认') + '\n配对截止：' + (record.expiresAt ? date(record.expiresAt) : '待确认') + '\n编号：' + record.id;
      const actions = ['pending', 'active'].includes(record.status) ? [button('停用', async () => { if (await confirmAction('停用这次限时配对？', '后台会通知电脑撤销。离线时显示等待确认，不会假装已经停用。')) { await api('/pairings/' + record.id + '/revoke', {}); await loadPairings(); } }, 'quiet danger')] : [];
      const item = row(record.nodeName + ' · ' + record.days + ' 天 · ' + (pairingStatuses[record.status] || '待确认'), description, actions);
      item.classList.add('pairing-record'); $('pairing-records').append(item);
    }
  } finally { pairingSyncBusy = false; }
}
async function loadCodes() {
  const { items } = await api('/codes'); $('codes').replaceChildren(); if (!items.length) empty($('codes'), '还没有生成兑换码');
  for (const code of items) {
    const status = code.revokedAt ? '已停用' : code.expiresAt <= Date.now() ? '已过期' : code.used >= code.uses ? '已用完' : '可兑换';
    const actions = [button('复制', async () => { const value = await api('/codes/' + code.id + '/copy', {}); try { await navigator.clipboard.writeText(value.code); notice('兑换码已复制'); } catch { result('复制兑换码', '浏览器未允许自动复制，可选中文字复制。', value.code, null, code.id); } })];
    if (status === '可兑换') actions.push(button('停用', async () => { if (await confirmAction('停用兑换码？', '将停止新的兑换，已完成授权不受影响。')) { await api('/codes/' + code.id + '/revoke', {}); await loadCodes(); } }, 'quiet'));
    actions.push(button('删除', () => deleteCode(code.id), 'quiet danger'));
    $('codes').append(row(code.days + ' 天 · 已用 ' + code.used + '/' + code.uses + ' · ' + status, (code.nodeId ? '旧版节点 ' + code.nodeId : '鲸尾公网服务 · 不限制局域网') + ' · ' + date(code.expiresAt) + ' 前兑换' + (code.canCopy ? '' : ' · 旧码仅存哈希，无法恢复原码'), actions));
  }
}
async function deleteCode(id) {
  if (!await confirmAction('删除兑换码？', '将停止新的兑换并从列表移除，已兑换的公网时长不受影响；保留必要使用审计记录。')) return;
  await api('/codes/' + id + '/delete', {});
  if (resultCodeId === id && $('result-dialog').open) $('result-dialog').close();
  await loadCodes(); notice('兑换码已删除');
}
async function loadShare() {
  const state = await api('/share');
  sharingEnabled = state.rules.enabled;
  $('toggle-sharing').disabled = false;
  $('toggle-sharing').textContent = sharingEnabled ? '已开启 · 点击关闭' : '已关闭 · 点击开启';
  $('toggle-sharing').setAttribute('aria-pressed', String(sharingEnabled));
  if ($('dashboard').hidden) return;
  $('share-enabled').value = String(state.rules.enabled);
  state.rules.tiers.forEach((t,i) => { $('tier-' + (i+1) + '-days').value = t.days; if (i) $('tier-' + (i+1) + '-from').value = t.from; });
  $('moments-days').value = state.rules.momentsDays;
  $('moments-records').replaceChildren();
  if (!state.items.length) empty($('moments-records'), '暂无朋友圈登记记录');
  const statuses = { waiting:'等待满24小时后复核', pending:'待审核', approved:'已发放', rejected:'未通过', expired:'凭证过期' };
  for (const item of state.items) {
    const card = element('article', 'proof-card');
    card.append(element('h3', '', item.day + ' · ' + (statuses[item.status] || item.status)), element('p', 'muted', item.deviceId + ' · 奖励 ' + item.days + ' 天 · 登记 ' + date(item.createdAt)));
    if (item.note) card.append(element('p', 'help', item.note));
    const proofs = element('div', 'proof-grid');
    if (item.hasProof) card.append(button('查看审核截图', async () => {
      const data = await api('/share/proof/' + item.id); proofs.replaceChildren();
      for (const [key,label] of [['initialProof','发布时截图'],['finalProof','满24小时复核截图']]) {
        if (!data[key]) continue;
        const figure = element('figure'), img = element('img'); img.src = data[key]; img.alt = label; figure.append(element('figcaption','help',label),img); proofs.append(figure);
      }
      if (!data.initialProof && !data.finalProof) empty(proofs, '截图已删除或过期');
    }, 'quiet'));
    card.append(proofs);
    if (item.status === 'pending') {
      const note = element('input'); note.maxLength = 200; note.placeholder = '审核说明（可选）'; note.setAttribute('aria-label','审核说明'); card.append(note);
      const actions = element('div','node-actions');
      for (const [action,label] of [['approve','通过并发奖'],['reject','拒绝']]) actions.append(button(label, async () => {
        if (!await confirmAction(label + '？', action === 'approve' ? '请人工核实两张截图属于同一条鲸尾分享；提交后发奖一次并删除截图。' : '拒绝后不发奖并删除截图。')) return;
        await api('/share/review', { id:item.id, action, note:note.value.trim() }); await loadShare();
      }, action === 'approve' ? 'primary' : 'quiet danger'));
      card.append(actions);
    }
    $('moments-records').append(card);
  }
}
form('device-admin-form', async () => { const deviceId = $('device-admin-id').value.trim().toUpperCase(); if (!await confirmAction('绑定这个微信为管理员？', '请先向本人核实设备 ID：' + deviceId + '。此权限可以生成、复制和删除兑换码。')) return; await api('/admins/device', {deviceId, label:$('device-admin-label').value.trim()}); $('device-admin-id').value = ''; await refresh(); notice('绑定成功，请重新进入小程序设置'); });
form('share-rules-form', async () => { await api('/share/rules', {enabled:$('share-enabled').value === 'true', tiers:[1,2,3].map(i=>({from:i===1?1:Number($('tier-'+i+'-from').value),days:Number($('tier-'+i+'-days').value)})), momentsDays:Number($('moments-days').value)}); await loadShare(); notice('活动规则已保存'); });
$('refresh-share').onclick = () => busy($('refresh-share'), loadShare);
$('delete-result').onclick = () => busy($('delete-result'), () => deleteCode(resultCodeId));
form('auth-form', async () => { $('auth-error').textContent = ''; try { const value = await api(initialized ? '/login' : '/setup', { password: $('password').value, setupToken: $('setup-token').value }); csrf = value.csrf; $('password').value = ''; $('setup-token').value = ''; await boot(); } catch (e) { $('auth-error').textContent = e.message; } });
form('wechat-form', async () => { await api('/settings', { appId: $('app-id').value.trim(), appSecret: $('app-secret').value.trim() }); $('app-secret').value = ''; await refresh(); notice('微信配置已保存'); });
form('node-form', async () => { showConnector(await api('/nodes', { name: $('node-name').value.trim() })); $('node-name').value = ''; await refresh(); });
form('pairing-form', async () => {
  pairingIssuing = true;
  try {
  const p = await api('/pairings', { nodeId: $('pair-node').value, days: Number($('pair-days').value) });
  result('限时配对码', p.nodeName + ' · ' + p.days + ' 天 · 访问截止 ' + date(p.accessExpiresAt) + '。请在 ' + date(p.expiresAt) + ' 前扫码或粘贴配对，完整码只显示本次。', p.qrPayload, p.qrImage);
  await loadPairings();
  } finally { pairingIssuing = false; }
});
$('pair-node').addEventListener('change', updatePairingReady);
form('grant-form', async () => { await api('/grant-settings', { url: $('grant-url').value.trim(), token: $('grant-token').value }); $('grant-token').value = ''; await refresh(); notice('授权接口已保存，请完成真实到期控制联调后分发兑换码'); });
form('code-form', async () => { const value = await api('/codes', { nodeId: $('code-node').value, days: Number($('code-days').value), uses: Number($('code-uses').value) }); result('兑换码', value.days + ' 天 · ' + value.uses + ' 人 · ' + date(value.expiresAt) + ' 前兑换。不是设备配对码。', value.code, null, value.id); await loadCodes(); });
form('password-form', async () => { await api('/password', { currentPassword: $('old-password').value, password: $('new-password').value }); $('old-password').value = ''; $('new-password').value = ''; await boot(); notice('密码已更新，请重新登录'); });
$('refresh').onclick = () => busy($('refresh'), async () => { await refresh(); if (currentTab === 'codes') await loadCodes(); if (currentTab === 'pairings') await loadPairings(); if (currentTab === 'share') await loadShare(); if (currentTab === 'announcements') await loadAnnouncements(); notice('状态已刷新'); });
$('logout').onclick = () => busy($('logout'), async () => { await api('/logout', {}); await boot(); });
$('close-result').onclick = () => $('result-dialog').close();
$('result-dialog').addEventListener('close', () => { resultCodeId = ''; $('result-value').value = ''; $('pair-qr').removeAttribute('src'); });
$('copy-result').onclick = () => busy($('copy-result'), async () => { try { await navigator.clipboard.writeText($('result-value').value); notice('已复制'); } catch { $('result-value').focus(); $('result-value').select(); notice('浏览器不允许自动复制，请复制已选中的内容', true); } });
$('theme').onclick = () => { const dark = document.documentElement.dataset.theme ? document.documentElement.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme:dark)').matches; document.documentElement.dataset.theme = dark ? 'light' : 'dark'; };
document.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => { tab(b.dataset.tab).catch(e => notice(e.message, true)); }));
document.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => { tab(b.dataset.go).catch(e => notice(e.message, true)); }));
function resetAnnouncement() { announcementEditing = null; $('announcement-form').reset(); $('announcement-editor-title').textContent = '发布公告'; $('announcement-cancel').hidden = true; }
async function loadAnnouncements() {
  const { items } = await api('/announcements');
  if ($('dashboard').hidden) return;
  const list = $('announcements-list'); list.replaceChildren();
  if (!items.length) empty(list, '暂无公告。在左侧发布第一条，或由小程序管理员发布。');
  for (const item of items) {
    const card = element('article', 'announcement-record'), details = element('details', 'announcement-preview');
    const summary = element('summary'); summary.append(element('span', 'announcement-tag', '公告'), element('strong', '', item.title));
    details.append(summary, element('p', 'announcement-body', item.content));
    const actions = element('div', 'row-actions');
    actions.append(button('编辑', () => { announcementEditing = item; $('announcement-title').value = item.title; $('announcement-content').value = item.content; $('announcement-editor-title').textContent = '编辑公告'; $('announcement-cancel').hidden = false; $('announcement-title').focus(); }, 'quiet'),
      button('删除', async () => { if (!await confirmAction('删除公告？', '「' + item.title + '」将从小程序移除。')) return; await api('/announcements/' + item.id + '/delete', { revision: item.revision }); if (announcementEditing?.id === item.id) resetAnnouncement(); await loadAnnouncements(); notice('公告已删除'); }, 'quiet danger'));
    card.append(details, element('p', 'help', date(item.createdAt) + (item.revision > 1 ? ' · 已编辑' : '')), actions); list.append(card);
  }
}
form('announcement-form', async () => {
  const input = { title: $('announcement-title').value.trim(), content: $('announcement-content').value.trim() };
  if (!input.title || !input.content) throw new Error('请填写标题和正文');
  if (announcementEditing) { input.id = announcementEditing.id; input.revision = announcementEditing.revision; }
  await api('/announcements', input); resetAnnouncement(); await loadAnnouncements(); notice('公告已发布，小程序重新进入公告页即可看到');
});
$('announcement-cancel').onclick = resetAnnouncement;
$('refresh-announcements').onclick = () => busy($('refresh-announcements'), loadAnnouncements);
$('toggle-sharing').onclick = async () => {
  await busy($('toggle-sharing'), async () => {
    const enabled = !sharingEnabled;
    if (enabled && !await confirmAction('开启分享活动？', '请先确认活动规则、微信运营要求和奖励成本，开启后用户可以参与分享。')) return;
    await api('/share/enabled', { enabled }); sharingEnabled = enabled; notice(enabled ? '分享已开启' : '分享已关闭，用户刷新或重新进入设置后隐藏按钮');
  });
  try { await loadShare(); } catch (error) { notice(error.message, true); }
};
boot();
setInterval(() => { if (!document.hidden && !$('dashboard').hidden && currentTab === 'pairings' && !document.querySelector('dialog[open]') && !pairingIssuing) loadPairings().catch(e => { $('pair-sync').textContent = '同步失败：' + e.message; }); }, 10000);
