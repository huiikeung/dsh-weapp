// The standalone deployable service keeps its integration suite with the package.
require('../dsh-console/services/public-access/test/console.test.cjs');
require('../dsh-console/services/public-access/test/managed-devices.test.cjs');

const test = require('node:test');
const assert = require('node:assert/strict');
test('web console relay pairing shape is accepted by the miniapp', () => {
  const nodeId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  const raw = Buffer.from(JSON.stringify({ version: 3, mode: 'relay', relay: 'wss://relay.example.test',
    nodeId, agentPubKey: Buffer.alloc(32, 7).toString('base64'), pairingCode: 'fixture-pairing-credential-123456',
    expiresAt: Date.now() + 120000, gatewayName: '验收节点' })).toString('base64url');
  const result = require('../miniprogram/utils/pairing.js').parse(raw);
  assert.equal(result.ok, true);
  assert.equal(result.payload.authMode, 'gateway');
  assert.equal(result.payload.nodeId, nodeId);
});
