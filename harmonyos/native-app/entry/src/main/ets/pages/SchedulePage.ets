import { uiMaterial } from '@kit.ArkUI';
import {
  GatewayClient, SessionStore, SessionSummary, GatewayFrame, ScheduleTask, ScheduleDraft,
  SCHEDULE_RULES, SCHEDULE_INTERVAL_UNIT_TITLES, SCHEDULE_RULE_AT, SCHEDULE_RULE_EVERY,
  SCHEDULE_RULE_DAILY, SCHEDULE_RULE_CRON, SCHEDULE_RULE_WEEKLY, SCHEDULE_RULE_WEEKDAYS,
  makeScheduleDraft, buildScheduleChange, validateScheduleDraft,
  shortScheduleRule, fullScheduleRule, formatScheduleDate, parseScheduleIsoMs,
  localTimeZone, todayDateText, weekDayShortName, pad2,
  asRec, arr, str, num, bool, field, ScheduleRuleOption
} from 'nativecore';
import { openSessionRoute } from '../common/SessionRoute';
import { appGlassFill, appGlassBlur, APP_GLASS_RADIUS, appGlassBorderColor, appGlassShadow } from '../common/AppGlass';
import { NavBackButton } from '../components/NavBackButton';
import { HdsNavDestination, ScrollEffectType, hdsMaterial } from '@kit.UIDesignKit';
import { SETTINGS_MAX_WIDTH } from '../common/Responsive';

/** 任务运行记录行（对齐小程序 loadHistory 里的 records 映射） */
interface ScheduleHistoryRow {
  messageId: string;
  scheduledAt: string;
  prompt: string;
  dateLabel: string;
  expanded: boolean;
}

/** 编辑草稿初值：未打开任何任务时占位（不会显示） */
function emptyDraft(): ScheduleDraft {
  return {
    title: '', prompt: '', kind: SCHEDULE_RULE_DAILY, ruleIndex: 2,
    date: todayDateText(), time: '09:00:00', zone: localTimeZone(),
    interval: '1', unitSeconds: 3600, unitIndex: 0,
    weekdays: [1], expression: '0 9 * * 1-5',
    error: '', saving: false, canSave: false
  };
}

/**
 * 自动化任务页（对齐小程序 pages/schedule）：
 * 搜索 + 状态筛选 + 任务列表（下次计划时间）、任务详情里的「规则 / 任务运行记录」分页、
 * 规则编辑（仅一次 / 固定间隔 / 每天 / 周一至周五 / 每周 / Cron）、确认删除。
 * 新建与小程序一致：只开一个空白会话交给 Agent，不直接造任务。
 */
@Component
export struct SchedulePage {
  @StorageLink('isDark') isDark: boolean = false;
  @StorageLink('connectionState') connection: string = 'disconnected';
  @StorageLink('scheduleTasks') tasks: ScheduleTask[] = [];
  @StorageLink('sessions') sessions: SessionSummary[] = [];
  @StorageLink('safeTopVp') safeTopStorage: number = 0;
  @StorageLink('scheduleChangedSeq') @Watch('onScheduleChanged') changedSeq: number = 0;
  @Consume('pageStack') pageStack: NavPathStack;

  // ── 列表状态 ──
  @State loading: boolean = false;
  @State error: string = '';
  @State refreshing: boolean = false;
  @State creating: boolean = false;
  @State search: string = '';
  @State searchOpen: boolean = false;
  @State filterOpen: boolean = false;
  @State statusFilter: string = 'all';
  // ── 详情 / 编辑弹层 ──
  @State sheetOpen: boolean = false;
  @State selectedId: string = '';
  @State detailTab: string = 'rule';
  @State busyId: string = '';
  // ── 运行记录 ──
  @State history: ScheduleHistoryRow[] = [];
  @State historyLoading: boolean = false;
  @State historyError: string = '';
  @State historyNext: string = '';
  @State historyPruned: boolean = false;
  @State historyRetention: string = '';
  // ── 编辑表单（拆成基础类型状态，避免深层对象变更不刷新）──
  @State editing: boolean = false;
  @State editTitle: string = '';
  @State editPrompt: string = '';
  @State editKind: string = SCHEDULE_RULE_DAILY;
  @State editRuleIndex: number = 2;
  @State editDate: string = '';
  @State editTime: string = '';
  @State editZone: string = '';
  @State editInterval: string = '';
  @State editUnitSeconds: number = 3600;
  @State editUnitIndex: number = 0;
  @State editWeekdays: number[] = [];
  @State editExpression: string = '';
  @State editError: string = '';
  @State editSaving: boolean = false;
  @State editCanSave: boolean = false;
  @State ruleMenuOpen: boolean = false;
  @State unitMenuOpen: boolean = false;

  // 非状态引用：原始任务 / 初始草稿（保存时做乐观并发与「时间规则是否变化」判断）
  private editTaskRef: ScheduleTask | undefined = undefined;
  private initialDraft: ScheduleDraft = emptyDraft();
  private originalTitle: string = '';
  private originalPrompt: string = '';
  // 请求序号：刷新/记录请求的迟到回执据此丢弃
  private refreshSeq: number = 0;
  private historyRead: number = 0;
  private loadedOnce: boolean = false;
  private refreshTimer: number = -1;

  // ───────────── 配色 ─────────────
  private pageBg(): string {
    return this.isDark ? '#000000' : '#F2F2F7';
  }

  private cardBg(): string {
    return this.isDark ? '#1C1C1E' : '#FFFFFF';
  }

  private textColor(): string {
    return this.isDark ? '#F1F4FA' : '#101318';
  }

  private subColor(): string {
    return this.isDark ? 'rgba(241,244,250,0.60)' : 'rgba(16,19,24,0.60)';
  }

  private accent(): string {
    return '#2E6BE6';
  }

  private accentBg(): string {
    return this.isDark ? 'rgba(46,107,230,0.22)' : 'rgba(46,107,230,0.10)';
  }

  private softColor(): string {
    return this.isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.045)';
  }

  private lineColor(): string {
    return this.isDark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.10)';
  }

  private dangerColor(): string {
    return this.isDark ? '#EF9398' : '#C95056';
  }

  private iconTint(color: string): number[] {
    const hex: string = color.startsWith('#') ? color.substring(1) : '101318';
    const value: number = parseInt(hex, 16);
    return [0, 0, 0, 0, ((value >> 16) & 255) / 255, 0, 0, 0, 0, ((value >> 8) & 255) / 255, 0, 0, 0, 0, (value & 255) / 255, 0, 0, 0, 1, 0];
  }

  private sheetMaterial(): uiMaterial.Material | undefined {
    try {
      if (!uiMaterial.isImmersiveMaterialSupported()) {
        return undefined;
      }
      return new uiMaterial.ImmersiveMaterial({
        style: uiMaterial.ImmersiveStyle.THICK,
        materialColor: this.isDark ? 'rgba(255,255,255,0.02)' : 'rgba(255,255,255,0.34)',
        colorInvert: true,
        applyShadow: true
      });
    } catch (err) {
      return undefined;
    }
  }

  private toast(message: string): void {
    try {
      this.getUIContext().getPromptAction().showToast({ message: message, duration: 2000 });
    } catch (err) {
    }
  }

  // ───────────── 生命周期 ─────────────
  aboutToAppear(): void {
    this.refresh(false);
  }

  aboutToDisappear(): void {
    this.refreshSeq += 1;
    this.historyRead += 1;
    if (this.refreshTimer >= 0) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = -1;
    }
  }

  /** 主机广播任务变化（任一设备改了任务）→ 静默重新拉目录 */
  onScheduleChanged(): void {
    if (this.connection === 'connected') {
      this.refresh(true);
    }
  }

  // ───────────── 数据 ─────────────
  private refresh(silent: boolean): void {
    if (this.connection !== 'connected') {
      this.loading = false;
      this.refreshing = false;
      this.error = '连接网关后可查看自动化任务';
      return;
    }
    this.refreshSeq += 1;
    const seq: number = this.refreshSeq;
    if (!silent) {
      this.loading = this.tasks.length === 0;
      this.error = '';
    }
    const gateway: GatewayClient = GatewayClient.get();
    // 12s 兜底超时（对齐小程序 refreshScheduledTasks）：网关不回执时不能一直转圈
    if (this.refreshTimer >= 0) {
      clearTimeout(this.refreshTimer);
    }
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = -1;
      if (seq !== this.refreshSeq || !this.loading) {
        return;
      }
      this.loading = false;
      this.refreshing = false;
      this.error = '自动化任务请求超时，请重试';
    }, 12000);
    gateway.requestScheduleCatalogAsync().then((frame: GatewayFrame) => {
      if (seq !== this.refreshSeq) {
        return;
      }
      if (this.refreshTimer >= 0) {
        clearTimeout(this.refreshTimer);
        this.refreshTimer = -1;
      }
      this.loading = false;
      this.refreshing = false;
      this.loadedOnce = true;
      this.error = '';
    }).catch((err: Error) => {
      if (seq !== this.refreshSeq) {
        return;
      }
      if (this.refreshTimer >= 0) {
        clearTimeout(this.refreshTimer);
        this.refreshTimer = -1;
      }
      this.loading = false;
      this.refreshing = false;
      this.error = err.message.length > 0 ? err.message : '自动化任务加载失败';
    });
  }

  private onRefresh(): void {
    if (this.connection !== 'connected') {
      this.refreshing = false;
      return;
    }
    this.refreshing = true;
    this.refresh(false);
    if (this.selectedTask() !== undefined && this.detailTab === 'records') {
      this.loadHistory(false);
    }
  }

  /** 搜索 + 状态筛选后的任务（对齐小程序 filterTasks：标题/内容/会话 id 都参与匹配） */
  private visibleTasks(): ScheduleTask[] {
    const keyword: string = this.search.trim().toLowerCase();
    const out: ScheduleTask[] = [];
    for (const task of this.tasks) {
      if (this.statusFilter !== 'all' && task.status !== this.statusFilter) {
        continue;
      }
      if (keyword.length > 0) {
        const haystack: string = (task.title + ' ' + task.prompt + ' ' + task.sessionId).toLowerCase();
        if (haystack.indexOf(keyword) < 0) {
          continue;
        }
      }
      out.push(task);
    }
    return out;
  }

  private activeCount(): number {
    let count: number = 0;
    for (const task of this.tasks) {
      if (task.status === 'active') {
        count += 1;
      }
    }
    return count;
  }

  private selectedTask(): ScheduleTask | undefined {
    for (const task of this.tasks) {
      if (task.id === this.selectedId) {
        return task;
      }
    }
    return undefined;
  }

  /** 关联会话标题：会话列表里有就用标题，否则退回 sessionId */
  private sessionLabel(task: ScheduleTask): string {
    for (const item of this.sessions) {
      if (item.id === task.sessionId) {
        return item.title.length > 0 ? item.title : item.id;
      }
    }
    return task.sessionId.length > 0 ? task.sessionId : '未知会话';
  }

  private statusLabel(task: ScheduleTask): string {
    return task.status === 'active' ? '已开启' : '已结束';
  }

  // ───────────── 交互：搜索 / 筛选 ─────────────
  private clearSearch(): void {
    this.search = '';
    this.searchOpen = false;
  }

  private pickStatus(value: string): void {
    this.statusFilter = value;
    this.filterOpen = false;
  }

  private statusFilterLabel(): string {
    if (this.statusFilter === 'active') {
      return '已开启';
    }
    if (this.statusFilter === 'inactive') {
      return '已结束';
    }
    return '全部';
  }

  // ───────────── 交互：详情 / 运行记录 ─────────────
  private openDetail(task: ScheduleTask): void {
    this.historyRead += 1;
    this.selectedId = task.id;
    this.detailTab = 'rule';
    this.history = [];
    this.historyNext = '';
    this.historyError = '';
    this.historyLoading = false;
    this.historyPruned = false;
    this.historyRetention = '';
    this.editing = false;
    this.sheetOpen = true;
  }

  private closeSheet(): void {
    if (this.editSaving) {
      return;
    }
    this.historyRead += 1;
    this.sheetOpen = false;
    this.editing = false;
    this.selectedId = '';
    this.history = [];
    this.historyLoading = false;
  }

  private selectDetailTab(tab: string): void {
    this.detailTab = tab;
    if (tab === 'records') {
      this.loadHistory(false);
    }
  }

  private historyLoadingOrRetry(): void {
    if (this.historyError.length > 0) {
      return;
    }
    this.loadHistory(false);
  }

  /** 网关 code → 用户可读文案（对齐小程序 scheduleFailureMessage） */
  private scheduleFailureText(code: string, fallback: string): string {
    if (code === 'schedule_conflict') {
      return '任务已被其他设备修改，列表已刷新，请重新打开编辑';
    }
    if (code === 'schedule_ended') {
      return '任务已结束，无法再编辑';
    }
    if (code === 'schedule_not_found') {
      return '任务已不存在，列表已刷新';
    }
    return fallback;
  }

  /** 运行记录：最新在前，cursor 翻页，按 messageId 去重（对齐小程序 loadHistory） */
  private loadHistory(more: boolean): void {
    const task: ScheduleTask | undefined = this.selectedTask();
    if (task === undefined || this.connection !== 'connected') {
      return;
    }
    if (this.historyLoading) {
      return;
    }
    this.historyRead += 1;
    const read: number = this.historyRead;
    const previous: ScheduleHistoryRow[] = more ? this.history : [];
    const cursor: string = more ? this.historyNext : '';
    this.historyLoading = true;
    this.historyError = '';
    GatewayClient.get().requestScheduleHistory(task.sessionId, task.id, cursor.length > 0 ? cursor : undefined)
      .then((frame: GatewayFrame) => {
        if (read !== this.historyRead) {
          return;
        }
        const current: ScheduleTask | undefined = this.selectedTask();
        if (current === undefined || current.id !== task.id) {
          return;
        }
        const raw: Object = frame as Object;
        // 协议约定：任务或游标不存在时仍在成功帧里返回 code，需要转成页面错误
        const code: string = str(raw, 'code') !== undefined ? (str(raw, 'code') as string) : '';
        if (code.length > 0) {
          this.historyLoading = false;
          this.historyError = this.scheduleFailureText(code, '记录已更新，请刷新');
          return;
        }
        const records: Object[] = arr(raw, 'records') !== undefined ? (arr(raw, 'records') as Object[]) : [];
        const seen: string[] = [];
        for (const row of previous) {
          seen.push(row.messageId);
        }
        const merged: ScheduleHistoryRow[] = previous.slice();
        for (const item of records) {
          const messageId: string = str(item, 'messageId') !== undefined ? (str(item, 'messageId') as string) : '';
          if (messageId.length === 0 || seen.indexOf(messageId) >= 0) {
            continue;
          }
          seen.push(messageId);
          const scheduledAt: string = str(item, 'scheduledAt') !== undefined ? (str(item, 'scheduledAt') as string) : '';
          const prompt: string = str(item, 'prompt') !== undefined ? (str(item, 'prompt') as string) : '';
          merged.push({
            messageId: messageId,
            scheduledAt: scheduledAt,
            prompt: prompt,
            dateLabel: scheduledAt.length > 0 ? formatScheduleDate(scheduledAt) : '—',
            expanded: false
          });
        }
        const nextBefore: string = str(raw, 'nextBefore') !== undefined ? (str(raw, 'nextBefore') as string) : '';
        const pruned: boolean = bool(raw, 'earlierRecordsPruned') === true;
        // ArkTS 不允许按索引读 Object 字段：用编解码 helper 取 retention 子对象
        const retentionRec: Record<string, Object> | undefined = asRec(field(frame as Object, 'retention'));
        let retentionText: string = '';
        if (retentionRec !== undefined) {
          const days: number = num(retentionRec, 'days') !== undefined ? (num(retentionRec, 'days') as number) : 0;
          const recordsCount: number = num(retentionRec, 'records') !== undefined ? (num(retentionRec, 'records') as number) : 0;
          if (days > 0 || recordsCount > 0) {
            retentionText = '每个任务最多保留近 ' + days.toString() + ' 天内的 ' + recordsCount.toString() + ' 条运行记录。';
          }
        }
        this.history = merged;
        this.historyNext = nextBefore;
        this.historyPruned = pruned;
        this.historyRetention = retentionText;
        this.historyLoading = false;
      })
      .catch((err: Error) => {
        if (read !== this.historyRead) {
          return;
        }
        this.historyLoading = false;
        this.historyError = err.message.length > 0 ? err.message : '无法读取运行记录';
      });
  }

  private toggleHistoryExpanded(row: ScheduleHistoryRow): void {
    const next: ScheduleHistoryRow[] = [];
    for (const item of this.history) {
      next.push({
        messageId: item.messageId,
        scheduledAt: item.scheduledAt,
        prompt: item.prompt,
        dateLabel: item.dateLabel,
        expanded: item.messageId === row.messageId ? !item.expanded : item.expanded
      });
    }
    this.history = next;
  }

  // ───────────── 交互：新建 / 打开关联会话 ─────────────
  /** 小程序语义：新建只是「开一个空白会话交给 Agent」，不直接创建定时任务 */
  private newTask(): void {
    if (this.creating) {
      return;
    }
    if (this.connection !== 'connected') {
      this.toast('请先连接网关');
      return;
    }
    this.creating = true;
    GatewayClient.get().createSession('').then((id: string) => {
      this.creating = false;
      if (id.length === 0) {
        this.toast('打开会话失败，请重试');
        return;
      }
      SessionStore.get().open(id);
      openSessionRoute(this.pageStack);
    }).catch((err: Error) => {
      this.creating = false;
      this.toast(err.message.length > 0 ? err.message : '打开会话失败，请重试');
    });
  }

  private openLinkedSession(): void {
    const task: ScheduleTask | undefined = this.selectedTask();
    if (task === undefined || this.connection !== 'connected') {
      return;
    }
    this.closeSheet();
    SessionStore.get().open(task.sessionId);
    openSessionRoute(this.pageStack);
  }

  // ───────────── 交互：删除 ─────────────
  private confirmDelete(): void {
    const task: ScheduleTask | undefined = this.selectedTask();
    if (task === undefined || this.busyId.length > 0 || this.connection !== 'connected') {
      return;
    }
    AlertDialog.show({
      title: '删除此自动化任务？',
      message: '任务将停止触发，并删除已保存的运行记录。原会话及消息仍保留；已排队消息不会撤回。',
      autoCancel: true,
      primaryButton: {
        value: '取消',
        action: () => {
        }
      },
      secondaryButton: {
        value: '确认删除',
        fontColor: this.dangerColor(),
        action: () => {
          this.deleteTask(task);
        }
      }
    });
  }

  private deleteTask(task: ScheduleTask): void {
    if (this.connection !== 'connected') {
      this.toast('连接网关后才能修改自动化任务');
      return;
    }
    this.busyId = task.id;
    GatewayClient.get().deleteScheduleTask(task).then((frame: GatewayFrame) => {
      this.busyId = '';
      const deleted: boolean = bool(frame as Object, 'deleted') === true;
      if (!deleted) {
        const code: string = str(frame as Object, 'code') !== undefined
          ? (str(frame as Object, 'code') as string) : '';
        this.toast(this.scheduleFailureText(code, '未能确认删除结果，请刷新后核对'));
        this.refresh(false);
        return;
      }
      this.closeSheet();
      this.toast('任务已删除');
      this.refresh(false);
    }).catch((err: Error) => {
      this.busyId = '';
      this.toast(err.message.length > 0 ? err.message : '删除失败，请稍后重试');
      this.refresh(false);
    });
  }

  // ───────────── 交互：编辑 ─────────────
  private startEdit(): void {
    const task: ScheduleTask | undefined = this.selectedTask();
    if (task === undefined || this.connection !== 'connected' || this.busyId.length > 0) {
      return;
    }
    if (task.status !== 'active') {
      this.toast('任务已结束，无法再编辑');
      return;
    }
    this.editTaskRef = task;
    this.initialDraft = makeScheduleDraft(task);
    this.originalTitle = task.title;
    this.originalPrompt = task.prompt;
    this.editTitle = this.initialDraft.title;
    this.editPrompt = this.initialDraft.prompt;
    this.editKind = this.initialDraft.kind;
    this.editRuleIndex = this.initialDraft.ruleIndex;
    this.editDate = this.initialDraft.date;
    this.editTime = this.initialDraft.time;
    this.editZone = this.initialDraft.zone;
    this.editInterval = this.initialDraft.interval;
    this.editUnitSeconds = this.initialDraft.unitSeconds;
    this.editUnitIndex = this.initialDraft.unitIndex;
    this.editWeekdays = this.initialDraft.weekdays.slice();
    this.editExpression = this.initialDraft.expression;
    this.editError = '';
    this.editSaving = false;
    this.editCanSave = false;
    this.editing = true;
  }

  private cancelEdit(): void {
    if (this.editSaving) {
      return;
    }
    this.editing = false;
    this.editTaskRef = undefined;
    this.editError = '';
  }

  /** 当前表单 → 草稿对象（校验与保存都基于它） */
  private currentDraft(): ScheduleDraft {
    return {
      title: this.editTitle,
      prompt: this.editPrompt,
      kind: this.editKind,
      ruleIndex: this.editRuleIndex,
      date: this.editDate,
      time: this.editTime,
      zone: this.editZone,
      interval: this.editInterval,
      unitSeconds: this.editUnitSeconds,
      unitIndex: this.editUnitIndex,
      weekdays: this.editWeekdays.slice(),
      expression: this.editExpression,
      error: this.editError,
      saving: this.editSaving,
      canSave: this.editCanSave
    };
  }

  /** 任何字段变化都重算校验与「是否可保存」 */
  private syncDraftValidation(): void {
    const draft: ScheduleDraft = validateScheduleDraft(this.currentDraft(), this.initialDraft,
      this.originalTitle, this.originalPrompt);
    this.editError = draft.error;
    this.editCanSave = draft.canSave;
  }

  private pickRule(index: number): void {
    if (index < 0 || index >= SCHEDULE_RULES.length) {
      return;
    }
    const option = SCHEDULE_RULES[index];
    this.editRuleIndex = index;
    this.editKind = option.id;
    this.syncDraftValidation();
  }

  private pickUnit(index: number): void {
    if (index < 0 || index >= SCHEDULE_INTERVAL_UNIT_TITLES.length) {
      return;
    }
    this.editUnitIndex = index;
    const units: number[] = [3600, 60, 1];
    this.editUnitSeconds = units[index];
    this.syncDraftValidation();
  }

  private pickWeekday(day: number): void {
    const next: number[] = [];
    let found: boolean = false;
    for (const value of this.editWeekdays) {
      if (value === day) {
        found = true;
      } else {
        next.push(value);
      }
    }
    if (!found) {
      next.push(day);
      next.sort((a: number, b: number) => a - b);
    }
    this.editWeekdays = next;
    this.syncDraftValidation();
  }

  private weekSelected(day: number): boolean {
    return this.editWeekdays.indexOf(day) >= 0;
  }

  private showDatePicker(): void {
    let selected: Date = new Date();
    const ms: number | undefined = parseScheduleIsoMs(this.editDate + 'T12:00:00');
    if (ms !== undefined) {
      selected = new Date(ms);
    }
    try {
      this.getUIContext().showDatePickerDialog({
        selected: selected,
        onDateAccept: (value: Date) => {
          this.editDate = value.getFullYear().toString() + '-' + pad2(value.getMonth() + 1) + '-' + pad2(value.getDate());
          this.syncDraftValidation();
        }
      });
    } catch (err) {
      this.toast('当前系统不支持日期选择');
    }
  }

  private saveEdit(): void {
    const task: ScheduleTask | undefined = this.editTaskRef;
    if (task === undefined) {
      return;
    }
    if (!this.editCanSave || this.editSaving || this.connection !== 'connected') {
      return;
    }
    let change: Record<string, Object> | undefined = undefined;
    try {
      change = buildScheduleChange(this.currentDraft(), this.initialDraft);
    } catch (err) {
      this.editError = err instanceof Error ? err.message : '执行规则无效';
      return;
    }
    this.editSaving = true;
    this.editError = '';
    GatewayClient.get().updateScheduleTask(task, this.editTitle.trim(), this.editPrompt.trim(), change)
      .then((frame: GatewayFrame) => {
        const updated: boolean = bool(frame as Object, 'updated') === true;
        this.editSaving = false;
        if (!updated) {
          const code: string = str(frame as Object, 'code') !== undefined
            ? (str(frame as Object, 'code') as string) : '';
          this.editError = this.scheduleFailureText(code, '未能确认保存结果，请刷新后核对');
          this.refresh(false);
          return;
        }
        this.editing = false;
        this.editTaskRef = undefined;
        this.closeSheet();
        this.toast('已保存修改');
        this.refresh(false);
      })
      .catch((err: Error) => {
        this.editSaving = false;
        this.editError = err.message.length > 0 ? err.message : '保存失败，请稍后重试';
        this.refresh(false);
      });
  }

  // ───────────── UI：头部 / 工具栏 ─────────────
  @Builder
  headerRow() {
    Stack({ alignContent: Alignment.Center }) {
      Text('自动化任务')
        .fontSize(17)
        .fontWeight(FontWeight.Medium)
        .fontColor(this.textColor())
      Row() {
        NavBackButton({ isDark: this.isDark })
          .onClick(() => {
            if (this.editing) {
              this.cancelEdit();
              return;
            }
            if (this.sheetOpen) {
              this.closeSheet();
              return;
            }
            this.pageStack.pop();
          })
        Blank()
      }
      .width('100%')
      .padding({ left: 16, right: 16 })
    }
    .width('100%')
    .height(44)
    .margin({ top: (this.safeTopStorage > 0 ? this.safeTopStorage : 38.9) + 4 })
  }

  /** 搜索胶囊（收起时是「搜索 + 筛选」两个按钮）+ 圆形新建按钮 */
  @Builder
  searchToolbar() {
    Row({ space: 8 }) {
      if (this.searchOpen) {
        Row({ space: 6 }) {
          Image(this.isDark ? $r('app.media.proc_search_dark') : $r('app.media.proc_search'))
            .width(16)
            .height(16)
            .objectFit(ImageFit.Contain)
          TextInput({ text: this.search, placeholder: '搜索自动化任务' })
            .caretStyle({ width: 1 })
            .fontSize(14)
            .fontColor(this.textColor())
            .placeholderColor(this.subColor())
            .backgroundColor(Color.Transparent)
            .padding(0)
            .height('100%')
            .layoutWeight(1)
            .onChange((value: string) => {
              this.search = value;
            })
          Row() {
            Text('×').fontSize(16).fontColor(this.subColor())
          }
          .width(22)
          .height(22)
          .borderRadius(11)
          .backgroundColor(this.softColor())
          .justifyContent(FlexAlign.Center)
          .onClick(() => {
            this.clearSearch();
          })
        }
        .height(34)
        .padding({ left: 10, right: 6 })
        .borderRadius(17)
        .backgroundColor(appGlassFill(this.isDark))
        .backdropBlur(appGlassBlur(this.isDark))
        .clip(true)
        .border({ width: 1, color: appGlassBorderColor(this.isDark) })
        .shadow(appGlassShadow(this.isDark))
        .layoutWeight(1)
      } else {
        Row({ space: 0 }) {
          Row() {
            Image(this.isDark ? $r('app.media.proc_search_dark') : $r('app.media.proc_search'))
              .width(16)
              .height(16)
              .objectFit(ImageFit.Contain)
          }
          .width(31)
          .height(28)
          .justifyContent(FlexAlign.Center)
          .onClick(() => {
            this.searchOpen = true;
            this.filterOpen = false;
          })
          // 筛选图形（对齐小程序 .sched-filter-glyph）：三条**横线**自上而下 14/10/6，竖直居中对齐
          Column({ space: 2.5 }) {
            Column().width(14).height(1.6).borderRadius(1).backgroundColor(this.textColor())
            Column().width(10).height(1.6).borderRadius(1).backgroundColor(this.textColor())
            Column().width(6).height(1.6).borderRadius(1).backgroundColor(this.textColor())
          }
          .width(33)
          .height(28)
          .borderRadius(14)
          .justifyContent(FlexAlign.Center)
          .alignItems(HorizontalAlign.Center)
          .backgroundColor(this.filterOpen
            ? (this.isDark ? 'rgba(255,255,255,0.14)' : 'rgba(16,19,24,0.08)')
            : Color.Transparent)
          .bindMenu(this.filterOpen, this.filterMenu(), {
            placement: Placement.BottomLeft,
            offset: { x: 0, y: 4 },
            onWillDisappear: () => {
              this.filterOpen = false;
            },
            onDisappear: () => {
              this.filterOpen = false;
            }
          })
          .onClick(() => {
            this.searchOpen = false;
            this.filterOpen = true;
          })
        }
        .height(34)
        .padding({ left: 4, right: 4 })
        .borderRadius(17)
        .backgroundColor(appGlassFill(this.isDark))
        .backdropBlur(appGlassBlur(this.isDark))
        .clip(true)
        .border({ width: 1, color: appGlassBorderColor(this.isDark) })
        .shadow(appGlassShadow(this.isDark))
      }

      Blank()

      // 圆形新建（与返回按钮同款发丝描边；加号用两条线画）
      Stack() {
        Column().width(13).height(1.6).borderRadius(1).backgroundColor(this.textColor())
        Column().width(1.6).height(13).borderRadius(1).backgroundColor(this.textColor())
      }
      .width(32)
      .height(32)
      .borderRadius(16)
      .backgroundColor(appGlassFill(this.isDark))
      .backdropBlur(appGlassBlur(this.isDark))
      .clip(true)
      .border({ width: 1, color: appGlassBorderColor(this.isDark) })
      .shadow(appGlassShadow(this.isDark))
      .opacity(this.connection === 'connected' && !this.creating ? 1 : 0.4)
      .onClick(() => {
        this.newTask();
      })
    }
    .width('100%')
    .alignItems(VerticalAlign.Center)
    .padding({ left: 16, right: 16, top: 10, bottom: 10 })
  }

  @Builder
  filterMenu() {
    Menu() {
      MenuItem(this.filterMenuRow('全部', this.statusFilter === 'all')).onClick(() => {
        this.pickStatus('all');
      })
      MenuItem(this.filterMenuRow('已开启', this.statusFilter === 'active')).onClick(() => {
        this.pickStatus('active');
      })
      MenuItem(this.filterMenuRow('已结束', this.statusFilter === 'inactive')).onClick(() => {
        this.pickStatus('inactive');
      })
    }
  }

  @Builder
  filterMenuRow(label: string, selected: boolean) {
    Row({ space: 10 }) {
      Text(selected ? '✓' : '')
        .fontSize(14)
        .fontColor(this.textColor())
        .width(16)
      Text(label)
        .fontSize(15)
        .fontWeight(selected ? FontWeight.Medium : FontWeight.Normal)
        .fontColor(this.textColor())
    }
    .width(150)
    .height(40)
  }

  // ───────────── UI：状态块 ─────────────
  @Builder
  loadingState() {
    Column({ space: 10 }) {
      LoadingProgress().width(24).height(24).color(this.subColor())
      Text('正在加载自动化任务…').fontSize(13).fontColor(this.subColor())
    }
    .width('100%')
    .padding({ top: 60, bottom: 60 })
  }

  @Builder
  errorState() {
    Column({ space: 10 }) {
      Image(this.isDark ? $r('app.media.automation_white') : $r('app.media.automation_ink'))
        .width(34)
        .height(34)
        .objectFit(ImageFit.Contain)
        .opacity(0.5)
      Text('无法显示自动化任务')
        .fontSize(15)
        .fontWeight(FontWeight.Medium)
        .fontColor(this.textColor())
      Text(this.error)
        .fontSize(13)
        .fontColor(this.subColor())
        .textAlign(TextAlign.Center)
      Text('重试')
        .fontSize(13)
        .fontColor(this.accent())
        .padding({ left: 18, right: 18, top: 8, bottom: 8 })
        .borderRadius(16)
        .backgroundColor(appGlassFill(this.isDark))
        .backdropBlur(appGlassBlur(this.isDark))
        .clip(true)
        .border({ width: 1, color: appGlassBorderColor(this.isDark) })
        .shadow(appGlassShadow(this.isDark))
        .onClick(() => {
          this.refresh(false);
        })
    }
    .width('100%')
    .padding({ top: 50, bottom: 50 })
  }

  @Builder
  emptyState() {
    Column({ space: 10 }) {
      Image(this.isDark ? $r('app.media.proc_clock_dark') : $r('app.media.proc_clock'))
        .width(34)
        .height(34)
        .objectFit(ImageFit.Contain)
      Text('还没有自动化任务')
        .fontSize(15)
        .fontWeight(FontWeight.Medium)
        .fontColor(this.textColor())
      Text('在会话中告诉 Agent 任务内容和执行时间，创建后会显示在这里。')
        .fontSize(13)
        .fontColor(this.subColor())
        .textAlign(TextAlign.Center)
        .padding({ left: 24, right: 24 })
      Row({ space: 6 }) {
        Stack() {
          Column().width(13).height(1.6).borderRadius(1).backgroundColor(this.textColor())
          Column().width(1.6).height(13).borderRadius(1).backgroundColor(this.textColor())
        }
        .width(13)
        .height(13)
        Text('新建自动化任务')
          .fontSize(14)
          .fontWeight(FontWeight.Medium)
          .fontColor(this.textColor())
      }
      .height(40)
      .padding({ left: 22, right: 22 })
      .borderRadius(20)
      .backgroundColor(appGlassFill(this.isDark))
      .backdropBlur(appGlassBlur(this.isDark))
      .clip(true)
      .border({ width: 1, color: appGlassBorderColor(this.isDark) })
      .shadow(appGlassShadow(this.isDark))
      .margin({ top: 8 })
      .opacity(this.connection === 'connected' && !this.creating ? 1 : 0.4)
      .onClick(() => {
        this.newTask();
      })
    }
    .width('100%')
    .padding({ top: 50, bottom: 50 })
  }

  @Builder
  noticeRow(text: string) {
    Text(text)
      .fontSize(12.5)
      .fontColor(this.dangerColor())
      .width('100%')
      .margin({ bottom: 10 })
  }

  // ───────────── UI：任务行 ─────────────
  @Builder
  taskRow(task: ScheduleTask) {
    Row({ space: 10 }) {
      Row() {
        Image(this.isDark ? $r('app.media.automation_white') : $r('app.media.automation_ink'))
          .width(18)
          .height(18)
          .objectFit(ImageFit.Contain)
          .opacity(task.status === 'active' ? 0.85 : 0.45)
      }
      .width(30)
      .height(30)
      .borderRadius(9)
      .backgroundColor(this.softColor())
      .justifyContent(FlexAlign.Center)

      Column({ space: 4 }) {
        Row({ space: 6 }) {
          Text(task.title)
            .fontSize(15)
            .fontWeight(FontWeight.Medium)
            .fontColor(this.textColor())
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
            .layoutWeight(1)
          Text(this.statusLabel(task))
            .fontSize(10)
            .fontColor(task.status === 'active' ? this.accent() : this.subColor())
            .backgroundColor(task.status === 'active' ? this.accentBg() : this.softColor())
            .padding({ left: 6, right: 6, top: 2, bottom: 2 })
            .borderRadius(10)
        }
        .width('100%')
        .alignItems(VerticalAlign.Center)

        Text(fullScheduleRule(task))
          .fontSize(12)
          .fontColor(this.subColor())
          .maxLines(2)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .width('100%')
        Text(task.prompt)
          .fontSize(12.5)
          .fontColor(this.subColor())
          .maxLines(2)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .width('100%')
          .lineHeight(18)
        Text(task.status === 'active'
          ? ('下次计划时间：' + formatScheduleDate(task.scheduledAt))
          : '任务已结束')
          .fontSize(11)
          .fontColor(this.subColor())
          .width('100%')
      }
      .layoutWeight(1)
      .alignItems(HorizontalAlign.Start)

      Image($r('app.media.ic_dir_chevron_mist'))
        .width(12)
        .height(12)
        .rotate({ angle: 90 })
        .colorFilter(this.iconTint(this.subColor()))
        .margin({ top: 8 })
    }
    .width('100%')
    .padding({ left: 12, right: 12, top: 13, bottom: 13 })
    .borderRadius(16)
    .backgroundColor(this.cardBg())
    .border({ width: 0.5, color: this.lineColor() })
    .onClick(() => {
      this.openDetail(task);
    })
  }

  // ───────────── UI：详情弹层 ─────────────
  @Builder
  sheetHandle() {
    Row()
      .width(32)
      .height(4)
      .borderRadius(2)
      .backgroundColor(this.lineColor())
      .margin({ top: 8, bottom: 6 })
  }

  @Builder
  sheetContent() {
    Column() {
      this.sheetHandle()
      if (this.editing) {
        this.editHeader()
        this.editForm()
        this.editFooter()
      } else {
        this.detailHeader()
        this.detailTabs()
        this.detailBody()
        this.detailFooter()
      }
    }
    .width('100%')
    .height('100%')
  }

  @Builder
  detailHeader() {
    Row() {
      Column({ space: 3 }) {
        Text('任务详情').fontSize(11).fontColor(this.subColor())
        Text(this.selectedTask() !== undefined ? (this.selectedTask() as ScheduleTask).title : '')
          .fontSize(17)
          .fontWeight(FontWeight.Medium)
          .fontColor(this.textColor())
          .maxLines(2)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
      }
      .layoutWeight(1)
      .alignItems(HorizontalAlign.Start)
      Text('×')
        .fontSize(22)
        .fontColor(this.dangerColor())
        .width(30)
        .height(30)
        .textAlign(TextAlign.Center)
        .onClick(() => {
          this.closeSheet();
        })
    }
    .width('100%')
    .padding({ left: 16, right: 16, top: 6, bottom: 10 })
    .alignItems(VerticalAlign.Top)
  }

  @Builder
  detailTabs() {
    Row({ space: 22 }) {
      Text('规则')
        .fontSize(13.5)
        .fontWeight(this.detailTab === 'rule' ? FontWeight.Medium : FontWeight.Normal)
        .fontColor(this.detailTab === 'rule' ? this.textColor() : this.subColor())
        .padding({ top: 8, bottom: 8 })
        .border({ width: { bottom: this.detailTab === 'rule' ? 2 : 0 }, color: this.textColor() })
        .onClick(() => {
          this.selectDetailTab('rule');
        })
      Text('任务运行记录')
        .fontSize(13.5)
        .fontWeight(this.detailTab === 'records' ? FontWeight.Medium : FontWeight.Normal)
        .fontColor(this.detailTab === 'records' ? this.textColor() : this.subColor())
        .padding({ top: 8, bottom: 8 })
        .border({ width: { bottom: this.detailTab === 'records' ? 2 : 0 }, color: this.textColor() })
        .onClick(() => {
          this.selectDetailTab('records');
        })
      Blank()
    }
    .width('100%')
    .padding({ left: 16, right: 16 })
    .border({ width: { bottom: 0.5 }, color: this.lineColor() })
  }

  @Builder
  detailBody() {
    Scroll() {
      Column({ space: 14 }) {
        if (this.detailTab === 'rule') {
          this.ruleBody()
        } else {
          this.recordsBody()
        }
      }
      .width('100%')
      .alignItems(HorizontalAlign.Start)
      .padding({ left: 16, right: 16, top: 14, bottom: 18 })
    }
    .layoutWeight(1)
    .width('100%')
    .align(Alignment.Top)
    .scrollBar(BarState.Off)
    .edgeEffect(EdgeEffect.None)
  }

  @Builder
  ruleBody() {
    if (this.selectedTask() !== undefined) {
      this.ruleBodyFor(this.selectedTask() as ScheduleTask)
    }
  }

  @Builder
  ruleBodyFor(task: ScheduleTask) {
    // 下次运行 / 任务状态
    Column({ space: 5 }) {
      Text(task.status === 'active' ? '下次运行' : '任务状态')
        .fontSize(11.5)
        .fontColor(this.subColor())
      Text(task.status === 'active' ? formatScheduleDate(task.scheduledAt) : '已结束')
        .fontSize(15)
        .fontWeight(FontWeight.Medium)
        .fontColor(this.textColor())
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
    .padding(12)
    .borderRadius(12)
    .backgroundColor(this.softColor())

    Text('自动化任务内容')
      .fontSize(13)
      .fontWeight(FontWeight.Medium)
      .fontColor(this.textColor())
    Text(task.prompt)
      .fontSize(14)
      .fontColor(this.textColor())
      .lineHeight(21)
      .copyOption(CopyOptions.LocalDevice)
      .width('100%')

    Column() {
      this.factRow('提醒频率', fullScheduleRule(task), false)
      Row().width('100%').height(0.5).backgroundColor(this.lineColor())
      this.factRow('状态', this.statusLabel(task), false)
      Row().width('100%').height(0.5).backgroundColor(this.lineColor())
      this.factRow('任务 ID', task.id, true)
    }
    .width('100%')

    // 关联会话
    Row({ space: 8 }) {
      Column({ space: 3 }) {
        Text('关联会话').fontSize(11.5).fontColor(this.subColor())
        Text(this.sessionLabel(task))
          .fontSize(13.5)
          .fontColor(this.textColor())
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
      }
      .layoutWeight(1)
      .alignItems(HorizontalAlign.Start)
      Text('打开 ›')
        .fontSize(12.5)
        .fontColor(this.accent())
    }
    .width('100%')
    .padding(12)
    .borderRadius(12)
    .border({ width: 0.5, color: this.lineColor() })
    .opacity(this.connection === 'connected' ? 1 : 0.5)
    .onClick(() => {
      this.openLinkedSession();
    })

    if (task.status !== 'active') {
      Text('已结束的任务为只读，无法修改时间。')
        .fontSize(12)
        .fontColor(this.subColor())
    }
  }

  @Builder
  factRow(label: string, value: string, selectable: boolean) {
    Row({ space: 12 }) {
      Text(label)
        .fontSize(12.5)
        .fontColor(this.subColor())
        .width(72)
      if (selectable) {
        Text(value)
          .fontSize(12.5)
          .fontColor(this.textColor())
          .layoutWeight(1)
          .copyOption(CopyOptions.LocalDevice)
      } else {
        Text(value)
          .fontSize(12.5)
          .fontColor(this.textColor())
          .layoutWeight(1)
      }
    }
    .width('100%')
    .padding({ top: 10, bottom: 10 })
    .alignItems(VerticalAlign.Top)
  }

  @Builder
  recordsBody() {
    Row() {
      Text('已保存的任务运行记录')
        .fontSize(13)
        .fontWeight(FontWeight.Medium)
        .fontColor(this.textColor())
        .layoutWeight(1)
      Text('刷新')
        .fontSize(12.5)
        .fontColor(this.accent())
        .opacity(this.historyLoading || this.connection !== 'connected' ? 0.5 : 1)
        .onClick(() => {
          this.historyLoadingOrRetry();
        })
    }
    .width('100%')

    if (this.historyError.length > 0) {
      Row({ space: 10 }) {
        Text(this.historyError)
          .fontSize(12.5)
          .fontColor(this.dangerColor())
          .layoutWeight(1)
        Text('重试')
          .fontSize(12.5)
          .fontColor(this.accent())
          .onClick(() => {
            this.loadHistory(false);
          })
      }
      .width('100%')
    }

    if (this.history.length === 0 && !this.historyLoading && this.historyError.length === 0) {
      Column({ space: 8 }) {
        Image(this.isDark ? $r('app.media.proc_clock_dark') : $r('app.media.proc_clock'))
          .width(28)
          .height(28)
          .objectFit(ImageFit.Contain)
        Text('暂无任务运行记录').fontSize(12.5).fontColor(this.subColor())
      }
      .width('100%')
      .padding({ top: 24, bottom: 24 })
    }

    ForEach(this.history, (row: ScheduleHistoryRow) => {
      this.historyRow(row)
    }, (row: ScheduleHistoryRow) => row.messageId)

    if (this.historyLoading) {
      Row({ space: 8 }) {
        LoadingProgress().width(16).height(16).color(this.subColor())
        Text('正在加载记录…').fontSize(12.5).fontColor(this.subColor())
      }
      .width('100%')
      .justifyContent(FlexAlign.Center)
      .padding({ top: 10, bottom: 10 })
    }

    if (this.historyNext.length > 0 && this.historyError.length === 0) {
      Text('加载更多')
        .fontSize(12.5)
        .fontColor(this.accent())
        .padding({ left: 16, right: 16, top: 8, bottom: 8 })
        .borderRadius(16)
        .backgroundColor(appGlassFill(this.isDark))
        .backdropBlur(appGlassBlur(this.isDark))
        .clip(true)
        .border({ width: 1, color: appGlassBorderColor(this.isDark) })
        .shadow(appGlassShadow(this.isDark))
        .alignSelf(ItemAlign.Center)
        .opacity(this.historyLoading || this.connection !== 'connected' ? 0.5 : 1)
        .onClick(() => {
          this.loadHistory(true);
        })
    }

    if (this.historyPruned && this.historyNext.length === 0) {
      Column({ space: 3 }) {
        Text('更早的运行记录已清理').fontSize(11.5).fontColor(this.subColor())
        if (this.historyRetention.length > 0) {
          Text(this.historyRetention).fontSize(11.5).fontColor(this.subColor())
        }
        Text('清理记录不影响任务继续运行。').fontSize(11.5).fontColor(this.subColor())
      }
      .width('100%')
      .alignItems(HorizontalAlign.Start)
    }
  }

  @Builder
  historyRow(row: ScheduleHistoryRow) {
    Row({ space: 10 }) {
      Column()
        .width(7)
        .height(7)
        .borderRadius(3.5)
        .border({ width: 1.5, color: this.accent() })
        .margin({ top: 5 })
      Column({ space: 6 }) {
        Text(row.dateLabel)
          .fontSize(13.5)
          .fontWeight(FontWeight.Medium)
          .fontColor(this.textColor())
        if (row.prompt.length > 0) {
          Text(row.prompt)
            .fontSize(12.5)
            .fontColor(this.subColor())
            .lineHeight(19)
            .maxLines(row.expanded ? 999 : 3)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
            .width('100%')
          Text(row.expanded ? '收起' : '展开')
            .fontSize(12)
            .fontColor(this.accent())
            .onClick(() => {
              this.toggleHistoryExpanded(row);
            })
        }
      }
      .layoutWeight(1)
      .alignItems(HorizontalAlign.Start)
      .padding({ bottom: 12 })
      .border({ width: { bottom: 0.5 }, color: this.lineColor() })
    }
    .width('100%')
    .alignItems(VerticalAlign.Top)
  }

  @Builder
  detailFooter() {
    Row({ space: 12 }) {
      Text('删除任务')
        .fontSize(14)
        .fontColor(this.dangerColor())
        .opacity(this.connection === 'connected' && this.busyId.length === 0 ? 1 : 0.4)
        .onClick(() => {
          this.confirmDelete();
        })
      Blank()
      Text('编辑规则')
        .fontSize(14)
        .fontWeight(FontWeight.Medium)
        .fontColor(this.isDark ? '#F1F4FA' : this.accent())
        .backgroundColor(appGlassFill(this.isDark))
        .backdropBlur(appGlassBlur(this.isDark))
        .padding({ left: 18, right: 18, top: 9, bottom: 9 })
        .borderRadius(17)
        .clip(true)
        .border({ width: 1, color: appGlassBorderColor(this.isDark) })
        .shadow(appGlassShadow(this.isDark))
        .opacity(this.selectedTask() !== undefined && (this.selectedTask() as ScheduleTask).status === 'active' &&
          this.connection === 'connected' && this.busyId.length === 0 ? 1 : 0.4)
        .onClick(() => {
          this.startEdit();
        })
    }
    .width('100%')
    .padding({ left: 16, right: 16, top: 10, bottom: 10 })
    .border({ width: { top: 0.5 }, color: this.lineColor() })
  }

  // ───────────── UI：编辑弹层 ─────────────
  @Builder
  editHeader() {
    Row() {
      Text('编辑自动化任务')
        .fontSize(17)
        .fontWeight(FontWeight.Medium)
        .fontColor(this.textColor())
        .layoutWeight(1)
      Text('×')
        .fontSize(22)
        .fontColor(this.dangerColor())
        .width(30)
        .height(30)
        .textAlign(TextAlign.Center)
        .opacity(this.editSaving ? 0.4 : 1)
        .onClick(() => {
          this.cancelEdit();
        })
    }
    .width('100%')
    .padding({ left: 16, right: 16, top: 6, bottom: 10 })
  }

  @Builder
  editForm() {
    Scroll() {
      Column({ space: 8 }) {
        this.fieldLabel('任务名称')
        TextInput({ text: this.editTitle, placeholder: '最多 120 个字符' })
          .maxLength(120)
          .fontSize(14)
          .fontColor(this.textColor())
          .placeholderColor(this.subColor())
          .backgroundColor(this.cardBg())
          .border({ width: 0.5, color: this.lineColor() })
          .borderRadius(10)
          .height(40)
          .padding({ left: 10, right: 10 })
          .enabled(!this.editSaving)
          .onChange((value: string) => {
            this.editTitle = value;
            this.syncDraftValidation();
          })

        this.fieldLabel('任务内容')
        TextArea({ text: this.editPrompt, placeholder: '希望 Agent 执行的内容' })
          .fontSize(14)
          .fontColor(this.textColor())
          .placeholderColor(this.subColor())
          .backgroundColor(this.cardBg())
          .border({ width: 0.5, color: this.lineColor() })
          .borderRadius(10)
          .height(96)
          .padding(10)
          .enabled(!this.editSaving)
          .onChange((value: string) => {
            this.editPrompt = value;
            this.syncDraftValidation();
          })

        this.fieldLabel('运行时间')
        // 重复方式
        Row() {
          Text('重复').fontSize(14).fontColor(this.textColor())
          Blank()
          Text(this.ruleTitle())
            .fontSize(14)
            .fontColor(this.accent())
          Text(' ⌄').fontSize(12).fontColor(this.accent())
        }
        .width('100%')
        .height(42)
        .padding({ left: 10, right: 10 })
        .border({ width: 0.5, color: this.lineColor() })
        .borderRadius(10)
        .enabled(!this.editSaving)
        .bindMenu(this.ruleMenuOpen, this.ruleMenu(), {
          placement: Placement.Bottom,
          offset: { x: 0, y: 4 },
          onWillDisappear: () => {
            this.ruleMenuOpen = false;
          },
          onDisappear: () => {
            this.ruleMenuOpen = false;
          }
        })
        .onClick(() => {
          this.ruleMenuOpen = !this.ruleMenuOpen;
        })

        if (this.editKind === SCHEDULE_RULE_AT) {
          Row() {
            Text('日期').fontSize(14).fontColor(this.textColor())
            Blank()
            Text(this.editDate).fontSize(14).fontColor(this.accent())
          }
          .width('100%')
          .height(42)
          .padding({ left: 10, right: 10 })
          .border({ width: 0.5, color: this.lineColor() })
          .borderRadius(10)
          .enabled(!this.editSaving)
          .onClick(() => {
            this.showDatePicker();
          })
        }

        if (this.editKind === SCHEDULE_RULE_EVERY) {
          Row({ space: 8 }) {
            TextInput({ text: this.editInterval, placeholder: '间隔' })
              .type(InputType.Number)
              .fontSize(14)
              .fontColor(this.textColor())
              .placeholderColor(this.subColor())
              .backgroundColor(this.cardBg())
              .border({ width: 0.5, color: this.lineColor() })
              .borderRadius(10)
              .height(42)
              .padding({ left: 10, right: 10 })
              .layoutWeight(1)
              .enabled(!this.editSaving)
              .onChange((value: string) => {
                this.editInterval = value;
                this.syncDraftValidation();
              })
            Row() {
              Text(SCHEDULE_INTERVAL_UNIT_TITLES[this.editUnitIndex] + ' ⌄')
                .fontSize(14)
                .fontColor(this.accent())
            }
            .height(42)
            .padding({ left: 12, right: 12 })
            .border({ width: 0.5, color: this.lineColor() })
            .borderRadius(10)
            .enabled(!this.editSaving)
            .bindMenu(this.unitMenuOpen, this.unitMenu(), {
              placement: Placement.Bottom,
              offset: { x: 0, y: 4 },
              onWillDisappear: () => {
                this.unitMenuOpen = false;
              },
              onDisappear: () => {
                this.unitMenuOpen = false;
              }
            })
            .onClick(() => {
              this.unitMenuOpen = !this.unitMenuOpen;
            })
          }
          .width('100%')
          this.hintText('至少 60 秒。间隔从创建或上次修改规则时起计，不受时区影响。')
        } else if (this.editKind === SCHEDULE_RULE_CRON) {
          TextInput({ text: this.editExpression, placeholder: '0 9 * * 1-5' })
            .fontSize(14)
            .fontColor(this.textColor())
            .placeholderColor(this.subColor())
            .backgroundColor(this.cardBg())
            .border({ width: 0.5, color: this.lineColor() })
            .borderRadius(10)
            .height(42)
            .padding({ left: 10, right: 10 })
            .enabled(!this.editSaving)
            .onChange((value: string) => {
              this.editExpression = value;
              this.syncDraftValidation();
            })
          this.hintText('5 字段 Cron：分钟、小时、日、月、星期。')
        } else {
          this.fieldLabel('执行时刻')
          TextInput({ text: this.editTime, placeholder: '09:00:00' })
            .maxLength(8)
            .fontSize(14)
            .fontColor(this.textColor())
            .placeholderColor(this.subColor())
            .backgroundColor(this.cardBg())
            .border({ width: 0.5, color: this.lineColor() })
            .borderRadius(10)
            .height(42)
            .padding({ left: 10, right: 10 })
            .enabled(!this.editSaving)
            .onChange((value: string) => {
              this.editTime = value;
              this.syncDraftValidation();
            })
        }

        if (this.editKind === SCHEDULE_RULE_WEEKLY) {
          Row({ space: 5 }) {
            ForEach([1, 2, 3, 4, 5, 6, 7], (day: number) => {
              Text(weekDayShortName(day))
                .fontSize(11)
                .fontWeight(this.weekSelected(day) ? FontWeight.Medium : FontWeight.Normal)
                .fontColor(this.weekSelected(day) ? this.accent() : this.textColor())
                .backgroundColor(this.weekSelected(day) ? this.accentBg() : this.softColor())
                .layoutWeight(1)
                .height(34)
                .textAlign(TextAlign.Center)
                .borderRadius(8)
                .enabled(!this.editSaving)
                .onClick(() => {
                  this.pickWeekday(day);
                })
            }, (day: number) => day.toString())
          }
          .width('100%')
        }

        if (this.editKind !== SCHEDULE_RULE_EVERY) {
          this.fieldLabel('时区')
          TextInput({ text: this.editZone, placeholder: 'Asia/Shanghai' })
            .fontSize(14)
            .fontColor(this.textColor())
            .placeholderColor(this.subColor())
            .backgroundColor(this.cardBg())
            .border({ width: 0.5, color: this.lineColor() })
            .borderRadius(10)
            .height(42)
            .padding({ left: 10, right: 10 })
            .enabled(!this.editSaving)
            .onChange((value: string) => {
              this.editZone = value;
              this.syncDraftValidation();
            })
          this.hintText('按此 IANA 时区解释时间。主机将校验时区、夏令时和未来执行时间。')
        }

        if (this.editError.length > 0) {
          Text(this.editError)
            .fontSize(12.5)
            .fontColor(this.dangerColor())
            .width('100%')
            .padding({ top: 4 })
        }
      }
      .width('100%')
      .alignItems(HorizontalAlign.Start)
      .padding({ left: 16, right: 16, top: 4, bottom: 16 })
    }
    .layoutWeight(1)
    .width('100%')
    .align(Alignment.Top)
    .scrollBar(BarState.Off)
    .edgeEffect(EdgeEffect.None)
  }

  private ruleTitle(): string {
    if (this.editRuleIndex >= 0 && this.editRuleIndex < SCHEDULE_RULES.length) {
      return SCHEDULE_RULES[this.editRuleIndex].title;
    }
    return '仅一次';
  }

  @Builder
  ruleMenu() {
    Menu() {
      ForEach(SCHEDULE_RULES, (item: ScheduleRuleOption, index: number) => {
        MenuItem(this.menuOptionRow(item.title, index === this.editRuleIndex)).onClick(() => {
          this.pickRule(index);
          this.ruleMenuOpen = false;
        })
      }, (item: ScheduleRuleOption) => item.id)
    }
  }

  @Builder
  unitMenu() {
    Menu() {
      ForEach(SCHEDULE_INTERVAL_UNIT_TITLES, (title: string, index: number) => {
        MenuItem(this.menuOptionRow(title, index === this.editUnitIndex)).onClick(() => {
          this.pickUnit(index);
          this.unitMenuOpen = false;
        })
      }, (title: string) => title)
    }
  }

  @Builder
  menuOptionRow(label: string, selected: boolean) {
    Row({ space: 10 }) {
      Text(selected ? '✓' : '').fontSize(14).fontColor(this.textColor()).width(16)
      Text(label).fontSize(15).fontColor(this.textColor())
    }
    .width(160)
    .height(40)
  }

  @Builder
  fieldLabel(text: string) {
    Text(text)
      .fontSize(13)
      .fontWeight(FontWeight.Medium)
      .fontColor(this.textColor())
      .margin({ top: 6 })
  }

  @Builder
  hintText(text: string) {
    Text(text)
      .fontSize(11.5)
      .fontColor(this.subColor())
      .width('100%')
      .lineHeight(17)
  }

  @Builder
  editFooter() {
    Row({ space: 10 }) {
      Text('取消')
        .fontSize(14)
        .fontColor(this.subColor())
        .layoutWeight(1)
        .height(38)
        .textAlign(TextAlign.Center)
        .borderRadius(19)
        .backgroundColor(appGlassFill(this.isDark))
        .backdropBlur(appGlassBlur(this.isDark))
        .clip(true)
        .border({ width: 1, color: appGlassBorderColor(this.isDark) })
        .shadow(appGlassShadow(this.isDark))
        .opacity(this.editSaving ? 0.4 : 1)
        .onClick(() => {
          this.cancelEdit();
        })
      Text(this.editSaving ? '保存中…' : '保存修改')
        .fontSize(14)
        .fontWeight(FontWeight.Medium)
        .fontColor(this.isDark ? '#F1F4FA' : this.accent())
        .layoutWeight(1)
        .height(38)
        .textAlign(TextAlign.Center)
        .borderRadius(19)
        .backgroundColor(appGlassFill(this.isDark))
        .backdropBlur(appGlassBlur(this.isDark))
        .clip(true)
        .border({ width: 1, color: appGlassBorderColor(this.isDark) })
        .shadow(appGlassShadow(this.isDark))
        .opacity(this.editCanSave && !this.editSaving && this.connection === 'connected' ? 1 : 0.4)
        .onClick(() => {
          this.saveEdit();
        })
    }
    .width('100%')
    .padding({ left: 16, right: 16, top: 10, bottom: 10 })
    .border({ width: { top: 0.5 }, color: this.lineColor() })
  }

  // ───────────── build ─────────────
  private scroller: Scroller = new Scroller();

  build() {
    HdsNavDestination() {
      Column() {
        // 首屏让出原生标题栏
        Column().width('100%').height((this.safeTopStorage > 0 ? this.safeTopStorage : 38.9) + 56)
        this.searchToolbar()
        if (this.connection !== 'connected') {
          Text('网关未连接，连接后可查看和管理自动化任务')
            .fontSize(12)
            .fontColor(this.isDark ? '#FFB05C' : '#B26A00')
            .width('100%')
            .padding({ left: 12, right: 12, top: 9, bottom: 9 })
            .borderRadius(9)
            .backgroundColor(this.isDark ? 'rgba(255,149,0,0.12)' : 'rgba(255,149,0,0.10)')
            .margin({ left: 16, right: 16, bottom: 6 })
        }
        Refresh({ refreshing: $$this.refreshing }) {
          Scroll(this.scroller) {
            Column({ space: 10 }) {
              if (this.loading && this.tasks.length === 0) {
                this.loadingState()
              } else if (this.error.length > 0 && this.tasks.length === 0) {
                this.errorState()
              } else if (this.tasks.length === 0) {
                this.emptyState()
              } else {
                if (this.error.length > 0) {
                  this.noticeRow(this.error + '；当前显示上次读取的任务。')
                }
                if (this.visibleTasks().length === 0) {
                  Text(this.statusFilter === 'inactive' && this.search.trim().length === 0
                    ? '没有已结束的自动化任务'
                    : '没有匹配的自动化任务')
                    .fontSize(13)
                    .fontColor(this.subColor())
                    .width('100%')
                    .padding({ top: 40, bottom: 40 })
                    .textAlign(TextAlign.Center)
                }
                ForEach(this.visibleTasks(), (task: ScheduleTask) => {
                  this.taskRow(task)
                }, (task: ScheduleTask) => task.id + task.status)
              }
            }
            .width('100%')
            .alignItems(HorizontalAlign.Start)
            .padding({ left: 16, right: 16, top: 4, bottom: 28 })
          }
          .width('100%')
          .height('100%')
          .scrollBar(BarState.Off)
          .edgeEffect(EdgeEffect.None)
          .align(Alignment.Top)
          // 平板/宽屏：设置内容居中一栏（对齐 iOS iPad 设置页）
          .constraintSize({ maxWidth: SETTINGS_MAX_WIDTH })
        }
        .layoutWeight(1)
        .width('100%')
        .onRefreshing(() => {
          this.onRefresh();
        })
      }
      .width('100%')
      .height('100%')
      .backgroundColor(this.pageBg())
      .bindSheet($$this.sheetOpen, this.sheetContent(), {
        height: '88%',
        dragBar: false,
        showClose: false,
        preferType: SheetType.BOTTOM,
        backgroundColor: this.sheetMaterial() !== undefined ? Color.Transparent : (this.isDark ? '#1C1C1E' : '#F7F8FA'),
        systemMaterial: this.sheetMaterial(),
        onDisappear: () => {
          if (!this.editing) {
            this.closeSheet();
          }
        }
      })
    }
    .titleBar({
      avoidLayoutSafeArea: true,
      content: { title: { mainTitle: '自动化任务' } },
      style: {
        scrollEffectOpts: {
          enableScrollEffect: true,
          scrollEffectType: ScrollEffectType.GRADIENT_BLUR
        },
        systemMaterialEffect: {
          materialType: hdsMaterial.MaterialType.IMMERSIVE,
          materialLevel: hdsMaterial.MaterialLevel.ADAPTIVE
        },
        originalStyle: { contentStyle: { titleStyle: { mainTitleColor: $r('sys.color.font_primary') }, menuStyle: { iconColor: $r('sys.color.icon_primary'), backgroundColor: $r('sys.color.comp_background_tertiary') } } },
        scrollEffectStyle: { contentStyle: { titleStyle: { mainTitleColor: $r('sys.color.font_primary') }, menuStyle: { iconColor: $r('sys.color.icon_primary'), backgroundColor: $r('sys.color.comp_background_tertiary') } } }
      }
    })
    .bindToScrollable([this.scroller])
    .backgroundColor(this.pageBg())
    .onShown(() => {
      if (this.loadedOnce && this.connection === 'connected') {
        this.refresh(true);
      }
    })
  }
}
