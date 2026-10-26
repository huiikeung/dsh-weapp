// 鲸尾 Harness（dsh-weapp）— 微信小程序客户端
// 全局入口：初始化 Gateway Store，恢复已保存的配对凭据并尝试连接。

// 必须在任何 Page() 注册之前安装。
// 先装偏好注入，再装分享包装器：分享包装器必须是最外层的那一层，
// 否则页面注册时可能拿到被后续 installer 覆盖掉的 Page，导致
// onShareAppMessage / onShareTimeline 没有真正注入。
require('./utils/ui-preferences').install();
require('./utils/share').install();

const store = require('./utils/store');
const attachmentCache = require('./utils/attachment-cache');

App({
  resetAttachmentCacheIndex() {
    attachmentCache._reset();
  },
  onLaunch() {
    store.init();
    if (typeof wx.onMemoryWarning === 'function') wx.onMemoryWarning(() => {
      require('./utils/session-view-cache').clear();
    });
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
