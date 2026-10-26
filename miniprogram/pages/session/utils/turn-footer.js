const { t } = require('../../../utils/ui-preferences');
const { compact } = require('../../../utils/turn-usage');

// Keep footer decoration out of cached entries and independent of copyable text.
function applyTurnFooters(rows, source, usageByTurn, running) {
  const groups = [], byKey = new Map();
  let group;
  (source || []).forEach(row => {
    if (!group || row.kind === 'user' || (row.turn != null && group.turn != null && row.turn !== group.turn)) {
      group = { source: [], entries: [], turn: row.turn }; groups.push(group);
    }
    if (row.turn != null) group.turn = row.turn;
    group.source.push(row); byKey.set(row.key, group);
  });
  rows.forEach(row => {
    row.copyText = row.kind === 'user' ? row.text || '' : '';
    row.copyKey = ''; row.turnMetaText = ''; row.turnMetaKey = '';
    row.turnTimeText = ''; row.turnUsage = null; row.footerVisible = false;
    const owner = byKey.get(row.key) || (row.sourceKeys || []).map(key => byKey.get(key)).find(Boolean);
    if (owner) owner.entries.push(row);
  });
  groups.forEach((item, index) => {
    const closed = item.source.some(row => row.turnClosed);
    if (running && index === groups.length - 1 && !closed) return;
    const entries = item.entries.filter(row => row.kind !== 'user');
    if (!entries.length) return;
    const target = entries[entries.length - 1];
    const answers = entries.filter(row => row.kind === 'assistant' && row.text);
    const answer = answers[answers.length - 1];
    const exact = usageByTurn && usageByTurn[item.turn];
    const samples = item.source.filter(row => row.kind === 'assistant' && Number.isFinite(row.usageTokens) && row.usageTokens >= 0);
    const total = exact && Number.isFinite(exact.totalTokens) ? exact.totalTokens
      : samples.length ? samples.reduce((sum, row) => sum + row.usageTokens, 0) : null;
    const ended = item.source.find(row => row.finishedAtMs || row.durationMs);
    if (answer) { target.copyText = answer.text; target.copyKey = answer.key; target.seq = answer.seq; }
    target.turnUsage = exact || null;
    target.turnMetaKey = target.key;
    if (total !== null) target.turnMetaText = t('用量') + ' ' + compact(total) + ' tok';
    if (ended) {
      const ms = Number(ended.durationMs) || 0;
      const date = new Date(ended.finishedAtMs || 0);
      target.turnTimeText = ended.finishedAtMs
        ? String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0')
        : ms >= 60000 ? Math.floor(ms / 60000) + 'm ' + Math.round(ms % 60000 / 1000) + 's'
          : ms >= 1000 ? Math.round(ms / 1000) + 's' : ms > 0 ? Math.round(ms) + 'ms' : '';
    }
    target.footerVisible = !!(target.copyText || target.turnMetaText || target.turnTimeText);
  });
  return rows;
}
module.exports = { applyTurnFooters };
