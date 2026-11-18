import { Logger } from '../common/Logger';

/** 团队成员：wire 上来自 projections.values.agentTeam.members 与 team/member 事件。 */
export interface TeamMemberView {
  id: string;
  name: string;
  role: string;
  phase: string;
  provider: string;
  description: string;
  error: string;
  avatarIndex: number;
  statusLabel: string;
  canOpen: boolean;
}

/** 团队共享任务：wire 上来自 projections.values.agentTeam.tasks 与 team/task 事件。 */
export interface TeamTaskView {
  id: string;
  subject: string;
  description: string;
  status: string;
  ownerId: string;
  ownerName: string;
  blockedBy: string[];
}

/** 只需要事件三段字段，SessionStore 的 RawSessionEvent 可直接传入。 */
export interface TeamEventInput {
  type: string;
  seq: number;
  data: Object;
}

const MEMBER_EVENT: string = 'team/member';
const TASK_EVENT: string = 'team/task';

function asRecord(value: Object | undefined): Record<string, Object> | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'object') return undefined;
  if (Array.isArray(value as Object)) return undefined;
  return value as Record<string, Object>;
}

function recordField(source: Record<string, Object> | undefined, key: string): Object | undefined {
  if (source === undefined) return undefined;
  return source[key];
}

function textField(source: Record<string, Object> | undefined, key: string): string {
  const value: Object | undefined = recordField(source, key);
  return typeof value === 'string' ? value as string : '';
}

function numberField(source: Record<string, Object> | undefined, key: string): number {
  const value: Object | undefined = recordField(source, key);
  return typeof value === 'number' ? value as number : 0;
}

function avatarIndexOf(id: string): number {
  let hash: number = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) % 100003;
  }
  return hash % 16;
}

function memberStatusLabel(phase: string): string {
  if (phase === 'provisioning') return '正在创建';
  if (phase === 'failed') return '创建失败';
  if (phase === 'active') return '成员';
  return phase.length > 0 ? phase : '成员';
}

function taskStatusLabel(status: string): string {
  if (status === 'completed') return '已完成';
  if (status === 'in_progress') return '进行中';
  if (status === 'pending') return '待处理';
  return status;
}

function parseMember(value: Object | undefined): TeamMemberView | undefined {
  const record: Record<string, Object> | undefined = asRecord(value);
  if (record === undefined) return undefined;
  const id: string = textField(record, 'id');
  if (id.length === 0) return undefined;
  const name: string = textField(record, 'name');
  const role: string = textField(record, 'role');
  const phase: string = textField(record, 'phase');
  return {
    id: id,
    name: name.length > 0 ? name : id.substring(0, 8),
    role: role.length > 0 ? role : 'teammate',
    phase: phase.length > 0 ? phase : 'active',
    provider: textField(record, 'provider'),
    description: textField(record, 'description'),
    error: textField(record, 'error'),
    avatarIndex: avatarIndexOf(id),
    statusLabel: memberStatusLabel(phase),
    canOpen: phase !== 'provisioning'
  };
}

function parseTask(value: Object | undefined): TeamTaskView | undefined {
  const record: Record<string, Object> | undefined = asRecord(value);
  if (record === undefined) return undefined;
  const id: string = textField(record, 'id');
  if (id.length === 0) return undefined;
  const blockedRaw: Object | undefined = recordField(record, 'blockedBy');
  const blockedBy: string[] = [];
  if (Array.isArray(blockedRaw as Object)) {
    for (const one of blockedRaw as Object[]) {
      if (typeof one === 'string') blockedBy.push(one as string);
    }
  }
  const status: string = textField(record, 'status');
  return {
    id: id,
    subject: textField(record, 'subject'),
    description: textField(record, 'description'),
    status: status.length > 0 ? status : 'pending',
    ownerId: textField(record, 'ownerId'),
    ownerName: textField(record, 'ownerName'),
    blockedBy: blockedBy
  };
}

/**
 * 智能体团队快照：把网关下发的 agentTeam 投影（基线）与 team/member、team/task 事件（增量）
 * 合并成对话页右上角「协作」入口与团队面板需要的数据。
 * 只读视图，不切父会话、不发送任务。
 */
export class TeamStore {
  private static instance: TeamStore = new TeamStore();
  private leadId: string = '';
  private members: Map<string, TeamMemberView> = new Map<string, TeamMemberView>();
  private tasks: Map<string, TeamTaskView> = new Map<string, TeamTaskView>();
  private baselineSeq: number = 0;
  private pendingEvents: TeamEventInput[] = [];
  private failure: string = '';
  private loaded: boolean = false;
  private enabled: boolean = false;

  static get(): TeamStore {
    return TeamStore.instance;
  }

  leadSessionId(): string {
    return this.leadId;
  }

  isLoaded(): boolean {
    return this.loaded;
  }

  failureText(): string {
    return this.failure;
  }

  memberList(): TeamMemberView[] {
    const rows: TeamMemberView[] = [];
    this.members.forEach((one: TeamMemberView) => {
      rows.push(one);
    });
    rows.sort((a: TeamMemberView, b: TeamMemberView) => {
      const aLead: number = a.role === 'lead' ? 0 : 1;
      const bLead: number = b.role === 'lead' ? 0 : 1;
      if (aLead !== bLead) return aLead - bLead;
      return a.name.localeCompare(b.name);
    });
    return rows;
  }

  taskList(): TeamTaskView[] {
    const rows: TeamTaskView[] = [];
    this.tasks.forEach((one: TeamTaskView) => {
      rows.push(one);
    });
    rows.sort((a: TeamTaskView, b: TeamTaskView) => a.id.localeCompare(b.id));
    return rows;
  }

  /** 团队协作是否开启（agentTeam.enabled）。 */
  isEnabled(): boolean {
    return this.enabled;
  }

  /** 协作入口是否展示：团队协作已开启，或确实存在多个成员/共享任务。 */
  visible(): boolean {
    if (this.leadId.length === 0) return false;
    return this.enabled || this.members.size >= 2 || this.tasks.size > 0;
  }

  /** 切换会话时激活：成员会话沿用当前团队，无关会话清空，避免旧团队串到别的会话。 */
  activate(sessionId: string): void {
    if (this.leadId.length === 0 || sessionId.length === 0) return;
    if (sessionId === this.leadId || this.members.has(sessionId)) return;
    this.reset();
  }

  reset(): void {
    this.leadId = '';
    this.members.clear();
    this.tasks.clear();
    this.baselineSeq = 0;
    this.pendingEvents = [];
    this.failure = '';
    this.loaded = false;
    this.publish();
  }

  /** session-snapshot / history 帧里的 projections（values.agentTeam）。 */
  ingestProjection(sessionId: string, projections: Record<string, Object> | undefined): void {
    if (projections === undefined || sessionId.length === 0) return;
    const values: Record<string, Object> | undefined = asRecord(recordField(projections, 'values'));
    if (values === undefined) return;
    const team: Record<string, Object> | undefined = asRecord(recordField(values, 'agentTeam'));
    if (team === undefined) return;
    const seq: number = numberField(projections, 'asOfSeq');
    if (this.leadId === sessionId && seq > 0 && this.baselineSeq > 0 && seq < this.baselineSeq) {
      return;
    }
    if (this.leadId !== sessionId) {
      this.members.clear();
      this.tasks.clear();
      this.pendingEvents = [];
    }
    this.leadId = sessionId;
    if (seq > 0) this.baselineSeq = seq;
    this.loaded = true;
    const enabledValue: Object | undefined = recordField(team, 'enabled');
    this.enabled = typeof enabledValue === 'boolean' && (enabledValue as boolean) === true;
    this.failure = textField(team, 'failure');
    const membersRaw: Object | undefined = recordField(team, 'members');
    if (Array.isArray(membersRaw as Object)) {
      for (const item of membersRaw as Object[]) {
        const member: TeamMemberView | undefined = parseMember(item);
        if (member !== undefined) this.members.set(member.id, member);
      }
    }
    const tasksRaw: Object | undefined = recordField(team, 'tasks');
    if (Array.isArray(tasksRaw as Object)) {
      for (const item of tasksRaw as Object[]) {
        const task: TeamTaskView | undefined = parseTask(item);
        if (task !== undefined) {
          if (task.status === 'deleted') this.tasks.delete(task.id);
          else this.tasks.set(task.id, task);
        }
      }
    }
    // 团队存在但成员表里没有 Lead 时补一位（对齐小程序：teamId 即 Lead 会话）
    if ((this.enabled || this.members.size >= 1 || this.tasks.size >= 1) && !this.members.has(sessionId)) {
      const leadMember: TeamMemberView = {
        id: sessionId,
        name: 'lead',
        role: 'lead',
        phase: 'active',
        provider: '',
        description: '',
        error: '',
        avatarIndex: avatarIndexOf(sessionId),
        statusLabel: '主会话',
        canOpen: true
      };
      this.members.set(sessionId, leadMember);
    }
    const replay: TeamEventInput[] = this.pendingEvents.slice();
    this.pendingEvents = [];
    for (const event of replay) {
      this.applyEvent(event);
    }
    Logger.info('team projection session=' + sessionId + ' enabled=' + this.enabled
      + ' members=' + this.members.size + ' tasks=' + this.tasks.size + ' seq=' + this.baselineSeq);
    this.publish();
  }

  /** 实时事件：team/member、team/task（字段拆开传，避免 ArkTS 结构化类型限制）。 */
  ingestEvent(type: string, seq: number, data: Object): void {
    if (type !== MEMBER_EVENT && type !== TASK_EVENT) return;
    const event: TeamEventInput = { type: type, seq: seq, data: data };
    if (this.leadId.length === 0) {
      if (this.pendingEvents.length < 200) this.pendingEvents.push(event);
      return;
    }
    this.applyEvent(event);
  }

  private applyEvent(input: TeamEventInput): void {
    const envelope: Record<string, Object> | undefined = asRecord(input.data);
    if (envelope === undefined) return;
    let payload: Record<string, Object> | undefined = envelope;
    const nested: Record<string, Object> | undefined = asRecord(recordField(envelope, 'data'));
    if (nested !== undefined && textField(envelope, 'type').length > 0) payload = nested;
    const teamId: string = textField(payload, 'teamId');
    if (teamId.length > 0 && teamId !== this.leadId) return;
    if (this.baselineSeq > 0 && input.seq > 0 && input.seq <= this.baselineSeq) return;
    const version: number = numberField(payload, 'version');
    if (version !== 0 && version !== 2) {
      this.failure = '团队数据版本暂不支持';
      this.publish();
      return;
    }
    if (input.type === MEMBER_EVENT) {
      const member: TeamMemberView | undefined = parseMember(recordField(payload, 'member'));
      if (member !== undefined) {
        this.members.set(member.id, member);
        this.loaded = true;
      }
    } else {
      const task: TeamTaskView | undefined = parseTask(recordField(payload, 'task'));
      if (task !== undefined) {
        if (task.status === 'deleted') this.tasks.delete(task.id);
        else this.tasks.set(task.id, task);
        this.loaded = true;
      }
    }
    this.publish();
  }

  private publish(): void {
    AppStorage.setOrCreate<string>('teamLeadSessionId', this.leadId);
    AppStorage.setOrCreate<TeamMemberView[]>('teamMembers', this.memberList());
    AppStorage.setOrCreate<TeamTaskView[]>('teamTasks', this.taskList());
    AppStorage.setOrCreate<boolean>('teamVisible', this.visible());
    AppStorage.setOrCreate<string>('teamFailure', this.failure);
  }
}
