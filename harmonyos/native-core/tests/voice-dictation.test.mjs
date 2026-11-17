import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
const source = readFileSync(new URL('../src/main/ets/common/VoiceDictation.ets', import.meta.url), 'utf8')
  .replace(/^import .*;$/gm, '').replace(/export /g, '');
const code = stripTypeScriptTypes(source) + ';globalThis.VoiceDictation = VoiceDictation;';
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const flush = () => new Promise(resolve => setImmediate(resolve));
function setup({ delayedEngine = false, delayedCapturer = false } = {}) {
  const engineReady = deferred(), capturerReady = deferred(), read = deferred();
  const calls = { shutdown: 0, cancel: 0, finish: 0, release: 0, stop: 0, frames: [], errors: [], final: [], complete: 0 };
  let listener, id;
  const engine = { setListener(value) { listener = value; }, startListening(p) { id = p.sessionId; },
    writeAudio(session, bytes) { calls.frames.push(bytes.length); }, finish() { calls.finish++; },
    cancel() { calls.cancel++; }, shutdown() { calls.shutdown++; } };
  const capturer = { start: async () => {}, read: () => read.promise,
    stop: async () => { calls.stop++; }, release: async () => { calls.release++; } };
  const audio = { AudioSamplingRate: { SAMPLE_RATE_16000: 16000 }, AudioChannel: { CHANNEL_1: 1 },
    AudioSampleFormat: { SAMPLE_FORMAT_S16LE: 1 }, AudioEncodingType: { ENCODING_TYPE_RAW: 1 },
    SourceType: { SOURCE_TYPE_MIC: 1 }, createAudioCapturer: () => delayedCapturer ? capturerReady.promise : Promise.resolve(capturer) };
  const speechRecognizer = { createEngine: () => delayedEngine ? engineReady.promise : Promise.resolve(engine) };
  const context = { speechRecognizer, audio, Uint8Array, Date, Error };
  runInNewContext(code, context);
  const voice = new context.VoiceDictation();
  const start = () => voice.start(() => {}, text => calls.final.push(text), err => calls.errors.push(err), () => calls.complete++);
  return { voice, start, calls, engine, capturer, engineReady, capturerReady, read,
    result: result => listener.onResult(id, result), complete: () => listener.onComplete(id, '') };
}
test('cancel during engine creation releases late engine', async () => {
  const s = setup({ delayedEngine: true }); const starting = s.start(); s.voice.cancel();
  s.engineReady.resolve(s.engine); await starting;
  assert.equal(s.calls.shutdown, 1); assert.equal(s.voice.isActive(), false);
});
test('stop during capturer creation releases both resources', async () => {
  const s = setup({ delayedCapturer: true }); const starting = s.start(); await flush();
  s.voice.stop(); s.capturerReady.resolve(s.capturer); await starting;
  assert.equal(s.calls.cancel, 1); assert.equal(s.calls.shutdown, 1); assert.equal(s.calls.release, 1);
});
test('stop finishes recognition and completion shuts down engine', async () => {
  const s = setup(); await s.start(); s.voice.stop(); await flush();
  assert.equal(s.calls.finish, 1); assert.equal(s.calls.release, 1);
  s.result({ isLast: true, result: 'done' }); s.complete();
  assert.deepEqual(s.calls.final, ['done']); assert.equal(s.calls.shutdown, 1); assert.equal(s.voice.isActive(), false);
});
test('invalid audio frame reports failure and releases resources', async () => {
  const s = setup(); await s.start(); s.read.resolve(new ArrayBuffer(20)); await flush();
  assert.deepEqual(s.calls.errors, ['音频采集失败']); assert.equal(s.calls.cancel, 1);
  assert.equal(s.calls.shutdown, 1); assert.equal(s.calls.release, 1);
});
