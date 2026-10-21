# DshMobile 微信小程序版

DeepSeek Harness Mobile 的微信小程序客户端，界面与功能对齐 iOS 端
（`DeepSeekHarnessMobile/`），通过 `dsh-plugin-mobile-gateway` 的 WebSocket
协议连接 DeepSeek Harness。

## 多端目录与上传边界

- `miniprogram/`：微信小程序唯一源码/上传目录；开发者工具请直接导入此目录。
- `dsh-console/`：独立控制台、中继和服务端，部署路径保持不变。
- `harmonyos/`：鸿蒙原生工程。
- `native-app/`：Android/iOS 多端配置和资源；执行 `node scripts/prepare-native-app.cjs` 生成独立的 `generated-miniprogram/` 多端工程。
- `dsh-mini/`：独立 Node CLI 内核。
- `resources/`：原始美术素材和语言字典源文件，不上传；字典编辑后执行 `node scripts/sync-i18n.cjs`。
- `scripts/`、`tests/`、`docs/`：构建、测试和文档，不上传。

主包保留聊天、首页和设置；插件、插件详情、定时任务及管理页面使用普通分包，原跳转路径不变。上传前体积检查按每包 1.8 MiB 原始源码预算预留编译余量，最终大小以开发者工具上传结果为准。主包图片/音频另有 300 KiB 软预算（`scripts/check-miniprogram-package.cjs` 的 `MEDIA_BUDGET`）：执行中状态图标新增的 12 个可选动效 GIF（约 82 KiB）使该预算从 200 KiB 上调，主包源码总量仍低于 1.8 MiB；后续再加媒体资源前应先评估该预算。

## 公网服务端与部署

服务器相关代码统一放在 [dsh-console/](dsh-console/README.md)，内部按 `deploy/`（部署升级）、`services/public-access/`（管理后台）、`relay/`（公网中继）区分，微信小程序代码独立放在 `miniprogram/`，上传不会包含控制台、鸿蒙、原生端或开发工具。

宝塔上传时，只把本地 `dsh-console/` **里面的内容**上传到 `/www/wwwroot/dsh-console/`，不要重复嵌套同名目录；保留服务器原 `deploy/.env` 和数据，不上传本机运行数据或依赖。已部署服务器仍执行 `cd /www/wwwroot/dsh-console/deploy`、`bash upgrade.sh`。详见 [统一部署教程](dsh-console/deploy/README.md)。

## 运行方式

1. 安装并打开 [微信开发者工具](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)。
2. 「导入项目」→ 选择 `D:\Other\P-Program\dsh-weapp\miniprogram`。该目录有独立的 `project.config.json`，保留现有 AppID。旧根目录工程也通过 `miniprogramRoot` 指向同一份小程序源码。
3. 详情 → 本地设置 → 勾选 **不校验合法域名、web-view、TLS 版本以及 HTTPS 证书**
   （开发期连接 `ws://` 局域网地址必需；正式发布必须使用 `wss://` 并在小程序后台
   配置 socket 合法域名）。
4. 编译运行，进入「设备配对」页。

真机预览时手机与电脑需在同一局域网，地址填 `ws://<电脑局域网IP>:3080/ws/mobile`；
`127.0.0.1` 只适用于开发者工具模拟器。

## 连接与配对

### 小程序构建与版本显示

每次编译、预览或上传前，在仓库根目录依次运行 `node scripts/check-miniprogram-package.cjs`、`node scripts/stamp-build.cjs`，然后在微信开发者工具编译。
「小程序版本 / 当前版本」优先使用微信包版本，开发包回退到 `miniprogram/utils/build.js` 的版本号；「构建记录」是生成脚本记录的北京时间与源码摘要，不是安装时间，也不是主机版本。源码修改后需要重新执行脚本。
「主机版本」来自网关的主机信息；「已连接网关版本」优先显示网关自报的版本（不要求包名匹配），未自报时取唯一启用的匹配插件目录版本，不再拿主机版本替代。适配基线按插件分开：0.8.6+，旧移动网关0.10.0+，不代表全部主机功能均已支持。
旧插件未上报版本时显示「未上报」。仓库插件升级器已加入握手与主机查询的版本字段；需在用户自己的DSH安装更新并正常重启后生效，不需要为此重新部署公网后台。不会通过公开管理端口读取版本。

### 隐私政策与首页背景

隐私政策为本地全屏底部弹窗，支持顶部拖动条下拉关闭、正文滚动和深浅色。发布前请核对 `miniprogram/utils/privacy-policy.js` 中的实际运营主体、客服渠道、保存与删除流程，并同步微信后台隐私声明；本页不替代微信的权限授权流程。
首页背景改编自DSH iOS手机流体场与粒子鲸尾，保留MIT声明（见 `THIRD_PARTY_NOTICES.md`）。光带强度按本客户端可读性压低，24秒内逐渐压暗；离页暂停，返回续播。为避免微信原生画布遮挡首页，使用离屏渲染加普通图片显示，限制15帧/秒及输出尺寸；不支持离屏画布时显示静态鲸鱼和柔和背景，不阻塞主机与会话操作。

与 iOS 完全一致：

1. 在 DeepSeek Harness 中安装并启用 `dsh-plugin-mobile-gateway`。
2. 打开 WebUI「移动设备」面板，启用移动连接与设备鉴权。
3. 生成一次性配对二维码/Token。
4. 小程序「设备配对」页扫描二维码（内容为 Base64URL(JSON) 配对载荷，version 2），
   或手动输入 WebSocket 地址 + 一次性配对码。
5. 配对成功后长期凭据保存在本地（`wx.setStorageSync`），后续以
   `Authorization: Bearer <token>` 自动重连。

配对握手走 `Sec-WebSocket-Protocol: dsh-mobile-v1, dsh-pair.<code>`；
每台设备有独立 `X-DSH-Device-ID`。一次性配对码失败后不会自动重试，需重新扫码。

## 功能对照（iOS ↔ 小程序）

| iOS | 小程序 | 说明 |
| --- | --- | --- |
| WorkspaceView 工作区首页 | `pages/home` | 工作区选择器、新建会话、最近会话、搜索、连接状态 |
| GatewayQRScanner / ManualPairing | `pages/pairing` | 扫码（wx.scanCode）+ 手动输入，Base64URL 载荷解析、过期校验 |
| GatewaySwitcher / DirectoryBrowser | `pages/workspace-picker` + `pages/files` | 工作区切换、远端目录浏览、新建目录、目录创建会话 |
| ConversationView 对话 | `pages/session`（对话分段） | Markdown/代码块、思考过程与工具调用折叠行、图片附件、流式生成 |
| TrajectoryView 轨迹 | `pages/session`（轨迹分段） | Turn 分组、USER/ASSISTANT/TOOL 徽标、#seq、时长概览、事件详情抽屉 |
| dsh-context 上下文 | `pages/session`（上下文分段） | 与「对话」「轨迹」同排；上下文统计、Token 组成、耗时统计、上下文趋势与最近事件；数据来自宿主 `mobileContext` 投影（需网关桥接，见下文） |
| dsh-context 编队 | `pages/session`（编队分段） | 当前 Agent 的家族网络：父链与全部子 Agent 卡片，含运行状态、上下文占用、7 类组成条、token/轮次/步数/活跃时长；点击卡片跳到该 Agent 的「上下文」；数据来自宿主 `context-fleet` 请求（需网关桥接） |
| HumanQuestionView | `pages/session` 提问卡片 | 单选/多选/自定义文本、提交/取消 |
| ApprovalRequestView | `pages/session` 审批卡片 | 允许一次 / 拒绝 |
| Composer 输入面板 | 同页 | 权限、模型、思考等级芯片、图片附件、发送、停止回合 |
| SettingsView | `pages/settings` | Agent 预设、默认模型、权限默认值、Gateway 状态/Ping/断开/忘记设备、DSH Host 信息、关于（隐私政策） |
| SessionStats | 同页「··· → 查看统计」 | 轮次/步骤/耗时/Tokens |
| WorkspaceView 侧边栏 drawer | `pages/home`（品牌 logo 点击/右滑唤出） | 品牌字标 + 插件 / 定时任务入口，主内容右移圆角 + 压暗，抽屉内拖拽关闭 |
| ScheduledTasksView 定时任务 | `pages/schedule` | schedule-catalog 目录、卡片左滑编辑/删除、展开详情、编辑弹层（标题/内容/执行时间）、删除确认、下拉刷新 |
| PluginsView 插件管理 | `pages/plugins` + `pages/plugin-detail` | plugin-catalog 目录（官方/已安装分组）、bundle 启用开关（停用移动网关需确认）、实验性徽标、官方配置项详情、组件条目开关与半屏组件详情、plugins-changed 自动刷新 |
| WorkspaceDrawerDestination 插件 | 已升级为真实插件管理页 | （v1.7.x 前为占位页，现对齐 PluginsView） |
| PrivacyPolicySheet 隐私政策 | `components/privacy-sheet` | 设置页底部滑出全屏弹窗，本地正文、顶部拖动条下拉关闭；旧路由复用同一组件 |
| （iOS 无对应）微信分享 | 全部页面（`utils/share.js` 全局注入） | 每个页面支持「转发给朋友」（onShareAppMessage）与「分享到朋友圈」（onShareTimeline），按页面给出中文文案；依赖页面参数的深页（插件详情/文件）转发落地首页。注意：朋友圈入口仅真机可用（开发者工具不显示），对方以单页模式打开 |
| （对齐 v1.7.2 视觉） | `pages/home` + `theme.js` | 首页对齐 iOS v1.7.2：深海背景（navy + 流体辉光 + 84rpx 技术网格渐隐 + 鲸鱼 screen 混合 + 底部压暗 clear→navy12%→black58%）、玻璃卡片（white 5.5%/6%/8% 填充 + white 14%/10% 描边 + 15pt 圆角）、按压反馈（scale 0.96 + 变暗）、字号/间距/分隔线按 WorkspaceView 度量；除首页外所有页面背景纯白（浅色）/纯黑（深色） |

## 协议覆盖

请求：`ping` `workspaces` `sessions` `host` `search` `directories`
`directory-create` `workspace-create` `models` `select-model`
`permission-options` `permission` `context-usage` `session-stats` `context-dashboard` `context-fleet` `history`
`attachment` `subscribe`/`unsubscribe` `session-archive` `session-rename`
`session-cancel` `message` `question-answer` `question-cancel`
`approval-response` `session-create` `agent-presets` `defaults`
`default-model` `save-default-model` `set-default`
`schedule-catalog` `schedule-update` `schedule-delete`
`plugin-catalog` `plugin-bundle-set-enabled` `plugin-entry-set-enabled`。

响应/事件：`paired` `hello` `pong` `subscribed` `sent` `event` `history`
`session-snapshot` `session-stream-reset` `workspaces` `sessions` `search`
`host` `models` `permission*` `session-stats` `context-usage` `context-dashboard`
`context-fleet`（`mobileContext` 投影 + 官方 `breakdown`/`usage`/`stats`；
编队为宿主侧家族列表；旧网关回 `unknown-command`、未装桥回
`context-unavailable`）
`question-*` `approval-*` `session-created` `attachment` `error`
`schedule-catalog`（items 任务目录）`schedule-changed`（变更推送，在途时
排队补拉）`schedule-update`（updated）`schedule-delete`（deleted）
`plugin-catalog`（bundles/plugins/officialItems，官方与已安装分组在本地
完成）`plugins-changed`（插件页访问过时自动刷新）
`plugin-bundle-set-enabled` / `plugin-entry-set-enabled`
（result.application：applied / restart-required / overridden）等，
事件归一化规则（`user/message`、`assistant/chunk`、`assistant/message`、
`tool/call`、`tool/result` …）与 `shared/protocol` 的
`RawSessionEvent.normalizedEvent` 一致。定时任务变更错误按 code 本地化
（`schedule_conflict` / `schedule_ended` / `schedule_not_found`）。

## 上下文 / 编队与网关桥接

「上下文」分段读取宿主注册的 `mobileContext` 会话投影（组成、请求趋势、事件、
工具调用与耗时），并附带宿主官方的 `tokenUsage` / `sessionStats` /
`contextBreakdown` 投影；token 分摊规则与 dsh-context 一致（估算项带 ≈，
输出与总数精确）。「编队」分段通过同一桥接的 `context-fleet` 请求，在宿主侧按
会话 `parentSession`/`origin` 关系汇总当前 Agent 家族，读取各会话投影快照生成
卡片。完整协议与 derive 规则见 [docs/context-dashboard.md](docs/context-dashboard.md)。

已安装网关需要补桥接（官方 `dsh-plugin-mobile-gateway` 与本仓库的
`dsh-plugin-weapp-gateway` 都支持）。**注意先解析实际生效的网关目录**：桌面
profile 的 `dependencies` 可能用 `link:` 指向另一个 checkout，`local-plugins/`
下的副本不一定被加载。

```bash
# 实际生效的 weapp 网关目录（示例输出：/Users/you/Downloads/dsh-plugin-weapp-gateway）
readlink ~/.dsh/profiles/desktop/node_modules/dsh-plugin-weapp-gateway
node scripts/install-context-bridge.cjs "$(readlink -f ~/.dsh/profiles/desktop/node_modules/dsh-plugin-weapp-gateway)" --check
node scripts/install-context-bridge.cjs "$(readlink -f ~/.dsh/profiles/desktop/node_modules/dsh-plugin-weapp-gateway)"
```

安装后正常重启 DSH 并让小程序重新连接；不需要重新配对或迁移数据。未安装桥
或网关版本过旧时，面板显示「需升级网关」的提示，不影响其他功能。

## 目录结构

```text
weapp/
├── app.js / app.json / app.wxss     # 入口、页面注册、设计 token + 深海背景组件
├── project.config.json              # 开发者工具工程配置
├── dsh-console/                     # 服务端部署包，不打入小程序
│   ├── deploy/                      # 安装、升级和备份恢复脚本
│   ├── services/public-access/      # 管理后台与公网授权 API
│   └── relay/                       # 公网中继与插件连接器
├── assets/icons/                    # 90 个 PNG：SF Symbols 重建图标 + 品牌标 + 背景素材
│                                    #   （bg-grid 网格瓦片 / bg-whale 粒子鲸鱼定格 /
│                                    #    wordmark 品牌字标 / pinwheel 插件风车）
├── utils/
│   ├── gateway.js                   # WebSocket 客户端（握手/重连/探测/请求关联）
│   ├── hosts.js                     # 主机档案模型与地址/身份校验（MultiGatewayStore 对齐）
│   ├── protocol.js                  # 事件归一化 + 对话/轨迹投影
│   ├── store.js                     # 全局状态仓库与订阅
│   ├── schedule.js                  # 定时任务模型与规则/时间格式化（ScheduledTaskFormat 对齐）
│   ├── plugins.js                   # 插件目录模型（MobilePluginCatalog/Bundle/Entry 对齐）
│   ├── share.js                     # 全局转发/朋友圈分享（包装 Page 注入全部页面）
│   ├── pairing.js                   # 配对载荷解析（Base64URL + 校验）
│   ├── markdown.js                  # 轻量 Markdown 块解析
│   ├── labels.js                    # 预设/权限/思考等级文案（对齐 L10n.swift）
│   └── util.js                      # 时间、Base64URL、JSON 展示工具
└── pages/
    ├── pairing/                     # 设备配对
    ├── home/                        # 工作区首页（含侧边栏 drawer）
    ├── workspace-picker/            # 切换工作区
    ├── session/                     # 对话 + 轨迹 + 交互卡片 + 输入面板
    ├── schedule/                    # 定时任务（左滑卡片 + 编辑弹层）
    ├── plugins/                      # 插件管理（官方/已安装 + 启用开关）
    ├── plugin-detail/                # 插件详情（组件列表 + 半屏组件详情）
    ├── privacy/                     # 隐私政策全屏弹窗兼容路由
    ├── settings/                    # 设置
    └── files/                       # 工作区目录浏览/创建
```

## 视觉语言

对齐 `Design/design-spec.md` 与 iOS `Theme.swift` / `HarnessAnimatedBackground`
（SwiftUI / Metal）：

- **深海蓝背景**（首页/配对/工作区选择）：与 `preview-bg.html` 同款并全页铺满 ——
  navy（`#07182B`）底 + 42pt 网格瓦片（全透明度平铺）+ 粒子鲸鱼定格 PNG
  （55%/34% 居中）；无流体渐变、无压暗层。顶部功能区（品牌栏）无背景。
- **图标资产**：iOS SF Symbols 与品牌 SVG 在构建期重建并栅格化为 PNG（小程序
  `<image>` 对 SVG 支持不可靠），按使用场景预着色（工具橙 `#EF7D14`、思考紫
  `#7A54C7`、上下文绿 `#34C759`、状态灰 `#8E8E93`、天线蓝 `#2E6BE6`、错误红
  `#FF3B30`）；轨迹行点位颜色：Input 蓝 / Model 紫 / Tools 橙。
- **浅色分组页**（设置/文件）：`systemGroupedBackground` `#F2F2F7` 底 + 纯白圆角
  分组卡片（28rpx）。
- 纸白（`#F7F8FA`）内容面、海洋蓝（`#2E6BE6`）主强调、雾蓝（`#BFD4FF`）辅助；
  液态玻璃用于导航、分段控件、输入面板与主操作按钮，长文本内容保持不透明以保证
  可读性；时间/Token/耗时使用等宽数字。
- Composer 对齐 iOS：权限 chip + 模型/思考等级合并玻璃胶囊（High/Low 紫色 pill）+
  上下文用量圆环（`conic-gradient` + 内圆盖心，来自 `context-usage` 的
  `pressureTokens/contextWindow`）+ 图片附件 + 发送/停止。
- **品牌 logo 颜色规则**：深色背景用 `whale-white.png`（白色图标），浅色背景用
  `whale-ink.png`（深色图标）；字标同理，深色面用 `wordmark-white.png`、浅色面用
  `wordmark-ink.png`。
- **品牌字标**：`assets/icons/wordmark-{white,ink}.png` 为 Outfit 600 预渲染 PNG
  （`whale` + `tail` 两段配色：深色面 `#FFFFFF` + 雾蓝 `#BFD4FF`，浅色面
  `#101318` + 海洋蓝 `#2E6BE6`），首页顶部与左侧栏共用同一张图，按
  `width: 168.75rpx` + `mode="widthFix"` 显示（375 宽下字高 16px），不再用 CSS 文字
  加 `scaleX` 横向拉伸（Android 会回退到系统默认字体、字形被拉变形）。源图见
  `resources/artwork/brand/wordmark-*@4x.png`，字体许可见 `THIRD_PARTY_NOTICES.md`。
- **切换主机**（首页顶部栏下方胶囊 + 底部 sheet）：对齐 iOS
  `GatewaySwitcherBar`/`GatewaySwitcherSheet`/`MultiGatewayStore` —— 主机档案
  （`gateway.profiles.v1`，v4 UUID）含地址候选（≤16，publicUrl 优先，默认路径
  `/ws/mobile`，ws 仅限本地）、网关身份、别名、设备类型（电脑/服务器）；设备类型
  优先用配对载荷的 `deviceKind` / `hostPlatform`（中继连接器会上报
  `process.platform`），否则按主机名特征推断，无法判断时默认「电脑」；「编辑主机」
  手动选择后不会被自动推断覆盖。凭据按
  档案 ID 命名空间（`dsh_creds.<id>`），旧版 `dsh_endpoint`/`dsh_token` 自动迁移；
  切换即断开重连并清空上一台主机的业务数据；在线探测 3s/端点、30s 自动刷新；
  编辑模式支持多选删除（不删除网关上的会话/工作区）。

## 与 iOS 的平台差异

### 插件页排障

进入「插件」页若显示错误态，按提示对照处理：

| 提示 | 原因 | 处理 |
| --- | --- | --- |
| 当前网关插件版本不支持插件管理，请升级… | 网关插件 < 2025-09-30 构建 | 升级 `dsh-plugin-mobile-gateway`（≥ 0.9） |
| 插件管理需要已配对设备 | 中继 connector 未持有网关凭据 | 按 `dsh-console/relay/README-relay.md` 重新扫码配对一次（connector 会保存 token） |
| 当前 Host 不支持插件管理 | DSH Host < 0.2.0 | 升级 DSH Host |
| 插件目录请求超时 | 帧未到达/未返回（中继掉线等） | 看小程序 Console 的 `[plugins]` 日志；重进页面重试 |
| 其他英文报错 | 网关透传 DSH 错误 | 对照 DSH Host 日志 |

- 小程序无后台长连接保活：退到后台由微信管理 WebSocket，回前台自动重连
  （iOS 使用系统后台执行时间管理活动任务）。
- 图片附件按需经 `FileSystemManager` 读为 Base64 走协议 3 `images`；
  附件回显需调用 `attachment` 请求拉取（iOS 有本地附件缓存）。
- 正式发布需在小程序后台配置 socket 合法域名（`wss://`），本地开发需勾选
  「不校验合法域名」。
- 图标为 PNG 栅格而非 SF Symbols 矢量（小程序 `<image>` 不可靠支持 SVG）；
  粒子鲸鱼为 t=0 离线定格（小程序无 Metal，逐帧动画不可行）。
- 会话内导航「Agent 预设」chip 为**展示态**：当前网关 `agent-presets` 未定义选择
  交互 schema，不做假交互；设置页的 Agent 预设默认值可正常读写。
- 停止按钮保留 `■` 文字字形（未采用 stop.fill 资产）。
