# DshMobile 微信小程序版

DeepSeek Harness Mobile 的微信小程序客户端，界面与功能对齐 iOS 端
（`DeepSeekHarnessMobile/`），通过 `dsh-plugin-mobile-gateway` 的 WebSocket
协议连接 DeepSeek Harness。

## 运行方式

1. 安装并打开 [微信开发者工具](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)。
2. 「导入项目」→ 选择本目录（`weapp/`）→ AppID 可先用「测试号」（`project.config.json`
   中默认为 `touristappid`）。
3. 详情 → 本地设置 → 勾选 **不校验合法域名、web-view、TLS 版本以及 HTTPS 证书**
   （开发期连接 `ws://` 局域网地址必需；正式发布必须使用 `wss://` 并在小程序后台
   配置 socket 合法域名）。
4. 编译运行，进入「设备配对」页。

真机预览时手机与电脑需在同一局域网，地址填 `ws://<电脑局域网IP>:3080/ws/mobile`；
`127.0.0.1` 只适用于开发者工具模拟器。

## 连接与配对

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
| HumanQuestionView | `pages/session` 提问卡片 | 单选/多选/自定义文本、提交/取消 |
| ApprovalRequestView | `pages/session` 审批卡片 | 允许一次 / 拒绝 |
| Composer 输入面板 | 同页 | 权限、模型、思考等级芯片、图片附件、发送、停止回合 |
| SettingsView | `pages/settings` | Agent 预设、默认模型、权限默认值、Gateway 状态/Ping/断开/忘记设备、DSH Host 信息 |
| SessionStats | 同页「··· → 查看统计」 | 轮次/步骤/耗时/Tokens |

## 协议覆盖

请求：`ping` `workspaces` `sessions` `host` `search` `directories`
`directory-create` `workspace-create` `models` `select-model`
`permission-options` `permission` `context-usage` `session-stats` `history`
`attachment` `subscribe`/`unsubscribe` `session-archive` `session-rename`
`session-cancel` `message` `question-answer` `question-cancel`
`approval-response` `session-create` `agent-presets` `defaults`
`default-model` `save-default-model` `set-default`。

响应/事件：`paired` `hello` `pong` `subscribed` `sent` `event` `history`
`session-snapshot` `session-stream-reset` `workspaces` `sessions` `search`
`host` `models` `permission*` `session-stats` `context-usage`
`question-*` `approval-*` `session-created` `attachment` `error` 等，
事件归一化规则（`user/message`、`assistant/chunk`、`assistant/message`、
`tool/call`、`tool/result` …）与 `shared/protocol` 的
`RawSessionEvent.normalizedEvent` 一致。

## 目录结构

```text
weapp/
├── app.js / app.json / app.wxss     # 入口、页面注册、设计 token + 深海背景组件
├── project.config.json              # 开发者工具工程配置
├── assets/icons/                    # 71 个 PNG：SF Symbols 重建图标 + 品牌标 + 背景素材
│                                    #   （bg-grid 网格瓦片 / bg-whale 粒子鲸鱼定格）
├── utils/
│   ├── gateway.js                   # WebSocket 客户端（握手/重连/探测/请求关联）
│   ├── hosts.js                     # 主机档案模型与地址/身份校验（MultiGatewayStore 对齐）
│   ├── protocol.js                  # 事件归一化 + 对话/轨迹投影
│   ├── store.js                     # 全局状态仓库与订阅
│   ├── pairing.js                   # 配对载荷解析（Base64URL + 校验）
│   ├── markdown.js                  # 轻量 Markdown 块解析
│   ├── labels.js                    # 预设/权限/思考等级文案（对齐 L10n.swift）
│   └── util.js                      # 时间、Base64URL、JSON 展示工具
└── pages/
    ├── pairing/                     # 设备配对
    ├── home/                        # 工作区首页
    ├── workspace-picker/            # 切换工作区
    ├── session/                     # 对话 + 轨迹 + 交互卡片 + 输入面板
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
  `whale-ink.png`（深色图标）。
- **切换主机**（首页顶部栏下方胶囊 + 底部 sheet）：对齐 iOS
  `GatewaySwitcherBar`/`GatewaySwitcherSheet`/`MultiGatewayStore` —— 主机档案
  （`gateway.profiles.v1`，v4 UUID）含地址候选（≤16，publicUrl 优先，默认路径
  `/ws/mobile`，ws 仅限本地）、网关身份、别名、设备类型（电脑/服务器）；凭据按
  档案 ID 命名空间（`dsh_creds.<id>`），旧版 `dsh_endpoint`/`dsh_token` 自动迁移；
  切换即断开重连并清空上一台主机的业务数据；在线探测 3s/端点、30s 自动刷新；
  编辑模式支持多选删除（不删除网关上的会话/工作区）。

## 与 iOS 的平台差异

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
