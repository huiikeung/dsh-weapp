// 对话页面玻璃开关：默认开启；设置页「外观」里单独控制，与全局玻璃 UI 开关互相独立。
const KEY = 'sessionGlassEnabled';
const DEFAULT = true;

function read() {
  try {
    const stored = wx.getStorageSync(KEY);
    return stored === '' || stored === undefined || stored === null ? DEFAULT : !!stored;
  } catch (_) {
    return DEFAULT;
  }
}

function set(value) {
  const next = value === true || value === 'true' || value === 1;
  try { wx.setStorageSync(KEY, next); } catch (_) { /* 内存生效 */ }
  return next;
}

module.exports = { KEY, DEFAULT, read, set };
