const { t: uiText } = require('../../utils/ui-preferences');
const api = require('../../utils/access-api');
const theme = require('../../utils/theme');
Page({
  manualShareMenu: true,
  data: { loading: true, busy: false, isAdmin: false, error: '', items: [], editingId: '', revision: null, title: '', content: '' },
  onLoad() { theme.applyTo(this); },
  onShow() { return this.refresh(); },
  onHide() { this.invalidate(); },
  onUnload() { this.invalidate(); },
  invalidate() { this._generation = (this._generation || 0) + 1; this.setData({ isAdmin: false, items: [], busy: false }); },
  async refresh() {
    if (this.data.busy) return;
    const generation = this._generation = (this._generation || 0) + 1;
    this.setData({ loading: true, error: '', isAdmin: false, items: [] });
    try {
      const account = await api.ensureAccount({ freshLogin: true });
      if (generation !== this._generation) return;
      if (!account.isAdmin) throw Object.assign(new Error(uiText('当前微信没有管理员权限')), { code: 'FORBIDDEN' });
      const result = await api.announcements();
      if (generation === this._generation) this.setData({ isAdmin: true, items: result.items });
    } catch (e) {
      if (generation === this._generation) { this.setData({ error: e.message || uiText('加载失败') }); if (['FORBIDDEN','UNAUTHORIZED','LOGIN_REQUIRED'].includes(e.code)) this.clearEditor(); }
    } finally { if (generation === this._generation) this.setData({ loading: false }); }
  },
  inputTitle(e) { this.setData({ title: e.detail.value }); },
  inputContent(e) { this.setData({ content: e.detail.value }); },
  clearEditor() { this.setData({ editingId: '', revision: null, title: '', content: '' }); },
  edit(e) {
    if (!this.data.isAdmin || this.data.busy) return;
    const item = this.data.items.find(x => x.id === e.currentTarget.dataset.id);
    if (item) { this.setData({ editingId: item.id, revision: item.revision, title: item.title, content: item.content, error: '' }); wx.pageScrollTo({ scrollTop: 0 }); }
  },
  async save() {
    if (!this.data.isAdmin || this.data.busy || this.data.loading) return;
    const title = this.data.title.trim(), content = this.data.content.trim();
    if (!title || !content) { this.setData({ error: uiText('请填写标题和正文') }); return; }
    const input = { title, content };
    if (this.data.editingId) { input.id = this.data.editingId; input.revision = this.data.revision; }
    await this.mutate(() => api.saveAnnouncement(input), uiText('公告已发布'), true);
  },
  remove(e) {
    if (!this.data.isAdmin || this.data.busy) return;
    const item = this.data.items.find(x => x.id === e.currentTarget.dataset.id), generation = this._generation;
    if (!item) return;
    wx.showModal({ title: uiText('删除公告？'), content: '「' + item.title + uiText('」将从所有用户的公告列表移除。'),
      success: res => { if (res.confirm && generation === this._generation) return this.mutate(() => api.deleteAnnouncement(item.id, item.revision), uiText('公告已删除'), this.data.editingId === item.id); } });
  },
  async mutate(action, message, clearEditor) {
    if (this.data.busy || !this.data.isAdmin) return;
    const generation = this._generation;
    this.setData({ busy: true, error: '' });
    let saved = false;
    try {
      await action(); saved = true;
      if (generation !== this._generation) return;
      if (clearEditor) this.clearEditor();
      wx.showToast({ title: message, icon: 'success' });
    } catch (e) {
      if (generation !== this._generation) return;
      this.setData({ error: e.message || uiText('操作失败，请重试') });
      if (['FORBIDDEN','UNAUTHORIZED','LOGIN_REQUIRED'].includes(e.code)) { this.setData({ isAdmin: false, items: [] }); this.clearEditor(); }
    } finally { if (generation === this._generation) { this.setData({ busy: false }); if (saved) await this.refresh(); } }
  }
});
