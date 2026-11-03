import { util } from '@kit.ArkTS';
import { str, num, asRec } from './GatewayFrameCodec';

/** 解析后的配对信息（原生 MVP：直连候选优先，中继元信息保留待 E2EE 接入）。 */
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
  return {
    ok: false,
    error: error,
    pairCode: '',
    expiresAt: 0,
    gatewayName: '',
    gatewayId: '',
    candidates: [],
    relayNodeId: '',
    relayAgentPubKey: '',
    relayInviteToken: '',
    relayAuthMode: ''
  };
}

function decodeBase64Url(value: string): string | undefined {
  try {
    let normalized: string = value.replace(/-/g, '+').replace(/_/g, '/').trim();
    // Base64URL 常省略 '=' 填充；Base64Helper 需要合法长度，否则解出错误字节。
    while (normalized.length % 4 !== 0) {
      normalized += '=';
    }
    const helper = new util.Base64Helper();
    const bytes: Uint8Array = helper.decodeSync(normalized, util.Type.BASIC);
    return util.TextDecoder.create('utf-8').decodeToString(bytes);
  } catch (err) {
    return undefined;
  }
}

function normalizeEndpoint(raw: string): string {
  let value: string = raw.trim();
  if (value.length === 0) {
    return '';
  }
  if (value.startsWith('https://')) {
    value = 'wss://' + value.substring('https://'.length);
  } else if (value.startsWith('http://')) {
    value = 'ws://' + value.substring('http://'.length);
  } else if (!value.startsWith('ws://') && !value.startsWith('wss://')) {
    // 裸主机按局域网直连处理（原生应用不受元服务的 wss 域名白名单限制）。
    value = 'ws://' + value;
  }
  while (value.endsWith('/')) {
    value = value.substring(0, value.length - 1);
  }
  return value;
}

function pushUnique(list: string[], value: string): void {
  const normalized: string = normalizeEndpoint(value);
  if (normalized.length > 0 && list.indexOf(normalized) < 0) {
    list.push(normalized);
  }
}

function collectEndpoints(node: Object | undefined, list: string[]): void {
  const record = asRec(node);
  if (record === undefined) {
    return;
  }
  const single: string | undefined = str(record, 'url') ?? str(record, 'endpoint') ?? str(record, 'publicUrl');
  if (single !== undefined) {
    pushUnique(list, single);
  }
  const endpoints = record['endpoints'];
  if (Array.isArray(endpoints)) {
    for (const item of endpoints as Object[]) {
      if (typeof item === 'string') {
        pushUnique(list, item as string);
      } else {
        const inner: string | undefined = str(item, 'url') ?? str(item, 'endpoint');
        if (inner !== undefined) {
          pushUnique(list, inner);
        }
      }
    }
  }
  const routes = record['routes'];
  if (Array.isArray(routes)) {
    for (const item of routes as Object[]) {
      if (typeof item === 'string') {
        pushUnique(list, item as string);
      } else {
        const inner: string | undefined = str(item, 'url') ?? str(item, 'endpoint');
        if (inner !== undefined) {
          pushUnique(list, inner);
        }
      }
    }
  }
}

/** 解析扫码得到的配对文本（v2 直连 / v3 中继）。 */
export function parsePairingPayload(rawText: string, nowMs: number = Date.now()): PairingResult {
  const text: string = rawText.trim();
  if (text.length === 0) {
    return fail('配对内容为空');
  }
  let jsonText: string | undefined = undefined;
  if (text.startsWith('{')) {
    jsonText = text;
  } else {
    jsonText = decodeBase64Url(text);
  }
  if (jsonText === undefined) {
    return fail('配对内容不是有效的 Base64URL');
  }
  let payload: Object | undefined = undefined;
  try {
    payload = JSON.parse(jsonText) as Object;
  } catch (err) {
    return fail('配对 JSON 解析失败');
  }
  const record = asRec(payload);
  if (record === undefined) {
    return fail('配对内容不是对象');
  }
  const version: number = num(record, 'version') ?? 0;
  if (version !== 2 && version !== 3) {
    return fail('不支持的配对版本：' + version);
  }
  const pairCode: string = str(record, 'pairingCode') ?? '';
  const expiresAt: number = num(record, 'expiresAt') ?? 0;
  if (pairCode.length === 0) {
    return fail('二维码缺少 pairingCode');
  }
  if (expiresAt > 0 && expiresAt <= nowMs) {
    return fail('二维码已过期，请重新生成');
  }

  const result: PairingResult = {
    ok: true,
    error: '',
    pairCode: pairCode,
    expiresAt: expiresAt,
    gatewayName: str(record, 'gatewayName') ?? '',
    gatewayId: str(record, 'gatewayId') ?? '',
    candidates: [],
    relayNodeId: '',
    relayAgentPubKey: '',
    relayInviteToken: '',
    relayAuthMode: ''
  };

  collectEndpoints(record, result.candidates);
  const mini = asRec(record['miniProgramRoute']);
  if (mini !== undefined) {
    collectEndpoints(mini, result.candidates);
  }

  // 中继元信息（v3 顶层，或 miniProgramRoute.mode === 'relay'）。
  let relay: Record<string, Object> | undefined = undefined;
  if (version === 3) {
    relay = record;
  } else if (mini !== undefined && str(mini, 'mode') === 'relay') {
    relay = mini;
  }
  if (relay !== undefined) {
    result.relayNodeId = str(relay, 'nodeId') ?? str(relay, 'gatewayId') ?? '';
    result.relayAgentPubKey = str(relay, 'agentPubKey') ?? '';
    result.relayInviteToken = str(relay, 'inviteToken') ?? '';
    result.relayAuthMode = str(relay, 'authMode') ?? '';
    collectEndpoints(relay, result.candidates);
  }

  if (result.candidates.length === 0 && result.relayNodeId.length === 0) {
    return fail('二维码中没有可用地址（直连或中继）');
  }
  return result;
}