const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const preferences = require('../miniprogram/utils/ui-preferences');

const pageFile = path.resolve(__dirname, '../miniprogram/pages/insights/insights.js');

function fixture(options = {}) {
  let definition;
  const calls = [];
  const wxCalls = { navigate: [], modals: [], clipboard: [] };
  const store = {
    state: {
      gatewayCapabilities: options.capabilities || ['context-insights-v1'],
      connection: options.connection,
      host: options.host,
      activeID: 'owner-1'
    },
    client: options.client === null ? null : {
      requestContextInsights: options.request || (async () => ({ kind: 'context-insights', value: { kpi: {} } })),
      requestAccount: options.account || (async () => ({ kind: 'account', state: {}, balance: null }))
    },
    openSession(id) { calls.push(['open', id]); }
  };
  const wx = {
    stopPullDownRefresh() {},
    navigateBack() {},
    navigateTo(args) { wxCalls.navigate.push(args && args.url); },
    showToast(args) { wxCalls.modals.push(['toast', args && args.title]); },
    showModal(args) { wxCalls.modals.push(['modal', args]); if (args && typeof args.success === 'function') args.success({ confirm: true, cancel: false }); },
    setClipboardData(args) { wxCalls.clipboard.push(args && args.data); if (args && typeof args.success === 'function') args.success(); }
  };
  vm.runInNewContext(fs.readFileSync(pageFile, 'utf8'), {
    Page: (value) => { definition = value; }, wx, console,
    setTimeout: (fn, ms) => { calls.push(['timeout', ms]); return 1; }, clearTimeout() {},
    require: (name) => {
      if (name === '../../utils/store') return store;
      if (name === '../../utils/theme') return { applyTo() {} };
      if (name === '../../utils/haptics') return { tick() {}, vibrate() {} };
      if (name === '../../utils/ui-preferences') return preferences;
      return require(path.resolve(path.dirname(pageFile), name));
    }
  });
  const page = Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch) { Object.assign(this.data, patch); }
  });
  return { page, calls, store, wxCalls };
}

test('insights page reports a restart hint when the running gateway lacks the request type', async () => {
  const { page } = fixture({
    request: async () => ({ kind: 'error', code: 'unsupported-request', requestType: 'context-insights', message: 'unknown message type: context-insights' })
  });
  page.data.sessionId = 's1';
  await page.refresh();
  assert.equal(page.data.status, 'unsupported');
  assert.match(page.data.errorText, /重启电脑端 DSH/);
});

test('insights page distinguishes a stale gateway from a capability gap', async () => {
  const { page } = fixture({ capabilities: [] });
  page.data.sessionId = 's1';
  await page.refresh();
  assert.equal(page.data.status, 'unsupported');
  assert.match(page.data.errorText, /需升级网关/);

  const retry = fixture({ request: async () => ({ kind: 'error', code: 'context-unavailable', message: 'unavailable' }) });
  retry.page.data.sessionId = 's1';
  await retry.page.refresh();
  assert.equal(retry.page.data.status, 'unsupported');
  assert.match(retry.page.data.errorText, /需升级网关/);
});

test('insights page renders the aggregated value on success and keeps errors actionable', async () => {
  const { page } = fixture({ request: async () => ({ kind: 'context-insights', value: { kpi: {}, days: [] } }) });
  page.data.sessionId = 's1';
  await page.refresh();
  assert.equal(page.data.status, 'ready');
  assert.ok(page.data.panel, 'derived panel is rendered');

  const failure = fixture({ request: async () => { throw new Error('boom'); } });
  failure.page.data.sessionId = 's1';
  await failure.page.refresh();
  assert.equal(failure.page.data.status, 'error');
  assert.equal(failure.page.data.errorText, 'boom');
});

test('insights page keeps the DSH gateway plugin as its data source', async () => {
  const sessionIds = [];
  const { page } = fixture({
    request: async (sessionId) => {
      sessionIds.push(sessionId);
      return { kind: 'context-insights', value: { sessions: [], days: [] } };
    }
  });
  page.data.sessionId = 'desktop-session';
  await page.refresh();
  assert.deepEqual(sessionIds, ['desktop-session']);
  assert.equal(page.data.status, 'ready');
});

test('insights header renders the DeepSeek balance capsule from the account frame', async () => {
  let requested = null;
  const { page, wxCalls } = fixture({
    connection: 'connected',
    host: { dshVersion: '1.2.3' },
    account: async (payload) => {
      requested = payload;
      return {
        kind: 'account',
        state: { signedIn: true, status: 'credential-stored', links: { usageUrl: 'https://platform.example/usage' } },
        profile: { name: 'tester' },
        balance: { status: 'ready', value: [{ currency: 'CNY', balance: '12.34' }], bonusWallets: [{ currency: 'CNY', balance: '5' }] }
      };
    }
  });
  await page.refreshBalance();
  assert.equal(requested.version, '1.2.3');
  assert.equal(page.data.balanceVisible, true);
  assert.equal(page.data.balanceText, '¥12.34 + ¥5.00');
  assert.deepEqual(page.data.balanceRows.map(row => row.kind), ['recharge', 'bonus']);
  assert.equal(page.data.balanceUsageUrl, 'https://platform.example/usage');
  page.openBalance();
  const modal = wxCalls.modals.find(item => item[0] === 'modal')[1];
  assert.match(modal.content, /充值余额：¥12\.34/);
  assert.match(modal.content, /赠金余额：¥5\.00/);
  assert.equal(modal.confirmText, preferences.t('复制'));
  assert.deepEqual(wxCalls.clipboard, ['https://platform.example/usage']);
});

test('balance capsule stays hidden without a signed-in account and copes with old gateways', async () => {
  const signedOut = fixture({
    connection: 'connected',
    host: { dshVersion: '1.2.3' },
    account: async () => ({ kind: 'account', state: { status: 'signed-out' }, balance: null })
  });
  await signedOut.page.refreshBalance();
  assert.equal(signedOut.page.data.balanceVisible, false);

  const unsupported = fixture({
    connection: 'connected',
    host: { dshVersion: '1.2.3' },
    account: async () => { throw Object.assign(new Error('unknown message type'), { code: 'unknown-command' }); }
  });
  await unsupported.page.refreshBalance();
  assert.equal(unsupported.page.data.balanceVisible, false);
});

test('insights header settings button opens the context panel group', () => {
  const { page, wxCalls } = fixture({});
  page.openContextSettings();
  assert.deepEqual(wxCalls.navigate, ['/pages/settings/settings?panel=context']);
});

test('insights page header and date range controls use transparent outlined buttons', () => {
  const wxss = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/insights/insights.wxss'), 'utf8');
  assert.match(wxss, /\.ins-balance\s*\{[^}]*background:\s*transparent[^}]*border:\s*1rpx solid var\(--border\)/);
  assert.match(wxss, /\.ins-head-btn\s*\{[^}]*background:\s*transparent[^}]*border:\s*1rpx solid var\(--border\)/);
  assert.match(wxss, /\.ins-ranges\s*\{[^}]*gap:\s*6rpx[^}]*overflow-x:\s*auto/);
  assert.match(wxss, /\.ins-range\s*\{[^}]*border:\s*1rpx solid var\(--border\)[^}]*background:\s*transparent/);
  assert.match(wxss, /\.ins-range\.on\s*\{[^}]*border-color:\s*var\(--border-strong\)[^}]*background:\s*transparent/);
  assert.match(wxss, /\.ins-custom-range\.is-active\s*\{[^}]*border-color:\s*var\(--border-strong\)[^}]*background:\s*transparent/);
  assert.match(wxss, /\.ins-date-picker\s*\{[^}]*border:\s*1rpx solid var\(--border\)[^}]*background:\s*transparent/);
  assert.match(wxss, /\.ins-clear-range\s*\{[^}]*border:\s*1rpx solid var\(--border\)[^}]*background:\s*transparent/);
});

test('ring legend taps focus one slice and tap again releases it', () => {
  const { page } = fixture({});
  page.toggleRingFocus({ currentTarget: { dataset: { key: 'tools' } } });
  assert.equal(page.data.ringFocus, 'tools');
  page.toggleTimingFocus({ currentTarget: { dataset: { key: 'ttft' } } });
  assert.equal(page.data.timingFocus, 'ttft');
  page.toggleRingFocus({ currentTarget: { dataset: { key: 'tools' } } });
  assert.equal(page.data.ringFocus, '');
});

test('archived session cards explain why they cannot open', () => {
  const { page, wxCalls, calls } = fixture({});
  page.openSession({ currentTarget: { dataset: { id: 'archived-session', archived: true } } });
  assert.equal(calls.filter(call => call[0] === 'open').length, 0);
  assert.ok(wxCalls.modals.some(item => item[0] === 'toast'));
});

