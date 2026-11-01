/**
 * 外观主题：跟随微信（auto）/ 浅色（light）/ 深色（dark）。
 *
 * 生效链路（每个二级页面）：
 *  1. 根视图挂 theme-light / theme-dark 类 —— 覆盖 app.wxss 中的语义变量；
 *  2. <page-meta page-style> 设置页面背景色，避免与导航栏出现色差分层；
 *  3. wx.setNavigationBarColor 同步原生导航栏。
 * auto 模式下监听 wx.onThemeChange，系统切换时实时刷新所有存活页面。
 */

const MODE_KEY = 'appearanceMode';
// 非 home 页面：纯白 / 纯黑（用户要求，不用其他色阶）
const PAGE_BG = {
  light: '#FFFFFF',
  dark: '#000000'
};

const listeners = new Set();
let themeListenerInited = false;

function getMode() {
  try {
    const mode = has.getStorageSync(MODE_KEY);
    return mode === 'light' || mode === 'dark' ? mode : 'auto';
  } catch (e) {
    return 'auto';
  }
}

function setMode(mode) {
  try {
    if (mode === 'light' || mode === 'dark') {
      has.setStorageSync(MODE_KEY, mode);
    } else {
      has.removeStorageSync(MODE_KEY);
    }
  } catch (e) {
    // 存储失败时仅本次会话内生效
  }
  notifyListeners();
}

function systemTheme() {
  try {
    if (typeof has.getAppBaseInfo === 'function') {
      return has.getAppBaseInfo().theme === 'dark' ? 'dark' : 'light';
    }
    return has.getSystemInfoSync().theme === 'dark' ? 'dark' : 'light';
  } catch (e) {
    return 'light';
  }
}

/** 解析当前生效主题：'light' | 'dark' */
function resolveTheme() {
  const mode = getMode();
  return mode === 'auto' ? systemTheme() : mode;
}

function ensureThemeListener() {
  if (themeListenerInited) return;
  themeListenerInited = true;
  if (typeof has.onThemeChange === 'function') {
    has.onThemeChange(() => {
      if (getMode() === 'auto') {
        notifyListeners();
      }
    });
  }
}

function notifyListeners() {
  listeners.forEach((apply) => {
    try {
      apply();
    } catch (e) {
      // 单页刷新失败不影响其他页面
    }
  });
}

/** 页面创建时就能拿到的主题数据：让首帧就带正确的页面底色，避免先白屏再变色。 */
function initialData() {
  const resolved = resolveTheme();
  return { theme: resolved, themeClass: 'theme-' + resolved, pageStyle: 'background-color: ' + PAGE_BG[resolved] + ';' };
}

/**
 * 接入页面：onLoad 中调用 theme.applyTo(this)。
 * 自动订阅主题变更并在页面卸载时取消订阅。
 */
/**
 * 把主题写到页面。
 * options.pageBackground 可覆盖页面窗口底色（字符串或 theme => color），
 * 首页用它保持海面深蓝，避免主题默认底色在首帧之后又刷一次、闪出夹层。
 */
function applyTo(page, options) {
  ensureThemeListener();
  const background = (theme) => {
    const custom = options && options.pageBackground;
    const value = typeof custom === 'function' ? custom(theme) : custom;
    return value || PAGE_BG[theme];
  };
  const render = () => {
    const theme = resolveTheme();
    const pageBackground = background(theme);
    page.setData({
      theme,
      themeClass: 'theme-' + theme,
      pageStyle: 'background-color: ' + pageBackground + ';'
    });
    if (typeof has.setNavigationBarColor === 'function') {
      has.setNavigationBarColor({
        frontColor: theme === 'dark' ? '#ffffff' : '#000000',
        backgroundColor: pageBackground,
        fail: () => {}
      });
    }
    // 顶部状态栏/下拉区域背景：手动切深色时必须同步，否则导航栏上方会露白
    if (typeof has.setBackgroundColor === 'function') {
      has.setBackgroundColor({
        backgroundColor: pageBackground,
        backgroundColorTop: pageBackground,
        backgroundColorBottom: pageBackground,
        fail: () => {}
      });
    }
  };
  render();

  const rebroadcast = () => render();
  listeners.add(rebroadcast);
  if (typeof page.onUnload === 'function') {
    const originalOnUnload = page.onUnload.bind(page);
    page.onUnload = function () {
      listeners.delete(rebroadcast);
      return originalOnUnload();
    };
  }
}

module.exports = { initialData: initialData,
  getMode,
  setMode,
  resolveTheme,
  applyTo,
  PAGE_BG
};
