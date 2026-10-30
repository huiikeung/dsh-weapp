// 预览模型管理页：node preview/models-page/shoot.cjs
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const dir = __dirname;
const root = path.resolve(dir, '..', '..');
const rawCss = fs.readFileSync(path.join(root, 'miniprogram/pages/models/models.wxss'), 'utf8')
  .split('\n').filter(line => !line.startsWith('@import')).join('\n');
const toPx = s => s.replace(/(\d+(?:\.\d+)?)rpx/g, (_, v) => {
  const px = Number(v) / 2;
  return (Number.isInteger(px) ? px : px.toFixed(2).replace(/\.?0+$/, '')) + 'px';
});

const icon = name => '../../miniprogram/assets/icons/' + name;
const row = (name, custom, dot, models) => [
  '  <div class="provider-card">',
  '    <div class="provider-row">',
  '      <span class="provider-name">' + name + '</span>',
  custom ? '      <span class="provider-badge">自定义</span>' : '',
  '      <div class="provider-dot ' + dot + '"></div>',
  '      <div class="provider-actions"><div class="provider-edit">' + (models ? '完成' : '编辑') + '</div></div>',
  '    </div>',
  models ? [
    '    <div class="provider-body">',
    '      <div class="provider-meta">',
    '        <div class="provider-meta-row"><span class="provider-meta-label">API 协议</span><span class="provider-meta-value">OpenAI Chat Completions</span></div>',
    '        <div class="provider-meta-row"><span class="provider-meta-label">接口地址</span><span class="provider-meta-value provider-meta-mono">https://token-plan-cn.xiaomimimo.com/v1</span></div>',
    '      </div>',
    '      <div class="provider-models-head"><span class="provider-models-title">模型</span><span class="provider-models-count">2 个模型</span></div>',
    models,
    '      <div class="model-add"><span class="model-add-plus">＋</span><span class="model-add-label">添加模型</span></div>',
    '    </div>'
  ].join('\n') : '',
  '  </div>'
].join('\n');

const modelRow = (name, id, meta, isDefault) => [
  '      <div class="model-row">',
  '        <div class="model-copy">',
  '          <div class="model-title-row"><span class="model-name">' + name + '</span>' + (isDefault ? '<span class="model-default-badge">默认</span>' : '') + '</div>',
  '          <span class="model-id">' + id + '</span>',
  '          <span class="model-meta">' + meta + '</span>',
  '        </div>',
  '        <div class="model-delete">删除</div>',
  '      </div>'
].join('\n');

const body = [
  '<div class="page models theme-dark">',
  '  <div class="models-nav" style="padding-top: 47px;">',
  '    <div class="models-back"><img class="models-back-ic" src="' + icon('back-white.png') + '"></div>',
  '    <span class="models-title">模型</span>',
  '  </div>',
  '  <div class="models-scroll">',
  '    <div class="models-body">',
  '      <span class="models-intro">管理已配置提供商的模型；修改会同步到 DSH 客户端。</span>',
  '      <div class="models-section-head"><span class="models-section-title">模型提供商</span><span class="models-section-refresh">刷新</span></div>',
  row('opencode-go', false, 'ready', null),
  row('小米', true, 'ready', modelRow('mimo-v2.6-flash', 'mimo-v2.6-flash', '上下文 1M · 文本/图片', true) + '\n' + modelRow('mimo-v2.6-pro', 'mimo-v2.6-pro', '上下文 1M · 文本/图片', false)),
  row('ZAI', true, 'ready', null),
  row('阶跃', true, 'ready', null),
  '      <div class="provider-add"><span class="provider-add-plus">＋</span><span class="provider-add-label">添加模型提供商</span></div>',
  '      <span class="models-footer-hint">提供商配置与 API Key 会写入 DSH，数据和 DSH 客户端双向同步。</span>',
  '    </div>',
  '  </div>',
  '</div>'
].join('\n');

const html = [
  '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>',
  '* { box-sizing: border-box; } html, body { margin: 0; }',
  'body { background: #e9edf3; font-family: -apple-system, "PingFang SC", sans-serif; padding: 28px; }',
  '.stage { position: relative; width: 390px; height: 844px; border-radius: 40px; overflow: hidden; box-shadow: 0 18px 60px rgba(7,24,43,.22); }',
  '.stage.theme-dark { background: #000; color: #F1F4FA; --bg:#000; --surface:#1C1C1E; --fill:rgba(255,255,255,.06); --fill-2:rgba(255,255,255,.10); --border:rgba(255,255,255,.10); --border-strong:rgba(255,255,255,.16); --divider:rgba(255,255,255,.08); --text:#F1F4FA; --text-2:rgba(241,244,250,.62); --text-3:rgba(241,244,250,.55); --text-4:rgba(241,244,250,.45); --placeholder:rgba(241,244,250,.28); --ocean:#2E6BE6; }',
  toPx(rawCss),
  '</style></head><body>',
  '<section class="stage theme-dark">' + body + '</section>',
  '</body></html>'
].join('\n');

const browser = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/usr/bin/chromium']
  .find(p => { try { fs.accessSync(p); return true; } catch (e) { return false; } });
if (!browser) { console.error('no chrome'); process.exit(1); }
const file = path.join(dir, 'shot-tmp.html');
fs.writeFileSync(file, html);
try {
  execFileSync(browser, ['--headless=new', '--no-sandbox', '--hide-scrollbars', '--force-device-scale-factor=2', '--window-size=452,900', '--screenshot=' + path.join(dir, 'models-page.png'), 'file://' + file], { stdio: 'ignore' });
  console.log('wrote models-page.png');
} finally { fs.unlinkSync(file); }
