const { t: uiText } = require('../../utils/ui-preferences');
const store = require('../../utils/store');
const labels = require('../../utils/labels');
const theme = require('../../utils/theme');
const { nodePresentation } = require('../../utils/node-presentation');
const { hostDisplay } = require('../../utils/host-info');
const { clientVersion } = require('../../utils/version-info');
const CONNECTION_LABELS = { disconnected: uiText('未连接'), connecting: uiText('连接中'), connected: uiText('已连接'), failed: uiText('连接失败') };

Page({
  manualShareMenu: true,
  data: { navPadTop: 50, navHeight: 32, presetLabel: uiText('标准模式'), modelLabel: '—', permissionLabel: uiText('工作区写入'), host: {}, hostInfo: { version: uiText('未提供'), provider: uiText('未提供'), model: uiText('未提供') }, buildLabel: '', utilitySheet: '', diagnostics: [], cacheClearing: false, cacheError: '', picker: '', pickerTitle: '', pickerOptions: [], sheetMaxH: 480, pickerListH: 348, presetId: 'standard', modelId: '', modelProvider: '', pendingModel: null, filesSheet: false, filesEntries: [], filesLoading: false, filesError: '', filesPathLabel: '', filesIsRoot: true },
  onUiLocaleChange() { this.syncFromStore({ app: store.state, session: store.sessionState }); },
  onLoad() {
    theme.applyTo(this);
    this.updateNavigationLayout();
    this.setData(clientVersion(wx));
    this.unsubscribe = store.subscribe(snapshot => this.syncFromStore(snapshot));
    this.syncFromStore({ app: store.state });
    if (store.state.connection === 'connected') {
      ['requestHost', 'requestDefaultModel', 'requestModels'].forEach(method => {
        if (typeof store.client[method] !== 'function') return;
        Promise.resolve(store.client[method](null)).catch(() => {});
      });
    }
  },
  updateNavigationLayout() {
    let info = {}, rect = null;
    try {
      info = (typeof wx.getWindowInfo === 'function' ? wx.getWindowInfo() : wx.getSystemInfoSync()) || {};
    } catch (e) { /* 胶囊位置可独立读取。 */ }
    try { rect = wx.getMenuButtonBoundingClientRect(); } catch (e) { /* 旧基础库按状态栏回退。 */ }
    const validRect = rect && Number.isFinite(rect.top) && rect.top > 0 && Number.isFinite(rect.height) && rect.height > 0;
    const statusBarHeight = Number.isFinite(info.statusBarHeight) && info.statusBarHeight >= 0 ? info.statusBarHeight : 44;
    const navPadTop = validRect ? rect.top : statusBarHeight + 6;
    const navHeight = validRect ? rect.height : 32;
    // 弹窗最高到「胶囊下沿」为止：可用高度 = 屏幕高 - 胶囊下沿 - 安全间距
    const windowHeight = Number.isFinite(info.windowHeight) && info.windowHeight > 0 ? info.windowHeight : 667;
    const capBottom = navPadTop + navHeight;
    const sheetMaxH = Math.max(240, Math.round(windowHeight - capBottom - 16));
    const pickerListH = Math.max(160, sheetMaxH - 132);   // 抓手+标题+底部安全区
    this.setData({ navPadTop, navHeight, sheetMaxH, pickerListH });
  },
  onResize() { this.updateNavigationLayout(); },
  goBack() {
    wx.navigateBack({ fail() { wx.reLaunch({ url: '/pages/home/home' }); } });
  },
  onUnload() { if (this.unsubscribe) this.unsubscribe(); },
  onHide() { this.setData({ utilitySheet: '', cacheError: '' }); },
  syncFromStore(snapshot) {
    const app = snapshot.app;
    const defaults = app.defaults || {};
    const model = app.defaultModel || {};
    const presetId = defaults.agentPresetDefault || 'standard';
    this.setData({
      presetId: presetId,
      modelId: model.model || '',
      modelProvider: model.provider || '',
      presetLabel: (app.agentPresets && findPresetName(app.agentPresets.presets, presetId)) || labels.presetModeName(presetId),
      modelLabel: model.model ? model.model + (model.reasoningEffort ? ' · ' + capitalize(model.reasoningEffort) : '') : '—',
      permissionLabel: labels.permissionName(defaults.permissionDefault || 'workspace-write') || defaults.permissionDefault || uiText('工作区写入'),
      host: app.host || {},
      hostInfo: hostDisplay(app)
    });
    if (this.data.utilitySheet === 'diagnostics') this.setData({ diagnostics: this.diagnosticRows(app) });
  },

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
    // 当前预设来自部署级 defaults（与页面顶部标签同源）
    const defaults = (store.state && store.state.defaults) || {};
    const current = this.data.presetId || defaults.agentPresetDefault || 'standard';
    this.openPickerSheet('preset', uiText('Agent 预设'), list.slice(0, 8).map((p) => ({
      id: p.id,
      label: p.name || labels.presetModeName(p.id),
      checked: p.id === current
    })));
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
          wx.showToast({ title: uiText('网关未提供模型目录'), icon: 'none' });
        }
      }).catch(() => {
        wx.showToast({ title: uiText('模型目录加载失败'), icon: 'none' });
      });
      return;
    }
    this.showModelSheet(flat);
  },

  showModelSheet(flat) {
    const defaults = (store.state && store.state.defaults) || {};
    const currentModel = this.data.modelId || defaults.model || '';
    const currentProvider = this.data.modelProvider || defaults.provider || '';
    let marked = false;
    // 按供应商分组：每组一个标题行，其后是该供应商的模型
    const groups = [];
    flat.forEach((m) => {
      let group = groups.find((g) => g.provider === m.provider);
      if (!group) {
        group = { provider: m.provider, title: capitalize(m.provider), models: [] };
        groups.push(group);
      }
      group.models.push(m);
    });
    const options = [];
    groups.forEach((group) => {
      options.push({ header: group.title || group.provider, key: 'h-' + group.provider });
      group.models.forEach((m) => {
        // 精确匹配「供应商 + 模型」，且只标记第一项，避免同名模型出现多个勾
        const providerMatch = currentProvider ? m.provider === currentProvider : true;
        const hit = !marked && providerMatch && m.model === currentModel;
        if (hit) marked = true;
        options.push({
          key: m.provider + '|' + m.model,
          id: m.provider + '|' + m.model + '|' + (m.defaultEffort || ''),
          label: m.label,
          checked: hit,
          provider: m.provider,
          model: m.model,
          efforts: m.efforts || [],
          defaultEffort: m.defaultEffort || ''
        });
      });
    });
    this.openPickerSheet('model', uiText('默认模型'), options);
  },

  pickDefaultPermission() {
    const values = ['read-only', 'workspace-write', 'danger-full-access'];
    const labelsText = [uiText('只读'), uiText('工作区写入'), uiText('完全访问')];
    const current = (store.state && store.state.defaults && store.state.defaults.permissionDefault) || '';
    this.openPickerSheet('permission', uiText('权限'), values.map((value, index) => ({
      id: value,
      label: labelsText[index],
      checked: value === current
    })));
  },

  /** 保存默认模型；若该模型支持思考强度，先让用户选择强度。 */
  applyModelSelection(provider, model, efforts, effort) {
    const currentEffort = (store.state && store.state.defaultModel && store.state.defaultModel.reasoningEffort) || '';
    if (efforts && efforts.length && !effort) {
      this.setData({
        pendingModel: { provider, model, efforts },
        picker: 'effort',
        pickerTitle: uiText('思考强度'),
        pickerOptions: efforts.map((item) => ({
          id: item.id,
          label: item.name || item.id,
          checked: item.id === currentEffort
        }))
      });
      return;
    }
    const chosen = effort || (efforts && efforts.length ? (efforts.find((item) => item.id === currentEffort) || {}).id || currentEffort : '');
    store.client.saveDefaultModel(provider, model, chosen || '')
      .then(() => { wx.showToast({ title: uiText('已保存'), icon: 'success' }); })
      .catch((err) => { wx.showToast({ title: err.message || uiText('保存失败'), icon: 'none' }); });
    this.setData({
      modelId: model,
      modelProvider: provider,
      modelLabel: model + (chosen ? ' · ' + capitalize(chosen) : ''),
      pendingModel: null
    });
  },

  // ---------- 通用选择弹窗（与设置页弹窗样式一致） ----------

  openPickerSheet(kind, title, options) {
    this.setData({ picker: kind, pickerTitle: title, pickerOptions: options || [] });
  },

  closePickerSheet() {
    this.setData({ picker: '', pickerTitle: '', pickerOptions: [] });
  },

  choosePicker(e) {
    const index = Number(e.currentTarget.dataset.index);
    const option = (this.data.pickerOptions || [])[index];
    const kind = this.data.picker;
    if (!option || option.header) return;   /* 分组标题不可点 */
    this.closePickerSheet();
    if (kind === 'preset') {
      // 先乐观更新标签，再写入部署级默认值
      this.setData({ presetId: option.id, presetLabel: option.label });
      store.client.setDefault('agent-preset', option.id).catch((err) => {
        wx.showToast({ title: err.message || uiText('设置失败'), icon: 'none' });
      });
      return;
    }
    if (kind === 'permission') {
      store.client.setDefault('permission', option.id).catch((err) => {
        wx.showToast({ title: err.message || uiText('设置失败'), icon: 'none' });
      });
      return;
    }
    if (kind === 'model') {
      this.applyModelSelection(option.provider, option.model, option.efforts || [], '');
      return;
    }
    if (kind === 'effort') {
      const pending = this.data.pendingModel || {};
      this.applyModelSelection(pending.provider, pending.model, pending.efforts || [], option.id);
    }
  },

  openPlugins() {
    wx.navigateTo({ url: '/pages/plugins/plugins' });
  },

  openFiles() {
    this._filesRel = null;
    this.setData({ filesSheet: true, filesEntries: [], filesLoading: true, filesError: '' });
    this.loadFiles(null);
  },

  closeFiles() {
    this.setData({ filesSheet: false, filesEntries: [], filesError: '', filesLoading: false });
  },

  /** 读取工作区目录（相对会话工作区根）。 */
  loadFiles(relPath) {
    const sessionId = (store.sessionState && store.sessionState.sessionId) || '';
    if (!sessionId) {
      this.setData({ filesLoading: false, filesError: uiText('请先打开一个会话'), filesEntries: [] });
      return;
    }
    if (store.state.connection !== 'connected') {
      this.setData({ filesLoading: false, filesError: uiText('请先连接驭鲸 Harness'), filesEntries: [] });
      return;
    }
    this._filesRel = relPath || null;
    this.setData({ filesLoading: true, filesError: '' });
    store.client.requestFileList(sessionId, relPath)
      .then((frame) => {
        if (!frame) return;
        const entries = (frame.entries || frame.items || []).map((item, index) => ({
          name: item.name || item.title || '',
          path: item.path || '',
          kind: item.kind === 'dir' || item.kind === 'directory' ? 'dir' : 'file',
          iconFile: fileIconFor(item),
          subLabel: describeFileEntry(item),
          key: (item.path || '') + '/' + index
        }));
        this._filesRel = frame.path || this._filesRel || null;
        const rel = this._filesRel;
        const isRoot = !rel || rel === '.' || rel === '/';
        this.setData({
          filesEntries: entries,
          filesIsRoot: isRoot,
          filesPathLabel: isRoot ? uiText('工作区根目录') : String(rel),
          filesLoading: false
        });
      })
      .catch((err) => {
        this.setData({ filesLoading: false, filesError: err.message || uiText('读取目录失败') });
      });
  },

  filesOpenEntry(e) {
    const index = Number(e.currentTarget.dataset.index);
    const item = (this.data.filesEntries || [])[index];
    if (!item) return;
    if (item.kind === 'dir') {
      this.loadFiles(item.path);
      return;
    }
    wx.showModal({ title: item.name, content: item.path, showCancel: false, confirmText: uiText('知道了') });
  },

  filesGoUp() {
    const rel = this._filesRel;
    if (!rel || rel === '.' || rel === '/') {
      this.loadFiles(null);
      return;
    }
    const idx = rel.lastIndexOf('/');
    this.loadFiles(idx > 0 ? rel.substring(0, idx) : null);
  },

  openSchedule() {
    wx.navigateTo({ url: '/pages/schedule/schedule' });
  },

  showDiagnostics() {
    this.setData({ utilitySheet: 'diagnostics', diagnostics: this.diagnosticRows(store.state || {}), cacheError: '' });
  },

  diagnosticRows(app) {
    const detail = nodePresentation((app.profiles || []).find(p => p.id === app.activeID), app);
    const frames = app.frameStats || {};
    const frameText = Object.keys(frames).length
      ? Object.keys(frames).map((k) => k + '×' + frames[k]).slice(0, 12).join('  ')
      : uiText('（暂无）');
    return [
      { label: uiText('连接状态'), value: CONNECTION_LABELS[app.connection] || uiText('未知') },
      { label: detail && detail.isPublic ? uiText('公网标识') : uiText('地址'), value: detail && detail.isPublic ? detail.identifier : app.endpoint || uiText('未配置'), mono: true },
      { label: uiText('网关'), value: detail ? detail.name : '—' },
      { label: uiText('帧统计'), value: frameText, mono: true }
    ];
  },

  clearLocalCache() {
    this.setData({ utilitySheet: 'cache', cacheError: '' });
  },

  closeUtilitySheet() {
    if (!this.data.cacheClearing) this.setData({ utilitySheet: '', cacheError: '' });
  },

  noop() {},

  confirmClearCache() {
    if (this.data.utilitySheet !== 'cache' || this.data.cacheClearing) return;
    this.setData({ cacheClearing: true, cacheError: '' });
    let removed = 0, failed = 0;
    try {
      const keys = wx.getStorageInfoSync().keys || [];
      keys.filter(key => key.indexOf('dsh_session_cache') === 0 || key.indexOf('dsh_home_cache') === 0).forEach(key => {
        try { wx.removeStorageSync(key); removed += 1; } catch (e) { failed += 1; }
      });
    } catch (e) {
      this.setData({ cacheClearing: false, cacheError: uiText('无法读取缓存，请稍后重试。') });
      return;
    }
    this.setData({ cacheClearing: false, ...(failed ? { cacheError: uiText('已清理 ') + removed + uiText(' 项，剩余 ') + failed + uiText(' 项未清理，请重试。') } : { utilitySheet: '' }) });
    if (!failed) wx.showToast({ title: removed ? uiText('已清理 ') + removed + uiText(' 项') : uiText('没有可清理的缓存'), icon: 'none' });
    if (removed && store.refreshHosts) store.refreshHosts();
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
        const reasoning = model.reasoning || null;
        flat.push({
          provider: group.id,
          model: model.id,
          label: (group.name || group.id) + ' · ' + (model.name || model.id),
          defaultEffort: reasoning && reasoning.defaultEffort,
          efforts: (reasoning && Array.isArray(reasoning.efforts)) ? reasoning.efforts : []
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

/* ---------- 工作区文件弹窗辅助（与 pages/files 保持一致） ---------- */
function fileIconFor(item) {
  if (item.kind === 'dir' || item.kind === 'directory') return 'folder-blue.png';   /* 与首页工作区卡片同款蓝色渐变文件夹 */
  const ext = String(item.name || '').split('.').pop().toLowerCase();
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'heic'].indexOf(ext) >= 0) return 'photo-ocean.png';
  if (['md', 'doc', 'docx', 'rtf', 'pages'].indexOf(ext) >= 0) return 'doc-richtext-ocean.png';
  if (['txt', 'log', 'json', 'yaml', 'yml', 'toml', 'xml', 'csv'].indexOf(ext) >= 0) return 'doc-text-ocean.png';
  if (['zip', 'tar', 'gz', '7z', 'rar', 'pkg', 'dmg'].indexOf(ext) >= 0) return 'box-ocean.png';
  return 'doc-ocean.png';
}

function describeFileEntry(item) {
  const parts = [];
  const isDir = item.kind === 'dir' || item.kind === 'directory';
  if (!isDir && item.bytes !== undefined && item.bytes !== null) parts.push(formatSize(item.bytes));
  if (item.modifiedAt) parts.push(formatFileDate(item.modifiedAt));
  return parts.join(' · ');
}

function formatSize(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1024 / 1024).toFixed(1) + ' MB';
}

function formatFileDate(epoch) {
  const ms = typeof epoch === 'string' ? parseInt(epoch, 10) : epoch;
  if (!ms || isNaN(ms)) return '';
  const d = new Date(ms * (ms < 1e12 ? 1000 : 1));
  const pad = (n) => (n < 10 ? '0' + n : '' + n);
  return d.getFullYear() + '/' + pad(d.getMonth() + 1) + '/' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}
