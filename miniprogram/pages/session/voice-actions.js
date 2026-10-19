const preferences = require('../../utils/ui-preferences');
const voicePreference = require('../../utils/voice-preference');
const { VoiceInput } = require('../../utils/voice-input');
const store = require('../../utils/store');
const t = preferences.t;
const HOLD_DELAY_MS = 350;
const TAP_MOVE_LIMIT = 12;
module.exports = {
  voiceContext() {
    if (!store.state || store.state.connection !== 'connected') return '';
    return [store.state.activeID, store.client.connectGeneration, store.sessionState.sessionId].join(':');
  },
  syncVoicePreference() {
    this.setData(voicePreference.view());
    if (!this.data.voiceEnabled) this.cancelVoice();
  },
  onComposerAction() {
    this.prioritizeInteraction();
    if (this.data.canSend || !this.data.voiceEnabled) { this.send(); return; }
    if (this._voice && this._voice.active) return;
    if (this.data.voicePendingText) return;
    const typing = !this.data.voiceTyping;
    this.setData({ voiceTyping:typing, composerFocus:typing, composerFocused:typing });
    if (!typing && typeof wx.hideKeyboard === 'function') wx.hideKeyboard();
  },
  voiceController() {
    if (this._voice) return this._voice;
    this._voice = new VoiceInput({ wx, client: store.client, context: () => this.voiceContext(),
      onState: state => {
        if (this._unloaded) return;
        const overlay = ['authorizing', 'starting', 'recording'].includes(state.phase);
        const armed = state.cancelArmed === undefined ? this.data.voiceCancelArmed : state.cancelArmed;
        const status = armed ? '松手取消' : state.phase === 'authorizing' ? '正在获取麦克风权限' : state.phase === 'starting' ? '正在开启麦克风' : '松手转文字 · 上滑取消';
        const progressVisible = phase => phase === 'transcribing' || phase === 'stopping';
        const measure = progressVisible(this.data.voicePhase) !== progressVisible(state.phase);
        this.setData({ voicePhase: state.phase, voiceOverlayVisible: overlay, voiceCancelArmed: armed, voiceStatus: t(status) });
        // Opacity-only hold/cancel transitions do not change the dock's geometry.
        if (measure) this.updateDockInset();
      },
      onLevel: value => { const component = this.selectComponent('#voice-overlay'); if (component) component.pushLevel(value); },
      onText: text => {
        if (this._unloaded || this._voiceHidden) return;
        if (this._voiceDraftRevision !== (this._draftRevision || 0) || this._voiceDraft !== this.data.draft) { this.setData({ voicePendingText: text }); this.updateDockInset(); return; }
        this.insertVoiceText(text);
      },
      onError: (message, code) => {
        if (this._unloaded || this._voiceHidden) return;
        wx.showModal({ title:t('语音输入'), content:t(message),
          showCancel: code === 'voice/permission' || code === 'speech/not-ready' || code === 'speech/unavailable',
          confirmText:t(code === 'voice/permission' ? '去设置' : (code === 'speech/not-ready' || code === 'speech/unavailable') ? '插件设置' : '知道了'),
          success: result => {
            if (!result.confirm) return;
            if (code === 'voice/permission') wx.openSetting({});
            else if (code === 'speech/not-ready' || code === 'speech/unavailable') wx.navigateTo({ url:voicePreference.SETTINGS_URL });
          } });
      }
    }); return this._voice;
  },
  onVoiceTouchStart(event) {
    if (!this.data.voiceEnabled || this.data.tab !== 'conversation' || this.data.composerFocused || this.data.voicePendingText) return;
    if (this._voiceTouch || (this._voice && this._voice.active)) return;
    const touch = event.touches && event.touches[0]; if (!touch) return;
    this.prioritizeInteraction(HOLD_DELAY_MS + 32);
    const pending = { id:touch.identifier, x:touch.clientX, y:touch.clientY, held:false };
    this._voiceTouch = pending;
    clearTimeout(this._voicePressTimer);
    this._voicePressTimer = setTimeout(() => {
      if (this._voiceTouch !== pending || this._unloaded || this._voiceHidden) return;
      this.prioritizeInteraction();
      this._voiceTouch.held = true; this._voiceDraftRevision = this._draftRevision || 0;
      this._voiceDraft = this.data.draft;
      this.setData({ voiceCancelArmed:false, voicePendingText:'', commandMenu:null });
      this.voiceController().start();
    }, HOLD_DELAY_MS);
  },
  onVoiceTouchMove(event) {
    if (!this._voiceTouch) return;
    const touch = (event.touches || []).find(item => item.identifier === this._voiceTouch.id); if (!touch) return;
    const cancel = touch.clientY - this._voiceTouch.y < -64;
    if (!this._voiceTouch.held && (Math.abs(touch.clientY - this._voiceTouch.y) > TAP_MOVE_LIMIT || Math.abs(touch.clientX - this._voiceTouch.x) > TAP_MOVE_LIMIT)) {
      clearTimeout(this._voicePressTimer); this._voiceTouch = null; return;
    }
    if (this._voice) this._voice.move(cancel);
  },
  onVoiceTouchEnd(event) {
    const released = event && (event.changedTouches || []).find(item => this._voiceTouch && item.identifier === this._voiceTouch.id);
    if (event && event.changedTouches && !released) return;
    // The last move can be coalesced on mobile; decide cancellation from release position too.
    if (released && this._voiceTouch.held && this._voice) this._voice.move(released.clientY - this._voiceTouch.y < -64);
    clearTimeout(this._voicePressTimer);
    const touch = this._voiceTouch; this._voiceTouch = null;
    if (!touch) return;
    if (touch.held) { if (this._voice) this._voice.release(); }
    else {
      if (released && (Math.abs(released.clientY - touch.y) > TAP_MOVE_LIMIT || Math.abs(released.clientX - touch.x) > TAP_MOVE_LIMIT)) return;
      this.prioritizeInteraction();
      this.setData({ voiceTyping:true, composerFocus:true });
    }
  },
  cancelVoice() {
    clearTimeout(this._voicePressTimer); this._voiceTouch = null;
    if (this._voice) this._voice.cancel();
    if (!this._unloaded && (this.data.voiceOverlayVisible || this.data.voiceCancelArmed)) {
      this.setData({ voiceOverlayVisible:false, voiceCancelArmed:false, voicePhase:'idle', voiceStatus:'' });
    }
  },
  insertVoiceText(text) {
    const draft = this.data.draft || '';
    const cursor = Math.max(0, Math.min(draft.length, Number.isInteger(this._composerCursor) ? this._composerCursor : draft.length));
    const next = draft.slice(0, cursor) + text + draft.slice(cursor);
    this._draftRevision = (this._draftRevision || 0) + 1;
    this._composerCursor = cursor + text.length;
    this.setData({ draft:next, canSend:!!next.trim() || this.data.images.length > 0, voicePendingText:'' });
    this.syncCommandMenu(next, store.sessionState); this.updateDockInset();
  },
  insertPendingVoiceText() { if (this.data.voicePendingText) this.insertVoiceText(this.data.voicePendingText); },
  discardPendingVoiceText() { this.setData({ voicePendingText:'' }); this.updateDockInset(); },
  checkVoiceContext() {
    if (this._voice && this._voice.active && this._voice.active.context !== this.voiceContext()) this.cancelVoice();
    if (this._voiceContextKey !== this.voiceContext()) {
      this._voiceContextKey = this.voiceContext(); this.setData({ voicePendingText:'' });
      if (this.data.voiceEnabled && this._voiceContextKey && !this._voiceHidden) this.voiceController().preflight();
    }
  }
};
