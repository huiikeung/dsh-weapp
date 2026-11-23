import { common } from '@kit.AbilityKit';
import { pasteboard } from '@kit.BasicServicesKit';
import { display, KeyboardAvoidMode, LengthMetrics, uiMaterial } from '@kit.ArkUI';
import { drawing } from '@kit.ArkGraphics2D';
import { scanBarcode, scanCore } from '@kit.ScanKit';
import { TailscaleMarkView } from '../components/TailscaleMarkView';
import { FluKeCoin } from '../components/FluKeCoin';
import { Haptics } from '../services/Haptics';
import { StatusBarStyle, STATUS_BAR_HOME_ROUTE } from '../services/StatusBarStyle';
import { openSessionRoute } from '../common/SessionRoute';
import {
  GatewayClient, OceanBackground, PairingResult, PreferencesStore, SessionStore, SessionSummary,
  DirEntry, DirCrumb, WorkspaceRow, parsePairingPayload, SavedGateway
} from 'nativecore';

/** 全部会话视图：每个工作区分区默认显示的条数（对齐小程序 ALL_SESSIONS_SECTION_LIMIT） */
const SESSION_SECTION_LIMIT: number = 5;
/** 最近会话 / 单个工作区视图默认显示的条数（对齐小程序 RECENT_SESSION_LIMIT） */
const SESSION_RECENT_LIMIT: number = 12;
const SESSION_UNGROUPED: string = '__ungrouped__';

/** 全部会话视图中的一个工作区分区（对齐小程序 displayEntries 的 section 项） */
interface SessionSection {
  id: string;
  title: string;
  rows: SessionSummary[];
  shown: SessionSummary[];
  expanded: boolean;
  toggleLabel: string;
  lastSection: boolean;
}

@Component
export struct HomePage {
  @StorageLink('isDark') @Watch('onIsDarkChanged') isDark: boolean = false;
  @StorageLink('connectionState') @Watch('onConnectionChanged') connection: string = 'disconnected';
  @StorageLink('tailscaleTunnelEnabled') tailscaleTunnelEnabled: boolean = false;
  @StorageLink('tailscaleStage') tailscaleStage: string = 'disabled';
  @StorageLink('transportTailnet') transportTailnet: boolean = false;
  @StorageLink('sessions') sessions: SessionSummary[] = [];
  @StorageLink('gatewayName') gatewayName: string = '';
  @State creating: boolean = false;
  @State createHint: string = '';
  @State search: string = '';
  @State drawerOpen: boolean = false;
  // 侧栏右推：抽屉在下层，首页整体右移（对齐小程序 contentX / contentCornerRadius）
  @State drawerWidth: number = 280;
  private drawerShift(): number {
    return this.drawerOpen ? this.drawerWidth : 0;
  }
  /** 侧栏展开时首页内容层上下各让出的高度（vp）：顶部让到状态栏下方，底部同高对称，形成明显的浮起卡片 */
  private drawerInsetVp(): number {
    if (!this.drawerOpen) {
      return 0;
    }
    const statusBar: number = this.safeTopStorage > 0 ? this.safeTopStorage : 38.9;
    // 状态栏高度 + 一点缝隙（16rpx 约 9vp），保证卡片顶边落在状态栏下方
    return Math.round(statusBar + this.rpx(16));
  }

  /** 打开左侧栏的统一入口：附带与设置页「震动反馈」一致档位的触感 */
  private openDrawer(): void {
    if (this.drawerOpen) {
      return;
    }
    this.drawerOpen = true;
    Haptics.play();
  }

  /**
   * 首页横向手势结束：
   * 右滑（dx>0）→ 打开左侧栏；左滑（dx<0）→ 打开会话设置页面。
   * 位移需 ≥64vp 且以横向为主，避免与 Scroll 的竖向滚动互相误触。
   */
  private onHomeSwipeEnd(event: GestureEvent): void {
    const dx: number = event.offsetX;
    const dy: number = event.offsetY;
    if (Math.abs(dx) < 64 || Math.abs(dx) < Math.abs(dy) * 1.2) {
      return;
    }
    if (dx > 0) {
      this.openDrawer();
      return;
    }
    // 左滑：侧栏展开时先收起，否则打开会话设置
    if (this.drawerOpen) {
      this.drawerOpen = false;
      Haptics.play();
      return;
    }
    Haptics.play();
    this.pageStack.pushPathByName('session-settings', null);
  }

  /** 兼容旧入口：右滑结束 */
  private onDrawerSwipeEnd(event: GestureEvent): void {
    this.onHomeSwipeEnd(event);
  }
  @State manualSheetOpen: boolean = false;
  /** 配对按钮屏幕左边缘（用于把菜单水平居中） */
  @State private pairBtnX: number = 0;
  @State manualText: string = '';
  @State manualHint: string = '';
  @StorageLink('keyboardHeightVp') keyboardHeightVp: number = 0;
  @State hostSheetOpen: boolean = false;
  @State hostEditMode: boolean = false;
  /** 编辑模式下勾选的主机 id（多选删除，对齐小程序 host-select） */
  @State hostSelectedIds: string[] = [];
  /** 当前编辑表单对应的主机 id（空 = 编辑当前连接主机） */
  @State editingGatewayId: string = '';
  @State hostEditOpen: boolean = false;
  @State hostDeleteOpen: boolean = false;
  @State editAlias: string = '';
  @State editKind: string = 'desktop';
  @State pairMenuOpen: boolean = false;
  @State kindMenuOpen: boolean = false;
  @State wsFilter: string = 'all';
  @State wsMenuOpen: boolean = false;
  @State wsCardW: number = 0;
  @State wsCardH: number = 0;
  // 全部会话视图里已展开的工作区分区（对齐小程序 expandedSectionIds）
  @State expandedSectionIds: string[] = [];
  // 最近会话 / 单个工作区视图是否展开到全部（对齐小程序 recentExpanded）
  @State recentExpanded: boolean = false;
  // 会话长按菜单 / 重命名 / 归档（对齐小程序 session-menu）
  @State sessionMenuOpen: boolean = false;
  @State sessionMenuId: string = '';
  @State renameSessionOpen: boolean = false;
  @State renameSessionId: string = '';
  @State renameValue: string = '';
  @State archiveSessionOpen: boolean = false;
  @State archiveSessionId: string = '';
  // 最近一次长按时间：抬手后的点按要忽略，避免长按又顺带打开会话
  private sessionLongPressAt: number = 0;
  // 长按检测（自己做计时，不走手势仲裁，避免被 Scroll 抢走）
  private pressTimer: number = -1;
  private pressX: number = 0;
  private pressY: number = 0;
  // 本次长按的落点（vp），菜单据此定位：水平居中、纵向跟手
  private menuPressY: number = 0;
  @State dirSheetOpen: boolean = false;
  @State dirError: string = '';
  @State dirLoading: boolean = false;
  @State dirShowHidden: boolean = false;
  @State dirCreatingWs: boolean = false;
  @State dirCreatingDir: boolean = false;
  @State dirNewFolderOpen: boolean = false;
  @State dirNewFolderName: string = '';
  @State dirNewFolderError: string = '';
  @State dirJumpOpen: boolean = false;
  @State dirJumpValue: string = '';
  @State dirJumpError: string = '';
  @State dirLocationsOpen: boolean = false;
  // 首屏是否还需要跳到网关家目录（对齐小程序 openDirSheet）
  private dirAutoHome: boolean = false;
  @StorageLink('dirEntries') @Watch('onDirEntriesChanged') dirEntries: DirEntry[] = [];
  @StorageLink('dirCurrent') dirCurrent: string = '';
  @StorageLink('dirCrumbs') dirCrumbs: DirCrumb[] = [];
  @StorageLink('dirHome') dirHome: string = '';
  @StorageLink('workspaces') @Watch('onWorkspacesChanged') workspaces: WorkspaceRow[] = [];
  @StorageLink('hostAlias') hostAlias: string = '';
  // 网关判定保存的设备凭据失效（握手 401）后置位：界面据此提示重新配对，而不是假装没有主机
  @StorageLink('gatewayCredentialRejected') credentialRejected: boolean = false;
  // 已保存主机快照（未连接时也要显示，见 refreshSavedHosts）
  @State savedHosts: SavedGateway[] = [];
  @StorageLink('transportKind') transportKind: string = '';
  @State rowY: number = 0;
  @State rowH: number = 0;
  @State sheetHint: string = '';
  @StorageLink('safeTopVp') safeTopStorage: number = 0;
  @StorageLink('safeBottomVp') safeBottomStorage: number = 0;

  private get safeTop(): number {
    return this.safeTopStorage > 0 ? this.safeTopStorage : 34;
  }

  private get safeBottom(): number {
    return this.safeBottomStorage > 0 ? this.safeBottomStorage : 20;
  }
  @Consume('pageStack') pageStack: NavPathStack;

  private bg(): string {
    return '#141518';
  }

  /** 首页恒为深海深色背景：状态栏内容强制白色（浅色主题下系统会重置成黑，需显式覆盖）。
   *  颜色由 StatusBarStyle 按「首页可见 → 白 / 其它页面跟随主题」统一决定，
   *  切主题、系统配色变化、回前台都会重新写回，避免出现深海背景配黑字。 */
  private applyStatusBarWhite(): void {
    StatusBarStyle.setRoute(STATUS_BAR_HOME_ROUTE);
  }

  /** 切换浅色/深色后系统会重刷状态栏（浅色下变黑字），首页背景始终是深海深色，立刻改回白字 */
  onIsDarkChanged(): void {
    this.applyStatusBarWhite();
  }

  private navPad(): Length {
    return 16;
  }

  private workspacePath(): string {
    for (const item of this.sessions) {
      if (item.cwd.length > 0) {
        return item.cwd;
      }
    }
    return '~/workspace/dsh';
  }

  /** rpx → vp：小程序 750rpx = 屏宽，这里按同一比例换算字号/尺寸 */
  private rpx(value: number): number {
    try {
      const screenW: number = this.getUIContext().px2vp(display.getDefaultDisplaySync().width);
      return value * screenW / 750;
    } catch (err) {
      return value * 0.53;
    }
  }

  /** 菜单行宽：约 52% 屏宽（190~232） */
  /**
   * 选择工作区菜单宽度（对齐小程序 home.js 的弹窗布局）：
   *   width = min(240, max(200, screenW * 0.6), screenW - 16)
   */
  private wsMenuWidth(): number {
    try {
      const screenW: number = this.getUIContext().px2vp(display.getDefaultDisplaySync().width);
      return Math.min(240, Math.max(200, screenW * 0.6), screenW - 16);
    } catch (err) {
      return 232;
    }
  }

  /** 菜单高度估算（行高 84rpx + 内容上下 16rpx） */
  private wsMenuHeight(): number {
    const rows: number = 2 + 1 + this.workspaces.length;
    return rows * this.rpx(84) + this.rpx(32);
  }

  private workspaceTitle(): string {
    if (this.wsFilter === 'all') {
      return '全部会话';
    }
    if (this.wsFilter === 'ungrouped') {
      return '未分组';
    }
    for (const ws of this.workspaces) {
      if (ws.workspaceId === this.wsFilter) {
        return ws.title;
      }
    }
    return this.gatewayName.length > 0 ? this.gatewayName : 'DSH 工作区';
  }

  private workspaceSubtitle(): string {
    if (this.wsFilter === 'all') {
      return this.sessions.length + ' 个会话';
    }
    if (this.wsFilter === 'ungrouped') {
      return '不属于任何工作区';
    }
    for (const ws of this.workspaces) {
      if (ws.workspaceId === this.wsFilter) {
        return ws.path.length > 0 ? ws.path : ws.title;
      }
    }
    return this.workspacePath();
  }

  private timeLabel(updatedAt: number): string {
    if (updatedAt <= 0) {
      return '';
    }
    const delta: number = Date.now() - updatedAt;
    const min: number = Math.floor(delta / 60000);
    if (min < 1) {
      return '刚刚';
    }
    if (min < 60) {
      return min + ' 分钟前';
    }
    const hour: number = Math.floor(min / 60);
    if (hour < 24) {
      return hour + ' 小时前';
    }
    return Math.floor(hour / 24) + ' 天前';
  }

  private statusText(): string {
    if (this.connection === 'connected') {
      return '已连接';
    }
    if (this.connection === 'connecting') {
      return '连接中';
    }
    return '未连接';
  }

  private statusColor(): string {
    if (this.connection === 'connected') {
      return '#34C759';
    }
    if (this.connection === 'connecting') {
      return '#FF9500';
    }
    return 'rgba(255,255,255,0.45)';
  }

  private inWorkspace(item: SessionSummary): boolean {
    if (this.wsFilter === 'all') {
      return true;
    }
    if (this.wsFilter === 'ungrouped') {
      for (const ws of this.workspaces) {
        if (ws.sessionIds.indexOf(item.id) >= 0) {
          return false;
        }
      }
      return true;
    }
    for (const ws of this.workspaces) {
      if (ws.workspaceId === this.wsFilter) {
        return ws.sessionIds.indexOf(item.id) >= 0;
      }
    }
    return true;
  }

  private filtered(): SessionSummary[] {
    const scoped: SessionSummary[] = [];
    for (const item of this.sessions) {
      if (this.inWorkspace(item)) {
        scoped.push(item);
      }
    }
    const key: string = this.search.trim().toLowerCase();
    if (key.length === 0) {
      return scoped;
    }
    const out: SessionSummary[] = [];
    for (const item of scoped) {
      const title: string = item.title.length > 0 ? item.title : item.id;
      if (title.toLowerCase().indexOf(key) >= 0) {
        out.push(item);
      }
    }
    return out;
  }

  private sessionTitle(item: SessionSummary): string {
    if (item.title.length > 0) {
      return item.title;
    }
    return '新会话';
  }

  private screenWidthVp(): number {
    try {
      return this.getUIContext().px2vp(display.getDefaultDisplaySync().width);
    } catch (err) {
      return 360;
    }
  }

  private screenHeightVp(): number {
    try {
      return this.getUIContext().px2vp(display.getDefaultDisplaySync().height);
    } catch (err) {
      return 780;
    }
  }

  /** 长按会话：记录目标会话，菜单锚点固定在屏幕正中弹出 */
  private openSessionMenu(item: SessionSummary): void {
    this.sessionMenuId = item.id;
    this.sessionMenuOpen = true;
  }

  private cancelPressTimer(): void {
    if (this.pressTimer >= 0) {
      clearTimeout(this.pressTimer);
      this.pressTimer = -1;
    }
  }

  /** 手指按住不动 1s 视为长按：不参与手势仲裁，Scroll 不会抢走 */
  private handleRowTouch(event: TouchEvent, item: SessionSummary): void {
    if (event.type === TouchType.Down) {
      this.cancelPressTimer();
      const touch = event.touches.length > 0 ? event.touches[0] : undefined;
      this.pressX = touch !== undefined ? touch.x : 0;
      this.pressY = touch !== undefined ? touch.y : 0;
      this.menuPressY = touch !== undefined ? touch.windowY : this.menuPressY;
      this.pressTimer = setTimeout(() => {
        this.pressTimer = -1;
        this.sessionLongPressAt = Date.now();
        this.openSessionMenu(item);
      }, 1000);
      return;
    }
    if (event.type === TouchType.Move) {
      const touch = event.touches.length > 0 ? event.touches[0] : undefined;
      const dx: number = touch !== undefined ? Math.abs(touch.x - this.pressX) : 0;
      const dy: number = touch !== undefined ? Math.abs(touch.y - this.pressY) : 0;
      if (dx > 10 || dy > 10) {
        this.cancelPressTimer();
      }
      return;
    }
    // Up / Cancel
    this.cancelPressTimer();
  }

  /**
   * 菜单锚点：只做**水平居中**（纵向跟随长按位置，不上下居中）。
   * 实测系统菜单约 173×83vp；锚点 x 取"屏幕中心 - 菜单半宽"，
   * 纵向由 bindMenu 从锚点向下展开，实测菜单顶边 ≈ 锚点 y - 140。
   */
  private menuAnchorX(): number {
    return Math.max(0, this.screenWidthVp() / 2 - 78);
  }

  private menuAnchorY(): number {
    const y: number = this.menuPressY + 140;
    return Math.min(y, Math.max(0, this.screenHeightVp() - 120));
  }

  private menuSession(): SessionSummary | undefined {
    for (const one of this.sessions) {
      if (one.id === this.sessionMenuId) {
        return one;
      }
    }
    return undefined;
  }

  private onSessionMenuAction(action: string): void {
    const item: SessionSummary | undefined = this.menuSession();
    this.sessionMenuOpen = false;
    if (item === undefined) {
      return;
    }
    if (action === 'rename') {
      this.beginRenameSession(item);
    } else if (action === 'archive') {
      this.beginArchiveSession(item);
    }
  }

  private beginRenameSession(item: SessionSummary): void {
    this.renameSessionId = item.id;
    this.renameValue = this.sessionTitle(item);
    this.renameSessionOpen = true;
  }

  private beginArchiveSession(item: SessionSummary): void {
    this.archiveSessionId = item.id;
    this.archiveSessionOpen = true;
  }

  private submitRenameSession(): void {
    const title: string = this.renameValue.trim();
    const id: string = this.renameSessionId;
    if (title.length === 0 || id.length === 0) {
      return;
    }
    this.renameSessionOpen = false;
    this.renameSessionId = '';
    try {
      GatewayClient.get().renameSession(id, title);
    } catch (ignored) {
    }
    // 兜底刷新：主机回执也会自动请求一次会话列表（对齐小程序 500ms 后 requestSessions）
    setTimeout(() => {
      SessionStore.get().refreshSessionsNow();
    }, 500);
  }

  private submitArchiveSession(): void {
    const id: string = this.archiveSessionId;
    this.archiveSessionOpen = false;
    this.archiveSessionId = '';
    if (id.length === 0) {
      return;
    }
    try {
      GatewayClient.get().archiveSession(id);
    } catch (ignored) {
    }
    // 兜底刷新（同上）
    setTimeout(() => {
      SessionStore.get().refreshSessionsNow();
    }, 500);
  }

  private sessionMeta(item: SessionSummary): string {
    // 对齐小程序 .session-sub：sessionId 前 16 位，等宽字体
    return item.id.substring(0, 16);
  }

  /** 排序：运行中优先 → 最近更新 → sessionId 升序（对齐小程序 compareSessionRecency） */
  private compareRecency(a: SessionSummary, b: SessionSummary): number {
    const runDiff: number = (b.running ? 1 : 0) - (a.running ? 1 : 0);
    if (runDiff !== 0) {
      return runDiff;
    }
    const timeDiff: number = b.updatedAt - a.updatedAt;
    if (timeDiff !== 0) {
      return timeDiff;
    }
    return a.id < b.id ? -1 : (a.id > b.id ? 1 : 0);
  }

  private sortSessions(input: SessionSummary[]): SessionSummary[] {
    const out: SessionSummary[] = input.slice();
    out.sort((a: SessionSummary, b: SessionSummary) => this.compareRecency(a, b));
    return out;
  }

  /** 分区标题：优先工作区标题，其次路径最后一段（对齐小程序 workspaceSectionTitle） */
  private sectionTitle(ws: WorkspaceRow): string {
    const title: string = ws.title.trim();
    if (title.length > 0) {
      return title;
    }
    const parts: string[] = ws.path.split('/').filter((part: string) => part.length > 0);
    return parts.length > 0 ? parts[parts.length - 1] : '工作区';
  }

  private sectionExpanded(id: string): boolean {
    return this.expandedSectionIds.indexOf(id) >= 0;
  }

  private toggleSection(id: string): void {
    const next: string[] = [];
    let hit: boolean = false;
    for (const item of this.expandedSectionIds) {
      if (item === id) {
        hit = true;
      } else {
        next.push(item);
      }
    }
    if (!hit) {
      next.push(id);
    }
    this.expandedSectionIds = next;
  }

  /** 全部会话：按工作区分区（未分组固定最后），每区默认折叠到 5 条（对齐小程序 displayEntries） */
  private sessionSections(): SessionSection[] {
    const sorted: SessionSummary[] = this.sortSessions(this.filtered());
    const owner: Map<string, string> = new Map<string, string>();
    const titles: Map<string, string> = new Map<string, string>();
    for (const ws of this.workspaces) {
      titles.set(ws.workspaceId, this.sectionTitle(ws));
      for (const id of ws.sessionIds) {
        if (!owner.has(id)) {
          owner.set(id, ws.workspaceId);
        }
      }
    }
    const groups: Map<string, SessionSummary[]> = new Map<string, SessionSummary[]>();
    for (const item of sorted) {
      const sid: string = owner.has(item.id) ? (owner.get(item.id) as string) : SESSION_UNGROUPED;
      const bucket: SessionSummary[] | undefined = groups.get(sid);
      if (bucket === undefined) {
        groups.set(sid, [item]);
      } else {
        bucket.push(item);
      }
    }
    const ids: string[] = [];
    groups.forEach((rows: SessionSummary[], sid: string) => {
      ids.push(sid);
    });
    ids.sort((a: string, b: string) => {
      if (a === SESSION_UNGROUPED) {
        return 1;
      }
      if (b === SESSION_UNGROUPED) {
        return -1;
      }
      const left: SessionSummary[] = groups.get(a) as SessionSummary[];
      const right: SessionSummary[] = groups.get(b) as SessionSummary[];
      return this.compareRecency(left[0], right[0]);
    });
    const out: SessionSection[] = [];
    for (let i = 0; i < ids.length; i++) {
      const sid: string = ids[i];
      const rows: SessionSummary[] = groups.get(sid) as SessionSummary[];
      const expanded: boolean = this.sectionExpanded(sid);
      const shown: SessionSummary[] = expanded ? rows : rows.slice(0, SESSION_SECTION_LIMIT);
      const remaining: number = rows.length - SESSION_SECTION_LIMIT;
      out.push({
        id: sid,
        title: titles.has(sid) ? (titles.get(sid) as string) : '未分组',
        rows: rows,
        shown: shown,
        expanded: expanded,
        toggleLabel: remaining > 0 ? (expanded ? '收起' : ('展开其余 ' + remaining + ' 个会话')) : '',
        lastSection: i === ids.length - 1
      });
    }
    return out;
  }

  /** 最近会话 / 单个工作区：默认 12 条（对齐小程序 RECENT_SESSION_LIMIT） */
  private recentRows(): SessionSummary[] {
    const sorted: SessionSummary[] = this.sortSessions(this.filtered());
    return this.recentExpanded ? sorted : sorted.slice(0, SESSION_RECENT_LIMIT);
  }



  /** iOS 风格「桌面电脑」图标（近似 SF Symbols desktopcomputer：屏幕 + 支架 + 底座） */
  @Builder
  hostGlyph(size: number, color: string) {
    Column() {
      Column()
        .width(size * 0.94)
        .height(size * 0.60)
        .border({ width: 1.4, color: color })
        .borderRadius(size * 0.12)
      Column()
        .width(1.4)
        .height(size * 0.14)
        .backgroundColor(color)
      Column()
        .width(size * 0.42)
        .height(1.4)
        .borderRadius(1)
        .backgroundColor(color)
    }
    .width(size)
    .height(size)
    .justifyContent(FlexAlign.Center)
  }

  /** iOS 风格「服务器」图标（近似 SF Symbols server.rack：竖长机箱 + 两道分隔线 + 状态点） */
  @Builder
  serverGlyph(size: number, color: string) {
    Stack({ alignContent: Alignment.Center }) {
      // 机箱外框（接近 SF Symbols：略扁的方形）
      Column()
        .width(size * 0.90)
        .height(size * 0.76)
        .border({ width: 1.4, color: color })
        .borderRadius(size * 0.14)
      // 两道分隔线（与机箱同宽，把它分成三层）
      Column()
        .width(size * 0.90)
        .height(1.2)
        .backgroundColor(color)
        .translate({ y: -size * 0.127 })
      Column()
        .width(size * 0.90)
        .height(1.2)
        .backgroundColor(color)
        .translate({ y: size * 0.127 })
      // 三层状态点（左侧）
      Circle({ width: size * 0.075, height: size * 0.075 }).fill(color).translate({ x: -size * 0.30, y: -size * 0.253 })
      Circle({ width: size * 0.075, height: size * 0.075 }).fill(color).translate({ x: -size * 0.30, y: 0 })
      Circle({ width: size * 0.075, height: size * 0.075 }).fill(color).translate({ x: -size * 0.30, y: size * 0.253 })
    }
    .width(size)
    .height(size)
  }

  /** 扫描二维码图标：15×15 等比设计（四角外沿 + 三个定位框 + 右下四个圆点） */
  @Builder
  scanIcon() {
    Stack() {
      // 四角（只留外沿）
      Column().width(4.6).height(4.6)
        .borderWidth({ left: 1.1, top: 1.1 }).borderColor(this.iconColor())
        .borderRadius({ topLeft: 2.1 })
        .position({ x: 0, y: 0 })
      Column().width(4.6).height(4.6)
        .borderWidth({ right: 1.1, top: 1.1 }).borderColor(this.iconColor())
        .borderRadius({ topRight: 2.1 })
        .position({ x: 10.4, y: 0 })
      Column().width(4.6).height(4.6)
        .borderWidth({ left: 1.1, bottom: 1.1 }).borderColor(this.iconColor())
        .borderRadius({ bottomLeft: 2.1 })
        .position({ x: 0, y: 10.4 })
      Column().width(4.6).height(4.6)
        .borderWidth({ right: 1.1, bottom: 1.1 }).borderColor(this.iconColor())
        .borderRadius({ bottomRight: 2.1 })
        .position({ x: 10.4, y: 10.4 })
      // 三个定位方框
      this.scanFind(2.9, 2.9)
      this.scanFind(7.9, 2.9)
      this.scanFind(2.9, 7.9)
      // 右下四个圆点（与定位框同栅格）
      Circle({ width: 1.85, height: 1.85 }).fill(this.iconColor()).position({ x: 7.9, y: 7.9 })
      Circle({ width: 1.85, height: 1.85 }).fill(this.iconColor()).position({ x: 10.25, y: 7.9 })
      Circle({ width: 1.85, height: 1.85 }).fill(this.iconColor()).position({ x: 7.9, y: 10.25 })
      Circle({ width: 1.85, height: 1.85 }).fill(this.iconColor()).position({ x: 10.25, y: 10.25 })
    }
    .width(15)
    .height(15)
  }

  @Builder
  scanFind(x: number, y: number) {
    Stack() {
      Column().width(4.2).height(4.2)
        .border({ width: 0.9, color: this.iconColor() })
        .borderRadius(0.9)
      Circle({ width: 1.25, height: 1.25 }).fill(this.iconColor())
    }
    .width(4.2)
    .height(4.2)
    .position({ x: x, y: y })
  }

  /**
   * 扫描二维码图标：组件绘制（对齐小程序 .ico-scan）。
   *
   * 不用 scan_white.svg：那份 SVG 依赖根节点 fill="none" 继承，ArkUI 会把其中的
   * 取景框 rect 当成实心填充渲染（框内背景不透明），且右下角小点的填充分组被单独
   * 着色，颜色和描边不一致。这里按小程序几何直接画：
   *   4 个角括号（只画外侧两边）+ 3 个取景框（仅描边 + 中心点）+ 右下 2×2 小点
   * 全部用同一个 color，框内天然透明。
   */
  @Builder
  scanGlyph(size: number, color: string) {
    Stack({ alignContent: Alignment.TopStart }) {
      // 四角括号（11/36 边长、3/36 描边、5/36 外圆角）
      Column()
        .width(size * 11 / 36)
        .height(size * 11 / 36)
        .border({
          width: { top: size * 2.5 / 36, left: size * 2.5 / 36 },
          color: color,
          radius: { topLeft: size * 5 / 36 }
        })
        .position({ x: 0, y: 0 })
      Column()
        .width(size * 11 / 36)
        .height(size * 11 / 36)
        .border({
          width: { top: size * 2.5 / 36, right: size * 2.5 / 36 },
          color: color,
          radius: { topRight: size * 5 / 36 }
        })
        .position({ x: size * 25 / 36, y: 0 })
      Column()
        .width(size * 11 / 36)
        .height(size * 11 / 36)
        .border({
          width: { bottom: size * 2.5 / 36, left: size * 2.5 / 36 },
          color: color,
          radius: { bottomLeft: size * 5 / 36 }
        })
        .position({ x: 0, y: size * 25 / 36 })
      Column()
        .width(size * 11 / 36)
        .height(size * 11 / 36)
        .border({
          width: { bottom: size * 2.5 / 36, right: size * 2.5 / 36 },
          color: color,
          radius: { bottomRight: size * 5 / 36 }
        })
        .position({ x: size * 25 / 36, y: size * 25 / 36 })

      // 三个取景框：10/36 边长、2/36 描边、2/36 圆角，内部透明 + 3/36 中心点
      this.scanFinder(size, color, size * 7 / 36, size * 7 / 36)
      this.scanFinder(size, color, size * 19 / 36, size * 7 / 36)
      this.scanFinder(size, color, size * 7 / 36, size * 19 / 36)

      // 右下 2×2 小点（3/36 点、2/36 间距、距右/下各 6/36）
      Column()
        .width(size * 3 / 36)
        .height(size * 3 / 36)
        .borderRadius(size / 36)
        .backgroundColor(color)
        .position({ x: size * 20 / 36, y: size * 20 / 36 })
      Column()
        .width(size * 3 / 36)
        .height(size * 3 / 36)
        .borderRadius(size / 36)
        .backgroundColor(color)
        .position({ x: size * 25 / 36, y: size * 20 / 36 })
      Column()
        .width(size * 3 / 36)
        .height(size * 3 / 36)
        .borderRadius(size / 36)
        .backgroundColor(color)
        .position({ x: size * 20 / 36, y: size * 25 / 36 })
      Column()
        .width(size * 3 / 36)
        .height(size * 3 / 36)
        .borderRadius(size / 36)
        .backgroundColor(color)
        .position({ x: size * 25 / 36, y: size * 25 / 36 })
    }
    .width(size)
    .height(size)
  }

  /** 扫描图标里的单个取景框：仅描边 + 中心点（框内透明） */
  @Builder
  scanFinder(size: number, color: string, px: number, py: number) {
    Stack({ alignContent: Alignment.TopStart }) {
      Column()
        .width(size * 10 / 36)
        .height(size * 10 / 36)
        .border({ width: size * 2 / 36, color: color, radius: size * 2 / 36 })
      Column()
        .width(size * 3 / 36)
        .height(size * 3 / 36)
        .borderRadius(size / 36)
        .backgroundColor(color)
        .position({ x: size * 3.5 / 36, y: size * 3.5 / 36 })
    }
    .width(size * 10 / 36)
    .height(size * 10 / 36)
    .position({ x: px, y: py })
  }

  /** 配对菜单里的「扫描二维码」行：图标用组件绘制，其余排版与 menuRow 一致 */
  @Builder
  scanMenuRow(label: string, rowWidth: number) {
    Row({ space: this.rpx(24) }) {
      this.scanGlyph(this.rpx(36), this.iconColor())
      Text(label)
        .fontSize(this.rpx(32))
        .fontColor(this.labelColor())
        .maxLines(1)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
        .layoutWeight(1)
    }
    .width(rowWidth)
    .height(this.rpx(84))
    .padding({ left: this.rpx(48), right: this.rpx(48) })
  }

  /** 系统菜单里的行：完全按小程序 .ws-pop-row 换算（行高84rpx / 图标36rpx / 间距24rpx / 左右48rpx） */
  @Builder
  menuRow(icon: Resource, label: string, selected: boolean, rowWidth: number) {
    Row({ space: this.rpx(24) }) {
      Image(selected ? $r('app.media.check_fill_white') : icon)
        .width(this.rpx(36))
        .height(this.rpx(36))
        .objectFit(ImageFit.Contain)
        .colorFilter(this.iconTint(this.iconColor()))
      Text(label)
        .fontSize(this.rpx(32))
        .fontColor(this.labelColor())
        .maxLines(1)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
        .layoutWeight(1)
    }
    .width(rowWidth)
    .height(this.rpx(84))
    .padding({ left: this.rpx(48), right: this.rpx(48) })
  }

  /** 主机类型菜单内容（系统 Menu 容器；行内图标/字号对齐小程序） */
  @Builder
  kindMenuBuilder() {
    Menu() {
      MenuItem(this.menuRow($r('app.media.host_desktop_white'), '电脑', this.editKind === 'desktop', this.wsMenuWidth()))
        .id('host-kind-desktop')
        .onClick(() => {
          this.editKind = 'desktop';
        })
      MenuItem(this.menuRow($r('app.media.server_white'), '服务器', this.editKind === 'server', this.wsMenuWidth()))
        .id('host-kind-server')
        .onClick(() => {
          this.editKind = 'server';
        })
    }
  }

  /** 添加工作区（系统半模态 bindSheet + ImmersiveMaterial，与「切换主机」同款） */
  @Builder
  dirSheetContent() {
    Stack({ alignContent: Alignment.TopStart }) {
      Column({ space: 0 }) {
        // 抓手（对齐 .dir-sheet-handle：76rpx × 10rpx）
        Column() {
          Column()
            .width(38)
            .height(5)
            .borderRadius(999)
            .backgroundColor(this.isDark ? 'rgba(255,255,255,0.24)' : 'rgba(0,0,0,0.20)')
        }
        .width('100%')
        .height(17)
        .justifyContent(FlexAlign.Center)

        // 头部：新建文件夹（左） / 选择工作区目录（居中） / 取消（右）
        Stack({ alignContent: Alignment.Center }) {
          Text('选择工作区目录')
            .fontSize(17)
            .fontWeight(FontWeight.Medium)
            .fontColor(this.labelColor())
          Row() {
            Row() {
              Image($r('app.media.plus_white'))
                .width(19)
                .height(19)
                .objectFit(ImageFit.Contain)
                .colorFilter(this.iconTint(this.iconColor()))
            }
            .width(36)
            .height(36)
            .borderRadius(18)
            .justifyContent(FlexAlign.Center)
            .backgroundColor(this.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.55)')
            .border({ width: 0.5, color: this.isDark ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.85)' })
            .onClick(() => {
              this.dirNewFolderName = '';
              this.dirNewFolderError = '';
              this.dirNewFolderOpen = true;
            })
            Blank()
            Text('取消')
              .fontSize(14)
              .fontWeight(FontWeight.Medium)
              .fontColor(this.labelColor())
              .height(36)
              .padding({ left: 15, right: 15 })
              .borderRadius(999)
              .backgroundColor(this.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.55)')
              .border({ width: 0.5, color: this.isDark ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.85)' })
              .onClick(() => {
                this.closeDirSheet();
              })
          }
          .width('100%')
          .height(66)
          .padding({ left: 16, right: 16 })
          .alignItems(VerticalAlign.Center)
        }
        .width('100%')
        .height(66)

        // 位置 + 面包屑 + 编辑路径（对齐 .dir-loc-row）
        Row({ space: 6 }) {
          Row({ space: 4 }) {
            Image($r('app.media.server_white'))
              .width(14)
              .height(14)
              .objectFit(ImageFit.Contain)
              .colorFilter(this.iconTint(this.iconColor()))
            Text('位置')
              .fontSize(12)
              .fontColor(this.labelColor())
          }
          .height(30)
          .padding({ left: 10, right: 10 })
          .borderRadius(999)
          .backgroundColor(this.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.55)')
          .border({ width: 0.5, color: this.isDark ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.85)' })
          .onClick(() => {
            this.dirLocationsOpen = true;
          })
          Scroll() {
            Row() {
              ForEach(this.dirCrumbs, (crumb: DirCrumb, index: number) => {
                Row() {
                  if (index > 0) {
                    Text('›')
                      .fontSize(12)
                      .fontColor(this.secondaryLabel())
                      .padding({ left: 2, right: 2 })
                  }
                  Text(this.dirCrumbLabel(crumb))
                    .fontSize(12)
                    .fontColor(index === this.dirCrumbs.length - 1 ? this.labelColor() : this.secondaryLabel())
                    .maxLines(1)
                    .textOverflow({ overflow: TextOverflow.Ellipsis })
                    .constraintSize({ maxWidth: 130 })
                    .height(26)
                    .padding({ left: 6, right: 6 })
                    .borderRadius(7)
                    .backgroundColor(index === this.dirCrumbs.length - 1 ? (this.isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.06)') : 'rgba(0,0,0,0)')
                    .onClick(() => {
                      if (index !== this.dirCrumbs.length - 1) {
                        this.browseDirs(crumb.path);
                      }
                    })
                }
              }, (crumb: DirCrumb) => crumb.path)
            }
            .height(30)
            .padding({ left: 2, right: 2 })
            .alignItems(VerticalAlign.Center)
            // 路径短时也保持左对齐（Scroll 子内容默认会居中）
            .constraintSize({ minWidth: '100%' })
          }
          .layoutWeight(1)
          .height(30)
          .scrollable(ScrollDirection.Horizontal)
          .scrollBar(BarState.Off)
          Row() {
            Image($r('app.media.pencil_edit_white'))
              .width(14)
              .height(14)
              .objectFit(ImageFit.Contain)
              .fillColor(this.iconColor())
          }
          .width(30)
          .height(30)
          .borderRadius(15)
          .justifyContent(FlexAlign.Center)
          .backgroundColor(this.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.55)')
          .border({ width: 0.5, color: this.isDark ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.85)' })
          .onClick(() => {
            this.dirJumpValue = this.dirCurrent;
            this.dirJumpError = '';
            this.dirJumpOpen = true;
          })
        }
        .width('100%')
        .padding({ left: 16, right: 16 })
        .alignItems(VerticalAlign.Center)

        // 显示隐藏文件（对齐 .dir-filter-row）
        Row() {
          Row({ space: 4 }) {
            Text('显示隐藏文件')
              .fontSize(11)
              .fontColor(this.dirShowHidden ? this.labelColor() : this.secondaryLabel())
            if (!this.dirShowHidden && this.dirHiddenCount() > 0) {
              Text(this.dirHiddenCount().toString())
                .fontSize(10)
                .fontColor(this.secondaryLabel())
                .padding({ left: 4, right: 4 })
                .borderRadius(999)
                .backgroundColor(this.isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.06)')
            }
          }
          .height(24)
          .padding({ left: 8, right: 8 })
          .borderRadius(999)
          .backgroundColor(this.dirShowHidden ? (this.isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)') : (this.isDark ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.40)'))
          .onClick(() => {
            this.dirShowHidden = !this.dirShowHidden;
          })
        }
        .width('100%')
        .justifyContent(FlexAlign.End)
        .padding({ left: 16, right: 16 })
        .margin({ top: 6 })

        // 目录列表（对齐 .dir-body / .dir-list-card）
        Scroll() {
          Column() {
            Column() {
            if (this.dirLoading) {
              Row({ space: 10 }) {
                LoadingProgress()
                  .width(20)
                  .height(20)
                  .color(this.iconColor())
                Text('正在读取远程目录…')
                  .fontSize(15)
                  .fontColor(this.secondaryLabel())
              }
              .width('100%')
              .justifyContent(FlexAlign.Center)
              .padding({ top: 40, bottom: 40 })
            } else if (this.dirError.length > 0) {
              Text(this.dirError)
                .fontSize(13)
                .fontColor('#FF8A8A')
                .width('100%')
                .padding({ top: 30, bottom: 30 })
                .textAlign(TextAlign.Center)
            } else {
              if (this.dirParentPath().length > 0) {
                this.dirEntryRow('..', '返回上一级', false, this.dirParentPath())
                if (this.dirVisible().length > 0) {
                  this.dirDividerRow()
                }
              }
              ForEach(this.dirVisible(), (entry: DirEntry, index: number) => {
                this.dirEntryRow(entry.name, entry.hidden ? '隐藏目录' : '', entry.hidden, entry.path)
                if (index < this.dirVisible().length - 1) {
                  this.dirDividerRow()
                }
              }, (entry: DirEntry) => entry.path)
              if (this.dirVisible().length === 0) {
                Text(this.dirEntries.length > 0 ? '没有可显示的目录，打开“显示隐藏文件”查看' : '此目录为空')
                  .fontSize(13)
                  .fontColor(this.secondaryLabel())
                  .lineHeight(20)
                  .width('100%')
                  .textAlign(TextAlign.Center)
                  .padding({ top: 32, bottom: 32 })
              }
            }
          }
          .width('100%')
          .padding({ left: 8, right: 8, top: 5, bottom: 5 })
          .backgroundColor(this.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.45)')
          .border({ width: 0.5, color: this.isDark ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.80)' })
            .borderRadius(16)
            .margin({ top: 10, bottom: 4 })
            }
            .width('100%')
            // 内容不足一屏时也靠上，不垂直居中
            .constraintSize({ minHeight: '100%' })
            .justifyContent(FlexAlign.Start)
            .padding({ left: 12, right: 12 })
        }
        .layoutWeight(1)
        .width('100%')
        .scrollBar(BarState.Off)

        // 底部：当前路径 + 在当前目录创建工作区（对齐 .dir-create-bar）
        Column() {
          Text(this.dirCurrent.length > 0 ? this.dirCurrent : '选择要添加为工作区的目录')
            .fontSize(12)
            .fontColor(this.secondaryLabel())
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
            .width('100%')
            .textAlign(TextAlign.Center)
            .margin({ bottom: 8 })
          Row({ space: 6 }) {
            if (this.dirCreatingWs) {
              LoadingProgress()
                .width(15)
                .height(15)
                .color(this.iconColor())
            } else {
              Image($r('app.media.plus_white'))
                .width(15)
                .height(15)
                .objectFit(ImageFit.Contain)
                .colorFilter(this.iconTint(this.iconColor()))
            }
            Text(this.dirCreatingWs ? '正在创建…' : '在当前目录创建工作区')
              .fontSize(15)
              .fontWeight(FontWeight.Medium)
              .fontColor(this.labelColor())
          }
          .width('100%')
          .height(42)
          .justifyContent(FlexAlign.Center)
          .borderRadius(14)
          .border({ width: 0.5, color: this.isDark ? 'rgba(255,255,255,0.30)' : 'rgba(0,0,0,0.18)' })
          .backgroundColor('rgba(0,0,0,0)')
          .enabled(this.dirCurrent.length > 0 && !this.dirCreatingWs && !this.dirLoading)
          .opacity(this.dirCurrent.length > 0 && !this.dirCreatingWs && !this.dirLoading ? 1 : 0.45)
          .onClick(() => {
            this.createWorkspaceHere();
          })
          if (this.dirCreatingDir) {
            Row({ space: 7 }) {
              LoadingProgress()
                .width(12)
                .height(12)
                .color(this.iconColor())
              Text('正在创建文件夹…')
                .fontSize(12)
                .fontColor(this.secondaryLabel())
            }
            .width('100%')
            .justifyContent(FlexAlign.Center)
            .margin({ top: 8 })
          }
        }
        .width('100%')
        .padding({ left: 20, right: 20, top: 9 })
        .alignItems(HorizontalAlign.Center)
      }
      .width('100%')
      .height('100%')
      .padding({ bottom: 8 })
      // 角标弹窗放在弹层内部，避免被半模态层级遮挡
      if (this.dirNewFolderOpen) {
        this.dirNewFolderPrompt()
      }
      if (this.dirJumpOpen) {
        this.dirJumpPrompt()
      }
      if (this.dirLocationsOpen) {
        this.dirLocationsPrompt()
      }
    }
    .width('100%')
    .height('100%')
  }

  /** 目录行（对齐小程序 .dir-row） */
  @Builder
  dirEntryRow(name: string, sub: string, hidden: boolean, path: string) {
    Row() {
      Row() {
        Image($r('app.media.workspace_folder_white'))
          .width(21)
          .height(21)
          .objectFit(ImageFit.Contain)
          .colorFilter(this.iconTint(this.iconColor()))
          .opacity(hidden ? 0.86 : 1)
      }
      .width(29)
      .justifyContent(FlexAlign.Center)
      Column() {
        Text(name)
          .fontSize(16)
          .fontColor(this.labelColor())
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .width('100%')
        if (sub.length > 0) {
          Text(sub)
            .fontSize(12)
            .fontColor(this.secondaryLabel())
            .maxLines(1)
            .margin({ top: 1 })
            .width('100%')
        }
      }
      .alignItems(HorizontalAlign.Start)
      .layoutWeight(1)
      .margin({ left: 6 })
      Image($r('app.media.ic_dir_chevron_mist'))
        .width(16)
        .height(16)
        .colorFilter(this.iconTint(this.iconColorSecondary()))
        .opacity(0.92)
    }
    .width('100%')
    .padding({ top: 11, bottom: 11, left: 8, right: 8 })
    .borderRadius(10)
    .onClick(() => {
      if (this.dirLoading || path.length === 0) {
        return;
      }
      this.browseDirs(path);
    })
  }

  /** 目录分隔线（对齐小程序 .dir-divider） */
  @Builder
  dirDividerRow() {
    Row() {
      Row()
        .width('100%')
        .height(0.5)
        .backgroundColor(this.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)')
    }
    .width('100%')
    .padding({ left: 54 })
  }

  /** 新建文件夹弹窗（对齐小程序 .dir-prompt-sheet） */
  @Builder
  dirNewFolderPrompt() {
    Stack({ alignContent: Alignment.Center }) {
      Column()
        .width('100%')
        .height('100%')
        .backgroundColor('rgba(0,0,0,0.45)')
        .onClick(() => {
          this.dirNewFolderOpen = false;
        })
      Column() {
        Text('新建文件夹')
          .fontSize(16)
          .fontWeight(FontWeight.Bold)
          .fontColor(this.labelColor())
          .width('100%')
        Text('将在当前目录中创建一个新的子文件夹。')
          .fontSize(12)
          .fontColor(this.secondaryLabel())
          .lineHeight(18)
          .width('100%')
          .margin({ top: 5 })
        TextInput({ text: this.dirNewFolderName, placeholder: '文件夹名称' })
          .caretStyle({ width: 1 })
          .height(42)
          .margin({ top: 13 })
          .padding({ left: 12, right: 12 })
          .borderRadius(9)
          .backgroundColor(this.isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.06)')
          .border({ width: 0.5, color: this.isDark ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.85)' })
          .fontSize(14)
          .fontColor(this.labelColor())
          .placeholderColor(this.secondaryLabel())
          .onChange((value: string) => {
            this.dirNewFolderName = value;
            this.dirNewFolderError = '';
          })
        if (this.dirNewFolderError.length > 0) {
          Text(this.dirNewFolderError)
            .fontSize(12)
            .fontColor('#FF8A8A')
            .width('100%')
            .margin({ top: 6 })
        }
        Row({ space: 10 }) {
          Button('取消')
            .layoutWeight(1)
            .height(42)
            .fontSize(14)
            .fontColor(this.labelColor())
            .backgroundColor(this.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.55)')
            .borderRadius(9)
            .border({ width: 0.5, color: this.isDark ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.85)' })
            .onClick(() => {
              this.dirNewFolderOpen = false;
            })
          Button(this.dirCreatingDir ? '正在创建…' : '创建')
            .layoutWeight(1)
            .height(42)
            .fontSize(14)
            .fontWeight(FontWeight.Medium)
            .fontColor(this.labelColor())
            .backgroundColor('rgba(0,0,0,0)')
            .borderRadius(9)
            .border({ width: 0.5, color: this.isDark ? 'rgba(255,255,255,0.30)' : 'rgba(0,0,0,0.18)' })
            .enabled(!this.dirCreatingDir)
            .opacity(this.dirCreatingDir ? 0.7 : 1)
            .onClick(() => {
              this.confirmNewFolder();
            })
        }
        .width('100%')
        .margin({ top: 14 })
      }
      .width(310)
      .padding({ left: 18, right: 18, top: 20, bottom: 14 })
      .borderRadius(16)
      // 玻璃材质对齐会话设置弹窗：半透明底 + 亮边 + 背景模糊
      .backgroundColor(this.isDark ? 'rgba(30,33,40,0.72)' : 'rgba(255,255,255,0.90)')
      .border({ width: 0.5, color: this.isDark ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.85)' })
      .backdropBlur(16)
      .shadow({ radius: 24, color: 'rgba(3,14,30,0.26)', offsetY: 6 })
    }
    .width('100%')
    .height('100%')
  }

  /** 编辑路径弹窗（对齐小程序 .dir-prompt-sheet） */
  @Builder
  dirJumpPrompt() {
    Stack({ alignContent: Alignment.Center }) {
      Column()
        .width('100%')
        .height('100%')
        .backgroundColor('rgba(0,0,0,0.45)')
        .onClick(() => {
          this.dirJumpOpen = false;
        })
      Column() {
        Text('编辑路径')
          .fontSize(16)
          .fontWeight(FontWeight.Bold)
          .fontColor(this.labelColor())
          .width('100%')
        Text('输入绝对路径，例如 /Users/… 或 D:/…')
          .fontSize(12)
          .fontColor(this.secondaryLabel())
          .lineHeight(18)
          .width('100%')
          .margin({ top: 5 })
        TextInput({ text: this.dirJumpValue, placeholder: '输入绝对路径' })
          .caretStyle({ width: 1 })
          .height(42)
          .margin({ top: 13 })
          .padding({ left: 12, right: 12 })
          .borderRadius(9)
          .backgroundColor(this.isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.06)')
          .border({ width: 0.5, color: this.isDark ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.85)' })
          .fontSize(14)
          .fontColor(this.labelColor())
          .placeholderColor(this.secondaryLabel())
          .onChange((value: string) => {
            this.dirJumpValue = value;
            this.dirJumpError = '';
          })
        if (this.dirJumpError.length > 0) {
          Text(this.dirJumpError)
            .fontSize(12)
            .fontColor('#FF8A8A')
            .width('100%')
            .margin({ top: 6 })
        }
        Row({ space: 10 }) {
          Button('取消')
            .layoutWeight(1)
            .height(42)
            .fontSize(14)
            .fontColor(this.labelColor())
            .backgroundColor(this.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.55)')
            .borderRadius(9)
            .border({ width: 0.5, color: this.isDark ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.85)' })
            .onClick(() => {
              this.dirJumpOpen = false;
            })
          Button('前往')
            .layoutWeight(1)
            .height(42)
            .fontSize(14)
            .fontWeight(FontWeight.Medium)
            .fontColor(this.labelColor())
            .backgroundColor('rgba(0,0,0,0)')
            .borderRadius(9)
            .border({ width: 0.5, color: this.isDark ? 'rgba(255,255,255,0.30)' : 'rgba(0,0,0,0.18)' })
            .onClick(() => {
              this.submitDirJump();
            })
        }
        .width('100%')
        .margin({ top: 14 })
      }
      .width(310)
      .padding({ left: 18, right: 18, top: 20, bottom: 14 })
      .borderRadius(16)
      // 玻璃材质对齐会话设置弹窗：半透明底 + 亮边 + 背景模糊
      .backgroundColor(this.isDark ? 'rgba(30,33,40,0.72)' : 'rgba(255,255,255,0.90)')
      .border({ width: 0.5, color: this.isDark ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.85)' })
      .backdropBlur(16)
      .shadow({ radius: 24, color: 'rgba(3,14,30,0.26)', offsetY: 6 })
    }
    .width('100%')
    .height('100%')
  }

  /** 位置面板：电脑 / 主目录（对齐小程序 .dir-prompt-sheet 位置） */
  @Builder
  dirLocationsPrompt() {
    Stack({ alignContent: Alignment.Center }) {
      Column()
        .width('100%')
        .height('100%')
        .backgroundColor('rgba(0,0,0,0.45)')
        .onClick(() => {
          this.dirLocationsOpen = false;
        })
      Column() {
        Text('位置')
          .fontSize(16)
          .fontWeight(FontWeight.Bold)
          .fontColor(this.labelColor())
          .width('100%')
        Scroll() {
          Column() {
            if (this.dirRootPath().length > 0) {
              Row({ space: 10 }) {
                Image($r('app.media.server_white'))
                  .width(18)
                  .height(18)
                  .objectFit(ImageFit.Contain)
                Column() {
                  Text('电脑')
                    .fontSize(14)
                    .fontColor('#F1F4FA')
                    .width('100%')
                  Text(this.dirRootPath())
                    .fontSize(11)
                    .fontColor('rgba(241,244,250,0.40)')
                    .maxLines(1)
                    .textOverflow({ overflow: TextOverflow.Ellipsis })
                    .width('100%')
                }
                .alignItems(HorizontalAlign.Start)
                .layoutWeight(1)
              }
              .width('100%')
              .padding({ top: 10, bottom: 10, left: 6, right: 6 })
              .borderRadius(10)
              .onClick(() => {
                this.dirLocationsOpen = false;
                this.browseDirs(this.dirRootPath());
              })
            }
            if (this.dirHome.length > 0) {
              Row({ space: 10 }) {
                Image($r('app.media.workspace_folder_white'))
                  .width(18)
                  .height(18)
                  .objectFit(ImageFit.Contain)
                Column() {
                  Text('主目录')
                    .fontSize(14)
                    .fontColor('#F1F4FA')
                    .width('100%')
                  Text(this.dirHome)
                    .fontSize(11)
                    .fontColor('rgba(241,244,250,0.40)')
                    .maxLines(1)
                    .textOverflow({ overflow: TextOverflow.Ellipsis })
                    .width('100%')
                }
                .alignItems(HorizontalAlign.Start)
                .layoutWeight(1)
              }
              .width('100%')
              .padding({ top: 10, bottom: 10, left: 6, right: 6 })
              .borderRadius(10)
              .onClick(() => {
                this.dirLocationsOpen = false;
                this.browseDirs(this.dirHome);
              })
            }
          }
          .width('100%')
          .margin({ top: 8 })
        }
        .constraintSize({ maxHeight: 320 })
        .scrollBar(BarState.Off)
        Row({ space: 10 }) {
          Button('取消')
            .layoutWeight(1)
            .height(42)
            .fontSize(14)
            .fontColor(this.labelColor())
            .backgroundColor(this.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.55)')
            .borderRadius(9)
            .border({ width: 0.5, color: this.isDark ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.85)' })
            .onClick(() => {
              this.dirLocationsOpen = false;
            })
        }
        .width('100%')
        .margin({ top: 14 })
      }
      .width(310)
      .padding({ left: 18, right: 18, top: 20, bottom: 14 })
      .borderRadius(16)
      // 玻璃材质对齐会话设置弹窗：半透明底 + 亮边 + 背景模糊
      .backgroundColor(this.isDark ? 'rgba(30,33,40,0.72)' : 'rgba(255,255,255,0.90)')
      .border({ width: 0.5, color: this.isDark ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.85)' })
      .backdropBlur(16)
      .shadow({ radius: 24, color: 'rgba(3,14,30,0.26)', offsetY: 6 })
    }
    .width('100%')
    .height('100%')
  }

  // ── 添加工作区：数据与交互（对齐小程序 openDirSheet / browseDirs / 弹窗动作）──

  private closeDirSheet(): void {
    this.dirSheetOpen = false;
    this.dirNewFolderOpen = false;
    this.dirJumpOpen = false;
    this.dirLocationsOpen = false;
  }

  private openDirSheet(): void {
    this.wsMenuOpen = false;
    this.dirShowHidden = false;
    this.dirLoading = true;
    this.dirError = '';
    this.dirNewFolderOpen = false;
    this.dirJumpOpen = false;
    this.dirLocationsOpen = false;
    this.dirSheetOpen = true;
    // 对齐小程序：默认落在网关家目录（未知时先请求空路径，拿到 home 后再补一次）
    this.dirAutoHome = true;
    this.browseDirs(this.dirHome.length > 0 ? this.dirHome : '');
  }

  private browseDirs(path: string): void {
    this.dirLoading = true;
    this.dirError = '';
    if (!GatewayClient.get().requestDirectories(path)) {
      this.dirLoading = false;
      this.dirError = '请先连接鲸尾 Harness';
    }
  }

  private dirVisible(): DirEntry[] {
    const out: DirEntry[] = [];
    for (const entry of this.dirEntries) {
      if (!this.dirShowHidden && entry.hidden) {
        continue;
      }
      out.push(entry);
    }
    out.sort((a: DirEntry, b: DirEntry) => {
      const left: string = a.name.toLowerCase();
      const right: string = b.name.toLowerCase();
      return left < right ? -1 : (left > right ? 1 : 0);
    });
    return out;
  }

  private dirHiddenCount(): number {
    let hidden: number = 0;
    for (const entry of this.dirEntries) {
      if (entry.hidden) {
        hidden += 1;
      }
    }
    return hidden;
  }

  private dirParentPath(): string {
    if (this.dirCrumbs.length < 2) {
      return '';
    }
    return this.dirCrumbs[this.dirCrumbs.length - 2].path;
  }

  private dirRootPath(): string {
    return this.dirCrumbs.length > 0 ? this.dirCrumbs[0].path : '';
  }

  private dirCrumbLabel(crumb: DirCrumb): string {
    if (crumb.path === '/') {
      return '电脑';
    }
    if (this.dirHome.length > 0 && crumb.path === this.dirHome) {
      return '主目录';
    }
    return crumb.name.length > 0 ? crumb.name : crumb.path;
  }

  private confirmNewFolder(): void {
    const name: string = this.dirNewFolderName.trim();
    if (name.length === 0) {
      this.dirNewFolderError = '请输入文件夹名称';
      return;
    }
    this.dirNewFolderError = '';
    this.dirNewFolderName = '';
    this.dirNewFolderOpen = false;
    this.dirCreatingDir = true;
    if (!GatewayClient.get().createDirectory(this.dirCurrent, name)) {
      this.dirCreatingDir = false;
      this.dirError = '请先连接鲸尾 Harness';
    }
  }

  private submitDirJump(): void {
    let value: string = this.dirJumpValue.trim();
    if (value.length === 0) {
      this.dirJumpError = '请输入绝对路径';
      return;
    }
    if (value === '~') {
      value = this.dirHome;
    } else if (value.indexOf('~/') === 0 || value.indexOf('~\\') === 0) {
      value = this.dirHome + value.slice(1);
    }
    const posix: boolean = value.charAt(0) === '/';
    const windows: boolean = /^[A-Za-z]:[\\/]/.test(value);
    if (!posix && !windows) {
      this.dirJumpError = '请输入以 / 或盘符开头的绝对路径';
      return;
    }
    this.dirJumpError = '';
    this.dirJumpOpen = false;
    this.browseDirs(value);
  }

  private createWorkspaceHere(): void {
    if (this.dirCurrent.length === 0 || this.dirCreatingWs) {
      return;
    }
    this.dirCreatingWs = true;
    if (!GatewayClient.get().createWorkspace(this.dirCurrent)) {
      this.dirCreatingWs = false;
      this.dirError = '请先连接鲸尾 Harness';
      return;
    }
    // 兜底：网关没回工作区列表时也不要一直停在「正在创建…」
    setTimeout(() => {
      if (this.dirCreatingWs) {
        this.dirCreatingWs = false;
        this.closeDirSheet();
      }
    }, 4000);
  }

  onDirEntriesChanged(): void {
    this.dirLoading = false;
    this.dirCreatingDir = false;
    if (this.dirAutoHome) {
      this.dirAutoHome = false;
      // 网关把空路径解析成根目录时，回到家目录（对齐小程序首屏）
      if (this.dirHome.length > 0 && this.dirCurrent !== this.dirHome && this.dirCrumbs.length <= 1) {
        this.browseDirs(this.dirHome);
      }
    }
  }

  onWorkspacesChanged(): void {
    if (this.dirCreatingWs) {
      this.dirCreatingWs = false;
      this.closeDirSheet();
    }
  }

  /** 左侧栏（对齐小程序 drawer：品牌 + 插件 / 自动化任务 + 设置） */
  /** 侧栏底层：抽屉固定在左侧，首页内容右推后露出它（对齐小程序 drawer + home-content-wrap） */
  @Builder
  drawerOverlay() {
    Column() {
        // 品牌
        Row({ space: 6 }) {
          // 品牌硬币：与顶部品牌行同一枚 3D 硬币（可拖动翻转）
          FluKeCoin({ diameter: 32 })
            .translate({ y: -1 })
          // 文字标：与顶部品牌行等高（52×15），侧栏标题高度与主页一致
          Image(this.isDark ? $r('app.media.wordmark_white') : $r('app.media.wordmark_ink'))
            .width(52)
            .height(15)
            .objectFit(ImageFit.Contain)
          // HARNESS 徽章：白底抽屉上用深底白字，与主页顶栏同一规格
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
        .padding({ left: this.rpx(24), bottom: this.rpx(32) })

        // 插件
        this.drawerItem($r('app.media.pinwheel_ink'), $r('app.media.pinwheel_ink'), '插件', 'plugins')
        // 连接器
        this.drawerItem($r('app.media.connector_ink'), $r('app.media.connector_white'), '连接器', 'connectors')
        // 自动化任务
        this.drawerItem($r('app.media.automation_ink'), $r('app.media.automation_white'), '自动化任务', 'schedule')

        Blank()

        // 设置（对齐小程序 .drawer-footer：上方 24rpx 间距，底部 24rpx + 安全区）
        Column() {
          this.drawerItem($r('app.media.settings_ink'), $r('app.media.settings_white'), '设置', 'app-settings')
        }
        .width('100%')
        .padding({ top: this.rpx(24) })
      }
      .width(this.drawerWidth)
      .height('100%')
      .padding({
        left: this.rpx(36),
        right: this.rpx(36),
        // 小程序：calc(20rpx + safe-area-inset-top) / calc(24rpx + safe-area-inset-bottom)
        top: Math.max(this.safeTopStorage, 38) + this.rpx(20),
        // 底部安全区补足到接近 iOS 手势条高度，避免设置按钮贴底
        bottom: Math.max(this.safeBottomStorage, 30) + this.rpx(24)
      })
      .backgroundColor(this.isDark ? '#181A1F' : '#FFFFFF')
      .alignItems(HorizontalAlign.Start)
      .position({ x: 0, y: 0 })
      // 抽屉自身从左向右展开；关闭时缩回屏外（对齐小程序 translateX(-100%) → 0）
      .translate({ x: this.drawerOpen ? 0 : -this.drawerWidth })
      .animation({ duration: 320, curve: Curve.FastOutSlowIn })
  }

  @Builder
  drawerItem(icon: Resource, iconDark: Resource, label: string, route: string) {
    Row({ space: this.rpx(20) }) {
      // 深色模式用白色图标资源（SVG 描边色写死）；PNG 再用颜色矩阵染白
      Image(this.isDark ? iconDark : icon)
        .width(this.rpx(44))
        .height(this.rpx(44))
        .objectFit(ImageFit.Contain)
        .colorFilter(this.iconTint(this.isDark ? '#FFFFFF' : '#101318'))
      Text(label)
        .fontSize(this.rpx(34))
        .fontColor(this.isDark ? '#FFFFFF' : '#101318')
        .layoutWeight(1)
    }
    .width('100%')
    .height(this.rpx(104))
    .padding({ left: this.rpx(28), right: this.rpx(28) })
    .borderRadius(this.rpx(24))
    // 按下/悬停高亮：与系统菜单（协作、⋯）同一套 press 反馈
    .hoverEffect(HoverEffect.Highlight)
    .onClick(() => {
      // 侧栏每一项都按「设置 → 震动反馈」的档位给一次触感
      Haptics.play();
      this.drawerOpen = false;
      this.pageStack.pushPathByName(route, null);
    })
  }

  /** 选择工作区菜单（系统 Menu 容器 + 分组分割线；行内图标/字号对齐小程序） */
  @Builder
  workspaceMenuBuilder() {
    Menu()
      .menuItemDivider({
        strokeWidth: LengthMetrics.vp(1),
        color: this.separatorColor(),
        startMargin: LengthMetrics.vp(this.rpx(44)),
        endMargin: LengthMetrics.vp(this.rpx(44))
      }) {
      MenuItemGroup() {
        MenuItem(this.menuRow($r('app.media.all_sessions_white'), '全部会话', this.wsFilter === 'all', this.wsMenuWidth()))
          .id('ws-all')
          .onClick(() => {
            this.pickWorkspace('all');
          })
        MenuItem(this.menuRow($r('app.media.tray_white'), '未分组', this.wsFilter === 'ungrouped', this.wsMenuWidth()))
          .id('ws-ungrouped')
          .onClick(() => {
            this.pickWorkspace('ungrouped');
          })
      }
      MenuItemGroup() {
        ForEach(this.workspaces, (ws: WorkspaceRow) => {
          MenuItem(this.menuRow($r('app.media.workspace_folder_white'), ws.title, this.wsFilter === ws.workspaceId, this.wsMenuWidth()))
            .id('ws-' + ws.workspaceId)
            .onClick(() => {
              this.pickWorkspace(ws.workspaceId);
            })
        }, (ws: WorkspaceRow) => ws.workspaceId)
      }
      MenuItemGroup() {
        MenuItem(this.menuRow($r('app.media.plus_white'), '添加工作区', false, this.wsMenuWidth()))
          .id('ws-add')
          .onClick(() => {
            this.openDirSheet();
          })
      }
    }
  }

  /** 选择工作区：切换筛选并重置折叠状态（对齐小程序 expandedSectionIds / recentExpanded） */
  private pickWorkspace(id: string): void {
    this.wsFilter = id;
    this.wsMenuOpen = false;
    this.expandedSectionIds = [];
    this.recentExpanded = false;
  }


  /**
   * 分区本身的 ForEach key：必须随区内会话的运行状态一起变。
   * ArkUI 只按 key 复用节点——key 不变时，连它内部的 ForEach 都不会重跑，
   * 于是「运行中」这种行内变化永远上不了屏。
   */
  private sectionKey(sec: SessionSection): string {
    let runCount: number = 0;
    let stamp: number = 0;
    for (const row of sec.rows) {
      if (row.running) {
        runCount += 1;
      }
      if (row.updatedAt > stamp) {
        stamp = row.updatedAt;
      }
    }
    return sec.id + '|' + sec.rows.length.toString() + '|' + runCount.toString() + '|'
      + stamp.toString() + '|' + sec.toggleLabel;
  }

  /**
   * 会话行的 ForEach key：必须带上会变的状态。
   * ArkUI 的 ForEach 只按 key 复用节点，key 不变就不会重跑 item builder，
   * 于是「运行中 / 时间」这类内容变了界面也不动——这正是手机端状态更新不及时的直接原因。
   */
  private sessionKey(item: SessionSummary): string {
    return item.id + '|' + (item.running ? '1' : '0') + '|' + item.updatedAt.toString() + '|' + item.title;
  }

  /** 会话行（对齐小程序 .session-row）：圆点 / 标题 + 等宽 id / 右侧时间 */
  @Builder
  sessionRow(item: SessionSummary, last: boolean) {
    Column() {
      Row({ space: 11 }) {
        Row() {
          if (item.running) {
            LoadingProgress()
              .width(14)
              .height(14)
              .color('#FFFFFF')
          } else {
            Circle({ width: 7, height: 7 })
              .fill('rgba(255,255,255,0.4)')
          }
        }
        .width(14)
        .height(14)
        .justifyContent(FlexAlign.Center)
        Column({ space: 1 }) {
          Text(this.sessionTitle(item))
            .fontSize(14)
            .fontWeight(FontWeight.Medium)
            .fontColor('#FFFFFF')
            .width('100%')
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
          Text(this.sessionMeta(item))
            .fontSize(10)
            .fontFamily('monospace')
            .fontColor('rgba(255,255,255,0.42)')
            .width('100%')
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
        }
        .alignItems(HorizontalAlign.Start)
        .layoutWeight(1)
        Text(item.running ? '运行中' : this.timeLabel(item.updatedAt))
          .fontSize(11)
          .fontColor(item.running ? '#0A84FF' : 'rgba(255,255,255,0.48)')
          .margin({ left: 9 })
      }
      .width('100%')
      .padding({ top: 10, bottom: 10, left: 4, right: 4 })
      .borderRadius(8)
      // 长按菜单打开时这一行先隐去（对齐小程序 .session-row-hidden）；
      // 用透明度而不是 visibility，锚点节点保持布局，弹窗不会被系统提前关掉
      .opacity(this.sessionMenuOpen && this.sessionMenuId === item.id ? 0 : 1)
      .onTouch((event: TouchEvent) => {
        this.handleRowTouch(event, item);
      })
      .onClick(() => {
        // 长按/菜单打开时抬手那一下不算点按
        if (this.sessionMenuOpen || Date.now() - this.sessionLongPressAt < 900) {
          return;
        }
        SessionStore.get().open(item.id);
        openSessionRoute(this.pageStack);
      })
      if (!last) {
        Row() {
          Row()
            .width('100%')
            .height(0.5)
            .backgroundColor('rgba(255,255,255,0.10)')
        }
        .width('100%')
        .padding({ left: 18 })
      }
    }
    .width('100%')
  }

  /**
   * 会话长按菜单：系统 Menu 弹窗（与对话页右上角「⋯」同款）。
   * 图标走 startIcon（系统固定槽位），用带内边距的图标资源让字形视觉约 18vp，避免图标显得过大。
   */
  @Builder
  sessionActionMenu() {
    Menu() {
      MenuItem({
        content: '重命名',
        startIcon: this.isDark ? $r('app.media.session_menu_rename_white') : $r('app.media.session_menu_rename_dark')
      }).id('session-menu-rename').onClick(() => {
        this.onSessionMenuAction('rename');
      })
      MenuItem({
        content: '归档会话',
        startIcon: $r('app.media.session_menu_archive')
      }).id('session-menu-archive').onClick(() => {
        this.onSessionMenuAction('archive');
      })
    }
  }

  /** 重命名会话弹窗（对齐小程序 showModal editable）：系统弹窗圆角 + 分隔线 */
  @Builder
  renameSessionAlert() {
    Stack({ alignContent: Alignment.Center }) {
      Column()
        .width('100%')
        .height('100%')
        .backgroundColor('rgba(0,0,0,0.35)')
        .onClick(() => {
          this.renameSessionOpen = false;
        })
      Column() {
        Column() {
          Text('重命名会话')
            .fontSize(17)
            .fontWeight(FontWeight.Bold)
            .fontColor(this.dialogText())
            .textAlign(TextAlign.Center)
            .width('100%')
          TextInput({ text: this.renameValue, placeholder: '输入新的会话名称' })
            .caretStyle({ width: 1 })
            .fontSize(15)
            .fontColor(this.dialogText())
            .placeholderColor(this.dialogSubText())
            .backgroundColor(this.dialogInputBackground())
            .height(40)
            .borderRadius(10)
            .padding({ left: 12, right: 12 })
            .margin({ top: 14 })
            .maxLength(80)
            .defaultFocus(true)
            .onChange((value: string) => {
              this.renameValue = value;
            })
            .onSubmit(() => {
              this.submitRenameSession();
            })
        }
        .width('100%')
        .padding({ left: 16, right: 16, top: 20, bottom: 18 })

        Row()
          .width('100%')
          .height(0.5)
          .backgroundColor(this.separatorColor())

        Row() {
          Row() {
            Text('取消')
              .fontSize(16)
              .fontColor(this.accentColor())
          }
          .layoutWeight(1)
          .height(44)
          .justifyContent(FlexAlign.Center)
          .onClick(() => {
            this.renameSessionOpen = false;
          })
          Column()
            .width(0.5)
            .height(44)
            .backgroundColor(this.separatorColor())
          Row() {
            Text('保存')
              .fontSize(16)
              .fontWeight(FontWeight.Bold)
              .fontColor(this.renameValue.trim().length > 0 ? this.accentColor() : this.secondaryLabel())
          }
          .layoutWeight(1)
          .height(44)
          .justifyContent(FlexAlign.Center)
          .onClick(() => {
            this.submitRenameSession();
          })
        }
        .width('100%')
        .height(44)
      }
      .width(300)
      .backgroundColor(this.dialogBackground())
      .borderRadius(28)
      .clip(true)
    }
    .width('100%')
    .height('100%')
  }

  /** 归档会话确认（文案对齐小程序 archiveSession） */
  @Builder
  archiveSessionAlert() {
    Stack({ alignContent: Alignment.Center }) {
      Column()
        .width('100%')
        .height('100%')
        .backgroundColor('rgba(0,0,0,0.35)')
        .onClick(() => {
          this.archiveSessionOpen = false;
        })
      Column() {
        Column() {
          Text('归档会话')
            .fontSize(17)
            .fontWeight(FontWeight.Bold)
            .fontColor(this.dialogText())
            .textAlign(TextAlign.Center)
            .width('100%')
          Text('归档后会话将从列表隐藏，可在 WebUI 中恢复。')
            .fontSize(15)
            .fontColor(this.dialogSubText())
            .textAlign(TextAlign.Center)
            .width('100%')
            .margin({ top: 6 })
        }
        .width('100%')
        .padding({ left: 16, right: 16, top: 20, bottom: 18 })

        Row()
          .width('100%')
          .height(0.5)
          .backgroundColor(this.separatorColor())

        Row() {
          Row() {
            Text('取消')
              .fontSize(16)
              .fontColor(this.accentColor())
          }
          .layoutWeight(1)
          .height(44)
          .justifyContent(FlexAlign.Center)
          .onClick(() => {
            this.archiveSessionOpen = false;
          })
          Column()
            .width(0.5)
            .height(44)
            .backgroundColor(this.separatorColor())
          Row() {
            Text('归档')
              .fontSize(16)
              .fontWeight(FontWeight.Bold)
              .fontColor(this.destructiveColor())
          }
          .layoutWeight(1)
          .height(44)
          .justifyContent(FlexAlign.Center)
          .onClick(() => {
            this.submitArchiveSession();
          })
        }
        .width('100%')
        .height(44)
      }
      .width(300)
      .backgroundColor(this.dialogBackground())
      .borderRadius(28)
      .clip(true)
    }
    .width('100%')
    .height('100%')
  }

  /** 折叠开关（对齐小程序 .session-section-toggle）；sectionId 为空代表最近会话视图 */
  @Builder
  sessionToggle(label: string, expanded: boolean, sectionId: string) {
    Row({ space: 3 }) {
      Text(label)
        .fontSize(13)
        .fontColor('rgba(255,255,255,0.62)')
      Image($r('app.media.ic_dir_chevron_mist'))
        .width(11)
        .height(11)
        .opacity(0.62)
        .rotate({ angle: expanded ? 180 : 0 })
    }
    .width('100%')
    .constraintSize({ minHeight: 44 })
    .padding({ left: 18 })
    .alignItems(VerticalAlign.Center)
    .onClick(() => {
      if (sectionId.length > 0) {
        this.toggleSection(sectionId);
      } else {
        this.recentExpanded = !this.recentExpanded;
      }
    })
  }

  /** 配对菜单宽度：与工作区菜单同一套公式，避免贴右溢出 */
  private pairMenuWidth(): number {
    try {
      const screenW: number = this.getUIContext().px2vp(display.getDefaultDisplaySync().width);
      return Math.min(240, Math.max(200, screenW * 0.6), screenW - 16);
    } catch (err) {
      return 232;
    }
  }

  /** 菜单水平居中所需的锚点偏移（相对按钮左边缘） */
  private pairMenuAnchorX(): number {
    try {
      const screenW: number = this.getUIContext().px2vp(display.getDefaultDisplaySync().width);
      const width: number = this.pairMenuWidth();
      // 按钮实测位置不可靠时，按「右侧内边距 20 + 按钮宽 49」估算
      const fallbackX: number = screenW - 20 - 49;
      const buttonX: number = (isFinite(this.pairBtnX) && this.pairBtnX > 0) ? this.pairBtnX : fallbackX;
      // 系统 Menu 容器比内容宽约 18vp（实测：805px 容器 / 720px 内容），居中要一起算
      const containerW: number = width + 18;
      const offset: number = (screenW - containerW) / 2 - buttonX;
      return isFinite(offset) ? offset : 0;
    } catch (err) {
      return 0;
    }
  }

  /** 配对菜单（系统 Menu 容器；行内图标/字号对齐小程序） */
  @Builder
  pairMenuBuilder() {
    Menu() {
      MenuItem(this.scanMenuRow('扫描二维码', this.pairMenuWidth()))
        .id('pair-scan')
        .onClick(() => {
          this.pairMenuOpen = false;
          this.scanPairingNow();
        })
      MenuItem(this.menuRow($r('app.media.voice_keyboard'), '手动输入配对信息', false, this.pairMenuWidth()))
        .id('pair-keyboard')
        .onClick(() => {
          this.pairMenuOpen = false;
          this.manualSheetOpen = true;
          this.manualHint = '';
        })
      MenuItem(this.menuRow($r('app.media.setup_guide_white'), '配置引导', false, this.pairMenuWidth()))
        .id('pair-guide')
        .onClick(() => {
          this.pairMenuOpen = false;
          this.pageStack.pushPathByName('add-node', null);
        })
    }
  }

  /** 切换主机（系统半模态 bindSheet + ImmersiveMaterial 沉浸光感） */
  @Builder
  hostSheetContent() {
    Column({ space: 0 }) {
        // 顶部拖动条
        Column() {
          Column()
            .width(36)
            .height(4)
            .borderRadius(2)
            .backgroundColor(this.isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.22)')
        }
        .width('100%')
        .height(16)
        .justifyContent(FlexAlign.Center)

        if (this.hostEditOpen) {
          // ── 编辑主机（iOS Form 风格）──
          Stack({ alignContent: Alignment.Center }) {
            Text('编辑主机')
              .fontSize(17)
              .fontWeight(FontWeight.Medium)
              .fontColor(this.labelColor())
            Row() {
              Text('取消')
                .fontSize(16)
                .fontColor(this.labelColor())
                .height(44)
                .onClick(() => {
                  this.hostEditOpen = false;
                })
              Blank()
              Text('保存')
                .fontSize(16)
                .fontWeight(FontWeight.Bold)
                .fontColor(this.labelColor())
                .height(44)
                .onClick(() => {
                  this.saveHostAlias();
                })
            }
            .width('100%')
            .height(48)
            .padding({ left: 16, right: 16 })
          }
          .width('100%')
          .height(48)

          Scroll() {
            Column() {
              Text('留空使用网关提供的名称：' + (this.gatewayName.length > 0 ? this.gatewayName : '未命名'))
                .fontSize(12)
                .fontColor(this.secondaryLabel())
                .width('100%')
                .padding({ left: 16, top: 16, bottom: 6 })
              Column() {
                TextInput({ text: this.editAlias, placeholder: this.gatewayName })
                  .caretStyle({ width: 1 })
                  .fontSize(16)
                  .fontColor(this.labelColor())
                  .placeholderColor(this.secondaryLabel())
                  .backgroundColor(Color.Transparent)
                  .height(44)
                  .padding({ left: 16, right: 16 })
                  .onChange((value: string) => {
                    this.editAlias = value;
                  })
                Row() {
                  Row()
                    .width('100%')
                    .height(0.5)
                    .backgroundColor(this.separatorColor())
                }
                .width('100%')
                .padding({ left: 16 })
                Row() {
                  Text('主机类型')
                    .fontSize(16)
                    .fontColor(this.labelColor())
                  Blank()
                  Row({ space: 6 }) {
                    if (this.editKind === 'server') {
                      this.serverGlyph(16, this.iconColor())
                    } else {
                      this.hostGlyph(16, this.iconColor())
                    }
                    Text(this.editKind === 'server' ? '服务器' : '电脑')
                      .fontSize(16)
                      .fontColor(this.labelColor())
                    Image($r('app.media.chev_down_white'))
                      .width(12)
                      .height(12)
                      .objectFit(ImageFit.Contain)
                      .colorFilter(this.iconTint(this.iconColor()))
                  }
                  .onClick(() => {
                    this.kindMenuOpen = !this.kindMenuOpen;
                  })
                  // 系统菜单：与对话页右上角「⋯」同款
                  .bindMenu(this.kindMenuOpen, this.kindMenuBuilder(), {
                    outlineColor: this.separatorColor(),
                    outlineWidth: 1,
                    onWillDisappear: () => {
                      this.kindMenuOpen = false;
                    },
                    onDisappear: () => {
                      this.kindMenuOpen = false;
                    },
                    onDidDisappear: () => {
                      this.kindMenuOpen = false;
                    }
                  })
                }
                .width('100%')
                .height(44)
                .padding({ left: 16, right: 16 })
              }
              .width('100%')
              .backgroundColor(this.isDark ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.38)')
              .border({ width: 0.5, color: this.isDark ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.60)' })
              .borderRadius(16)
              .margin({ bottom: 16 })
            }
            .width('100%')
            .padding({ left: 14, right: 14 })
          }
          .layoutWeight(1)
          .width('100%')
          .scrollBar(BarState.Off)
          .align(Alignment.Top)
        } else {
          // ── 主机列表（iOS inset grouped List）──
          Stack({ alignContent: Alignment.Center }) {
            Text('切换主机')
              .fontSize(17)
              .fontWeight(FontWeight.Medium)
              .fontColor(this.labelColor())
            Row() {
              Text(this.hostEditMode ? '完成' : '编辑')
                .fontSize(16)
                .fontWeight(FontWeight.Medium)
                .fontColor(this.labelColor())
                .height(32)
                .padding({ left: 14, right: 14 })
                .borderRadius(999)
                .backgroundColor(this.isDark ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.60)')
                .border({ width: 0.5, color: this.isDark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.10)' })
                .onClick(() => {
                  this.hostEditMode = !this.hostEditMode;
                  if (!this.hostEditMode) {
                    this.hostSelectedIds = [];
                  }
                })
              Blank()
              if (this.hostEditMode && this.hostSelectedIds.length > 0) {
                Text('删除')
                  .fontSize(16)
                  .fontColor(this.destructiveColor())
                  .height(44)
                  .onClick(() => {
                    this.confirmDeleteHost();
                  })
              }
            }
            .width('100%')
            .height(48)
            .padding({ left: 16, right: 16 })
          }
          .width('100%')
          .height(48)

          Scroll() {
            Column() {
              Text('我的主机')
                .fontSize(14)
                .fontColor(this.secondaryLabel())
                .width('100%')
                .padding({ left: 19, top: 16, bottom: 6 })

              if (!this.hasSavedHost()) {
                Column() {
                  Row({ space: 12 }) {
                    this.hostGlyph(22, this.iconColorSecondary())
                    Text('暂无已连接的主机')
                      .fontSize(16)
                      .fontColor(this.secondaryLabel())
                      .layoutWeight(1)
                  }
                  .width('100%')
                  .padding({ left: 16, right: 16, top: 10, bottom: 10 })
                }
                .width('100%')
                  .backgroundColor(this.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.50)')
                  .border({ width: 0.5, color: this.isDark ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.80)' })
                .borderRadius(16)
              } else {
                ForEach(this.distinctHosts(), (gateway: SavedGateway) => {
                  Column() {
                    Row({ space: 12 }) {
                      if (this.hostEditMode) {
                        // 多选圆：外圈 + 选中时内圈实心点（对齐小程序多选删除）
                        Stack({ alignContent: Alignment.Center }) {
                          Circle()
                            .width(20)
                            .height(20)
                            .fill('rgba(0,0,0,0)')
                            .stroke(this.hostSelectedIds.indexOf(gateway.id) >= 0
                              ? this.iconColor() : this.iconColorSecondary())
                            .strokeWidth(1.5)
                          if (this.hostSelectedIds.indexOf(gateway.id) >= 0) {
                            Circle()
                              .width(11)
                              .height(11)
                              .fill(this.iconColor())
                          }
                        }
                        .width(20)
                        .height(20)
                        .margin({ right: 2 })
                        .onClick(() => {
                          this.toggleHostSelected(gateway.id);
                        })
                      }
                      if (this.savedHostKind(gateway) === 'server') {
                        this.serverGlyph(22, this.iconColor())
                      } else {
                        this.hostGlyph(22, this.iconColor())
                      }
                      Column({ space: 2 }) {
                        Row({ space: 6 }) {
                          Text(this.savedHostName(gateway))
                            .fontSize(16)
                            .fontColor(this.labelColor())
                            .maxLines(1)
                            .textOverflow({ overflow: TextOverflow.Ellipsis })
                            .constraintSize({ maxWidth: 180 })
                          if (this.isActiveGateway(gateway) && this.hostLinkLabel().length > 0) {
                            Text(this.hostLinkLabel())
                              .fontSize(10.5)
                              .fontWeight(FontWeight.Medium)
                              .fontColor(this.hostLinkColor())
                              .backgroundColor(this.hostLinkBg())
                              .border({ width: 1, color: this.hostLinkBorder() })
                              .borderRadius(999)
                              .height(16)
                              .padding({ left: 6, right: 6 })
                              .textAlign(TextAlign.Center)
                          }
                        }
                        .width('100%')
                        Text(this.savedHostSubLabel(gateway))
                          .fontSize(12.5)
                          .fontColor(this.hostRowSubColor(this.isActiveGateway(gateway) && this.connection === 'connected'))
                          .maxLines(1)
                          .textOverflow({ overflow: TextOverflow.Ellipsis })
                          .width('100%')
                      }
                      .alignItems(HorizontalAlign.Start)
                      .layoutWeight(1)
                      Circle({ width: 8, height: 8 })
                        .fill(this.isActiveGateway(gateway) ? this.hostPillDotColor() : this.iconColorSecondary())
                      if (this.hostEditMode) {
                        Row() {
                          Image($r('app.media.pencil_edit_white'))
                            .width(18)
                            .height(18)
                            .objectFit(ImageFit.Contain)
                            .fillColor(this.iconColor())
                        }
                        .width(44)
                        .height(44)
                        .justifyContent(FlexAlign.Center)
                        .onClick(() => {
                          // 编辑哪台就加载哪台的备注与类型
                          this.editAlias = gateway.alias !== undefined ? gateway.alias : '';
                          this.editKind = this.savedHostKind(gateway);
                          this.editingGatewayId = gateway.id;
                          this.hostEditOpen = true;
                        })
                      }
                    }
                    .width('100%')
                    .padding({ left: 16, right: 16, top: 10, bottom: 10 })
                    .onClick(() => {
                      if (this.hostEditMode) {
                        this.toggleHostSelected(gateway.id);
                      } else {
                        this.hostSheetOpen = false;
                        if (this.isActiveGateway(gateway)) {
                          // 当前主机：关闭面板并立即尝试连接（按当前网络选择局域网/隧道）
                          if (this.connection !== 'connected') {
                            if (this.credentialRejected) {
                              // 网关已拒绝保存的凭据：重连只会再吃一次 401，直接进扫码配对
                              this.scanPairingNow();
                            } else {
                              GatewayClient.get().revalidateOnForeground();
                              GatewayClient.get().reconnectCurrent();
                            }
                          }
                        } else {
                          // 切换到另一台已保存的主机（按其档案里的候选地址连接）
                          GatewayClient.get().switchGateway(gateway.id);
                        }
                      }
                    })
                  }
                  .width('100%')
                  .backgroundColor(this.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.50)')
                  .border({ width: 0.5, color: this.isDark ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.80)' })
                  .borderRadius(16)
                  .margin({ top: 5, bottom: 5 })
                }, (gateway: SavedGateway) => gateway.id)
              }
            }
            .width('100%')
            .padding({ left: 14, right: 14, bottom: 16 })
          }
          .layoutWeight(1)
          .width('100%')
          .scrollBar(BarState.Off)
          .align(Alignment.Top)
        }
      }
      .width('100%')
      .height('100%')
      .padding({ bottom: 8 })
  }

  /** 删除主机确认（对齐 iOS alert） */
  @Builder
  hostDeleteAlert() {
    Stack({ alignContent: Alignment.Center }) {
      Column()
        .width('100%')
        .height('100%')
        .backgroundColor('rgba(0,0,0,0.35)')
        .onClick(() => {
          this.hostDeleteOpen = false;
        })
      Column() {
        Column() {
          Text('删除主机？')
            .fontSize(20)
            .fontWeight(FontWeight.Bold)
            .fontColor(this.labelColor())
            .textAlign(TextAlign.Center)
            .width('100%')
          Text('从 App 移除选中的 1 台主机及连接凭证；网关上的会话和工作区不会被删除。再次连接需重新配对。')
            .fontSize(16)
            .fontColor(this.labelColor())
            .textAlign(TextAlign.Center)
            .lineHeight(18)
            .width('100%')
            .margin({ top: 4 })
        }
        .width('100%')
        .padding({ left: 16, right: 16, top: 20, bottom: 18 })

        Row()
          .width('100%')
          .height(0.5)
          .backgroundColor(this.separatorColor())

        Row() {
          Row() {
            Text('取消')
              .fontSize(16)
              .fontColor(this.accentColor())
          }
          .layoutWeight(1)
          .height(44)
          .justifyContent(FlexAlign.Center)
          .onClick(() => {
            this.hostDeleteOpen = false;
          })
          Column()
            .width(0.5)
            .height(44)
            .backgroundColor(this.separatorColor())
          Row() {
            Text('删除')
              .fontSize(16)
              .fontWeight(FontWeight.Bold)
              .fontColor(this.destructiveColor())
          }
          .layoutWeight(1)
          .height(44)
          .justifyContent(FlexAlign.Center)
          .onClick(() => {
            this.hostDeleteOpen = false;
            this.deleteSelectedHosts();
          })
        }
        .width('100%')
        .height(44)
      }
      .width(320)
      // 鸿蒙对话框：32vp 圆角 + 系统底色
      .backgroundColor(this.isDark ? '#2E2E2E' : this.labelColor())
      .borderRadius(32)
    }
    .width('100%')
    .height('100%')
  }

  /** 系统扫码：扫到配对二维码后直接连接（对齐小程序 pairByScan） */
  private async scanPairingNow(): Promise<void> {
    try {
      const context = getContext(this) as common.UIAbilityContext;
      const options: scanBarcode.ScanOptions = {
        scanTypes: [scanCore.ScanType.ALL],
        enableMultiMode: false,
        enableAlbum: true
      };
      const result: scanBarcode.ScanResult = await scanBarcode.startScanForResult(context, options);
      const parsed: PairingResult = parsePairingPayload(result.originalValue);
      if (!parsed.ok) {
        this.manualHint = parsed.error;
        this.manualSheetOpen = true;
        return;
      }
      GatewayClient.get().connectPairing(parsed);
    } catch (err) {
      // 用户取消或扫码失败：不打断
    }
  }

  /** 手动输入配对信息：对齐小程序 manual-sheet 的「设备认证」 */
  @Builder
  manualSheetOverlay() {
    Column({ space: 0 }) {
        // 顶部拖动条（与「切换主机」半模态同款）
        Column() {
          Column()
            .width(36)
            .height(4)
            .borderRadius(2)
            .backgroundColor(this.isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.22)')
        }
        .width('100%')
        .height(16)
        .justifyContent(FlexAlign.Center)

        // 头部：标题居中 + 右侧取消（对齐切换主机头部）
        Stack({ alignContent: Alignment.Center }) {
          Text('设备认证')
            .fontSize(17)
            .fontWeight(FontWeight.Medium)
            .fontColor(this.labelColor())
          Row() {
            Blank()
            Text('取消')
              .fontSize(16)
              .fontColor(this.labelColor())
              .height(44)
              .onClick(() => {
                this.manualSheetOpen = false;
              })
          }
          .width('100%')
          .height(48)
          .padding({ left: 16, right: 16 })
        }
        .width('100%')
        .height(48)

        if (this.keyboardHeightVp <= 0) {
          Text('粘贴 Harness WebUI 提供的配对信息即可连接；长期设备 token 只会安全保存在本机。')
            .fontSize(12)
            .fontColor(this.secondaryLabel())
            .width('100%')
            .padding({ left: 16, right: 16, top: 8, bottom: 10 })
        }

        Column() {
          Row() {
            Text('配对信息')
              .fontSize(12)
              .fontColor(this.secondaryLabel())
            Blank()
            Row({ space: 14 }) {
              Text('粘贴')
                .fontSize(12)
                .fontColor(this.accentColor())
                .onClick(() => {
                  this.pastePairingText();
                })
              if (this.manualText.length > 0) {
                Text('清空')
                  .fontSize(12)
                  .fontColor(this.accentColor())
                  .onClick(() => {
                    this.manualText = '';
                  })
              }
            }
          }
          .width('100%')
          .padding({ left: 12, right: 12, top: 10 })

          TextArea({ text: this.manualText, placeholder: '粘贴 Base64URL 配对字符串或完整配对信息' })
            .caretStyle({ width: 1 })
            .height(this.keyboardHeightVp > 0 ? 64 : 120)
            .fontSize(13)
            .fontColor(this.labelColor())
            .placeholderColor(this.secondaryLabel())
            .backgroundColor(Color.Transparent)
            .padding({ left: 12, right: 12, top: 6, bottom: 10 })
            .onChange((value: string) => {
              this.manualText = value;
            })
        }
        .width('100%')
        .borderRadius(16)
        .backgroundColor(this.isDark ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.38)')
        .border({ width: 0.5, color: this.isDark ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.60)' })

        if (this.manualHint.length > 0) {
          Text(this.manualHint)
            .fontSize(12)
            .fontColor('#FF6B60')
            .width('100%')
            .margin({ top: 8 })
        }

        Button('连接')
          .width('100%')
          .height(46)
          .fontSize(15)
          .fontColor(this.labelColor())
          .backgroundColor('#2E6BE6')
          .margin({ top: 12 })
          .enabled(this.manualText.trim().length > 0)
          .opacity(this.manualText.trim().length > 0 ? 1 : 0.5)
          .onClick(() => {
            this.connectManual();
          })
      }
      .width('100%')
      .padding({ left: 14, right: 14, bottom: this.safeBottom })
  }

  /** 从系统剪贴板粘贴配对信息（对齐小程序 pastePairingText） */
  private pastePairingText(): void {
    try {
      pasteboard.getSystemPasteboard().getData().then((data: pasteboard.PasteData) => {
        const text: string = data.getPrimaryText();
        if (text.length > 0) {
          this.manualText = text.trim();
          this.manualHint = '';
        }
      }).catch(() => {
        this.manualHint = '剪贴板为空';
      });
    } catch (err) {
      this.manualHint = '读取剪贴板失败';
    }
  }

  private connectManual(): void {
    const raw: string = this.manualText.trim();
    if (raw.length === 0) {
      this.manualHint = '请先粘贴配对信息';
      return;
    }
    const parsed: PairingResult = parsePairingPayload(raw);
    if (!parsed.ok) {
      this.manualHint = parsed.error;
      return;
    }
    this.manualSheetOpen = false;
    GatewayClient.get().connectPairing(parsed);
  }

  /** 连接方式徽标：直连局域网 / 公网中继（对齐 .host-link-badge） */
  /** 判断地址是否属于局域网（私有网段 / localhost / mDNS） */
  private isLanEndpoint(url: string): boolean {
    let host: string = url;
    const scheme: number = host.indexOf('://');
    if (scheme >= 0) {
      host = host.substring(scheme + 3);
    }
    const slash: number = host.indexOf('/');
    if (slash >= 0) {
      host = host.substring(0, slash);
    }
    const colon: number = host.indexOf(':');
    if (colon >= 0) {
      host = host.substring(0, colon);
    }
    if (host === 'localhost' || host.endsWith('.local')) {
      return true;
    }
    const parts: string[] = host.split('.');
    if (parts.length === 4) {
      const a: number = Number(parts[0]);
      const b: number = Number(parts[1]);
      if (a === 127) return true;
      if (a === 10) return true;
      if (a === 192 && b === 168) return true;
      if (a === 172 && b >= 16 && b <= 31) return true;
      if (a === 169 && b === 254) return true;
    }
    return false;
  }

  /** 线路族：lan / public（对齐小程序 hostLinkKind） */
  private hostLinkKind(): string {
    if (this.connection === 'connected') {
      // 按实际链路：只有真的走中继/内嵌隧道才是公网，局域网直连保持局域网
      if (this.transportKind === 'relay' || this.transportTailnet) {
        return 'public';
      }
      return 'lan';
    }
    // 未连接：按已保存端点推断，局域网优先
    const saved = GatewayClient.get().savedGateways();
    let lan: boolean = false;
    let pub: boolean = false;
    for (const one of saved) {
      const list: string[] = one.endpoints !== undefined && one.endpoints.length > 0 ? one.endpoints : [one.wsUrl];
      for (const endpoint of list) {
        if (this.isLanEndpoint(endpoint)) {
          lan = true;
        } else {
          pub = true;
        }
      }
    }
    if (lan) return 'lan';
    if (pub) return 'public';
    return '';
  }

  private hostLinkLabel(): string {
    const kind: string = this.hostLinkKind();
    if (kind === 'lan') {
      return '局域网';
    }
    if (kind === 'public') {
      return '公网';
    }
    return '';
  }

  /** 切换主机按钮的状态点：公网中继 / Tailscale 隧道=蓝色、局域网直连=绿色，其余按连接状态 */
  private hostPillDotColor(): string {
    if (this.connection === 'connected') {
      // Tailscale 内嵌隧道同样走公网路径，与中继共用蓝色
      // 按实际链路：中继或真的走了内嵌隧道才显示公网蓝，局域网直连保持绿色
      if (this.transportKind === 'relay' || this.transportTailnet) {
        return '#4C8CF5';
      }
      return '#34C759';
    }
    return this.statusColor();
  }

  /** Tailscale 隧道是否已就绪（节点 Running 且开关打开） */
  private tailscaleTunnelActive(): boolean {
    return this.tailscaleTunnelEnabled && this.tailscaleStage === 'ready';
  }

  /** 徽标颜色与状态点保持一致：公网/Tailscale=蓝，局域网=绿 */
  private hostLinkColor(): string {
    return this.hostLinkKind() === 'public' ? '#4C8CF5' : '#34C759';
  }

  private hostLinkBg(): string {
    return this.hostLinkKind() === 'public' ? 'rgba(76,140,245,0.12)' : 'rgba(52,199,89,0.12)';
  }

  private hostLinkBorder(): string {
    return this.hostLinkKind() === 'public' ? 'rgba(76,140,245,0.34)' : 'rgba(52,199,89,0.34)';
  }

  /** 沉浸光感能力判断（旧系统降级） */
  private immersiveSupported(): boolean {
    try {
      return uiMaterial.isImmersiveMaterialSupported();
    } catch (err) {
      return false;
    }
  }

  /** 半模态弹窗材质：浅色=奶白玻璃、深色=通透深玻璃（系统按算力自动降级） */
  private hostSheetMaterial(): uiMaterial.Material | undefined {
    if (!this.immersiveSupported()) {
      return undefined;
    }
    return new uiMaterial.ImmersiveMaterial({
      style: uiMaterial.ImmersiveStyle.THICK,
      // 浅色模式叠白做「奶白」，深色模式几乎不叠白保持通透
      materialColor: this.isDark ? 'rgba(255,255,255,0.02)' : 'rgba(255,255,255,0.34)',
      colorInvert: true,
      applyShadow: true
    });
  }

  /** 删除主机确认：系统 AlertDialog（自动使用沉浸材质） */
  private confirmDeleteHost(): void {
    AlertDialog.show({
      title: '删除主机？',
      message: '从 App 移除选中的 ' + this.hostSelectedIds.length + ' 台主机及连接凭证；网关上的会话和工作区不会被删除。再次连接需重新配对。',
      autoCancel: true,
      systemMaterial: this.hostSheetMaterial(),
      primaryButton: {
        value: '取消',
        action: () => {
        }
      },
      secondaryButton: {
        value: '删除',
        fontColor: this.destructiveColor(),
        action: () => {
          this.deleteSelectedHosts();
        }
      }
    });
  }

  // ── iOS 风格（系统 sheet / 分组列表）配色与图标着色 ──
  private labelColor(): string {
    // 鸿蒙主文字：黑/白 90%
    return this.isDark ? 'rgba(255,255,255,0.92)' : 'rgba(0,0,0,0.90)';
  }

  private secondaryLabel(): string {
    // 鸿蒙次要文字：黑/白 60%
    return this.isDark ? 'rgba(255,255,255,0.60)' : 'rgba(0,0,0,0.55)';
  }

  /** 主机行副标题：深色=白 60%/45%，浅色=黑 60%/45%（对齐小程序 host-row-sub 的 on/off） */
  private hostRowSubColor(isActive: boolean): string {
    if (isActive) {
      return this.isDark ? 'rgba(255,255,255,0.60)' : 'rgba(16,19,24,0.55)';
    }
    return this.isDark ? 'rgba(255,255,255,0.45)' : 'rgba(16,19,24,0.40)';
  }

  private separatorColor(): string {
    // 鸿蒙分割线：黑 10% / 白 20%
    return this.isDark ? 'rgba(255,255,255,0.16)' : 'rgba(0,0,0,0.10)';
  }

  private accentColor(): string {
    // 鸿蒙品牌蓝
    return this.isDark ? '#6FA8FF' : '#0A59F7';
  }

  private destructiveColor(): string {
    // 鸿蒙警示红
    return this.isDark ? '#FF6B60' : '#E84026';
  }

  private dialogBackground(): string {
    // 系统弹窗底色（深色 #2E2E2E / 浅色 #FFFFFF）
    return this.isDark ? '#2E2E2E' : '#FFFFFF';
  }

  private dialogText(): string {
    return this.isDark ? 'rgba(255,255,255,0.92)' : 'rgba(0,0,0,0.90)';
  }

  private dialogSubText(): string {
    return this.isDark ? 'rgba(255,255,255,0.60)' : 'rgba(0,0,0,0.55)';
  }

  private dialogInputBackground(): string {
    return this.isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.06)';
  }

  private sheetBackground(): string {
    return this.isDark ? '#000000' : '#F2F2F7';
  }

  private cellBackground(): string {
    // 鸿蒙列表卡片：玻璃上叠淡白（深色模式叠淡白 8%）
    return this.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.45)';
  }

  /** 鸿蒙沉浸光感材质；不支持或低算力设备返回 undefined，回退到系统模糊 + 半透明底 */
  private immersiveMaterial(style: uiMaterial.ImmersiveStyle, materialColor: ResourceColor, interactive: boolean): uiMaterial.Material | undefined {
    if (!uiMaterial.isImmersiveMaterialSupported()) {
      return undefined;
    }
    // 低算力设备上材质会退化成纯色层（没有模糊），回退到半透明底更稳
    if (uiMaterial.getGlobalMaterialLevel() === uiMaterial.MaterialLevel.SMOOTH) {
      return undefined;
    }
    return new uiMaterial.ImmersiveMaterial({
      style: style,
      materialColor: materialColor,
      colorInvert: true,
      applyShadow: true,
      interactive: interactive,
      lightEffect: interactive ? { color: '#FFFFFF' } : undefined
    });
  }

  /** 图标主色 / 次色：随浅深色切换 */
  private iconColor(): string {
    return this.isDark ? '#FFFFFF' : '#000000';
  }

  private iconColorSecondary(): string {
    return this.isDark ? '#A0A0A8' : '#8A8A8E';
  }

  /** 单色图标着色（颜色矩阵）：支持 #RRGGBB / #AARRGGBB / rgb() / rgba()，只换 RGB 保留透明度 */
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
    // 注意：颜色矩阵的偏移列是 0~1 归一化值（不是 0~255），否则会被截断成白色
    return [
      0, 0, 0, 0, red / 255,
      0, 0, 0, 0, green / 255,
      0, 0, 0, 0, blue / 255,
      0, 0, 0, alpha, 0
    ];
  }

  /** 重新读取已保存主机：连不上时这些记录仍在本地，界面必须能显示出来。 */
  private refreshSavedHosts(): void {
    try {
      this.savedHosts = GatewayClient.get().savedGateways();
    } catch (err) {
      this.savedHosts = [];
    }
  }

  private hasSavedHost(): boolean {
    return this.savedHosts.length > 0 || this.gatewayName.length > 0 || this.hostAlias.length > 0;
  }

  /**
   * 最近使用的那台已保存主机：活动档案优先，否则取 lastConnectedAt 最大的一条。
   * 注意不能用 savedHosts[0] —— 那是「最早保存」的一条，不是「最近使用」的。
   */
  private recentSavedHost(): SavedGateway | null {
    if (this.savedHosts.length === 0) {
      return null;
    }
    const activeId: string = GatewayClient.get().activeGatewayId();
    for (const gateway of this.savedHosts) {
      if (gateway.id === activeId) {
        return gateway;
      }
    }
    let newest: SavedGateway = this.savedHosts[0];
    for (const gateway of this.savedHosts) {
      if (gateway.lastConnectedAt > newest.lastConnectedAt) {
        newest = gateway;
      }
    }
    return newest;
  }

  /** 未连接时的主机名兜底：最近使用的主机名 → wsUrl 主机段 */
  private savedHostFallbackName(): string {
    const one: SavedGateway | null = this.recentSavedHost();
    if (one === null) {
      return '';
    }
    if (one.name.length > 0) {
      return one.name;
    }
    const url: string = one.wsUrl;
    const start: number = url.indexOf('://') >= 0 ? url.indexOf('://') + 3 : 0;
    const rest: string = url.substring(start);
    const end: number = rest.indexOf('/') >= 0 ? rest.indexOf('/') : rest.length;
    return rest.substring(0, end);
  }

  private hostDisplayName(): string {
    // 活动主机档案里的备注名优先（每台主机各自的 alias），再退回网关上报名与最近使用的主机
    const activeId: string = GatewayClient.get().activeGatewayId();
    for (const gateway of this.savedHosts) {
      if (gateway.id === activeId && gateway.alias !== undefined && gateway.alias.length > 0) {
        return gateway.alias;
      }
    }
    if (this.gatewayName.length > 0) {
      return this.gatewayName;
    }
    const saved: string = this.savedHostFallbackName();
    if (saved.length > 0) {
      return saved;
    }
    return this.hostAlias.length > 0 ? this.hostAlias : '暂无已保存的主机';
  }

  /**
   * 顶部胶囊的主机名：连接中显示网关上报名，未连接/重连中显示「最近使用」的那台。
   * 顺序：网关上报名 → 最近使用主机的备注名/名称 → 旧的全局别名 → 本机。
   * 以前把全局 hostAlias 排在已保存主机前面：只要你给某台主机改过备注，
   * 之后切到别的主机、或冷启动时，胶囊还会顶着上一台的备注名。
   */
  private hostPillLabel(): string {
    if (this.gatewayName.length > 0) {
      return this.gatewayName;
    }
    const recent: SavedGateway | null = this.recentSavedHost();
    if (recent !== null) {
      const name: string = this.savedHostName(recent);
      if (name.length > 0) {
        return name;
      }
    }
    if (this.hostAlias.length > 0) {
      return this.hostAlias;
    }
    return '本机';
  }

  /** 保存编辑表单：备注名与主机类型写入对应主机档案（编辑哪台存哪台）。 */
  private saveHostAlias(): void {
    const alias: string = this.editAlias.trim();
    const activeId: string = GatewayClient.get().activeGatewayId();
    const target: string = this.editingGatewayId.length > 0 ? this.editingGatewayId : activeId;
    GatewayClient.get().renameGateway(target, alias, this.editKind);
    // 活动主机的备注同步到旧 hostAlias 偏好：首页顶部胶囊仍从那里读
    if (target === activeId) {
      this.hostAlias = alias;
      PreferencesStore.get().putString('hostAlias', this.hostAlias);
      AppStorage.setOrCreate<string>('hostAlias', this.hostAlias);
    }
    this.refreshSavedHosts();
    this.hostEditOpen = false;
    this.editingGatewayId = '';
  }

  /** 当前查看的主机是否是活动连接的那台 */
  private isActiveGateway(gateway: SavedGateway): boolean {
    return GatewayClient.get().activeGatewayId() === gateway.id;
  }

  /** 同一物理主机的归组键：网关名一致视为同一台（历史重复配对会攒出多条档案）。 */
  private hostGroupKey(gateway: SavedGateway): string {
    const name: string = gateway.name.trim().toLowerCase();
    if (name.length > 0) {
      return 'name:' + name;
    }
    const url: string = gateway.wsUrl;
    const start: number = url.indexOf('://') >= 0 ? url.indexOf('://') + 3 : 0;
    const rest: string = url.substring(start);
    const end: number = rest.indexOf('/') >= 0 ? rest.indexOf('/') : rest.length;
    let hostEnd: number = end;
    const colon: number = rest.indexOf(':');
    if (colon >= 0 && colon < end) {
      hostEnd = colon;
    }
    return 'url:' + rest.substring(0, hostEnd).toLowerCase();
  }

  /** 去重后的主机列表：同一台只留一条——组里有活动档案优先保留它，否则留最近连接的；按最近连接排序。 */
  private distinctHosts(): SavedGateway[] {
    const activeId: string = GatewayClient.get().activeGatewayId();
    const keys: string[] = [];
    const lists: SavedGateway[][] = [];
    for (const gateway of this.savedHosts) {
      const key: string = this.hostGroupKey(gateway);
      const idx: number = keys.indexOf(key);
      if (idx < 0) {
        keys.push(key);
        lists.push([gateway]);
      } else {
        lists[idx].push(gateway);
      }
    }
    const result: SavedGateway[] = [];
    for (const list of lists) {
      let kept: SavedGateway = list[0];
      for (const item of list) {
        if (item.id === activeId) {
          kept = item;
          break;
        }
      }
      if (kept.id !== activeId) {
        for (const item of list) {
          if (item.lastConnectedAt > kept.lastConnectedAt) {
            kept = item;
          }
        }
      }
      result.push(kept);
    }
    result.sort((a: SavedGateway, b: SavedGateway) => b.lastConnectedAt - a.lastConnectedAt);
    return result;
  }

  /** 勾选一台时，同组的重复档案 id 一并返回（删除时一起清掉）。 */
  private duplicateIdsFor(id: string): string[] {
    const target: SavedGateway | undefined = this.savedHosts.find((item: SavedGateway) => item.id === id);
    if (target === undefined) {
      return [id];
    }
    const key: string = this.hostGroupKey(target);
    const ids: string[] = [];
    for (const item of this.savedHosts) {
      if (this.hostGroupKey(item) === key) {
        ids.push(item.id);
      }
    }
    return ids;
  }

  /** 行显示名：备注名 → 网关上报名 → wsUrl 主机段 */
  private savedHostName(gateway: SavedGateway): string {
    if (gateway.alias !== undefined && gateway.alias.length > 0) {
      return gateway.alias;
    }
    if (gateway.name.length > 0) {
      return gateway.name;
    }
    const url: string = gateway.wsUrl;
    const start: number = url.indexOf('://') >= 0 ? url.indexOf('://') + 3 : 0;
    const rest: string = url.substring(start);
    const end: number = rest.indexOf('/') >= 0 ? rest.indexOf('/') : rest.length;
    return rest.substring(0, end);
  }

  /** 行图标类型：档案里有 deviceKind 用它，否则按电脑 */
  private savedHostKind(gateway: SavedGateway): string {
    return gateway.deviceKind !== undefined && gateway.deviceKind.length > 0
      ? gateway.deviceKind : 'desktop';
  }

  /** 行副标题：活动主机看连接状态，其它主机固定「点击连接」 */
  private savedHostSubLabel(gateway: SavedGateway): string {
    if (!this.isActiveGateway(gateway)) {
      return '点击连接';
    }
    if (this.connection === 'connected') {
      return '当前主机 · 已连接';
    }
    return this.credentialRejected ? '设备凭据已失效 · 点击重新配对' : '点击连接';
  }

  /** 编辑模式勾选/取消一台主机（多选删除，对齐小程序 host-select） */
  private toggleHostSelected(id: string): void {
    const index: number = this.hostSelectedIds.indexOf(id);
    if (index >= 0) {
      const next: string[] = this.hostSelectedIds.slice();
      next.splice(index, 1);
      this.hostSelectedIds = next;
    } else {
      this.hostSelectedIds = this.hostSelectedIds.concat(id);
    }
  }

  /** 删除勾选的主机（对齐小程序 confirmDeleteHosts）：同名重复档案一并移除。 */
  private deleteSelectedHosts(): void {
    const ids: string[] = [];
    for (const id of this.hostSelectedIds) {
      for (const dup of this.duplicateIdsFor(id)) {
        if (ids.indexOf(dup) < 0) {
          ids.push(dup);
        }
      }
    }
    for (const id of ids) {
      GatewayClient.get().removeGateway(id);
    }
    this.hostSelectedIds = [];
    this.refreshSavedHosts();
    // 删到一台不剩且当前没有连接：收起面板（对齐小程序删除后刷新列表）
    if (this.distinctHosts().length === 0 && this.connection !== 'connected') {
      this.hostSheetOpen = false;
    }
  }

  /**
   * 连上/重连后立刻校准一次会话列表：
   * 断线期间桌面端可能开跑或跑完，重连后不能干等下一拍轮询。
   */
  onConnectionChanged(): void {
    this.refreshSavedHosts();
    if (this.connection === 'connected') {
      SessionStore.get().refreshSessionsNow();
    }
  }

  aboutToAppear(): void {
    this.refreshSavedHosts();
    this.applyStatusBarWhite();
    // 键盘出现时不移动整页，只让底部弹层自己上浮
    try {
      this.getUIContext().setKeyboardAvoidMode(KeyboardAvoidMode.NONE);
    } catch (ignored) {
    }
    // 抽屉宽度：min(屏宽 × 0.76, 360)（对齐小程序 drawerW）
    try {
      const screenW: number = this.getUIContext().px2vp(display.getDefaultDisplaySync().width);
      this.drawerWidth = Math.min(Math.round(screenW * 0.76), 360);
    } catch (ignored) {
    }
  }

  build() {
    NavDestination() {
      // 左上对齐：抽屉必须从屏幕左缘 (x=0) 展开，默认居中会把它推到中间
      Stack({ alignContent: Alignment.TopStart }) {
        // ── 侧栏底层：常驻挂载，打开时自身向右展开（对齐小程序 drawer translateX(-100%) → 0）──
        this.drawerOverlay()

        // ── 首页内容层：深海背景 + 内容同层，整体右移并被左侧圆角裁切；侧栏展开时上下同时内缩（对齐小程序 home-content-wrap）──
        Stack({ alignContent: Alignment.TopStart }) {
          // 深海鲸鱼背景：首页恒用深海背景，不随明暗主题变化（对齐小程序 .deep-bg）
          Stack() {
            OceanBackground()
          }
          .width('100%')
          .height('100%')

          Scroll() {
          Column() {
          // ── 顶栏：品牌 + 两个圆形玻璃按钮 ──
          Row() {
            // 品牌硬币：App 图标六边形（fluKe）做成 3D 硬币，拖动可上下左右翻转
            FluKeCoin({
              diameter: 36,
              onTap: () => {
                this.openDrawer();
              }
            })
              .margin({ right: 6 })
              .translate({ y: -1 })
            // 文字标：与徽章同高，垂直居中（对齐小程序 brand-row）
            Image($r('app.media.wordmark_white'))
              .width(52)
              .height(15)
              .objectFit(ImageFit.Contain)
              .margin({ right: 9 })
            // HARNESS 徽章：19rpx 字 / 30rpx 高 / 8rpx 圆角
            Text('HARNESS')
              .fontSize(9.5)
              .fontWeight(FontWeight.Bold)
              .fontColor('#10151F')
              .backgroundColor('#FFFFFF')
              .borderRadius(4)
              .height(15)
              .padding({ left: 6, right: 6 })
              .textAlign(TextAlign.Center)
              .letterSpacing(0.5)
            Blank()
          }
          .width('100%')
          .alignItems(VerticalAlign.Center)
          .margin({ bottom: 22 })
          .onClick(() => {
            this.openDrawer();
          })

          // ── 主机行：主机胶囊（左） + 配对/设置圆形玻璃钮（右） ──
          Row() {
            // 主机胶囊：点击打开主机切换面板（外层固定 49 = 圆钮高度，保证垂直居中对齐）
            Column() {
            Row({ space: 8 }) {
              if (this.tailscaleTunnelEnabled) {
                TailscaleMarkView({
                  connected: this.tailscaleStage === 'ready',
                  tint: 'rgba(255,255,255,0.85)',
                  markSize: 18
                })
              }
              if (this.editKind === 'server') {
                this.serverGlyph(18, '#FFFFFF')
              } else {
                this.hostGlyph(18, '#FFFFFF')
              }
              Text(this.hostPillLabel())
                .fontSize(14)
                .fontColor('#FFFFFF')
                .maxLines(1)
                .textOverflow({ overflow: TextOverflow.Ellipsis })
                .constraintSize({ maxWidth: 200 })
              Circle({ width: 8, height: 8 }).fill(this.hostPillDotColor())
              Image($r('app.media.chev_down_white'))
                .height(13)
            }
            .padding({ left: 14, right: 14, top: 7, bottom: 7 })
            .borderRadius(999)
            .border({ width: 1, color: 'rgba(255,255,255,0.20)' })
            .backgroundEffect({ radius: 1.5, saturation: 1, brightness: 1 })
            .backgroundColor('rgba(255,255,255,0.05)')
            .shadow({ radius: 12, color: 'rgba(3,14,30,0.22)', offsetY: 4 })
            .onClick(() => {
              this.refreshSavedHosts();
              this.hostSheetOpen = true;
            })
            }
            .height(49)
            .justifyContent(FlexAlign.Center)

            Blank()

            // 配对（person-key）：玻璃圆钮 + 配对菜单
            Stack({ alignContent: Alignment.TopEnd }) {
              Row() {
                Image($r('app.media.person_key_white'))
                  .height(28)
                  .objectFit(ImageFit.Contain)
              }
              .width(49)
              .height(49)
              .borderRadius(24.5)
              .justifyContent(FlexAlign.Center)
              .onAreaChange((oldArea: Area, newArea: Area) => {
                const gx: number = Number(newArea.globalPosition.x);
                if (isFinite(gx) && gx > 0) {
                  this.pairBtnX = gx;
                }
              })
              .backgroundEffect({ radius: 1.5, saturation: 1, brightness: 1 })
              .backgroundColor('rgba(255,255,255,0.08)')
              .border({ width: 1, color: 'rgba(255,255,255,0.24)' })
              .onClick(() => {
                this.pairMenuOpen = !this.pairMenuOpen;
              })
              // 系统菜单：打开时按钮隐藏（保留布局做锚点），关闭后恢复
              .bindMenu(this.pairMenuOpen, this.pairMenuBuilder(), {
                outlineColor: this.separatorColor(),
                outlineWidth: 1,
                // 菜单水平居中：左右留白相等；y 保持在按钮下方
                anchorPosition: {
                  x: this.pairMenuAnchorX(),
                  y: 56
                },
                onWillDisappear: () => {
                  this.pairMenuOpen = false;
                },
                onDisappear: () => {
                  this.pairMenuOpen = false;
                },
                onDidDisappear: () => {
                  this.pairMenuOpen = false;
                }
              })
              .opacity(this.pairMenuOpen ? 0 : 1)
              .hitTestBehavior(this.pairMenuOpen ? HitTestMode.None : HitTestMode.Default)
            }

            // 设置：玻璃圆钮（打开会话设置）
            Row() {
              Image($r('app.media.sliders_white'))
                .height(23)
                .objectFit(ImageFit.Contain)
            }
            .width(49)
            .height(49)
            .borderRadius(24.5)
            .justifyContent(FlexAlign.Center)
            .backgroundEffect({ radius: 1.5, saturation: 1, brightness: 1 })
            .backgroundColor('rgba(255,255,255,0.08)')
            .border({ width: 1, color: 'rgba(255,255,255,0.24)' })
            .margin({ left: 10.6 })
            .onClick(() => {
              this.pageStack.pushPathByName('session-settings', null);
            })
          }
          .width('100%')
          .alignItems(VerticalAlign.Center)
          .margin({ top: 0, bottom: 24 })
          .onAreaChange((oldValue: Area, newValue: Area) => {
            this.rowY = Number(newValue.globalPosition.y);
            this.rowH = Number(newValue.height);
          })

          // ── Hero ──
          Column({ space: 6 }) {
            Text('探索未至之境')
              .fontSize(25)
              .fontWeight(FontWeight.Bold)
              .fontColor('#FFFFFF')
            Text('从想法到落地，一个对话即可。')
              .fontSize(13)
              .fontColor('rgba(255,255,255,0.65)')
          }
          .alignItems(HorizontalAlign.Start)
          .width('100%')
          .margin({ top: 60, bottom: 18 })
          // ── 工作区卡片 ──
          Row({ space: 10 }) {
            Image($r('app.media.workspace_folder_blue'))
              .height(26)
              .objectFit(ImageFit.Contain)
            Column({ space: 2 }) {
              Text(this.workspaceTitle())
                .fontSize(15) // 30rpx（对齐小程序 .ws-title）
                .fontWeight(FontWeight.Medium)
                .fontColor('#FFFFFF')
                .maxLines(1)
                .textOverflow({ overflow: TextOverflow.Ellipsis })
              Text(this.workspaceSubtitle())
                .fontSize(12) // 24rpx（对齐小程序 .ws-path）
                .fontColor('rgba(255,255,255,0.55)')
                .maxLines(1)
                .textOverflow({ overflow: TextOverflow.Ellipsis })
            }
            .alignItems(HorizontalAlign.Start)
            .layoutWeight(1)
            Row({ space: 8 }) {
              Circle({ width: 7, height: 7 }).fill(this.statusColor())
              Image($r('app.media.ic_dir_chevron_mist'))
                .height(14)
                .fillColor('rgba(255,255,255,0.5)')
            }
          }
          .width('100%')
          .padding({ top: 14, bottom: 14, left: 16, right: 16 })
          .borderRadius(21)
          .border({ width: 1, color: 'rgba(255,255,255,0.22)' })
          .backgroundEffect({ radius: 1, saturation: 1, brightness: 1 })
          .linearGradient({
            angle: 165,
            colors: [['rgba(255,255,255,0.018)', 0], ['rgba(255,255,255,0.004)', 1]]
          })
          .shadow({ radius: 14, color: 'rgba(3,14,30,0.12)', offsetY: 4 })
          .onAreaChange((oldValue: Area, newValue: Area) => {
            this.wsCardW = Number(newValue.width);
            this.wsCardH = Number(newValue.height);
          })
          .onClick(() => {
            this.wsMenuOpen = !this.wsMenuOpen;
          })
          // 系统菜单：打开时卡片隐藏（保留布局做锚点），关闭后恢复
          .bindMenu(this.wsMenuOpen, this.workspaceMenuBuilder(), {
            // 描边用中性色，深色模式下不再出现系统蓝边
            outlineColor: this.separatorColor(),
            outlineWidth: 1,
            // 菜单中心对齐工作区卡片（比默认贴在卡片下方更高）
            anchorPosition: {
              // 菜单比卡片窄：补偿容器差值后水平居中
              x: (this.wsCardW - (this.wsMenuWidth() + 15)) / 2,
              // 垂直方向不再居中上浮：菜单顶贴着卡片顶向下展开，整体位置更低
              y: 0
            },
            onWillDisappear: () => {
              this.wsMenuOpen = false;
            },
            onDisappear: () => {
              this.wsMenuOpen = false;
            },
            onDidDisappear: () => {
              this.wsMenuOpen = false;
            }
          })
          .opacity(this.wsMenuOpen ? 0 : 1)
          .hitTestBehavior(this.wsMenuOpen ? HitTestMode.None : HitTestMode.Default)

          // ── 新建会话 ──
          Row() {
            // plus-circle：24vp 玻璃圆（48rpx）
            Row() {
              Text('＋')
                .fontSize(15) // 30rpx 图标（对齐小程序 .plus-img）
                .fontColor('#FFFFFF')
            }
            .width(28)
            .height(28)
            .borderRadius(14)
            .justifyContent(FlexAlign.Center)
            .backgroundEffect({ radius: 1.5, saturation: 1, brightness: 1 })
            .backgroundColor('rgba(255,255,255,0.07)')
            .border({ width: 1, color: 'rgba(255,255,255,0.20)' })
            .margin({ right: 11 })
            Text(this.creating ? '正在新建…' : '新建会话')
              .fontSize(15) // 30rpx（对齐小程序 .new-session-text）
              .fontWeight(FontWeight.Bold)
              .fontColor('#FFFFFF')
          }
          .width('100%')
          .justifyContent(FlexAlign.Center)
          .padding({ top: 10.5, bottom: 10.5 })
          .borderRadius(19)
          .border({ width: 1, color: 'rgba(255,255,255,0.38)' })
          .backgroundEffect({ radius: 1.5, saturation: 1, brightness: 1 })
          .linearGradient({
            angle: 165,
            colors: [['rgba(255,255,255,0.06)', 0], ['rgba(255,255,255,0.015)', 1]]
          })
          .shadow({ radius: 16, color: 'rgba(3,14,30,0.18)', offsetY: 4 })
          .enabled(!this.creating)
          .opacity(this.creating ? 0.6 : 1)
          .margin({ top: 21, bottom: 21 })
          .onClick(() => {
            this.createSession();
          })

          if (this.createHint.length > 0) {
            Text(this.createHint)
              .fontSize(12)
              .fontColor('#FF6B60')
              .width('100%')
              .margin({ bottom: 10 })
          }

          // ── 最近会话 ──
          Row() {
            Text('最近会话')
              .fontSize(14)
              .fontWeight(FontWeight.Medium)
              .fontColor('#FFFFFF')
            Blank()
            Text(this.statusText())
              .fontSize(12)
              .fontColor(this.statusColor())
          }
          .width('100%')
          .margin({ bottom: 12 })

          // ── 搜索条 ──
          Row({ space: 8 }) {
            Image($r('app.media.search_white_thin'))
              .width(20)
              .height(20)
              .objectFit(ImageFit.Contain)
              .opacity(0.68)
            TextInput({ text: this.search, placeholder: '搜索会话内容' })
              .caretStyle({ width: 1 })
              .fontSize(16)
              .fontColor('rgba(255,255,255,0.92)')
              .placeholderColor('rgba(255,255,255,0.58)')
              .backgroundColor(Color.Transparent)
              .padding(0)
              .height('100%')
              .layoutWeight(1)
              .onChange((value: string) => {
                this.search = value;
              })
          }
          .width('100%')
          .height(42)
          .padding({ left: 12, right: 12 })
          .borderRadius(13)
          .border({ width: 1, color: 'rgba(255,255,255,0.15)' })
          .backgroundEffect({ radius: 1.5, saturation: 1, brightness: 1 })
          .linearGradient({
            angle: 165,
            colors: [['rgba(255,255,255,0.05)', 0], ['rgba(255,255,255,0.012)', 1]]
          })
          .margin({ bottom: 14 })

          // ── 会话列表（对齐小程序 .session-list / .session-row / .session-section）──
          if (this.filtered().length === 0) {
            Text(this.sessions.length === 0 ? '暂无会话' : '没有匹配的会话')
              .fontSize(15)
              .fontColor('rgba(255,255,255,0.5)')
              .width('100%')
              .textAlign(TextAlign.Start)
              .padding(18)
              .borderRadius(15)
              .backgroundColor('rgba(255,255,255,0.04)')
              .margin({ bottom: 8 })
          } else if (this.wsFilter === 'all') {
            // 全部会话：按工作区分区，未分组排最后，每区默认只显示 5 条
            ForEach(this.sessionSections(), (sec: SessionSection, si: number) => {
              Column() {
                Row({ space: 10 }) {
                  Text(sec.title)
                    .fontSize(12)
                    .fontColor('rgba(255,255,255,0.55)')
                    .maxLines(1)
                    .textOverflow({ overflow: TextOverflow.Ellipsis })
                    .constraintSize({ maxWidth: '55%' })
                  // 与会话行分割线一致：0.5vp / rgba(255,255,255,0.10)
                  Row()
                    .layoutWeight(1)
                    .height(0.5)
                    .backgroundColor('rgba(255,255,255,0.10)')
                  Text(sec.rows.length + ' 个会话')
                    .fontSize(11)
                    .fontColor('rgba(255,255,255,0.55)')
                    .margin({ left: 10 })
                }
                .width('100%')
                .alignItems(VerticalAlign.Center)
                .padding({ bottom: 8 })
                .margin({ top: si === 0 ? 8 : 24 })
                ForEach(sec.shown, (item: SessionSummary, index: number) => {
                  this.sessionRow(item, sec.lastSection && sec.toggleLabel.length === 0 && index === sec.shown.length - 1)
                }, (item: SessionSummary) => this.sessionKey(item))
                if (sec.toggleLabel.length > 0) {
                  this.sessionToggle(sec.toggleLabel, sec.expanded, sec.id)
                }
              }
              .width('100%')
            }, (sec: SessionSection) => this.sectionKey(sec))
          } else {
            // 最近会话 / 单个工作区：默认只显示 12 条
            ForEach(this.recentRows(), (item: SessionSummary, index: number) => {
              this.sessionRow(item, this.filtered().length <= SESSION_RECENT_LIMIT && index === this.recentRows().length - 1)
            }, (item: SessionSummary) => this.sessionKey(item))
            if (this.filtered().length > SESSION_RECENT_LIMIT) {
              this.sessionToggle(this.recentExpanded ? '收起' : ('展开其余 ' + (this.filtered().length - SESSION_RECENT_LIMIT) + ' 个会话'), this.recentExpanded, '')
            }
          }
          }
          .width('100%')
          // 内容不足一屏时也保持顶部对齐（否则 Scroll 会把短内容垂直居中）
          .constraintSize({ minHeight: '100%' })
          .padding({ left: 22, right: 22, top: (this.safeTopStorage > 0 ? this.safeTopStorage : 38.9) + 14, bottom: (this.safeBottomStorage > 0 ? this.safeBottomStorage : 28) + 12 })
          }
          .width('100%')
          .height('100%')
          .scrollBar(BarState.Off)
          .edgeEffect(EdgeEffect.Spring)

          // 抽屉遮罩：压在内容层内部，点击收回（对齐小程序 .drawer-mask，必须留在本层才能贴合圆角）
          if (this.drawerOpen) {
            Column()
              .width('100%')
              .height('100%')
              .backgroundColor('rgba(0,0,0,0.16)')
              .onClick(() => {
                this.drawerOpen = false;
              })
          }
        }
        .width('100%')
        // 侧栏展开时上下缩小：高度减去上下各一份内缩，再整体下移一份，保证上下留白一致
        .height(this.drawerOpen ? ('calc(100% - ' + (this.drawerInsetVp() * 2) + 'vp)') : '100%')
        // 左上/左下圆角 + clip：小程序 contentCornerRadius 为 48（单位 px≈vp），非 rpx
        .borderRadius({ topLeft: this.drawerOpen ? 48 : 0, bottomLeft: this.drawerOpen ? 48 : 0 })
        .clip(true)
        .translate({ x: this.drawerShift(), y: this.drawerInsetVp() })
        .animation({ duration: 320, curve: Curve.FastOutSlowIn })
        // 首页横向手势：右滑打开左侧栏，左滑打开会话设置（只吃横向滑动，避免抢走 Scroll 的竖向手势）
        .gesture(
          PanGesture({ fingers: 1, direction: PanDirection.Horizontal, distance: 12 })
            .onActionEnd((event: GestureEvent) => {
              this.onHomeSwipeEnd(event);
            })
        )

        // ── 以下浮层必须留在根层：跟随内容层会被 translate/clip 影响 ──
        // 会话长按菜单的锚点：固定在屏幕正中，系统菜单从这里展开，因此居中显示
        Column()
          .width(1)
          .height(1)
          .position({ x: this.menuAnchorX(), y: this.menuAnchorY() })
          .bindMenu(this.sessionMenuOpen, this.sessionActionMenu(), {
            placement: Placement.BottomLeft,
            onWillDisappear: () => {
              this.sessionMenuOpen = false;
            },
            onDisappear: () => {
              this.sessionMenuOpen = false;
            }
          })
        if (this.renameSessionOpen) {
          this.renameSessionAlert()
        }
        if (this.archiveSessionOpen) {
          this.archiveSessionAlert()
        }

      }
      .width('100%')
      .height('100%')
      // 抽屉打开时根层为白色：圆角裁开处透出白色，才能看出圆角（对齐小程序 .home-root #FFFFFF）
      .backgroundColor(this.drawerOpen ? (this.isDark ? '#181A1F' : '#FFFFFF') : this.bg())
      .expandSafeArea([SafeAreaType.SYSTEM], [SafeAreaEdge.TOP, SafeAreaEdge.BOTTOM])
      // 系统半模态：ImmersiveMaterial（沉浸光感）+ 空间动效；不支持时回退半透明底
      .bindSheet($$this.hostSheetOpen, this.hostSheetContent(), {
        height: '65%',
        dragBar: false,
        showClose: false,
        preferType: SheetType.BOTTOM,
        backgroundColor: this.immersiveSupported() ? Color.Transparent : (this.isDark ? '#2E2E2E' : '#F7F8FA'),
        systemMaterial: this.hostSheetMaterial(),
        onDisappear: () => {
          this.hostEditMode = false;
          this.hostSelectedIds = [];
          this.editingGatewayId = '';
          this.hostEditOpen = false;
          this.hostDeleteOpen = false;
        }
      })
    }
    .hideTitleBar(true)
    .onShown(() => {
      // 回到首页：登记可见并重写白字
      this.applyStatusBarWhite();
    })
    .onHidden(() => {
      // 压栈到别的页面：颜色由路由回调 didShow 决定（浅色页面需要黑字），这里只做兜底刷新
      StatusBarStyle.refresh();
    })
    .backgroundColor(this.drawerOpen ? (this.isDark ? '#181A1F' : '#FFFFFF') : this.bg())
    .expandSafeArea([SafeAreaType.SYSTEM], [SafeAreaEdge.TOP, SafeAreaEdge.BOTTOM])
    // 添加工作区：系统半模态 + 沉浸材质（与切换主机一致）
    .bindSheet($$this.dirSheetOpen, this.dirSheetContent(), {
      height: '82%',
      dragBar: false,
      showClose: false,
      preferType: SheetType.BOTTOM,
      backgroundColor: this.immersiveSupported() ? Color.Transparent : (this.isDark ? '#2E2E2E' : '#F7F8FA'),
      systemMaterial: this.hostSheetMaterial(),
      onDisappear: () => {
        this.closeDirSheet();
      }
    })
    // 设备认证：系统半模态（与「切换主机」同款材质与空间动效）
    .bindSheet($$this.manualSheetOpen, this.manualSheetOverlay(), {
      height: '58%',
      dragBar: false,
      showClose: false,
      preferType: SheetType.BOTTOM,
      backgroundColor: this.immersiveSupported() ? Color.Transparent : (this.isDark ? '#2E2E2E' : '#F7F8FA'),
      systemMaterial: this.hostSheetMaterial(),
      onDisappear: () => {
        this.manualHint = '';
      }
    })
  }

  private createSession(): void {
    this.creating = true;
    this.createHint = '';
    GatewayClient.get().createSession('').then((id: string) => {
      this.creating = false;
      SessionStore.get().open(id);
      openSessionRoute(this.pageStack);
    }).catch((error: Error) => {
      this.creating = false;
      this.createHint = error.message.length > 0 ? error.message : '创建会话失败';
    });
  }
}
