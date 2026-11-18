import { audio } from '@kit.AudioKit';
import { util } from '@kit.ArkTS';
import { GatewayFrame } from '../protocol/GatewayDtos';
import { GatewayClient } from '../network/GatewayClient';
import { asRec, bool, field, num, str } from '../protocol/GatewayFrameCodec';
import { Logger } from './Logger';

const SAMPLE_RATE: number = 16000;
const BYTE_RATE: number = SAMPLE_RATE * 2;

/** 网关语音插件给出的录音限制（对齐小程序 catalogLimits） */
export interface SpeechLimits {
  providerId: string;
  language: string;
  maxBytes: number;
  maxPcmBytes: number;
  durationMs: number;
}

/**
 * 语音输入失败：code 对齐小程序 pages/session/utils/voice-input.js 的错误码，
 * 页面据此在弹窗里给出「去设置 / 插件设置」动作，而不是把原始系统报错直接甩给用户。
 */
export class SpeechFailure extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'SpeechFailure';
  }

  /** 兜底文案（对齐小程序 MESSAGES 表） */
  static messageFor(code: string): string {
    if (code === 'speech/unavailable') {
      return '请在 DSH 插件管理中启用官方语音输入';
    }
    if (code === 'speech/not-ready') {
      return '请先在 DSH 语音插件中完成模型准备，再按住说话';
    }
    if (code === 'speech/busy') {
      return '语音服务忙，请稍后重试';
    }
    if (code === 'speech/timeout') {
      return '语音识别超时，请重试';
    }
    if (code === 'speech/invalid-audio') {
      return '录音格式或时长不符合要求，请重新录音';
    }
    if (code === 'speech/invalid-response') {
      return '语音服务返回无效，请更新网关插件';
    }
    if (code === 'voice/permission') {
      return '麦克风权限未开启，请在系统设置中允许使用麦克风';
    }
    if (code === 'voice/start-timeout') {
      return '麦克风启动超时，请检查麦克风权限后重试';
    }
    if (code === 'voice/interrupted') {
      return '录音中断，请重试';
    }
    if (code === 'voice/connection') {
      return '请先连接网关，再使用语音输入';
    }
    if (code === 'voice/empty') {
      return '未识别到语音，请再试一次';
    }
    return '语音输入失败，请检查 DSH 语音插件后重试';
  }
}

/**
 * 长按语音输入（对齐小程序 pages/session/utils/voice-input.js）。
 *
 * 关键：不在本机做识别——鸿蒙的 CoreSpeechKit 在没有语音服务时直接抛 system error。
 * 小程序是把 PCM16/16k 录下来转成 WAV，再通过网关发给 DSH 的官方语音插件转写。
 * 这里走同一条链路：speech-catalog 拿限制 → 录音 → speech-transcribe → 文本。
 */
export class SpeechInput {
  private capturer: audio.AudioCapturer | null = null;
  private chunks: Uint8Array[] = [];
  private totalBytes: number = 0;
  /** 会话代数：每次开始/取消自增，让在途的异步回调自动作废 */
  private generating: number = 0;
  private limitPcmBytes: number = 0;
  private recording: boolean = false;
  /** 最近一帧的音量 0..1（对齐小程序 frameLevel，用于波纹高度） */
  private currentLevel: number = 0;

  isActive(): boolean {
    return this.capturer !== null || this.recording;
  }

  /** 当前音量 0..1，录音时用于驱动波纹 */
  level(): number {
    return this.currentLevel;
  }

  /** 读网关语音插件能力；不可用时抛出可读错误 */
  async catalog(): Promise<SpeechLimits> {
    const client: GatewayClient = GatewayClient.get();
    if (!client.isConnected()) {
      throw new SpeechFailure('voice/connection', SpeechFailure.messageFor('voice/connection'));
    }
    const frame: GatewayFrame = await client.requestPlugin('speech-catalog', {}, 8000);
    Logger.info('speech catalog available=' + (bool(frame, 'available') === true ? '1' : '0'));
    const available: boolean = bool(frame, 'available') === true;
    if (!available) {
      throw new SpeechFailure('speech/unavailable', SpeechFailure.messageFor('speech/unavailable'));
    }
    const maxAudioBytes: number = num(frame, 'maxAudioBytes') ?? (4 * 1024 * 1024);
    const maxDurationSeconds: number = num(frame, 'maxDurationSeconds') ?? 120;
    const selection = asRec(field(frame, 'selection'));
    let providerId: string = selection !== undefined ? (str(selection, 'providerId') ?? '') : '';
    let language: string = selection !== undefined ? (str(selection, 'language') ?? 'auto') : 'auto';
    const rawProviders: Object | undefined = field(frame, 'providers');
    if (rawProviders !== undefined && Array.isArray(rawProviders)) {
      const providers = rawProviders as Object[];
      for (const one of providers) {
        const id: string = str(one, 'id') ?? '';
        if (id === providerId) {
          const prepared = asRec(field(one, 'preparation'));
          if (prepared !== undefined) {
            const phase: string = str(prepared, 'phase') ?? '';
            if (phase !== 'ready' && phase !== 'standby') {
              throw new SpeechFailure('speech/not-ready', SpeechFailure.messageFor('speech/not-ready'));
            }
          }
          const langs: Object | undefined = field(one, 'languages');
          if (langs !== undefined && Array.isArray(langs) && !(langs as Object[]).includes('auto')) {
            language = str(selection as Object, 'language') ?? language;
          }
        }
      }
    }
    const seconds: number = Math.min(120, maxDurationSeconds, (maxAudioBytes - 44) / BYTE_RATE);
    if (!isFinite(seconds) || seconds < 0.1) {
      throw new SpeechFailure('speech/invalid-response', SpeechFailure.messageFor('speech/invalid-response'));
    }
    return {
      providerId: providerId,
      language: language,
      maxBytes: maxAudioBytes,
      maxPcmBytes: Math.floor(seconds * SAMPLE_RATE) * 2,
      durationMs: Math.floor(seconds * 1000)
    };
  }

  /** 开始采集：限制值由 catalog() 预先拿到 */
  async start(limits: SpeechLimits, onError: (message: string) => void): Promise<void> {
    if (this.capturer !== null) {
      return;
    }
    this.chunks = [];
    this.totalBytes = 0;
    this.limitPcmBytes = limits.maxPcmBytes;
    const generation: number = ++this.generating;
    let capturer: audio.AudioCapturer | null = null;
    const options: audio.AudioCapturerOptions = {
      streamInfo: {
        samplingRate: audio.AudioSamplingRate.SAMPLE_RATE_16000,
        channels: audio.AudioChannel.CHANNEL_1,
        sampleFormat: audio.AudioSampleFormat.SAMPLE_FORMAT_S16LE,
        encodingType: audio.AudioEncodingType.ENCODING_TYPE_RAW
      },
      capturerInfo: { source: audio.SourceType.SOURCE_TYPE_MIC, capturerFlags: 0 }
    };
    try {
      capturer = await audio.createAudioCapturer(options);
      if (generation !== this.generating) {
        await capturer.release();
        return;
      }
      this.capturer = capturer;
      this.recording = true;
      const active = capturer;
      const readLoop = async (): Promise<void> => {
        try {
          while (generation === this.generating && this.recording) {
            const buffer: ArrayBuffer = await active.read(1280, true);
            if (generation !== this.generating || !this.recording) {
              break;
            }
            if (this.totalBytes < this.limitPcmBytes) {
              const chunk: Uint8Array = new Uint8Array(buffer.slice(0));
              this.chunks.push(chunk);
              this.totalBytes += chunk.length;
              this.currentLevel = SpeechInput.frameLevel(chunk);
            }
          }
        } catch (err) {
          if (generation === this.generating && this.recording) {
            this.recording = false;
            onError('录音中断，请重试');
          }
        }
      };
      readLoop();
      // 麦克风被占用 / 权限被拒时 start() 可能一直挂着：给一个看门狗，避免长按后无限等
      await new Promise<void>((resolve: () => void, reject: (reason: Object) => void) => {
        const timer = setTimeout(() => {
          reject(new SpeechFailure('voice/start-timeout', SpeechFailure.messageFor('voice/start-timeout')));
        }, 10000);
        active.start().then(() => {
          clearTimeout(timer);
          resolve();
        }).catch((reason: Object) => {
          clearTimeout(timer);
          reject(reason);
        });
      });
    } catch (err) {
      this.recording = false;
      this.releaseCapturer();
      throw SpeechInput.failureOf(err);
    }
  }

  private releaseCapturer(): void {
    const capturer = this.capturer;
    this.capturer = null;
    if (capturer !== null) {
      capturer.stop().then(() => capturer.release()).catch(() => {
        capturer.release().catch(() => {});
      });
    }
  }

  /** 结束录音并把音频发给网关转写；返回识别文本 */
  async stopAndTranscribe(limits: SpeechLimits): Promise<string> {
    this.recording = false;
    const generation: number = this.generating;
    this.releaseCapturer();
    await new Promise<void>((resolve: () => void) => {
      setTimeout(() => resolve(), 120);
    });
    if (generation !== this.generating) {
      return '';
    }
    if (this.totalBytes < 2) {
      throw new SpeechFailure('speech/invalid-audio', '没有录到有效声音，请重试');
    }
    const wav: Uint8Array = SpeechInput.pcmToWav(this.chunks, this.totalBytes, limits.maxPcmBytes);
    if (wav.length > limits.maxBytes) {
      throw new SpeechFailure('speech/invalid-audio', SpeechFailure.messageFor('speech/invalid-audio'));
    }
    const helper = new util.Base64Helper();
    const base64: string = helper.encodeToStringSync(wav);
    const requestId: string = 'voice-' + Date.now();
    const payload: Record<string, Object> = {
      'requestId': requestId,
      'audioBase64': base64,
      'providerId': limits.providerId
    };
    if (limits.language.length > 0) {
      payload['language'] = limits.language;
    }
    Logger.info('speech transcribe bytes=' + wav.length.toString() + ' provider=' + limits.providerId);
    const frame: GatewayFrame = await GatewayClient.get().requestPlugin('speech-transcribe', payload, 185000);
    const text: string = str(frame, 'text') ?? '';
    if (text.trim().length === 0) {
      throw new SpeechFailure('voice/empty', SpeechFailure.messageFor('voice/empty'));
    }
    return text.trim();
  }

  /** 取消：丢弃音频，可选通知网关取消在途转写 */
  cancel(requestId?: string): void {
    this.generating++;
    this.recording = false;
    this.chunks = [];
    this.totalBytes = 0;
    this.releaseCapturer();
    if (requestId !== undefined && requestId.length > 0) {
      GatewayClient.get().requestPlugin('speech-cancel', { 'targetRequestId': requestId }, 6000).catch(() => {});
    }
  }

  /**
   * 把音频栈抛出的原始错误翻成可读失败。
   * 鸿蒙在「未声明/未授予麦克风权限」或「麦克风被其它应用占用」时，createAudioCapturer / start
   * 会直接抛 6800301「system error」——这行字对用户没有意义，必须翻译成能行动的话。
   */
  static failureOf(err: Object): SpeechFailure {
    if (err instanceof SpeechFailure) {
      return err;
    }
    const message: string = err instanceof Error ? err.message : String(err);
    const lower: string = message.toLowerCase();
    if (lower.indexOf('permission') >= 0 || lower.indexOf('not granted') >= 0) {
      return new SpeechFailure('voice/permission', SpeechFailure.messageFor('voice/permission'));
    }
    if (lower.indexOf('system error') >= 0) {
      return new SpeechFailure('voice/permission',
        '麦克风启动失败：麦克风权限未开启，或正被其它应用占用。请到系统设置中允许「鲸尾」使用麦克风后重试');
    }
    if (lower.indexOf('timeout') >= 0 || message.indexOf('超时') >= 0) {
      return new SpeechFailure('voice/start-timeout', SpeechFailure.messageFor('voice/start-timeout'));
    }
    return new SpeechFailure('voice/start', '麦克风启动失败：' + message);
  }

  /** 一帧 PCM16 的 RMS → 0..1（对齐小程序 frameLevel 的 dB 映射） */
  private static frameLevel(chunk: Uint8Array): number {
    const view: DataView = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    let energy: number = 0;
    let count: number = 0;
    for (let i = 0; i + 1 < view.byteLength; i += 2) {
      const value: number = view.getInt16(i, true) / 32768;
      energy += value * value;
      count += 1;
    }
    const rms: number = Math.sqrt(energy / Math.max(1, count));
    const db: number = 20 * Math.log10(Math.max(0.0001, rms));
    const level: number = (db + 55) / 55;
    return Math.max(0, Math.min(1, level));
  }

  /** PCM16 小端 → 44 字节 WAV；两端补静音并做峰值归一（对齐小程序 pcmToWav） */
  private static pcmToWav(chunks: Uint8Array[], total: number, maxPcmBytes: number): Uint8Array {
    const length: number = Math.min(total, maxPcmBytes);
    const leading: number = Math.min(Math.floor(BYTE_RATE / 5), maxPcmBytes - length);
    const trailing: number = Math.min(Math.floor(BYTE_RATE / 2), maxPcmBytes - length - leading);
    const out: Uint8Array = new Uint8Array(44 + leading + length + trailing);
    const view: DataView = new DataView(out.buffer);
    const writeText = (at: number, value: string): void => {
      for (let i = 0; i < value.length; i++) {
        out[at + i] = value.charCodeAt(i);
      }
    };
    writeText(0, 'RIFF');
    view.setUint32(4, out.byteLength - 8, true);
    writeText(8, 'WAVEfmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, SAMPLE_RATE, true);
    view.setUint32(28, BYTE_RATE, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeText(36, 'data');
    view.setUint32(40, out.byteLength - 44, true);
    // 把分片里的 PCM 拷到 data 段
    const pcm: Uint8Array = new Uint8Array(out.buffer, 44 + leading, length);
    let offset: number = 0;
    for (const chunk of chunks) {
      if (offset >= length) {
        break;
      }
      const take: number = Math.min(chunk.length, length - offset);
      pcm.set(chunk.subarray(0, take), offset);
      offset += take;
    }
    // 峰值归一：声音偏小时提亮，避免转写听不清
    let peak: number = 0;
    let energy: number = 0;
    const pcmView: DataView = new DataView(out.buffer, 44 + leading, length);
    for (let i = 0; i + 1 < length; i += 2) {
      const sample: number = pcmView.getInt16(i, true);
      peak = Math.max(peak, Math.abs(sample));
      energy += sample * sample;
    }
    const rms: number = Math.sqrt(energy / Math.max(1, Math.floor(length / 2)));
    const gain: number = (peak >= 128 && peak < 8192 && peak >= rms * 3) ? Math.min(8, 16384 / peak) : 1;
    if (gain > 1) {
      for (let i = 0; i + 1 < length; i += 2) {
        const scaled: number = Math.round(pcmView.getInt16(i, true) * gain);
        pcmView.setInt16(i, Math.max(-32768, Math.min(32767, scaled)), true);
      }
    }
    return out;
  }
}
