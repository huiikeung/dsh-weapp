import { uiMaterial } from '@kit.ArkUI';
import { APP_DISPLAY_NAME } from '../common/LegalDocs';

/**
 * 同意弹窗的材质：与「切换主机」半模态同一套沉浸光感（旧系统降级为普通弹窗）。
 * 控制器要在 Index 的成员初始化里创建，不能用 this，所以深浅色从 AppStorage 取。
 */
export function consentDialogMaterial(): uiMaterial.Material | undefined {
  try {
    if (!uiMaterial.isImmersiveMaterialSupported()) {
      return undefined;
    }
    const dark: boolean = AppStorage.get<boolean>('isDark') ?? false;
    return new uiMaterial.ImmersiveMaterial({
      style: uiMaterial.ImmersiveStyle.THICK,
      materialColor: dark ? 'rgba(255,255,255,0.02)' : 'rgba(255,255,255,0.34)',
      colorInvert: true,
      applyShadow: true
    });
  } catch (err) {
    return undefined;
  }
}

/**
 * 首次启动隐私同意弹窗的内容。
 *
 * 容器由系统 CustomDialog 提供（沉浸光感材质 + 系统圆角/阴影，见 Index 的 showConsentDialog），
 * 这里只排版内容：标题 / 三条要点 / 带链接的协议说明 / 两个按钮。
 */
@Component
export struct PrivacyConsentDialog {
  @StorageLink('isDark') isDark: boolean = false;
  /** 点「同意并继续」 */
  onAgree: () => void = () => {
  };
  /** 点「不同意」 */
  onDisagree: () => void = () => {
  };
  /** 点协议链接，参数是二级页路由名（user-agreement / privacy-policy） */
  onOpenDoc: (route: string) => void = () => {
  };

  private textColor(): string {
    return this.isDark ? '#F1F4FA' : '#10131A';
  }

  private bodyColor(): string {
    return this.isDark ? 'rgba(241,244,250,0.82)' : 'rgba(16,19,24,0.80)';
  }

  private subColor(): string {
    return this.isDark ? 'rgba(241,244,250,0.50)' : 'rgba(16,19,24,0.48)';
  }

  /** 一条要点：圆点 + 文字 */
  @Builder
  point(text: string) {
    Row({ space: 8 }) {
      Circle({ width: 5, height: 5 })
        .fill('#2E6BE6')
        .margin({ top: 8.5 })
      Text(text)
        .fontSize(14)
        .lineHeight(22)
        .fontColor(this.bodyColor())
        .layoutWeight(1)
    }
    .width('100%')
    .alignItems(VerticalAlign.Top)
  }

  build() {
    Column({ space: 14 }) {
      Text('欢迎使用' + APP_DISPLAY_NAME)
        .fontSize(20)
        .fontWeight(FontWeight.Bold)
        .fontColor(this.textColor())
        .width('100%')
      Column({ space: 8 }) {
        this.point('用于连接你自己的电脑：会话内容只在手机与电脑之间传输，我们不存储、不备份。')
        this.point('配对信息与凭据仅保存在本机；相机、麦克风、通知等权限在你使用对应功能时才申请。')
        this.point('对话内容由 AI 生成，仅供参考，请自行甄别。')
      }
      .width('100%')
      .alignItems(HorizontalAlign.Start)

      Text() {
        Span('请阅读').fontColor(this.bodyColor())
        Span('《用户协议》')
          .fontColor('#2E6BE6')
          .onClick(() => {
            this.onOpenDoc('user-agreement');
          })
        Span('和').fontColor(this.bodyColor())
        Span('《隐私政策》')
          .fontColor('#2E6BE6')
          .onClick(() => {
            this.onOpenDoc('privacy-policy');
          })
        Span('。点击「同意并继续」表示你已阅读并同意上述协议。').fontColor(this.bodyColor())
      }
      .fontSize(13)
      .lineHeight(20)
      .width('100%')

      Row({ space: 12 }) {
        Text('不同意')
          .fontSize(16)
          .fontWeight(FontWeight.Medium)
          .fontColor(this.textColor())
          .textAlign(TextAlign.Center)
          .height(46)
          .layoutWeight(1)
          .borderRadius(12)
          .backgroundColor(this.isDark ? 'rgba(255,255,255,0.10)' : 'rgba(16,19,24,0.06)')
          .onClick(() => {
            this.onDisagree();
          })
        Text('同意并继续')
          .fontSize(16)
          .fontWeight(FontWeight.Medium)
          .fontColor('#FFFFFF')
          .textAlign(TextAlign.Center)
          .height(46)
          .layoutWeight(1.6)
          .borderRadius(12)
          .backgroundColor('#2E6BE6')
          .onClick(() => {
            this.onAgree();
          })
      }
      .width('100%')
      .alignItems(VerticalAlign.Center)
      .margin({ top: 4 })

      Text('上述协议可随时在「设置 → 关于」中再次查看。')
        .fontSize(12)
        .fontColor(this.subColor())
        .width('100%')
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
    // 实测：系统弹窗容器（玻璃卡片）本身没有内边距，内容区 = 整张卡片。
    // 留白必须在这里自己加，否则文字和按钮顶到圆角上会被裁掉。
    .padding({ left: 24, right: 24, top: 24, bottom: 20 })
  }
}
