const { t: uiText } = require('../../utils/ui-preferences');
// 添加节点引导：三步（介绍 → 电脑端准备 → 扫码配对）
const store = require('../../utils/store');
const theme = require('../../utils/theme');
const publicAccessPrompt = require('../../utils/public-access-prompt');

const PLUGIN_NAME = 'dsh-plugin-weapp-gateway';
const TOTAL_DOTS = 2;   // 准备 / 配对

Page({
  data: {
    theme: 'light',
    themeClass: 'theme-light',
    pageStyle: '',
    step: 0,
    dots: [0, 1],
    pluginName: PLUGIN_NAME,
    scanning: false,
    pairError: '',
    pairSheetOpen: false,
    pairingText: '',
    pairingError: '',
    pairingConnecting: false,
    publicAccessDialog: null,
    publicAccessDialogOpen: false,
    pairKb: 0,
    pairSheetStyle: ''
  },

  onLoad() {
    theme.applyTo(this);
    try {
      const info = typeof wx.getWindowInfo === 'function' ? wx.getWindowInfo() : wx.getSystemInfoSync();
      const sbH = info.statusBarHeight || 44;
      let rect = null;
      try {
        rect = typeof wx.getMenuButtonBoundingClientRect === 'function'
          ? wx.getMenuButtonBoundingClientRect() : null;
      } catch (e) { rect = null; }
      // 导航行与右上角胶囊严格同一水平线：顶距=胶囊 top，行高=胶囊 height
      const navTop = rect && rect.top ? rect.top : sbH + 6;
      const navH = rect && rect.height ? rect.height : 32;
      const winH = info.windowHeight || 800;
      this._windowH = winH;
      // 弹窗顶部让开胶囊行：可用高度 = 窗口高度 - 导航行底部 - 40px
      this._pairSheetMax = Math.max(240, winH - (navTop + navH) - 40);
      this.setData({
        navPadTop: navTop,
        navHeight: navH,
        pairSheetStyle: 'max-height: ' + this._pairSheetMax + 'px;'
      });
    } catch (e) {
      this.setData({ navPadTop: 48, navHeight: 32 });
    }
    this.unsubscribe = store.subscribe((snapshot) => {
      const app = snapshot.app || {};
      if (this._pairing && app.connection === 'connected') {
        this._pairing = false;
        this._scanRelayPending = false;
        this.setData({ pairSheetOpen: false, pairingConnecting: false, pairingText: '' });
        wx.showToast({ title: uiText('节点已连接'), icon: 'success' });
        setTimeout(() => wx.navigateBack({ delta: 1 }), 600);
      } else if (this._pairing && app.connection === 'failed') {
        this._pairing = false;
        const connectionMessage = app.connectionMessage || uiText('连接失败，请检查配对信息');
        if (this._scanRelayPending) {
          this._scanRelayPending = false;
          publicAccessPrompt.showPublicAccessFailure(connectionMessage, app.connectionErrorCode);
        }
        this.setData({
          scanning: false,
          pairError: connectionMessage,
          pairingConnecting: false,
          pairingError: connectionMessage
        });
      }
    });
  },

  onUnload() {
    if (this.unsubscribe) this.unsubscribe();
  },

  onPublicAccessDialogConfirm() { publicAccessPrompt.resolvePublicAccessDialog(this); },

  goBack() {
    wx.navigateBack({ delta: 1 });
  },

  prev() {
    this.setData({ step: Math.max(0, this.data.step - 1), pairError: '' });
  },

  toPair() {
    this.setData({ step: 1 });
  },

  copyPlugin() {
    wx.setClipboardData({
      data: this.data.pluginName,
      success: () => wx.showToast({ title: uiText('插件名已复制'), icon: 'success' })
    });
  },

  scan() {
    if (this.data.scanning) return;
    wx.scanCode({
      onlyFromCamera: true,
      success: (res) => {
        this._scanRelayPending = !!publicAccessPrompt.managedRelayPayload(res.result);
        this.connect(res.result);
      },
      fail: (err) => {
        const message = (err && err.errMsg) || '';
        if (message.indexOf('permission') >= 0 || message.indexOf('auth') >= 0) {
          wx.showToast({ title: uiText('需要摄像头权限，请在设置中开启'), icon: 'none' });
        } else if (message.indexOf('cancel') < 0) {
          wx.showToast({ title: uiText('扫码失败：') + message, icon: 'none' });
        }
      }
    });
  },

  /** 打开底部输入弹窗 */
  manual() {
    this.setData({
      pairSheetOpen: true,
      pairingText: '',
      pairingError: '',
      pairingConnecting: false,
      pairKb: 0,
      pairSheetStyle: 'max-height: ' + (this._pairSheetMax || 600) + 'px;'
    });
  },

  closePairSheet() {
    if (this.data.pairingConnecting) return;
    this.setData({ pairSheetOpen: false, pairingText: '', pairingError: '' });
  },

  onPairingInput(e) {
    this.setData({ pairingText: e.detail.value, pairingError: '' });
  },

  /** 一键粘贴配对信息。 */
  pastePairingText() {
    if (typeof wx.getClipboardData !== 'function') return;
    wx.getClipboardData({
      success: (res) => {
        const text = String((res && res.data) || '').trim();
        if (!text) { wx.showToast({ title: uiText('剪贴板为空'), icon: 'none' }); return; }
        this.setData({ pairingText: text, pairingError: '' });
      },
      fail: () => wx.showToast({ title: uiText('读取剪贴板失败'), icon: 'none' })
    });
  },

  clearPairingText() {
    this.setData({ pairingText: '', pairingError: '' });
  },

  /** 键盘高度：弹窗上移并限制高度，输入框始终在输入法上方。 */
  onPairKeyboard(e) {
    const height = Math.max(0, Number(e && e.detail && e.detail.height) || 0);
    if (height === this.data.pairKb) return;
    const windowH = this._windowH || 800;
    const base = this._pairSheetMax || Math.max(240, windowH - 160);
    const available = height > 0 ? Math.min(base, windowH - height - 32) : base;
    this.setData({
      pairKb: height,
      pairSheetStyle: (height > 0 ? 'bottom: ' + (height + 8) + 'px; ' : '') + 'max-height: ' + available + 'px;'
    });
  },

  connectPublicNode() {
    const raw = String(this.data.pairingText || '').trim();
    if (!raw || this.data.pairingConnecting) return;
    const result = store.pairWithPayload(raw);
    if (!result.ok) {
      this.setData({ pairingError: result.error || uiText('配对信息无效') });
      return;
    }
    this.setData({ pairingConnecting: true, pairingError: '' });
    this._pairing = true;
  },

  noop() {},

  connect(raw) {
    const result = store.pairWithPayload(raw);
    if (!result.ok) {
      this._scanRelayPending = false;
      this.setData({ pairError: result.error || uiText('配对信息无效') });
      wx.showToast({ title: result.error || uiText('配对信息无效'), icon: 'none' });
      return;
    }
    this._pairing = true;
    this.setData({ scanning: true, pairError: '' });
    wx.showToast({ title: uiText('正在连接节点…'), icon: 'none' });
  }
});
