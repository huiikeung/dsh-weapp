export { Logger } from './src/main/ets/common/Logger';
export { PreferencesStore } from './src/main/ets/common/PreferencesStore';
export { StatusAppearance } from './src/main/ets/common/StatusAppearance';
export type { StatusAppearanceOption } from './src/main/ets/common/StatusAppearance';
export { NotificationService } from './src/main/ets/common/NotificationService';
export { pickDocuments } from './src/main/ets/common/AttachmentPicker';
export type { PickedAttachment } from './src/main/ets/common/AttachmentPicker';
export { uploadAttachment, downloadAttachment } from './src/main/ets/common/AttachmentTransfer';
export type { UploadResult, DownloadResult } from './src/main/ets/common/AttachmentTransfer';
export { AttachmentCache } from './src/main/ets/common/AttachmentCache';
export { VoiceDictation } from './src/main/ets/common/VoiceDictation';
export type { AttachmentCacheEntry } from './src/main/ets/common/AttachmentCache';
export { ThemeManager } from './src/main/ets/common/ThemeManager';
export type { ThemeMode } from './src/main/ets/common/ThemeManager';
export { AppState, KEY_CONNECTION, KEY_WORKSPACE } from './src/main/ets/common/AppState';
export { GatewayClient, ConnectionState } from './src/main/ets/network/GatewayClient';
export type { GatewayProfile } from './src/main/ets/network/GatewayClient';
export { SessionStore } from './src/main/ets/state/SessionStore';
export type { GatewayFrame } from './src/main/ets/protocol/GatewayDtos';
export {
  PI_NS, buildProviderRows, protocolLabel, formatTokenCount, modelMeta,
  parseNamespace, appendModelsMutation, removeModelMutation, editModelMutation,
  providerCreateMutation, providerRemoveMutation, parseDiscoveredModels, discoveredModelPayload
} from './src/main/ets/state/ModelSettingsStore';
export type { ProviderRow, ModelRow, ReasoningLevel, PluginNamespace, DiscoveredModel } from './src/main/ets/state/ModelSettingsStore';
export type { PresetOption, ModelOption, PermissionOption, DiagnosticRow } from './src/main/ets/state/SessionStore';
export { OceanBackground } from './src/main/ets/components/OceanBackground.ets';
export { ParticleBackground } from './src/main/ets/components/ParticleBackground.ets';
export { GlassCard } from './src/main/ets/components/GlassCard.ets';
export { ScheduleStore } from './src/main/ets/state/ScheduleStore';
export type { ScheduleTask } from './src/main/ets/state/ScheduleStore';
export { PluginStore } from './src/main/ets/state/PluginStore';
export type { PluginItem, OfficialPluginItem } from './src/main/ets/state/PluginStore';
export { EventProjector } from './src/main/ets/state/EventProjector';
export type { ProjTurn, ProjStep, ProjTool } from './src/main/ets/state/EventProjector';
export { CredentialStore } from './src/main/ets/state/CredentialStore';
export type { SavedGateway } from './src/main/ets/state/CredentialStore';
export type { DirEntry, DirCrumb, SessionRow, SessionSummary, QueueItem, WorkspaceRow } from './src/main/ets/state/SessionStore';
export { GatewayRequests } from './src/main/ets/protocol/GatewayRequests';
export { GatewayRequestFactory, GatewayRequestLanePolicy } from './src/main/ets/protocol/GatewayRequest';
export type { GatewayRequest } from './src/main/ets/protocol/GatewayRequest';
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
export * from './src/main/ets/domain/ApprovalReducer';
export * from './src/main/ets/domain/QuestionReducer';
export * from './src/main/ets/domain/SessionListReducer';
export * from './src/main/ets/domain/SessionControlReducer';
export { SharedMviSubscription, SharedMviEventEmitter, SharedMviEventValidator, SharedMviEventConsumer } from './src/main/ets/facade/SharedMviEvents';
export type { SharedMviEvent, SharedMviDispatchResult } from './src/main/ets/facade/SharedMviEvents';
export * from './src/main/ets/sync/HistoryReducer';
export * from './src/main/ets/sync/HistorySyncEngine';
export * from './src/main/ets/sync/AssistantStreamState';
export * from './src/main/ets/projection/ConversationProjection';
export * from './src/main/ets/projection/TrajectoryProjection';
export * from './src/main/ets/projection/ToolActivitySummary';
export * from './src/main/ets/projection/ConversationFeed';
export { WorkStepPresentation } from './src/main/ets/projection/WorkStepPresentation';
export type { WorkStepOption, WorkStepPolicy } from './src/main/ets/projection/WorkStepPresentation';
export type { ToolFace } from './src/main/ets/projection/ConversationFeed';
export { ConversationFeedEntryModel } from './src/main/ets/components/ConversationFeedModel';
export type { ModelMenuItem } from './src/main/ets/components/ConversationFeedModel';
export { MarkdownLite } from './src/main/ets/components/MarkdownLite';
export type { MarkdownBlock, InlineSpan } from './src/main/ets/components/MarkdownLite';
export * from './src/main/ets/stores/SharedStoreKernel';
export * from './src/main/ets/stores/SharedConversationStore';
export * from './src/main/ets/stores/SharedHistoryStore';
export * from './src/main/ets/stores/SharedQuestionStore';
export * from './src/main/ets/stores/SharedApprovalStore';
export * from './src/main/ets/stores/SharedQueueStore';
export * from './src/main/ets/stores/SharedSessionListStore';
export * from './src/main/ets/stores/SharedTrajectoryStore';
export * from './src/main/ets/stores/SharedSessionControlStore';
export * from './src/main/ets/stores/SharedTurnTimingStore';
export * from './src/main/ets/stores/SharedVoiceInputStore';
export * from './src/main/ets/stores/SharedSlashCommandStore';
export * from './src/main/ets/stores/SharedTeamStore';
export * from './src/main/ets/stores/SharedFileUploadStore';
export * from './src/main/ets/stores/SharedWorkspaceFileStore';
export * from './src/main/ets/stores/SharedSessionAgentPresetStore';
export * from './src/main/ets/stores/SharedMobileStore';
export * from './src/main/ets/cache/ChatCacheWindowPolicy';
export * from './src/main/ets/cache/ChatMemoryCache';
export * from './src/main/ets/cache/ChatCacheDiagnostics';
export * from './src/main/ets/cache/ChatPrefetchPolicy';
export * from './src/main/ets/cache/SharedChatHistoryCache';
export * from './src/main/ets/transport/GatewayTransportPolicy';
export * from './src/main/ets/transport/MgwCodec';
export * from './src/main/ets/transport/RtcUpgradeMachine';
export * from './src/main/ets/transport/RtcDiagnostics';
export * from './src/main/ets/transport/RtcSelectedPath';
export * from './src/main/ets/tailscale/TailscalePlatformStatus';
export * from './src/main/ets/diagnostics/NetworkDiagnosticsStore';
export { aeadSeal, aeadOpen, blake2s, hmacBlake2s, chacha20Xor, wireGuardSelfTest } from './src/main/ets/crypto/WireGuardCrypto';
export { WireGuardTunnel } from './src/main/ets/crypto/WireGuardTunnel';
export type { WireGuardPeerConfig } from './src/main/ets/crypto/WireGuardTunnel';
