// 左侧栏额度卡片的玻璃开关：默认原生（关闭），可在额度卡片页的弹窗里单独控制。
const KEY = 'quotaSidebarGlass';
const DEFAULT = false;

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
