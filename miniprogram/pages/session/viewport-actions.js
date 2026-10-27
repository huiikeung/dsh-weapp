const { ConversationWindow } = require('./utils/conversation-window');
const { dataPatch } = require('./utils/session-render');
module.exports = {
  conversationWindowPatch(rows, options) {
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
    if (options && options.anchor && anchor) {
      // 历史页插入时改用 scroll-into-view 钉住原来视口顶部的消息：原生滚动
      // 定位不会先按错误的估算高度跳一下，再被测量结果二次修正。
      patch.scrollTarget = anchor.key;
      patch.scrollAnim = false;
      this._lastScrollTop = top;
      this._scrollAnchorAt = Date.now();
      return patch;
    }
    if (Math.abs(top - (this._lastScrollTop || 0)) > 1) {
      patch.conversationScrollTop = top;
      this._lastScrollTop = top;
      this._programmaticScrollAt = Date.now();
      this._programmaticScrollTop = top;
    }
    return patch;
  },
  updateConversationWindow(top) {
    const window = this._conversationWindow;
    if (!window) return;
    const height = this._convClientHeight || 700;
    if (!window.shouldShiftForScroll(top, height)) return;
    const patch = dataPatch(this.data, window.select(top, height));
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
    const gesture = this._panelGesture;
    const touchingConversation = gesture && gesture.tab === 'conversation';
    const scrollQuietFor = Date.now() - (this._lastConvScrollAt || 0);
    const settlingScroll = this._convPinned === false && this._lastConvScrollAt && scrollQuietFor < 160;
    if (touchingConversation || settlingScroll) {
      if (!this._windowMeasureTimer) {
        const wait = touchingConversation ? 120 : Math.max(16, 160 - scrollQuietFor);
        this._windowMeasureTimer = setTimeout(() => {
          this._windowMeasureTimer = null;
          this.measureConversationWindow();
        }, wait);
      }
      return;
    }
    const keys = this.data.rows.map(row => row.key);
    this._windowMeasurePending = true;
    const query = wx.createSelectorQuery().in(this);
    query.select('.conversation').boundingClientRect();
    const offsetQuery = query.select('.conversation');
    const hasScrollOffset = !!(offsetQuery && typeof offsetQuery.scrollOffset === 'function');
    if (hasScrollOffset) offsetQuery.scrollOffset();
    query.selectAll('.conversation-window-row').boundingClientRect();
    query.exec((res) => {
      this._windowMeasurePending = false;
      if (this._unloaded || this._voiceHidden || window !== this._conversationWindow || keys.join('|') !== this.data.rows.map(row => row.key).join('|')) return;
      // The selector query can finish after a swipe has started. Do not apply a
      // stale height correction to the native scroll position mid-gesture.
      const currentGesture = this._panelGesture;
      const currentScrollQuietFor = Date.now() - (this._lastConvScrollAt || 0);
      if ((currentGesture && currentGesture.tab === 'conversation')
        || (this._convPinned === false && this._lastConvScrollAt && currentScrollQuietFor < 160)) {
        this.measureConversationWindow();
        return;
      }
      const viewport = res && res[0];
      const nativeOffset = hasScrollOffset && res ? res[1] : null;
      const rects = (res && res[hasScrollOffset ? 2 : 1]) || [];
      const viewportTop = viewport && Number(viewport.top);
      const viewportBottom = viewport && Number(viewport.bottom);
      const visibleRow = Number.isFinite(viewportTop) && Number.isFinite(viewportBottom)
        ? rects.findIndex(rect => rect && rect.height > 0 && rect.bottom > viewportTop + 1 && rect.top < viewportBottom - 1)
        : -1;
      const anchorIndex = visibleRow >= 0 && keys[visibleRow]
        ? window.rows.findIndex(row => row.key === keys[visibleRow])
        : -1;
      const oldAnchorOffset = anchorIndex >= 0 ? window.offsets[anchorIndex] : 0;
      let changed = false;
      (rects || []).forEach((rect, i) => {
        if (rect.height > 0 && Math.abs((window.heights.get(keys[i]) || 0) - rect.height) > 1) { window.heights.set(keys[i], rect.height); changed = true; }
      });
      if (!changed) {
        if (this._initialConversationAnchorApplied && this.data.scrollTarget === 'conv-bottom') {
          this._initialConversationAnchorApplied = false;
        }
        return;
      }
      window.update(window.rows);
      const patch = dataPatch(this.data, window.patch());
      const anchoring = this._scrollAnchorAt && Date.now() - this._scrollAnchorAt < 800;
      // Anchor to the first actually visible row, not the row guessed from cumulative estimates.
      // Large variable-height messages can make that guessed index drift and jump on release.
      if (!anchoring && this._convPinned === false && anchorIndex >= 0 && window.offsets[anchorIndex] !== oldAnchorOffset) {
        // Reopen and first-render paths can leave the cached offset behind the native view.
        // Base the correction on the measured scroll position to avoid a one-time snap.
        const currentTop = nativeOffset && Number.isFinite(Number(nativeOffset.scrollTop))
          ? Number(nativeOffset.scrollTop) : (this._lastScrollTop || 0);
        patch.conversationScrollTop = Math.max(0, currentTop + window.offsets[anchorIndex] - oldAnchorOffset);
        this._lastScrollTop = patch.conversationScrollTop;
        this._programmaticScrollAt = Date.now();
        this._programmaticScrollTop = patch.conversationScrollTop;
      }
      if (Object.keys(patch).length) this.setData(patch);
      if (this._convPinned !== false) {
        if (this._initialConversationAnchorApplied && this.data.scrollTarget === 'conv-bottom') {
          this._initialConversationAnchorApplied = false;
        } else {
          this.refreshBottomAnchor();
        }
      }
    });
  }
};
