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
function conversationSettleDelay(page, now) {
  const gestureAt = Number(page._lastConversationGestureAt) || 0;
  const touchedAt = Number(page._lastTouchAt) || 0;
  const lastScrollAt = Number(page._lastConvScrollAt) || 0;
  let lastActivityAt = gestureAt > 0 && now - gestureAt < MANUAL_SCROLL_SETTLE_MS ? gestureAt : 0;
  if (touchedAt > 0 && lastScrollAt >= touchedAt && now - touchedAt < MANUAL_SCROLL_SETTLE_MS) {
    lastActivityAt = Math.max(lastActivityAt, touchedAt);
  }
  return lastActivityAt ? Math.max(0, MANUAL_SCROLL_SETTLE_MS - (now - lastActivityAt)) : 0;
}
function conversationAnchorIndex(page, window, top, origin) {
  const estimatedIndex = window.indexAt(top - origin);
  const saved = page._lastMeasuredConversationAnchor;
  if (!saved || !saved.key) return estimatedIndex;
  const savedIndex = window.rows.findIndex(row => row.key === saved.key);
  const savedTop = Number(saved.screenTop) - (top - Number(saved.scrollTop));
  const viewportHeight = Number(page._convClientHeight) || 700;
  return savedIndex >= 0 && Number.isFinite(savedTop)
    && savedTop > -viewportHeight && savedTop < viewportHeight ? savedIndex : estimatedIndex;
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
      this._lastMeasuredConversationAnchor = null;
      this._conversationWindow = new ConversationWindow(); this._windowSession = this._renderSessionId;
    }
    const window = this._conversationWindow;
    const nativeTop = Number(this._lastNativeScrollTop);
    let top = Number.isFinite(nativeTop) ? Math.max(0, nativeTop) : Math.max(0, Number(this._lastScrollTop) || 0);
    const oldOrigin = Number(window.origin) || 0;
    const anchorIndex = conversationAnchorIndex(this, window, top, oldOrigin);
    const anchor = window.rows[anchorIndex];
    const oldAnchorOffset = window.offsets[anchorIndex] || 0;
    this._conversationRows = rows; window.update(rows);
    if (this._convPinned !== false) {
      window.origin = 0;
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
    const desiredOrigin = index >= 0
      ? oldOrigin + oldAnchorOffset - (window.offsets[index] || 0)
      : oldOrigin;
    window.origin = desiredOrigin;
    const keepVirtual = !window.full && (hasRecentConversationTouch(this) || settlingAfterTouch(this));
    const patch = window.select(top, this._convClientHeight || 700, undefined, keepVirtual);
    const originClamp = window.origin - desiredOrigin;
    if (options && options.anchor && anchor) {
      // Keep the same keyed row in virtual coordinates. scroll-into-view aligns
      // it to the viewport edge and cancels the reader's in-flight swipe.
      patch.scrollTarget = '';
      patch.scrollAnim = false;
      this._lastScrollTop = top;
      return patch;
    }
    // Keep the native scroll position fixed as row heights change. The virtual
    // spacers absorb the offset delta; only a clamped/full-render transition
    // needs a native correction, and never while a finger or momentum owns it.
    if (Math.abs(originClamp) > 1 && !hasRecentConversationTouch(this) && !settlingAfterTouch(this)) {
      patch.conversationScrollTop = Math.max(0, top + originClamp);
      this._lastScrollTop = patch.conversationScrollTop;
      this._lastNativeScrollTop = patch.conversationScrollTop;
      this._programmaticScrollAt = Date.now();
      this._programmaticScrollTop = patch.conversationScrollTop;
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
      const previousOrigin = Number(window.origin) || 0;
      const viewportTop = Number(viewport && viewport.top);
      const viewportBottom = Number(viewport && viewport.bottom);
      const visibleRow = Number.isFinite(viewportTop) && Number.isFinite(viewportBottom)
        ? (rects || []).findIndex(rect => rect && rect.height > 0
          && rect.bottom > viewportTop + 1 && rect.top < viewportBottom - 1)
        : -1;
      const anchorIndex = visibleRow >= 0 && renderedKeys[visibleRow]
        ? sourceRows.findIndex(row => row.key === renderedKeys[visibleRow]) : -1;
      const oldAnchorOffset = anchorIndex >= 0 ? window.offsets[anchorIndex] : 0;
      const previousHeights = new Map();
      renderedKeys.forEach(key => { if (key) previousHeights.set(key, window.heights.get(key)); });
      (rects || []).forEach((rect, index) => {
        const key = renderedKeys[index];
        if (key && rect && rect.height > 0) window.heights.set(key, rect.height);
      });
      const latestTop = scrollAdvancedDuringMeasure
        ? this._pendingWindowScrollTop
        : (Number.isFinite(Number(measuredTop)) ? measuredTop : this._lastNativeScrollTop);
      const scrollTop = Number.isFinite(Number(latestTop))
        ? Math.max(0, Number(latestTop))
        : Math.max(0, Number(this._lastNativeScrollTop) || Number(this._pendingWindowScrollTop) || 0);
      this._lastScrollTop = scrollTop;
      this._lastNativeScrollTop = scrollTop;
      this._pendingWindowScrollTop = null;
      if (anchorIndex >= 0 && Number.isFinite(viewportTop)) {
        const queryTop = measuredTop != null && Number.isFinite(Number(measuredTop)) ? Number(measuredTop) : scrollTop;
        this._lastMeasuredConversationAnchor = {
          key: sourceRows[anchorIndex].key,
          screenTop: Number(rects[visibleRow].top) - viewportTop + queryTop - scrollTop,
          scrollTop
        };
      }
      const restoreMeasuredHeights = () => {
        previousHeights.forEach((value, key) => {
          if (value === undefined) window.heights.delete(key); else window.heights.set(key, value);
        });
        window.update(sourceRows);
        window.origin = previousOrigin;
      };
      window.update(sourceRows);
      let desiredOrigin = previousOrigin;
      let windowPatch;
      let originClamp = 0;
      if (anchorIndex >= 0) {
        // Keep the visible stable key at its pre-measure logical offset. Its
        // current rect already includes the reflow and cannot represent the
        // position before that reflow happened.
        desiredOrigin = previousOrigin + oldAnchorOffset - window.offsets[anchorIndex];
        window.origin = desiredOrigin;
        windowPatch = window.select(scrollTop, height);
        originClamp = window.origin - desiredOrigin;
      } else {
        // A fast fling can move the viewport past every mounted row before this
        // query returns. Without a visible key+pixel anchor, measured height
        // deltas have no safe reference and must not rewrite the scroll geometry.
        restoreMeasuredHeights();
        windowPatch = window.select(scrollTop, height);
      }

      // If a boundary leaves no room for the spacer to absorb the correction,
      // keep momentum untouched and let the post-swipe measurement reconcile it.
      if (readerOwnsScroll && Math.abs(originClamp) > 1) {
        restoreMeasuredHeights();
        windowPatch = window.select(scrollTop, height);
        originClamp = 0;
      }

      // Rebase the virtual content origin instead of writing scrollTop during
      // a swipe. The user-controlled native position remains the source of truth.
      const patch = dataPatch(this.data, windowPatch);
      if (!readerOwnsScroll && Math.abs(originClamp) > 1) {
        patch.conversationScrollTop = Math.max(0, scrollTop + originClamp);
        this._lastScrollTop = patch.conversationScrollTop;
        this._lastNativeScrollTop = patch.conversationScrollTop;
        this._programmaticScrollAt = Date.now();
        this._programmaticScrollTop = patch.conversationScrollTop;
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

    if (typeof has !== 'undefined' && typeof has.createSelectorQuery === 'function') {
      try {
        this._windowShiftMeasurePending = true;
        const query = has.createSelectorQuery().in(this);
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
    if (this._windowMeasurePending || this._unloaded || this._voiceHidden || this.data.tab !== 'conversation' || typeof has === 'undefined' || typeof has.createSelectorQuery !== 'function') return;
    const window = this._conversationWindow; if (!window) return;
    const gesture = this._panelGesture;
    const touchingConversation = gesture && gesture.tab === 'conversation';
    const scrollQuietFor = Date.now() - (this._lastConvScrollAt || 0);
    const settlingScroll = this._lastConvScrollAt && scrollQuietFor < 160;
    const settlingTouch = settlingAfterTouch(this);
    if (touchingConversation || settlingScroll || settlingTouch) {
      if (!this._windowMeasureTimer) {
        const wait = Math.max(touchingConversation ? 120 : 16,
          settlingScroll ? 160 - scrollQuietFor : 0,
          settlingTouch ? conversationSettleDelay(this, Date.now()) : 0);
        this._windowMeasureTimer = setTimeout(() => {
          this._windowMeasureTimer = null;
          this.measureConversationWindow();
        }, wait);
      }
      return;
    }
    const keys = this.data.rows.map(row => row.key);
    this._windowMeasurePending = true;
    const query = has.createSelectorQuery().in(this);
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
        || (this._lastConvScrollAt && currentScrollQuietFor < 160)
        || settlingAfterTouch(this)) {
        this.measureConversationWindow();
        return;
      }
      const viewport = res && res[0];
      const nativeOffset = hasScrollOffset && res ? res[1] : null;
      const rects = (res && res[hasScrollOffset ? 2 : 1]) || [];
      const nativeTop = nativeOffset && nativeOffset.scrollTop != null
        ? Number(nativeOffset.scrollTop) : NaN;
      const cachedNativeTop = Number(this._lastNativeScrollTop);
      const cachedTop = Number(this._lastScrollTop);
      const currentTop = Number.isFinite(nativeTop) ? Math.max(0, nativeTop)
        : Number.isFinite(cachedNativeTop) ? Math.max(0, cachedNativeTop)
          : Math.max(0, Number.isFinite(cachedTop) ? cachedTop : 0);
      const initialAnchorActive = this._initialConversationAnchorApplied === true;
      const fastEntryAnchorActive = this._fastLiveSessionEntry === true && initialAnchorActive;
      const virtualOrigin = Number(window.origin) || 0;
      const canonicalTop = currentTop - virtualOrigin;
      if (Math.abs(virtualOrigin) > 1 && canonicalTop >= 0 && !fastEntryAnchorActive) {
        // Translate a temporary virtual origin into native scroll coordinates
        // only after the gesture settles. Updating both together keeps pixels
        // stationary while restoring access to the full prepended history.
        window.origin = 0;
        const patch = dataPatch(this.data, window.select(canonicalTop, this._convClientHeight || 700));
        patch.conversationScrollTop = canonicalTop;
        patch.scrollAnim = false;
        this._lastScrollTop = canonicalTop;
        this._lastNativeScrollTop = canonicalTop;
        this._programmaticScrollAt = Date.now();
        this._programmaticScrollTop = canonicalTop;
        this.setData(patch, () => this.measureConversationWindow());
        return;
      }
      const viewportTop = viewport && Number(viewport.top);
      const viewportBottom = viewport && Number(viewport.bottom);
      const visibleRow = Number.isFinite(viewportTop) && Number.isFinite(viewportBottom)
        ? rects.findIndex(rect => rect && rect.height > 0 && rect.bottom > viewportTop + 1 && rect.top < viewportBottom - 1)
        : -1;
      const anchorIndex = visibleRow >= 0 && keys[visibleRow]
        ? window.rows.findIndex(row => row.key === keys[visibleRow])
        : -1;
      if (anchorIndex >= 0 && Number.isFinite(viewportTop)) {
        this._lastMeasuredConversationAnchor = {
          key: keys[visibleRow],
          screenTop: Number(rects[visibleRow].top) - viewportTop,
          scrollTop: currentTop
        };
      }
      if (anchorIndex < 0) {
        // Never apply geometry from an offscreen slice: it cannot anchor the
        // reader. First move the window to the actual native viewport, then
        // measure the newly visible rows on the next render pass.
        const currentTop = nativeOffset && Number.isFinite(Number(nativeOffset.scrollTop))
          ? Number(nativeOffset.scrollTop) : Number(this._lastNativeScrollTop || this._lastScrollTop) || 0;
        this.updateConversationWindow(currentTop);
        return;
      }
      const oldAnchorOffset = anchorIndex >= 0 ? window.offsets[anchorIndex] : 0;
      const oldOrigin = Number(window.origin) || 0;
      const previousHeights = new Map();
      let changed = false;
      (rects || []).forEach((rect, i) => {
        if (!rect || !(rect.height > 0)) return;
        previousHeights.set(keys[i], window.heights.get(keys[i]));
        if (Math.abs((window.heights.get(keys[i]) || 0) - rect.height) > 1) {
          window.heights.set(keys[i], rect.height);
          changed = true;
        }
      });
      if (!changed) {
        if (initialAnchorActive && !this._initialConversationAnchorRecoveryPending
          && !this._dockMeasurePending && !hasVisiblePendingHistoryFormatting(this)) {
          this._initialConversationAnchorApplied = false;
          if (fastEntryAnchorActive) this._fastLiveSessionEntry = false;
          // History formatting and dock measurement can finish after the first
          // scroll-into-view. Reconcile once against the final content height so
          // entry cannot remain parked above the newest message.
          if (!fastEntryAnchorActive && this._convPinned !== false) this.refreshBottomAnchor();
        }
        return;
      }
      window.update(window.rows);
      const patch = dataPatch(this.data, window.patch());
      this._lastScrollTop = currentTop;
      this._lastNativeScrollTop = currentTop;
      // Anchor to the first actually visible row, not the row guessed from cumulative estimates.
      // Large variable-height messages can make that guessed index drift and jump on release.
      // Rebase by the old/new logical offset delta. The post-layout rect already
      // includes the height change, so using it as the old anchor preserves the
      // jump instead of undoing it.
      if (!window.full && anchorIndex >= 0 && Number.isFinite(Number(rects[visibleRow].top))) {
        const desiredOrigin = oldOrigin + oldAnchorOffset - window.offsets[anchorIndex];
        window.origin = desiredOrigin;
        const clampedPatch = dataPatch(this.data, window.patch());
        const originClamp = window.origin - desiredOrigin;
        Object.assign(patch, clampedPatch);
        if (Math.abs(originClamp) > 1) {
          const readerOwnsScroll = (this._panelGesture && this._panelGesture.tab === 'conversation')
            || settlingAfterTouch(this)
            || (this._lastConvScrollAt && Date.now() - this._lastConvScrollAt < 160);
          if (readerOwnsScroll) {
            previousHeights.forEach((value, key) => {
              if (value === undefined) window.heights.delete(key); else window.heights.set(key, value);
            });
            window.update(window.rows);
            window.origin = oldOrigin;
            Object.assign(patch, dataPatch(this.data, window.patch()));
          } else if (!fastEntryAnchorActive) {
            patch.conversationScrollTop = Math.max(0, currentTop + originClamp);
            this._lastScrollTop = patch.conversationScrollTop;
            this._lastNativeScrollTop = patch.conversationScrollTop;
            this._programmaticScrollAt = Date.now();
            this._programmaticScrollTop = patch.conversationScrollTop;
          }
        }
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
