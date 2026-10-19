const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const { check } = require('../scripts/check-installed-gateway.cjs');

test('gateway smoke check refuses relative or absent installation paths', async () => {
  for (const gateway of [undefined, '', './gateway']) {
    await assert.rejects(check({ gateway, management: 'http://127.0.0.1:1' }), /Absolute/);
  }
});

test('gateway smoke check never sends management requests to non-loopback origins', async () => {
  for (const management of [
    'https://example.com', 'http://192.168.1.2:3080', 'http://127.0.0.1.example.com',
    'http://user:password@127.0.0.1:3080', 'http://127.0.0.1/mgw',
    'http://127.0.0.1/?token=hidden', 'http://127.0.0.1/#fragment', 'file:///tmp/test'
  ]) {
    await assert.rejects(check({ gateway: os.tmpdir(), management }), /loopback HTTP origin/);
  }
});
