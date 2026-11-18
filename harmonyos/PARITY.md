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

## 插件页 / 自动化页

| # | 功能 | 状态 |
| --- | --- | --- |
| 1 | 插件列表 + 开关 | ✅ |
| 2 | 插件详情（组件开关/配置表单） | ⬜ |
| 3 | 自动化任务列表 + 开关 | ✅ |
| 4 | 任务编辑（新建/修改/删除） | ⬜ |
