import { fileIo } from '@kit.CoreFileKit';
import { image } from '@kit.ImageKit';
import { util } from '@kit.ArkTS';
import { Logger } from './Logger';

/**
 * 发图统一管线（工作模式 / Bot 模式共用）。
 *
 * 为什么要转码：网关只接受 png/jpeg/webp/gif 四种 mediaType，
 * 相机原图常见 HEIC/HEIF、截图有时 BMP；另外原图 base64 动辄十几 MB，
 * 一次性塞进 WebSocket 帧会让发送"看起来没反应"。所以：
 *   · 已经是 png/jpeg/webp/gif 且 ≤1.5MB  → 原样直传（快）
 *   · 其它格式或超过 1.5MB             → 解码后最长边 2048 + JPEG 质量阶梯压到 ≤1.4MB
 * 失败返回 undefined（调用方必须给出可见错误，不能静默丢弃）。
 */

/** 网关允许的图片 mediaType */
const SUPPORTED_NAME_EXTENSIONS: string[] = ['png', 'jpg', 'jpeg', 'webp', 'gif'];
const FAST_PATH_MAX_BYTES: number = 1500 * 1024;
const TARGET_BYTES: number = 1400 * 1024;
const FALLBACK_RAW_MAX_BYTES: number = 8 * 1024 * 1024;
const MAX_SIDE: number = 2048;

export interface SendImagePayload {
  mediaType: string;
  data: string;
  name: string;
}

function extensionOf(name: string): string {
  const lower: string = name.toLowerCase();
  const dot: number = lower.lastIndexOf('.');
  return dot >= 0 ? lower.substring(dot + 1) : '';
}

/** 网关支持直接透传的图片扩展名 */
export function isGatewayImageName(name: string): boolean {
  return SUPPORTED_NAME_EXTENSIONS.indexOf(extensionOf(name)) >= 0;
}

function gatewayMediaTypeOf(name: string): string {
  const ext: string = extensionOf(name);
  if (ext === 'png') {
    return 'image/png';
  }
  if (ext === 'webp') {
    return 'image/webp';
  }
  if (ext === 'gif') {
    return 'image/gif';
  }
  return 'image/jpeg';
}

function rawPathOf(uri: string): string {
  return uri.startsWith('file://') ? uri.substring(7) : uri;
}

function readBase64(raw: string, name: string): SendImagePayload | undefined {
  let file: fileIo.File | undefined = undefined;
  try {
    file = fileIo.openSync(raw, fileIo.OpenMode.READ_ONLY);
    const size: number = fileIo.statSync(file.fd).size;
    if (size <= 0 || size > FALLBACK_RAW_MAX_BYTES) {
      return undefined;
    }
    const buffer: ArrayBuffer = new ArrayBuffer(size);
    fileIo.readSync(file.fd, buffer);
    const encoded: string = new util.Base64Helper().encodeToStringSync(new Uint8Array(buffer));
    return { mediaType: gatewayMediaTypeOf(name), data: encoded, name: name };
  } catch (err) {
    Logger.warn('[SendImage] read failed ' + name + ' ' + (err instanceof Error ? err.message : String(err)));
    return undefined;
  } finally {
    if (file !== undefined) {
      try {
        fileIo.closeSync(file);
      } catch (ignored) {
      }
    }
  }
}

async function transcodeJpeg(raw: string, name: string): Promise<SendImagePayload | undefined> {
  let file: fileIo.File | undefined = undefined;
  let source: image.ImageSource | undefined = undefined;
  let pixelMap: image.PixelMap | undefined = undefined;
  let packer: image.ImagePacker | undefined = undefined;
  try {
    file = fileIo.openSync(raw, fileIo.OpenMode.READ_ONLY);
    source = image.createImageSource(file.fd);
    const info: image.ImageInfo = await source.getImageInfo();
    let width: number = info.size.width;
    let height: number = info.size.height;
    const maxSide: number = Math.max(width, height);
    if (maxSide > MAX_SIDE) {
      const scale: number = MAX_SIDE / maxSide;
      width = Math.max(1, Math.floor(width * scale));
      height = Math.max(1, Math.floor(height * scale));
    }
    pixelMap = await source.createPixelMap({ desiredSize: { width: width, height: height } });
    packer = image.createImagePacker();
    let quality: number = 85;
    let buffer: ArrayBuffer = await packer.packing(pixelMap, { format: 'image/jpeg', quality: quality });
    while (buffer.byteLength > TARGET_BYTES && quality > 30) {
      quality -= 10;
      buffer = await packer.packing(pixelMap, { format: 'image/jpeg', quality: quality });
    }
    const encoded: string = new util.Base64Helper().encodeToStringSync(new Uint8Array(buffer));
    Logger.info('[SendImage] transcoded ' + name + ' ' + width.toString() + 'x' + height.toString()
      + ' q=' + quality.toString() + ' bytes=' + buffer.byteLength.toString());
    return { mediaType: 'image/jpeg', data: encoded, name: name };
  } catch (err) {
    Logger.warn('[SendImage] transcode failed ' + name + ' ' + (err instanceof Error ? err.message : String(err)));
    return undefined;
  } finally {
    if (packer !== undefined) {
      try {
        await packer.release();
      } catch (ignored) {
      }
    }
    if (pixelMap !== undefined) {
      try {
        await pixelMap.release();
      } catch (ignored) {
      }
    }
    if (source !== undefined) {
      try {
        await source.release();
      } catch (ignored) {
      }
    }
    if (file !== undefined) {
      try {
        fileIo.closeSync(file);
      } catch (ignored) {
      }
    }
  }
}

/**
 * 生成可直接放进网关 images[] 的图片载荷。
 * 失败返回 undefined；调用方必须提示用户，不要静默当作已发送。
 */
export async function buildSendImagePayload(uri: string, name: string): Promise<SendImagePayload | undefined> {
  const raw: string = rawPathOf(uri);
  let size: number = 0;
  try {
    size = fileIo.statSync(raw).size;
  } catch (err) {
    size = 0;
  }
  if (size > 0 && size <= FAST_PATH_MAX_BYTES && isGatewayImageName(name)) {
    const fast: SendImagePayload | undefined = readBase64(raw, name);
    if (fast !== undefined) {
      return fast;
    }
  }
  const packed: SendImagePayload | undefined = await transcodeJpeg(raw, name);
  if (packed !== undefined) {
    return packed;
  }
  if (size > 0 && size <= FALLBACK_RAW_MAX_BYTES && isGatewayImageName(name)) {
    return readBase64(raw, name);
  }
  return undefined;
}
