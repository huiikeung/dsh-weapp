import { common } from '@kit.AbilityKit';
import { image } from '@kit.ImageKit';
import { util } from '@kit.ArkTS';
import { fileIo } from '@kit.CoreFileKit';
import { GatewayFrame, Logger, asRec, arr, bool, num, str } from 'nativecore';
import { GatewayClient } from 'nativecore';
import { NavBackButton } from '../components/NavBackButton';

/** 会话选择项 / 接入目标 */
interface ClawbotSession {
  id: string;
  title: string;
  workspaceTitle: string;
}

/**
 * 微信 ClawBot 私聊接线（视觉对齐小程序 clawbot 面板）：
 * hero 状态卡 → 接入会话/待处理 tile → 操作按钮 → 扫码绑定卡。
 * 协议：网关 clawbot-control（status/sessions/route/enabled/login.start/login.poll/login.cancel/disconnect）。
 */
@Component
export struct ClawbotPage {
  @Consume('pageStack') pageStack: NavPathStack;
  @StorageLink('isDark') isDark: boolean = false;
  @StorageLink('safeTopVp') safeTopStorage: number = 0;

  @State private supported: boolean = false;
  @State private revision: number = 0;
  @State private bridgeEnabled: boolean = false;
  @State private state: string = '';
  @State private paired: boolean = false;
  @State private bindingState: string = 'unpaired';
  @State private targetTitle: string = '';
  @State private message: string = '';
  @State private pending: number = 0;
  @State private uncertain: number = 0;
  @State private pairingId: string = '';
  @State private pairingStatus: string = '';
  @State private pairingQrPath: string = '';
  /** 二维码像素图：直接从 base64 解码，避免沙箱文件路径读不出来 */
  @State private qrPixel: image.PixelMap | undefined = undefined;
  @State private verifyCode: string = '';
  @State private busy: boolean = false;
  @State private error: string = '';
  @State private loaded: boolean = false;
  @State private confirmDisconnect: boolean = false;
  @State private sessionsOpen: boolean = false;
  @State private sessionsLoading: boolean = false;
  @State private sessions: ClawbotSession[] = [];

  private pollTimer: number = -1;
  private disposed: boolean = false;

  aboutToAppear(): void {
    this.refresh(true);
    this.pollTimer = setInterval(() => {
      if (this.disposed || this.busy) {
        return;
      }
      this.refresh(true);
    }, 3000);
  }

  aboutToDisappear(): void {
    this.disposed = true;
    if (this.pollTimer >= 0) {
      clearInterval(this.pollTimer);
      this.pollTimer = -1;
    }
  }

  private topInset(): number {
    return this.safeTopStorage > 0 ? this.safeTopStorage : 38.9;
  }

  private pageBg(): string {
    return this.isDark ? '#000000' : '#F2F2F7';
  }

  private heroBg(): string {
    if (this.bridgeEnabled) {
      return this.isDark ? 'rgba(25,135,84,0.14)' : 'rgba(25,135,84,0.08)';
    }
    return this.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.72)';
  }

  private heroBorder(): string {
    return this.bridgeEnabled ? 'rgba(25,135,84,0.30)' : this.dividerColor();
  }

  private tileBg(): string {
    return this.isDark ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.66)';
  }

  private textColor(): string {
    return this.isDark ? '#F1F4FA' : '#10131A';
  }

  private subColor(): string {
    return this.isDark ? 'rgba(241,244,250,0.55)' : 'rgba(16,19,24,0.52)';
  }

  private dividerColor(): string {
    return this.isDark ? 'rgba(255,255,255,0.10)' : 'rgba(16,19,24,0.08)';
  }

  private ocean(): string {
    return this.isDark ? '#6B92F2' : '#2E6BE6';
  }

  private dangerColor(): string {
    return this.isDark ? '#F08A8A' : '#C44848';
  }

  private successColor(): string {
    return this.isDark ? '#4ADE80' : '#198754';
  }

  private stateLabel(): string {
    if (!this.loaded) {
      return '正在读取状态…';
    }
    if (this.state === 'error') {
      return 'ClawBot 异常';
    }
    if (this.bridgeEnabled) {
      return '接线运行中';
    }
    return this.paired ? '已暂停' : '未绑定微信';
  }

  private heroSub(): string {
    if (!this.paired) {
      return '尚未绑定微信';
    }
    if (this.targetTitle.length > 0) {
      return '接入会话：' + this.targetTitle;
    }
    return '尚未选择接入会话';
  }

  private applyStatus(value: Object | undefined): void {
    const rec = asRec(value);
    if (rec === undefined || bool(rec, 'supported') !== true) {
      this.supported = false;
      this.loaded = true;
      return;
    }
    this.supported = true;
    this.revision = num(rec, 'revision') ?? this.revision;
    this.bridgeEnabled = bool(rec, 'enabled') ?? false;
    this.state = str(rec, 'state') ?? this.state;
    this.paired = bool(rec, 'paired') ?? false;
    this.bindingState = str(rec, 'bindingState') ?? this.bindingState;
    this.message = str(rec, 'message') ?? '';
    this.pending = num(rec, 'pending') ?? 0;
    this.uncertain = num(rec, 'uncertain') ?? 0;
    const target = asRec(rec['target'] as Object);
    this.targetTitle = target !== undefined ? (str(target, 'title') ?? '') : '';
    const pairing = asRec(rec['pairing'] as Object);
    if (pairing !== undefined) {
      this.pairingId = str(pairing, 'id') ?? '';
      this.pairingStatus = str(pairing, 'status') ?? '';
      const dataUrl: string = str(pairing, 'qrDataUrl') ?? '';
      if (dataUrl.length > 0) {
        this.writeQr(dataUrl);
      }
    } else {
      this.pairingId = '';
      this.pairingStatus = '';
      this.pairingQrPath = '';
    }
    this.loaded = true;
    this.refreshSummary();
  }

  private refreshSummary(): void {
    let summary: string = '未绑定微信';
    if (this.bridgeEnabled) {
      summary = '运行中';
    } else if (this.paired) {
      summary = '已暂停';
    }
    AppStorage.setOrCreate<string>('clawbotStatusSummary', summary);
  }

  private writeQr(dataUrl: string): void {
    try {
      const comma: number = dataUrl.indexOf(',');
      const base64: string = comma >= 0 ? dataUrl.substring(comma + 1) : dataUrl;
      const helper = new util.Base64Helper();
      const bytes = helper.decodeSync(base64);
      const context = getContext(this) as common.UIAbilityContext;
      const path: string = context.filesDir + '/clawbot-login-qr.png';
      const file = fileIo.openSync(path, fileIo.OpenMode.CREATE | fileIo.OpenMode.READ_WRITE | fileIo.OpenMode.TRUNC);
      fileIo.writeSync(file.fd, bytes.buffer);
      fileIo.closeSync(file);
      // Image 组件显示沙箱文件需要 file:// 前缀
      this.pairingQrPath = 'file://' + path;
      Logger.info('[CLAWBOT] qr saved len=' + dataUrl.length.toString() + ' path=' + path);
    } catch (err) {
      Logger.warn('[CLAWBOT] qr write failed: ' + (err as Error).message);
    }
    // 主路径：直接解码成 PixelMap 交给 Image 渲染（不依赖文件读取）
    try {
      const helper = new util.Base64Helper();
      const bytes = helper.decodeSync(dataUrl.indexOf(',') >= 0 ? dataUrl.substring(dataUrl.indexOf(',') + 1) : dataUrl);
      const source = image.createImageSource(bytes.buffer as ArrayBuffer);
      const options: image.DecodingOptions = {
        desiredSize: { width: 440, height: 440 }
      };
      source.createPixelMap(options).then((pixel: image.PixelMap) => {
        this.qrPixel = pixel;
        this.pairingQrPath = '';
        Logger.info('[CLAWBOT] qr pixel ready');
      }).catch((error: Error) => {
        Logger.warn('[CLAWBOT] qr pixel failed: ' + error.message);
      });
    } catch (error) {
      Logger.warn('[CLAWBOT] qr pixel decode failed: ' + (error as Error).message);
    }
  }

  private refresh(silent: boolean): void {
    if (!silent) {
      this.busy = true;
    }
    GatewayClient.get().clawbotControl('status')
      .then((frame: GatewayFrame) => {
        this.error = '';
        this.applyStatus(frame.value);
      })
      .catch((err: Error) => {
        this.error = err.message;
      })
      .finally(() => {
        if (!silent) {
          this.busy = false;
        }
      });
  }

  private run(action: string, fields: Record<string, Object>): void {
    if (this.busy) {
      return;
    }
    this.busy = true;
    this.error = '';
    GatewayClient.get().clawbotControl(action, fields)
      .then((frame: GatewayFrame) => {
        const value = frame.value;
        const rec = asRec(value);
        if (rec !== undefined && rec['sessions'] !== undefined) {
          this.applySessions(arr(rec, 'sessions'));
          return;
        }
        this.applyStatus(value);
      })
      .catch((err: Error) => {
        this.error = err.message;
      })
      .finally(() => {
        this.busy = false;
      });
  }

  private applySessions(list: Object[] | undefined): void {
    const rows: ClawbotSession[] = [];
    const source: Object[] = list !== undefined ? list : [];
    for (const one of source) {
      const id: string = str(one, 'id') ?? '';
      if (id.length === 0) {
        continue;
      }
      const title: string = str(one, 'title') ?? '';
      // 过滤掉没有标题的空会话（网关用「未命名会话」占位），只保留真正用过的会话
      if (title.length === 0 || title === '未命名会话' || title === id) {
        continue;
      }
      rows.push({
        id: id,
        title: title,
        workspaceTitle: str(one, 'workspaceTitle') ?? ''
      });
    }
    this.sessions = rows;
    this.sessionsOpen = true;
  }

  private toggleEnabled(): void {
    if (!this.paired || this.targetTitle.length === 0) {
      this.error = '请先绑定微信并选择接入会话';
      return;
    }
    this.run('enabled', { 'enabled': !this.bridgeEnabled, 'expectedRevision': this.revision });
  }

  private startLogin(): void {
    this.run('login.start', { 'expectedRevision': this.revision });
  }

  private cancelLogin(): void {
    if (this.pairingId.length === 0) {
      return;
    }
    this.run('login.cancel', { 'loginId': this.pairingId });
  }

  private submitVerify(): void {
    const code: string = this.verifyCode.trim();
    if (this.pairingId.length === 0 || code.length === 0) {
      return;
    }
    this.run('login.poll', { 'loginId': this.pairingId, 'verifyCode': code });
    this.verifyCode = '';
  }

  private openSessions(): void {
    if (this.busy) {
      return;
    }
    this.sessionsOpen = true;
    this.sessionsLoading = true;
    GatewayClient.get().clawbotControl('sessions')
      .then((frame: GatewayFrame) => {
        const rec = asRec(frame.value);
        this.applySessions(rec !== undefined ? arr(rec, 'sessions') : undefined);
      })
      .catch((err: Error) => {
        this.error = err.message;
      })
      .finally(() => {
        this.sessionsLoading = false;
      });
  }

  private chooseSession(id: string): void {
    this.sessionsOpen = false;
    this.run('route', { 'sessionId': id, 'expectedRevision': this.revision });
  }

  private disconnect(): void {
    this.confirmDisconnect = false;
    this.run('disconnect', { 'expectedRevision': this.revision, 'abandonPending': true });
  }

  @Builder
  navBar() {
    Row() {
      NavBackButton({ isDark: this.isDark })
        .onClick(() => {
          this.pageStack.pop();
        })
      Text('微信 ClawBot')
        .fontSize(17)
        .fontWeight(FontWeight.Medium)
        .fontColor(this.textColor())
        .layoutWeight(1)
        .textAlign(TextAlign.Center)
      Row().width(44).height(44)
    }
    .width('100%')
    .height(56 + this.topInset())
    .padding({ left: 14, right: 14, top: this.topInset() > 2 ? this.topInset() - 2 : 0 })
    .zIndex(10)
  }

  /** hero：状态点 + 标题 + 副标题 + 刷新胶囊（运行中绿色高亮，对齐小程序 .clawbot-hero） */
  @Builder
  hero() {
    Row({ space: 12 }) {
      Circle()
        .width(10)
        .height(10)
        .fill(this.bridgeEnabled ? this.successColor() : (this.paired ? '#FFAD1F' : '#8A9099'))
        .shadow(this.bridgeEnabled ? { radius: 8, color: 'rgba(25,135,84,0.45)' } : { radius: 0, color: Color.Transparent })
      Column({ space: 4 }) {
        Text(this.stateLabel())
          .fontSize(16.5)
          .fontWeight(FontWeight.Medium)
          .fontColor(this.bridgeEnabled ? this.successColor() : this.textColor())
        Text(this.heroSub())
          .fontSize(12.5)
          .fontColor(this.subColor())
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
      }
      .alignItems(HorizontalAlign.Start)
      .layoutWeight(1)

      Text(this.busy ? '刷新中…' : '刷新')
        .fontSize(12.5)
        .fontColor(this.subColor())
        .padding({ left: 12, right: 12, top: 6, bottom: 6 })
        .borderRadius(999)
        .border({ width: 1, color: this.dividerColor() })
        .onClick(() => {
          if (!this.busy) {
            this.refresh(false);
          }
        })
    }
    .width('100%')
    .padding({ left: 16, right: 16, top: 16, bottom: 16 })
    .borderRadius(20)
    .backgroundColor(this.heroBg())
    .border({ width: 1, color: this.heroBorder() })
  }

  /** 两个信息 tile：接入会话 / 待处理 · 不确定 */
  @Builder
  tiles() {
    Row({ space: 12 }) {
      Column({ space: 6 }) {
        Text('接入会话')
          .fontSize(11.5)
          .fontColor(this.subColor())
        Row({ space: 6 }) {
          Text(this.targetTitle.length > 0 ? this.targetTitle : '尚未选择')
            .fontSize(14)
            .fontWeight(FontWeight.Medium)
            .fontColor(this.textColor())
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
            .layoutWeight(1)
          Text('›').fontSize(17).fontColor(this.subColor())
        }
        .width('100%')
      }
      .alignItems(HorizontalAlign.Start)
      .layoutWeight(1)
      .padding({ left: 14, right: 14, top: 12, bottom: 12 })
      .borderRadius(16)
      .backgroundColor(this.tileBg())
      .border({ width: 1, color: this.dividerColor() })
      .onClick(() => {
        this.openSessions();
      })

      Column({ space: 6 }) {
        Text('待处理 / 不确定')
          .fontSize(11.5)
          .fontColor(this.subColor())
        Text(this.pending.toString() + ' / ' + this.uncertain.toString())
          .fontSize(14)
          .fontWeight(FontWeight.Medium)
          .fontColor(this.textColor())
      }
      .alignItems(HorizontalAlign.Start)
      .layoutWeight(1)
      .padding({ left: 14, right: 14, top: 12, bottom: 12 })
      .borderRadius(16)
      .backgroundColor(this.tileBg())
      .border({ width: 1, color: this.dividerColor() })
    }
    .width('100%')
  }

  /** 操作按钮：绑定/选择会话/移除绑定（对齐小程序 .clawbot-ops） */
  @Builder
  opButton(label: string, danger: boolean, disabled: boolean, onTap: () => void) {
    Text(label)
      .fontSize(13.5)
      .fontWeight(FontWeight.Medium)
      .fontColor(disabled ? this.subColor() : (danger ? this.dangerColor() : this.textColor()))
      .textAlign(TextAlign.Center)
      .constraintSize({ minHeight: 42 })
      .padding({ left: 12, right: 12 })
      .layoutWeight(1)
      .borderRadius(14)
      .backgroundColor(this.tileBg())
      .border({
        width: 1,
        color: disabled ? this.dividerColor()
          : (danger ? 'rgba(196,72,72,0.34)' : this.dividerColor())
      })
      .opacity(disabled ? 0.45 : 1)
      .onClick(() => {
        if (!disabled) {
          onTap();
        }
      })
  }

  @Builder
  ops() {
    Row({ space: 10 }) {
      this.opButton(this.paired ? '重新绑定微信' : '绑定微信', false,
        this.busy || this.bridgeEnabled || this.pairingId.length > 0, () => {
          this.startLogin();
        })
      this.opButton(this.bridgeEnabled ? '暂停接线' : '开启接线', false,
        this.busy || !this.paired || this.targetTitle.length === 0, () => {
          this.toggleEnabled();
        })
      if (this.paired) {
        this.opButton('移除绑定', true, this.busy || this.bridgeEnabled, () => {
          this.confirmDisconnect = true;
        })
      }
    }
    .width('100%')
  }

  /** 扫码绑定卡：白底二维码 + 状态提示 + 确认码输入 + 取消 */
  @Builder
  pairingCard() {
    Column({ space: 12 }) {
      if (this.qrPixel !== undefined) {
        Image(this.qrPixel)
          .width(220)
          .height(220)
          .objectFit(ImageFit.Contain)
          .borderRadius(16)
          .backgroundColor('#FFFFFF')
          .padding(8)
      } else if (this.pairingQrPath.length > 0) {
        Image(this.pairingQrPath)
          .width(220)
          .height(220)
          .objectFit(ImageFit.Contain)
          .borderRadius(16)
          .backgroundColor('#FFFFFF')
          .padding(8)
      } else {
        Text('二维码暂不可显示，请在电脑端扫码')
          .fontSize(12.5)
          .fontColor(this.subColor())
      }
      Text(this.pairingStatus === 'scaned' || this.pairingStatus === 'scaned_but_redirect'
        ? '已扫码，请在微信中确认'
        : '请用微信扫一扫扫描二维码并确认')
        .fontSize(12.5)
        .fontColor(this.subColor())
        .textAlign(TextAlign.Center)
      if (this.pairingStatus === 'need_verifycode') {
        Row({ space: 10 }) {
          TextInput({ placeholder: '输入微信确认码', text: this.verifyCode })
            .fontSize(14)
            .height(42)
            .layoutWeight(1)
            .borderRadius(12)
            .backgroundColor(this.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(16,19,24,0.05)')
            .onChange((value: string) => {
              this.verifyCode = value;
            })
          Text('提交')
            .fontSize(13.5)
            .fontColor('#FFFFFF')
            .height(42)
            .padding({ left: 16, right: 16 })
            .borderRadius(12)
            .backgroundColor(this.ocean())
            .onClick(() => {
              this.submitVerify();
            })
        }
        .width('100%')
      }
      Text('取消绑定流程')
        .fontSize(13)
        .fontColor(this.ocean())
        .onClick(() => {
          this.cancelLogin();
        })
    }
    .width('100%')
    .padding({ left: 18, right: 18, top: 18, bottom: 18 })
    .borderRadius(18)
    .backgroundColor(this.tileBg())
    .border({ width: 1, color: this.dividerColor() })
  }

  @Builder
  sections() {
    Column({ space: 12 }) {
      this.hero()
      if (this.error.length > 0) {
        Text(this.error)
          .fontSize(12.5)
          .fontColor(this.dangerColor())
          .width('100%')
          .padding({ left: 14, right: 14, top: 10, bottom: 10 })
          .borderRadius(12)
          .backgroundColor('rgba(196,72,72,0.10)')
      }
      if (!this.supported && this.loaded) {
        Text('当前网关未提供 ClawBot 控制能力，请重启升级后的 DSH 后重连。')
          .fontSize(12.5)
          .fontColor(this.subColor())
          .width('100%')
      }
      if (this.loaded) {
        this.tiles()
      }
      if (this.message.length > 0) {
        Text(this.message)
          .fontSize(12)
          .fontColor(this.subColor())
          .width('100%')
      }
      if (this.loaded) {
        this.ops()
      }
      if (this.pairingId.length > 0) {
        this.pairingCard()
      }
      Text('微信凭据只保存在电脑端；接线开启后，发给该微信的私聊会转交给所选 DSH 会话。')
        .fontSize(11.5)
        .fontColor(this.subColor())
        .lineHeight(17)
        .width('100%')
    }
    .width('100%')
  }

  @Builder
  sessionsSheet() {
    Stack({ alignContent: Alignment.Bottom }) {
      Column()
        .width('100%')
        .height('100%')
        .backgroundColor(this.isDark ? 'rgba(0,0,0,0.45)' : 'rgba(16,19,24,0.25)')
        .onClick(() => {
          this.sessionsOpen = false;
        })
      Column({ space: 0 }) {
        Row() {
          Text('选择接入会话')
            .fontSize(16)
            .fontWeight(FontWeight.Medium)
            .fontColor(this.textColor())
          Blank()
          Text('关闭')
            .fontSize(13.5)
            .fontColor(this.subColor())
            .onClick(() => {
              this.sessionsOpen = false;
            })
        }
        .width('100%')
        .height(52)
        .padding({ left: 18, right: 18 })
        if (this.sessionsLoading) {
          Row({ space: 8 }) {
            LoadingProgress().width(18).height(18).color(this.ocean())
            Text('正在读取会话…').fontSize(13).fontColor(this.subColor())
          }
          .padding({ left: 18, right: 18, top: 8, bottom: 12 })
        }
        List({ space: 8 }) {
          ForEach(this.sessions, (one: ClawbotSession) => {
            ListItem() {
              Row() {
                Column({ space: 3 }) {
                  Text(one.title.length > 0 ? one.title : one.id)
                    .fontSize(14)
                    .fontColor(this.textColor())
                    .maxLines(2)
                    .textOverflow({ overflow: TextOverflow.Ellipsis })
                    .width('100%')
                  if (one.workspaceTitle.length > 0) {
                    Text(one.workspaceTitle)
                      .fontSize(11.5)
                      .fontColor(this.subColor())
                      .maxLines(1)
                      .textOverflow({ overflow: TextOverflow.Ellipsis })
                      .width('100%')
                  }
                }
                .alignItems(HorizontalAlign.Start)
                .layoutWeight(1)
                if (this.targetTitle.length > 0 && one.title === this.targetTitle) {
                  Text('✓').fontSize(14).fontColor(this.ocean())
                }
              }
              .width('100%')
              .constraintSize({ minHeight: 52 })
              .padding({ left: 16, right: 16, top: 10, bottom: 10 })
              .borderRadius(14)
              .backgroundColor(this.tileBg())
              .border({
                width: 1,
                color: this.targetTitle.length > 0 && one.title === this.targetTitle
                  ? this.ocean() : this.dividerColor()
              })
              .onClick(() => {
                this.chooseSession(one.id);
              })
            }
          }, (one: ClawbotSession) => one.id)
        }
        .layoutWeight(1)
        .width('100%')
        .padding({ left: 16, right: 16, bottom: 16 })
        .scrollBar(BarState.Off)
      }
      .width('100%')
      .height('64%')
      .backgroundColor(this.pageBg())
      .borderRadius({ topLeft: 22, topRight: 22 })
      .clip(true)
    }
    .width('100%')
    .height('100%')
  }

  @Builder
  disconnectConfirm() {
    Stack({ alignContent: Alignment.Center }) {
      Column()
        .width('100%')
        .height('100%')
        .backgroundColor(this.isDark ? 'rgba(0,0,0,0.45)' : 'rgba(16,19,24,0.25)')
      Column({ space: 12 }) {
        Text('移除微信绑定')
          .fontSize(16)
          .fontWeight(FontWeight.Medium)
          .fontColor(this.textColor())
        Text('这会移除此电脑端的本地绑定并停止未完成的微信渠道消息；已开始的 DSH 任务不会取消，也不会撤销微信账号侧的授权。')
          .fontSize(13)
          .fontColor(this.subColor())
          .lineHeight(19)
        Row({ space: 12 }) {
          Text('取消')
            .fontSize(14)
            .fontColor(this.textColor())
            .textAlign(TextAlign.Center)
            .layoutWeight(1)
            .height(42)
            .borderRadius(12)
            .backgroundColor(this.isDark ? 'rgba(255,255,255,0.10)' : 'rgba(16,19,24,0.06)')
            .onClick(() => {
              this.confirmDisconnect = false;
            })
          Text('移除绑定')
            .fontSize(14)
            .fontColor('#FFFFFF')
            .textAlign(TextAlign.Center)
            .layoutWeight(1)
            .height(42)
            .borderRadius(12)
            .backgroundColor('#C44848')
            .onClick(() => {
              this.disconnect();
            })
        }
        .width('100%')
      }
      .width('84%')
      .padding(18)
      .borderRadius(20)
      .backgroundColor(this.isDark ? '#1C1C1E' : '#FFFFFF')
    }
    .width('100%')
    .height('100%')
  }

  build() {
    NavDestination() {
      Stack({ alignContent: Alignment.TopStart }) {
        Column()
          .width('100%')
          .height(56 + this.topInset())
          .backdropBlur(12)
          .backgroundColor(Color.Transparent)
          .hitTestBehavior(HitTestMode.None)
        Column() {
          this.navBar()
          Scroll() {
            Column() {
              this.sections()
            }
            .width('100%')
            .alignItems(HorizontalAlign.Start)
            .padding({ left: 16, right: 16, top: 4, bottom: 40 })
          }
          .layoutWeight(1)
          .width('100%')
          .padding({ top: 56 + this.topInset() })
          .margin({ top: -(56 + this.topInset()) })
          .align(Alignment.TopStart)
          .scrollBar(BarState.Off)
        }
        .width('100%')
        .height('100%')
        .justifyContent(FlexAlign.Start)
        .alignItems(HorizontalAlign.Start)

        if (this.sessionsOpen) {
          this.sessionsSheet()
        }
        if (this.confirmDisconnect) {
          this.disconnectConfirm()
        }
      }
      .width('100%')
      .height('100%')
    }
    .hideTitleBar(true)
    .backgroundColor(this.pageBg())
  }
}
