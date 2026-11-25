/**
 * 主机切换条（HostSwitcherBar）
 *
 * 把工作模式首页的「主机行」整块抽成自包含可复用组件，供 Bot 模式首页直接使用：
 *   主机胶囊（Tailscale 标记 + 电脑/服务器图标 + 主机名 + 状态点 + 下拉箭头）
 *   + 配对圆形玻璃钮（点击弹出配对菜单：扫码 / 手动输入 / 配置引导）
 *   + 设置圆形玻璃钮（打开会话设置）
 *   + 切换主机半模态（列表 / 编辑备注 / 多选删除 / 切换连接）
 *   + 设备认证半模态（手动粘贴配对信息，配对菜单第二项打开）
 *
 * 组件自包含：除 import 外不引用 HomePage 的任何成员；所有状态与 @Builder 都在本组件内。
 * 对外零回调，只有两个入参（isDark / compact）。跨页共享的连接状态走 AppStorage。
 *
 * 来源：pages/HomePage.ets
 *   L3648-3761  主机行 UI（胶囊 + 配对钮 + 设置钮）
 *   L618-670    hostGlyph / serverGlyph
 *   L672-861    scanGlyph / scanFinder / 菜单行 / menuRow
 *   L2155-2206  pairMenuWidth / pairMenuAnchorX / pairMenuBuilder
 *   L2208-2534  hostSheetContent（列表 / 编辑 / 删除 / 切换主机）
 *   L2613-2780  scanPairingNow / manualSheetOverlay / pastePairingText / connectManual
 *   L2782-2961  hostLinkKind / isLanEndpoint / hostLinkLabel / hostPillDotColor / 各配色
 *   L3058-3307  refreshSavedHosts / hostPillLabel / saveHostAlias / distinctHosts /
 *               savedHostName / savedHostKind / savedHostSubLabel / toggleHostSelected /
 *               deleteSelectedHosts / duplicateIdsFor
 *   L3852-3866  hostSheet 的 bindSheet 参数（height 65% / 沉浸材质 / onDisappear 复位）
 *   L3892-3902  manualSheet 的 bindSheet 参数（height 58% / 沉浸材质）
 *
 * Bot 模式浅色适配（仅 compact + 浅色生效，工作模式与深色模式 100% 沿用 HomePage 原样式）：
 *   工作模式首页是深海深色底，胶囊/圆钮按白色半透明玻璃设计；Bot 模式浅色是浅紫底，
 *   白色 8% 底 + 白色图标会「发白」看不见，因此：
 *     圆钮底 rgba(255,255,255,0.08) → rgba(255,255,255,0.55)，描边 0.24 白 → rgba(37,35,50,0.12)，
 *     胶囊底 0.05 白 → 0.55 白、描边 0.20 白 → rgba(37,35,50,0.12)，
 *   并把白色 SVG 图标（person_key_white / sliders_white / chev_down_white）用 colorFilter 染深墨，
 *   文字与自绘图标改 #252332（Bot 主题深墨色），未连接状态点改 rgba(37,35,50,0.45)。
 */
import { common } from '@kit.AbilityKit';
import { pasteboard } from '@kit.BasicServicesKit';
import { display, uiMaterial } from '@kit.ArkUI';
import { scanBarcode, scanCore } from '@kit.ScanKit';
import { TailscaleMarkView } from './TailscaleMarkView';
import {
  GatewayClient, PairingResult, PreferencesStore, parsePairingPayload, SavedGateway
} from 'nativecore';

@Component
export struct HostSwitcherBar {
  // ==================== 对外 API（只有这两个入参）====================
  /** 深色模式：由父页传入（工作模式取 isDark，Bot 模式取 AppStorage 的 isDark） */
  @Prop isDark: boolean = false;
  /**
   * 紧凑模式：仅供 Bot 模式首页使用。
   * true 时左右内边距为 0（由父级 Column 的 padding 控制）且不追加工作首页的 24vp 底部间距；
   * 视觉与工作首页完全一致（胶囊高 49、两枚 49 圆钮、圆钮间距 10.6）。
   */
  @Prop compact: boolean = false;

  // ==================== 跨页共享状态（AppStorage，键名与 HomePage 一致）====================
  @StorageLink('connectionState') @Watch('onConnectionChanged') connection: string = 'disconnected';
  @StorageLink('gatewayName') gatewayName: string = '';
  @StorageLink('hostAlias') hostAlias: string = '';
  /** 网关判定保存的设备凭据失效（握手 401）后置位：界面据此提示重新配对 */
  @StorageLink('gatewayCredentialRejected') credentialRejected: boolean = false;
  @StorageLink('transportKind') transportKind: string = '';
  @StorageLink('transportTailnet') transportTailnet: boolean = false;
  @StorageLink('tailscaleTunnelEnabled') tailscaleTunnelEnabled: boolean = false;
  @StorageLink('tailscaleStage') tailscaleStage: string = 'disabled';
  @StorageLink('keyboardHeightVp') keyboardHeightVp: number = 0;
  @StorageLink('safeBottomVp') safeBottomStorage: number = 0;

  /** 父页（HomePage / BotHomePage）提供的路由栈：设置钮与配置引导都靠它 */
  @Consume('pageStack') pageStack: NavPathStack;

  // ==================== 组件内部状态（原 HomePage 同名 @State）====================
  @State hostSheetOpen: boolean = false;
  @State hostEditMode: boolean = false;
  /** 编辑模式下勾选的主机 id（多选删除） */
  @State hostSelectedIds: string[] = [];
  /** 当前编辑表单对应的主机 id（空 = 编辑当前连接主机） */
  @State editingGatewayId: string = '';
  @State hostEditOpen: boolean = false;
  @State editAlias: string = '';
  @State editKind: string = 'desktop';
  @State kindMenuOpen: boolean = false;
  @State pairMenuOpen: boolean = false;
  /** 配对按钮屏幕左边缘（用于把菜单水平居中） */
  @State pairBtnX: number = 0;
  @State manualSheetOpen: boolean = false;
  @State manualText: string = '';
  @State manualHint: string = '';
  /**
   * 已保存主机快照（未连接时也要显示，见 refreshSavedHosts）。
   * 与 HomePage 的 @State 同名字段一致；不同页面各自持有一份，互不影响。
   */
  @State savedHosts: SavedGateway[] = [];

  private get safeBottom(): number {
    return this.safeBottomStorage > 0 ? this.safeBottomStorage : 20;
  }

  aboutToAppear(): void {
    this.refreshSavedHosts();
  }

  /** 连接状态变化：主机列表里的「当前主机 · 已连接」副标题与状态点要跟着刷新 */
  onConnectionChanged(): void {
    this.refreshSavedHosts();
  }

  // ==================== Bot 浅色适配（工作模式 / 深色模式走 else 分支，等同原样式）====================

  /** 是否启用 Bot 浅色配色：只有 compact + 浅色才需要（见文件头说明） */
  private botLight(): boolean {
    return this.compact && !this.isDark;
  }

  /**
   * 胶囊内文字/图标色：工作模式是纯白；Bot 浅紫底上用深墨，保证可读。
   */
  private pillInk(): string {
    return this.botLight() ? '#252332' : '#FFFFFF';
  }

  /**
   * 胶囊底色：与工作模式同款「近乎透明的玻璃」——工作模式是 5% 白，
   * Bot 浅底上等价换成 5% 墨，保留同样的通透感，而不是实心白胶囊。
   */
  private pillFill(): string {
    return this.botLight() ? 'rgba(37,35,50,0.05)' : 'rgba(255,255,255,0.05)';
  }

  /** 胶囊描边：与工作模式同比例（20%），Bot 浅底换成墨色描边 */
  private pillBorder(): string {
    return this.botLight() ? 'rgba(37,35,50,0.20)' : 'rgba(255,255,255,0.20)';
  }

  /** 圆形玻璃钮底：工作模式 8% 白 → Bot 浅底等价 8% 墨，保持玻璃通透 */
  private glassFill(): string {
    return this.botLight() ? 'rgba(37,35,50,0.06)' : 'rgba(255,255,255,0.08)';
  }

  // ==================== Chief 卡片同款（对齐 BotHomePage.glassHairline / glassShadow）====================
  /** 卡片发丝边：深 0.16 白 / 浅 0.90 白 */
  private cardHairline(): string {
    return this.isDark ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.90)';
  }

  /** 卡片投影：radius 14 / offsetY 6（只挂未裁剪外层） */
  private cardShadow(): ShadowOptions {
    return {
      radius: 14,
      color: this.isDark ? 'rgba(0,0,0,0.45)' : 'rgba(16,19,24,0.12)',
      offsetX: 0,
      offsetY: 6
    };
  }

  /** 圆形玻璃钮描边：工作模式 24% 白 → Bot 浅底 24% 墨 */
  private glassBorder(): string {
    return this.botLight() ? 'rgba(37,35,50,0.24)' : 'rgba(255,255,255,0.24)';
  }

  /** 圆钮内图标色：person_key_white / sliders_white 原图是白色，浅底必须染深墨 */
  private glassIconColor(): string {
    return this.botLight() ? '#252332' : '#FFFFFF';
  }

  /** Tailscale 九点标记的着色：浅底改深墨半透明 */
  private tailscaleTint(): string {
    return this.botLight() ? 'rgba(37,35,50,0.75)' : 'rgba(255,255,255,0.85)';
  }

  // ==================== 尺寸换算 ====================

  /** rpx → vp：小程序 750rpx = 屏宽，这里按同一比例换算字号/尺寸 */
  private rpx(value: number): number {
    try {
      const screenW: number = this.getUIContext().px2vp(display.getDefaultDisplaySync().width);
      return value * screenW / 750;
    } catch (err) {
      return value * 0.53;
    }
  }

  /**
   * 菜单行宽（对齐小程序 home.js 弹窗布局）：
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

  // ==================== 图标（iOS 风格自绘，尺寸随入参缩放）====================

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
      Column()
        .width(size * 0.90)
        .height(size * 0.76)
        .border({ width: 1.4, color: color })
        .borderRadius(size * 0.14)
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
      Circle({ width: size * 0.075, height: size * 0.075 }).fill(color).translate({ x: -size * 0.30, y: -size * 0.253 })
      Circle({ width: size * 0.075, height: size * 0.075 }).fill(color).translate({ x: -size * 0.30, y: 0 })
      Circle({ width: size * 0.075, height: size * 0.075 }).fill(color).translate({ x: -size * 0.30, y: size * 0.253 })
    }
    .width(size)
    .height(size)
  }

  /**
   * 扫描二维码图标：组件绘制（对齐小程序 .ico-scan）。
   * 不用 scan_white.svg：那份 SVG 依赖根节点 fill="none" 继承，ArkUI 会把取景框当成实心填充渲染。
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

  // ==================== 系统菜单行（对齐小程序 .ws-pop-row）====================

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
        .onClick(() => {
          this.editKind = 'desktop';
        })
      MenuItem(this.menuRow($r('app.media.server_white'), '服务器', this.editKind === 'server', this.wsMenuWidth()))
        .onClick(() => {
          this.editKind = 'server';
        })
    }
  }

  /** 配对菜单（系统 Menu 容器；行内图标/字号对齐小程序） */
  @Builder
  pairMenuBuilder() {
    Menu() {
      MenuItem(this.scanMenuRow('扫描二维码', this.pairMenuWidth()))
        .onClick(() => {
          this.pairMenuOpen = false;
          this.scanPairingNow();
        })
      MenuItem(this.menuRow($r('app.media.voice_keyboard'), '手动输入配对信息', false, this.pairMenuWidth()))
        .onClick(() => {
          this.pairMenuOpen = false;
          this.manualSheetOpen = true;
          this.manualHint = '';
        })
      MenuItem(this.menuRow($r('app.media.setup_guide_white'), '配置引导', false, this.pairMenuWidth()))
        .onClick(() => {
          this.pairMenuOpen = false;
          this.pageStack.pushPathByName('add-node', null);
        })
    }
  }

  // ==================== 切换主机半模态 ====================

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

  // ==================== 设备认证（手动配对）半模态 ====================

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

  // ==================== 主机数据（已保存主机快照与派生）====================

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
    // 活动主机的备注同步到旧 hostAlias 偏好：顶部胶囊仍从那里读
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

  // ==================== 连接方式 / 状态点 ====================

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
    const saved: SavedGateway[] = GatewayClient.get().savedGateways();
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

  /** 未连接时的状态点兜底色：工作模式沿用原「白 45%」；Bot 浅色改深墨 45%（否则浅紫底上看不见） */
  private statusColor(): string {
    if (this.connection === 'connected') {
      return '#34C759';
    }
    if (this.connection === 'connecting') {
      return '#FF9500';
    }
    return this.botLight() ? 'rgba(37,35,50,0.45)' : 'rgba(255,255,255,0.45)';
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

  // ==================== 沉浸材质 ====================

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

  // ==================== iOS 风格配色 ====================

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

  // ==================== 配对动作 ====================

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

  // ==================== 视图 ====================

  build() {
    Column() {
      Row() {
      // ── 主机胶囊：点击打开主机切换面板（外层固定 49 = 圆钮高度，保证垂直居中对齐）──
      Column() {
        Row({ space: 8 }) {
          if (this.tailscaleTunnelEnabled) {
            TailscaleMarkView({
              connected: this.tailscaleStage === 'ready',
              tint: this.tailscaleTint(),
              markSize: 18
            })
          }
          // 原首页这里跟的是「编辑表单当前类型」this.editKind（未编辑过时恒为 desktop），按原样照搬
          if (this.editKind === 'server') {
            this.serverGlyph(18, this.pillInk())
          } else {
            this.hostGlyph(18, this.pillInk())
          }
          Text(this.hostPillLabel())
            .fontSize(14)
            .fontColor(this.pillInk())
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
            .constraintSize({ maxWidth: 200 })
          Circle({ width: 8, height: 8 }).fill(this.hostPillDotColor())
          Image($r('app.media.chev_down_white'))
            .height(13)
            .colorFilter(this.iconTint(this.pillInk()))
        }
        .padding({ left: 12, right: 12, top: 7, bottom: 7 })
        // 与 Chief 卡片完全同款：透明底 + backdropBlur(10) + 1vp 发丝边 + 半径 21 + 卡片投影
        .backgroundColor(Color.Transparent)
        .backdropBlur(10)
        .clip(true)
        .borderRadius(21)
        .border({ width: 1, color: this.cardHairline() })
        .shadow(this.cardShadow())
        .onClick(() => {
          this.refreshSavedHosts();
          this.hostSheetOpen = true;
        })
      }
      .height(48)
      .justifyContent(FlexAlign.Center)

      Blank()

      // ── 配对（person-key）：玻璃圆钮 + 配对菜单 ──
      Stack({ alignContent: Alignment.TopEnd }) {
        Row() {
          Image($r('app.media.person_key_white'))
            .height(28)
            .objectFit(ImageFit.Contain)
            .colorFilter(this.iconTint(this.glassIconColor()))
        }
        .width(48)
        .height(48)
        .justifyContent(FlexAlign.Center)
        .onAreaChange((oldArea: Area, newArea: Area) => {
          const gx: number = Number(newArea.globalPosition.x);
          if (isFinite(gx) && gx > 0) {
            this.pairBtnX = gx;
          }
        })
        // 与 Chief 卡片完全同款：透明底 + backdropBlur(10) + 1vp 发丝边 + 半径 21 + 卡片投影
        .backgroundColor(Color.Transparent)
        .backdropBlur(10)
        .clip(true)
        .borderRadius(21)
        .border({ width: 1, color: this.cardHairline() })
        .shadow(this.cardShadow())
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

      // ── 设置：玻璃圆钮（打开会话设置）──
      Row() {
        Image($r('app.media.sliders_white'))
          .height(23)
          .objectFit(ImageFit.Contain)
          .colorFilter(this.iconTint(this.glassIconColor()))
      }
      .width(48)
      .height(48)
      .justifyContent(FlexAlign.Center)
      // 与 Chief 卡片完全同款
      .backgroundColor(Color.Transparent)
      .backdropBlur(10)
      .clip(true)
      .borderRadius(21)
      .border({ width: 1, color: this.cardHairline() })
      .shadow(this.cardShadow())
      .margin({ left: 10.6 })
      .onClick(() => {
        this.pageStack.pushPathByName('session-settings', null);
      })
    }
    .width('100%')
    .alignItems(VerticalAlign.Center)
    // compact（Bot 模式）时左右内边距与底部间距都交给父级；工作模式保留首页的 24vp 行距
    .padding({ left: 0, right: 0 })
    .margin({ top: 0, bottom: this.compact ? 0 : 24 })
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
    .width('100%')
    // 切换主机半模态：挂在行外层容器上（ArkUI 同一节点不能同时挂两个 bindSheet，否则后者会覆盖前者）
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
      }
    })
  }
}
