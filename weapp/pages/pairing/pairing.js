const store = require('../../utils/store');

Page({
  data: {
    pairingPayload: '',
    error: '',
    statusText: ''
  },

  onLoad() {
    this.unsubscribe = store.subscribe((snapshot) => {
      const conn = snapshot.app.connection;
      if (conn === 'connected' && snapshot.app.paired) {
        wx.showToast({ title: '配对成功', icon: 'success' });
        setTimeout(() => {
          const pages = getCurrentPages();
          if (pages.length > 1) {
            wx.navigateBack();
          } else {
            wx.reLaunch({ url: '/pages/home/home' });
          }
        }, 400);
      } else if (conn === 'failed') {
        this.setData({ error: snapshot.app.connectionMessage || '连接失败', statusText: '' });
      } else if (conn === 'connecting') {
        this.setData({ statusText: '连接中…', error: '' });
      }
    });
  },

  onUnload() {
    if (this.unsubscribe) this.unsubscribe();
  },

  onPayloadInput(e) {
    this.setData({ pairingPayload: e.detail.value });
  },

  scanQR() {
    wx.scanCode({
      onlyFromCamera: true,
      success: (res) => {
        this.applyPayload(res.result);
      },
      fail: (err) => {
        const msg = err && err.errMsg ? err.errMsg : '';
        if (msg.indexOf('permission') >= 0 || msg.indexOf('auth') >= 0) {
          wx.showToast({ title: '需要摄像头权限，请在设置中开启', icon: 'none' });
        } else if (msg.indexOf('cancel') < 0) {
          this.setData({ error: '扫码失败：' + msg, statusText: '' });
        }
      }
    });
  },

  applyPayload(raw) {
    const result = store.pairWithPayload(raw);
    if (!result.ok) {
      this.setData({ error: result.error, statusText: '' });
      return;
    }
    this.setData({ error: '', statusText: '连接中…' });
  },

  pairManual() {
    const raw = String(this.data.pairingPayload || '').trim();
    if (!raw) {
      this.setData({ error: '请输入配对信息', statusText: '' });
      return;
    }
    const result = store.pairWithPayload(raw);
    if (!result.ok) {
      this.setData({ error: result.error, statusText: '' });
      return;
    }
    this.setData({ error: '', statusText: '连接中…' });
  },

  restoreSaved() {
    const ok = store.reconnectWithSaved();
    this.setData({
      error: ok ? '' : '没有已保存的凭据，请扫码或手动配对',
      statusText: ok ? '连接中…' : ''
    });
  }
});
