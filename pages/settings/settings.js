const store = require('../../utils/store');
const labels = require('../../utils/labels');
const notifyPref = require('../../utils/notify-pref');
const theme = require('../../utils/theme');

// 订阅消息模板 ID：在小程序管理后台申请「任务完成提醒」类模板后填入。
// 留空时开启开关仅保存偏好，不发起授权请求。
const NOTIFY_TEMPLATE_ID = 'QvgkQ88HKFdTNPJVOp0EdOHNDodOQACzB9oDEFDZXKU';

const CONNECTION_LABELS = {
  disconnected: '未连接',
  connecting: '连接中',
  connected: '已连接',
  failed: '连接失败'
};

Page({
  data: {
    buildLabel: '',          // 构建时间标记：用于确认手机上运行的是最新预览包
    appearanceLabel: '跟随微信',
    presetLabel: '标准模式',
    modelLabel: '—',
    permissionLabel: '工作区写入',
    endpoint: '',
    connectionLabel: '未连接',
    connectionClass: 'disconnected',
    port: null,
    host: {},
    nodes: [],
    nodeCount: 0,
    onlineNodeCount: 0,
    pairSheetOpen: false,
    pairingText: '',
    pairingError: '',
    pairingConnecting: false,
    notifyEnabled: false
  },

  onLoad() {
    theme.applyTo(this);
    this.setData({
      appearanceLabel: this.appearanceLabelOf(theme.getMode()),
      notifyEnabled: notifyPref.enabled(),
      buildLabel: '构建 ' + require('utils/build.js').BUILD_TIME
    });
    this.unsubscribe = store.subscribe((snapshot) => {
      this.syncFromStore(snapshot);
    });
    this.syncFromStore({ app: store.state, session: store.sessionState });
    store.refreshHostPresence();
    if (store.state.connection === 'connected') {
      store.client.requestHost();
    }
  },

  // ---------- 外观模式 ----------

  pickAppearance() {
    const modes = [
      { mode: 'auto', label: '跟随微信' },
      { mode: 'light', label: '浅色' },
      { mode: 'dark', label: '深色' }
    ];
    const current = theme.getMode();
    wx.showActionSheet({
      itemList: modes.map((m) => (m.mode === current ? '✓ ' : '') + m.label),
      success: (res) => {
        const picked = modes[res.tapIndex];
        if (!picked || picked.mode === current) return;
        theme.setMode(picked.mode);
        this.setData({ appearanceLabel: this.appearanceLabelOf(theme.getMode()) });
      }
    });
  },

  appearanceLabelOf(mode) {
    return mode === 'light' ? '浅色' : mode === 'dark' ? '深色' : '跟随微信';
  },

  onUnload() {
    if (this.unsubscribe) this.unsubscribe();
  },

  // ---------- 实验性功能 ----------

  toggleNotify(e) {
    const enabled = !!e.detail.value;
    const self = this;
    if (!enabled) {
      notifyPref.setEnabled(false);
      this.setData({ notifyEnabled: false });
      return;
    }
    if (!NOTIFY_TEMPLATE_ID) {
      notifyPref.setEnabled(true);
      this.setData({ notifyEnabled: true });
      wx.showModal({
        title: '待配置模板',
        content: '尚未配置订阅消息模板 ID（pages/settings/settings.js 中的 NOTIFY_TEMPLATE_ID）。已先记住偏好，配置后发送任务时会自动申请授权。',
        showCancel: false
      });
      return;
    }
    wx.requestSubscribeMessage({
      tmplIds: [NOTIFY_TEMPLATE_ID],
      complete() {
        // 无论用户允许/拒绝，都记住开关状态；下次发送任务时会再次申请。
        notifyPref.setEnabled(true);
        self.setData({ notifyEnabled: true });
      }
    });
  },

  syncFromStore(snapshot) {
    const app = snapshot.app;
    const defaults = app.defaults || {};
    const defaultModel = app.defaultModel || {};
    const presetId = defaults.agentPresetDefault || 'standard';
    const modelLabel = defaultModel.model
      ? (defaultModel.model + (defaultModel.reasoningEffort ? ' · ' + capitalize(defaultModel.reasoningEffort) : ''))
      : '—';
    const onlineIDs = app.onlineIDs || [];
    const nodes = (app.profiles || []).map((profile) => {
      const online = onlineIDs.indexOf(profile.id) >= 0 ||
        (profile.id === app.activeID && app.connection === 'connected');
      return {
        id: profile.id,
        gatewayId: profile.gatewayId || '',
        name: profile.alias || profile.gatewayName || '未命名节点',
        online: online,
        statusLabel: online ? '在线' : '离线',
        active: profile.id === app.activeID
      };
    });

    if (this._pairingAttemptActive && app.connection === 'connected') {
      this._pairingAttemptActive = false;
      this.setData({ pairSheetOpen: false, pairingConnecting: false, pairingText: '', pairingError: '' });
      wx.showToast({ title: '节点已连接', icon: 'success' });
    } else if (this._pairingAttemptActive && app.connection === 'failed') {
      this._pairingAttemptActive = false;
      this.setData({
        pairingConnecting: false,
        pairingError: app.connectionMessage || '连接失败，请检查配对信息'
      });
    }

    this.setData({
      presetLabel: (app.agentPresets && findPresetName(app.agentPresets.presets, presetId)) || labels.presetModeName(presetId),
      modelLabel: modelLabel,
      permissionLabel: labels.permissionName(defaults.permissionDefault || 'workspace-write') || (defaults.permissionDefault || '工作区写入'),
      endpoint: app.endpoint || '',
      connectionLabel: CONNECTION_LABELS[app.connection] || app.connection,
      connectionClass: app.connection,
      port: app.port,
      host: app.host || {},
      nodes: nodes,
      nodeCount: nodes.length,
      onlineNodeCount: nodes.filter((node) => node.online).length
    });
  },

  // ---------- 新会话默认配置 ----------

  pickAgentPreset() {
    const catalog = store.state.agentPresets;
    const presets = (catalog && catalog.presets) || [];
    const list = presets.length
      ? presets
      : [
          { id: 'standard' },
          { id: 'code' },
          { id: 'minimal' },
          { id: 'cordis' }
        ];
    wx.showActionSheet({
      itemList: list.map((p) => p.name || labels.presetModeName(p.id)).slice(0, 6),
      success(res) {
        const picked = list[res.tapIndex];
        store.client.setDefault('agent-preset', picked.id).catch((err) => {
          wx.showToast({ title: err.message || '设置失败', icon: 'none' });
        });
      }
    });
  },

  pickDefaultModel() {
    const self = this;
    const catalog = store.state.modelCatalog;
    const flat = flattenModels(catalog);
    if (!flat.length) {
      store.client.requestModels(null).then(() => {
        const refreshed = flattenModels(store.state.modelCatalog);
        if (refreshed.length) {
          self.showModelSheet(refreshed);
        } else {
          wx.showToast({ title: '网关未提供模型目录', icon: 'none' });
        }
      }).catch(() => {
        wx.showToast({ title: '模型目录加载失败', icon: 'none' });
      });
      return;
    }
    this.showModelSheet(flat);
  },

  showModelSheet(flat) {
    const self = this;
    wx.showActionSheet({
      itemList: flat.map((m) => m.label).slice(0, 6),
      success(res) {
        const picked = flat[res.tapIndex];
        store.client.saveDefaultModel(picked.provider, picked.model, picked.defaultEffort)
          .then(() => {
            wx.showToast({ title: '已保存', icon: 'success' });
          })
          .catch((err) => {
            wx.showToast({ title: err.message || '保存失败', icon: 'none' });
          });
        self.setData({ modelLabel: picked.model });
      }
    });
  },

  pickDefaultPermission() {
    wx.showActionSheet({
      itemList: ['只读', '工作区写入', '完全访问'],
      success(res) {
        const values = ['read-only', 'workspace-write', 'danger-full-access'];
        store.client.setDefault('permission', values[res.tapIndex]).catch((err) => {
          wx.showToast({ title: err.message || '设置失败', icon: 'none' });
        });
      }
    });
  },

  // ---------- Mobile Gateway ----------

  disconnect() {
    wx.showModal({
      title: '断开连接',
      content: '将断开与 Mobile Gateway 的连接。',
      success(res) {
        if (res.confirm) store.client.disconnect();
      }
    });
  },

  pingGateway() {
    const started = Date.now();
    store.client.ping()
      .then(() => {
        wx.showToast({ title: '往返 ' + (Date.now() - started) + 'ms', icon: 'none' });
      })
      .catch((err) => {
        wx.showToast({ title: err.message || 'Ping 失败', icon: 'none' });
      });
  },

  forgetDevice() {
    wx.showModal({
      title: '忘记此设备',
      content: '将删除本机保存的配对凭据，需要重新扫码配对。',
      confirmColor: '#E5484D',
      success(res) {
        if (res.confirm) {
          store.forgetDevice();
          wx.reLaunch({ url: '/pages/home/home' });
        }
      }
    });
  },

  // ---------- 公网节点 ----------

  refreshNodes() {
    store.refreshHostPresence();
  },

  selectNode(e) {
    const id = e.currentTarget.dataset.id;
    if (!id || id === store.state.activeID) return;
    store.selectHost(id);
  },

  copyNodeId(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    wx.setClipboardData({ data: id });
  },

  addPublicNode() {
    wx.showActionSheet({
      itemList: ['扫描配对二维码', '输入配对信息'],
      success: (res) => {
        if (res.tapIndex === 0) this.scanPublicNode();
        if (res.tapIndex === 1) this.openPairSheet();
      }
    });
  },

  scanPublicNode() {
    wx.scanCode({
      onlyFromCamera: true,
      success: (res) => {
        const result = store.pairWithPayload(res.result);
        if (result.ok) {
          this._pairingAttemptActive = true;
          wx.showToast({ title: '连接中…', icon: 'none' });
        } else {
          wx.showToast({ title: result.error || '配对失败', icon: 'none' });
        }
      },
      fail: (err) => {
        const message = err && err.errMsg ? err.errMsg : '';
        if (message.indexOf('permission') >= 0 || message.indexOf('auth') >= 0) {
          wx.showToast({ title: '需要摄像头权限，请在设置中开启', icon: 'none' });
        } else if (message.indexOf('cancel') < 0) {
          wx.showToast({ title: '扫码失败：' + message, icon: 'none' });
        }
      }
    });
  },

  openPairSheet() {
    this.setData({ pairSheetOpen: true, pairingText: '', pairingError: '', pairingConnecting: false });
  },

  closePairSheet() {
    if (this.data.pairingConnecting) return;
    this.setData({ pairSheetOpen: false, pairingText: '', pairingError: '' });
  },

  noop() {},

  onPairingInput(e) {
    this.setData({ pairingText: e.detail.value, pairingError: '' });
  },

  connectPublicNode() {
    const raw = String(this.data.pairingText || '').trim();
    if (!raw || this.data.pairingConnecting) return;
    const result = store.pairWithPayload(raw);
    if (!result.ok) {
      this.setData({ pairingError: result.error || '配对信息无效' });
      return;
    }
    this._pairingAttemptActive = true;
    this.setData({ pairingConnecting: true, pairingError: '正在连接…' });
  },

  openFiles() {
    wx.navigateTo({ url: '/pages/files/files' });
  },

  /** 隐私政策（对齐 dsh-mobile SettingsView 关于 → 隐私政策）。 */
  openPrivacyPolicy() {
    wx.navigateTo({ url: '/pages/privacy/privacy' });
  }
});

function findPresetName(presets, id) {
  const found = (presets || []).find((p) => p.id === id);
  return found ? (found.name || labels.presetModeName(id)) : null;
}

function flattenModels(catalog) {
  const flat = [];
  if (catalog && catalog.groups) {
    catalog.groups.forEach((group) => {
      (group.models || []).forEach((model) => {
        flat.push({
          provider: group.id,
          model: model.id,
          label: (group.name || group.id) + ' · ' + (model.name || model.id),
          defaultEffort: model.reasoning && model.reasoning.defaultEffort
        });
      });
    });
  }
  return flat;
}

function capitalize(text) {
  if (!text) return '';
  return text.charAt(0).toUpperCase() + text.slice(1);
}
