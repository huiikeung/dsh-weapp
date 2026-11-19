import { fileIo } from '@kit.CoreFileKit';
import { base64Decode } from '../crypto/DshCrypto';
import { GatewayFrame } from '../protocol/GatewayDtos';
import { asRec, num, str } from '../protocol/GatewayFrameCodec';
import { GatewayClient } from '../network/GatewayClient';
import { Logger } from './Logger';

const DIR_NAME: string = 'dsh-attachment-cache';
const MAX_IMAGE_BYTES: number = 20 * 1024 * 1024;
const EXTENSIONS: string[] = ['jpg', 'png', 'gif', 'webp', 'heic', 'bmp'];

/** image/* → 扩展名（对齐小程序 utils/attachment-cache.js 的 MEDIA_EXT）。 */
function extOf(mediaType: string, name: string): string {
  const media: string = mediaType.toLowerCase().split(';')[0].trim();
  if (media === 'image/jpeg' || media === 'image/jpg') return 'jpg';
  if (media === 'image/png') return 'png';
  if (media === 'image/gif') return 'gif';
  if (media === 'image/webp') return 'webp';
  if (media === 'image/heic' || media === 'image/heif') return 'heic';
  if (media === 'image/bmp') return 'bmp';
  const match: RegExpMatchArray | null = name.toLowerCase().match(/\.([a-z0-9]{2,5})(?:[?#]|$)/);
  if (match !== null && EXTENSIONS.indexOf(match[1]) >= 0) {
    return match[1];
  }
  return 'jpg';
}

function safeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 120);
}

/**
 * 图片附件本地缓存（对齐小程序 ascf_src/utils/attachment-cache.js）：
 * 会话历史只带 attachmentId，回显时按需向网关拉 base64 并落成文件，进程内记住路径。
 */
export class AttachmentImageCache {
  private static root: string = '';
  private static memory: Map<string, string> = new Map<string, string>();
  private static absent: Set<string> = new Set<string>();
  private static inflight: Map<string, Promise<string>> = new Map<string, Promise<string>>();

  /** 由 EntryAbility 在启动时注入 filesDir。 */
  static configure(filesDir: string): void {
    AttachmentImageCache.root = filesDir + '/' + DIR_NAME;
  }

  static isReady(): boolean {
    return AttachmentImageCache.root.length > 0;
  }

  /** 同步查询本地缓存：命中返回文件路径，否则返回 ''。 */
  static localPath(attachmentId: string, mediaType: string, name: string): string {
    if (!AttachmentImageCache.isReady() || attachmentId.length === 0) {
      return '';
    }
    const cached: string | undefined = AttachmentImageCache.memory.get(attachmentId);
    if (cached !== undefined) {
      return cached;
    }
    if (AttachmentImageCache.absent.has(attachmentId)) {
      return '';
    }
    const base: string = AttachmentImageCache.root + '/' + safeId(attachmentId);
    const preferred: string = extOf(mediaType, name);
    const candidates: string[] = [preferred];
    for (const ext of EXTENSIONS) {
      if (ext !== preferred) {
        candidates.push(ext);
      }
    }
    for (const ext of candidates) {
      const path: string = base + '.' + ext;
      try {
        fileIo.accessSync(path);
        AttachmentImageCache.memory.set(attachmentId, path);
        return path;
      } catch (err) { }
    }
    AttachmentImageCache.absent.add(attachmentId);
    return '';
  }

  private static ensureDir(): void {
    try {
      fileIo.mkdirSync(AttachmentImageCache.root);
    } catch (err) { }
  }

  /** 拉取并落盘；同一 attachmentId 并发调用复用同一个 Promise。 */
  static fetch(sessionId: string, attachmentId: string, mediaType: string, name: string): Promise<string> {
    const cached: string = AttachmentImageCache.localPath(attachmentId, mediaType, name);
    if (cached.length > 0) {
      return Promise.resolve(cached);
    }
    const running: Promise<string> | undefined = AttachmentImageCache.inflight.get(attachmentId);
    if (running !== undefined) {
      return running;
    }
    const task: Promise<string> = AttachmentImageCache.fetchOnce(sessionId, attachmentId, mediaType, name)
      .then((path: string) => {
        AttachmentImageCache.inflight.delete(attachmentId);
        return path;
      })
      .catch((err: Error) => {
        AttachmentImageCache.inflight.delete(attachmentId);
        throw err;
      });
    AttachmentImageCache.inflight.set(attachmentId, task);
    return task;
  }

  private static async fetchOnce(sessionId: string, attachmentId: string, mediaType: string, name: string): Promise<string> {
    if (!AttachmentImageCache.isReady() || sessionId.length === 0 || attachmentId.length === 0) {
      throw new Error('图片附件信息不完整');
    }
    const frame: GatewayFrame = await GatewayClient.get().requestAttachment(sessionId, attachmentId);
    const data: string = frame.data ?? '';
    if (data.length === 0) {
      throw new Error('附件数据为空');
    }
    const attachment = asRec(frame.attachment);
    const media: string = attachment !== undefined ? (str(attachment, 'mediaType') ?? mediaType) : mediaType;
    const displayName: string = attachment !== undefined ? (str(attachment, 'name') ?? name) : name;
    const bytes: number = attachment !== undefined ? (num(attachment, 'bytes') ?? 0) : 0;
    if (bytes > MAX_IMAGE_BYTES) {
      throw new Error('图片过大，无法自动显示');
    }
    AttachmentImageCache.ensureDir();
    const path: string = AttachmentImageCache.root + '/' + safeId(attachmentId) + '.' + extOf(media, displayName);
    const buffer: Uint8Array = base64Decode(data);
    const file: fileIo.File = fileIo.openSync(path,
      fileIo.OpenMode.READ_WRITE | fileIo.OpenMode.CREATE | fileIo.OpenMode.TRUNC);
    try {
      fileIo.writeSync(file.fd, buffer.buffer);
    } finally {
      fileIo.closeSync(file);
    }
    AttachmentImageCache.memory.set(attachmentId, path);
    AttachmentImageCache.absent.delete(attachmentId);
    Logger.info('attachment image cached ' + path + ' (' + buffer.length + 'B)');
    return path;
  }
}
