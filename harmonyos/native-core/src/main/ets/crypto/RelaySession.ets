import { boxBeforenm, BoxKeyPair, randomBytes, scalarmultBase, secretbox, secretboxOpen } from './Sodium';
import { concatBytes, sha512, utf8Decode, utf8Encode, verifyEd25519 } from './DshCrypto';

/**
 * 中继 E2EE v1 客户端会话（与元服务 relay-e2ee.js / agent-connector 镜像）。
 *
 *   ClientHello [0x01][临时公钥32][随机16]
 *   AgentHello  [0x02][临时公钥32][Ed25519 签名64]
 *   数据包      [0x03][counter u64 BE][secretbox(0x03 || utf8 帧)]
 */
const PROTOCOL: string = 'dsh-weapp-e2ee-v1';
const PACKET_CLIENT_HELLO: number = 1;
const PACKET_AGENT_HELLO: number = 2;
const PACKET_SEALED: number = 3;
const CLEAR_DATA: number = 3;

function counterBytes(value: number): Uint8Array {
  const out: Uint8Array = new Uint8Array(8);
  let v: number = value;
  for (let i = 7; i >= 0; i--) {
    out[i] = v & 255;
    v = Math.floor(v / 256);
  }
  return out;
}

function readCounter(bytes: Uint8Array, offset: number): number {
  let value: number = 0;
  for (let i = 0; i < 8; i++) {
    value = value * 256 + bytes[offset + i];
  }
  return value;
}

export class RelaySession {
  readonly hello: Uint8Array;
  private nodeId: string;
  private agentIdentityPub: Uint8Array;
  private ephemeral: BoxKeyPair;
  private txCounter: number = 0;
  private rxCounter: number = 0;
  private ready: boolean = false;
  private key: Uint8Array = new Uint8Array(32);
  private txPrefix: Uint8Array = new Uint8Array(16);
  private rxPrefix: Uint8Array = new Uint8Array(16);

  constructor(nodeId: string, agentPubKeyRaw: Uint8Array) {
    this.nodeId = nodeId;
    this.agentIdentityPub = agentPubKeyRaw;
    const secretKey: Uint8Array = randomBytes(32);
    const publicKey: Uint8Array = new Uint8Array(32);
    scalarmultBase(publicKey, secretKey);
    this.ephemeral = { publicKey: publicKey, secretKey: secretKey };
    const nonceTail: Uint8Array = randomBytes(16);
    this.hello = concatBytes([
      new Uint8Array([PACKET_CLIENT_HELLO]), this.ephemeral.publicKey, nonceTail
    ]);
  }

  isReady(): boolean {
    return this.ready;
  }

  /** 处理 AgentHello：验签 + 派生密钥，成功返回 true。 */
  acceptAgentHello(packet: Uint8Array): boolean {
    if (packet.length !== 1 + 32 + 64 || packet[0] !== PACKET_AGENT_HELLO) {
      return false;
    }
    const agentEphPub: Uint8Array = packet.subarray(1, 33);
    const signature: Uint8Array = packet.subarray(33, 97);
    const transcript: Uint8Array = sha512(concatBytes([
      utf8Encode(PROTOCOL + '\0'),
      utf8Encode(this.nodeId),
      this.hello,
      agentEphPub
    ]));
    if (!verifyEd25519(this.agentIdentityPub, transcript, signature)) {
      return false;
    }
    const shared: Uint8Array = boxBeforenm(agentEphPub, this.ephemeral.secretKey);
    const kdfDigest: Uint8Array = sha512(concatBytes([
      utf8Encode(PROTOCOL + '-KDF\0'), shared, transcript
    ]));
    const key: Uint8Array = kdfDigest.subarray(0, 32);
    const material: Uint8Array = sha512(concatBytes([key, utf8Encode('nonce-prefix')]));
    this.txPrefix = material.subarray(0, 16);
    this.rxPrefix = material.subarray(16, 32);
    this.key = key;
    this.ready = true;
    return true;
  }

  /** 明文帧 → 密文包（NaCl secretbox：明文前补 32 字节零，输出跳过 16 字节）。 */
  seal(text: string): Uint8Array {
    const counter: number = this.txCounter;
    this.txCounter += 1;
    const clear: Uint8Array = concatBytes([new Uint8Array([CLEAR_DATA]), utf8Encode(text)]);
    const padded: Uint8Array = new Uint8Array(clear.length + 32);
    padded.set(clear, 32);
    const sealed: Uint8Array = new Uint8Array(padded.length);
    const nonce: Uint8Array = concatBytes([this.txPrefix, counterBytes(counter)]);
    secretbox(sealed, padded, padded.length, nonce, this.key);
    return concatBytes([new Uint8Array([PACKET_SEALED]), counterBytes(counter), sealed.subarray(16)]);
  }

  /** 密文包 → 明文帧；失败返回空字符串。 */
  open(packet: Uint8Array): string {
    if (!this.ready || packet.length < 1 + 8 + 17 || packet[0] !== PACKET_SEALED) {
      return '';
    }
    const counter: number = readCounter(packet, 1);
    if (counter < this.rxCounter) {
      return '';
    }
    const body: Uint8Array = packet.subarray(9);
    const padded: Uint8Array = new Uint8Array(body.length + 16);
    padded.set(body, 16);
    const plain: Uint8Array = new Uint8Array(padded.length);
    const nonce: Uint8Array = concatBytes([this.rxPrefix, counterBytes(counter)]);
    if (secretboxOpen(plain, padded, padded.length, nonce, this.key) !== 0) {
      return '';
    }
    const clear: Uint8Array = plain.subarray(32);
    if (clear.length < 1 || clear[0] !== CLEAR_DATA) {
      return '';
    }
    this.rxCounter = counter + 1;
    return utf8Decode(clear.subarray(1));
  }
}
