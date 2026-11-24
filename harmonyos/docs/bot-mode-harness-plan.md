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

## 构建注意

- `build-profile.json5` 仓库提交的是 Windows 签名路径，本机编译前需临时改成本机 Mac 证书（不要提交该文件）。
- 构建命令：
  ```bash
  cd harmonyos/native-app && hvigorw --mode module -p product=default assembleHap --no-daemon
  ```
- 真机安装：`hdc -t <serial> install -r entry/build/default/outputs/default/entry-default-signed.hap`
- 深链调试：`hdc shell aa start -b com.flukit.app -a EntryAbility --ps pageRoute bot-home|bot-manage|bot-create|bot-new-chat|bot-chat`
- **当前构建阻塞（2026-11-24 19:10 起）**：`TailscaleTunnelStore.ets:589` 调用了未实现的 `pairedTailnetIps()`（另一并行工作留下的 Tailscale 网关 peer 选择 WIP）。Bot 侧改动已在隔离副本（/tmp/hverify，将该文件还原为 HEAD）验证 `BUILD SUCCESSFUL` 并装到真机截图。等 Tailscale 那边补完方法即可在主仓重新构建。
