// 定时任务页（对齐 dsh-mobile RootView.ScheduledTasksView / ScheduledTaskCard /
// ScheduledTaskEditSheet）：左滑卡片揭示编辑/删除、点击展开详情、下拉刷新、
// 编辑弹层（标题/内容/执行时间）与删除确认。

const store = require('../../utils/store');
const schedule = require('../../utils/schedule');
const theme = require('../../utils/theme');

// iOS revealWidth 固定 128（pt ≈ weapp 逻辑 px），不随屏宽缩放
const REVEAL_W = 128;

Page({
  data: {
    theme: 'light',
    themeClass: 'theme-light',
    pageStyle: '',
    statusBarH: 44,
    tasks: [],
    loading: false,
    error: '',
    busyId: null,
    revealedId: null,
    draggingIndex: -1,
    refreshing: false,
    editingOpen: false,
    editing: null
  },

  onLoad() {
    theme.applyTo(this);
    try {
      const info = typeof wx.getWindowInfo === 'function' ? wx.getWindowInfo() : wx.getSystemInfoSync();
      this.setData({ statusBarH: info.statusBarHeight || 44 });
    } catch (e) { /* 默认 44 */ }
    this.revealW = REVEAL_W;
    this.expandedSet = new Set();
    this.rawTasks = {};
    this.drag = null;
    this.suppressTapUntil = 0;
    this.pendingRequestId = null;
    this.lastConn = null;
    this.lastAlertError = null;
    this.unsubscribe = store.subscribe((snapshot) => this.syncFromStore(snapshot));
    this.syncFromStore({ app: store.state, session: store.sessionState });
  },

  onShow() {
    // 对齐 iOS .task { if !connected refresh }：进入页面即拉取
    store.refreshScheduledTasks();
  },

  onReady() {
    if (store.state.connection === 'connected') store.refreshScheduledTasks();
  },

  onUnload() {
    if (this.unsubscribe) this.unsubscribe();
  },

  // ---------- 数据同步 ----------

  syncFromStore(snapshot) {
    const app = snapshot.app;
    const conn = app.connection;
    const tasks = (app.scheduledTasks || []).map((t) => this.toViewTask(t, app));
    const patch = {
      tasks: tasks,
      loading: app.scheduledTasksLoading === true,
      error: app.scheduledTasksError || '',
      busyId: app.scheduledTaskPendingId || null
    };
    // 下拉刷新收尾
    if (this.data.refreshing && !patch.loading) patch.refreshing = false;
    // 连接建立后自动刷新（对齐 iOS onReceive gateway.$state）
    if (conn === 'connected' && this.lastConn !== 'connected' && !patch.loading) {
      store.refreshScheduledTasks();
    }
    this.lastConn = conn;

    // 编辑弹层：变更完成关闭 / 失败回显（对齐 iOS onChange scheduledTaskCompletedRequestID）
    if (this.pendingRequestId) {
      if (app.scheduleCompletedRequestId === this.pendingRequestId) {
        this.pendingRequestId = null;
        patch.editingOpen = false;
        patch.editing = null;
      } else if (!app.scheduledTaskPendingId) {
        // 请求已结束但未成功
        if (this.data.editing) {
          patch.editing = Object.assign({}, this.data.editing, {
            saving: false,
            error: app.scheduleMutationError || '操作失败，请稍后重试'
          });
        }
        this.pendingRequestId = null;
      }
    }
    this.setData(patch);

    // 弹层外的操作失败提示（对齐 iOS .alert 定时任务操作失败）
    if (app.scheduleMutationError && !this.data.editingOpen && app.scheduleMutationError !== this.lastAlertError) {
      this.lastAlertError = app.scheduleMutationError;
      wx.showModal({
        title: '定时任务操作失败',
        content: app.scheduleMutationError,
        showCancel: false,
        confirmText: '好'
      });
    }
  },

  toViewTask(t, app) {
    const sessions = app.sessions || [];
    const sess = sessions.find((s) => s.sessionId === t.sessionId);
    const active = t.status === 'active';
    const revealed = this.data.revealedId === t.id;
    this.rawTasks[t.id] = t;
    return {
      id: t.id,
      sessionId: t.sessionId,
      title: t.title,
      prompt: t.prompt,
      kind: t.kind,
      status: t.status,
      raw: t.raw,
      ruleShort: schedule.shortRule(t),
      ruleFull: schedule.fullRule(t),
      dateLabel: active ? schedule.formatDate(t.scheduledAt) : '已结束',
      nextLabel: active ? schedule.formatDate(t.scheduledAt) : '无',
      statusLabel: active ? '运行中' : '已结束',
      deliveryLabel: (t.lastDelivery && t.lastDelivery.deliveredAt)
        ? '已投递 · ' + schedule.formatDate(t.lastDelivery.deliveredAt)
        : '暂无投递记录',
      sessionLabel: (sess && sess.title) || t.sessionId,
      canEdit: active,
      expanded: this.expandedSet.has(t.id),
      x: revealed ? -this.revealW : 0
    };
  },

  // ---------- 刷新 / 导航 ----------

  onRefresh() {
    this.setData({ refreshing: true });
    store.refreshScheduledTasks();
  },

  onRetry() {
    store.refreshScheduledTasks();
  },

  goBack() {
    wx.navigateBack({
      fail() {
        wx.reLaunch({ url: '/pages/home/home' });
      }
    });
  },

  // ---------- 卡片手势（对齐 iOS swipeGesture） ----------

  onCardTouchStart(e) {
    const index = e.currentTarget.dataset.index;
    const item = this.data.tasks[index];
    if (!item) return;
    this.drag = {
      index: index,
      id: item.id,
      startX: e.touches[0].clientX,
      startY: e.touches[0].clientY,
      startT: Date.now(),
      baseX: this.data.revealedId === item.id ? -this.revealW : 0,
      axis: null,
      lastX: 0
    };
  },

  onCardTouchMove(e) {
    const d = this.drag;
    if (!d) return;
    const dx = e.touches[0].clientX - d.startX;
    const dy = e.touches[0].clientY - d.startY;
    if (d.axis === null) {
      // 对齐 iOS：水平位移 > 垂直 × 1.15 才进入左滑
      if (Math.abs(dx) < 8) return;
      d.axis = Math.abs(dx) > Math.abs(dy) * 1.15 ? 'h' : 'v';
      if (d.axis === 'h') {
        // 拖动其他已揭示卡片时先收起
        if (this.data.revealedId && this.data.revealedId !== d.id) {
          this.closeReveal();
          d.baseX = 0;
        }
        this.setData({ draggingIndex: d.index });
      }
    }
    if (d.axis !== 'h') return;
    const x = Math.min(0, Math.max(-this.revealW, d.baseX + dx));
    if (Math.abs(x - d.lastX) < 1) return;
    d.lastX = x;
    this.setData({ ['tasks[' + d.index + '].x']: x });
  },

  onCardTouchEnd(e) {
    const d = this.drag;
    this.drag = null;
    if (!d || d.axis !== 'h') {
      if (d && d.axis === null) { /* 视为点击，不处理 */ }
      return;
    }
    const changed = e.changedTouches && e.changedTouches[0];
    const totalDx = (changed ? changed.clientX - d.startX : d.lastX);
    const dt = Math.max(1, Date.now() - d.startT);
    const velocity = totalDx / dt * 1000; // px/s
    const settled = d.lastX || Math.min(0, Math.max(-this.revealW, d.baseX + totalDx));
    // 对齐 iOS：快滑速度优先，其次阈值（关闭态 0.25 / 打开态 0.75）
    let shouldReveal;
    if (velocity < -280) shouldReveal = true;
    else if (velocity > 280) shouldReveal = false;
    else shouldReveal = settled <= -this.revealW * (d.baseX === 0 ? 0.25 : 0.75);
    this.suppressTapUntil = Date.now() + 350;
    this.setData({
      draggingIndex: -1,
      revealedId: shouldReveal ? d.id : null,
      ['tasks[' + d.index + '].x']: shouldReveal ? -this.revealW : 0
    });
  },

  closeReveal() {
    const revealedId = this.data.revealedId;
    if (!revealedId) return;
    const patch = { revealedId: null };
    this.data.tasks.forEach((item, i) => {
      if (item.id === revealedId) patch['tasks[' + i + '].x'] = 0;
    });
    this.setData(patch);
  },

  // ---------- 卡片交互 ----------

  onCardTap(e) {
    if (Date.now() < this.suppressTapUntil) return; // 左滑后抑制误触
    const index = e.currentTarget.dataset.index;
    const item = this.data.tasks[index];
    if (!item) return;
    if (this.data.revealedId === item.id) {
      this.closeReveal();
      return;
    }
    this.closeReveal();
    // 打开所属会话（iOS onOpenSession）
    store.openSession(item.sessionId, item.sessionLabel, null);
    wx.navigateTo({ url: '/pages/session/session' });
  },

  onExpandTap(e) {
    if (Date.now() < this.suppressTapUntil) return;
    const index = e.currentTarget.dataset.index;
    const item = this.data.tasks[index];
    if (!item) return;
    if (this.data.revealedId === item.id) {
      this.closeReveal();
      return;
    }
    if (this.expandedSet.has(item.id)) this.expandedSet.delete(item.id);
    else this.expandedSet.add(item.id);
    this.setData({ ['tasks[' + index + '].expanded']: this.expandedSet.has(item.id) });
  },

  onEditTap(e) {
    const index = e.currentTarget.dataset.index;
    const item = this.data.tasks[index];
    if (!item || !item.canEdit || this.data.busyId === item.id) return;
    this.closeReveal();
    const isRepeating = item.kind !== 'at' && item.kind !== 'after';
    const raw = item.raw || {};
    const zone = schedule.taskZone(raw);
    // at/after 类型默认进入指定日期模式；循环任务保留原规则只调时刻
    this.editingTask = this.rawTasks[item.id] || item;
    this.setData({
      editingOpen: true,
      editing: {
        id: item.id,
        title: item.title,
        prompt: item.prompt,
        isRepeating: isRepeating,
        kindLabel: item.kind === 'daily' ? '每日' : '每周',
        ruleFull: item.ruleFull,
        zone: zone,
        useSpecificDate: !isRepeating,
        today: schedule.todayStr(),
        date: this.initialDate(item),
        time: schedule.initialClock(raw),
        canSave: false,
        saving: false,
        pastWarning: false,
        error: ''
      }
    });
  },

  initialDate(item) {
    // at/after：原计划时间在未来时作为初值，否则今天
    const ms = schedule.parseISOms(item.scheduledAt);
    if (ms && ms > Date.now()) {
      const d = new Date(ms);
      const pad = (n) => (n < 10 ? '0' + n : '' + n);
      return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    }
    return schedule.todayStr();
  },

  onEditCancel() {
    if (this.data.editing && this.data.editing.saving) return; // 保存中禁止关闭（iOS interactiveDismissDisabled）
    this.setData({ editingOpen: false, editing: null });
  },

  onTitleInput(e) {
    this.patchEditing({ title: e.detail.value });
  },

  onPromptInput(e) {
    this.patchEditing({ prompt: e.detail.value });
  },

  onSpecificChange(e) {
    this.patchEditing({ useSpecificDate: e.detail.value });
  },

  onDatePick(e) {
    this.patchEditing({ date: e.detail.value });
  },

  onTimePick(e) {
    this.patchEditing({ time: e.detail.value });
  },

  patchEditing(fields) {
    const editing = Object.assign({}, this.data.editing, fields);
    const task = this.editingTask;
    const title = editing.title.trim();
    const prompt = editing.prompt.trim();
    const titleChanged = title !== this.editingTask.title;
    const promptChanged = prompt !== this.editingTask.prompt;
    let change = null;
    try {
      change = schedule.timingChange(task, {
        useSpecificDate: editing.useSpecificDate,
        date: editing.date,
        time: editing.time
      });
    } catch (err) { change = null; }
    const ms = schedule.combineDateTime(editing.date, editing.time);
    editing.pastWarning = !!(editing.useSpecificDate && change && ms && ms <= Date.now());
    editing.canSave = !!(
      title && title.length <= 120 && prompt &&
      (titleChanged || promptChanged || change !== null) &&
      !(editing.useSpecificDate && change && ms && ms <= Date.now())
    );
    editing.error = '';
    this.setData({ editing: editing });
  },

  onEditSave() {
    const editing = this.data.editing;
    if (!editing || !editing.canSave || editing.saving) return;
    const task = this.editingTask;
    let change = null;
    try {
      change = schedule.timingChange(task, {
        useSpecificDate: editing.useSpecificDate,
        date: editing.date,
        time: editing.time
      });
    } catch (err) { change = null; }
    const requestId = store.updateScheduledTask(
      task, editing.title.trim(), editing.prompt.trim(), change
    );
    if (requestId) {
      this.pendingRequestId = requestId;
      this.setData({ editing: Object.assign({}, editing, { saving: true, error: '' }) });
    } else {
      this.setData({
        editing: Object.assign({}, editing, {
          saving: false,
          error: store.state.scheduleMutationError || '操作正在进行，请稍后重试'
        })
      });
    }
  },

  onDeleteTap(e) {
    const index = e.currentTarget.dataset.index;
    const item = this.data.tasks[index];
    if (!item || this.data.busyId === item.id) return;
    const task = this.rawTasks[item.id] || item;
    wx.showModal({
      title: '删除定时任务？',
      content: '删除后任务及投递记录无法恢复；已进入会话队列的消息不会撤回。',
      confirmText: '删除',
      confirmColor: '#D64F52',
      cancelText: '取消',
      success: (res) => {
        if (!res.confirm) return;
        this.closeReveal();
        if (!store.deleteScheduledTask(task)) {
          const error = store.state.scheduleMutationError;
          if (error) {
            wx.showModal({ title: '定时任务操作失败', content: error, showCancel: false, confirmText: '好' });
          }
        }
      }
    });
  }
});
