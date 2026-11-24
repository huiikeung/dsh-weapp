/**
 * Bot 聊天图片加载：经 bot-call('image') 分块拉取（384 KiB/块、单图 ≤16 MiB）
 * 后落到应用缓存目录，UI 用 file:// 渲染。网关返回 rev = 内容 SHA-256，用于缓存键。
 */
import { fileIo as fs } from '@kit.CoreFileKit';
import { common } from '@kit.AbilityKit';
import { util } from '@kit.ArkTS';
import { BotStore } from './BotStore';
import { GatewayClient } from '../network/GatewayClient';
import { Logger } from '../common/Logger';
import { asRec, field, num, str } from '../protocol/GatewayFrameCodec';

const MAX_IMAGE_BYTES: number = 16 * 1024 * 1024;
const MAX_CHUNKS: number = 64;

export class BotImageCache {
  private static instance: BotImageCache = new BotImageCache();
  private paths: Map<string, string> = new Map<string, string>();
  private inflight: Map<string, boolean> = new Map<string, boolean>();

  static get(): BotImageCache {
    return BotImageCache.instance;
  }

  /** 已缓存图片的本地路径；没有返回空串。 */
  cachedPath(key: string): string {
    return this.paths.get(key) ?? '';
  }

  /** 拉取一张图片；成功后回调本地文件路径（失败静默，UI 保持占位）。 */
  load(key: string, chatId: string, sessionId: string, attachmentId: string, mediaType: string,
    onReady: (path: string) => void): void {
    const cached: string = this.paths.get(key) ?? '';
    if (cached.length > 0) {
      onReady(cached);
      return;
    }
    if (this.inflight.get(key) === true) {
      return;
    }
    this.inflight.set(key, true);
    void this.fetchAll(chatId, sessionId, attachmentId).then((bytes: Uint8Array | null) => {
      this.inflight.delete(key);
      if (bytes === null || bytes.byteLength === 0) {
        return;
      }
      const path: string = this.writeFile(attachmentId, mediaType, bytes);
      if (path.length === 0) {
        return;
      }
      this.paths.set(key, path);
      onReady(path);
    }).catch((error: Error) => {
      this.inflight.delete(key);
      Logger.warn('bot image failed: ' + error.message);
    });
  }

  private async fetchAll(chatId: string, sessionId: string, attachmentId: string): Promise<Uint8Array | null> {
    const chunks: Uint8Array[] = [];
    let offset: number = 0;
    let total: number = 0;
    let revision: string = '';
    let expectedSize: number = 0;
    const store: BotStore = BotStore.get();
    for (let attempt = 0; attempt < MAX_CHUNKS; attempt++) {
      const payload: Record<string, Object> = {
        'sessionId': sessionId, 'preview': false, 'offset': offset, 'attachmentId': attachmentId
      };
      const value: Record<string, Object> | undefined = await store.requestValue('image', payload, chatId);
      if (value === undefined) {
        return null;
      }
      const mime: string = str(value, 'mime') ?? '';
      if (mime !== 'image/png' && mime !== 'image/jpeg' && mime !== 'image/webp'
        && mime !== 'image/gif' && mime !== 'image/bmp') {
        return null;
      }
      const encoded: string = str(value, 'data') ?? str(value, 'bytes') ?? '';
      if (encoded.length === 0) {
        return null;
      }
      let decoded: Uint8Array;
      try {
        decoded = new util.Base64Helper().decodeSync(encoded);
      } catch (error) {
        return null;
      }
      if (decoded.byteLength === 0 || total + decoded.byteLength > MAX_IMAGE_BYTES) {
        return null;
      }
      const rev: string = str(value, 'rev') ?? '';
      if (offset !== 0 && rev.length > 0 && rev !== revision) {
        return null;
      }
      revision = rev;
      let done: boolean = true;
      if (field(value, 'nextOffset') !== undefined) {
        const next: number = num(value, 'nextOffset') ?? -1;
        const size: number = num(value, 'size') ?? -1;
        if (expectedSize > 0 && expectedSize !== size) {
          return null;
        }
        expectedSize = size;
        done = value.done === true;
        if (num(value, 'offset') !== offset || next !== offset + decoded.byteLength
          || size <= 0 || size > MAX_IMAGE_BYTES || next > size || done !== (next === size)) {
          return null;
        }
      }
      chunks.push(decoded);
      total += decoded.byteLength;
      offset += decoded.byteLength;
      if (done) {
        break;
      }
    }
    if (chunks.length === 0) {
      return null;
    }
    const merged: Uint8Array = new Uint8Array(total);
    let at: number = 0;
    for (const chunk of chunks) {
      merged.set(chunk, at);
      at += chunk.byteLength;
    }
    return merged;
  }
  private writeFile(attachmentId: string, mediaType: string, bytes: Uint8Array): string {
    try {
      const context: common.UIAbilityContext | undefined =
        AppStorage.get<common.UIAbilityContext>('uiAbilityContext');
      if (context === undefined) {
        return '';
      }
      const dir: string = context.cacheDir + '/bot-images';
      try {
        fs.mkdirSync(dir);
      } catch (error) {
      }
      let ext: string = '.png';
      if (mediaType.indexOf('jpeg') >= 0) ext = '.jpg';
      else if (mediaType.indexOf('webp') >= 0) ext = '.webp';
      else if (mediaType.indexOf('gif') >= 0) ext = '.gif';
      else if (mediaType.indexOf('bmp') >= 0) ext = '.bmp';
      const safe: string = attachmentId.replace(/[^a-zA-Z0-9]/g, '').substring(0, 48);
      const path: string = dir + '/' + safe + ext;
      const file = fs.openSync(path, fs.OpenMode.CREATE | fs.OpenMode.READ_WRITE | fs.OpenMode.TRUNC);
      try {
        fs.writeSync(file.fd, bytes.buffer as ArrayBuffer);
      } finally {
        fs.closeSync(file);
      }
      return 'file://' + path;
    } catch (error) {
      const reason: string = error instanceof Error ? error.message : String(error);
      Logger.warn('bot image write failed: ' + reason);
      return '';
    }
  }
}
