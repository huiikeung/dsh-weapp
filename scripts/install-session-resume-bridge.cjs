// Adds bounded, process-local event replay to a deployed mobile gateway.
// Usage: node scripts/install-session-resume-bridge.cjs <absolute gateway package> [--check]
const fs = require('node:fs');
const path = require('node:path');

function once(source, before, after) {
  if (source.includes(after)) return source;
  if (source.split(before).length !== 2) throw Error('Unsupported gateway source; nothing changed: ' + before.slice(0, 100));
  return source.replace(before, after);
}

// A gateway that already ships session resume (native upstream support, or a
// previous run of this installer) is left byte-for-byte untouched. The anchors
// below describe only the legacy pre-resume sources; requiring them would make
// reinstalling fail on an already-patched package.
function hasResumeSupport(source) {
  return source.includes('sessionReplay.append(') || source.includes('sessionReplay.recover(');
}

function hasFollowerResumeSupport(source) {
  return /const start = \([^)]*afterSeq[^)]*\) => \{/.test(source) && source.includes('{ afterSeq }');
}

function transform(source) {
  if (hasResumeSupport(source)) return source;
  const importAnchor = "import { createSessionFollower } from './session-follower.mjs'";
  source = once(source, importAnchor,
    importAnchor + "\nimport { createSessionReplay } from './session-resume-bridge.mjs'");

  const clientsAnchor = '    const clients = new Set()';
  source = once(source, clientsAnchor, clientsAnchor + '\n    const sessionReplay = createSessionReplay()');

  const snapshotReplacement = `                const recovery = context.afterSeq === undefined
                  ? { status: 'snapshot', events: [] }
                  : sessionReplay.recover(context.sessionId, context.afterSeq, frame.history.cursor)
                const resumed = context.afterSeq !== undefined && recovery.status === 'replayed'
                if (resumed) recovery.events.forEach(event => sendFrame({ ...event, ...context, resumed: true }))
                const calibrated = resumed
                  ? { ...page, events: [], bytes: 0, kind: 'session-snapshot', ...context,
                    assistantStream: frame.assistantStream, recovery: 'replayed', resumeFromSeq: context.afterSeq,
                    resumeToSeq: frame.history.cursor, replace: false }
                  : { ...page, kind: 'session-snapshot', ...context, assistantStream: frame.assistantStream,
                    recovery: recovery.status, ...(context.afterSeq === undefined ? {} : { resumeFromSeq: context.afterSeq }),
                    resumeToSeq: frame.history.cursor, replace: true }
                sendFrame(calibrated)`;
  const currentSnapshotAnchor = `                const page = historyPage(frame.history, { sessionId: context.sessionId, view: 'conversation',
                  maxBytes: ws.snapshotMaxBytes || HISTORY_OPENING_MAX_BYTES })
                rememberProjections(context.sessionId, page)
                sendFrame({ ...page,
                  kind: 'session-snapshot', ...context, assistantStream: frame.assistantStream, replace: true })`;
  if (source.includes(currentSnapshotAnchor)) {
    source = once(source, currentSnapshotAnchor,
      currentSnapshotAnchor.replace(/                sendFrame\(\{ \.\.\.page,[\s\S]*?replace: true \}\)/, snapshotReplacement));
  } else {
    const legacySnapshotAnchor = `                sendFrame({ ...historyPage(frame.history, { sessionId: context.sessionId, view: 'conversation', maxBytes: HISTORY_OPENING_MAX_BYTES }),
                  kind: 'session-snapshot', ...context, assistantStream: frame.assistantStream, replace: true })`;
    if (!source.includes('const calibrated = resumed')) {
      const legacyReplacement = `                const page = historyPage(frame.history, { sessionId: context.sessionId, view: 'conversation', maxBytes: HISTORY_OPENING_MAX_BYTES })
                rememberProjections(context.sessionId, page)
${snapshotReplacement}`;
      source = once(source, legacySnapshotAnchor, legacyReplacement);
    }
  }

  // 网关重构后 sessionId 归一化写法变了（trim() !== '' / : null）：两种形态都接受。
  const sessionIdAnchors = [
    "              const sessionId = typeof msg.sessionId === 'string' && msg.sessionId.trim() ? msg.sessionId.trim() : undefined",
    "              const sessionId = typeof msg.sessionId === 'string' && msg.sessionId.trim() !== '' ? msg.sessionId.trim() : null",
    // 订阅目标解析收进 sessionTargetFromMessage 之后的形态。
    '              const sessionId = target.sessionId',
  ];
  const sessionIdAnchor = sessionIdAnchors.find(anchor => source.includes(anchor))
    || (source.match(/^ {14}const sessionId = typeof msg\.sessionId === 'string'[^\n]*$/m) || [])[0];
  if (!sessionIdAnchor) throw Error('Unsupported gateway source; sessionId anchor not found');
  source = once(source, sessionIdAnchor, sessionIdAnchor + `
              if (msg.afterSeq !== undefined && (!Number.isSafeInteger(msg.afterSeq) || msg.afterSeq < 0)) {
                sendFrame({ kind: 'error', code: 'bad-request', requestType: 'subscribe', message: 'afterSeq must be a non-negative safe integer' })
                return
              }`);
  const resumeSessionAnchor = `              if (msg.afterSeq !== undefined && (!Number.isSafeInteger(msg.afterSeq) || msg.afterSeq < 0)) {
                sendFrame({ kind: 'error', code: 'bad-request', requestType: 'subscribe', message: 'afterSeq must be a non-negative safe integer' })
                return
              }`;
  source = once(source, resumeSessionAnchor, resumeSessionAnchor + `
              if (msg.afterSeq !== undefined && !sessionId) {
                sendFrame({ kind: 'error', code: 'bad-request', requestType: 'subscribe', message: 'afterSeq requires a sessionId' })
                return
              }`);

  const startAnchor = 'void ws.sessionFollower.start(sessionId, subscriptionId).catch(error => {';
  source = once(source, startAnchor, 'void ws.sessionFollower.start(sessionId, subscriptionId, msg.afterSeq).catch(error => {');

  const eventListenerVariants = [
    [`      api.observeSessionEvent(String(session.id), event)
      completionNotifications.onSessionEvent(String(session.id), event)
      if (clients.size === 0) return
      const wire = buildWireEvent(session, event)
      if (!wire) return`,
    `      api.observeSessionEvent(String(session.id), event)
      completionNotifications.onSessionEvent(String(session.id), event)
      const wire = buildWireEvent(session, event)
      if (wire) sessionReplay.append(String(session.id), wire)
      if (clients.size === 0 || !wire) return`],
    [`      completionNotifications.onSessionEvent(String(session.id), event)
      if (clients.size === 0) return
      const wire = buildWireEvent(session, event)
      if (!wire) return`,
    `      completionNotifications.onSessionEvent(String(session.id), event)
      const wire = buildWireEvent(session, event)
      if (wire) sessionReplay.append(String(session.id), wire)
      if (clients.size === 0 || !wire) return`],
    [`      api.observeSessionEvent(String(session.id), event)
      if (clients.size === 0) return
      const wire = buildWireEvent(session, event)
      if (!wire) return`,
    `      api.observeSessionEvent(String(session.id), event)
      const wire = buildWireEvent(session, event)
      if (wire) sessionReplay.append(String(session.id), wire)
      if (clients.size === 0 || !wire) return`],
  ];
  const listener = eventListenerVariants.find(([anchor]) => source.includes(anchor));
  if (listener) source = once(source, listener[0], listener[1]);
  else if (!source.includes('sessionReplay.append(String(session.id), wire)')) {
    throw Error('Unsupported gateway source: session event listener not found');
  }

  const capabilityAnchor = "              'assistant-stream-v1',";
  source = once(source, capabilityAnchor, capabilityAnchor + "\n              'session-resume-v1',");
  return source;
}

function transformFollower(source) {
  if (hasFollowerResumeSupport(source)) return source;
  const startAnchor = '  const start = (sessionId, subscriptionId) => {';
  source = once(source, startAnchor, '  const start = (sessionId, subscriptionId, afterSeq) => {');
  const contextAnchor = '        const context = { sessionId, subscriptionId, streamId }';
  source = once(source, contextAnchor,
    '        const context = { sessionId, subscriptionId, streamId, ...(Number.isSafeInteger(afterSeq) && afterSeq >= 0 ? { afterSeq } : {}) }');
  return source;
}

function install(root, checkOnly = false) {
  if (!root || !path.isAbsolute(root)) throw Error('An absolute gateway package directory is required');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  if (!['dsh-plugin-weapp-gateway', 'dsh-plugin-mobile-gateway'].includes(manifest.name)) throw Error('Unsupported gateway');
  const index = path.join(root, 'lib/index.mjs');
  const follower = path.join(root, 'lib/session-follower.mjs');
  const bridge = path.join(root, 'lib/session-resume-bridge.mjs');
  const original = fs.readFileSync(index, 'utf8');
  const updated = transform(original);
  const originalFollower = fs.readFileSync(follower, 'utf8');
  const updatedFollower = transformFollower(originalFollower);
  const nextBridge = fs.readFileSync(path.join(__dirname, 'lib/session-resume-bridge.mjs'), 'utf8');
  const previousBridge = fs.existsSync(bridge) ? fs.readFileSync(bridge, 'utf8') : null;
  const changes = (original !== updated ? 1 : 0) + (originalFollower !== updatedFollower ? 1 : 0) +
    (previousBridge !== nextBridge ? 1 : 0);
  if (checkOnly) return { compatible: true, changes };
  if (!changes) return { updated: 0, restartRequired: false };

  const stamp = Date.now();
  fs.writeFileSync(index + '.before-session-resume-' + stamp, original, { flag: 'wx' });
  fs.writeFileSync(follower + '.before-session-resume-' + stamp, originalFollower, { flag: 'wx' });
  if (previousBridge !== null) fs.writeFileSync(bridge + '.before-session-resume-' + stamp, previousBridge, { flag: 'wx' });
  try {
    fs.writeFileSync(bridge, nextBridge);
    fs.writeFileSync(index, updated);
    fs.writeFileSync(follower, updatedFollower);
  } catch (error) {
    fs.writeFileSync(index, original);
    fs.writeFileSync(follower, originalFollower);
    if (previousBridge !== null) fs.writeFileSync(bridge, previousBridge);
    else if (fs.existsSync(bridge)) fs.unlinkSync(bridge);
    throw error;
  }
  return { updated: changes, restartRequired: true };
}

if (require.main === module) {
  try { console.log(JSON.stringify(install(process.argv[2], process.argv.includes('--check')))); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { transform, transformFollower, install };
