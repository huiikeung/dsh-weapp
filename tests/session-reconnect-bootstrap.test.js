'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('a session opened offline refreshes its history and composer state after reconnect', () => {
  const file = path.resolve(__dirname, '../miniprogram/utils/store.js');
  const module = { exports: {} };
  const calls = [];
  const timers = new Map();
  let timerId = 0;

  class Client {
    constructor(callbacks) {
      this.callbacks = callbacks;
      this.connectGeneration = 1;
      this.state = 'disconnected';
      return new Proxy(this, {
        get(target, key) {
          if (key in target) return target[key];
          return (...args) => {
            calls.push({ method: key, args, state: target.state });
            return target.state === 'connected';
          };
        }
      });
    }
  }

  const wx = { getStorageSync() {}, setStorageSync() {}, removeStorageSync() {} };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    module, wx, Date, console,
    setTimeout(fn, delay) { const id = ++timerId; timers.set(id, { fn, delay }); return id; },
    clearTimeout(id) { timers.delete(id); }, setInterval: () => 1, clearInterval() {},
    require(name) {
      return name === './gateway'
        ? { GatewayClient: Client }
        : require(path.resolve(path.dirname(file), name));
    }
  }, { filename: file });

  const store = module.exports;
  store.openSession('session-offline', 'Offline session');
  assert.ok(calls.some(call => call.method === 'requestHistory' && call.state === 'disconnected'));
  assert.ok(!calls.some(call => call.method === 'requestCommands' && call.state === 'disconnected'));

  store.client.state = 'connected';
  store.client.callbacks.onState('connected');
  const historyIndex = calls.findIndex(call => call.method === 'requestHistory' && call.state === 'connected');
  assert.ok(historyIndex >= 0, 'session history is sent immediately after reconnect');
  assert.ok(!calls.some(call => call.method === 'requestWorkspaces' && call.state === 'connected'), 'home RPCs wait behind active session loading');
  assert.ok(!calls.some(call => call.method === 'requestCommands' && call.state === 'connected'), 'auxiliary session RPCs wait for the history request to start');

  for (const [id, timer] of [...timers]) {
    if (timer.delay === 250) { timers.delete(id); timer.fn(); }
  }

  for (const method of ['requestHistory', 'requestQueue']) {
    assert.ok(calls.some(call => call.method === method && call.state === 'connected'), `${method} starts after connect`);
  }
  assert.ok(!calls.some(call => [
    'requestPermissionOptions', 'requestModels', 'requestCommands', 'requestTasks', 'requestGoal',
    'requestSessionStats', 'requestContextUsage'
  ].includes(call.method)), 'optional session RPCs wait for the conversation tail');

  store.client.callbacks.onFrame({
    kind: 'history', sessionId: 'session-offline', events: [], hasMore: false
  });
  for (const [id, timer] of [...timers]) {
    if (timer.delay === 150) { timers.delete(id); timer.fn(); }
  }
  for (const method of ['requestPermissionOptions', 'requestModels', 'requestCommands', 'requestTasks', 'requestGoal']) {
    assert.ok(calls.some(call => call.method === method && call.state === 'connected'), `${method} starts after history`);
  }
  assert.ok(!calls.some(call => call.method === 'requestSessionStats' || call.method === 'requestContextUsage'),
    'log-scanning stats follow the smaller session RPCs');
  for (const [id, timer] of [...timers]) {
    if (timer.delay === 700) { timers.delete(id); timer.fn(); }
  }
  for (const method of ['requestSessionStats', 'requestContextUsage']) {
    assert.ok(calls.some(call => call.method === method && call.state === 'connected'), `${method} starts after history`);
  }
  for (const [id, timer] of [...timers]) {
    if (timer.delay === 400) { timers.delete(id); timer.fn(); }
  }
  const workspaceIndex = calls.findIndex(call => call.method === 'requestWorkspaces' && call.state === 'connected');
  assert.ok(historyIndex < workspaceIndex, 'session history is sent before home bootstrap RPCs');
});
