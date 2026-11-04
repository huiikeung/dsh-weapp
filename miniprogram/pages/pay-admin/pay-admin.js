const { t: uiText } = require('../../utils/ui-preferences');
const api = require('../../utils/access-api');
const theme = require('../../utils/theme');
const virtualPay = require('../../utils/virtual-pay');

// 与服务端 CODE_DAYS 完全一致；顺序与文案一一对应。
const DAYS = [1, 3, 7, 30, 60, 90, 180, 365, 730, 1095, 3650];
const DAY_KEYS = ['1 天', '3 天', '7 天', '30 天', '60 天', '90 天', '半年', '1 年', '2 年', '3 年', '长期'];
const MAX_TIERS = 10;
// 交易记录默认只露出最近 5 条：订单会持续累积，全部铺开会让整页很长。
const ORDER_PREVIEW_LIMIT = 5;
// 一次拉多少条订单：服务端游标分页，避免一次把全部历史拉进页面。
const ORDER_PAGE_SIZE = 20;
// 页面里最多保留多少条订单：再多就只留在服务端，避免 setData 体积无限增长。
const MAX_LOADED_ORDERS = 200;
// 与服务端 payment.cjs 的 MIN_PRICE=1 分保持一致；Android 允许 1 分测试档。
// iOS（Apple 支付）官方要求最低 1 元，由用户端 virtual-pay.priceIssue 在购买时拦截。
const MIN_PRICE_CENTS = 1;
const MAX_PRICE_CENTS = 1000000;
const IOS_MIN_PRICE_CENTS = 100;
const dayLabels = () => DAY_KEYS.map(uiText);

// 订单状态：内联双语，不占用 i18n 字典预算（字典已接近 180 KiB 上限）。
const ORDER_STATUS = {
  created: '待支付', paid: '待发货', delivered: '已发货', closed: '已关闭', refunded: '已退款'
};
const ORDER_STATUS_EN = {
  created: 'Pending', paid: 'Paid', delivered: 'Delivered', closed: 'Closed', refunded: 'Refunded'
};
function orderStatusLabel(status) {
  try {
    if (require('../../utils/ui-preferences').snapshot().uiLocale === 'en') return ORDER_STATUS_EN[status] || status;
  } catch (e) { /* 退回中文 */ }
  return ORDER_STATUS[status] || status;
}

/** 订单 → 列表行视图：日期单独成组标题，行内只显示时分。 */
function orderRowView(order) {
  const d = new Date(order.createdAt);
  const date = [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('/');
  const time = [String(d.getHours()).padStart(2, '0'), String(d.getMinutes()).padStart(2, '0')].join(':');
  return {
    outTradeNo: order.outTradeNo,
    date,
    time,
    days: order.days,
    amountLabel: virtualPay.formatPrice(order.amount),
    statusLabel: orderStatusLabel(order.status),
    status: order.status
  };
}

Page({
  data: {
    loading: true, verified: false, isAdmin: false, ready: false, upgradeRequired: false,
    busy: false, enabled: false, error: '', savedLabel: '',
    tiers: [], dayLabels: dayLabels(), maxReached: false,
    summary: null, orders: [], ordersLoaded: false, ordersBusy: false,
    orderGroups: [], ordersCursor: null, ordersHasMore: false,
    ordersExpanded: false, ordersRemaining: 0, ordersToggleLabel: '', loadMoreBusy: false, ordersCapped: false,
    orderFilter: 'all'
  },
  onUiLocaleChange() {
    this.setData({ dayLabels: dayLabels(), tiers: (this.data.tiers || []).map(tier => Object.assign({}, tier, { daysLabel: dayLabels()[tier.dayIndex] })) });
  },
  onLoad() { theme.applyTo(this); },
  onShow() { return this.refresh(); },
  onHide() {
    this._generation = (this._generation || 0) + 1;
    this.setData({ isAdmin: false, busy: false, enabled: false, tiers: [], error: '', savedLabel: '', upgradeRequired: false });
  },
  onUnload() { this._generation = (this._generation || 0) + 1; },

  async refresh() {
    const generation = this._generation = (this._generation || 0) + 1;
    this.setData({ loading: true, verified: false, isAdmin: false, busy: false, error: '', savedLabel: '', tiers: [] });
    try {
      const account = await api.ensureAccount({ freshLogin: true });
      if (generation !== this._generation) return;
      if (!account || account.isAdmin !== true) {
        this.setData({ loading: false, verified: true, isAdmin: false, error: uiText('当前微信不是管理员，不能管理支付档位。') });
        return;
      }
      const content = await api.appContent();
      if (generation !== this._generation) return;
      const payment = content && content.payment && typeof content.payment === 'object' ? content.payment : {};
      const upgradeRequired = payment.upgradeRequired === true;
      this.applyConfig({
        enabled: payment.enabled === true,
        tiers: (Array.isArray(payment.tiers) ? payment.tiers : []).map(tier => ({ days: tier.days, price: tier.price }))
      });
      this.setData({
        loading: false, verified: true, isAdmin: true, ready: payment.ready === true, upgradeRequired,
        error: upgradeRequired ? uiText('服务端尚未升级虚拟支付接口，请先部署新版 public-access 服务，再回到这里配置档位。') : ''
      });
      this.loadOrders(generation);
    } catch (err) {
      if (generation === this._generation) this.setData({ loading: false, verified: true, error: err.message || uiText('加载失败，请重试') });
    }
  },

  /** 管理员交易记录：月流水 + 第一页订单（游标分页）。失败不阻断档位配置。 */
  async loadOrders(generation) {
    if (generation !== this._generation) return;
    this.setData({ ordersBusy: true, ordersCursor: null, ordersHasMore: false });
    try {
      const [summary, list] = await Promise.all([api.paySummary(), api.payOrders(ORDER_PAGE_SIZE, null, this.orderSince())]);
      if (generation !== this._generation) return;
      const items = list && Array.isArray(list.items) ? list.items : [];
      const nextCursor = list && list.nextCursor ? list.nextCursor : null;
      const s = summary || {};
      this.setData({
        ordersBusy: false, ordersLoaded: true,
        orders: items.map(orderRowView),
        ordersCursor: nextCursor,
        ordersHasMore: !!nextCursor,
        ordersExpanded: false,
        summary: {
          month: String(s.month || ''),
          amountLabel: virtualPay.formatPrice(Number(s.cents) || 0),
          count: Number(s.count) || 0,
          limitLabel: virtualPay.formatPrice(Number(s.limit) || 0)
        }
      });
      this.applyOrdersView(false);
    } catch (e) {
      if (generation === this._generation) this.setData({ ordersBusy: false, ordersLoaded: true });
    }
  },

  /** 日期筛选换算成 since 时间戳：服务端按 createdAt >= since 过滤，筛选对全部历史生效而不是只在已加载页里找。 */
  orderSince() {
    const filter = this.data.orderFilter;
    if (filter === 'today') { const start = new Date(); start.setHours(0, 0, 0, 0); return start.getTime(); }
    if (filter === '7d') return Date.now() - 7 * 86400000;
    if (filter === '30d') return Date.now() - 30 * 86400000;
    return 0;
  },

  /** 切换日期筛选：清空已加载订单，从第一页重新拉。 */
  setOrderFilter(event) {
    const id = event && event.currentTarget && event.currentTarget.dataset ? event.currentTarget.dataset.id : '';
    if (!id || id === this.data.orderFilter) return;
    this.setData({ orderFilter: id, orders: [], orderGroups: [], ordersCursor: null, ordersHasMore: false, ordersCapped: false, ordersExpanded: false, ordersRemaining: 0, ordersToggleLabel: '' });
    this.loadOrders(this._generation);
  },

  /** 按日期分组渲染：默认 5 条；展开显示已加载的全部；还有更早订单时给「加载更多」。 */
  applyOrdersView(expanded) {
    const all = Array.isArray(this.data.orders) ? this.data.orders : [];
    const remaining = Math.max(0, all.length - ORDER_PREVIEW_LIMIT);
    const open = expanded === true;
    const visible = open || remaining === 0 ? all : all.slice(0, ORDER_PREVIEW_LIMIT);
    const groups = [];
    visible.forEach(order => {
      const date = order.date || '';
      let group = groups[groups.length - 1];
      if (!group || group.date !== date) { group = { date: date, items: [] }; groups.push(group); }
      group.items.push(order);
    });
    this.setData({
      ordersExpanded: open,
      orderGroups: groups,
      ordersRemaining: remaining,
      ordersToggleLabel: remaining === 0 ? '' : (open ? uiText('收起') : uiText('展开其余 {n} 条记录', { n: remaining }))
    });
  },

  toggleOrders() { this.applyOrdersView(this.data.ordersExpanded !== true); },

  /** 加载更早的订单：游标是上一页最后一条，翻多少页就拉多少页，不会一次拉全量。 */
  async loadMoreOrders() {
    if (this.data.loadMoreBusy || !this.data.ordersHasMore) return;
    const generation = this._generation;
    const cursor = this.data.ordersCursor;
    this.setData({ loadMoreBusy: true });
    try {
      const list = await api.payOrders(ORDER_PAGE_SIZE, cursor, this.orderSince());
      if (generation !== this._generation) return;
      const items = list && Array.isArray(list.items) ? list.items : [];
      const nextCursor = list && list.nextCursor ? list.nextCursor : null;
      const merged = (this.data.orders || []).concat(items.map(orderRowView)).slice(0, MAX_LOADED_ORDERS);
      const capped = merged.length >= MAX_LOADED_ORDERS;
      this.setData({
        orders: merged,
        ordersCursor: capped ? null : nextCursor,
        ordersHasMore: !capped && !!nextCursor,
        ordersCapped: capped,
        loadMoreBusy: false
      });
      this.applyOrdersView(true);
    } catch (err) {
      if (generation !== this._generation) return;
      this.setData({ loadMoreBusy: false });
      wx.showToast({ title: err.message || uiText('加载失败，请重试'), icon: 'none' });
    }
  },

  /** 点订单「核对」：以微信侧为准查单，自动同步退款状态。 */
  async inspectOrder(event) {
    const id = event && event.currentTarget && event.currentTarget.dataset ? event.currentTarget.dataset.id : '';
    if (!id || this.data.ordersBusy) return;
    this.setData({ ordersBusy: true });
    try {
      const res = await api.inspectPayOrder(id);
      const w = res && res.wechat ? res.wechat : {};
      const lines = [
        uiText('微信状态：') + (w.status === 4 ? uiText('已发货') : w.status === 5 || w.status === 8 ? uiText('已退款') : String(w.status)),
        uiText('支付金额：') + '¥' + virtualPay.formatPrice(w.paidFee || 0),
        uiText('可退余额：') + '¥' + virtualPay.formatPrice(w.leftFee || 0),
        w.wxOrderId ? uiText('微信单号：') + w.wxOrderId : ''
      ].filter(Boolean);
      wx.showModal({ title: uiText('微信侧订单'), content: lines.join('\n'), showCancel: false });
      this.loadOrders(this._generation);
    } catch (err) {
      wx.showToast({ title: err.message || uiText('查单失败'), icon: 'none' });
      this.setData({ ordersBusy: false });
    }
  },

  /** 点「退款」：仅 Android/鸿蒙单可退，iOS 由用户走 App Store。 */
  async refundOrder(event) {
    const id = event && event.currentTarget && event.currentTarget.dataset ? event.currentTarget.dataset.id : '';
    if (!id || this.data.ordersBusy) return;
    const ok = await new Promise(resolve => wx.showModal({
      title: uiText('确认退款'), content: uiText('将向微信发起退款，成功后自动扣回该订单赠送的天数。iOS 订单不支持主动退款。'),
      success: r => resolve(!!r.confirm), fail: () => resolve(false)
    }));
    if (!ok) return;
    this.setData({ ordersBusy: true });
    try {
      const res = await api.refundPayOrder(id, 3);
      wx.showToast({ title: uiText('退款已发起') + (res && res.refundOrderId ? ' ' + res.refundOrderId : ''), icon: 'none' });
      this.loadOrders(this._generation);
    } catch (err) {
      wx.showToast({ title: err.message || uiText('退款失败'), icon: 'none' });
      this.setData({ ordersBusy: false });
    }
  },

  /** 服务端配置是唯一事实来源；档位项用稳定 key。价格直接存进 tier.priceYuan（受控），不再用 _priceDrafts。 */
  applyConfig(config) {
    const source = config && typeof config === 'object' ? config : {};
    this._tierSeq = 0;
    const tiers = (Array.isArray(source.tiers) ? source.tiers : [])
      .filter(tier => tier && Number.isInteger(tier.days) && tier.days > 0)
      .slice(0, MAX_TIERS)
      .map(tier => this.projectTier(tier.days, tier.price));
    this.setData({ enabled: source.enabled === true, tiers, maxReached: tiers.length >= MAX_TIERS });
  },

  projectTier(days, price) {
    const value = Number(days) || DAYS[0];
    const dayIndex = Math.max(0, DAYS.indexOf(value));
    this._tierSeq = (this._tierSeq || 0) + 1;
    return {
      key: 'tier-' + this._tierSeq,
      days: DAYS[dayIndex],
      dayIndex,
      daysLabel: dayLabels()[dayIndex],
      priceYuan: price === null || price === undefined || price === '' ? '' : virtualPay.toYuan(price),
      productId: virtualPay.productId(DAYS[dayIndex])
    };
  },

  toggleEnabled(event) {
    if (!this.data.isAdmin || this.data.busy) return;
    if (this.data.upgradeRequired) { this.setData({ error: uiText('服务端尚未升级虚拟支付接口，请先部署新版 public-access 服务后再配置') }); return; }
    this.setData({ enabled: !!(event && event.detail && event.detail.value), error: '', savedLabel: '' });
  },

  chooseDays(event) {
    if (!this.data.isAdmin || this.data.busy) return;
    const index = Number(event && event.currentTarget && event.currentTarget.dataset ? event.currentTarget.dataset.index : -1);
    const dayIndex = Number(event && event.detail ? event.detail.value : -1);
    const tier = (this.data.tiers || [])[index];
    if (!tier || !Number.isInteger(dayIndex) || !DAYS[dayIndex]) return;
    const tiers = (this.data.tiers || []).slice();
    tiers[index] = Object.assign({}, tier, {
      days: DAYS[dayIndex], dayIndex, daysLabel: dayLabels()[dayIndex], productId: virtualPay.productId(DAYS[dayIndex])
    });
    this.setData({ tiers, error: '', savedLabel: '' });
  },

  inputPrice(event) {
    const index = Number(event && event.currentTarget && event.currentTarget.dataset ? event.currentTarget.dataset.index : -1);
    const tier = (this.data.tiers || [])[index];
    if (!tier) return;
    const value = String(event && event.detail && event.detail.value !== undefined ? event.detail.value : '');
    const tiers = (this.data.tiers || []).slice();
    tiers[index] = Object.assign({}, tier, { priceYuan: value });
    this.setData({ tiers, error: '', savedLabel: '' });
  },

  addTier() {
    if (!this.data.isAdmin || this.data.busy) return;
    const tiers = this.data.tiers || [];
    if (tiers.length >= MAX_TIERS) { this.setData({ error: uiText('最多只能配置 10 个档位') }); return; }
    const used = tiers.map(tier => tier.days);
    const days = DAYS.find(value => used.indexOf(value) < 0);
    if (!days) { this.setData({ error: uiText('可选天数已全部添加') }); return; }
    // 新增档位给一个默认价格，避免「加了却因空价格保存不了」。
    const next = tiers.concat([this.projectTier(days, 990)]);
    this.setData({ tiers: next, maxReached: next.length >= MAX_TIERS, error: '', savedLabel: '' });
  },

  deleteTier(event) {
    if (!this.data.isAdmin || this.data.busy) return;
    const index = Number(event && event.currentTarget && event.currentTarget.dataset ? event.currentTarget.dataset.index : -1);
    const tiers = (this.data.tiers || []).slice();
    if (!tiers[index]) return;
    tiers.splice(index, 1);
    this.setData({ tiers, maxReached: tiers.length >= MAX_TIERS, error: '', savedLabel: '' });
  },

  async save() {
    // 任何前置条件不满足都要给出明确提示，不能静默 return。
    if (this.data.loading) { wx.showToast({ title: uiText('正在验证身份，请稍候'), icon: 'none' }); return; }
    if (!this.data.isAdmin) { wx.showToast({ title: uiText('当前微信不是管理员，不能保存档位'), icon: 'none' }); return; }
    if (this.data.busy) return;
    if (this.data.upgradeRequired) { this.setData({ error: uiText('服务端尚未升级虚拟支付接口，请先部署新版 public-access 服务后再保存') }); return; }

    const tiers = [];
    const seen = {};
    const list = this.data.tiers || [];
    for (let i = 0; i < list.length; i++) {
      const tier = list[i];
      const cents = virtualPay.toCents(tier.priceYuan);
      if (Number.isNaN(cents) || cents < MIN_PRICE_CENTS || cents > MAX_PRICE_CENTS) {
        this.setData({ error: uiText('第 {n} 个档位的价格需在 0.01–10000 元之间，最多两位小数', { n: i + 1 }) });
        return;
      }
      const days = Number(tier.days);
      if (!days) { this.setData({ error: uiText('请选择天数') }); return; }
      if (seen[days]) { this.setData({ error: uiText('天数不能重复，请修改后再保存') }); return; }
      seen[days] = true;
      tiers.push({ days, price: cents });
    }
    if (!tiers.length && this.data.enabled) { this.setData({ error: uiText('开启虚拟支付前请至少添加一个档位') }); return; }

    const generation = this._generation;
    this.setData({ busy: true, error: '', savedLabel: '' });
    try {
      const result = await api.savePayConfig({ enabled: this.data.enabled === true, tiers });
      if (generation !== this._generation) return;
      const payment = result && result.payment && typeof result.payment === 'object' ? result.payment : { enabled: this.data.enabled, tiers };
      this.applyConfig({ enabled: payment.enabled === true, tiers: (payment.tiers || []).map(tier => ({ days: tier.days, price: tier.price })) });
      this.setData({ ready: payment.ready === true, savedLabel: uiText('档位已保存，请到 MP 后台按 pub_<days>d 建道具并发布（约 10 分钟生效）') });
      wx.showToast({ title: uiText('档位已保存'), icon: 'success' });
    } catch (err) {
      if (generation !== this._generation) return;
      this.setData({ error: err.message || uiText('保存失败，请重试'), ...(err.code === 'FORBIDDEN' || err.code === 'UNAUTHORIZED' ? { isAdmin: false } : {}) });
    } finally { if (generation === this._generation) this.setData({ busy: false }); }
  }
});
