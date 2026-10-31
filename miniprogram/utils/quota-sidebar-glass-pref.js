// 左侧栏额度卡片的玻璃开关：默认开启玻璃样式，可在额度卡片页的弹窗里单独关掉。
const KEY = 'quotaSidebarGlass';
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
  try { wx.setStorageSync(KEY, next); } catch (_) { /* 保持内存值 */ }
  return next;
}

module.exports = { KEY, DEFAULT, read, set };
