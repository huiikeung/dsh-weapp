/**
 * Bot 模式首页（对齐 iOS BotModeView.compactHome + Bot 浅紫视觉规格 §3 / §8）：
 * 浅紫 Bot 主题背景 + 品牌顶栏、「个人助理」标题区、Chief 卡、「与 X 聊聊」主按钮、
 * 连接/加载/空态卡、「我的 Bot」「定时任务」快捷卡、聊天区（标题行 + 搜索 + 列表卡）、
 * 只读定时任务面板。数据与交互沿用 BotStore 快照与既有 pageStack 路由。
 * 宽屏（≥760×500vp）启用 R2 双栏（左助理区 / 右聊天区，§3.5 / §8.8）；手机保持单栏。
 */
import { uiMaterial } from '@kit.ArkUI';
import {
  BotChat, BotLiveWork, BotRoleDetails, BotRoleOption, BotRoleProfile, BotSchedule, BotSnapshot, BotStore,
  Logger, PreferencesStore, emptyBotSnapshot
} from 'nativecore';
import { FluKeCoin } from '../components/FluKeCoin';
import { Haptics } from '../services/Haptics';
import { BotBackground } from '../components/BotBackground';
import { BotGroupAvatar } from '../components/BotGroupAvatar';
import { appGlassFill, appGlassBlur, appGlassBorderColor, appGlassShadow } from '../common/AppGlass';
import { HostSwitcherBar } from '../components/HostSwitcherBar';
import { startModeWave } from '../common/ModeTransition';

/** 行内实时活动文案（由 BotStore.liveWork 的 kind 映射） */
function liveText(live: BotLiveWork | undefined): string {
  if (live === undefined) {
    return '';
  }
  const kind: string = live.kind;
  if (kind === 'web-search') return '正在搜索网页';
  if (kind === 'web-read') return '正在读取网页';
  if (kind === 'image') return '正在处理图片';
  if (kind === 'switching-folder') return '正在切换工作目录';
  if (kind === 'working') return '正在执行';
  return '正在思考';
}

@Component
export struct BotHomePage {
  @Consume('pageStack') pageStack: NavPathStack;
  @StorageLink('isDark') isDark: boolean = false;
  @StorageLink('safeTopVp') safeTop: number = 0;
  @StorageLink('safeBottomVp') safeBottom: number = 0;
  @StorageLink('connectionState') @Watch('onConnection') connection: string = 'disconnected';
  @StorageLink('botState') @Watch('onRoleState') state: BotSnapshot = emptyBotSnapshot();

  @State search: string = '';
  @State scheduleOpen: boolean = false;
  /** Chief 角色名片底部弹窗 */
  @State chiefSheetOpen: boolean = false;
  /** 弹窗内的页面：0=角色名片，1=角色设置（都在同一个弹窗里切换） */
  @State chiefSheetPage: number = 0;
  // 弹窗内设置表单草稿
  @State editName: string = '';
  @State editRole: string = '';
  @State editInstructions: string = '';
  @State editWorkDir: string = '';
  @State editModel: string = '';
  @State editEffort: string = '';
  @State editPermission: string = '';
  @State editPrivate: boolean = false;
  @State editLoaded: boolean = false;
  @State editPending: string = '';
  @State editErrorBefore: string = '';
  @State editOpError: string = '';
  /** 页面尺寸（vp，onAreaChange 记录）；用于 R2 宽屏断点 */
  @State pageW: number = 0;
  @State pageH: number = 0;
  /** 搜索框是否聚焦：键盘压缩高度时仍保持双栏（§8.8「或搜索聚焦」） */
  @State searchFocused: boolean = false;
  /** 左侧栏（与工作模式共用一套抽屉视觉；Bot 模式首项为「切换到工作模式」） */
  @State drawerOpen: boolean = false;
  @State drawerWidth: number = 280;
  /** 模式切换时抽屉要「立即无动画归零」（对齐 iOS disablesAnimations） */
  @State drawerInstant: boolean = false;

  aboutToAppear(): void {
    BotStore.get().refreshAll();
    BotStore.get().setForeground(true);
    AppStorage.setOrCreate<string>('botMode', '1');
    try {
      PreferencesStore.get().putString('botMode', '1');
    } catch (ignored) {
    }
    Logger.info('BOT_HOME appear chats=' + this.state.chats.length.toString()
      + ' supported=' + (this.state.supported ? '1' : '0'));
  }

  onConnection(): void {
    if (this.connection === 'connected') {
      BotStore.get().refreshAll();
    }
  }

  private topInset(): number {
    return this.safeTop > 0 ? this.safeTop : 38.9;
  }

  // ==================== 宽屏 R2 断点（§3.5 / §8.8） ====================

  /** 宽屏双栏：宽 ≥760vp 且 高 ≥500vp；搜索聚焦时保持双栏，避免键盘压缩高度后抖回单栏 */
  private isWide(): boolean {
    if (this.pageW < 760) {
      return false;
    }
    return this.pageH >= 500 || this.searchFocused;
  }

  /** 左栏宽 = min(440, 窗口宽 × 0.38)（§8.4 / §8.8） */
  private wideLeftWidth(): number {
    return Math.min(440, this.pageW * 0.38);
  }

  /** 页面最大内容宽 1440，超出后居中（§8.8） */
  private wideContentWidth(): number {
    return Math.min(this.pageW, 1440);
  }

  /**
   * onAreaChange 记录窗口尺寸：Area 的 width/height 已是 vp，直接取 Number，
   * 不再 px2vp（重复换算会按屏幕密度放大，把手机误判成宽屏）。
   * 变化小于 1vp 不写回，避免布局回调反复 setState 导致整页重建抖动。
   */
  private onPageArea(after: Area): void {
    const w: number = Number(after.width);
    const h: number = Number(after.height);
    if (!isFinite(w) || !isFinite(h) || w <= 0 || h <= 0) {
      return;
    }
    if (Math.abs(w - this.pageW) < 1 && Math.abs(h - this.pageH) < 1) {
      return;
    }
    this.pageW = w;
    this.pageH = h;
  }

  private leaveBotMode(animated: boolean = false): void {
    AppStorage.setOrCreate<string>('botMode', '0');
    try {
      PreferencesStore.get().putString('botMode', '0');
    } catch (ignored) {
    }
    // 模式切换不做左右推屏转场（对齐 iOS：直接换根内容，用波纹覆盖）
    this.pageStack.pop(animated);
  }

  // ==================== 左侧栏 / 模式切换（对齐工作模式抽屉与 iOS §2） ====================

  /** 抽屉展开时内容层右移量（对齐工作模式首页） */
  private drawerShift(): number {
    return this.drawerOpen ? this.drawerWidth : 0;
  }

  /** 抽屉展开时内容层上下让出的高度（vp） */
  private drawerInsetVp(): number {
    if (!this.drawerOpen) {
      return 0;
    }
    const statusBar: number = this.safeTop > 0 ? this.safeTop : 38.9;
    return Math.round(statusBar + 9);
  }

  private drawerBg(): string {
    return this.isDark ? '#181A1F' : '#FFFFFF';
  }

  /** 打开左侧栏（触感与设置页「震动反馈」档位一致） */
  private openDrawer(): void {
    if (this.drawerOpen) {
      return;
    }
    this.drawerOpen = true;
    Haptics.play();
  }

  private closeDrawer(): void {
    if (!this.drawerOpen) {
      return;
    }
    this.drawerOpen = false;
    Haptics.play();
  }

  /** 首页横向手势：右滑开抽屉，左滑收抽屉（位移 ≥64vp 且以横向为主） */
  private onHomeSwipeEnd(event: GestureEvent): void {
    const dx: number = event.offsetX;
    const dy: number = event.offsetY;
    if (Math.abs(dx) < 64 || Math.abs(dx) < Math.abs(dy) * 1.2) {
      return;
    }
    if (dx > 0) {
      this.openDrawer();
    } else {
      this.closeDrawer();
    }
  }

  /**
   * 离开 Bot 模式并进入某个工作模式目的地（抽屉里的插件/自动化任务/连接器/设置）：
   * 先把模式写回工作模式、弹出 Bot 首页，再压入目标页，避免目标页叠在 Bot 首页之上。
   */
  private exitToRoute(route: string): void {
    AppStorage.setOrCreate<string>('botMode', '0');
    try {
      PreferencesStore.get().putString('botMode', '0');
    } catch (ignored) {
    }
    this.drawerOpen = false;
    this.pageStack.pop(false);
    setTimeout(() => {
      this.pageStack.pushPathByName(route, null);
    }, 40);
  }

  private iconTint(color: string): number[] {
    const text: string = color.trim();
    let alpha: number = 1;
    let red: number = 255;
    let green: number = 255;
    let blue: number = 255;
    if (text.startsWith('#')) {
      const hex: string = text.substring(1);
      const value: number = parseInt(hex, 16);
      if (hex.length === 8) {
        alpha = ((value >>> 24) & 255) / 255;
        red = (value >> 16) & 255;
        green = (value >> 8) & 255;
        blue = value & 255;
      } else {
        red = (value >> 16) & 255;
        green = (value >> 8) & 255;
        blue = value & 255;
      }
    } else if (text.startsWith('rgb')) {
      const inner: string = text.substring(text.indexOf('(') + 1, text.lastIndexOf(')'));
      const parts: string[] = inner.split(',');
      if (parts.length >= 3) {
        red = Math.round(parseFloat(parts[0].trim()));
        green = Math.round(parseFloat(parts[1].trim()));
        blue = Math.round(parseFloat(parts[2].trim()));
        if (parts.length >= 4) {
          alpha = parseFloat(parts[3].trim());
        }
      }
    }
    // 颜色矩阵的偏移列是 0~1 归一化值（不是 0~255），否则会被截断成白色
    return [
      0, 0, 0, 0, red / 255,
      0, 0, 0, 0, green / 255,
      0, 0, 0, 0, blue / 255,
      0, 0, 0, alpha, 0
    ];
  }

  // ==================== Bot 主题色（§8.1 浅色 / 深色 token） ====================

  private ink(): string {
    return this.isDark ? '#F2EEF6' : '#252332';
  }

  private secondaryText(): string {
    return this.isDark ? '#D8D2E1' : '#5C536C';
  }

  private purple(): string {
    return this.isDark ? '#C8B5E8' : '#7760B4';
  }

  /** Chief 状态行文案色（iOS cardAccent） */
  private cardAccent(): string {
    return this.isDark ? '#C8B5E8' : '#584190';
  }

  /** 玻璃卡底：BotCard token（浅 #FFFFFF / 深 #292733）带一点透光，让浅紫背景透出来 */
  private cardFill(): string {
    return this.isDark ? 'rgba(41,39,51,0.92)' : 'rgba(255,255,255,0.92)';
  }

  /** 不透明卡片底（定时任务行、面板内卡片） */
  private cardSolid(): string {
    return this.isDark ? '#292733' : '#FFFFFF';
  }

  private groupedSurface(): string {
    return this.isDark ? '#211F2A' : '#F2F2F7';
  }

  private lavenderSoft(): string {
    return this.isDark ? '#333044' : '#ECE7F7';
  }

  private lineColor(): string {
    return this.isDark ? '#484354' : '#DAD6E3';
  }

  /** 1px 描边：浅色 BotLine 45%，深色 BotGlassRim */
  private rimColor(): string {
    return this.isDark ? '#777184' : 'rgba(218,214,227,0.45)';
  }

  /** 柔和阴影：浅色 navy 6%（radius 16 / y 8） */
  private shadowColor(): string {
    return this.isDark ? 'rgba(0,0,0,0.36)' : 'rgba(23,35,80,0.06)';
  }

  private primaryButton(): string {
    return '#6C50A7';
  }

  // ==================== 首页沉浸玻璃材质（系统液态玻璃：透明底 + 背景模糊 + 发丝描边，投影挂未裁剪外层） ====================

  /** 玻璃发丝描边：浅色白 0.90 / 深色白 0.16（对齐 NavBackButton 系统菜单描边） */
  private glassHairline(): string {
    return this.isDark ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.90)';
  }

  /** 玻璃投影（radius 14 / offsetY 6）：只挂在未裁剪的外层容器上，挂在 clip 节点上会被裁掉 */
  private glassShadow(): ShadowOptions {
    return {
      radius: 14,
      color: this.isDark ? 'rgba(0,0,0,0.45)' : 'rgba(16,19,24,0.12)',
      offsetX: 0,
      offsetY: 6
    };
  }

  private botBlue(): string {
    return this.isDark ? '#A1BFF6' : '#2E6BE6';
  }

  private successGreen(): string {
    return '#2EB85C';
  }

  private unreadRed(): string {
    return '#D6263C';
  }

  /** 主 Bot 无图时：紫色底 + 首字 */
  private mainAvatarBg(): string {
    return this.isDark ? '#C8B5E8' : '#6C50A7';
  }

  private mainAvatarFg(): string {
    return this.isDark ? '#17161F' : '#FFFFFF';
  }

  // ==================== 派生数据 ====================

  private chief(): BotChat | null {
    const main: string = this.state.mainBotId ?? '';
    for (const chat of this.state.chats) {
      if (!chat.room && (main.length > 0 ? chat.id === main : true)) {
        return chat;
      }
    }
    return null;
  }

  private visibleChats(): BotChat[] {
    const query: string = this.search.trim().toLowerCase();
    const out: BotChat[] = [];
    for (const chat of this.state.chats) {
      if (chat.hidden) {
        continue;
      }
      if (query.length > 0 && chat.name.toLowerCase().indexOf(query) < 0
        && chat.preview.toLowerCase().indexOf(query) < 0) {
        continue;
      }
      out.push(chat);
    }
    return out;
  }

  private runningCount(): number {
    let count: number = 0;
    for (const chat of this.state.chats) {
      if (this.state.liveWork[chat.id] !== undefined) {
        count += 1;
      }
    }
    return count;
  }

  private rosterCount(): number {
    let count: number = 0;
    for (const chat of this.state.chats) {
      if (!chat.room) {
        count += 1;
      }
    }
    return count;
  }

  private isSearching(): boolean {
    return this.search.trim().length > 0;
  }

  private resultLabel(): string {
    return this.visibleChats().length.toString() + ' 个结果';
  }

  private hasError(): boolean {
    return this.state.error !== undefined && this.state.error.length > 0;
  }

  private statusText(): string {
    if (this.connection !== 'connected') {
      return '连接主机后查看个人助理';
    }
    if (!this.state.supported) {
      return '请更新主机上的移动网关以使用 Bot 模式';
    }
    if (this.hasError()) {
      return '连接异常：' + (this.state.error ?? '');
    }
    return '';
  }

  private showStatusCard(): boolean {
    return this.connection !== 'connected' || !this.state.supported || this.hasError();
  }

  private showLoadingCard(): boolean {
    return this.connection === 'connected' && this.state.loading && this.state.chats.length === 0;
  }

  private chiefRunning(): boolean {
    const chief: BotChat | null = this.chief();
    return chief !== null && (chief.running || this.state.liveWork[chief.id] !== undefined);
  }

  private chiefName(): string {
    const chief: BotChat | null = this.chief();
    return chief !== null ? chief.name : '个人助理';
  }

  private chiefSubtitle(): string {
    if (this.chief() === null) {
      return '连接主机后开始使用';
    }
    if (this.chiefRunning()) {
      return '正在为你推进 ' + this.runningCount().toString() + ' 件事';
    }
    return '随时可以找我聊聊';
  }

  private startChatLabel(): string {
    const chief: BotChat | null = this.chief();
    return chief !== null ? '与 ' + chief.name + ' 聊聊' : '与助理聊聊';
  }

  private chiefHasStatus(): boolean {
    const chief: BotChat | null = this.chief();
    return chief !== null && (this.runningOf(chief) || this.unreadOf(chief.id) > 0);
  }

  private runningOf(chat: BotChat): boolean {
    return chat.running || this.state.liveWork[chat.id] !== undefined;
  }

  private unreadOf(id: string): number {
    return this.state.unreadCounts[id] ?? 0;
  }

  private unreadLabel(count: number): string {
    return count > 99 ? '99+' : count.toString();
  }

  private isMainBotId(id: string): boolean {
    if (id.length === 0) {
      return false;
    }
    if (id === (this.state.mainBotId ?? '')) {
      return true;
    }
    return this.state.mainBotIds.indexOf(id) >= 0;
  }

  private isMainChat(chat: BotChat): boolean {
    const chief: BotChat | null = this.chief();
    return chief !== null && chief.id === chat.id;
  }

  private hasImage(chat: BotChat): boolean {
    const image: string | undefined = chat.image;
    return image !== undefined && image.length > 0;
  }

  /** Chief 是否有主机下发的头像图（没有则用虎鲸标记） */
  private chiefHasImage(): boolean {
    const chief: BotChat | null = this.chief();
    return chief !== null && this.hasImage(chief);
  }

  private imageOf(chat: BotChat): string {
    const image: string | undefined = chat.image;
    return image === undefined ? '' : image;
  }

  private firstChar(chat: BotChat): string {
    return chat.name.length > 0 ? chat.name.substring(0, 1) : 'B';
  }

  private chatSubtitle(chat: BotChat): string {
    const live: BotLiveWork | undefined = this.state.liveWork[chat.id];
    if (live !== undefined) {
      return liveText(live);
    }
    if (chat.preview.length > 0) {
      return chat.preview;
    }
    if (chat.room) {
      return '群聊';
    }
    return chat.role.length > 0 ? chat.role : '私聊';
  }

  private scheduleSubtitle(): string {
    if (this.state.schedules.length > 0) {
      return '下次 ' + this.state.schedules[0].next;
    }
    return '查看安排';
  }

  private scheduleStateText(): string {
    if (this.state.loading) {
      return '正在同步助理';
    }
    if (!this.state.schedulesAvailable) {
      return '主机未启用定时任务';
    }
    return '还没有定时任务';
  }

  private timeLabel(chat: BotChat): string {
    if (chat.lastAt <= 0) {
      return '';
    }
    const ms: number = chat.lastAt > 100000000000 ? chat.lastAt : chat.lastAt * 1000;
    const diff: number = Math.max(0, Date.now() - ms);
    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return Math.floor(diff / 60000).toString() + ' 分钟前';
    if (diff < 86400000) return Math.floor(diff / 3600000).toString() + ' 小时前';
    return Math.floor(diff / 86400000).toString() + ' 天前';
  }

  private openChat(chat: BotChat): void {
    BotStore.get().selectChat(chat.id);
    this.pageStack.pushPathByName('bot-chat', chat.id);
  }

  /** 进入完整角色设置页（名片里的「角色设置」） */
  private openChiefRole(): void {
    const chief: BotChat | null = this.chief();
    if (chief === null) {
      return;
    }
    BotStore.get().openRole(chief.id);
    this.chiefSheetOpen = false;
    this.pageStack.pushPathByName('bot-role', chief.id);
  }

  // ==================== 角色名片（底部原生玻璃弹窗，对齐 iOS §7.5） ====================

  /** 沉浸光感能力判断（旧系统降级为半透明底） */
  private immersiveSupported(): boolean {
    try {
      return uiMaterial.isImmersiveMaterialSupported();
    } catch (err) {
      return false;
    }
  }

  /** 弹窗材质：永远是原生沉浸玻璃（浅色奶白 / 深色通透） */
  private sheetMaterial(): uiMaterial.Material | undefined {
    if (!this.immersiveSupported()) {
      return undefined;
    }
    return new uiMaterial.ImmersiveMaterial({
      style: uiMaterial.ImmersiveStyle.THICK,
      materialColor: this.isDark ? 'rgba(255,255,255,0.02)' : 'rgba(255,255,255,0.34)',
      colorInvert: true,
      applyShadow: true
    });
  }

  private sheetFallbackColor(): string {
    return this.isDark ? '#2E2E2E' : '#F7F8FA';
  }

  /** 弹窗内的半透明填充：让系统玻璃透出来，而不是盖一层实色 */
  private sheetFill(): string {
    return this.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.55)';
  }

  private chiefProfile(): BotRoleProfile | undefined {
    const chief: BotChat | null = this.chief();
    if (chief === null) {
      return undefined;
    }
    return chief.profile;
  }

  private chiefRoleLabel(): string {
    const chief: BotChat | null = this.chief();
    if (chief === null || chief.role.length === 0) {
      return '主 Bot';
    }
    return chief.role;
  }

  private chiefInstructions(): string {
    const profile: BotRoleProfile | undefined = this.chiefProfile();
    if (profile === undefined) {
      return '';
    }
    return profile.instructions;
  }

  private chiefModelLabel(): string {
    const profile: BotRoleProfile | undefined = this.chiefProfile();
    let id: string = '';
    if (profile !== undefined) {
      id = profile.model !== undefined && profile.model.length > 0
        ? profile.model : (profile.appliedModel !== undefined ? profile.appliedModel : '');
    }
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

  private chiefPermissionLabel(): string {
    const profile: BotRoleProfile | undefined = this.chiefProfile();
    const id: string = profile !== undefined && profile.permission !== undefined ? profile.permission : '';
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

  private chiefWorkDirLabel(): string {
    const profile: BotRoleProfile | undefined = this.chiefProfile();
    if (profile === undefined || profile.workDir === undefined || profile.workDir.length === 0) {
      return '总工作区';
    }
    return profile.workDir;
  }

  private chiefId(): string {
    const chief: BotChat | null = this.chief();
    return chief !== null ? chief.id : '';
  }

  private chiefMemoryCount(): number {
    const details: BotRoleDetails | undefined = this.state.roleDetails;
    if (details === undefined || details.botId !== this.chiefId()) {
      return 0;
    }
    return details.memories.length;
  }

  private chiefScheduleCount(): number {
    const id: string = this.chiefId();
    let count: number = 0;
    for (const task of this.state.schedules) {
      if (task.botId === id) {
        count += 1;
      }
    }
    return count;
  }

  private chiefUsageAvailable(): boolean {
    const details: BotRoleDetails | undefined = this.state.roleDetails;
    if (details === undefined || details.botId !== this.chiefId()) {
      return false;
    }
    return details.inputTokens !== undefined && details.outputTokens !== undefined;
  }

  private chiefUsageText(): string {
    const details: BotRoleDetails | undefined = this.state.roleDetails;
    if (details === undefined || details.inputTokens === undefined || details.outputTokens === undefined) {
      return '';
    }
    return this.groupDigits(details.inputTokens + details.outputTokens) + ' tokens';
  }

  private groupDigits(value: number): string {
    const text: string = Math.round(value).toString();
    let out: string = '';
    for (let i = 0; i < text.length; i++) {
      if (i > 0 && (text.length - i) % 3 === 0) {
        out += ',';
      }
      out += text.charAt(i);
    }
    return out;
  }

  /** Chief 卡：打开底部原生玻璃角色名片（对齐 iOS §7.5） */
  private openChiefCard(): void {
    const chief: BotChat | null = this.chief();
    if (chief === null) {
      return;
    }
    BotStore.get().openRole(chief.id);
    this.chiefSheetPage = 0;
    this.editLoaded = false;
    this.editOpError = '';
    this.chiefSheetOpen = true;
  }


  // ==================== 通用样式 ====================

  /**
   * BotFace：有主机下发图 → 渲染图；否则首字。
   * 普通 Bot 用 BotLavenderSoft 底 + BotBlue 首字；主 Bot 用紫色底 + 首字。
   * 圆角 size / 3（§8.4）。
   */
  @Builder
  letterAvatar(letter: string, size: number, main: boolean) {
    Stack({ alignContent: Alignment.Center }) {
      Column()
        .width(size)
        .height(size)
        .borderRadius(size / 3)
        .backgroundColor(main ? this.mainAvatarBg() : this.lavenderSoft())
      Text(letter)
        .fontSize(size * 0.42)
        .fontWeight(FontWeight.Bold)
        .fontColor(main ? this.mainAvatarFg() : this.botBlue())
    }
    .width(size)
    .height(size)
    .flexShrink(0)
  }

  @Builder
  botAvatar(chat: BotChat, size: number, main: boolean) {
    if (this.hasImage(chat)) {
      Image(this.imageOf(chat))
        .width(size)
        .height(size)
        .borderRadius(size / 3)
        .objectFit(ImageFit.Cover)
        .flexShrink(0)
    } else {
      this.letterAvatar(this.firstChar(chat), size, main)
    }
  }

  /** Chief 头像：对齐 iOS WhalenessOrcaIcon（主 Bot 无图时用墨色虎鲸标记 + BotLavenderSoft 底、圆角 size/3） */
  @Builder
  orcaAvatar(size: number) {
    Stack({ alignContent: Alignment.Center }) {
      Column()
        .width(size)
        .height(size)
        .borderRadius(size / 3)
        .backgroundColor(this.lavenderSoft())
      Image($r('app.media.dsh_orca_mark'))
        .width(size * 0.58)
        .height(size * 0.58)
        .objectFit(ImageFit.Contain)
        .colorFilter(this.iconTint(this.ink()))
    }
    .width(size)
    .height(size)
    .flexShrink(0)
  }

  @Builder
  chiefAvatar() {
    if (this.chiefHasImage()) {
      this.botAvatar(this.chief() as BotChat, 44, true)
    } else {
      this.orcaAvatar(44)
    }
  }

  /** 列表行右侧状态标记：运行中绿点 → 未读红角标（running 优先） */
  @Builder
  statusMark(chat: BotChat) {
    if (this.runningOf(chat)) {
      Row() {
        Circle({ width: 8, height: 8 }).fill(this.successGreen())
      }
      .width(20)
      .height(20)
      .justifyContent(FlexAlign.Center)
    } else if (this.unreadOf(chat.id) > 0) {
      Text(this.unreadLabel(this.unreadOf(chat.id)))
        .fontSize(11)
        .fontWeight(FontWeight.Bold)
        .fontColor('#FFFFFF')
        .backgroundColor(this.unreadRed())
        .borderRadius(10)
        .constraintSize({ minWidth: 20, minHeight: 20 })
        .textAlign(TextAlign.Center)
        .padding({ left: 5, right: 5, top: 2, bottom: 2 })
    }
  }

  @Builder
  chiefStatusMark() {
    if (this.chief() !== null) {
      this.statusMark(this.chief() as BotChat)
    }
  }

  // ==================== 顶栏 / 标题区 ====================

  @Builder
  brandHeader(wide: boolean) {
    Row() {
      FluKeCoin({
        diameter: 36,
        onTap: () => {
          this.openDrawer();
        }
      })
        .margin({ right: 8 })
        .translate({ y: -1 })
      Image(this.isDark ? $r('app.media.wordmark_white') : $r('app.media.wordmark_ink'))
        .width(52)
        .height(15)
        .objectFit(ImageFit.Contain)
        .margin({ right: 9 })
      Text('HARNESS')
        .fontSize(9.5)
        .fontWeight(FontWeight.Bold)
        .fontColor(this.purple())
        .backgroundColor(this.lavenderSoft())
        .borderRadius(4)
        .height(15)
        .padding({ left: 6, right: 6 })
        .textAlign(TextAlign.Center)
        .letterSpacing(0.5)
      Blank()
      Row({ space: 6 }) {
        Circle({ width: 7, height: 7 })
          .fill(this.connection === 'connected'
            ? (this.state.supported ? this.successGreen() : '#E0A03C')
            : this.lineColor())
        Text(this.connection === 'connected'
          ? (this.state.supported ? 'DS Bot 已连接' : '主机未启用 DS-Bot')
          : '未连接')
          .fontSize(11.5)
          .fontColor(this.secondaryText())
      }
      .padding({ left: 8, right: 10, top: 5, bottom: 5 })
      .backgroundColor(this.lavenderSoft())
      .borderRadius(12)
    }
    .width('100%')
    .alignItems(VerticalAlign.Center)
    .margin({ bottom: wide ? 0 : 28 })
    .onClick(() => {
      this.openDrawer();
    })
  }

  @Builder
  hero(wide: boolean) {
    Column({ space: wide ? 6 : 3 }) {
      Text('个人助理')
        .fontSize(32)
        .fontWeight(FontWeight.Bold)
        .fontColor(this.ink())
      Text('今天也交给我吧。')
        .fontSize(15)
        .fontColor(this.secondaryText())
    }
    .alignItems(HorizontalAlign.Start)
    .width('100%')
  }

  // ==================== Chief / 主按钮 ====================

  @Builder
  chiefCard() {
    Column() {
      Row({ space: 12 }) {
        this.chiefAvatar()
        Column({ space: 2 }) {
          Text(this.chiefName())
            .fontSize(17)
            .fontWeight(FontWeight.Bold)
            .fontColor(this.ink())
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
          Row({ space: 4 }) {
            Circle({ width: 5, height: 5 })
              .fill(this.chiefRunning() ? this.successGreen() : this.purple())
            Text(this.chiefSubtitle())
              .fontSize(12)
              .fontColor(this.cardAccent())
              .maxLines(1)
              .textOverflow({ overflow: TextOverflow.Ellipsis })
          }
        }
        .alignItems(HorizontalAlign.Start)
        .layoutWeight(1)
      }
      .width('100%')
      .constraintSize({ minHeight: 66 })
      .padding({ left: 16, right: 16, top: 14, bottom: 14 })
      .backgroundColor(Color.Transparent)
      .backdropBlur(10)
      .clip(true)
      .borderRadius(21)
      .border({ width: 1, color: this.glassHairline() })
    }
    .width('100%')
    .borderRadius(21)
    .shadow(this.glassShadow())
    .onClick(() => {
      // 对齐 iOS：Chief 卡打开底部角色名片弹窗（原生玻璃），而不是直接跳页
      this.openChiefCard();
    })
  }

  @Builder
  startChatButton() {
    Column() {
      Stack({ alignContent: Alignment.Center }) {
        Row({ space: 10 }) {
          Image($r('app.media.bot_drawer_mark'))
            .width(22)
            .height(22)
            .objectFit(ImageFit.Contain)
            .colorFilter(this.iconTint(this.ink()))
          Text(this.startChatLabel())
            .fontSize(15)
            .fontWeight(FontWeight.Medium)
            .fontColor(this.ink())
        }
        .justifyContent(FlexAlign.Center)
        .width('100%')

        Row() {
          if (this.chiefHasStatus()) {
            this.chiefStatusMark()
          }
        }
        .width('100%')
        .justifyContent(FlexAlign.End)
      }
      .width('100%')
      .constraintSize({ minHeight: 46 })
      .padding({ left: 22, right: 22, top: 10.5, bottom: 10.5 })
      .backgroundColor(Color.Transparent)
      .backdropBlur(10)
      .clip(true)
      .borderRadius(19)
      .border({ width: 1, color: this.glassHairline() })
    }
    .width('100%')
    .borderRadius(19)
    .opacity(this.chief() === null ? 0.4 : 1)
    .shadow(this.glassShadow())
    .onClick(() => {
      const chief: BotChat | null = this.chief();
      if (chief !== null) {
        this.openChat(chief);
      }
    })
  }

  // ==================== 状态 / 加载卡 ====================

  @Builder
  statusCard() {
    if (this.showStatusCard()) {
      Column() {
        Column({ space: 10 }) {
          Text(this.statusText())
            .fontSize(15)
            .fontColor(this.secondaryText())
            .width('100%')
          if (this.connection === 'connected' && this.state.supported && this.hasError()) {
            // 错误卡里的「重新同步」chip：与卡片同一套沉浸玻璃（投影挂未裁剪外层）
            Column() {
              Text('重新同步')
                .fontSize(13)
                .fontColor(this.purple())
                .padding({ left: 18, right: 18, top: 8, bottom: 8 })
                .backgroundColor(Color.Transparent)
                .backdropBlur(10)
                .clip(true)
                .borderRadius(14)
                .border({ width: 1, color: this.glassHairline() })
            }
            .borderRadius(14)
            .shadow(this.glassShadow())
            .onClick(() => {
              BotStore.get().refreshAll();
            })
          }
        }
        .alignItems(HorizontalAlign.Start)
        .width('100%')
        .padding({ left: 16, right: 16, top: 14, bottom: 14 })
        .backgroundColor(Color.Transparent)
        .backdropBlur(10)
        .clip(true)
        .borderRadius(21)
        .border({ width: 1, color: this.glassHairline() })
      }
      .width('100%')
      .borderRadius(21)
      .shadow(this.glassShadow())
    }
  }

  @Builder
  loadingCard() {
    if (this.showLoadingCard()) {
      Column() {
        Row({ space: 10 }) {
          LoadingProgress()
            .width(20)
            .height(20)
            .color(this.purple())
          Text('正在同步助理')
            .fontSize(15)
            .fontColor(this.secondaryText())
        }
        .justifyContent(FlexAlign.Center)
        .width('100%')
        .padding({ left: 16, right: 16, top: 14, bottom: 14 })
        .backgroundColor(Color.Transparent)
        .backdropBlur(10)
        .clip(true)
        .borderRadius(21)
        .border({ width: 1, color: this.glassHairline() })
      }
      .width('100%')
      .borderRadius(21)
      .shadow(this.glassShadow())
    }
  }

  // ==================== 快捷入口卡 ====================

  @Builder
  shortcut(title: string, count: string, subtitle: string, onTap: () => void) {
    Column() {
      Column({ space: 4 }) {
        Row() {
          Text(title)
            .fontSize(15)
            .fontColor(this.ink())
          Blank()
          Text(count)
            .fontSize(17)
            .fontWeight(FontWeight.Bold)
            .fontColor(this.ink())
        }
        .width('100%')

        Text(subtitle)
          .fontSize(12)
          .fontColor(this.secondaryText())
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .width('100%')
      }
      .alignItems(HorizontalAlign.Start)
      .width('100%')
      .constraintSize({ minHeight: 66 })
      .padding({ left: 16, right: 16, top: 12, bottom: 12 })
      .backgroundColor(Color.Transparent)
      .backdropBlur(10)
      .clip(true)
      .borderRadius(19)
      .border({ width: 1, color: this.glassHairline() })
    }
    .layoutWeight(1)
    .borderRadius(19)
    .shadow(this.glassShadow())
    .onClick(onTap)
  }

  @Builder
  shortcutsRow() {
    Row({ space: 12 }) {
      this.shortcut('我的 Bot', this.rosterCount().toString(), '查看与创建', () => {
        this.pageStack.pushPathByName('bot-manage', null);
      })
      this.shortcut('定时任务', this.state.schedules.length.toString(), this.scheduleSubtitle(), () => {
        this.scheduleOpen = true;
      })
    }
    .width('100%')
  }

  // ==================== 聊天区 ====================

  @Builder
  chatTitleRow(wide: boolean) {
    Row({ space: 8 }) {
      Text('聊天')
        .fontSize(17)
        .fontWeight(FontWeight.Bold)
        .fontColor(this.ink())
      if (this.isSearching()) {
        Text(this.resultLabel())
          .fontSize(12)
          .fontColor(this.secondaryText())
      }
      Blank()
      // 圆形新建：沉浸玻璃圆钮（透明底 + 背景模糊 + 发丝描边，投影挂未裁剪外层）
      Column() {
        Stack() {
          Column()
            .width(13)
            .height(1.6)
            .borderRadius(1)
            .backgroundColor(this.ink())
          Column()
            .width(1.6)
            .height(13)
            .borderRadius(1)
            .backgroundColor(this.ink())
        }
        .width(28)
        .height(28)
        .backgroundColor(Color.Transparent)
        .backdropBlur(10)
        .clip(true)
        .borderRadius(14)
        .border({ width: 1, color: this.glassHairline() })
      }
      .width(28)
      .height(28)
      .borderRadius(14)
      .shadow(this.glassShadow())
      .bindMenu([
        { value: '新建 Bot', action: () => { this.pageStack.pushPathByName('bot-create', null); } },
        { value: '新建群聊', action: () => { this.pageStack.pushPathByName('bot-new-chat', null); } }
      ])
    }
    .width('100%')
    .alignItems(VerticalAlign.Center)
    .constraintSize({ minHeight: 40 })
    .margin({ top: wide ? 0 : 6 })
  }

  @Builder
  searchBox() {
    Column() {
      Row({ space: 8 }) {
        Text('🔍')
          .fontSize(16)
          .opacity(0.6)
        TextInput({ text: this.search, placeholder: '搜索聊天名称或内容' })
          .fontSize(15)
          .fontColor(this.ink())
          .placeholderColor(this.isDark ? this.secondaryText() : 'rgba(37,35,50,0.55)')
          .caretColor(this.purple())
          .backgroundColor(Color.Transparent)
          .padding({ left: 0, right: 0 })
          .layoutWeight(1)
          .height(42)
          .onChange((value: string) => {
            this.search = value;
          })
          .onFocus(() => {
            this.searchFocused = true;
          })
          .onBlur(() => {
            this.searchFocused = false;
          })
      }
      .width('100%')
      .height(42)
      .padding({ left: 12, right: 12 })
      .backgroundColor(Color.Transparent)
      .backdropBlur(10)
      .clip(true)
      .borderRadius(13)
      .border({ width: 1, color: this.glassHairline() })
    }
    .width('100%')
    .borderRadius(13)
    .shadow(this.glassShadow())
  }

  @Builder
  chatRow(chat: BotChat) {
    Row({ space: 12 }) {
      if (chat.room) {
        BotGroupAvatar({
          chatId: chat.id,
          chats: this.state.chats,
          mainBotId: this.state.mainBotId ?? '',
          faceSize: 44,
          isDark: this.isDark
        })
      } else {
        this.botAvatar(chat, 44, this.isMainChat(chat))
      }
      Column({ space: 4 }) {
        Text(chat.name)
          .fontSize(17)
          .fontWeight(FontWeight.Bold)
          .fontColor(this.ink())
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .width('100%')
        Text(this.chatSubtitle(chat))
          .fontSize(15)
          .fontColor(this.secondaryText())
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .width('100%')
      }
      .alignItems(HorizontalAlign.Start)
      .layoutWeight(1)

      if (this.runningOf(chat)) {
        this.statusMark(chat)
      } else if (this.unreadOf(chat.id) > 0) {
        this.statusMark(chat)
      } else if (chat.lastAt > 0) {
        Text(this.timeLabel(chat))
          .fontSize(12)
          .fontColor(this.secondaryText())
      }
    }
    .width('100%')
    .alignItems(VerticalAlign.Center)
    .padding({ left: 16, right: 16, top: 14, bottom: 14 })
    .constraintSize({ minHeight: 76 })
    .onClick(() => {
      this.openChat(chat);
    })
  }

  @Builder
  chatList() {
    if (this.visibleChats().length > 0) {
      Column() {
        Column() {
          ForEach(this.visibleChats(), (chat: BotChat, index: number) => {
            Column() {
              this.chatRow(chat)
              if (index < this.visibleChats().length - 1) {
                Divider()
                  .strokeWidth(0.6)
                  .color(this.lineColor())
                  .margin({ left: 78 })
              }
            }
            .width('100%')
          }, (chat: BotChat) => chat.id + ':' + chat.preview + ':' + chat.lastAt.toString())
        }
        .width('100%')
        .backgroundColor(Color.Transparent)
        .backdropBlur(10)
        .clip(true)
        .borderRadius(21)
        .border({ width: 1, color: this.glassHairline() })
      }
      .width('100%')
      .borderRadius(21)
      .shadow(this.glassShadow())
    } else if (this.isSearching()) {
      Column() {
        Column({ space: 8 }) {
          Text('没有找到相关聊天')
            .fontSize(17)
            .fontWeight(FontWeight.Bold)
            .fontColor(this.ink())
          Text('换个关键词试试')
            .fontSize(15)
            .fontColor(this.secondaryText())
        }
        .justifyContent(FlexAlign.Center)
        .width('100%')
        .constraintSize({ minHeight: 138 })
        .padding({ left: 16, right: 16, top: 14, bottom: 14 })
        .backgroundColor(Color.Transparent)
        .backdropBlur(10)
        .clip(true)
        .borderRadius(21)
        .border({ width: 1, color: this.glassHairline() })
      }
      .width('100%')
      .borderRadius(21)
      .shadow(this.glassShadow())
    } else {
      Column() {
        Column({ space: 6 }) {
          Text('还没有聊天')
            .fontSize(17)
            .fontWeight(FontWeight.Bold)
            .fontColor(this.ink())
          Text('在主机上创建 Bot 后，聊天会出现在这里。')
            .fontSize(15)
            .fontColor(this.secondaryText())
        }
        .alignItems(HorizontalAlign.Start)
        .width('100%')
        .padding({ left: 16, right: 16, top: 14, bottom: 14 })
        .backgroundColor(Color.Transparent)
        .backdropBlur(10)
        .clip(true)
        .borderRadius(21)
        .border({ width: 1, color: this.glassHairline() })
      }
      .width('100%')
      .borderRadius(21)
      .shadow(this.glassShadow())
    }
  }

  // ==================== 角色名片弹窗（底部原生玻璃，对齐 iOS §7.5） ====================

  @Builder
  roleSheetRow(label: string, value: string) {
    Row() {
      Text(label)
        .fontSize(15)
        .fontColor(this.secondaryText())
      Blank()
      Text(value)
        .fontSize(15)
        .fontColor(this.ink())
        .maxLines(2)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
        .textAlign(TextAlign.End)
        .constraintSize({ maxWidth: '62%' })
    }
    .width('100%')
    .constraintSize({ minHeight: 42 })
    .alignItems(VerticalAlign.Center)
  }

  @Builder
  roleSheetAction(label: string, value: string, action: () => void) {
    Row() {
      Text(label)
        .fontSize(15)
        .fontColor(this.ink())
      Blank()
      Text(value)
        .fontSize(13)
        .fontColor(this.secondaryText())
      Text('›')
        .fontSize(18)
        .fontColor(this.secondaryText())
        .margin({ left: 6 })
    }
    .width('100%')
    .constraintSize({ minHeight: 48 })
    .alignItems(VerticalAlign.Center)
    .onClick(action)
  }

  /** Chief 角色名片：底部原生沉浸玻璃弹窗（系统材质，永远玻璃样式） */
  @Builder
  chiefRoleSheet() {
    Column() {
      Column()
        .width(36)
        .height(4)
        .borderRadius(2)
        .backgroundColor(this.isDark ? 'rgba(255,255,255,0.28)' : 'rgba(37,35,50,0.18)')
        .margin({ top: 8, bottom: 8 })

      // 右上角「设置」：点它在同一个弹窗内切到角色设置（对齐 iOS 名片工具栏）
      if (this.chiefSheetPage === 0) {
        Row() {
          Blank()
          Text('设置')
            .fontSize(13)
            .fontWeight(FontWeight.Medium)
            .fontColor(this.primaryButton())
            .height(30)
            .padding({ left: 14, right: 14 })
            .backgroundColor(this.sheetFill())
            .borderRadius(15)
            .border({ width: 0.6, color: this.isDark ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.75)' })
            .onClick(() => {
              this.openSheetSettings();
            })
        }
        .width('100%')
        .margin({ bottom: 4 })
      }

      if (this.chiefSheetPage === 1) {
        this.chiefSettingsPane()
      } else {
      Scroll() {
        Column({ space: 16 }) {
          // 头部：orca 头像 + 名字 + 角色 + 说明
          Column({ space: 8 }) {
            if (this.chiefHasImage()) {
              Image(this.imageOf(this.chief() as BotChat))
                .width(80)
                .height(80)
                .borderRadius(80 / 3)
                .objectFit(ImageFit.Cover)
            } else {
              this.orcaAvatar(80)
            }
            Text(this.chiefName())
              .fontSize(24)
              .fontWeight(FontWeight.Bold)
              .fontColor(this.ink())
              .textAlign(TextAlign.Center)
            Text(this.chiefRoleLabel())
              .fontSize(15)
              .fontColor(this.secondaryText())
              .textAlign(TextAlign.Center)
            if (this.chiefInstructions().length > 0) {
              Text(this.chiefInstructions())
                .fontSize(13)
                .fontColor(this.secondaryText())
                .textAlign(TextAlign.Center)
                .maxLines(4)
                .textOverflow({ overflow: TextOverflow.Ellipsis })
                .padding({ left: 8, right: 8 })
            }
          }
          .width('100%')
          .alignItems(HorizontalAlign.Center)
          .padding({ top: 4, bottom: 4 })

          // 只读资料：模型 / 权限 / 工作文件夹 / 近 30 天用量
          Column() {
            this.roleSheetRow('模型', this.chiefModelLabel())
            Divider().color(this.lineColor()).strokeWidth(0.5)
            this.roleSheetRow('权限', this.chiefPermissionLabel())
            Divider().color(this.lineColor()).strokeWidth(0.5)
            this.roleSheetRow('工作文件夹', this.chiefWorkDirLabel())
            if (this.chiefUsageAvailable()) {
              Divider().color(this.lineColor()).strokeWidth(0.5)
              this.roleSheetRow('近 30 天用量', this.chiefUsageText())
            }
          }
          .width('100%')
          .padding({ left: 16, right: 16, top: 2, bottom: 2 })
          .backgroundColor(this.sheetFill())
          .borderRadius(20)
          .border({ width: 0.6, color: this.isDark ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.75)' })

          // 功能区：记忆 / 定时任务（都进完整角色页）
          Column() {
            this.roleSheetAction('记忆', this.chiefMemoryCount().toString() + ' 条', () => {
              this.openChiefRole();
            })
            Divider().color(this.lineColor()).strokeWidth(0.5)
            this.roleSheetAction('定时任务', this.chiefScheduleCount().toString() + ' 个', () => {
              this.openChiefRole();
            })
          }
          .width('100%')
          .padding({ left: 16, right: 16, top: 2, bottom: 2 })
          .backgroundColor(this.sheetFill())
          .borderRadius(20)
          .border({ width: 0.6, color: this.isDark ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.75)' })
        }
        .width('100%')
        .padding({ bottom: 8 })
      }
      .width('100%')
      .constraintSize({ maxHeight: 520 })
      .scrollBar(BarState.Off)
      .align(Alignment.Top)

      // 底部：关闭（设置入口在右上角）
      Text('关闭')
        .fontSize(15)
        .fontWeight(FontWeight.Medium)
        .fontColor(this.ink())
        .width('100%')
        .height(46)
        .textAlign(TextAlign.Center)
        .backgroundColor(this.sheetFill())
        .borderRadius(23)
        .border({ width: 0.6, color: this.isDark ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.75)' })
        .margin({ top: 12 })
        .onClick(() => {
          this.chiefSheetOpen = false;
        })
      }
    }
    .width('100%')
    .padding({ left: 20, right: 20, bottom: this.safeBottom })
  }


  // ==================== 弹窗内「角色设置」（不跳页，直接切弹窗内容） ====================

  /** 弹窗切到设置页：把当前资料灌进草稿并拉取可选模型档位 */
  private openSheetSettings(): void {
    this.syncRoleDraft();
    this.editOpError = '';
    this.chiefSheetPage = 1;
    const chief: BotChat | null = this.chief();
    if (chief !== null && chief.profile !== undefined) {
      const ref: string = chief.profile.model !== undefined ? chief.profile.model : '';
      if (ref.length > 0) {
        BotStore.get().loadEfforts(ref);
      }
    }
  }

  private syncRoleDraft(): void {
    const chief: BotChat | null = this.chief();
    if (chief === null) {
      return;
    }
    this.editName = chief.name;
    this.editRole = chief.role;
    const profile: BotRoleProfile | undefined = chief.profile;
    if (profile !== undefined) {
      this.editInstructions = profile.instructions;
      this.editModel = profile.model !== undefined ? profile.model : '';
      this.editEffort = profile.effort !== undefined ? profile.effort : '';
      this.editWorkDir = profile.workDir !== undefined ? profile.workDir : '';
      this.editPermission = profile.permission !== undefined ? profile.permission : '';
      this.editPrivate = profile.privateRole;
    }
    this.editLoaded = true;
  }

  /** 角色写操作回包：失败写红字，成功 toast 并刷新草稿 */
  private onRoleState(): void {
    if (this.editPending.length === 0) {
      if (!this.editLoaded && this.chiefSheetPage === 1) {
        const chief: BotChat | null = this.chief();
        if (chief !== null && chief.profile !== undefined) {
          this.syncRoleDraft();
        }
      }
      return;
    }
    if (this.state.roleSaving) {
      return;
    }
    const code: string = this.roleWriteErrorCode();
    this.editPending = '';
    if (code.length > 0) {
      this.editOpError = this.roleErrorText(code);
      return;
    }
    this.editLoaded = false;
    this.syncRoleDraft();
    try {
      this.getUIContext().getPromptAction().showToast({ message: '已保存' });
    } catch (ignored) {
    }
  }

  private roleWriteErrorCode(): string {
    const roleError: string = this.state.roleError ?? '';
    if (roleError.length > 0) {
      return roleError;
    }
    const generic: string = this.state.error ?? '';
    return generic !== this.editErrorBefore ? generic : '';
  }

  private roleErrorText(code: string): string {
    if (code === 'bot-unavailable' || code === 'bot/not-found') {
      return '主机上的 DS-Bot 尚未启用，或版本暂不支持';
    }
    if (code === 'bot-version-unsupported') {
      return '请更新主机上的 DS-Bot';
    }
    if (code === 'not-connected') {
      return '主机连接已断开，重连后将同步';
    }
    if (code === 'request-timeout' || code === 'bot-timeout') {
      return '保存超时，请稍后重试';
    }
    return '保存失败，请稍后重试';
  }

  private roleEditable(): boolean {
    return this.state.connected && this.state.roleSettingsSupported
      && this.state.writable && !this.state.roleSaving;
  }

  private collectRoleChanges(): Record<string, Object> {
    const changes: Record<string, Object> = {};
    const chief: BotChat | null = this.chief();
    if (chief === null) {
      return changes;
    }
    const trimmedName: string = this.editName.trim();
    if (trimmedName !== chief.name) {
      changes['name'] = trimmedName;
    }
    if (this.editRole !== chief.role) {
      changes['role'] = this.editRole;
    }
    const profile: BotRoleProfile | undefined = chief.profile;
    if (profile === undefined) {
      return changes;
    }
    if (this.editInstructions !== profile.instructions) {
      changes['instructions'] = this.editInstructions;
    }
    if (this.editModel.length > 0 && this.editModel !== (profile.model ?? '')) {
      changes['model'] = this.editModel;
    }
    if (this.editEffort.length > 0 && this.editEffort !== (profile.effort ?? '')) {
      changes['effort'] = this.editEffort;
    }
    const trimmedWorkDir: string = this.editWorkDir.trim();
    if (trimmedWorkDir.length > 0 && trimmedWorkDir !== (profile.workDir ?? '')) {
      changes['workDir'] = trimmedWorkDir;
    }
    if (this.editPermission.length > 0 && this.editPermission !== (profile.permission ?? '')) {
      changes['permission'] = this.editPermission;
    }
    if (this.editPrivate !== profile.privateRole) {
      changes['private'] = this.editPrivate;
    }
    return changes;
  }

  private roleHasChanges(): boolean {
    return Object.keys(this.collectRoleChanges()).length > 0;
  }

  private roleCanSave(): boolean {
    if (!this.roleEditable() || this.editName.trim().length === 0) {
      return false;
    }
    return this.roleHasChanges();
  }

  private saveRole(): void {
    if (!this.roleCanSave()) {
      return;
    }
    const changes: Record<string, Object> = this.collectRoleChanges();
    if (Object.keys(changes).length === 0) {
      return;
    }
    this.editPending = 'save';
    this.editErrorBefore = this.state.error ?? '';
    this.editOpError = '';
    const ok: boolean = BotStore.get().updateRole(this.chiefId(), changes);
    if (!ok) {
      this.editPending = '';
      this.editOpError = '保存失败：当前不可编辑，或主机未连接';
    }
  }

  private roleModelLabel(): string {
    if (this.editModel.length === 0) {
      return '默认模型';
    }
    for (const option of this.state.models) {
      if (option.id === this.editModel) {
        return option.title;
      }
    }
    return this.editModel;
  }

  private roleEffortLabel(): string {
    if (this.editEffort.length === 0) {
      return '默认';
    }
    for (const option of this.state.efforts) {
      if (option.id === this.editEffort) {
        return option.title;
      }
    }
    return this.editEffort;
  }

  private rolePermissionLabel(): string {
    if (this.editPermission.length === 0) {
      return '默认权限';
    }
    for (const option of this.state.permissions) {
      if (option.id === this.editPermission) {
        return option.title;
      }
    }
    return this.editPermission;
  }

  private rolePrivacyHint(): string {
    const chief: BotChat | null = this.chief();
    if (chief === null) {
      return '';
    }
    if (this.isMainChat(chief) || (this.state.mainBotIds.indexOf(chief.id) >= 0)) {
      return '主 Bot 不能开启隐私。';
    }
    return '开启后，其他 Bot 无法读取它的工作文件夹、记忆和对话。';
  }

  @Builder
  sheetFieldLabel(label: string) {
    Text(label)
      .fontSize(13)
      .fontColor(this.secondaryText())
      .width('100%')
  }

  @Builder
  sheetNavRow(label: string, value: string) {
    Row() {
      Text(label)
        .fontSize(15)
        .fontColor(this.ink())
      Blank()
      Text(value)
        .fontSize(14)
        .fontColor(this.secondaryText())
        .maxLines(1)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
        .constraintSize({ maxWidth: '58%' })
      Text('›')
        .fontSize(17)
        .fontColor(this.secondaryText())
        .margin({ left: 4 })
    }
    .width('100%')
    .constraintSize({ minHeight: 44 })
    .alignItems(VerticalAlign.Center)
  }

  @Builder
  modelMenu() {
    Menu() {
      ForEach(this.state.models, (option: BotRoleOption) => {
        MenuItem({ content: option.title })
          .onClick(() => {
            this.editModel = option.id;
            BotStore.get().loadEfforts(option.id);
          })
      }, (option: BotRoleOption) => option.id)
    }
  }

  @Builder
  effortMenu() {
    Menu() {
      ForEach(this.state.efforts, (option: BotRoleOption) => {
        MenuItem({ content: option.title })
          .onClick(() => {
            this.editEffort = option.id;
          })
      }, (option: BotRoleOption) => option.id)
    }
  }

  @Builder
  permissionMenu() {
    Menu() {
      ForEach(this.state.permissions, (option: BotRoleOption) => {
        MenuItem({ content: option.title })
          .onClick(() => {
            this.editPermission = option.id;
          })
      }, (option: BotRoleOption) => option.id)
    }
  }

  /** 弹窗内「角色设置」页（与名片同一个底部玻璃弹窗） */
  @Builder
  chiefSettingsPane() {
    Column() {
      Row() {
        Text('‹ 返回')
          .fontSize(15)
          .fontColor(this.primaryButton())
          .onClick(() => {
            this.chiefSheetPage = 0;
          })
        Blank()
        Text('角色设置')
          .fontSize(17)
          .fontWeight(FontWeight.Medium)
          .fontColor(this.ink())
        Blank()
        if (this.state.roleSaving) {
          LoadingProgress()
            .width(20)
            .height(20)
            .color(this.purple())
        } else {
          Text('保存')
            .fontSize(15)
            .fontWeight(FontWeight.Medium)
            .fontColor(this.roleCanSave() ? this.primaryButton() : this.secondaryText())
            .opacity(this.roleCanSave() ? 1 : 0.5)
            .onClick(() => {
              this.saveRole();
            })
        }
      }
      .width('100%')
      .height(40)
      .alignItems(VerticalAlign.Center)

      Scroll() {
        Column({ space: 12 }) {
          if (this.editOpError.length > 0) {
            Text(this.editOpError)
              .fontSize(13)
              .fontColor('#D9534F')
              .width('100%')
          }

          // 资料
          Column({ space: 8 }) {
            this.sheetFieldLabel('名字')
            TextInput({ text: this.editName, placeholder: 'Bot 名称' })
              .fontSize(15)
              .fontColor(this.ink())
              .height(42)
              .backgroundColor(this.sheetFill())
              .borderRadius(12)
              .enabled(this.roleEditable())
              .onChange((value: string) => {
                this.editName = value;
              })
            this.sheetFieldLabel('标签')
            TextInput({ text: this.editRole, placeholder: '一句话说明（不授予权限）' })
              .fontSize(15)
              .fontColor(this.ink())
              .height(42)
              .backgroundColor(this.sheetFill())
              .borderRadius(12)
              .enabled(this.roleEditable())
              .onChange((value: string) => {
                this.editRole = value;
              })
            this.sheetFieldLabel('说明')
            TextArea({ text: this.editInstructions, placeholder: '这个 Bot 负责什么…' })
              .fontSize(14)
              .fontColor(this.ink())
              .height(96)
              .backgroundColor(this.sheetFill())
              .borderRadius(12)
              .enabled(this.roleEditable())
              .onChange((value: string) => {
                this.editInstructions = value;
              })
          }
          .width('100%')
          .padding(14)
          .backgroundColor(this.sheetFill())
          .borderRadius(18)
          .border({ width: 0.6, color: this.isDark ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.75)' })

          // 运行
          Column() {
            Row() {
              this.sheetNavRow('模型', this.roleModelLabel())
            }
            .width('100%')
            .bindMenu(this.modelMenu())
            .enabled(this.roleEditable() && this.state.models.length > 0)
            if (this.state.efforts.length > 0 || this.editEffort.length > 0) {
              Divider().color(this.lineColor()).strokeWidth(0.5)
              Row() {
                this.sheetNavRow('推理强度', this.roleEffortLabel())
              }
              .width('100%')
              .bindMenu(this.effortMenu())
              .enabled(this.roleEditable())
            }
            Divider().color(this.lineColor()).strokeWidth(0.5)
            Row() {
              this.sheetNavRow('权限', this.rolePermissionLabel())
            }
            .width('100%')
            .bindMenu(this.permissionMenu())
            .enabled(this.roleEditable() && this.state.permissions.length > 0)
            Divider().color(this.lineColor()).strokeWidth(0.5)
            Column({ space: 6 }) {
              this.sheetFieldLabel('工作文件夹')
              TextInput({ text: this.editWorkDir, placeholder: '总工作区' })
                .fontSize(15)
                .fontColor(this.ink())
                .height(42)
                .backgroundColor(this.sheetFill())
                .borderRadius(12)
                .enabled(this.roleEditable())
                .onChange((value: string) => {
                  this.editWorkDir = value;
                })
            }
            .width('100%')
            .padding({ top: 6, bottom: 6 })
            .alignItems(HorizontalAlign.Start)
            Divider().color(this.lineColor()).strokeWidth(0.5)
            Row() {
              Column({ space: 2 }) {
                Text('隐私')
                  .fontSize(15)
                  .fontColor(this.ink())
                Text(this.rolePrivacyHint())
                  .fontSize(12)
                  .fontColor(this.secondaryText())
                  .maxLines(2)
              }
              .alignItems(HorizontalAlign.Start)
              .layoutWeight(1)
              Toggle({ type: ToggleType.Switch, isOn: this.editPrivate })
                .enabled(this.roleEditable() && !(this.isMainBotId(this.chiefId())))
                .onChange((value: boolean) => {
                  this.editPrivate = value;
                })
            }
            .width('100%')
            .constraintSize({ minHeight: 52 })
            .alignItems(VerticalAlign.Center)
          }
          .width('100%')
          .padding({ left: 14, right: 14, top: 4, bottom: 4 })
          .backgroundColor(this.sheetFill())
          .borderRadius(18)
          .border({ width: 0.6, color: this.isDark ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.75)' })

          // 记忆 / 定时任务：进完整页面编辑（弹窗内只给入口与数量）
          Column() {
            this.roleSheetAction('记忆', this.chiefMemoryCount().toString() + ' 条', () => {
              this.openChiefRole();
            })
            Divider().color(this.lineColor()).strokeWidth(0.5)
            this.roleSheetAction('定时任务', this.chiefScheduleCount().toString() + ' 个', () => {
              this.openChiefRole();
            })
          }
          .width('100%')
          .padding({ left: 14, right: 14, top: 2, bottom: 2 })
          .backgroundColor(this.sheetFill())
          .borderRadius(18)
          .border({ width: 0.6, color: this.isDark ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.75)' })
        }
        .width('100%')
        .padding({ bottom: 8 })
        .alignItems(HorizontalAlign.Start)
      }
      .width('100%')
      .layoutWeight(1)
      .scrollBar(BarState.Off)
      .align(Alignment.Top)
    }
    .width('100%')
    .constraintSize({ maxHeight: 560 })
  }

  // ==================== 定时任务面板（只读，§6） ====================

  @Builder
  clockIcon() {
    Stack({ alignContent: Alignment.Center }) {
      Circle({ width: 16, height: 16 })
        .fill(Color.Transparent)
        .stroke(this.purple())
        .strokeWidth(1.5)
      Column()
        .width(1.5)
        .height(5)
        .borderRadius(1)
        .backgroundColor(this.purple())
        .translate({ y: -2 })
      Column()
        .width(4.5)
        .height(1.5)
        .borderRadius(1)
        .backgroundColor(this.purple())
        .translate({ x: 1.8 })
    }
    .width(36)
    .height(36)
    .backgroundColor(this.lavenderSoft())
    .borderRadius(12)
  }

  @Builder
  scheduleRow(task: BotSchedule) {
    Row({ space: 12 }) {
      this.clockIcon()
      Column({ space: 4 }) {
        Text(task.title)
          .fontSize(17)
          .fontWeight(FontWeight.Bold)
          .fontColor(this.ink())
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .width('100%')
        Text(task.status)
          .fontSize(12)
          .fontColor(this.secondaryText())
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .width('100%')
      }
      .alignItems(HorizontalAlign.Start)
      .layoutWeight(1)

      Text(task.next)
        .fontSize(17)
        .fontWeight(FontWeight.Bold)
        .fontColor(this.purple())
        .maxLines(2)
        .textAlign(TextAlign.End)
        .constraintSize({ maxWidth: 110 })
    }
    .width('100%')
    .alignItems(VerticalAlign.Center)
    .padding(16)
    .constraintSize({ minHeight: 96 })
    .backgroundColor(this.cardSolid())
    .borderRadius(22)
    .border({ width: 1, color: this.rimColor() })
  }

  @Builder
  scheduleSheet() {
    Column() {
      // 拖动条（36×4，可见）
      Row() {
        Column()
          .width(36)
          .height(4)
          .borderRadius(2)
          .backgroundColor(this.isDark ? 'rgba(216,210,225,0.35)' : 'rgba(92,83,108,0.30)')
      }
      .width('100%')
      .justifyContent(FlexAlign.Center)
      .padding({ top: 8, bottom: 14 })

      // 标题行：22 semibold + 关闭 40×40
      Row() {
        Text('定时任务')
          .fontSize(22)
          .fontWeight(FontWeight.Bold)
          .fontColor(this.ink())
        Blank()
        Row() {
          Text('关闭')
            .fontSize(14)
            .fontWeight(FontWeight.Medium)
            .fontColor(this.ink())
        }
        .height(32)
        .padding({ left: 16, right: 16 })
        .justifyContent(FlexAlign.Center)
        .backgroundColor(appGlassFill(this.isDark))
        .backdropBlur(appGlassBlur(this.isDark))
        .clip(true)
        .borderRadius(16)
        .border({ width: 1, color: appGlassBorderColor(this.isDark) })
        .shadow(appGlassShadow(this.isDark))
        .onClick(() => {
          this.scheduleOpen = false;
        })
      }
      .width('100%')
      .alignItems(VerticalAlign.Center)

      Text('让助理按时替你做事。')
        .fontSize(15)
        .fontColor(this.secondaryText())
        .width('100%')
        .margin({ top: 4, bottom: 18 })

      if (this.state.schedules.length === 0) {
        Column() {
          Text(this.scheduleStateText())
            .fontSize(15)
            .fontColor(this.secondaryText())
            .width('100%')
        }
        .width('100%')
        .padding(16)
        .backgroundColor(this.cardSolid())
        .borderRadius(20)
        .border({ width: 1, color: this.rimColor() })
      } else {
        List({ space: 12 }) {
          ForEach(this.state.schedules, (task: BotSchedule) => {
            ListItem() {
              this.scheduleRow(task)
            }
          }, (task: BotSchedule) => task.id)
        }
        .width('100%')
        .constraintSize({ maxHeight: 420 })
        .scrollBar(BarState.Off)
      }

      Text('完成后，' + this.chiefName() + ' 会在聊天里告诉你。')
        .fontSize(12)
        .fontColor(this.secondaryText())
        .width('100%')
        .margin({ top: 16 })
    }
    .width('100%')
    .padding({ left: 20, right: 20, top: 6, bottom: 20 + this.safeBottom })
    // 面板本身交给系统沉浸玻璃材质绘制（见 build() 的 bindSheet），这里只排内容
    .backgroundColor(Color.Transparent)
  }

  // ==================== 布局（手机单栏 / 宽屏 R2 双栏） ====================

  /** 手机单栏：现有布局原样保留；R2 断点不满足时回退到这里 */
  @Builder
  compactHome() {
    Scroll() {
      Column({ space: 16 }) {
        this.brandHeader(false)
        // 复用工作模式首页的「切换主机」行（主机胶囊 + 配对/设置圆钮 + 切换主机半模态）
        HostSwitcherBar({ isDark: this.isDark, compact: true })
        this.hero(false)
        this.chiefCard()
        this.startChatButton()
        this.statusCard()
        this.loadingCard()
        this.shortcutsRow()
        this.chatTitleRow(false)
        this.searchBox()
        this.chatList()
      }
      .width('100%')
      .padding({ left: 22, right: 22, top: this.topInset() + 18, bottom: 24 + this.safeBottom })
      .alignItems(HorizontalAlign.Start)
    }
    .width('100%')
    .height('100%')
    .scrollBar(BarState.Off)
    .align(Alignment.Top)
  }

  /**
   * 宽屏 R2（对齐 iOS BotModeView wideHome）：左栏助理区 / 右栏聊天区，顶部对齐。
   * 外边距 40、栏间距 48、左栏 min(440, W×0.38)、右栏填满剩余、内容最大 1440 居中（§8.8）。
   */
  @Builder
  wideHome() {
    Scroll() {
      Column({ space: 40 }) {
        Column({ space: 8 }) {
          this.brandHeader(true)
          // 宽屏同样保留切换主机行（跨两栏，品牌行下方）
          HostSwitcherBar({ isDark: this.isDark, compact: true })
        }
        .width('100%')
        .alignItems(HorizontalAlign.Start)

        Row({ space: 48 }) {
          Column({ space: 16 }) {
            this.hero(true)
            this.chiefCard()
            this.startChatButton()
            this.statusCard()
            this.loadingCard()
            this.shortcutsRow()
          }
          .width(this.wideLeftWidth())
          .alignItems(HorizontalAlign.Start)

          Column({ space: 16 }) {
            this.chatTitleRow(true)
            this.searchBox()
            this.chatList()
          }
          .layoutWeight(1)
          .alignItems(HorizontalAlign.Start)
        }
        .width('100%')
        .alignItems(VerticalAlign.Top)
      }
      .width(this.wideContentWidth())
      .alignItems(HorizontalAlign.Start)
      .padding({ left: 40, right: 40, top: this.topInset() + 18, bottom: 24 + this.safeBottom })
    }
    .width('100%')
    .height('100%')
    .scrollBar(BarState.Off)
    .align(Alignment.Top)
  }

  build() {
    NavDestination() {
      Stack({ alignContent: Alignment.TopStart }) {
        // 左侧栏底层（与工作模式同一套抽屉；Bot 模式首项为「切换到工作模式」）
        this.drawerOverlay()

        // 内容层：抽屉展开时整体右移并在左侧裁圆角，露出下层抽屉（对齐工作模式首页）
        Stack({ alignContent: Alignment.Bottom }) {
          // Bot 浅紫主题背景（静态 Canvas，一次绘制）
          BotBackground()

          if (this.isWide()) {
            this.wideHome()
          } else {
            this.compactHome()
          }

          // 抽屉遮罩：点击收回
          if (this.drawerOpen) {
            Column()
              .width('100%')
              .height('100%')
              .backgroundColor('rgba(0,0,0,0.16)')
              .onClick(() => {
                this.closeDrawer();
              })
          }

          // 第二个 sheet 挂到独立节点：同一节点只能有一个 bindSheet，否则后者覆盖前者
          Column()
            .width(0)
            .height(0)
            .bindSheet($$this.scheduleOpen, this.scheduleSheet(), {
              height: SheetSize.FIT_CONTENT,
              dragBar: false,
              showClose: false,
              preferType: SheetType.BOTTOM,
              backgroundColor: this.immersiveSupported() ? Color.Transparent : this.sheetFallbackColor(),
              systemMaterial: this.sheetMaterial()
            })
        }
        .width('100%')
        .height(this.drawerOpen ? ('calc(100% - ' + (this.drawerInsetVp() * 2) + 'vp)') : '100%')
        .borderRadius({ topLeft: this.drawerOpen ? 48 : 0, bottomLeft: this.drawerOpen ? 48 : 0 })
        .clip(true)
        .translate({ x: this.drawerShift(), y: this.drawerInsetVp() })
        .animation({ duration: 320, curve: Curve.FastOutSlowIn })
        .backgroundColor(this.isDark ? '#17161F' : '#F4F1FA')
        // 首页横向手势：右滑开抽屉、左滑收抽屉（只吃横向，避免抢走 Scroll 的竖向手势）
        .gesture(
          PanGesture({ fingers: 1, direction: PanDirection.Horizontal, distance: 12 })
            .onActionEnd((event: GestureEvent) => {
              this.onHomeSwipeEnd(event);
            })
        )
      }
      .width('100%')
      .height('100%')
      // 抽屉展开时整页底色与抽屉同色：让抽屉背景延伸到主页内容层之外（上/下/右侧外露区域），
      // 对齐工作模式首页的 drawerBg 处理
      .backgroundColor(this.drawerOpen ? this.drawerBg() : (this.isDark ? '#17161F' : '#F4F1FA'))
      .onAreaChange((_oldArea: Area, newArea: Area) => {
        this.onPageArea(newArea);
      })
      // Chief 角色名片：底部原生沉浸玻璃弹窗（永远是系统玻璃样式）
      .bindSheet($$this.chiefSheetOpen, this.chiefRoleSheet(), {
        height: SheetSize.FIT_CONTENT,
        dragBar: false,
        showClose: false,
        preferType: SheetType.BOTTOM,
        backgroundColor: this.immersiveSupported() ? Color.Transparent : this.sheetFallbackColor(),
        systemMaterial: this.sheetMaterial()
      })
    }
    .hideTitleBar(true)
    // 返回：抽屉打开时先收抽屉；否则离开 Bot 模式并写回工作模式
    .onBackPressed(() => {
      if (this.drawerOpen) {
        this.drawerOpen = false;
        return true;
      }
      this.leaveBotMode();
      return true;
    })
  }

  // ==================== 左侧栏（对齐工作模式 WorkspaceDrawer / iOS §2） ====================

  @Builder
  drawerOverlay() {
    Column() {
      Row({ space: 6 }) {
        FluKeCoin({ diameter: 30 })
          .translate({ y: -1 })
        Image(this.isDark ? $r('app.media.wordmark_white') : $r('app.media.wordmark_ink'))
          .width(52)
          .height(15)
          .objectFit(ImageFit.Contain)
        Text('HARNESS')
          .fontSize(9.5)
          .fontWeight(FontWeight.Bold)
          .fontColor(this.isDark ? '#10151F' : '#FFFFFF')
          .backgroundColor(this.isDark ? '#FFFFFF' : '#10151F')
          .borderRadius(4)
          .height(15)
          .padding({ left: 6, right: 6 })
          .textAlign(TextAlign.Center)
          .letterSpacing(0.5)
      }
      .width('100%')
      .alignItems(VerticalAlign.Center)
      .padding({ left: 6, bottom: 16 })

      // 首项：模式切换（Bot 模式 → 切换到工作模式，尾随双箭头）
      Row({ space: 10 }) {
        Image($r('app.media.workspace_drawer_mark'))
          .width(24)
          .height(24)
          .objectFit(ImageFit.Contain)
          .colorFilter(this.iconTint(this.ink()))
        Text('切换到工作模式')
          .fontSize(17)
          .fontColor(this.isDark ? '#FFFFFF' : '#101318')
          .layoutWeight(1)
        Image($r('app.media.mode_swap'))
          .width(16)
          .height(19.6)
          .objectFit(ImageFit.Contain)
      }
      .width('100%')
      .constraintSize({ minHeight: 52 })
      .padding({ left: 14, right: 14 })
      .borderRadius(12)
      .hoverEffect(HoverEffect.Highlight)
      .onClick((event: ClickEvent) => {
        Haptics.play();
        // 对齐 iOS：抽屉立即无动画归零 → 以点击点为圆心播放模式波纹（目标=工作模式深海军蓝）→ 无滑动转场弹回工作首页
        this.drawerInstant = true;
        this.drawerOpen = false;
        startModeWave(event.windowX, event.windowY, '#081A2E');
        setTimeout(() => {
          this.drawerInstant = false;
          this.leaveBotMode(false);
        }, 430);
      })

      this.drawerItem($r('app.media.pinwheel_ink'), $r('app.media.pinwheel_ink'), '插件', 'plugins')
      this.drawerItem($r('app.media.automation_ink'), $r('app.media.automation_white'), '自动化任务', 'schedule')
      this.drawerItem($r('app.media.connector_ink'), $r('app.media.connector_white'), '连接器', 'connectors')

      Blank()

      Column() {
        this.drawerItem($r('app.media.settings_ink'), $r('app.media.settings_white'), '设置', 'app-settings')
      }
      .width('100%')
      .padding({ top: 24 })
    }
    .width(this.drawerWidth)
    .height('100%')
    .padding({
      left: 18,
      right: 18,
      top: Math.max(this.safeTop, 38) + 20,
      bottom: Math.max(this.safeBottom, 30) + 24
    })
    .backgroundColor(this.drawerBg())
    .alignItems(HorizontalAlign.Start)
    .position({ x: 0, y: 0 })
    .translate({ x: this.drawerOpen ? 0 : -this.drawerWidth })
    .animation({ duration: this.drawerInstant ? 0 : 320, curve: Curve.FastOutSlowIn })
  }

  @Builder
  drawerItem(icon: Resource, iconDark: Resource, label: string, route: string) {
    Row({ space: 10 }) {
      Image(this.isDark ? iconDark : icon)
        .width(24)
        .height(24)
        .objectFit(ImageFit.Contain)
        .colorFilter(this.iconTint(this.isDark ? '#FFFFFF' : '#101318'))
      Text(label)
        .fontSize(17)
        .fontColor(this.isDark ? '#FFFFFF' : '#101318')
        .layoutWeight(1)
    }
    .width('100%')
    .constraintSize({ minHeight: 52 })
    .padding({ left: 14, right: 14 })
    .borderRadius(12)
    .hoverEffect(HoverEffect.Highlight)
    .onClick(() => {
      Haptics.play();
      this.exitToRoute(route);
    })
  }
}
