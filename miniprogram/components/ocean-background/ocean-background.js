const { createOceanRenderer } = require('../../utils/ocean-renderer');
Component({
  properties: {
    active: { type: Boolean, value: true, observer: 'syncPlayback' },
    reducedMotion: { type: Boolean, value: false, observer: 'syncPlayback' }
  },
  data: { ready: false, failed: false, frameImage: '', buffered: false, frameA: '', frameB: '', frontSlot: '', frameAId: 0, frameBId: 0 },
  lifetimes: {
    ready() {
      this._visible = true; this._disposed = false; this._elapsed = 0;
      this.initialize();
    },
    detached() {
      this._disposed = true; this.pause(); this.release();
    }
  },
  pageLifetimes: {
    show() { this._visible = true; this.syncPlayback(); },
    hide() { this._visible = false; this.pause(); },
    resize() { this.resizeCanvas(); }
  },
  methods: {
    initialize() {
      this.createSelectorQuery().select('.ocean-background').boundingClientRect().exec(results => {
        if (this._disposed) return;
        const field = results && results[0];
        if (!field || !field.width || !field.height) { this.onCanvasError(); return; }
        try {
          let info = {};
          try { info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync(); } catch (e) { /* Canvas has measured dimensions. */ }
          let device = {};
          try { device = wx.getDeviceInfo ? wx.getDeviceInfo() : wx.getSystemInfoSync(); } catch (e) { /* Keep the existing renderer on unknown platforms. */ }
          this.setData({ buffered: String(device.platform || '').toLowerCase() === 'ios' });
          // Native canvas compositing can cover ordinary WXML on some runtimes.
          // Render entirely offscreen and present an ordinary image below content.
          this._pixelRatio = Math.min(info.pixelRatio || 1, 480 / field.width, 900 / field.height);
          this._canvas = wx.createOffscreenCanvas({ type: 'webgl', width: field.width, height: field.height });
          this._renderer = createOceanRenderer(this._canvas, field.width, field.height, this._pixelRatio);
          this.draw(this._elapsed || 0);
          this.setData({ ...(!this.data.buffered ? { ready: true } : {}), failed: false });
          this.syncPlayback();
        } catch (e) { this.onCanvasError(); }
      });
    },
    syncPlayback() {
      this.pause();
      if (!this._renderer || this._disposed || !this._visible || !this.data.active) return;
      if (this.data.reducedMotion) { this.draw(0); return; }
      this._lastTick = Date.now(); this._lastPaint = 0;
      this._raf = this._canvas.requestAnimationFrame(() => this.tick());
    },
    tick() {
      this._raf = null;
      if (!this._renderer || this._disposed || !this._visible || !this.data.active || this.data.reducedMotion) return;
      const now = Date.now();
      if (now - this._lastPaint >= 1000 / 15 - 1) {
        this._elapsed += Math.min(0.1, Math.max(0, (now - this._lastTick) / 1000));
        this._lastTick = now; this._lastPaint = now;
        try { this.draw(this._elapsed); } catch (e) { this.onCanvasError(); return; }
      }
      this._raf = this._canvas.requestAnimationFrame(() => this.tick());
    },
    pause() {
      if (this._raf != null && this._canvas) this._canvas.cancelAnimationFrame(this._raf);
      this._raf = null;
    },
    /** Commit a buffered frame even if bindload never fires (iOS data-URL images). */
    commitFrame(pending) {
      if (this._disposed || this._pendingFrame !== pending || pending.committing) return;
      pending.committing = true;
      this.setData({ frontSlot: pending.slot, ready: true, failed: false }, () => {
        if (this._pendingFrame === pending) this._pendingFrame = null;
      });
    },
    draw(time) {
      // iOS 不改写正在显示的图片；解码和换层未完成时也不继续发送帧。
      if (this.data.buffered && this._pendingFrame) return;
      this._renderer.draw(time);
      const image = this._canvas.toDataURL('image/jpeg', 0.82);
      if (!this.data.buffered) { this.setData({ frameImage: image }); return; }
      if (!image || image === 'data:,') { this.onCanvasError(); return; }
      const slot = this.data.frontSlot === 'a' ? 'b' : 'a';
      const id = this._frameSerial = (this._frameSerial || 0) + 1;
      const pending = { slot, id };
      this._pendingFrame = pending;
      this.setData(slot === 'a' ? { frameA: image, frameAId: id } : { frameB: image, frameBId: id });
      // Some iOS WebViews decode data-URL images without firing bindload; without
      // this watchdog the first frame never becomes visible and the page stays on
      // the static fallback (no fluid wave, no grain).
      // Mini-program runtimes provide timers; unit-test sandboxes may not, so
      // keep the watchdog optional instead of requiring a global.
      if (typeof setTimeout === 'function') {
        if (this._frameWatchdog != null && typeof clearTimeout === 'function') clearTimeout(this._frameWatchdog);
        this._frameWatchdog = setTimeout(() => {
          this._frameWatchdog = null;
          this.commitFrame(pending);
        }, 600);
      }
    },
    onFrameLoad(e) {
      if (this._frameWatchdog != null && typeof clearTimeout === 'function') { clearTimeout(this._frameWatchdog); this._frameWatchdog = null; }
      const pending = this._pendingFrame;
      const data = e.currentTarget.dataset;
      if (this._disposed || !pending || pending.committing || data.slot !== pending.slot || Number(data.frameId) !== pending.id) return;
      this.commitFrame(pending);
    },
    onFrameError(e) {
      if (this._frameWatchdog != null && typeof clearTimeout === 'function') { clearTimeout(this._frameWatchdog); this._frameWatchdog = null; }
      const pending = this._pendingFrame;
      const data = e.currentTarget.dataset;
      if (!this._disposed && pending && data.slot === pending.slot && Number(data.frameId) === pending.id) this.onCanvasError();
    },
    release() {
      if (this._frameWatchdog != null && typeof clearTimeout === 'function') { clearTimeout(this._frameWatchdog); this._frameWatchdog = null; }
      this._pendingFrame = null;
      if (this._renderer) this._renderer.dispose();
      this._renderer = null;
    },
    resizeCanvas() {
      if (!this._renderer) return;
      this.createSelectorQuery().select('.ocean-background').boundingClientRect().exec(results => {
        const size = results && results[0];
        if (this._disposed || !this._renderer || !size || !size.width || !size.height) return;
        this._renderer.resize(size.width, size.height, this._pixelRatio);
        this.draw(this.data.reducedMotion ? 0 : this._elapsed);
      });
    },
    onContextLost() { this.onCanvasError(); },
    onContextRestored() { if (!this._disposed) this.initialize(); },
    onCanvasError() {
      this.pause(); this.release();
      // 解码失败时保留已经显示的完整帧，不闪回纯色背景。
      if (!this._disposed) this.setData(this.data.buffered && this.data.frontSlot
        ? { failed: true } : { ready: false, failed: true, frameImage: '' });
    }
  }
});
