const { t: uiText } = require('../../utils/ui-preferences');
const api = require('../../utils/access-api');
const theme = require('../../utils/theme');
// 兑换码档位：与设置页、服务端 CODE_DAYS/CODE_USES 保持一致。
const DAYS = [1, 3, 7, 30, 60, 90, 180, 365, 730, 1095, 3650];
const USES = [1, 5, 20, 50, 100];
const DURATION_KEYS = ['1 天', '3 天', '7 天', '30 天', '60 天', '90 天', '半年', '1 年', '2 年', '3 年', '长期'];
const USE_KEYS = ['1 次', '5 次', '20 次', '50 次', '100 次'];
function date(value) { const d = new Date(value); return [d.getFullYear(), d.getMonth() + 1, d.getDate()].join('/'); }
Page({
  data: {
    loading: true, verified: false, isAdmin: false, grantReady: false,
    busy: false, actionId: '', error: '', nodes: [], nodeIndex: 0,
    durations: DURATION_KEYS.map(uiText), durationIndex: 3, durationPickerOpen: false, countPickerOpen: false,
    counts: USE_KEYS.map(uiText), countIndex: 0,
    generatedCode: '', generatedMeta: '', generatedId: '', items: [], usedCodeCount: 0
  },
  onUiPreferencesChange() { this.setData({ durations: DURATION_KEYS.map(uiText), counts: USE_KEYS.map(uiText) }); },
  onLoad() { theme.applyTo(this); },
  onShow() { return this.refresh(); },
  onHide() { this._generation = (this._generation || 0) + 1; this.setData({ isAdmin: false, busy: false, actionId: '', generatedCode: '', generatedId: '', items: [], usedCodeCount: 0 }); },
  onUnload() { this._generation = (this._generation || 0) + 1; },
  async refresh() {
    const generation = this._generation = (this._generation || 0) + 1;
    this.setData({ loading: true, isAdmin: false, verified: false, busy: false, actionId: '', error: '', generatedCode: '', generatedId: '' });
    try {
      const account = await api.ensureAccount({ freshLogin: true });
      if (generation !== this._generation) return;
      if (!account || account.isAdmin !== true) {
        this.setData({ loading: false, verified: true, items: [], usedCodeCount: 0, error: uiText('当前微信不是管理员，不能生成或管理兑换码。') });
        return;
      }
      const items = await api.codes();
      if (generation !== this._generation) return;
      const publicReady = typeof account.publicAccessReady === 'boolean' ? account.publicAccessReady : account.grantReady === true;
      this.setData({ loading: false, verified: true, isAdmin: true, grantReady: publicReady,
        ...this.itemsPatch(items),
        error: publicReady ? '' : uiText('公网服务尚未完成部署，暂不能签发可兑换的码。') });
    } catch (err) {
      if (generation === this._generation) this.setData({ loading: false, isAdmin: false, items: [], usedCodeCount: 0, error: err.message || uiText('加载失败，请重试') });
    }
  },
  formatItems(items) {
    return items.map(item => ({ ...item,
      title: item.days + uiText(' 天 · ') + item.uses + uiText(' 次'),
      usageLabel: uiText('已用 ') + item.used + ' / ' + item.uses + uiText(' 次'),
      expiryLabel: date(item.expiresAt),
      statusLabel: item.revokedAt ? uiText('已停用') : item.expiresAt <= Date.now() ? uiText('已过期') : item.used >= item.uses ? uiText('已用完') : uiText('可兑换'),
      canRevoke: !item.revokedAt && item.expiresAt > Date.now() && item.used < item.uses,
      // 「已用完」= 卡片上显示的正是这个状态：没停用、没过期、次数已兑换完。
      // 一键清空只删这一类；已停用/已过期的保留下来做对账与审计。
      usedUp: !item.revokedAt && item.expiresAt > Date.now() && item.used >= item.uses
    }));
  },
  /** 统一写入列表：顺带算出「已用完」的条数，决定一键清空按钮是否出现。 */
  itemsPatch(items) {
    const formatted = this.formatItems(items);
    return { items: formatted, usedCodeCount: formatted.filter(item => item.usedUp).length };
  },
  applyItems(items) { this.setData(this.itemsPatch(items)); },
  pickNode(e) { if (!this.data.busy) this.setData({ nodeIndex: Number(e.detail.value) }); },
  openDurationPicker() { if (!this.data.busy) this.setData({ durationPickerOpen: true }); },
  closeDurationPicker() { this.setData({ durationPickerOpen: false }); },
  chooseDuration(e) {
    const index = Number(e.currentTarget.dataset.index);
    if (!Number.isInteger(index) || index < 0) return;
    this.setData({ durationIndex: index, durationPickerOpen: false });
  },
  pickDuration(e) { if (!this.data.busy) this.setData({ durationIndex: Number(e.detail.value) }); },
  pickCount(e) { if (!this.data.busy) this.setData({ countIndex: Number(e.detail.value) }); },
  openCountPicker() { if (!this.data.busy) this.setData({ countPickerOpen: true }); },
  closeCountPicker() { this.setData({ countPickerOpen: false }); },
  chooseCount(e) {
    const index = Number(e.currentTarget.dataset.index);
    if (!Number.isInteger(index) || index < 0) return;
    this.setData({ countIndex: index, countPickerOpen: false });
  },
  async generate() {
    if (!this.data.isAdmin || this.data.busy || !this.data.grantReady) return;
    const days = DAYS[this.data.durationIndex], uses = USES[this.data.countIndex];
    if (!days || !uses) { this.setData({ error: uiText('请选择访问时长和兑换次数') }); return; }
    const generation = this._generation;
    this.setData({ busy: true, generatedCode: '', generatedId: '', error: '' });
    try {
      // 服务端每次重新验证管理员，无论页面或本地缓存被怎样修改。
      const result = await api.createCode(null, days, uses);
      if (generation !== this._generation) return;
      this.setData({ generatedCode: result.code, generatedId: result.id,
        generatedMeta: uiText('全局公网服务 · ') + days + uiText(' 天 · ') + uses + uiText(' 次 · ') + date(result.expiresAt) + uiText(' 前兑换') });
      const items = await api.codes();
      if (generation === this._generation) this.applyItems(items);
    } catch (err) {
      if (generation !== this._generation) return;
      this.setData({ error: err.message || uiText('生成失败'), ...(err.code === 'FORBIDDEN' || err.code === 'UNAUTHORIZED' ? { isAdmin: false, generatedCode: '', generatedId: '', items: [], usedCodeCount: 0 } : {}) });
    } finally { if (generation === this._generation) this.setData({ busy: false }); }
  },
  copyCode() {
    if (!this.data.generatedCode || !this.data.isAdmin) return;
    wx.setClipboardData({ data: this.data.generatedCode,
      success: () => wx.showToast({ title: uiText('已复制，可发送给用户'), icon: 'none' }) });
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
      if (generation === this._generation) this.setData({ error: err.message || uiText('复制失败'), ...(err.code === 'FORBIDDEN' || err.code === 'UNAUTHORIZED' ? { isAdmin: false, items: [], usedCodeCount: 0, generatedCode: '', generatedId: '' } : {}) });
    } finally { if (generation === this._generation) this.setData({ actionId: '' }); }
  },
  deleteItem(e) {
    const id = e.currentTarget.dataset.id;
    if (!this.data.isAdmin || this.data.actionId || this.data.busy) return;
    const generation = this._generation;
    wx.showModal({ title: uiText('删除兑换码'), content: uiText('删除后停止新兑换，已兑换的公网时长不受影响。保留必要的使用审计记录。'),
      success: async res => {
        if (!res.confirm || generation !== this._generation) return;
        this.setData({ actionId: id, error: '' });
        try {
          await api.deleteCode(id);
          if (generation !== this._generation) return;
          if (this.data.generatedId === id) this.setData({ generatedCode: '', generatedId: '' });
          const items = await api.codes();
          if (generation === this._generation) this.applyItems(items);
        } catch (err) {
          if (generation === this._generation) this.setData({ error: err.message || uiText('删除失败'), ...(err.code === 'FORBIDDEN' || err.code === 'UNAUTHORIZED' ? { isAdmin: false, items: [], usedCodeCount: 0, generatedCode: '', generatedId: '' } : {}) });
        } finally { if (generation === this._generation) this.setData({ actionId: '' }); }
      }
    });
  },
  revoke(e) {
    const id = e.currentTarget.dataset.id;
    if (!this.data.isAdmin || this.data.actionId || !this.data.items.some(item => item.id === id && item.canRevoke)) return;
    const generation = this._generation;
    wx.showModal({ title: uiText('停用兑换码'), content: uiText('停用后不能再兑换，已兑换的授权不受影响。'),
      success: async res => {
        if (!res.confirm || generation !== this._generation) return;
        this.setData({ actionId: id, error: '' });
        try {
          await api.revokeCode(id);
          if (generation !== this._generation) return;
          if (this.data.generatedId === id) this.setData({ generatedCode: '', generatedId: '' });
          const items = await api.codes();
          if (generation === this._generation) this.applyItems(items);
        } catch (err) {
          if (generation === this._generation) this.setData({ error: err.message || uiText('停用失败'), ...(err.code === 'FORBIDDEN' || err.code === 'UNAUTHORIZED' ? { isAdmin: false, items: [], usedCodeCount: 0, generatedCode: '' } : {}) });
        } finally { if (generation === this._generation) this.setData({ actionId: '' }); }
      }
    });
  },

  /**
   * 一键清空「已用完」的兑换码（used >= uses：次数已兑换完，码本身再无用处）。
   * 已停用/已过期的不动 —— 它们仍是对账与审计的依据；已兑换的公网时长也不受影响。
   * 服务端只支持单个删除且限流 30 次/分钟：被限流时停下并说明，已删成功的不会回滚。
   */
  clearUsedCodes() {
    if (!this.data.isAdmin || this.data.actionId || this.data.busy) return;
    const used = this.data.items.filter(item => item.usedUp);
    if (!used.length) return;
    const generation = this._generation;
    wx.showModal({
      title: uiText('清空已用完的兑换码'),
      content: uiText('将删除 {n} 个已用完的兑换码，已兑换的公网时长不受影响。', { n: used.length }),
      confirmText: uiText('清空'),
      success: async res => {
        if (!res.confirm || generation !== this._generation) return;
        this.setData({ actionId: 'clear-used', error: '' });
        let failed = 0;
        let limited = false;
        const deletedIds = [];
        try {
          for (const item of used) {
            if (generation !== this._generation) return;
            try { await api.deleteCode(item.id); deletedIds.push(item.id); }
            catch (err) {
              if (err && (err.code === 'FORBIDDEN' || err.code === 'UNAUTHORIZED')) throw err;
              if (err && err.code === 'RATE_LIMITED') { limited = true; break; }
              failed += 1;
            }
          }
          if (generation !== this._generation) return;
          if (used.some(item => item.id === this.data.generatedId)) this.setData({ generatedCode: '', generatedId: '' });
          const items = await api.codes();
          if (generation !== this._generation) return;
          this.applyItems(items);
          if (failed) this.setData({ error: uiText('{n} 个兑换码删除失败，请重试', { n: failed }) });
          if (deletedIds.length) {
            wx.showToast({
              title: limited
                ? uiText('已清空 {n} 个，其余受频率限制稍后再试', { n: deletedIds.length })
                : uiText('已清空 {n} 个兑换码', { n: deletedIds.length }),
              icon: 'none'
            });
          }
        } catch (err) {
          if (generation === this._generation) this.setData({ error: err.message || uiText('清空失败'), ...(err.code === 'FORBIDDEN' || err.code === 'UNAUTHORIZED' ? { isAdmin: false, items: [], usedCodeCount: 0, generatedCode: '', generatedId: '' } : {}) });
        } finally { if (generation === this._generation) this.setData({ actionId: '' }); }
      }
    });
  }
});
