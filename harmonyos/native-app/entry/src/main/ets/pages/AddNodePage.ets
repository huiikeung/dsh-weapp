import { common } from '@kit.AbilityKit';
import { KeyboardAvoidMode } from '@kit.ArkUI';
import { pasteboard } from '@kit.BasicServicesKit';
import { scanBarcode, scanCore } from '@kit.ScanKit';
import {
  GatewayClient, PairingResult, parsePairingPayload
} from 'nativecore';

@Component
export struct AddNodePage {
  @Consume('pageStack') pageStack: NavPathStack;
  @StorageLink('isDark') isDark: boolean = false;
  @StorageLink('safeTopVp') safeTopStorage: number = 0;
  @State step: number = 0;
  @State scanning: boolean = false;
  @State copied: boolean = false;
  @State pairError: string = '';
  @State sheetOpen: boolean = false;
  @State manualText: string = '';
  @State manualHint: string = '';

  private textColor(): string {
    return this.isDark ? '#F1F4FA' : '#101318';
  }

  private text2(): string {
    return this.isDark ? 'rgba(241,244,250,0.62)' : 'rgba(16,19,24,0.62)';
  }

  private surface(): string {
    return this.isDark ? 'rgba(255,255,255,0.06)' : '#FFFFFF';
  }

  private fill(): string {
    return this.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(16,19,24,0.05)';
  }

  private pluginName(): string {
    return 'dsh-plugin-weapp-gateway';
  }

  @Builder
  stepDot(i: number) {
    if (i > 0) {
      Column()
        .width(48)
        .height(2)
        .borderRadius(999)
        .backgroundColor(i <= this.step ? '#4C6CE0' : 'rgba(120,120,128,0.22)')
        .margin({ left: 9, right: 9 })
    }
    Circle({ width: 7, height: 7 })
      .fill(i <= this.step ? '#4C6CE0' : 'rgba(120,120,128,0.22)')
  }

  @Builder
  cardStep(no: string, title: string, text: string) {
    Column({ space: 8 }) {
      Row({ space: 8 }) {
        Text(no)
          .fontSize(12)
          .fontWeight(FontWeight.Bold)
          .fontColor('#4C6CE0')
          .width(22)
          .height(22)
          .textAlign(TextAlign.Center)
          .borderRadius(11)
          .backgroundColor(this.isDark ? 'rgba(76,108,224,0.18)' : 'rgba(76,108,224,0.12)')
        Text(title)
          .fontSize(16)
          .fontWeight(FontWeight.Medium)
          .fontColor(this.textColor())
      }
      .width('100%')
      Text(text)
        .fontSize(13)
        .fontColor(this.text2())
        .lineHeight(21)
        .width('100%')
    }
    .width('100%')
    .padding(14)
    .borderRadius(14)
    .backgroundColor(this.surface())
    .shadow({ radius: 12, color: 'rgba(23,42,84,0.06)', offsetY: 3 })
    .margin({ top: 12 })
  }

  @Builder
  cardStep1(title: string, text: string) {
    Column({ space: 8 }) {
      Row({ space: 8 }) {
        Text('1')
          .fontSize(12)
          .fontWeight(FontWeight.Bold)
          .fontColor('#4C6CE0')
          .width(22)
          .height(22)
          .textAlign(TextAlign.Center)
          .borderRadius(11)
          .backgroundColor(this.isDark ? 'rgba(76,108,224,0.18)' : 'rgba(76,108,224,0.12)')
        Text(title)
          .fontSize(16)
          .fontWeight(FontWeight.Medium)
          .fontColor(this.textColor())
      }
      .width('100%')
      Text(text)
        .fontSize(13)
        .fontColor(this.text2())
        .lineHeight(21)
        .width('100%')
      // 插件名 + 复制（放在卡片内部）
      Row({ space: 8 }) {
        Text(this.pluginName())
          .fontSize(13)
          .fontColor(this.textColor())
          .layoutWeight(1)
        if (this.copied) {
          Text('已复制')
            .fontSize(11)
            .fontColor('#34C759')
        }
        Image($r('app.media.copy_gray'))
          .width(16)
          .height(16)
          .objectFit(ImageFit.Contain)
          .onClick(() => {
            this.copyPluginName();
          })
      }
      .width('100%')
      .padding({ left: 11, right: 11, top: 10, bottom: 10 })
      .borderRadius(9)
      .backgroundColor(this.fill())
    }
    .width('100%')
    .padding(14)
    .borderRadius(14)
    .backgroundColor(this.surface())
    .shadow({ radius: 12, color: 'rgba(23,42,84,0.06)', offsetY: 3 })
    .margin({ top: 12 })
  }

  @Builder
  scanIconSmall() {
    Stack() {
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
      this.scanFindSmall(2.9, 2.9)
      this.scanFindSmall(7.9, 2.9)
      this.scanFindSmall(2.9, 7.9)
      Circle({ width: 1.85, height: 1.85 }).fill('#FFFFFF').position({ x: 7.9, y: 7.9 })
      Circle({ width: 1.85, height: 1.85 }).fill('#FFFFFF').position({ x: 10.25, y: 7.9 })
      Circle({ width: 1.85, height: 1.85 }).fill('#FFFFFF').position({ x: 7.9, y: 10.25 })
      Circle({ width: 1.85, height: 1.85 }).fill('#FFFFFF').position({ x: 10.25, y: 10.25 })
    }
    .width(15)
    .height(15)
  }

  @Builder
  scanFindSmall(x: number, y: number) {
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

  build() {
    NavDestination() {
      Column() {
        // 导航
        Row() {
          Text('‹')
            .fontSize(26)
            .fontColor(this.textColor())
            .width(40)
            .height(40)
            .textAlign(TextAlign.Center)
            .onClick(() => {
              this.pageStack.pop();
            })
          Blank()
          Text('添加节点')
            .fontSize(17)
            .fontWeight(FontWeight.Bold)
            .fontColor(this.textColor())
          Blank()
          Row().width(40)
        }
        .width('100%')
        .height(48)
        .padding({ left: 8, right: 8 })
        .margin({ top: this.safeTopStorage > 0 ? this.safeTopStorage : 38.9 })

        // 进度点
        Row() {
          this.stepDot(0)
          this.stepDot(1)
        }
        .width('100%')
        .justifyContent(FlexAlign.Center)
        .padding({ top: 2, bottom: 0 })

        Scroll() {
          Column() {
            if (this.step === 0) {
              Column() {
                Text('电脑端准备')
                  .fontSize(22)
                  .fontWeight(FontWeight.Bold)
                  .fontColor(this.textColor())
                Text('在电脑上完成三步，再用手机扫码配对。')
                  .fontSize(13)
                  .fontColor(this.text2())
                  .lineHeight(21)
                  .margin({ top: 8 })
                this.cardStep1('安装微信连接插件',
                  '打开 DSH 桌面端，在「插件 → 添加插件」中输入下方名称，安装并启用。带插件管理器的 Web 端也可这样安装。')
                this.cardStep('2', '确认插件已生效',
                  '按安装结果提示操作；若提示需要重启，请保存工作后正常重启对应的 DSH。已生效时无需重启，仅刷新 Web 网页不会重启服务。')
                this.cardStep('3', '显示小程序配对码',
                  '打开「微信连接」插件详情，或「设置 → 微信连接」，显示当前节点的小程序配对码。下一步用本应用扫码。')
              }
              .width('100%')
              .padding({ left: 16, right: 16, top: 0, bottom: 12 })
              .alignItems(HorizontalAlign.Start)

              Button('已完成，去配对')
                .width('calc(100% - 96vp)')
                .height(44)
                .fontSize(16)
                .fontWeight(FontWeight.Bold)
                .fontColor('#3D5ACB')
                .backgroundColor(this.isDark ? 'rgba(76,108,224,0.18)' : 'rgba(76,108,224,0.10)')
                .borderRadius(999)
                .border({ width: 1, color: 'rgba(76,108,224,0.55)' })
                .margin({ top: 16 })
                .alignSelf(ItemAlign.Center)
                .onClick(() => {
                  this.step = 1;
                })
            } else {
              Column() {
                Text('网关配对')
                  .fontSize(22)
                  .fontWeight(FontWeight.Bold)
                  .fontColor(this.textColor())
                Text('扫码绑定你的 Agent 节点，建立手机与电脑的安全连接。配对后支持同一局域网内安全直连，也支持公网连接。')
                  .fontSize(13)
                  .fontColor(this.text2())
                  .lineHeight(21)
                  .margin({ top: 8 })
              }
              .width('100%')
              .padding({ left: 16, right: 16, top: 0, bottom: 4 })
              .margin({ top: 0 })
              .alignItems(HorizontalAlign.Start)

              Column({ space: 10 }) {
                Row({ space: 8 }) {
                  Row() {
                    if (this.scanning) {
                      LoadingProgress().width(15).height(15).color(this.textColor())
                    } else {
                      this.scanIconSmall()
                    }
                  }
                  .width(20)
                  .height(20)
                  .justifyContent(FlexAlign.Center)
                  Text(this.scanning ? '正在连接…' : '扫描二维码')
                    .fontSize(16)
                    .fontWeight(FontWeight.Medium)
                    .fontColor(this.textColor())
                }
                .width('calc(100% - 96vp)')
                .height(44)
                .justifyContent(FlexAlign.Center)
                .borderRadius(999)
                .backgroundColor(this.fill())
                .onClick(() => {
                  this.scanNow();
                })
                Row({ space: 8 }) {
                  Row() {
                    Image($r('app.media.voice_keyboard'))
                      .width(20)
                      .height(20)
                      .objectFit(ImageFit.Contain)
                  }
                  .width(20)
                  .height(20)
                  .justifyContent(FlexAlign.Center)
                  Text('手动输入配对信息')
                    .fontSize(16)
                    .fontWeight(FontWeight.Medium)
                    .fontColor(this.textColor())
                }
                .width('calc(100% - 96vp)')
                .height(44)
                .justifyContent(FlexAlign.Center)
                .borderRadius(999)
                .backgroundColor(this.fill())
                .onClick(() => {
                  this.sheetOpen = true;
                  this.manualHint = '';
                })
                if (this.pairError.length > 0) {
                  Text(this.pairError)
                    .fontSize(12)
                    .fontColor('#FF6B60')
                }
              }
              .width('100%')
              .padding({ left: 16, right: 16 })
              .alignItems(HorizontalAlign.Center)

              Button('上一步')
                .width('calc(100% - 96vp)')
                .height(44)
                .fontSize(16)
                .fontWeight(FontWeight.Medium)
                .fontColor(this.text2())
                .backgroundColor(Color.Transparent)
                .margin({ top: 16 })
                .alignSelf(ItemAlign.Center)
                .onClick(() => {
                  this.step = 0;
                })
            }
          }
          .width('100%')
          .padding({ top: 14, bottom: 24 })
        }
        .layoutWeight(1)
        .align(Alignment.Top)
        .scrollBar(BarState.Off)
      }
      .width('100%')
      .height('100%')
      .padding({ left: 8, right: 8 })

      if (this.sheetOpen) {
        this.manualSheet()
      }
    }
    .hideTitleBar(true)
    .backgroundColor(this.isDark ? '#000000' : '#F2F2F7')
  }

  @Builder
  manualSheet() {
    Stack({ alignContent: Alignment.Bottom }) {
      Column()
        .width('100%')
        .height('100%')
        .backgroundColor('rgba(0,0,0,0.55)')
        .onClick(() => {
          this.sheetOpen = false;
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
              this.sheetOpen = false;
            })
        }
        .width('100%')
        .height(44)
        .alignItems(VerticalAlign.Center)
        Text('粘贴 Harness WebUI 提供的配对信息即可连接；长期设备 token 只会安全保存在本机。')
          .fontSize(12)
          .fontColor('rgba(255,255,255,0.55)')
          .width('100%')
          .margin({ bottom: 10 })
        Column() {
          Row() {
            Text('配对信息').fontSize(12).fontColor('rgba(255,255,255,0.55)')
            Blank()
            Text('清空')
              .fontSize(12)
              .fontColor('#7BA7F5')
              .onClick(() => {
                this.manualText = '';
              })
          }
          .width('100%')
          .padding({ left: 12, right: 12, top: 10 })
          TextArea({ text: this.manualText, placeholder: '粘贴 Base64URL 配对字符串或完整配对信息' })
            .height(110)
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
          Text(this.manualHint).fontSize(12).fontColor('#FF6B60').width('100%').margin({ top: 8 })
        }
        Button('连接')
          .width('100%')
          .height(46)
          .fontSize(15)
          .fontColor('#FFFFFF')
          .backgroundColor('#2E6BE6')
          .margin({ top: 12 })
          .onClick(() => {
            this.connectManual();
          })
      }
      .width('100%')
      .padding({ left: 14, right: 14, bottom: 20 })
      .borderRadius(18)
      .backgroundEffect({ radius: 4, saturation: 1, brightness: 1 })
      .linearGradient({
        angle: 165,
        colors: [['rgba(255,255,255,0.10)', 0], ['rgba(255,255,255,0.04)', 1]]
      })
      .border({ width: 1, color: 'rgba(255,255,255,0.38)' })
      .margin({ left: 12, right: 12, bottom: 24 })
    }
    .width('100%')
    .height('100%')
  }

  private copyPluginName(): void {
    const data: pasteboard.PasteData = pasteboard.createData(pasteboard.MIMETYPE_TEXT_PLAIN, this.pluginName());
    pasteboard.getSystemPasteboard().setData(data).then(() => {
      this.copied = true;
      setTimeout(() => {
        this.copied = false;
      }, 1500);
    }).catch(() => {
    });
  }

  private async scanNow(): Promise<void> {
    this.scanning = true;
    this.pairError = '';
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
        this.pairError = parsed.error;
        return;
      }
      GatewayClient.get().connectPairing(parsed);
      this.pageStack.pop();
    } catch (err) {
      this.pairError = '';
    } finally {
      this.scanning = false;
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
    this.sheetOpen = false;
    GatewayClient.get().connectPairing(parsed);
    this.pageStack.pop();
  }
}
