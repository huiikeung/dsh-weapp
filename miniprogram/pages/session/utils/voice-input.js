// DSH mobile contract: PCM16 mono 16kHz -> WAV -> official speech Remote.
// No microphone access on page load and no transcript is automatically sent.
const SAMPLE_RATE = 16000, BYTE_RATE = SAMPLE_RATE * 2, MAX_BYTES = 4 * 1024 * 1024;
let recorderOwner = null;
const failure = (code, message) => Object.assign(new Error(message), { code });
function catalogLimits(catalog) {
  if (!catalog || catalog.available !== true) throw failure('speech/unavailable', '请在 DSH 插件管理中启用官方语音输入');
  const selection = catalog.selection || {};
  const provider = (catalog.providers || []).find(item => item.id === selection.providerId);
  if (!provider || !['ready', 'standby'].includes((provider.preparation || {}).phase)) {
    throw failure('speech/not-ready', '请先在 DSH 语音插件中完成模型准备，再按住说话');
  }
  const maxBytes = Math.min(MAX_BYTES, catalog.maxAudioBytes);
  const seconds = Math.min(120, catalog.maxDurationSeconds, (maxBytes - 44) / BYTE_RATE);
  if (!Number.isFinite(seconds) || seconds < 0.1 || !Number.isInteger(maxBytes)) throw failure('speech/invalid-response', '语音服务限制无效，请更新网关插件');
  return { providerId: provider.id, language: (provider.languages || []).includes('auto') ? 'auto' : selection.language,
    maxBytes, maxPcmBytes: Math.floor(seconds * SAMPLE_RATE) * 2, duration: Math.floor(seconds * 1000) };
}
function pcmToWav(buffer, maxPcmBytes) {
  const source = new Uint8Array(buffer);
  if (!source.length || source.length % 2) throw failure('speech/invalid-audio', '没有录到有效声音，请重试');
  // Some devices deliver one final frame beyond the duration limit.
  const length = Math.min(source.length, maxPcmBytes);
  const leading = Math.min(BYTE_RATE / 5, maxPcmBytes - length);
  const trailing = Math.min(BYTE_RATE / 2, maxPcmBytes - length - leading);
  const result = new ArrayBuffer(44 + leading + length + trailing), view = new DataView(result);
  const bytes = new Uint8Array(result);
  const text = (at, value) => { for (let i = 0; i < value.length; i++) bytes[at + i] = value.charCodeAt(i); };
  text(0, 'RIFF'); view.setUint32(4, result.byteLength - 8, true); text(8, 'WAVEfmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, SAMPLE_RATE, true); view.setUint32(28, BYTE_RATE, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data');
  view.setUint32(40, result.byteLength - 44, true);
  const pcm = new DataView(buffer); let peak = 0, energy = 0;
  for (let i = 0; i < length; i += 2) { const sample = pcm.getInt16(i, true); peak = Math.max(peak, Math.abs(sample)); energy += sample * sample; }
  const rms = Math.sqrt(energy / (length / 2));
  const gain = peak >= 128 && peak < 8192 && peak >= rms * 3 ? Math.min(8, 16384 / peak) : 1;
  for (let i = 0; i < length; i += 2) view.setInt16(44 + leading + i, Math.max(-32768, Math.min(32767, Math.round(pcm.getInt16(i, true) * gain))), true);
  return result;
}
function frameLevel(buffer) {
  const view = new DataView(buffer); let energy = 0;
  for (let i = 0; i + 1 < view.byteLength; i += 2) { const value = view.getInt16(i, true) / 32768; energy += value * value; }
  const rms = Math.sqrt(energy / Math.max(1, Math.floor(view.byteLength / 2)));
  return Math.max(0, Math.min(1, (20 * Math.log10(Math.max(0.0001, rms)) + 55) / 55));
}
const MESSAGES = {
  'speech/unavailable': '请在 DSH 插件管理中启用官方语音输入',
  'speech/not-ready': '请先在 DSH 语音插件中完成模型准备，再按住说话',
  'speech/busy': '语音服务忙，请稍后重试',
  'speech/timeout': '语音识别超时，请重试',
  'speech/invalid-audio': '录音格式或时长不符合要求，请重新录音',
  'speech/invalid-response': '语音服务返回无效，请更新网关插件',
  'voice/permission': '麦克风权限未开启，请在小程序设置中允许录音',
  'voice/unsupported': '当前微信不支持此录音方式，请升级微信后重试',
  'voice/interrupted': '录音中断，请重试',
  'voice/start-timeout': '麦克风启动超时，请检查微信录音权限后重试',
  'voice/connection': '请先连接网关，再使用语音输入',
  'voice/empty': '未识别到语音，请再试一次'
};
function errorMessage(error) { return MESSAGES[error && error.code] || '语音输入失败，请检查 DSH 语音插件后重试'; }

class VoiceInput {
  constructor({ wx, client, context, onState, onLevel, onText, onError }) {
    Object.assign(this, { wx, client, context, onState, onLevel, onText, onError });
    this.phase = 'idle'; this.ordinal = 0; this.disposed = false; this.active = null;
  }
  valid(task) { return !this.disposed && this.active === task && !task.cancelled && this.context() === task.context; }
  state(phase, extra) { this.phase = phase; if (!this.disposed) this.onState(Object.assign({ phase }, extra)); }
  async catalog() {
    const key = this.context();
    if (!key) throw failure('voice/connection');
    if (this.cached && this.cached.key === key && Date.now() - this.cached.time < 10000) return this.cached.value;
    const value = catalogLimits(await this.client.requestPlugin('speech-catalog', {}, 6000));
    if (key !== this.context()) throw failure('voice/connection');
    this.cached = { key, time: Date.now(), value }; return value;
  }
  preflight() { this.catalog().catch(() => {}); }
  ensureRecorder() {
    if (recorderOwner && recorderOwner !== this) throw failure('speech/busy');
    if (this.handlers) return;
    if (typeof this.wx.getRecorderManager !== 'function') throw failure('voice/unsupported');
    this.recorder = this.wx.getRecorderManager();
    recorderOwner = this;
    this.handlers = { Start: () => this.started(), Stop: result => this.stopped(result),
      Error: () => this.hardwareError(), InterruptionBegin: () => this.interrupted(),
      FrameRecorded: result => {
        const task = this.active;
        if (!task || !this.valid(task) || this.phase !== 'recording' || !result.frameBuffer) return;
        // Real PCM level, at most ten small component updates per second.
        if (Date.now() - (task.lastLevel || 0) < 100) return;
        task.lastLevel = Date.now(); this.onLevel(frameLevel(result.frameBuffer));
      } };
    Object.keys(this.handlers).forEach(name => { const fn = this.recorder['on' + name]; if (typeof fn === 'function') fn.call(this.recorder, this.handlers[name]); });
  }
  permission(task) {
    const call = (method, options) => new Promise((resolve, reject) => this.wx[method](Object.assign({}, options, { success: resolve, fail: reject })));
    return (typeof this.wx.requirePrivacyAuthorize === 'function' ? call('requirePrivacyAuthorize', {}) : Promise.resolve())
      .then(() => this.valid(task) ? call('authorize', { scope: 'scope.record' }) : undefined)
      .catch(() => { throw failure('voice/permission'); });
  }
  async start() {
    if (this.disposed || this.active) return;
    const task = { id: 'voice-' + Date.now() + '-' + (++this.ordinal), context: this.context(), cancelled: false };
    this.active = task; this.state('authorizing');
    try {
      if (!task.context) throw failure('voice/connection');
      // Check the host before asking for microphone access.
      task.limits = await this.catalog();
      if (!this.valid(task)) { this.finish(task); return; }
      await this.permission(task);
      if (!this.valid(task)) { this.finish(task); return; }
      this.ensureRecorder(); this.state('starting'); task.hardwarePending = true;
      task.watchdog = setTimeout(() => { this.fail(task, failure('voice/start-timeout')); if (this.active === task) this.stopHardware(task, false); }, 10000);
      try {
        this.recorder.start({ duration: task.limits.duration, sampleRate: SAMPLE_RATE, numberOfChannels: 1,
          format: 'PCM', frameSize: 4, audioSource: 'auto' });
      } catch (error) { task.hardwarePending = false; this.detach(); throw error; }
    } catch (error) { this.fail(task, error); }
  }
  started() {
    const task = this.active;
    if (!task) { this.recorder.stop(); return; }
    clearTimeout(task.watchdog); task.started = true;
    if (!this.valid(task) || task.released) { this.stopHardware(task, false); return; }
    this.state('recording');
    if (typeof this.wx.vibrateShort === 'function') this.wx.vibrateShort({ type: 'light', fail() {} });
    // A native duration limit is set too; this protects against missing callbacks.
    task.watchdog = setTimeout(() => this.release(), task.limits.duration);
  }
  move(cancelArmed) {
    const task = this.active;
    if (!task || !['authorizing', 'starting', 'recording'].includes(this.phase) || !!task.cancelArmed === cancelArmed) return;
    task.cancelArmed = cancelArmed; this.state(this.phase, { cancelArmed });
    if (cancelArmed && typeof this.wx.vibrateShort === 'function') this.wx.vibrateShort({ type: 'light', fail() {} });
  }
  release() {
    const task = this.active;
    if (!task || task.released) return;
    if (task.cancelArmed || this.phase === 'authorizing') { this.cancel(); return; }
    if (!['starting', 'recording'].includes(this.phase)) return;
    task.released = true; this.state('stopping');
    if (task.started) this.stopHardware(task, true);
  }
  stopHardware(task, tail) {
    if (task.stopRequested) return;
    task.stopRequested = true; clearTimeout(task.watchdog);
    task.tail = setTimeout(() => {
      try { this.recorder.stop(); } catch (_) { this.hardwareError(); }
      if (this.active === task && task.hardwarePending) task.watchdog = setTimeout(() => this.hardwareError(), 5000);
    }, tail && !task.cancelled ? 200 : 0);
  }
  cleanupFile(path) {
    if (!path) return;
    try { this.wx.getFileSystemManager().unlink({ filePath: path, fail() {} }); } catch (_) { /* Temporary file may already have been removed by WeChat. */ }
  }
  async stopped(result) {
    const task = this.active, path = result && result.tempFilePath;
    if (!task) { this.cleanupFile(path); return; }
    clearTimeout(task.watchdog); clearTimeout(task.tail); task.hardwarePending = false;
    this.detach();
    if (!this.valid(task)) { this.cleanupFile(path); this.finish(task); return; }
    this.state('transcribing');
    try {
      if (!path || !result.fileSize || result.fileSize > MAX_BYTES + 65536) throw failure('speech/invalid-audio');
      const buffer = await new Promise((resolve, reject) => this.wx.getFileSystemManager().readFile({ filePath: path, success: result => resolve(result.data), fail: reject }));
      this.cleanupFile(path);
      if (!this.valid(task)) { this.finish(task); return; }
      const wav = pcmToWav(buffer, task.limits.maxPcmBytes);
      if (wav.byteLength > task.limits.maxBytes) throw failure('speech/invalid-audio');
      const payload = { requestId: task.id, audioBase64: this.wx.arrayBufferToBase64(wav), providerId: task.limits.providerId };
      if (task.limits.language) payload.language = task.limits.language;
      task.submitted = true;
      const response = await this.client.requestPlugin('speech-transcribe', payload, 185000);
      if (!this.valid(task)) { this.finish(task); return; }
      if (typeof response.text !== 'string' || !response.text.trim()) throw failure('voice/empty');
      this.onText(response.text.trim()); this.finish(task);
    } catch (error) { this.cleanupFile(path); this.fail(task, error); }
  }
  cancel() {
    const task = this.active; if (!task) return;
    task.cancelled = true;
    if (task.submitted && this.context() === task.context) {
      this.client.requestPlugin('speech-cancel', { targetRequestId: task.id }, 6000).catch(() => {});
    }
    this.state('idle', { cancelArmed: false });
    // Keep the native owner until onStop so delayed callbacks never target a new recording.
    if (task.hardwarePending) { if (task.started) this.stopHardware(task, false); }
    else this.finish(task);
  }
  interrupted() { const task = this.active; if (task && this.valid(task)) this.fail(task, failure('voice/interrupted')); }
  hardwareError() {
    const task = this.active; if (!task) return;
    task.hardwarePending = false; this.detach(); this.fail(task, failure('voice/interrupted'));
  }
  fail(task, error) {
    if (this.active !== task) return;
    const report = this.valid(task); this.cancel();
    if (report) this.onError(errorMessage(error), error && error.code);
  }
  finish(task) {
    clearTimeout(task.watchdog); clearTimeout(task.tail);
    if (this.active !== task) return;
    this.active = null; this.state('idle', { cancelArmed: false });
    if (this.disposed) this.detach();
  }
  detach() {
    if (!this.recorder || !this.handlers) return;
    Object.keys(this.handlers).forEach(name => { const fn = this.recorder['off' + name]; if (typeof fn === 'function') fn.call(this.recorder, this.handlers[name]); });
    this.handlers = null;
    if (recorderOwner === this) recorderOwner = null;
  }
  dispose() { this.cancel(); this.disposed = true; if (!this.active) this.detach(); }
}
module.exports = { VoiceInput, catalogLimits, pcmToWav, frameLevel, errorMessage };
