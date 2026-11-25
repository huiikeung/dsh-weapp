# Bot 模式（DS-Bot）鸿蒙对接计划与进度

参考：iOS/Android DSH Mobile 的 Bot 模式（https://github.com/Clarklevis1995/dsh-mobile）。
规格：[bot-mode-ios-spec.md](./bot-mode-ios-spec.md)；现状：[bot-mode-harness-current.md](./bot-mode-harness-current.md)。

## 已完成

- [x] 规格与现状盘点（iOS 1098 行规格 + 鸿蒙 666 行盘点）
- [x] 新建群聊带首条消息时也跳转聊天页（BotStore.applyCreateRoom 一律记 openedId）
- [x] 系统返回离开 Bot 模式时写回 botMode='0'（BotHomePage.onBackPressed）
- [x] bot-chat / bot-role 深链参数恢复（NavDestination.onReady 读 param）
- [x] 聊天页发送失败提示 + 保留草稿；更多菜单改为 bindMenu 并在关闭时复位
- [x] 聊天页输入条键盘避让；聊天空态/未选聊天空态
- [x] 聊天页选图发送（最多 4 张 / 12MB，base64 入 images，attachmentsSupported 门控）
- [x] 新增「我的 Bot」管理页（团队成员列表、主 Bot 徽标、隐藏 Bot 恢复、新建入口）
     路由 bot-manage；首页「我的 Bot」快捷卡改为进入该页
- [x] 新建 Bot 页补全（本地 Agent/模型/形象/名字校验/提交态，浅紫主题）
- [x] 角色设置页补全（只读资料/用量、私有开关可关、danger 权限二次确认、保存脏检查、记忆/定时任务编辑、管理区确认弹窗、Bot 主题）
- [x] Bot 首页浅紫主题 + BotBackground（BotBackground.ets 静态 Canvas；首页 1045 行重做）
- [x] 聊天页浅紫主题（气泡/顶栏/提问/审批/输入条、时间与发送状态、BotFace 头像）
- [x] BotStore 失败兜底：bot-call 32s 超时、发送超时→delivery=unknown、角色写失败→roleError

## 模式入口 / 左侧栏对齐（2026-11-24 追加）

- [x] Bot 模式首页也挂载同一套左侧栏（`BotHomePage.drawerOverlay/drawerItem`，与 `HomePage` 同视觉：白/深底、圆角、遮罩、320ms 动画）
- [x] 左上 HarnessMark（FluKeCoin/品牌行）点击 → 打开左侧栏（**不再直接退出 Bot 模式**）
- [x] 抽屉首项：Bot 模式显示「切换到工作模式」（⇄ 紫色尾随），点击立即关抽屉并写回 `botMode='0'` 弹出 Bot 首页
- [x] 工作模式抽屉首项改为「切换到 Bot 模式」（原来只写「Bot 模式」）
- [x] Bot 模式抽屉里的插件/自动化任务/连接器/设置：先退出 Bot 模式再压入目标页（避免目标页叠在 Bot 首页上）
- [x] 右滑开抽屉 / 左滑收抽屉（PanGesture 横向 ≥64vp，横向分量 > 纵向 1.2 倍）
- [x] 系统返回：抽屉打开时先收抽屉，否则离开 Bot 模式
- 备注：抽屉项尺寸改用固定 vp（图标 24 / 文字 17 / minHeight 52 / 内边距 14），不再用放大的 rpx 数值，避免文字竖排
- [x] 抽屉图标换成 iOS 原版矢量：新增 `workspace_drawer_mark.svg`（「切换到工作模式」前图标，BotInk 着色）、`mode_swap.svg`（尾巴双向箭头，替换文本 ⇄）、`bot_drawer_mark.svg`（工作模式抽屉「切换到 Bot 模式」前的黑色 DS Bot 鲸鱼）
- [x] Bot 首页**全模块**改用「自动化任务」页 AppGlass 语汇：主按钮（与 X 聊聊）= 玻璃胶囊；「+」= 32 玻璃圆 + 双线加号；Chief 卡 / 我的 Bot / 定时任务快捷卡 / 搜索框 / 聊天列表卡 / 状态卡 / 加载卡 / 空态卡 = 玻璃卡或玻璃胶囊；定时任务面板 = 玻璃面板 + 玻璃「关闭」胶囊；抽屉保持白/深底
- [x] 工作模式首页的「切换主机」行抽成组件 `components/HostSwitcherBar.ets`（1543 行：主机胶囊 + 配对/设置圆钮 + 切换主机半模态 + 配对菜单 + 设备认证 sheet，自包含、零回调），已插入 Bot 首页（手机单栏品牌行下方；宽屏跨两栏），Bot 浅色下玻璃圆钮/图标做深墨适配

## Bot 背景 / 切换主机（2026-11-24 追加）

- [x] Bot 背景补鲸鱼点阵：`BotBackground.paintWhale()` 复用工作模式/iOS `HarnessBackgroundComposition` 构图（cx=0.55w、cy=0.34h、size=max(1.15w,0.48h)、iPhone 2000 点 / 平板 100×100 点阵），静态一次绘制；浅色淡紫点、深色淡紫 screen 发光；`nativecore` 导出 `WHALE_PIXELS_IOS/PAD`
- [x] 切换主机面板打不开修复：`HostSwitcherBar` 同一节点挂了两个 `bindSheet`（切换主机 + 设备认证），ArkUI 下后者覆盖前者 → 把「切换主机」sheet 移到行外层 Column 上，两个 sheet 分属不同节点
- [x] 深色模式：鲸鱼点阵深色配色；HostSwitcherBar 深色沿用工作模式白玻璃（浅色 Bot 用墨色玻璃）；抽屉底色深色 #181A1F
- [x] 空聊天区：Bot 首页聊天区只渲染会话列表（名称/预览/时间/未读/运行中），无会话显示「还没有聊天」玻璃空态卡
- [x] Bot 首页卡片统一为系统液态玻璃（沉浸光感）：透明底 + backdropBlur(10) + 1px 白 0.90/0.16 发丝边 + 外层不裁剪容器 shadow(14/6)；覆盖 Chief 卡、快捷卡、聊天列表卡、搜索框、状态/加载/空态卡、主按钮、「+」、重新同步 chip（不透明实底与 AppGlass 全部移除）
- [x] Bot 背景按 dsh-mobile Bot 首页截图重做：淡紫 #EFE9F6 基色 + 左上柔光 + 三道 -0.34rad 斜向光束（白 60/44%、淡紫 55%）+ 顶部提亮 + 更淡网格/点阵；深色版对应减弱；鲸鱼点阵保留
- [x] Chief 头像对齐 iOS BotFace：有主机图用图，否则主 Bot 用 `dsh_orca_mark.svg`（WhalenessOrcaIcon，0.58×、BotInk 着色、BotLavenderSoft 圆角 size/3 底）；新增私有 helper `chiefHasImage()`
- [x] Chief 卡点击改为**底部原生玻璃弹窗**（对齐 iOS §7.5 角色名片）：`bindSheet` + `uiMaterial.ImmersiveMaterial(THICK)` `systemMaterial`（浅色奶白 / 深色通透，永远系统玻璃），`SheetSize.FIT_CONTENT`；
      内容：拖动条 + orca 头像 80 + 名字 24 bold + 角色 + 说明 + 只读资料（模型/权限/工作文件夹/近 30 天用量）+ 功能区（记忆 N 条、定时任务 N 个）+ 底部「关闭 / 角色设置」；行底为半透明填充让玻璃透出
- [x] 名片弹窗内右上角「设置」→ **在同一个弹窗内**切到「角色设置」页（不跳页）：新增 `@State chiefSheetPage`（0=名片 / 1=设置）+ 草稿字段 + 脏检查/保存/roleError 映射；设置页含 名字/标签/说明/模型/推理强度/权限/工作文件夹/隐私 与保存按钮，记忆与定时任务保留完整页入口
- [x] 定时任务面板同样改为原生玻璃 `bindSheet`（挂在独立 0×0 节点上，避免与 Chief sheet 同节点互相覆盖）
- [x] 模式切换动效对齐 iOS：去掉左右推屏转场，改为「点击点为圆心的模式波纹」——
      `components/ModeWave.ets`（Index 根层常驻，圆形扩张 420ms + 淡出 200ms，颜色=目标模式底色）+ `common/ModeTransition.ets`（startModeWave）；
      抽屉首项点击时抽屉立即无动画归零（drawerInstant），430ms 后 `pushPathByName(..., false)` / `pop(false)` 无动画切页；冷启动进入 Bot 模式也不再用推屏动画

## 待做（P1/P2）

1. 文件附件上传（bot-attachments receipts 链路；需要网关 upload 协议，iOS 走 FileUploadController）
   - 说明：图片已支持随消息发送（base64 images）；非图片文件仍需 receipts 上传通道
2. [ ] @ 引用系统 —— **尚未落盘**（18:5x 的 impl-bot-refs 子任务未产生修改，需重跑：BotStore.searchReferences/clearReferenceSearch + 聊天页 @ 弹层）
3. [x] Bot 本地通知（BotNotify.ets：仅 done 事件、boot:seq 去重、前台打开该聊天不打扰、开关 botDoneNotifyEnabled、复用 NotificationService.notifyTaskDone；点击仅回前台，Bot 专用路由待 EntryAbility 扩展）
4. [x] R2 宽屏双栏（BotHomePage 1163 行：wideHome/compactHome 分支、pageW/pageH + onAreaChange、760×500 断点、搜索聚焦保持双栏、sheet 限宽 580；手机单栏真机回归通过）
5. [x] 群聊拼贴头像（4+N）+ 成员五色板（BotGroupAvatar.ets：席位几何对齐共享层 BotAvatarLayout；BotBubblePalette 按 id 排序稳定；首页群聊行/聊天页群聊顶栏与发言者已接入）
6. [x] 状态缓存持久化（BotCache.ets：12 聊天×100 条、7.5MB 淘汰、600ms 防抖、原子写、恢复清在线态；真机已落盘验证 version=1 / connected=false / 无 selectedChatId / histories 1×1）
7. [x] 请求超时 32s + 「状态待确认」
8. [x] 角色定时任务/记忆的完整编辑体验

## 2026-11-25 图标 / 头像 / 聊天区

- [x] 首页聊天区默认不显示 Chief（对齐 iOS `SharedBotStore.searchChats`：搜索词为空过滤 mainBotId；隐藏 Bot 仅搜索时出现，主 Bot 私聊除外）
- [x] 「与 X 聊聊」前置图标换成 iOS BotConversationMark（`bot_conversation_mark.svg`，25.2422×20.1094）＋白色变体；原先误用抽屉里的 BotDrawerMark 鲸鱼
- [x] 统一 BotFace（首页 Chief 卡 / 聊天列表行 / 我的 Bot / 聊天页顶栏与气泡）：主机下发图 → 主 Bot「DS Bot 蓝鲸」→ 首字；圆角 size/3
- [x] 主 Bot 无图兜底从虎鲸剪影改为 `dsh_whale.svg`（DS Bot 蓝鲸 #4D6BFF），主机头像没到时不再「头像变空」
- [x] 快捷卡数量改内联读取 state（ArkUI @Builder 按值传参不刷新，导致「我的 Bot」长期显示 0）
- [x] 首页搜索框换成工作模式同款细线放大镜（`search_white_thin` / 新增 `search_ink_thin`，20×20、opacity 0.68）
- [x] 左侧栏（工作 / Bot 两个抽屉）深浅色适配：新增 `bot_drawer_mark_white` / `workspace_drawer_mark_white` / `mode_swap_dark`
- **坑**：`Image.colorFilter()` 对 SVG 无效（只对位图生效）；SVG 图标要么用深/浅两套资源（本仓既有 `*_ink`/`*_white` 约定），要么改 `fillColor`（限 fill 型图标）。深色模式下「图标消失」基本都是这个原因。
- [x] 名片 / 定时任务弹窗高度 `FIT_CONTENT` → `92%`：内容 Scroll/List 改 `layoutWeight(1)` 撑满，去掉 520/560/420 的 maxHeight 限制
- [x] 「关闭」从底部（名片）和右上（定时任务）统一移到弹窗左上角工具条；右侧按页给「设置」/「保存」
- [x] 弹窗内翻页：0 名片 / 1 角色设置 / 2 记忆 / 3 定时任务，全部在同一个 sheet 内切换（`chiefSheetPage`），不再 push `bot-role` 二级页
- [x] 头像默认态统一「无底板」：`orcaAvatar(size, iconScale)` / `letterAvatar` 都不再铺 `lavenderSoft` 方块；聊天行主 Bot 鲸鱼 0.58→**0.82**、首字 0.42→**0.56**（名片/弹窗保持 0.58，靠显式传参区分）
- [~] 弹窗顶部「系统渐变模糊」尝试后**已回滚**：在沉浸玻璃面板上再叠 `BlurStyle.COMPONENT_THICK` 会显出白色块（面板本身已是系统材质），改为只保留按钮行
- [x] 「我的 Bot」：主 Bot（Chief）**永远排第一**（`bots()` 主 Bot 分组 + 其余保持主机顺序）；点行不再进 `bot-role` 二级页，改为写 `botPendingRoleId` 并 pop，由 Bot 首页消费后弹出**与 Chief 卡同一个底部弹窗**（`sheetBotId` 切换目标 Bot，标题/角色/说明/头像/档案全部跟随目标 Bot）
- [x] 弹窗宿主统一系统材质：新增 `common/SheetMaterial.ets`（`sheetSystemMaterial/sheetFallbackColor/immersiveSheetSupported`），对话页与「我的 Bot」的 bindSheet 都传 `systemMaterial`，不再出现"透明底"
- [x] sheet 内容只构建一次 → 目标 Bot 改走 `@StorageLink('botSheetTargetId')`（`chiefId()` 以此优先），修掉"点谁都显示 Chief"
- [x] 角色弹窗最终方案：`components/BotRoleSheet.ets` 由 **BotHomePage 整体复制**（imports + 全部成员）而来，只把 `build()` 换成 `this.chiefRoleSheet()`、`chiefId()` 返回 `botId`、`closeChiefSheet()` 调 `onClose`；因此样式与内容与首页 Chief 卡**逐像素一致**。对话页头像、我的 Bot 点行都改用它（就地 bindSheet，92% 高、系统玻璃材质）。
  被取代的尝试：手工按成员抽取（漏成员 → 编译失败）与「角色页嵌弹窗」（样式不一致）
- [~] 旧的抽取尝试： `components/BotRoleSheet.ets`（从 BotHomePage 抽取 84 个成员，含状态/工具方法/四个页面），入参 `botId` + `isDark` + `onClose`，数据走 `@StorageLink('botState')`；对话页与「我的 Bot」都改成**就地 bindSheet**（不再 pop 回首页）
- [~] 对话页头像点击统一走角色弹窗（旧方案，已由上面的就地弹窗取代）：`BotChatPage.openIdentity()`（顶栏身份头像）与 `botFace()` 内的头像点击都改成「写 `botPendingRoleId` → pop → Bot 首页弹同一个弹窗」；群聊头像不响应
- [x] 弹窗「管理」组补齐非主 Bot 的行：**设为主 Bot**（`replacePrimary`）、**删除 Bot**（`deleteRole` + `AlertDialog` 二次确认「将「名字」移出团队和所在群聊。」，仅 `botDeletionSupported` 时显示）
- [x] 主题色补齐：主 Bot 徽标/「恢复」胶囊/头像 hover 底用 `softChipColor()`、分段 Tab 选中底 `segmentSelectedColor()`、形象选择头像块的 hover/选中 `lookTileColor(selected)`、`purple()` 强调色统一换成 `actionColor()`；弹窗内「设置」文字与保存/添加/创建/+ 主按钮也改用 `sheetActionColor()`
- [x] 返回按钮统一：`我的 Bot`、`新建 Bot`（含形象面板内的关闭返回）全部换成 `NavBackButton` 原生玻璃圆钮
- [x] 「我的 Bot」「新建 Bot」配色跟随主题：`BotPalette` 新增 `action/actionDark`，两页 canvas 用 `palette.base/baseDark`、主按钮用 `palette.action`、分段控件底用调色板淡色；新建 Bot 仍是二级页
- [x] 右上角状态胶囊拆成三态并支持点击提示：`botPillText()` = 未连接 / **未安装 ds-bot 插件**（订阅报错 `state.error` 有值）/ **网关版本过低**（hello 一直没回来）/ DS Bot 已连接；点击走 `showBotStatusHint()`，未连接→提示先连主机，未装插件→提示装 ds-bot 插件，网关过旧→提示更新主机插件，**插件已装则点击不打扰**
- [x] 顶部轻提示 `topToast()`：淡入 + 停留 2.6s + 淡出，样式对齐对话页（圆点 ! 徽标 + 白/深色卡片 + 0.5 描边 + 柔和投影），`hitTestBehavior(None)` 不挡触摸
- [x] 品牌行右上「DS Bot 已连接」胶囊底色改为**跟随 Bot 背景配色**（`statusPillBg()`：浅色取调色板 `fluidFrom` @0.42、深色取 `fluidToDark` @0.55），不再是固定的 lavenderSoft
- [x] 设置页分组标题：缩进 16（与卡片内文字对齐）、`margin bottom -14` 让标题距自己的模块只有 8，距上一个模块仍 22
- [x] 名片页数据刷新修正：记忆/定时任务/用量改为**内联读取状态**的 `sheetMemoryRow()`/`sheetScheduleRow()`/`sheetUsageRow()`（原来用 `@Builder` 值参数，回包后不重建，所以记忆一直显示 0，点进记忆页再返回才刷新）
- [x] 名片页顺序：模型/权限/工作文件夹 → 记忆/定时任务 → **近 30 天用量挪到定时任务下面**
- [x] 设置页补齐 iOS §7.6：每个分组加 section 标题（资料/模型/工作区与权限/说明/操控/内容/管理），新增「管理」组：更换主 Bot（主 Bot 才显示，bindMenu 选候选，走 `replacePrimary`）+ 复制一份（`duplicateRole`），footer 说明
- [x] 弹窗工具条按页切换：名片页左「关闭」右「设置」；子页左上换成默认圆形返回钮（复刻 NavBackButton：系统玻璃 + 白细边 + 柔和投影，点击只翻弹窗页）；设置页右上「保存」默认灰、改动后变实心紫色；记忆/定时任务页右上圆形「+」
- [x] 记忆「+」/ 定时任务「+」在弹窗内展开表单（不弹二级对话框）：记忆走 `saveMemory`，定时任务走 `scheduleDaily`（标题/内容/每天 HH:mm + 设备时区），成功后 `openRole` 刷新列表
- [x] 弹窗「角色设置」页布局对齐 iOS §7.6（insetGrouped）：头像 56 头部行 → 资料（名字/标签，右对齐输入）→ 模型（模型/推理强度行）→ 工作区与权限（工作文件夹/权限/隐私）→ 说明（TextArea 96）→ 操控（只读）→ 记忆/定时任务导航；每组独立卡片 + 组下 12pt footer（负 margin 贴紧卡片）；组间距 22
- [x] Bot 头像：主机没给 `imageRef` 时也主动请求一次 `avatar`（每台 Bot 一次，`attemptedAvatars` 用空串占位）；`applyAvatar` 改为「只在登记过 ref 且回包 ref 不一致时丢弃」，否则首次安装会一直停在首字
- [x] **聊天区头像一直不显示的真因**：网关 `bot-bridge` 的 `avatar` 端点会用 `defaultAvatar(bot)` 现渲染 look SVG（`data:image/svg+xml`），回包 `ref` 与 state 注入的 `imageRef` 一致；但列表 `ForEach` 的 key 只含 id/preview/lastAt，头像异步到达后行不重建 → 永远显示首字。key 补上 `imageRef` + 是否已有图，头像到位即刷新（首页聊天区与「我的 Bot」都已改）
- [x] 头像图统一套固定尺寸裁剪容器 `hostAvatar(chat,size)`（Stack + clip）：dataURL 若是 SVG，直接给 Image 设宽高在部分版本会按固有尺寸溢出

## 2026-11-25 Bot 背景配色可选（设置 → Bot 背景配色）

- 新增 `native-core/src/main/ets/core/BotPalettes.ets`：`BotPalette` 结构（基色 / 两段流体色 / 网格墨色 / 鲸鱼点色 / 底部收敛 / 游移柔光，深浅各一套）+ 5 套预设：
  `periwinkle` 长春花（默认，冷蓝紫）、`mint` 薄荷青、`sky` 天空蓝、`ice` 冰紫、`lavender` 淡紫（iOS 原版，略粉）
- `BrandFlow.render()` 不再写死调色板：改为接收 `paletteFrom/paletteTo` 两段 RGB；`renderBotFlow(w,h,aspect,seconds,night,presetId)` 从预设里取色；`prepareBotFlow` 增加 `presetId` 入参（TaskPool 只传字符串，安全）
- `BotBackground` 用 `@StorageLink('botBgTheme')` 取预设，基色/网格/鲸鱼/收敛/柔光全部走预设；切预设即重建流体位图
- 设置页「界面」组新增行「Bot 背景配色」（`rowDescPref` + `openPicker('botbg')`），副文案显示「名称 · 风格」；选择后 `PreferencesStore.putString('botBgTheme')` + `AppStorage` 联动，重启保持
- 深色网格同步下调：亮线改成「比底色更暗」的黑线（0.16 / 点 0.20），避免暗底上亮格线刺眼
- 修「进页面颜色有明显延迟」：① `EntryAbility` 在 Preferences 就绪后**立刻**把 `botBgTheme` 写进 AppStorage（原先只有进设置页才读，用户没进过设置就会先按默认色画一帧再跳色）；② `BotBackground.drawBase()` 在流体位图缺失时**同步**渲一张低分辨率流体并当场画上，不再出现"先只有底色、几百毫秒后光带才浮出来"

## 2026-11-25 Bot 首页背景动起来（对齐 iOS HarnessAnimatedBackground）

- [x] `BotBackground.ets` 从「单 Canvas 画一次」改为两层：静态层（基色 + 柔光斑 + 技术网格，主题/尺寸变化时重画）+ 30fps 运动层（光带 + 鲸鱼点阵 + 底部收敛）
- [x] 鲸鱼点阵按 iOS `HarnessWhaleField` 公式动：`driftX = sin(t*0.5 + phase*0.53) * 2.8 * edge`、`driftY = cos(t*0.42 + phase*0.71) * 2.6 * edge`、尾部 `sin(t*1.1 - x*7) * 7 * smoothstep(0.54,0.94,x)`、`shimmer = 0.9 + 0.1*sin(t*1.5 + x*15 + y*9)`；点改 `fillRect` 圆角小方块（比 arc 便宜），按亮度分 6 批合并 fillStyle
- [x] 光带改成**弯曲光弧**（原来是我自己画的三条直线渐变，所以看着是直的）：`BrandFlow.ets` 的 `render()` 增加 `palette` 参数，Bot 模式复用同一套 fbm/丝带公式，只在最后按 iOS `lavenderPalette` 分支做亮度重映射——浅色 `mix(#C9B3E3, #FCF8FF, saturate(lum/0.5))`，深色 `mix(#332B3D, #574C5E, …)`；新增 `renderBotFlow` / `prepareBotFlow`（TaskPool 渲染 144px 宽位图）+ `nativecore` 导出
- [x] 光带只渲染一次（fbm 逐像素太贵），保留一层极淡的缓慢游移柔光（浅 `rgba(255,255,255,0.30~0.40)`、深 `rgba(146,120,196,0.045~0.07)`）让背景"活着"
- [x] 鲸鱼层模糊从 `.blur(0.9)` 加到 `.blur(2.4)`（用户要求更糊），alpha 仍是 iOS 的 0.56 折算
- [x] **配色改「年轻」一档**（用户反馈 iOS 原版 lavender 偏粉）：基色 `#F4F1FA` → `#EEF1FB`，流体丝带 `#B9C4F0 → #F8F9FF`（长春花蓝/雾蓝，冷蓝紫），网格墨色改 `rgba(88,104,168,…)`，鲸鱼点 `rgb(104,124,190)`；深色基色 `#14151F`、丝带 `#28293A → #4A4C66`、点 `rgba(184,198,240,…)`；流体位图以 0.58（深色 0.72）叠加，避免整屏被染
- [x] 每帧只重绘运动层（约 1k 粒子 + 3 条渐变带 + 1 个底部渐变），静态层零重绘；`aboutToDisappear` 清定时器
- 数据来源：`WHALE_PIXELS_IOS`/`WHALE_PIXELS_PAD`，字段 `[x, y, luminance, edge, phase, light]`
- [x] 柔化对齐 iOS 的两处：① iOS 该层整体 `.opacity(0.56)` → 这里把 alpha 直接乘 0.56（原来偏黑偏实）；② iOS `.blur(radius: 0.18)` → 运动层 Canvas 加 `.blur(0.9)`（vp），点阵边缘不再锐利；浅色点色也从 `#584190` 调到 iOS lavender 的中性紫 `rgb(133,113,176)`

## 2026-11-25 首页头部对齐工作模式首页

- [x] Bot 首页内容顶部内边距 `safeTop + 18` → `safeTop + 14`（与工作首页一致）
- [x] 品牌行 → 主机行：`28` → `6`（本页列间距 16，合计 22，与工作首页 `margin bottom 22` 一致）
- [x] 主机行 →「个人助理」：加 `margin top 69`（列间距 16 + 69 = 85，对应工作首页 24 + 60）
- 尺寸链：工作首页 `14 + 品牌36 + 22 + 主机49 + 24 + 60 = 205vp`；Bot 首页 `14 + 36 + (6+16) + 48 + (16+69) = 205vp`
- 实测（截图取文本带 y 坐标，1320px 宽 3x 屏）：主机胶囊标签带 工作 `448–472` / Bot `447–471`（差 1px）；标题顶部 工作 `829` / Bot `832`（差 3px ≈ 1vp，字号 25 vs 32 导致的字形差）
- 主机行三颗控件两页共用同一布局：左右边距 22、胶囊高 48（工作页 49）、配对/设置圆钮 48（49）且设置钮左间距 10.6

## 构建注意

- `build-profile.json5` 仓库提交的是 Windows 签名路径，本机编译前需临时改成本机 Mac 证书（不要提交该文件）。
- 构建命令：
  ```bash
  cd harmonyos/native-app && hvigorw --mode module -p product=default assembleHap --no-daemon
  ```
- 真机安装：`hdc -t <serial> install -r entry/build/default/outputs/default/entry-default-signed.hap`
- 深链调试：`hdc shell aa start -b com.flukit.app -a EntryAbility --ps pageRoute bot-home|bot-manage|bot-create|bot-new-chat|bot-chat`
- **当前构建阻塞（2026-11-24 19:10 起）**：`TailscaleTunnelStore.ets:589` 调用了未实现的 `pairedTailnetIps()`（另一并行工作留下的 Tailscale 网关 peer 选择 WIP）。Bot 侧改动已在隔离副本（/tmp/hverify，将该文件还原为 HEAD）验证 `BUILD SUCCESSFUL` 并装到真机截图。等 Tailscale 那边补完方法即可在主仓重新构建。
