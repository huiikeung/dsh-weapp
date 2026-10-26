const test = require('node:test');
const assert = require('node:assert/strict');
const { VoiceInput, catalogLimits, pcmToWav, frameLevel } = require('../miniprogram/pages/session/utils/voice-input');
const { GatewayClient } = require('../miniprogram/utils/gateway');
const catalog = () => ({ available:true, selection:{ providerId:'local', language:'zh' }, maxAudioBytes:4194304, maxDurationSeconds:120, providers:[{ id:'local', languages:['auto','zh'], preparation:{ phase:'ready' } }] });
const tick = () => new Promise(resolve => setImmediate(resolve));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function fixture(options = {}) {
  const handlers = {}, calls = [], states = [], texts = [], errors = [], levels = [];
  let context = 'node:1:session', permission, response;
  const pcm = new Int16Array(3200); pcm.fill(1200);
  const recorder = { start(value) { calls.push(['start', value]); if (options.startThrows) throw Error('hardware'); }, stop() { calls.push(['stop']); } };
  for (const name of ['Start','Stop','Error','InterruptionBegin','FrameRecorded']) {
    recorder['on' + name] = fn => { handlers[name] = fn; };
    recorder['off' + name] = fn => { if (handlers[name] === fn) delete handlers[name]; };
  }
  const wx = { getRecorderManager: () => recorder, requirePrivacyAuthorize: o => o.success(),
    authorize(o) { calls.push(['authorize']); permission = o; if (!options.deferPermission) options.denyPermission ? o.fail({}) : o.success(); },
    arrayBufferToBase64: buffer => Buffer.from(buffer).toString('base64'),
    getFileSystemManager: () => ({ unlink: o => calls.push(['unlink', o.filePath]), readFile: o => { calls.push(['read']); o.success({ data:pcm.buffer }); } }) };
  const client = { requestPlugin(type, payload, timeout) {
    calls.push([type, payload, timeout]);
    if (type === 'speech-catalog') return Promise.resolve(options.catalog || catalog());
    if (type === 'speech-transcribe') return new Promise((resolve, reject) => { response = { resolve, reject }; });
    return Promise.resolve({});
  } };
  const voice = new VoiceInput({ wx, client, context:() => context, onState:s => states.push(s), onLevel:l => levels.push(l), onText:t => texts.push(t), onError:(...e) => errors.push(e) });
  const stop = async () => { const handler = handlers.Stop; if (handler) await handler({ tempFilePath:'/tmp/test.pcm', fileSize:pcm.byteLength }); };
  return { voice, calls, states, texts, errors, handlers, levels, client, wx, stop, permission:() => permission, response:() => response, context:value => { context = value; } };
}
test('setting defaults on, persists explicit choice and switches placeholder', () => {
  const pref = require('../miniprogram/pages/session/utils/voice-preference'), storage = {};
  global.wx = { getStorageSync:k => storage[k], setStorageSync:(k,v) => { storage[k]=v; } };
  try {
    assert.equal(pref.enabled(), true);
    assert.equal(pref.view().composerPlaceholder, '输入内容, /调用指令, @ 文件或对话, 或按住说话');
    pref.save(false); assert.equal(pref.enabled(), false);
    assert.equal(pref.view().composerPlaceholder, '输入内容, /调用指令, @ 文件或对话, 或按住说话');
    pref.save(true); assert.equal(pref.enabled(), true);
  } finally { delete global.wx; }
});
test('catalog requires ready/standby host and honors byte/duration limits', () => {
  assert.equal(catalogLimits(catalog()).duration,120000);
  const c = catalog(); c.providers[0].preparation.phase='standby'; c.maxAudioBytes=32044;
  assert.equal(catalogLimits(c).duration,1000); assert.equal(catalogLimits(c).language,'auto');
  c.providers[0].preparation.phase='downloading'; assert.throws(() => catalogLimits(c), { code:'speech/not-ready' });
  assert.throws(() => catalogLimits({available:false}), {code:'speech/unavailable'});
  c.providers[0].preparation.phase='ready'; c.maxDurationSeconds=NaN; assert.throws(() => catalogLimits(c));
});
test('PCM becomes bounded mono PCM16 WAV with DSH lead/tail padding', () => {
  const pcm = new Int16Array(16000); pcm.fill(20000);
  const wav = Buffer.from(pcmToWav(pcm.buffer,64000));
  assert.equal(wav.toString('ascii',0,4),'RIFF'); assert.equal(wav.toString('ascii',8,16),'WAVEfmt ');
  assert.equal(wav.readUInt16LE(20),1); assert.equal(wav.readUInt16LE(22),1); assert.equal(wav.readUInt32LE(24),16000);
  assert.equal(wav.readUInt16LE(34),16); assert.equal(wav.length,44+32000+6400+16000);
  assert.equal(wav.readInt16LE(44),0); assert.equal(wav.readInt16LE(44+6400),20000);
  assert.equal(pcmToWav(pcm.buffer,32000).byteLength,32044);
  assert.throws(() => pcmToWav(new ArrayBuffer(3),32000));
  assert.equal(frameLevel(new ArrayBuffer(400)),0); assert.ok(frameLevel(pcm.buffer)>0.5);
});
test('unavailable host never requests microphone', async () => {
  const f = fixture({catalog:{available:false}}); await f.voice.start();
  assert.equal(f.voice.phase,'idle'); assert.equal(f.errors[0][1],'speech/unavailable'); assert.ok(!f.calls.some(x => x[0]==='authorize'||x[0]==='start'));
});
test('preflight checks readiness without microphone', async () => {
  const f=fixture(); f.voice.preflight(); await tick(); assert.deepEqual(f.calls.map(x=>x[0]),['speech-catalog']); f.voice.dispose();
});
test('release during permission prevents late recording', async () => {
  const f=fixture({deferPermission:true}); const pending=f.voice.start(); await tick(); f.voice.release(); f.permission().success(); await pending;
  assert.equal(f.voice.phase,'idle'); assert.ok(!f.calls.some(x=>x[0]==='start'));
});
test('denied permission returns actionable error', async () => {
  const f=fixture({denyPermission:true}); await f.voice.start(); assert.equal(f.errors[0][1],'voice/permission'); assert.deepEqual(f.texts,[]); assert.equal(f.voice.active,null);
});
test('release sends one WAV to selected plugin and returns editable text', async () => {
  const f=fixture(); await f.voice.start(); assert.equal(f.calls.find(x=>x[0]==='start')[1].format,'PCM');
  f.handlers.Start(); f.handlers.FrameRecorded({frameBuffer:new Int16Array([3000,5000]).buffer}); assert.ok(f.levels[0]>0);
  f.voice.release(); f.voice.release(); await delay(210); assert.equal(f.calls.filter(x=>x[0]==='stop').length,1);
  const pending=f.stop(); await tick(); const request=f.calls.find(x=>x[0]==='speech-transcribe');
  assert.equal(request[1].providerId,'local'); assert.equal(request[1].language,'auto'); assert.equal(request[2],185000);
  assert.equal(Buffer.from(request[1].audioBase64,'base64').toString('ascii',0,4),'RIFF');
  f.response().resolve({text:' 测试语音 '}); await pending; assert.deepEqual(f.texts,['测试语音']); assert.equal(f.voice.phase,'idle'); assert.ok(f.calls.some(x=>x[0]==='unlink'));
});
test('slide up cancels without upload, slide back restores state', async () => {
  const f=fixture(); await f.voice.start(); f.handlers.Start(); f.voice.move(true); f.voice.move(false); assert.equal(f.states.at(-1).cancelArmed,false);
  f.voice.move(true); f.voice.release(); await delay(5); await f.stop(); assert.ok(!f.calls.some(x=>x[0]==='speech-transcribe')); assert.equal(f.voice.active,null);
});
test('cancel during hardware startup waits for late stop before next recording', async () => {
  const f=fixture(); await f.voice.start(); f.voice.cancel(); await f.voice.start(); assert.equal(f.calls.filter(x=>x[0]==='start').length,1);
  f.handlers.Start(); await delay(5); await f.stop(); assert.equal(f.voice.active,null);
  await f.voice.start(); assert.equal(f.calls.filter(x=>x[0]==='start').length,2); f.handlers.Error();
});
test('start failure releases recorder ownership for retry', async () => {
  const f=fixture({startThrows:true}); await f.voice.start(); assert.equal(f.voice.active,null);
  const next=fixture(); await next.voice.start(); assert.ok(next.calls.some(x=>x[0]==='start')); next.handlers.Error();
});
test('cancel transcription sends correlated cancel and ignores late text', async () => {
  const f=fixture(); await f.voice.start(); f.handlers.Start(); const pending=f.stop(); await tick();
  const request=f.calls.find(x=>x[0]==='speech-transcribe'); f.voice.cancel();
  assert.equal(f.calls.find(x=>x[0]==='speech-cancel')[1].targetRequestId,request[1].requestId);
  f.response().resolve({text:'late'}); await pending; assert.deepEqual(f.texts,[]); assert.equal(f.voice.active,null);
});
test('context changes, interruptions and unload clean up without wrong-session text', async () => {
  const f=fixture(); await f.voice.start(); f.handlers.Start(); const pending=f.stop(); await tick(); f.context('another');
  f.response().resolve({text:'wrong session'}); await pending; assert.deepEqual(f.texts,[]); assert.equal(f.voice.active,null);
  const g=fixture(); await g.voice.start(); g.handlers.Start(); g.handlers.InterruptionBegin(); await delay(5); await g.stop(); assert.equal(g.errors[0][1],'voice/interrupted');
  const h=fixture(); await h.voice.start(); h.handlers.Start(); h.voice.dispose(); await delay(5); await h.stop(); assert.deepEqual(Object.keys(h.handlers),[]); assert.deepEqual(h.texts,[]);
});
test('empty transcript and RPC errors allow retry', async () => {
  for (const reject of [false,true]) {
    const f=fixture(); await f.voice.start(); f.handlers.Start(); const pending=f.stop(); await tick();
    if (reject) f.response().reject(Object.assign(Error('timeout'),{code:'speech/timeout'})); else f.response().resolve({text:'  '});
    await pending; assert.equal(f.voice.phase,'idle'); assert.equal(f.errors.length,1); assert.equal(f.voice.active,null);
  }
});
test('gateway resolves speech response kinds and error codes', async () => {
  const client=Object.create(GatewayClient.prototype); client.pendingRequests={}; client.send=()=>true;
  for (const [type,kind] of [['speech-transcribe','speech-transcript'],['speech-cancel','speech-cancelled'],['speech-subscribe','speech-subscribed'],['speech-unsubscribe','speech-unsubscribed']]) {
    const pending=client.requestPlugin(type,{requestId:type},1000); client.resolveCorrelated({kind,requestId:type,text:'hello'}); assert.equal((await pending).kind,kind);
  }
  const pending=client.requestPlugin('speech-transcribe',{requestId:'fail'},1000); client.resolveCorrelated({kind:'error',requestId:'fail',code:'speech/not-ready',message:'not ready'}); await assert.rejects(pending,{code:'speech/not-ready'});
});
