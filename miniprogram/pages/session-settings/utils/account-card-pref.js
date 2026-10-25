// 账号卡片可见性：设置页（页面顶部）与会话设置页顶部的 DSH 账号区共用这个开关。
// 默认关闭 —— 账号信息属于隐私内容，需要时在设置页顶部用开关打开。
const KEY = 'dsh_account_card_visible';
const DEFAULT = false;

function read() {
  let stored;
  try { stored = wx.getStorageSync(KEY); } catch (_) { stored = null; }
  return typeof stored === 'boolean' ? stored : DEFAULT;
}

function set(value) {
  const next = value === true;
  try { wx.setStorageSync(KEY, next); } catch (_) { /* 存储失败时按调用方的回退处理 */ }
  return next;
}

module.exports = { KEY, DEFAULT, read, set };
