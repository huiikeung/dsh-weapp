const assert = require('node:assert/strict');
const { test } = require('node:test');
const accountView = require('../miniprogram/utils/account-view');

test('account protocol balance totals render as a concrete recharge amount', () => {
  const view = accountView.normalize({
    state: { signedIn: true },
    profile: { name: 'Test User' },
    balance: { currency: 'CNY', total: 12.34 }
  });

  assert.equal(view.signedIn, true);
  assert.deepEqual(view.balance, ['¥12.34']);
  assert.equal(view.balanceText, '¥12.34');
  assert.equal(view.balanceState, 'ready');
});

test('account view accepts legacy ready wallet responses and hides signed-out balances', () => {
  const legacy = accountView.normalize({
    state: { status: 'credential-stored' },
    profile: { status: 'ready', value: { name: 'Test User' } },
    balance: { status: 'ready', value: [{ currency: 'CNY', balance: '12.34' }] }
  });
  assert.deepEqual(legacy.balance, ['¥12.34']);
  assert.equal(legacy.balanceText, '¥12.34');

  const signedOut = accountView.normalize({ state: { signedIn: false }, balance: null });
  assert.equal(signedOut.signedIn, false);
  assert.deepEqual(signedOut.balance, []);
  assert.equal(signedOut.balanceState, 'signed-out');
});

test('balance values survive status wrappers and use the topped-up amount when provided', () => {
  const ready = accountView.normalize({
    state: { signedIn: true },
    balance: { status: 'ready', currency: 'CNY', total: 20, rechargeBalance: 12.5 }
  });
  assert.deepEqual(ready.balance, ['¥12.50']);

  const wrapped = accountView.normalize({
    state: { signedIn: true },
    balance: { status: 'ok', value: { currency: 'CNY', total: 8 } }
  });
  assert.deepEqual(wrapped.balance, ['¥8.00']);
});
