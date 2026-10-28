Component({
  properties: {
    active: { type: Boolean, value: true, observer: 'syncPlayback' },
    reducedMotion: { type: Boolean, value: false, observer: 'syncPlayback' }
  },
  data: { ready: false, failed: false, frameImage: '', buffered: false, staticMode: false, frameA: '', frameB: '', frontSlot: '', frameAId: 0, frameBId: 0 },
  lifetimes: {
    ready() {
      this._visible = true; this._disposed = false; this._elapsed = 0;
      // 各平台一视同仁（安卓/鸿蒙/开发者工具都播动画，实测华为性能足够）：
      // 静态海洋只作为「首页动画」关闭时的兜底，此时连 WebGL 上下文都不用建。
      if (this.data.reducedMotion) {
        this._staticMode = true;
        this.setData({ staticMode: true });
        return;
      }
      // Let the home controls paint with the shared base gradient before compiling WebGL.
      if (typeof wx.nextTick === 'function') wx.nextTick(() => this.initialize());
      else this.initialize();
    },
    detached() {
      this._disposed = true;
      this.pause(); this.release();
    }
  },
  pageLifetimes: {
    show() { this._visible = true; this.syncPlayback(); },
    hide() { this._visible = false; this.pause(); },
    resize() { this.resizeCanvas(); }
  },
  methods: {
    initialize() {
      if (this._disposed || !this._visible || !this.data.active || this.data.reducedMotion || this._renderer || this._initRequest) return;
      const request = this._initRequest = {};
      this.createSelectorQuery().select('.ocean-background').boundingClientRect().exec(results => {
        if (this._initRequest !== request || this._disposed) return;
        this._initRequest = null;
        const field = results && results[0];
        if (!field || !field.width || !field.height) { this.onCanvasError(); return; }
        try {
          let info = {};
          try { info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync(); } catch (e) { /* Canvas has measured dimensions. */ }
          const platform = getPlatform();
          this.setData({ buffered: platform === 'ios' });
          // Native canvas compositing can cover ordinary WXML on some runtimes.
          // Render entirely offscreen and present an ordinary image below content.
          this._pixelRatio = Math.min(info.pixelRatio || 1, 480 / field.width, 900 / field.height);
          this._canvas = wx.createOffscreenCanvas({ type: 'webgl', width: field.width, height: field.height });
          const { createOceanRenderer } = require('../../utils/ocean-renderer');
          this._renderer = createOceanRenderer(this._canvas, field.width, field.height, this._pixelRatio);
          // Draw the first frame as soon as the renderer is ready.
          const start = () => {
            if (this._disposed || !this._visible || !this.data.active || !this._renderer) return;
            try {
              this.draw(this._elapsed || 0);
              if (!this._renderer) return;
              this.setData({ ...(!this.data.buffered ? { ready: true } : {}), failed: false });
              this.syncPlayback();
            } catch (e) { this.onCanvasError(); }
          };
          start();
        } catch (e) { this.onCanvasError(); }
      });
    },
    syncPlayback() {
      this.pause();
      if (this._disposed || !this._visible || !this.data.active) return;
      if (this._staticMode && !this.data.reducedMotion && this._visible && this.data.active && !this._disposed) {
        // 「首页动画」被重新打开：退出静态模式并按需创建渲染器。
        this._staticMode = false;
        this.setData({ staticMode: false });
        this.initialize();
        return;
      }
      if (!this._renderer) { if (!this.data.failed) this.initialize(); return; }
      // 关掉「首页动画」：画一帧静态图就停，不进入动画循环。
      if (this.data.reducedMotion) { this.draw(0); return; }
      this._lastTick = Date.now(); this._lastPaint = 0;
      this._raf = this._canvas.requestAnimationFrame(() => this.tick());
    },
    tick() {
      this._raf = null;
      if (!this._renderer || this._disposed || !this._visible || !this.data.active || this.data.reducedMotion) return;
      const now = Date.now();
      // Cap every platform at 8fps; skip encoding while the previous transfer is pending.
      if (now - this._lastPaint >= 1000 / 8 - 1) {
        this._elapsed += Math.min(0.1, Math.max(0, (now - this._lastTick) / 1000));
        this._lastTick = now; this._lastPaint = now;
        try { this.draw(this._elapsed); } catch (e) { this.onCanvasError(); return; }
      }
      if (this._renderer) this._raf = this._canvas.requestAnimationFrame(() => this.tick());
    },
    pause() {
      this._initRequest = null;
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
      if (!this._renderer || this._disposed || this._frameTransfer) return;
      // iOS 不改写正在显示的图片；解码和换层未完成时也不继续发送帧。
      if (this.data.buffered && this._pendingFrame) return;
      this._renderer.draw(time);
      let image = this._canvas.toDataURL('image/jpeg', 0.68);
      // 个别 WebView 带质量参数时会返回 data:,（空图）→ 会被判成失败退化成静态兜底，
      // 这里再兜一次默认参数。
      if (!image || image === 'data:,') image = this._canvas.toDataURL('image/jpeg');
      if (!image || image === 'data:,') { this.onCanvasError(); return; }
      if (!this.data.buffered) {
        const transfer = this._frameTransfer = {};
        this.setData({ frameImage: image, ready: true, failed: false }, () => {
          if (this._frameTransfer === transfer) this._frameTransfer = null;
        });
        return;
      }
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
      this._frameTransfer = null;
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

function getPlatform() {
  try {
    const device = typeof wx.getDeviceInfo === 'function' ? wx.getDeviceInfo() : null;
    if (device && device.platform) return String(device.platform).toLowerCase();
  } catch (e) { /* Fall through to the older system-info API. */ }
  try {
    const system = wx.getSystemInfoSync ? wx.getSystemInfoSync() : null;
    return String(system && system.platform || '').toLowerCase();
  } catch (e) { return ''; }
}
