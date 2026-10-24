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
  const store = {
    state: { gatewayCapabilities: options.capabilities || ['context-insights-v1'] },
    client: options.client === null ? null : {
      requestContextInsights: options.request || (async () => ({ kind: 'context-insights', value: { kpi: {} } }))
    },
    openSession(id) { calls.push(['open', id]); }
  };
  const wx = { stopPullDownRefresh() {}, navigateBack() {}, navigateTo() {}, showToast() {} };
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
  return { page, calls, store };
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
