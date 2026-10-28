// Variable-height window. Offscreen messages stay in logic memory, not WXML.
//
// Height estimates must track session.wxss closely: the conversation column is
// 750rpx wide minus 40rpx padding on each side (≈335px), markdown paragraphs are
// 32rpx (≈16.7px) with line-height 1.6 (≈27px) and 10rpx block margins. When the
// estimate drifts from the rendered row, every measured correction moves the
// spacers and the viewport jumps — that was the "page keeps bouncing" report.
//
// Conversations that fit in a few viewports are rendered whole: with no top or
// bottom spacer the document height is the rendered height, so estimates never
// reach the layout at all and scrolling stays exact.
class ConversationWindow {
  constructor() { this.rows = []; this.heights = new Map(); this.offsets = [0]; this.start = 0; this.end = 0; this.full = false; }
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
    const total = this.offsets[this.rows.length] || 0;
    const limit = Math.max(FULL_RENDER_MIN_PX, Math.min(FULL_RENDER_MAX_PX, (Number(height) || 700) * FULL_RENDER_VIEWPORTS));
    if (this.rows.length <= FULL_RENDER_MAX_ROWS && total <= limit) {
      // 整段渲染：上下占位都是 0，文档高度就是真实渲染高度，估算值完全不参与布局。
      this.full = true; this.start = 0; this.end = this.rows.length;
      return this.patch();
    }
    this.full = false;
    const index = target == null ? this.indexAt(top) : target;
    this.start = Math.max(0, index - 6);
    this.end = Math.min(this.rows.length, Math.max(index + 12, this.indexAt(top + height) + 7));
    this.end = Math.min(this.end, this.start + 40);
    return this.patch();
  }
  shouldShiftForScroll(top, height) {
    if (!this.rows.length || this.full) return false;
    if (this.start >= this.end) return true;
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

// 整段渲染阈值：行数不多且估算总高落在几个视口内时不做虚拟化。
const FULL_RENDER_MAX_ROWS = 80;
const FULL_RENDER_MIN_PX = 4000;
const FULL_RENDER_MAX_PX = 12000;
const FULL_RENDER_VIEWPORTS = 8;

// session.wxss 实测推导出来的排版参数（px）。
const PARA_LINE_PX = 27;        // .md-para 32rpx × line-height 1.6
const PARA_PER_LINE = 20;       // 335px 文本列 / 16.7px 字号
const BLOCK_MARGIN_PX = 10.4;   // .md-block margin 10rpx 0
const ASSISTANT_PAD_PX = 25;    // .row-assistant padding 24rpx 0
const BUBBLE_PAD_PX = 20.8;     // .row-user-bubble padding 20rpx 28rpx
const BUBBLE_LINE_PX = 25.7;    // .row-user-text 34rpx × 1.45
const BUBBLE_PER_LINE = 15;     // (335 - 58)px / 17.7px
const IMAGE_BLOCK_PX = 220;     // markdown 图片块近似高度
const ATTACHMENT_PX = 48;

/** 中日韩字符占一个字宽，其余约 0.55 个字宽。 */
function textUnits(text) {
  const value = String(text || '');
  let units = 0;
  for (const char of value) {
    const code = char.codePointAt(0);
    const wide = (code >= 0x1100 && code <= 0x115f) || (code >= 0x2e80 && code <= 0xa4cf)
      || (code >= 0xac00 && code <= 0xd7a3) || (code >= 0xf900 && code <= 0xfaff)
      || (code >= 0xfe30 && code <= 0xfe6f) || (code >= 0xff00 && code <= 0xff60)
      || (code >= 0xffe0 && code <= 0xffe6) || code > 0x20000;
    units += wide ? 1 : 0.55;
  }
  return units;
}

function paragraphCount(text) {
  const value = String(text || '');
  if (!value.trim()) return 0;
  return value.split(/\n\s*\n/).filter(part => part.trim()).length;
}

function lineCount(text, perLine) {
  const value = String(text || '');
  if (!value) return 0;
  let lines = 0;
  for (const paragraph of value.split(/\n+/)) {
    const units = textUnits(paragraph);
    if (units > 0) lines += Math.max(1, Math.ceil(units / perLine));
  }
  return lines;
}

function estimateRowHeight(row) {
  if (row.kind === 'assistant') {
    const textHeight = lineCount(row.text, PARA_PER_LINE) * PARA_LINE_PX;
    const imageHeight = (row.images || []).length * IMAGE_BLOCK_PX;
    const attachmentHeight = (row.attachments || []).length * ATTACHMENT_PX;
    const blocks = Math.max(1, paragraphCount(row.text));
    return Math.max(60, ASSISTANT_PAD_PX + textHeight + blocks * BLOCK_MARGIN_PX + imageHeight + attachmentHeight);
  }

  if (row.kind === 'user') {
    const imageCount = (row.images || []).length;
    const textHeight = lineCount(row.text, BUBBLE_PER_LINE) * BUBBLE_LINE_PX;
    if (!imageCount) {
      return Math.max(60, BUBBLE_PAD_PX + textHeight + (row.text ? 8 : 0));
    }
    const imageHeight = imageCount === 1
      ? Math.max(0, Number(row.singleHeight) || 640) * 0.5
      : Math.max(0, Number(row.stackHeight) || 328) * 0.5;
    return Math.max(60, BUBBLE_PAD_PX + imageHeight + textHeight + (row.text ? 20 : 0));
  }

  if (row.kind === 'processGroup' && row.processBodyVisible) {
    if (row.processBodyCapped) return 460;
    const bodyText = (row.children || []).reduce((length, child) => length
      + String(child.text || child.preview || '').length
      + (child.tools || []).reduce((sum, tool) => sum
        + String(tool.argumentsText || '').length + String(tool.resultText || '').length, 0), 0);
    return Math.max(100, 56 + lineCount(String(bodyText), PARA_PER_LINE) * PARA_LINE_PX);
  }

  return 100;
}

module.exports = { ConversationWindow, estimateRowHeight };
