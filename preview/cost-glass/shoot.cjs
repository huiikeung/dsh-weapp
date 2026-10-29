// 预览额度卡片页的玻璃 UI（深/浅色各一张）：卡片 + 底部弹窗。
// 用法: node preview/cost-glass/shoot.cjs
// 玻璃材质直接从 styles/glass-ui.wxss 与 cost-meter.wxss 抽取并把 rpx 折算成 px，
// 避免预览与实现脱节。无第三方依赖。
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const dir = __dirname;
const root = path.resolve(dir, '..', '..');
const glass = fs.readFileSync(path.join(root, 'miniprogram/styles/glass-ui.wxss'), 'utf8');
const page = fs.readFileSync(path.join(root, 'miniprogram/pages/cost-meter/cost-meter.wxss'), 'utf8')
  .split('\n').filter(line => !line.startsWith('@import')).join('\n');
const toPx = css => css.replace(/(\d+(?:\.\d+)?)rpx/g, (_, value) => {
  const px = Number(value) / 2;
  return (Number.isInteger(px) ? px : px.toFixed(2).replace(/\.?0+$/, '')) + 'px';
});
const sheetCss = toPx(glass + '\n' + page);

const stage = (theme, glass, sheet) => `
  <section class="stage theme-${theme}">
    <div class="cost-page theme-${theme} ${glass ? 'cost-glass' : ''}">
      <div class="cost-nav"><div class="cost-nav-back">‹</div><div class="cost-nav-title">额度卡片</div><div class="cost-nav-refresh">↻</div></div>
      <div class="cost-overview">
        <div class="cost-overview-heading"><div><span class="cost-eyebrow">USAGE</span><span class="cost-overview-title">今日用量</span></div><span class="cost-updated">刚刚更新</span></div>
        <div class="cost-stats-grid">
          <div class="cost-stat cost-stat-primary"><span class="cost-stat-label">今日</span><span class="cost-stat-value">¥0.42</span><span class="cost-stat-meta">12.3k tokens</span></div>
          <div class="cost-stat"><span class="cost-stat-label">本月</span><span class="cost-stat-value">¥8.36</span><span class="cost-stat-meta">286k tokens</span></div>
        </div>
      </div>
      <div class="cost-section">
        <span class="cost-section-title">显示设置</span>
        <div class="cost-card cost-entry-card ${glass ? 'settings-glass-card' : ''}">
          <div class="cost-row"><div class="cost-row-copy"><span class="cost-row-label">左侧栏样式</span><span class="cost-row-hint">合并卡片 · 货币单位 CNY</span></div><div class="cost-row-value"><span class="cost-chevron">›</span></div></div>
          <div class="cost-divider"></div>
          <div class="cost-row"><div class="cost-row-copy"><span class="cost-row-label">显示额度卡片</span><span class="cost-row-hint">在左侧栏显示余额与额度卡片</span></div><span class="cost-switch">开</span></div>
        </div>
      </div>
    </div>
    ${sheet ? `<div class="choice-sheet-mask">
      <div class="choice-sheet${glass ? ' choice-sheet-glass' : ''}" data-mock-menu>
        <div class="choice-sheet-grabber"><div class="choice-sheet-grabbar"></div></div>
        <div class="choice-sheet-body">
          <div class="settings-choice-content">
            <div class="settings-choice-row"><img class="settings-choice-ic" src="../../miniprogram/assets/icons/check-fill-white.png"><span class="settings-choice-label">人民币 CNY</span></div>
            <div class="settings-choice-row"><img class="settings-choice-ic" src="../../miniprogram/assets/icons/circle-white.png"><span class="settings-choice-label">美元 USD</span></div>
            <div class="settings-choice-row"><img class="settings-choice-ic" src="../../miniprogram/assets/icons/circle-white.png"><span class="settings-choice-label">欧元 EUR</span></div>
          </div>
        </div>
      </div>
    </div>` : `<div class="settings-choice${glass ? ' settings-choice-glass' : ''}" style="left: 24px; top: 210px; width: 243px; height: 140px;">
      <div class="settings-choice-content">
        <div class="settings-choice-row"><img class="settings-choice-ic" src="../../miniprogram/assets/icons/check-fill-white.png"><span class="settings-choice-label">人民币 CNY</span></div>
        <div class="settings-choice-row"><img class="settings-choice-ic" src="../../miniprogram/assets/icons/circle-white.png"><span class="settings-choice-label">美元 USD</span></div>
        <div class="settings-choice-row"><img class="settings-choice-ic" src="../../miniprogram/assets/icons/circle-white.png"><span class="settings-choice-label">欧元 EUR</span></div>
      </div>
    </div>`}
    <div class="cost-sheet-mask">
      <div class="cost-sheet ${glass ? 'settings-glass-sheet' : ''}">
        <div class="cost-sheet-grabber"><div class="cost-sheet-grabbar"></div></div>
        <div class="cost-sheet-head"><span class="cost-sheet-title">显示设置</span><div class="cost-sheet-close">✕</div></div>
        <div class="cost-sheet-body carded">
          <div class="cost-card settings-glass-card">
            <div class="cost-row"><div class="cost-row-copy"><span class="cost-row-label">左侧栏样式</span><span class="cost-row-hint">合并卡片</span></div><div class="cost-row-value"><span class="cost-chevron">›</span></div></div>
            <div class="cost-divider"></div>
            <div class="cost-row"><div class="cost-row-copy"><span class="cost-row-label">显示额度卡片</span><span class="cost-row-hint">在左侧栏显示余额与额度卡片</span></div><span class="cost-switch">开</span></div>
          </div>
        </div>
      </div>
    </div>
  </section>`;

const shell = fs.readFileSync(path.join(dir, 'index.html'), 'utf8').replace('/*__SHEET_CSS__*/', sheetCss);

const candidates = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/chromium'
];
const browser = candidates.find(candidate => { try { fs.accessSync(candidate); return true; } catch (error) { return false; } });
if (!browser) { console.error('no headless browser found'); process.exit(1); }

for (const theme of ['dark', 'light']) {
  for (const glass of [true, false]) {
    for (const sheet of [false, true]) {
    const name = 'preview-' + theme + (glass ? '' : '-native') + (sheet ? '-sheet' : '') + '.png';
    const temp = path.join(dir, 'shot-tmp.html');
    fs.writeFileSync(temp, shell.replace('__STAGES__', stage(theme, glass, sheet)));
    try {
      execFileSync(browser, ['--headless=new', '--no-sandbox', '--hide-scrollbars', '--force-device-scale-factor=2',
        '--window-size=452,900', '--screenshot=' + path.join(dir, name), 'file://' + temp], { stdio: 'ignore' });
      console.log('wrote ' + name);
    } finally { fs.unlinkSync(temp); }
    }
  }
}