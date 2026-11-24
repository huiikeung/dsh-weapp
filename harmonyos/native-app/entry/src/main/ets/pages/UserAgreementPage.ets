import { NavBackButton } from '../components/NavBackButton';
import { APP_DISPLAY_NAME, DEVELOPER_NAME, USER_AGREEMENT_EFFECTIVE_AT, USER_AGREEMENT_VERSION } from '../common/LegalDocs';
import { SETTINGS_MAX_WIDTH } from '../common/Responsive';

/** 协议章节 */
interface AgreementSection {
  id: string;
  title: string;
  paragraphs: string[];
}

/**
 * 用户协议二级页面（设置 → 关于 → 用户协议）。
 *
 * 排版与「隐私政策」二级页一致：头部卡片（产品名 + 标题 + 生效日期/版本 + 引言）
 * + 分章节卡片 + 联系方式卡片。
 *
 * 条款按鸿蒙版实际功能表述（与 App 内文案保持同一套名称）：
 *   应用名 = flukit（首页品牌标识；系统应用名显示为「鲸尾」）；
 *   电脑端 = DeepSeek Harness（DSH）+ 网关插件 dsh-plugin-weapp-gateway；
 *   配对码在 DSH WebUI「移动设备」面板生成；手机端在「设置 → 连接 → 管理」管理已配对节点；
 *   本版本没有独立账号体系与会员，公网访问 / Tailscale 内嵌隧道为可选功能。
 */
/** 应用名、开发者、生效日期、版本统一在 common/LegalDocs */
const AGREEMENT_INTRO: string =
  '欢迎使用' + APP_DISPLAY_NAME + '（以下简称「本应用」）。本应用由开发者 ' + DEVELOPER_NAME + ' 开发和运营。请你在使用前认真阅读本协议的全部条款；你下载、安装、启动或以任何方式使用本应用，即视为你已阅读并同意本协议。若你不同意本协议的任何内容，请立即停止使用并卸载本应用。';

const AGREEMENT_SECTIONS: AgreementSection[] = [
  {
    id: 'service',
    title: '一、服务说明',
    paragraphs: [
      '1. 本应用是一款远程控制工具：连接你在电脑端 DeepSeek Harness（DSH）中安装并启用的网关插件 dsh-plugin-weapp-gateway，让你在手机上查看和管理自己的会话。手机与电脑处于同一局域网时走局域网直连；公网通路在电脑端安装该插件后即已就绪，你开通公网访问服务后，即可通过公网连接你自己的电脑。',
      '2. 会话内容只在你手机与你自己的电脑之间传输，我们不存储、不备份你的会话内容；经托管公网中继转发的会话内容均为端到端加密，我们无法解密读取。我们还可能向你提供公网访问等增值服务，并为此在你的手机与我们的服务器之间传输必要的控制信息（详见《隐私政策》）。能否连接成功，取决于你的电脑、网络，以及电脑端的 DeepSeek Harness 与网关插件是否正常运行。',
      '3. 本应用可能因版本升级、系统兼容性调整而变更功能，功能变更我们会通过应用版本更新说明告知。'
    ]
  },
  {
    id: 'account',
    title: '二、账号与使用规范',
    paragraphs: [
      '1. 本应用不提供独立注册的账号，你无需登录即可使用局域网连接功能。公网访问服务与 Tailscale 内嵌隧道为可选功能：前者按应用内提示单独开通，后者如需使用可登录你自己的 Tailscale 账号。',
      '2. 你需要在电脑端 DeepSeek Harness WebUI 的「移动设备」面板生成配对码（二维码与 6 位数字码统称配对码），它是把手机连到你本人电脑的一次性凭据，请妥善保管、不要透露给他人；因泄露或保管不当造成的损失由你自行承担。配对码用后立即失效，二维码每次刷新都会更换，其他设备无法复用你已完成的配对。配对完成后，你可以在应用内「设置 → 连接 → 管理」中查看已配对的节点并移除本机配对信息；已连接本电脑的可信设备列表可在电脑端的「移动设备」面板中查看，并可随时移除其中任意一台，被移除的手机必须重新配对才能再次连接到你的电脑。公网通道只对已完成配对的手机开放。',
      '3. 你承诺仅在你自己拥有所有权或已获得合法授权的设备与网络上使用本应用。',
      '4. 你不得利用本应用从事任何违法违规活动，包括但不限于：侵入他人网络或设备、未经授权获取他人数据、传播违法信息、侵犯他人合法权益。',
      '5. 你不得对本应用进行反向工程、反编译、破解、篡改，也不得制作、发布或传播其衍生版本（法律法规另有规定的除外）。'
    ]
  },
  {
    id: 'liability',
    title: '三、免责与责任限制',
    paragraphs: [
      '1. 本应用按「现状」提供。在法律允许的最大范围内，我们不对服务的及时性、安全性、准确性作出任何明示或默示的保证。',
      '2. 因下列原因导致的服务中断、数据丢失或其它损失，我们不承担责任：① 你的网络或设备故障；② 电脑端 DeepSeek Harness 或网关插件本身的问题；③ 你误操作或未妥善保管配对码；④ 公网通路（含 Tailscale 隧道与中继服务器链路）出现中断、延迟或抖动；⑤ 不可抗力或第三方原因。',
      '3. 在法律允许的最大范围内，我们对你承担的全部赔偿责任，以你为使用本应用而实际支付的费用为上限；本应用的局域网功能免费提供。'
    ]
  },
  {
    id: 'ip',
    title: '四、知识产权',
    paragraphs: [
      '1. 本应用的界面设计、图标、文案与程序代码等知识产权归开发者 ' + DEVELOPER_NAME + ' 所有，受法律保护。',
      '2. 未经书面许可，你不得复制、修改、分发、出租或出售本应用或其任何部分。'
    ]
  },
  {
    id: 'changes',
    title: '五、协议变更与终止',
    paragraphs: [
      '1. 我们有权根据功能更新或法律法规要求修订本协议，修订后的协议在本页面公布即生效；你继续使用本应用，即视为接受修订后的内容。',
      '2. 你可以随时通过卸载本应用终止本协议。',
      '3. 若你违反本协议，我们有权停止向你提供本应用相关服务。'
    ]
  },
  {
    id: 'dispute',
    title: '六、争议解决',
    paragraphs: [
      '1. 本协议的订立、效力、解释与争议解决均适用中华人民共和国法律。',
      '2. 因本协议产生的争议，双方应先友好协商解决；协商不成的，任何一方可向开发者住所地有管辖权的人民法院提起诉讼。'
    ]
  }
];

@Component
export struct UserAgreementPage {
  @Consume('pageStack') pageStack: NavPathStack;
  @StorageLink('isDark') isDark: boolean = false;
  @StorageLink('safeTopVp') safeTopStorage: number = 0;
  @StorageLink('safeBottomVp') safeBottomStorage: number = 0;

  private topInset(): number {
    return this.safeTopStorage > 0 ? this.safeTopStorage : 38.9;
  }

  private pageBg(): string {
    return this.isDark ? '#000000' : '#F2F2F7';
  }

  private cardBg(): string {
    return this.isDark ? '#1C1C1E' : '#FFFFFF';
  }

  private textColor(): string {
    return this.isDark ? '#F1F4FA' : '#10131A';
  }

  private subColor(): string {
    return this.isDark ? 'rgba(241,244,250,0.55)' : 'rgba(16,19,24,0.55)';
  }

  private accentColor(): string {
    return '#2E6BE6';
  }

  /** 导航：返回 + 居中标题（与其它二级页一致） */
  @Builder
  navBar() {
    // 与一级页（设置）一致：玻璃底覆盖「状态栏 + 导航栏」整条，内容从下方滚过时透出模糊
    Stack({ alignContent: Alignment.TopStart }) {
      Column()
        .width('100%')
        .height(56 + this.topInset())
        .backdropBlur(12)
        .backgroundColor(Color.Transparent)
        .hitTestBehavior(HitTestMode.None)

      Row() {
        NavBackButton({ isDark: this.isDark })
          .onClick(() => {
            this.pageStack.pop();
          })
        Text('用户协议')
          .fontSize(17)
          .fontWeight(FontWeight.Medium)
          .fontColor(this.textColor())
          .layoutWeight(1)
          .textAlign(TextAlign.Center)
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
        Row().width(44).height(44)
      }
      .width('100%')
      .height(56)
      .padding({ left: 16, right: 16 })
      .margin({ top: this.topInset() })
    }
    .width('100%')
    .zIndex(10)
  }

  /** iOS 分组 footer 说明 */
  @Builder
  groupFooter(text: string) {
    Text(text)
      .fontSize(12)
      .lineHeight(18)
      .fontColor(this.subColor())
      .width('100%')
      .padding({ left: 2, right: 2, top: 8 })
  }

  /** 头部卡片：产品名 + 标题 + 生效日期/版本 + 引言 */
  @Builder
  introCard() {
    Column({ space: 10 }) {
      Text(APP_DISPLAY_NAME)
        .fontSize(12)
        .fontWeight(FontWeight.Medium)
        .fontColor(this.accentColor())
      Text('用户协议')
        .fontSize(22)
        .fontWeight(FontWeight.Bold)
        .fontColor(this.textColor())
      Text('生效日期：' + USER_AGREEMENT_EFFECTIVE_AT + '    版本：' + USER_AGREEMENT_VERSION)
        .fontSize(12)
        .fontColor(this.subColor())
      Text(AGREEMENT_INTRO)
        .fontSize(14)
        .lineHeight(23)
        .fontColor(this.textColor())
        .width('100%')
        .copyOption(CopyOptions.LocalDevice)
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
    .padding({ left: 16, right: 16, top: 16, bottom: 16 })
    .backgroundColor(this.cardBg())
    .borderRadius(14)
  }

  /** 章节卡片：标题 + 条款段落 */
  @Builder
  sectionCard(section: AgreementSection) {
    Column({ space: 10 }) {
      Text(section.title)
        .fontSize(16)
        .fontWeight(FontWeight.Bold)
        .fontColor(this.textColor())
        .width('100%')
      ForEach(section.paragraphs, (paragraph: string) => {
        Text(paragraph)
          .fontSize(14)
          .lineHeight(23)
          .fontColor(this.textColor())
          .width('100%')
          .copyOption(CopyOptions.LocalDevice)
      }, (paragraph: string) => paragraph)
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
    .padding({ left: 16, right: 16, top: 16, bottom: 16 })
    .backgroundColor(this.cardBg())
    .borderRadius(14)
    .margin({ top: 12 })
  }

  /** 联系方式卡片（七、联系我们） */
  @Builder
  contactCard() {
    Column({ space: 10 }) {
      Text('七、联系我们')
        .fontSize(16)
        .fontWeight(FontWeight.Bold)
        .fontColor(this.textColor())
        .width('100%')
      Row() {
        Text('开发者 / 运营者')
          .fontSize(14)
          .fontColor(this.subColor())
        Blank()
        Text(DEVELOPER_NAME)
          .fontSize(14)
          .fontColor(this.textColor())
          .copyOption(CopyOptions.LocalDevice)
      }
      .width('100%')
      Row() {
        Text('联系邮箱')
          .fontSize(14)
          .fontColor(this.subColor())
        Blank()
        Text('wo.nbplus@qq.com')
          .fontSize(14)
          .fontColor(this.accentColor())
          .copyOption(CopyOptions.LocalDevice)
      }
      .width('100%')
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
    .padding({ left: 16, right: 16, top: 16, bottom: 16 })
    .backgroundColor(this.cardBg())
    .borderRadius(14)
    .margin({ top: 12 })
  }

  build() {
    NavDestination() {
      Stack({ alignContent: Alignment.TopStart }) {
        Scroll() {
          Column({ space: 0 }) {
            this.introCard()
            ForEach(AGREEMENT_SECTIONS, (section: AgreementSection) => {
              this.sectionCard(section)
            }, (section: AgreementSection) => section.id)
            this.contactCard()
            this.groupFooter('继续使用本应用即表示你已阅读并同意本协议。')
          }
          .width('100%')
          // 顶部让出玻璃导航高度，内容可滚到导航下方
          .padding({ left: 16, right: 16, top: 56 + this.topInset() + 8, bottom: this.safeBottomStorage > 0 ? this.safeBottomStorage + 24 : 36 })
        }
        .width('100%')
        .height('100%')
        .align(Alignment.Top)
        .scrollBar(BarState.Off)
        .edgeEffect(EdgeEffect.None)
        // 平板/宽屏：设置内容居中一栏（对齐 iOS iPad 设置页）
        .constraintSize({ maxWidth: SETTINGS_MAX_WIDTH })

        this.navBar()
      }
      .width('100%')
      .height('100%')
      .backgroundColor(this.pageBg())
    }
    .hideTitleBar(true)
    .backgroundColor(this.pageBg())
  }
}
