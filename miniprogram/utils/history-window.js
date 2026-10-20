// Cache a recent event window, not an ever-growing conversation snapshot.
const EVENT_LIMIT = 80;
function recentWindow(cached, protocol, sessionId) {
  const source = Array.isArray(cached.events) ? cached.events : [];
  const events = source.slice(-EVENT_LIMIT);
  let rows;
  if (events.length && source.length > EVENT_LIMIT) {
    const agg = protocol.newAggregator();
    events.forEach(event => protocol.applyEvent(agg, protocol.normalizeRawEvent(event, sessionId)));
    rows = agg.rows;
  } else rows = (cached.rows || []).slice(-EVENT_LIMIT);
  const truncated = source.length > events.length || (!source.length && (cached.rows || []).length > rows.length);
  return { rows, events, savedAt: cached.savedAt, historyFormatVersion: cached.historyFormatVersion || null,
    hasMore: truncated || cached.hasMore === true,
    nextBeforeSeq: truncated && events.length ? events[0].seq : cached.nextBeforeSeq };
}
module.exports = { recentWindow, EVENT_LIMIT };
