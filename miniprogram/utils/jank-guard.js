// 卡顿守护（jank guard）
// 目的：如果页面因为玻璃模糊 / 大列表重排把 JS 主线程拖到长时间停顿，
// 自动降级到「无模糊、无动画」的轻量渲染，并把降级状态持久化 1 小时——
// 这样即使重启小程序，也不会立刻又卡在同一处。
//
// 采样方式：250ms 心跳，比较「预期唤醒时间」和「实际唤醒时间」的偏差。
// 连续两次偏差超过 1200ms 视为一次卡死（加载/首帧的偶发慢只记一次 strike）。

const KEY = 'dsh_jank_guard_at';
const TTL_MS = 60 * 60 * 1000;
const TICK_MS = 250;
const STRIKE_DRIFT_MS = 1200;
const MAX_STRIKES = 2;

let timer = null;
let strikes = 0;
let expectedAt = 0;
let active = false;

function storageRead() {
  try { return typeof wx !== 'undefined' && wx.getStorageSync ? wx.getStorageSync(KEY) : 0; } catch (error) { return 0; }
}

function storageWrite(value) {
  try { if (typeof wx !== 'undefined' && wx.setStorageSync) wx.setStorageSync(KEY, value); } catch (error) { /* 内存态继续生效 */ }
}

/** 当前是否处于降级窗口内。 */
function degraded(at) {
  const stamp = Number(at === undefined ? storageRead() : at) || 0;
  return stamp > 0 && Date.now() - stamp < TTL_MS;
}

function degrade() { storageWrite(Date.now()); }

function recover() { storageWrite(0); strikes = 0; }

/** 单次采样偏差是否算「卡顿」；独立出来方便测试。 */
function evaluateDrift(drift) { return Number(drift) > STRIKE_DRIFT_MS; }

function tick() {
  const now = Date.now();
  const drift = now - expectedAt;
  expectedAt = now + TICK_MS;
  if (!active) { strikes = 0; return; }
  if (drift < -TICK_MS) return; // 系统时钟跳变，不算卡顿
  if (!evaluateDrift(drift)) { strikes = 0; return; }
  strikes += 1;
  if (strikes >= MAX_STRIKES) { strikes = 0; degrade(); }
}

function start() {
  if (timer) return;
  expectedAt = Date.now() + TICK_MS;
  timer = setInterval(tick, TICK_MS);
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
  strikes = 0;
}

function setActive(value) {
  active = value === true;
  strikes = 0;
  expectedAt = Date.now() + TICK_MS;
}

module.exports = { KEY, TTL_MS, TICK_MS, STRIKE_DRIFT_MS, MAX_STRIKES, start, stop, setActive, degraded, degrade, recover, evaluateDrift };
