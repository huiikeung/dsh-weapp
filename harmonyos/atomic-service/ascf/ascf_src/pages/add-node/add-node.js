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
    publicAccessDialogOpen: false
  },

  onLoad() {
    theme.applyTo(this);
    try {
      const info = typeof has.getWindowInfo === 'function' ? has.getWindowInfo() : has.getSystemInfoSync();
      const sbH = info.statusBarHeight || 44;
      let rect = null;
      try {
        rect = typeof has.getMenuButtonBoundingClientRect === 'function'
          ? has.getMenuButtonBoundingClientRect() : null;
      } catch (e) { rect = null; }
      // 导航行与右上角胶囊严格同一水平线：顶距=胶囊 top，行高=胶囊 height
      this.setData({
        navPadTop: rect && rect.top ? rect.top : sbH + 6,
        navHeight: rect && rect.height ? rect.height : 32
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
        has.showToast({ title: uiText('节点已连接'), icon: 'success' });
        setTimeout(() => has.navigateBack({ delta: 1 }), 600);
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
    has.navigateBack({ delta: 1 });
  },

  prev() {
    this.setData({ step: Math.max(0, this.data.step - 1), pairError: '' });
  },

  toPair() {
    this.setData({ step: 1 });
  },

  copyPlugin() {
    has.setClipboardData({
      data: this.data.pluginName,
      success: () => has.showToast({ title: uiText('插件名已复制'), icon: 'success' })
    });
  },

  scan() {
    if (this.data.scanning) return;
    has.scanCode({
      onlyFromCamera: true,
      success: (res) => {
        this._scanRelayPending = !!publicAccessPrompt.managedRelayPayload(res.result);
        this.connect(res.result);
      },
      fail: (err) => {
        const message = (err && err.errMsg) || '';
        if (message.indexOf('permission') >= 0 || message.indexOf('auth') >= 0) {
          has.showToast({ title: uiText('需要摄像头权限，请在设置中开启'), icon: 'none' });
        } else if (message.indexOf('cancel') < 0) {
          has.showToast({ title: uiText('扫码失败：') + message, icon: 'none' });
        }
      }
    });
  },

  /** 打开底部输入弹窗 */
  manual() {
    this.setData({ pairSheetOpen: true, pairingText: '', pairingError: '', pairingConnecting: false });
  },

  closePairSheet() {
    if (this.data.pairingConnecting) return;
    this.setData({ pairSheetOpen: false, pairingText: '', pairingError: '' });
  },

  onPairingInput(e) {
    this.setData({ pairingText: e.detail.value, pairingError: '' });
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
      has.showToast({ title: result.error || uiText('配对信息无效'), icon: 'none' });
      return;
    }
    this._pairing = true;
    this.setData({ scanning: true, pairError: '' });
    has.showToast({ title: uiText('正在连接节点…'), icon: 'none' });
  }
});
