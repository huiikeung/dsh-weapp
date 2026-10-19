const test = require('node:test');
const assert = require('node:assert/strict');
const { GatewayClient } = require('../miniprogram/utils/gateway');

function fixture(t, info = {}) {
  const sockets = [];
  global.wx = { getStorageSync: () => 'fixture-device-123', setStorageSync() {}, ...info,
    connectSocket(options) { sockets.push(options); return { onOpen() {}, onMessage() {}, onError() {}, onClose() {}, close() {} }; } };
  const client = new GatewayClient();
  t.after(() => { client.disconnect(); delete global.wx; });
  return { client, sockets };
}
test('direct pairing and token reconnect send UTF-8 standard Base64 device name', t => {
  const { client, sockets } = fixture(t, { getDeviceInfo: () => ({ brand: '华为', model: '手机 📱' }) });
  for (const opts of [{ pairingCode: 'pair' }, { token: 'saved-token' }]) {
    client.connect('wss://example.com/ws/mobile', opts);
    const header = sockets.at(-1).header;
    const encoded = header['X-DSH-Device-Name'];
    assert.match(encoded, /^[A-Za-z0-9+/]*={0,2}$/);
    assert.equal(encoded.length % 4, 0);
    assert.equal(Buffer.from(encoded, 'base64').toString('utf8'), '华为 手机 📱');
    assert.equal(header['X-DSH-Device-ID'], 'fixture-device-123');
  }
});
test('device label handles legacy API, duplicated brands and unavailable device APIs', t => {
  const { client } = fixture(t, { getDeviceInfo() { throw Error('not supported'); }, getSystemInfoSync: () => ({ brand: 'HUAWEI', model: 'HUAWEI Mate' }) });
  assert.equal(client.deviceName(), 'HUAWEI Mate');
  wx.getSystemInfoSync = () => null;
  assert.equal(client.deviceName(), '小程序 fixture-');
  wx.getDeviceInfo = () => ({ brand: '\r\n华为', model: '手机\u0000\ud800' + '📱'.repeat(80) });
  const name = client.deviceName();
  assert.ok(name.length <= 80);
  assert.doesNotMatch(name, /[\u0000-\u001f\ufffd]/);
  assert.doesNotThrow(() => encodeURIComponent(name));
});
test('relay device-info reuses the same truthful label', t => {
  const { client } = fixture(t, { getDeviceInfo: () => ({ brand: 'Apple', model: 'iPhone' }) });
  let frame; client.send = value => { frame = value; return true; };
  client.reportDeviceInfo();
  assert.deepEqual(frame, { type: 'device-info', model: 'Apple iPhone' });
});
