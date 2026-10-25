const DEFAULT_LIMITS = Object.freeze({
  maxSessions: 32,
  maxEventsPerSession: 2048,
  maxBytesPerSession: 512 * 1024,
  maxReplayEvents: 256,
  maxReplayBytes: 256 * 1024,
  maxAgeMs: 60 * 60 * 1000,
})

function byteLength(value) {
  return Buffer.byteLength(JSON.stringify(value), 'utf8')
}

// Keep only bounded wire-safe events. Recovery succeeds only when the entire
// sequence interval is present; otherwise callers must trust a fresh snapshot.
export function createSessionReplay(options = {}) {
  const limits = { ...DEFAULT_LIMITS, ...options }
  const sessions = new Map()

  function prune(now = Date.now()) {
    for (const [sessionId, entry] of sessions) {
      if (now - entry.touchedAt > limits.maxAgeMs) sessions.delete(sessionId)
    }
    while (sessions.size > limits.maxSessions) sessions.delete(sessions.keys().next().value)
  }

  function append(sessionId, frame) {
    if (typeof sessionId !== 'string' || !sessionId || !Number.isSafeInteger(frame?.seq) || frame.seq < 0) return false
    const now = Date.now()
    prune(now)
    let entry = sessions.get(sessionId)
    if (!entry) entry = { events: [], bytes: 0, touchedAt: now }
    const copy = { ...frame }
    const bytes = byteLength(copy)
    if (bytes > limits.maxBytesPerSession) return false
    const last = entry.events[entry.events.length - 1]
    if (!last || frame.seq > last.seq) {
      entry.events.push({ seq: frame.seq, frame: copy, bytes })
    } else {
      const existing = entry.events.findIndex(item => item.seq === frame.seq)
      if (existing >= 0) {
        entry.bytes -= entry.events[existing].bytes
        entry.events.splice(existing, 1)
      }
      let low = 0, high = entry.events.length
      while (low < high) {
        const middle = (low + high) >> 1
        if (entry.events[middle].seq < frame.seq) low = middle + 1
        else high = middle
      }
      entry.events.splice(low, 0, { seq: frame.seq, frame: copy, bytes })
    }
    entry.bytes += bytes
    entry.touchedAt = now
    while (entry.events.length > limits.maxEventsPerSession || entry.bytes > limits.maxBytesPerSession) {
      const removed = entry.events.shift()
      entry.bytes -= removed.bytes
    }
    sessions.delete(sessionId)
    sessions.set(sessionId, entry)
    prune(now)
    return true
  }

  function recover(sessionId, afterSeq, throughSeq) {
    const invalid = { status: 'snapshot', events: [] }
    if (!Number.isSafeInteger(afterSeq) || afterSeq < 0 || !Number.isSafeInteger(throughSeq) || throughSeq < afterSeq) return invalid
    if (afterSeq === throughSeq) return { status: 'replayed', events: [], fromSeq: afterSeq, toSeq: throughSeq }
    if (throughSeq - afterSeq > limits.maxReplayEvents) return invalid
    prune()
    const entry = sessions.get(sessionId)
    if (!entry) return invalid
    const picked = entry.events.filter(item => item.seq > afterSeq && item.seq <= throughSeq)
    if (picked.length !== throughSeq - afterSeq) return invalid
    for (let i = 0; i < picked.length; i += 1) {
      if (picked[i].seq !== afterSeq + i + 1) return invalid
    }
    const events = picked.map(item => item.frame)
    if (byteLength(events) > limits.maxReplayBytes) return invalid
    entry.touchedAt = Date.now()
    return { status: 'replayed', events, fromSeq: afterSeq, toSeq: throughSeq }
  }

  return { append, recover }
}

