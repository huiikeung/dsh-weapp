import { common } from '@kit.AbilityKit';
import { pasteboard } from '@kit.BasicServicesKit';
import { display, KeyboardAvoidMode } from '@kit.ArkUI';
import { scanBarcode, scanCore } from '@kit.ScanKit';
import {
  GatewayClient, OceanBackground, PairingResult, PreferencesStore, SessionStore, SessionSummary,
  DirEntry, WorkspaceRow, parsePairingPayload
} from 'nativecore';

@Component
export struct HomePage {
  @StorageLink('isDark') isDark: boolean = false;
  @StorageLink('connectionState') connection: string = 'disconnected';
  @StorageLink('sessions') sessions: SessionSummary[] = [];
  @StorageLink('gatewayName') gatewayName: string = '';
  @State creating: boolean = false;
  @State createHint: string = '';
  @State search: string = '';
  @State drawerOpen: boolean = false;
  @State pairMenuOpen: boolean = false;
  @State pairMenuScale: number = 0.86;
  @State manualSheetOpen: boolean = false;
  @State manualText: string = '';
  @State manualHint: string = '';
  @StorageLink('keyboardHeightVp') keyboardHeightVp: number = 0;
  @State hostSheetOpen: boolean = false;
  @State hostEditMode: boolean = false;
  @State hostSelected: boolean = false;
  @State hostEditOpen: boolean = false;
  @State editAlias: string = '';
  @State editKind: string = 'desktop';
  @State kindMenuOpen: boolean = false;
  @State kindRowY: number = 0;
  @State wsMenuOpen: boolean = false;
  @State wsFilter: string = 'all';
  @State wsCardY: number = 0;
  @State wsCardH: number = 0;
  @State dirSheetOpen: boolean = false;
  @State dirError: string = '';
  @State newFolderOpen: boolean = false;
  @State newFolderName: string = '';
  @StorageLink('dirEntries') dirEntries: DirEntry[] = [];
  @StorageLink('dirCurrent') dirCurrent: string = '';
  @StorageLink('workspaces') workspaces: WorkspaceRow[] = [];
  @StorageLink('hostAlias') hostAlias: string = '';
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
    return this.isDark ? '#141518' : '#FFFFFF';
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

  /** 弹窗以工作区卡片中心为中心（对齐 workspacePopoverLayout） */
  private wsOffsetY(): number {
    const screenH: number = this.getUIContext().px2vp(display.getDefaultDisplaySync().height);
    const cardCenter: number = this.wsCardY + this.wsCardH / 2;
    return cardCenter - screenH / 2;
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

  private sessionMeta(item: SessionSummary): string {
    return item.id.substring(0, 8);
  }


  /** 扫描二维码图标：15×15 等比设计（四角外沿 + 三个定位框 + 右下四个圆点） */
  @Builder
  scanIcon() {
    Stack() {
      // 四角（只留外沿）
      Column().width(4.6).height(4.6)
        .borderWidth({ left: 1.1, top: 1.1 }).borderColor('#FFFFFF')
        .borderRadius({ topLeft: 2.1 })
        .position({ x: 0, y: 0 })
      Column().width(4.6).height(4.6)
        .borderWidth({ right: 1.1, top: 1.1 }).borderColor('#FFFFFF')
        .borderRadius({ topRight: 2.1 })
        .position({ x: 10.4, y: 0 })
      Column().width(4.6).height(4.6)
        .borderWidth({ left: 1.1, bottom: 1.1 }).borderColor('#FFFFFF')
        .borderRadius({ bottomLeft: 2.1 })
        .position({ x: 0, y: 10.4 })
      Column().width(4.6).height(4.6)
        .borderWidth({ right: 1.1, bottom: 1.1 }).borderColor('#FFFFFF')
        .borderRadius({ bottomRight: 2.1 })
        .position({ x: 10.4, y: 10.4 })
      // 三个定位方框
      this.scanFind(2.9, 2.9)
      this.scanFind(7.9, 2.9)
      this.scanFind(2.9, 7.9)
      // 右下四个圆点（与定位框同栅格）
      Circle({ width: 1.85, height: 1.85 }).fill('#FFFFFF').position({ x: 7.9, y: 7.9 })
      Circle({ width: 1.85, height: 1.85 }).fill('#FFFFFF').position({ x: 10.25, y: 7.9 })
      Circle({ width: 1.85, height: 1.85 }).fill('#FFFFFF').position({ x: 7.9, y: 10.25 })
      Circle({ width: 1.85, height: 1.85 }).fill('#FFFFFF').position({ x: 10.25, y: 10.25 })
    }
    .width(15)
    .height(15)
  }

  @Builder
  scanFind(x: number, y: number) {
    Stack() {
      Column().width(4.2).height(4.2)
        .border({ width: 0.9, color: '#FFFFFF' })
        .borderRadius(0.9)
      Circle({ width: 1.25, height: 1.25 }).fill('#FFFFFF')
    }
    .width(4.2)
    .height(4.2)
    .position({ x: x, y: y })
  }

  /** 配对菜单项 */
  @Builder
  pairMenuItem(kind: string, label: string) {
    Row({ space: 7 }) {
      if (kind === 'scan') {
        this.scanIcon()
      } else if (kind === 'keyboard') {
        Image($r('app.media.voice_keyboard')).width(18).height(18).objectFit(ImageFit.Contain)
      } else {
        Image($r('app.media.setup_guide_white')).width(18).height(18).objectFit(ImageFit.Contain)
      }
      Text(label)
        .fontSize(17)
        .fontWeight(FontWeight.Medium)
        .fontColor('#FFFFFF')
        .layoutWeight(1)
    }
    .width('100%')
    .height(58)
    .padding({ left: 22, right: 22 })
    .onClick(() => {
      this.pairMenuOpen = false;
      if (kind === 'scan') {
        this.scanPairingNow();
      } else if (kind === 'keyboard') {
        this.manualSheetOpen = true;
        this.manualHint = '';
      } else {
        this.pageStack.pushPathByName('add-node', null);
      }
    })
  }

  @Builder
  kindMenuItem(kind: string, label: string) {
    Row({ space: 6 }) {
      Row() {
        if (this.editKind === kind) {
          Image($r('app.media.check_white')).width(13).height(13).objectFit(ImageFit.Contain)
        }
      }
      .width(16)
      if (kind === 'server') {
        Image($r('app.media.server_white')).width(15).height(15).objectFit(ImageFit.Contain)
      } else {
        Image($r('app.media.host_desktop_white')).width(15).height(15).objectFit(ImageFit.Contain)
      }
      Text(label)
        .fontSize(15)
        .fontColor('#FFFFFF')
        .layoutWeight(1)
    }
    .width('100%')
    .height(44)
    .padding({ left: 10, right: 10 })
    .onClick(() => {
      this.editKind = kind;
      this.kindMenuOpen = false;
    })
  }

  @Builder
  kindMenuOverlay() {
    Stack({ alignContent: Alignment.TopEnd }) {
      Column()
        .width('100%')
        .height('100%')
        .backgroundColor(Color.Transparent)
        .onClick(() => {
          this.kindMenuOpen = false;
        })
      Column() {
        this.kindMenuItem('desktop', '电脑')
        this.kindMenuItem('server', '服务器')
      }
      .width(160)
      .borderRadius(14)
      .padding({ top: 5, bottom: 5 })
      .backgroundEffect({ radius: 10, saturation: 1.2, brightness: 1 })
      .backgroundColor('rgba(10,14,24,0.30)')
      .linearGradient({
        angle: 165,
        colors: [['rgba(255,255,255,0.10)', 0], ['rgba(255,255,255,0.04)', 1]]
      })
      .border({ width: 1, color: 'rgba(255,255,255,0.12)' })
      .shadow({ radius: 24, color: 'rgba(0,0,0,0.30)', offsetY: 8 })
      .margin({ top: this.kindRowY + 44, right: 28 })
    }
    .width('100%')
    .height('100%')
  }

  /** 工作区选择弹窗（对齐小程序 .ws-pop） */
  /** 添加工作区：目录浏览弹层（对齐小程序 openDirSheet） */
  @Builder
  dirSheetOverlay() {
    Stack({ alignContent: Alignment.Bottom }) {
      Column()
        .width('100%')
        .height('100%')
        .backgroundColor('rgba(0,0,0,0.55)')
        .onClick(() => {
          this.dirSheetOpen = false;
        })
      Column({ space: 0 }) {
        Column() {
          Column().width(36).height(4).borderRadius(2).backgroundColor('rgba(255,255,255,0.28)')
        }
        .width('100%')
        .height(14)
        .justifyContent(FlexAlign.Center)

        Row() {
          Text('添加工作区')
            .fontSize(17)
            .fontWeight(FontWeight.Bold)
            .fontColor('#FFFFFF')
          Blank()
          Text('✕')
            .fontSize(16)
            .fontColor('rgba(255,255,255,0.75)')
            .onClick(() => {
              this.dirSheetOpen = false;
            })
        }
        .width('100%')
        .height(44)
        .alignItems(VerticalAlign.Center)

        Text(this.dirCurrent.length > 0 ? this.dirCurrent : '选择要添加为工作区的目录')
          .fontSize(12)
          .fontColor('rgba(255,255,255,0.55)')
          .maxLines(2)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .width('100%')
          .margin({ bottom: 8 })

        List({ space: 2 }) {
          ForEach(this.dirEntries, (entry: DirEntry) => {
            ListItem() {
              Row({ space: 10 }) {
                Image($r('app.media.workspace_folder_white'))
                  .width(16)
                  .height(16)
                  .objectFit(ImageFit.Contain)
                Text(entry.name)
                  .fontSize(14)
                  .fontColor('#FFFFFF')
                  .maxLines(1)
                  .textOverflow({ overflow: TextOverflow.Ellipsis })
                  .layoutWeight(1)
              }
              .width('100%')
              .height(40)
              .padding({ left: 8, right: 8 })
              .borderRadius(8)
              .onClick(() => {
                GatewayClient.get().requestDirectories(entry.path);
              })
            }
          }, (entry: DirEntry) => entry.path)
        }
        .width('100%')
        .height(200)
        .scrollBar(BarState.Off)

        if (this.dirError.length > 0) {
          Text(this.dirError).fontSize(12).fontColor('#FF6B60').width('100%')
        }

        Row({ space: 10 }) {
          Button('新建文件夹')
            .layoutWeight(1)
            .height(42)
            .fontSize(14)
            .fontColor('#FFFFFF')
            .backgroundColor('rgba(255,255,255,0.10)')
            .onClick(() => {
              this.newFolderOpen = true;
            })
          Button('添加此目录')
            .layoutWeight(1)
            .height(42)
            .fontSize(14)
            .fontColor('#FFFFFF')
            .backgroundColor('#2E6BE6')
            .enabled(this.dirCurrent.length > 0)
            .opacity(this.dirCurrent.length > 0 ? 1 : 0.5)
            .onClick(() => {
              if (this.dirCurrent.length === 0) {
                return;
              }
              GatewayClient.get().createWorkspace(this.dirCurrent);
              this.dirSheetOpen = false;
            })
        }
        .width('100%')
        .margin({ top: 10 })

        if (this.newFolderOpen) {
          Row({ space: 8 }) {
            TextInput({ text: this.newFolderName, placeholder: '文件夹名称' })
              .caretStyle({ width: 1 })
              .layoutWeight(1)
              .height(40)
              .fontSize(13)
              .fontColor('#FFFFFF')
              .placeholderColor('rgba(255,255,255,0.35)')
              .backgroundColor('rgba(255,255,255,0.08)')
              .borderRadius(10)
              .onChange((value: string) => {
                this.newFolderName = value;
              })
            Button('创建')
              .height(40)
              .fontSize(14)
              .backgroundColor('#2E6BE6')
              .onClick(() => {
                const name: string = this.newFolderName.trim();
                if (name.length === 0) {
                  this.dirError = '请输入文件夹名称';
                  return;
                }
                GatewayClient.get().createDirectory(this.dirCurrent, name);
                this.newFolderName = '';
                this.newFolderOpen = false;
              })
          }
          .width('100%')
          .margin({ top: 10 })
        }
      }
      .width('calc(100% - 24vp)')
      .constraintSize({ maxHeight: '70%' })
      .padding({ left: 14, right: 14, bottom: 20 })
      .borderRadius(18)
      .backgroundEffect({ radius: 4, saturation: 1, brightness: 1 })
      .linearGradient({
        angle: 165,
        colors: [['rgba(255,255,255,0.10)', 0], ['rgba(255,255,255,0.04)', 1]]
      })
      .border({ width: 1, color: 'rgba(255,255,255,0.38)' })
      .shadow({ radius: 24, color: 'rgba(3,14,30,0.26)', offsetY: 6 })
      .margin({ bottom: 24 })
    }
    .width('100%')
    .height('100%')
  }

  /** 左侧栏（对齐小程序 drawer：品牌 + 插件 / 自动化任务 + 额度卡片 + 设置） */
  @Builder
  drawerOverlay() {
    Stack({ alignContent: Alignment.TopStart }) {
      // 遮罩
      Column()
        .width('100%')
        .height('100%')
        .backgroundColor('rgba(0,0,0,0.45)')
        .onClick(() => {
          this.drawerOpen = false;
        })

      // 面板
      Column() {
        // 品牌
        Row({ space: 6 }) {
          Image($r('app.media.whale_ink')).width(29).height(29).objectFit(ImageFit.Contain)
          Image($r('app.media.wordmark_ink')).width(76).objectFit(ImageFit.Contain)
          Text('HARNESS')
            .fontSize(9.5)
            .fontWeight(FontWeight.Bold)
            .fontColor('#10151F')
            .backgroundColor('#FFFFFF')
            .borderRadius(4)
            .height(15)
            .padding({ left: 6, right: 6 })
        }
        .width('100%')
        .padding({ left: 12, bottom: 16 })

        // 插件
        this.drawerItem($r('app.media.pinwheel_ink'), '插件', 'plugins')
        // 自动化任务
        this.drawerItem($r('app.media.automation_ink'), '自动化任务', 'schedule')

        Blank()

        // 额度卡片（未连接时展示提示）
        Column({ space: 3 }) {
          Text(this.connection === 'connected' ? '用量额度' : '额度卡片未连接到网关')
            .fontSize(13)
            .fontWeight(FontWeight.Medium)
            .fontColor('#101318')
          Text(this.connection === 'connected' ? '点击查看用量明细' : '点此重新连接')
            .fontSize(10.5)
            .fontColor('rgba(16,19,24,0.55)')
        }
        .width('100%')
        .padding(11)
        .borderRadius(10)
        .border({ width: 1, color: 'rgba(122,142,175,0.16)' })
        .backgroundColor('rgba(116,133,161,0.07)')
        .alignItems(HorizontalAlign.Start)
        .onClick(() => {
          this.drawerOpen = false;
          this.pageStack.pushPathByName('session-settings', null);
        })

        // 设置
        this.drawerItem($r('app.media.settings_ink'), '设置', 'app-settings')
      }
      .width('76%')
      .constraintSize({ maxWidth: 360 })
      .height('100%')
      .padding({ left: 18, right: 18, top: this.safeTop + 18, bottom: this.safeBottom + 12 })
      .backgroundColor('#FFFFFF')
      .alignItems(HorizontalAlign.Start)
    }
    .width('100%')
    .height('100%')
  }

  @Builder
  drawerItem(icon: Resource, label: string, route: string) {
    Row({ space: 10 }) {
      Image(icon).width(22).height(22).objectFit(ImageFit.Contain)
      Text(label)
        .fontSize(17)
        .fontColor('#101318')
        .layoutWeight(1)
    }
    .width('100%')
    .height(52)
    .padding({ left: 14, right: 14 })
    .borderRadius(12)
    .onClick(() => {
      this.drawerOpen = false;
      this.pageStack.pushPathByName(route, null);
    })
  }

  @Builder
  workspaceMenuOverlay() {
    Stack({ alignContent: Alignment.Center }) {
      Column()
        .width('100%')
        .height('100%')
        .backgroundColor('rgba(0,0,0,0.01)')
        .onClick(() => {
          this.wsMenuOpen = false;
        })
      Column({ space: 0 }) {
        // 全部会话
        this.wsRow('all', '全部会话', $r('app.media.all_sessions_white'))
        // 未分组
        this.wsRow('ungrouped', '未分组', $r('app.media.tray_white'))
        if (this.workspaces.length > 0) {
          Divider().color('rgba(255,255,255,0.14)').strokeWidth(1).margin({ left: 22, right: 22 })
        }
        ForEach(this.workspaces, (ws: WorkspaceRow) => {
          this.wsRow(ws.workspaceId, ws.title, $r('app.media.workspace_folder_white'))
        }, (ws: WorkspaceRow) => ws.workspaceId)
        Divider().color('rgba(255,255,255,0.14)').strokeWidth(1).margin({ left: 22, right: 22 })
        // 添加工作区
        Row({ space: 12 }) {
          Image($r('app.media.plus_white')).width(18).height(18).objectFit(ImageFit.Contain)
          Text('添加工作区')
            .fontSize(16)
            .fontColor('#FFFFFF')
            .layoutWeight(1)
        }
        .width('100%')
        .height(42)
        .padding({ left: 24, right: 24 })
        .onClick(() => {
          this.wsMenuOpen = false;
          this.dirSheetOpen = true;
          this.dirError = '';
          GatewayClient.get().requestDirectories('');
        })
      }
      .width('62.4%')
      .constraintSize({ minWidth: 224, maxWidth: 280 })
      .borderRadius(32)
      .padding({ top: 8, bottom: 8 })
      .backgroundEffect({ radius: 4, saturation: 1, brightness: 1 })
      .linearGradient({
        angle: 165,
        colors: [['rgba(255,255,255,0.10)', 0], ['rgba(255,255,255,0.04)', 1]]
      })
      .border({ width: 1, color: 'rgba(255,255,255,0.38)' })
      .shadow({ radius: 32, color: 'rgba(3,14,30,0.26)', offsetY: 10 })
      .translate({ y: this.wsOffsetY() })
    }
    .width('100%')
    .height('100%')
  }

  @Builder
  wsRow(id: string, label: string, icon: Resource) {
    Row({ space: 12 }) {
      if (this.wsFilter === id) {
        Image($r('app.media.check_fill_white')).width(18).height(18).objectFit(ImageFit.Contain)
      } else {
        Image(icon).width(18).height(18).objectFit(ImageFit.Contain)
      }
      Text(label)
        .fontSize(16)
        .fontColor('#FFFFFF')
        .maxLines(1)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
        .layoutWeight(1)
    }
    .width('100%')
    .height(42)
    .padding({ left: 24, right: 24 })
    .onClick(() => {
      this.wsFilter = id;
      this.wsMenuOpen = false;
    })
  }

  @Builder
  pairMenuOverlay() {
    Stack({ alignContent: Alignment.TopEnd }) {
      Column()
        .width('100%')
        .height('100%')
        .backgroundColor('rgba(0,0,0,0.18)')
        .onClick(() => {
          this.pairMenuOpen = false;
        })
      Column() {
        this.pairMenuItem('scan', '扫描二维码')
        this.pairMenuItem('keyboard', '手动输入配对信息')
        this.pairMenuItem('guide', '配置引导')
      }
      .width(248)
      .borderRadius(18)
      .padding({ top: 6, bottom: 6 })
      .scale({ x: this.pairMenuScale, y: this.pairMenuScale, centerX: '100%', centerY: '0%' })
      .opacity(this.pairMenuScale)
      .backgroundEffect({ radius: 4, saturation: 1, brightness: 1 })
      .backgroundColor('rgba(255,255,255,0.06)')
      .linearGradient({
        angle: 165,
        colors: [['rgba(255,255,255,0.10)', 0], ['rgba(255,255,255,0.04)', 1]]
      })
      .border({ width: 1, color: 'rgba(255,255,255,0.38)' })
      .shadow({ radius: 24, color: 'rgba(3,14,30,0.26)', offsetY: 8 })
      .margin({ top: this.rowY + this.rowH + 6, right: 73 })
    }
    .width('100%')
    .height('100%')
  }

  @Builder
  hostSheetOverlay() {
    Stack({ alignContent: Alignment.Bottom }) {
      Column()
        .width('100%')
        .height('100%')
        .backgroundColor('rgba(0,0,0,0.55)')
        .onClick(() => {
          this.hostSheetOpen = false;
          this.hostEditMode = false;
          this.hostSelected = false;
          this.hostEditOpen = false;
        })

      Column({ space: 0 }) {
        Column() {
          Column()
            .width(36)
            .height(4)
            .borderRadius(2)
            .backgroundColor('rgba(255,255,255,0.28)')
        }
        .width('100%')
        .height(14)
        .justifyContent(FlexAlign.Center)

        if (this.hostEditOpen) {
          // ── 编辑主机子页（对齐 .host-edit-*）──
          Row() {
            Text('取消')
              .fontSize(14)
              .fontColor('#FFFFFF')
              .padding({ left: 15, right: 15, top: 7, bottom: 7 })
              .borderRadius(999)
              .backgroundColor('rgba(255,255,255,0.10)')
              .border({ width: 1, color: 'rgba(255,255,255,0.24)' })
              .onClick(() => {
                this.hostEditOpen = false;
              })
            Blank()
            Text('编辑主机')
              .fontSize(17)
              .fontWeight(FontWeight.Bold)
              .fontColor('#FFFFFF')
            Blank()
            Text('保存')
              .fontSize(14)
              .fontWeight(FontWeight.Medium)
              .fontColor('#FFFFFF')
              .padding({ left: 15, right: 15, top: 7, bottom: 7 })
              .borderRadius(999)
              .backgroundColor('#2E6BE6')
              .onClick(() => {
                this.saveHostAlias();
              })
          }
          .width('100%')
          .height(48)
          .alignItems(VerticalAlign.Center)

          Text('留空使用网关提供的名称：' + (this.gatewayName.length > 0 ? this.gatewayName : '未命名'))
            .fontSize(12)
            .fontColor('rgba(255,255,255,0.45)')
            .width('100%')
            .padding({ left: 4, bottom: 10 })

          Column() {
            TextInput({ text: this.editAlias, placeholder: this.gatewayName })
              .caretStyle({ width: 1 })
              .fontSize(15)
              .fontColor('#FFFFFF')
              .placeholderColor('rgba(255,255,255,0.35)')
              .backgroundColor(Color.Transparent)
              .padding({ left: 14, right: 14, top: 14, bottom: 14 })
              .onChange((value: string) => {
                this.editAlias = value;
              })
            Divider().color('rgba(255,255,255,0.10)').strokeWidth(1)
            Row() {
              Text('主机类型')
                .fontSize(14)
                .fontColor('#FFFFFF')
              Blank()
              Row({ space: 6 }) {
                if (this.editKind === 'server') {
                  Image($r('app.media.server_white')).width(15).height(15).objectFit(ImageFit.Contain)
                } else {
                  Image($r('app.media.host_desktop_white')).width(15).height(15).objectFit(ImageFit.Contain)
                }
                Text(this.editKind === 'server' ? '服务器' : '电脑')
                  .fontSize(14)
                  .fontColor('#FFFFFF')
                Image($r('app.media.chev_down_white')).width(10).height(10)
              }
              .onClick(() => {
                this.kindMenuOpen = !this.kindMenuOpen;
              })
            }
            .width('100%')
            .height(48)
            .padding({ left: 14, right: 14 })
            .onAreaChange((oldValue: Area, newValue: Area) => {
              this.kindRowY = Number(newValue.globalPosition.y);
            })
            .width('100%')
          }
          .width('100%')
          .borderRadius(18)
          .backgroundColor('rgba(255,255,255,0.055)')
          .border({ width: 1, color: 'rgba(255,255,255,0.10)' })

          Blank()
        } else {
          // ── 主机列表 ──
          Row() {
            Text(this.hostEditMode ? '完成' : '编辑')
              .fontSize(14)
              .fontColor('#FFFFFF')
              .padding({ left: 15, right: 15, top: 7, bottom: 7 })
              .borderRadius(999)
              .backgroundColor('rgba(255,255,255,0.10)')
              .border({ width: 1, color: 'rgba(255,255,255,0.24)' })
              .onClick(() => {
                this.hostEditMode = !this.hostEditMode;
                if (!this.hostEditMode) {
                  this.hostSelected = false;
                }
              })
            Blank()
            Text('切换主机')
              .fontSize(17)
              .fontWeight(FontWeight.Bold)
              .fontColor('#FFFFFF')
            Blank()
            if (this.hostEditMode && this.hostSelected) {
              Text('删除')
                .fontSize(14)
                .fontColor('#FF6B60')
                .padding({ left: 15, right: 15, top: 7, bottom: 7 })
                .onClick(() => {
                  this.forgetHost();
                })
            } else {
              Row().width(60)
            }
          }
          .width('100%')
          .height(48)
          .alignItems(VerticalAlign.Center)

          Text('我的主机')
            .fontSize(14)
            .fontWeight(FontWeight.Medium)
            .fontColor('rgba(255,255,255,0.50)')
            .width('100%')
            .padding({ left: 4, top: 6, bottom: 8 })

          Column() {
            Row({ space: 10 }) {
              if (this.hostEditMode) {
                Image(this.hostSelected ? $r('app.media.circle_filled_white') : $r('app.media.circle_white'))
                  .width(20)
                  .height(20)
                  .objectFit(ImageFit.Contain)
                  .margin({ right: 9 })
                  .onClick(() => {
                    this.hostSelected = !this.hostSelected;
                  })
              }
              Image($r('app.media.host_desktop_white'))
                .height(22)
                .objectFit(ImageFit.Contain)
              Column({ space: 3 }) {
                Row({ space: 5 }) {
                  Text(this.hostDisplayName())
                    .fontSize(15)
                    .fontWeight(FontWeight.Medium)
                    .fontColor('#FFFFFF')
                    .maxLines(1)
                    .textOverflow({ overflow: TextOverflow.Ellipsis })
                  if (this.hostLinkLabel().length > 0) {
                    Text(this.hostLinkLabel())
                      .fontSize(9)
                      .fontWeight(FontWeight.Medium)
                      .fontColor(this.hostLinkColor())
                      .backgroundColor(this.hostLinkBg())
                      .border({ width: 1, color: this.hostLinkBorder() })
                      .borderRadius(999)
                      .padding({ left: 5, right: 5, top: 2, bottom: 2 })
                  }
                }
                .alignItems(VerticalAlign.Center)
                Text(this.connection === 'connected' ? '当前使用 · 在线' : '暂无已保存的主机，请扫码添加')
                  .fontSize(12)
                  .fontColor('rgba(255,255,255,0.45)')
              }
              .alignItems(HorizontalAlign.Start)
              .layoutWeight(1)
              Circle({ width: 7, height: 7 }).fill(this.statusColor())
              if (this.hostEditMode) {
                Row() {
                  Image($r('app.media.pencil_edit_white'))
                    .width(18)
                    .height(18)
                    .objectFit(ImageFit.Contain)
                }
                .width(30)
                .height(30)
                .justifyContent(FlexAlign.Center)
                .onClick(() => {
                  this.editAlias = this.hostAlias;
                  this.hostEditOpen = true;
                })
              }
            }
            .width('100%')
            .padding({ left: 14, right: 14, top: 13, bottom: 13 })
          }
          .width('100%')
          .borderRadius(18)
          .backgroundColor('rgba(255,255,255,0.055)')
          .border({ width: 1, color: 'rgba(255,255,255,0.10)' })

          Blank()
        }
      }
      .width('calc(100% - 24vp)')
      .constraintSize({ minHeight: '46%' })
      .padding({ left: 14, right: 14, bottom: 24 })
      .borderRadius(18)
      .backgroundEffect({ radius: 4, saturation: 1, brightness: 1 })
      .linearGradient({
        angle: 165,
        colors: [['rgba(255,255,255,0.10)', 0], ['rgba(255,255,255,0.04)', 1]]
      })
      .border({ width: 1, color: 'rgba(255,255,255,0.38)' })
      .shadow({ radius: 24, color: 'rgba(3,14,30,0.26)', offsetY: 6 })
      .margin({ bottom: 24 })
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
    Stack({ alignContent: Alignment.Bottom }) {
      Column()
        .width('100%')
        .height('100%')
        .backgroundColor('rgba(0,0,0,0.55)')
        .onClick(() => {
          this.manualSheetOpen = false;
        })

      Column({ space: 0 }) {
        Column() {
          Column().width(36).height(4).borderRadius(2).backgroundColor('rgba(255,255,255,0.28)')
        }
        .width('100%')
        .height(14)
        .justifyContent(FlexAlign.Center)

        Row() {
          Text('设备认证')
            .fontSize(17)
            .fontWeight(FontWeight.Bold)
            .fontColor('#FFFFFF')
          Blank()
          Text('✕')
            .fontSize(16)
            .fontColor('rgba(255,255,255,0.75)')
            .onClick(() => {
              this.manualSheetOpen = false;
            })
        }
        .width('100%')
        .height(44)
        .alignItems(VerticalAlign.Center)

        if (this.keyboardHeightVp <= 0) {
          Text('粘贴 Harness WebUI 提供的配对信息即可连接；长期设备 token 只会安全保存在本机。')
            .fontSize(12)
            .fontColor('rgba(255,255,255,0.55)')
            .width('100%')
            .margin({ bottom: 10 })
        }

        Column() {
          Row() {
            Text('配对信息')
              .fontSize(12)
              .fontColor('rgba(255,255,255,0.55)')
            Blank()
            Row({ space: 14 }) {
              Text('粘贴')
                .fontSize(12)
                .fontColor('#7BA7F5')
                .onClick(() => {
                  this.pastePairingText();
                })
              if (this.manualText.length > 0) {
                Text('清空')
                  .fontSize(12)
                  .fontColor('#7BA7F5')
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
            .fontColor('#FFFFFF')
            .placeholderColor('rgba(255,255,255,0.35)')
            .backgroundColor(Color.Transparent)
            .padding({ left: 12, right: 12, top: 6, bottom: 10 })
            .onChange((value: string) => {
              this.manualText = value;
            })
        }
        .width('100%')
        .borderRadius(16)
        .backgroundColor('rgba(255,255,255,0.06)')
        .border({ width: 1, color: 'rgba(255,255,255,0.12)' })

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
          .fontColor('#FFFFFF')
          .backgroundColor('#2E6BE6')
          .margin({ top: 12 })
          .enabled(this.manualText.trim().length > 0)
          .opacity(this.manualText.trim().length > 0 ? 1 : 0.5)
          .onClick(() => {
            this.connectManual();
          })
      }
      .width('calc(100% - 24vp)')
      .padding({ left: 14, right: 14, bottom: 20 })
      .borderRadius(18)
      .backgroundEffect({ radius: 4, saturation: 1, brightness: 1 })
      .linearGradient({
        angle: 165,
        colors: [['rgba(255,255,255,0.10)', 0], ['rgba(255,255,255,0.04)', 1]]
      })
      .border({ width: 1, color: 'rgba(255,255,255,0.38)' })
      .shadow({ radius: 24, color: 'rgba(3,14,30,0.26)', offsetY: 6 })
      .margin({ bottom: this.keyboardHeightVp > 0 ? this.keyboardHeightVp + 8 : 24 })
    }
    .width('100%')
    .height('100%')
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

  /** 配对菜单：从按钮右上角放大展开（对齐 .pair-menu 的 pair-menu-in） */
  private togglePairMenu(): void {
    if (this.pairMenuOpen) {
      this.pairMenuOpen = false;
      return;
    }
    this.pairMenuScale = 0.86;
    this.pairMenuOpen = true;
    setTimeout(() => {
      animateTo({ duration: 180, curve: Curve.Friction }, () => {
        this.pairMenuScale = 1;
      });
    }, 16);
  }

  /** 连接方式徽标：直连局域网 / 公网中继（对齐 .host-link-badge） */
  private hostLinkLabel(): string {
    if (this.connection !== 'connected') {
      return '';
    }
    if (this.transportKind === 'relay') {
      return '公网';
    }
    if (this.transportKind === 'direct') {
      return '局域网';
    }
    return '';
  }

  private hostLinkColor(): string {
    return this.transportKind === 'relay' ? '#9CC2FF' : '#7BE39E';
  }

  private hostLinkBg(): string {
    return this.transportKind === 'relay' ? 'rgba(156,194,255,0.10)' : 'rgba(123,227,158,0.10)';
  }

  private hostLinkBorder(): string {
    return this.transportKind === 'relay' ? 'rgba(156,194,255,0.32)' : 'rgba(123,227,158,0.35)';
  }

  private hostDisplayName(): string {
    if (this.hostAlias.length > 0) {
      return this.hostAlias;
    }
    return this.gatewayName.length > 0 ? this.gatewayName : '暂无已保存的主机';
  }

  private saveHostAlias(): void {
    this.hostAlias = this.editAlias.trim();
    PreferencesStore.get().putString('hostAlias', this.hostAlias);
    AppStorage.setOrCreate<string>('hostAlias', this.hostAlias);
    this.hostEditOpen = false;
  }

  private forgetHost(): void {
    GatewayClient.get().forgetSaved();
    this.hostSelected = false;
    this.hostSheetOpen = false;
  }

  aboutToAppear(): void {
    // 键盘出现时不移动整页，只让底部弹层自己上浮
    try {
      this.getUIContext().setKeyboardAvoidMode(KeyboardAvoidMode.NONE);
    } catch (ignored) {
    }
  }

  build() {
    NavDestination() {
      Stack() {
        // 深色海洋渐变背景
        if (this.isDark) {
          OceanBackground()
        } else {
          Column()
            .width('100%')
            .height('100%')
            .linearGradient({
              angle: 165,
              colors: [['#EAF2F8', 0], ['#F7FAFC', 0.6], ['#FFFFFF', 1]]
            })
        }

        Column() {
          // ── 顶栏：品牌 + 两个圆形玻璃按钮 ──
          Row() {
            // 品牌鲸鱼：58rpx = 29vp 正方形
            Image($r('app.media.whale_white'))
              .width(29)
              .height(29)
              .objectFit(ImageFit.Contain)
              .margin({ right: 3.5, top: -4 })
            // 文字标：168.75rpx ≈ 84vp 固定宽
            Image($r('app.media.wordmark_white'))
              .width(84)
              .objectFit(ImageFit.Contain)
              .margin({ right: 9 })
            // HARNESS 徽章：19rpx 字 / 30rpx 高 / 8rpx 圆角
            Text('HARNESS')
              .fontSize(9.5)
              .fontWeight(FontWeight.Bold)
              .fontColor(this.isDark ? '#10151F' : '#FFFFFF')
              .backgroundColor(this.isDark ? '#FFFFFF' : '#141518')
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
            this.drawerOpen = true;
          })

          // ── 主机行：主机胶囊（左） + 配对/设置圆形玻璃钮（右） ──
          Row() {
            // 主机胶囊：点击打开主机切换面板
            Row({ space: 8 }) {
              Image($r('app.media.host_desktop_white'))
                .height(15)
                .objectFit(ImageFit.Contain)
              Text(this.gatewayName.length > 0 ? this.gatewayName : '本机')
                .fontSize(12)
                .fontColor('#FFFFFF')
                .maxLines(1)
                .textOverflow({ overflow: TextOverflow.Ellipsis })
                .constraintSize({ maxWidth: 170 })
              Circle({ width: 6, height: 6 }).fill(this.statusColor())
              Image($r('app.media.chev_down_white'))
                .height(12)
            }
            .padding({ left: 12, right: 12, top: 6, bottom: 6 })
            .borderRadius(999)
            .border({ width: 1, color: 'rgba(255,255,255,0.20)' })
            .backgroundEffect({ radius: 1.5, saturation: 1, brightness: 1 })
            .backgroundColor('rgba(255,255,255,0.05)')
            .shadow({ radius: 12, color: 'rgba(3,14,30,0.22)', offsetY: 4 })
            .onClick(() => {
              this.hostSheetOpen = true;
            })

            Blank()

            // 配对（person-key）：玻璃圆钮 + 配对菜单
            Stack({ alignContent: Alignment.TopEnd }) {
              Row() {
                Image($r('app.media.person_key_white'))
                  .height(24)
                  .objectFit(ImageFit.Contain)
              }
              .width(42)
              .height(42)
              .borderRadius(21)
              .justifyContent(FlexAlign.Center)
              .backgroundEffect({ radius: 1.5, saturation: 1, brightness: 1 })
              .backgroundColor('rgba(255,255,255,0.08)')
              .border({ width: 1, color: 'rgba(255,255,255,0.24)' })
              .visibility(this.pairMenuOpen ? Visibility.Hidden : Visibility.Visible)
              .onClick(() => {
                this.togglePairMenu();
              })
            }

            // 设置：玻璃圆钮（打开会话设置）
            Row() {
              Image($r('app.media.sliders_white'))
                .height(20)
                .objectFit(ImageFit.Contain)
            }
            .width(42)
            .height(42)
            .borderRadius(21)
            .justifyContent(FlexAlign.Center)
            .backgroundEffect({ radius: 1.5, saturation: 1, brightness: 1 })
            .backgroundColor('rgba(255,255,255,0.08)')
            .border({ width: 1, color: 'rgba(255,255,255,0.24)' })
            .margin({ left: 9 })
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
              .fontColor(this.isDark ? '#FFFFFF' : '#101318')
            Text('从想法到落地，一个对话即可。')
              .fontSize(13)
              .fontColor(this.isDark ? 'rgba(255,255,255,0.65)' : 'rgba(16,19,24,0.55)')
          }
          .alignItems(HorizontalAlign.Start)
          .width('100%')
          .margin({ top: 60, bottom: 18 })
          // ── 工作区卡片 ──
          Row({ space: 10 }) {
            Image($r('app.media.workspace_folder_blue'))
              .height(22)
              .objectFit(ImageFit.Contain)
            Column({ space: 2 }) {
              Text(this.workspaceTitle())
                .fontSize(15)
                .fontWeight(FontWeight.Medium)
                .fontColor(this.isDark ? '#FFFFFF' : '#101318')
                .maxLines(1)
                .textOverflow({ overflow: TextOverflow.Ellipsis })
              Text(this.workspaceSubtitle())
                .fontSize(12)
                .fontColor(this.isDark ? 'rgba(255,255,255,0.55)' : 'rgba(16,19,24,0.5)')
                .maxLines(1)
                .textOverflow({ overflow: TextOverflow.Ellipsis })
            }
            .alignItems(HorizontalAlign.Start)
            .layoutWeight(1)
            Row({ space: 8 }) {
              Circle({ width: 7, height: 7 }).fill(this.statusColor())
              Image($r('app.media.ic_dir_chevron_mist'))
                .height(14)
                .fillColor(this.isDark ? 'rgba(255,255,255,0.5)' : 'rgba(16,19,24,0.4)')
            }
          }
          .width('100%')
          .padding({ top: 12, bottom: 12, left: 14, right: 14 })
          .borderRadius(18)
          .border({ width: 1, color: 'rgba(255,255,255,0.22)' })
          .backgroundEffect({ radius: 1, saturation: 1, brightness: 1 })
          .linearGradient({
            angle: 165,
            colors: [['rgba(255,255,255,0.018)', 0], ['rgba(255,255,255,0.004)', 1]]
          })
          .shadow({ radius: 14, color: 'rgba(3,14,30,0.12)', offsetY: 4 })
          .onAreaChange((oldValue: Area, newValue: Area) => {
            this.wsCardY = Number(newValue.globalPosition.y);
            this.wsCardH = Number(newValue.height);
          })
          .onClick(() => {
            this.wsMenuOpen = true;
          })
          .visibility(this.wsMenuOpen ? Visibility.Hidden : Visibility.Visible)

          // ── 新建会话 ──
          Row() {
            // plus-circle：24vp 玻璃圆（48rpx）
            Row() {
              Text('＋')
                .fontSize(15)
                .fontColor('#FFFFFF')
            }
            .width(24)
            .height(24)
            .borderRadius(12)
            .justifyContent(FlexAlign.Center)
            .backgroundEffect({ radius: 1.5, saturation: 1, brightness: 1 })
            .backgroundColor(this.isDark ? 'rgba(255,255,255,0.07)' : 'rgba(16,19,24,0.06)')
            .border({ width: 1, color: 'rgba(255,255,255,0.20)' })
            .margin({ right: 11 })
            Text(this.creating ? '正在新建…' : '新建会话')
              .fontSize(15)
              .fontWeight(FontWeight.Bold)
              .fontColor(this.isDark ? '#FFFFFF' : '#101318')
          }
          .width('100%')
          .justifyContent(FlexAlign.Center)
          .padding({ top: 9, bottom: 9 })
          .borderRadius(16)
          .border({ width: 1, color: this.isDark ? 'rgba(255,255,255,0.38)' : 'rgba(16,19,24,0.30)' })
          .backgroundEffect({ radius: 1.5, saturation: 1, brightness: 1 })
          .linearGradient({
            angle: 165,
            colors: [['rgba(255,255,255,0.06)', 0], ['rgba(255,255,255,0.015)', 1]]
          })
          .shadow({ radius: 16, color: 'rgba(3,14,30,0.18)', offsetY: 4 })
          .enabled(!this.creating)
          .opacity(this.creating ? 0.6 : 1)
          .margin({ top: 18, bottom: 18 })
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
              .fontColor(this.isDark ? '#FFFFFF' : '#101318')
            Blank()
            Text(this.statusText())
              .fontSize(12)
              .fontColor(this.statusColor())
          }
          .width('100%')
          .margin({ bottom: 10 })

          // ── 搜索条 ──
          Row({ space: 8 }) {
            Image($r('app.media.search_white_thin'))
              .height(15)
              .fillColor(this.isDark ? 'rgba(255,255,255,0.5)' : 'rgba(16,19,24,0.4)')
            TextInput({ text: this.search, placeholder: '搜索会话内容' })
              .caretStyle({ width: 1 })
              .fontSize(15)
              .fontColor(this.isDark ? '#FFFFFF' : '#101318')
              .placeholderColor(this.isDark ? 'rgba(255,255,255,0.5)' : 'rgba(16,19,24,0.4)')
              .backgroundColor(Color.Transparent)
              .padding(0)
              .layoutWeight(1)
              .onChange((value: string) => {
                this.search = value;
              })
          }
          .width('100%')
          .padding({ left: 12, right: 12, top: 9, bottom: 9 })
          .borderRadius(13)
          .border({ width: 1, color: 'rgba(255,255,255,0.10)' })
          .backgroundEffect({ radius: 1.5, saturation: 1, brightness: 1 })
          .linearGradient({
            angle: 165,
            colors: [['rgba(255,255,255,0.05)', 0], ['rgba(255,255,255,0.012)', 1]]
          })
          .margin({ bottom: 14 })

          // ── 会话列表 ──
          List({ space: 2 }) {
            if (this.filtered().length === 0) {
              ListItem() {
                Text(this.sessions.length === 0 ? '暂无会话' : '没有匹配的会话')
                  .fontSize(13)
                  .fontColor(this.isDark ? 'rgba(255,255,255,0.52)' : 'rgba(16,19,24,0.45)')
                  .width('100%')
                  .textAlign(TextAlign.Center)
                  .padding(20)
              }
            }
            ForEach(this.filtered(), (item: SessionSummary) => {
              ListItem() {
                Row({ space: 11 }) {
                  Circle({ width: 7, height: 7 })
                    .fill(this.connection === 'connected' ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.2)')
                  Text(this.sessionTitle(item))
                    .fontSize(14)
                    .fontWeight(FontWeight.Medium)
                    .fontColor(this.isDark ? '#FFFFFF' : '#101318')
                    .layoutWeight(1)
                    .maxLines(1)
                    .textOverflow({ overflow: TextOverflow.Ellipsis })
                  Text(item.running ? '运行中' : this.timeLabel(item.updatedAt))
                    .fontSize(12)
                    .fontColor(item.running ? '#34C759' : (this.isDark ? 'rgba(255,255,255,0.45)' : 'rgba(16,19,24,0.4)'))
                }
                .width('100%')
                .padding({ top: 10, bottom: 10, left: 4, right: 4 })
                .borderRadius(8)
                .onClick(() => {
                  SessionStore.get().open(item.id);
                  this.pageStack.pushPathByName('session', null);
                })
              }
            }, (item: SessionSummary) => item.id)
          }
          .width('100%')
          .layoutWeight(1)
          .scrollBar(BarState.Off)
        }
        .width('100%')
        .height('100%')
        .padding({ left: 22, right: 22, top: (this.safeTopStorage > 0 ? this.safeTopStorage : 38.9) + 14, bottom: (this.safeBottomStorage > 0 ? this.safeBottomStorage : 28) + 12 })

        if (this.pairMenuOpen) {
          this.pairMenuOverlay()
        }
        if (this.hostSheetOpen) {
          this.hostSheetOverlay()
        }
        if (this.kindMenuOpen) {
          this.kindMenuOverlay()
        }
        if (this.drawerOpen) {
          this.drawerOverlay()
        }
        if (this.wsMenuOpen) {
          this.workspaceMenuOverlay()
        }
        if (this.dirSheetOpen) {
          this.dirSheetOverlay()
        }
        if (this.manualSheetOpen) {
          this.manualSheetOverlay()
        }
      }
      .width('100%')
      .height('100%')
      .backgroundColor(this.bg())
      .expandSafeArea([SafeAreaType.SYSTEM], [SafeAreaEdge.TOP, SafeAreaEdge.BOTTOM])
    }
    .hideTitleBar(true)
    .backgroundColor(this.bg())
    .expandSafeArea([SafeAreaType.SYSTEM], [SafeAreaEdge.TOP, SafeAreaEdge.BOTTOM])
  }

  private createSession(): void {
    this.creating = true;
    this.createHint = '';
    GatewayClient.get().createSession('').then((id: string) => {
      this.creating = false;
      SessionStore.get().open(id);
      this.pageStack.pushPathByName('session', null);
    }).catch((error: Error) => {
      this.creating = false;
      this.createHint = error.message.length > 0 ? error.message : '创建会话失败';
    });
  }
}
