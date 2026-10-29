const { ConversationWindow } = require('./utils/conversation-window');
const { dataPatch } = require('./utils/session-render');
const WINDOW_SHIFT_INTERVAL = 32;
const MANUAL_SCROLL_SETTLE_MS = 800;
function hasRecentConversationTouch(page) {
  const touchedAt = Number(page._lastTouchAt) || 0;
  return touchedAt > 0 && Date.now() - touchedAt < MANUAL_SCROLL_SETTLE_MS;
}
// 只有「触摸之后真的发生过滚动」才按 settling 处理。单击（触摸后没有滚动事件）
// 必须立刻测量：否则点「已完成」后的高度校正要等 800ms 才发生，看上去就是
// 「点了没反应/延迟很大」，而且校正落地时还会把视图推走一格。
function settlingAfterTouch(page) {
  const gestureAt = Number(page._lastConversationGestureAt) || 0;
  if (gestureAt > 0 && Date.now() - gestureAt < MANUAL_SCROLL_SETTLE_MS) return true;
  const touchedAt = Number(page._lastTouchAt) || 0;
  if (!touchedAt) return false;
  return (page._lastConvScrollAt || 0) >= touchedAt && Date.now() - touchedAt < MANUAL_SCROLL_SETTLE_MS;
}
function hasVisiblePendingHistoryFormatting(page) {
  const pending = page._pendingHistoryFormat;
  if (!pending || !pending.size) return false;
  const visible = new Set();
  (page.data.rows || []).forEach(row => {
    if (!row) return;
    if (row.key) visible.add(row.key);
    if (row.kind === 'processGroup') (row.children || []).forEach(child => {
      const key = child && (child.formatKey || child.sourceKey);
      if (key) visible.add(key);
    });
  });
  for (const key of pending.keys()) if (visible.has(key)) return true;
  return false;
}
module.exports = {
  conversationWindowPatch(rows, options) {
    if (!this._conversationWindow || this._windowSession !== this._renderSessionId) {
      if (this._windowShiftTimer) clearTimeout(this._windowShiftTimer);
      this._windowShiftTimer = null;
      this._pendingWindowScrollTop = null;
      this._lastWindowShiftAt = null;
      this._windowShiftMeasurePending = false;
      this._windowShiftRenderPending = false;
      this._conversationWindow = new ConversationWindow(); this._windowSession = this._renderSessionId;
    }
    const window = this._conversationWindow;
    const nativeTop = Number(this._lastNativeScrollTop);
    let top = Number.isFinite(nativeTop) ? Math.max(0, nativeTop) : Math.max(0, Number(this._lastScrollTop) || 0);
    const anchorIndex = window.indexAt(top);
    const anchor = window.rows[anchorIndex];
    const offset = top - window.offsets[anchorIndex];
    this._conversationRows = rows; window.update(rows);
    if (this._convPinned !== false) {
      return window.select(Math.max(0, window.offsets[rows.length] - 700), 700, Math.max(0, rows.length - 12));
    }

    if (options && options.focusKey) {
      const focusIndex = rows.findIndex(row => row.key === options.focusKey);
      if (focusIndex >= 0) {
        const patch = window.select(window.offsets[focusIndex], this._convClientHeight || 700, focusIndex);
        patch.scrollTarget = options.focusKey;
        patch.scrollAnim = false;
        this._scrollAnchorAt = Date.now();
        return patch;
      }
    }

    const index = anchor ? rows.findIndex(row => row.key === anchor.key) : -1;
    // 整段渲染时文档高度就是真实渲染高度：估算偏移推不出滚动位置，直接用原生 scrollTop，
    // 否则每次估算/实测的差都会被写成一次滚动，列表跟着抖。
    if (index >= 0 && !window.full) top = Math.max(0, window.offsets[index] + offset);
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
    if (!window.full && !hasRecentConversationTouch(this) && !settlingAfterTouch(this)
      && Math.abs(top - (this._lastScrollTop || 0)) > 1) {
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
    this._pendingWindowScrollTop = Math.max(0, Number(top) || 0);
    this._windowShiftScrollVersion = (this._windowShiftScrollVersion || 0) + 1;
    const height = this._convClientHeight || 700;
    if (this._windowShiftMeasurePending || this._windowShiftRenderPending) return;
    if (!window.shouldShiftForScroll(this._pendingWindowScrollTop, height)) return;
    const now = Date.now();
    if (this._lastWindowShiftAt != null && now - this._lastWindowShiftAt < WINDOW_SHIFT_INTERVAL) {
      if (!this._windowShiftTimer) {
        const expectedWindow = window;
        this._windowShiftTimer = setTimeout(() => {
          this._windowShiftTimer = null;
          const latestTop = this._pendingWindowScrollTop;
          this._pendingWindowScrollTop = null;
          if (!this._unloaded && this._conversationWindow === expectedWindow && latestTop != null) {
            this.updateConversationWindow(latestTop);
          }
        }, WINDOW_SHIFT_INTERVAL - (now - this._lastWindowShiftAt));
      }
      return;
    }
    const sourceRows = window.rows;
    const renderedRows = this.data.rows || [];
    const renderedKeys = renderedRows.map(row => row.key);
    const requestScrollVersion = this._windowShiftScrollVersion;
    const shift = (rects, measuredTop, viewport) => {
      this._windowShiftMeasurePending = false;
      if (this._unloaded || this._conversationWindow !== window || window.rows !== sourceRows
        || renderedKeys.join('|') !== (this.data.rows || []).map(row => row.key).join('|')) {
        const latestTop = this._pendingWindowScrollTop;
        if (latestTop != null) this.updateConversationWindow(latestTop);
        return;
      }

      const scrollAdvancedDuringMeasure = this._windowShiftScrollVersion !== requestScrollVersion;
      const scrollQuietFor = Date.now() - (this._lastConvScrollAt || 0);
      const readerOwnsScroll = (this._panelGesture && this._panelGesture.tab === 'conversation')
        || settlingAfterTouch(this)
        || (this._convPinned === false && this._lastConvScrollAt && scrollQuietFor < 160);
      (rects || []).forEach((rect, index) => {
        const key = renderedKeys[index];
        if (key && rect && rect.height > 0) window.heights.set(key, rect.height);
      });
      const latestTop = scrollAdvancedDuringMeasure
        ? this._pendingWindowScrollTop
        : (readerOwnsScroll && Number.isFinite(Number(this._lastNativeScrollTop))
          ? this._lastNativeScrollTop : measuredTop);
      const scrollTop = Number.isFinite(Number(latestTop))
        ? Math.max(0, Number(latestTop))
        : Math.max(0, Number(this._lastNativeScrollTop) || Number(this._pendingWindowScrollTop) || 0);
      this._pendingWindowScrollTop = null;
      const viewportTop = Number(viewport && viewport.top);
      const viewportBottom = Number(viewport && viewport.bottom);
      const visibleRow = Number.isFinite(viewportTop) && Number.isFinite(viewportBottom)
        ? (rects || []).findIndex(rect => rect && rect.height > 0
          && rect.bottom > viewportTop + 1 && rect.top < viewportBottom - 1)
        : -1;
      const anchorIndex = visibleRow >= 0 && renderedKeys[visibleRow]
        ? window.rows.findIndex(row => row.key === renderedKeys[visibleRow]) : -1;
      const anchorScreenTop = visibleRow >= 0 ? Number(rects[visibleRow].top) - viewportTop : null;
      window.update(sourceRows);
      const measuredScrollTop = Number(measuredTop);
      const correctedTop = Math.max(0, anchorIndex >= 0 && Number.isFinite(anchorScreenTop)
        ? window.offsets[anchorIndex] - anchorScreenTop
          + (Number.isFinite(measuredScrollTop) ? scrollTop - measuredScrollTop : 0)
        : scrollTop);

      // Preserve the measured row's screen position as the virtual spacers change.
      const patch = dataPatch(this.data, window.select(correctedTop, height));
      if (Math.abs(correctedTop - scrollTop) > 1) {
        patch.conversationScrollTop = correctedTop;
        this._lastScrollTop = correctedTop;
        this._lastNativeScrollTop = correctedTop;
        this._programmaticScrollAt = Date.now();
        this._programmaticScrollTop = correctedTop;
      }
      this._lastWindowShiftAt = Date.now();
      if (Object.keys(patch).length) {
        this._windowShiftRenderPending = true;
        this.setData(patch, () => {
          this._windowShiftRenderPending = false;
          this.scheduleHistoryFormatting(); this.measureConversationWindow();
          // 滚动带出的新图也需要回填本地缓存路径，否则进入窗口后是空白图。
          if (typeof this.scheduleAttachmentThumbs === 'function') this.scheduleAttachmentThumbs();
          const latestTop = this._pendingWindowScrollTop;
          if (latestTop != null) this.updateConversationWindow(latestTop);
        });
      } else {
        const latestTop = this._pendingWindowScrollTop;
        if (latestTop != null) this.updateConversationWindow(latestTop);
      }
    };

    if (typeof wx !== 'undefined' && typeof wx.createSelectorQuery === 'function') {
      try {
        this._windowShiftMeasurePending = true;
        const query = wx.createSelectorQuery().in(this);
        query.select('.conversation').boundingClientRect();
        const offsetQuery = query.select('.conversation');
        const hasScrollOffset = !!(offsetQuery && typeof offsetQuery.scrollOffset === 'function');
        if (hasScrollOffset) offsetQuery.scrollOffset();
        query.selectAll('.conversation-window-row').boundingClientRect();
        query.exec(res => shift(res && res[hasScrollOffset ? 2 : 1],
          hasScrollOffset && res && res[1] ? res[1].scrollTop : undefined, res && res[0]));
        return;
      } catch (_) {
        this._windowShiftMeasurePending = false;
      }
    }
    shift(null, undefined, null);
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
    const touchAge = Date.now() - (Number(this._lastTouchAt) || 0);
    const settlingScroll = this._convPinned === false && this._lastConvScrollAt && scrollQuietFor < 160;
    const settlingTouch = this._convPinned === false && settlingAfterTouch(this);
    if (touchingConversation || settlingScroll || settlingTouch) {
      if (!this._windowMeasureTimer) {
        const wait = Math.max(touchingConversation ? 120 : 16,
          settlingScroll ? 160 - scrollQuietFor : 0,
          settlingTouch ? MANUAL_SCROLL_SETTLE_MS - touchAge : 0);
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
        || (this._convPinned === false && this._lastConvScrollAt && currentScrollQuietFor < 160)
        || (this._convPinned === false && settlingAfterTouch(this))) {
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
      const initialAnchorActive = this._initialConversationAnchorApplied === true;
      if (!changed) {
        if (initialAnchorActive && !this._initialConversationAnchorRecoveryPending
          && !this._dockMeasurePending && !hasVisiblePendingHistoryFormatting(this)) {
          this._initialConversationAnchorApplied = false;
          // History formatting and dock measurement can finish after the first
          // scroll-into-view. Reconcile once against the final content height so
          // entry cannot remain parked above the newest message.
          if (this._convPinned !== false) this.refreshBottomAnchor();
        }
        return;
      }
      window.update(window.rows);
      const patch = dataPatch(this.data, window.patch());
      const anchoring = this._scrollAnchorAt && Date.now() - this._scrollAnchorAt < 800;
      // Anchor to the first actually visible row, not the row guessed from cumulative estimates.
      // Large variable-height messages can make that guessed index drift and jump on release.
      // During and just after a finger scroll, the native gesture/momentum owns the
      // viewport. An estimated-height correction here can override its settled
      // position and make the list jump as soon as the finger lifts.
      // 整段渲染时占位永远是 0，渲染高度就是文档高度：估算→实测的差不是真实位移，
      // 不能再按它修正滚动，否则一测量就跳一大格。
      // 单击（触摸后没有滚动）要当场校正，否则点「已完成」的高度变化要等 800ms 才落地。
      if (!anchoring && !settlingAfterTouch(this) && this._convPinned === false && !window.full
        && anchorIndex >= 0 && window.offsets[anchorIndex] !== oldAnchorOffset) {
        // Reopen and first-render paths can leave the cached offset behind the native view.
        // Base the correction on the measured scroll position to avoid a one-time snap.
        const currentTop = nativeOffset && Number.isFinite(Number(nativeOffset.scrollTop))
          ? Number(nativeOffset.scrollTop) : (this._lastScrollTop || 0);
        patch.conversationScrollTop = Math.max(0, currentTop + window.offsets[anchorIndex] - oldAnchorOffset);
        this._lastScrollTop = patch.conversationScrollTop;
        this._programmaticScrollAt = Date.now();
        this._programmaticScrollTop = patch.conversationScrollTop;
      }
      if (Object.keys(patch).length) this.setData(patch, () => {
        if (initialAnchorActive && this._initialConversationAnchorApplied) this.measureConversationWindow();
      });
      else if (initialAnchorActive) this.measureConversationWindow();
      if (this._convPinned !== false
        && !initialAnchorActive) {
        // The initial tail target stays active while the first row measurements
        // settle. Re-clearing it for every height correction makes entry visibly
        // creep down the list instead of landing at the latest message once.
        this.refreshBottomAnchor(true);
      }
    });
  }
};
