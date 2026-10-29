// 原生样式设置弹窗预览：node preview/glass-style/shoot.cjs
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const dir = __dirname;

const row = (label, percent, value) => `<div class="glass-alpha-row"><span class="label">${label}</span><div class="glass-alpha-control"><span class="glass-alpha-fake-track"><span class="glass-alpha-fake-fill" style="width: ${percent}%"></span><span class="glass-alpha-fake-knob" style="left: ${percent}%"></span></span><span class="glass-alpha-value">${value}</span></div></div>`;
const rows = () => row('玻璃透明度', 17, '10%') + row('玻璃模糊', 33, '8rpx') + row('玻璃亮度', 50, '100%') + row('玻璃亮边', 47, '38%') + row('玻璃圆角', 60, '32rpx');
const popup = (cls) => `<div class="${cls}"><span class="grabber"></span><div class="glass-style-head"><span class="glass-style-title">原生样式设置</span><span class="glass-style-actions"><span class="glass-style-reset">重置为默认</span><span class="glass-style-done">完成</span></span></div>${rows()}</div>`;

const page = `<!doctype html><html><head><meta charset="utf-8"><style>
  html, body { margin: 0; }
  body { width: 906px; height: 1600px; background: radial-gradient(120% 70% at 50% 0%, #0d1b33 0%, #05070c 60%); color: #F1F4FA; font-family: -apple-system, 'PingFang SC', sans-serif; padding: 36px; box-sizing: border-box; }
  .stage { position: relative; width: 390px; height: 640px; border-radius: 34px; overflow: hidden; background: radial-gradient(120% 80% at 50% 0%, #0d1b33 0%, #05070c 60%); border: 1px solid rgba(255,255,255,.10); }
  .stage + .stage { margin-left: 24px; }
  .stages { display: flex; }
  .title { font-size: 12px; color: rgba(241,244,250,.5); margin: 0 4px 8px; }
  .caption { font-size: 11px; color: rgba(241,244,250,.45); margin: 8px 4px 0; }
  .card { position: absolute; left: 14px; right: 14px; top: 40px; border-radius: 18px; background: linear-gradient(165deg, rgba(255,255,255,.06), rgba(255,255,255,.015)); border: 1px solid rgba(255,255,255,.38); box-shadow: inset 0 1px 0 rgba(255,255,255,.16); padding: 4px 16px; }
  .card-row { display: flex; align-items: center; justify-content: space-between; height: 48px; border-top: 1px solid rgba(255,255,255,.08); font-size: 14px; }
  .card-row:first-child { border-top: none; }
  .chev { width: 7px; height: 7px; border-right: 1.4px solid rgba(241,244,250,.5); border-top: 1.4px solid rgba(241,244,250,.5); transform: rotate(45deg); }
  .arrow { display: flex; align-items: center; gap: 6px; color: rgba(241,244,250,.62); font-size: 12px; }
  .glass-style-sheet, .glass-style-pop { position: absolute; z-index: 2; background: linear-gradient(165deg, rgba(255,255,255,.10), rgba(255,255,255,.04)); border: 1px solid rgba(255,255,255,.38); box-shadow: inset 0 1px 0 rgba(255,255,255,.16), 0 12px 40px rgba(3,14,30,.26); backdrop-filter: blur(8px); }
  .glass-style-sheet.native-skin, .glass-style-pop.native-skin { background: #1C1C1E; border-color: rgba(255,255,255,.10); box-shadow: 0 12px 40px rgba(0,0,0,.24); backdrop-filter: none; }
  .glass-style-sheet { left: 12px; right: 12px; bottom: 18px; border-radius: 16px; padding: 4px 0 15px; }
  .glass-style-pop { left: 37px; top: 200px; width: 316px; border-radius: 16px; padding: 0 0 8px; }
  .glass-style-head { display: flex; align-items: center; justify-content: space-between; padding: 10px 18px 22px; } .glass-style-pop .glass-style-head { padding-top: 12px; }
  .glass-style-title { font-size: 16px; font-weight: 700; }
  .glass-style-caption { padding: 0 18px 4px; font-size: 10px; color: rgba(241,244,250,.62); } .glass-style-actions { display: flex; align-items: center; gap: 6px; } .glass-style-reset { font-size: 11px; padding: 5px 10px; border-radius: 999px; background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.12); color: rgba(241,244,250,.72); } .glass-style-done { font-size: 12px; padding: 5px 12px; border-radius: 999px; background: rgba(255,255,255,.10); border: 1px solid rgba(255,255,255,.18); } .grabber { display: block; width: 34px; height: 4px; border-radius: 2px; background: rgba(241,244,250,.30); margin: 8px auto 2px; }
  .glass-alpha-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 18px; }
  
  .label { font-size: 13px; }
  .glass-alpha-control { display: flex; align-items: center; gap: 8px; width: 58%; }
  .glass-alpha-fake-track { position: relative; flex: 1; height: 4px; border-radius: 2px; background: rgba(150,150,155,.35); }
  .glass-alpha-fake-fill { position: absolute; inset: 0 auto 0 0; border-radius: 2px; background: #fff; }
  .glass-alpha-fake-knob { position: absolute; top: 50%; width: 11px; height: 11px; border-radius: 50%; background: #fff; transform: translate(-50%,-50%); }
  .glass-alpha-value { min-width: 46px; text-align: right; font-size: 11px; color: rgba(241,244,250,.72); font-variant-numeric: tabular-nums; }
  .mask { position: absolute; inset: 0; background: rgba(0,0,0,.45); }
</style></head><body>
  <div class="stages">
    <div>
      <div class="title">底部弹窗形态 · 玻璃</div>
      <div class="stage">
        <div class="mask"></div>
        <div class="card">
          <div class="card-row"><span>玻璃UI样式</span><span class="arrow">已开启</span></div>
          <div class="card-row"><span>底部弹窗</span><span class="arrow">已开启</span></div>
          <div class="card-row"><span>原生样式设置</span><span class="arrow">10% · 8rpx<span class="chev"></span></span></div>
        </div>
        <div class="glass-style-sheet"><div class="glass-style-head"><span class="glass-style-title">玻璃样式设置</span><span class="glass-style-actions"><span class="glass-style-reset">重置为默认</span><span class="glass-style-done">完成</span></span></div>${rows()}</div>
      </div>
      <div class="caption">仅「玻璃UI样式」开启时出现入口；关闭开关自动收起</div>
    </div>
    <div>
      <div class="title">非底部浮层形态 · 玻璃</div>
      <div class="stage">
        <div class="card">
          <div class="card-row"><span>玻璃UI样式</span><span class="arrow">已开启</span></div>
          <div class="card-row"><span>底部弹窗</span><span class="arrow">已关闭</span></div>
          <div class="card-row"><span>原生样式设置</span><span class="arrow">10% · 8rpx<span class="chev"></span></span></div>
        </div>
        <div class="glass-style-pop native-skin"><div class="glass-style-head"><span class="glass-style-title">原生样式设置</span><span class="glass-style-done">完成</span></div>${rows()}</div>
      </div>
      <div class="caption">非底部形态锚定在入口行下方，同样是玻璃皮肤（无原生样式）</div>
    </div>
  </div>
</body></html>`;

fs.mkdirSync(dir, { recursive: true });
const temp = path.join(dir, 'shot.html');
fs.writeFileSync(temp, page);
const browser = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/chromium'].find(p => { try { fs.accessSync(p); return true; } catch (e) { return false; } });
if (!browser) { console.error('no chrome'); process.exit(1); }
try {
  execFileSync(browser, ['--headless=new', '--no-sandbox', '--hide-scrollbars', '--force-device-scale-factor=2', '--window-size=940,780', '--screenshot=' + path.join(dir, 'glass-style.png'), 'file://' + temp], { stdio: 'ignore' });
  console.log('wrote glass-style.png');
} finally { fs.unlinkSync(temp); }
