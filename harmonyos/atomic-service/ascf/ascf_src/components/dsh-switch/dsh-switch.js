const theme = require('../../utils/theme');

// 自绘开关：深色由组件自行读主题模块判定（.dk 类），不依赖外部变量级联。
Component({
  options: { styleIsolation: 'apply-shared' },
  properties: {
    checked: { type: Boolean, value: false },
    disabled: { type: Boolean, value: false },
    ariaLabel: { type: String, value: '' },
    scale: { type: Number, value: 1 },
    // 页面把当前主题传进来：手动切深浅色时属性变化会立即重新同步 .dk 配色。
    themeMode: { type: String, value: '', observer() { this.syncTheme(); } }
  },
  data: { dark: false },
  lifetimes: {
    attached() {
      this.syncTheme();
      if (typeof has !== 'undefined' && typeof has.onThemeChange === 'function') {
        this._themeHandler = () => this.syncTheme();
        has.onThemeChange(this._themeHandler);
      }
    },
    detached() {
      if (this._themeHandler && typeof has.offThemeChange === 'function') has.offThemeChange(this._themeHandler);
    }
  },
  pageLifetimes: {
    show() { this.syncTheme(); }
  },
  methods: {
    syncTheme() {
      const mode = this.data.themeMode === 'dark' || this.data.themeMode === 'light' ? this.data.themeMode : theme.resolveTheme();
      this.setData({ dark: mode === 'dark' });
    },
    onTap() {
      if (this.data.disabled) return;
      this.triggerEvent('change', { value: !this.data.checked });
    }
  }
})
