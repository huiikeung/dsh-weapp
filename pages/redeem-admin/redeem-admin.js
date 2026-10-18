const api = require('../../utils/access-api');
const theme = require('../../utils/theme');
const DAYS = [3, 7, 30, 180, 365];
const USES = [1, 5, 20];
function date(value) { const d = new Date(value); return [d.getFullYear(), d.getMonth() + 1, d.getDate()].join('/'); }
Page({
  data: {
    loading: true, verified: false, isAdmin: false, grantReady: false,
    busy: false, actionId: '', error: '', nodes: [], nodeIndex: 0,
    durations: ['3 天', '7 天', '30 天', '半年', '1 年'], durationIndex: 2,
    counts: ['1 次', '5 次', '20 次'], countIndex: 0,
    generatedCode: '', generatedMeta: '', generatedId: '', items: []
  },
  onLoad() { theme.applyTo(this); },
  onShow() { return this.refresh(); },
  onHide() { this._generation = (this._generation || 0) + 1; this.setData({ isAdmin: false, busy: false, actionId: '', generatedCode: '', generatedId: '', items: [] }); },
  onUnload() { this._generation = (this._generation || 0) + 1; },
  async refresh() {
    const generation = this._generation = (this._generation || 0) + 1;
    this.setData({ loading: true, isAdmin: false, verified: false, busy: false, actionId: '', error: '', generatedCode: '', generatedId: '' });
    try {
      const account = await api.ensureAccount({ freshLogin: true });
      if (generation !== this._generation) return;
      if (!account || account.isAdmin !== true) {
        this.setData({ loading: false, verified: true, items: [], error: '当前微信不是管理员，不能生成或管理兑换码。' });
        return;
      }
      const items = await api.codes();
      if (generation !== this._generation) return;
      const publicReady = typeof account.publicAccessReady === 'boolean' ? account.publicAccessReady : account.grantReady === true;
      this.setData({ loading: false, verified: true, isAdmin: true, grantReady: publicReady,
        items: this.formatItems(items),
        error: publicReady ? '' : '公网服务尚未完成部署，暂不能签发可兑换的码。' });
    } catch (err) {
      if (generation === this._generation) this.setData({ loading: false, isAdmin: false, items: [], error: err.message || '加载失败，请重试' });
    }
  },
  formatItems(items) {
    return items.map(item => ({ ...item,
      title: item.days + ' 天 · ' + item.uses + ' 次',
      usageLabel: '已用 ' + item.used + ' / ' + item.uses + ' 次',
      expiryLabel: date(item.expiresAt),
      statusLabel: item.revokedAt ? '已停用' : item.expiresAt <= Date.now() ? '已过期' : item.used >= item.uses ? '已用完' : '可兑换',
      canRevoke: !item.revokedAt && item.expiresAt > Date.now() && item.used < item.uses
    }));
  },
  pickNode(e) { if (!this.data.busy) this.setData({ nodeIndex: Number(e.detail.value) }); },
  pickDuration(e) { if (!this.data.busy) this.setData({ durationIndex: Number(e.detail.value) }); },
  pickCount(e) { if (!this.data.busy) this.setData({ countIndex: Number(e.detail.value) }); },
  async generate() {
    if (!this.data.isAdmin || this.data.busy || !this.data.grantReady) return;
    const days = DAYS[this.data.durationIndex], uses = USES[this.data.countIndex];
    if (!days || !uses) { this.setData({ error: '请选择访问时长和兑换次数' }); return; }
    const generation = this._generation;
    this.setData({ busy: true, generatedCode: '', generatedId: '', error: '' });
    try {
      // 服务端每次重新验证管理员，无论页面或本地缓存被怎样修改。
      const result = await api.createCode(null, days, uses);
      if (generation !== this._generation) return;
      this.setData({ generatedCode: result.code, generatedId: result.id,
        generatedMeta: '全局公网服务 · ' + days + ' 天 · ' + uses + ' 次 · ' + date(result.expiresAt) + ' 前兑换' });
      const items = await api.codes();
      if (generation === this._generation) this.setData({ items: this.formatItems(items) });
    } catch (err) {
      if (generation !== this._generation) return;
      this.setData({ error: err.message || '生成失败', ...(err.code === 'FORBIDDEN' || err.code === 'UNAUTHORIZED' ? { isAdmin: false, generatedCode: '', generatedId: '', items: [] } : {}) });
    } finally { if (generation === this._generation) this.setData({ busy: false }); }
  },
  copyCode() {
    if (!this.data.generatedCode || !this.data.isAdmin) return;
    wx.setClipboardData({ data: this.data.generatedCode,
      success: () => wx.showToast({ title: '已复制，可发送给用户', icon: 'none' }) });
  },
  async copyItem(e) {
    const id = e.currentTarget.dataset.id;
    if (!this.data.isAdmin || this.data.actionId || this.data.busy) return;
    const generation = this._generation;
    this.setData({ actionId: id, error: '' });
    try {
      const result = await api.copyCode(id);
      if (generation === this._generation && this.data.isAdmin) wx.setClipboardData({ data: result.code });
    } catch (err) {
      if (generation === this._generation) this.setData({ error: err.message || '复制失败', ...(err.code === 'FORBIDDEN' || err.code === 'UNAUTHORIZED' ? { isAdmin: false, items: [], generatedCode: '', generatedId: '' } : {}) });
    } finally { if (generation === this._generation) this.setData({ actionId: '' }); }
  },
  deleteItem(e) {
    const id = e.currentTarget.dataset.id;
    if (!this.data.isAdmin || this.data.actionId || this.data.busy) return;
    const generation = this._generation;
    wx.showModal({ title: '删除兑换码', content: '删除后停止新兑换，已兑换的公网时长不受影响。保留必要的使用审计记录。',
      success: async res => {
        if (!res.confirm || generation !== this._generation) return;
        this.setData({ actionId: id, error: '' });
        try {
          await api.deleteCode(id);
          if (generation !== this._generation) return;
          if (this.data.generatedId === id) this.setData({ generatedCode: '', generatedId: '' });
          const items = await api.codes();
          if (generation === this._generation) this.setData({ items: this.formatItems(items) });
        } catch (err) {
          if (generation === this._generation) this.setData({ error: err.message || '删除失败', ...(err.code === 'FORBIDDEN' || err.code === 'UNAUTHORIZED' ? { isAdmin: false, items: [], generatedCode: '', generatedId: '' } : {}) });
        } finally { if (generation === this._generation) this.setData({ actionId: '' }); }
      }
    });
  },
  revoke(e) {
    const id = e.currentTarget.dataset.id;
    if (!this.data.isAdmin || this.data.actionId || !this.data.items.some(item => item.id === id && item.canRevoke)) return;
    const generation = this._generation;
    wx.showModal({ title: '停用兑换码', content: '停用后不能再兑换，已兑换的授权不受影响。',
      success: async res => {
        if (!res.confirm || generation !== this._generation) return;
        this.setData({ actionId: id, error: '' });
        try {
          await api.revokeCode(id);
          if (generation !== this._generation) return;
          if (this.data.generatedId === id) this.setData({ generatedCode: '', generatedId: '' });
          const items = await api.codes();
          if (generation === this._generation) this.setData({ items: this.formatItems(items) });
        } catch (err) {
          if (generation === this._generation) this.setData({ error: err.message || '停用失败', ...(err.code === 'FORBIDDEN' || err.code === 'UNAUTHORIZED' ? { isAdmin: false, items: [], generatedCode: '' } : {}) });
        } finally { if (generation === this._generation) this.setData({ actionId: '' }); }
      }
    });
  }
});
