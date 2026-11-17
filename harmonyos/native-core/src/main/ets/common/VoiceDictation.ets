import { speechRecognizer } from '@kit.CoreSpeechKit';
import { audio } from '@kit.AudioKit';

export class VoiceDictation {
  private engine: speechRecognizer.SpeechRecognitionEngine | null = null;
  private capturer: audio.AudioCapturer | null = null;
  private sessionId: string = '';
  private generation: number = 0;
  private starting: boolean = false;
  private capturing: boolean = false;

  async start(onPartial: (text: string) => void, onFinal: (text: string) => void,
    onError: (message: string) => void, onComplete: () => void): Promise<void> {
    if (this.starting || this.engine !== null) throw new Error('语音识别正在进行');
    this.starting = true;
    const generation: number = ++this.generation;
    let engine: speechRecognizer.SpeechRecognitionEngine | null = null;
    let capturer: audio.AudioCapturer | null = null;
    try {
      engine = await speechRecognizer.createEngine({ language: 'zh-CN', online: 1 });
      if (generation !== this.generation) { engine.shutdown(); return; }
      const activeEngine = engine;
      const sessionId: string = 'dsh-dictation-' + Date.now();
      this.engine = engine;
      this.sessionId = sessionId;
      const listener: speechRecognizer.RecognitionListener = {
        onStart: (id: string, message: string) => { },
        onEvent: (id: string, code: number, message: string) => { },
        onResult: (id: string, result: speechRecognizer.SpeechRecognitionResult) => {
          if (generation !== this.generation || id !== sessionId) return;
          if (result.isLast) onFinal(result.result); else onPartial(result.result);
        },
        onComplete: (id: string, message: string) => {
          if (generation === this.generation && id === sessionId) { this.cleanup(false); onComplete(); }
        },
        onError: (id: string, code: number, message: string) => {
          if (generation !== this.generation || id !== sessionId) return;
          this.cleanup(false);
          onError(message);
        }
      };
      engine.setListener(listener);
      const options: audio.AudioCapturerOptions = {
        streamInfo: { samplingRate: audio.AudioSamplingRate.SAMPLE_RATE_16000,
          channels: audio.AudioChannel.CHANNEL_1, sampleFormat: audio.AudioSampleFormat.SAMPLE_FORMAT_S16LE,
          encodingType: audio.AudioEncodingType.ENCODING_TYPE_RAW },
        capturerInfo: { source: audio.SourceType.SOURCE_TYPE_MIC, capturerFlags: 0 }
      };
      capturer = await audio.createAudioCapturer(options);
      if (generation !== this.generation) { await capturer.release(); return; }
      this.capturer = capturer;
      engine.startListening({ sessionId: sessionId,
        audioInfo: { audioType: 'pcm', sampleRate: 16000, soundChannel: 1, sampleBit: 16 } });
      await capturer.start();
      if (generation !== this.generation) return;
      this.capturing = true;
      const activeCapturer = capturer;
      const readLoop = async (): Promise<void> => {
        try {
          while (generation === this.generation && this.capturing) {
            const buffer: ArrayBuffer = await activeCapturer.read(640, true);
            if (generation !== this.generation || !this.capturing) break;
            if (buffer.byteLength !== 640) throw new Error('音频采集长度无效');
            activeEngine.writeAudio(sessionId, new Uint8Array(buffer));
          }
        } catch (err) {
          if (generation === this.generation && this.capturing) {
            this.cleanup(true);
            onError('音频采集失败');
          }
        }
      };
      readLoop();
    } catch (err) {
      if (generation === this.generation) this.cleanup(true);
      throw new Error(err instanceof Error ? err.message : '语音识别启动失败');
    } finally {
      if (generation === this.generation) this.starting = false;
    }
  }

  stop(): void {
    if (this.starting) { this.cleanup(true); return; }
    if (this.engine === null) return;
    this.capturing = false;
    const capturer = this.capturer;
    this.capturer = null;
    if (capturer !== null) capturer.stop().then(() => capturer.release()).catch(() => { capturer.release().catch(() => {}); });
    try { this.engine.finish(this.sessionId); } catch (err) { this.cleanup(true); }
  }

  cancel(): void { this.cleanup(true); }

  private cleanup(cancel: boolean): void {
    this.generation++;
    this.starting = false;
    this.capturing = false;
    const engine = this.engine;
    const capturer = this.capturer;
    const sessionId = this.sessionId;
    this.engine = null;
    this.capturer = null;
    this.sessionId = '';
    if (capturer !== null) capturer.stop().then(() => capturer.release()).catch(() => { capturer.release().catch(() => {}); });
    if (engine !== null) {
      if (cancel) { try { engine.cancel(sessionId); } catch (err) { } }
      try { engine.shutdown(); } catch (err) { }
    }
  }

  isActive(): boolean { return this.starting || this.engine !== null; }
}
