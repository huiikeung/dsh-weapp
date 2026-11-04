'use strict';
// 预览「设置 → 公网访问 → 在线购买公网有效期」的档位选择卡与主按钮。
// 用法：node preview/pay-block/shoot.cjs
// 直接抽取 settings.wxss / glass-ui.wxss 并把 rpx 折算成 px，避免预览与实现脱节；
// 弹窗骨架按 settings.wxss 的取值模仿。无第三方依赖。

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const dir = __dirname;
const root = path.resolve(dir, '..', '..');
const px = css => css.replace(/(\d+(?:\.\d+)?)rpx/g, (_, value) => {
  const value2 = Number(value) / 2;
  return (Number.isInteger(value2) ? value2 : value2.toFixed(2).replace(/\.?0+$/, '')) + 'px';
});
const wxss = px(fs.readFileSync(path.join(root, 'miniprogram/pages/settings/settings.wxss'), 'utf8'));
const glass = px(fs.readFileSync(path.join(root, 'miniprogram/styles/glass-ui.wxss'), 'utf8'));

const tiers = [
  { days: '3 天', price: '2', unit: '¥0.67/天' },
  { days: '7 天', price: '4', unit: '¥0.57/天' },
  { days: '30 天', price: '12', unit: '¥0.40/天', best: true, selected: true }
];

const tierHtml = item => `<div class="pay-tier ${item.selected ? 'is-selected' : ''}">
  <div class="pay-tier-head">${item.best ? '<span class="pay-tier-best">推荐</span>' : ''}<span class="pay-tier-radio ${item.selected ? 'on' : ''}"><span class="pay-tier-radio-dot"></span></span></div>
  <span class="pay-tier-days">${item.days}</span>
  <div class="pay-tier-price"><span class="pay-tier-currency">¥</span><span class="pay-tier-amount">${item.price}</span></div>
  <span class="pay-tier-unit">${item.unit}</span>
</div>`;

const stage = theme => `<section class="stage theme-${theme}">
  <div class="mask">
    <div class="pair-sheet settings-glass-sheet">
      <div class="sheet-grabber-zone"><div class="sheet-grabber"></div></div>
      <div class="pair-sheet-head">
        <div><span class="pair-sheet-title">公网访问</span><span class="pair-sheet-subtitle">管理当前微信账号的公网有效期</span></div>
        <div class="pair-sheet-close"><div class="close-x"></div></div>
      </div>
      <div class="card public-card">
        <div class="public-head">
          <img class="public-icon" src="../../miniprogram/assets/icons/node-router.svg">
          <div class="public-main"><span class="public-title">公网访问已开启</span><span class="public-sub">外网可经中继访问这台设备</span></div>
        </div>
        <div class="public-detail-row"><span class="public-detail-label">访问状态</span><span class="public-pill on"><span class="public-pill-dot"></span>已授权</span></div>
        <div class="public-detail-row"><span class="public-detail-label">设备 ID</span><span class="public-detail-value mono">7f3a9c2d</span></div>
        <div class="public-detail-row"><span class="public-detail-label">访问有效期</span><span class="public-detail-value">2026-12-04 23:59</span></div>
        <div class="public-actions"><button class="public-share">分享</button><button class="public-redeem">兑换续期</button></div>
      </div>
      <div class="pay-block">
        <div class="pay-head"><span class="pay-title">在线购买公网有效期</span><span class="pay-sub">虚拟商品，支付后即时生效。</span></div>
        <div class="pay-grid">${tiers.map(tierHtml).join('')}</div>
        <div class="pay-buy"><span class="pay-buy-label">立即购买</span><span class="pay-buy-price">¥12</span></div>
        <div class="pay-compliance"><span class="pay-compliance-text">Android 可联系客服退款；iOS 购买请通过 App Store 申请退款。</span><button class="pay-support">联系客服</button></div>
      </div>
    </div>
  </div>
</section>`;

const stageCss = `
  * { box-sizing: border-box; }
  html, body { margin: 0; }
  body { background: #dfe5ee; font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif; padding: 18px; }
  .stage { position: relative; width: 390px; border-radius: 32px; overflow: hidden; padding: 20px 12px 24px; }
  .stage.theme-dark {
    --surface: #1C1C1E; --text: #F1F4FA; --text-2: rgba(241,244,250,.62); --text-3: rgba(241,244,250,.55);
    --border: rgba(255,255,255,.10); --border-strong: rgba(255,255,255,.16); --divider: rgba(255,255,255,.08);
    --fill: rgba(255,255,255,.06); --fill-2: rgba(255,255,255,.10); --ocean: #2E6BE6; --success: #2EB85C; --card-shadow: none;
    --glass-alpha-top: .10; --glass-alpha-bottom: .04; --glass-edge-alpha: .38; --glass-blur-sheet: 8px; --glass-radius-sheet: 16px;
    background: radial-gradient(120% 70% at 75% 0%, #1d4d8f 0%, #0d2340 45%, #07101c 100%); color: var(--text);
  }
  .stage.theme-light {
    --surface: #FFFFFF; --text: #10131A; --text-2: rgba(16,19,24,.62); --text-3: rgba(16,19,24,.55);
    --border: rgba(16,19,24,.10); --border-strong: rgba(16,19,24,.16); --divider: rgba(16,19,24,.08);
    --fill: rgba(16,19,24,.05); --fill-2: rgba(16,19,24,.07); --ocean: #2E6BE6; --success: #2EB85C; --card-shadow: 0 1px 6px rgba(7,24,43,.05);
    --glass-alpha-top: .96; --glass-alpha-bottom: .92; --glass-edge-alpha: .10; --glass-blur-sheet: 24px; --glass-radius-sheet: 16px;
    background: linear-gradient(160deg, #eaf1fb 0%, #f6f8fc 60%, #eef2f8 100%); color: var(--text);
  }
  .mask { display: flex; align-items: flex-end; }
  .pair-sheet { width: 100%; padding: 4px 16px 18px; }
  .pair-sheet-head { margin: 6px 0 8px; }
  .pair-sheet-title { font-size: 17px; }
  .pair-sheet-subtitle { margin-top: 2px; }
  .close-x { width: 16px; height: 16px; position: relative; }
  .close-x::before, .close-x::after { content: ''; position: absolute; left: 50%; top: 50%; width: 11px; height: 1.5px; background: var(--text-2); border-radius: 2px; }
  .close-x::before { transform: translate(-50%, -50%) rotate(45deg); }
  .close-x::after { transform: translate(-50%, -50%) rotate(-45deg); }
  .card { border-radius: 14px; overflow: hidden; border: .5px solid var(--border); background: var(--surface); }
  .public-card { padding: 14px; }
  .public-head { display: flex; align-items: center; gap: 11px; }
  .public-icon { width: 44px; height: 44px; }
  .public-title { display: block; font-size: 15px; font-weight: 600; }
  .public-sub { display: block; margin-top: 3px; color: var(--text-2); font-size: 12px; }
  .public-detail-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 10px; min-height: 26px; }
  .public-detail-label { flex: none; font-size: 12.5px; color: var(--text-2); }
  .public-detail-value { flex: 1; min-width: 0; text-align: right; font-size: 12px; }
  .public-detail-value.mono { font-family: Menlo, Consolas, monospace; }
  .public-pill { display: flex; align-items: center; gap: 5px; padding: 3px 8px; border-radius: 999px; background: var(--fill); font-size: 11.5px; }
  .public-pill.on { background: rgba(58,130,96,.14); color: #3A8260; }
  .public-pill-dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
  .public-actions { display: flex; gap: 8px; margin-top: 12px; }
  .public-share, .public-redeem { flex: 1; margin: 0; padding: 8px 0; border-radius: 10px; border: 0; font-size: 13px; background: var(--fill-2); color: var(--text); }
  .public-share { background: var(--ocean); color: #fff; }
  .pay-block { margin-top: 17px; }
  ${wxss}
  ${glass}
`;

const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<style>${stageCss}</style></head><body>
__STAGE__
</body></html>`;

const candidates = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/chromium',
  '/usr/bin/google-chrome'
];
const browser = candidates.find(candidate => {
  try { fs.accessSync(candidate); return true; } catch (error) { return false; }
});
if (!browser) {
  console.error('no headless browser found; install Edge/Chrome or adapt the candidate list');
  process.exit(1);
}

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-pay-preview-'));
try {
  for (const theme of ['dark', 'light']) {
    const page = html.replace('__STAGE__', () => stage(theme));
    const temp = path.join(dir, 'shot-tmp.html');
    fs.writeFileSync(temp, page);
    try {
      execFileSync(browser, [
        '--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars',
        '--user-data-dir=' + profile,
        '--force-device-scale-factor=2',
        '--window-size=430,900',
        '--screenshot=' + path.join(dir, 'preview-' + theme + '.png'),
        'file://' + temp
      ], { stdio: 'ignore' });
      console.log('wrote preview-' + theme + '.png');
    } finally {
      fs.unlinkSync(temp);
    }
  }
} finally {
  fs.rmSync(profile, { recursive: true, force: true });
}
