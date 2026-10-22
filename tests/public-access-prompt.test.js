'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const pairing = require('../miniprogram/utils/pairing');
const prompt = require('../miniprogram/utils/public-access-prompt');

function relayQr() {
  return Buffer.from(JSON.stringify({
    version: 3,
    mode: 'relay',
    relay: 'wss://dsh.ahwe.top/relay',
    nodeId: 'fixture-node',
    agentPubKey: 'A'.repeat(43) + '=',
    inviteToken: 'i'.repeat(32),
    expiresAt: Date.now() + 60000
  })).toString('base64url');
}

test('a managed relay QR is identified without showing an entitlement-blind first-use prompt', () => {
  const saved = new Map();
  let modal;
  const previousWx = global.wx;
  global.wx = {
    getStorageSync: key => saved.get(key),
    setStorageSync: (key, value) => saved.set(key, value),
    showModal: options => { modal = options; }
  };
  try {
    const raw = relayQr();
    assert.equal(pairing.parse(raw).ok, true);
    assert.equal(prompt.managedRelayPayload(raw).mode, 'relay');
    assert.equal(modal, undefined, 'expired accounts should reach the entitlement check before any onboarding copy');
    assert.equal(saved.size, 0);
  } finally {
    if (previousWx === undefined) delete global.wx;
    else global.wx = previousWx;
  }
});

test('the first-use onboarding appears only when the caller authorizes a valid public lease', () => {
  const saved = new Map();
  let modal;
  let continued = 0;
  const previousWx = global.wx;
  global.wx = {
    getStorageSync: key => saved.get(key),
    setStorageSync: (key, value) => saved.set(key, value),
    showModal: options => { modal = options; }
  };
  try {
    prompt.promptFirstAuthorizedUse(() => { continued++; });
    assert.equal(continued, 0);
    assert.equal(modal.showCancel, false);
    assert.match(modal.content, /首次连接公网节点|internet relay/);
    modal.success({ confirm: true });
    assert.equal(continued, 1);
    assert.equal(saved.size, 1);
    prompt.promptFirstAuthorizedUse(() => { continued++; });
    assert.equal(continued, 2, 'later authorized connections continue without repeating onboarding');
  } finally {
    if (previousWx === undefined) delete global.wx;
    else global.wx = previousWx;
  }
});

test('first-use notice renders in the centered page dialog and continues after confirmation', () => {
  const saved = new Map();
  let modalCalls = 0;
  let continued = 0;
  const page = {
    data: { publicAccessDialog: null, publicAccessDialogOpen: false },
    setData(patch) { Object.assign(this.data, patch); }
  };
  const previousWx = global.wx;
  const previousGetCurrentPages = global.getCurrentPages;
  global.getCurrentPages = () => [page];
  global.wx = {
    getStorageSync: key => saved.get(key),
    setStorageSync: (key, value) => saved.set(key, value),
    showModal() { modalCalls++; }
  };
  try {
    prompt.promptFirstAuthorizedUse(() => { continued++; });
    assert.equal(modalCalls, 0);
    assert.equal(page.data.publicAccessDialog.kind, 'welcome');
    assert.equal(page.data.publicAccessDialog.title, '首次使用公网连接');
    assert.equal(page.data.publicAccessDialog.actionLabel, '继续');
    assert.equal(continued, 0);
    prompt.resolvePublicAccessDialog(page);
    assert.equal(continued, 1);
    assert.equal(page.data.publicAccessDialogOpen, false);
    assert.equal(saved.size, 1);
  } finally {
    if (previousWx === undefined) delete global.wx;
    else global.wx = previousWx;
    if (previousGetCurrentPages === undefined) delete global.getCurrentPages;
    else global.getCurrentPages = previousGetCurrentPages;
  }
});

test('self-hosted relay QR codes are not classified as managed public access', () => {
  const raw = Buffer.from(JSON.stringify({
    version: 3,
    mode: 'relay',
    relay: 'wss://relay.example.test',
    nodeId: 'fixture-node',
    agentPubKey: 'A'.repeat(43) + '=',
    inviteToken: 'i'.repeat(32),
    expiresAt: Date.now() + 60000
  })).toString('base64url');
  let modal;
  const previousWx = global.wx;
  global.wx = { showModal(options) { modal = options; } };
  try {
    assert.equal(prompt.managedRelayPayload(raw), null);
    assert.equal(modal, undefined);
  } finally {
    if (previousWx === undefined) delete global.wx;
    else global.wx = previousWx;
  }
});

test('only public-access failures trigger the actionable scan modal', () => {
  let modal;
  const previousWx = global.wx;
  global.wx = { showModal: options => { modal = options; } };
  try {
    assert.equal(prompt.showPublicAccessFailure('连接超时', 'NETWORK_ERROR'), false);
    assert.equal(modal, undefined);
    assert.equal(prompt.showPublicAccessFailure('Public access has expired', 'PUBLIC_ACCESS_EXPIRED'), true);
    assert.equal(modal.showCancel, false);
    assert.match(modal.content, /Public access has expired/);
  } finally {
    if (previousWx === undefined) delete global.wx;
    else global.wx = previousWx;
  }
});

test('expired and inactive accounts get distinct centered access dialogs', () => {
  const page = {
    data: { publicAccessDialog: null, publicAccessDialogOpen: false },
    setData(patch) { Object.assign(this.data, patch); }
  };
  const previousWx = global.wx;
  const previousGetCurrentPages = global.getCurrentPages;
  global.getCurrentPages = () => [page];
  global.wx = { showModal() { assert.fail('should use the custom dialog'); } };
  try {
    assert.equal(prompt.showPublicAccessFailure('Your public access has expired', 'PUBLIC_ACCESS_EXPIRED'), true);
    assert.equal(page.data.publicAccessDialog.kind, 'expired');
    assert.equal(page.data.publicAccessDialog.title, '公网访问已到期');
    assert.equal(page.data.publicAccessDialog.content, 'Your public access has expired');
    prompt.resolvePublicAccessDialog(page);

    assert.equal(prompt.showPublicAccessFailure('Public access is inactive', 'PUBLIC_ACCESS_REQUIRED'), true);
    assert.equal(page.data.publicAccessDialog.kind, 'required');
    assert.equal(page.data.publicAccessDialog.title, '尚未开通公网访问');
  } finally {
    if (previousWx === undefined) delete global.wx;
    else global.wx = previousWx;
    if (previousGetCurrentPages === undefined) delete global.getCurrentPages;
    else global.getCurrentPages = previousGetCurrentPages;
  }
});
