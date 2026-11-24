/**
 * DS-Bot 移动端数据模型（对齐 dsh-mobile shared/facade/SharedBotStore.kt）。
 *
 * 与普通会话完全独立：Bot 团队、私聊/群聊、定时任务、记忆、创建流程都由
 * /api/bot 桥（bot-call / bot-subscribe）驱动，不进入 SessionStore 的会话投影。
 */

/** 每个 Bot 的角色资料（只读快照字段 + 已应用的模型/档位）。 */
export interface BotRoleProfile {
  instructions: string;
  model?: string;
  effort?: string;
  workDir?: string;
  permission?: string;
  privateRole: boolean;
  appliedModel?: string;
  appliedEffort?: string;
}

/** 下拉选项：模型、权限、推理档位共用。 */
export interface BotRoleOption {
  id: string;
  title: string;
}

/** 一条 Bot 记忆。 */
export interface BotMemory {
  id: string;
  scope: string;
  topic?: string;
  text: string;
}

/** 角色面板详情（记忆 + 月度用量）。 */
export interface BotRoleDetails {
  botId: string;
  memories: BotMemory[];
  inputTokens?: number;
  outputTokens?: number;
}

/** 聊天里的图片引用（字节经 image 端点分块拉取）。 */
export interface BotChatImage {
  attachmentId: string;
  sessionId: string;
  mediaType: string;
  name: string;
  width: number;
  height: number;
}

/** 回答卡片里的一条选择题答案。 */
export interface BotAnswerChoice {
  label: string;
  letter?: string;
}

/** 已回答的问题（历史里的 answer 行）。 */
export interface BotQuestionAnswer {
  question: string;
  choices: BotAnswerChoice[];
}

/** 聊天历史里的一行。kind: user | bot | post | event | answer | view | closed | file */
export interface BotChatMessage {
  id: string;
  kind: string;
  text: string;
  name: string;
  botId?: string;
  streaming: boolean;
  delivery?: string;
  sessionId: string;
  images: BotChatImage[];
  timeMs?: number;
  activity?: string;
  questionAnswers: BotQuestionAnswer[];
  files: BotPresentedFile[];
  turn?: number;
}

/** 交付文件（与普通会话的 PresentedFile 同构，避免跨模块依赖）。 */
export interface BotPresentedFile {
  name: string;
  path: string;
  added?: number;
  deleted?: number;
  status?: string;
  description?: string;
}

/** 团队里的一台 Bot / 一个群聊。 */
export interface BotChat {
  id: string;
  name: string;
  room: boolean;
  role: string;
  preview: string;
  image?: string;
  imageRef?: string;
  lastAt: number;
  running: boolean;
  part: number;
  memberIds: string[];
  sessionId?: string;
  profile?: BotRoleProfile;
  hidden: boolean;
}

/** 列表行右侧的「运行中 / 未读」标记。 */
export interface BotChatIndicator {
  running: boolean;
  unreadCount: number;
  unreadText: string;
}

/** 定时任务（只读）。 */
export interface BotSchedule {
  id: string;
  title: string;
  status: string;
  next: string;
  botId?: string;
  sessionId?: string;
}

/** 最近活动（done / question / approval / group / message）。 */
export interface BotActivity {
  id: string;
  text: string;
  chatId?: string;
  kind: string;
  name: string;
}

/** 待处理交互：提问或审批。 */
export interface BotInteraction {
  id: string;
  kind: string;
  chatId: string;
  sessionId: string;
  title: string;
  detail: string;
  options: string[];
  multiSelect: boolean;
}

/** 运行中的实时状态（用于「正在进行」区与行内活动文案）。 */
export interface BotLiveWork {
  kind: string;
  botId?: string;
  startedAtMs?: number;
}

/** 新建 Bot 的外形/配色目录。 */
export interface BotCreationColor {
  id: string;
  stops: string[];
}

export interface BotCreationShape {
  id: string;
  images: Record<string, string>;
}

export interface BotCreationLook {
  shape: string;
  color: string;
}

export interface BotCreationAgent {
  id: string;
  title: string;
  available: boolean;
  signedIn?: boolean;
  image?: string;
}

export interface BotAvatarPhoto {
  id: string;
  name: string;
  image: string;
}

export interface BotCreationAppearance {
  shapes: BotCreationShape[];
  colors: BotCreationColor[];
}

/** 新建 Bot 的草稿状态。 */
export interface BotCreationState {
  supported: boolean;
  /** 外形 / 配色目录（creation-appearance） */
  appearance?: BotCreationAppearance;
  loadingAppearance: boolean;
  appearanceFailed: boolean;
  /** 本地 Agent 列表（local-agents） */
  agents: BotCreationAgent[];
  loadingAgents: boolean;
  agentsFailed: boolean;
  /** 选中的本地 Agent 与它支持的模型 */
  agentRoute?: string;
  agentModels: BotRoleOption[];
  loadingAgentModels: boolean;
  /** 头像素材库（avatar-library 分页） */
  photos: BotAvatarPhoto[];
  photoOffset: number;
  hasMorePhotos: boolean;
  loadingPhotos: boolean;
  photosFailed: boolean;
  /** 新建提交 */
  saving: boolean;
  createdId?: string;
  error?: string;
}

/** 主页「新建会话 / 群聊」草稿。 */
export interface BotConversationState {
  supported: boolean;
  memberIds: string[];
  message: string;
  saving: boolean;
  error?: string;
  errorDetail?: string;
  uncertain: boolean;
  createdId?: string;
  openedId?: string;
}

/** @ 引用搜索状态。 */
export interface BotReferenceCandidate {
  id: string;
  kind: string;
  label: string;
  detail: string;
  wire: string;
  path: string;
}

export interface BotReferenceSearch {
  chatId: string;
  query: string;
  quoted: boolean;
  loading: boolean;
  unavailable: boolean;
  items: BotReferenceCandidate[];
}

/** 整页快照：BotStore 每次变更都会发布整个对象到 AppStorage('botState')。 */
export interface BotSnapshot {
  connected: boolean;
  supported: boolean;
  loading: boolean;
  error?: string;
  feedActive: boolean;
  boot?: string;
  capabilities: string[];
  mainBotId?: string;
  mainBotIds: string[];
  rosterIds: string[];
  chats: BotChat[];
  selectedChatId?: string;
  messages: BotChatMessage[];
  historyLoading: boolean;
  hasEarlier: boolean;
  schedules: BotSchedule[];
  schedulesAvailable: boolean;
  recent: BotActivity[];
  interactions: BotInteraction[];
  models: BotRoleOption[];
  permissions: BotRoleOption[];
  defaultModel?: string;
  effortModel?: string;
  efforts: BotRoleOption[];
  memoryAvailable: boolean;
  computerEnabled: boolean;
  writable: boolean;
  roleDetails?: BotRoleDetails;
  roleSaving: boolean;
  roleError?: string;
  roleSettingsSupported: boolean;
  attachmentsSupported: boolean;
  referencesSupported: boolean;
  botDeletionSupported: boolean;
  attachmentSending: boolean;
  creation: BotCreationState;
  conversation: BotConversationState;
  referenceSearch?: BotReferenceSearch;
  liveWork: Record<string, BotLiveWork>;
  unreadCounts: Record<string, number>;
}

/** 空状态工厂（ArkTS 不支持对象字面量默认值嵌套 Set 等，集中在这里创建）。 */
export function emptyBotCreationState(): BotCreationState {
  return {
    supported: false, loadingAppearance: false, appearanceFailed: false,
    agents: [], loadingAgents: false, agentsFailed: false, agentModels: [], loadingAgentModels: false,
    photos: [], photoOffset: 0, hasMorePhotos: false, loadingPhotos: false, photosFailed: false,
    saving: false
  };
}

export function emptyBotConversationState(): BotConversationState {
  return { supported: false, memberIds: [], message: '', saving: false, uncertain: false };
}

export function emptyBotSnapshot(): BotSnapshot {
  return {
    connected: false, supported: false, loading: false, feedActive: false,
    capabilities: [], mainBotIds: [], rosterIds: [], chats: [], messages: [],
    historyLoading: false, hasEarlier: false, schedules: [], schedulesAvailable: false,
    recent: [], interactions: [], models: [], permissions: [], efforts: [],
    memoryAvailable: true, computerEnabled: false, writable: true,
    roleSaving: false, roleSettingsSupported: false, attachmentsSupported: false,
    referencesSupported: false, botDeletionSupported: false, attachmentSending: false,
    creation: emptyBotCreationState(), conversation: emptyBotConversationState(),
    liveWork: {}, unreadCounts: {}
  };
}
