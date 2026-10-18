// 全局分享能力：让每个页面都支持「转发给朋友」（onShareAppMessage）
// 和「分享到朋友圈」（onShareTimeline），并按页面给出中文分享文案。
//
// 通过包装全局 Page 构造器注入默认实现；页面自己定义的同名处理函数
// 优先（包装器只补缺，不覆盖）。

const APP_NAME = 'DeepSeek Harness';

// 每个页面的分享文案（key 为页面路径）
const SHARE_TITLES = {
  'pages/home/home': APP_NAME + ' · AI 工作台',
  'pages/session/session': '会话 · ' + APP_NAME,
  'pages/settings/settings': '设置 · ' + APP_NAME,
  'pages/files/files': '工作区文件 · ' + APP_NAME,
  'pages/workspace-picker/workspace-picker': '切换工作区 · ' + APP_NAME,
  'pages/schedule/schedule': '定时任务 · ' + APP_NAME,
  'pages/plugins/plugins': '插件管理 · ' + APP_NAME,
  'pages/plugin-detail/plugin-detail': '插件详情 · ' + APP_NAME,
  'pages/privacy/privacy': '隐私政策 · ' + APP_NAME
};

// 依赖页面参数（bundle/path 等）的深页：转发落地页用首页，
// 避免对方打开后停在参数缺失的兜底态。
const DEEP_PAGES = {
  'pages/plugin-detail/plugin-detail': true,
  'pages/files/files': true
};

function titleFor(route) {
  return (route && SHARE_TITLES[route]) || APP_NAME;
}

function pathFor(route) {
  if (route && DEEP_PAGES[route]) return '/pages/home/home';
  return route ? '/' + route : '/pages/home/home';
}

/**
 * 打开右上角菜单的两个分享入口。
 * 分两步：先常规开启转发（兼容旧基础库），再带 menus 开启朋友圈
 * （基础库 ≥ 2.11.3；不支持时 fail 回调静默，转发不受影响）。
 * 注意：朋友圈入口只在真机出现，开发者工具模拟器不展示。
 */
function ensureShareMenu() {
  try {
    wx.showShareMenu({ withShareTicket: false, fail: function () { /* 忽略 */ } });
  } catch (e) { /* 忽略 */ }
  try {
    wx.showShareMenu({
      withShareTicket: false,
      menus: ['shareAppMessage', 'shareTimeline'],
      fail: function () { /* 基础库/环境不支持朋友圈时忽略 */ }
    });
  } catch (e) { /* 忽略 */ }
}

/** 包装 Page：注入默认转发/朋友圈处理函数与分享菜单（缺省补齐，不覆盖页面自有实现）。 */
function install() {
  const originalPage = Page;
  Page = function (options) {
    options = options || {};
    if (typeof options.onShareAppMessage !== 'function') {
      options.onShareAppMessage = function () {
        const route = this.route || this.__route__ || '';
        return { title: titleFor(route), path: pathFor(route) };
      };
    }
    if (typeof options.onShareTimeline !== 'function') {
      options.onShareTimeline = function () {
        const route = this.route || this.__route__ || '';
        return { title: titleFor(route) }; // 朋友圈固定分享当前页，仅可自定义标题/查询
      };
    }
    // onLoad 与 onShow 都补一次菜单开启：部分机型页面切换后会重置分享菜单
    ['onLoad', 'onShow'].forEach(function (hook) {
      const original = options[hook];
      options[hook] = function () {
        if (options.manualShareMenu) {
          try { wx.hideShareMenu({ menus: ['shareAppMessage', 'shareTimeline'] }); } catch (e) {}
        } else ensureShareMenu();
        if (typeof original === 'function') {
          return original.apply(this, arguments);
        }
      };
    });
    return originalPage(options);
  };
}

module.exports = {
  APP_NAME: APP_NAME,
  SHARE_TITLES: SHARE_TITLES,
  titleFor: titleFor,
  pathFor: pathFor,
  install: install
};
