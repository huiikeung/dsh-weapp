import { cryptoFramework } from '@kit.CryptoArchitectureKit';
import { util } from '@kit.ArkTS';
import { BusinessError } from '@kit.BasicServicesKit';
import { Logger } from '../common/Logger';

/** 拼接字节数组。 */
export function concatBytes(parts: Uint8Array[]): Uint8Array {
  let total: number = 0;
  for (const part of parts) {
    total += part.length;
  }
  const out: Uint8Array = new Uint8Array(total);
  let offset: number = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export function utf8Encode(text: string): Uint8Array {
  return new util.TextEncoder().encodeInto(text);
}

export function utf8Decode(bytes: Uint8Array): string {
  return util.TextDecoder.create('utf-8').decodeToString(bytes);
}

export function base64Decode(text: string): Uint8Array {
  const normalized: string = text.replace(/-/g, '+').replace(/_/g, '/');
  const helper = new util.Base64Helper();
  return helper.decodeSync(normalized, util.Type.BASIC);
}

/** SHA-512（nacl.hash 等价）。 */
export function sha512(data: Uint8Array): Uint8Array {
  const md = cryptoFramework.createMd('SHA512');
  md.updateSync({ data: data });
  const digest = md.digestSync();
  return digest.data;
}

/** Ed25519 验签：公钥为 32 字节原始编码（配对载荷里的 agentPubKey）。 */
export function verifyEd25519(publicKeyRaw: Uint8Array, message: Uint8Array, signature: Uint8Array): boolean {
  if (publicKeyRaw.length !== 32 || signature.length !== 64) {
    return false;
  }
  // 原始 32 字节公钥包成 X.509 SubjectPublicKeyInfo（Ed25519 OID）。
  const prefix: Uint8Array = new Uint8Array([
    0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00
  ]);
  const der: Uint8Array = concatBytes([prefix, publicKeyRaw]);
  try {
    const generator = cryptoFramework.createAsyKeyGenerator('Ed25519');
    const keyPair = generator.convertKeySync({ data: der }, null);
    const verifier = cryptoFramework.createVerify('Ed25519');
    verifier.initSync(keyPair.pubKey);
    verifier.updateSync({ data: message });
    return verifier.verifySync(null, { data: signature });
  } catch (err) {
    const error = err as BusinessError;
    Logger.warn('ed25519 verify failed: ' + error.message);
    return false;
  }
}
