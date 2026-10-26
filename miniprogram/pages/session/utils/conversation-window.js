// Variable-height window. Offscreen messages stay in logic memory, not WXML.
class ConversationWindow {
  constructor() { this.rows = []; this.heights = new Map(); this.offsets = [0]; this.start = 0; this.end = 0; }
  update(rows) {
    this.rows = rows; this.offsets = [0];
    for (const row of rows) {
      const estimate = row.kind === 'assistant' ? Math.max(100, Math.min(1400, String(row.text || '').length / 28 * 24)) : 100;
      this.offsets.push(this.offsets[this.offsets.length - 1] + (this.heights.get(row.key) || estimate));
    }
  }
  indexAt(top) {
    let lo = 0, hi = this.rows.length;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (this.offsets[mid + 1] <= top) lo = mid + 1; else hi = mid; }
    return Math.min(lo, Math.max(0, this.rows.length - 1));
  }
  select(top, height, target) {
    const index = target == null ? this.indexAt(top) : target;
    this.start = Math.max(0, index - 6);
    this.end = Math.min(this.rows.length, Math.max(index + 12, this.indexAt(top + height) + 7));
    this.end = Math.min(this.end, this.start + 40);
    return this.patch();
  }
  patch() {
    return { rows: this.rows.slice(this.start, this.end),
      conversationTopSpace: this.offsets[this.start] || 0,
      conversationBottomSpace: this.offsets[this.rows.length] - (this.offsets[this.end] || 0) };
  }
}
module.exports = { ConversationWindow };
