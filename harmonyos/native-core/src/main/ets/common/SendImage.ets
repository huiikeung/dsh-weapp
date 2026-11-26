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
// 关键：单帧必须远小于 WebSocket 上限。之前 target 1.4MB（base64 ≈1.9MB）+
// 4 张图就是 ~8MB 单帧，ArkTS 的 ws.send 会异步失败而 Promise 还在等 60s，
// 表现为「点了发送没反应」，之后同 lane 的请求还会被 request busy 直接拒掉。
const FAST_PATH_MAX_BYTES: number = 600 * 1024;
const TARGET_BYTES: number = 560 * 1024;
const FALLBACK_RAW_MAX_BYTES: number = 8 * 1024 * 1024;
const MAX_SIDE: number = 1600;

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

/**
 * 读文件头判断「真实」图片格式。
 * 网关会用 magic 校验 mediaType，声明与字节不符就回 session/attachment-invalid
 * （「Declared image type does not match its bytes.」）——之前按文件扩展名声明，
 * 相册里扩展名和真实编码不一致的图（HEIC 存成 .jpg、PNG 改名等）必然发送失败。
 */
function detectMediaType(raw: string): string {
  let file: fileIo.File | undefined = undefined;
  try {
    file = fileIo.openSync(raw, fileIo.OpenMode.READ_ONLY);
    const head: ArrayBuffer = new ArrayBuffer(32);
    const read: number = fileIo.readSync(file.fd, head);
    if (read <= 0) {
      return '';
    }
    const b: Uint8Array = new Uint8Array(head, 0, read);
    if (b.length >= 3 && b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) {
      return 'image/jpeg';
    }
    if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) {
      return 'image/png';
    }
    if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) {
      return 'image/gif';
    }
    if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46
      && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) {
      return 'image/webp';
    }
    if (b.length >= 2 && b[0] === 0x42 && b[1] === 0x4D) {
      return 'image/bmp';
    }
    if (b.length >= 12) {
      const brand: string = String.fromCharCode(b[8], b[9], b[10], b[11]);
      if (brand === 'heic' || brand === 'heix' || brand === 'hevc' || brand === 'mif1' || brand === 'msf1') {
        return 'image/heic';
      }
    }
    return '';
  } catch (err) {
    Logger.warn('[SendImage] detect failed ' + (err instanceof Error ? err.message : String(err)));
    return '';
  } finally {
    if (file !== undefined) {
      try {
        fileIo.closeSync(file);
      } catch (ignored) {
      }
    }
  }
}

function readBase64(raw: string, name: string, mediaType: string): SendImagePayload | undefined {
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
    return { mediaType: mediaType, data: encoded, name: name };
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
  // 以文件头为准声明 mediaType（网关按 magic 校验，扩展名不可信）
  const detected: string = detectMediaType(raw);
  const supported: string[] = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  const passthrough: boolean = supported.indexOf(detected) >= 0;
  Logger.info('[SendImage] ' + name + ' size=' + size.toString() + ' detected=' + (detected.length > 0 ? detected : 'unknown'));
  if (passthrough && size > 0 && size <= FAST_PATH_MAX_BYTES) {
    const fast: SendImagePayload | undefined = readBase64(raw, name, detected);
    if (fast !== undefined) {
      return fast;
    }
  }
  // 其它格式（HEIC/BMP/未知）或体积偏大：统一转 JPEG（顺带把尺寸压到 MAX_SIDE）
  const packed: SendImagePayload | undefined = await transcodeJpeg(raw, name);
  if (packed !== undefined) {
    return packed;
  }
  if (passthrough && size > 0 && size <= FALLBACK_RAW_MAX_BYTES) {
    return readBase64(raw, name, detected);
  }
  Logger.warn('[SendImage] unsupported image ' + name + ' detected=' + (detected.length > 0 ? detected : 'unknown'));
  return undefined;
}
