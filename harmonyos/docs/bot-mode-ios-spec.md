# DS-Bot 模式（Bot Mode）iOS 规格 · 鸿蒙 ArkTS 实现蓝本

> 参考仓库：/tmp/dsh-mobile-ref（只读）。本文所有「规格值」均从 iOS 当前分支代码逐行核对；与更早的产品稿/设计稿冲突处显式标注【实现现状】与【设计稿】。
> 适用范围：HarmonyOS 原生（ArkTS/ArkUI）复刻 Bot 模式。工作模式（Workspace）已有实现不在本文范围，但抽屉、品牌头、连接/设置、主机选择器必须复用现有组件。
> 阅读顺序：§1 总览 → §2 入口 → §3 首页 → §4 聊天 → §5 交互卡 → §6 定时任务 → §7 管理 → §8 视觉 → §9 数据 → §12 边界 → §13 鸿蒙风险清单。

---

## 0. 文档信息与溯源

| 项 | 内容 |
|---|---|
| 产品范围与协议入口 | Docs/bot-mode-integration.md（2026-11-18 / 11-23 两次增补） |
| 设计说明 | Design/bot-mode/README.md、wide-home-r2.md |
| 设计资源 | Design/bot-mode/{ds-bot-whale,group-avatar,conversation,mode-swap}.svg、preview-fixture*.json |
| iOS 核心实现 | DeepSeekHarnessMobile/Views/BotModeView.swift（2444 行）、Views/BotManagementView.swift（815 行） |
| 行为/验收 | DeepSeekHarnessMobileUITests/BotModeUITests.swift（1524 行，DSH_BOT_PROBE_URL=127.0.0.1:3098 才跑真实主机用例） |
| 协议/状态权威 | shared/src/commonMain/.../facade/SharedBotStore.kt（状态机、缓存、未读、交互卡） |
| 传输 | DeepSeekHarnessMobile/Core/GatewayClient.swift:964-1030（bot 帧分流） |
| 颜色资源 | DeepSeekHarnessMobile/Resources/Assets.xcassets/Bot*.colorset |
| 玻璃/自适应 | Components/Glass.swift、Core/Theme.swift |

重要说明：
1. 本仓库 iOS 端 Bot 模式入口当前只在 DEBUG 编译（Docs/bot-mode-integration.md「本轮设计验收」）；正式产品化需产品确认开关策略。
2. 设计稿（wide-home-r2.md）仍描述「正在进行/已完成」区块，**当前 iOS 代码没有渲染这两个区块**（UITest 明确断言「正在进行」不存在：BotModeUITests.swift:262）。本文按代码实际描述，差异列入 §3.6。
3. 文档 SoC「未实现清单」写于附件/图片能力之前；当前分支已实现图片与文件附件，§12 给出原文与代码现状对照。

---

## 1. 总览与信息架构

### 1.1 页面地图

~~~text
工作页（Workspace）
└─ 抽屉（右滑/点 Logo）
   ├─ [首项] 切换到 Bot 模式 / 切换到工作模式   ← 唯一模式入口与反向入口
   ├─ 插件 / 定时任务 / 连接器（工作页原有）
   └─ 品牌头、连接配对、设置、主机选择器（原组件，Bot 模式继续使用）

Bot 模式（bot-mode）
├─ 首页（单栏手机 / R2 双栏宽屏）
│  ├─ 我的 Bot（BotRosterView） → 新建 Bot / 角色名片 / 角色设置 / 记忆 / 角色定时任务
│  ├─ 定时任务（BotScheduleSheet，只读）
│  ├─ 聊天（群聊 + 私聊混排）
│  │  └─ 点行 → 独立聊天页（BotPrivateChatView，群聊复用同页）
│  └─ 新建对话菜单（+）：新建 Bot / 新建群聊 / 查找 Bot… / 已有 Bot 列表
└─ 独立聊天页
   ├─ 顶栏身份 → 私聊=角色名片 Sheet；群聊=群成员 Sheet
   ├─ 更多菜单 → 重新同步 / 定时任务
   ├─ 时间线（气泡、活动、系统事件、已回答问答、交互卡、实时工作行、加载更早）
   └─ 输入区（附件、图片、@引用、引用回复、发送）
~~~

### 1.2 必须复用的共享能力（禁止另起一套）

- 抽屉（WorkspaceDrawer 等价物）、品牌 HarnessMark、左上 Logo 打开抽屉手势（含边缘拖拽与跟手动画）。
- 右上「连接配对」菜单与「设置」按钮（40×40 玻璃圆钮）。
- 主机选择器条（GatewaySwitcherBar）：Bot 首页标题区下方一行，与工作页一致。
- Markdown 渲染（含代码块、表格、链接、行内代码）、复制/选择、图片加载器、大图预览/保存、文件预览 Sheet。
- 统一 Alert/Dialog 组件（Bot 页面不新增 Material AlertDialog 风格，一律用项目统一弹窗）。
- 玻璃材质封装、字号缩放（appearance.fontScale，0.8–1.5）、Dynamic Type 语义色。
- 本地通知管理器（当前 Bot 事件尚未接入，见 §12）。

### 1.3 模式差异总表

| 维度 | 工作模式 | Bot 模式 |
|---|---|---|
| 背景 | 深海军蓝流体几何 | 浅紫（浅色）/ 近黑紫（深色）同一几何、光弧、网格、鲸鱼点阵 |
| 抽屉首项 | 「切换到 Bot 模式」，黑色 DS Bot 鲸鱼矢量 | 「切换到工作模式」，工作图标；尾随双箭头 |
| 首页标题 | 探索未至之境 | 个人助理 / 今天也交给我吧。 |
| 内容 | 工作区卡片、会话列表 | Chief、快捷入口、群聊+私聊 |
| 窄屏方向 | 小屏固定竖屏 | 同（最小宽度 <600dp 固定竖屏） |
| 宽屏 | 双栏（1120 断点） | R2 双栏（760 断点 + 条件） |

---

## 2. Bot 模式入口与切换

### 2.1 入口位置与结构（WorkspaceView.swift:372-441）

- 位置：右滑抽屉**第一项**，位于品牌 Logo 下方、插件/定时任务/连接器之上；抽屉左右内边距 18，Logo 下间距 16。
- 结构（一行）：图标 24×24 → 间距 10 → 文案 17pt → 弹簧占位 → 尾随 arrow.left.arrow.right 17pt（tint BotPurple）。
- 行高：minHeight 52；水平内边距 14；整行可点；无障碍标识 workspace-mode-switch。
- 文案：Bot 模式时显示「切换到工作模式」；工作模式时显示「切换到 Bot 模式」（中英已本地化）。
- 图标：
  - 进 Bot：Assets BotDrawerMark，24×24 viewBox，DS Bot 原始「鲸鱼/DeepSeek」矢量（上游 MAIN_LOOK），主色黑 #000000、透明眼睛、无背景；来源 DS-Bot a66cc73 的 sidebar.js BotReturn；资源由 Design/bot-mode/ds-bot-whale.svg 提供。
  - 回工作：Assets WorkspaceDrawerMark，同尺寸同色。
  - 两者均以 BotInk 着色（浅色 #252332，接近纯黑）。
- 抽屉动画：打开时内容 opacity 0.6→1.0、scale 0.9→1.0（anchor leading），关闭反向；点击模式项后**抽屉立即无动画归零**（selectDrawerItem 用 disablesAnimations transaction），随后执行模式切换，避免「先看到旧首页再跳变」。

### 2.2 切换动作与过渡

1. 读取本次点击坐标（SpatialTapGesture，窗口坐标系），供波纹动画起点。
2. 关闭抽屉并用禁用动画的 transaction 把 offset 归零。
3. 调用 onBotMode / onStandardMode，写入本地偏好 app.bot-mode（RootView.swift:87、141-143）。
4. iOS 17+ 且未开启「减弱动态效果」时，以点击点为圆心播放模式波纹（WorkspaceModeWave，圆形扩散 + 背景色调切换）；减弱动态时直接切。
5. 模式持久化：仅本地偏好，默认 false；**重启 App 保持上次模式**；不随主机切换变化；不写入主机。

### 2.3 反向切换入口

- 只有抽屉首项一个入口（Bot 模式内无「返回工作模式」按钮）。
- Bot 首页左上同样显示 HarnessMark，点击开抽屉；右滑手势与工作页一致（Home 滚动区覆盖 DrawerPanGestureAttachment；方向判定要求水平分量 > 垂直 1.2 倍）。

### 2.4 复用确认清单

| 能力 | 是否复用 | 说明 |
|---|---|---|
| 品牌 HarnessMark（左上） | 复用 | 宽度 216（辅助字号 150）；点击开抽屉 |
| 右上连接配对菜单 | 复用 | 位置/操作与工作页一致 |
| 右上设置按钮 | 复用 | 40×40 玻璃圆钮，gearshape.fill |
| 主机选择器 | 复用 | 首页标题区下方 GatewaySwitcherBar；Bot 页不另建 |
| 抽屉其它项（插件/定时任务/连接器） | 复用 | Bot 模式下同样存在，点击进入对应工作模式目的地 |
| 统一弹窗/菜单/玻璃 | 复用 | iOS 原生 Menu/Sheet/Form；鸿蒙用项目等价组件 |

---

## 3. 手机首页（Bot 首页）

### 3.1 布局骨架

**单栏（手机/紧凑窗口）** BotModeView.swift:493-508

- ScrollView 包 VStack(alignment: leading, spacing: 16)：
  1. header（复用品牌头 + 主机选择器）
  2. Spacer(minLength: 44)
  3. 助理区 assistantContent
  4. 聊天区 chatSection
- 水平内边距 22；上内边距 safeArea.top + 18；下内边距 safeArea.bottom + 16；隐藏滚动指示器；滚动交互式收键盘。

**双栏 R2（宽屏）** BotModeView.swift:427-447

- 触发条件（全部满足）：窗口宽 ≥ 760；非辅助字号；高度 ≥ 500 **或** 搜索框聚焦；应用字号倍率 < 1.5。
- 结构：ScrollView → VStack(spacing: 40) { header; HStack(alignment: top, spacing: 48) { assistantContent.frame(width: min(440, 窗口宽×0.38)); chatSection.frame(maxWidth: .infinity, alignment: topLeading) } }。
- 外边距：水平 40；上 safeArea.top + 18；下 safeArea.bottom + 24；内容最大宽度 1440 居中。
- 无障碍标识 bot.wide-home；首页**不出现**消息正文、会话 ID、输入框（UITest 断言 bot.composer 不存在）。
- 键盘弹出时维持双栏，仅高度条件放宽（height ≥ 500 || searchFocused）。

### 3.2 区块顺序与逐项规格（自上而下）

#### (1) 标题区

- 「个人助理」：32pt bold。
- 「今天也交给我吧。」：15pt secondary；双栏时 minHeight 21。
- 内容栈间距：双栏 6 / 单栏 3。

#### (2) Chief 卡（当前主 Bot）

BotModeView.swift:517-530，无障碍 bot.chief

- 容器：HStack(spacing 12)，水平内边 16、垂直 11，minHeight 66，玻璃卡圆角 22。
- 头像：BotAvatar size 44，main=true（主 Bot 用 Whaleness Orca 轮廓；否则图片或首字，见 §8.6）。
- 文本列（spacing 2）：
  - 名字 17pt semibold。
  - 状态行（spacing 4）：5×5 圆点 + 12pt 文案，颜色 cardAccent。
    - 运行中（running==true）：圆点 green（#2EB85C），文案「正在为你推进 N 件事」（N=当前 running 的聊天数）。
    - 空闲：圆点 BotPurple，文案「随时可以找我聊聊」。
- 点击行为：打开**角色名片 Sheet**（BotRoleSheet），不是聊天。
- 无主 Bot（chief==nil）时禁用。
- 状态点色值与列表「运行中」点一致：DSHColor.success = rgb(0.18,0.72,0.36) ≈ #2EB85C。

#### (3)「与 X 聊聊」按钮

BotModeView.swift:531-547，无障碍 bot.start-chat

- 容器：HStack(spacing 10)，minHeight 52，玻璃卡圆角 26。
- 图标：Assets BotConversationMark（conversation.svg 源尺寸 25.2422×20.1094），template 渲染、当前色。
- 文案：17pt semibold，「与 {Chief 名} 聊聊」（无 Chief 时「与助理聊聊」）。
- 右侧状态标记 BotChatStatusMark（运行绿点或未读红角标），trailing 内边距 16；存在标记时左侧内容水平内边距 64 避免压字。
- 点击：进入 Chief 私聊。

#### (4) 连接/能力/错误卡

BotModeView.swift:548-554

- 触发：未连接 或 不支持 或 snapshot.error 非空。
- 文案（15pt secondary）：
  - 未连接：「连接主机后查看个人助理」
  - 不支持：「请更新主机上的移动网关以使用 Bot 模式」
  - 错误码映射见 §9.8。
- 已连接且支持但出错：追加「重新同步」文字按钮（tint BotPurple）。
- 容器：padding 16，玻璃卡（默认圆角 20）。

#### (5) 首次加载

- 条件：loading 且 chats 为空 → ProgressView +「正在同步助理」，满宽居中（BotModeView.swift:555）。

#### (6) 两张快捷入口卡（并排）

BotModeView.swift:556-563、677-688

- HStack spacing 12，各占一半。
- 卡内容（VStack spacing 3）：
  - 首行：标题 15pt + Spacer + 数字 17pt semibold（右对齐、baseline 对齐）。
  - 次行：副标题 12pt secondary，单行截断。
- 容器：水平 16、垂直 12，minHeight 66，玻璃卡（默认圆角 20）。
- 卡 1「我的 Bot」：数量 = 非群聊聊天数；副标题固定「查看与创建」；无障碍 bot.roster；点击 → 我的 Bot 页。
- 卡 2「定时任务」：数量 = schedules.count；副标题 = 有任务时「下次 {next}」，否则「查看安排」；无障碍 bot.schedules；点击 → 定时任务面板。next 为主机返回的展示字符串（如 08:30 / 下周四 17:00（本地时间）），客户端原样显示。

#### (7) 聊天区标题行

BotModeView.swift:570-579

- HStack，minHeight 40：
  - 「聊天」17pt semibold。
  - Spacer。
  - 搜索词非空时：「{N} 个结果」12pt secondary。
  - 尾随新建按钮（+）：28×28 图标，17pt regular，玻璃圆钮，无障碍 bot.conversation.new；conversation.saving 时禁用并叠加 ProgressView。
- 新建按钮点击弹出**可滚动原生 Menu**（顺序）：
  1. Section：「新建 Bot」（!canCreateBot 时禁用）、「新建群聊」（需 connected 且 writable 且 conversation.supported）、「查找 Bot…」。
  2. Section：已有 Bot 列表（名字 + 角色描述 + 可选头像），点击打开其现有聊天（隐藏 Bot 先 set-flags 恢复侧边栏入口再进入）；saving 或隐藏且不可写时禁用。
- 新建错误行：conversation.error 存在且成员页未打开时，在标题行下方显示错误 13pt 红色（优先 errorDetail）。

#### (8) 搜索框

BotModeView.swift:584-585、717-772，无障碍 bot.chat-search

- 高度固定 44；使用系统级搜索控件（iOS 为 UISearchTextField）保证清除按钮/选区/键盘/无障碍原生行为。
- 占位：「搜索聊天名称或内容」。
- 浅色：背景 BotPurple 28% 透明度，无描边，圆角 13；文字 BotInk；placeholder/tint BotInk 80%；光标 BotPurple。
- 深色：背景 BotGlassTint，描边 0.8 BotGlassRim，placeholder BotSecondary。
- 行为：
  - 即时筛选（本地快照），**不请求网关**；去掉首尾空白；忽略大小写。
  - 匹配：聊天名、最近消息摘要 preview、本地已缓存历史消息文本（kind ∈ user/bot/post）。
  - 清空恢复全列表；返回主页/横竖屏切换**保留搜索条件**；键盘弹出保持双栏。
  - Enter 仅收键盘。

#### (9) 聊天列表卡

BotModeView.swift:586-627

- 容器：VStack(spacing 0)，玻璃卡圆角 24；行间 Divider（leading 76）。
- 排序：主机返回 peers 已按 lastAt 倒序；主 Bot 不在列表中（搜索词为空时过滤 mainBotId）；隐藏 Bot 不出现（主 Bot 私聊除外）。
- 空态：
  - 搜索词非空：「没有找到相关聊天」17pt semibold +「换个关键词试试」15pt secondary，minHeight 138、padding 16，无障碍 bot.search-empty。
  - 无搜索：「还没有可用的 Bot，请先在主机上配置助理」15pt secondary，左对齐 padding 16。
- 行样式（minHeight 76，水平 14、垂直 14，整行可点，无障碍 bot.chat.{id}）：
  - 头像：48（群聊为成员拼贴，§8.6）。
  - 文本列（spacing 4，占满）：
    - 标题 17pt semibold，单行截断。
    - 副标题 15pt secondary，单行截断；取 preview；为空时群聊显示「群聊」，私聊显示角色 role。
  - 右侧列（spacing 6，仅当 lastAt>0 或存在状态标记时）：
    - 时间 11pt secondary：本地时区 HH:mm。
    - 状态标记 BotChatStatusMark：
      - running → 8×8 圆点 success 绿，外层 20×20，无障碍「运行中」，id bot.running.{id}。
      - 否则有未读 → 红角标：11pt semibold 白字，水平 5、垂直 2，minWidth/minHeight 20，Capsule，背景 rgb(214,38,60)=#D6263C；文案 99+（>99），无障碍「未读消息：N」，id bot.unread.{id}。
      - 运行中与未读同时存在时**只显示绿点**（running 优先）。
- 点击行：进入独立聊天页（push，非 Sheet），同时选中会话。

#### (10) 页面级状态汇总

| 状态 | 表现 |
|---|---|
| 首次连接中，chats 空 | 「正在同步助理」ProgressView |
| 无任何 Bot | 列表卡内单行空态文案 |
| 搜索无结果 | 双行空态卡（138 高） |
| 离线/不支持/错误 | §3.2(4) 错误卡（不遮挡既有缓存内容） |
| 定时任务面板 loading/error | 只在面板内（§6） |

### 3.3 区块数据来源

| 区块 | 字段 | 来源 |
|---|---|---|
| 标题/副标题 | 固定文案 | 本地化资源 |
| Chief 卡 | mainBotId → chat(name, image, running, role) | bot-call state → value.bots/rooms；running 由 work 合并 |
| 「正在推进 N 件事」 | running 聊天数 | snapshot.chats.filter(running).count |
| 与 Chief 聊聊 | mainBotId 名 | 同上 |
| 我的 Bot 数 | 非群聊 chats 数 | state 快照 |
| 定时任务卡 | schedules.count / schedules[0].next | bot-call schedules → tasks |
| 聊天列表 | chats：群聊+私聊，按 lastAt 倒序 | state 快照（peers） |
| 时间 | lastAt（毫秒 epoch） | 主机 |
| 运行中 | liveWork[chatId] 存在 | state 的 work.bots/rooms/turns；由 bot-event revision/live 触发 state 增量刷新（无固定轮询） |
| 未读数 | unreadCounts[chatId] | bot-event notice（kind group/message 且满足未读条件） |
| 搜索命中数 | searchChats(term).count | 本地快照 + 缓存历史 |

### 3.4 首页点击行为表

| 目标 | 行为 |
|---|---|
| HarnessMark | 打开抽屉 |
| Chief 卡 | 角色名片 Sheet |
| 与 X 聊聊 | 进入私聊 |
| 错误卡「重新同步」 | refresh()（重订阅 + 读 state/notices/当前聊天） |
| 我的 Bot | push 我的 Bot 页 |
| 定时任务 | 打开定时任务 Sheet |
| +（新建） | 可滚动 Menu |
| 聊天行 | push 独立聊天页 |
| 搜索框 | 聚焦，本地过滤 |

### 3.5 宽屏 R2 附加规格

- 左栏 = 助理区（标题、Chief 卡、与 Chief 聊聊、错误、快捷入口），宽 min(440, W×0.38)。
- 右栏 = 聊天区（标题、搜索、列表），填满剩余宽度。
- 搜索命中显示结果数；无结果卡（设计稿 170 高；实现 minHeight 138，**以 138 为准**，170 可作为视觉留白可选项）。
- 返回聊天列表后保留搜索条件；旋转保持；键盘弹出保持双栏。
- 右侧聊天分组设计稿：24 点圆角 + 74% 白底；实现用项目玻璃封装（浅色 tint 白 12% + clear glass）。鸿蒙按玻璃卡处理，不强行复刻 74% 数值。

### 3.6 【重要差异】「正在处理 / 近期完成」区块

| 项 | 产品/设计稿 | 当前 iOS 代码 |
|---|---|---|
| 正在进行 | 首页有独立区块 | **无**独立区块；运行状态只体现在 Chief 卡副标题与聊天行绿点 |
| 近期完成 | 首页有独立区块 | **无**；done 通知只写入 snapshot.recent（最多 30 条），首页不渲染 |
| 数据 | — | snapshot.recent（BotActivity：done/question/approval/group/message，§9.6） |
| 验收 | — | UITest 断言首页不存在「正在进行」文本（BotModeUITests.swift:262） |

鸿蒙建议：先按当前 iOS 实现（不加这两个区块）；若要按设计稿补，需产品确认并复用 recent/liveWork，不要自行推算「完成」（§9.6）。

---

## 4. 聊天页（私聊 / 群聊共用同一实现）

### 4.1 导航结构

- 从首页 push（非 Sheet）；首页 toolbar 隐藏，聊天页显示导航栏。
- 聊天页导航栏：inline 标题；principal 为身份按钮（maxWidth 220）；trailing 为 44×44 圆形更多按钮；导航栏背景隐藏，滚动时用顶部玻璃安全区；tint=primary；原生返回按钮。
- 身份按钮（无障碍 bot.chat-identity）：HStack(spacing 10)：头像 36（含 main 标识）+ VStack(spacing 2)：名字 17 semibold 单行 + 副标题 12 secondary 单行。
  - 私聊副标题 = role（非空）否则「随时为你效劳」。
  - 群聊副标题 =「群聊」。
  - 点击：私聊 → 角色名片 Sheet；群聊 → 群成员 Sheet。
- 更多按钮（无障碍 bot.chat-more，44×44）：菜单两项——「重新同步」（arrow.clockwise）、「定时任务」（clock，打开 §6）。
- 页面级 Sheet/弹窗：提问 Sheet、定时任务 Sheet、角色名片、群成员、文件预览；附件错误 Alert「添加附件」。

### 4.2 时间线容器

BotModeView.swift:1113-1180

- 复用统一会话视口组件（滚动、高度缓存、贴底检测与工作模式同一套）。
- 内容最大宽度 748 居中；每条消息行 frame(maxWidth 748).frame(maxWidth infinity).padding(bottom 18)。
- 顶部内边距 topInset + 18；底部内边距 inputHeight + ComposerChrome 余量（输入框悬浮覆盖，消息可滚到其后方）。
- 历史加载：
  - hasEarlier 时在时间线顶部显示「加载更早消息」按钮（满宽，bottom 18）；historyLoading / 离线 / 不支持时禁用。
  - 触发 bot-call chat / room-chat（带 cursor），older 页 prepend；最新页替换重叠区。
  - 内存中每个聊天最多保留 2000 条消息；磁盘缓存最多 100 条（§9.5）。
- 首屏历史加载中：顶部 ProgressView +「正在读取聊天」（messages 与 interactions 同时为空时）。
- 贴底与「回到最新」：
  - 已呈现历史、消息非空、且当前未贴底时，在输入框上方显示圆形「回到底部」按钮（无障碍 scroll-to-bottom），点击滚到最新并隐藏。
  - 键盘聚焦、最后一条消息 delivery=sending 时自动滚底。
- 消息预渲染：对最近 24 条 + 更早 12 条非流式、非事件文本做 Markdown 预解析（性能优化，可等价实现分段缓存）。

### 4.3 消息行规格（BotModeView.swift:1463-1605）

通用：
- 头像 28，头像与气泡间距 8；助手行左侧头像、右侧 Spacer(minLength 40)；用户行左侧 Spacer(minLength 40)、无头像。
- 内容列宽：常规宽度（平板/宽屏）max 720；紧凑（手机）max 292；短消息按内容收缩。
- 时间：气泡下方 11pt secondary（含星期），无障碍 bot.message-time.{id}；仅 user/bot/post 消息显示。
- 发送状态（delivery 非空）：11pt secondary，文案：
  - sending →「发送中」
  - sent →「已发送」
  - unknown →「发送状态待确认，请同步聊天后核对」
- 助手回复操作：非流式、文本非空时，气泡下方显示复制/回复动作条（复用项目组件）；点「回复」把该文本作为引用插入输入框。
- 附件消息：先渲染气泡（若有文本/图片），再在头像内容缩进（28+8=36）处渲染文件卡片，最后动作条。

#### (1) 用户气泡

- 底色：浅色 = DSHColor.ocean 11% 叠加（代码走计算色，assets BotUserBubble 浅色 #E8EFFC 是同一视觉目标；鸿蒙取 #E8EFFC 即可）；深色 = BotUserBubble #2A3D57。
- 描边：浅色 0.7pt ocean 8%；深色无。
- 文字：17pt，lineSpacing 4，可选文本；颜色 primary。
- 圆角 20；内边距 水平 14、垂直 12；右侧对齐。

#### (2) 助手气泡

- 底色：按发言者取色板（§8.7），跨私聊/群聊同一成员同色；主 Bot 浅色 #F3EFF6，深色 #352D3D。
- 内容：Markdown 渲染（标题/列表/代码/链接/行内代码/表格），文字色 BotInk；图片按 §4.3(5)。
- 圆角 20；内边距 水平 14、垂直 12；左侧对齐。

#### (3) 群聊发言者

- 条件：群聊 且 非用户 且 message.name 非空。
- 气泡上方 12pt secondary 单行名字；与气泡左对齐（内容列内）。
- 身份：message.botId → 名册 chat（id/name/image/room）；未知作者回落为私聊对方；群聊内无回落则不显示名字/头像。

#### (4) 流式回复

- 数据：bot-event stream（phase=start 建立占位流式消息；delta 追加 text；end 收尾并重新读取 chat 落盘版本，§9.4）。
- 视觉：**iOS 没有独立闪烁光标**；消息行以 streaming=true 的 Markdown 内容随增量刷新，气泡随文本自然增长（流式期间禁用高度缓存、隐藏复制/回复动作）。
- 鸿蒙建议：保持「无独立光标」，或用 2px 主题色竖线做可选增强；不要新增 iOS 不存在的「生成中」状态条；若加光标需设计确认。
- 保护：bot-stream-reset → 有界指数恢复（2s/4s/6s，最多 3 次）。

#### (5) 图片

- 结构化 Agent 图片（message.images，来自官方会话附件引用）：按 Markdown 附件图渲染，无障碍 bot.image.{attachmentId}；点击走统一大图预览（横竖屏、保存、失败重试对话框「图片加载失败/重试」）。
- Markdown 图片（正文内图片语法）：复用统一 Markdown 图片组件与预览，不另做加载器。
- 预览与原图读取同一字节；预览尺寸由客户端组件缩放。

#### (6) 引用消息（用户发送的引用回复）

- 用户消息 text 含 Markdown 引用段时解析为 quoteParts：先渲染 SentReplyBubble（引用块），再渲染用户气泡（若还有正文）。
- 引用块样式复用项目组件；深色下 fill BotUserBubble、quoteFill BotGlassTint。
- 输入框上方 ComposerQuoteStack 显示当前引用，可逐个移除。

#### (7) 活动行（成员动态）

- message.activity ∈ {bot-created, bot-messaged}：HStack(spacing 6) 居中：文案「已创建」/「已发消息给」+ 头像 18 + 名字；footnote；secondary。
- 无气泡、无时间。

#### (8) 系统事件 / 分隔线

- kind = event / divider：居中 12pt secondary；文本为空时 divider 显示时间、event 显示「协作动态」。
- 群聊中即「系统事件行」（成员加入、Bot 创建等主机下发事件）。

#### (9) 已回答问答卡（历史）

- message.questionAnswers 非空时渲染：
  - 每题：问题 15pt semibold secondary → 选项行（spacing 10）：字母徽标（13pt semibold BotBlue，水平 8、垂直 5，BotBlue 12% 底，圆角 7）+ 选项文本 16pt BotInk。
  - 卡片：padding 16/12，BotCard 底，圆角 20，描边 BotLavenderSoft；最大宽 360，左对齐。

#### (10) 实时工作行（BotModeView.swift:1867-1904）

- 时间线尾部（最新消息之后）显示「Bot 正在做事」：头像 28 + 文案 +「· N 秒」。
- 文案映射：web-search「上网搜索…」、web-read「正在浏览网页…」、image「正在生成图片…」、switching-folder「正在切换工作文件夹…」、thinking「正在思考…」、其它「正在处理…」。
- 字体 14；颜色 BotSecondary；计时 1s 刷新，等宽数字，无障碍 bot.live-work-elapsed。
- 显示条件（visibleLiveWork）：存在 liveWork；同一聊天存在待回答交互卡时不显示；thinking 且最后一条消息 streaming 时不显示（避免与流式气泡重复）。

### 4.4 输入框（BotModeView.swift:1288-1413）

- 容器：VStack(spacing 6)，外层水平 padding 14，底部 padding = ComposerChrome.bottomPadding(safeArea)；玻璃面 radius 24，水平 14、垂直 8；深色 tint BotGlassTint 84% + edge BotGlassRim 70%；浅色默认 composer glass。
- 输入框：多行文本，minHeight 38，水平 3；聚焦/有草稿时展开附件栏，失焦收起但保留发送按钮（深色或有草稿时始终显示发送）。
- 占位文案：
  - 群聊：「发消息到群聊…」
  - 私聊：「发消息给 {名字}…」
  - 深色模式当前实现统一为「描述你想要构建的内容」（待确认项，见附录 D）。
- 附件按钮（左侧项目组件）：点击 Menu——「图片」（系统照片选择，最多 4 张）、「文件」（多选文件导入）。
  - 总附件上限 20（图片 + 文件），图片总大小 ≤12MB；超限提示「一次最多添加 20 个附件，请等待已有附件准备完成」/「图片总大小超出限制」。
  - 仅 connected 且 attachmentsSupported 且 writable 且非 attachmentSending 可用。
  - 图片先预处理（尺寸/格式），失败走 Alert。
- 发送按钮：42×42；图标 fill = 深色 BotSend，浅色 ocean（#2E6BE6）；无障碍「发送消息」。
  - 可用条件：有草稿/附件、已连接、可写、非导入中、非 preparing、非 attachmentSending、附件 ready。
- 发送行为：
  - 生成乐观用户气泡（delivery=sending，id=requestId）。
  - 无附件 → bot-call send {sessionId, text}；有附件 → send-attachments {sessionId(官方会话), chatId, text, images[], receipts[]}。
  - 成功后气泡 delivery=sent 并重新读取 chat/state；附件发送成功回执触发 lastAttachmentAck → 清空草稿与已选图片、收键盘。
  - 32 秒无回执 → 未知：气泡保留且 delivery=unknown，**不自动重发**（§9.7）。
- @ 引用（mention）：
  - 输入 @（光标处、无选区、非附件发送中）弹菜单（玻璃面 radius 20，最大高度 220）。
  - 分组：成员 / 文件与文件夹 / 对话；成员显示头像 22；目录有展开箭头（drill）；「所有人」固定项。
  - 输入 180ms 防抖请求 reference-candidates {chatId, query, quoted}；上限 48 项；不可用「暂时无法读取引用」，无匹配「没有匹配的引用」。
  - 选中后以显示文本插入，wire text 使用协议引用格式。
- 引用回复：气泡操作「回复」→ 插入引用到草稿（输入框有选区则替换）；QuoteStack 可移除。
- 键盘：
  - 聚焦自动滚到底；轻触聊天区收键盘；输入框始终高于软键盘（安全区 reader + 额外 inset），横屏同样不被遮挡。
  - 附件错误 Alert 仅一个「好」。

### 4.5 群聊页差异（相对私聊）

| 项 | 私聊 | 群聊 |
|---|---|---|
| 副标题 | role / 随时为你效劳 | 「群聊」 |
| 点击身份 | 角色名片 | 群成员列表 Sheet |
| 气泡上方 | 无 | 非用户且有 name 时显示名字 12pt secondary |
| 头像取色 | 固定对方色 | 按发言者取色（同名册成员跨聊天同色） |
| 活动行 | 可能出现「已发消息给」 | 「已创建」/「已发消息给」（成员动态） |
| 系统事件 | 有 | 有（更多） |
| 输入框占位 | 发消息给 X… | 发消息到群聊… |
| 群成员 Sheet | — | 成员行：头像 40 + 名字 + 角色 12pt caption；点成员进角色名片；标题「群成员」，取消「关闭」 |
| 顶部群头像 | 单头像/首字 | 成员拼贴：最多 4 席位 +「+N」（§8.6） |
| 会话 ID | 不显示 | 不显示 |

说明：群聊与私聊**共用**同一消息行、时间线、输入框与交互卡代码路径；群聊不做独立页面。

### 4.6 聊天页错误态

- 顶部错误：snapshot.error 在输入框上方显示 caption secondary（botErrorText 映射，§9.8）。
- 历史加载失败/超时：不清空已缓存消息；用户可点更多菜单「重新同步」。
- 附件失败：Alert「添加附件」，message 为附件错误文本。
- 群聊图片归属：官方 API 未提供稳定来源映射时**不猜测作者**，按官方公开行渲染（§12）。

---

## 5. 交互卡片

### 5.1 提问（question）

时间线内卡片（BotModeView.swift:1246-1265）：

- 顶部「助理在等你回答」：12pt secondary。
- 标题：17pt semibold。
- 详情：15pt secondary（可空）。
- 按钮「回答」（项目主按钮样式）。
- 卡片：水平 16 / 垂直 16，BotCard 底，圆角 20，最大宽 748，bottom 18。

回答 Sheet（BotModeView.swift:1762-1794）：

- NavigationStack + Form：
  - Section 1：标题 + 详情（secondary，可空）。
  - Section 2：选项行（文本 + 选中时尾部 checkmark）；「补充回答」多行 TextField（2–6 行）。
- 选择逻辑：
  - 单选：点选项 → 选中并清空补充回答；再点已选项 → 取消选择。
  - 多选：点选切换。
- 导航：标题「回答助理」inline；左「取消」；右「提交」。
- 提交可用：已选至少 1 项 **或** 补充回答去空白非空；否则禁用。
- 提交：bot-call answer-question {sessionId, questionId, answer:{selected:[...], custom?}}；成功后关 Sheet；失败按错误处理，不自动重试。
- 验收：初始提交禁用、选中后可用、取消后卡片仍在（BotModeUITests.swift:625-636）。

### 5.2 审批（approval）

时间线内卡片：

- 顶部「需要你批准」：12pt secondary。
- 标题 17pt semibold（reason 或工具名）；详情 15pt secondary。
- 按钮行：左「拒绝」（destructive 红色文字）、右「仅允许这一次」（主按钮）。
- 卡片同上（BotCard、圆角 20、maxWidth 748）。
- **只提供「拒绝 / 单次允许」两种**，没有「始终允许」。
- 提交：bot-call approval-answer {id, choice: "allow" | "reject"}。
- 显示条件：work.approvals 每项且 answerable != false；增量（unchanged）时保留旧 approval 之外的新列表，避免闪烁。
- 状态：点击后按钮立即禁用防重复；结果未知按 §9.7（不自动重试）。

---

## 6. 定时任务面板（BotScheduleSheet）

入口：首页「定时任务」快捷卡；聊天页更多菜单「定时任务」。两处同一 Sheet。

### 6.1 面板规格（BotModeView.swift:797-864）

- 呈现：sheet + 拖动条可见 + 高度 660（presentationDetents [.height(660)]）+ 圆角 32 + 背景 BotGroupedSurface。
  - 平板/大屏：文档口径「居中靠下的 580 点宽面板」（Android 显式 580；iOS 为系统 page sheet 形态）。鸿蒙建议：手机全宽 bottom sheet，平板/宽屏固定 580 宽居中偏下并保留拖动条。
- 内边距：水平 20、上 28、下 20；VStack(spacing 18)。
- 标题行：标题「定时任务」22pt semibold（无障碍 bot.panel-title）+ Spacer + 关闭按钮 40×40 玻璃圆钮（xmark 17 semibold，无障碍「关闭」，id bot.schedules-close）。
- 副标题：「让助理按时替你做事。」15pt secondary。
- 列表：ScrollView + LazyVStack(spacing 12)。
- 底部说明：12pt secondary 左对齐，「完成后，{主 Bot 名} 会在聊天里告诉你。」；浅色固定在面板底部，深色放在滚动内容末尾。
- 只读语义：**面板不提供新建/编辑/删除**（无按钮、无滑动操作）；点击行无导航。角色页另有定时任务管理（§7.8）。

### 6.2 列表行

- HStack(spacing 12)：
  - 时钟图标 20pt，BotPurple，36×36 底 BotLavenderSoft，圆角 12。
  - 文本列（spacing 4）：标题 17pt semibold；状态 12pt secondary（主机 status，如「每天 · Chief」）。
  - 右侧下次时间：17pt semibold BotPurple，右对齐，maxWidth 110，可换行。
- 容器：padding 16，minHeight 96，BotCard 底，圆角 22。

### 6.3 空/加载/错误态（无障碍 bot.panel-state）

- 同一卡片（padding 16，圆角 20）内：
  - 有错误：错误文案（§9.8）+「重新同步」按钮（BotPurple）。
  - loading：「正在同步助理」。
  - 否则：「还没有定时任务」。
- 文字均 secondary；卡片满宽左对齐。
- 大字号/横屏：面板高度预算包含拖动条+标题+正文+底部+安全区；窄窗口列表只占剩余空间；1.5 倍字号不裁切。

---

## 7. Bot 管理

### 7.1 我的 Bot（BotManagementView.swift:5-66）

- 页面骨架：
  - 顶部自定义栏 minHeight 60，水平 24：左侧返回（chevron.left 15 semibold，44×44 圆形 pill 带阴影；或「取消」文字 pill 13 medium，minHeight 40）；标题 17 semibold 居中；右侧 action。
  - 内容 ScrollView：VStack(spacing 16) 水平 24、上 8、下 16，最大宽 560 居中。
  - 背景 canvas（浅 #F5F3F9 / 深 #1B1924），文字 BotInk；隐藏系统导航栏。
- 右上 action：「新建 Bot」pill（plus 图标 + 13pt medium，minHeight 40，卡片底 + rim 描边）；不可创建时禁用并 45% 透明；无障碍 bot.new。
- 内容：
  - 行：caption「团队成员」（13 secondary）+ 右侧「{N} 个 Bot」（13 secondary）。
  - 不可创建提示（13 secondary）：未连接「连接主机后可以创建 Bot」；只读「当前主机为只读」；能力缺失「请更新主机上的移动网关和 DS Bot 后再创建 Bot」。
  - 列表空态：loading → ProgressView；否则「还没有 Bot」卡（padding 16，圆角 20）。
  - 列表卡（BotCard 底，圆角 20，1pt rim 描边）：
    - 行 minHeight 72，水平 16、垂直 12；头像 44 带 BotLavenderSoft 圆角 14 底；名字 17 semibold；主 Bot 徽标（10pt medium，BotPurple，BotLavenderSoft 底，圆角 6，水平 7 垂直 3，文案「主 Bot」）；角色 12 secondary；右侧 chevron.right 12 semibold。
    - 行间分隔线 BotLine 45% 透明，水平 16。
    - 无障碍 bot.roster.{id}；点击打开角色名片 Sheet。
- 能做什么：查看全部 Bot（含隐藏）、新建 Bot、进入角色名片（进而设置/复制/删除/换主 Bot）、查看主 Bot 标记。**列表页本身不做删除/编辑**。

### 7.2 新建 Bot（BotManagementView.swift:223-406）

- 标题「新建 Bot」；保存中返回禁用。
- 表单区块（顺序）：
  1. 形象行（无障碍 bot.create.appearance）：52 头像瓷片 +「形象」15 medium + 说明（使用自动分配的形象 / 使用自定义形象 / 使用 X 形象）+ 右侧「编辑」/「重试」13 semibold accent + chevron；卡片 minHeight 84 padding 16；点进编辑形象页。
  2. 名字：caption「名字」+ TextField（minHeight 52，水平 16，垂直 10，16pt，BotCard 底，圆角 16，1pt BotLine 描边），占位为自动生成名；留空提示「留空会使用自动生成的名字。」；用户编辑后校验：重复「已经有一个同名 Bot。」、长度「名字最多 40 个字符。」、保留「这个名字在群聊中有保留用途。」、非法字符「名字不能包含 @、反引号或控制字符。」（13 红字）。
  3. 运行方式：caption + 分段控件「DS Bot 模型」/「本地 Agent」（无障碍 bot.create.mode）。
  4. 本地 Agent（选中本地时）：caption；加载 ProgressView / 失败行「无法读取本地 Agent · 重试」/ 空「未发现本地 Agent」；列表行（terminal 图标 + 名称 + 已登录/可用/未登录 + 选中勾），不可用禁用；无障碍 bot.create.agent.{id}。
  5. 模型：caption；行（「所选模型」/「模型」+ 当前值 + chevron，无障碍 bot.create.model）→ 模型选择页；本地模式文案「沿用 {agent} 的默认模型。」，云端「沿用主机预选模型，可在 Bot 详情中修改。」。
  6. 错误：创建失败「创建 Bot 失败，请检查主机连接和设置后重试。」/ 未知「暂时无法确认创建结果，请返回列表查看。」（13 红）。
- 底部主按钮：胶囊「创建 Bot」（16 semibold 白字，minHeight 50，背景 #6C50A7，禁用 45%；saving 时白色 Spinner），无障碍 bot.create.submit。
- 可提交条件：canCreateBot、名字无问题、形象已选、本地模式必须选 agent 且可用、创建状态非 uncertain。
- 成功后 createdId 非空自动 dismiss，列表出现新 Bot。

### 7.3 编辑形象（BotManagementView.swift:480-577）

- 标题「编辑形象」；内容：
  - 大预览：size 72（无瓷片底），minHeight 84 卡片。
  - 「形状」：5 列网格，每格 52 高、圆角 14；选中 BotLavenderSoft 底 + 1.5pt accent 描边；无障碍 label = shape id。
  - 「颜色」：6 列，每色 31×31 圆、37×38 点击区；选中 2pt accent 描边，未选 0.75pt 白描边。
  - 操作行（ViewThatFits 横/竖）：随机（shuffle）/ 上传照片 / 头像库（archivebox）；pill 13 medium，minHeight 40。
  - 照片失败提示「无法读取或处理所选照片。」。
- 底部「完成」胶囊（无障碍 bot.appearance.done）。
- 头像库页：标题「头像库」，右上「导入照片」pill；网格自适应 72；空态「头像库还没有照片。」；失败行「头像库操作失败 · 重试」；加载更多行；点击照片回填。
- 照片规则：预处理到固定字节/边长上限（BotCreationRules.PHOTO_BYTES / PHOTO_SIDE），以 data URL 传主机。

### 7.4 模型选择（BotManagementView.swift:408-462）

- 标题「选择模型」；caption「可用模型」；卡片行：名称 + 右侧「已选」/「选择」；本地模式顶部「CLI 默认」行；加载 ProgressView；云端空态「主机暂无可选模型」。
- 云端另有「思考强度」Menu 行（当前值/系统默认 + chevron），选项来自所选模型的 efforts；caption「主机会提供模型和它所支持的思考强度。」。

### 7.5 角色名片（BotModeView.swift:1919-2028）

- Sheet：NavigationStack + List(insetGrouped)，背景 BotGroupedSurface。
- 头部：头像 80（main 标识）+ 名字 largeTitle bold + 角色 subheadline secondary + 说明 footnote secondary 居中。
- 信息区：模型 / 权限 / 工作文件夹（LabeledContent，BotCard 行底）。
- 功能区：
  - 记忆（memoryAvailable 时）：行右侧数量 → 记忆页。
  - 定时任务：右侧该 Bot 任务数（无障碍 bot.role-schedules）→ 角色定时任务页。
  - 近 30 天用量（input+output 格式化）。
- 工具栏：浅色「角色设置」齿轮（无障碍「角色设置」）+ 左侧「关闭」；深色用玻璃圆钮齿轮 + 关闭。
- 呈现：手机深色紧凑时 detent 650 与 large 可拖动切换；其余 large；拖动条可见；圆角 32。
- 关闭：右上关闭/下拉。

### 7.6 角色设置（BotModeView.swift:2030-2274）

Form 区块与字段（顺序）：

1. 头部资料行：头像 56 + 名字 title2 bold + 角色 caption（透明行底）。
2. 资料：名字（右对齐 TextField）、标签（右对齐，选填；footer「标签为选填，会显示在 Bot 名字下方。」）。
3. 模型：模型 Picker（「默认模型」+ 主机模型列表；保留未知 id）、推理强度 Picker（「默认」+ efforts；仅当 efforts 非空或已有值）；footer「模型更改从下一条消息开始生效。」。
4. 工作区与权限：工作文件夹（右对齐 TextField，占位「总工作区」）、权限 Picker（「默认权限」+ permissions）、隐私 Toggle（主 Bot 禁用）；footer：danger-full-access 时「允许修改工作区以外的文件，范围仍受主机系统权限限制。」+ 隐私说明（主 Bot 不能开启隐私 / 有群聊时需先移出 / 无独立工作文件夹需先设置 / 开启后其他 Bot 无法读取其文件夹、记忆与对话，分享内容需批准）。
5. 说明：TextEditor minHeight 88，占位「这个 Bot 负责什么…」；footer「这段说明会写入 Bot 的系统提示词。」。
6. 操控：只读行「电脑操控 已开启/已关闭」；footer「各 Bot 的电脑操控授权可在 DS Bot 网页端管理。」。
7. 记忆 / 定时任务导航行。
8. 主 Bot 区（仅主 Bot）：「更换主 Bot」Menu（候选非私密 Bot）→ 二次确认「更换主 Bot？」取消/确认；footer「主 Bot 可以创建和修改团队 Bot，并管理群聊。」。
9. 管理：「复制一份」→ 确认「复制这个角色？」；「删除 Bot」（红色 + chevron，无障碍 bot.role-delete，仅非主 Bot 且 botDeletionSupported）→ 确认「删除 Bot？」message「将"{名字}"移出团队和所在群聊。」；footer「复制分工和模型，新 Bot 从空白记忆开始。」。
10. 错误行：roleError 映射为红字。
- 右上「保存」：无改动或名字为空时禁用；roleSaving 显示 Spinner；保存 permission 改为 danger-full-access 时先弹「确认授予完全权限？」取消/确认（destructive）。
- 编辑可用性：connected 且 roleSettingsSupported 且 writable 且非 roleSaving；否则整表禁用。
- 键盘：滚动区交互式收键盘；点表单空白收键盘。

### 7.7 记忆（BotModeView.swift:2302-2381）

- 列表：空态「还没有记忆」；行文本可点编辑；左滑「删除」→ 确认「删除这条记忆？」；右上 +（无障碍「添加记忆」）。
- 编辑页：TextEditor（无障碍 bot.memory-editor）+ 占位；标题「编辑记忆」/「添加记忆」；保存按钮（去空白非空才可用）。
- 长文本编辑：编辑器高度 >160 且键盘不遮挡（UITest 断言）。

### 7.8 角色定时任务（BotModeView.swift:2383-2444）

- 列表：空态「还没有定时任务」；行 LabeledContent(标题, next)，无障碍 bot.role-schedule.{id}；可编辑时左滑「删除」→ 确认「删除这个定时任务？」；右上 +「新建定时任务」。
- 新建页 Form：任务名称、任务内容（多行）、每天运行时间 DatePicker(hourAndMinute，无障碍 bot.role-schedule-time)；保存（名称/内容非空才可用）。
- 协议：schedule-create {target:botId, title, prompt, when:{kind:"daily", time:"HH:mm", timeZone}}；删除 schedule-delete {sessionId, id}。
- 与首页只读面板的关系：首页面板不提供管理，管理只在本页。

### 7.9 新建群聊 / 查找 Bot（BotManagementView.swift:643-791）

- 新建群聊页：标题「新建群聊」；List insetGrouped，maxWidth 608：
  - 头部：「选择群聊成员」28pt semibold +「第一位选中的成员为管理员。」14 secondary（无障碍 bot.group.admin-note）+ 已选成员 chips（「1 名字 · 管理员」/「2 名字」，可移除，无障碍 bot.group.remove.{id}）。
  - 搜索：TextField「搜索名称或角色」（无障碍 bot.conversation.search）。
  - 成员行：头像 36 + 名字 17 + 角色 13 secondary + 选中时右侧序号（第一位显示「管理员」+序号）；无障碍 bot.conversation.member.{id}，value=管理员/已选择。
  - 首条消息（选填）多行 TextField 2–5 行，无障碍 bot.group.message。
  - 不可写提示 + 错误区（uncertain 时「暂时无法确认提交结果…」并提供「已核对列表，确认未创建」）。
  - 底部安全区栏：说明「不填写首条消息时，管理员会先询问群聊用途。」+ 主按钮「创建群聊 · N 位 Bot」（N≥2 才可用，无障碍 bot.group.create）；群已创建但首条消息失败时按钮变「重试发送首条消息」，并出现「进入群聊」按钮（无障碍 bot.group.enter）。
- 查找 Bot 页：标题「查找 Bot」；同搜索 + 成员行（点击直接打开聊天，隐藏 Bot 先恢复）；footer「可选择已从侧边栏隐藏的 Bot。」。
- 创建逻辑：members 有序（首位 admin）；空消息 → create-room {members, admin, greet:true}；有文字 → 先 create-room 再 send；失败保留草稿；提交中锁定；成功进入聊天。

---

## 8. 视觉规格

### 8.1 颜色（浅色 / 深色，Assets.xcassets）

| Token | 浅色 | 深色 | 用途 |
|---|---|---|---|
| BotInk | #252332 | #F2EEF6 | Bot 页正文/图标主色 |
| BotSecondary | #5C536C | #D8D2E1 | 次级文字 |
| BotPurple | #7760B4 | #C8B5E8 | 强调色 |
| BotLavender | #F4F1FA | #17161F | 会话页深色底 / 浅紫基色 |
| BotLavenderSoft | #ECE7F7 | #333044 | 图标底、徽标底、选中态 |
| BotCard | #FFFFFF | #292733 | 卡片底 |
| BotGroupedSurface | #F2F2F7 | #211F2A | 面板/表单底 |
| BotLine | #DAD6E3 | #484354 | 分隔线、描边 |
| BotGlassTint | #FFFFFF | #2D2A38 | 玻璃 tint |
| BotGlassRim | #DAD6E3 | #777184 | 玻璃描边 |
| BotBlue | #2E6BE6 | #A1BFF6 | 问答字母徽标、首字 |
| BotSend | #2E6BE6 | #101A42 | 深色发送按钮填充 |
| BotUserBubble | #E8EFFC | #2A3D57 | 用户气泡 |
| cardAccent（代码内） | #584190 | BotPurple | Chief 状态文案色 |
| 未读角标 | #D6263C | 同 | 红角标胶囊 |
| 运行绿点 | #2EB85C | 同 | success |
| 群成员气泡（浅） | #E7EFE7 / #F3E7EA / #F3ECDF / #E4ECEF / #F2E7E1 | — | 按成员 id 排序轮转 |
| 群成员气泡（深） | — | #2C3D34 / #402F3A / #40382E / #2A3A43 / #42322F | 同上 |
| 主 Bot 气泡 | #F3EFF6 | #352D3D | 固定 |
| 未知作者气泡 | #F0EFED | #302E35 | 兜底 |
| 管理页 canvas | #F5F3F9 | #1B1924 | Bot 管理页背景 |
| 管理页 secondary | #74727E | #D8D2E1 | 管理说明 |
| 管理页 rim | 透明 | #777184 | 卡片描边 |
| 管理页 action | #6C50A7 | 同 | 主按钮胶囊 |

背景（浅紫主题）：
- 浅色：以 BotLavender 为基色，叠加流体几何（渐变 #EBE0F7 / #E0D4F0 近似）+ 光弧 + 技术网格 + 鲸鱼点阵；网格墨色 rgb(0.43,0.32,0.62) ≈ #6E529E；光弧 #C9B3E3 → #E6D9F5。
- 深色：基色 #17161F；几何/网格以黑紫（0.30,0.27,0.34 / 0.24,0.21,0.28）低透明度叠加；鲸鱼点阵保持同几何。
- 要求：只换色，不换几何/层序/动画节奏；Android 13+ 与 iOS 用同一流体着色器；鸿蒙按同一参数族实现。

### 8.2 玻璃材质

- 首页卡：圆角 20（聊天列表 24、Chief 22、聊聊 26）；浅色 tint 白 12% + clear glass；深色 tint BotCard 86%；阴影 navy 6%（radius 16, y 8）。
- 旧系统等价：浅色 thinMaterial；深色 ultraThinMaterial 82% + tint + 白描边 0.8（浅色 0.7）+ 阴影。
- 圆形玻璃按钮：40×40（更多 44×44）；深色背景 clear tint navy 22%；旧系统 ultraThinMaterial + 白 25% 描边。
- 输入框玻璃：半径 24（mention 菜单 20）；浅色 tint secondarySystemBackground 48% + 白 56% 描边 0.7 + 黑 10% 阴影（radius 10, y 2）；深色 tint 52% 或 BotGlassTint 84% + 白 13% 描边 + 黑 24% 阴影。
- 鸿蒙建议：背景模糊 + 半透明色 + 1px 内描边 + 轻阴影；保持轻，不堆厚阴影。

### 8.3 字体与字号

系统字体 + 应用字号倍率（0.8–1.5）；1.5 倍走单栏回退。

| 场景 | 字号/字重 |
|---|---|
| 首页大标题「个人助理」 | 32 bold |
| 首页副标题 | 15 regular secondary |
| 区块标题 | 17 semibold |
| 卡片标题、聊天行标题、消息内标题 | 17 semibold |
| 正文/消息 | 17 regular（用户气泡 lineSpacing 4） |
| 聊天行副标题 / 错误说明 | 15 regular secondary |
| 快捷卡标题 | 15 regular |
| 快捷卡数字 | 17 semibold |
| 状态/时间/计数 | 12 / 11 |
| 角标 | 11 semibold |
| 系统事件/活动 | 12（活动 footnote） |
| 群聊发言者名 | 12 regular secondary |
| 角色名（名片） | largeTitle bold |
| 面板标题 | 22 semibold |
| 管理页主按钮 | 16 semibold |
| 管理页 caption | 13 regular |
| 管理页徽标 | 10 medium |

### 8.4 关键尺寸

| 元素 | 尺寸 |
|---|---|
| 首页水平内边距（手机/宽屏） | 22 / 40 |
| 首页段落间距 | 16（手机）/ 40（宽屏） |
| 标题与内容间距 | 3（手机）/ 6（宽屏） |
| 首页顶部 Spacer | 44（手机） |
| Chief 头像 | 44 |
| Chief 卡 / 与Chief聊聊 / 快捷卡 / 聊天行 高 | 66 / 52 / 66 / 76 |
| 聊天头像 | 48 |
| 列表分隔线缩进 | 76 |
| 搜索框高 | 44 |
| 消息头像 | 28 |
| 助手行内容最大宽（手机/平板） | 292 / 720 |
| 消息行容器最大宽 | 748 |
| 气泡内边距 / 圆角 | 14×12 / 20 |
| 用户气泡描边 | 0.7 |
| 输入框圆角 | 24 |
| 发送按钮 | 42×42 |
| 定时任务面板高度 | 660（拖拽条可见）；平板 580 宽居中 |
| 定时任务行高 | min 96 |
| 角色名片头像 | 80 |
| 设置页头像 | 56 |
| 管理列表头像 | 44（底 14 圆角） |
| 群成员行头像 | 40 |
| 头像圆角（BotFace） | size/3 |
| 管理页内容最大宽 | 560；群聊选择页 608 |
| 宽屏左栏 | min(440, W×0.38) |
| 宽屏栏间距 / 外边距 | 48 / 40 |
| 页面最大内容宽 | 1440 |

### 8.5 图标

| 资源 | 规格 |
|---|---|
| BotDrawerMark（抽屉进 Bot） | 24×24，DS Bot 鲸鱼原始矢量，黑 #000000 |
| WorkspaceDrawerMark（抽屉回工作） | 24×24 |
| BotConversationMark | 25.2422×20.1094 |
| BotGroupAvatar | 48×48 源（群头像拼贴基准） |
| BotModeSwap | 16.0125×19.6064（设计资源；iOS 当前抽屉改用双箭头 SF 图标） |
| 系统图标 | plus、xmark、chevron.left/right、clock、gearshape、ellipsis、arrow.clockwise、photo、doc、folder、bubble.left、person.2、terminal、shuffle、archivebox 等，用平台等价图标 |
| 主 Bot 头像 | WhalenessOrcaIcon，占头像 58% |

### 8.6 头像规则（BotAvatar / BotFace）

- 普通 Bot：有主机下发 image → 渲染该图；否则首字，字号 = size×0.42 semibold，色 BotBlue。
- 主 Bot 无图：WhalenessOrcaIcon，占 size×0.58，色 BotInk。
- 群聊：成员拼贴：
  - 成员数 1 → 单头像；
  - 2–4 → 按席位布局拼贴；>4 → 第 4 席显示「+{N}」（字号 side×0.36 semibold）；
  - 每席 BotLavenderSoft 底、圆形裁切、1pt 描边（浅色白 / 深色 BotLine）；
  - 无成员时用 BotGroupAvatar 群图。
- 圆角：BotFace 统一 size/3；拼贴内部为圆形。
- 加载：data URL 经图标缓存（深浅色变体）；失败回落首字/鲸鱼。

### 8.7 气泡色板（BotBubblePalette）

- 候选成员 = 所有非群聊且非主 Bot 的 chat.id，去重后**按 id 排序**，索引 mod 5 取色。
- 主 Bot 固定色；未知 botId 用兜底色。
- 同一成员在私聊与群聊颜色一致；名册顺序变化不影响颜色（排序保证稳定）。
- 实现要求：颜色只依赖成员 id 排序与主 Bot id，不依赖列表顺序/首次出现顺序。

### 8.8 宽屏 R2 参数汇总

| 参数 | 值 |
|---|---|
| 触发 | 宽 ≥760 且 高 ≥500（或搜索聚焦）且非辅助字号且字号倍率 <1.5 |
| 左右边距 | 40 / 40 |
| 左栏宽 | min(440, 窗口宽×0.38) |
| 栏间距 | 48 |
| 右栏 | 填满剩余宽度，顶部对齐 |
| 页面最大宽 | 1440（居中） |
| 垂直分组间距 | 40 |
| 顶部偏移 | safeArea.top + 18 |
| 底部偏移 | safeArea.bottom + 24 |
| 搜索框 | 44 高；结果数；无结果卡 ≥138（设计 170） |
| 返回/旋转 | 保留搜索条件；键盘不破双栏 |
| 单栏回退 | 任一条件不满足（含 1.5 倍字号、辅助字号、高度不足且未聚焦） |

### 8.9 方向与安全区

- iPhone/小屏（最小宽度 <600dp）：工作、Bot、图片预览固定竖屏；iPad/大屏保留系统横竖屏。
- 键盘：输入框始终高于软键盘；横屏同样；聊天区点击收键盘；面板/设置滚动区交互式收键盘。
- 底部安全区：输入框底部余量 = 安全区 inset + 固定 padding；聊天页忽略底部 container 安全区但用 reader 取真实 inset（避免双倍留白）。

---

## 9. 状态机与数据

### 9.1 通道与握手

- 复用既有配对 + control WebSocket（设备凭据；不需要浏览器 Cookie）。
- 网关 hello 声明网关能力（diagnosticsCapabilities 含 bot-v1 表示 Bot 桥接可用）；APP 侧 supportsBots = hello.capabilities 包含 bot-v1。
- Bot 帧独立于工作会话历史通道：kind/requestType 前缀为 bot- 的帧分流到 onBotFrame，不占用工作会话订阅/历史通道。
- 主机侧固定路由 /api/bot 与 /api/bot/feed；APP 只发白名单 endpoint。

### 9.2 请求/回执

- 订阅：APP → {type:"bot-subscribe", requestId}；主机 → {kind:"bot-subscribed", requestId, hello:{capabilities:[...]}}。
- 调用：APP → {type:"bot-call", requestId, endpoint, payload}（requestId 全局唯一、按请求独立关联）。
- 成功：{kind:"bot-result", requestId, endpoint, value}；**必须校验 endpoint 与 requestId 双匹配**，否则丢弃（防旧回执/串包）。
- 失败：{kind:"error", requestId, code, message}。
- 事件：{kind:"bot-event", subscriptionId, botEvent, botData}。
- 流中断：{kind:"bot-stream-reset", subscriptionId} → 置 feed 失活，平台做有界恢复（iOS 最多 3 次，延迟 2/4/6 秒后 refresh；不在共享层忙循环）。
- 客户端超时：每个 bot-call 32 秒；到时 requestFailed(code="bot-timeout")。
- 能力协商（hello.capabilities）：bot-conversations（新建群聊/恢复隐藏 Bot）、bot-creation（创建 Bot）、role-settings（角色设置可写）、bot-attachments（附件）、reference-candidates（@引用）、bot-deletion（删除 Bot）。

### 9.3 endpoint 清单（SharedBotStore 实测）

| 类别 | endpoint | 关键 payload / 说明 |
|---|---|---|
| 快照 | state | {avatars:"ref", since:revision}；value: revision, unchanged, mainBotId, mainBotIds, bots[], rooms[], models[], permissions, prefs.defaultBotModel, defaultModel, memory, computer, readOnly, work{bots,rooms,turns,approvals,steered}, questions{}, notices 游标 |
| 聊天 | chat | {botId, historyDetails:true, cursor?}；value: items[], cursor |
| 群聊 | room-chat | {roomId, cursor?} |
| 通知 | notices | {boot?, since}；value: boot, noticeSequence, notices[] |
| 定时任务 | schedules | value: available, tasks[{id,title,status,scheduledAt,botId,sessionId}] |
| 发送 | send / send-attachments | {sessionId, text} / {sessionId(官方会话), chatId, text, images[], receipts[]} |
| 交互 | answer-question | {sessionId, questionId, answer:{selected[], custom?}} |
| 交互 | approval-answer | {id, choice:"allow"/"reject"} |
| 群聊 | create-room | {members[], admin, greet?}；value: room |
| 恢复隐藏 | set-flags | {id, hidden:false} |
| 角色 | update-bot / duplicate-bot / delete-bot / set-main | 角色设置、复制、删除、换主 Bot |
| 角色 | memory-view / memory-add / memory-edit / memory-forget / usage-summary | 记忆与用量 |
| 角色 | efforts | {ref} → efforts[] |
| 定时 | schedule-create / schedule-delete | {target,title,prompt,when{kind:"daily",time,timeZone}} / {sessionId,id} |
| 创建 | creation-appearance / local-agents / local-agent-models / avatar-library / avatar-import / create-bot | 创建流程 |
| 引用 | reference-candidates | {chatId, query, quoted} → items[]（≤48） |
| 头像 | avatar | {botId} → ref/image（<256KB data URL） |
| 图片 | image 分块 | 由统一 MarkdownImageLoader 发起（offset/rev/MIME/大小校验） |

### 9.4 bot-event 种类与处理

| botEvent | botData | 处理 |
|---|---|---|
| hello | boot, noticeSequence | 记录 feed boot；boot 变化时清空 revision/histories/cursors/streams；读 notices + state + 当前 chat |
| revision / live | — | 读 state（增量） |
| message | botId | 读 state；若等于当前聊天再读 chat |
| room | roomId | 读 state；若等于当前聊天再读 room-chat |
| notice | seq, kind, roomId/botId, text, name | seq>noticeSeq 入队/处理，必要时补读 notices；读 state |
| stream | botId, attemptId, phase(start/end/其它=delta), text | start 建 streaming 气泡；delta 追加（≤200k）；end 收尾并读 chat |

### 9.5 缓存策略（按主机隔离）

- 每台主机一个 SharedBotStore 实例；iOS 缓存文件：Caches/BotMode/{sha256(profileID)}.json。
- 版本 1 结构：{version, snapshot, histories, optimistic, noticeBoot, noticeSeq, readThrough}。
- 限制：
  - 历史最多保留 **12 个聊天**，每个聊天最近 **100 条**；
  - 序列化后 ≤ 7.5MB（超出淘汰最早聊天页）；iOS 读取文件 ≤8MB；
  - 内存内每个聊天最多 2000 条。
- 落盘清洗在线态：connected=false、loading=false、historyLoading=false、feedActive=false、selectedChatId=null、messages=[]、interactions=[]、error=null、roleSaving/roleDetails/roleError=null、effortModel/efforts=[]、roleSettingsSupported=false、attachmentsSupported=false、attachmentSending=false、lastAttachmentAck=null、referencesSupported=false、referenceSearch=null、botDeletionSupported=false、liveWork={}、creation 与 conversation 重置。
- 待确认消息：optimistic 消息写盘时一律 delivery="unknown"。
- 恢复：清空在线/流式/交互等待状态与选中会话；读回后 connected/supported=false；连接恢复后重新读 state/notices/当前聊天，以主机落盘消息为准。
- iOS 写盘：状态变更后 600ms 防抖，异步队列原子写入（completeFileProtectionUntilFirstUserAuthentication）；只写非空 json。
- 鸿蒙建议：按 hostId 分文件 + 12×100 + 7.5MB 淘汰 + 清在线态 + 防抖写 + 原子替换。

### 9.6 未读数与「done 提醒」

未读来源（唯一）：
- bot-event notice 到达或 notices 回放时 recordNotice：
  - kind ∈ {done, question, approval, group, message} → 写入 recent（最多 30 条，倒序，id=boot:seq）。
  - 仅 kind ∈ {group, message} 且 chatId 非空、且**不是**「前台且当前正打开该聊天」、且 seq > readThrough[chatId] → unreadCounts[chatId] += 1。
- 打开聊天（selectChat）或收到消息时若前台且正打开该聊天 → markChatRead：记 readThrough[chatId] = max(noticeTip, 旧值)，移除 unreadCounts[chatId]。
- 回到前台 setForeground(true) 也会 markChatRead 当前聊天。
- 未读展示：99+ 截断；运行中优先显示绿点（未读数字隐藏）。
- 不根据普通回复推断未读；不硬编码任何计数。

done 提醒：
- 触发来源是主机 notice kind="done"（DS-Bot 的完成提醒），不是「猜测任务完成」。
- 当前 iOS 到达后仅写入 snapshot.recent（首页不渲染），**不触发本地通知**（文档明确：Bot 事件尚未接入通知管理器）。
- 鸿蒙可实现本地通知（后续项），但必须满足「仅由 done 事件触发、不猜测」；done 不计未读。

### 9.7 断线与「状态待确认」

- 写操作（send / send-attachments / create-room / 角色写 / 定时写 / 审批与回答）**从不自动重试**。
- 不确定集合：bot-timeout、request-timeout、timeout、disconnected、connection-lost、not-connected、bot-invalid-response → 状态记 uncertain。
- 用户消息：乐观气泡 delivery=sending → 超时/断线变 unknown，文案「发送状态待确认，请同步聊天后核对」；刷新历史后按主机落盘结果核对/替换。
- 建群：uncertain 后保持「已创建/未创建不明」保护，禁止重复提交；UI 提供「已核对列表，确认未创建」解除；群已创建但首条消息失败 → 只重试发送（不重建群）。
- 普通发送失败（非不确定错误码）：移除对应乐观气泡并显示错误（不伪造成功）。
- 断线：清除图片/附件进行中状态；保留缓存展示；重连后刷新，不重放写操作。

### 9.8 错误码文案（botErrorText）

| code | 文案 |
|---|---|
| bot-unavailable / bot/not-found | 主机上的 DS-Bot 尚未启用，或版本暂不支持 |
| bot-version-unsupported | 请更新主机上的 DS-Bot |
| not-connected | 主机连接已断开，重连后将同步聊天 |
| bot/main-protected | 主 Bot 不能删除。 |
| bot-delete-failed | 暂时无法删除此 Bot，请稍后重试。 |
| bot-delete-unconfirmed | 尚未确认删除结果，请重新同步后核对。 |
| bot-timeout | 同步超时，请稍后重试；发送中的消息请先核对 |
| 其它 | 聊天同步暂时中断，可以重新同步 |

---

## 10. 状态矩阵（加载/空/错误/离线）

| 页面/区块 | 加载 | 空 | 错误 | 离线 |
|---|---|---|---|---|
| 首页助理区 | 「正在同步助理」（chats 空时） | 未连接错误卡「连接主机后查看个人助理」 | 错误卡 + 重新同步 | 保留缓存内容 + 错误卡 |
| 首页聊天列表 | 无独立 loading（依赖助理区） | 「还没有可用的 Bot，请先在主机上配置助理」 | 标题行下红字 | 保留缓存列表 |
| 搜索 | — | 「没有找到相关聊天 / 换个关键词试试」 | — | 本地检索仍可用 |
| 聊天时间线 | 「正在读取聊天」（顶部） | 空时间线（无空态卡） | 输入框上方 caption + 更多菜单刷新 | 已缓存消息仍显示，禁止发送 |
| 定时任务面板 | 「正在同步助理」 | 「还没有定时任务」 | 错误 + 重新同步 | 同错误 |
| 我的 Bot | ProgressView 行 | 「还没有 Bot」 | 不可创建提示 | 列表禁用新建 |
| 角色设置 | saving Spinner | — | roleError 红字 | 整表禁用 |
| 群聊创建 | 主按钮 Spinner | 成员数<2 禁用创建 | 错误区 + 保留草稿 + 核对按钮 | 不可新建 |

---

## 11. 验收清单（映射 iOS UI 测试）

1. 双向模式切换：抽屉项文案「切换到工作模式/切换到 Bot 模式」，切换后主页标题变化，抽屉首项位置不变（testWorkspaceModeSwitchesBothWays / testNightWorkspaceModeSwitchesBothWays）。
2. 抽屉首项为黑色 DS Bot 矢量；点击后立即关抽屉并切换（testDesignHomeDrawerChatsAndSchedules）。
3. 首页结构：Chief、与Chief聊聊、我的 Bot、定时任务、聊天、搜索；**不存在**「正在进行」；不出现输入框（testRealHostBotCreation、testWideHomeSearchAndIndependentChat）。
4. 定时任务面板：标题、空态「还没有定时任务」、关闭按钮；loading/error 大字号下不溢出（testEmptyOfflineHomeAndSchedule、testLoadingAndErrorPanelsKeepBounds）。
5. 私聊：身份、气泡、时间、输入框、键盘安全区、横屏不越界（testRealHostHomeChatAndNativeControls、testDesignHomeDrawerChatsAndSchedules）。
6. 群聊：发言者名、群成员 Sheet、身份、活动行（testBotSecondaryPages、testHiddenBotRemainsInGroupMembers）。
7. 未读角标：出现 → 打开聊天 → 返回后消失；100 显示 99+（testBotUnreadBadgeClearsAfterOpeningChat）。
8. 运行中：首页绿点、「上网搜索…」、计时递增（testBotLiveWorkAtConversationTail）。
9. 交互卡：提问 Sheet 初始提交禁用 → 选择后可提交 → 取消保持卡片；审批仅拒绝/单次允许（testBotSecondaryPages）。
10. 历史分页 + 贴底/跳到底部（testBotComposerJumpsBackToLatest）。
11. 气泡宽度：手机短消息按内容收缩、长消息 ≤292；平板长消息 >400 且 ≤720（testBotTextBubbleWidths 两种字号）。
12. 引用回复：私聊移除引用、群聊发送后出现引用气泡（testQuoteBotRepliesInPrivateAndGroupChats）。
13. 大屏 R2：搜索框在左栏右侧、名称/摘要搜索、无结果、清空恢复、独立聊天、返回保留搜索、竖屏仍双栏（testWideHomeSearchAndIndependentChat）。
14. 大字号 1.5 倍：气泡/面板/角色页/记忆编辑不裁切、单栏回退。
15. 角色管理：复制一份 → 副本出现；主 Bot 无删除；删除二次确认含名字；删除后列表消失（testRealHostDeleteBot）。
16. 新建 Bot：形象编辑、头像库、模型选择、本地 Agent 可用性、名字、创建成功（testRealHostBotCreation）。
17. 我的 Bot 列表；角色名片；角色设置表单可滚动、说明可点收键盘（testBotRosterLayout、testBotRoleProfileLayout、testRealHostRoleSettingsDismissesKeyboardOnOutsideTap）。
18. 新建群聊：菜单可滚动、首位为管理员、移除后递补、成员 2 位才可创建、失败保留草稿、隐藏 Bot 可搜索恢复（testNewConversationMenuAndOrderedGroupSelection、testNewGroupFailurePreservesDraft、testNewConversationSearchRestoresHiddenBot）。
19. 记忆：列表、左滑删除确认、编辑/添加、长文本编辑器 >160 且键盘不遮挡（testRealHostLongMemoryEditor、testBotSecondaryPages）。
20. 图片：结构化图片、Markdown 图片、原图失败重试、横屏预览（testAgentImage*）。
21. 离线空态与断线（testEmptyOfflineHomeAndSchedule）。

---

## 12. SoC「未实现/后续边界」清单

### 12.1 文档原文（Docs/bot-mode-integration.md「后续边界」）

- 尚未实现**后台系统推送**（FCM/APNs；当前沿用 APP 本地通知渠道，APNs 在另一 Worktree 独立验证，不纳入本分支）。
- 尚未实现**完整任务档案**（上游提醒仅保留在主机内存，本地最多缓存近期 30 条，不能作为完整永久任务档案）。
- 尚未实现**定时任务编辑**（首页面板只读；角色页支持新建/删除每日任务，但不是完整编辑）。
- 尚未实现**图片上传界面及通用大文件传输**（文档写作时）。
- 尚未实现**通用 view 卡片的完整交互渲染**。
- 问答与审批操作已接线，但真实主机测试尚未构造需要批准的工具调用，不能视为完整端到端验收。
- Android 系统键盘、字体光栅、返回手势保留平台行为；两端不称逐像素一致。
- 全仓本地化守卫仍有此前其他功能的未翻译项；本次新增 Bot 文案中英已补。
- 本轮改动未提交/合并/发布；现有主机使用该能力需安装此分支网关。
- 模式入口在 iOS 为 DEBUG-only、Android 要求可调试构建（测试宿主只含 Debug APK）。
- 图片能力补充（2026-11-18）：**群聊成员结构化图片与公开发言的来源映射尚未完整支持**，网关不扫描内部输出猜测作者归属；工作目录图片只走对应会话官方权限，读不到就显示加载失败。
- 通知：当前 Bot 事件**未接入通知管理器**，不能把消息同步测试视为 Bot 通知验收。

### 12.2 代码现状对照

| 文档边界 | 当前代码现状 | 鸿蒙建议 |
|---|---|---|
| 图片上传 | 已实现：输入框图片（最多 4 张/12MB）+ 文件（总 20）+ 结构化/正文图片预览 | 按 §4.4 实现 |
| 大文件传输 | 仍无通用大文件；文件按 Bot 附件 receipts 上传 | 不做额外大文件通道 |
| 定时任务编辑 | 首页只读；角色页可新建每日任务/删除；无「编辑已有任务」 | 按此实现，编辑留待后续 |
| 后台推送 | 无；仅前台/连接态事件 | 不声称离线必达 |
| 完整任务档案 | 无；recent 上限 30 | 不做历史完成档案 |
| 通用 view 卡片 | 无 | 不实现 |
| Bot 通知 | 未接入 | 可作后续项，事件驱动 |
| 群成员图片归属 | 群聊仅官方公开行；不猜作者 | 保持一致 |
| 图片缓存 | 网关内存缓存 8 张/32MiB、20 秒有效 | 客户端按统一图片加载器 |

---

## 13. 鸿蒙端实现建议与风险

### 13.1 实现优先级

- P0：入口/模式持久化/抽屉复用；首页（Chief、快捷卡、聊天列表、搜索）；私聊/群聊气泡、输入框、发送状态、历史分页；未读/运行标记；定时任务只读面板；协议与缓存（§9）。
- P1：交互卡（提问/审批）、实时工作行、引用与 @、图片/文件附件、角色名片/设置/记忆/定时任务管理、我的 Bot、新建 Bot、新建群聊。
- P2：R2 宽屏、模式波纹过渡、玻璃细节打磨、无障碍/大字号适配、本地通知接入（新增能力需产品确认）。

### 13.2 最可能缺失的 10 个功能点（鸿蒙端自检）

1. **请求 32s 超时 +「状态待确认」**：发送/写操作超时或断线后不自动重发，气泡显示「发送状态待确认，请同步聊天后核对」，刷新历史后以主机为准。缺这项会造成重复消息。
2. **按主机隔离缓存（12 聊天×100 条 + 7.5MB 淘汰 + 清在线态）**：不是简单持久化聊天列表；必做清洗与淘汰，恢复后不显示「在线/流式/待交互」假状态。
3. **未读语义**：只由 notice（group/message）计数，前台且正在看的聊天不计数；打开聊天/回前台清零（readThrough 游标）；99+；运行中绿点优先。
4. **bot-event stream 增量 + bot-stream-reset 有界恢复**：start/delta/end 三阶段、200k 字符上限、中断后最多 3 次退避刷新；不做忙循环轮询。
5. **requestId 独立请求关联 + endpoint 双校验 + state revision/since 增量合并**：旧回执/串包必须丢弃；unchanged 时只合并 work，避免列表闪烁与脏写。
6. **交互卡协议与状态**：answer-question（多选/补充回答）、approval-answer（只 allow/reject）、approval 仅 answerable 才展示、提交禁用与失败不重试。
7. **群聊身份与色板稳定性**：发言者名显示条件、群成员拼贴头像（4+N）、色板按成员 id 排序分配（跨私聊/群聊一致、名册顺序变化不漂移）。
8. **附件链路**：bot-attachments 能力检测、20 个上限、4 图/12MB、图片预处理、receipts、失败 invalidReceipts、lastAttachmentAck 清草稿，以及图片只走统一加载器（缓存键区分来源/作者/预览）。
9. **引用与 @ 系统**：@ 弹层分组（成员/文件/对话/所有人）、目录 drill、180ms 防抖 reference-candidates、引用消息解析与移除、发送后引用气泡。
10. **模式与布局硬约束**：抽屉首项黑色 DS Bot 矢量 + 反向入口 + 立即关抽屉 + 模式持久化；小屏固定竖屏；R2 断点（760/500/1.5×）与「返回/旋转保留搜索」；面板 660/580 + 拖动条 + 只读。

附加易漏项：错误码文案映射（8 条）、隐藏 Bot 只能搜索/群成员可见且打开前 set-flags 恢复、主 Bot 不可删除/不可私密、群聊创建 uncertain 防重复与「已核对未创建」解除、键盘安全区（横屏）、深色模式全套色板。

---

## 附录 A：核心文案表（zh-Hans）

入口与首页：
- 切换到 Bot 模式 / 切换到工作模式
- 个人助理 / 今天也交给我吧。
- 正在为你推进 N 件事 / 随时可以找我聊聊
- 与 {name} 聊聊 / 与助理聊聊
- 连接主机后查看个人助理 / 请更新主机上的移动网关以使用 Bot 模式 / 重新同步
- 正在同步助理
- 我的 Bot / 查看与创建 / 定时任务 / 查看安排 / 下次 {next}
- 聊天 / N 个结果 / 搜索聊天名称或内容 / 没有找到相关聊天 / 换个关键词试试
- 还没有可用的 Bot，请先在主机上配置助理
- 运行中 / 未读消息：N

聊天：
- 随时为你效劳 / 群聊 / 加载更早消息 / 正在读取聊天
- 发送中 / 已发送 / 发送状态待确认，请同步聊天后核对
- 描述你想要构建的内容 / 发消息到群聊… / 发消息给 {name}…
- 添加附件 / 图片 / 文件 / 移除 / 一次最多添加 20 个附件，请等待已有附件准备完成 / 图片总大小超出限制
- 回到底部 / 重新同步 / 定时任务 / 更多操作
- 已创建 / 已发消息给 / 协作动态
- 需要你批准 / 仅允许这一次 / 拒绝 / 助理在等你回答 / 回答
- 回答助理 / 补充回答 / 取消 / 提交
- 暂时无法读取引用 / 没有匹配的引用 / 成员 / 文件与文件夹 / 对话 / 所有人

定时任务：
- 定时任务 / 让助理按时替你做事。 / 还没有定时任务
- 完成后，{name} 会在聊天里告诉你。

管理与创建：
- 我的 Bot / 团队成员 / N 个 Bot / 新建 Bot / 还没有 Bot
- 连接主机后可以创建 Bot / 当前主机为只读 / 请更新主机上的移动网关和 DS Bot 后再创建 Bot
- 主 Bot / 名字 / 标签 / 形象 / 编辑 / 重试 / 运行方式 / DS Bot 模型 / 本地 Agent / 模型 / 选择模型
- 留空会使用自动生成的名字。 / 已经有一个同名 Bot。 / 名字最多 40 个字符。 / 这个名字在群聊中有保留用途。 / 名字不能包含 @、反引号或控制字符。
- 创建 Bot / 编辑形象 / 形状 / 颜色 / 随机 / 上传照片 / 头像库 / 导入照片 / 完成
- 角色设置 / 资料 / 模型 / 推理强度 / 工作区与权限 / 工作文件夹 / 权限 / 隐私 / 说明 / 操控 / 记忆 / 近 30 天用量
- 复制一份 / 删除 Bot / 更换主 Bot / 保存
- 复制这个角色？ / 删除 Bot？ / 将「{name}」移出团队和所在群聊。 / 确认授予完全权限？
- 记忆 / 添加记忆 / 编辑记忆 / 删除这条记忆？ / 还没有记忆
- 定时任务 / 新建定时任务 / 任务名称 / 任务内容 / 每天运行时间 / 删除这个定时任务？
- 新建群聊 / 查找 Bot / 选择群聊成员 / 第一位选中的成员为管理员。 / 首条消息（选填） / 描述群聊用途 / 创建群聊 · N 位 Bot / 重试发送首条消息 / 进入群聊
- 暂时无法确认提交结果，请返回聊天列表核对，避免重复创建或发送。 / 群聊已创建，首条消息发送失败。 / 已核对列表，确认未创建
- 可选择已从侧边栏隐藏的 Bot。 / 不填写首条消息时，管理员会先询问群聊用途。

---

## 附录 B：资源与依赖清单

- Assets：BotDrawerMark(24)、WorkspaceDrawerMark(24)、BotConversationMark(25.2422×20.1094)、BotGroupAvatar(48)、BotModeSwap(16.0125×19.6064)。
- Assets 颜色：BotBlue/BotCard/BotGlassRim/BotGlassTint/BotGroupedSurface/BotInk/BotLavender/BotLavenderSoft/BotLine/BotPurple/BotSecondary/BotSend/BotUserBubble（§8.1）。
- 组件依赖：Markdown 渲染、Markdown 图片上下文、大图预览、文件引用卡、文件预览、会话视口、Composer 家族、设置字号、玻璃、BotAvatar/BotFace、BotBubblePalette（共享层）。
- 主机依赖：DS-Bot 0.3.6+（state/chat/room-chat/feed）、移动网关（bot-v1 + 能力位）、已配对设备凭据。

---

## 附录 C：源码溯源

| 主题 | 位置 |
|---|---|
| 模式状态与入口 | RootView.swift:87,141-143；WorkspaceView.swift:239-251（BotModeView 装配）、379-400（抽屉首项）、528-538（切换） |
| 首页 | BotModeView.swift:390-508（布局）、510-565（助理区）、567-688（聊天区/快捷卡）、691-714（状态标记）、717-772（搜索） |
| 私聊/时间线 | BotModeView.swift:940-1180（导航/时间线）、1182-1265（行与交互卡）、1463-1605（气泡）、1607-1638（已回答问答）、1640-1713（mention 菜单）、1716-1755（更多菜单） |
| 提问 Sheet | BotModeView.swift:1762-1794 |
| 实时工作行/错误文案 | BotModeView.swift:1867-1917 |
| 角色名片/设置/记忆/定时 | BotModeView.swift:1919-2028、2030-2274、2302-2381、2383-2444 |
| 定时任务面板 | BotModeView.swift:797-864 |
| 我的 Bot/创建/角色管理 | BotManagementView.swift:5-66、118-168（页面骨架）、188-216（行）、223-406（创建）、408-462（模型）、480-577（形象/头像库）、589-638、643-791（群聊） |
| 协议/状态/缓存/未读 | SharedBotStore.kt:28-55（BotChat）、115-132（Indicator/Interaction）、233-330（缓存）、469-524（发送与乐观）、740-830（回答/审批/订阅/刷新）、831-1114（结果分支）、1117-1165（事件）、1177-1224（通知/未读）、1233-1260+（liveWork） |
| 传输分流 | GatewayClient.swift:251-253、964-975、1015-1030 |
| 颜色/玻璃/自适应 | Assets.xcassets/Bot*.colorset、BotBubblePalette.kt、Components/Glass.swift:27-121、Core/Theme.swift:140-157、190-219、BotModeView.swift:414-417、785-795 |
| 验收 | BotModeUITests.swift 全文（21 组用例，§11） |

---

## 附录 D：待产品确认（不要在鸿蒙端擅自决定）

1. 首页「正在处理 / 近期完成」区块是否补回（当前 iOS 无；数据已有 recent/liveWork）。
2. Bot 模式入口正式发布开关（当前 iOS DEBUG-only）。
3. 流式回复是否要独立光标（iOS 无）。
4. 深色模式输入框占位统一为「描述你想要构建的内容」（当前 iOS 行为）是否保留。
5. 宽屏无结果卡高度 138（实现）vs 170（设计稿）。
6. Bot 事件是否接入本地通知（含 done 提醒推送），以及通知点击落地页。
7. 定时任务面板在平板的呈现（580 宽居中 vs 系统 page sheet）。
8. 群聊成员结构化图片与公开发言归属（官方 API 无稳定映射）后续方案。
