const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { transform, install } = require('../scripts/install-cost-meter-bridge.cjs');

const gatewaySource = `
import { handleContextQuery, handleContextFleet, registerContextProjection, registerContextServices, CONTEXT_REQUEST_TYPES } from './context-bridge.mjs'
import { handlePluginQuery, PLUGIN_REQUEST_TYPES } from './plugin-management.mjs'

async function handleQuery(api, msg, pluginContext) {
  if (PLUGIN_REQUEST_TYPES.has(msg.type)) return handlePluginQuery(api, msg, pluginContext)
  if (CONTEXT_REQUEST_TYPES.has(msg.type)) return handleContextQuery(api, msg)
}

handleQuery(api, msg, {
  onInstallStart: (requestId) => pluginInstallOwners.set(requestId, ws),
  onInstallEnd: (requestId) => pluginInstallOwners.delete(requestId),
})

if (CONTEXT_REQUEST_TYPES.has(msg.type) || PLUGIN_REQUEST_TYPES.has(msg.type)) {
  if ((CONTEXT_REQUEST_TYPES.has(msg.type) || PLUGIN_REQUEST_TYPES.has(msg.type)) && !ws.deviceId) {
    return sendFrame({ kind: 'error' })
  }
}

const hello = {
  capabilities: [
              'context-dashboard-v1',
              'context-fleet-v1',
  ],
}
`;

const projectionGatewaySource = `
import { handleCostMeter, COST_METER_REQUEST_TYPES, registerCostMeterProjection, registerCostMeterServices } from './cost-meter-bridge.mjs'

async function handleQuery(api, msg, pluginContext) {
  if (COST_METER_REQUEST_TYPES.has(msg.type)) return handleCostMeter(api, msg)
}

if (ACCOUNT_REQUEST_TYPES.has(msg.type) || COST_METER_REQUEST_TYPES.has(msg.type) || PLUGIN_REQUEST_TYPES.has(msg.type)) {
  if ((ACCOUNT_REQUEST_TYPES.has(msg.type) || COST_METER_REQUEST_TYPES.has(msg.type) || PLUGIN_REQUEST_TYPES.has(msg.type)) && !ws.deviceId) {
    return sendFrame({ kind: 'error' })
  }
  handleQuery(api, msg, {
    onInstallEnd: (requestId) => pluginInstallOwners.delete(requestId),
    clawbotService,
  })
}

const capabilities = ['cost-meter-v1']
`;

test('installer wires cost meter into modern context-enabled gateway and is idempotent', () => {
  const installed = transform(gatewaySource);
  assert.match(installed, /import \{ handleCostMeter, COST_METER_REQUEST_TYPES \} from '\.\/cost-meter-bridge\.mjs'/);
  assert.match(installed, /if \(COST_METER_REQUEST_TYPES\.has\(msg\.type\)\) return handleCostMeter\(api, msg, \{ hostContext: pluginContext\?\.hostContext \}\)/);
  assert.match(installed, /hostContext: ctx/);
  assert.match(installed, /COST_METER_REQUEST_TYPES\.has\(msg\.type\) \|\| PLUGIN_REQUEST_TYPES\.has\(msg\.type\)/);
  assert.match(installed, /COST_METER_REQUEST_TYPES\.has\(msg\.type\) \|\| CONTEXT_REQUEST_TYPES\.has\(msg\.type\)/);
  assert.match(installed, /'cost-meter-v1'/);
  assert.equal(transform(installed), installed, 'a second install must not change the source');
});

test('installer supports the active WeChat gateway paired route and clawbot context', () => {
  const source = gatewaySource
    .replace('if (CONTEXT_REQUEST_TYPES.has(msg.type) || PLUGIN_REQUEST_TYPES.has(msg.type)) {', 'if (ACCOUNT_REQUEST_TYPES.has(msg.type) || WORKSPACE_CHANGES_TYPES.has(msg.type) || CONTEXT_REQUEST_TYPES.has(msg.type) || PLUGIN_REQUEST_TYPES.has(msg.type) || msg.type === \'clawbot-control\') {')
    .replace('if ((CONTEXT_REQUEST_TYPES.has(msg.type) || PLUGIN_REQUEST_TYPES.has(msg.type)) && !ws.deviceId) {', 'if ((ACCOUNT_REQUEST_TYPES.has(msg.type) || WORKSPACE_CHANGES_TYPES.has(msg.type) || CONTEXT_REQUEST_TYPES.has(msg.type) || PLUGIN_REQUEST_TYPES.has(msg.type) || msg.type === \'clawbot-control\') && !ws.deviceId) {')
    .replace('  onInstallEnd: (requestId) => pluginInstallOwners.delete(requestId),\n})', '  onInstallEnd: (requestId) => pluginInstallOwners.delete(requestId),\n  clawbotService,\n})')
  const installed = transform(source);
  assert.match(installed, /COST_METER_REQUEST_TYPES\.has\(msg\.type\) \|\| PLUGIN_REQUEST_TYPES\.has\(msg\.type\) \|\| msg\.type === 'clawbot-control'/);
  assert.match(installed, /ACCOUNT_REQUEST_TYPES\.has\(msg\.type\) \|\| COST_METER_REQUEST_TYPES\.has\(msg\.type\) \|\| WORKSPACE_CHANGES_TYPES\.has\(msg\.type\)/);
  assert.match(installed, /clawbotService,\n  hostContext: ctx,/);
  assert.equal(transform(installed), installed, 'the active gateway patch must also be idempotent');
});

test('installer wraps an existing projection gateway without replacing its cost bridge', () => {
  const installed = transform(projectionGatewaySource);
  assert.match(installed, /import \{ handleCostMeterWithDashboard \} from '\.\/cost-meter-dashboard-bridge\.mjs'/);
  assert.match(installed, /handleCostMeterWithDashboard\(api, msg, \{ hostContext: pluginContext\?\.hostContext \}\)/);
  assert.match(installed, /hostContext: ctx,/);
  assert.match(installed, /registerCostMeterProjection, registerCostMeterServices/);
  assert.equal(transform(installed), installed, 'the projection gateway patch must be idempotent');
});

test('install preserves the projection bridge byte-for-byte', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cost-meter-install-'));
  const lib = path.join(root, 'lib');
  fs.mkdirSync(lib, { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'dsh-plugin-weapp-gateway' }));
  fs.writeFileSync(path.join(lib, 'index.mjs'), projectionGatewaySource);
  fs.writeFileSync(path.join(lib, 'cost-meter-bridge.mjs'), 'export const userProjectionBridge = true\n');
  const originalBridge = fs.readFileSync(path.join(lib, 'cost-meter-bridge.mjs'), 'utf8');
  try {
    assert.deepEqual(install(root, true), { compatible: true, changes: 2 });
    assert.equal(install(root).updated, 2);
    assert.equal(fs.readFileSync(path.join(lib, 'cost-meter-bridge.mjs'), 'utf8'), originalBridge);
    assert.equal(fs.readFileSync(path.join(lib, 'cost-meter-dashboard-bridge.mjs'), 'utf8'),
      fs.readFileSync(path.join(__dirname, '../scripts/lib/cost-meter-dashboard-bridge.mjs'), 'utf8'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
