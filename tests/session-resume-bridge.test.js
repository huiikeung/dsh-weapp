'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

test('gateway replay resumes only complete bounded sequence intervals', async () => {
  const { createSessionReplay } = await import('../scripts/lib/session-resume-bridge.mjs');
  const replay = createSessionReplay({ maxReplayEvents: 4, maxReplayBytes: 4096, maxEventsPerSession: 5 });
  const frame = seq => ({ kind: 'event', seq, time: seq, event: { type: 'turn/start' } });
  replay.append('s1', frame(4));
  replay.append('s1', frame(5));
  replay.append('s1', frame(6));
  assert.deepEqual(replay.recover('s1', 3, 6).events.map(item => item.seq), [4, 5, 6]);
  assert.equal(replay.recover('s1', 2, 6).status, 'snapshot', 'evicted prefix must not claim continuity');
  assert.equal(replay.recover('s1', 3, 7).status, 'snapshot', 'missing live event must trigger calibration');
  assert.equal(replay.recover('s1', 6, 6).status, 'replayed');
  assert.equal(replay.append('s1', { seq: -1 }), false);
});

test('replay ring enforces event and byte caps without returning partial recovery', async () => {
  const { createSessionReplay } = await import('../scripts/lib/session-resume-bridge.mjs');
  const replay = createSessionReplay({ maxEventsPerSession: 2, maxBytesPerSession: 256, maxReplayEvents: 8, maxReplayBytes: 128 });
  for (let seq = 1; seq <= 3; seq += 1) {
    replay.append('s', { kind: 'event', seq, event: { type: 'user/message', text: 'x' } });
  }
  assert.equal(replay.recover('s', 0, 3).status, 'snapshot');
  assert.equal(replay.recover('s', 1, 3).status, 'snapshot', 'partial recovery above byte limit is rejected');
});

test('session resume installer patches both gateway variants and is idempotent', (t) => {
  const { transform } = require('../scripts/install-session-resume-bridge.cjs');
  const roots = [
    path.resolve(__dirname, '../../dsh-plugin-weapp-gateway'),
    path.join(os.homedir(), '.dsh/profiles/desktop/local-plugins/dsh-plugin-weapp-gateway'),
    path.join(os.homedir(), '.dsh/profiles/desktop/local-plugins/dsh-plugin-mobile-gateway'),
  ].filter((root, index, all) => all.indexOf(root) === index && fs.existsSync(path.join(root, 'lib/index.mjs')));
  if (!roots.length) return t.skip('no installed gateway package on this machine');
  for (const root of roots) {
    const source = fs.readFileSync(path.join(root, 'lib/index.mjs'), 'utf8');
    // Gateways that already ship session resume (native upstream support or a
    // previous installer run) must be left untouched, so their call shapes are
    // the gateway's own rather than this installer's legacy anchors.
    const nativeResume = source.includes("'session-resume-v1'");
    const patched = transform(source);
    const followerSource = fs.readFileSync(path.join(root, 'lib/session-follower.mjs'), 'utf8');
    const { transformFollower } = require('../scripts/install-session-resume-bridge.cjs');
    const patchedFollower = transformFollower(followerSource);
    assert.ok(patched.includes("'session-resume-v1'"));
    assert.ok(patched.includes('sessionReplay.recover(context.sessionId, context.afterSeq, frame.history.cursor)'));
    assert.ok(patched.includes("recovery: 'replayed', resumeFromSeq: context.afterSeq"));
    assert.ok(patched.includes('events: [], bytes: 0'));
    assert.ok(patched.includes("recovery: recovery.status"));
    assert.ok(patched.includes('sessionReplay.append(String(session.id), wire)'));
    if (nativeResume) {
      assert.equal(patched, source, 'already-patched gateway source is left untouched');
      assert.ok(patched.includes('sessionReplay.recover('), 'native source keeps its own replay wiring');
    } else {
      assert.ok(patched.includes('ws.sessionFollower.start(sessionId, subscriptionId, msg.afterSeq)'));
    }
    assert.equal(transform(patched), patched, 'installer can safely rerun');
    assert.ok(patchedFollower.includes('{ afterSeq }'));
    if (nativeResume) {
      assert.equal(patchedFollower, followerSource, 'already-patched follower source is left untouched');
      assert.ok(patchedFollower.includes('afterSeq'), 'native follower keeps afterSeq support');
    } else {
      assert.ok(patchedFollower.includes('const start = (sessionId, subscriptionId, afterSeq) => {'));
    }
    assert.equal(transformFollower(patchedFollower), patchedFollower, 'follower patch can safely rerun');
  }
});
