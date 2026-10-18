const theme = require('../../utils/theme');
Page({
  manualShareMenu: true,
  data: { privacyOpen: true },
  onLoad() { theme.applyTo(this); },
  closePrivacyPolicy() {
    this.setData({ privacyOpen: false });
    wx.navigateBack({ fail() { wx.redirectTo({ url: '/pages/settings/settings' }); } });
  }
});
