// 首页深海背景组件。
//
// 分层（从下到上）：静态海报底 → WebGL 流体帧（低分辨率，淡入）→ 胶片颗粒
// → 技术网格 → 鲸鱼粒子 → 底部压暗 → 24s 渐进压暗。
//
// 网格和鲸鱼改由 CSS/SVG 按设备像素绘制，所以进页面第一帧就是高清的静态背景
// （海报底 + 网格 + 鲸鱼），不需要等 WebGL 编译/首帧编码；流体帧随后淡入，
// 只承载平滑的流体与光带，可以用 ~0.7x CSS 像素渲染，体积小、编码快，
// 放大后也看不出锯齿，贴近 dsh-mobile 原生的 Metal 观感。
const INIT_DELAY_MS = 60;       // 首屏绘制完成后再创建 WebGL 上下文
const FRAME_INTERVAL_MS = 125;  // 8fps：流体变化缓慢，省电且不卡顿
const FLUID_PIXEL_BUDGET = 160000; // 单帧缓存的像素上限（约 273x590）
const FLUID_SCALE_CAP = 0.72;   // 低分辨率上限：帧里只有平滑渐变，放大后依然细腻
const FLUID_JPEG_QUALITY = 0.72;

Component({
  properties: {
    active: { type: Boolean, value: true, observer: 'syncPlayback' },
    reducedMotion: { type: Boolean, value: false, observer: 'syncPlayback' }
  },
  data: { ready: false, failed: false, frameImage: '', buffered: false, ios: false, staticMode: false, frameA: '', frameB: '', frontSlot: '', frameAId: 0, frameBId: 0 },
  lifetimes: {
    ready() {
      this._visible = true; this._disposed = false; this._elapsed = 0;
      // 关掉「首页动画」时只要静态层：海报 + 网格 + 鲸鱼本身就是 dsh-mobile 的静态构图，
      // 连 WebGL 上下文都不用建。
      if (this.data.reducedMotion) {
        this._staticMode = true;
        this.setData({ staticMode: true });
        return;
      }
      this.scheduleInitialize();
    },
    detached() {
      this._disposed = true;
      this.clearInitTimer();
      this.pause(); this.release();
    }
  },
  pageLifetimes: {
    show() { this._visible = true; this.syncPlayback(); },
    hide() { this._visible = false; this.pause(); },
    resize() { this.resizeCanvas(); }
  },
  methods: {
    clearInitTimer() {
      if (this._initTimer != null && typeof clearTimeout === 'function') clearTimeout(this._initTimer);
      this._initTimer = null;
    },
    /** 首帧（海报/网格/鲸鱼）先显示，WebGL 初始化和首帧编码挪到首屏之后。 */
    scheduleInitialize() {
      if (this._disposed || !this._visible || !this.data.active || this.data.reducedMotion || this._renderer || this._initRequest || this._initTimer != null) return;
      const start = () => { this._initTimer = null; this.initialize(); };
      // 单元测试等没有计时器的环境保持同步，行为不变。
      if (typeof setTimeout === 'function') this._initTimer = setTimeout(start, INIT_DELAY_MS);
      else start();
    },
    initialize() {
      if (this._disposed || !this._visible || !this.data.active || this.data.reducedMotion || this._renderer || this._initRequest) return;
      const request = this._initRequest = {};
      this.createSelectorQuery().select('.ocean-background').boundingClientRect().exec(results => {
        if (this._initRequest !== request || this._disposed) return;
        this._initRequest = null;
        const field = results && results[0];
        if (!field || !field.width || !field.height) { this.onCanvasError(); return; }
        try {
          this._platform = getPlatform();
          this.setData({ buffered: this._platform === 'ios', ios: this._platform === 'ios' });
          // 帧里只剩平滑渐变：按像素预算压低分辨率，编码耗时和 setData 体积都降一个量级。
          this._pixelRatio = fluidPixelRatio(field.width, field.height);
// 暂不支持api has.createOffscreenCanvas TODO
          this._canvas = has.createOffscreenCanvas({ type: 'webgl', width: field.width, height: field.height });
          const { createOceanRenderer } = require('../../utils/ocean-renderer');
          this._renderer = createOceanRenderer(this._canvas, field.width, field.height, this._pixelRatio);
          this.draw(this._elapsed || 0);
          if (!this._renderer) return;
          this.setData({ failed: false });
          this.syncPlayback();
        } catch (e) { this.onCanvasError(); }
      });
    },
    syncPlayback() {
      this.pause();
      if (this._disposed || !this._visible || !this.data.active) return;
      if (this.data.reducedMotion) {
        // 静态层常驻；已经显示的最后一帧保持不动，不再编码。
        if (!this._staticMode) { this._staticMode = true; this.setData({ staticMode: true }); }
        return;
      }
      if (this._staticMode) { this._staticMode = false; this.setData({ staticMode: false }); }
      if (!this._renderer) { if (!this.data.failed) this.scheduleInitialize(); return; }
      this._lastTick = Date.now(); this._lastPaint = 0;
      this._raf = this._canvas.requestAnimationFrame(() => this.tick());
    },
    tick() {
      this._raf = null;
      if (!this._renderer || this._disposed || !this._visible || !this.data.active || this.data.reducedMotion) return;
      const now = Date.now();
      if (now - this._lastPaint >= FRAME_INTERVAL_MS - 1) {
        this._elapsed += Math.min(0.1, Math.max(0, (now - this._lastTick) / 1000));
        this._lastTick = now; this._lastPaint = now;
        try { this.draw(this._elapsed); } catch (e) { this.onCanvasError(); return; }
      }
      if (this._renderer) this._raf = this._canvas.requestAnimationFrame(() => this.tick());
    },
    pause() {
      this.clearInitTimer();
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
      // 低分辨率平滑渐变：q0.72 已看不出块效应，CSS 颗粒层再兜底。
      let image = this._canvas.toDataURL('image/jpeg', FLUID_JPEG_QUALITY);
      // 个别 WebView 带质量参数时会返回 data:,（空图）→ 会被判成失败退化成静态层，
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
      // Some iOS WebViews decode data-URL images without firing bindload.
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
        this._pixelRatio = fluidPixelRatio(size.width, size.height);
        this._renderer.resize(size.width, size.height, this._pixelRatio);
        this.draw(this.data.reducedMotion ? 0 : this._elapsed);
      });
    },
    onContextLost() { this.onCanvasError(); },
    onContextRestored() { if (!this._disposed) this.initialize(); },
    onCanvasError() {
      this.pause(); this.release();
      // 失败时保留已经显示的完整帧；静态层（海报/网格/鲸鱼）始终在下面兜底。
      if (!this._disposed) this.setData({ failed: true });
    }
  }
});

/** 帧率无关的流体缓存比例：像素预算内尽量接近 0.72x CSS 像素。 */
function fluidPixelRatio(width, height) {
  const area = Math.max(1, width * height);
  return Math.max(0.45, Math.min(FLUID_SCALE_CAP, Math.sqrt(FLUID_PIXEL_BUDGET / area)));
}

function getPlatform() {
  try {
    const device = typeof has.getDeviceInfo === 'function' ? has.getDeviceInfo() : null;
    if (device && device.platform) return String(device.platform).toLowerCase();
  } catch (e) { /* Fall through to the older system-info API. */ }
  try {
    const system = has.getSystemInfoSync ? has.getSystemInfoSync() : null;
    return String(system && system.platform || '').toLowerCase();
  } catch (e) { return ''; }
}
