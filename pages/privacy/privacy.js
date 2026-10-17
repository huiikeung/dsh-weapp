// 隐私政策（对齐 dsh-mobile PrivacyPolicySheet：加载在线页面，失败提供重试）。
// 小程序 web-view 仅支持后台配置的业务域名；未配置时展示回退 UI（复制链接/重试）。

const PRIVACY_URL = 'https://clarklevis1995.github.io/dsh-mobile/privacy/';

Page({
  data: {
    url: PRIVACY_URL,
    loadFailed: false
  },

  onWebViewError() {
    this.setData({ loadFailed: true });
  },

  // web-view 域名未配置等情况不会触发 binderror，而是停留在白屏；
  // 提供手动入口：长按页面标题区无操作时用户可通过「···」复制链接，
  // 这里同时监听加载完成事件复位失败态。
  onWebViewLoad() {
    if (this.data.loadFailed) this.setData({ loadFailed: false });
  },

  copyLink() {
    wx.setClipboardData({
      data: this.data.url,
      success() {
        wx.showToast({ title: '链接已复制', icon: 'success' });
      }
    });
  },

  retry() {
    this.setData({ loadFailed: false, url: '' }, () => {
      // 重挂载 web-view 触发重新加载（对齐 iOS reloadID = UUID()）
      this.setData({ url: PRIVACY_URL });
    });
  }
});
