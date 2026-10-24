const { t: uiText } = require('./ui-preferences');
// 全局分享能力：让页面支持「转发给朋友」（onShareAppMessage）与
// 「分享到朋友圈」（onShareTimeline），并按页面给出分享文案。
//
// 通过包装全局 Page 构造器注入默认实现；页面自己定义的同名处理函数
// 优先（包装器只补缺，不覆盖）。

const APP_NAME = 'DeepSeek Harness';
const HOME_PATH = '/pages/home/home';
// 分享封面：5:4 / 500×400，内容居中（朋友圈 1:1 裁切不丢内容），保留颗粒噪点的 JPEG，约 23 KB。
const SHARE_IMAGE = '/assets/brand/app-icon-share-500x400.jpg';

// 每个页面的分享文案（key 为页面路径）
const SHARE_TITLES = {
  'pages/home/home': APP_NAME + uiText(' · AI 工作台'),
  'pages/session/session': uiText('会话 · ') + APP_NAME,
  'pages/settings/settings': uiText('设置 · ') + APP_NAME,
  'pages/files/files': uiText('工作区文件 · ') + APP_NAME,
  'pages/workspace-picker/workspace-picker': uiText('切换工作区 · ') + APP_NAME,
  'pages/schedule/schedule': uiText('定时任务 · ') + APP_NAME,
  'pages/plugins/plugins': uiText('插件管理 · ') + APP_NAME,
  'pages/plugin-detail/plugin-detail': uiText('插件详情 · ') + APP_NAME,
  'pages/privacy/privacy': uiText('隐私政策 · ') + APP_NAME
};

// 页面分享策略：
// - path：好友/群聊打开后的落地页。会话、设置、插件等页面依赖连接状态、登录身份
//   或页面参数，别人打开只会看到空态/报错，因此统一落到首页；只有首页和隐私政策
//   这两类可独立打开的页面才分享自身。
// - timeline：朋友圈只能分享“当前页”，参数缺失的页面不开放朋友圈入口，
//   避免对方打开后停在无效页面。
const SHARE_PAGES = {
  'pages/home/home': { path: HOME_PATH, timeline: true }
};

function routeKey(route) {
  return String(route || '').replace(/^\//, '');
}

function sharePage(route) {
  const key = routeKey(route);
  const custom = SHARE_PAGES[key];
  return {
    title: titleFor(key),
    path: custom ? custom.path : HOME_PATH,
    timeline: !!(custom && custom.timeline),
    imageUrl: SHARE_IMAGE
  };
}

function titleFor(route) {
  const key = routeKey(route);
  const titles = { 'pages/home/home': 'AI workspace', 'pages/session/session': 'Conversation', 'pages/settings/settings': 'Settings', 'pages/files/files': 'Workspace files', 'pages/workspace-picker/workspace-picker': 'Switch workspace', 'pages/schedule/schedule': 'Scheduled tasks', 'pages/plugins/plugins': 'Plugin management', 'pages/plugin-detail/plugin-detail': 'Plugin details', 'pages/privacy/privacy': 'Privacy policy' };
  if (require('./ui-preferences').locale() === 'en') return titles[key] ? titles[key] + ' · ' + APP_NAME : APP_NAME;
  return (key && SHARE_TITLES[key]) || APP_NAME;
}

function pathFor(route) {
  return sharePage(route).path;
}

/** 好友/群聊转发：落地页按页面策略回退到首页，陌生人打开不会停在缺参页面。 */
function friendMessage(page) {
  const info = sharePage(page);
  return { title: info.title, path: info.path, imageUrl: info.imageUrl };
}

/** 朋友圈：只能分享当前页，仅返回标题/配图。 */
function timelineMessage(page) {
  const info = sharePage(page);
  return { title: info.title, query: '', imageUrl: info.imageUrl };
}

function pageRoute(page) {
  return (page && (page.route || page.__route__)) || '';
}

// 打开右上角菜单的分享入口：转发始终开启；朋友圈只在支持的页面开启，
// 其余页面显式隐藏，避免分享出去打开缺参页面。
function showShareMenus(route) {
  const info = sharePage(route);
  try {
    wx.showShareMenu({
      withShareTicket: false,
      menus: info.timeline ? ['shareAppMessage', 'shareTimeline'] : ['shareAppMessage'],
      fail: function () { /* 基础库/环境不支持时忽略 */ }
    });
  } catch (e) { /* 忽略 */ }
  if (!info.timeline) {
    try { wx.hideShareMenu({ menus: ['shareTimeline'] }); } catch (e) { /* 忽略 */ }
  }
}

function hideShareMenus() {
  try { wx.hideShareMenu({ menus: ['shareAppMessage', 'shareTimeline'] }); } catch (e) { /* 忽略 */ }
}

/** 包装 Page：注入默认转发/朋友圈处理函数与分享菜单（缺省补齐，不覆盖页面自有实现）。 */
function install() {
  const scope = typeof globalThis !== 'undefined' ? globalThis : null;
  const current = (scope && typeof scope.Page === 'function') ? scope.Page
    : (typeof Page !== 'undefined' ? Page : null);
  if (typeof current !== 'function' || current._shareWrapped) return;

  function wrappedPage(options) {
    options = options || {};
    if (typeof options.onShareAppMessage !== 'function') {
      options.onShareAppMessage = function () {
        return friendMessage(pageRoute(this));
      };
    }
    if (typeof options.onShareTimeline !== 'function') {
      options.onShareTimeline = function () {
        return timelineMessage(pageRoute(this));
      };
    }
    // onLoad / onShow 都同步一次菜单：切页或部分机型会重置分享菜单。
    ['onLoad', 'onShow'].forEach(function (hook) {
      const original = options[hook];
      options[hook] = function () {
        if (options.manualShareMenu) hideShareMenus();
        else showShareMenus(pageRoute(this));
        if (typeof original === 'function') return original.apply(this, arguments);
        return undefined;
      };
    });
    return current(options);
  }
  wrappedPage._shareWrapped = true;

  try { Page = wrappedPage; } catch (e) { /* 只读环境走下面的全局赋值 */ }
  if (scope) {
    try { if (scope.Page !== wrappedPage) scope.Page = wrappedPage; } catch (e) { /* 忽略 */ }
  }
}

module.exports = {
  APP_NAME: APP_NAME,
  HOME_PATH: HOME_PATH,
  SHARE_IMAGE: SHARE_IMAGE,
  SHARE_TITLES: SHARE_TITLES,
  SHARE_PAGES: SHARE_PAGES,
  sharePage: sharePage,
  titleFor: titleFor,
  pathFor: pathFor,
  friendMessage: friendMessage,
  timelineMessage: timelineMessage,
  showShareMenus: showShareMenus,
  install: install
};
