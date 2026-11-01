// 会话页悬浮侧栏分组：口径对齐首页抽屉与 dsh-mobile ConversationSidebar。
// 过滤空白 / 归档会话；同一会话可出现在多个所属工作区；不属于任何工作区的归入「未分组」。
const UNGROUPED_KEY = '__ungrouped__';

function buildGroups(options) {
  const opts = options || {};
  const sessions = Array.isArray(opts.sessions) ? opts.sessions : [];
  const workspaces = Array.isArray(opts.workspaces) ? opts.workspaces : [];
  const archived = new Set(Array.isArray(opts.archivedSessionIds) ? opts.archivedSessionIds : []);
  const currentId = opts.currentSessionId || '';
  const text = typeof opts.text === 'function' ? opts.text : (value) => value;
  const relativeTime = typeof opts.relativeTime === 'function' ? opts.relativeTime : () => '';
  const visible = sessions.filter((s) => s && s.hasConversation !== false && !s.blank && !archived.has(s.sessionId));
  const owned = new Set();
  workspaces.forEach((w) => (w.sessionIds || []).forEach((id) => owned.add(id)));
  const groups = workspaces.map((w) => ({
    id: w.workspaceId,
    title: w.title || text('工作区'),
    ungrouped: false,
    sessions: visible.filter((s) => (w.sessionIds || []).indexOf(s.sessionId) >= 0)
  }));
  groups.push({
    id: UNGROUPED_KEY,
    title: opts.ungroupedLabel || text('未分组'),
    ungrouped: true,
    sessions: visible.filter((s) => !owned.has(s.sessionId))
  });
  const currentGroup = groups.find((g) => g.sessions.some((s) => s.sessionId === currentId));
  const expanded = (Array.isArray(opts.expanded) ? opts.expanded : []).slice();
  // 只有首次打开侧栏时才自动展开当前工作区；之后完全尊重用户的折叠/展开选择
  if (opts.autoExpandCurrent !== false && currentGroup && expanded.indexOf(currentGroup.id) < 0) {
    expanded.push(currentGroup.id);
  }
  return {
    expanded,
    groups: groups.map((g) => ({
      id: g.id,
      title: g.title,
      ungrouped: g.ungrouped,
      containsCurrent: !!currentGroup && currentGroup.id === g.id,
      expanded: expanded.indexOf(g.id) >= 0,
      sessions: g.sessions.slice()
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
        .map((s) => ({
          id: s.sessionId,
          title: s.title || text('未命名会话'),
          running: s.running === true,
          selected: s.sessionId === currentId,
          timeText: relativeTime(s.updatedAt)
        }))
    }))
  };
}

module.exports = { UNGROUPED_KEY, buildGroups };
