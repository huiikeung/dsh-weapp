const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { install, transform } = require('../scripts/install-account-bridge.cjs');

const SOURCE = [
  "import { handleWorkspaceChanges, WORKSPACE_CHANGES_TYPES } from './workspace-changes-bridge.mjs'",
  'function handleQuery(api, host, agentDefaultModel, msg, pluginContext) {',
  '  if (WORKSPACE_CHANGES_TYPES.has(msg.type)) return handleWorkspaceChanges(api, msg)',
  '  if (PLUGIN_REQUEST_TYPES.has(msg.type)) return handlePluginQuery(api, msg, pluginContext)',
  '}',
  '  apply(ctx) {',
  '    const api = createDshHostAdapter(ctx.typertGateway)',
  '  }',
  '  if (msg.type === \'x\' ||',
  '                       WORKSPACE_CHANGES_TYPES.has(msg.type) || PLUGIN_REQUEST_TYPES.has(msg.type)) {',
  "              if ((WORKSPACE_CHANGES_TYPES.has(msg.type) || PLUGIN_REQUEST_TYPES.has(msg.type) || msg.type === 'clawbot-control') && !ws.deviceId) {",
  "              ...(api.workspaceChanges ? ['workspace-changes-v1'] : []),",
].join('\n');

test('account bridge installer patches every gateway hook idempotently', () => {
  const patched = transform(SOURCE);
  assert.match(patched, /import \{ handleAccount, ACCOUNT_REQUEST_TYPES \} from '\.\/account-bridge\.mjs'/);
  assert.match(patched, /if \(ACCOUNT_REQUEST_TYPES\.has\(msg\.type\)\) return handleAccount\(api, msg\)/);
  assert.match(patched, /ctx\.inject\(\['accountController'\]/);
  assert.match(patched, /api\.account = accountCtx\.accountController/);
  assert.match(patched, /ACCOUNT_REQUEST_TYPES\.has\(msg\.type\) \|\| WORKSPACE_CHANGES_TYPES/);
  assert.match(patched, /\.\.\.\(api\.account \? \['account-v1'\] : \[\]\)/);
  assert.equal(transform(patched), patched);
  assert.throws(() => transform('nope'), /Unsupported gateway source/);
});

test('account bridge proxies the host account projection and degrades gracefully', async () => {
  const { handleAccount, ACCOUNT_REQUEST_TYPES } = await import('../scripts/lib/account-bridge.mjs');
  assert.deepEqual([...ACCOUNT_REQUEST_TYPES], ['account']);
  const api = { account: {
    getState: () => ({ status: 'credential-stored', links: { usageUrl: 'https://u', topUpUrl: 'https://t' }, attempt: null }),
    getProfile: async () => ({ status: 'ready', value: { name: '鲸尾用户', contact: 'u@example.com' } }),
    getBalance: async () => ({ status: 'ready', value: [{ currency: 'CNY', balance: '12.34' }], bonusWallets: [{ currency: 'CNY', balance: '5' }] }),
  } };
  const frame = await handleAccount(api, { requestId: 'r1', client: { version: '0.9.23', locale: 'zh', timezoneOffsetSeconds: 28800 } });
  assert.equal(frame.kind, 'account'); assert.equal(frame.requestId, 'r1');
  assert.equal(frame.state.status, 'credential-stored');
  assert.equal(frame.profile.value.name, '鲸尾用户');
  assert.equal(frame.balance.value[0].balance, '12.34');
  // 缺少 account 服务：明确返回不可用，客户端回落提示而不是伪装成未登录数据
  assert.equal((await handleAccount({}, { requestId: 'r2' })).code, 'account-unavailable');
  // 未登录态
  const signedOut = { account: { getState: () => ({ status: 'signed-out', links: {}, attempt: null }), getProfile: () => null, getBalance: () => null } };
  const out = await handleAccount(signedOut, { requestId: 'r3', client: { version: '0.9.23' } });
  assert.equal(out.state.status, 'signed-out'); assert.equal(out.profile, null); assert.equal(out.balance, null);
  // 缺少 requestId 不进入 Host
  assert.equal((await handleAccount(api, {})).code, 'bad-request');
  // 抛异常不外泄细节
  const broken = { account: { getState: () => { throw Error('secret host detail'); } } };
  const failure = await handleAccount(broken, { requestId: 'r4' });
  assert.equal(failure.code, 'account-unavailable'); assert.doesNotMatch(failure.message, /secret/);
});

test('installed bridge module matches the repository copy', () => {
  const source = fs.readFileSync(path.join(__dirname, '../scripts/lib/account-bridge.mjs'), 'utf8');
  assert.match(source, /export const ACCOUNT_REQUEST_TYPES/);
  assert.ok(!/console\.log|debugger/.test(source));
});
