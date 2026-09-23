// DeepSeek Harness Mobile — 微信小程序客户端
// 全局入口：初始化 Gateway Store，恢复已保存的配对凭据并尝试连接。

const store = require('./utils/store');

App({
  onLaunch() {
    store.init();
  },
  onShow() {
    store.appDidBecomeActive();
  },
  onHide() {
    store.appDidEnterBackground();
  },
  globalData: {
    // Design tokens 与 iOS Theme.swift / Design/design-spec.md 对齐。
    colors: {
      navy: '#07182B',
      navyRaised: '#0D2340',
      ocean: '#2E6BE6',
      mist: '#BFD4FF',
      ink: '#101318',
      paper: '#F7F8FA',
      gray: '#7D8592',
      purple: '#7A54C7',
      orange: '#F07D14',
      amber: '#FFAE1F',
      success: '#2EB85C'
    }
  }
});
