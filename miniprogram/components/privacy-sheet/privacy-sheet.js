const { t: uiText } = require('../../utils/ui-preferences');
const policy = require('../../utils/privacy-policy');
const preferences = require('../../utils/ui-preferences');
Component({
  properties: {
    visible: { type: Boolean, value: false, observer: 'onVisibilityChange' },
    theme: { type: String, value: 'light' }
  },
  data: { policy, mounted: false, closing: false, topInset: 88, scrollTop: 0, dragOffset: 0, dragging: false },
  lifetimes: {
    attached() { this.refreshLanguage(); this._unsubscribeLanguage = preferences.subscribe(() => this.refreshLanguage()); },
    detached() { clearTimeout(this._closeTimer); if (this._unsubscribeLanguage) this._unsubscribeLanguage(); }
  },
  pageLifetimes: { resize() { if (this.data.mounted) this.updateInset(); } },
  methods: {
    refreshLanguage() {
      this.setData({ ...preferences.snapshot(), policy: { ...policy, updatedAt: preferences.t(policy.updatedAt), intro: preferences.t(policy.intro),
        sections: policy.sections.map(section => ({ ...section, title: preferences.t(section.title), paragraphs: section.paragraphs.map(text => preferences.t(text)) })) } });
    },
    onVisibilityChange(visible) {
      clearTimeout(this._closeTimer);
      if (!visible) { this.setData({ mounted: false, closing: false, dragOffset: 0, dragging: false }); return; }
      this.updateInset();
      this.setData({ mounted: true, closing: false, scrollTop: 0, dragOffset: 0, dragging: false });
    },
    updateInset() {
      let statusBar = 44;
      try {
        const info = (wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()) || {};
        if (Number.isFinite(info.statusBarHeight) && info.statusBarHeight >= 0) statusBar = info.statusBarHeight;
      } catch (e) { /* 保留安全区回退。 */ }
      let topInset = statusBar + 44;
      try {
        const rect = wx.getMenuButtonBoundingClientRect();
        if (rect && Number.isFinite(rect.bottom) && rect.bottom > 0) topInset = rect.bottom + 8;
      } catch (e) { /* 旧基础库按状态栏高度回退。 */ }
      this.setData({ topInset });
    },
    close() {
      if (this.data.closing) return;
      this.setData({ closing: true });
      this._closeTimer = setTimeout(() => {
        this.setData({ mounted: false, closing: false });
        this.triggerEvent('close');
      }, 220);
    },
    onDragStart(event) {
      if (this.data.closing) return;
      const touch = event.touches && event.touches[0];
      if (!touch) return;
      this._dragStartY = touch.clientY;
      this.setData({ dragging: true, dragOffset: 0 });
    },
    onDragMove(event) {
      const touch = event.touches && event.touches[0];
      if (!this.data.dragging || !touch) return;
      this.setData({ dragOffset: Math.max(0, Math.min(300, touch.clientY - this._dragStartY)) });
    },
    onDragEnd() {
      if (!this.data.dragging) return;
      const dismiss = this.data.dragOffset >= 90;
      this.setData({ dragging: false, dragOffset: dismiss ? this.data.dragOffset : 0 });
      if (dismiss) this.close();
    },
    onDragCancel() { this.setData({ dragging: false, dragOffset: 0 }); },
    openPlatformPrivacy() {
      if (typeof wx.openPrivacyContract !== 'function') {
        wx.showToast({ title: uiText('请升级微信后查看平台隐私指引'), icon: 'none' }); return;
      }
      wx.openPrivacyContract({ fail() { wx.showToast({ title: uiText('暂时无法打开微信隐私指引'), icon: 'none' }); } });
    },
    onContactError() { wx.showToast({ title: uiText('客服暂不可用，请稍后重试'), icon: 'none' }); },
    noop() {}
  }
});
