// Variable-height window. Offscreen messages stay in logic memory, not WXML.
class ConversationWindow {
  constructor() { this.rows = []; this.heights = new Map(); this.offsets = [0]; this.start = 0; this.end = 0; }
  update(rows) {
    this.rows = rows; this.offsets = [0];
    for (const row of rows) {
      const estimate = estimateRowHeight(row);
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
  shouldShiftForScroll(top, height) {
    if (!this.rows.length || this.start >= this.end) return true;
    const firstVisible = this.indexAt(top);
    const lastVisible = this.indexAt(top + height);
    // Keep a stable DOM window through most of a swipe. Replacing keyed rows
    // on every crossed row makes the native scroll-view repeatedly re-layout.
    return firstVisible < this.start + 4 || lastVisible >= this.end - 6;
  }
  patch() {
    return { rows: this.rows.slice(this.start, this.end),
      conversationTopSpace: this.offsets[this.start] || 0,
      conversationBottomSpace: this.offsets[this.rows.length] - (this.offsets[this.end] || 0) };
  }
}

function estimateTextHeight(text, charsPerLine, lineHeight) {
  const value = String(text || '');
  if (!value) return 0;
  return estimateLengthHeight(value.length, charsPerLine, lineHeight);
}

function estimateLengthHeight(length, charsPerLine, lineHeight) {
  if (!(length > 0)) return 0;
  return Math.max(lineHeight, Math.ceil(length / charsPerLine) * lineHeight);
}

function estimateRowHeight(row) {
  if (row.kind === 'assistant') {
    const textHeight = estimateTextHeight(row.text, 28, 24);
    const imageCount = (row.images || []).length;
    const imageHeight = imageCount ? Math.ceil(imageCount / 2) * 280 : 0;
    const attachmentHeight = (row.attachments || []).length * 48;
    // Keep long replies proportional; the old 1400px cap badly undercounted
    // tall answers and moved every virtual row after them by thousands of px.
    return Math.max(100, 48 + textHeight + imageHeight + attachmentHeight);
  }

  if (row.kind === 'user') {
    const imageCount = (row.images || []).length;
    if (!imageCount) return 100;
    const imageHeight = imageCount === 1
      ? Math.max(0, Number(row.singleHeight) || 640) * 0.5
      : Math.max(0, Number(row.stackHeight) || 328) * 0.5;
    return Math.max(100, 24 + imageHeight + estimateTextHeight(row.text, 22, 24)
      + (row.text ? 20 : 0));
  }

  if (row.kind === 'processGroup' && row.processBodyVisible) {
    if (row.processBodyCapped) return 460;
    const bodyText = (row.children || []).reduce((length, child) => length
      + String(child.text || child.preview || '').length
      + (child.tools || []).reduce((sum, tool) => sum
        + String(tool.argumentsText || '').length + String(tool.resultText || '').length, 0), 0);
    return Math.max(100, 56 + estimateLengthHeight(bodyText, 28, 24));
  }

  return 100;
}

module.exports = { ConversationWindow };
