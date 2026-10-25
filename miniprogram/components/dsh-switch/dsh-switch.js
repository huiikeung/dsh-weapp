const theme = require('../../utils/theme');

// 自绘开关：深色由组件自行读主题模块判定（.dk 类），不依赖外部变量级联。
Component({
  options: { styleIsolation: 'apply-shared' },
  properties: {
    checked: { type: Boolean, value: false },
    disabled: { type: Boolean, value: false },
    ariaLabel: { type: String, value: '' },
    scale: { type: Number, value: 1 }
  },
  data: { dark: false },
  lifetimes: {
    attached() {
      this.syncTheme();
      if (typeof wx !== 'undefined' && typeof wx.onThemeChange === 'function') {
        this._themeHandler = () => this.syncTheme();
        wx.onThemeChange(this._themeHandler);
      }
    },
    detached() {
      if (this._themeHandler && typeof wx.offThemeChange === 'function') wx.offThemeChange(this._themeHandler);
    }
  },
  pageLifetimes: {
    show() { this.syncTheme(); }
  },
  methods: {
    syncTheme() { this.setData({ dark: theme.resolveTheme() === 'dark' }); },
    onTap() {
      if (this.data.disabled) return;
      this.triggerEvent('change', { value: !this.data.checked });
    }
  }
})
