import { util } from '@kit.ArkTS';

/**
 * MGW1 数据通道分片编解码（对齐 iOS GatewayMgwCodec / KMP MgwCodec）：
 * 头 32 字节：magic "MGW1" | version=1 | flags=0 | channel | reserved=0
 *             sendSequence(u64) | index(u32) | count(u32) | total(u32) | length(u32)
 * 帧长 33..16384；payload 长度 = frameLimit - 32；逻辑消息上限 16 MiB；
 * 30 秒缺片超时。
 */
const HEADER_BYTES: number = 32;
const UTF8: util.TextDecoder = new util.TextDecoder('utf-8');
const MAGIC_0: number = 77;
const MAGIC_1: number = 71;
const MAGIC_2: number = 87;
const MAGIC_3: number = 49;
const MAX_FRAME_BYTES: number = 16384;
const MAX_MESSAGE_BYTES: number = 16777216;
const PARTIAL_TIMEOUT_MS: number = 30000;

export class MgwCodec {
  private channel: number;
  private sendSequence: number = 1;
  private receiveSequence: number = 1;
  private nextChunk: number = 0;
  private chunkCount: number = 0;
  private totalBytes: number = 0;
  private partial: Uint8Array = new Uint8Array(0);
  private touchedAt: number = 0;
  private writtenBytes: number = 0;

  constructor(channel: number) {
    this.channel = channel;
  }

  get hasPartial(): boolean {
    return this.nextChunk !== 0;
  }

  private writeU64(view: DataView, offset: number, value: number): void {
    const high: number = Math.floor(value / 4294967296);
    const low: number = value % 4294967296;
    view.setUint32(offset, high);
    view.setUint32(offset + 4, low);
  }

  private readU64(view: DataView, offset: number): number {
    const high: number = view.getUint32(offset);
    const low: number = view.getUint32(offset + 4);
    return high * 4294967296 + low;
  }

  /** 一条逻辑消息 → 若干分片（每片 ≤ frameLimit）。 */
  encode(text: string, frameLimit: number, messageLimit: number): Uint8Array[] {
    const encoder: util.TextEncoder = new util.TextEncoder();
    const bytes: Uint8Array = encoder.encodeInto(text);
    const totalBytes: number = bytes.length;
    if (totalBytes === 0 || totalBytes > Math.min(messageLimit, MAX_MESSAGE_BYTES)) {
      throw new Error('mgw-message-too-large');
    }
    const limit: number = Math.min(frameLimit, MAX_FRAME_BYTES);
    if (limit < 33 || this.sendSequence > Number.MAX_SAFE_INTEGER) {
      throw new Error('mgw-invalid-frame-limit');
    }
    const size: number = limit - HEADER_BYTES;
    const count: number = Math.ceil(totalBytes / size);
    const frames: Uint8Array[] = [];
    for (let index: number = 0; index < count; index++) {
      const start: number = index * size;
      const length: number = Math.min(size, totalBytes - start);
      const frame: Uint8Array = new Uint8Array(HEADER_BYTES + length);
      frame[0] = MAGIC_0;
      frame[1] = MAGIC_1;
      frame[2] = MAGIC_2;
      frame[3] = MAGIC_3;
      frame[4] = 1;
      frame[5] = 0;
      frame[6] = this.channel;
      frame[7] = 0;
      const view: DataView = new DataView(frame.buffer);
      this.writeU64(view, 8, this.sendSequence);
      view.setUint32(16, index);
      view.setUint32(20, count);
      view.setUint32(24, totalBytes);
      view.setUint32(28, length);
      frame.set(bytes.subarray(start, start + length), HEADER_BYTES);
      frames.push(frame);
    }
    this.sendSequence += 1;
    return frames;
  }

  /** 收到一片：返回完整逻辑消息文本；未收齐返回 undefined；非法帧抛错（调用方应关闭整组）。 */
  receive(input: Uint8Array, now: number = Date.now()): string | undefined {
    this.checkIdle(now);
    if (input.length < 33 || input.length > MAX_FRAME_BYTES) {
      throw new Error('mgw-invalid-frame-length');
    }
    if (input[0] !== MAGIC_0 || input[1] !== MAGIC_1 || input[2] !== MAGIC_2 || input[3] !== MAGIC_3 ||
        input[4] !== 1 || input[5] !== 0 || input[6] !== this.channel || input[7] !== 0) {
      throw new Error('mgw-invalid-header');
    }
    const view: DataView = new DataView(input.buffer, input.byteOffset, input.byteLength);
    const sequence: number = this.readU64(view, 8);
    const index: number = view.getUint32(16);
    const count: number = view.getUint32(20);
    const total: number = view.getUint32(24);
    const length: number = view.getUint32(28);
    if (sequence !== this.receiveSequence || index !== this.nextChunk || total < 1 ||
        total > MAX_MESSAGE_BYTES || count === 0 || count > total || index >= count ||
        length !== input.length - HEADER_BYTES) {
      throw new Error('mgw-invalid-frame');
    }
    if (this.nextChunk === 0) {
      this.chunkCount = count;
      this.totalBytes = total;
      this.partial = new Uint8Array(total);
    }
    if (this.chunkCount !== count || this.totalBytes !== total ||
        this.nextChunk * 0 + this.partial.length > total) {
      throw new Error('mgw-inconsistent-message');
    }
    this.partial.set(input.subarray(HEADER_BYTES), this.writtenBytes);
    this.writtenBytes += length;
    this.nextChunk += 1;
    this.touchedAt = now;
    if (this.nextChunk !== count) {
      return undefined;
    }
    if (this.partial.length !== total) {
      throw new Error('mgw-incomplete-message');
    }
    const text: string = UTF8.decodeToString(this.partial);
    this.partial = new Uint8Array(0);
    this.nextChunk = 0;
    this.chunkCount = 0;
    this.totalBytes = 0;
    this.writtenBytes = 0;
    this.receiveSequence += 1;
    return text;
  }

  /** 缺片超过 30 秒：关闭整组 */
  private checkIdle(now: number): void {
    if (this.nextChunk !== 0 && now - this.touchedAt >= PARTIAL_TIMEOUT_MS) {
      throw new Error('mgw-partial-timeout');
    }
  }

  close(): void {
    this.partial = new Uint8Array(0);
    this.nextChunk = 0;
    this.chunkCount = 0;
    this.totalBytes = 0;
  }
}
