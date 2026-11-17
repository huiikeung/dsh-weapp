import { fileIo, hash } from '@kit.CoreFileKit';
import { common } from '@kit.AbilityKit';
import { util } from '@kit.ArkTS';
import { GatewayClient } from '../network/GatewayClient';
import { base64Decode } from '../crypto/DshCrypto';
import { randomBytes } from '../crypto/Sodium';
import { GatewayFrame } from '../protocol/GatewayDtos';
import { asRec, num, str } from '../protocol/GatewayFrameCodec';
import { PickedAttachment } from './AttachmentPicker';

export interface UploadResult {
  receiptId: string;
  uploadId: string;
  name: string;
  size: number;
  sha256: string;
  file: Object;
}

const MAX_UPLOAD_BYTES: number = 50 * 1024 * 1024;
const READ_BYTES: number = 64 * 1024;

function checkConnection(client: GatewayClient, generation: number): void {
  if (!client.isConnected() || client.generation() !== generation) {
    throw new Error('连接已变化，请重新操作');
  }
}

/** Read, hash, and upload a picker URI with offset/receipt validation. */
export async function uploadAttachment(
  client: GatewayClient,
  sessionId: string,
  attachment: PickedAttachment,
  onProgress?: (percent: number) => void
): Promise<UploadResult> {
  const generation: number = client.generation();
  checkConnection(client, generation);
  const file = await fileIo.open(attachment.uri, fileIo.OpenMode.READ_ONLY);
  let uploadId: string = '';
  let completed: boolean = false;
  try {
    const stat = await fileIo.stat(file.fd);
    const size: number = stat.size;
    if (!Number.isSafeInteger(size) || size < 0 || size > MAX_UPLOAD_BYTES) {
      throw new Error('文件不能超过 50 MB');
    }
    const digest: string = (await hash.hash(attachment.uri, 'sha256')).toLowerCase();
    checkConnection(client, generation);
    const opened: GatewayFrame = await client.openFileUpload(sessionId, attachment.name, size, digest);
    checkConnection(client, generation);
    uploadId = opened.uploadId ?? opened.transferId ?? '';
    const chunkBytes: number = opened.chunkBytes ?? 0;
    if (opened.sessionId !== sessionId || uploadId.length === 0 || opened.size !== size ||
      !Number.isSafeInteger(chunkBytes) || chunkBytes < 1 || chunkBytes > 4 * 1024 * 1024) {
      throw new Error('文件上传响应无效');
    }
    const chunkSize: number = Math.min(READ_BYTES, chunkBytes);
    let offset: number = 0;
    while (offset < size) {
      const length: number = Math.min(chunkSize, size - offset);
      const buffer: ArrayBuffer = new ArrayBuffer(length);
      const read: number = await fileIo.read(file.fd, buffer, { length: length });
      checkConnection(client, generation);
      if (read !== length) throw new Error('文件读取失败');
      const bytes: Uint8Array = new Uint8Array(buffer, 0, read);
      const data: string = new util.Base64Helper().encodeToStringSync(bytes);
      const accepted: GatewayFrame = await client.uploadFileChunk(sessionId, uploadId, offset, data);
      checkConnection(client, generation);
      const nextOffset: number = accepted.nextOffset ?? -1;
      if (accepted.sessionId !== sessionId || (accepted.uploadId ?? accepted.transferId) !== uploadId || nextOffset !== offset + read) {
        throw new Error('文件上传偏移校验失败');
      }
      offset = nextOffset;
      if (onProgress !== undefined) onProgress(size === 0 ? 100 : Math.floor(offset * 100 / size));
    }
    const finished: GatewayFrame = await client.finishFileUpload(sessionId, uploadId);
    checkConnection(client, generation);
    const receiptId: string = finished.receiptId ?? '';
    const returnedSha: string = (finished.sha256 ?? '').toLowerCase();
    const returnedFile = asRec(finished.file);
    if (finished.sessionId !== sessionId || (finished.uploadId ?? finished.transferId) !== uploadId ||
      receiptId.length === 0 || returnedSha !== digest || returnedFile === undefined ||
      (str(returnedFile, 'attachmentId') ?? '').length === 0 ||
      (str(returnedFile, 'name') ?? '').length === 0 || num(returnedFile, 'bytes') !== size) {
      throw new Error('文件校验失败，请重试');
    }
    completed = true;
    return { receiptId: receiptId, uploadId: uploadId, name: attachment.name, size: size, sha256: digest, file: returnedFile };
  } finally {
    try { await fileIo.close(file); } catch (err) { }
    if (!completed && uploadId.length > 0 && client.isConnected() && client.generation() === generation) {
      await client.cancelFileUpload(sessionId, uploadId).catch(() => { });
    }
  }
}

export interface DownloadResult {
  localPath: string;
  name: string;
  mediaType: string;
  size: number;
  sha256: string;
}

const MAX_DOWNLOAD_BYTES: number = 50 * 1024 * 1024;

/** Download to app filesDir with chunk, size, eof and SHA-256 validation. */
export async function downloadAttachment(
  context: common.UIAbilityContext,
  client: GatewayClient,
  sessionId: string,
  path: string,
  onProgress?: (percent: number) => void
): Promise<DownloadResult> {
  const generation: number = client.generation();
  checkConnection(client, generation);
  const opened: GatewayFrame = await client.openFileDownload(sessionId, path);
  checkConnection(client, generation);
  const transferId: string = opened.transferId ?? '';
  const size: number = opened.size ?? -1;
  const chunkBytes: number = opened.chunkBytes ?? 0;
  const rawName: string = opened.name ?? path.substring(path.lastIndexOf('/') + 1);
  const name: string = sanitizeFileName(rawName.length > 0 ? rawName : 'file');
  if (opened.sessionId !== sessionId || opened.path !== path || transferId.length === 0 ||
    !Number.isSafeInteger(size) || size < 0 || size > MAX_DOWNLOAD_BYTES ||
    !Number.isSafeInteger(chunkBytes) || chunkBytes < 1 || chunkBytes > 4 * 1024 * 1024) {
    if (transferId.length > 0 && client.isConnected()) {
      await client.cancelFileDownload(transferId).catch(() => { });
    }
    throw new Error('文件下载响应无效');
  }
  const basePath: string = context.filesDir + '/dsh-downloads';
  try { await fileIo.mkdir(basePath); } catch (err) { }
  const random: Uint8Array = randomBytes(16);
  let unique: string = '';
  for (const byte of random) unique += (byte < 16 ? '0' : '') + byte.toString(16);
  const suffix: string = unique + '-' + name;
  const tempPath: string = basePath + '/.' + suffix + '.part';
  const finalPath: string = basePath + '/' + suffix;
  let output: fileIo.File | null = null;
  let ownsTemp: boolean = false;
  let completed: boolean = false;
  try {
    output = await fileIo.open(tempPath, fileIo.OpenMode.READ_WRITE | fileIo.OpenMode.CREATE | fileIo.OpenMode.TRUNC);
    ownsTemp = true;
    let offset: number = 0;
    let expectedDigest: string = '';
    while (true) {
      checkConnection(client, generation);
      const frame: GatewayFrame = await client.readFileDownload(transferId, offset);
      checkConnection(client, generation);
      const data: string = frame.data ?? '';
      if (frame.transferId !== transferId || frame.offset !== offset || typeof frame.data !== 'string' ||
        typeof frame.eof !== 'boolean' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data) ||
        (data.length === 0 && frame.eof !== true)) {
        throw new Error('文件下载响应无效');
      }
      const bytes: Uint8Array = base64Decode(data);
      if (bytes.length > chunkBytes || offset + bytes.length > size) throw new Error('文件下载分块超限');
      if (bytes.length > 0) {
        const chunk: ArrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
        const written: number = await fileIo.write(output.fd, chunk, { length: bytes.length });
        if (written !== bytes.length) throw new Error('文件写入失败');
      }
      offset += bytes.length;
      if (onProgress !== undefined) onProgress(size === 0 ? 100 : Math.floor(offset * 100 / size));
      if (frame.eof === true) {
        if (offset !== size) throw new Error('文件大小校验失败');
        expectedDigest = (frame.sha256 ?? '').toLowerCase();
        if (!/^[0-9a-f]{64}$/.test(expectedDigest)) throw new Error('文件校验摘要无效');
        break;
      }
    }
    await fileIo.close(output);
    output = null;
    const digest: string = (await hash.hash(tempPath, 'sha256')).toLowerCase();
    checkConnection(client, generation);
    if (digest !== expectedDigest) throw new Error('文件校验失败，请重新下载');
    await fileIo.rename(tempPath, finalPath);
    completed = true;
    return { localPath: finalPath, name: name, mediaType: opened.mediaType ?? '', size: size, sha256: digest };
  } finally {
    if (output !== null) { try { await fileIo.close(output); } catch (err) { } }
    if (!completed) {
      if (client.isConnected() && client.generation() === generation) {
        await client.cancelFileDownload(transferId).catch(() => { });
      }
      if (ownsTemp) await fileIo.unlink(tempPath).catch(() => { });
    }
  }
}

function sanitizeFileName(value: string): string {
  let result: string = value.replace(/[\\/\x00-\x1F:*?"<>|]/g, '_');
  if (result.length === 0) result = 'file';
  return result.substring(Math.max(0, result.length - 160));
}

