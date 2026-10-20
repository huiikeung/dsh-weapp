'use strict';
const { t: uiText } = require('../../utils/ui-preferences');
const store = require('../../utils/store');
const schedule = require('../../utils/schedule');
const editor = require('./schedule-editor');
const theme = require('../../utils/theme');
const week = [uiText('一'), uiText('二'), uiText('三'), uiText('四'), uiText('五'), uiText('六'), uiText('日')];
Page({
  data: { theme: 'light', themeClass: 'theme-light', statusBarH: 44, connected: false, tasks: [], visibleTasks: [], loading: false, error: '', busyId: null,
    search: '', statusFilter: 'all', activeCount: 0, inactiveCount: 0, refreshing: false, selected: null, detailTab: 'rule', editingOpen: false, editing: null,
    rules: editor.RULES, units: [uiText('小时'), uiText('分钟'), uiText('秒')], weekOptions: [], history: [], historyLoading: false, historyError: '', historyNext: '', historyPruned: false, historyRetention: '', creating: false },
  owner() { return store.state.activeID || store.state.gatewayId || store.state.endpoint || ''; },
  onUiPreferencesChange() { this.setData({ rules: editor.RULES.map(item => ({ ...item, title: uiText(item.title) })), units: [uiText('小时'), uiText('分钟'), uiText('秒')], weekOptions: (this.data.weekOptions || []).map(item => ({ ...item, title: uiText(item.title) })) }); },
  onUiLocaleChange() { this.syncFromStore({ app: store.state }); },
  onLoad() {
    this.alive = true; this.host = this.owner(); this.historyRead = 0; this.rawTasks = {}; this.pendingRequestId = null;
    theme.applyTo(this);
    try { this.setData({ statusBarH: (wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()).statusBarHeight || 44 }); } catch (_) {}
    this.unsubscribe = store.subscribe(snapshot => this.syncFromStore(snapshot));
    this.syncFromStore({ app: store.state });
  },
  onShow() { store.refreshScheduledTasks(); },
  onUnload() { this.alive = false; this.historyRead++; if (this.unsubscribe) this.unsubscribe(); },
  syncFromStore(snapshot) {
    const app = snapshot.app, host = this.owner(), connected = app.connection === 'connected';
    const reconnect = connected && !this.data.connected;
    const hostChanged = host !== this.host;
    if (hostChanged) {
      this.host = host; this.historyRead++; this.pendingRequestId = null; this.editingTask = null;
      this.setData({ selected: null, editingOpen: false, editing: null, history: [], historyLoading: false, historyNext: '', historyError: '', search: '', statusFilter: 'all' });
    }
    if (!connected && this.data.connected) { this.historyRead++; this.setData({ historyLoading: false, historyError: uiText('连接已断开，请重连后刷新记录') }); }
    this.rawTasks = {};
    const tasks = (app.scheduledTasks || []).map(t => {
      this.rawTasks[t.id] = t;
      const sess = (app.sessions || []).find(s => s.sessionId === t.sessionId);
      return { ...t, ruleFull: schedule.fullRule(t), ruleShort: schedule.shortRule(t), statusLabel: t.status === 'active' ? uiText('已开启') : uiText('已结束'),
        nextLabel: t.status === 'active' ? schedule.formatDate(t.scheduledAt) : uiText('已结束'), sessionLabel: sess && sess.title || t.sessionId,
        canEdit: t.status === 'active', expanded: false };
    }).sort((a,b) => (Date.parse(a.scheduledAt) || 0) - (Date.parse(b.scheduledAt) || 0));
    const selected = this.data.selected && tasks.find(t => t.id === this.data.selected.id && t.sessionId === this.data.selected.sessionId) || null;
    const patch = { tasks, selected, connected, loading: !!app.scheduledTasksLoading, error: app.scheduledTasksError || '', busyId: app.scheduledTaskPendingId || null,
      activeCount: tasks.filter(t => t.status === 'active').length, inactiveCount: tasks.filter(t => t.status === 'inactive').length };
    if (this.data.refreshing && !patch.loading) patch.refreshing = false;
    if (this.pendingRequestId && !app.scheduledTaskPendingId) {
      if (app.scheduleCompletedRequestId === this.pendingRequestId) { patch.editingOpen = false; patch.editing = null; }
      else if (this.data.editing) patch.editing = { ...this.data.editing, saving: false, error: app.scheduleMutationError || uiText('未能确认保存结果，请刷新后核对') };
      this.pendingRequestId = null;
    }
    this.setData(patch); this.filterTasks();
    if (app.scheduleMutationError && !this.data.editingOpen && app.scheduleMutationError !== this.lastError) {
      this.lastError = app.scheduleMutationError;
      wx.showToast({ title: app.scheduleMutationError, icon: 'none' });
    }
    if (!app.scheduleMutationError) this.lastError = '';
    if ((reconnect || hostChanged) && connected && !patch.loading) store.refreshScheduledTasks();
  },
  filterTasks() {
    const q = this.data.search.trim().toLowerCase(), filter = this.data.statusFilter;
    this.setData({ visibleTasks: this.data.tasks.filter(t => (filter === 'all' || t.status === filter) && (!q || [t.title, t.prompt, t.sessionId].some(v => String(v).toLowerCase().includes(q)))) });
  },
  onSearch(e) { this.setData({ search: e.detail.value }); this.filterTasks(); },
  clearSearch() { this.setData({ search: '' }); this.filterTasks(); },
  selectStatus(e) { const value = e.currentTarget.dataset.status; if (!['all','active','inactive'].includes(value)) return; this.setData({ statusFilter: value }); this.filterTasks(); },
  onRefresh() { if (!this.data.connected) return; this.setData({ refreshing: true }); store.refreshScheduledTasks(); if (this.data.selected && this.data.detailTab === 'records') this.loadHistory(false); },
  onRetry() { store.refreshScheduledTasks(); },
  goBack() { if (this.data.editingOpen) { this.onEditCancel(); return; } if (this.data.selected) { this.closeDetail(); return; } wx.navigateBack({ fail() { wx.reLaunch({ url: '/pages/home/home' }); } }); },
  newTask() {
    if (!this.data.connected || this.data.creating) return;
    this.setData({ creating: true }); const host = this.owner();
    const creation = store.createAndOpenSession(store.state.currentWorkspaceId);
    wx.navigateTo({ url: '/pages/session/session' });
    creation.catch(() => {}).finally(() => { if (this.alive && this.owner() === host) this.setData({ creating: false }); });
  },
  openDetail(e) { const item = this.data.tasks.find(t => t.id === e.currentTarget.dataset.id); if (!item) return; this.historyRead++; this.setData({ selected: item, detailTab: 'rule', history: [], historyNext: '', historyError: '', historyLoading: false, historyPruned: false, historyRetention: '' }); },
  closeDetail() { this.historyRead++; this.setData({ selected: null, history: [], historyLoading: false }); },
  selectDetailTab(e) { const tab = e.currentTarget.dataset.tab; if (!['rule','records'].includes(tab)) return; this.setData({ detailTab: tab }); if (tab === 'records') this.loadHistory(false); },
  openLinkedSession() { const t = this.data.selected; if (!t || !this.data.connected) return; store.openSession(t.sessionId, t.sessionLabel, null); wx.navigateTo({ url: '/pages/session/session' }); },
  refreshHistory() { return this.loadHistory(false); },
  moreHistory() { if (this.data.historyNext && !this.data.historyLoading) return this.loadHistory(true); },
  async loadHistory(more) {
    const task = this.data.selected; if (!task || !this.data.connected) return;
    const host = this.owner(), read = ++this.historyRead;
    const previous = more ? this.data.history : [];
    this.setData({ historyLoading: true, historyError: '' });
    try {
      const result = await store.client.requestScheduleHistory(task.sessionId, task.id, more ? this.data.historyNext : undefined);
      if (!this.alive || host !== this.owner() || read !== this.historyRead || !this.data.selected || this.data.selected.id !== task.id) return;
      if (result.code) throw Error(result.code === 'schedule_not_found' ? uiText('任务已不可用') : uiText('记录已更新，请刷新'));
      if (!Array.isArray(result.records)) throw Error(uiText('主机返回了无效的运行记录'));
      const seen = new Set(previous.map(r => r.messageId));
      const records = result.records.filter(r => !seen.has(r.messageId)).map(r => ({ ...r, dateLabel: schedule.formatDate(r.scheduledAt), expanded: false }));
      this.setData({ history: previous.concat(records), historyNext: result.nextBefore || '', historyLoading: false, historyPruned: !!result.earlierRecordsPruned,
        historyRetention: result.retention ? uiText('每个任务最多保留近 ') + result.retention.days + uiText(' 天内的 ') + result.retention.records + uiText(' 条运行记录。') : '' });
    } catch (error) { if (this.alive && host === this.owner() && read === this.historyRead) this.setData({ historyLoading: false, historyError: error.message || uiText('无法读取运行记录') }); }
  },
  expandHistory(e) { const id = e.currentTarget.dataset.id; this.setData({ history: this.data.history.map(r => r.messageId === id ? { ...r, expanded: !r.expanded } : r) }); },
  onEditTap() {
    const item = this.data.selected; if (!item || !item.canEdit || !this.data.connected || this.data.busyId) return;
    this.editingTask = this.rawTasks[item.id]; this.initialDraft = editor.draft(this.editingTask);
    this.setData({ editingOpen: true, editing: { ...this.initialDraft } }); this.syncWeek();
  },
  syncWeek() { this.setData({ weekOptions: week.map((title,i) => ({ day: i+1, title: uiText(title), selected: this.data.editing.weekdays.includes(i+1) })) }); },
  onEditCancel() { if (this.data.editing && this.data.editing.saving) return; this.setData({ editingOpen: false, editing: null }); },
  editField(e) { const key = e.currentTarget.dataset.field; if (['title','prompt','time','zone','interval','expression'].includes(key)) this.patchEditing({ [key]: e.detail.value }); },
  pickDate(e) { this.patchEditing({ date: e.detail.value }); },
  pickRule(e) { const index = Number(e.detail.value), rule = editor.RULES[index]; if (rule) this.patchEditing({ ruleIndex: index, kind: rule.id }); },
  pickUnit(e) { const i = Number(e.detail.value); if ([0,1,2].includes(i)) this.patchEditing({ unitIndex: i, unit: [3600,60,1][i] }); },
  pickWeek(e) { const day = Number(e.currentTarget.dataset.day); if (!this.data.editing || !Number.isInteger(day) || day<1 || day>7) return; const days = this.data.editing.weekdays; this.patchEditing({ weekdays: days.includes(day) ? days.filter(v=>v!==day) : days.concat(day).sort() }); this.syncWeek(); },
  patchEditing(fields) {
    if (!this.data.editing || this.data.editing.saving) return;
    const d = { ...this.data.editing, ...fields }; let error = '', change;
    try { if (!d.title.trim() || d.title.trim().length>120) throw Error(uiText('任务名称需为 1–120 个字符')); if (!d.prompt.trim()) throw Error(uiText('请输入任务内容')); change = editor.buildChange(d,this.initialDraft); } catch(e) { error = e.message; }
    d.error = error; d.canSave = !error && (d.title.trim()!==this.editingTask.title || d.prompt.trim()!==this.editingTask.prompt || change!==null); this.setData({ editing: d });
  },
  onEditSave() {
    const d = this.data.editing; if (!d || !d.canSave || d.saving || !this.data.connected) return;
    try {
      const change = editor.buildChange(d,this.initialDraft);
      const id = store.updateScheduledTask(this.editingTask,d.title.trim(),d.prompt.trim(),change);
      if (id) { this.pendingRequestId = id; this.setData({ editing: { ...d, saving: true, error: '' } }); }
      else this.setData({ editing: { ...d,error: store.state.scheduleMutationError || uiText('另一个操作正在进行，请稍后重试') } });
    } catch(error) { this.setData({ editing: { ...d,error: error.message } }); }
  },
  onDeleteTap() {
    const item = this.data.selected, host = this.owner(); if (!item || !this.data.connected || this.data.busyId) return;
    const task = this.rawTasks[item.id];
    wx.showModal({ title: uiText('删除此自动化任务？'), content: uiText('任务将停止触发，并删除已保存的运行记录。原会话及消息仍保留；已排队消息不会撤回。'), confirmText: uiText('确认删除'), confirmColor: '#D64F52', cancelText: uiText('取消'), success: res => {
      if (!res.confirm || !this.alive || host !== this.owner()) return;
      store.deleteScheduledTask(task);
    } });
  },
  noop() {}
});
