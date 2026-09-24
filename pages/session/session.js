const store = require('../../utils/store');
const markdown = require('../../utils/markdown');
const labels = require('../../utils/labels');
const util = require('../../utils/util');
const notifyPref = require('../../utils/notify-pref');
const theme = require('../../utils/theme');

// 订阅消息模板 ID：与设置页保持一致；留空则发送时不申请授权。
const NOTIFY_TEMPLATE_ID = 'QvgkQ88HKFdTNPJVOp0EdOHNDodOQACzB9oDEFDZXKU';

Page({
  data: {
    tab: 'conversation', // conversation | trajectory
    navTitle: '会话',
    presetLabel: '',
    running: false,
    rows: [],
    trajectory: [],
    folds: {},
    scrollTarget: 'conv-bottom',
    hasMoreHistory: false,

    question: null,
    questionBusy: false,
    approval: null,
    approvalBusy: false,

    draft: '',
    images: [],
    canSend: false,
    canAttach: true,

    permissionLabel: '工作区写入',
    permissionIcon: 'shield-pencil-gray',
    modelLabel: 'DeepSeek',
    effortLabel: 'High',
    contextPct: -1,

    stats: {
      turns: 0,
      steps: 0,
      durationLabel: '0.00 s',
      inputPct: 0,
      modelPct: 0,
      toolsPct: 0
    },
    statsLabel: '',

    traceDetail: null,    recording: false
  },

  onLoad(options) {
    theme.applyTo(this);
    this.sessionId = options.id || store.sessionState.sessionId;
    this.folds = {};
    this.unsubscribe = store.subscribe((snapshot) => {
      this.syncFromStore(snapshot);
    });
    this.syncFromStore({ app: store.state, session: store.sessionState });
  },

  onUnload() {
    if (this.unsubscribe) this.unsubscribe();
  },

  // ---------- 状态同步 ----------

  syncFromStore(snapshot) {
    const s = snapshot.session;
    const app = snapshot.app;
    if (!s || !s.sessionId) return;

    const rows = (s.rows || []).map((row) => {
      const copy = Object.assign({}, row);
      if (row.kind === 'assistant') {
        copy.blocks = markdown.parse(row.text || '');
        copy.images = row.images || [];
      }
      if (row.kind === 'user') {
        copy.images = row.images || [];
      }
      return copy;
    });

    const trajectory = (s.trajectory || []).map((item) => {
      const copy = Object.assign({}, item);
      copy.badgeClass = String(item.badge || '').toLowerCase();
      copy.seqLabel = typeof item.seq === 'number' ? numberWithCommas(item.seq) : '';
      return copy;
    });

    const stats = s.stats && s.stats.stats ? s.stats.stats : {};
    const llmMs = stats.llmMs || 0;
    const toolMs = stats.toolMs || 0;
    const totalMs = Math.max(llmMs + toolMs, 1);
    const turns = stats.turns || 0;
    const steps = stats.steps || 0;
    const durationSeconds = totalMs / 1000;

    const selection = s.selection || app.modelCatalog && app.modelCatalog.current || app.defaultModel;
    const modelLabel = selection
      ? (selection.model || selection.provider || '模型')
      : '模型';
    const effort = selection && selection.reasoningEffort
      ? labels.reasoningEffortName(selection.reasoningEffort)
      : (app.defaultModel && app.defaultModel.reasoningEffort
        ? labels.reasoningEffortName(app.defaultModel.reasoningEffort)
        : 'High');

    const question = s.pendingQuestion ? decorateQuestion(s.pendingQuestion, this.questionDraft || {}) : null;
    const approval = s.pendingApproval;

    // 会话级 Agent 预设胶囊（对齐 dsh-mobile v1.6.0）：
    // 预设目录已加载且会话未在运行时展示；运行中发送会锁定预设
    const presetsCatalog = store.state.agentPresets;
    const presetVisible = !!(presetsCatalog && presetsCatalog.presets && presetsCatalog.presets.length && s.sessionId && !s.running);
    const presetName = s.agentPreset
      ? this.findPresetName(presetsCatalog, s.agentPreset)
      : '';
    if (s.sessionId && presetVisible && !this._presetRequestedFor) {
      this._presetRequestedFor = s.sessionId;
      store.client.requestSessionAgentPreset(s.sessionId).catch(() => {});
    }
    if (this._presetRequestedFor && this._presetRequestedFor !== s.sessionId) {
      this._presetRequestedFor = s.sessionId;
      if (s.sessionId) store.client.requestSessionAgentPreset(s.sessionId).catch(() => {});
    }

    const pressure = (s.stats && s.stats.pressure) || null;
    const contextPct = pressure && pressure.contextWindow > 0
      ? Math.min(100, Math.max(0, Math.round(((pressure.pressureTokens || 0) / pressure.contextWindow) * 100)))
      : -1;

    this.setData({
      navTitle: s.title || util.sessionIdLabel(s.sessionId),
      presetLabel: labels.presetModeName(s.agentPreset || 'standard'),
      sessionPresetVisible: presetVisible,
      sessionPresetName: presetName || '选择模式',
      running: isRunning(rows),
      rows: rows,
      trajectory: trajectory,
      hasMoreHistory: s.hasMoreHistory,
      question: question,
      questionBusy: s.questionStatus === 'submitting' || s.questionStatus === 'accepted',
      approval: approval,
      approvalBusy: s.approvalStatus === 'submitting' || s.approvalStatus === 'accepted',
      permissionLabel: labels.permissionName(s.permission || 'workspace-write'),
      permissionIcon: labels.permissionIconFile(s.permission || 'workspace-write'),
      modelLabel: modelLabel,
      effortLabel: effort,
      contextPct: contextPct,
      stats: {
        turns: turns,
        steps: steps,
        durationLabel: durationSeconds.toFixed(2) + ' s',
        inputPct: Math.min(100, Math.round((toolMs / totalMs) * 60 + 15)),
        modelPct: Math.min(100, Math.round((llmMs / totalMs) * 85 + 10)),
        toolsPct: Math.min(100, Math.round((toolMs / totalMs) * 95 + 5))
      },
      statsLabel: turns || steps ? (turns + ' 轮 · ' + steps + ' 步') : ''
    });

    // 新内容到达时贴底
    if (this.data.tab === 'conversation') {
      this.setData({ scrollTarget: 'conv-bottom' });
    }
  },

  // ---------- 导航 ----------

  goBack() {
    wx.navigateBack();
  },

  switchTab(e) {
    this.setData({ tab: e.currentTarget.dataset.tab });
  },

  findPresetName(catalog, presetId) {
    const presets = (catalog && catalog.presets) || [];
    const found = presets.find((p) => p.id === presetId);
    return (found && found.name) || labels.presetModeName(presetId);
  },

  // 对齐 dsh-mobile v1.6.0：会话模式胶囊，点击弹出预设列表
  pickSessionPreset() {
    const catalog = store.state.agentPresets;
    const presets = (catalog && catalog.presets) || [];
    const sessionId = store.sessionState.sessionId;
    if (!presets.length || !sessionId) return;
    const current = store.sessionState.agentPreset;
    wx.showActionSheet({
      itemList: presets
        .map((p) => (p.id === current ? '✓ ' : '') + ((p.name && p.name.trim()) || labels.presetModeName(p.id)))
        .slice(0, 6),
      success: (res) => {
        const picked = presets[res.tapIndex];
        if (!picked || picked.id === current) return;
        store.client.selectSessionAgentPreset(sessionId, picked.id).catch((err) => {
          wx.showToast({ title: err.message || '切换失败', icon: 'none' });
        });
      }
    });
  },

  moreActions() {
    const s = store.sessionState;
    const self = this;
    wx.showActionSheet({
      itemList: ['重命名会话', '查看统计', '工作区文件', '取消当前回合', '归档会话'],
      success(res) {
        switch (res.tapIndex) {
          case 0:
            wx.showModal({
              title: '重命名会话',
              editable: true,
              placeholderText: self.data.navTitle,
              success(r) {
                if (r.confirm && r.content && r.content.trim()) {
                  store.client.renameSession(s.sessionId, r.content.trim());
                  self.setData({ navTitle: r.content.trim() });
                }
              }
            });
            break;
          case 1:
            self.showStats();
            break;
          case 2:
            wx.navigateTo({ url: '/pages/files/files' });
            break;
          case 3:
            store.client.cancelSession(s.sessionId);
            break;
          case 4:
            wx.showModal({
              title: '归档会话',
              content: '归档后会话将从列表隐藏。',
              success(r) {
                if (r.confirm) {
                  store.client.archiveSession(s.sessionId);
                  wx.navigateBack();
                }
              }
            });
            break;
          default:
        }
      }
    });
  },

  showStats() {
    const stats = store.sessionState.stats || {};
    const st = stats.stats || {};
    const totals = (stats.tokenUsage && stats.tokenUsage.totals) || {};
    const lines = [
      '轮次 ' + (st.turns || 0) + ' · 步骤 ' + (st.steps || 0),
      'LLM ' + ((st.llmMs || 0) / 1000).toFixed(1) + 's · 工具 ' + ((st.toolMs || 0) / 1000).toFixed(1) + 's',
      'Tokens 输入 ' + ((totals.inputTokens || 0) + (totals.cacheReadTokens || 0)) + ' / 输出 ' + (totals.outputTokens || 0)
    ];
    wx.showModal({ title: '会话统计', content: lines.join('\n'), showCancel: false });
  },

  // ---------- 对话交互 ----------

  loadOlder() {
    store.loadOlderHistory();
  },

  toggleFold(e) {
    const key = e.currentTarget.dataset.key;
    const patch = {};
    patch['folds.' + key] = !this.data.folds[key];
    this.setData(patch);
  },

  copyCode(e) {
    wx.setClipboardData({ data: e.currentTarget.dataset.text || '' });
  },

  previewAttachment(e) {
    const id = e.currentTarget.dataset.id;
    const row = this.data.rows.find((r) => (r.images || []).some((img) => img.attachmentId === id));
    const img = row && row.images.find((i) => i.attachmentId === id);
    if (img && img.localUrl) {
      wx.previewImage({ urls: [img.localUrl] });
      return;
    }
    // 按需从网关拉取图片附件
    store.client.requestAttachment(store.sessionState.sessionId, id).then(() => {
      wx.showToast({ title: '已请求附件', icon: 'none' });
    }).catch((err) => {
      wx.showToast({ title: err.message || '附件加载失败', icon: 'none' });
    });
  },

  // ---------- 问题应答 ----------

  toggleOption(e) {
    const { qid, label } = e.currentTarget.dataset;
    const question = this.data.question;
    if (!question) return;
    this.questionDraft = this.questionDraft || {};
    const q = question.questions.find((item) => item.id === qid);
    if (!q) return;
    const current = this.questionDraft[qid] || {};
    if (q.allowsMultipleSelections) {
      current[label] = !current[label];
    } else {
      const next = {};
      Object.keys(current).forEach((k) => { next[k] = false; });
      next[label] = !current[label];
      this.questionDraft[qid] = next;
      this.setData({ 'question.questions': decorateQuestion(store.sessionState.pendingQuestion, this.questionDraft).questions });
      return;
    }
    this.questionDraft[qid] = current;
    this.setData({ 'question.questions': decorateQuestion(store.sessionState.pendingQuestion, this.questionDraft).questions });
  },

  onCustomInput(e) {
    const qid = e.currentTarget.dataset.qid;
    this.questionDraft = this.questionDraft || {};
    this.customDraft = this.customDraft || {};
    this.customDraft[qid] = e.detail.value;
  },

  submitQuestion() {
    const pending = store.sessionState.pendingQuestion;
    if (!pending || this.data.questionBusy) return;
    const self = this;
    const draft = this.questionDraft || {};
    const custom = this.customDraft || {};
    const answers = pending.questions.map((q) => {
      const selected = Object.keys(draft[q.id] || {}).filter((k) => draft[q.id][k]);
      const answer = { id: q.id, selected: selected };
      if (custom[q.id] && custom[q.id].trim()) answer.custom = custom[q.id].trim();
      return answer;
    });
    this.setData({ questionBusy: true });
    store.client.answerQuestion(pending.rpcId, pending.sessionId, answers)
      .then(() => {
        self.questionDraft = {};
        self.customDraft = {};
        wx.showToast({ title: '已提交', icon: 'success' });
      })
      .catch((err) => {
        self.setData({ questionBusy: false });
        wx.showToast({ title: err.message || '提交失败', icon: 'none' });
      });
  },

  cancelQuestion() {
    const pending = store.sessionState.pendingQuestion;
    if (!pending) return;
    store.client.cancelQuestion(pending.rpcId, pending.sessionId).catch(() => {});
  },

  // ---------- 审批 ----------

  allowApproval() {
    this.respondApproval('allowed-once');
  },

  rejectApproval() {
    this.respondApproval('rejected');
  },

  respondApproval(outcome) {
    const pending = store.sessionState.pendingApproval;
    if (!pending || this.data.approvalBusy) return;
    const self = this;
    this.setData({ approvalBusy: true });
    store.client.respondToApproval(pending.rpcId, pending.sessionId, pending.approvalId, outcome)
      .catch((err) => {
        self.setData({ approvalBusy: false });
        wx.showToast({ title: err.message || '操作失败', icon: 'none' });
      });
  },

  // ---------- 输入面板 ----------

  onDraftInput(e) {
    const value = e.detail.value;
    this.setData({ draft: value, canSend: !!value.trim() || this.data.images.length > 0 });
  },

  chooseImage() {
    const self = this;
    wx.chooseMedia({
      count: 4,
      mediaType: ['image'],
      sizeType: ['compressed'],
      success(res) {
        const files = res.tempFiles.map((file) => ({
          id: util.uuid(),
          tempPath: file.tempFilePath,
          mediaType: 'image/jpeg',
          name: 'image.jpg'
        }));
        self.setData({
          images: self.data.images.concat(files),
          canSend: !!self.data.draft.trim() || self.data.images.length + files.length > 0
        });
      }
    });
  },

  removeImage(e) {
    const images = this.data.images.slice();
    images.splice(e.currentTarget.dataset.index, 1);
    this.setData({
      images: images,
      canSend: !!this.data.draft.trim() || images.length > 0
    });
  },

  send() {
    const text = this.data.draft.trim();
    const images = this.data.images;
    if (!text && !images.length) return;
    // 实验性：发送任务前申请订阅消息授权（一次性授权，每次发送都需申请）。
    if (notifyPref.enabled() && NOTIFY_TEMPLATE_ID) {
      wx.requestSubscribeMessage({ tmplIds: [NOTIFY_TEMPLATE_ID], fail: function () {} });
    }
    const s = store.sessionState;
    const self = this;
    const sendWithImages = images.length
      ? Promise.all(images.map(readImageBase64))
      : Promise.resolve([]);

    sendWithImages.then((encoded) => {
      store.client.sendMessage(
        text,
        s.sessionId,
        store.state.currentWorkspaceId,
        encoded,
        'queue'
      );
      self.setData({ draft: '', images: [], canSend: false });
      // 乐观回显用户消息
      wx.showToast({ title: '已发送', icon: 'none', duration: 600 });
    }).catch((err) => {
      wx.showToast({ title: err.message || '图片处理失败', icon: 'none' });
    });
  },

  stopAgent() {
    const s = store.sessionState;
    wx.showModal({
      title: '停止当前回合',
      content: '将取消 Agent 正在执行的回合。',
      success(res) {
        if (res.confirm) store.client.cancelSession(s.sessionId);
      }
    });
  },

  // ---------- 选择器 ----------

  pickPermission() {
    const s = store.sessionState;
    const options = (s.permissionOptions && s.permissionOptions.length)
      ? s.permissionOptions
      : [
          { value: 'read-only', name: '只读' },
          { value: 'workspace-write', name: '工作区写入' },
          { value: 'danger-full-access', name: '完全访问' }
        ];
    const self = this;
    wx.showActionSheet({
      itemList: options.map((o) => o.name || labels.permissionName(o.value)),
      success(res) {
        const picked = options[res.tapIndex];
        store.client.setPermission(s.sessionId, picked.value).catch((err) => {
          wx.showToast({ title: err.message || '设置失败', icon: 'none' });
        });
        self.setData({
          permissionLabel: picked.name || labels.permissionName(picked.value),
          permissionIcon: labels.permissionIconFile(picked.value)
        });
      }
    });
  },

  pickModel() {
    const catalog = store.state.modelCatalog;
    const flat = [];
    if (catalog && catalog.groups) {
      catalog.groups.forEach((group) => {
        (group.models || []).forEach((model) => {
          flat.push({
            provider: group.id,
            model: model.id,
            label: (group.name || group.id) + ' · ' + (model.name || model.id),
            reasoning: model.reasoning
          });
        });
      });
    }
    if (!flat.length) {
      store.client.requestModels(store.sessionState.sessionId).catch(() => {});
      wx.showToast({ title: '正在加载模型列表', icon: 'none' });
      return;
    }
    const self = this;
    wx.showActionSheet({
      itemList: flat.map((m) => m.label).slice(0, 6),
      success(res) {
        const picked = flat[res.tapIndex];
        const effort = picked.reasoning && picked.reasoning.defaultEffort;
        store.client.selectModel(store.sessionState.sessionId, picked.provider, picked.model, effort)
          .catch((err) => {
            wx.showToast({ title: err.message || '切换失败', icon: 'none' });
          });
        self.setData({ modelLabel: picked.model, effortLabel: effort ? labels.reasoningEffortName(effort) : self.data.effortLabel });
      }
    });
  },

  pickEffort() {
    const levels = ['low', 'medium', 'high'];
    const self = this;
    wx.showActionSheet({
      itemList: ['低', '中', '高'],
      success(res) {
        const level = levels[res.tapIndex];
        const s = store.sessionState;
        const selection = s.selection || store.state.defaultModel;
        if (!selection) return;
        store.client.selectModel(s.sessionId, selection.provider, selection.model, level)
          .catch((err) => {
            wx.showToast({ title: err.message || '设置失败', icon: 'none' });
          });
        self.setData({ effortLabel: labels.reasoningEffortName(level) });
      }
    });
  },

  // ---------- 轨迹详情 ----------

  openTraceDetail(e) {
    const item = this.data.trajectory[e.currentTarget.dataset.index];
    if (!item || item.kind !== 'event') return;
    this.setData({ traceDetail: item });
  },

  closeTraceDetail() {
    this.setData({ traceDetail: null });
  },

  copyTraceDetail() {
    if (!this.data.traceDetail) return;
    wx.setClipboardData({ data: this.data.traceDetail.detail || '' });
  },

  noop() {}
});

// ---------- 辅助 ----------

function numberWithCommas(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function isRunning(rows) {
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const row = rows[i];
    if (row.kind === 'assistant') return row.streaming === true;
    if (row.kind === 'user') return false;
  }
  return false;
}

/** 为问题选项补上本地选中态（不写回 store）。 */
function decorateQuestion(pending, draft) {
  if (!pending) return null;
  return {
    rpcId: pending.rpcId,
    sessionId: pending.sessionId,
    questions: (pending.questions || []).map((q) => ({
      id: q.id,
      header: q.header,
      question: q.question,
      detail: q.detail,
      options: (q.options || []).map((opt) => ({
        label: opt.label,
        description: opt.description
      })),
      multiSelect: q.multiSelect === true,
      allowsMultipleSelections: q.multiSelect === true,
      checked: draft[q.id] || {},
      hasOptions: !!(q.options && q.options.length)
    })),
    custom: {}
  };
}

/** 把本地临时图片读成 base64（协议 3 images.data 为标准 Base64）。 */
function readImageBase64(image) {
  return new Promise((resolve, reject) => {
    wx.getFileSystemManager().readFile({
      filePath: image.tempPath,
      encoding: 'base64',
      success(res) {
        resolve({ mediaType: image.mediaType, data: res.data, name: image.name });
      },
      fail(err) {
        reject(new Error(err.errMsg || '读取图片失败'));
      }
    });
  });
}
