import { util } from '@kit.ArkTS';
import { str, num, asRec } from './GatewayFrameCodec';

/** 配对信息，与 dsh-plugin-weapp-gateway v2 直连协议一致。 */
export interface PairingResult {
  ok: boolean;
  error: string;
  pairCode: string;
  expiresAt: number;
  gatewayName: string;
  gatewayId: string;
  candidates: string[];
  relayNodeId: string;
  relayAgentPubKey: string;
  relayInviteToken: string;
  relayAuthMode: string;
}

function fail(error: string): PairingResult {
  return { ok: false, error: error, pairCode: '', expiresAt: 0, gatewayName: '', gatewayId: '',
    candidates: [], relayNodeId: '', relayAgentPubKey: '', relayInviteToken: '', relayAuthMode: '' };
}

function decodeStrictBase64Url(value: string): string | undefined {
  if (value.length === 0 || value.indexOf('=') >= 0 || value.length % 4 === 1) return undefined;
  for (let i = 0; i < value.length; i++) {
    const c: number = value.charCodeAt(i);
    const alpha: boolean = (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57);
    if (!alpha && c !== 45 && c !== 95) return undefined;
  }
  try {
    let normalized: string = value.replace(/-/g, '+').replace(/_/g, '/');
    while (normalized.length % 4 !== 0) normalized += '=';
    const helper = new util.Base64Helper();
    const bytes: Uint8Array = helper.decodeSync(normalized, util.Type.BASIC);
    return util.TextDecoder.create('utf-8').decodeToString(bytes);
  } catch (err) {
    return undefined;
  }
}

function isIpv4(value: string): boolean {
  const parts: string[] = value.split('.');
  if (parts.length !== 4) return false;
  for (const part of parts) {
    if (part.length === 0) return false;
    const n: number = Number(part);
    if (isNaN(n) || n < 0 || n > 255 || String(n) !== part) return false;
  }
  return true;
}

function isLocalHost(rawHost: string): boolean {
  let host: string = rawHost.toLowerCase();
  if (host.startsWith('[') && host.endsWith(']')) host = host.substring(1, host.length - 1);
  if (host === 'localhost' || host === '::1' || host.endsWith('.local')) return true;
  if (host.indexOf(':') >= 0) return host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80:');
  if (!isIpv4(host)) return false;
  const p: string[] = host.split('.');
  const a: number = Number(p[0]);
  const b: number = Number(p[1]);
  return a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) ||
    (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254);
}

/** 规范化地址；明文 ws 只允许本地/局域网，公网必须使用 wss。 */
function normalizeEndpoint(raw: string): string {
  const value: string = raw.trim();
  if (value.length === 0 || value.length > 2048 || value.indexOf('\\') >= 0 ||
      value.indexOf('?') >= 0 || value.indexOf('#') >= 0 || value.indexOf('@') >= 0) return '';
  const schemeEnd: number = value.indexOf('://');
  if (schemeEnd <= 0) return '';
  const scheme: string = value.substring(0, schemeEnd).toLowerCase();
  if (scheme !== 'ws' && scheme !== 'wss') return '';
  const rest: string = value.substring(schemeEnd + 3);
  const slash: number = rest.indexOf('/');
  const authority: string = slash >= 0 ? rest.substring(0, slash) : rest;
  const path: string = slash >= 0 ? rest.substring(slash) : '/ws/mobile';
  if (authority.length === 0 || path.length === 0) return '';
  let host: string = authority;
  let port: string = '';
  if (authority.startsWith('[')) {
    const close: number = authority.indexOf(']');
    if (close < 0) return '';
    host = authority.substring(0, close + 1);
    port = authority.substring(close + 1);
    if (port.length > 0 && !port.startsWith(':')) return '';
  } else {
    const colon: number = authority.lastIndexOf(':');
    if (colon >= 0) {
      host = authority.substring(0, colon);
      port = authority.substring(colon);
      if (port.length <= 1) return '';
      const portNumber: number = Number(port.substring(1));
      if (isNaN(portNumber) || portNumber < 1 || portNumber > 65535) return '';
    }
  }
  if (host.length === 0 || host === '0.0.0.0' || host === '::' || host === '[::]') return '';
  if (scheme === 'ws' && !isLocalHost(host)) return '';
  return scheme + '://' + host.toLowerCase() + port + path;
}

function pushUnique(list: string[], value: string): void {
  const normalized: string = normalizeEndpoint(value);
  if (normalized.length > 0 && list.indexOf(normalized) < 0 && list.length < 16) list.push(normalized);
}

function validPairCode(value: string): boolean {
  if (value.length === 0 || value.indexOf(',') >= 0) return false;
  for (let i = 0; i < value.length; i++) {
    const c: number = value.charCodeAt(i);
    if (c <= 32 || c === 127) return false;
  }
  return true;
}

/** 解析严格 v2 载荷：不带 padding 的 Base64URL、未过期 pairingCode。 */
export function parsePairingPayload(rawText: string, nowMs: number = Date.now()): PairingResult {
  const text: string = rawText.trim();
  if (text.length === 0) return fail('配对内容为空');
  const decoded: string | undefined = decodeStrictBase64Url(text);
  if (decoded === undefined || decoded.length === 0) return fail('配对内容不是有效的 Base64URL');
  let payload: Object;
  try { payload = JSON.parse(decoded) as Object; } catch (err) { return fail('配对 JSON 解析失败'); }
  const record = asRec(payload);
  if (record === undefined) return fail('配对内容不是对象');
  const version: number = num(record, 'version') ?? 0;
  if (version !== 2) return fail('不支持的配对版本：' + version + '（当前需要 version 2）');
  const pairCode: string = str(record, 'pairingCode') ?? '';
  const expiresAt: number = num(record, 'expiresAt') ?? 0;
  if (!validPairCode(pairCode)) return fail('二维码缺少有效 pairingCode');
  if (expiresAt <= 0 || expiresAt <= nowMs) return fail('二维码已过期，请重新生成');
  const result: PairingResult = { ok: true, error: '', pairCode: pairCode, expiresAt: expiresAt,
    gatewayName: str(record, 'gatewayName') ?? '', gatewayId: str(record, 'gatewayId') ?? '',
    candidates: [], relayNodeId: '', relayAgentPubKey: '', relayInviteToken: '', relayAuthMode: '' };
  const publicUrl: string | undefined = str(record, 'publicUrl');
  if (publicUrl === undefined || normalizeEndpoint(publicUrl) === '') return fail('二维码 publicUrl 无效');
  const gatewayId: Object | undefined = record['gatewayId'];
  if (gatewayId !== undefined && gatewayId !== null &&
      (typeof gatewayId !== 'string' || !/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/.test(gatewayId))) {
    return fail('网关身份格式无效');
  }
  const gatewayName: Object | undefined = record['gatewayName'];
  if (gatewayName !== undefined && gatewayName !== null && typeof gatewayName !== 'string') return fail('网关名称格式无效');
  pushUnique(result.candidates, publicUrl);
  const endpoints = record['endpoints'];
  if (endpoints !== undefined && endpoints !== null && !Array.isArray(endpoints)) return fail('二维码候选地址格式无效');
  if (Array.isArray(endpoints)) {
    if (endpoints.length > 16) return fail('二维码候选地址超过 16 个');
    for (const item of endpoints as Object[]) {
      if (typeof item !== 'string' || normalizeEndpoint(item) === '') return fail('二维码候选地址无效');
      pushUnique(result.candidates, item);
    }
    const all: string[] = [publicUrl];
    for (const item of endpoints as string[]) if (all.indexOf(item) < 0) all.push(item);
    if (all.length > 16) return fail('二维码候选地址超过 16 个');
  }
  return result;
}
