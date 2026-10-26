'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

test('completion prompt issues a backend ticket only when WeChat accepts the one-time subscription', async t => {
  const storage = new Map();
  const calls = [];
  global.wx = {
    getStorageSync(key) { return storage.get(key); },
    setStorageSync(key, value) { storage.set(key, value); },
    removeStorageSync(key) { storage.delete(key); },
    showToast(options) { calls.push({ toast: options.title }); },
    requestSubscribeMessage(options) { calls.push({ templateIds: options.tmplIds }); options.success({ [options.tmplIds[0]]: 'accept' }); },
    request(options) {
      calls.push({ url: options.url, authorization: options.header.Authorization, data: options.data });
      options.success(options.url.endsWith('/me')
        ? { statusCode: 200, data: { account: {} } }
        : { statusCode: 201, data: { ticket: 't'.repeat(43), expiresAt: Date.now() + 86400000 } });
    }
  };
  t.after(() => { delete global.wx; });
  const config = require('../miniprogram/utils/access-config');
  storage.set('public-access.session.v1', JSON.stringify({ token: 's'.repeat(43), expiresAt: Date.now() + 3600000, baseUrl: config.baseUrl }));
  const notifyPref = require('../miniprogram/pages/session/utils/notify-pref');
  const subscription = require('../miniprogram/pages/session/utils/notify-subscription');
  notifyPref.setEnabled(false);
  assert.equal(await subscription.requestCompletionTicket(), '');
  assert.equal(calls.length, 0);

  notifyPref.setEnabled(true);
  assert.equal(await subscription.requestCompletionTicket(), 't'.repeat(43));
  assert.deepEqual(calls[0].templateIds, [require('../miniprogram/pages/session/utils/notify-config').TEMPLATE_ID]);
  assert.match(calls[2].url, /\/notifications\/tickets$/);
  assert.equal(calls[2].authorization, 'Bearer ' + 's'.repeat(43));
  // 模板 ID 随票据申请一起提交，服务端不再单独配置。
  assert.equal(calls[2].data.templateId, require('../miniprogram/pages/session/utils/notify-config').TEMPLATE_ID);
});

test('completion prompt never issues a ticket after decline', async t => {
  const storage = new Map([['dsh_exp_notify', true]]);
  let backendRequests = 0;
  global.wx = {
    getStorageSync(key) { return storage.get(key); },
    requestSubscribeMessage(options) { options.success({ [options.tmplIds[0]]: 'reject' }); },
    request() { backendRequests++; }
  };
  t.after(() => { delete global.wx; });
  delete require.cache[require.resolve('../miniprogram/pages/session/utils/notify-pref')];
  delete require.cache[require.resolve('../miniprogram/pages/session/utils/notify-subscription')];
  const subscription = require('../miniprogram/pages/session/utils/notify-subscription');
  assert.equal(await subscription.requestCompletionTicket(), '');
  assert.equal(backendRequests, 0);
});
