# DS-Bot（Bot 模式）实现现状盘点（harmonyos）

> 盘点对象：`harmonyos` 工程中的 DS-Bot（Bot 模式）现状
> 盘点方式：只读源码（未修改任何代码、未构建、未提交 git）
> 盘点时间：2026-11-24
> 阅读范围：
> - `native-core/src/main/ets/state/BotStore.ets`（2274 行）
> - `native-core/src/main/ets/protocol/BotDtos.ets`（319 行）
> - `native-core/src/main/ets/state/BotImageCache.ets`（161 行）
> - `native-app/entry/src/main/ets/pages/BotHomePage.ets`（559 行）、`BotChatPage.ets`（625 行）、`BotNewChatPage.ets`（183 行）、`BotRolePage.ets`（536 行）、`BotCreatePage.ets`（317 行）
> - `native-app/entry/src/main/ets/pages/Index.ets`（393 行，路由注册）
> - `native-app/entry/src/main/ets/pages/HomePage.ets`（仅 bot 模式入口相关段落）
> - `native-app/entry/src/main/ets/entryability/EntryAbility.ets`（仅 bot 初始化/前后台相关段落）

---

## 1. 路由与入口

### 1.1 Bot 页面路由清单

路由统一注册在 `Index.ets` 的 `@Builder PageMap(name: string)`（Index.ets:139-151）：

| 路由名 | 目标页面 | 注册位置 | 传递参数 | 页面是否读取参数 |
| --- | --- | --- | --- | --- |
| `bot-home` | `BotHomePage` | Index.ets:141-142 | `null` | — |
| `bot-chat` | `BotChatPage` | Index.ets:143-144 | `chat.id`（string） | 否（完全依赖 push 前已调用 `BotStore.selectChat`） |
| `bot-role` | `BotRolePage` | Index.ets:145-146 | `botId`（string） | 否（完全依赖 push 前已调用 `BotStore.openRole`） |
| `bot-create` | `BotCreatePage` | Index.ets:147-148 | `null` | — |
| `bot-new-chat` | `BotNewChatPage` | Index.ets:149-150 | `null` | — |

5 个页面组件全为 `NavDestination` + `.hideTitleBar(true)` 自绘顶栏，不使用系统标题栏。

### 1.2 入口位置：首页抽屉首项

Bot 模式入口在首页左侧抽屉里，位置是品牌行下面的**第一个功能项**：

- 抽屉结构（`HomePage.ets:1698-1763`）：品牌行（FluKeCoin + wordmark + HARNESS 徽章）→ **Bot 模式** → 插件 → 自动化任务 → 连接器 → `Blank()` → 设置。
- 入口调用：`this.drawerItem($r('app.media.bot_mode'), $r('app.media.bot_mode'), 'Bot 模式', 'bot-home')`（HomePage.ets:1729-1730）。
- `drawerItem` 实现（HomePage.ets:1766-1791）：点击 → `Haptics.play()` → `this.drawerOpen = false` → `this.pageStack.pushPathByName(route, null)`。**不写 botMode 标记**，模式标记由 BotHomePage 自己负责。
- 抽屉宽度/内边距/底色：`drawerWidth`、左右 36rpx、上 `max(safeTop,38)+20rpx`、下 `max(safeBottom,30)+24rpx`（HomePage.ets:1747-1757），暗色 `#181A1F` / 亮色 `#FFFFFF`。

### 1.3 模式切换与保存逻辑

模式标记为字符串 `botMode`（`'0'` / `'1'`），保存在两处：`AppStorage` 与 `PreferencesStore`（key 同为 `botMode`）。

| 时机 | 逻辑 | 位置 |
| --- | --- | --- |
| 冷启动偏好恢复 | `PreferencesStore` 初始化后 `AppStorage.setOrCreate('botMode', pref.getString('botMode','0'))` | EntryAbility.ets:96-97 |
| 启动自动回 Bot 模式 | 首页 `aboutToAppear` 延迟 900ms：若 `botMode==='1'` 且 `pageStack.getAllPathName().length===0` 则 `pushPathByName('bot-home', null)` | Index.ets:114-121 |
| 进入 Bot 模式 | BotHomePage `aboutToAppear`：`AppStorage.setOrCreate('botMode','1')` + `PreferencesStore.putString('botMode','1')`，同时 `refreshAll()`、`setForeground(true)` | BotHomePage.ets:37-47 |
| 退出 Bot 模式 | `leaveBotMode()`：`AppStorage='0'` + `PreferencesStore.putString('botMode','0')` + `pageStack.pop()` | BotHomePage.ets:59-66 |
| 退出触发点 | ① 品牌顶栏整行 `onClick`（含 HARNESS 徽章区，204-206）；② 左上角 FluKeCoin 点击（169-174） | BotHomePage.ets:166-207 |

注意点：

1. **系统返回/侧滑返回不会写回 `botMode='0'`**：BotHomePage 没有 `onBackPressed` / `onDisAppear`（对 5 个 Bot 页面 grep 均无命中），NavDestination 被系统 pop 后偏好仍是 `'1'`，于是**下一次冷启动又会自动进入 Bot 模式**。只有点品牌栏/硬币退出才会写 0。
2. 品牌栏按钮同时承担「退出 Bot 模式」与「回首页」语义，容易误触。
3. 深链 `pageRoute` 可推任意路由（Index.ets:111-113、124-129），理论上可直达 `bot-chat`/`bot-role`，但因为不带参数、页面也不读参数，直达会落在空白状态（见第 4 节）。

### 1.4 页面间跳转关系

- `bot-home` → `bot-chat`：`openChat(chat)` 先 `selectChat(chat.id)` 再 `pushPathByName('bot-chat', chat.id)`（BotHomePage.ets:116-119）；「与 X 聊聊」按钮复用同一函数（284-286）。
- `bot-home` → `bot-role`：Chief 玻璃卡点击，`openRole(chief.id)` + push `'bot-role'`（BotHomePage.ets:254-259）。
- `bot-home` → `bot-create`：「我的 Bot」快捷卡（457-459）、「+」菜单「新建 Bot」（483）。
- `bot-home` → `bot-new-chat`：「+」菜单「新建群聊」（484）。
- `bot-chat` → `bot-role`：仅私聊，「⋯」菜单「查看角色资料」`openRole+push`（BotChatPage.ets:537-544）。
- `bot-new-chat` → `bot-chat`：创建成功且 `conversation.openedId` 出现时，`selectChat(opened)` + `pop()` + `pushPathByName('bot-chat', opened)`（BotNewChatPage.ets:22-31）。
- `bot-create` 成功：只 `selectChat(created)` + `pop()`（BotCreatePage.ets:33-45），**不打开会话页也不打开角色页**，回到 Bot 首页。

---

## 2. 每个页面的现状

### 2.1 BotHomePage（Bot 模式首页，559 行）

文件头注释：对齐 iOS `BotModeView` 的 `compactHome`，与首页同一套深海鲸鱼背景 + 品牌顶栏。

**结构（build，BotHomePage.ets:419-559；自上而下）**

1. `NavDestination > Stack(alignContent: Bottom)`
2. 底层 `OceanBackground()` 铺满（423-427）
3. `Scroll` 内容（429-533）：
   1. `brandHeader()`：FluKeCoin(36) + `wordmark_white`(52×15) + HARNESS 徽章 + 右侧连接状态点/文案（166-207）
   2. `hero()`：「个人助理」32vp Bold 白 + 「今天也交给我吧。」15vp 白 68%（209-223）
   3. `chiefCard()`：主 Bot 玻璃卡（225-262）
   4. `startChatButton()`：「与 {name} 聊聊」紫色玻璃大按钮（264-288）
   5. 主机未启用 DS-Bot 提示条（440-454，仅 connected 且 !supported）
   6. 两张快捷卡：我的 Bot / 定时任务（456-464）
   7. 「聊天」标题 + 「+」圆形按钮（`bindMenu`：新建 Bot / 新建群聊）（467-488）
   8. 搜索条：🔍 + TextInput「搜索聊天」（490-508）
   9. 聊天列表或空态（510-521）
   10. 连接异常文本 `state.error`（523-528）
4. 底部 `scheduleOpen` 遮罩 + 定时任务 sheet（539-552）

**关键样式**

| 元素 | 样式 |
| --- | --- |
| 页面背景 | `OceanBackground`（与首页同一深海鲸鱼背景），无额外底色 |
| 品牌行 | 白 wordmark、HARNESS 徽章白底 `#10151F` 字 `9.5vp`、圆角 4、高 15 |
| 连接状态 | 点 7vp：`#31B77A`（已连接且支持）/ `#E0A03C`（已连接未启用）/ `rgba(255,255,255,0.4)`（未连接）；文案 `11.5vp` `rgba(255,255,255,0.7)` |
| hero | 32 Bold `#FFFFFF`；副标题 15 `rgba(255,255,255,0.68)` |
| Chief 卡 | 底 `rgba(255,255,255,0.10)`、圆角 22、描边 1 `rgba(255,255,255,0.16)`、padding 16/11、`minHeight 66`；名称 17 Bold 白；状态行 12 `#D9C8FF`，点 5vp（运行 `#31B77A` / 空闲 `#C9A9FF`） |
| 大按钮 | 底 `rgba(167,139,250,0.32)`、圆角 26、描边 1 `rgba(255,255,255,0.18)`、`minHeight 52`；图标 25 + 文字 17 Bold 白 |
| 快捷卡 | 底 `rgba(255,255,255,0.10)`、圆角 18、描边 1 `rgba(255,255,255,0.14)`、padding 14、`minHeight 78`；标题 13.5 Medium 白、副标题 11.5 `rgba(255,255,255,0.6)` |
| 聊天行 | 底 `rgba(255,255,255,0.06)`、圆角 16、padding 14/10；名称 15.5 Medium 白；预览 12.5 `rgba(255,255,255,0.55)`；运行中标签 `#9BD9B8` 底 `rgba(49,183,122,0.18)` 圆角 8 `10.5vp`；未读 `#FF4D4F` 白字 `10.5vp` 圆角 8；时间 `11vp` `rgba(255,255,255,0.42)` |
| 「+」按钮 | 30×30 圆形，底 `rgba(255,255,255,0.14)`，白 19vp |
| 搜索条 | 底 `rgba(255,255,255,0.08)`、圆角 12、高 38；输入 14 白，placeholder `rgba(255,255,255,0.42)` |
| 定时任务 sheet | 底 暗 `#1C1E24` / 亮 `#FFFFFF`，上圆角 20；遮罩 `rgba(0,0,0,0.4)` |
| 内容排版 | 左右 padding 22、顶部 `safeTop+18`、底部 `24+safeBottom`；区块间距 16 |

**数据来源（均为 `@StorageLink('botState')`，@Watch 无）**

- 生命周期：`BotStore.refreshAll()`、`setForeground(true)`（37-47）；`onConnection`：连接变成 connected 时再 `refreshAll()`（49-53）。
- 派生数据：`chief()` 用 `state.mainBotId` 在非 room 列表里找主 Bot（70-78）；`visibleChats()` 过滤 hidden 并按 name/preview 本地搜索（80-94）；`runningCount()` 数 `state.liveWork` 命中数（96-104）；`rosterCount()` 数非 room 数（106-114）；`timeLabel()` 用 `lastAt`（秒/毫秒兼容）算「刚刚/N 分钟前…」（130-140）。
- 直接读取的字段：`state.chats / mainBotId / liveWork / unreadCounts / schedules / schedulesAvailable / supported / error`。
- `state.recent`（最近活动）、`state.loading`、`state.feedActive`、`state.capabilities`、`state.computerEnabled`、`state.rosterIds`、`state.mainBotIds` **未被本页使用**。

**已实现交互**

- 点品牌栏/硬币退出 Bot 模式（见 1.3）。
- Chief 卡 → 角色页；「与 X 聊聊」→ 聊天页；聊天行 → 聊天页（均含 selectChat/openRole 前置）。
- 「+」→ 系统 Menu（新建 Bot / 新建群聊）。
- 搜索框本地过滤。
- 定时任务快捷卡 → 底部 sheet，展示 title + `status · next`，空态两文案（「暂无定时任务」/「主机未启用定时任务」），「关闭」按钮收起。

**空态/加载/错误态**

- 空态：`visibleChats().length===0` → 居中「还没有聊天」13vp 白 50%（510-516）——**搜索无结果也显示同一句**。
- 未启用：connected 且 !supported → 「主机未启用 DS-Bot」说明条（440-454）。
- 错误：`state.error` 有值 → 「连接异常：{code}」11.5vp `#E0A03C`（523-528）。
- 加载态：**没有**（`state.loading` 未渲染、无骨架屏）。

**明显 TODO/占位**

- 源码无 TODO/FIXME 注释。
- 「我的 Bot」副标题写「N 个 · 查看与创建」，但点击只跳 `bot-create`（新建只有创建，没有 Bot 列表/管理）。
- `state.recent` 没有任何展示区（DTO 注释里的「最近活动」未落地）。
- 定时任务只读，不能从首页进入详情/编辑。
- 品牌栏整行可点退出模式，是隐藏行为，无视觉提示。

---

### 2.2 BotChatPage（Bot 独立聊天页，625 行）

文件头注释：对齐 dsh-mobile `BotPrivateChatView`。

**结构（build，BotChatPage.ets:552-624）**

1. `NavDestination > Column`
2. `header()`：返回圆钮(36) + 头像(30) + 名称/运行中标 + 「⋯」圆钮(34)（169-228）
3. 主区：
   - 未启用：居中「主机未启用 DS-Bot」说明（557-570）
   - 正常：`List({scroller})` 消息时间线（572-601）+ `historyLoading` 且消息空时「加载中…」ListItem（582-591）
   - 待处理：`approvalCard`（603-605）→ `questionCard`（606-608）
   - `composer()` 输入条（610）
4. `if (this.moreOpen) this.moreMenu()`（613-615）
5. 整页 `.opacity/.translate` 进入动画（619-620），底色暗 `#141220` / 亮 `#F4F2FB`（621）

**关键样式**

| 元素 | 样式 |
| --- | --- |
| header | 返回/更多按钮圆形底 暗 `rgba(255,255,255,0.08)` / 亮 `rgba(0,0,0,0.05)`；标题 16.5 Medium；「运行中」10.5 `#2F7DF6` |
| 消息行 | 左右 padding 14/4；群聊发言者名 11vp 55% 灰，左缩进 44 |
| 用户气泡 | 底 `#2F7DF6`、白 15vp、圆角 16、padding 12/9、`maxWidth 78%` |
| Bot 气泡 | 底 暗 `rgba(255,255,255,0.07)` / 亮 `#FFFFFF`、圆角 16、`maxWidth 86%`，内容用 `MarkdownBodyView(fontSize 15.5)` |
| 流式行 | 头像 30 + Markdown 气泡 + 蓝点「●」8vp `#2F7DF6` |
| event 行（bot-created / bot-messaged） | 12vp 45% 灰文案「创建了 X / 向 X 发了消息」 |
| answer 行 | 问题 12.5；选项胶囊底 暗 `rgba(255,255,255,0.08)` / 亮 `rgba(46,107,230,0.08)`、圆角 8 |
| 图片 | `BotMessageImage`（按 sessionId+attachmentId）流式排列 |
| 文件 | 文件区底 暗 `rgba(255,255,255,0.05)` / 亮 `rgba(46,107,230,0.05)`、圆角 10、padding 8 |
| 问题卡 | 底 暗 `rgba(38,40,48,0.9)` / 亮 `rgba(255,255,255,0.95)`、圆角 16、padding 14、margin 12；选项胶囊圆角 14，选中 `#2F7DF6` 白字；「提交回答」36 高圆角 16 |
| 审批卡 | 同上底色；「需要批准」13 `#E0A03C`；拒绝/允许一次两按钮 36 高圆角 16 |
| composer | 输入框圆角 20、高 40、底 暗 `rgba(255,255,255,0.06)` / 亮 `rgba(0,0,0,0.04)`；发送 40×40 圆钮 `#2F7DF6`/40%；整条底 暗 `rgba(20,22,27,0.96)` / 亮 `rgba(244,246,250,0.96)`，padding 12,8+`safeBottom` |
| 头像调色板 | `#5B7CFA #7A5BFA #2FA98C #D97706 #DB2777 #0EA5E9`，按 id 哈希取首字 |

**数据来源**

- `@StorageLink('botState') @Watch('onStateChanged')`：`selectedChatId / chats / messages / historyLoading / hasEarlier / interactions / liveWork`。
- 方法调用：`setForeground(true)`（aboutToAppear，36）；`sendMessage(text, [], [])`（139-150）；`answerQuestion(id, picked, customAnswer)`（433-439）；`answerApproval(id, allow)`（476-488）；`openRole + push bot-role`（537-544）；`loadEarlier()`（545-548、597-601）；返回时 `closeChat()`（181-184）。

**已实现交互**

- 返回：`closeChat()` + pop。
- 发送：`onSend` 空文本/发送中拦截；成功后清空 draft（不依赖 state）。
- 自动滚底：`scheduleScroll()` 以「末条消息 id+text 长度」为 key，30ms 后 `scrollEdge(Edge.Bottom)`（71-85）。
- 上拉加载更早：`onReachStart` 且 `hasEarlier && !historyLoading`。
- 提问卡：单选/多选胶囊（`togglePick`）+ 「补充回答」输入 + 提交；新问题到达时清空已选（59-69）。
- 审批卡：拒绝 / 允许一次。
- 「⋯」菜单：查看角色资料（仅私聊）、加载更早消息。
- 进入动画：40ms 后 280ms `FastOutSlowIn`，`enterOpacity 0→1`、`enterShift 22→0`（35-57）。

**空态/加载/错误态**

- unsupported 居中说明（557-570）。
- 空消息且 historyLoading → 「加载中…」（582-591）；**正常空会话无空态**。
- 发送失败（`sendMessage` 返回 false）**无任何错误提示**，草稿保留。
- `state.error` 在本页不渲染。

**明显问题 / 占位**

- `keyboardHeightVp` 已声明（19）但 composer 未避让键盘，只加 `safeBottom`。
- `moreOpen` 置 true 后没有复位点（Menu 是内联组件而非 `bindMenu`），点菜单项后状态仍为 true。
- 图片/文件只能展示，**不能发送**（sendMessage 传空数组）。
- 消息列表 `ForEach` key = `id + ':' + text.length`，流式变化会重建列表项（可接受但成本高）。
- `message.kind === 'stream'` 与 `streaming === true` 都走 streamingRow，但 store 生成的流式消息 kind 固定为 `'bot'`。

---

### 2.3 BotNewChatPage（新建会话/群聊，183 行）

文件头注释：选择成员（第一位为管理员）→ 首条消息（选填）→ 创建；结果不确定时不自动重试。

**结构（build，BotNewChatPage.ets:89-182）**

1. `header()`：返回圆钮(36) + 「新建群聊」+ 右侧「创建中…」或「创建」按钮(30 高圆角 14)（53-87）
2. `Scroll > Column`：
   1. 「选择成员（第一位为管理员）」标签 12.5（95-98）
   2. 非 room 的 Bot 列表：圆点选中标记（`#2F7DF6`）+ 名称 + 管理员小字 + 序号圆标 + 「已隐藏」标记（99-129）
   3. 「首条消息（选填）」标签 + TextArea（90 高、圆角 12、placeholder「不填则管理员先询问群聊用途」）（131-141）
   4. 「管理员先发言」Toggle 行（142-150）
   5. `uncertain` 提示 + 「已核对列表，确认未创建」按钮（152-161）
   6. `error` 文案（162-166）
   7. 底部留白 `24 + safeBottom`（167）
3. 底色暗 `#0E1014` / 亮 `#F4F6FA`（179）

**样式要点**：标题 18 Medium；「创建」按钮 13 白、`#2F7DF6`（不可用时 40% 透明）、圆角 14、高 30；标签 12.5 灰 50-55%；成员名 14；管理员 10.5 `#2F7DF6`；序号圆标 18×18 圆角 9 白字蓝底；TextArea 13.5、高 90、圆角 12、底 暗 6% 白 / 亮 4% 黑；错误红 `#D9534F`；uncertain 橙 `#E0A03C`。

**数据来源与校验**

- `beginConversation()`（18-20）重置草稿；`conversation` 全部来自 `BotSnapshot.conversation`。
- `candidates()`：`state.chats` 中过滤 `!chat.room`（33-41）。
- `canCreate()`：`conversation.supported && !saving && !uncertain && memberIds.length>=2 && writable`（47-51）。
- 交互调用：`toggleConversationMember`、`updateConversationMessage`、`createConversationRoom(greet)`、`confirmConversationNotCreated`。
- 创建成功跳转：`onState` 监听 `conversation.openedId` → `selectChat(opened)` → `pop()` → `push bot-chat`（22-31）。

**空态/加载/错误**

- 成员列表**无空文案**（若没有任何私聊 Bot，列表全空但无提示）。
- 创建中：「创建中…」文字替代按钮；`saving` 期间不可再点。
- 错误：`need-members` → 「至少选择两位成员」；其余 → 「创建失败：{code}」；`uncertain` 有专用提示与确认按钮。

**缺口**

- **填了首条消息时创建成功不会跳转**：`BotStore.applyCreateRoom` 只在 `message.length===0` 时设置 `openedId`；非空时发送消息且不设 `openedId`（BotStore.ets:1925-1954）；页面只监听 `openedId`，于是停留在本页无反馈。
- 群聊不能命名（无标题输入）；只能建群，不能建 1:1 新会话（`memberIds>=2`）。

---

### 2.4 BotRolePage（Bot 角色管理，536 行）

文件头注释：对齐 dsh-mobile `BotManagementView` 的 Bot 编辑面板。

**结构（build，BotRolePage.ets:507-536）**

1. `header()`：返回圆钮 + 名称（或「角色资料」）+ 右侧「保存中…」/「保存」（124-154）
2. `Scroll > Column(space 2)`：
   1. `section('资料')` → `card()`（170-297）：名称、标签、指令（TextArea 110 高）、工作目录、模型（「切换」展开 chips）、思考强度（有 `state.efforts` 才显示）、权限（有 `state.permissions` 才显示）、私有 Bot 开关
   2. `section('记忆')` → `memories()`（299-383）：记忆列表（编辑/忘记）+ 新增输入
   3. `section('定时任务')` → `schedules()`（385-467）：任务列表（自己的 bot 才有「删除」）+ 「+ 新建每日任务」表单（标题/指令/HH:mm）
   4. `section('操作')` → `actions()`（469-505）：复制 Bot、设为主 Bot、删除 Bot、roleError 文案
   5. 底部留白 30+safeBottom
3. 底色暗 `#0E1014` / 亮 `#F4F6FA`（532）

**关键样式**：卡片底 暗 `rgba(38,40,48,0.78)` / 亮 `rgba(255,255,255,0.9)`、圆角 16、padding 14、左右 margin 14；section 标题 12.5 灰；字段标签 13；输入底 暗 6% 白 / 亮 4% 黑、圆角 10-12；主按钮 `#2F7DF6` 圆角 14-16 高 28-36；危险 `#D9534F`；chip 选中 `#2F7DF6` 白字、未选底 暗 8% 白 / 亮 `rgba(46,107,230,0.08)`、圆角 12。

**数据来源**

- `openRole(chat.id)`（aboutToAppear，38-44）；`syncFrom(chat)` 一次把 `chat.name/role/profile.*` 灌入本地 `@State`（55-69）。
- 页面依赖 `state.roleDetails.botId` 反查 `state.chats`（71-86）；**若 `roleDetails` 为空则整页读不到 Bot（见缺口）**。
- 下拉数据：`state.models / permissions / efforts`（模型点击后 `loadEfforts(model)`，233-237）。
- 记忆：`state.roleDetails.memories`；`saveMemory / forgetMemory`。
- 定时任务：`state.schedules / schedulesAvailable`；`scheduleDaily(...,'Asia/Shanghai')`、`deleteSchedule`。
- 操作：`duplicateRole / replacePrimary(snapshot().mainBotId, botId) / deleteRole`；`isMainBot`、`botDeletionSupported` 控制可用性；`roleSaving / roleError`。

**已实现交互**：保存（仅提交有变化的 name/role/instructions，其余非空字段无条件重发，88-122）；模型/强度/权限 chips 选择；私有开关；记忆新增/编辑/忘记；每日定时任务创建/删除；复制/设为主/删除。

**空态/加载/错误**

- 记忆空态：「暂无记忆」/「主机未启用记忆」（302-305）。
- 定时任务空态：「暂无定时任务」/「主机未启用定时任务」（388-391）。
- 保存中：「保存中…」；roleError 只在操作区展示（498-501）。
- **无页面级 loading / 加载失败态**；roleDetails 未到达时页面是空的。

**缺口**

1. **直接进入本页（未先 openRole）会永远空白**：`aboutToAppear` 里的 `bot()` 依赖 `state.roleDetails.botId`，而 `roleDetails` 只有 `openRole` 才会创建；当前仅靠两个调用方（BotHomePage Chief 卡、BotChatPage 菜单）先 openRole 兜住。
2. **月度用量未展示**：`BotRoleDetails.inputTokens/outputTokens`（DTO 35-41）从未渲染，`usage-summary` 请求有发但结果不用。
3. **appliedModel / appliedEffort 未展示**：profile 里有「已应用模型/档位」，页面只展示「期望」值。
4. **私有开关只能开不能关**：`save()` 只有 `if (this.privateRole) changes.private = true`（116-118），关掉开关不会提交 `private:false`。
5. `workDir/model/effort/permission` 只要非空每次都提交（104-115），未做脏检查。
6. 时区写死 `'Asia/Shanghai'`（439-440）。
7. 保存成功无 toast/回显；`loaded` 只同步一次，之后 store 刷新不会回灌表单。
8. 无 API 可删记忆以外的「忘记全部」；无记忆分页；定时任务只支持 daily 一种。

---

### 2.5 BotCreatePage（新建 Bot，317 行）

文件头注释：对齐 dsh-mobile `BotCreateView`：名称 / 外形+配色 / 头像（素材库或上传图）/ 运行方式（团队模型或本地 Agent）/ 提交。

**结构（build，BotCreatePage.ets:145-317）**

1. `header()`：返回 + 「新建 Bot」+ 右侧「创建中…」/「创建」（93-126）
2. `Scroll > Column(space 12)`：
   1. `preview()`：96 头像（选中素材 → 圆形；外形图 → 圆角 30；否则灰圆）+ 名称/「未命名 Bot」（128-143）
   2. 名称 TextInput（153-159）
   3. 形象目录区：loading「正在加载形象目录…」/ failed「主机未提供形象目录，稍后重试」/ 正常显示「配色」chips（30 渐变圆）+「外形」网格（64×64 圆角 16，选中蓝边）（161-206）
   4. 「头像素材库」：loading「加载中…」/ 空「暂无素材（可直接用上方外形与配色）」/ 横向滚动 48 圆头像（208-232）
   5. 「运行方式」：「DS Bot 模型」chip + 本地 Agent chips（不可用 op 0.45）（234-264）
   6. 模型 chips：团队模型（`state.models`）或本地 Agent 模型（`creation.agentModels`）（266-296）
   7. error 文案（298-300）+ 底部留白 24+safeBottom
3. 底色暗 `#0E1014` / 亮 `#F4F6FA`（313）

**数据来源**：`creation` 全部字段（`appearance / loadingAppearance / appearanceFailed / agents / loadingAgents / agentsFailed / agentModels / loadingAgentModels / photos / photoOffset / hasMorePhotos / loadingPhotos / photosFailed / saving / createdId / error`）+ `state.models`；方法 `openCreation / loadCreationPhotos(true) / loadCreationAgents / loadCreationAgentModels(route) / createBot(...)`。

**已实现交互**：选配色/外形（并清空已选素材）；选素材头像；选择运行方式（团队模型 ↔ 本地 Agent）；选模型；创建（校验 name 非空且 shape 非空才可点，114）；创建成功 `createdId` → `selectChat(created)` + `pop()`（39-44）。

**空态/加载/错误**

- 形象目录：loading / failed / 正常三态齐。
- 素材库：loading / 空 / 正常三态；`photosFailed` **未渲染**。
- 本地 Agent：`loadingAgents`、`agentsFailed`、`signedIn` **均未渲染**，加载中无提示。
- error 文案映射：invalid-name/duplicate-name、invalid-appearance、uncertain、bd-request-failed/bot-request-failed、其他（47-65）；其中 `duplicate-name` 分支重复出现一次（50 与 58-60，后者是死分支）。

**缺口**

1. **本地 Agent 的产物没有真正提交**：`createBot` 签名含 `effort`、`agentAppearance`，页面调用固定传 `this.agentRoute` 作为 `model`、`undefined, false`（BotCreatePage.ets:116-120）→ 本地 Agent 路由被塞进 `model` 字段，`agentAppearance` 永远 false。
2. **「上传头像」无入口**：`BotStore.importCreationPhoto`（2046-2062）与 `avatar-import` 端点已实现但页面没有上传按钮/选图器。
3. **素材库分页未接线**：只加载第 0 页；`hasMorePhotos`/`photoOffset` 无滚动加载。
4. 创建成功后不打开新 Bot 的会话/角色页（只 selectChat + pop），用户需回首页自己点。
5. 创建按钮可用性只看 name+shape，未校验 color/模型。
6. `creationImage`（store 提供的一张预览图）页面自己实现 `shapeImage()`，store 方法无调用方。

---

### 2.6 配套：BotImageCache（161 行，非页面）

- 职责：经 `BotStore.requestValue('image', {sessionId, preview:false, offset, attachmentId}, chatId)` 分块拉取图片，写应用缓存目录，UI 用 `file://` 渲染。
- 约束：单块 384 KiB（注释）、单图 `≤16 MiB`、最多 64 块；mime 白名单 png/jpeg/webp/gif/bmp；用网关 `rev`（内容 SHA-256）做缓存键与分块一致性校验（offset/nextOffset/size/done/rev 全校验）。
- 落盘：`cacheDir/bot-images/{sanitized attachmentId}.{ext}`，返回 `file://` 路径。
- 状态：`paths`（内存路径表）与 `inflight`（去重）都只在内存；失败静默（仅 `Logger.warn`），UI 保持占位；无磁盘清理/淘汰。
- 调用方：`BotMessageImage` 组件（本次未读，仅确认引用：BotChatPage.ets:306-313）。

---

## 3. BotStore 能力清单

### 3.1 定位与架构

- 单例 `BotStore`（BotStore.ets:48-79），由 `EntryAbility.onCreate` 里 `BotStore.get().attach(GatewayClient.get())` 挂到网关连接（EntryAbility.ets:58-59）。
- 只走网关 Bot 桥：`bot-subscribe`（每条连接一个订阅）+ `bot-call`（requestId 关联），**不写 SessionStore 的会话投影**（文件头注释 1-6）。
- 全量快照发布：每次变更 `AppStorage.setOrCreate<BotSnapshot>('botState', this.cloneSnapshot())`（2249、2253-2273），页面用 `@StorageLink('botState')` 订阅；浅拷贝保证 ArkUI 引用变化。
- 快照 DTO：`BotDtos.ets:250-292`（40 个字段），空快照工厂 `emptyBotSnapshot()`（307-319）。

### 3.2 公开方法（43 个 = 42 个实例方法 + `static get()`）

> 全部逐项列出；「调用方」为本次盘点范围内可见接线情况。

| # | 方法 | 作用 | 参数 → 返回 | 调用方/备注 |
| --- | --- | --- | --- | --- |
| 1 | `static get()` | 取单例 | — → `BotStore` | 全部页面/EntryAbility |
| 2 | `attach(client)` | 绑定 GatewayClient 并注册 frame 监听；幂等（attached 后忽略） | `GatewayClient` → void | EntryAbility.ets:58-59 |
| 3 | `snapshot()` | 取当前快照引用（非拷贝） | — → `BotSnapshot` | BotRolePage（486/494） |
| 4 | `isSupported()` | 主机是否支持 DS-Bot | — → boolean | 无调用方 |
| 5 | `refreshAll()` | 连接/前台时重建订阅并拉全量（state/notices/schedules/当前 chat） | — → void | BotHomePage（38/51） |
| 6 | `setForeground(active)` | 前台标记；active=true 时 refreshAll + 当前会话标记已读 | boolean → void | EntryAbility（311/332）、BotHomePage/BotChatPage |
| 7 | `requestValue(endpoint,payload,chatId)` | 发一次性 bot-call 并等 value；30s 超时/失败返回 undefined | string, Record, string → Promise | BotImageCache |
| 8 | `consume(frame)` | 帧分发入口（attach 回调） | `GatewayFrame` → void | attach 内部 |
| 9 | `sendMessage(text, images, receipts)` | 发送文本/附件；非空即进 optimistic + `send`/`send-attachments` | string, Object[], string[] → boolean | BotChatPage（传空数组） |
| 10 | `answerQuestion(id, selected, custom)` | 回答提问（answer-question） | string, string[], string → boolean | BotChatPage |
| 11 | `answerApproval(id, allow)` | 审批 allow/reject（approval-answer） | string, boolean → boolean | BotChatPage |
| 12 | `selectChat(id)` | 选会话：清空消息、置 historyLoading、标记已读、拉首页历史 | string → void | BotHomePage/BotNewChatPage/BotCreatePage |
| 13 | `closeChat()` | 取消选中并清空消息 | — → void | BotChatPage 返回 |
| 14 | `loadEarlier()` | 用 cursor 拉更早历史（older=true） | — → void | BotChatPage |
| 15 | `hasEarlier()` | 当前会话是否还有更早（看 cursors） | — → boolean | 无调用方（页面用 snapshot.hasEarlier） |
| 16 | `openRole(id)` | 打开角色：初始化 roleDetails 并拉 memory-view/usage-summary/schedules | string → void | BotHomePage/BotChatPage |
| 17 | `loadEfforts(ref)` | 拉某模型的推理档位 | string → void | BotRolePage |
| 18 | `updateRole(id, changes)` | 更新 Bot 资料（update-bot） | string, Record → boolean | BotRolePage |
| 19 | `saveMemory(id, entryId?, value)` | 新增（memory-add）或编辑（memory-edit）记忆 | string, string/undefined, string → boolean | BotRolePage |
| 20 | `forgetMemory(id, entryId)` | 删除记忆（memory-forget） | string, string → boolean | BotRolePage |
| 21 | `scheduleDaily(id,title,prompt,time,zone)` | 建每日定时任务（schedule-create） | 5×string → boolean | BotRolePage（zone 写死） |
| 22 | `deleteSchedule(id, taskId)` | 删定时任务（schedule-delete，需带 sessionId） | string, string → boolean | BotRolePage |
| 23 | `duplicateRole(id)` | 复制 Bot（duplicate-bot） | string → boolean | BotRolePage |
| 24 | `deleteRole(id)` | 删除 Bot（delete-bot；需 bot-deletion 能力且非主 Bot） | string → boolean | BotRolePage |
| 25 | `replacePrimary(current, replacement)` | 设为主 Bot（set-main；非私有 Bot） | string, string → boolean | BotRolePage |
| 26 | `isMainBot(id)` | 是否主 Bot（mainBotId/mainBotIds） | string → boolean | BotRolePage |
| 27 | `chatOf(id)` | 按 id 查 BotChat | string → BotChat/null | store 内部（sendPayload） |
| 28 | `indicatorOf(chatId)` | 行右侧「运行中/未读」标记 | string → BotChatIndicator/null | 无调用方 |
| 29 | `canCreate()` | 能否新建 Bot（connected+supported+writable+bot-creation+非 saving+非 uncertain） | — → boolean | BotCreatePage 间接 |
| 30 | `openCreation()` | 初始化创建态并拉 creation-appearance | — → void | BotCreatePage |
| 31 | `loadCreationAgents()` | 拉本地 Agent 列表（local-agents） | — → void | BotCreatePage |
| 32 | `loadCreationAgentModels(route)` | 拉本地 Agent 模型（local-agent-models） | string → void | BotCreatePage |
| 33 | `loadCreationPhotos(reset)` | 拉头像素材库（avatar-library，offset 分页） | boolean → void | BotCreatePage（只 reset=true） |
| 34 | `importCreationPhoto(image,name)` | 上传头像素材（avatar-import） | string, string → void | 无调用方 |
| 35 | `createBot(name,shape,color,image,model,effort,agentAppearance)` | 创建 Bot（本地校验名称/外形/图片后 create-bot） | 7 参 → void（异步回执） | BotCreatePage |
| 36 | `creationImage(shape,color)` | 外形+配色预览 data URI | string,string → Object/undefined | 无调用方 |
| 37 | `beginConversation()` | 重置新建会话草稿 | — → void | BotNewChatPage |
| 38 | `toggleConversationMember(id)` | 选/取消群成员（顺序即管理员顺序） | string → void | BotNewChatPage |
| 39 | `updateConversationMessage(text)` | 更新首条消息草稿 | string → void | BotNewChatPage |
| 40 | `createConversationRoom(greet)` | 创建群聊（create-room；成员<2 报 need-members） | boolean → void | BotNewChatPage |
| 41 | `confirmConversationNotCreated()` | 清 uncertain（用户确认未创建） | — → void | BotNewChatPage |
| 42 | `enterCreatedConversation()` | 把 createdId 置为 openedId | — → void | 无调用方（页面自己监听 openedId） |
| 43 | `restoreHiddenBot(id)` | 恢复隐藏 Bot（set-flags hidden=false） | string → void | 无调用方（无隐藏管理 UI） |

### 3.3 公开数据面（BotSnapshot，40 字段）

> 全部字段均为只读快照，页面通过 `@StorageLink('botState')` 读取；「维护处」指 store 内赋值的主要位置。

| 字段 | 含义 | 维护处 / 说明 |
| --- | --- | --- |
| `connected` | 网关是否已连接 | refreshAll（108-114） |
| `supported` | 主机是否启用 DS-Bot | bot-subscribed 置 true（262）；初始 false |
| `loading` | state 请求在途 | readState（360）、applyState 置 false（513） |
| `error` | 最近错误码 | fail（223-227）、订阅被重置（284） |
| `feedActive` | Bot 事件流是否活跃 | bot-subscribed（261）/bot-stream-reset（283）；无 UI 消费 |
| `boot` | 通知流 boot id | **从未赋值**（只在 cloneSnapshot 转发，2257） |
| `capabilities` | 主机能力列表 | bot-subscribed hello（255-260）；无 UI 消费 |
| `mainBotId` | 主 Bot id | applyState（572） |
| `mainBotIds` | 全部主 Bot id | applyState（573-578） |
| `rosterIds` | 非 room 的 Bot id 列表 | applyState（579-584） |
| `chats` | Bot + 群聊列表（按 lastAt 倒序） | applyState（536-569） |
| `selectedChatId` | 当前选中会话 | selectChat/applyState 兜底（607-620） |
| `messages` | 当前会话消息（history+optimistic+stream） | publish（2224-2240） |
| `historyLoading` | 历史加载中 | readChat（413）、applyChatPage（896-898） |
| `hasEarlier` | 是否还有更早 | publish（2241，看 cursors） |
| `schedules` | 定时任务 | applySchedules（1224-1248） |
| `schedulesAvailable` | 主机是否启用定时任务 | applySchedules（1228） |
| `recent` | 最近活动（最多 30） | recordNotice（1198-1205）；无 UI 消费 |
| `interactions` | 提问 + 可回答审批 | applyState（621-676） |
| `models` | 团队模型选项 | applyState（550-558） |
| `permissions` | 权限选项 | applyState（559-568） |
| `defaultModel` | 团队默认模型 | applyState（585-586）；无 UI 消费 |
| `effortModel` | 当前加载 efforts 的模型 | loadEfforts（1592） |
| `efforts` | 推理档位 | applyEfforts（1269-1287） |
| `memoryAvailable` | 主机是否启用记忆 | applyState（587） |
| `computerEnabled` | 电脑控制是否开启 | applyState（588-589）；无 UI 消费 |
| `writable` | 是否只读 | applyState（590） |
| `roleDetails` | 角色详情（记忆 + 用量） | openRole 初始化（1575-1578）、applyRoleDetails（1289-1323） |
| `roleSaving` | 角色写操作在途 | roleWrite（1725）、相关回执置 false |
| `roleError` | 角色写失败 | fail / 置 undefined |
| `roleSettingsSupported` | role-settings 能力 | applyCapabilities（336） |
| `attachmentsSupported` | bot-attachments 能力 | applyCapabilities（337）；无 UI 消费 |
| `referencesSupported` | reference-candidates 能力 | applyCapabilities（338）；无 UI 消费 |
| `botDeletionSupported` | bot-deletion 能力 | applyCapabilities（339） |
| `attachmentSending` | 当前会话附件发送中 | publish（2242-2248）；无 UI 消费 |
| `creation` | 新建 Bot 草稿/目录/提交态 | 见下方子结构 |
| `conversation` | 新建会话草稿/提交态 | 见下方子结构 |
| `referenceSearch` | @ 引用搜索态 | **从未赋值**（唯一引用点 2270 clone） |
| `liveWork` | 每会话实时状态 | computeLiveWork（685/699-754） |
| `unreadCounts` | 每会话未读数 | recordNotice（1206-1211）、markChatRead（1214-1222） |

子结构：`BotCreationState`（BotDtos.ets:191-216，19 字段）、`BotConversationState`（218-227，9 字段）。

### 3.4 协议帧处理

**发送的帧**

| 帧类型 | 结构 | 位置 | 现状 |
| --- | --- | --- | --- |
| `bot-subscribe` | {type, requestId} | BotStore.ets:137-143 | 已实现；连接/hello/refreshAll 时按需发 |
| `bot-unsubscribe` | {type, requestId} | 145-153 | **已定义但从未调用**（没有停止/登出路径） |
| `bot-call` | {type, requestId, endpoint, payload} | 167-188、194-221 | 已实现；`pending.size>=32` 或同 endpoint+chatId 重复时直接返回 null（静默丢弃）；send/send-attachments 不做重复拦截 |

**接收的帧（consume，BotStore.ets:231-332）**

| 帧类型 | 处理 | 现状 |
| --- | --- | --- |
| `hello`（网关级） | 清空订阅与 feedBoot → `refreshAll()` 重新订阅 | 已实现（233-239） |
| `bot-subscribed` | 校验 requestId==subscription；无 subscriptionId 视为不支持（feedActive=false）；有则读 hello.capabilities → supported/feedActive=true → applyCapabilities → 立即 readState/readNotices/readSchedules/readChat | 已实现（240-275） |
| `bot-stream-reset` | subscriptionId 匹配 → 清订阅、feedActive=false、error='bot-feed-interrupted' | 已实现（276-287）；**无自动重订阅**，只能等 hello/前台 refreshAll |
| `bot-event` | 校验 subscriptionId → `onBotEvent(botEvent, botData)` | 已实现（288-297） |
| `bot-result` | 先查 waiters（一次性 requestValue，回 value）；否则校验 pending.endpoint 后 `onReply` | 已实现（298-318） |
| `error` | 有 waiter → resolve undefined；否则按 requestId 调 `fail(code)` 写入 state.error | 已实现（319-331） |

**bot-event 子事件（onBotEvent，1358-1450）**

| 事件 | 处理 |
| --- | --- |
| `hello` | 记录 feedBoot；boot 变化时 revision=-1、清 histories/cursors/streams；updateNoticeBoot；补 readNotices/readState/readChat |
| `revision` / `live` | readState |
| `message` / `room` | readState；若是当前选中会话再 readChat |
| `notice` | seq 连续段立即 recordNotice（含未读计数），断档进 queuedNotices（上限 200）并 readNotices；然后 readState |
| `stream` | 仅当前选中会话：start 建流式消息（id=stream:{attemptId}），end 置 streaming=false + readChat，其它 phase 追加 text（上限 200000） |

**用到的 endpoint 清单**

- 读：`state`、`notices`、`schedules`、`chat`、`room-chat`、`avatar`、`efforts`、`memory-view`、`usage-summary`、`creation-appearance`、`local-agents`、`local-agent-models`、`avatar-library`、`avatar-import`、`image`（BotImageCache）。
- 写：`send`、`send-attachments`、`answer-question`、`approval-answer`、`update-bot`、`memory-add`、`memory-edit`、`memory-forget`、`schedule-create`、`schedule-delete`、`duplicate-bot`、`delete-bot`、`set-main`、`create-bot`、`create-room`、`set-flags`。

### 3.5 缓存 / 持久化现状

| 数据 | 存放 | 生命周期 | 说明 |
| --- | --- | --- | --- |
| BotSnapshot | 内存 `BotStore.state` + `AppStorage('botState')` 浅拷贝 | 进程内 | 无磁盘持久化 |
| 聊天历史 | histories: Map<chatId, BotChatMessage[]> | 进程内 | 每会话上限 2000 条；最多保留 12 个会话（904-918），超出按 Map 顺序删除非当前会话 |
| 历史游标 | cursors | 进程内 | older 分页用；随历史淘汰一起删 |
| 流式消息 | streams | 进程内 | boot 变化时清空 |
| 乐观消息 | optimistic | 进程内 | 收到 ack 置 'sent'，刷新首页后剔除已 sent |
| 脏会话 | dirty | 进程内 | 历史请求在途时的续拉标记 |
| 通知游标 | noticeSeq/noticeTip/boot/feedBoot/queuedNotices/readThrough | 进程内 | 未读数/最近活动都依赖它；冷启动后从头拉 |
| 头像 | wantAvatars/attemptedAvatars | 进程内 | 图片本身以 data URI 存在 snapshot.chats[].image |
| Bot 模式标记 | PreferencesStore key botMode | 磁盘 | 唯一 Bot 相关持久化 |
| 聊天图片 | cacheDir/bot-images/* | 磁盘（文件） | 只有文件，无索引持久化、无清理/容量上限 |
| 内存图片索引 | BotImageCache.paths/inflight | 进程内 | 冷启动后需重新下载 |

### 3.6 未读数与「运行中」状态来源

- **未读数**：`state.unreadCounts[chatId]`，仅由 notice 事件里 kind 为 group/message 且 seq > readThrough[chatId]、且非「前台且当前选中」时 +1（recordNotice 1206-1211）；markChatRead 在 selectChat/setForeground/notice 到达时清零并把 readThrough 推进到 noticeTip（1214-1222）；boot 变化时全部清空（updateNoticeBoot 1181）。
- **运行中/实时状态**：`state.liveWork[chatId] = {kind, botId, startedAtMs}`，由 work.bots[botId]、work.rooms[roomId][]、work.turns[sessionId]、work.steered[sessionId] 推导（699-754）；kind 映射：switching-folder / web-search / web-read / image / working / thinking（756-774）。BotHomePage 用 liveWork 显示「运行中」和活动文案；BotChatPage 显示「运行中」。
- **最近活动**：`state.recent`（最多 30 条，done/question/approval/group/message），当前无页面渲染。
- **交互**：`state.interactions` 由 state.questions（按 sessionId 映射回 chatId）与 work.approvals（answerable!==false）合成（621-676）。

### 3.7 能力开关（capabilities → 快照字段）

`bot-subscribed.hello.capabilities` → applyCapabilities（334-342）：

| capability | 字段 | 使用方 |
| --- | --- | --- |
| role-settings | roleSettingsSupported | canEditRole 门槛（1731-1742） |
| bot-attachments | attachmentsSupported | 无 UI |
| reference-candidates | referencesSupported | 无 UI |
| bot-deletion | botDeletionSupported | BotRolePage 删除按钮 |
| bot-creation | creation.supported | create 系列 |
| bot-conversations | conversation.supported | new-chat 系列 |

### 3.8 其他实现细节

- revision/since 增量：state 请求带 since=revision、avatars='ref'；unchanged===true 时只更新 work+liveWork（525-684）；revision 回退则直接忽略。
- 消息 id 规则：`chatId:part:seq:kind:0`（938-975）；kind 为空丢弃；file 类无文件也丢弃。
- readChat 去重：同会话 chat/room-chat 在途时非 older 只标 dirty（390-401）。
- 头像：state 返回 imageRef 时按需拉 avatar（最多 4 并发），要求返回 data URI 且 ref 匹配才应用（1250-1267、1325-1354）。
- 写入保护：roleWrite 统一走 canEditRole（connected + role-settings + 非 saving + writable + 非 room），失败返回 false（1717-1742）。
- 错误处理：所有回执解析用 try/catch 包在 attach 的 onFrame 里，异常只 Logger.warn（87-93）。

---

## 4. 已知缺口

### 4.1 源码 TODO/FIXME 扫描结果

对 9 个 Bot 相关源文件做 `TODO|FIXME|HACK|XXX|暂未|未实现|后续|待实现|暂不|占位` 扫描：**0 处 TODO/FIXME 注释**。但存在等价于「后续/未接线」的死代码与半成品：

| 项 | 位置 | 说明 |
| --- | --- | --- |
| prefetched | BotStore.ets:73 | 声明后从未使用（疑似预取功能未完成） |
| unsubscribe() | BotStore.ets:145-153 | 从未调用，没有停止订阅/登出 Bot 的路径 |
| enterCreatedConversation() | BotStore.ets:2205-2211 | 无调用方 |
| restoreHiddenBot() | BotStore.ets:2214-2220 | 无 UI；而 visibleChats() 会过滤 hidden，被隐藏的 Bot 在首页无恢复入口 |
| indicatorOf() | BotStore.ets:1757-1767 | 无调用方（首页自己拼角标） |
| importCreationPhoto() | BotStore.ets:2046-2062 | 无 UI 上传入口 |
| creationImage() | BotStore.ets:2118-2129 | 无调用方 |
| hasEarlier() / isSupported() | BotStore.ets:1560/101 | 无调用方 |
| referenceSearch 字段 | BotDtos.ets:240-248 / BotStore.ets:2270 | 从未赋值；@ 引用搜索只有 DTO，没有 store 方法、没有输入框 |
| snapshot.boot | BotStore.ets:2257 | 从未赋值（只有私有 this.boot 在用） |
| BotChatPage.sending | BotChatPage.ets:23,144-146 | 同步置 true/false，无实际并发保护作用 |
| BotChatPage.keyboardVp | BotChatPage.ets:19 | 声明后未使用 |
| moreOpen | BotChatPage.ets:27,222-224,613-615 | 置 true 后无复位点 |

### 4.2 页面级缺口（按严重度）

1. **系统返回退出 Bot 模式不持久化**：无 onBackPressed/onDisAppear → botMode 仍为 '1'，下次冷启动自动进 Bot 模式（见 1.3）。
2. **Bot 页面不读路由参数、依赖前置状态**：
   - bot-chat 不读 param，依赖 push 前 selectChat；深链 pageRoute=bot-chat 会空白。
   - bot-role 同理；且 BotRolePage.aboutToAppear 用 roleDetails.botId 找 Bot，若未先 openRole 则永远空白（BotRolePage.ets:38-44、71-86）。
   - bot-create 成功只 selectChat + pop，不进入新 Bot 会话。
3. **新建群聊带首条消息时创建成功不跳转**（BotStore.ets:1944-1951 + BotNewChatPage.ets:22-31）。
4. **发送失败无任何提示**：BotChatPage onSend 无视 sendMessage 返回 false；state.error 只在 BotHomePage 显示。
5. **键盘避让缺失**：composer 只用 safeBottom，未用已声明的 keyboardHeightVp（BotChatPage.ets:19、499-532）。
6. **附件/图片发送、@引用未接线**：能力位与 DTO 都有，UI 只传空数组；无选图/附件入口；无 @ 候选输入。
7. **角色页信息缺失**：月度用量（inputTokens/outputTokens）、appliedModel/appliedEffort 未展示；私有开关不能关闭；保存无成功回显。
8. **新建 Bot 页功能不完整**：本地 Agent 路由被塞进 model 参数且 agentAppearance 恒 false；头像上传无入口；素材库分页未接线；loadingAgents/agentsFailed/photosFailed/signedIn 未渲染；errorText 重复分支。
9. **首页能力未落地**：「我的 Bot」只是新建页，没有 Bot 列表/管理/隐藏恢复；recent 最近活动无展示；定时任务只读 sheet。
10. **无加载态/骨架**：state.loading 全局未用；BotRolePage/BotCreatePage agents 无 loading 提示。
11. **「更多」菜单非弹层且不可关闭**（BotChatPage 内联 Menu()）。
12. **空态薄**：BotChatPage 空会话无空态；BotNewChatPage 成员列表无空提示；首页搜索无结果文案与「还没有聊天」混用。

**页面按钮接线盘点（逐页核对：没有发现「空实现 onClick」的按钮，缺的是按钮本身/入口）**

| 页面 | 已接线按钮 | 缺失按钮/入口 |
| --- | --- | --- |
| BotHomePage | 品牌栏/硬币（退出模式）、+（bindMenu）、两张快捷卡、Chief 卡、「与 X 聊聊」、聊天行、定时任务「关闭」 | 无「Bot 列表/管理」「编辑/删除/隐藏」「最近活动」入口 |
| BotChatPage | 返回、⋯、发送、选项胶囊、提交回答、拒绝、允许一次、两个菜单项 | 无附件、图片、@ 引用按钮 |
| BotNewChatPage | 返回、创建、成员行、管理员先发言 Toggle、已核对确认 | 无群聊命名输入、无 1:1 新建入口 |
| BotRolePage | 返回、保存、切换模型、模型/强度/权限 chip、私有 Toggle、记忆编辑/保存/取消/忘记/添加、「删除」任务、+新建每日任务/创建/取消、复制/设为主/删除 | 无月度用量展示、无头像/标签编辑入口（标签可编辑，无头像修改） |
| BotCreatePage | 返回、创建、配色/外形/素材/运行方式/模型 chip | 无「上传头像」、无「加载更多素材」、无 effort 选择 |

### 4.3 数据/协议层缺口

1. **无 Bot 状态持久化**：历史、游标、未读数、最近活动、图片索引都只在内存；冷启动全靠 refreshAll 重拉；离线期间通知无本地缓存。
2. **无 Bot 通知/角标**：EntryAbility 只调 BotStore.setForeground；没有 Bot 的 NotificationService/badge 集成（对比会话完成的 clearBadge，EntryAbility.ets:305-307）。
3. **bot-call 除 requestValue 外无超时**：pending 最多 32 条，满了 call 直接返回 null → UI 无提示；requestValue 也不检查 32 上限。
4. **订阅中断不自动恢复**：bot-stream-reset 只置 error，无退避重订阅；依赖下一次 hello/前台 refreshAll。
5. **未读数语义粗糙**：只在 group/message notice 上 +1，不做本地「当前页面正在看」以外的已读推进；无「全部已读」；readThrough 不持久化。
6. **create-room 的发送字段不一致**：applyCreateRoom 用 {sessionId, text} 发首条消息（1948），而 sendPayload 对群聊用 roomId（1481-1489）。
7. **创建/发送不确定性处理只做了一半**：create-bot 无 id 时置 uncertain 给用户核对（1915-1923）；但 create-room 之外（如 send）没有重试/幂等策略。
8. **state.boot 字段形同虚设**；capabilities/feedActive 等状态无 UI 呈现，排障只能看日志。

### 4.4 与 dsh-mobile 契约对齐层面的观察

- DTO 注释声明对齐 `dsh-mobile shared/facade/SharedBotStore.kt`；能力位与端点命名基本一致。
- 但 BotReferenceSearch（@ 引用）、BotChatIndicator（未读标记）、BotCreationAgent.image/signedIn、BotRoleDetails 用量等契约字段在 UI 侧没有消费方，说明「契约先行、UI 未跟进」。
- BotChat 的 image/imageRef 双通道：data URI 直出或按 ref 拉 avatar，已实现；hidden 字段只用于过滤，无隐藏/恢复操作入口。

---

## 5. 样式现状摘要（Bot 主题）

### 5.1 色板

| 语义 | 值 | 使用处 |
| --- | --- | --- |
| 主蓝（CTA/选中/发送） | #2F7DF6 | 全 Bot 页按钮、chip 选中、气泡、发送钮 |
| 主蓝禁用 | rgba(47,125,246,0.4) | 禁用按钮/发送钮 |
| 运行绿 | #31B77A；文字 #9BD9B8；底 rgba(49,183,122,0.18) | 首页连接点、运行中角标 |
| 未读红 | #FF4D4F | 首页未读数角标 |
| 错误/危险红 | #D9534F | 表单错误、删除、忘记 |
| 警示橙 | #E0A03C | 连接异常、未启用形象目录、uncertain、审批标题 |
| Bot 紫（主 Bot 主题） | 按钮底 rgba(167,139,250,0.32)；副文案 #D9C8FF；空/闲点 #C9A9FF | 首页「与 X 聊聊」、Chief 卡状态行 |
| 首页文字 | 主 #FFFFFF；次级 rgba(255,255,255,0.55~0.68)；弱 rgba(255,255,255,0.42) | BotHomePage |
| 首页玻璃底 | rgba(255,255,255,0.06)（列表行）/ 0.08（搜索条）/ 0.10（卡片）/ 0.14（+ 按钮）；描边 0.14~0.18 白 | BotHomePage |
| 管理页暗色 | 底 #0E1014；卡片 rgba(38,40,48,0.78)；输入 rgba(255,255,255,0.06)；chip 未选 rgba(255,255,255,0.08) | Role/Create/NewChat |
| 管理页亮色 | 底 #F4F6FA；卡片 rgba(255,255,255,0.9)；输入 rgba(0,0,0,0.04)；chip 未选 rgba(46,107,230,0.08) | Role/Create/NewChat |
| 聊天页 | 暗底 #141220 / 亮底 #F4F2FB；composer 暗 rgba(20,22,27,0.96) / 亮 rgba(244,246,250,0.96)；Bot 气泡暗 rgba(255,255,255,0.07) / 亮 #FFFFFF；交互卡暗 rgba(38,40,48,0.9) / 亮 rgba(255,255,255,0.95) | BotChatPage |
| 头像哈希色 | 首页 #C026D3 #7A5BFA #2F7DF6 #2FA98C #D97706；聊天 #5B7CFA #7A5BFA #2FA98C #D97706 #DB2777 #0EA5E9 | 无头像图时用首字 + 色块 |
| 定时任务 sheet | 暗 #1C1E24 / 亮 #FFFFFF，遮罩 rgba(0,0,0,0.4) | BotHomePage 367-417 |

### 5.2 背景与「玻璃」用法

- Bot 首页是**唯一有真实背景图层的页面**：OceanBackground() 深海鲸鱼背景铺满，其余内容靠白色半透明卡片叠在上面（BotHomePage.ets:419-427）。
- 5 个 Bot 页**均未使用** backgroundBlurStyle / BlurStyle / backgroundEffect（对 Bot*.ets grep 0 命中）。所谓「玻璃」是：半透明白底 + 1px 高光描边 + 大圆角，没有真实模糊。对比首页抽屉/隐私同意弹窗使用 BlurStyle.COMPONENT_THICK（Index.ets:354 附近）。
- 管理三页（Role/Create/NewChat）与聊天页是**纯色底**（暗 #0E1014/#141220，亮 #F4F6FA/#F4F2FB），卡片用 78%~95% 不透明度模拟层叠。
- Bot 页不设置状态栏特殊样式，走全局 StatusBarStyle 路由联动（Index.ets:198-212）。

### 5.3 字号 / 圆角 / 尺寸速查

- 字号：hero 32 Bold；页面标题 18；Chief 名称 17；区块标题 17；聊天标题 16.5；聊天/列表正文 15.5；输入 14-15；按钮 12-14；字段值 13.5-14；卡片标题 13.5；标签 12.5；说明 12；辅助/时间 11-11.5；角标 10.5；HARNESS 徽章 9.5。
- 圆角：大按钮 26；Chief 卡 22；快捷卡 18；卡片/气泡/按钮 16；chip/小按钮 12-14；输入 10-20（聊天输入 20、表单 10-12）；头像全圆；sheet 顶部 20。
- 常用尺寸：头像 30/40/44/96；顶栏圆钮 34-36；发送钮 40；聊天行 padding 14/10；卡片 padding 14；首页左右 22、子页左右 14-16；顶栏高约 safeTop+4 + 36。
- 安全区：safeTopVp/safeBottomVp（兜底 38.9/20）；聊天 composer 额外处理 keyboardHeightVp 但未使用（见 4.1）。
- 动效：BotChatPage 进入 280ms FastOutSlowIn（opacity 0→1、translateX 22→0）；首页无入场动效；定时任务 sheet 无过渡动画。

---

## 附：盘点范围与统计

| 文件 | 行数 | 本次读取方式 |
| --- | --- | --- |
| BotStore.ets | 2274 | 全文 4 段读取 |
| BotDtos.ets | 319 | 全文 |
| BotImageCache.ets | 161 | 全文 |
| BotHomePage.ets | 559 | 全文 |
| BotChatPage.ets | 625 | 全文 |
| BotNewChatPage.ets | 183 | 全文 |
| BotRolePage.ets | 536 | 全文 |
| BotCreatePage.ets | 317 | 全文 |
| Index.ets | 393 | 全文（含路由段） |
| HomePage.ets | 3921 | 仅 bot 入口/抽屉段（1690-1791） |
| EntryAbility.ets | 357 | 仅 bot attach / botMode / 前后台段 |

- Bot 相关页面数：5 个（1 首页 + 1 聊天 + 1 角色 + 1 新建 Bot + 1 新建会话）。
- Bot 路由数：5 条。
- BotStore 公开方法数：43 个（42 实例方法 + 1 静态方法）。
- BotSnapshot 公开字段数：40 个；另有 2 个子状态结构（creation 19 字段 / conversation 9 字段）。
- 源码 TODO/FIXME：0 处。
