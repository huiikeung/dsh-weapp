# 原生元服务 ↔ 小程序 对齐清单

对照源：`miniprogram/`（home / session-settings / add-node / plugins / schedule）
状态：✅ 已对齐 · 🟡 部分 · ⬜ 未做

## 首页（pages/home）

| # | 入口 | 小程序行为 | 对应弹窗/页面 | 状态 |
| --- | --- | --- | --- | --- |
| 1 | 左上角品牌行 | openDrawer | 左侧栏 | ✅ |
| 2 | 主机胶囊 | openHostSwitcher | 切换主机底部面板（编辑/删除/铅笔/类型下拉） | ✅ |
| 3 | 配对圆钮 | togglePairMenu | 配对菜单（扫描/手动/引导）+ 按钮隐藏+缩放展开 | ✅ |
| 4 | 设置圆钮 | openSessionSettings | 会话设置页 | 🟡 仅主机信息/诊断/连接 |
| 5 | 工作区卡片 | openWorkspacePicker | 工作区弹窗（全部/未分组/工作区/添加） | ✅ |
| 6 | 添加工作区 | openDirSheet | 目录浏览 + 新建文件夹 + 添加此目录 | ✅ |
| 7 | 新建会话 | newSession | session-create + 进入会话 | ✅ |
| 8 | 搜索框 | 搜索会话 | 本地过滤 | ✅ |
| 9 | 会话行 | openSession | 会话页 | 🟡 页面未 1:1 |
| 10 | 会话行左滑 | 重命名/归档 | 操作按钮 | ⬜ |
| 11 | 会话行长按 | sessionActions | 操作菜单 | ⬜ |
| 12 | 最近会话分区 | toggleSessionSection | 折叠/展开 | ⬜ |

## 左侧栏（drawer）

| # | 入口 | 行为 | 状态 |
| --- | --- | --- | --- |
| 1 | 品牌 | — | ✅ |
| 2 | 插件 | 插件页 | ✅ |
| 3 | 自动化任务 | 自动化页 | ✅ |
| 4 | 额度卡片 | 用量明细 | ⬜ |
| 5 | 设置 | 会话设置页 | 🟡 |

## 会话设置页（pages/session-settings）

| # | 区块 | 内容 | 状态 |
| --- | --- | --- | --- |
| 1 | 账号与余额 | 头像/名称/充值余额/赠金 | ⬜ |
| 2 | 新会话默认配置 | Agent 预设 / 默认模型 / 权限 | ⬜ |
| 3 | 功能 | 模型 | ⬜ |
| 4 | 诊断信息 | 模型服务商 / 模型 / 已连接会话 / 工作目录 | 🟡 |
| 5 | 清理缓存 | confirmClearCache | 🟡 仅提示 |
| 6 | 主机信息 | gatewayId / version / path | ✅ |

## 会话页（pages/session）

| # | 区块 | 状态 |
| --- | --- | --- |
| 1 | 对话（气泡 + markdown + 输入框 + 发送/排队） | ✅ 原生 `pages/ConversationPage`（对齐 dsh-mobile ConversationView） |
| 2 | 排队（steer/remove） | 🟡 仍在 `pages/SessionPage`（更多菜单 → 任务面板） |
| 3 | 轨迹（turn/step/tool） | 🟡 同上 |
| 4 | 上下文（requests/window/stats） | 🟡 同上 |
| 5 | 编队（fleet 节点+连线） | 🟡 同上 |
| 6 | 顶部标签栏/更多菜单 | 🟡 更多菜单已接「会话设置 / 任务面板」 |
| 7 | 工作步骤展示（简洁/标准/详细/完全展开） | ✅ 四档策略与小程序 `work-step-presentation.apply` 同构 |
| 8 | 底部 dock：排队消息 / 任务 / 目标 | ✅ 卡片样式、图标、交互按小程序 `dock-stack` 对齐；显示完全由网关数据驱动 |

### 底部 dock（对齐 `miniprogram/pages/session` 的 dock-stack）

- **显示映射**：不给默认假数据，完全按 DSH 下发的数据出现——
  - 排队消息：`session-queue` 有 items 才显示（>1 条可折叠，单条直接铺开，>4 条限高 360rpx 滚动）
  - 任务：`tasks/tasks-updated` 帧的 `todos` 非空才显示，标题旁「N 已完成 · N 进行中 · N 待处理」，点开看成员列表
  - 目标：`goal/goal-updated` 帧存在目标才显示，阶段文案 进行中的目标/已暂停的目标/受阻的目标/当前目标
- **图标**：直接使用小程序同一批资源 `tasks-list.svg`、`goal-target(-dark).svg`、`goal-pause/play(-dark).svg`、`queue-message/edit/delete/send(-dark).svg`、`check-green.png`、`dotted-gray.png`、`pinwheel-ink/white.png`；尺寸 36/34/38rpx、0.72 透明度与小程序一致
- **功能**：
  - 队列：编辑（取回草稿并从队列移除，草稿非空时换行拼接）、删除、运行中「立刻发送（steer）」；附件显示「N 个附件」
  - 任务：只读 + 折叠
  - 目标：暂停/继续（按 phase 切换图标）、就地编辑（✓ 保存 / × 取消）、清除（确认弹窗，提示会停止后续自动轮次）
- 数据来源：`native-core/state/SessionStore.ets` 解析 `tasks / tasks-updated / goal / goal-updated / goal-edited|paused|resumed|cleared / session-queue(s)` 帧，按 `asOfSeq` 丢弃旧帧；进入会话与重连后主动拉一次；目标变更用 `goal-edit / goal-pause / goal-resume / goal-clear`（带 revision CAS），本地 5s 兜底释放忙碌态

### 工作步骤展示（对齐 `miniprogram/pages/session/utils/work-step-presentation.js`）

- **档位策略**（`native-core/projection/WorkStepPresentation.ets`）：
  - 简洁 `compact`：恒分组、收拢已完成回合、组标题去掉「N 次工具调用 / N 项上下文」计数、运行中只留活动组
  - 标准 `standard`：恒分组、运行中显示实时细节，展开后限高滚动
  - 详细 `detailed`：`history` 分组——对话过程中不分组、组体自动展开；回合收工后折成「已完成」行，展开后各组默认跟着展开
  - 完全展开 `verbose`：不分组、无组标题、组体常开、不自动收起
  - 收起时机 `completion / next-input`：后者只收拢后面已经出现新用户消息的回合
- **回合行**：标题「已完成」+ 摘要「用时 X」；展开后摘要换成「N 次工具调用」；失败/中断回合恒展开、不可折叠
- **组行**：活动命名（「已读取文件，已搜索代码…」）+ 计数摘要；展开时组体限高 `min(400px, 50vh)` 语义
- **步骤行**（`ConversationRowView`）：图标槽 32rpx，点开时图标淡出、同一位置换成向上箭头（`.command-icon-slot.disclosed`）
  - 工具行 = 调用参数 + 结果两段（结果按 callId 并入调用行，不再单独占一行）
  - 思考 = 阅读卡（定高滚动 + 「完整内容 / 收起阅读」底栏）
  - 上下文 = 2rpx 竖线 + 缩进正文
  - PTC 子步骤（`tool/ptc-dispatch`）= 每级 28rpx 缩进 + 左侧竖线轨道

### 新会话输入框上方的模式 / 工作区胶囊

对齐 iOS `ConversationView.newConversationWorkspaceControl` / `newConversationWorkspaceMenu`（`_dsh-mobile-latest`）。

- **显示时机**：会话还没有任何消息、没在跑、队列为空（`showModeChip()`）时，输入框上方出现一行胶囊（`ConversationPage.bottomDockLayer`）：
  - 左：Agent 预设（运行模式）胶囊，原生 `Menu` 弹出标准 / PTC / 极简 / 创造模式（实际项以网关预设为准）
  - 右：「工作区」胶囊，显示这个新会话所属工作区（认不出时显示「未分组」），原生 `Menu` 弹出「默认工作区 + 各工作区（名称 + 路径）」，当前项打勾
- **样式**：两个胶囊同一套——`HdsGlassSurface` 沉浸玻璃 + `ButtonType.Capsule` + 右下箭头旋转 −90°，字号 12.5vp（平板 11vp）、最小高度 rpx(56)（平板 32vp）；两个菜单都由原生 `Menu + MenuItem` 承载，行排版共用 `chipMenuRow`（标题 15 + 说明/路径 11.5 + 蓝底白色对勾），因此弹窗样式与模式菜单完全一致
- **切换行为**（`switchNewSessionWorkspace`）：选目标工作区后按 `session-create`（带 `workspaceId` 与当前 Agent 预设）新建一个会话并切过去，与 iOS `AppStore.selectNewConversationWorkspace` 同一套做法。草稿跟着新会话走（先按新会话 id 落盘，`openSession → restoreDraft` 读回），图片/文件附件是本地 URI 原样保留；`@` 文件/文件夹引用属于旧工作区会被清掉（会话引用保留）
- **状态**：切换中胶囊显示「切换中…」并禁用；未连网关时禁用；成功后立即按目标工作区显示并补拉 `workspaces`，失败弹顶部 toast 并保持原状
- **空会话处理**：切换本质是「在新工作区新建一个会话」，原来那个空会话不会出现在任何列表里（见下一节），下一个「新建会话」也只会复用最新的那个空会话

### 空会话（host 的 blank）不占列表、新建会话复用

对齐 dsh 端（iOS `SharedSessionListReducer`）：`sessions` 帧每个会话都带 `blank`，表示「新建之后还没发过消息」。这类会话不算会话列表的一条，也不再每点一次新建就新造一个。

- **数据层**（`native-core/state/SessionStore.ets`）：`SessionSummary` 新增 `blank`；`consumeSessions` 按 `blank` 标记 + 本机 `localSent`（刚发过消息的会话先放行，主机帧翻标记前不会把它藏掉）写入；`appendOptimisticUser` 调 `noteConversationSent` 立即放行并作废「可复用」记忆；冷启动缓存恢复给旧缓存兜底成「有对话」
- **列表过滤**：首页 `visibleSessions()`（工作区筛选 + 剔除空会话，`filtered()` / 最近会话 / 全部会话分区 / 「N 个会话」计数都走它）与会话页侧栏 `convSidebarSessions()` 都不再列出空会话
- **新建会话复用**：`HomePage.createSession` 先查 `SessionStore.reusableBlankSessionId(...)`——上次新建、还没发过消息、仍在列表里的空会话直接打开，不再 `session-create`；建成功后 `rememberBlankSession(id)`，工作区切换新建成功也记这一次。这样「新建 → 返回 → 再新建」始终停在同一张空会话上
- **发消息后**：`localSent` 立即把它放出列表；主机 `blank` 变 false 后，记忆自动作废，下次新建才真正造新会话

## 插件页 / 自动化页

| # | 功能 | 状态 |
| --- | --- | --- |
| 1 | 插件列表 + 开关 | ✅ |
| 2 | 插件详情（组件开关/配置表单） | ⬜ |
| 3 | 自动化任务列表 + 开关 | ✅ |
| 4 | 任务编辑（新建/修改/删除） | ⬜ |
