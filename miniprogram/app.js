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
const jankGuard = require('./utils/jank-guard');

// 下面这些工具被多个分包（设置 / 会话 / 模型 / 额度卡片）共用，按微信分包规则
// 只能放在主包。打包质检的「主包内未使用的 JS」会把它们标出来，这里在主包入口
// 显式引用一次：既声明了真实依赖，也让质检识别为主包已使用。
require('./utils/choice-menu');
require('./utils/model-settings');
require('./utils/session-card-style-pref');
require('./utils/session-glass-pref');
require('./utils/settings-glass-sheet-pref');

App({
  resetAttachmentCacheIndex() {
    attachmentCache._reset();
  },
  onLaunch() {
    store.init();
    jankGuard.start();
    if (typeof wx.onMemoryWarning === 'function') wx.onMemoryWarning(() => {
      require('./utils/session-view-cache').clear();
    });
  },
  onShow() {
    jankGuard.setActive(true);
    this.globalData.foregroundEpoch = (this.globalData.foregroundEpoch || 0) + 1;
    store.appDidBecomeActive();
  },
  onHide() {
    jankGuard.setActive(false);
    store.appDidEnterBackground();
  },
  globalData: {
    foregroundEpoch: 0,
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
