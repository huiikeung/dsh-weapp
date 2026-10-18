const api = require('../../utils/access-api');
const theme = require('../../utils/theme');
Page({
  manualShareMenu: true,
  data: { loading: true, error: '', items: [] },
  onLoad() { theme.applyTo(this); },
  onShow() { return this.refresh(); },
  onPullDownRefresh() { return this.refresh().finally(() => wx.stopPullDownRefresh()); },
  onHide() { this._generation = (this._generation || 0) + 1; },
  onUnload() { this._generation = (this._generation || 0) + 1; },
  async refresh() {
    const generation = this._generation = (this._generation || 0) + 1;
    this.setData({ loading: true, error: '' });
    try {
      const value = await api.appContent();
      if (generation !== this._generation) return;
      const opened = new Set(this.data.items.filter(x => x.expanded).map(x => x.id));
      this.setData({ items: value.items.map(x => ({ ...x, expanded: opened.has(x.id) })) });
    } catch (error) { if (generation === this._generation) this.setData({ error: error.message || '公告暂时加载失败，请重试', items: [] }); }
    finally { if (generation === this._generation) this.setData({ loading: false }); }
  },
  toggle(event) {
    const id = event.currentTarget.dataset.id;
    this.setData({ items: this.data.items.map(x => x.id === id ? { ...x, expanded: !x.expanded } : x) });
  }
});
