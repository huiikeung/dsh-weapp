// DSH iOS VoiceRipplePanel geometry. Frames stay local to this component.
const { createField, drawField, paletteInk } = require('./voice-field');
Component({
  properties: { visible: Boolean, cancelArmed: Boolean, theme: String, status: String },
  data: { leaving: false, displayStatus: '', displayCancelArmed: false },
  observers: {
    visible(value) {
      clearTimeout(this._exitTimer);
      if (value) { this.setData({ leaving: false }); this.start(); }
      else {
        // Native canvas can outlive its ancestor's CSS opacity on a phone.
        // Clear the bitmap AND unmount it immediately; only the DOM halo fades.
        this.stop();
        this.setData({ leaving: true });
        this._exitTimer = setTimeout(() => { this.setData({ leaving: false }); }, 280);
      }
    },
    status(value) { if (this.data.visible && value) this.setData({ displayStatus: value }); },
    cancelArmed(value) { if (this.data.visible) this.setData({ displayCancelArmed: value }); }
  },
  lifetimes: {
    ready() { this._ready = true; if (this.data.visible) this.start(); },
    detached() { this._ready = false; clearTimeout(this._exitTimer); this.stop(); }
  },
  methods: {
    start() {
      if (!this._ready) return;
      this.stop();
      this.levels = Array(45).fill(0); this.level = 0; this.gatheredAt = null;
      this.ink = paletteInk(this.data.theme, this.data.cancelArmed);
      this.setData({ displayStatus: this.data.status, displayCancelArmed: this.data.cancelArmed });
      const generation = this._generation;
      const mount = () => {
        if (generation !== this._generation || !this._ready || !this.data.visible) return;
        this.createSelectorQuery().select('#voice-particles').fields({ node: true, size: true }).exec(result => {
        if (generation !== this._generation || !this._ready || !this.data.visible || !result[0] || !result[0].node) return;
        this.canvas = result[0].node; this.ctx = this.canvas.getContext('2d');
        this.width = result[0].width; this.height = result[0].height;
        if (!this.width || !this.height) return;
        let ratio = 2;
        try { ratio = (wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()).pixelRatio || 2; } catch (_) {}
        this.canvas.width = this.width * ratio; this.canvas.height = this.height * ratio; this.ctx.scale(ratio, ratio);
        this.field = createField(this.width, this.height); this._lastFrame = 0; this.draw();
        });
      };
      if (typeof wx.nextTick === 'function') wx.nextTick(mount); else mount();
    },
    pushLevel(value) {
      if (!this.levels || !this.data.visible) return;
      value = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
      this.level += (value - this.level) * (value > this.level ? 0.55 : 0.18);
      this.levels.shift(); this.levels.push(this.level);
      if (this.gatheredAt === null && value > 0.08) this.gatheredAt = Date.now();
    },
    draw() {
      if (!this._ready || !this.data.visible || !this.ctx) return;
      const now = Date.now();
      if (now - this._lastFrame >= 1000 / 30) {
        const dt = this._lastFrame ? now - this._lastFrame : 34; this._lastFrame = now;
        const progress = this.gatheredAt === null ? 0 : Math.min(1, (now - this.gatheredAt) / 160);
        const gathering = 1 - Math.pow(1 - progress, 3);
        const target = paletteInk(this.data.theme, this.data.displayCancelArmed);
        this.ink = this.ink.map((value, i) => value + (target[i] - value) * Math.min(1, dt / 80));
        const ctx = this.ctx; ctx.clearRect(0, 0, this.width, this.height);
        ctx.fillStyle = 'rgb(' + this.ink.map(Math.round).join(',') + ')';
        drawField(ctx, this.field, this.levels, gathering, now / 1000, this.height);
      }
      const generation = this._generation;
      this._raf = this.canvas.requestAnimationFrame(() => {
        if (generation !== this._generation) return;
        this._raf = null; this.draw();
      });
    },
    stop() {
      this._generation = (this._generation || 0) + 1;
      if (this.canvas && this._raf != null) this.canvas.cancelAnimationFrame(this._raf);
      this._raf = null;
      if (this.ctx) this.ctx.clearRect(0, 0, this.width || 0, this.height || 0);
      // Resetting the backing store also clears native compositor's retained frame.
      if (this.canvas) { this.canvas.width = 1; this.canvas.height = 1; }
      this.ctx = null; this.canvas = null; this.levels = null; this.field = null;
      this.level = 0; this.gatheredAt = null;
    }
  }
});
