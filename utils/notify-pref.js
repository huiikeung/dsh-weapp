// 订阅通知偏好的本地存储（设置页写入，会话页发送前读取）。

const KEY = 'dsh_exp_notify';

module.exports = {
  enabled: function () {
    try { return wx.getStorageSync(KEY) === true; } catch (e) { return false; }
  },
  setEnabled: function (value) {
    try { wx.setStorageSync(KEY, value === true); } catch (e) { /* 忽略 */ }
  }
};
