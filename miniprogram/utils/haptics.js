// 全局震动反馈：等级在「设置 → 通用设置 → 震动反馈」中选择，所有震动调用统一走这里。
const STORAGE_KEY = 'dsh-haptics-level';
const LEVELS = ['off', 'light', 'medium', 'heavy'];
const DEFAULT_LEVEL = 'medium';

let level = null;
let lastResult = null;
let lastTickAt = 0;

// 连续滑动沿用当前档位并限频，避免反馈堆积。
function tick() {
  if (getLevel() === 'off' || Date.now() - lastTickAt < 60) return;
  lastTickAt = Date.now();
  return vibrate();
}

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
 * 按当前等级触发震动；把轻档映射到 medium 短震，中档映射到 heavy，重档使用长震增强。
 * 旧环境缺少短震接口时仍降级到长震。
 */
function vibrate(callback) {
  const value = getLevel();
  const finish = (api, ok, detail) => {
    const result = record(api, ok, detail);
    if (typeof callback === 'function') callback(result);
    return result;
  };
  if (value === 'off') return finish('off', false, 'level=off');
  record('pending', false, value);
  try {
    if (value === 'heavy' && typeof wx.vibrateLong === 'function') {
      wx.vibrateLong({
        success: () => finish('long', true, 'heavy-enhanced'),
        fail: (err) => finish('long', false, (err && (err.errMsg || err.message)) || 'fail')
      });
    } else if (typeof wx.vibrateShort === 'function') {
      const strength = value === 'light' ? 'medium' : 'heavy';
      wx.vibrateShort({
        type: strength,
        success: () => finish('short', true, strength),
        fail: (err) => finish('short', false, (err && (err.errMsg || err.message)) || 'fail')
      });
    } else if (typeof wx.vibrateLong === 'function') {
      wx.vibrateLong({
        success: () => finish('long', true, value),
        fail: (err) => finish('long', false, (err && (err.errMsg || err.message)) || 'fail')
      });
    } else {
      finish('none', false, 'no vibrate api');
    }
  } catch (e) {
    finish('exception', false, (e && e.message) || 'exception');
  }
  return lastResult;
}

/** 测试当前档位一次，与实际交互反馈保持一致。 */
function test(callback) {
  const done = typeof callback === 'function' ? callback : function () {};
  let finished = false;
  const finish = result => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    done({ ok: result.ok, report: [{ name: result.api, ok: result.ok, detail: result.detail }], env: environmentHint() });
  };
  const timer = setTimeout(() => finish({ api: 'timeout', ok: false, detail: '' }), 1200);
  vibrate(finish);
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

module.exports = { LEVELS, DEFAULT_LEVEL, getLevel, setLevel, vibrate, tick, test, environmentHint, getLastResult };
