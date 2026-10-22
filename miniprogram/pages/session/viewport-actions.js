const { ConversationWindow } = require('../../utils/conversation-window');
const { dataPatch } = require('../../utils/session-render');
module.exports = {
  conversationWindowPatch(rows) {
    if (!this._conversationWindow || this._windowSession !== this._renderSessionId) {
      this._conversationWindow = new ConversationWindow(); this._windowSession = this._renderSessionId;
    }
    const window = this._conversationWindow;
    const anchor = window.rows[window.indexAt(this._lastScrollTop || 0)];
    const offset = (this._lastScrollTop || 0) - window.offsets[window.indexAt(this._lastScrollTop || 0)];
    this._conversationRows = rows; window.update(rows);
    let top = this._lastScrollTop || 0;
    if (this._convPinned !== false) {
      return window.select(Math.max(0, window.offsets[rows.length] - 700), 700, Math.max(0, rows.length - 12));
    }
    const index = anchor ? rows.findIndex(row => row.key === anchor.key) : -1;
    if (index >= 0) top = Math.max(0, window.offsets[index] + offset);
    const patch = window.select(top, this._convClientHeight || 700);
    if (Math.abs(top - (this._lastScrollTop || 0)) > 1) { patch.conversationScrollTop = top; this._lastScrollTop = top; }
    return patch;
  },
  updateConversationWindow(top) {
    const window = this._conversationWindow;
    if (!window) return;
    const patch = dataPatch(this.data, window.select(top, this._convClientHeight || 700));
    if (Object.keys(patch).length) this.setData(patch, () => {
      this.scheduleHistoryFormatting(); this.measureConversationWindow();
      // 滚动带出的新图也需要回填本地缓存路径，否则进入窗口后是空白图。
      if (typeof this.scheduleAttachmentThumbs === 'function') this.scheduleAttachmentThumbs();
    });
  },
  revealConversationRow(key) {
    const window = this._conversationWindow; if (!window) return;
    const index = window.rows.findIndex(row => row.key === key); if (index < 0) return;
    this.setData(dataPatch(this.data, window.select(window.offsets[index], this._convClientHeight || 700, index)));
    this.scheduleHistoryFormatting();
  },
  measureConversationWindow() {
    if (this._windowMeasurePending || this._unloaded || this._voiceHidden || this.data.tab !== 'conversation' || typeof wx === 'undefined' || typeof wx.createSelectorQuery !== 'function') return;
    const window = this._conversationWindow; if (!window) return;
    const keys = this.data.rows.map(row => row.key);
    this._windowMeasurePending = true;
    wx.createSelectorQuery().in(this).selectAll('.conversation-window-row').boundingClientRect(rects => {
      this._windowMeasurePending = false;
      if (this._unloaded || this._voiceHidden || window !== this._conversationWindow || keys.join('|') !== this.data.rows.map(row => row.key).join('|')) return;
      const index = window.indexAt(this._lastScrollTop || 0), oldOffset = window.offsets[index];
      let changed = false;
      (rects || []).forEach((rect, i) => {
        if (rect.height > 0 && Math.abs((window.heights.get(keys[i]) || 0) - rect.height) > 1) { window.heights.set(keys[i], rect.height); changed = true; }
      });
      if (!changed) return;
      window.update(window.rows);
      const patch = dataPatch(this.data, window.patch());
      if (this._convPinned === false && window.offsets[index] !== oldOffset) {
        patch.conversationScrollTop = Math.max(0, (this._lastScrollTop || 0) + window.offsets[index] - oldOffset);
        this._lastScrollTop = patch.conversationScrollTop;
      }
      if (Object.keys(patch).length) this.setData(patch);
      if (this._convPinned !== false) this.refreshBottomAnchor();
    }).exec();
  }
};
