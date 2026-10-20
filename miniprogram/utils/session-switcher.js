function buildItems(sessions, options = {}) {
  const currentId = options.currentSessionId || '';
  const archived = new Set(options.archivedSessionIds || []);
  const seen = new Set();
  const items = [];

  (Array.isArray(sessions) ? sessions : []).forEach(session => {
    const id = session && (session.sessionId || session.id);
    if (!id || seen.has(id)) return;
    const current = id === currentId;
    if (archived.has(id) && !current) return;
    if (!current && (session.blank || session.hasConversation === false)) return;
    seen.add(id);
    items.push({
      sessionId: id,
      title: session.title || session.snippet || '',
      updatedAt: Number(session.updatedAt) || 0,
      running: session.running === true,
      hasUnread: session.hasUnread === true,
      agentPreset: session.agentPreset || null,
      current: current
    });
  });

  if (currentId && !seen.has(currentId)) {
    items.push({
      sessionId: currentId,
      title: options.currentTitle || '',
      updatedAt: 0,
      running: options.currentRunning === true,
      hasUnread: false,
      agentPreset: options.currentPreset || null,
      current: true
    });
  }

  return items.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

function filterItems(items, query) {
  const needle = String(query || '').trim().toLowerCase();
  if (!needle) return items;
  return (items || []).filter(item => (
    String(item.title || '').toLowerCase().includes(needle)
    || String(item.sessionId || '').toLowerCase().includes(needle)
  ));
}

module.exports = { buildItems, filterItems };
