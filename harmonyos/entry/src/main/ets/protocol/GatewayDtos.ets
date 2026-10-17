/**
 * Gateway 协议 DTO —— ArkTS 版
 * 1:1 对照 shared/src/commonMain/kotlin/com/clarklevis/dsh/shared/protocol/GatewayDtos.kt
 *
 * Kotlin 的 data class + kotlinx Serialization（全部字段可选、宽松解码）在 ArkTS 中
 * 用「可选字段 interface + JSON.parse 断言」表达；strictMode 校验（kind 必须为 string 等）
 * 集中在 GatewayFrameCodec.ets 的 decodeFrame / normalizeFrame 中，保持 fail-closed 语义。
 *
 * JsonValue 在 ArkTS 侧用 Object 表示（运行时为 JSON.parse 的原生值），
 * 需要动态访问时经 GatewayFrameCodec 的 json/str/num/bool/arr 辅助函数取值。
 */

/** WebUI 的 todo_write 投影；移动端仅展示，不直接修改。 */
export interface GatewayTask {
  content: string;
  status: string;
}

/** Goal 写入的 compare-and-set 引用，防止多端以旧版本覆盖新修改。 */
export interface GatewayGoalRef {
  id: string;
  revision: number;
}

export interface GatewayGoalDefinition {
  id: string;
  revision: number;
  objective: string;
  phase: string;
  maxGoalRounds?: number;
}

export interface GatewayGoalSnapshot {
  goal: GatewayGoalDefinition;
  roundsStarted: number;
  createdAt?: number;
  updatedAt?: number;
}

export interface GatewaySlashCommandInput {
  hint?: string;
  images?: boolean;
}

export interface GatewaySlashCommandUi {
  kind: string;
  insertText?: string;
  hint?: string;
  displayHint?: string;
  images?: boolean;
  submitRequest?: string;
  submitText?: string;
  optionsRequest?: string;
  selectionRequest?: string;
}

export interface GatewaySlashCommand {
  id: string;
  name: string;
  description: string;
  source?: string;
  action?: string;
  modelInvocable?: boolean;
  whenToUse?: string;
  input?: GatewaySlashCommandInput;
  ui: GatewaySlashCommandUi;
}

/** GatewaySlashCommand.stableId：id 为空时回退 `${source ?? 'item'}:${name}` */
export function slashCommandStableId(c: GatewaySlashCommand): string {
  if (c.id.length > 0) {
    return c.id;
  }
  return `${c.source ?? 'item'}:${c.name}`;
}

export interface GatewaySlashCommandGroup {
  id: string;
  title: string;
  items: GatewaySlashCommand[];
}

export interface GatewayCommandOption {
  id: string;
  label: string;
  detail?: string;
  description?: string;
  selected?: boolean;
}

export interface GatewayDevice {
  id: string;
  name?: string;
  createdAt?: number;
}

export interface GatewayPairingPayload {
  version: number;
  publicUrl: string;
  pairingCode: string;
  expiresAt: number;
  gatewayId?: string;
  gatewayName?: string;
  endpoints?: string[];
}

export interface GatewayImageAttachment {
  attachmentId: string;
  mediaType: string;
  bytes: number;
  width: number;
  height: number;
  name?: string;
}

export interface GatewayQuestionOption {
  label: string;
  description?: string;
}

export interface GatewayQuestionIntent {
  kind: string;
  approve?: string;
}

export interface GatewayQuestion {
  id: string;
  header?: string;
  question: string;
  detail?: string;
  options?: GatewayQuestionOption[];
  multiSelect?: boolean;
  intent?: GatewayQuestionIntent;
}

export function questionAllowsMultipleSelections(q: GatewayQuestion): boolean {
  return q.multiSelect === true;
}

export interface GatewayPendingQuestionRequest {
  rpcId: string;
  sessionId: string;
  questions: GatewayQuestion[];
  replay: boolean;
}

export interface GatewayQuestionAnswer {
  id: string;
  selected: string[];
  custom?: string;
}

/** GatewayQuestionAnswer.normalizedCustom */
export function questionAnswerNormalizedCustom(a: GatewayQuestionAnswer): string | undefined {
  const t = a.custom?.trim();
  return t !== undefined && t.length > 0 ? t : undefined;
}

/** GatewayQuestionAction 枚举（wire: "answer" / "cancel"） */
export enum GatewayQuestionAction {
  ANSWER = 'answer',
  CANCEL = 'cancel'
}

export interface GatewayWorkspace {
  workspaceId: string;
  path: string;
  title: string;
  sessionIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface GatewayPendingApprovalRequest {
  rpcId: string;
  sessionId: string;
  approvalId: string;
  toolName: string;
  callId?: string;
  reason?: string;
  replay: boolean;
}

/** GatewayApprovalOutcome 枚举（wire: "allowed-once" / "rejected"） */
export enum GatewayApprovalOutcome {
  ALLOWED_ONCE = 'allowed-once',
  REJECTED = 'rejected'
}

export interface GatewaySessionSummary {
  sessionId: string;
  updatedAt: number;
  running: boolean;
  blank: boolean;
  parentSessionId?: string;
  origin?: string;
  cwd?: string;
  agentPreset?: string;
  projections?: Object;
}

export interface GatewaySearchItem {
  sessionId: string;
  snippet: string;
}

export interface GatewayDirectoryItem {
  name: string;
  path: string;
  hidden: boolean;
  kind?: string;
  bytes?: number;
  modifiedAt?: number;
  mediaType?: string;
}

export interface GatewayHostSnapshot {
  version?: string;
  cwd?: string;
  provider?: string;
  model?: string;
  attachedSessions?: number;
  canOpenPath?: boolean;
}

export interface GatewayModelSelection {
  provider: string;
  model: string;
  reasoningEffort?: string;
}

export interface GatewayReasoningEffort {
  id: string;
  name: string;
}

export interface GatewayModelReasoning {
  efforts: GatewayReasoningEffort[];
  defaultEffort?: string;
}

export interface GatewayModelItem {
  id: string;
  name: string;
  reasoning?: GatewayModelReasoning;
}

export interface GatewayModelGroup {
  id: string;
  name: string;
  models: GatewayModelItem[];
}

export interface GatewayModelCatalog {
  current?: GatewayModelSelection;
  routable: boolean;
  groups: GatewayModelGroup[];
}

export interface GatewayPermissionOption {
  value: string;
  name: string;
}

export interface GatewayAgentPreset {
  id: string;
  trust?: Object;
  isDefault: boolean;
  name?: string;
  description?: string;
  broken?: boolean;
  brokenReason?: string;
}

export interface GatewaySessionPermissions {
  options?: GatewayPermissionOption[];
  currentValue?: string;
  preset?: string;
  sandbox?: string;
  approval?: string;
}

export interface GatewaySessionTokenUsageTotals {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
}

export interface GatewayTokenUsage {
  uncachedInputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  totals?: GatewaySessionTokenUsageTotals;
}

export interface GatewayContextPressure {
  pressureTokens?: number;
  projectedTokens?: number;
  contextWindow?: number;
}

export interface GatewayContextBreakdown {
  systemTokens?: number;
  toolsTokens?: number;
  messageTokens?: number;
}

export interface GatewayContextSnapshot {
  asOfSeq?: number;
  tokenUsage?: GatewayTokenUsage;
  pressure?: GatewayContextPressure;
  breakdown?: GatewayContextBreakdown;
}

export interface GatewaySessionStats {
  turns?: number;
  steps?: number;
  llmMs?: number;
  toolMs?: number;
  ttftMs?: number;
  ttftSteps?: number;
  decodeMs?: number;
  decodeTokens?: number;
  lastTurn?: number;
  openStep?: number;
  pendingCalls?: Object;
}

export interface GatewaySessionTokenUsage {
  totals?: GatewaySessionTokenUsageTotals;
}

export interface GatewaySessionStatsSnapshot {
  asOfSeq?: number;
  stats?: GatewaySessionStats;
  tokenUsage?: GatewaySessionTokenUsage;
  contextPressure?: GatewayContextPressure;
}

export interface ToolDelta {
  id?: string;
  name?: string;
  argumentsDelta?: string;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments?: Object;
}

export interface FinishInfo {
  kind?: string;
}

export interface GatewayEvent {
  type: string;
  turn?: number;
  step?: number;
  text?: string;
  /** 归一化后的事件来源；兼容 WebUI 字符串与 Host `{ kind: ... }` 对象两种形态。 */
  source?: string;
  chunkType?: string;
  tool?: ToolDelta;
  usage?: Object;
  finish?: FinishInfo;
  reasoning?: string;
  toolCalls?: ToolCall[];
  images?: GatewayImageAttachment[];
  callId?: string;
  name?: string;
  arguments?: Object;
  isError?: boolean;
  preview?: string;
  reason?: string;
  rootCallId?: string;
  parentCallId?: string;
  subCallId?: string;
  commandId?: string;
  args?: string;
  outcome?: string;
  sourceEventSeq?: number;
  compactionId?: string;
  sourceCommandId?: string;
  shadowedItemCount?: number;
  shadowedTokenCount?: number;
  error?: string;
  raw?: Object;
  interrupted?: boolean;
  stream?: Object;
}

export interface SessionEvent {
  sessionId: string;
  seq: number;
  time: number;
  event: GatewayEvent;
  surfaceOp?: Object;
  sourceEventSeqs?: number[];
}

export interface RawSessionEvent {
  type: string;
  seq: number;
  time: number;
  data: Object;
}

/**
 * Gateway 帧的宽松结构。
 * Kotlin 端所有字段均为可空可选；此处全部可选，strictMode 语义校验由 codec 执行。
 */
export interface GatewayFrame {
  kind: string;
  gatewayId?: string;
  gatewayName?: string;
  protocol?: number;
  capabilities?: string[];
  dshVersion?: string;
  historyFormatVersion?: number;
  subscriptionId?: string;
  streamId?: string;
  cursor?: number;
  replace?: boolean;
  assistantStream?: Object;
  frame?: Object;
  retrying?: boolean;
  resetRequired?: boolean;
  surfaceOp?: Object;
  sourceEventSeqs?: number[];
  authenticated?: boolean;
  token?: string;
  device?: GatewayDevice;
  port?: number;
  clients?: number;
  at?: number;
  sessionId?: string;
  title?: string;
  seq?: number;
  time?: number;
  event?: GatewayEvent;
  code?: string;
  message?: string;
  mode?: string;
  command?: Object;
  line?: string;
  commandId?: string;
  result?: Object;
  commands?: GatewaySlashCommand[];
  skills?: GatewaySlashCommand[];
  options?: GatewayCommandOption[];
  requestType?: string;
  items?: Object[];
  events?: RawSessionEvent[];
  hasMore?: boolean;
  nextBeforeSeq?: number;
  bytes?: number;
  view?: string;
  query?: string;
  archivedSessionIds?: string[];
  workspace?: GatewayWorkspace;
  created?: boolean;
  version?: string;
  cwd?: string;
  provider?: string;
  model?: string;
  attachedSessions?: number;
  canOpenPath?: boolean;
  path?: string;
  requestId?: string;
  transferId?: string;
  name?: string;
  mediaType?: string;
  size?: number;
  chunkBytes?: number;
  offset?: number;
  eof?: boolean;
  sha256?: string;
  home?: string;
  crumbs?: GatewayDirectoryItem[];
  entries?: GatewayDirectoryItem[];
  truncated?: boolean;
  current?: GatewayModelSelection;
  routable?: boolean;
  /** 多态字段：模型目录为 GatewayModelGroup，斜杠目录为 GatewaySlashCommandGroup，按 kind 惰性解码。 */
  groups?: Object[];
  failures?: Object[];
  selected?: Object;
  selection?: GatewayModelSelection;
  saved?: GatewayModelSelection;
  namespace?: Object;
  sessionPermissions?: GatewaySessionPermissions;
  set?: string;
  asOfSeq?: number;
  todos?: GatewayTask[];
  goal?: GatewayGoalSnapshot;
  ref?: GatewayGoalRef;
  cleared?: boolean;
  sessionStats?: GatewaySessionStats;
  tokenUsage?: GatewayTokenUsage;
  contextPressure?: GatewayContextPressure;
  projections?: Object;
  presets?: GatewayAgentPreset[];
  agentPreset?: string;
  locked?: boolean;
  modeSelectionEnabled?: boolean;
  authorable?: boolean;
  hasDocument?: boolean;
  agentPresetDefault?: string;
  permissionDefault?: string;
  target?: string;
  value?: Object;
  applied?: boolean;
  rpcId?: string;
  questions?: GatewayQuestion[];
  replay?: boolean;
  /** wire 为 Map<String, List<JsonValue>>；ArkTS 侧保持 Object，取值时经辅助函数。 */
  queues?: Object;
  itemId?: string;
  action?: string;
  accepted?: boolean;
  reason?: string;
  outcome?: string;
  approvalId?: string;
  toolName?: string;
  callId?: string;
  attachment?: GatewayImageAttachment;
  data?: string;
}
