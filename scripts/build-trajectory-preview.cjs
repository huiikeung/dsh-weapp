// Rebuilds preview/trajectory/index.html from the real trajectory.wxss so the
// preview can never drift from the mini program styles. rpx is converted to px
// (750rpx = 375pt) and WXSS-only syntax is dropped.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const wxss = fs.readFileSync(path.join(root, 'miniprogram/styles/trajectory.wxss'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(-?\d+(?:\.\d+)?)rpx/g, (_, value) => (parseFloat(value) / 2) + 'px')
  .replace(/env\(safe-area-inset-bottom\)/g, '0px');

const theme = `:root {
  --bg: #FFFFFF; --surface: #FFFFFF; --fill: rgba(16,19,24,.05); --fill-2: rgba(16,19,24,.07);
  --border: rgba(16,19,24,.10); --border-strong: rgba(16,19,24,.16); --divider: rgba(16,19,24,.08);
  --text: #10131A; --text-2: rgba(16,19,24,.62); --text-3: rgba(16,19,24,.55); --text-4: rgba(16,19,24,.45);
  --ocean: #2E6BE6; --purple: #7A54C7; --orange: #F07D14;
}
.theme-dark {
  --bg: #000000; --surface: #1C1C1E; --fill: rgba(255,255,255,.06); --fill-2: rgba(255,255,255,.10);
  --border: rgba(255,255,255,.10); --border-strong: rgba(255,255,255,.16); --divider: rgba(255,255,255,.08);
  --text: #F1F4FA; --text-2: rgba(241,244,250,.62); --text-3: rgba(241,244,250,.55); --text-4: rgba(241,244,250,.45);
}`;

const phone = (dark) => `<div class="phone ${dark ? 'theme-dark' : ''}">
  <div class="navbar"><div class="nav-back">&#8249;</div><div class="nav-title">修复轨迹排版</div><div style="width:32px"></div></div>
  <div class="segmented-row"><div class="segmented"><div class="segment">对话</div><div class="segment active">轨迹</div><div class="segment">上下文</div></div></div>
  <div class="trajectory-panel">
    <div class="trace-overview">
      <div class="trace-overview-head">
        <div class="trace-overview-head-label active"><svg class="trace-overview-clock" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg><text>时长</text></div>
        <div class="trace-overview-stat"><svg class="trace-overview-metric-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h16M4 12h16M4 18h10"/></svg><text>3</text><text>轮次</text></div>
        <div class="trace-overview-stat"><svg class="trace-overview-metric-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.7 6.3a4 4 0 1 0 3 6.7L21 19l-2 2-6.3-6.3"/></svg><text>18</text><text>调用</text></div>
      </div>
      <div class="trace-overview-lane"><text class="trace-overview-label">输入</text>
        <div class="trace-overview-track">
          <div class="trace-overview-bar user" style="left:0%;width:6%"></div>
          <div class="trace-overview-bar user" style="left:34%;width:5%"></div>
          <div class="trace-overview-bar user" style="left:71%;width:6%"></div>
        </div>
      </div>
      <div class="trace-overview-lane"><text class="trace-overview-label">模型</text>
        <div class="trace-overview-track">
          <div class="trace-overview-bar assistant" style="left:6%;width:26%"></div>
          <div class="trace-overview-bar assistant" style="left:40%;width:29%"></div>
          <div class="trace-overview-bar assistant error" style="left:78%;width:9%"></div>
          <div class="trace-overview-cursor" style="left:52%"></div>
        </div>
      </div>
      <div class="trace-overview-lane"><text class="trace-overview-label">工具</text>
        <div class="trace-overview-track">
          <div class="trace-overview-bar tool" style="left:8%;width:9%"></div>
          <div class="trace-overview-bar tool" style="left:19%;width:12%"></div>
          <div class="trace-overview-bar subtool dimmed" style="left:23%;width:4%"></div>
          <div class="trace-overview-bar tool" style="left:43%;width:14%"></div>
          <div class="trace-overview-bar tool error" style="left:59%;width:6%"></div>
          <div class="trace-overview-bar subtool" style="left:66%;width:3%"></div>
          <div class="trace-overview-bar context" style="left:88%;width:5%"></div>
        </div>
      </div>
      <div class="trace-overview-axis"><text>0 秒</text><text>42.86 秒</text></div>
    </div>
    <div class="trajectory">
      <div class="trace-turn"><text class="trace-turn-label">第 1 轮</text><div class="trace-turn-line"></div></div>

      <div class="trace-native-row">
        <div class="trace-request-gutter"></div>
        <div class="trace-native-content">
          <text class="trace-native-badge user">用户</text>
          <text class="trace-native-preview">参考 dsh 客户端修一下轨迹页，重点是…</text>
          <text class="trace-native-seq">#1,024</text><text class="trace-native-chevron">&#8250;</text>
        </div>
      </div>

      <div class="trace-native-row selected">
        <div class="trace-request-gutter"><div class="trace-dot-hit"><div class="trace-node-dot request active"></div></div></div>
        <div class="trace-native-content">
          <text class="trace-native-badge assistant">助手</text>
          <text class="trace-native-preview">我先对照客户端的 TrajectoryTable 改…</text>
          <text class="trace-native-seq">#1,025</text><text class="trace-native-chevron">&#8250;</text>
        </div>
      </div>

      <div class="trace-native-row">
        <div class="trace-request-gutter"></div>
        <div class="trace-native-content">
          <text class="trace-native-badge tool">工具</text>
          <text class="trace-native-name">read</text>
          <text class="trace-native-preview">{path: "styles/"} → 3 files</text>
          <text class="trace-native-seq">#1,026</text><text class="trace-native-chevron">&#8250;</text>
        </div>
      </div>

      <div class="trace-native-row error">
        <div class="trace-request-gutter"><div class="trace-dot-hit"><div class="trace-node-dot request error"></div></div></div>
        <div class="trace-native-content">
          <text class="trace-native-badge tool">工具</text>
          <text class="trace-native-name">bash</text>
          <text class="trace-native-preview">wcc -o out.js → exit code 1</text>
          <text class="trace-native-seq">#1,027</text><text class="trace-native-chevron">&#8250;</text>
        </div>
      </div>

      <div class="trace-turn"><text class="trace-turn-label">第 2 轮</text><div class="trace-turn-line"></div></div>

      <div class="trace-native-row">
        <div class="trace-request-gutter"></div>
        <div class="trace-native-content">
          <text class="trace-native-badge user">用户</text>
          <text class="trace-native-preview">深色模式也检查一下</text>
          <text class="trace-native-seq">#2,048</text><text class="trace-native-chevron">&#8250;</text>
        </div>
      </div>

      <div class="trace-native-row">
        <div class="trace-request-gutter"><div class="trace-dot-hit"><div class="trace-node-dot request"></div></div></div>
        <div class="trace-native-content">
          <text class="trace-native-badge assistant">助手</text>
          <text class="trace-native-preview">深色下提高了淡色底与导轨对比…</text>
          <text class="trace-native-seq">#2,049</text><text class="trace-native-chevron">&#8250;</text>
        </div>
      </div>

      <div class="trace-native-row">
        <div class="trace-request-gutter"></div>
        <div class="trace-native-content">
          <text class="trace-native-badge context">上下文</text>
          <text class="trace-native-name">tool-addition</text>
          <text class="trace-native-preview">新增 read、bash 两个工具</text>
          <text class="trace-native-seq">#2,050</text><text class="trace-native-chevron">&#8250;</text>
        </div>
      </div>
    </div>
  </div>
</div>`;

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>轨迹页预览 · dsh 客户端 ledger 对齐</title>
<style>
  body { margin: 0; padding: 24px; background: #E5E5EA; font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif; }
  h1 { font-size: 15px; color: #3a3f4a; margin: 0 0 14px; font-weight: 600; }
  .row { display: flex; gap: 32px; align-items: flex-start; }
  .caption { text-align: center; font: 11px/1.4 -apple-system; color: #6b7280; padding: 10px 0 0; }
  .phone { width: 375px; background: var(--bg); color: var(--text); border-radius: 28px; overflow: hidden; box-shadow: 0 12px 40px rgba(7,24,43,.18); }
  .navbar { display: flex; align-items: center; padding: 4px 12px; }
  .nav-back { width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; background: rgba(255,255,255,.9); border: 1px solid rgba(0,0,0,.08); font-size: 15px; color: #101318; }
  .nav-title { flex: 1; text-align: center; font-size: 14px; font-weight: 600; }
  .segmented-row { display: flex; align-items: center; gap: 8px; padding: 5px 20px 6px; }
  .segmented { display: flex; flex: 1; border-radius: 14px; padding: 1.5px; background: var(--fill-2); }
  .segment { flex: 1; text-align: center; padding: 5px 0; border-radius: 12.5px; font-size: 12px; color: var(--text-2); }
  .segment.active { background: var(--surface); color: var(--text); font-weight: 600; box-shadow: 0 .5px 2px rgba(0,0,0,.12); }
${theme}
${wxss}
</style>
</head>
<body>
<h1>轨迹页 · 对齐 dsh 客户端 TrajectoryTable / TrajectoryTimeline（轮次标签贴着首条记录，不额外占高 · 请求圆点落行分隔线 · 类型 pill · 网络面板式概览）</h1>
<div class="row">
  <div class="col col-light">${phone(false)}<div class="caption">浅色</div></div>
  <div class="col col-dark">${phone(true)}<div class="caption">深色</div></div>
</div>
</body>
</html>
`;

const dir = path.join(root, 'preview/trajectory');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'index.html'), html);
console.log('wrote preview/trajectory/index.html', html.length, 'bytes');
