'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { install } = require('../dsh-console/relay/install-plugin-connector.cjs');
const root = path.join(__dirname, '../dsh-console');
const { customizeClient, customizeSupervisor, customizeGatewayMetadata } = require('../dsh-console/relay/plugin-customization.cjs');
test('gateway reports plugin version separately from host, with idempotent guarded patch', () => {
  const original = "const PLUGIN_VERSION = '0.8.6';\nconst hello = {\n            kind: 'hello',\n            ...gatewayIdentity,\n};\nreturn proxyQuery(api, 'host', api.host.describe.bind(api.host), {})";
  const result = customizeGatewayMetadata(original);
  assert.equal(customizeGatewayMetadata(result), result);
  assert.equal((result.match(/gatewayVersion: PLUGIN_VERSION/g) || []).length, 2);
  assert.throws(() => customizeGatewayMetadata('unknown'), /未修改/);
});
test('supervisor customization is idempotent, preserves third-party routing and starts under Electron', () => {
  const original = 'function create(relay) {\n  let child = null;\n const env = {\n          ...process.env,\n }; return {relay, env}; }';
  const updated = customizeSupervisor(original);
  assert.equal(customizeSupervisor(updated), updated);
  const create = new Function(updated + '; return create;')();
  for (const url of ['', 'wss://relay.ahwe.top', 'wss://relay.ahwe.top/relay/']) assert.equal(create(url).relay, 'wss://dsh.ahwe.top/relay');
  assert.equal(create('wss://private.example/relay').relay, 'wss://private.example/relay');
  assert.match(updated, /ELECTRON_RUN_AS_NODE/);
  assert.throws(() => customizeClient('unknown UI'), /未修改/);
});
test('unsupported plugin UI aborts before changing its connector', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-unknown-ui-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'relay')); fs.mkdirSync(path.join(dir, 'lib'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'dsh-plugin-weapp-gateway' }));
  const original = '// dsh-weapp-e2ee-v1 MGMT_URL keep this';
  fs.writeFileSync(path.join(dir, 'relay/agent-connector.js'), original);
  fs.writeFileSync(path.join(dir, 'lib/client.js'), 'unknown UI');
  assert.throws(() => install(dir), /未修改/);
  assert.equal(fs.readFileSync(path.join(dir, 'relay/agent-connector.js'), 'utf8'), original);
  assert.equal(fs.readdirSync(path.join(dir, 'relay')).length, 1);
});
test('plugin connector installer preserves identity, makes one backup and refuses unrelated packages', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-plugin-upgrade-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'relay'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'dsh-plugin-weapp-gateway' }));
  const old = '// dsh-weapp-e2ee-v1 MGMT_URL original connector';
  fs.writeFileSync(path.join(dir, 'relay/agent-connector.js'), old);
  fs.writeFileSync(path.join(dir, 'identity.json'), 'keep-original-device-identity');
  install(dir); install(dir);
  const backups = fs.readdirSync(path.join(dir, 'relay')).filter(n => n.includes('.before-public-access-'));
  assert.equal(backups.length, 1);
  assert.equal(fs.readFileSync(path.join(dir, 'relay', backups[0]), 'utf8'), old);
  assert.equal(fs.readFileSync(path.join(dir, 'identity.json'), 'utf8'), 'keep-original-device-identity');
  assert.equal(fs.readFileSync(path.join(dir, 'relay/agent-connector.js'), 'utf8'), fs.readFileSync(path.join(root, 'relay/agent-connector.js'), 'utf8'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'unrelated-plugin' }));
  assert.throws(() => install(dir), /未修改/);
});
function upgradeFixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-deploy-upgrade-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const bin = path.join(dir, 'bin'), backup = path.join(dir, 'private-backups');
  fs.mkdirSync(bin);
  const source = fs.readFileSync(path.join(root, 'deploy/upgrade.sh'), 'utf8');
  assert.equal(source.includes('BACKUP_ROOT=/var/backups/dsh-public'), true);
  // Redirect only the private backup directory in the test copy, never touch host deployment.
  fs.writeFileSync(path.join(dir, 'upgrade.sh'), source.replace('BACKUP_ROOT=/var/backups/dsh-public', 'BACKUP_ROOT=' + JSON.stringify(backup)));
  fs.copyFileSync(path.join(root, 'deploy/ensure-relay-auth.sh'), path.join(dir, 'ensure-relay-auth.sh'));
  const original = 'PUBLIC_DOMAIN=dsh.ahwe.top\nCONSOLE_ORIGIN=https://dsh.ahwe.top\nACCESS_MASTER_KEY=fixture-original-master\nCONSOLE_SETUP_TOKEN=fixture-original-setup\nCADDY_HTTP_BIND=127.0.0.1:18080\nCADDY_HTTPS_BIND=127.0.0.1:18443\n';
  fs.writeFileSync(path.join(dir, '.env'), original);
  const mock = [
    '#!' + process.execPath,
    "const fs = require('node:fs'), path = require('node:path');",
    'const args = process.argv.slice(2), action = args.join(" "), env = process.env;',
    'fs.appendFileSync(env.DSH_DOCKER_LOG, JSON.stringify(args) + "\\n");',
    'if (action === "compose up --help") console.log("--wait-timeout");',
    'if (env.DSH_FAIL_AT === "build" && action.startsWith("compose build")) process.exit(9);',
    'if (env.DSH_FAIL_AT === "backup" && args[0] === "run") process.exit(9);',
    'if (env.DSH_FAIL_AT === "up" && action.startsWith("compose up -d")) process.exit(9);',
    'if (args[0] === "run") { const target = args.find(a => a.endsWith(":/backup")).slice(0, -8); fs.writeFileSync(path.join(target, args.at(-1) + ".tar.gz"), "mock volume snapshot"); }'
  ].join('\n');
  fs.writeFileSync(path.join(bin, 'docker'), mock, { mode: 0o755 });
  const log = path.join(dir, 'docker-calls.jsonl');
  return { dir, original, backup, run(failure = '') {
    const result = spawnSync('bash', ['upgrade.sh'], { cwd: dir, encoding: 'utf8', env: { ...process.env, PATH: bin + path.delimiter + process.env.PATH, DSH_DOCKER_LOG: log, DSH_FAIL_AT: failure } });
    const calls = fs.readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    return { result, calls };
  } };
}
for (const failure of ['', 'build', 'backup', 'up']) {
  test('upgrade shell with mock Docker preserves configuration and handles ' + (failure || 'success'), t => {
    const f = upgradeFixture(t), { result, calls } = f.run(failure);
    assert.equal(result.status, failure ? 9 : 0, result.stdout + result.stderr);
    const after = fs.readFileSync(path.join(f.dir, '.env'), 'utf8');
    assert.equal(after.startsWith(f.original), true);
    assert.equal(after.match(/^RELAY_AUTH_SECRET=/gm).length, 1);
    assert.equal(calls.some(args => args.includes('down') || args.includes('rm')), false);
    const actions = calls.map(args => args.join(' '));
    if (failure === 'build') assert.equal(actions.includes('compose stop'), false);
    else assert.equal(actions.includes('compose stop'), true);
    if (failure === 'backup' || failure === 'up') assert.equal(actions.includes('compose start'), true);
    if (!failure) {
      const snapshot = path.join(f.backup, fs.readdirSync(f.backup)[0]);
      assert.equal(fs.readFileSync(path.join(snapshot, 'env.before-upgrade'), 'utf8'), f.original);
      assert.equal(fs.existsSync(path.join(snapshot, 'backup.tar.gz')), true);
      assert.equal(actions.includes('compose up -d --wait --wait-timeout 120'), true);
    }
  });
}
