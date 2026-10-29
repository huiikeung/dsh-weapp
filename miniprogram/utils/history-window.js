// Cache a recent event window, not an ever-growing conversation snapshot.
// Keep several pages locally so reopening and scrolling do not immediately
// depend on the gateway; the shared cache applies the serialized byte ceiling.
const EVENT_LIMIT = 2000;
function recentWindow(cached, protocol, sessionId) {
  const source = Array.isArray(cached.events) ? cached.events : [];
  const events = source.slice(-EVENT_LIMIT);
  let rows;
  if (events.length && !(cached.rows || []).length) {
    const agg = protocol.newAggregator();
    events.forEach(event => protocol.applyEvent(agg, protocol.normalizeRawEvent(event, sessionId)));
    rows = agg.rows;
  } else rows = (cached.rows || []).slice(-EVENT_LIMIT);
  const truncated = source.length > events.length || (!source.length && (cached.rows || []).length > rows.length);
  const visibleTurns = new Set();
  rows.forEach(row => {
    if (row && row.turn !== undefined && row.turn !== null) visibleTurns.add(String(row.turn));
  });
  const turnUsage = {};
  const cachedTurnUsage = cached.turnUsage || {};
  Object.keys(cachedTurnUsage).forEach(key => {
    if (visibleTurns.has(String(key))) turnUsage[key] = cachedTurnUsage[key];
  });
  return { rows, events, savedAt: cached.savedAt, historyFormatVersion: cached.historyFormatVersion || null,
    hasMore: truncated || cached.hasMore === true,
    hasMoreKnown: truncated || cached.hasMore === true || cached.hasMoreKnown === true,
    stats: cached.stats || null, turnUsage,
    nextBeforeSeq: truncated && events.length ? events[0].seq : cached.nextBeforeSeq };
}
module.exports = { recentWindow, EVENT_LIMIT };
