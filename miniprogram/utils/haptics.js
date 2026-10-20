// 全局震动反馈：等级在「设置 → 通用设置 → 震动反馈」中选择，所有震动调用统一走这里。
const STORAGE_KEY = 'dsh-haptics-level';
const LEVELS = ['off', 'light', 'medium', 'heavy'];
const DEFAULT_LEVEL = 'medium';

let level = null;
let lastResult = null;

function readStorage() {
  try {
    const value = wx.getStorageSync(STORAGE_KEY);
    if (typeof value === 'string' && LEVELS.indexOf(value) >= 0) return value;
  } catch (e) { /* 忽略 */ }
  return DEFAULT_LEVEL;
}

function getLevel() {
  if (level === null) level = readStorage();
  return level;
}

function setLevel(next) {
  const value = LEVELS.indexOf(next) >= 0 ? next : DEFAULT_LEVEL;
  level = value;
  try { wx.setStorageSync(STORAGE_KEY, value); } catch (e) { /* 忽略 */ }
  return value;
}

function getLastResult() { return lastResult; }

function record(api, ok, detail) {
  lastResult = { api, ok, detail: detail || '', at: Date.now() };
  return lastResult;
}

/**
 * 按当前等级触发震动；off 时静默。
 * iOS 上短震（触感反馈）在静音/低电量时经常被系统吞掉，因此统一走 vibrateLong
 * 的系统马达震动，再叠加一次短震（可用时）增强手感。
 */
function vibrate() {
  const value = getLevel();
  if (value === 'off') { record('off', false, 'level=off'); return lastResult; }
  try {
    if (typeof wx.vibrateLong === 'function') {
      wx.vibrateLong({
        success: () => record('long', true, value),
        fail: (err) => record('long', false, (err && (err.errMsg || err.message)) || 'fail')
      });
    } else if (typeof wx.vibrateShort === 'function') {
      wx.vibrateShort({
        type: value,
        success: () => record('short', true, value),
        fail: (err) => record('short', false, (err && (err.errMsg || err.message)) || 'fail')
      });
    } else {
      record('none', false, 'no vibrate api');
    }
  } catch (e) {
    record('exception', false, (e && e.message) || 'exception');
  }
  return lastResult;
}

/** 直接测试长震（不受等级关闭影响），用于设置页验证硬件/权限。 */
function test(callback) {
  const done = typeof callback === 'function' ? callback : function () {};
  const report = [];
  let pending = 0;
  const finishOnce = (() => {
    let doneCalled = false;
    return () => {
      if (doneCalled) return;
      doneCalled = true;
      done({ ok: report.some((x) => x.ok), report, env: environmentHint() });
    };
  })();
  const track = (name) => {
    pending += 1;
    return (ok, detail) => { report.push({ name, ok, detail: detail || '' }); pending -= 1; if (pending <= 0) finishOnce(); };
  };
  const steps = [];
  if (typeof wx.vibrateShort === 'function') {
    steps.push(() => { const cb = track('vibrateShort(heavy)'); wx.vibrateShort({ type: 'heavy', success: () => cb(true), fail: (e) => cb(false, (e && e.errMsg) || 'fail') }); });
    steps.push(() => { const cb = track('vibrateShort(default)'); wx.vibrateShort({ success: () => cb(true), fail: (e) => cb(false, (e && e.errMsg) || 'fail') }); });
  } else {
    report.push({ name: 'vibrateShort', ok: false, detail: 'missing api' });
  }
  if (typeof wx.vibrateLong === 'function') {
    steps.push(() => { const cb = track('vibrateLong'); wx.vibrateLong({ success: () => cb(true), fail: (e) => cb(false, (e && e.errMsg) || 'fail') }); });
  } else {
    report.push({ name: 'vibrateLong', ok: false, detail: 'missing api' });
  }
  try {
    steps.forEach((step, index) => setTimeout(() => {
      try { step(); } catch (e) { report.push({ name: 'exception', ok: false, detail: (e && e.message) || 'exception' }); finishOnce(); }
    }, index * 220));
    if (!steps.length) finishOnce();
    setTimeout(finishOnce, steps.length * 220 + 600);
  } catch (e) {
    report.push({ name: 'exception', ok: false, detail: (e && e.message) || 'exception' });
    finishOnce();
  }
}

/** 当前环境是否可能震动（开发者工具/模拟器不会震动）。 */
function environmentHint() {
  try {
    if (typeof wx.getDeviceInfo === 'function') {
      const info = wx.getDeviceInfo();
      if (info && info.platform === 'devtools') return 'devtools';
    }
    if (typeof wx.getSystemInfoSync === 'function') {
      const info = wx.getSystemInfoSync();
      if (info && info.platform === 'devtools') return 'devtools';
    }
  } catch (e) { /* 忽略 */ }
  return 'device';
}

module.exports = { LEVELS, DEFAULT_LEVEL, getLevel, setLevel, vibrate, test, environmentHint, getLastResult };
