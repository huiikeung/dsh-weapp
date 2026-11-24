/**
 * Bot 角色管理（对齐 iOS BotRoleSheet / BotRoleSettings，docs/bot-mode-ios-spec.md §7.5-7.8、§8）：
 * 只读资料（模型/权限/工作文件夹/近 30 天用量）→ 角色设置（名字/标签/说明/模型/推理强度/工作文件夹/权限/隐私）
 * → 记忆 → 定时任务 → 管理（复制一份 / 设为主 Bot / 删除 Bot）。
 * 视觉使用 Bot 颜色 token（BotInk/BotCard/BotGroupedSurface/BotLine/BotPurple/BotLavenderSoft），
 * 卡片 16 圆角 + 1px 描边、深浅两套，不使用 Material 风格。
 */
import {
  BotChat, BotMemory, BotRoleOption, BotRoleProfile, BotSchedule, BotSnapshot, BotStore, emptyBotSnapshot
} from 'nativecore';
import i18n from '@ohos.i18n';

/** Bot 视觉 token（§8.1，浅色/深色两套）。 */
function inkColor(dark: boolean): string {
  return dark ? '#F2EEF6' : '#252332';
}

function secondaryColor(dark: boolean): string {
  return dark ? '#D8D2E1' : '#5C536C';
}

function cardColor(dark: boolean): string {
  return dark ? '#292733' : '#FFFFFF';
}

function groupedColor(dark: boolean): string {
  return dark ? '#211F2A' : '#F2F2F7';
}

function lineColor(dark: boolean): string {
  return dark ? '#484354' : '#DAD6E3';
}

function purpleColor(dark: boolean): string {
  return dark ? '#C8B5E8' : '#7760B4';
}

function lavenderSoftColor(dark: boolean): string {
  return dark ? '#333044' : '#ECE7F7';
}

function dangerColor(): string {
  return '#D9534F';
}

/** 千分位格式化（用量展示，避免依赖 Intl）。 */
function groupDigits(value: number): string {
  const rounded: number = Math.round(value);
  const negative: boolean = rounded < 0;
  let digits: string = Math.abs(rounded).toString();
  let grouped: string = '';
  while (digits.length > 3) {
    grouped = ',' + digits.substring(digits.length - 3) + grouped;
    digits = digits.substring(0, digits.length - 3);
  }
  grouped = digits + grouped;
  return negative ? '-' + grouped : grouped;
}

@Component
export struct BotRolePage {
  @Consume('pageStack') pageStack: NavPathStack;
  @StorageLink('isDark') isDark: boolean = false;
  @StorageLink('safeTopVp') safeTop: number = 0;
  @StorageLink('safeBottomVp') safeBottom: number = 0;
  @StorageLink('botState') @Watch('onState') state: BotSnapshot = emptyBotSnapshot();

  // ── 表单字段 ──
  @State name: string = '';
  @State role: string = '';
  @State instructions: string = '';
  @State workDir: string = '';
  @State model: string = '';
  @State effort: string = '';
  @State permission: string = '';
  @State privateRole: boolean = false;
  @State loaded: boolean = false;
  @State routeId: string = '';
  @State openModels: boolean = false;

  // ── 写操作状态 ──
  @State pendingKind: string = '';
  @State errorBefore: string = '';
  @State opError: string = '';
  @State awaitResync: boolean = false;

  // ── 记忆编辑 ──
  @State memoryEditing: boolean = false;
  @State editingMemory: string = '';
  @State editingText: string = '';

  // ── 新建定时任务 ──
  @State showScheduleForm: boolean = false;
  @State scheduleTitle: string = '';
  @State schedulePrompt: string = '';
  @State scheduleTime: string = '';

  aboutToAppear(): void {
    this.scheduleTime = this.nowTime();
    const chat: BotChat | null = this.bot();
    if (chat !== null) {
      BotStore.get().openRole(chat.id);
      this.syncFrom(chat);
    }
  }

  onState(): void {
    if (this.pendingKind.length > 0) {
      if (this.state.roleSaving) {
        return;
      }
      this.settleWrite();
      return;
    }
    const chat: BotChat | null = this.bot();
    if (chat === null) {
      return;
    }
    this.ensureRoleOpen();
    if (!this.loaded && chat.profile !== undefined) {
      this.syncFrom(chat);
    }
    if (this.awaitResync && !this.state.roleSaving && !this.hasChanges()) {
      this.awaitResync = false;
    }
  }

  // ==================== 数据读取 ====================

  private botId(): string {
    if (this.routeId.length > 0) {
      return this.routeId;
    }
    return this.state.roleDetails !== undefined ? this.state.roleDetails.botId : '';
  }

  private bot(): BotChat | null {
    const id: string = this.botId();
    if (id.length === 0) {
      return null;
    }
    for (const chat of this.state.chats) {
      if (chat.id === id && !chat.room) {
        return chat;
      }
    }
    return null;
  }

  private profile(): BotRoleProfile | undefined {
    const chat: BotChat | null = this.bot();
    if (chat === null) {
      return undefined;
    }
    return chat.profile;
  }

  private isMainBot(): boolean {
    const id: string = this.botId();
    return id.length > 0 && BotStore.get().isMainBot(id);
  }

  private ensureRoleOpen(): void {
    const id: string = this.botId();
    if (id.length === 0) {
      return;
    }
    if (this.state.roleDetails === undefined || this.state.roleDetails.botId !== id) {
      BotStore.get().openRole(id);
    }
  }

  private syncFrom(chat: BotChat): void {
    const profile: BotRoleProfile | undefined = chat.profile;
    if (profile === undefined) {
      return;
    }
    this.name = chat.name;
    this.role = chat.role;
    this.instructions = profile.instructions;
    this.workDir = profile.workDir ?? '';
    this.model = profile.model ?? '';
    this.effort = profile.effort ?? '';
    this.permission = profile.permission ?? '';
    this.privateRole = profile.privateRole;
    this.loaded = true;
    this.loadEffortsForCurrent();
  }

  private loadEffortsForCurrent(): void {
    const profile: BotRoleProfile | undefined = this.profile();
    let ref: string = this.model;
    if (ref.length === 0 && profile !== undefined && profile.appliedModel !== undefined) {
      ref = profile.appliedModel;
    }
    if (ref.length === 0) {
      ref = this.state.defaultModel ?? '';
    }
    if (ref.length > 0) {
      BotStore.get().loadEfforts(ref);
    }
  }

  private modelTitle(id: string): string {
    if (id.length === 0) {
      return '默认模型';
    }
    for (const option of this.state.models) {
      if (option.id === id) {
        return option.title;
      }
    }
    return id;
  }

  private permissionTitle(id: string): string {
    if (id.length === 0) {
      return '默认权限';
    }
    for (const option of this.state.permissions) {
      if (option.id === id) {
        return option.title;
      }
    }
    return id;
  }

  private effortTitle(id: string): string {
    if (id.length === 0) {
      return '默认';
    }
    for (const option of this.state.efforts) {
      if (option.id === id) {
        return option.title;
      }
    }
    return id;
  }

  private overviewModel(): string {
    const profile: BotRoleProfile | undefined = this.profile();
    if (profile !== undefined) {
      if (profile.model !== undefined && profile.model.length > 0) {
        return this.modelTitle(profile.model);
      }
      if (profile.appliedModel !== undefined && profile.appliedModel.length > 0) {
        return this.modelTitle(profile.appliedModel);
      }
    }
    const fallback: string = this.state.defaultModel ?? '';
    return fallback.length > 0 ? this.modelTitle(fallback) : '默认模型';
  }

  private overviewPermission(): string {
    const profile: BotRoleProfile | undefined = this.profile();
    if (profile !== undefined && profile.permission !== undefined && profile.permission.length > 0) {
      return this.permissionTitle(profile.permission);
    }
    return '默认权限';
  }

  private overviewWorkDir(): string {
    const profile: BotRoleProfile | undefined = this.profile();
    if (profile !== undefined && profile.workDir !== undefined && profile.workDir.length > 0) {
      return profile.workDir;
    }
    return '总工作区';
  }

  private usageAvailable(): boolean {
    const details = this.state.roleDetails;
    if (details === undefined) {
      return false;
    }
    return details.inputTokens !== undefined && details.outputTokens !== undefined;
  }

  private usageText(): string {
    const details = this.state.roleDetails;
    if (details === undefined || details.inputTokens === undefined || details.outputTokens === undefined) {
      return '';
    }
    return groupDigits(details.inputTokens + details.outputTokens) + ' tokens';
  }

  /** 已应用模型与期望不一致时提示「更改从下一条消息生效」。 */
  private appliedModelHint(): string {
    const profile: BotRoleProfile | undefined = this.profile();
    if (profile === undefined || profile.appliedModel === undefined) {
      return '';
    }
    const desired: string = this.model;
    if (desired.length === 0 || desired === profile.appliedModel) {
      return '';
    }
    return '当前生效：' + this.modelTitle(profile.appliedModel) + '，更改从下一条消息开始生效';
  }

  private appliedEffortHint(): string {
    const profile: BotRoleProfile | undefined = this.profile();
    if (profile === undefined || profile.appliedEffort === undefined) {
      return '';
    }
    const desired: string = this.effort;
    if (desired.length === 0 || desired === profile.appliedEffort) {
      return '';
    }
    return '当前生效：' + this.effortTitle(profile.appliedEffort) + '，更改从下一条消息开始生效';
  }

  private selectedModelLabel(): string {
    return this.model.length > 0 ? this.modelTitle(this.model) : '默认模型';
  }

  private modelUnknown(): boolean {
    if (this.model.length === 0) {
      return false;
    }
    for (const option of this.state.models) {
      if (option.id === this.model) {
        return false;
      }
    }
    return true;
  }

  private effortUnknown(): boolean {
    if (this.effort.length === 0) {
      return false;
    }
    for (const option of this.state.efforts) {
      if (option.id === this.effort) {
        return false;
      }
    }
    return true;
  }

  private permissionUnknown(): boolean {
    if (this.permission.length === 0) {
      return false;
    }
    for (const option of this.state.permissions) {
      if (option.id === this.permission) {
        return false;
      }
    }
    return true;
  }

  private showEfforts(): boolean {
    return this.state.efforts.length > 0 || this.effort.length > 0;
  }

  private inGroupChat(): boolean {
    const id: string = this.botId();
    if (id.length === 0) {
      return false;
    }
    for (const chat of this.state.chats) {
      if (chat.room && chat.memberIds.indexOf(id) >= 0) {
        return true;
      }
    }
    return false;
  }

  private privacyHint(): string {
    if (!this.privateRole) {
      if (this.isMainBot()) {
        return '主 Bot 不能开启隐私。';
      }
      if (this.inGroupChat()) {
        return '将此 Bot 移出所有群聊后，才能开启隐私。';
      }
      if (this.workDir.trim().length === 0) {
        return '开启隐私前，请为此 Bot 设置独立的工作文件夹。';
      }
    }
    return '开启后，其他 Bot 无法读取它的工作文件夹、记忆和对话。向其他 Bot 分享内容需你批准。';
  }

  private memories(): BotMemory[] {
    const details = this.state.roleDetails;
    return details !== undefined ? details.memories : [];
  }

  private mySchedules(): BotSchedule[] {
    const out: BotSchedule[] = [];
    const id: string = this.botId();
    for (const task of this.state.schedules) {
      if (task.botId === id) {
        out.push(task);
      }
    }
    return out;
  }

  // ==================== 编辑可用性 / 脏检查 ====================

  private editable(): boolean {
    return this.state.connected && this.state.roleSettingsSupported
      && this.state.writable && !this.state.roleSaving;
  }

  private memoryEditable(): boolean {
    return this.editable() && this.state.memoryAvailable;
  }

  private scheduleEditable(): boolean {
    return this.editable() && this.state.schedulesAvailable;
  }

  private collectChanges(): Record<string, Object> {
    const changes: Record<string, Object> = {};
    const chat: BotChat | null = this.bot();
    if (chat === null) {
      return changes;
    }
    const trimmedName: string = this.name.trim();
    if (trimmedName !== chat.name) {
      changes['name'] = trimmedName;
    }
    if (this.role !== chat.role) {
      changes['role'] = this.role;
    }
    const profile: BotRoleProfile | undefined = chat.profile;
    if (profile === undefined) {
      return changes;
    }
    if (this.instructions !== profile.instructions) {
      changes['instructions'] = this.instructions;
    }
    if (this.model.length > 0 && this.model !== (profile.model ?? '')) {
      changes['model'] = this.model;
    }
    if (this.effort.length > 0 && this.effort !== (profile.effort ?? '')) {
      changes['effort'] = this.effort;
    }
    const trimmedWorkDir: string = this.workDir.trim();
    if (trimmedWorkDir.length > 0 && trimmedWorkDir !== (profile.workDir ?? '')) {
      changes['workDir'] = trimmedWorkDir;
    }
    if (this.permission.length > 0 && this.permission !== (profile.permission ?? '')) {
      changes['permission'] = this.permission;
    }
    if (this.privateRole !== profile.privateRole) {
      changes['private'] = this.privateRole;
    }
    return changes;
  }

  private hasChanges(): boolean {
    return Object.keys(this.collectChanges()).length > 0;
  }

  private canSave(): boolean {
    if (!this.editable()) {
      return false;
    }
    if (this.name.trim().length === 0) {
      return false;
    }
    return this.hasChanges();
  }

  /** 权限改为 danger-full-access 时需要二次确认。 */
  private dangerousPermissionChange(): boolean {
    if (this.permission !== 'danger-full-access') {
      return false;
    }
    const profile: BotRoleProfile | undefined = this.profile();
    if (profile === undefined) {
      return false;
    }
    return profile.permission !== 'danger-full-access';
  }

  // ==================== 保存 ====================

  private requestSave(): void {
    if (!this.canSave()) {
      return;
    }
    const changes: Record<string, Object> = this.collectChanges();
    if (Object.keys(changes).length === 0) {
      return;
    }
    if (this.dangerousPermissionChange()) {
      AlertDialog.show({
        title: '确认授予完全权限？',
        message: '允许修改工作区以外的文件，范围仍受主机系统权限限制。',
        autoCancel: true,
        primaryButton: {
          value: '取消',
          action: () => {
          }
        },
        secondaryButton: {
          value: '确认',
          fontColor: dangerColor(),
          action: () => {
            this.saveNow(changes);
          }
        }
      });
      return;
    }
    this.saveNow(changes);
  }

  private saveNow(changes: Record<string, Object>): void {
    this.beginWrite('save');
    const ok: boolean = BotStore.get().updateRole(this.botId(), changes);
    if (!ok) {
      this.pendingKind = '';
      this.opError = '保存失败：当前不可编辑，或主机未连接';
      return;
    }
    this.awaitResync = true;
  }

  private beginWrite(kind: string): void {
    this.pendingKind = kind;
    this.errorBefore = this.state.error ?? '';
    this.opError = '';
  }

  private settleWrite(): void {
    const kind: string = this.pendingKind;
    const code: string = this.writeErrorCode();
    this.pendingKind = '';
    if (code.length > 0) {
      this.awaitResync = false;
      this.opError = this.roleErrorText(code);
      return;
    }
    this.showToast(this.successText(kind));
  }

  private writeErrorCode(): string {
    const roleError: string = this.state.roleError ?? '';
    if (roleError.length > 0) {
      return roleError;
    }
    const generic: string = this.state.error ?? '';
    return generic !== this.errorBefore ? generic : '';
  }

  private successText(kind: string): string {
    if (kind === 'schedule') {
      return '已创建定时任务';
    }
    if (kind === 'forget') {
      return '已删除记忆';
    }
    if (kind === 'schedule-delete') {
      return '已删除定时任务';
    }
    if (kind === 'copy') {
      return '已复制一份';
    }
    if (kind === 'main') {
      return '已设为主 Bot';
    }
    return '已保存';
  }

  private errorText(): string {
    const roleError: string = this.state.roleError ?? '';
    if (roleError.length > 0) {
      return this.roleErrorText(roleError);
    }
    return this.opError;
  }

  /** §9.8 botErrorText（角色写操作复用）。 */
  private roleErrorText(code: string): string {
    if (code === 'bot-unavailable' || code === 'bot/not-found') {
      return '主机上的 DS-Bot 尚未启用，或版本暂不支持';
    }
    if (code === 'bot-version-unsupported') {
      return '请更新主机上的 DS-Bot';
    }
    if (code === 'not-connected' || code === 'disconnected' || code === 'connection-lost') {
      return '主机连接已断开，重连后将同步聊天';
    }
    if (code === 'bot/main-protected') {
      return '主 Bot 不能删除。';
    }
    if (code === 'bot-delete-failed') {
      return '暂时无法删除此 Bot，请稍后重试。';
    }
    if (code === 'bot-delete-unconfirmed') {
      return '尚未确认删除结果，请重新同步后核对。';
    }
    if (code === 'bot-timeout') {
      return '同步超时，请稍后重试；发送中的消息请先核对';
    }
    if (code === 'invalid-name') {
      return '名称不合法';
    }
    if (code === 'duplicate-name') {
      return '已有同名 Bot';
    }
    if (code === 'forbidden' || code === 'permission-denied' || code === 'not-authorized') {
      return '当前账号没有修改权限';
    }
    if (code.length === 0) {
      return '';
    }
    return '操作失败：' + code;
  }

  private showToast(message: string): void {
    try {
      this.getUIContext().getPromptAction().showToast({ message: message, duration: 2000 });
    } catch (error) {
    }
  }

  private dismissKeyboard(): void {
    try {
      this.getUIContext().getFocusController().clearFocus();
    } catch (error) {
    }
  }

  // ==================== 记忆 ====================

  private confirmForgetMemory(memory: BotMemory): void {
    AlertDialog.show({
      title: '删除这条记忆？',
      message: '删除后 Bot 将不再记得这条内容。',
      autoCancel: true,
      primaryButton: {
        value: '取消',
        action: () => {
        }
      },
      secondaryButton: {
        value: '删除',
        fontColor: dangerColor(),
        action: () => {
          this.forgetMemoryNow(memory);
        }
      }
    });
  }

  private forgetMemoryNow(memory: BotMemory): void {
    this.beginWrite('forget');
    const ok: boolean = BotStore.get().forgetMemory(this.botId(), memory.id);
    if (!ok) {
      this.pendingKind = '';
      this.opError = '删除失败：当前不可编辑，或主机未连接';
    }
  }

  private saveMemoryDraft(): void {
    if (!this.memoryEditable()) {
      return;
    }
    const text: string = this.editingText.trim();
    if (text.length === 0) {
      return;
    }
    const entryId: string | undefined = this.editingMemory.length > 0 ? this.editingMemory : undefined;
    this.beginWrite('memory');
    const ok: boolean = BotStore.get().saveMemory(this.botId(), entryId, text);
    if (!ok) {
      this.pendingKind = '';
      this.opError = '保存失败：当前不可编辑，或主机未连接';
      return;
    }
    this.memoryEditing = false;
    this.editingMemory = '';
    this.editingText = '';
  }

  private memoryEditorTitle(): string {
    return this.editingMemory.length > 0 ? '编辑记忆' : '添加记忆';
  }

  // ==================== 定时任务 ====================

  private pad2(value: number): string {
    return value < 10 ? '0' + value.toString() : value.toString();
  }

  private nowTime(): string {
    const now: Date = new Date();
    return this.pad2(now.getHours()) + ':' + this.pad2(now.getMinutes());
  }

  /** 设备本地时区（IANA）；取不到时退回 UTC 偏移串，不硬编码具体城市。 */
  private deviceZone(): string {
    try {
      const zone: string = i18n.getTimeZone().getID();
      if (zone.length > 0) {
        return zone;
      }
    } catch (error) {
    }
    const offset: number = -new Date().getTimezoneOffset();
    const sign: string = offset >= 0 ? '+' : '-';
    const abs: number = Math.abs(offset);
    return 'UTC' + sign + this.pad2(Math.floor(abs / 60)) + ':' + this.pad2(abs % 60);
  }

  private isTimeValid(value: string): boolean {
    if (value.length !== 5 || value.charAt(2) !== ':') {
      return false;
    }
    const hh: string = value.substring(0, 2);
    const mm: string = value.substring(3, 5);
    if (!this.isDigit(hh.charAt(0)) || !this.isDigit(hh.charAt(1))) {
      return false;
    }
    if (!this.isDigit(mm.charAt(0)) || !this.isDigit(mm.charAt(1))) {
      return false;
    }
    const hour: number = Number(hh);
    const minute: number = Number(mm);
    return hour >= 0 && hour < 24 && minute >= 0 && minute < 60;
  }

  private isDigit(value: string): boolean {
    const code: number = value.charCodeAt(0);
    return code >= 48 && code <= 57;
  }

  private scheduleValid(): boolean {
    return this.scheduleTitle.trim().length > 0
      && this.schedulePrompt.trim().length > 0
      && this.isTimeValid(this.scheduleTime);
  }

  private createSchedule(): void {
    if (!this.scheduleValid()) {
      return;
    }
    this.beginWrite('schedule');
    const ok: boolean = BotStore.get().scheduleDaily(this.botId(), this.scheduleTitle,
      this.schedulePrompt, this.scheduleTime, this.deviceZone());
    if (!ok) {
      this.pendingKind = '';
      this.opError = '创建失败：当前不可编辑，或主机未连接';
      return;
    }
    this.showScheduleForm = false;
    this.scheduleTitle = '';
    this.schedulePrompt = '';
    this.scheduleTime = this.nowTime();
  }

  private confirmDeleteSchedule(task: BotSchedule): void {
    AlertDialog.show({
      title: '删除这个定时任务？',
      message: '任务将停止触发，已创建的会话与消息仍保留。',
      autoCancel: true,
      primaryButton: {
        value: '取消',
        action: () => {
        }
      },
      secondaryButton: {
        value: '删除',
        fontColor: dangerColor(),
        action: () => {
          this.deleteScheduleNow(task);
        }
      }
    });
  }

  private deleteScheduleNow(task: BotSchedule): void {
    this.beginWrite('schedule-delete');
    const ok: boolean = BotStore.get().deleteSchedule(this.botId(), task.id);
    if (!ok) {
      this.pendingKind = '';
      this.opError = '删除失败：当前不可编辑，或主机未连接';
    }
  }

  // ==================== 管理动作 ====================

  private confirmCopyRole(): void {
    if (!this.editable()) {
      return;
    }
    AlertDialog.show({
      title: '复制这个角色？',
      message: '复制分工和模型，新 Bot 从空白记忆开始。',
      autoCancel: true,
      primaryButton: {
        value: '取消',
        action: () => {
        }
      },
      secondaryButton: {
        value: '复制一份',
        action: () => {
          this.copyRoleNow();
        }
      }
    });
  }

  private copyRoleNow(): void {
    this.beginWrite('copy');
    const ok: boolean = BotStore.get().duplicateRole(this.botId());
    if (!ok) {
      this.pendingKind = '';
      this.opError = '复制失败：当前不可编辑，或主机未连接';
    }
  }

  private confirmReplacePrimary(): void {
    if (!this.editable()) {
      return;
    }
    const current: string = this.state.mainBotId ?? '';
    if (current.length === 0) {
      this.opError = '主机未提供主 Bot，暂时无法更换';
      return;
    }
    AlertDialog.show({
      title: '更换主 Bot？',
      message: '设为主 Bot 后可以创建和修改团队 Bot，并管理群聊。',
      autoCancel: true,
      primaryButton: {
        value: '取消',
        action: () => {
        }
      },
      secondaryButton: {
        value: '确认',
        action: () => {
          this.replacePrimaryNow(current);
        }
      }
    });
  }

  private replacePrimaryNow(current: string): void {
    this.beginWrite('main');
    const ok: boolean = BotStore.get().replacePrimary(current, this.botId());
    if (!ok) {
      this.pendingKind = '';
      this.opError = '设为主 Bot 失败：该 Bot 可能已开启隐私，或主机未连接';
    }
  }

  private confirmDeleteBot(): void {
    if (!this.editable() || !this.state.botDeletionSupported || this.isMainBot()) {
      return;
    }
    const display: string = this.name.trim().length > 0 ? this.name.trim() : '这个 Bot';
    AlertDialog.show({
      title: '删除 Bot？',
      message: '将“' + display + '”移出团队和所在群聊。',
      autoCancel: true,
      primaryButton: {
        value: '取消',
        action: () => {
        }
      },
      secondaryButton: {
        value: '删除',
        fontColor: dangerColor(),
        action: () => {
          this.deleteBotNow();
        }
      }
    });
  }

  private deleteBotNow(): void {
    this.beginWrite('delete-bot');
    const ok: boolean = BotStore.get().deleteRole(this.botId());
    if (!ok) {
      this.pendingKind = '';
      this.opError = '删除失败：仅非主 Bot 且主机支持删除时可用';
      return;
    }
    this.showToast('已删除');
    this.pageStack.pop();
  }

  // ==================== 界面 ====================

  private topInset(): number {
    return this.safeTop > 0 ? this.safeTop : 38.9;
  }

  @Builder
  header() {
    Row({ space: 10 }) {
      Button({ type: ButtonType.Circle }) {
        Text('‹').fontSize(24).fontColor(inkColor(this.isDark)).offset({ y: -1 })
      }
      .width(36).height(36)
      .backgroundColor(lavenderSoftColor(this.isDark))
      .onClick(() => {
        this.pageStack.pop();
      })
      Text(this.name.length > 0 ? this.name : '角色资料')
        .fontSize(20)
        .fontWeight(FontWeight.Medium)
        .fontColor(inkColor(this.isDark))
        .layoutWeight(1)
        .maxLines(1)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
      if (this.state.roleSaving) {
        LoadingProgress().width(20).height(20).color(purpleColor(this.isDark)).margin({ right: 10 })
      } else {
        Button('保存')
          .type(ButtonType.Normal)
          .fontSize(14)
          .fontWeight(FontWeight.Medium)
          .fontColor(this.canSave() ? purpleColor(this.isDark) : secondaryColor(this.isDark))
          .backgroundColor(lavenderSoftColor(this.isDark))
          .borderRadius(16)
          .height(32)
          .padding({ left: 14, right: 14 })
          .enabled(this.canSave())
          .onClick(() => {
            this.requestSave();
          })
      }
    }
    .width('100%')
    .padding({ left: 10, right: 12, top: this.topInset() + 4, bottom: 8 })
  }

  @Builder
  errorBanner() {
    Row({ space: 8 }) {
      Text('!')
        .fontSize(12)
        .fontColor('#FFFFFF')
        .textAlign(TextAlign.Center)
        .width(18).height(18)
        .borderRadius(9)
        .backgroundColor(dangerColor())
      Text(this.errorText())
        .fontSize(12.5)
        .fontColor(dangerColor())
        .layoutWeight(1)
    }
    .width('100%')
    .padding(12)
    .backgroundColor(this.isDark ? 'rgba(217,83,79,0.16)' : 'rgba(217,83,79,0.10)')
    .borderRadius(12)
    .margin({ left: 16, right: 16, top: 8 })
  }

  @Builder
  placeholderCard() {
    Column({ space: 10 }) {
      LoadingProgress().width(22).height(22).color(purpleColor(this.isDark))
      Text('正在读取角色资料…').fontSize(13).fontColor(secondaryColor(this.isDark))
    }
    .width('100%')
    .padding(28)
    .backgroundColor(cardColor(this.isDark))
    .borderRadius(16)
    .border({ width: 1, color: lineColor(this.isDark) })
    .margin({ left: 16, right: 16, top: 12 })
  }

  @Builder
  section(title: string) {
    Text(title)
      .fontSize(12.5)
      .fontColor(secondaryColor(this.isDark))
      .width('100%')
      .padding({ left: 20, right: 20, top: 18, bottom: 8 })
      .onClick(() => {
        this.dismissKeyboard();
      })
  }

  @Builder
  fieldLabel(title: string) {
    Text(title)
      .fontSize(13)
      .fontColor(secondaryColor(this.isDark))
      .onClick(() => {
        this.dismissKeyboard();
      })
  }

  @Builder
  footerText(title: string) {
    Text(title)
      .fontSize(11.5)
      .fontColor(secondaryColor(this.isDark))
      .width('100%')
      .onClick(() => {
        this.dismissKeyboard();
      })
  }

  @Builder
  infoRow(label: string, value: string) {
    Row({ space: 12 }) {
      Text(label).fontSize(13.5).fontColor(secondaryColor(this.isDark))
      Text(value)
        .fontSize(13.5)
        .fontColor(inkColor(this.isDark))
        .layoutWeight(1)
        .textAlign(TextAlign.End)
        .maxLines(2)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
    }
    .width('100%')
    .onClick(() => {
      this.dismissKeyboard();
    })
  }

  @Builder
  overviewCard() {
    Column() {
      this.infoRow('模型', this.overviewModel())
      Divider().color(lineColor(this.isDark)).strokeWidth(0.5).margin({ top: 10, bottom: 10 })
      this.infoRow('权限', this.overviewPermission())
      Divider().color(lineColor(this.isDark)).strokeWidth(0.5).margin({ top: 10, bottom: 10 })
      this.infoRow('工作文件夹', this.overviewWorkDir())
      if (this.usageAvailable()) {
        Divider().color(lineColor(this.isDark)).strokeWidth(0.5).margin({ top: 10, bottom: 10 })
        this.infoRow('近 30 天用量', this.usageText())
      }
    }
    .width('100%')
    .padding(16)
    .backgroundColor(cardColor(this.isDark))
    .borderRadius(16)
    .border({ width: 1, color: lineColor(this.isDark) })
    .margin({ left: 16, right: 16 })
  }

  @Builder
  basicCard() {
    Column({ space: 12 }) {
      this.fieldLabel('名字')
      TextInput({ text: this.name, placeholder: 'Bot 名称' })
        .fontSize(14)
        .fontColor(inkColor(this.isDark))
        .height(40)
        .backgroundColor(lavenderSoftColor(this.isDark))
        .borderRadius(10)
        .enabled(this.editable())
        .onChange((value: string) => {
          this.name = value;
        })
      this.fieldLabel('标签')
      TextInput({ text: this.role, placeholder: '一句话说明（不授予权限）' })
        .fontSize(14)
        .fontColor(inkColor(this.isDark))
        .height(40)
        .backgroundColor(lavenderSoftColor(this.isDark))
        .borderRadius(10)
        .enabled(this.editable())
        .onChange((value: string) => {
          this.role = value;
        })
      this.footerText('标签为选填，会显示在 Bot 名字下方。')
      this.fieldLabel('说明')
      TextArea({ text: this.instructions, placeholder: '这个 Bot 负责什么…' })
        .fontSize(13.5)
        .fontColor(inkColor(this.isDark))
        .height(120)
        .backgroundColor(lavenderSoftColor(this.isDark))
        .borderRadius(10)
        .enabled(this.editable())
        .onChange((value: string) => {
          this.instructions = value;
        })
      this.footerText('这段说明会写入 Bot 的系统提示词。')
    }
    .width('100%')
    .padding(16)
    .backgroundColor(cardColor(this.isDark))
    .borderRadius(16)
    .border({ width: 1, color: lineColor(this.isDark) })
    .margin({ left: 16, right: 16 })
  }

  @Builder
  modelCard() {
    Column({ space: 12 }) {
      Row({ space: 8 }) {
        this.fieldLabel('模型')
        Text(this.selectedModelLabel())
          .fontSize(13.5)
          .fontColor(inkColor(this.isDark))
          .layoutWeight(1)
          .textAlign(TextAlign.End)
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
        Button('切换')
          .type(ButtonType.Normal)
          .fontSize(12)
          .height(28)
          .borderRadius(14)
          .fontColor(purpleColor(this.isDark))
          .backgroundColor(lavenderSoftColor(this.isDark))
          .enabled(this.editable())
          .onClick(() => {
            this.openModels = !this.openModels;
          })
      }
      .width('100%')
      if (this.openModels) {
        Flex({ wrap: FlexWrap.Wrap }) {
          ForEach(this.state.models, (option: BotRoleOption) => {
            Text(option.title)
              .fontSize(12.5)
              .fontColor(this.model === option.id ? (this.isDark ? '#17161F' : '#FFFFFF') : inkColor(this.isDark))
              .backgroundColor(this.model === option.id ? purpleColor(this.isDark) : lavenderSoftColor(this.isDark))
              .borderRadius(14)
              .padding({ left: 12, right: 12, top: 6, bottom: 6 })
              .margin({ right: 8, bottom: 8 })
              .onClick(() => {
                this.model = option.id;
                this.openModels = false;
                this.effort = '';
                BotStore.get().loadEfforts(option.id);
              })
          })
          if (this.modelUnknown()) {
            Text(this.model)
              .fontSize(12.5)
              .fontColor(this.isDark ? '#17161F' : '#FFFFFF')
              .backgroundColor(purpleColor(this.isDark))
              .borderRadius(14)
              .padding({ left: 12, right: 12, top: 6, bottom: 6 })
              .margin({ right: 8, bottom: 8 })
              .onClick(() => {
                this.openModels = false;
              })
          }
        }
        .width('100%')
      }
      if (this.appliedModelHint().length > 0) {
        Text(this.appliedModelHint()).fontSize(11.5).fontColor(purpleColor(this.isDark)).width('100%')
      }
      this.footerText('模型更改从下一条消息开始生效。')
      if (this.showEfforts()) {
        Divider().color(lineColor(this.isDark)).strokeWidth(0.5)
        this.fieldLabel('推理强度')
        Flex({ wrap: FlexWrap.Wrap }) {
          ForEach(this.state.efforts, (option: BotRoleOption) => {
            Text(option.title)
              .fontSize(12.5)
              .fontColor(this.effort === option.id ? (this.isDark ? '#17161F' : '#FFFFFF') : inkColor(this.isDark))
              .backgroundColor(this.effort === option.id ? purpleColor(this.isDark) : lavenderSoftColor(this.isDark))
              .borderRadius(14)
              .padding({ left: 12, right: 12, top: 6, bottom: 6 })
              .margin({ right: 8, bottom: 8 })
              .onClick(() => {
                this.effort = option.id;
              })
          })
          if (this.effortUnknown()) {
            Text(this.effort)
              .fontSize(12.5)
              .fontColor(this.isDark ? '#17161F' : '#FFFFFF')
              .backgroundColor(purpleColor(this.isDark))
              .borderRadius(14)
              .padding({ left: 12, right: 12, top: 6, bottom: 6 })
              .margin({ right: 8, bottom: 8 })
          }
        }
        .width('100%')
        if (this.appliedEffortHint().length > 0) {
          Text(this.appliedEffortHint()).fontSize(11.5).fontColor(purpleColor(this.isDark)).width('100%')
        }
      }
    }
    .width('100%')
    .padding(16)
    .backgroundColor(cardColor(this.isDark))
    .borderRadius(16)
    .border({ width: 1, color: lineColor(this.isDark) })
    .margin({ left: 16, right: 16 })
  }

  @Builder
  workspaceCard() {
    Column({ space: 12 }) {
      this.fieldLabel('工作文件夹')
      TextInput({ text: this.workDir, placeholder: '总工作区' })
        .fontSize(13.5)
        .fontColor(inkColor(this.isDark))
        .height(40)
        .backgroundColor(lavenderSoftColor(this.isDark))
        .borderRadius(10)
        .enabled(this.editable())
        .onChange((value: string) => {
          this.workDir = value;
        })
      this.footerText('留空时不提交修改；填写绝对路径后保存。空值恢复「总工作区」需在网页端操作。')
      this.fieldLabel('权限')
      Flex({ wrap: FlexWrap.Wrap }) {
        ForEach(this.state.permissions, (option: BotRoleOption) => {
          Text(option.title)
            .fontSize(12.5)
            .fontColor(this.permission === option.id ? (this.isDark ? '#17161F' : '#FFFFFF') : inkColor(this.isDark))
            .backgroundColor(this.permission === option.id ? purpleColor(this.isDark) : lavenderSoftColor(this.isDark))
            .borderRadius(14)
            .padding({ left: 12, right: 12, top: 6, bottom: 6 })
            .margin({ right: 8, bottom: 8 })
            .onClick(() => {
              this.permission = option.id;
            })
        })
        if (this.permissionUnknown()) {
          Text(this.permission)
            .fontSize(12.5)
            .fontColor(this.isDark ? '#17161F' : '#FFFFFF')
            .backgroundColor(purpleColor(this.isDark))
            .borderRadius(14)
            .padding({ left: 12, right: 12, top: 6, bottom: 6 })
            .margin({ right: 8, bottom: 8 })
        }
      }
      .width('100%')
      if (this.permission === 'danger-full-access') {
        this.footerText('允许修改工作区以外的文件，范围仍受主机系统权限限制。')
      }
      Divider().color(lineColor(this.isDark)).strokeWidth(0.5)
      Row({ space: 12 }) {
        Column({ space: 2 }) {
          Text('隐私')
            .fontSize(13.5)
            .fontColor(inkColor(this.isDark))
          Text('主 Bot 禁用；开启后其他 Bot 无法读取此 Bot 的文件夹、记忆与对话。')
            .fontSize(11.5)
            .fontColor(secondaryColor(this.isDark))
        }
        .alignItems(HorizontalAlign.Start)
        .layoutWeight(1)
        Toggle({ type: ToggleType.Switch, isOn: this.privateRole })
          .selectedColor(purpleColor(this.isDark))
          .enabled(this.editable() && !this.isMainBot())
          .onChange((on: boolean) => {
            this.privateRole = on;
          })
      }
      .width('100%')
      this.footerText(this.privacyHint())
    }
    .width('100%')
    .padding(16)
    .backgroundColor(cardColor(this.isDark))
    .borderRadius(16)
    .border({ width: 1, color: lineColor(this.isDark) })
    .margin({ left: 16, right: 16 })
  }

  @Builder
  sectionMemories() {
    Row({ space: 8 }) {
      Text('记忆')
        .fontSize(12.5)
        .fontColor(secondaryColor(this.isDark))
        .layoutWeight(1)
      if (this.memoryEditable() && !this.memoryEditing) {
        Text('＋ 添加')
          .fontSize(12.5)
          .fontColor(purpleColor(this.isDark))
          .onClick(() => {
            this.editingMemory = '';
            this.editingText = '';
            this.memoryEditing = true;
          })
      }
    }
    .width('100%')
    .padding({ left: 20, right: 20, top: 18, bottom: 8 })
    .onClick(() => {
      this.dismissKeyboard();
    })
  }

  @Builder
  memoriesCard() {
    Column({ space: 10 }) {
      if (this.memoryEditing) {
        Text(this.memoryEditorTitle())
          .fontSize(13)
          .fontColor(secondaryColor(this.isDark))
          .width('100%')
        TextArea({ text: this.editingText, placeholder: '记忆内容' })
          .fontSize(13)
          .fontColor(inkColor(this.isDark))
          .height(140)
          .backgroundColor(lavenderSoftColor(this.isDark))
          .borderRadius(10)
          .onChange((value: string) => {
            this.editingText = value;
          })
        Row({ space: 10 }) {
          Button('保存')
            .type(ButtonType.Normal)
            .fontSize(12.5)
            .height(32)
            .borderRadius(16)
            .fontColor(this.isDark ? '#17161F' : '#FFFFFF')
            .backgroundColor(purpleColor(this.isDark))
            .enabled(this.editingText.trim().length > 0 && this.memoryEditable())
            .onClick(() => {
              this.saveMemoryDraft();
            })
          Button('取消')
            .type(ButtonType.Normal)
            .fontSize(12.5)
            .height(32)
            .borderRadius(16)
            .fontColor(inkColor(this.isDark))
            .backgroundColor(lavenderSoftColor(this.isDark))
            .onClick(() => {
              this.memoryEditing = false;
              this.editingMemory = '';
              this.editingText = '';
            })
        }
        .width('100%')
      } else if (this.state.roleDetails === undefined) {
        Text('正在读取记忆…')
          .fontSize(12.5)
          .fontColor(secondaryColor(this.isDark))
          .width('100%')
      } else if (this.memories().length === 0) {
        Text(this.state.memoryAvailable ? '还没有记忆' : '主机未启用记忆')
          .fontSize(12.5)
          .fontColor(secondaryColor(this.isDark))
          .width('100%')
      } else {
        ForEach(this.memories(), (memory: BotMemory) => {
          Column({ space: 6 }) {
            Text(memory.text)
              .fontSize(13)
              .fontColor(inkColor(this.isDark))
              .width('100%')
              .maxLines(6)
              .textOverflow({ overflow: TextOverflow.Ellipsis })
              .onClick(() => {
                if (this.memoryEditable()) {
                  this.editingMemory = memory.id;
                  this.editingText = memory.text;
                  this.memoryEditing = true;
                }
              })
            if (this.memoryEditable()) {
              Row({ space: 16 }) {
                Text('编辑')
                  .fontSize(11.5)
                  .fontColor(purpleColor(this.isDark))
                  .onClick(() => {
                    this.editingMemory = memory.id;
                    this.editingText = memory.text;
                    this.memoryEditing = true;
                  })
                Text('删除')
                  .fontSize(11.5)
                  .fontColor(dangerColor())
                  .onClick(() => {
                    this.confirmForgetMemory(memory);
                  })
              }
              .width('100%')
            }
          }
          .alignItems(HorizontalAlign.Start)
          .width('100%')
          .padding(12)
          .backgroundColor(lavenderSoftColor(this.isDark))
          .borderRadius(10)
        })
      }
    }
    .width('100%')
    .padding(16)
    .backgroundColor(cardColor(this.isDark))
    .borderRadius(16)
    .border({ width: 1, color: lineColor(this.isDark) })
    .margin({ left: 16, right: 16 })
  }

  @Builder
  sectionSchedules() {
    Row({ space: 8 }) {
      Text('定时任务')
        .fontSize(12.5)
        .fontColor(secondaryColor(this.isDark))
        .layoutWeight(1)
      if (this.scheduleEditable() && !this.showScheduleForm) {
        Text('＋ 新建')
          .fontSize(12.5)
          .fontColor(purpleColor(this.isDark))
          .onClick(() => {
            this.scheduleTitle = '';
            this.schedulePrompt = '';
            this.scheduleTime = this.nowTime();
            this.showScheduleForm = true;
          })
      }
    }
    .width('100%')
    .padding({ left: 20, right: 20, top: 18, bottom: 8 })
    .onClick(() => {
      this.dismissKeyboard();
    })
  }

  @Builder
  schedulesCard() {
    Column({ space: 10 }) {
      if (this.mySchedules().length === 0) {
        Text(this.state.schedulesAvailable ? '还没有定时任务' : '主机未启用定时任务')
          .fontSize(12.5)
          .fontColor(secondaryColor(this.isDark))
          .width('100%')
      } else {
        ForEach(this.mySchedules(), (task: BotSchedule) => {
          Row({ space: 10 }) {
            Column({ space: 3 }) {
              Text(task.title)
                .fontSize(13.5)
                .fontColor(inkColor(this.isDark))
                .maxLines(1)
                .textOverflow({ overflow: TextOverflow.Ellipsis })
              Text(task.status + ' · ' + task.next)
                .fontSize(11.5)
                .fontColor(secondaryColor(this.isDark))
                .maxLines(1)
                .textOverflow({ overflow: TextOverflow.Ellipsis })
            }
            .alignItems(HorizontalAlign.Start)
            .layoutWeight(1)
            if (this.scheduleEditable() && task.sessionId !== undefined) {
              Text('删除')
                .fontSize(11.5)
                .fontColor(dangerColor())
                .onClick(() => {
                  this.confirmDeleteSchedule(task);
                })
            }
          }
          .width('100%')
          .padding({ top: 8, bottom: 8 })
          .border({ width: { bottom: 0.5 }, color: lineColor(this.isDark) })
        })
      }
      if (this.showScheduleForm) {
        Divider().color(lineColor(this.isDark)).strokeWidth(0.5)
        this.fieldLabel('任务名称')
        TextInput({ text: this.scheduleTitle, placeholder: '例如：每日晨报' })
          .fontSize(13)
          .fontColor(inkColor(this.isDark))
          .height(40)
          .backgroundColor(lavenderSoftColor(this.isDark))
          .borderRadius(10)
          .onChange((value: string) => {
            this.scheduleTitle = value;
          })
        this.fieldLabel('任务内容')
        TextArea({ text: this.schedulePrompt, placeholder: '发给 Bot 的指令' })
          .fontSize(13)
          .fontColor(inkColor(this.isDark))
          .height(90)
          .backgroundColor(lavenderSoftColor(this.isDark))
          .borderRadius(10)
          .onChange((value: string) => {
            this.schedulePrompt = value;
          })
        this.fieldLabel('每天运行时间')
        Row({ space: 10 }) {
          TextInput({ text: this.scheduleTime, placeholder: 'HH:mm' })
            .fontSize(13)
            .fontColor(inkColor(this.isDark))
            .height(40)
            .width(100)
            .backgroundColor(lavenderSoftColor(this.isDark))
            .borderRadius(10)
            .onChange((value: string) => {
              this.scheduleTime = value;
            })
          Text('时区：' + this.deviceZone())
            .fontSize(11.5)
            .fontColor(secondaryColor(this.isDark))
            .layoutWeight(1)
        }
        .width('100%')
        if (!this.isTimeValid(this.scheduleTime)) {
          this.footerText('时间格式应为 HH:mm')
        }
        this.footerText('发送时按设备本地时区触发；名称与内容都填写后才能创建。')
        Row({ space: 10 }) {
          Button('创建')
            .type(ButtonType.Normal)
            .fontSize(12.5)
            .height(32)
            .borderRadius(16)
            .fontColor(this.isDark ? '#17161F' : '#FFFFFF')
            .backgroundColor(purpleColor(this.isDark))
            .enabled(this.scheduleValid() && this.scheduleEditable())
            .onClick(() => {
              this.createSchedule();
            })
          Button('取消')
            .type(ButtonType.Normal)
            .fontSize(12.5)
            .height(32)
            .borderRadius(16)
            .fontColor(inkColor(this.isDark))
            .backgroundColor(lavenderSoftColor(this.isDark))
            .onClick(() => {
              this.showScheduleForm = false;
            })
        }
        .width('100%')
      }
    }
    .width('100%')
    .padding(16)
    .backgroundColor(cardColor(this.isDark))
    .borderRadius(16)
    .border({ width: 1, color: lineColor(this.isDark) })
    .margin({ left: 16, right: 16 })
  }

  @Builder
  managementCard() {
    Column({ space: 0 }) {
      Row({ space: 8 }) {
        Text('复制一份')
          .fontSize(13.5)
          .fontColor(inkColor(this.isDark))
          .layoutWeight(1)
        Text('›').fontSize(16).fontColor(secondaryColor(this.isDark))
      }
      .width('100%')
      .height(44)
      .onClick(() => {
        this.confirmCopyRole();
      })
      if (!this.isMainBot()) {
        Divider().color(lineColor(this.isDark)).strokeWidth(0.5)
        Row({ space: 8 }) {
          Text('设为主 Bot')
            .fontSize(13.5)
            .fontColor(inkColor(this.isDark))
            .layoutWeight(1)
          Text('›').fontSize(16).fontColor(secondaryColor(this.isDark))
        }
        .width('100%')
        .height(44)
        .onClick(() => {
          this.confirmReplacePrimary();
        })
      }
      if (this.state.botDeletionSupported && !this.isMainBot()) {
        Divider().color(lineColor(this.isDark)).strokeWidth(0.5)
        Row({ space: 8 }) {
          Text('删除 Bot')
            .fontSize(13.5)
            .fontColor(dangerColor())
            .layoutWeight(1)
          Text('›').fontSize(16).fontColor(secondaryColor(this.isDark))
        }
        .width('100%')
        .height(44)
        .onClick(() => {
          this.confirmDeleteBot();
        })
      }
      Divider().color(lineColor(this.isDark)).strokeWidth(0.5).margin({ top: 4, bottom: 10 })
      this.footerText('复制分工和模型，新 Bot 从空白记忆开始。')
      if (this.isMainBot()) {
        Text('主 Bot 可以创建和修改团队 Bot，并管理群聊。')
          .fontSize(11.5)
          .fontColor(secondaryColor(this.isDark))
          .width('100%')
          .padding({ top: 4 })
      }
    }
    .width('100%')
    .padding(16)
    .backgroundColor(cardColor(this.isDark))
    .borderRadius(16)
    .border({ width: 1, color: lineColor(this.isDark) })
    .margin({ left: 16, right: 16 })
  }

  build() {
    NavDestination() {
      Column() {
        this.header()
        Scroll() {
          Column({ space: 0 }) {
            if (this.errorText().length > 0) {
              this.errorBanner()
            }
            if (this.bot() === null) {
              this.placeholderCard()
            } else {
              this.section('资料')
              this.overviewCard()
              this.section('角色设置')
              this.basicCard()
              this.section('模型')
              this.modelCard()
              this.section('工作区与权限')
              this.workspaceCard()
              this.sectionMemories()
              this.memoriesCard()
              this.sectionSchedules()
              this.schedulesCard()
              this.section('管理')
              this.managementCard()
            }
            Row()
              .width('100%')
              .height(30 + this.safeBottom)
              .onClick(() => {
                this.dismissKeyboard();
              })
          }
          .width('100%')
        }
        .layoutWeight(1)
        .width('100%')
        .scrollBar(BarState.Off)
        .align(Alignment.Top)
        .onScrollStart(() => {
          this.dismissKeyboard();
        })
      }
      .width('100%')
      .height('100%')
      .backgroundColor(groupedColor(this.isDark))
    }
    .hideTitleBar(true)
    // 深链进入时按路由参数打开角色详情（之前必须先 openRole，否则页面永远空白）
    .onReady((ctx: NavDestinationContext) => {
      const id: string = BotRolePage.paramId(ctx);
      if (id.length > 0) {
        this.routeId = id;
        BotStore.get().openRole(id);
      }
    })
  }

  private static paramId(ctx: NavDestinationContext): string {
    try {
      const raw: Object | undefined = ctx.pathInfo.param as Object | undefined;
      if (typeof raw === 'string') {
        return raw as string;
      }
      return '';
    } catch (error) {
      return '';
    }
  }
}
