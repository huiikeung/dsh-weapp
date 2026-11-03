import { common } from '@kit.AbilityKit';
import { scanBarcode, scanCore } from '@kit.ScanKit';
import {
  GatewayClient, GatewayProfile, PairingResult, parsePairingPayload, ThemeManager, ThemeMode
} from 'nativecore';

interface ThemeOption {
  key: string;
  title: string;
  subtitle: string;
}

@Component
export struct SettingsPage {
  @StorageLink('isDark') isDark: boolean = false;
  @StorageLink('themeMode') themeMode: string = 'system';
  @StorageLink('connectionState') connection: string = 'disconnected';
  @State wsUrl: string = 'ws://10.0.2.2:3081/ws/mobile';
  @State payloadText: string = '';
  @State pairCode: string = '';
  @State connectHint: string = '';
  @StorageLink('pairingHint') pairingHint: string = '';
  @StorageLink('gatewayName') gatewayName: string = '';
  @StorageLink('publicAccessState') publicAccessState: string = '未连接';
  @StorageLink('transportKind') transportKind: string = '';

  private options: ThemeOption[] = [
    { key: 'system', title: '跟随系统', subtitle: '随系统深浅色切换' },
    { key: 'light', title: '浅色', subtitle: '始终使用浅色外观' },
    { key: 'dark', title: '深色', subtitle: '始终使用深色外观' }
  ];

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
    return this.isDark ? 'rgba(241, 244, 250, 0.62)' : 'rgba(16, 19, 24, 0.62)';
  }

  private fieldBg(): string {
    return this.isDark ? '#2C2C2E' : '#FFFFFF';
  }

  build() {
    NavDestination() {
      Scroll() {
        Column({ space: 14 }) {
          Text('外观')
            .fontSize(13)
            .fontColor(this.subColor())
            .width('100%')
            .padding({ left: 4 })

          Column() {
            ForEach(this.options, (option: ThemeOption, index: number) => {
              this.themeRow(option, index)
            }, (option: ThemeOption) => option.key)
          }
          .width('100%')
          .borderRadius(18)
          .backgroundColor(this.cardBg())

          Text('连接（调试用）')
            .fontSize(13)
            .fontColor(this.subColor())
            .width('100%')
            .padding({ left: 4, top: 8 })

          Column({ space: 10 }) {
            Button('扫码配对（DSH 插件二维码）')
              .width('100%')
              .height(42)
              .backgroundColor('#2E6BE6')
              .onClick(() => {
                this.scanPairing();
              })
            TextInput({ text: this.payloadText, placeholder: '粘贴配对载荷（Base64）' })
              .onChange((value: string) => {
                this.payloadText = value;
              })
              .fontSize(12)
              .fontColor(this.textColor())
              .backgroundColor(this.fieldBg())
              .borderRadius(10)
            Button('用配对载荷连接')
              .width('100%')
              .height(40)
              .backgroundColor('#34C759')
              .onClick(() => {
                this.connectByPayload();
              })
            TextInput({ text: this.wsUrl, placeholder: 'wss://…' })
              .onChange((value: string) => {
                this.wsUrl = value;
              })
              .fontSize(13)
              .fontColor(this.textColor())
              .backgroundColor(this.fieldBg())
              .borderRadius(10)
            TextInput({ text: this.pairCode, placeholder: '配对码（可空）' })
              .onChange((value: string) => {
                this.pairCode = value;
              })
              .fontSize(13)
              .fontColor(this.textColor())
              .backgroundColor(this.fieldBg())
              .borderRadius(10)
            Row({ space: 10 }) {
              Button('连接')
                .layoutWeight(1)
                .height(40)
                .backgroundColor('#2E6BE6')
                .onClick(() => {
                  this.connect();
                })
              Button('断开')
                .layoutWeight(1)
                .height(40)
                .backgroundColor('#8E8E93')
                .onClick(() => {
                  GatewayClient.get().disconnect();
                  this.connectHint = '已断开';
                })
            }
            if (this.connectHint.length > 0) {
              Text(this.connectHint)
                .fontSize(12)
                .fontColor(this.subColor())
            }
            if (this.pairingHint.length > 0) {
              Text(this.pairingHint)
                .fontSize(12)
                .fontColor(this.subColor())
            }
            Row({ space: 10 }) {
              Text(this.gatewayName.length > 0 ? ('网关：' + this.gatewayName) : '未保存网关')
                .fontSize(12)
                .fontColor(this.subColor())
                .layoutWeight(1)
              Button('忘记网关')
                .height(32)
                .fontSize(12)
                .backgroundColor('#8E8E93')
                .onClick(() => {
                  GatewayClient.get().forgetSaved();
                  this.connectHint = '已清除本地凭据';
                })
            }
            .width('100%')
          }
          .width('100%')
          .padding(16)
          .borderRadius(18)
          .backgroundColor(this.cardBg())

          Text('关于')
            .fontSize(13)
            .fontColor(this.subColor())
            .width('100%')
            .padding({ left: 4, top: 8 })

          Column() {
            this.infoRow('连接状态', this.connection)
            this.infoRow('连接方式', this.transportKind === 'relay' ? '公网中继（E2EE）'
              : (this.transportKind === 'direct' ? '直连网关' : '—'))
            this.infoRow('公网状态', this.publicAccessState)
            this.infoRow('工程类型', 'HarmonyOS 原生（ArkTS）')
            this.infoRow('版本', '1.0.0')
          }
          .width('100%')
          .borderRadius(18)
          .backgroundColor(this.cardBg())
        }
        .width('100%')
        .padding(16)
      }
      .width('100%')
      .height('100%')
      .scrollBar(BarState.Off)
    }
    .title('设置')
    .backgroundColor(this.pageBg())
  }

  private async scanPairing(): Promise<void> {
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
        this.connectHint = parsed.error;
        return;
      }
      this.connectHint = '读取到配对信息，正在连接…';
      GatewayClient.get().connectPairing(parsed);
    } catch (err) {
      this.connectHint = '扫码已取消或失败';
    }
  }

  private connectByPayload(): void {
    const raw: string = this.payloadText.trim();
    if (raw.length === 0) {
      this.connectHint = '请先粘贴配对载荷';
      return;
    }
    try {
      const parsed = parsePairingPayload(raw);
      if (!parsed.ok) {
        this.connectHint = '载荷无效：' + parsed.error;
        return;
      }
      this.connectHint = '解析成功，候选地址 ' + parsed.candidates.length + ' 个，正在连接…';
      GatewayClient.get().connectPairing(parsed);
    } catch (err) {
      this.connectHint = '载荷解析失败';
    }
  }

  private connect(): void {
    if (this.wsUrl.trim().length === 0) {
      this.connectHint = '请填写 wss 地址';
      return;
    }
    const profile: GatewayProfile = {
      wsUrl: this.wsUrl.trim(),
      pairCode: this.pairCode.trim(),
      leaseToken: '',
      inviteToken: '',
      accessToken: ''
    };
    GatewayClient.get().connect(profile);
    this.connectHint = '正在连接…';
  }

  @Builder
  themeRow(option: ThemeOption, index: number) {
    Column() {
      Row() {
        Column({ space: 4 }) {
          Text(option.title)
            .fontSize(16)
            .fontColor(this.textColor())
          Text(option.subtitle)
            .fontSize(12)
            .fontColor(this.subColor())
        }
        .alignItems(HorizontalAlign.Start)
        .layoutWeight(1)

        if (this.themeMode === option.key) {
          Text('✓')
            .fontSize(18)
            .fontColor('#2E6BE6')
        }
      }
      .width('100%')
      .padding({ left: 16, right: 16, top: 14, bottom: 14 })
      .onClick(() => {
        ThemeManager.get().setMode(option.key as ThemeMode);
      })

      if (index < this.options.length - 1) {
        Divider()
          .color(this.isDark ? 'rgba(241, 244, 250, 0.10)' : 'rgba(16, 19, 24, 0.08)')
          .margin({ left: 16, right: 16 })
      }
    }
    .width('100%')
  }

  @Builder
  infoRow(title: string, value: string) {
    Row() {
      Text(title)
        .fontSize(15)
        .fontColor(this.textColor())
      Blank()
      Text(value)
        .fontSize(13)
        .fontColor(this.subColor())
    }
    .width('100%')
    .padding({ left: 16, right: 16, top: 14, bottom: 14 })
  }
}
