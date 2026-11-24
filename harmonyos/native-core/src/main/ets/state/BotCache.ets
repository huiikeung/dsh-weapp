/**
 * DS-Bot 本地缓存（按主机隔离）——对齐 iOS SharedBotStore 的缓存策略（docs/bot-mode-ios-spec.md §9.5）。
 *
 * - 一台主机一个文件：filesDir/bot-mode/<sha256(hostKey)>.json；hostKey 由 BotStore 注入
 *   （已保存主机 id / 连接端点），拿不到身份时回落固定 'default'（见 currentHostKey 的风险说明）。
 * - 版本 1 结构：{version, snapshot, histories, optimistic, noticeBoot, noticeSeq, readThrough, savedAt}。
 * - 写：状态变化后 600ms 防抖（从首次变更起算，避免流式事件不断重置计时器）、异步队列串行写、
 *   先写 .tmp 再 rename 原子替换；只写非空 JSON；序列化后 > 7.5MB 时按「最早聊天页」淘汰 histories
 *   （每聊天最多 100 条、最多 12 个聊天）直至 <= 7.5MB。
 * - 读：文件 <= 8MB 才读；解析失败 / 版本不符 / 结构不合法 => 忽略并删除坏文件。
 * - 落盘前统一 clone 清洗在线态（绝不改 BotStore 内存里的线上状态）；optimistic 一律 delivery='unknown'。
 *
 * 本文件只做「本地状态镜像」：不改变 send/write 语义、不自动重试、不发任何网络请求。
 */
import { common } from '@kit.AbilityKit';
import { fileIo } from '@kit.CoreFileKit';
import { util } from '@kit.ArkTS';
import { cryptoFramework } from '@kit.CryptoArchitectureKit';
import { asRec, bool, field, num, str } from '../protocol/GatewayFrameCodec';
import {
  BotActivity, BotAnswerChoice, BotChat, BotChatImage, BotChatMessage, BotLiveWork, BotPresentedFile,
  BotQuestionAnswer, BotRoleOption, BotRoleProfile, BotSchedule, BotSnapshot,
  emptyBotCreationState, emptyBotConversationState, emptyBotSnapshot
} from '../protocol/BotDtos';
import { Logger } from '../common/Logger';

/** 缓存结构版本（版本不符直接丢弃并删文件）。 */
export const BOT_CACHE_VERSION: number = 1;
/** 缓存目录名：<filesDir>/bot-mode。 */
export const BOT_CACHE_DIR: string = 'bot-mode';

const EMPTY: string = '';
/** 主机身份解析不出来的兜底键。 */
const DEFAULT_HOST_KEY: string = 'default';
/** 状态变化后的写盘防抖。 */
const DEBOUNCE_MS: number = 600;
/** 写盘上限：7.5 MiB（对齐 iOS 序列化后 <= 7.5MB）。 */
const WRITE_LIMIT_BYTES: number = 7.5 * 1024 * 1024;
/** 读盘上限：8 MiB（对齐 iOS 读取文件 <= 8MB）。 */
const READ_LIMIT_BYTES: number = 8 * 1024 * 1024;
/** 历史最多保留的聊天数。 */
const MAX_HISTORY_CHATS: number = 12;
/** 每聊天最多保留的消息数。 */
const MAX_HISTORY_MESSAGES: number = 100;
/** 读盘分块 / 写盘分块（避免一次性大 buffer 卡主线程）。 */
const READ_CHUNK_BYTES: number = 256 * 1024;
const WRITE_CHUNK_BYTES: number = 512 * 1024;

/** 版本 1 的 JSON 文件结构。 */
interface BotCacheFile {
  version: number;
  snapshot: BotSnapshot;
  histories: Record<string, BotChatMessage[]>;
  optimistic: Record<string, BotChatMessage[]>;
  noticeBoot: string;
  noticeSeq: number;
  readThrough: Record<string, number>;
  savedAt: number;
}

/** BotStore 交给缓存写盘的内存态（全部是引用，序列化只在防抖后发生）。 */
export interface BotCachePayload {
  snapshot: BotSnapshot;
  histories: Map<string, BotChatMessage[]>;
  optimistic: Map<string, BotChatMessage[]>;
  noticeBoot: string;
  noticeSeq: number;
  readThrough: Map<string, number>;
}

/** 读盘结果（BotStore 据此合并；hostKey 用于防止切换主机后旧缓存串台）。 */
export interface RestoredBotCache {
  hostKey: string;
  snapshot: BotSnapshot;
  histories: Map<string, BotChatMessage[]>;
  optimistic: Map<string, BotChatMessage[]>;
  noticeBoot: string;
  noticeSeq: number;
  readThrough: Map<string, number>;
}

/** 历史页（按最近活动时间排序，便于「最早聊天页」淘汰）。 */
interface HistoryEntry {
  chatId: string;
  lastMs: number;
  messages: BotChatMessage[];
}

// ==================== 纯函数辅助 ====================

function failureText(error: Object): string {
  return error instanceof Error ? error.message : String(error);
}

function sha256Hex(text: string): string {
  const md: cryptoFramework.Md = cryptoFramework.createMd('SHA256');
  md.updateSync({ data: new util.TextEncoder().encodeInto(text) });
  const digest: cryptoFramework.DataBlob = md.digestSync();
  let hex: string = EMPTY;
  for (let i = 0; i < digest.data.length; i++) {
    const part: string = digest.data[i].toString(16);
    hex += part.length === 1 ? '0' + part : part;
  }
  return hex;
}

function utf8Bytes(text: string): number {
  return new util.TextEncoder().encodeInto(text).byteLength;
}

function stringsOf(rows: Object[] | undefined): string[] {
  const out: string[] = [];
  if (rows === undefined) {
    return out;
  }
  for (const one of rows) {
    if (typeof one === 'string') {
      out.push(one as string);
    }
  }
  return out;
}

function lastTimeOf(messages: BotChatMessage[]): number {
  let last: number = 0;
  for (const message of messages) {
    const timeMs: number = message.timeMs ?? 0;
    if (timeMs > last) {
      last = timeMs;
    }
  }
  return last;
}

function compareEntries(a: HistoryEntry, b: HistoryEntry): number {
  if (a.lastMs === b.lastMs) {
    if (a.chatId === b.chatId) {
      return 0;
    }
    return a.chatId < b.chatId ? -1 : 1;
  }
  return b.lastMs - a.lastMs;
}

/** 落盘清洗：connected/loading/... 等在线态一律清掉，返回新对象（不碰入参）。 */
function sanitizeSnapshot(source: BotSnapshot): BotSnapshot {
  const out: BotSnapshot = emptyBotSnapshot();
  out.connected = false;
  out.supported = source.supported;          // 保留：能力位由 hello 决定，缓存只做展示
  out.loading = false;
  out.error = undefined;
  out.feedActive = false;
  out.boot = source.boot;
  out.capabilities = source.capabilities.slice();
  out.mainBotId = source.mainBotId;
  out.mainBotIds = source.mainBotIds.slice();
  out.rosterIds = source.rosterIds.slice();
  out.chats = source.chats.slice();
  out.selectedChatId = undefined;            // 选中会话/当前历史不落盘：恢复时回首页
  out.messages = [];
  out.historyLoading = false;
  out.hasEarlier = false;
  out.schedules = source.schedules.slice();
  out.schedulesAvailable = source.schedulesAvailable;
  out.recent = source.recent.slice();
  out.interactions = [];                     // 待处理交互不缓存，重连后由主机重新下发
  out.models = source.models.slice();
  out.permissions = source.permissions.slice();
  out.defaultModel = source.defaultModel;
  out.effortModel = undefined;
  out.efforts = [];
  out.memoryAvailable = source.memoryAvailable;
  out.computerEnabled = source.computerEnabled;
  out.writable = source.writable;
  out.roleDetails = undefined;
  out.roleSaving = false;
  out.roleError = undefined;
  out.roleSettingsSupported = false;
  out.attachmentsSupported = false;
  out.referencesSupported = false;
  out.botDeletionSupported = false;
  out.attachmentSending = false;
  out.creation = emptyBotCreationState();
  out.conversation = emptyBotConversationState();
  out.referenceSearch = undefined;
  const liveWork: Record<string, BotLiveWork> = {};
  out.liveWork = liveWork;                   // 运行中状态只对当前进程有意义
  out.unreadCounts = copyCounts(source.unreadCounts);
  return out;
}

function copyCounts(source: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const key of Object.keys(source)) {
    const value: number = source[key];
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      out[key] = value;
    }
  }
  return out;
}

/** 消息拷贝：只改 delivery（乐观消息落盘一律 unknown），其余字段原样带过去。 */
function withDelivery(message: BotChatMessage, delivery: string): BotChatMessage {
  const copy: BotChatMessage = {
    id: message.id,
    kind: message.kind,
    text: message.text,
    name: message.name,
    streaming: false,
    sessionId: message.sessionId,
    images: message.images.slice(),
    questionAnswers: message.questionAnswers.slice(),
    files: message.files.slice()
  };
  if (message.botId !== undefined) {
    copy.botId = message.botId;
  }
  if (message.timeMs !== undefined) {
    copy.timeMs = message.timeMs;
  }
  if (message.activity !== undefined) {
    copy.activity = message.activity;
  }
  if (message.turn !== undefined) {
    copy.turn = message.turn;
  }
  copy.delivery = delivery;
  return copy;
}

/** 历史页收集：每聊天最近 100 条、最多 12 个聊天，按最近活动倒序（末尾=最早，供淘汰）。 */
function historyEntries(source: Map<string, BotChatMessage[]>, recency: Map<string, number>): HistoryEntry[] {
  const out: HistoryEntry[] = [];
  source.forEach((value: BotChatMessage[], chatId: string) => {
    if (value.length === 0) {
      return;
    }
    const tail: BotChatMessage[] = value.length > MAX_HISTORY_MESSAGES
      ? value.slice(value.length - MAX_HISTORY_MESSAGES) : value.slice();
    let lastMs: number = lastTimeOf(tail);
    if (lastMs === 0) {
      lastMs = recency.get(chatId) ?? 0;
    }
    out.push({ chatId: chatId, lastMs: lastMs, messages: tail });
  });
  out.sort(compareEntries);
  return out.length > MAX_HISTORY_CHATS ? out.slice(0, MAX_HISTORY_CHATS) : out;
}

/** 乐观消息落盘：delivery 一律 unknown（失败/超时待用户核对）。 */
function optimisticForDisk(source: Map<string, BotChatMessage[]>): Record<string, BotChatMessage[]> {
  const out: Record<string, BotChatMessage[]> = {};
  source.forEach((value: BotChatMessage[], chatId: string) => {
    if (value.length === 0) {
      return;
    }
    const tail: BotChatMessage[] = value.length > MAX_HISTORY_MESSAGES
      ? value.slice(value.length - MAX_HISTORY_MESSAGES) : value;
    const copies: BotChatMessage[] = [];
    for (const message of tail) {
      copies.push(withDelivery(message, 'unknown'));
    }
    out[chatId] = copies;
  });
  return out;
}

function readThroughForDisk(source: Map<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  source.forEach((seq: number, chatId: string) => {
    if (Number.isFinite(seq) && seq > 0) {
      out[chatId] = seq;
    }
  });
  return out;
}

// ---- 读盘解码（全部 fail-closed：坏记录丢弃，坏文件删除） ----

function decodeOptions(rows: Object[] | undefined): BotRoleOption[] {
  const out: BotRoleOption[] = [];
  if (rows === undefined) {
    return out;
  }
  for (const raw of rows) {
    const rec: Record<string, Object> | undefined = asRec(raw);
    if (rec === undefined) {
      continue;
    }
    const id: string = str(rec, 'id') ?? EMPTY;
    if (id.length === 0) {
      continue;
    }
    const title: string = str(rec, 'title') ?? EMPTY;
    out.push({ id: id, title: title.length > 0 ? title : id });
  }
  return out;
}

function decodeProfile(raw: Object | undefined): BotRoleProfile | undefined {
  const rec: Record<string, Object> | undefined = asRec(raw);
  if (rec === undefined) {
    return undefined;
  }
  const profile: BotRoleProfile = {
    instructions: str(rec, 'instructions') ?? EMPTY,
    privateRole: bool(rec, 'privateRole') === true
  };
  const model: string = str(rec, 'model') ?? EMPTY;
  if (model.length > 0) {
    profile.model = model;
  }
  const effort: string = str(rec, 'effort') ?? EMPTY;
  if (effort.length > 0) {
    profile.effort = effort;
  }
  const workDir: string = str(rec, 'workDir') ?? EMPTY;
  if (workDir.length > 0) {
    profile.workDir = workDir;
  }
  const permission: string = str(rec, 'permission') ?? EMPTY;
  if (permission.length > 0) {
    profile.permission = permission;
  }
  const appliedModel: string = str(rec, 'appliedModel') ?? EMPTY;
  if (appliedModel.length > 0) {
    profile.appliedModel = appliedModel;
  }
  const appliedEffort: string = str(rec, 'appliedEffort') ?? EMPTY;
  if (appliedEffort.length > 0) {
    profile.appliedEffort = appliedEffort;
  }
  return profile;
}

function decodeChat(raw: Object): BotChat | undefined {
  const rec: Record<string, Object> | undefined = asRec(raw);
  if (rec === undefined) {
    return undefined;
  }
  const id: string = str(rec, 'id') ?? EMPTY;
  if (id.length === 0) {
    return undefined;
  }
  const chat: BotChat = {
    id: id,
    name: str(rec, 'name') ?? EMPTY,
    room: bool(rec, 'room') === true,
    role: str(rec, 'role') ?? EMPTY,
    preview: str(rec, 'preview') ?? EMPTY,
    lastAt: num(rec, 'lastAt') ?? 0,
    running: false,
    part: num(rec, 'part') ?? 0,
    memberIds: stringsOf(safeArray(rec, 'memberIds')),
    hidden: bool(rec, 'hidden') === true
  };
  const image: string = str(rec, 'image') ?? EMPTY;
  if (image.startsWith('data:image/')) {
    chat.image = image;
  }
  const imageRef: string = str(rec, 'imageRef') ?? EMPTY;
  if (imageRef.length > 0) {
    chat.imageRef = imageRef;
  }
  const sessionId: string = str(rec, 'sessionId') ?? EMPTY;
  if (sessionId.length > 0) {
    chat.sessionId = sessionId;
  }
  const profile: BotRoleProfile | undefined = decodeProfile(field(rec, 'profile'));
  if (profile !== undefined) {
    chat.profile = profile;
  }
  return chat;
}

function safeArray(rec: Record<string, Object>, key: string): Object[] | undefined {
  const value: Object | undefined = rec[key];
  return Array.isArray(value) ? (value as Object[]) : undefined;
}

function decodeChats(rows: Object[] | undefined): BotChat[] {
  const out: BotChat[] = [];
  if (rows === undefined) {
    return out;
  }
  for (const raw of rows) {
    const chat: BotChat | undefined = decodeChat(raw);
    if (chat !== undefined) {
      out.push(chat);
    }
  }
  return out;
}

function decodeSchedules(rows: Object[] | undefined): BotSchedule[] {
  const out: BotSchedule[] = [];
  if (rows === undefined) {
    return out;
  }
  for (const raw of rows) {
    const rec: Record<string, Object> | undefined = asRec(raw);
    if (rec === undefined) {
      continue;
    }
    const id: string = str(rec, 'id') ?? EMPTY;
    if (id.length === 0) {
      continue;
    }
    const schedule: BotSchedule = {
      id: id,
      title: str(rec, 'title') ?? EMPTY,
      status: str(rec, 'status') ?? EMPTY,
      next: str(rec, 'next') ?? EMPTY
    };
    const botId: string = str(rec, 'botId') ?? EMPTY;
    if (botId.length > 0) {
      schedule.botId = botId;
    }
    const sessionId: string = str(rec, 'sessionId') ?? EMPTY;
    if (sessionId.length > 0) {
      schedule.sessionId = sessionId;
    }
    out.push(schedule);
  }
  return out;
}

function decodeActivities(rows: Object[] | undefined): BotActivity[] {
  const out: BotActivity[] = [];
  if (rows === undefined) {
    return out;
  }
  for (const raw of rows) {
    const rec: Record<string, Object> | undefined = asRec(raw);
    if (rec === undefined) {
      continue;
    }
    const id: string = str(rec, 'id') ?? EMPTY;
    const kind: string = str(rec, 'kind') ?? EMPTY;
    if (id.length === 0 || kind.length === 0) {
      continue;
    }
    const activity: BotActivity = {
      id: id,
      text: str(rec, 'text') ?? EMPTY,
      kind: kind,
      name: str(rec, 'name') ?? EMPTY
    };
    const chatId: string = str(rec, 'chatId') ?? EMPTY;
    if (chatId.length > 0) {
      activity.chatId = chatId;
    }
    out.push(activity);
    if (out.length >= 30) {
      break;
    }
  }
  return out;
}

function decodeCounts(raw: Object | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  const rec: Record<string, Object> | undefined = asRec(raw);
  if (rec === undefined) {
    return out;
  }
  for (const key of Object.keys(rec)) {
    const value: Object = rec[key];
    if (typeof value === 'number' && Number.isFinite(value as number) && (value as number) > 0) {
      out[key] = value as number;
    }
  }
  return out;
}

function decodeSnapshot(raw: Record<string, Object>): BotSnapshot {
  const out: BotSnapshot = emptyBotSnapshot();
  out.connected = false;
  out.supported = bool(raw, 'supported') === true;
  out.loading = false;
  out.error = undefined;
  out.feedActive = false;
  const boot: string = str(raw, 'boot') ?? EMPTY;
  out.boot = boot.length > 0 ? boot : undefined;
  out.capabilities = stringsOf(safeArray(raw, 'capabilities'));
  const mainBotId: string = str(raw, 'mainBotId') ?? EMPTY;
  out.mainBotId = mainBotId.length > 0 ? mainBotId : undefined;
  out.mainBotIds = stringsOf(safeArray(raw, 'mainBotIds'));
  out.rosterIds = stringsOf(safeArray(raw, 'rosterIds'));
  out.chats = decodeChats(safeArray(raw, 'chats'));
  out.selectedChatId = undefined;
  out.messages = [];
  out.historyLoading = false;
  out.hasEarlier = false;
  out.schedules = decodeSchedules(safeArray(raw, 'schedules'));
  out.schedulesAvailable = bool(raw, 'schedulesAvailable') === true;
  out.recent = decodeActivities(safeArray(raw, 'recent'));
  out.interactions = [];
  out.models = decodeOptions(safeArray(raw, 'models'));
  out.permissions = decodeOptions(safeArray(raw, 'permissions'));
  const defaultModel: string = str(raw, 'defaultModel') ?? EMPTY;
  out.defaultModel = defaultModel.length > 0 ? defaultModel : undefined;
  out.effortModel = undefined;
  out.efforts = [];
  out.memoryAvailable = bool(raw, 'memoryAvailable') !== false;
  out.computerEnabled = bool(raw, 'computerEnabled') === true;
  out.writable = bool(raw, 'writable') !== false;
  out.roleDetails = undefined;
  out.roleSaving = false;
  out.roleError = undefined;
  out.roleSettingsSupported = false;
  out.attachmentsSupported = false;
  out.referencesSupported = false;
  out.botDeletionSupported = false;
  out.attachmentSending = false;
  out.creation = emptyBotCreationState();
  out.conversation = emptyBotConversationState();
  out.referenceSearch = undefined;
  const liveWork: Record<string, BotLiveWork> = {};
  out.liveWork = liveWork;
  out.unreadCounts = decodeCounts(field(raw, 'unreadCounts'));
  return out;
}

function decodeImages(rows: Object[] | undefined): BotChatImage[] {
  const out: BotChatImage[] = [];
  if (rows === undefined) {
    return out;
  }
  for (const raw of rows) {
    const rec: Record<string, Object> | undefined = asRec(raw);
    if (rec === undefined) {
      continue;
    }
    const attachmentId: string = str(rec, 'attachmentId') ?? EMPTY;
    if (attachmentId.length === 0 || attachmentId.length > 512) {
      continue;
    }
    const mediaType: string = str(rec, 'mediaType') ?? EMPTY;
    out.push({
      attachmentId: attachmentId,
      sessionId: str(rec, 'sessionId') ?? EMPTY,
      mediaType: mediaType.length > 0 ? mediaType : 'image/png',
      name: str(rec, 'name') ?? EMPTY,
      width: num(rec, 'width') ?? 0,
      height: num(rec, 'height') ?? 0
    });
  }
  return out;
}

function decodeAnswers(rows: Object[] | undefined): BotQuestionAnswer[] {
  const out: BotQuestionAnswer[] = [];
  if (rows === undefined) {
    return out;
  }
  for (const raw of rows) {
    const rec: Record<string, Object> | undefined = asRec(raw);
    if (rec === undefined) {
      continue;
    }
    const question: string = str(rec, 'question') ?? EMPTY;
    if (question.length === 0) {
      continue;
    }
    const choices: BotAnswerChoice[] = [];
    for (const choiceRaw of safeArray(rec, 'choices') ?? []) {
      const choiceRec: Record<string, Object> | undefined = asRec(choiceRaw);
      if (choiceRec === undefined) {
        continue;
      }
      const label: string = str(choiceRec, 'label') ?? EMPTY;
      if (label.length === 0) {
        continue;
      }
      const choice: BotAnswerChoice = { label: label };
      const letter: string = str(choiceRec, 'letter') ?? EMPTY;
      if (letter.length > 0) {
        choice.letter = letter;
      }
      choices.push(choice);
    }
    if (choices.length > 0) {
      out.push({ question: question, choices: choices });
    }
  }
  return out;
}

function decodeFiles(rows: Object[] | undefined): BotPresentedFile[] {
  const out: BotPresentedFile[] = [];
  if (rows === undefined) {
    return out;
  }
  for (const raw of rows) {
    const rec: Record<string, Object> | undefined = asRec(raw);
    if (rec === undefined) {
      continue;
    }
    const path: string = str(rec, 'path') ?? EMPTY;
    if (path.length === 0) {
      continue;
    }
    const name: string = str(rec, 'name') ?? EMPTY;
    const file: BotPresentedFile = { name: name.length > 0 ? name : path, path: path };
    const added: number | undefined = num(rec, 'added');
    if (added !== undefined) {
      file.added = added;
    }
    const deleted: number | undefined = num(rec, 'deleted');
    if (deleted !== undefined) {
      file.deleted = deleted;
    }
    const status: string = str(rec, 'status') ?? EMPTY;
    if (status.length > 0) {
      file.status = status;
    }
    const description: string = str(rec, 'description') ?? EMPTY;
    if (description.length > 0) {
      file.description = description;
    }
    out.push(file);
    if (out.length >= 20) {
      break;
    }
  }
  return out;
}

function decodeMessage(raw: Object): BotChatMessage | undefined {
  const rec: Record<string, Object> | undefined = asRec(raw);
  if (rec === undefined) {
    return undefined;
  }
  const id: string = str(rec, 'id') ?? EMPTY;
  const kind: string = str(rec, 'kind') ?? EMPTY;
  if (id.length === 0 || kind.length === 0) {
    return undefined;
  }
  const message: BotChatMessage = {
    id: id,
    kind: kind,
    text: str(rec, 'text') ?? EMPTY,
    name: str(rec, 'name') ?? EMPTY,
    streaming: false,
    sessionId: str(rec, 'sessionId') ?? EMPTY,
    images: decodeImages(safeArray(rec, 'images')),
    questionAnswers: decodeAnswers(safeArray(rec, 'questionAnswers')),
    files: decodeFiles(safeArray(rec, 'files'))
  };
  const delivery: string = str(rec, 'delivery') ?? EMPTY;
  if (delivery.length > 0) {
    message.delivery = delivery;
  }
  const botId: string = str(rec, 'botId') ?? EMPTY;
  if (botId.length > 0) {
    message.botId = botId;
  }
  const timeMs: number | undefined = num(rec, 'timeMs');
  if (timeMs !== undefined && Number.isFinite(timeMs) && timeMs > 0) {
    message.timeMs = timeMs;
  }
  const activity: string = str(rec, 'activity') ?? EMPTY;
  if (activity.length > 0) {
    message.activity = activity;
  }
  const turn: number | undefined = num(rec, 'turn');
  if (turn !== undefined && Number.isFinite(turn) && turn >= 0) {
    message.turn = turn;
  }
  return message;
}

function decodeMessageRecord(raw: Object | undefined, forceUnknown: boolean): Map<string, BotChatMessage[]> {
  const out: Map<string, BotChatMessage[]> = new Map<string, BotChatMessage[]>();
  const rec: Record<string, Object> | undefined = asRec(raw);
  if (rec === undefined) {
    return out;
  }
  const entries: HistoryEntry[] = [];
  for (const key of Object.keys(rec)) {
    const value: Object = rec[key];
    if (!Array.isArray(value)) {
      continue;
    }
    const messages: BotChatMessage[] = [];
    for (const item of value as Object[]) {
      const message: BotChatMessage | undefined = decodeMessage(item);
      if (message === undefined) {
        continue;
      }
      if (forceUnknown) {
        message.delivery = 'unknown';
      }
      messages.push(message);
    }
    if (messages.length === 0) {
      continue;
    }
    const tail: BotChatMessage[] = messages.length > MAX_HISTORY_MESSAGES
      ? messages.slice(messages.length - MAX_HISTORY_MESSAGES) : messages;
    entries.push({ chatId: key, lastMs: lastTimeOf(tail), messages: tail });
  }
  entries.sort(compareEntries);
  for (let i = 0; i < entries.length && i < MAX_HISTORY_CHATS; i++) {
    out.set(entries[i].chatId, entries[i].messages);
  }
  return out;
}

function decodeReadThrough(raw: Object | undefined): Map<string, number> {
  const out: Map<string, number> = new Map<string, number>();
  const rec: Record<string, Object> | undefined = asRec(raw);
  if (rec === undefined) {
    return out;
  }
  for (const key of Object.keys(rec)) {
    const value: Object = rec[key];
    if (typeof value === 'number' && Number.isFinite(value as number) && (value as number) >= 0) {
      out.set(key, value as number);
    }
  }
  return out;
}

/**
 * Bot 模式本地缓存：一台主机一个 JSON 文件，600ms 防抖 + 串行原子写。
 * 单例由 BotStore 持有（attach 时 bind 主机身份并 load，状态变更时 scheduleSave）。
 */
export class BotCache {
  private static instance: BotCache = new BotCache();
  /** filesDir/bot-mode；uiAbilityContext 注入前为空。 */
  private rootDir: string = EMPTY;
  /** BotStore 注入的主机身份；空串时由 AppStorage 回落解析。 */
  private boundHostKey: string = EMPTY;
  /** 最新待写状态（只保留最后一份，天然去抖）。 */
  private pending: BotCachePayload | undefined = undefined;
  /** pending 对应的主机身份（切换主机后旧数据仍写入旧主机文件，不串台）。 */
  private pendingHostKey: string = EMPTY;
  /** 防抖计时器 id（0 = 未排程）。 */
  private timer: number = 0;
  /** 串行写盘标记：上一笔没写完时新状态只更新 pending，由队列补写。 */
  private writing: boolean = false;

  static get(): BotCache {
    return BotCache.instance;
  }

  /** 由 BotStore.attach / refreshAll 注入当前主机身份；空串表示交给 AppStorage 回落解析。 */
  bind(hostKey: string): void {
    this.boundHostKey = hostKey;
    // filesDir 可能晚于首次 bind 注入（EntryAbility 先 setOrCreate uiAbilityContext，再 attach BotStore），
    // 这里只清目录缓存，下一次读/写再按 context.filesDir 解析。
    this.rootDir = EMPTY;
  }

  /** 冷启动恢复：只读本地文件，不触发任何网络请求。 */
  load(): Promise<RestoredBotCache | undefined> {
    return this.readFile();
  }

  /**
   * 状态变化后调用：只记录最新引用并排 600ms 防抖，序列化推迟到 flush（不会每帧 JSON.stringify）。
   * 计时器不重置：流式事件密集时仍保证首次变更后 600ms 内落一次盘。
   */
  scheduleSave(payload: BotCachePayload): void {
    this.pending = payload;
    this.pendingHostKey = this.currentHostKey();
    if (this.writing || this.timer !== 0) {
      return;
    }
    this.armTimer();
  }

  /** 测试 / 退后台入口：跳过防抖立即写盘（写盘进行中时返回 false，队列稍后会补写最新状态）。 */
  async saveNow(payload: BotCachePayload): Promise<boolean> {
    this.pending = payload;
    this.pendingHostKey = this.currentHostKey();
    if (this.timer !== 0) {
      clearTimeout(this.timer);
      this.timer = 0;
    }
    if (this.writing) {
      return false;
    }
    return await this.flush();
  }

  // ==================== 写盘 ====================

  private armTimer(): void {
    if (this.timer !== 0) {
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = 0;
      void this.flush();
    }, DEBOUNCE_MS);
  }

  private async flush(): Promise<boolean> {
    if (this.writing) {
      return false;
    }
    const payload: BotCachePayload | undefined = this.pending;
    if (payload === undefined) {
      return false;
    }
    const hostKey: string = this.pendingHostKey.length > 0 ? this.pendingHostKey : this.currentHostKey();
    this.pending = undefined;
    this.pendingHostKey = EMPTY;
    this.writing = true;
    let written: boolean = false;
    try {
      written = await this.writePayload(payload, hostKey);
    } catch (error) {
      Logger.warn('bot cache flush failed: ' + failureText(error));
    } finally {
      this.writing = false;
      // 写盘期间又有更新：补排一次（仍走 600ms 防抖，合并连续变更）
      if (this.pending !== undefined) {
        this.armTimer();
      }
    }
    return written;
  }

  private async writePayload(payload: BotCachePayload, hostKey: string): Promise<boolean> {
    const json: string = this.buildJson(payload);
    // 只写非空 JSON
    if (json.length === 0) {
      return false;
    }
    const dir: string = this.baseDir();
    if (dir.length === 0) {
      Logger.warn('bot cache skipped: filesDir unavailable');
      return false;
    }
    try {
      await fileIo.mkdir(dir, true);
    } catch (error) {
      // 目录已存在会抛错，忽略
    }
    const path: string = dir + '/' + sha256Hex(hostKey) + '.json';
    const tempPath: string = path + '.tmp';
    const bytes: Uint8Array = new util.TextEncoder().encodeInto(json);
    let file: fileIo.File | null = null;
    try {
      file = await fileIo.open(tempPath, fileIo.OpenMode.READ_WRITE | fileIo.OpenMode.CREATE | fileIo.OpenMode.TRUNC);
      let offset: number = 0;
      while (offset < bytes.byteLength) {
        const length: number = Math.min(WRITE_CHUNK_BYTES, bytes.byteLength - offset);
        const chunk: ArrayBuffer = bytes.buffer.slice(bytes.byteOffset + offset, bytes.byteOffset + offset + length) as ArrayBuffer;
        const written: number = await fileIo.write(file.fd, chunk, { length: length });
        if (written !== length) {
          throw new Error('bot cache write incomplete');
        }
        offset += written;
      }
      try {
        await fileIo.fsync(file.fd);
      } catch (error) {
        // fsync 失败不阻断：内容已 write 完，rename 仍会在大多数设备上落盘
      }
      await fileIo.close(file);
      file = null;
      // 先写临时文件再 rename：rename 是原子替换，读侧不会看到半截 JSON
      try {
        await fileIo.rename(tempPath, path);
      } catch (error) {
        // 个别文件系统不允许覆盖已存在目标：删旧文件后重试一次
        try {
          await fileIo.unlink(path);
        } catch (cleanup) {
        }
        await fileIo.rename(tempPath, path);
      }
      return true;
    } catch (error) {
      Logger.warn('bot cache write failed: ' + failureText(error));
      try {
        await fileIo.unlink(tempPath);
      } catch (cleanup) {
      }
      return false;
    } finally {
      if (file !== null) {
        try {
          await fileIo.close(file);
        } catch (error) {
        }
      }
    }
  }

  /** 序列化 + 体积淘汰：> 7.5MB 时从最早聊天页开始丢 histories，直到满足上限或 histories 清空。 */
  private buildJson(payload: BotCachePayload): string {
    const snapshot: BotSnapshot = sanitizeSnapshot(payload.snapshot);
    const recency: Map<string, number> = new Map<string, number>();
    for (const chat of payload.snapshot.chats) {
      recency.set(chat.id, chat.lastAt);
    }
    const entries: HistoryEntry[] = historyEntries(payload.histories, recency);
    const optimistic: Record<string, BotChatMessage[]> = optimisticForDisk(payload.optimistic);
    const readThrough: Record<string, number> = readThroughForDisk(payload.readThrough);
    let json: string = this.serialize(snapshot, entries, optimistic, payload, readThrough);
    let bytes: number = utf8Bytes(json);
    while (bytes > WRITE_LIMIT_BYTES && entries.length > 0) {
      entries.pop();   // 倒序排列：pop 即淘汰「最早的聊天页」
      json = this.serialize(snapshot, entries, optimistic, payload, readThrough);
      bytes = utf8Bytes(json);
    }
    if (bytes > WRITE_LIMIT_BYTES) {
      // 只剩 snapshot 仍超限（头像 data URI 等）：仍写非空文件，仅记录风险
      Logger.warn('bot cache above limit after history eviction bytes=' + bytes.toString());
    }
    return json;
  }

  private serialize(snapshot: BotSnapshot, entries: HistoryEntry[], optimistic: Record<string, BotChatMessage[]>,
    payload: BotCachePayload, readThrough: Record<string, number>): string {
    const histories: Record<string, BotChatMessage[]> = {};
    for (const entry of entries) {
      histories[entry.chatId] = entry.messages;
    }
    const file: BotCacheFile = {
      version: BOT_CACHE_VERSION,
      snapshot: snapshot,
      histories: histories,
      optimistic: optimistic,
      noticeBoot: payload.noticeBoot,
      noticeSeq: payload.noticeSeq,
      readThrough: readThrough,
      savedAt: Date.now()
    };
    return JSON.stringify(file);
  }

  // ==================== 读盘 ====================

  private async readFile(): Promise<RestoredBotCache | undefined> {
    const path: string = this.filePath();
    if (path.length === 0) {
      return undefined;
    }
    const hostKey: string = this.currentHostKey();
    const text: string | undefined = await this.readText(path);
    if (text === undefined) {
      return undefined;
    }
    let parsed: Object | undefined = undefined;
    try {
      parsed = JSON.parse(text) as Object;
    } catch (error) {
      parsed = undefined;
    }
    if (parsed === undefined) {
      Logger.warn('bot cache json invalid, dropping file');
      await this.discard(path);
      return undefined;
    }
    const restored: RestoredBotCache | undefined = this.decode(parsed, hostKey);
    if (restored === undefined) {
      Logger.warn('bot cache shape/version mismatch, dropping file');
      await this.discard(path);
    }
    return restored;
  }

  private async readText(path: string): Promise<string | undefined> {
    let file: fileIo.File | null = null;
    try {
      const exists: boolean = await fileIo.access(path);
      if (!exists) {
        return undefined;
      }
      file = await fileIo.open(path, fileIo.OpenMode.READ_ONLY);
      const stat = await fileIo.stat(file.fd);
      const size: number = stat.size;
      // 读盘上限 8MB：空文件 / 超限文件都按坏文件删除
      if (!Number.isSafeInteger(size) || size <= 0 || size > READ_LIMIT_BYTES) {
        await fileIo.close(file);
        file = null;
        await this.discard(path);
        return undefined;
      }
      const chunks: Uint8Array[] = [];
      let read: number = 0;
      while (read < size) {
        const length: number = Math.min(READ_CHUNK_BYTES, size - read);
        const buffer: ArrayBuffer = new ArrayBuffer(length);
        const got: number = await fileIo.read(file.fd, buffer, { length: length });
        if (got <= 0) {
          break;
        }
        chunks.push(new Uint8Array(buffer, 0, got));
        read += got;
      }
      if (read === 0) {
        return undefined;
      }
      let merged: Uint8Array;
      if (chunks.length === 1) {
        merged = chunks[0];
      } else {
        merged = new Uint8Array(read);
        let at: number = 0;
        for (const chunk of chunks) {
          merged.set(chunk, at);
          at += chunk.byteLength;
        }
      }
      return util.TextDecoder.create('utf-8').decodeToString(merged);
    } catch (error) {
      Logger.warn('bot cache read failed: ' + failureText(error));
      return undefined;
    } finally {
      if (file !== null) {
        try {
          await fileIo.close(file);
        } catch (error) {
        }
      }
    }
  }

  private decode(parsed: Object, hostKey: string): RestoredBotCache | undefined {
    const root: Record<string, Object> | undefined = asRec(parsed);
    if (root === undefined) {
      return undefined;
    }
    const version: number = num(root, 'version') ?? -1;
    if (version !== BOT_CACHE_VERSION) {
      return undefined;
    }
    const snapshotRaw: Record<string, Object> | undefined = asRec(field(root, 'snapshot'));
    if (snapshotRaw === undefined) {
      return undefined;
    }
    const snapshot: BotSnapshot = decodeSnapshot(snapshotRaw);
    const histories: Map<string, BotChatMessage[]> = decodeMessageRecord(field(root, 'histories'), false);
    const optimistic: Map<string, BotChatMessage[]> = decodeMessageRecord(field(root, 'optimistic'), true);
    const noticeBoot: string = str(root, 'noticeBoot') ?? EMPTY;
    const noticeSeq: number = num(root, 'noticeSeq') ?? 0;
    const readThrough: Map<string, number> = decodeReadThrough(field(root, 'readThrough'));
    const restored: RestoredBotCache = {
      hostKey: hostKey,
      snapshot: snapshot,
      histories: histories,
      optimistic: optimistic,
      noticeBoot: noticeBoot,
      noticeSeq: noticeSeq,
      readThrough: readThrough
    };
    return restored;
  }

  private async discard(path: string): Promise<void> {
    try {
      await fileIo.unlink(path);
    } catch (error) {
      // 删除失败不影响启动
    }
  }

  // ==================== 路径与主机身份 ====================

  /**
   * 当前主机身份（缓存分文件键）：
   * 1) BotStore 注入的 key；2) AppStorage 'activeGatewayId'；3) 当前连接端点 'activeEndpoint'；
   * 4) 都拿不到时回落 'default' —— 风险：全新安装尚未连接任何主机时所有状态会共用一个
   *    bot-mode/<sha256(default)>.json；一旦连上主机 BotStore 会 bind 出真实 key，下次启动即按主机分文件。
   */
  private currentHostKey(): string {
    if (this.boundHostKey.length > 0) {
      return this.boundHostKey;
    }
    const stored: string = AppStorage.get<string>('activeGatewayId') ?? EMPTY;
    if (stored.length > 0) {
      return 'gateway:' + stored;
    }
    const endpoint: string = AppStorage.get<string>('activeEndpoint') ?? EMPTY;
    if (endpoint.length > 0) {
      return 'endpoint:' + endpoint;
    }
    return DEFAULT_HOST_KEY;
  }

  /** 缓存根目录 <filesDir>/bot-mode；context 未注入时返回空串（本次读写跳过）。 */
  private baseDir(): string {
    if (this.rootDir.length > 0) {
      return this.rootDir;
    }
    try {
      const context: common.UIAbilityContext | undefined =
        AppStorage.get<common.UIAbilityContext>('uiAbilityContext');
      if (context === undefined) {
        return EMPTY;
      }
      this.rootDir = context.filesDir + '/' + BOT_CACHE_DIR;
    } catch (error) {
      return EMPTY;
    }
    return this.rootDir;
  }

  private filePath(): string {
    const dir: string = this.baseDir();
    if (dir.length === 0) {
      return EMPTY;
    }
    return dir + '/' + sha256Hex(this.currentHostKey()) + '.json';
  }
}
