const { t: uiText } = require('../../utils/ui-preferences');
const api = require('../../utils/access-api');
const theme = require('../../utils/theme');
const statuses = { issuing: uiText('生成中'), pending: uiText('待配对'), active: uiText('使用中'), expired: uiText('已到期'), revoking: uiText('等待设备确认停用'), revoked: uiText('已停用'), superseded: uiText('已被新配对替换'), failed: uiText('生成失败') };
function date(value) { if (!value) return '—'; const d = new Date(value); return [d.getFullYear(), d.getMonth() + 1, d.getDate()].join('/') + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }
Page({
  data: { loading: true, isAdmin: false, busy: false, syncing: false, error: '', nodes: [], nodeIndex: 0, durations: [], durationIndex: 0, items: [], generatedCode: '', generatedMeta: '', generatedId: '', syncedLabel: '', actionId: '', selectedReady: false },
  onLoad() { theme.applyTo(this); },
  onShow() { this._visible = true; return this.refresh(); },
  onHide() { this.stop(); },
  onUnload() { this.stop(); },
  stop() { this._visible = false; this._generation = (this._generation || 0) + 1; clearInterval(this._timer); this._timer = null; this.setData({ isAdmin: false, busy: false, syncing: false, generatedCode: '', generatedId: '', items: [], actionId: '' }); },
  async refresh() {
    const generation = this._generation = (this._generation || 0) + 1;
    clearInterval(this._timer);
    this.setData({ loading: true, isAdmin: false, busy: false, error: '', generatedCode: '', generatedId: '', actionId: '' });
    try {
      const account = await api.ensureAccount({ freshLogin: true });
      if (generation !== this._generation) return;
      if (!account || account.isAdmin !== true) { this.setData({ loading: false, error: uiText('当前微信不是管理员，无法生成配对码。'), items: [], nodes: [] }); return; }
      const state = await api.pairings();
      if (generation !== this._generation) return;
      this.setData({ isAdmin: true, loading: false }); this.applyState(state);
      if (this._visible) this._timer = setInterval(() => this.sync(), 10000);
    } catch (e) { if (generation === this._generation) this.setData({ loading: false, isAdmin: false, error: e.message || uiText('后台连接失败'), items: [] }); }
  },
  applyState(state) {
    const selectedNode = this.data.nodes[this.data.nodeIndex], selectedDuration = this.data.durations[this.data.durationIndex];
    const nodes = (state.nodes || []).filter(n => !n.disabled).map(n => ({ ...n, label: n.name + (n.managedPairingReady ? uiText(' · 可签发') : n.online ? uiText(' · 需安装限时扩展') : uiText(' · 离线')) }));
    const durations = (state.durations || []).map(item => ({ ...item, label: item.days + uiText(' 天') }));
    const nodeIndex = Math.max(0, nodes.findIndex(n => n.id === (selectedNode && selectedNode.id)));
    let durationIndex = durations.findIndex(d => d.days === (selectedDuration ? selectedDuration.days : 30));
    if (durationIndex < 0) durationIndex = 0;
    const items = (state.items || []).map(r => ({ ...r, title: r.nodeName + ' · ' + r.days + uiText(' 天'), statusLabel: uiText(statuses[r.status]) || uiText('待确认'),
      originLabel: r.source === 'weapp' ? uiText('小程序签发') : uiText('网页签发'), createdLabel: date(r.createdAt), accessLabel: date(r.accessExpiresAt), codeLabel: date(r.expiresAt),
      canRevoke: ['pending', 'active'].includes(r.status) }));
    const generated = items.find(r => r.id === this.data.generatedId);
    this.setData({ nodes, nodeIndex, durations, durationIndex, items, selectedReady: !!(nodes[nodeIndex] && nodes[nodeIndex].managedPairingReady), syncedLabel: date(state.syncedAt),
      ...(generated && generated.status !== 'pending' ? { generatedCode: '', generatedId: '' } : {}) });
  },
  async sync() {
    if (!this.data.isAdmin || this.data.syncing || this.data.busy || this.data.actionId) return;
    const generation = this._generation; this.setData({ syncing: true });
    try { const state = await api.pairings(); if (generation === this._generation) { this.applyState(state); this.setData({ error: '' }); } }
    catch (e) { if (generation === this._generation) this.handleError(e); }
    finally { if (generation === this._generation) this.setData({ syncing: false }); }
  },
  handleError(e) {
    const denied = ['FORBIDDEN', 'UNAUTHORIZED', 'LOGIN_REQUIRED'].includes(e.code);
    this.setData({ error: e.message || uiText('请求失败'), ...(denied ? { isAdmin: false, generatedCode: '', generatedId: '', items: [] } : {}) });
    if (denied) clearInterval(this._timer);
  },
  pickNode(e) { if (this.data.busy) return; const nodeIndex = Number(e.detail.value); this.setData({ nodeIndex, selectedReady: !!(this.data.nodes[nodeIndex] && this.data.nodes[nodeIndex].managedPairingReady) }); },
  pickDuration(e) { if (!this.data.busy) this.setData({ durationIndex: Number(e.detail.value) }); },
  async generate() {
    if (!this.data.isAdmin || this.data.busy || !this.data.selectedReady) return;
    const node = this.data.nodes[this.data.nodeIndex], duration = this.data.durations[this.data.durationIndex];
    if (!node || !duration) return;
    const generation = this._generation; this.setData({ busy: true, error: '', generatedCode: '', generatedId: '' });
    try {
      const result = await api.createPairing(node.id, duration.days);
      if (generation !== this._generation) return;
      this.setData({ generatedCode: result.qrPayload, generatedId: result.id, generatedMeta: node.name + ' · ' + duration.label + uiText(' · 访问到期 ') + date(result.accessExpiresAt) + uiText('；扫码/粘贴截止 ') + date(result.expiresAt) });
      const state = await api.pairings(); if (generation === this._generation) this.applyState(state);
    } catch (e) { if (generation === this._generation) this.handleError(e); }
    finally { if (generation === this._generation) this.setData({ busy: false }); }
  },
  copyCode() { if (this.data.isAdmin && this.data.generatedCode) has.setClipboardData({ data: this.data.generatedCode, success: () => has.showToast({ title: uiText('已复制，请在短期有效期内配对'), icon: 'none' }) }); },
  revoke(e) {
    const id = e.currentTarget.dataset.id, generation = this._generation;
    if (!this.data.isAdmin || this.data.actionId || !this.data.items.some(r => r.id === id && r.canRevoke)) return;
    has.showModal({ title: uiText('停用限时配对'), content: uiText('后台会同步通知电脑撤销该授权。电脑离线时显示等待确认，不会假装已经撤销。'), success: async res => {
      if (!res.confirm || generation !== this._generation) return;
      this.setData({ actionId: id });
      try { await api.revokePairing(id); if (generation !== this._generation) return; const state = await api.pairings(); if (generation === this._generation) this.applyState(state); }
      catch (e) { if (generation === this._generation) this.handleError(e); }
      finally { if (generation === this._generation) this.setData({ actionId: '' }); }
    } });
  }
});
