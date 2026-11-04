const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const file = path.resolve(__dirname, '../miniprogram/pages/pay-admin/pay-admin.js');

/** 用最小桩加载 pay-admin 页面定义（不跑真实网络）。 */
function loadPage(apiStub) {
  let definition;
  const context = {
    console,
    Page: value => { definition = value; },
    wx: { showToast() {}, showModal() {}, setNavigationBarColor() {}, setBackgroundColor() {} },
    setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {},
    require: name => {
      if (name === '../../utils/ui-preferences') return { t: (text, vars) => (vars && vars.n !== undefined ? String(text).replace(/\{n\}/g, String(vars.n)) : text) };
      if (name === '../../utils/theme') return { applyTo() {} };
      if (name === '../../utils/virtual-pay') return { formatPrice: cents => (Number(cents) / 100).toFixed(2) };
      if (name === '../../utils/access-api') return apiStub;
      return require(path.resolve(path.dirname(file), name));
    }
  };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), context);
  return { ...definition, data: JSON.parse(JSON.stringify(definition.data)), setData(patch) { Object.assign(this.data, patch); } };
}

function row(id, createdAt) {
  return { outTradeNo: id, createdAt, date: '2026/11/04', time: '20:00', amountLabel: '1.00', statusLabel: '已关闭', status: 'closed' };
}

test('orders fold to five rows and group the visible rows by date', () => {
  const page = loadPage({});
  page.data.orders = [
    row('a1', 5), row('a2', 4), row('a3', 3), row('a4', 2), row('a5', 1),
    Object.assign(row('b1', 0), { date: '2026/11/03', time: '09:00' })
  ];
  page.applyOrdersView(false);
  assert.equal(page.data.orderGroups.length, 1, 'collapsed view shows the newest date group only');
  assert.equal(page.data.orderGroups[0].items.length, 5);
  assert.equal(page.data.ordersRemaining, 1);
  assert.match(page.data.ordersToggleLabel, /1/);

  page.applyOrdersView(true);
  assert.equal(page.data.orderGroups.length, 2, 'expanded view splits rows into date groups');
  assert.equal(page.data.orderGroups.map(group => group.date).join('|'), '2026/11/04|2026/11/03');
  assert.equal(page.data.orderGroups[0].items.length, 5);
  assert.equal(page.data.orderGroups[1].items.length, 1);
  assert.equal(page.data.ordersToggleLabel, '收起');
});

test('loading more appends the next cursor page and stops at the page cap', async () => {
  const rows = Array.from({ length: 25 }, (_, index) => row('n' + index, 100 - index));
  const apiStub = { payOrders: async () => ({ items: rows.map(item => ({ outTradeNo: item.outTradeNo, amount: 100, days: 30, status: 'closed', createdAt: item.createdAt })), nextCursor: null }) };
  const page = loadPage(apiStub);
  page.data.orders = Array.from({ length: 195 }, (_, index) => row('x' + index, 500 - index));
  page.data.ordersHasMore = true;
  page.data.ordersCursor = { createdAt: 1, outTradeNo: 'x195' };
  await page.loadMoreOrders();
  assert.equal(page.data.orders.length, 200, 'the page keeps at most 200 orders in memory');
  assert.equal(page.data.ordersCapped, true);
  assert.equal(page.data.ordersHasMore, false);
});

test('date filter maps to the expected since timestamp', () => {
  const page = loadPage({});
  page.data.orderFilter = 'all';
  assert.equal(page.orderSince(), 0);
  page.data.orderFilter = '7d';
  const week = Date.now() - 7 * 86400000;
  assert.ok(Math.abs(page.orderSince() - week) < 5000, 'last 7 days is a rolling window');
  page.data.orderFilter = '30d';
  const month = Date.now() - 30 * 86400000;
  assert.ok(Math.abs(page.orderSince() - month) < 5000);
  page.data.orderFilter = 'today';
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  assert.equal(page.orderSince(), midnight.getTime(), 'today starts at local midnight');
});
