function buildItems(sessions, options = {}) {
  const currentId = options.currentSessionId || '';
  const archived = new Set(options.archivedSessionIds || []);
  const seen = new Set();
  const items = [];

  const workspaceId = options.workspaceId || null;
  (Array.isArray(sessions) ? sessions : []).forEach(session => {
    const id = session && (session.sessionId || session.id);
    if (!id || seen.has(id)) return;
    const current = id === currentId;
    if (archived.has(id) && !current) return;
    // 只列工作区里的会话：子代理（有父会话）或非 user 类型的会话不显示
    const parentId = session.parentSessionId || session.parentId || null;
    if (!current && parentId) return;
    const kind = String(session.kind || '').toLowerCase();
    if (!current && kind && kind !== 'user' && kind !== 'session') return;
    if (!current && workspaceId && session.workspaceId && session.workspaceId !== workspaceId) return;
    if (!current && (session.blank || session.hasConversation === false)) return;
    seen.add(id);
    items.push({
      sessionId: id,
      title: session.title || session.snippet || '',
      updatedAt: Number(session.updatedAt) || 0,
      running: session.running === true,
      hasUnread: session.hasUnread === true,
      agentPreset: session.agentPreset || null,
      workspaceId: session.workspaceId || null,
      cwd: session.cwd || null,
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
