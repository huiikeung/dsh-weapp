const { t: uiText } = require('../../utils/ui-preferences');
const preferences = require('../../utils/ui-preferences');
const workSteps = require('../../utils/work-step-presentation');
const statusAppearance = require('../../utils/status-appearance');
const store = require('../../utils/store');
const notifyPref = require('../../utils/notify-pref');
const theme = require('../../utils/theme');
const accessApi = require('../../utils/access-api');
const { getPublicAccessState } = require('../../utils/public-access-state');
const { nodePresentation } = require('../../utils/node-presentation');
const { clientVersion, gatewayVersionInfo } = require('../../utils/version-info');

// 订阅消息模板 ID：在小程序管理后台申请「任务完成提醒」类模板后填入。
// 留空时开启开关仅保存偏好，不发起授权请求。
const NOTIFY_TEMPLATE_ID = 'QvgkQ88HKFdTNPJVOp0EdOHNDodOQACzB9oDEFDZXKU';

const CONNECTION_LABELS = {
  disconnected: uiText('未连接'),
  connecting: uiText('连接中'),
  connected: uiText('已连接'),
  failed: uiText('连接失败')
};

Page({
  manualShareMenu: true,
  data: {
    navPadTop: 50,
    workStepMenu: '',
    workStepModes: workSteps.MODES,
    workStepTimings: workSteps.TIMINGS,
    ...workSteps.view(),
    statusStyleSheetOpen: false,
    statusStyleChoices: statusAppearance.choices(),
    navHeight: 32,
    referralEnabled: false, contentLoaded: false, contentError: '', shareSaving: false,
    accountDeviceId: '', accountIdHint: '', referralSheetOpen: false, referralBusy: false, referralError: '', referralToken: '', referralDays: 0, referralHint: '',
    adminAdvancedOpen: false,
    privacyOpen: false,
    buildLabel: '',
    appVersion: '',
    minGatewayVersion: uiText('小程序网关 ≥ 0.8.6'),
    connectedGatewayVersion: uiText('未连接'),
    languageLabel: uiText('跟随系统'), preferenceMenu: '', fontSettingsExpanded: false, contentFontSize: 14,
    fontSizeLabel: '14 px',          // 构建时间标记：用于确认手机上运行的是最新预览包
    appearanceLabel: uiText('跟随微信'),
    endpoint: '',
    connectionLabel: uiText('未连接'),
    connectionClass: 'disconnected',
    port: null,
    host: {},
    nodes: [],
    nodeDetailId: '',
    nodeDetail: null,
    nodePingBusy: false,
    nodeEditMode: false,
    nodeSelection: [],
    nodeCount: 0,
    activeNodeName: '',
    onlineNodeCount: 0,
    managementPanel: '',
    pairSheetOpen: false,
    pairingText: '',
    pairingError: '',
    pairingConnecting: false,
    publicOn: false,
    publicStatusLabel: uiText('未开通'),
    publicId: '',
    publicExpiryLabel: '',
    publicTitle: uiText('尚未建立公网身份'),
    publicSub: uiText('添加 Agent 节点后自动建立'),
    publicHint: uiText('公网身份由节点 ID 标识；分享后对方凭一次性邀请连接，到期自动失效。'),
    isRelayOwner: false,
    redeemBusy: false,
    redeemResultLabel: '',
    shareEnabled: false,
    sharePayload: '',
    shareExpiresLabel: '',
    notifyEnabled: false,
    accountBusy: false,
    isWechatAdmin: false,
    accountLabel: uiText('识别中…'),
    accountHint: uiText('自动识别当前微信身份，无需手动切换'),
    shareReason: '',
    redeemAvailable: false
  },

  onLoad(options) {
    theme.applyTo(this);
    this.setData(workSteps.view(workSteps.read()));
    this.setData(statusAppearance.view(statusAppearance.read()));
    this.updateNavigationLayout();
    this.setData({
      appearanceLabel: preferences.t(this.appearanceLabelOf(theme.getMode())),
      notifyEnabled: notifyPref.enabled(),
      ...clientVersion(wx)
    });
    this.unsubscribe = store.subscribe((snapshot) => {
      this.syncFromStore(snapshot);
    });
    this.syncFromStore({ app: store.state, session: store.sessionState });
    store.refreshHostPresence();
    if (options && options.pair) {
      const result = store.pairWithPayload(options.pair);
      if (result.ok) {
        this._pairingAttemptActive = true;
        wx.showToast({ title: uiText('正在连接分享节点…'), icon: 'none' });
      } else {
        wx.showModal({ title: uiText('分享链接无效'), content: result.error || uiText('请让所有者重新生成邀请。'), showCancel: false });
      }
    }
    if (store.state.connection === 'connected') {
      store.client.requestHost();
    }
  },

  updateNavigationLayout() {
    let info = {};
    let rect = null;
    try {
      info = (typeof wx.getWindowInfo === 'function' ? wx.getWindowInfo() : wx.getSystemInfoSync()) || {};
    } catch (e) { /* 胶囊 API 可独立提供正确位置。 */ }
    try {
      rect = wx.getMenuButtonBoundingClientRect();
    } catch (e) { /* 旧基础库或异常设备按状态栏高度回退。 */ }
    const validRect = rect && Number.isFinite(rect.top) && rect.top > 0 &&
      Number.isFinite(rect.height) && rect.height > 0;
    const statusBarHeight = Number.isFinite(info.statusBarHeight) && info.statusBarHeight >= 0
      ? info.statusBarHeight : 44;
    // nav 为 content-box：顶部留白只计算一次，内容中心与胶囊中心相同。
    this.setData({
      navPadTop: validRect ? rect.top : statusBarHeight + 6,
      navHeight: validRect ? rect.height : 32
    });
  },

  onResize() {
    this.updateNavigationLayout();
  },

  // ---------- 外观模式 ----------

  toggleWorkStepMenu(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ workStepMenu: this.data.workStepMenu === field ? '' : field });
  },
  closeWorkStepMenu() { this.setData({ workStepMenu: '' }); },
  chooseWorkStep(e) {
    const { field, id } = e.currentTarget.dataset;
    if (!['mode','timing'].includes(field)) return;
    try {
      const value = workSteps.save({ ...workSteps.read(), [field]: id });
      this.setData({ ...workSteps.view(value), workStepMenu: '' });
    } catch (_) { wx.showToast({ title: uiText('保存失败，请重试'), icon: 'none' }); }
  },
  openStatusStyles() { this.setData({ statusStyleSheetOpen: true, ...statusAppearance.view(statusAppearance.read()) }); },
  closeStatusStyles() { this.setData({ statusStyleSheetOpen: false }); },
  chooseStatusStyle(event) {
    try {
      const id = statusAppearance.save(event.currentTarget.dataset.id);
      this.setData(statusAppearance.view(id));
    } catch (_) { wx.showToast({ title: uiText('保存失败，请重试'), icon: 'none' }); }
  },

  pickAppearance() {
    const modes = [
      { mode: 'auto', label: uiText('跟随微信') },
      { mode: 'light', label: uiText('浅色') },
      { mode: 'dark', label: uiText('深色') }
    ];
    const current = theme.getMode();
    wx.showActionSheet({
      itemList: modes.map((m) => (m.mode === current ? '✓ ' : '') + preferences.t(m.label)),
      success: (res) => {
        const picked = modes[res.tapIndex];
        if (!picked || picked.mode === current) return;
        theme.setMode(picked.mode);
        this.setData({ appearanceLabel: preferences.t(this.appearanceLabelOf(theme.getMode())) });
      }
    });
  },

  appearanceLabelOf(mode) {
    return mode === 'light' ? uiText('浅色') : mode === 'dark' ? uiText('深色') : uiText('跟随微信');
  },

  onShow() {
    this.onUiPreferencesChange();
    this.setData(workSteps.view(workSteps.read()));
    this.setData(statusAppearance.view(statusAppearance.read()));
    return Promise.all([this.refreshWechatAccount(), this.refreshAppContent()]);
  },

  onHide() {
    this.setData({ preferenceMenu: '' });
    this.setData({ workStepMenu: '' });
    this._nodePingGeneration = (this._nodePingGeneration || 0) + 1;
    this.setData({ nodePingBusy: false });
    this._contentGeneration = (this._contentGeneration || 0) + 1;
    this.setData({ referralEnabled: false, contentLoaded: false, shareSaving: false, referralToken: '' });
    this._accountGeneration = (this._accountGeneration || 0) + 1;
    this._publicAccount = null;
    this.setData({ accountBusy: false, redeemBusy: false, isWechatAdmin: false, adminAdvancedOpen: false, accountLabel: uiText('识别中…'), referralSheetOpen: false, referralBusy: false, accountDeviceId: '' });
  },

  onUnload() {
    this._nodePingGeneration = (this._nodePingGeneration || 0) + 1;
    this._contentGeneration = (this._contentGeneration || 0) + 1;
    this._accountGeneration = (this._accountGeneration || 0) + 1;
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
        title: uiText('待配置模板'),
        content: uiText('尚未配置订阅消息模板 ID（pages/settings/settings.js 中的 NOTIFY_TEMPLATE_ID）。已先记住偏好，配置后发送任务时会自动申请授权。'),
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
    const onlineIDs = app.onlineIDs || [];
    const nodes = (app.profiles || []).map((profile) => {
      const online = onlineIDs.indexOf(profile.id) >= 0 ||
        (profile.id === app.activeID && app.connection === 'connected');
      return {
        id: profile.id,
        gatewayId: profile.gatewayId || '',
        name: nodePresentation(profile, app).name,
        online: online,
        statusLabel: online
          ? (profile.relay && profile.relayClientCount ? profile.relayClientCount + uiText(' 台设备') : uiText('在线'))
          : uiText('离线'),
        active: profile.id === app.activeID,
        selected: (this.data.nodeSelection || []).indexOf(profile.id) >= 0
      };
    });
    const activeProfile = (app.profiles || []).find((profile) => profile.id === app.activeID);
    const detailProfile = (app.profiles || []).find((profile) => profile.id === this.data.nodeDetailId);
    const nodeDetail = nodePresentation(detailProfile, app);
    this.setData({ nodeDetail });
    if (this.data.nodeDetailId && !nodeDetail) {
      this.setData({ nodeDetailId: '', nodePingBusy: false, managementPanel: this.data.managementPanel === 'gateway' ? 'nodes' : this.data.managementPanel });
    }
    const publicState = getPublicAccessState(activeProfile, app.connection);
    const relayOwner = publicState.isRelayOwner;
    const nodeId = activeProfile ? (activeProfile.gatewayId || activeProfile.id || '') : '';
    const { expiresAt, authorized, publicOn, publicStatusLabel, publicTitle } = publicState;
    const publicSub = activeProfile
      ? (activeProfile.alias || activeProfile.gatewayName || uiText('当前节点'))
      : uiText('请先在节点管理中配对设备');
    const publicHint = publicState.publicHint;
    const shareEnabled = publicState.shareEnabled;
    const profileId = activeProfile ? activeProfile.id : null;
    if (this._shareProfileId !== profileId || !shareEnabled) {
      this.setData({ sharePayload: '', shareExpiresLabel: '' });
    }
    this._shareProfileId = profileId;

    if (this._pairingAttemptActive && app.connection === 'connected') {
      this._pairingAttemptActive = false;
      this.setData({ pairSheetOpen: false, pairingConnecting: false, pairingText: '', pairingError: '' });
      wx.showToast({ title: uiText('节点已连接'), icon: 'success' });
    } else if (this._pairingAttemptActive && app.connection === 'failed') {
      this._pairingAttemptActive = false;
      this.setData({
        pairingConnecting: false,
        pairingError: app.connectionMessage || uiText('连接失败，请检查配对信息')
      });
    }

    this.setData({
      endpoint: app.endpoint || '',
      connectionLabel: CONNECTION_LABELS[app.connection] || app.connection,
      connectionClass: app.connection,
      port: app.port,
      host: app.host || {},
      nodes: nodes,
      nodeCount: nodes.length,
      activeNodeName: ((nodes.find((node) => node.active) || {}).name) ||
        (app.connection === 'connected' && app.gatewayName ? app.gatewayName : ''),
      onlineNodeCount: nodes.filter((node) => node.online).length,
      ...gatewayVersionInfo(app),
      shareEnabled: shareEnabled,
      shareReason: publicState.shareReason,
      redeemAvailable: accessApi.configured(),
      isRelayOwner: relayOwner,
      publicOn: publicOn,
      publicStatusLabel: publicStatusLabel,
      publicId: activeProfile && activeProfile.relay ? nodeId : '',
      publicExpiryLabel: expiresAt ? formatExpiry(expiresAt) : authorized ? (publicState.gatewayMode ? uiText('以网关设备授权为准') : uiText('未设置到期时间')) : '',
      publicTitle: publicTitle,
      publicSub: publicSub,
      publicHint: publicHint
    });
    // Subscription belongs to WeChat, never to the selected LAN/DSH device.
    if (accessApi.configured()) {
      const account = this._publicAccount;
      const expiry = Number(account && account.publicAccessExpiresAt) || 0;
      const active = !!(account && account.publicAccess === true && (account.isAdmin === true || expiry > Date.now()));
      this.setData({
        publicOn: active,
        publicStatusLabel: !account ? uiText('待验证') : active ? uiText('已开通') : expiry ? uiText('已到期') : uiText('未开通'),
        publicTitle: active ? uiText('公网服务可用') : expiry ? uiText('公网服务已到期') : uiText('兑换开通公网服务'),
        publicExpiryLabel: account && account.isAdmin && active ? uiText('管理员权限') : expiry ? formatExpiry(expiry) : '',
        publicSub: uiText('仅控制鲸尾公网中继，局域网直连不受影响'),
        publicHint: uiText('兑换码开通当前微信账号的公网有效期；设备仍需扫描自己 DSH 插件的二维码配对。无需把电脑添加到后台或填写连接器 JSON。'),
        shareEnabled: active && shareEnabled,
        shareReason: active ? publicState.shareReason : uiText('请先兑换开通公网服务。分享设备邀请不会赠送公网有效期。')
      });
    }
  },

  // ---------- 网关连接 ----------

  disconnect() {
    const id = this.data.nodeDetailId;
    const detail = this.currentNodeDetail();
    if (!detail || !detail.canDisconnect) return;
    wx.showModal({
      title: uiText('断开连接'),
      content: uiText('将断开「') + detail.name + uiText('」的网关连接。'),
      success(res) {
        if (res.confirm && store.state.activeID === id && (store.state.profiles || []).some(p => p.id === id)) store.client.disconnect();
      }
    });
  },

  pingGateway() {
    const detail = this.currentNodeDetail();
    if (!detail || !detail.canPing || this.data.nodePingBusy) return;
    const generation = this._nodePingGeneration = (this._nodePingGeneration || 0) + 1;
    const id = detail.id;
    const isCurrent = () => generation === this._nodePingGeneration && this.data.nodeDetailId === id && store.state.activeID === id;
    const started = Date.now();
    this.setData({ nodePingBusy: true });
    store.client.ping()
      .then(() => {
        if (!isCurrent()) return;
        wx.showToast({ title: uiText('往返 ') + (Date.now() - started) + 'ms', icon: 'none' });
      })
      .catch((err) => {
        if (!isCurrent()) return;
        wx.showToast({ title: detail.isPublic ? uiText('Ping 失败，请检查节点连接') : err.message || uiText('Ping 失败'), icon: 'none' });
      })
      .finally(() => { if (generation === this._nodePingGeneration) this.setData({ nodePingBusy: false }); });
  },

  forgetDevice() {
    const detail = this.currentNodeDetail();
    if (!detail) return;
    const id = detail.id;
    wx.showModal({
      title: uiText('忘记此设备'),
      content: uiText('将删除「') + detail.name + uiText('」在本机保存的配对凭据，需要重新扫码配对。'),
      confirmColor: '#E5484D',
      success: (res) => {
        if (res.confirm) {
          store.removeHosts([id]);
          this.syncFromStore({ app: store.state });
        }
      }
    });
  },

  gatewayVersionText(app) {
    return gatewayVersionInfo(app).connectedGatewayVersion;
  },

  goBack() {
    wx.navigateBack({
      fail() { wx.reLaunch({ url: '/pages/home/home' }); }
    });
  },

  readAppVersion() {
    return clientVersion(wx).appVersion;
  },

  readLanguageLabel() { return preferences.snapshot().languageLabel; },
  readFontLabel() { return preferences.snapshot().fontSizeLabel; },
  onUiLocaleChange() { this.syncFromStore({ app: store.state }); },
  onUiPreferencesChange() {
    this.setData({ ...preferences.snapshot(), ...workSteps.view(workSteps.read()), ...statusAppearance.view(statusAppearance.read()),
      workStepModes: workSteps.MODES.map(item => ({ ...item, label: uiText(item.label) })), workStepTimings: workSteps.TIMINGS.map(item => ({ ...item, label: uiText(item.label) })), statusStyleChoices: statusAppearance.choices(), appearanceLabel: preferences.t(this.appearanceLabelOf(theme.getMode())),
      languageOptions: [{ id: 'system', label: preferences.t('跟随系统') }, { id: 'zh', label: '简体中文' }, { id: 'en', label: 'English' }] });
  },
  pickLanguage() { this.setData({ preferenceMenu: this.data.preferenceMenu === 'language' ? '' : 'language' }); },
  chooseLanguage(e) {
    try { preferences.setLanguage(e.currentTarget.dataset.id); this.onUiPreferencesChange(); this.setData({ preferenceMenu: '' }); }
    catch (_) { wx.showToast({ title: preferences.t('保存失败，请重试'), icon: 'none' }); }
  },
  changeFontSize(e) {
    const delta = Number(e.currentTarget.dataset.delta);
    const role = e.currentTarget.dataset.role || 'text', spec = preferences.FONTS[role];
    if (!spec || ![1, -1].includes(delta)) return;
    this.saveFontSize(Math.max(spec.min, Math.min(spec.max, preferences.fontSize(role) + delta)), role);
  },
  toggleFontSettings() { this.setData({ fontSettingsExpanded: !this.data.fontSettingsExpanded }); },
  commitFontSize(e) {
    const role = e.currentTarget.dataset.role || 'text', spec = preferences.FONTS[role];
    if (!spec) return;
    const input = String(e.detail.value).trim(), value = Number(input);
    if (!input || !Number.isFinite(value)) { this.onUiPreferencesChange(); return; }
    this.saveFontSize(Math.max(spec.min, Math.min(spec.max, Math.round(value))), role);
  },
  commitFontFamily(e) {
    try { preferences.setFontFamily(e.currentTarget.dataset.role, e.detail.value); this.onUiPreferencesChange(); }
    catch (_) { this.onUiPreferencesChange(); wx.showToast({ title: preferences.t('字体名称格式无效'), icon: 'none' }); }
  },
  resetFontSize(e) { const role = e && e.currentTarget && e.currentTarget.dataset.role || 'text'; if (preferences.FONTS[role]) this.saveFontSize(preferences.FONTS[role].default, role); },
  saveFontSize(value, role = 'text') {
    try { preferences.setFontSize(value, role); this.onUiPreferencesChange(); }
    catch (_) { wx.showToast({ title: preferences.t('保存失败，请重试'), icon: 'none' }); }
  },

  // ---------- 公网访问 / 节点管理（独立入口） ----------

  refreshWechatAccount() {
    if (this.data.accountBusy) return;
    const generation = this._accountGeneration = (this._accountGeneration || 0) + 1;
    if (!accessApi.configured()) {
      this.setData({ accountBusy: false, isWechatAdmin: false, accountLabel: uiText('待识别'),
        accountHint: uiText('身份服务待配置，管理员入口暂未启用') });
      return Promise.resolve();
    }
    this.setData({ accountBusy: true, isWechatAdmin: false, accountDeviceId: '', accountLabel: uiText('识别中…'),
      accountHint: uiText('自动匹配服务端绑定的管理员微信身份') });
    this._publicAccount = null;
    this.syncFromStore({ app: store.state });
    return accessApi.ensureAccount({ freshLogin: true }).then(account => {
      if (generation !== this._accountGeneration) return;
      if (!account || typeof account.isAdmin !== 'boolean') throw new Error(uiText('身份服务响应无效'));
      const admin = account && account.isAdmin === true;
      this._publicAccount = account;
      this.syncFromStore({ app: store.state });
      this.setData({ isWechatAdmin: admin, accountDeviceId: account.deviceId || '', accountLabel: admin ? uiText('管理员') : uiText('普通用户'),
        accountHint: admin ? uiText('已匹配服务端绑定的管理员微信身份') : uiText('已自动识别当前微信账号'),
        accountIdHint: account.deviceId ? '' : uiText('后台尚未支持设备 ID，请升级后台') });
    }).catch((error) => {
      if (generation !== this._accountGeneration) return;
      this._publicAccount = null;
      this.syncFromStore({ app: store.state });
      this.setData({ isWechatAdmin: false, accountLabel: uiText('待识别'),
        accountHint: error.message || uiText('暂时无法确认身份，重新进入页面将自动重试') });
    }).finally(() => { if (generation === this._accountGeneration) this.setData({ accountBusy: false }); });
  },

  openCodeManagement() {
    if (!this.data.isWechatAdmin || this.data.accountBusy) return;
    wx.navigateTo({ url: '/pages/redeem-admin/redeem-admin' });
  },

  openAnnouncements() { wx.navigateTo({ url: '/pages/announcements/announcements' }); },
  openAnnouncementManagement() {
    if (this.data.isWechatAdmin && !this.data.accountBusy) wx.navigateTo({ url: '/pages/announcement-admin/announcement-admin' });
  },
  onContactError() {
    wx.showModal({ title: uiText('客服暂未接通'), content: uiText('请稍后重试。管理员需在微信公众平台启用小程序客服并添加客服人员。请勿发送密码、配对令牌或模型密钥。'), showCancel: false });
  },
  applySharing(enabled) {
    this.setData({ referralEnabled: enabled === true, ...(enabled ? {} : { referralSheetOpen: false, referralToken: '', referralBusy: false }) });
    // Settings must not re-enable the platform sharing menu when this activity is off.
    try { wx.hideShareMenu({ menus: ['shareAppMessage', 'shareTimeline'] }); } catch (e) {}
  },
  async refreshAppContent() {
    const generation = this._contentGeneration = (this._contentGeneration || 0) + 1;
    this.setData({ contentLoaded: false, contentError: '' });
    this.applySharing(false);
    try {
      const content = await accessApi.appContent();
      if (generation !== this._contentGeneration) return;
      this.applySharing(content.shareEnabled === true);
      this.setData({ contentLoaded: true });
    } catch (error) {
      if (generation === this._contentGeneration) this.setData({ contentError: error.message || uiText('分享设置同步失败，请重试') });
    }
  },
  async toggleReferralSharing(event) {
    if (!this.data.isWechatAdmin || this.data.accountBusy || !this.data.contentLoaded || this.data.shareSaving) return;
    const generation = this._contentGeneration, accountGeneration = this._accountGeneration;
    const enabled = event.detail.value === true;
    this.setData({ shareSaving: true });
    try {
      const current = await accessApi.ensureAccount();
      if (generation !== this._contentGeneration || accountGeneration !== this._accountGeneration) return;
      if (!current.isAdmin) throw Object.assign(new Error(uiText('管理员权限已移除')), { code: 'FORBIDDEN' });
      const value = await accessApi.setSharingEnabled(enabled);
      if (generation !== this._contentGeneration || accountGeneration !== this._accountGeneration) return;
      this.applySharing(value.shareEnabled);
      wx.showToast({ title: value.shareEnabled ? uiText('分享已开启') : uiText('分享已关闭'), icon: 'success' });
    } catch (error) {
      if (generation !== this._contentGeneration || accountGeneration !== this._accountGeneration) return;
      this.applySharing(this.data.referralEnabled);
      if (['FORBIDDEN', 'UNAUTHORIZED', 'LOGIN_REQUIRED'].includes(error.code)) this.setData({ isWechatAdmin: false });
      wx.showModal({ title: uiText('设置未保存'), content: error.message || uiText('请稍后重试'), showCancel: false });
    } finally { if (generation === this._contentGeneration && accountGeneration === this._accountGeneration) this.setData({ shareSaving: false }); }
  },

  toggleAdminAdvanced() {
    if (!this.data.isWechatAdmin || this.data.accountBusy) return;
    this.setData({ adminAdvancedOpen: !this.data.adminAdvancedOpen });
  },

  openPairingManagement() {
    if (!this.data.isWechatAdmin || this.data.accountBusy) return;
    wx.navigateTo({ url: '/pages/pairing-admin/pairing-admin' });
  },

  bindWechatAdmin() {
    if (this.data.accountBusy) return;
    if (!accessApi.configured()) {
      wx.showModal({ title: uiText('请先部署管理后台'), content: uiText('在服务器启动鲸尾管理台、配置微信凭据，并将管理台 HTTPS 地址填入小程序配置后，即可绑定管理员。'), showCancel: false });
      return;
    }
    wx.showModal({ title: uiText('绑定管理员微信'), editable: true, placeholderText: uiText('输入网页后台生成的 WB- 绑定码'),
      success: async res => {
        if (!res.confirm) return;
        const code = String(res.content || '').trim().toUpperCase();
        if (!/^WB-(?:[A-F0-9]{6}-){3}[A-F0-9]{6}$/.test(code)) {
          wx.showToast({ title: uiText('请输入完整身份绑定码，不是设备配对码'), icon: 'none' }); return;
        }
        const generation = this._accountGeneration;
        this.setData({ accountBusy: true });
        try {
          await accessApi.ensureAccount({ freshLogin: true });
          if (generation !== this._accountGeneration) return;
          await accessApi.claimAdminBinding(code);
          if (generation !== this._accountGeneration) return;
          wx.showModal({ title: uiText('身份已提交'), content: uiText('请回到网页管理台核对并批准。批准后重新进入此页面，将自动识别管理员身份。'), showCancel: false });
        } catch (error) {
          if (generation === this._accountGeneration) wx.showToast({ title: error.message || uiText('绑定失败，请重试'), icon: 'none' });
        } finally { if (generation === this._accountGeneration) this.setData({ accountBusy: false }); }
      }
    });
  },

  openPublicAccess() {
    this.syncFromStore({ app: store.state, session: store.sessionState });
    this.setData({ managementPanel: 'public', pairSheetOpen: false });
    this.refreshAppContent();
  },

  async openReferralShare() {
    if (!this.data.referralEnabled || this.data.referralBusy) return;
    const generation = this._accountGeneration;
    this.setData({ referralSheetOpen: true, referralBusy: true, referralError: '', referralToken: '' });
    try {
      await accessApi.ensureAccount({ freshLogin: true });
      if (generation !== this._accountGeneration) return;
      const status = await accessApi.shareStatus();
      if (generation !== this._accountGeneration) return;
      if (!status.rules.enabled) { this.applySharing(false); return; }
      const result = status.rules.enabled ? await accessApi.shareInvite() : status;
      if (generation !== this._accountGeneration) return;
      const tiers = result.rules.tiers;
      this.setData({ referralDays: result.earnedDays,
        referralError: result.rules.enabled ? '' : uiText('分享活动暂未开放'),
        referralToken: result.rules.enabled ? result.inviteToken : '',
        referralHint: uiText('每位朋友首次有效打开，按人数阶梯赠送 ') + tiers.map(t => t.days).join(' / ') + uiText(' 天公网访问。') });
    } catch (e) { if (generation === this._accountGeneration) this.setData({ referralError: e.message || uiText('加载失败，请重试') }); }
    finally { if (generation === this._accountGeneration) this.setData({ referralBusy: false }); }
  },
  closeReferralShare() { this.setData({ referralSheetOpen: false }); },
  openShareRules() { this.setData({ referralSheetOpen: false }); wx.navigateTo({ url: '/pages/share-activity/share-activity?rules=1' }); },
  openMomentsActivity() { this.setData({ referralSheetOpen: false }); wx.navigateTo({ url: '/pages/share-activity/share-activity?moments=1' }); },

  openNodeManagement() {
    this.setData({ managementPanel: 'nodes', pairSheetOpen: false, nodeDetailId: '', nodeDetail: null });
    this.refreshNodes();
  },

  closeManagementPanel() {
    this._nodePingGeneration = (this._nodePingGeneration || 0) + 1;
    this.setData({ managementPanel: this.data.managementPanel === 'gateway' ? 'nodes' : '', nodeDetailId: '', nodeDetail: null, nodePingBusy: false });
  },

  refreshNodes() {
    store.refreshHostPresence();
  },

  toggleNodeEditMode() {
    const next = !this.data.nodeEditMode;
    this.setData({ nodeEditMode: next, nodeSelection: [] });
    this.syncFromStore({ app: store.state, session: store.sessionState });
  },

  toggleNodeSelect(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    const current = this.data.nodeSelection || [];
    const next = current.indexOf(id) >= 0
      ? current.filter((item) => item !== id)
      : current.concat([id]);
    this.setData({ nodeSelection: next });
    this.syncFromStore({ app: store.state, session: store.sessionState });
  },

  deleteSelectedNodes() {
    const ids = this.data.nodeSelection || [];
    if (!ids.length) return;
    const names = (this.data.nodes || []).filter((n) => ids.indexOf(n.id) >= 0).map((n) => n.name);
    wx.showModal({
      title: ids.length > 1 ? uiText('删除 ') + ids.length + uiText(' 个节点？') : uiText('删除节点？'),
      content: uiText('将移除：') + names.join('、') + uiText('。删除后需重新配对才能连接。'),
      confirmText: uiText('删除'),
      confirmColor: '#E5533C',
      success: (res) => {
        if (!res.confirm) return;
        store.removeHosts(ids);
        this.setData({ nodeSelection: [], nodeEditMode: false });
        this.syncFromStore({ app: store.state, session: store.sessionState });
        wx.showToast({ title: uiText('已删除'), icon: 'success' });
      }
    });
  },

  selectNode(e) {
    const id = e.currentTarget.dataset.id;
    if (!(store.state.profiles || []).some(p => p.id === id)) return;
    if (this.data.nodeEditMode) { this.toggleNodeSelect(e); return; }
    this._nodePingGeneration = (this._nodePingGeneration || 0) + 1;
    this.setData({ nodeDetailId: id, managementPanel: 'gateway', nodePingBusy: false });
    this.syncFromStore({ app: store.state });
  },

  currentNodeDetail() {
    return nodePresentation((store.state.profiles || []).find(p => p.id === this.data.nodeDetailId), store.state);
  },

  connectNode() {
    const detail = this.currentNodeDetail();
    if (!detail || detail.canDisconnect) return;
    store.selectHost(detail.id);
    this.syncFromStore({ app: store.state });
  },

  copyNodeId(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    wx.setClipboardData({ data: id });
  },

  /** 账号续期不依赖已配对节点，断线/到期后也能兑换。 */
  redeemRenewal() {
    if (this.data.redeemBusy) return;
    if (!accessApi.configured()) {
      wx.showModal({ title: uiText('兑换服务待配置'), content: uiText('请先配置公网服务后台。局域网直连不受影响。'), showCancel: false });
      return;
    }
    const generation = this._accountGeneration;
    wx.showModal({
      title: uiText('兑换公网有效期'),
      editable: true,
      placeholderText: uiText('输入管理员提供的兑换码'),
      success: (res) => {
        if (!res.confirm) return;
        const code = String(res.content || '').trim().toUpperCase();
        if (!code) {
          wx.showToast({ title: uiText('请输入兑换码'), icon: 'none' });
          return;
        }
        if (generation !== this._accountGeneration) return;
        this.setData({ redeemBusy: true, redeemResultLabel: '' });
        accessApi.ensureAccount({ freshLogin: true }).then(() => accessApi.redeemPublicAccess(code)).then(async (result) => {
          if (generation !== this._accountGeneration) return;
          this.setData({
            redeemBusy: false,
            redeemResultLabel: result.expiresAt
              ? uiText('兑换成功，有效期至 ') + formatExpiry(result.expiresAt)
              : uiText('兑换成功')
          });
          this.syncFromStore({ app: store.state, session: store.sessionState });
          await this.refreshWechatAccount();
          store.appDidBecomeActive();
          wx.showToast({ title: uiText('兑换成功'), icon: 'success' });
        }).catch((err) => {
          if (generation !== this._accountGeneration) return;
          this.setData({ redeemBusy: false });
          wx.showToast({ title: err.message || uiText('兑换失败'), icon: 'none' });
        });
      }
    });
  },

  createNodeShare() {
    if (!this.data.shareEnabled) {
      wx.showModal({ title: uiText('暂不能分享公网访问'), content: this.data.shareReason || uiText('当前节点暂不支持分享。'), showCancel: false });
      return;
    }
    const profileId = store.state.activeID;
    wx.showActionSheet({
      itemList: [uiText('1 小时'), uiText('1 天'), uiText('7 天')],
      success: (res) => {
        const choices = [3600000, 86400000, 604800000];
        const ttl = choices[res.tapIndex];
        if (!ttl || profileId !== store.state.activeID || !this.data.shareEnabled) return;
        wx.showLoading({ title: uiText('正在生成'), mask: true });
        store.createRelayShare(ttl).then((share) => {
          wx.hideLoading();
          if (profileId !== store.state.activeID || !this.data.shareEnabled) return;
          this.setData({
            sharePayload: share.raw,
            shareExpiresLabel: uiText('邀请有效至 ') + formatExpiry(share.expiresAt)
          });
        }).catch((err) => {
          wx.hideLoading();
          wx.showToast({ title: err.message || uiText('生成分享失败'), icon: 'none' });
        });
      }
    });
  },

  copyNodeShare() {
    if (!this.data.sharePayload) return;
    wx.setClipboardData({
      data: this.data.sharePayload,
      success: () => wx.showToast({ title: uiText('配对信息已复制'), icon: 'success' })
    });
  },

  onShareAppMessage(event) {
    if (this.data.referralEnabled && event && event.target && event.target.dataset && event.target.dataset.referral && this.data.referralToken) {
      return { title: uiText('鲸尾 · 随时连接自己的 DSH'), path: '/pages/share-activity/share-activity?ref=' + this.data.referralToken, imageUrl: '/assets/brand/app-icon-share-500x400.png' };
    }
    if (this.data.sharePayload) {
      return {
        title: uiText('邀请你连接「') + (store.state.gatewayName || uiText('公网节点')) + '」',
        path: '/pages/settings/settings?pair=' + this.data.sharePayload
      };
    }
    return { title: uiText('whaletail Harness · 公网节点'), path: '/pages/settings/settings' };
  },

  addPublicNode() {
    wx.showActionSheet({
      itemList: [uiText('扫描配对二维码'), uiText('输入配对信息')],
      success: (res) => {
        if (res.tapIndex === 0) this.scanPublicNode();
        if (res.tapIndex === 1) this.openPairSheet();
      }
    });
  },

  /** 添加节点：进入三步引导页 */
  addNode() {
    wx.navigateTo({ url: '/pages/add-node/add-node' });
  },

  scanPublicNode() {
    wx.scanCode({
      onlyFromCamera: true,
      success: (res) => {
        const result = store.pairWithPayload(res.result);
        if (result.ok) {
          this._pairingAttemptActive = true;
          wx.showToast({ title: uiText('连接中…'), icon: 'none' });
        } else {
          wx.showToast({ title: result.error || uiText('配对失败'), icon: 'none' });
        }
      },
      fail: (err) => {
        const message = err && err.errMsg ? err.errMsg : '';
        if (message.indexOf('permission') >= 0 || message.indexOf('auth') >= 0) {
          wx.showToast({ title: uiText('需要摄像头权限，请在设置中开启'), icon: 'none' });
        } else if (message.indexOf('cancel') < 0) {
          wx.showToast({ title: uiText('扫码失败：') + message, icon: 'none' });
        }
      }
    });
  },

  openPairSheet() {
    this.setData({ managementPanel: 'nodes', pairSheetOpen: true, pairingText: '', pairingError: '', pairingConnecting: false });
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
      this.setData({ pairingError: result.error || uiText('配对信息无效') });
      return;
    }
    this._pairingAttemptActive = true;
    this.setData({ pairingConnecting: true, pairingError: uiText('正在连接…') });
  },

  /** 全屏底部弹窗，关闭后保留设置列表位置。 */
  openPrivacyPolicy() {
    this.setData({ privacyOpen: true });
  },
  closePrivacyPolicy() {
    this.setData({ privacyOpen: false });
  }
});


function formatExpiry(value) {
  const date = new Date(value);
  const pad = (n) => n < 10 ? '0' + n : String(n);
  return date.getFullYear() + '/' + pad(date.getMonth() + 1) + '/' + pad(date.getDate()) + ' ' +
    pad(date.getHours()) + ':' + pad(date.getMinutes());
}
