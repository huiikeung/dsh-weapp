const { createOceanRenderer } = require('../../utils/ocean-renderer');
Component({
  properties: {
    active: { type: Boolean, value: true, observer: 'syncPlayback' },
    reducedMotion: { type: Boolean, value: false, observer: 'syncPlayback' }
  },
  data: { ready: false, failed: false, frameImage: '' },
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
          // Native canvas compositing can cover ordinary WXML on some runtimes.
          // Render entirely offscreen and present an ordinary image below content.
          this._pixelRatio = Math.min(info.pixelRatio || 1, 480 / field.width, 900 / field.height);
          this._canvas = wx.createOffscreenCanvas({ type: 'webgl', width: field.width, height: field.height });
          this._renderer = createOceanRenderer(this._canvas, field.width, field.height, this._pixelRatio);
          this.draw(this._elapsed || 0);
          this.setData({ ready: true, failed: false });
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
    draw(time) {
      this._renderer.draw(time);
      this.setData({ frameImage: this._canvas.toDataURL('image/jpeg', 0.82) });
    },
    release() {
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
    onContextLost() { this.pause(); this.release(); this.setData({ ready: false }); },
    onContextRestored() { if (!this._disposed) this.initialize(); },
    onCanvasError() { this.pause(); this.release(); if (!this._disposed) this.setData({ ready: false, failed: true, frameImage: '' }); }
  }
});
