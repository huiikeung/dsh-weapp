import { NavBackButton } from '../components/NavBackButton';
import { PRIVACY_POLICY_UPDATED_AT } from '../common/LegalDocs';
import { SETTINGS_MAX_WIDTH } from '../common/Responsive';

/** 政策章节 */
interface PolicySection {
  id: string;
  title: string;
  paragraphs: string[];
}

/**
 * 隐私政策二级页面（设置 → 关于 → 隐私政策）。
 *
 * 原来是设置页内的一行弹层说明；现在改为导航二级页，排版参考小程序
 * components/privacy-sheet：更新日期 + 引言 + 分章节正文 + 联系入口 + 结尾声明。
 *
 * 内容按小程序 utils/privacy-policy.js 同步维护，并替换为鸿蒙版对应的表述：
 *   小程序存储 → 本机应用存储；微信授权 → 系统权限（相机/麦克风/通知）；
 *   微信客服入口 → 鸿蒙版「联系客服」说明；去掉小程序专属的虚拟支付/分享活动章节。
 */

const POLICY_INTRO: string =
  '本政策适用于 flukit 及其配套公网服务。应用通过网关插件 dsh-plugin-weapp-gateway 连接你自行配对的 DeepSeek Harness（DSH）节点，并非连接运营方统一提供的 AI 主机。隐私问题可通过「设置 → 关于 → 联系客服」提出。';

const POLICY_SECTIONS: PolicySection[] = [
  {
    id: 'conversation',
    title: '一、会话、文件与连接信息',
    paragraphs: [
      '你发送的消息、主动选择的图片和文件，以及工作区、工具执行和历史会话数据，在应用与你配对的 DSH 节点之间传输。节点可能按照你选择的模型和权限，将相关内容发送给模型服务商或其他工具服务；其处理范围与保存规则由节点配置和相应服务政策决定。请仅连接信任的节点。',
      '如你主动启用实验性微信 ClawBot 私聊接线，授权微信账号收到的私聊内容会由配对电脑上的网关内置接入服务提交到你选择的 DSH 会话，并按该会话的模型和权限处理。微信登录凭据及接入状态保存在电脑本地；应用仅通过已配对网关管理绑定、目标会话和启停状态，不接收或保存微信登录凭据。请勿通过此功能传入不适合交给该 DSH 节点或模型服务的数据。',
      '如你开启订阅提醒并在发送任务时同意系统通知授权，应用会向配套公网服务申请一次性通知凭据。配对网关在任务回合结束后提交该凭据、会话标识和完成状态，可选附带任务名称、时长、Token 消耗量和缓存命中率等统计指标；不会提交任务正文、文件或模型回复。公网服务仅保存凭据摘要、设备标识散列值、会话标识及处理状态，最长约3天后删除；会话标识用于通知点击后打开对应会话。',
      '配对信息、访问凭证、节点列表、外观偏好以及会话列表与正文缓存会保存在本机应用存储中，用于重新连接和展示历史记录。设备品牌、型号等信息也可能发送给所配对的网关，以识别已信任设备。请妥善保管配对信息，不要将密钥发布到公告或聊天群。',
      '托管公网中继使用端到端加密传输会话载荷，中继仍需处理路由标识、连接鉴权及网络连接信息。局域网连接和其他部署的加密能力取决于实际配置，不应认为所有连接都具备相同的保护。'
    ]
  },
  {
    id: 'permissions',
    title: '二、按功能使用的权限',
    paragraphs: [
      '扫码配对时按系统提示使用相机；添加附件时只处理你主动选择或拍摄的图片及文件。是否提供相关权限由你决定，不使用这些功能时无需提交这些内容。请避免上传包含无关人员隐私的信息。',
      '连接器功能（日历读写、位置与地图等）：默认关闭；仅在你主动开启对应连接器并通过系统授权后，应用才会读取或写入相应数据（如日历日程、位置信息），用于向你自行配对的电脑提供对应的连接器能力。你可以随时在「设置 → 连接器」关闭对应功能，或在系统设置中撤回相关授权。',
      '任务完成订阅提醒仅在你主动开启并通过系统授权后使用。复制设备ID等操作会按你的点击写入剪贴板。本应用不读取你的通讯录。',
      '语音输入默认关闭。开启后，仅在你主动按住说话并授权麦克风时录音；松手后音频通过当前配对连接发送给你的 DSH 官方语音输入插件。本地识别或云端识别由该插件的服务配置决定；云端服务按其隐私政策处理音频。上滑取消不会提交音频。应用读取完成或取消后清理临时录音，不将其保存为会话附件；识别文字先回填可编辑草稿，由你确认发送。你可随时在设置中关闭语音输入或在系统设置中撤回麦克风授权。',
      '如你启用 Tailscale 内嵌隧道，应用会在本机建立一个 Tailscale 节点用于访问你自己的 tailnet。登录凭据与节点私钥仅保存在本机；节点流量按 Tailscale 自身的服务条款与隐私政策处理。'
    ]
  },
  {
    id: 'storage',
    title: '三、保存与删除',
    paragraphs: [
      '本机缓存保存在应用私有存储中；账号、有效期等公网权益记录保存在配套公网服务中；DSH会话和工作区文件保存在你连接的节点及其使用的服务中。不同位置的数据需分别管理。',
      '「设置 → 存储空间」只清理本机会话列表和正文缓存，不删除节点聊天记录、配对凭证或公网权益。移除已配对节点可清除相应本机配对信息；如需撤销其他客户端访问，应同时在对应DSH网关中管理可信设备。',
      '你可以联系客服申请查询、更正、删除相关资料或停止使用账号，我们会核对身份并说明可处理的范围；节点或第三方服务中的数据需向相应管理方提出请求。'
    ]
  },
  {
    id: 'choices',
    title: '四、你的选择与联系方式',
    paragraphs: [
      '你可以停止使用可选功能、关闭订阅提醒、撤回系统权限或断开节点连接。撤回某项必要权限可能影响对应功能，但不应被解释为对其他功能的概括授权。',
      '如对数据处理有疑问，请使用「设置 → 关于 → 联系客服」，并说明涉及的设备ID及问题类型，不要提交访问密钥。未成年人应在监护人知情指导下使用，避免向模型、工具或公开内容中提交个人敏感信息。',
      '政策发生与实际功能有关的重要变化时，我们会更新本页并通过应用适当提示。阅读或关闭本页不会自动授予相机、麦克风等权限。'
    ]
  }
];

@Component
export struct PrivacyPolicyPage {
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

  private dividerColor(): string {
    return this.isDark ? 'rgba(255,255,255,0.10)' : 'rgba(16,19,24,0.08)';
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
        Text('隐私政策')
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

  /** iOS 分组标题 */
  @Builder
  groupTitle(title: string) {
    Text(title)
      .fontSize(13)
      .fontColor(this.subColor())
      .width('100%')
      .padding({ left: 2, right: 2, top: 18, bottom: 7 })
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

  /** 头部卡片：产品名 + 更新日期 + 引言 */
  @Builder
  introCard() {
    Column({ space: 10 }) {
      Text('flukit')
        .fontSize(12)
        .fontWeight(FontWeight.Medium)
        .fontColor('#2E6BE6')
      Text('隐私政策')
        .fontSize(22)
        .fontWeight(FontWeight.Bold)
        .fontColor(this.textColor())
      Text('更新日期：' + PRIVACY_POLICY_UPDATED_AT)
        .fontSize(12)
        .fontColor(this.subColor())
      Text(POLICY_INTRO)
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

  /** 章节卡片：标题 + 段落 */
  @Builder
  sectionCard(section: PolicySection) {
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

  build() {
    NavDestination() {
      Stack({ alignContent: Alignment.TopStart }) {
        Scroll() {
          Column({ space: 0 }) {
            this.introCard()
            ForEach(POLICY_SECTIONS, (section: PolicySection) => {
              this.sectionCard(section)
            }, (section: PolicySection) => section.id)

            // 联系入口（对齐小程序底部两个链接：平台隐私指引 / 联系客服）
            Column({ space: 0 }) {
              Row() {
                Text('联系隐私与客服支持')
                  .fontSize(15)
                  .fontColor(this.textColor())
                  .layoutWeight(1)
                Text('›')
                  .fontSize(20)
                  .fontColor(this.subColor())
              }
              .width('100%')
              .height(48)
              .padding({ left: 16, right: 16 })
              .onClick(() => {
                this.pageStack.pop();
              })
            }
            .width('100%')
            .backgroundColor(this.cardBg())
            .borderRadius(14)
            .margin({ top: 12 })

            this.groupFooter('关闭此页仅表示结束阅读，不代表同意授权。')
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
