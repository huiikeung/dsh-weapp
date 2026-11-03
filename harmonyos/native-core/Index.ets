export { Logger } from './src/main/ets/common/Logger';
export { PreferencesStore } from './src/main/ets/common/PreferencesStore';
export { ThemeManager } from './src/main/ets/common/ThemeManager';
export type { ThemeMode } from './src/main/ets/common/ThemeManager';
export { AppState, KEY_CONNECTION, KEY_WORKSPACE } from './src/main/ets/common/AppState';
export { GatewayClient, ConnectionState } from './src/main/ets/network/GatewayClient';
export type { GatewayProfile } from './src/main/ets/network/GatewayClient';
export { SessionStore } from './src/main/ets/state/SessionStore';
export { OceanBackground } from './src/main/ets/components/OceanBackground.ets';
export { ScheduleStore } from './src/main/ets/state/ScheduleStore';
export type { ScheduleTask } from './src/main/ets/state/ScheduleStore';
export { PluginStore } from './src/main/ets/state/PluginStore';
export type { PluginItem } from './src/main/ets/state/PluginStore';
export { EventProjector } from './src/main/ets/state/EventProjector';
export type { ProjTurn, ProjStep, ProjTool } from './src/main/ets/state/EventProjector';
export { CredentialStore } from './src/main/ets/state/CredentialStore';
export type { SavedGateway } from './src/main/ets/state/CredentialStore';
export type { DirEntry, SessionRow, SessionSummary, QueueItem, WorkspaceRow } from './src/main/ets/state/SessionStore';
export { GatewayRequests } from './src/main/ets/protocol/GatewayRequests';
export {
  box as naclBox, boxOpen as naclBoxOpen, boxKeyPair, boxBeforenm, randomBytes as naclRandomBytes,
  selfTest as sodiumSelfTest
} from './src/main/ets/crypto/Sodium';
export type { BoxKeyPair } from './src/main/ets/crypto/Sodium';
export { RelaySession } from './src/main/ets/crypto/RelaySession';
export { sha512, verifyEd25519, utf8Encode, utf8Decode, base64Decode, concatBytes } from './src/main/ets/crypto/DshCrypto';
export { parsePairingPayload } from './src/main/ets/protocol/PairingPayload';
export type { PairingResult } from './src/main/ets/protocol/PairingPayload';

// 协议层（自旧原生工程迁入）：DTO 与 fail-closed 帧解码
export * from './src/main/ets/protocol/GatewayDtos';
export {
  GatewayFrameError, isObj, asRec, str, num, bool, arr, field, isNullValue,
  decodeFrame, normalizeEventSource, normalizeRawSessionEvent
} from './src/main/ets/protocol/GatewayFrameCodec';