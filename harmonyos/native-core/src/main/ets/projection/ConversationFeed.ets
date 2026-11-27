import { ConversationItem, ConversationItemKind } from '../projection/ConversationProjection';
import type { PresentedFile } from '../projection/ConversationProjection';
import type { GatewayFileAttachment, GatewayImageAttachment } from '../protocol/GatewayDtos';
import { WorkStepPresentation } from './WorkStepPresentation';
import type { WorkStepPolicy } from './WorkStepPresentation';

/**
 * 会话时间线显示条目（对齐小程序 pages/session/utils/conversation-workflow.js）。
 *
 * 与小程序保持一致的关键规则：
 * - 连续的 context / reasoning / tool / toolResult / status 合并成一个过程组；
 * - 过程组标题按「子内容」命名（已读取文件、已搜索代码、修改了文件…），不是按时长；
 * - 回合收工后，同一回合的多个过程组收拢成一条「已完成」折叠行；
 * - user / assistant / system 各自成为消息行，只有最后一条正式回复可复制。
 */

/** 工具活动分类（对齐小程序 toolActivityKind）。 */
export class ToolActivity {
  static kind(name: string): string {
    const raw: string = String(name === undefined ? '' : name).toLowerCase();
    const parts: string[] = raw.split('.');
    const dotted: string = parts[parts.length - 1];
    const slashed: string[] = dotted.split('/');
    const tail: string = slashed[slashed.length - 1];
    const n: string = tail.replace(/[^a-z0-9]/g, '');
    if (n === 'write' || n === 'writefile') {
      return 'write';
    }
    if (n === 'edit' || n === 'editfile' || n === 'applypatch' || n === 'strreplaceeditor') {
      return 'edit';
    }
    if (n === 'readimage' || n === 'viewimage') {
      return 'readImage';
    }
    if (n === 'read' || n === 'readfile') {
      return 'read';
    }
    if (n === 'glob' || n === 'grep' || n === 'search' || n === 'find' || n === 'lsp') {
      return 'search';
    }
    if (n === 'webfetch' || n === 'fetch') {
      return 'webFetch';
    }
    if (n === 'websearch' || n === 'browse') {
      return 'webSearch';
    }
    if (n === 'bash' || n === 'pwsh' || n === 'shell' || n === 'exec' || n === 'execcommand'
      || n === 'writestdin' || n === 'terminal') {
      return 'commands';
    }
    if (n === 'runcode' || n === 'code' || n === 'python') {
      return 'code';
    }
    if (n === 'spawnteammate' || n === 'listagents' || n === 'sendmessage' || n === 'interruptagent'
      || n === 'waitagent' || n === 'spawnagent' || n === 'subagent' || n === 'followuptask') {
      return 'subagents';
    }
    if (n === 'plan' || n === 'updateplan') {
      return 'plan';
    }
    if (n === 'askuser' || n === 'requestuserinput' || n === 'ask_user_question') {
      return 'questions';
    }
    return 'tools';
  }

  /** 活动分类 → 中文（对齐小程序 ACTIVITY_LABELS）。 */
  static label(kind: string): string {
    if (kind === 'thinking') {
      return '已完成分析';
    }
    if (kind === 'read') {
      return '已读取文件';
    }
    if (kind === 'readImage') {
      return '已读取图片';
    }
    if (kind === 'write') {
      return '已写入文件';
    }
    if (kind === 'search') {
      return '已搜索代码';
    }
    if (kind === 'edit') {
      return '修改了文件';
    }
    if (kind === 'commands') {
      return '执行了命令';
    }
    if (kind === 'code') {
      return '运行了代码';
    }
    if (kind === 'webSearch') {
      return '已搜索网页';
    }
    if (kind === 'webFetch') {
      return '已访问网页';
    }
    if (kind === 'subagents') {
      return '已协调子智能体';
    }
    if (kind === 'plan') {
      return '更新了计划';
    }
    if (kind === 'questions') {
      return '向用户提出了问题';
    }
    if (kind === 'context') {
      return '已注入上下文';
    }
    return '已调用工具';
  }
}

/** 单条工具调用的展示字段（对齐小程序 tool-presentation.js）。 */
export interface ToolFace {
  label: string;
  detail: string;
  /** 未识别具体动作的通用工具（标签统一为「工具调用」，工具名拼进 detail） */
  genericTool?: boolean;
  isCommand: boolean;
  commandText: string;
  cwdLabel: string;
}

/** 过程组（显示行的载体）。 */
export class ConversationFeedEntry {
  id: string = '';
  /** USER | ASSISTANT | PROCESS | TURN | STATUS | SYSTEM */
  kind: string = '';
  title: string = '';
  text: string = '';
  isError: boolean = false;
  streaming: boolean = false;
  copyable: boolean = false;
  epochSeconds: number = 0;
  expanded: boolean = false;
  items: ConversationItem[] = [];
  imageCount: number = 0;
  /** 图片附件（用户发送 / 助手回复里的 image 块），用于缩略图回显 */
  images: GatewayImageAttachment[] = [];
  /** 本地乐观回显图片（发送瞬间的本地 URI，真实附件到达前用它渲染缩略图） */
  localImages: string[] = [];
  /** 文件附件（type='file' 的 content 块），用于文件 chip 回显 */
  attachments: GatewayFileAttachment[] = [];
  /** 已编辑 / 交付文件卡片（CHANGES / FILES 行） */
  files: PresentedFile[] = [];
  /** CHANGES 行的事件 seq（拉取文件变更摘要用） */
  changeSeq: number = 0;
  /** 过程组：运行中 / 已完成 / 已停止 / 执行失败 */
  running: boolean = false;
  /** 可展开（有子内容） */
  expandable: boolean = false;
  /** 组摘要：N 次工具调用 · N 项上下文（用时不上组行，只留给回合折叠行） */
  summary: string = '';
  /** 组的用时文案（如「1 分 30 秒」）：回合折叠行显示用，不上过程组行 */
  durationText: string = '';
  /** 组内工具数、上下文数（供标题与摘要使用） */
  toolCount: number = 0;
  contextCount: number = 0;
  /** 回合折叠行：被收拢的过程组 id 列表 */
  childIds: string[] = [];
  /** 回合折叠行：被收拢的过程组（展开回合时逐组显示，各自保留活动标题） */
  children: ConversationFeedEntry[] = [];
  turnKey: string = '';
  /** 活动分类（决定过程组图标，对齐小程序 toolIconFile / dsh processToolIcon） */
  activityKind: string = 'tools';
  /**
   * 助手正文身份（对齐 dsh-interactive-reader：叙述永远不是过程内容、永远不折叠，身份只决定按钮行归谁）：
   *   'narration' = 过程叙述 —— 不渲染复制/引用/用量行；
   *   'answer'    = 最终答复 —— 渲染按钮行；
   *   'pending'   = 运行中最后一段正文，身份未定 —— 不渲染按钮行，回合结束再定。
   */
  bodyPhase: string = 'answer';
  /** 运行中细节（文件路径 / 命令），单独展示在标题后（对齐小程序 .process-live-detail） */
  liveDetail: string = '';
  /** 过程内叙述文字（对齐小程序 narration 节点） */
  narration: boolean = false;
  /** 回合页脚：复制 / 用量 / 时间（对齐小程序 turn-footer） */
  footerVisible: boolean = false;
  /** AI 生成内容显式标识：每轮第一条助手侧的行顶部显示（applyTurnFooters 标记） */
  aiLabelVisible: boolean = false;
  turnMetaText: string = '';
  /** 本轮用量明细（点用量胶囊时在按钮上方弹出） */
  turnUsageDetail: string = '';
  /** 正文里已用 Markdown 引用的图片 id：行尾图片网格要把它们排除，避免同一张图显示两次 */
  inlineImageIds: string[] = [];
  /** 用量弹窗标题行右侧的精确总量（如 8,853,566 tok） */
  turnUsageTotal: string = '';
  /** 用量弹窗分项行（label\u0001value） */
  turnUsageRows: string[] = [];
  turnTimeText: string = '';
  /** 本轮用时（用户发出 → 回复落地），如「用时 5 分 19 秒」 */
  turnElapsedText: string = '';
  failureTitle: string = '';
  /** 回合失败错误码（如 CONTENT_REFUSED） */
  failureCode: string = '';
  // ===== 工作步骤展示策略（对齐小程序 work-step-presentation.apply 的字段）=====
  /** 组体是否整块收起（grouped && !expanded） */
  processGrouped: boolean = false;
  /** 组体自动可见（详细档对话过程中 / 完全展开档） */
  processAutoOpen: boolean = false;
  /** 组体此刻是否可见 */
  processBodyVisible: boolean = false;
  /** 阅读档实时折叠：本轮新思考出现时，把前面这些步骤收进折叠条（条目数前缀） */
  liveFoldCount: number = 0;
  /** 组体是否限高滚动 */
  processBodyCapped: boolean = false;
  /**
   * 阅读档运行中：本组是「正在跑的那一轮」里、已被后续叙述/新组隔开的前序组 —— 整组折成一条摘要
   *（对齐 dsh-interactive-reader：narration 之前每个 run 各自收成 live fold）。
   * 回合结束后由 mergeSettledTurn 接手折成「已完成」行，本标记随之清零。
   */
  liveFoldSettled: boolean = false;
  /** 组标题隐藏（完全展开档 / 简洁档运行中只留活动组） */
  headingHidden: boolean = false;
  /** 组标题换行显示（简洁档） */
  titleWrap: boolean = false;
  /** 回合是否已收工 */
  turnClosed: boolean = false;
  /** 回合展开时显示的工具次数（对齐小程序 turnProcess.expandedSummary） */
  expandedSummary: string = '';
  /** 组内活动命名（回合收拢后组标题回到活动命名） */
  activityTitle: string = '';
  /** 可折叠（失败/中断的回合恒展开，对齐小程序 turnProcess.alwaysOpen） */
  foldable: boolean = true;
}

const PROCESS_KINDS: string[] = ['CONTEXT', 'REASONING', 'TOOL', 'JSON_TOOL', 'TOOL_RESULT'];

export class ConversationFeed {
  /** 流式标题常量（判定依据，不能本地化）。 */
  static streamingAssistantTitle: string = 'flukit · 正在生成…';

  /** 运行中短语（30 秒一桶轮换，对齐小程序 §3.4）。 */
  private static thinkingPhrases: string[] = ['梳理脉络中', '推敲细节中', '酝酿下一步中', '沿着思路前行中'];
  private static gatheringPhrases: string[] = ['翻阅已有线索中', '收拢相关信息中', '寻找切入点中', '铺开问题脉络中'];
  private static exploringPhrases: string[] = ['向外寻找线索中', '打捞新线索中', '沿途探查中', '搜集更多拼图中'];
  private static reviewingPhrases: string[] = ['对照新发现中', '拼合新线索中', '检视所得中', '把发现串起来中'];
  private static revisitingPhrases: string[] = ['回看已有线索中', '重新校准方向中', '再推敲一遍中', '换个角度审视中'];
  private static composingPhrases: string[] = ['组织回应中', '整理表达中', '将思路落成文字中', '勾勒答案中'];
  private static workingPhrases: string[] = ['继续推进中', '稳步探索中', '梳理当前进展中', '逐步展开中'];

  static phrases(activity: string): string[] {
    if (activity === 'gathering') {
      return ConversationFeed.gatheringPhrases;
    }
    if (activity === 'exploring') {
      return ConversationFeed.exploringPhrases;
    }
    if (activity === 'reviewing') {
      return ConversationFeed.reviewingPhrases;
    }
    if (activity === 'revisiting') {
      return ConversationFeed.revisitingPhrases;
    }
    if (activity === 'composing') {
      return ConversationFeed.composingPhrases;
    }
    if (activity === 'working') {
      return ConversationFeed.workingPhrases;
    }
    return ConversationFeed.thinkingPhrases;
  }

  static isProcessKind(kind: string): boolean {
    return PROCESS_KINDS.indexOf(kind) >= 0;
  }

  static collapse(value: string): string {
    return value.replace(/\s+/g, ' ').trim();
  }

  static preview(value: string, limit: number = 96): string {
    const collapsed: string = ConversationFeed.collapse(value);
    return collapsed.length > limit ? collapsed.substring(0, limit) + '…' : collapsed;
  }

  /** 后台任务类工具的展示名（对齐 DSH 桌面端 tool.title.*）；非任务工具返回空串。 */
  static jobToolLabel(name: string): string {
    const raw: string = String(name === undefined ? '' : name).toLowerCase();
    const parts: string[] = raw.split('.');
    const tail: string = parts[parts.length - 1].replace(/[^a-z0-9_]/g, '');
    if (tail === 'job_output' || tail === 'readjob' || tail === 'joboutput') {
      return '读取任务输出';
    }
    if (tail === 'job_list' || tail === 'listjobs' || tail === 'joblist') {
      return '查看后台任务';
    }
    if (tail === 'job_kill' || tail === 'killjob' || tail === 'jobkill') {
      return '取消后台任务';
    }
    return '';
  }

  /** 工具展示：命令工具取 command，其余按类型取代表字段（对齐小程序）。 */
  static toolFace(name: string, argumentsText: string): ToolFace {
    const face: ToolFace = {
      label: '工具调用', detail: '', genericTool: false, isCommand: false, commandText: '', cwdLabel: ''
    };
    const raw: string = argumentsText === undefined ? '' : argumentsText;
    const fields: Record<string, string> = ConversationFeed.parseFields(raw);
    const kind: string = ToolActivity.kind(name);
    const trimmed: string = String(name === undefined ? '' : name).trim();
    // 后台任务工具按 DSH 桌面端 tool.title.* 命名，并把 jobId 放到详情里：
    //   读取任务输出 · pwsh-b503d189e7a3406e
    const jobLabel: string = ConversationFeed.jobToolLabel(trimmed);
    if (jobLabel.length > 0) {
      const jobId: string = ConversationFeed.field(fields, ['job_id', 'jobId', 'job', 'id']);
      return {
        label: jobLabel, detail: jobId, genericTool: false, isCommand: false, commandText: '', cwdLabel: ''
      };
    }
    if (kind === 'commands') {
      face.label = '运行命令';
    } else if (kind === 'read' || kind === 'readImage') {
      face.label = '读取';
    } else if (kind === 'write') {
      face.label = '写入';
    } else if (kind === 'edit') {
      face.label = '编辑';
    } else if (kind === 'search' || kind === 'webSearch') {
      face.label = '搜索';
    } else if (kind === 'webFetch') {
      face.label = '读取网页';
    } else if (kind === 'code') {
      face.label = '代码';
    } else {
      // 未识别到具体动作的工具（ops_stat / ops_edit_file 等）：左侧标签固定为「工具调用」，
      // 工具名放到右侧详情里（对齐桌面端显示为「工具调用  ops_stat · <路径>」）。
      // 之前这里直接把工具名当标签，手机端就只剩「ops_stat · 路径」，前面的汉字没了。
      face.label = '工具调用';
      face.genericTool = true;
    }
    face.isCommand = kind === 'commands';
    const description: string = ConversationFeed.field(fields, ['description', 'title']);
    const command: string = ConversationFeed.field(fields, ['command', 'cmd', 'text', 'chars']);
    const path: string = ConversationFeed.field(fields, ['path', 'file_path', 'filePath', 'filename', 'file']);
    const query: string = ConversationFeed.field(fields, ['query', 'pattern', 'search', 'regex']);
    const url: string = ConversationFeed.field(fields, ['url']);
    let detail: string = description;
  if (detail.length === 0) {
      if (kind === 'commands') {
        detail = command;
      } else if (kind === 'search') {
        const pieces: string[] = [];
        if (query.length > 0) {
          pieces.push(query);
        }
        if (path.length > 0) {
          pieces.push(path);
        }
        detail = pieces.join(' · ');
      } else if (kind === 'webFetch' || kind === 'webSearch') {
        detail = url;
      } else if (kind === 'code') {
        // 对齐小程序 tool-presentation.js：run_code 的 detail 取 description，退而取 code 首行
        const code: string = ConversationFeed.field(fields, ['code', 'script', 'source']);
        detail = description.length > 0 ? description : code;
      } else {
        detail = path.length > 0 ? path : (command.length > 0 ? command : (query.length > 0 ? query : url));
      }
    }
    // 通用工具：把工具名拼到详情最前面，标签仍保留「工具调用」
    if (face.genericTool && detail.length > 0 && trimmed.length > 0) {
      detail = trimmed + ' · ' + detail;
    } else if (face.genericTool && detail.length === 0 && trimmed.length > 0) {
      detail = trimmed;
    }
    const firstLine: string = detail.split('\n')[0].trim();
    face.detail = firstLine.length > 600 ? firstLine.substring(0, 600) : firstLine;
    face.commandText = face.isCommand ? command : '';
    const cwd: string = ConversationFeed.field(fields, ['workdir', 'cwd', 'workingDirectory', 'working_directory']);
    if (cwd.length > 0) {
      const parts: string[] = cwd.replace(/[\\/]+$/, '').split(/[\\/]/);
      face.cwdLabel = parts.length > 0 ? parts[parts.length - 1] : cwd;
    }
    return face;
  }

  private static parseFields(raw: string): Record<string, string> {
    const fields: Record<string, string> = {};
    const text: string = raw.trim();
    if (text.length === 0 || text.charAt(0) !== '{') {
      return fields;
    }
    try {
      const parsed: Object = JSON.parse(text) as Object;
      const record: Record<string, Object> = parsed as Record<string, Object>;
      for (const key of Object.keys(record)) {
        const value: Object = record[key];
        if (typeof value === 'string') {
          fields[key] = value as string;
        }
      }
    } catch (err) {
      return fields;
    }
    return fields;
  }

  private static field(fields: Record<string, string>, keys: string[]): string {
    for (const key of keys) {
      const value: string = fields[key];
      if (value !== undefined && value.trim().length > 0) {
        return value;
      }
    }
    return '';
  }

  /** 过程组标题：按子内容命名（对齐小程序 processActivityTitle）。 */
  static activityTitle(kinds: string[]): string {
    const order: string[] = [];
    const counts: number[] = [];
    for (const kind of kinds) {
      const index: number = order.indexOf(kind);
      if (index >= 0) {
        counts[index] = counts[index] + 1;
      } else {
        order.push(kind);
        counts.push(1);
      }
    }
    if (order.length === 0) {
      return ToolActivity.label('thinking');
    }
    const labels: string[] = [];
    const limit: number = order.length < 3 ? order.length : 3;
    for (let index = 0; index < limit; index++) {
      labels.push(ToolActivity.label(order[index]));
    }
    if (labels.length === 1) {
      return labels[0];
    }
    if (labels.length === 2) {
      const prefix: string = '已';
      let second: string = labels[1];
      if (labels[0].startsWith(prefix) && second.startsWith(prefix)) {
        second = second.substring(prefix.length);
      }
      return labels[0] + '并' + second;
    }
    let joined: string = labels[0];
    for (let index = 1; index < labels.length; index++) {
      joined = joined + '，' + labels[index];
    }
    return order.length > 3 ? joined + '等' : joined;
  }

  static durationLabel(seconds: number): string {
    const total: number = Math.max(0, Math.round(seconds));
    if (total >= 60) {
      return Math.floor(total / 60).toString() + ' 分钟 ' + (total % 60).toString() + ' 秒';
    }
    return total.toString() + ' 秒';
  }

  /** 回复页脚的「用时」文案：用时 5 分 19 秒 / 用时 42 秒 / 用时 1 小时 5 分 */
  static elapsedLabel(seconds: number): string {
    const total: number = Math.max(0, Math.round(seconds));
    if (total >= 3600) {
      return '用时 ' + Math.floor(total / 3600).toString() + ' 小时 ' + Math.floor((total % 3600) / 60).toString() + ' 分';
    }
    if (total >= 60) {
      return '用时 ' + Math.floor(total / 60).toString() + ' 分 ' + (total % 60).toString() + ' 秒';
    }
    return '用时 ' + total.toString() + ' 秒';
  }

  /**
   * 把投影条目折叠成显示行。
   * 小程序口径：过程组按自身内容命名；回合收工后同一回合的多个过程组收拢成「已完成」行。
   */
  static build(items: ConversationItem[], running: boolean): ConversationFeedEntry[] {
    const groups: ConversationFeedEntry[] = [];
    let open: ConversationFeedEntry | null = null;
    let lastUserEpoch: number = 0;
    // 工具结果里的图片（如 read_image 输出）先缓存，挂到随后的助手回复行上显示
    const pendingToolImages: GatewayImageAttachment[] = [];
    // 「已编辑文件」行缓冲到本轮结尾再插入：投影里它出现在最终回复之前，
    // 直接 push 会变成卡片在回复上方（还被吸底挤出屏幕），用户看不到。
    const pendingFiles: ConversationFeedEntry[] = [];
    // 标记哪些工具步骤下面还有子步骤（对齐小程序：有子过程的父行只显示名称，不带「运行」）
    const parents: Set<string> = new Set<string>();
    for (const one of items) {
      const parentCall: string = one.parentCallId === undefined ? '' : one.parentCallId;
      if (parentCall.length > 0) {
        parents.add(parentCall);
      }
    }
    for (const one of items) {
      const call: string = one.callId === undefined ? '' : one.callId;
      if (call.length > 0 && parents.has(call)) {
        one.hasChildren = true;
      }
    }
    for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
      const item: ConversationItem = items[itemIndex];
      const kind: string = item.kind as string;
      // 工具结果里的图片先攒着，等本轮助手回复行建出来再挂上去（否则只存在于过程组里，没人渲染）
      if ((kind === ConversationItemKind.TOOL_RESULT as string || kind === ConversationItemKind.TOOL as string
        || kind === ConversationItemKind.JSON_TOOL as string) && item.images !== undefined
        && item.images.length > 0) {
        for (const one of item.images) {
          pendingToolImages.push(one as GatewayImageAttachment);
        }
      }
      if (kind === ConversationItemKind.USER as string) {
        // 新一轮开始前，把上一轮缓冲的「已编辑文件」行落位
        for (const pending of pendingFiles) {
          groups.push(pending);
        }
        pendingFiles.length = 0;
        lastUserEpoch = item.epochSeconds;
      }
      if (ConversationFeed.isProcessKind(kind)) {
        // 按 turn 隔离过程组：同一轮里的步骤才并进同一个「执行图标」行。
        // 之前只按「遇到非过程行就关组」切分：从电脑端在同一会话里发消息时，
        // 手机端可能先收到 tool/call 而没收到那条用户气泡，工具行就会续接进上一轮的过程组，
        // 看起来像新回合跑到了上一次运行里。
        const itemTurn: string = item.turn === undefined ? '' : item.turn.toString();
        if (open !== null) {
          if (itemTurn.length > 0 && open.turnKey.length > 0 && open.turnKey !== itemTurn) {
            // 已知轮次发生变化：新一轮另起一组
            open = null;
          } else if (itemTurn.length > 0 && open.turnKey.length === 0) {
            // 组创建时轮次未知，现在知道了就补齐（不拆组，否则同一轮出现两组、界面闪跳）
            open.turnKey = itemTurn;
          }
        }
        if (open === null) {
          open = ConversationFeed.newProcessGroup(item);
          groups.push(open);
        }
        ConversationFeed.appendToGroup(open, item);
        continue;
        // 注：title 为 'tool' 的包装事件已在投影层忽略，这里不需要再过滤
      }
      // 叙述（助手正文）永远不进过程组：它是阅读内容，独立成行、原位显示，永不折叠
      //（对齐 dsh-interactive-reader：narration is never process content and never folds）。
      // 叙述同时把本轮切成多个过程组：遇到叙述就关组，后面的步骤另起新组。
      // 以前「后面还有助手正文」的叙述会被塞进当前组，组一折叠它就跟着消失 ——
      // 这就是「运行工具之间的一些描述直接不显示」。
      // 叙述身份（过程叙述 / 最终答复）由 bodyPhase 单独标记，只决定复制/引用/用量行归谁。
      open = null;
      if (kind === ConversationItemKind.STATUS as string) {
        const group: ConversationFeedEntry = ConversationFeed.newProcessGroup(item);
        ConversationFeed.appendToGroup(group, item);
        groups.push(group);
        continue;
      }
      if (kind === ConversationItemKind.CHANGES as string || kind === ConversationItemKind.FILES as string) {
        const filesEntry: ConversationFeedEntry = new ConversationFeedEntry();
        filesEntry.id = 'files-' + item.id;
        filesEntry.kind = kind;
        filesEntry.title = item.title;
        filesEntry.epochSeconds = item.epochSeconds;
        filesEntry.turnKey = item.turn === undefined ? '' : item.turn.toString();
        filesEntry.files = item.files === undefined ? [] : item.files;
        filesEntry.changeSeq = item.changeSeq === undefined ? 0 : item.changeSeq;
        pendingFiles.push(filesEntry);
        continue;
      }
      const message: ConversationFeedEntry = new ConversationFeedEntry();
      message.id = 'message-' + item.id;
      message.kind = kind;
      message.title = item.title;
      message.text = item.text;
      message.isError = item.isError === true;
      if (message.isError) {
        message.failureTitle = ConversationFeed.humanizeFailure(item.title + ' ' + item.text);
        message.failureCode = item.failureCode === undefined ? '' : item.failureCode;
      }
      // turn/end 一到就立刻把流式行收口（对齐小程序 turn/end：row.streaming=false、标题清空）。
      // 否则 assistant/message 稍晚或丢失时，界面会一直显示「正在生成」，看起来回合结束不即时。
      if (kind === ConversationItemKind.ASSISTANT as string) {
        message.bodyPhase = ConversationFeed.bodyPhaseOf(items, itemIndex, item.turn, running);
      }
      const holdingStream: boolean = item.title === ConversationFeed.streamingAssistantTitle;
      message.streaming = holdingStream && running;
      if (holdingStream && !running) {
        message.title = '';
      }
      message.epochSeconds = item.epochSeconds;
      // 图片既可能来自 images 块，也可能是 mediaType=image/* 的文件附件（手机上传照片即属后者）：
      // 统一挑出来走图片网格，其余留在文件 chip 列表。
      const imgs: GatewayImageAttachment[] = item.images === undefined
        ? [] : (item.images as GatewayImageAttachment[]);
      const filesAll: GatewayFileAttachment[] = item.attachments === undefined
        ? [] : (item.attachments as GatewayFileAttachment[]);
      const filesRest: GatewayFileAttachment[] = [];
      for (const att of filesAll) {
        const mt: string = att.mediaType === undefined ? '' : att.mediaType;
        const aid: string = att.attachmentId === undefined ? '' : att.attachmentId;
        // 图片判定：mediaType 优先；网关有时只给文件名（上传回执路径），按扩展名兜底
        // （对齐小程序 file-deliverables 的 classify/iconFileFor：附件类型靠扩展名识别）
        const looksImage: boolean = mt.startsWith('image/') || ConversationFeed.imageName(att.name);
        if (looksImage && aid.length > 0) {
          let dup: boolean = false;
          for (const one of imgs) {
            if (one.attachmentId === aid) {
              dup = true;
            }
          }
          if (!dup) {
            imgs.push({
              attachmentId: aid,
              mediaType: mt,
              bytes: att.bytes === undefined ? 0 : att.bytes,
              width: 0,
              height: 0,
              name: att.name
            });
          }
        } else {
          filesRest.push(att);
        }
      }
      // 工具产出的图片只有「回复正文真正用 Markdown 引用了」才收集：
      // 否则每个调用过 read_image / 截图工具的回合都会在末尾多出一张图（用户明确不要）。
      if (kind === ConversationItemKind.ASSISTANT as string && pendingToolImages.length > 0) {
        for (const pending of pendingToolImages) {
          const pendingName: string = pending.name === undefined ? '' : pending.name;
          if (!ConversationFeed.referencedInText(item.text, pendingName)) {
            continue;
          }
          let dup: boolean = false;
          for (const one of imgs) {
            if (one.attachmentId === pending.attachmentId) {
              dup = true;
            }
          }
          if (!dup) {
            imgs.push(pending);
          }
        }
        pendingToolImages.length = 0;
      }
      // 正文 Markdown 里以文件名引用了哪些图（如 ![…](/tmp/style_mock2.png)）：
      // 这些图要在正文对应位置内联渲染，行尾图片网格不再重复显示。
      const inlineIds: string[] = [];
      for (const one of imgs) {
        const imageName: string = one.name === undefined ? '' : one.name;
        if (ConversationFeed.referencedInText(item.text, imageName)) {
          inlineIds.push(one.attachmentId);
        }
      }
      message.inlineImageIds = inlineIds;
      message.images = imgs;
      message.imageCount = imgs.length;
      message.localImages = item.localImagePaths === undefined ? [] : item.localImagePaths.slice();
      message.attachments = filesRest;
      message.turnKey = item.turn === undefined ? '' : item.turn.toString();
      groups.push(message);
    }
    for (const pending of pendingFiles) {
      groups.push(pending);
    }
    pendingFiles.length = 0;
    // 未在正文引用的工具图片直接丢弃（不追加到回复末尾）
    pendingToolImages.length = 0;
    ConversationFeed.finishGroups(groups, running, lastUserEpoch);
    ConversationFeed.applyCopyRules(groups);
    ConversationFeed.applyTurnFooters(groups);
    // 「已编辑文件」卡片固定放在整轮最后一行：回复正文之后、输入框上方。
    // （投影里它产生在最终回复之前，若按原序渲染会跑到回复上方并被吸底顶出屏幕。）
    const filesRows: ConversationFeedEntry[] = [];
    const rest: ConversationFeedEntry[] = [];
    // 当前正在跑的这轮先不显示卡片：否则会在「执行图标行」和鲸尾行之间冒出来。
    // 等这轮结束（running=false）后，卡片才落到回复正文之后、输入框上方。
    let lastProcessTurn: string = '';
    for (const entry of groups) {
      if (entry.kind === 'PROCESS' && entry.turnKey.length > 0) {
        lastProcessTurn = entry.turnKey;
      }
    }
    for (const entry of groups) {
      if (entry.kind === 'CHANGES' || entry.kind === 'FILES') {
        if (running && lastProcessTurn.length > 0 && entry.turnKey === lastProcessTurn) {
          continue;
        }
        filesRows.push(entry);
      } else {
        rest.push(entry);
      }
    }
    for (const entry of filesRows) {
      rest.push(entry);
    }
    return rest;
  }

  /**
   * 失败码 → 人话（对齐 DSH 客户端 FAILURE_COPY：只对少数已知码特殊处理，其余给通用文案）。
   */
  /** 正文里是否有 ![](…/name) 这种 Markdown 图片引用（按文件名精确匹配，避免“正文提到文件名”就误判）。 */
  static referencedInText(text: string, name: string): boolean {
    if (name.length === 0 || text.length === 0) {
      return false;
    }
    let from: number = 0;
    while (true) {
      const at: number = text.indexOf('](', from);
      if (at < 0) {
        return false;
      }
      const close: number = text.indexOf(')', at + 2);
      if (close < 0) {
        return false;
      }
      const src: string = text.substring(at + 2, close).trim();
      const base: string = src.split('/').pop() ?? '';
      if (base === name) {
        return true;
      }
      from = close + 1;
    }
  }

  /** 文件名是否是图片扩展名（jpg/jpeg/png/gif/webp/heic/bmp）。 */
  static imageName(name: string): boolean {
    const lower: string = name.toLowerCase();
    const dot: number = lower.lastIndexOf('.');
    if (dot < 0) {
      return false;
    }
    const ext: string = lower.substring(dot + 1);
    return ext === 'jpg' || ext === 'jpeg' || ext === 'png' || ext === 'gif'
      || ext === 'webp' || ext === 'heic' || ext === 'bmp';
  }

  static humanizeFailure(raw: string): string {
    const text: string = raw.toLowerCase();
    if (text.indexOf('version-conflict') >= 0 || text.indexOf('version conflict') >= 0) {
      return '客户端与网关版本不一致，请更新后重试';
    }
    if (text.indexOf('note-too-large') >= 0) {
      return '内容过长，无法保存';
    }
    if (text.indexOf('rate limit') >= 0 || text.indexOf('rate_limit') >= 0 || text.indexOf('429') >= 0
      || text.indexOf('too many requests') >= 0) {
      return '请求过于频繁，请稍后重试';
    }
    if (text.indexOf('max_tokens') >= 0 || text.indexOf('context length') >= 0
      || text.indexOf('context_length') >= 0 || text.indexOf('overflow') >= 0) {
      return '上下文超出模型上限，请压缩后重试';
    }
    if (text.indexOf('timeout') >= 0 || text.indexOf('timed out') >= 0) {
      return '请求超时，请重试';
    }
    if (text.indexOf('network') >= 0 || text.indexOf('econnreset') >= 0 || text.indexOf('fetch failed') >= 0) {
      return '网络连接中断，请重试';
    }
    if (text.indexOf('401') >= 0 || text.indexOf('unauthorized') >= 0 || text.indexOf('auth') >= 0) {
      return '认证失效，请重新配对';
    }
    return '本次回答失败，请重试';
  }

  private static newProcessGroup(item: ConversationItem): ConversationFeedEntry {
    const group: ConversationFeedEntry = new ConversationFeedEntry();
    group.id = 'process-' + item.id;
    group.kind = 'PROCESS';
    group.epochSeconds = item.epochSeconds;
    group.turnKey = item.turn === undefined ? '' : item.turn.toString();
    return group;
  }

  private static appendToGroup(group: ConversationFeedEntry, item: ConversationItem): void {
    group.items.push(item);
    if (item.epochSeconds > group.epochSeconds) {
      group.epochSeconds = item.epochSeconds;
    }
    // 工具失败只影响该步骤（红色「失败」），不把整个过程组标成失败——
    // 小程序里组标题仍是「已完成」，只有回合真正失败才是红标题。
    const kind: string = item.kind as string;
    if (kind === ConversationItemKind.CONTEXT as string) {
      group.contextCount = group.contextCount + 1;
    } else if (kind === ConversationItemKind.TOOL as string || kind === ConversationItemKind.JSON_TOOL as string) {
      group.toolCount = group.toolCount + 1;
    } else if (kind === ConversationItemKind.TOOL_RESULT as string) {
      // 结果行不重复计数
    }
  }

  /** 计算每个过程组的标题、摘要、展开能力与运行状态。 */
  private static finishGroups(entries: ConversationFeedEntry[], running: boolean, lastUserEpoch: number): void {
    let activeGroups: number = 0;
    for (const entry of entries) {
      if (entry.kind === 'PROCESS' && entry.running) {
        activeGroups = activeGroups + 1;
      }
    }
    for (const entry of entries) {
      if (entry.kind !== 'PROCESS') {
        continue;
      }
      const kinds: string[] = [];
      let started: number = 0;
      let ended: number = 0;
      let hasCommand: boolean = false;
      for (const item of entry.items) {
        const kind: string = item.kind as string;
        if (kind === ConversationItemKind.TOOL as string || kind === ConversationItemKind.JSON_TOOL as string) {
          kinds.push(ToolActivity.kind(item.title));
        } else if (kind === ConversationItemKind.STATUS as string) {
          hasCommand = true;
        }
        if (started === 0 || item.epochSeconds < started) {
          started = item.epochSeconds;
        }
        if (item.epochSeconds > ended) {
          ended = item.epochSeconds;
        }
      }
      entry.expandable = entry.items.length > 0;
      entry.running = false;
      entry.activityKind = kinds.length > 0 ? kinds[0] : (hasCommand ? 'commands' : 'thinking');
      entry.activityTitle = hasCommand && kinds.length === 0
        ? ConversationFeed.commandTitle(entry) : ConversationFeed.activityTitle(kinds);
      // 顶层组标题按状态命名（对齐小程序：已收工的组统一叫「已完成」）；回合收拢后换回活动命名。
      entry.title = '已完成';
      if (entry.toolCount > 0) {
        entry.summary = entry.toolCount.toString() + ' 次工具调用';
      }
      if (entry.contextCount > 0) {
        entry.summary = entry.summary.length > 0
          ? entry.summary + ' · ' + entry.contextCount.toString() + ' 项上下文'
          : entry.contextCount.toString() + ' 项上下文';
      }
      if (ended > started && ended - started >= 1) {
        // 用时只记在 durationText 上：过程组行（执行图标那行）不再显示用时，
        // 回合折叠行（「已完成」那行）仍然用它显示「用时 X」。
        entry.durationText = ConversationFeed.durationLabel(ended - started);
      }
      entry.text = entry.summary;
      entry.epochSeconds = ended;
    }
    // 只有最后一条过程组属于"当前活动"，其余视为已收工。
    for (let index = entries.length - 1; index >= 0; index--) {
      const entry: ConversationFeedEntry = entries[index];
      if (entry.kind === 'USER') {
        break;
      }
      if (entry.kind !== 'PROCESS') {
        continue;
      }
      if (running) {
        entry.running = true;
        entry.title = ConversationFeed.runningTitle(entry);
        entry.activityKind = ConversationFeed.runningActivityKind(entry);
        break;
      }
    }
  }

  /**
   * 按工作步骤展示偏好收拢已完成回合（对齐小程序 work-step-presentation.apply）。
   * - verbose（完全展开）不收拢，过程组逐组显示；
   * - compact / standard 只保留汇总行，不挂分段明细；
   * - timing=next-input 时只收拢后面已经出现新用户消息的回合。
   */
  static applyWorkStepPolicy(entries: ConversationFeedEntry[], mode: string, timing: string,
    folds: Map<string, boolean> = new Map<string, boolean>(), conversationRunning: boolean = false): void {
    const policy: WorkStepPolicy = WorkStepPresentation.policy(mode);
    const normalizedMode: string = WorkStepPresentation.normalizeMode(mode);
    const processRunning: boolean = ConversationFeed.hasRunningGroup(entries);
    // 运行中的过程组：liveProcessDetail 开启时标题后追加细节（对齐 DSH ProcessGroupHeader）
    if (policy.liveProcessDetail) {
      for (const entry of entries) {
        if (entry.kind === 'PROCESS' && entry.running) {
          entry.liveDetail = ConversationFeed.liveDetail(entry);
        }
      }
    }
    const lastUserIndex: number = ConversationFeed.lastUserRowIndex(entries);
    const groupIndices: number[] = [];
    for (let index = 0; index < entries.length; index++) {
      if (entries[index].kind === 'PROCESS') {
        groupIndices.push(index);
      }
    }
    const lastGroupIndex: number = groupIndices.length > 0 ? groupIndices[groupIndices.length - 1] : -1;
    // 先按档位处理「回合收工折叠」，再逐组套展示策略（对齐小程序 apply 的两段结构）
    if (policy.foldCompletedTurns) {
      ConversationFeed.mergeSettledTurn(entries, timing === 'next-input', processRunning || conversationRunning);
    }
    for (let index = 0; index < entries.length; index++) {
      const entry: ConversationFeedEntry = entries[index];
      // 回合收拢行：内部各过程组同样要套策略（展开「已完成」时逐组显示）
      if (entry.kind === 'TURN') {
        // 失败/中断的回合不折叠（对齐小程序 turnProcess.alwaysOpen）
        entry.foldable = !entry.isError;
        entry.expanded = entry.foldable ? ConversationFeed.foldOf(folds, entry.id, false) : true;
        for (const child of entry.children) {
          // 详细档：回合展开时各组默认跟着展开（对齐 openInExpandedTurn），
          // 用户点过就以用户的折叠状态为准。
          ConversationFeed.applyGroupPolicy(child, policy, normalizedMode, timing, false,
            ConversationFeed.foldOf(folds, child.id, policy.readingSummary ? entry.expanded
              : (entry.expanded && policy.stepGrouping === 'history')),
            entry.expanded, processRunning);
        }
        continue;
      }
      if (entry.kind !== 'PROCESS') {
        continue;
      }
      const hasInputAfter: boolean = index < lastUserIndex;
      const deferred: boolean = timing === 'next-input' && !hasInputAfter && index === lastGroupIndex;
      ConversationFeed.applyGroupPolicy(entry, policy, normalizedMode, timing, deferred,
        ConversationFeed.foldOf(folds, entry.id, policy.readingSummary && entry.running),
        false, processRunning);
    }
    ConversationFeed.foldSettledGroupsOfRunningTurn(entries, policy, processRunning);
  }

  /**
   * 阅读档运行中：叙述把本轮切成多个过程组。「叙述一出现，它上面的过程就收起」——
   * 每个后面（同轮）紧跟叙述的过程组整组折成一条「思考×N · 工具×N」摘要，点开按原顺序回看。
   * 不看 running：本轮最后一个组即便还标着运行，只要叙述已经出现在它下面，它就已被隔开、该收起
   *（以前只折「非运行组」，最后一个组收不到；而 liveFoldCount 只折思考之前的，工具步骤仍摊着）。
   * 只含记录（没有思考/工具）的组不折，避免出现无意义的折叠条。回合结束后由 mergeSettledTurn 接手。
   */
  private static foldSettledGroupsOfRunningTurn(entries: ConversationFeedEntry[], policy: WorkStepPolicy,
    processRunning: boolean): void {
    if (!policy.readingSummary || !processRunning) {
      return;
    }
    for (let index = 0; index < entries.length; index++) {
      const entry: ConversationFeedEntry = entries[index];
      if (entry.kind !== 'PROCESS' || entry.items.length === 0) {
        continue;
      }
      // 组后面、同轮内是否出现叙述正文（遇到 USER / 不同轮次即止）
      let narrationAfter: boolean = false;
      for (let probe = index + 1; probe < entries.length; probe++) {
        const next: ConversationFeedEntry = entries[probe];
        if (next.kind === 'USER') {
          break;
        }
        if (entry.turnKey.length > 0 && next.turnKey.length > 0 && next.turnKey !== entry.turnKey) {
          break;
        }
        if (next.kind === ConversationItemKind.ASSISTANT as string && next.text.trim().length > 0) {
          narrationAfter = true;
          break;
        }
      }
      if (!narrationAfter) {
        continue;
      }
      let foldable: boolean = false;
      for (const item of entry.items) {
        const kind: string = item.kind as string;
        if (kind === ConversationItemKind.REASONING as string || kind === ConversationItemKind.TOOL as string
          || kind === ConversationItemKind.JSON_TOOL as string) {
          foldable = true;
          break;
        }
      }
      if (!foldable) {
        continue;
      }
      entry.liveFoldSettled = true;
      entry.liveFoldCount = entry.items.length;
      // 组体保持可见（展开时由 displayItems 决定显示全部还是空），阅读档不渲染组头
      entry.expanded = true;
      entry.processBodyVisible = true;
    }
  }

  private static foldOf(folds: Map<string, boolean>, id: string, fallback: boolean): boolean {
    const value: boolean | undefined = folds.get(id);
    return value === undefined ? fallback : value;
  }

  /** 单个过程组套展示策略（回合内的子组与顶层组共用同一套规则）。 */
  private static applyGroupPolicy(entry: ConversationFeedEntry, policy: WorkStepPolicy,
    mode: string, timing: string, deferred: boolean, expanded: boolean, turnOpen: boolean,
    processRunning: boolean): void {
    const grouped: boolean = policy.stepGrouping === 'collapsed'
      || (policy.stepGrouping === 'history' && entry.turnClosed && !deferred);
    const verbose: boolean = policy.stepGrouping === 'none';
    // 组体一可见就限高：分组模式点开时、详细档对话过程中都要限高；完全展开不设上限
    // 运行中同样限高：组体始终待在那个容器里（内层小滚动并自动跟随最新一步），
    // 之前放开限高后，运行中的步骤会脱离容器直接铺满整页，行多了还要不停往上翻。
    const capWhenOpen: boolean = grouped
      || (policy.stepGrouping === 'history' && (entry.running || expanded));
    entry.processGrouped = grouped;
    entry.expanded = expanded;
    // 只有「对话过程中不分组」的详细档才自动铺开组体（对齐小程序 processAutoOpen = !grouped && !verbose）。
    // 简洁/标准恒分组：运行中也只留一行组标题（标准带实时细节），点开才看步骤。
    entry.processAutoOpen = !grouped && !verbose && policy.stepGrouping === 'history';
    if (policy.readingSummary) {
      // 阅读档：过程正文的展开/收起完全由用户点箭头控制（运行中也能实时折叠）
      entry.processAutoOpen = false;
    }
    // 完全展开（stepGrouping=none）永不收起：没有组标题，过程直接平铺
    entry.processBodyVisible = verbose || expanded || entry.processAutoOpen;
    // 运行中/展开时都套限高容器（原始结构）；思考卡保持卡片样式在容器内滚动。
    entry.processBodyCapped = entry.processBodyVisible ? capWhenOpen : (grouped && timing !== 'next-input');
    entry.liveDetail = policy.liveProcessDetail && entry.running
      ? ConversationFeed.liveDetail(entry) : '';
    // 阅读档（对齐 dsh-interactive-reader 的 live chain）：
    // 「新的思考出现」= 上一段链条结束，把该点之前的步骤收进折叠条，
    // 容器内只保留最新这段（从最后一次思考开始）的过程。
    entry.liveFoldCount = 0;
    entry.liveFoldSettled = false;
    if (policy.readingSummary && entry.running && entry.items.length > 1) {
      let lastReasoning: number = -1;
      for (let index = 0; index < entry.items.length; index++) {
        if (entry.items[index].kind === ConversationItemKind.REASONING) {
          lastReasoning = index;
        }
      }
      if (lastReasoning > 0) {
        entry.liveFoldCount = lastReasoning;
      }
    }
    // 简洁档运行中：只留活动组那一行「正在…」，已收工组的标题也收起来
    entry.headingHidden = verbose || (mode === 'compact' && processRunning && entry.running !== true);
    // 简洁档：组标题不带「N 次工具调用 / N 项上下文」计数后缀
    if (mode === 'compact') {
      entry.summary = ConversationFeed.stripCountParts(entry.summary);
      entry.text = entry.summary;
    }
    entry.titleWrap = mode === 'compact';
    // 阅读档：折叠行带步骤计数摘要（运行中也显示），轮次结束后可点开回看
    if (policy.readingSummary && entry.running) {
      const steps: number = entry.items.length;
      entry.summary = entry.toolCount > 0
        ? entry.toolCount.toString() + ' 步'
        : (steps > 0 ? steps.toString() + ' 步' : '');
      entry.text = entry.summary;
    }
    // 详细档回合收工后：组标题回到活动命名（对齐小程序 insertTurnDisclosures 的 title 覆盖）
    if (turnOpen && entry.activityTitle.length > 0) {
      entry.title = entry.activityTitle;
    }
  }

  /** 最后一条用户消息的下标（其后为当前回合） */
  private static lastUserRowIndex(entries: ConversationFeedEntry[]): number {
    for (let index = entries.length - 1; index >= 0; index--) {
      if (entries[index].kind === 'USER') {
        return index;
      }
    }
    return -1;
  }

  private static hasRunningGroup(entries: ConversationFeedEntry[]): boolean {
    for (const entry of entries) {
      if (entry.kind === 'PROCESS' && entry.running) {
        return true;
      }
    }
    return false;
  }

  /** 去掉「N 次工具调用 / N 项上下文」这类纯计数片段（简洁档） */
  private static stripCountParts(summary: string): string {
    if (summary.length === 0) {
      return '';
    }
    const parts: string[] = summary.split(' · ');
    const kept: string[] = [];
    for (const raw of parts) {
      const part: string = raw.trim();
      if (part.length === 0) {
        continue;
      }
      if (ConversationFeed.isCountPart(part, ' 次工具调用') || ConversationFeed.isCountPart(part, ' 项上下文')) {
        continue;
      }
      kept.push(part);
    }
    return kept.join(' · ');
  }

  private static isCountPart(part: string, suffix: string): boolean {
    if (part.length <= suffix.length) {
      return false;
    }
    if (part.substring(part.length - suffix.length) !== suffix) {
      return false;
    }
    const head: string = part.substring(0, part.length - suffix.length).trim();
    if (head.length === 0) {
      return false;
    }
    for (let index = 0; index < head.length; index++) {
      const code: number = head.charCodeAt(index);
      if (code < 48 || code > 57) {
        return false;
      }
    }
    return true;
  }

  /**
   * 同一条目之后、同一回合内是否还有过程条目。
   * 只按「下一个用户消息」截断是不够的：从电脑端发消息、或该轮用户气泡被窗口截掉时，
   * items 里没有 USER 分隔，上一轮的最终答复就会被下一轮的过程行误判成「回合中段叙述」，
   * 折叠进「记录×N」里 —— 界面上就是「回复最后一段不见了」，退出重进（不折叠）才正常。
   * 这里再加上回合号约束：跨回合的行一律不算「后面还有过程」。
   */
  /** 同一回合内、本条之后是否还有别的助手正文（有 = 本条只是过程叙述）。 */
  /**
   * 助手正文身份：后面（同轮）还有助手正文或过程步骤 → 不是最终答复。
   *   · 回合已结束：能确定它是不是最终答复；
   *   · 回合运行中：后面还有步骤的正文已是过程叙述；最后一段正文身份未定，记为 pending，
   *     回合一结束重新投影即可定性。
   */
  private static bodyPhaseOf(items: ConversationItem[], from: number, turn: number | undefined, running: boolean): string {
    if (ConversationFeed.hasAssistantAheadInTurn(items, from, turn)) {
      return 'narration';
    }
    if (ConversationFeed.hasProcessAheadInTurn(items, from, turn)) {
      return running ? 'narration' : 'answer';
    }
    return running ? 'pending' : 'answer';
  }

  private static hasAssistantAheadInTurn(items: ConversationItem[], from: number, turn: number | undefined): boolean {
    for (let index = from + 1; index < items.length; index++) {
      const item: ConversationItem = items[index];
      const kind: string = item.kind as string;
      if (kind === ConversationItemKind.USER as string) {
        return false;
      }
      if (turn !== undefined && item.turn !== undefined && item.turn !== turn) {
        return false;
      }
      if (kind === ConversationItemKind.ASSISTANT as string && item.text.length > 0) {
        return true;
      }
    }
    return false;
  }

  private static hasProcessAheadInTurn(items: ConversationItem[], from: number, turn: number | undefined): boolean {
    for (let index = from + 1; index < items.length; index++) {
      const item: ConversationItem = items[index];
      const kind: string = item.kind as string;
      if (kind === ConversationItemKind.USER as string) {
        return false;
      }
      if (turn !== undefined && item.turn !== undefined && item.turn !== turn) {
        return false;
      }
      if (ConversationFeed.isProcessKind(kind)) {
        return true;
      }
    }
    return false;
  }

  /** 当前条目之后、下一个用户消息之前是否还有过程条目。 */
  private static hasProcessAhead(items: ConversationItem[], from: number): boolean {
    for (let index = from + 1; index < items.length; index++) {
      const kind: string = items[index].kind as string;
      if (kind === ConversationItemKind.USER as string) {
        return false;
      }
      if (ConversationFeed.isProcessKind(kind)) {
        return true;
      }
    }
    return false;
  }

  private static commandTitle(entry: ConversationFeedEntry): string {
    for (const item of entry.items) {
      if (item.kind === ConversationItemKind.STATUS as string) {
        const text: string = ConversationFeed.collapse(item.text);
        return text.length > 0 ? item.title + ' · ' + text : item.title;
      }
    }
    return '执行过程';
  }

  /** 运行中文案（对齐 DSH 客户端 message.stepProcess.*）。 */
  static runningActivityLabel(activity: string, preparing: boolean): string {
    const prefix: string = preparing ? '准备' : '正在';
    if (activity === 'read') {
      return prefix + '读取文件';
    }
    if (activity === 'readImage') {
      return prefix + '读取图片';
    }
    if (activity === 'write') {
      return prefix + '写入文件';
    }
    if (activity === 'search') {
      return prefix + '搜索代码';
    }
    if (activity === 'edit') {
      return prefix + '编辑文件';
    }
    if (activity === 'commands') {
      return prefix + '运行命令';
    }
    if (activity === 'code') {
      return prefix + '运行代码';
    }
    if (activity === 'webSearch') {
      return prefix + '搜索网页';
    }
    if (activity === 'webFetch') {
      return prefix + '访问网页';
    }
    if (activity === 'subagents') {
      return prefix + '协调子智能体';
    }
    if (activity === 'plan') {
      return prefix + '更新计划';
    }
    if (activity === 'questions') {
      return preparing ? '准备提问' : '等待你的操作';
    }
    if (activity === 'tools') {
      return prefix + '调用工具';
    }
    return preparing ? '准备调用工具' : '正在分析请求';
  }

  /** 运行中细节：读取的文件路径 / 执行的命令（对齐 DSH liveProcessDetail）。 */
  static liveDetail(entry: ConversationFeedEntry): string {
    for (let index = entry.items.length - 1; index >= 0; index--) {
      const item: ConversationItem = entry.items[index];
      const kind: string = item.kind as string;
      if (kind === ConversationItemKind.TOOL as string || kind === ConversationItemKind.JSON_TOOL as string) {
        return ConversationFeed.toolFace(item.title, item.text).detail;
      }
    }
    return '';
  }

  /** 运行中活动分类（取最后一条工具调用）。 */
  static runningActivityKind(entry: ConversationFeedEntry): string {
    for (let index = entry.items.length - 1; index >= 0; index--) {
      const item: ConversationItem = entry.items[index];
      const kind: string = item.kind as string;
      if (kind === ConversationItemKind.TOOL as string || kind === ConversationItemKind.JSON_TOOL as string) {
        return ToolActivity.kind(item.title);
      }
      if (kind === ConversationItemKind.STATUS as string) {
        return 'commands';
      }
      if (kind === ConversationItemKind.REASONING as string) {
        return 'thinking';
      }
    }
    return 'thinking';
  }

  private static runningTitle(entry: ConversationFeedEntry): string {
    for (let index = entry.items.length - 1; index >= 0; index--) {
      const item: ConversationItem = entry.items[index];
      const kind: string = item.kind as string;
      if (kind === ConversationItemKind.TOOL as string || kind === ConversationItemKind.JSON_TOOL as string) {
        return ConversationFeed.runningActivityLabel(ToolActivity.kind(item.title), item.text.length === 0);
      }
      if (kind === ConversationItemKind.STATUS as string) {
        return ConversationFeed.runningActivityLabel('commands', false);
      }
      if (kind === ConversationItemKind.TOOL_RESULT as string) {
        return ConversationFeed.runningActivityLabel('tools', false);
      }
      if (kind === ConversationItemKind.REASONING as string) {
        return ConversationFeed.runningActivityLabel('thinking', false);
      }
      if (kind === ConversationItemKind.CONTEXT as string) {
        return ConversationFeed.runningActivityLabel('thinking', false);
      }
    }
    return ConversationFeed.runningActivityLabel('thinking', false);
  }

  /** 回合收工：连续已收工的过程组折叠成一条「已完成」行。 */
  private static mergeSettledTurn(entries: ConversationFeedEntry[],
    waitForNextInput: boolean = false, conversationRunning: boolean = false): void {
    const merged: ConversationFeedEntry[] = [];
    let index: number = 0;
    while (index < entries.length) {
      const entry: ConversationFeedEntry = entries[index];
      // 刚有进展的组不折叠：避免「执行过程中冒出好几个已完成」。
      const nowSeconds: number = Math.floor(Date.now() / 1000);
      const isFresh: boolean = entry.epochSeconds > 0 && nowSeconds - entry.epochSeconds < 3;
      if (entry.kind !== 'PROCESS' || entry.running || isFresh) {
        merged.push(entry);
        index++;
        continue;
      }
      const run: ConversationFeedEntry[] = [entry];
      let scan: number = index + 1;
      while (scan < entries.length && entries[scan].kind === 'PROCESS' && !entries[scan].running) {
        // 只合并同一轮的连续过程组：不同轮次的过程组挨在一起时（中间没有用户气泡、
        // 比如电脑端发起的回合、或用户消息被识别成上下文注入），以前会把两轮折叠进
        // 同一条「已完成」行，展开后上一轮和这一轮的步骤全混在一起、看起来在乱跳。
        const nextTurn: string = entries[scan].turnKey;
        const groupTurn: string = entry.turnKey;
        if (nextTurn.length > 0 && groupTurn.length > 0 && nextTurn !== groupTurn) {
          break;
        }
        run.push(entries[scan]);
        scan++;
      }
      // 这一串过程组后面还有没有新的用户消息：有 = 回合确实收工了
      let hasUserAfter: boolean = false;
      for (let probe: number = scan; probe < entries.length; probe++) {
        if (entries[probe].kind === 'USER') {
          hasUserAfter = true;
          break;
        }
      }
      // 还在跑的这一轮不能折叠：收起时机=「回答结束后」时，以前会把「已经跑完但整轮还没结束」
      // 的过程组立刻折成一条「已完成」，于是运行中只剩最后一行「正在调用…」，
      // 思考、执行代码这些步骤全被吞进折叠行，要等回合结束才看得到。
      if (!hasUserAfter && (waitForNextInput || conversationRunning)) {
        for (const group of run) {
          merged.push(group);
        }
        index = scan;
        continue;
      }
      const turn: ConversationFeedEntry = new ConversationFeedEntry();
      turn.id = 'turn-' + entry.id;
      turn.kind = 'TURN';
      // 回合行标题沿用最后一个组的状态标题（已完成 / 执行失败），摘要只放用时，
      // 工具次数挪到展开后的 expandedSummary（对齐小程序 turnProcess 行）。
      turn.title = run[run.length - 1].title;
      turn.isError = run.some((group: ConversationFeedEntry) => group.isError);
      // AI 生成内容标识挂在每轮第一条助手侧行上；过程组被折进回合行后，标记要带到回合行上，否则标识会丢
      turn.aiLabelVisible = run.some((group: ConversationFeedEntry) => group.aiLabelVisible);
      turn.expandable = run.some((group: ConversationFeedEntry) => group.expandable);
      turn.epochSeconds = run[run.length - 1].epochSeconds;
      turn.turnKey = entry.turnKey;
      let tools: number = 0;
      let contexts: number = 0;
      let duration: string = '';
      for (const group of run) {
        if (group.durationText.length > 0) {
          duration = '用时 ' + group.durationText;
        }
      }
      for (const group of run) {
        // 这些组所属回合已收工（决定 detailed 档是否折叠成标题）
        group.turnClosed = true;
        // AI 生成标识已经提升到回合行（上面 turn.aiLabelVisible = run.some(...)），
        // 展开回合时这些子组会作为同级行重新渲染，不能再各带一次标识，否则会出现两条
        group.aiLabelVisible = false;
        turn.childIds.push(group.id);
        // 回合内各组：标题回到活动命名，摘要去掉用时（用时归回合行）。
        // 四档都保留这些组：收起「已完成」时整轮折成一行，展开后逐组显示。
        if (group.activityTitle.length > 0) {
          group.title = group.activityTitle;
        }
        const kept: string[] = [];
        for (const part of group.summary.split(' · ')) {
          if (part.length > 0 && part.indexOf('用时 ') !== 0) {
            kept.push(part);
          }
        }
        if (kept.length === 0 && group.toolCount > 0) {
          kept.push(group.toolCount.toString() + ' 次工具调用');
        }
        group.summary = kept.join(' · ');
        group.text = group.summary;
        turn.children.push(group);
        tools = tools + group.toolCount;
        contexts = contexts + group.contextCount;
        turn.items = turn.items.concat(group.items);
      }
      turn.toolCount = tools;
      turn.contextCount = contexts;
      turn.summary = duration;
      turn.expandedSummary = tools > 0 ? tools.toString() + ' 次工具调用' : '';
      turn.text = duration;
      merged.push(turn);
      index = scan;
    }
    entries.length = 0;
    for (const entry of merged) {
      entries.push(entry);
    }
  }

  /**
   * 回合页脚：**每条已完成的正式回复**下面都挂复制 / 用量 / 时间（对齐小程序 turn-footer：
   * 小程序按「回合分组」给每组最后一条挂页脚，这里每条助手回复本身就是一行的结束）。
   */
  static applyTurnFooters(entries: ConversationFeedEntry[]): void {
    let turnStartEpoch: number = 0;
    // AI 生成内容显式标识：每轮（用户消息之后）第一条助手侧的行挂标识；
    // 列表开头直接是助手行（历史被截断）时也要标。
    let awaitingAiLead: boolean = true;
    for (const entry of entries) {
      if (entry.kind === ConversationItemKind.USER as string) {
        if (entry.epochSeconds > 0) {
          turnStartEpoch = entry.epochSeconds;
        }
        awaitingAiLead = true;
        continue;
      }
      // 助手侧会显示模型文字的行：回合组 / 过程行 / 正式回复（文件卡片、状态、系统行不算）
      if (entry.kind === ConversationItemKind.ASSISTANT as string || entry.kind === 'TURN' || entry.kind === 'PROCESS') {
        entry.aiLabelVisible = awaitingAiLead;
        awaitingAiLead = false;
      }
      if (entry.kind !== ConversationItemKind.ASSISTANT as string) {
        continue;
      }
      // 页脚（复制 / 引用 / 用量 / 时间）只挂在最终答复上（对齐 dsh-interactive-reader：
      // copy/fork 只留在 final answer）。过程叙述（narration）和运行中身份未定的末段（pending）不挂，
      // 否则一段叙述一行按钮，整轮看起来很啰嗦。空回复（只有图片/附件）仍挂（有时间可看）。
      if (entry.streaming || entry.bodyPhase !== 'answer') {
        continue;
      }
      entry.footerVisible = true;
      // turnMetaText（本轮用量）由会话页按 SessionStore 的每轮 token 统计填充，这里不猜
      entry.turnTimeText = ConversationFeed.clockText(entry.epochSeconds);
      // 本轮用时：用户消息时间 → 这条回复落地时间（对齐 iOS 回复页脚的「用时 X 分 Y 秒」）
      if (turnStartEpoch > 0 && entry.epochSeconds > turnStartEpoch) {
        entry.turnElapsedText = ConversationFeed.elapsedLabel(entry.epochSeconds - turnStartEpoch);
      }
    }
  }

  /** epoch 秒 → 本地 HH:MM（页脚时间，对齐小程序 turnTimeText）。 */
  private static clockText(epochSeconds: number): string {
    const date: Date = new Date(epochSeconds * 1000);
    const hh: string = date.getHours() < 10 ? '0' + date.getHours().toString() : date.getHours().toString();
    const mm: string = date.getMinutes() < 10 ? '0' + date.getMinutes().toString() : date.getMinutes().toString();
    return hh + ':' + mm;
  }

  /** 复制按钮规则：用户消息有正文即可复制，助手仅最后一条正式回复。 */
  static applyCopyRules(entries: ConversationFeedEntry[]): void {
    let lastAssistant: number = -1;
    for (let index = entries.length - 1; index >= 0; index--) {
      if (entries[index].kind === ConversationItemKind.ASSISTANT as string) {
        lastAssistant = index;
        break;
      }
    }
    for (let index = 0; index < entries.length; index++) {
      const entry: ConversationFeedEntry = entries[index];
      if (entry.kind === ConversationItemKind.USER as string) {
        entry.copyable = entry.text.length > 0 || entry.imageCount > 0;
      } else if (entry.kind === ConversationItemKind.ASSISTANT as string) {
        entry.copyable = index === lastAssistant && !entry.streaming;
      } else {
        entry.copyable = false;
      }
    }
  }

  /** 运行活动推断（对齐小程序 runCues 口径的简化版）。 */
  static runningActivity(items: ConversationItem[]): string {
    let lastUser: number = -1;
    for (let index = items.length - 1; index >= 0; index--) {
      if (items[index].kind === ConversationItemKind.USER) {
        lastUser = index;
        break;
      }
    }
    let activity: string = 'thinking';
    let hasReasoned: boolean = false;
    let hasResult: boolean = false;
    let hasError: boolean = false;
    for (let index = lastUser + 1; index < items.length; index++) {
      const item: ConversationItem = items[index];
      const kind: string = item.kind as string;
      if (kind === ConversationItemKind.CONTEXT as string) {
        activity = 'gathering';
      } else if (kind === ConversationItemKind.TOOL as string || kind === ConversationItemKind.JSON_TOOL as string) {
        activity = 'exploring';
      } else if (kind === ConversationItemKind.TOOL_RESULT as string) {
        if (item.isError === true) {
          activity = 'revisiting';
          hasError = true;
        } else {
          activity = 'reviewing';
          hasResult = true;
        }
      } else if (kind === ConversationItemKind.REASONING as string) {
        activity = hasReasoned || hasResult ? 'revisiting' : 'thinking';
        hasReasoned = true;
      } else if (kind === ConversationItemKind.ASSISTANT as string) {
        activity = 'composing';
      } else if (kind === ConversationItemKind.STATUS as string) {
        activity = 'working';
      }
    }
    return hasError ? 'revisiting' : activity;
  }

  /** 短语轮换：30 秒一桶，取 (起始秒 + 桶序) % 词数（对齐小程序）。 */
  static runningPhrase(activity: string, startEpochSeconds: number, nowEpochSeconds: number): string {
    const words: string[] = ConversationFeed.phrases(activity);
    const start: number = startEpochSeconds > 0 ? startEpochSeconds : nowEpochSeconds;
    const bucket: number = Math.floor(Math.max(0, nowEpochSeconds - start) / 30);
    const index: number = (Math.floor(start) + bucket) % words.length;
    return words[index < 0 ? index + words.length : index];
  }

  /** 运行条文案（对齐小程序 session.wxml:352「{{runPhrase}}，用时 N 秒…」）。 */
  static runningLabel(activity: string, startEpochSeconds: number, nowEpochSeconds: number): string {
    const phrase: string = ConversationFeed.runningPhrase(activity, startEpochSeconds, nowEpochSeconds);
    const started: number = startEpochSeconds > 0 ? startEpochSeconds : nowEpochSeconds;
    const elapsed: number = Math.max(0, nowEpochSeconds - started);
    return phrase + '，用时 ' + Math.floor(elapsed).toString() + ' 秒…';
  }

  /** 运行条头部：「耗时 X · N 项上下文 · N 次工具调用」（对齐小程序 buildRunHeader）。 */
  static runningHeader(items: ConversationItem[], startEpochSeconds: number, nowEpochSeconds: number): string {
    let contexts: number = 0;
    let tools: number = 0;
    for (const item of items) {
      const kind: string = item.kind as string;
      if (kind === ConversationItemKind.CONTEXT as string) {
        contexts = contexts + 1;
      } else if (kind === ConversationItemKind.TOOL as string || kind === ConversationItemKind.JSON_TOOL as string) {
        tools = tools + 1;
      }
    }
    let lastUser: number = -1;
    for (let index = items.length - 1; index >= 0; index--) {
      if (items[index].kind === ConversationItemKind.USER) {
        lastUser = index;
        break;
      }
    }
    let start: number = startEpochSeconds;
    if (start <= 0 && lastUser >= 0) {
      start = items[lastUser].epochSeconds;
    }
    if (start <= 0) {
      start = nowEpochSeconds;
    }
    const elapsed: number = Math.max(0, nowEpochSeconds - start);
    let head: string = '耗时 ' + ConversationFeed.durationLabel(elapsed);
    if (contexts > 0) {
      head = head + ' · ' + contexts.toString() + ' 项上下文';
    }
    if (tools > 0) {
      head = head + ' · ' + tools.toString() + ' 次工具调用';
    }
    return head;
  }

  static lastUserEpochSeconds(items: ConversationItem[]): number {
    for (let index = items.length - 1; index >= 0; index--) {
      if (items[index].kind === ConversationItemKind.USER) {
        return items[index].epochSeconds;
      }
    }
    return 0;
  }
}
