/**
 * WireGuard 隧道控制器：把 TUN 的 IP 包通过 UDP 加密隧道转发。
 *
 * 流程：
 * 1. 建 UDP socket 并 protect（避免隧道流量被自身路由回环）
 * 2. 发起 Noise IK 握手
 * 3. 收握手响应后派生传输密钥
 * 4. 双向转发：TUN -> AEAD -> UDP，UDP -> AEAD -> TUN
 */

import { socket } from '@kit.NetworkKit';
import { aeadOpen, blake2s, hmacBlake2s } from './WireGuardCrypto';
import {
  WG_HASH_LEN, WG_MSG_HANDSHAKE_INITIATION, WG_MSG_HANDSHAKE_RESPONSE,
  WG_MSG_COOKIE_REPLY, WG_MSG_TRANSPORT_DATA, WG_INITIATION_LEN, WG_RESPONSE_LEN,
  WG_TRANSPORT_HEADER_LEN, WireGuardHandshake, WireGuardInitiation, WireGuardTransport,
  kdf2, mixHash
} from './WireGuardProtocol';
import { scalarmult, scalarmultBase } from './Sodium';
import { Logger } from '../common/Logger';

export interface WireGuardPeerConfig {
  /** 本机私钥（32 字节） */
  privateKey: Uint8Array;
  /** 对端静态公钥（32 字节） */
  peerPublicKey: Uint8Array;
  /** 对端 UDP 地址 */
  endpointHost: string;
  endpointPort: number;
}

/** 传输密钥对 */
interface TransportKeys {
  sendKey: Uint8Array;
  recvKey: Uint8Array;
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out: Uint8Array = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

function asciiBytes(s: string): Uint8Array {
  const out: Uint8Array = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) {
    out[i] = s.charCodeAt(i) & 0xff;
  }
  return out;
}

/** TAI64N 时间戳（12 字节）：WireGuard 用于防重放 */
function tai64n(): Uint8Array {
  const out: Uint8Array = new Uint8Array(12);
  const nowMs: number = Date.now();
  const secs: number = Math.floor(nowMs / 1000) + 0x400000000000000a;
  const nanos: number = (nowMs % 1000) * 1000000;
  // 大端写入 8 字节秒
  out[0] = Math.floor(secs / 0x1000000000000) & 0xff;
  out[1] = Math.floor(secs / 0x10000000000) & 0xff;
  out[2] = Math.floor(secs / 0x100000000) & 0xff;
  out[3] = Math.floor(secs / 0x1000000) & 0xff;
  out[4] = Math.floor(secs / 0x10000) & 0xff;
  out[5] = Math.floor(secs / 0x100) & 0xff;
  out[6] = secs & 0xff;
  out[7] = Math.floor(secs / 0x10000000000) & 0xff;
  // 简化：低 4 字节纳秒
  out[8] = (nanos >>> 24) & 0xff;
  out[9] = (nanos >>> 16) & 0xff;
  out[10] = (nanos >>> 8) & 0xff;
  out[11] = nanos & 0xff;
  return out;
}

export class WireGuardTunnel {
  private config: WireGuardPeerConfig;
  private udp: socket.UDPSocket | undefined = undefined;
  private sendKey: Uint8Array | undefined = undefined;
  private recvKey: Uint8Array | undefined = undefined;
  private counter: number = 0;
  private localIndex: number = 0;
  private remoteIndex: number = 0;
  private handshake: WireGuardHandshake | undefined = undefined;
  private running: boolean = false;
  private onInbound: (packet: Uint8Array) => void;
  private protect: (fd: number) => Promise<void>;

  constructor(
    config: WireGuardPeerConfig,
    protect: (fd: number) => Promise<void>,
    onInbound: (packet: Uint8Array) => void
  ) {
    this.config = config;
    this.protect = protect;
    this.onInbound = onInbound;
  }

  isReady(): boolean {
    return this.sendKey !== undefined;
  }

  /** 建立 UDP 并发起握手 */
  async start(): Promise<void> {
    const udp: socket.UDPSocket = socket.constructUDPSocketInstance();
    await udp.bind({ address: '0.0.0.0', port: 0, family: 1 });
    const fd: number = await udp.getSocketFd();
    Logger.info('WG udp fd=' + fd);
    await this.protect(fd);
    Logger.info('WG udp protected');

    udp.on('message', (info: socket.SocketMessageInfo) => {
      const data: Uint8Array = new Uint8Array(info.message);
      this.handleIncoming(data);
    });
    this.udp = udp;
    this.running = true;

    this.localIndex = (Math.floor(Math.random() * 0xffffff) + 1) >>> 0;
    await this.sendHandshakeInitiation();
  }

  /** 构造并发送握手初始化 */
  private async sendHandshakeInitiation(): Promise<void> {
    const hs: WireGuardHandshake = new WireGuardHandshake();
    hs.init();
    hs.localStaticPrivate = this.config.privateKey.slice(0);
    hs.localStaticPublic = new Uint8Array(WG_HASH_LEN);
    scalarmultBase(hs.localStaticPublic, hs.localStaticPrivate);
    hs.remoteStaticPublic = this.config.peerPublicKey.slice(0);
    hs.generateEphemeral();

    this.handshake = hs;
    const msg: Uint8Array = WireGuardInitiation.build(hs, this.localIndex, tai64n());

    // mac1 = MAC(HASH(LABEL_MAC1 || responderPub), msg[0..116])
    const labelMac1: Uint8Array = asciiBytes('mac1----');
    const mac1Key: Uint8Array = blake2s(concat(labelMac1, this.config.peerPublicKey), WG_HASH_LEN);
    const mac1: Uint8Array = hmacBlake2s(mac1Key, msg.subarray(0, 116), 16);
    msg.set(mac1, 116);
    // mac2 留零（未收到 cookie）

    await this.sendUdp(msg);
    Logger.info('WG handshake initiation sent');
  }

  private async sendUdp(payload: Uint8Array): Promise<void> {
    const udp: socket.UDPSocket | undefined = this.udp;
    if (udp === undefined) {
      return;
    }
    const buf: ArrayBuffer = payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength);
    try {
      await udp.send({
        data: buf,
        address: {
          address: this.config.endpointHost,
          port: this.config.endpointPort,
          family: 1
        }
      });
    } catch (err) {
      Logger.warn('WG send failed: ' + String(err));
    }
  }

  /** 处理收到的 UDP 报文 */
  private handleIncoming(packet: Uint8Array): void {
    if (packet.length === 0) {
      return;
    }
    const type: number = packet[0];
    if (type === WG_MSG_HANDSHAKE_RESPONSE) {
      this.handleHandshakeResponse(packet).catch((e: Error) => {
        Logger.error('WG handshake response handling failed: ' + e.message);
      });
      return;
    }
    if (type === WG_MSG_TRANSPORT_DATA) {
      this.handleTransportData(packet);
      return;
    }
    if (type === WG_MSG_COOKIE_REPLY) {
      Logger.info('WG received cookie reply');
      return;
    }
  }

  /** 处理握手响应，派生传输密钥 */
  private async handleHandshakeResponse(packet: Uint8Array): Promise<void> {
    if (packet.length < WG_RESPONSE_LEN) {
      Logger.warn('WG response too short');
      return;
    }
    // 复算握手状态需要保留 initiation 时的状态；
    // 这里用最小实现：解析 receiver index 与 ephemeral，派生密钥。
    const hs: WireGuardHandshake | undefined = this.handshake;
    if (hs === undefined) {
      Logger.warn('WG response without handshake state');
      return;
    }
    const senderIndex: number = packet[4] | (packet[5] << 8) | (packet[6] << 16) | (packet[7] << 24);
    const receiverIndex: number = packet[8] | (packet[9] << 8) | (packet[10] << 16) | (packet[11] << 24);
    Logger.info('WG response sender=' + senderIndex + ' receiver=' + receiverIndex);
    this.remoteIndex = senderIndex;

    // e (responder ephemeral)
    const remoteEphemeral: Uint8Array = packet.subarray(12, 44);
    hs.remoteEphemeralPublic = remoteEphemeral.slice(0);
    hs.mixKey(remoteEphemeral);
    hs.mixHashPublic(remoteEphemeral);

    // ee = DH(localEphemeral, remoteEphemeral)
    const ee: Uint8Array = hs.dh(hs.localEphemeralPrivate, remoteEphemeral);
    const keyEe: Uint8Array = hs.mixKey(ee);
    hs.hash = mixHash(hs.hash, ee);

    // 解密空的加密载荷，验证对端持有正确密钥
    const encryptedEmpty: Uint8Array = packet.subarray(44, 60);
    const empty: Uint8Array | undefined = aeadOpen(keyEe, new Uint8Array(12), encryptedEmpty, hs.hash);
    if (empty === undefined) {
      Logger.error('WG response decrypt failed');
      return;
    }
    hs.hash = mixHash(hs.hash, encryptedEmpty);

    // psk：未配置预共享密钥时使用全零
    const psk: Uint8Array = new Uint8Array(32);
    const pskRes = kdf2(hs.chainKey, psk);
    hs.chainKey = pskRes.first;
    hs.hash = mixHash(hs.hash, psk);

    // 派生传输密钥（Initiator: send=first, recv=second）
    const transport = kdf2(hs.chainKey, new Uint8Array(0));
    this.sendKey = transport.first;
    this.recvKey = transport.second;
    Logger.info('WG transport keys ready');
  }

  /** 处理传输数据包 */
  private handleTransportData(packet: Uint8Array): void {
    const key: Uint8Array | undefined = this.recvKey;
    if (key === undefined) {
      return;
    }
    const plain: Uint8Array | undefined = WireGuardTransport.open(key, packet);
    if (plain === undefined) {
      Logger.warn('WG decrypt failed');
      return;
    }
    this.onInbound(plain);
  }

  /** 发送一个来自 TUN 的 IP 包 */
  async sendPacket(ipPacket: Uint8Array): Promise<void> {
    const key: Uint8Array | undefined = this.sendKey;
    if (key === undefined) {
      return;
    }
    if (this.counter >= Number.MAX_SAFE_INTEGER) {
      this.counter = 0;
    }
    const counter: number = this.counter;
    this.counter += 1;
    const sealed: Uint8Array = WireGuardTransport.seal(this.remoteIndex, counter, key, ipPacket);
    await this.sendUdp(sealed);
  }

  async stop(): Promise<void> {
    this.running = false;
    const udp: socket.UDPSocket | undefined = this.udp;
    this.udp = undefined;
    if (udp !== undefined) {
      try {
        await udp.close();
      } catch (err) {
        Logger.warn('WG udp close failed: ' + String(err));
      }
    }
  }
}
