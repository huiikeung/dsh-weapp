import { uiMaterial } from '@kit.ArkUI';
import { HdsNavDestination, ScrollEffectType, hdsMaterial } from '@kit.UIDesignKit';
import { CONNECTOR_MODULES, ConnectorModuleDefinition, DeviceConnectors } from 'nativecore';
import { SETTINGS_MAX_WIDTH } from '../common/Responsive';

interface ModuleRow {
  id: string;
  title: string;
  tools: number;
}

@Component
export struct ConnectorStatusPage {
  @Consume('pageStack') pageStack: NavPathStack;
  @StorageLink('isDark') isDark: boolean = false;
  @StorageLink('connectorsState') state: string = 'disconnected';
  @StorageLink('connectorsToolCount') toolCount: number = 0;
  @StorageLink('connectorsDetail') detail: string = '';
  @StorageLink('connectorsConfirmedAt') confirmedAt: number = 0;
  @StorageLink('connectorsEnabled') @Watch('onEnabledChanged') enabledJson: string = '{}';
  @StorageLink('connectorsAvailable') availableFlags: string = '00000000';
  @StorageProp('safeTopVp') safeTop: number = 0;
  @StorageProp('safeBottomVp') safeBottom: number = 0;
  @State private expanded: boolean = false;
  @State private checking: boolean = false;
  @State private refreshedAt: number = 0;
  /** 已登记能力：原生玻璃底部弹窗 */
  @State private capsSheetOpen: boolean = false;
  @State private capsSheetHeight: number = 420;
  /** 单个连接器能力详情：继续用原生玻璃底部弹窗（不再跳二级页） */
  @State private moduleSheetOpen: boolean = false;
  @State private moduleSheetHeight: number = 520;
  @State private moduleSheetId: string = '';
  @State private switchState: Record<string, boolean> = {};

  private timer: number = -1;

  aboutToAppear(): void {
    DeviceConnectors.bind();
    this.syncEnabled();
    this.refresh();
    // 对齐 iOS：只在「尚未注册」时每 10s 轮询状态；已注册后不再打扰
    this.timer = setInterval(() => {
      if (this.state !== 'registered') {
        this.refresh();
      }
    }, 10000);
  }

  aboutToDisappear(): void {
    if (this.timer >= 0) {
      clearInterval(this.timer);
      this.timer = -1;
    }
  }

  private refresh(): void {
    this.checking = true;
    DeviceConnectors.refreshStatus();
    setTimeout(() => {
      this.checking = false;
      this.refreshedAt = Date.now();
    }, 900);
  }

  private stateTitle(): string {
    if (this.state === 'registered') {
      return '网关已注册';
    }
    if (this.state === 'registering') {
      return '正在注册连接器';
    }
    if (this.state === 'unverified') {
      return '注册状态未确认';
    }
    if (this.state === 'unsupported') {
      return '网关不支持连接器';
    }
    if (this.state === 'failed') {
      return '连接器注册失败';
    }
    return '已连接，连接器未注册';
  }

  private stateDetail(): string {
    if (this.state === 'registering') {
      return '正在把本机能力登记到网关，通常一两秒内完成。';
    }
    if (this.state === 'unverified') {
      return '没有收到网关确认。请检查网络连接后点「重新注册」。';
    }
    if (this.state === 'unsupported') {
      return '当前网关版本较旧，没有连接器能力。请升级网关插件并重启服务，然后重新连接。';
    }
    if (this.state === 'failed') {
      return '网关拒绝了本次注册。请确认网关插件已更新，再重新注册。';
    }
    if (this.state === 'registered') {
      return '';
    }
    return '聊天连接正常，但网关还没有这次连接的能力登记。点「重新注册」即可。';
  }

  private stateColor(): string {
    if (this.state === 'registered') {
      return '#34C759';
    }
    if (this.state === 'failed') {
      return '#FF3B30';
    }
    if (this.state === 'registering' || this.state === 'unverified' || this.state === 'unsupported') {
      return '#FF9500';
    }
    return '#8E8E93';
  }

  private stateIcon(): Resource {
    if (this.state === 'registered') {
      return $r('app.media.connector_status_caps');
    }
    return $r('app.media.connector_status_caps');
  }

  /** 其它页面改了开关：同步本地状态，保证能力弹窗里的开关是最新值 */
  private onEnabledChanged(): void {
    this.syncEnabled();
  }

  private syncEnabled(): void {
    try {
      this.switchState = JSON.parse(this.enabledJson) as Record<string, boolean>;
    } catch (err) {
      this.switchState = {};
    }
  }

  private moduleDef(id: string): ConnectorModuleDefinition | undefined {
    for (const one of CONNECTOR_MODULES) {
      if (one.id === id) {
        return one;
      }
    }
    return undefined;
  }

  private moduleIndex(id: string): number {
    for (let i = 0; i < CONNECTOR_MODULES.length; i++) {
      if (CONNECTOR_MODULES[i].id === id) {
        return i;
      }
    }
    return -1;
  }

  private moduleAvailable(id: string): boolean {
    const index: number = this.moduleIndex(id);
    return index >= 0 && this.availableFlags.length > index && this.availableFlags.charAt(index) === '1';
  }

  private moduleEnabled(id: string): boolean {
    return this.switchState[id] === true;
  }

  private moduleStateLabel(id: string): string {
    if (!this.moduleAvailable(id)) {
      return '系统未授权';
    }
    if (!this.moduleEnabled(id)) {
      return '手机未开启';
    }
    if (this.state === 'registered') {
      return '已上报网关';
    }
    return '已开启';
  }

  private moduleStateColor(id: string): string {
    if (!this.moduleAvailable(id)) {
      return '#FF9500';
    }
    if (!this.moduleEnabled(id)) {
      return this.isDark ? 'rgba(255,255,255,0.45)' : 'rgba(16,19,24,0.45)';
    }
    if (this.state === 'registered') {
      return '#34C759';
    }
    return '#2E6BE6';
  }

  private toolLabel(id: string): string {
    if (id === 'calendar.busy') {
      return '查询忙闲';
    }
    if (id === 'calendar.create') {
      return '创建日程';
    }
    if (id === 'reminders.list') {
      return '查询提醒';
    }
    if (id === 'reminders.create') {
      return '创建提醒';
    }
    if (id === 'location.current') {
      return '当前位置';
    }
    if (id === 'location.precise') {
      return '精确定位';
    }
    if (id === 'photos.select') {
      return '选择照片';
    }
    if (id === 'music.search') {
      return '搜索音乐';
    }
    if (id === 'music.state') {
      return '播放状态';
    }
    if (id === 'music.play') {
      return '播放';
    }
    if (id === 'music.pause') {
      return '暂停';
    }
    if (id === 'music.seek') {
      return '跳转进度';
    }
    if (id === 'health.daily-summary') {
      return '健康摘要';
    }
    if (id === 'alarms.create') {
      return '创建闹钟';
    }
    if (id === 'alarms.list') {
      return '查询闹钟';
    }
    if (id === 'alarms.cancel') {
      return '取消闹钟';
    }
    return id;
  }

  private moduleToolCount(id: string): number {
    const def: ConnectorModuleDefinition | undefined = this.moduleDef(id);
    return def === undefined ? 0 : def.tools.length;
  }

  private modules(): ModuleRow[] {
    const rows: ModuleRow[] = [];
    if (this.detail.length === 0) {
      return rows;
    }
    this.detail.split(',').forEach((part: string) => {
      const seg: string[] = part.split(':');
      if (seg.length < 2) {
        return;
      }
      const id: string = seg[0];
      const count: number = Number.parseInt(seg[1], 10);
      let title: string = id;
      CONNECTOR_MODULES.forEach((m: ConnectorModuleDefinition) => {
        if (m.id === id) {
          title = m.title;
        }
      });
      rows.push({ id: id, title: title, tools: Number.isNaN(count) ? 0 : count });
    });
    return rows;
  }

  private clockLabel(millis: number): string {
    if (millis <= 0) {
      return '';
    }
    const date: Date = new Date(millis);
    const hh: string = date.getHours().toString().padStart(2, '0');
    const mm: string = date.getMinutes().toString().padStart(2, '0');
    const ss: string = date.getSeconds().toString().padStart(2, '0');
    return hh + ':' + mm + ':' + ss;
  }

  private cardFill(): string {
    return this.isDark ? 'rgba(255,255,255,0.055)' : 'rgba(255,255,255,0.74)';
  }

  private cardBorder(): string {
    return this.isDark ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.85)';
  }

  private cardShadow(): ShadowOptions {
    return {
      radius: 18,
      color: this.isDark ? 'rgba(0,0,0,0.38)' : 'rgba(23,43,77,0.09)',
      offsetX: 0,
      offsetY: 8
    };
  }

  private textColor(): string {
    return this.isDark ? '#FFFFFF' : '#101318';
  }

  private subColor(): string {
    return this.isDark ? 'rgba(255,255,255,0.55)' : 'rgba(16,19,24,0.55)';
  }

  private dividerColor(): string {
    return this.isDark ? 'rgba(255,255,255,0.10)' : 'rgba(16,19,24,0.08)';
  }

  private pageBg(): string {
    // 纯色背景：深色深海蓝黑、浅色冷白（不再用渐变/光晕）
    return this.isDark ? '#0C1017' : '#F5F7FA';
  }

  /** 半模态材质：与首页「切换主机」/会话页弹窗同款（ImmersiveMaterial，系统不支持时回退） */
  private immersiveSupported(): boolean {
    try {
      return uiMaterial.isImmersiveMaterialSupported();
    } catch (err) {
      return false;
    }
  }

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

  private moduleIcon(id: string): Resource {
    if (id === 'calendar') {
      return $r('app.media.ic_connector_calendar');
    }
    if (id === 'reminders') {
      return $r('app.media.ic_connector_reminders');
    }
    if (id === 'location') {
      return $r('app.media.ic_connector_location');
    }
    if (id === 'photos') {
      return $r('app.media.ic_connector_photos');
    }
    if (id === 'music') {
      return $r('app.media.ic_connector_music');
    }
    if (id === 'health') {
      return $r('app.media.ic_connector_health');
    }
    if (id === 'maps') {
      return $r('app.media.ic_connector_location');
    }
    return $r('app.media.ic_connector_alarms');
  }

  /** 打开某个连接器的能力详情（继续底部弹窗，不跳二级页） */
  private openModuleDetail(id: string): void {
    this.moduleSheetId = id;
    const tools: number = this.moduleToolCount(id);
    this.moduleSheetHeight = 300 + tools * 48 + (this.safeBottom > 0 ? this.safeBottom : 24);
    this.capsSheetOpen = false;
    setTimeout(() => {
      this.moduleSheetOpen = true;
    }, 260);
  }

  private toggleModule(id: string, value: boolean): void {
    DeviceConnectors.setEnabled(id, value).then((ok: boolean) => {
      this.syncEnabled();
      if (!ok) {
        try {
          this.getUIContext().getPromptAction().showToast({
            message: '系统权限未开启，请到应用设置中允许后再试',
            duration: 2200
          });
        } catch (err) {
        }
      }
    });
  }

  /** 打开「网关已登记的能力」原生玻璃底部弹窗，高度按模块数估算 */
  private openCapsSheet(): void {
    const count: number = this.modules().length;
    this.capsSheetHeight = 168 + count * 78 + (this.safeBottom > 0 ? this.safeBottom : 24);
    this.capsSheetOpen = true;
  }

  /** 已登记能力：原生玻璃半模态内容（标题 + 关闭 + 模块列表） */
  @Builder
  capsSheet() {
    Column() {
      Row() {
        Column()
          .width(36)
          .height(4)
          .borderRadius(2)
          .backgroundColor(this.isDark ? 'rgba(255,255,255,0.28)' : 'rgba(16,19,24,0.18)')
      }
      .width('100%')
      .justifyContent(FlexAlign.Center)
      .padding({ top: 8, bottom: 2 })

      Row() {
        Column({ space: 3 }) {
          Text('网关已登记的能力')
            .fontSize(17)
            .fontWeight(FontWeight.Bold)
            .fontColor(this.textColor())
          Text(this.modules().length.toString() + ' 个连接器 · ' + this.toolCount.toString() + ' 项能力')
            .fontSize(12)
            .fontColor(this.subColor())
        }
        .alignItems(HorizontalAlign.Start)
        Blank()
        Text('✕')
          .fontSize(16)
          .fontColor(this.subColor())
          .onClick(() => {
            this.capsSheetOpen = false;
          })
      }
      .width('100%')
      .padding({ left: 18, right: 18, top: 8, bottom: 10 })

      Scroll() {
        Column({ space: 0 }) {
          ForEach(this.modules(), (row: ModuleRow, index: number) => {
            Row({ space: 12 }) {
              Image(this.moduleIcon(row.id))
                .width(46)
                .height(46)
                .borderRadius(12)
                .objectFit(ImageFit.Contain)
                .clip(true)
              Column({ space: 4 }) {
                Text(row.title)
                  .fontSize(16)
                  .fontWeight(FontWeight.Medium)
                  .fontColor(this.textColor())
                Text(row.tools.toString() + ' 项能力')
                  .fontSize(12.5)
                  .fontColor(this.subColor())
              }
              .alignItems(HorizontalAlign.Start)
              .layoutWeight(1)
              Image($r('app.media.ic_dir_chevron_mist'))
                .width(13)
                .height(13)
                .fillColor(this.subColor())
            }
            .width('100%')
            .padding({ left: 16, right: 16, top: 14, bottom: 14 })
            .border({
              width: { top: index > 0 ? 0.5 : 0 },
              color: this.isDark ? 'rgba(255,255,255,0.10)' : 'rgba(16,19,24,0.06)'
            })
            .onClick(() => {
              this.openModuleDetail(row.id);
            })
          }, (row: ModuleRow) => row.id)
        }
        .width('100%')
        .borderRadius(12)
        .border({ width: 0.5, color: this.isDark ? 'rgba(255,255,255,0.14)' : 'rgba(16,19,24,0.10)' })
        .backgroundColor(this.isDark ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.55)')
      }
      .width('100%')
      .layoutWeight(1)
      .padding({ left: 16, right: 16, bottom: 18 })
      .scrollBar(BarState.Off)
      // 平板/宽屏：设置内容居中一栏（对齐 iOS iPad 设置页）
      .constraintSize({ maxWidth: SETTINGS_MAX_WIDTH })
      .align(Alignment.Top)
    }
    .width('100%')
    .height('100%')
  }

  /** 单个连接器详情：原生玻璃底部弹窗（状态 + 本机开关 + 能力列表） */
  @Builder
  moduleSheet() {
    Column() {
      Row() {
        Column()
          .width(36)
          .height(4)
          .borderRadius(2)
          .backgroundColor(this.isDark ? 'rgba(255,255,255,0.28)' : 'rgba(16,19,24,0.18)')
      }
      .width('100%')
      .justifyContent(FlexAlign.Center)
      .padding({ top: 8, bottom: 2 })

      Row({ space: 12 }) {
        Image(this.moduleIcon(this.moduleSheetId))
          .width(46)
          .height(46)
          .borderRadius(12)
          .objectFit(ImageFit.Contain)
          .clip(true)
        Column({ space: 3 }) {
          Text(this.moduleDef(this.moduleSheetId) !== undefined ? this.moduleDef(this.moduleSheetId)!.title : '连接器')
            .fontSize(18)
            .fontWeight(FontWeight.Bold)
            .fontColor(this.textColor())
          Text(this.moduleDef(this.moduleSheetId) !== undefined ? this.moduleDef(this.moduleSheetId)!.subtitle : '')
            .fontSize(12.5)
            .fontColor(this.subColor())
        }
        .alignItems(HorizontalAlign.Start)
        .layoutWeight(1)
        Text('✕')
          .fontSize(16)
          .fontColor(this.subColor())
          .onClick(() => {
            this.moduleSheetOpen = false;
          })
      }
      .width('100%')
      .padding({ left: 18, right: 18, top: 8, bottom: 12 })

      Scroll() {
        Column({ space: 10 }) {
          // 状态卡
          Column() {
            Row({ space: 10 }) {
              Circle({ width: 8, height: 8 })
                .fill(this.moduleStateColor(this.moduleSheetId))
              Text('当前状态')
                .fontSize(15)
                .fontColor(this.textColor())
              Blank()
              Text(this.moduleStateLabel(this.moduleSheetId))
                .fontSize(14)
                .fontColor(this.moduleStateColor(this.moduleSheetId))
            }
            .width('100%')
            .height(50)
            .padding({ left: 16, right: 16 })

            Divider().color(this.isDark ? 'rgba(255,255,255,0.10)' : 'rgba(16,19,24,0.08)')
              .strokeWidth(1).margin({ left: 16, right: 16 })

            Row({ space: 12 }) {
              Text('本机开启')
                .fontSize(15)
                .fontColor(this.textColor())
              Blank()
              Toggle({ type: ToggleType.Switch, isOn: this.moduleEnabled(this.moduleSheetId) })
                .selectedColor('#2E6BE6')
                .enabled(this.moduleAvailable(this.moduleSheetId))
                .onChange((value: boolean) => {
                  this.toggleModule(this.moduleSheetId, value);
                })
            }
            .width('100%')
            .height(50)
            .padding({ left: 16, right: 16 })

            if (!this.moduleAvailable(this.moduleSheetId)) {
              Text('需要系统权限，请到应用设置里允许后再开启。')
                .fontSize(12)
                .lineHeight(18)
                .fontColor(this.subColor())
                .width('100%')
                .padding({ left: 16, right: 16, bottom: 12 })
            }
          }
          .width('100%')
          .borderRadius(12)
          .border({ width: 0.5, color: this.isDark ? 'rgba(255,255,255,0.14)' : 'rgba(16,19,24,0.10)' })
          .backgroundColor(this.isDark ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.55)')

          // 能力列表
          Column() {
            ForEach(this.moduleDef(this.moduleSheetId) !== undefined
              ? this.moduleDef(this.moduleSheetId)!.tools : [], (tool: string, index: number) => {
              Row({ space: 12 }) {
                Text(this.toolLabel(tool))
                  .fontSize(15)
                  .fontColor(this.textColor())
                Blank()
                Text(tool)
                  .fontSize(12)
                  .fontFamily('monospace')
                  .fontColor(this.subColor())
              }
              .width('100%')
              .height(48)
              .padding({ left: 16, right: 16 })
              .border({
                width: { top: index > 0 ? 0.5 : 0 },
                color: this.isDark ? 'rgba(255,255,255,0.10)' : 'rgba(16,19,24,0.08)'
              })
            }, (tool: string) => tool)
          }
          .width('100%')
          .borderRadius(12)
          .border({ width: 0.5, color: this.isDark ? 'rgba(255,255,255,0.14)' : 'rgba(16,19,24,0.10)' })
          .backgroundColor(this.isDark ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.55)')
          .clip(true)

          Text('开启并授权后，Agent 才可以通过网关调用这些能力；关闭时不会上报给网关。')
            .fontSize(12)
            .lineHeight(18)
            .fontColor(this.subColor())
            .width('100%')
            .padding({ left: 2, right: 2 })
        }
        .width('100%')
      }
      .layoutWeight(1)
      .padding({ left: 16, right: 16, bottom: 18 })
      .scrollBar(BarState.Off)
    }
    .width('100%')
    .height('100%')
  }

  private scroller: Scroller = new Scroller();

  build() {
    HdsNavDestination() {
      Column() {
        Scroll(this.scroller) {
          Column({ space: 10 }) {
            // 首屏让出原生标题栏
            Column().width('100%').height((this.safeTop > 0 ? this.safeTop : 38.9) + 56)
            Column({ space: 6 }) {
              Text('本机能力在网关上的注册与连接状态')
                .fontSize(13)
                .fontColor(this.subColor())
                .width('100%')
            }
            .width('100%')
            .padding({ left: 4, top: 2, bottom: 12 })
            // ── 状态总览 ──
            Column() {
              Row({ space: 14 }) {
                Stack({ alignContent: Alignment.Center }) {
                  if (this.state === 'registering' || this.checking) {
                    LoadingProgress().width(28).height(28).color(this.stateColor())
                  } else {
                    Circle({ width: 8, height: 8 }).fill(this.stateColor())
                  }
                }
                .width(28)
                .height(28)

                Column({ space: 4 }) {
                  Text(this.stateTitle())
                    .fontSize(17)
                    .fontWeight(FontWeight.Medium)
                    .fontColor(this.textColor())
                  Text(this.state === 'registered'
                    ? '网关已确认 ' + this.toolCount.toString() + ' 项能力'
                    : '轻点下方按钮重试')
                    .fontSize(13)
                    .fontColor(this.subColor())
                }
                .alignItems(HorizontalAlign.Start)
                .layoutWeight(1)
              }
              .width('100%')
              .padding({ left: 16, right: 16, top: 18, bottom: 16 })

              if (this.state !== 'registered') {
                Text(this.stateDetail())
                  .fontSize(13)
                  .lineHeight(20)
                  .fontColor(this.subColor())
                  .width('100%')
                  .padding({ left: 16, right: 16, bottom: 16 })
              }

              if (this.state === 'registered' && this.clockLabel(this.confirmedAt).length > 0) {
                Divider().color(this.dividerColor()).strokeWidth(1).margin({ left: 16, right: 16 })
                Row() {
                  Text('最近确认')
                    .fontSize(13)
                    .fontColor(this.subColor())
                  Blank()
                  Text(this.clockLabel(this.confirmedAt))
                    .fontSize(13)
                    .fontColor(this.textColor())
                }
                .width('100%')
                .height(44)
                .padding({ left: 16, right: 16 })
              }
            }
            .width('100%')
            .backgroundColor(this.cardFill())
            .backdropBlur(this.isDark ? 30 : 22)
            .border({ width: 1, color: this.cardBorder() })
            .borderRadius(16)
            .shadow(this.cardShadow())

            // ── 已登记能力 ──
            if (this.state === 'registered') {
              Column() {
                Row({ space: 12 }) {
                  Image($r('app.media.connector_status_caps'))
                    .width(30)
                    .height(30)
                    .objectFit(ImageFit.Contain)
                  Column({ space: 2 }) {
                    Text('网关已登记的能力')
                      .fontSize(16)
                      .fontColor(this.textColor())
                    Text(this.modules().length.toString() + ' 个模块 · ' + this.toolCount.toString() + ' 个工具')
                      .fontSize(12)
                      .fontColor(this.subColor())
                  }
                  .alignItems(HorizontalAlign.Start)
                  .layoutWeight(1)
                  Image($r('app.media.ic_dir_chevron_mist'))
                    .width(12)
                    .height(12)
                    .fillColor(this.subColor())
                }
                .width('100%')
                .height(62)
                .padding({ left: 16, right: 16 })
                .onClick(() => {
                  this.openCapsSheet();
                })

              }
              .width('100%')
              .backgroundColor(this.cardFill())
              .backdropBlur(this.isDark ? 30 : 22)
              .border({ width: 1, color: this.cardBorder() })
              .borderRadius(16)
              .shadow(this.cardShadow())
              .clip(true)
            }

            // ── 操作 ──
            Column() {
              Row() {
                Row({ space: 8 }) {
                  if (this.checking) {
                    LoadingProgress().width(16).height(16).color('#2E6BE6')
                  }
                  Text(this.checking ? '刷新中…' : '刷新状态')
                    .fontSize(15)
                    .fontColor('#2E6BE6')
                }
                .onClick(() => {
                  this.refresh();
                })
                Blank()
                Text('重新注册')
                  .fontSize(15)
                  .fontColor('#2E6BE6')
                  .onClick(() => {
                    DeviceConnectors.retryRegister();
                    this.refresh();
                  })
              }
              .width('100%')
              .height(50)
              .padding({ left: 16, right: 16 })
            }
            .width('100%')
            .backgroundColor(this.cardFill())
            .backdropBlur(this.isDark ? 30 : 22)
            .border({ width: 1, color: this.cardBorder() })
            .borderRadius(16)
            .shadow(this.cardShadow())

            if (this.clockLabel(this.refreshedAt).length > 0) {
              Text((this.state === 'registered' ? '上次检查 ' : '未注册时每 10 秒自动检查 · 上次 ') + this.clockLabel(this.refreshedAt))
                .fontSize(11.5)
                .fontColor(this.subColor())
                .width('100%')
                .textAlign(TextAlign.Center)
                .padding({ top: 4 })
            }
          }
          .width('100%')
          .padding({ left: 16, right: 16, top: 8, bottom: 24 + this.safeBottom })
        }
        .layoutWeight(1)
        .width('100%')
        .align(Alignment.Top)
        .scrollBar(BarState.Off)
        // 已登记能力：原生玻璃底部弹窗
        Column()
          .width(1)
          .height(1)
          .opacity(0.01)
          .bindSheet($$this.capsSheetOpen, this.capsSheet(), {
            height: this.capsSheetHeight,
            dragBar: false,
            showClose: false,
            preferType: SheetType.BOTTOM,
            backgroundColor: this.immersiveSupported() ? Color.Transparent : (this.isDark ? '#2E2E2E' : '#F7F8FA'),
            systemMaterial: this.sheetMaterial()
          })

        // 单个连接器详情：同样用原生玻璃底部弹窗
        Column()
          .width(1)
          .height(1)
          .opacity(0.01)
          .bindSheet($$this.moduleSheetOpen, this.moduleSheet(), {
            height: this.moduleSheetHeight,
            dragBar: false,
            showClose: false,
            preferType: SheetType.BOTTOM,
            backgroundColor: this.immersiveSupported() ? Color.Transparent : (this.isDark ? '#2E2E2E' : '#F7F8FA'),
            systemMaterial: this.sheetMaterial()
          })
      }
      .width('100%')
      .height('100%')
      .justifyContent(FlexAlign.Start)
    }
    .titleBar({
      avoidLayoutSafeArea: true,
      content: { title: { mainTitle: '连接器状态' } },
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
  }
}
