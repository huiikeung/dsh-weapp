const api = require('../../utils/access-api');
const theme = require('../../utils/theme');
const labels = { waiting: '等待满 24 小时', pending: '等待管理员审核', approved: '已发放', rejected: '未通过', expired: '凭证已过期' };
const stamp = value => new Date(value).toLocaleString();
Page({
  manualShareMenu: true,
  data: { loading: true, busy: false, error: '', incoming: false, accepted: false, openResult: '', enabled: false,
    inviteToken: '', earnedDays: 0, validOpens: 0, tiers: [], momentsDays: 3, moments: [], records: [], rulesOpen: false },
  onLoad(options) { theme.applyTo(this); this._ref = options.ref || ''; this.setData({ incoming: !!this._ref, rulesOpen: options.moments === '1' || options.rules === '1' }); },
  onShow() { if (!this._choosingProof) return this.refresh(); },
  onHide() { if (!this._choosingProof) { this._generation = (this._generation || 0) + 1; this.setData({ busy: false, inviteToken: '', moments: [], records: [] }); } },
  onUnload() { this._generation = (this._generation || 0) + 1; },
  async refresh() {
    const generation = this._generation = (this._generation || 0) + 1;
    this.setData({ loading: true, busy: false, error: '', inviteToken: '', enabled: false, earnedDays: 0, validOpens: 0, moments: [], records: [] });
    this.syncShareMenu(false);
    try {
      await api.ensureAccount({ freshLogin: true });
      if (generation !== this._generation) return;
      const value = await api.shareStatus();
      if (generation !== this._generation) return;
      this.render(value);
      if (value.rules.enabled) {
        const invitation = await api.shareInvite();
        if (generation === this._generation) this.render(invitation);
      }
    } catch (e) { if (generation === this._generation) this.setData({ error: e.message || '加载失败，请重试' }); }
    finally { if (generation === this._generation) this.setData({ loading: false }); }
  },
  render(value) {
    this.syncShareMenu(value.rules.enabled === true);
    this.setData({ enabled: value.rules.enabled, inviteToken: value.rules.enabled ? value.inviteToken || '' : '', earnedDays: value.earnedDays,
      validOpens: value.validOpens, momentsDays: value.rules.momentsDays,
      tiers: value.rules.tiers.map((t,i,a) => ({ ...t, label: a[i+1] ? '第 ' + t.from + '–' + (a[i+1].from-1) + ' 位' : '第 ' + t.from + ' 位起' })),
      moments: value.moments.map(x => ({ ...x, statusLabel: labels[x.status] || x.status,
        eligibleLabel: stamp(x.eligibleAt), canSubmit: x.status === 'waiting' && Date.now() >= x.eligibleAt })),
      records: value.records.map(x => ({ ...x, label: x.kind === 'friend' ? '第 ' + x.ordinal + ' 位有效好友' : '朋友圈审核通过', timeLabel: stamp(x.createdAt) })) });
  },
  syncShareMenu(enabled) {
    try { if (enabled) wx.showShareMenu({ menus: ['shareAppMessage', 'shareTimeline'] }); else wx.hideShareMenu({ menus: ['shareAppMessage', 'shareTimeline'] }); } catch (e) {}
  },
  async acceptInvitation() {
    if (this.data.busy || this.data.loading || !this.data.enabled || this.data.accepted || !this._ref) return;
    const generation = this._generation;
    this.setData({ busy: true, error: '' });
    try {
      const result = await api.recordShareOpen(this._ref);
      if (generation !== this._generation) return;
      this.setData({ accepted: true, openResult: result.counted ? '已确认有效打开，朋友已获得公网时长。' : result.reason === 'self' ? '这是你自己的邀请，不重复计奖。' : '此微信已参与过，不重复计奖。' });
    } catch (e) { if (generation === this._generation) this.setData({ error: e.message || '确认失败' }); }
    finally { if (generation === this._generation) this.setData({ busy: false }); }
  },
  enterApp() { wx.reLaunch({ url: '/pages/home/home' }); },
  toggleRules() { this.setData({ rulesOpen: !this.data.rulesOpen }); },
  onShareAppMessage() {
    return { title: '鲸尾 · 随时连接自己的 DSH', path: this.data.enabled ? '/pages/share-activity/share-activity' + (this.data.inviteToken ? '?ref=' + this.data.inviteToken : '') : '/pages/home/home', imageUrl: '/assets/brand/app-icon-share-500x400.png' };
  },
  onShareTimeline() { return { title: '鲸尾 · 随时连接自己的 DSH', query: 'timeline=1', imageUrl: '/assets/brand/app-icon-share-500x400.png' }; },
  momentsGuide() { wx.showModal({ title: '分享到朋友圈', content: '点击右上角「…」→「分享到朋友圈」。发布后提交首张截图，保留满 24 小时再提交复核截图。微信不提供保留时长证明，需要后台人工审核；点击分享不会立即发奖。', showCancel: false }); },
  uploadProof(event) {
    if (this.data.busy || this.data.loading || !this.data.enabled) return;
    const id = event.currentTarget.dataset.id || '';
    const generation = this._generation;
    wx.showModal({ title: id ? '提交 24 小时复核' : '登记今日朋友圈',
      content: '仅上传自己的本次分享截图。请遮挡无关头像、姓名和动态；截图将上传后台人工审核，审核结束即删除，未处理最多保留 7 天。',
      success: res => {
        if (!res.confirm || generation !== this._generation) return;
        this._choosingProof = true;
        wx.chooseMedia({ count: 1, mediaType: ['image'], sourceType: ['album'], sizeType: ['compressed'],
          success: async chosen => {
            if (generation !== this._generation) return;
            this.setData({ busy: true, error: '' });
            try {
              const file = chosen.tempFiles[0];
              if (file.size > 337920) throw new Error('请裁剪或压缩截图至 330KB 内后重试');
              const base64 = wx.getFileSystemManager().readFileSync(file.tempFilePath, 'base64');
              const mime = base64.indexOf('iVBOR') === 0 ? 'png' : 'jpeg';
              const proof = 'data:image/' + mime + ';base64,' + base64;
              const value = id ? await api.momentsSubmit(id, proof) : await api.momentsStart(proof);
              if (generation === this._generation) { this.render(value); wx.showToast({ title: id ? '已提交审核' : '已登记，满24小时后复核', icon: 'none' }); }
            } catch (e) { if (generation === this._generation) this.setData({ error: e.message || '提交失败' }); }
            finally { this._choosingProof = false; if (generation === this._generation) this.setData({ busy: false }); }
          },
          fail: error => { this._choosingProof = false; if (generation === this._generation && !String(error.errMsg || '').includes('cancel')) this.setData({ error: '无法读取图片，请检查相册权限后重试' }); }
        });
      }
    });
  }
});
