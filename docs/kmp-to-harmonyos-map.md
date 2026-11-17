# KMP commonMain → HarmonyOS native-core 移植映射

> 生成者：`reference-vendoring`（有界只读分析）。参考源已由 Lead 全量落地，本文件**不写 `.reference/`**。
> 目标：把 `Clarklevis1995/dsh-mobile` 的 `shared/src/commonMain` 全部 73 个 Kotlin 业务模块，逐模块映射到 `harmonyos/native-core` 的建议 ArkTS 目标模块，供团队按模块移植。

## 0. 结论先行

- 参考侧 `.reference/kmp/` 现有 **73 个 `.kt`**（12 个 package），全部已读；来源见 `.reference/MANIFEST.md`：`c9e8e8b1df1c79414c6b4eefa7ad765198866f19`，645 文件 / 13M。
- 现状 `harmonyos/native-core/src/main/ets/` 有 **31 个 `.ets`**（约 11k 行），目录为 `common/ components/ crypto/ network/ protocol/ state/`，`tests/` 8 个 `.test.mjs`。
- 架构差异是根本性的：参考侧以 **Reducer + Projection + Store + Sync + MVI Event（state patch + effect，sequence 严格、fail-closed）** 为唯一业务状态源；现状是 **页面直连 `GatewayClient` + `AppStorage` 投影**，没有 Reducer / Projection / HistorySync / MVI 事件信封 / 分片 patch 这一整层。
- 等价实现分布：**✅ 已有等价 2 项、🟡 部分或路径不同 28 项、⬜ 无 39 项、⏸ 平台独占/暂缓 4 项**。即「补几个页面」不成立，需按阶段增量重写共享层。
- 优先级：**P0 18 项 / P1 19 项 / P2 36 项**（定义见第 2 节）。

## 1. 范围与依据

| 项 | 内容 |
| --- | --- |
| 已读清单 | `.reference/MANIFEST.md`（73 commonMain / 62 commonTest / 79 iOS Swift） |
| 已读源码 | `.reference/kmp/` 下 73 个 `.kt`（提取 package、import、顶层声明与文件头注释） |
| 已读现状 | `harmonyos/native-core/Index.ets` 及 31 个 `.ets`（导出、类/接口、行数） |
| 已读基线 | `harmonyos/NATIVE.md`、`harmonyos/PARITY.md`、`docs/harmonyos-1to1-rewrite-plan.md`、`docs/dsh-mobile-conversion-audit.md`、`docs/harmonyos-parity-matrix.md` |
| 目标工程 | `harmonyos/native-core/`（HAR 静态库，`native-atomic` 与 `native-app` 两壳共用） |
| 不在本表 | iOS Core/Views/Components/Tests 的 79 个 Swift（属平台 effect / ArkUI 视图层，另案映射）、62 个 commonTest（属阶段 6 测试门禁） |

## 2. 图例

**「是否已有等价实现」**

- ✅ **已有等价**：`native-core` 已有同名/同类实现，字段与行为基本对齐，只需交叉核对与补齐。
- 🟡 **部分 / 简化 / 路径不同**：有相关代码，但只覆盖子集、被内联进页面/Store，或与参考不是同一条技术路径，需重写补齐。
- ⬜ **无**：`native-core` 无对应模块，需新建。
- ⏸ **平台独占 / 暂缓**：依赖 iOS/Android 原生后端（tsnet 等），鸿蒙只能等价替换或本期不纳入。

**优先级**（沿用 `docs/dsh-mobile-conversion-audit.md` 定义）

- **P0**：阻止「可信的已连接客户端」发布 —— 协议 1:1、状态层 Reducer/Projection/MVI、history 与流同步、prompt 隔离。
- **P1**：重要可移植能力 —— 平台契约抽象、附件/上传、语音正确路径、轨迹细节、缓存与诊断。
- **P2**：广度与打磨 —— UI 共用格式化助手、Markdown/代码高亮、RTC/Tailscale、预取/淘汰策略。

**目标模块列**

- 所有路径均相对 `harmonyos/native-core/src/main/ets/`；标 🆕 者为**建议新建目录**（`domain/ projection/ sync/ facade/ gateway/ platform/ transport/ cache/ diagnostics/ tailscale/`）。
- `network/GatewayClient.ets` 保留为**平台 WebSocket effect**（对应参考 `platform/` 契约 + iOS `Core/GatewayRtcLink`）；参考 KMP `gateway/` 是**协议运行时状态机**，建议新建 `gateway/` 目录承载，避免与平台 effect 混淆。
- `state/` 现有 `SessionStore.ets / EventProjector.ets / ScheduleStore.ets / PluginStore.ets / CredentialStore.ets / HistoryPageMatcher.ets` 是「🟡 部分」的主要落点；移植后应退化为薄适配层或直接被 `facade/`、`domain/` 取代。

## 3. 建议目标目录

```text
harmonyos/native-core/src/main/ets/
  protocol/    ✅ 现有：GatewayDtos / GatewayFrameCodec / GatewayRequest(s) / PairingPayload / RequestCorrelation
               ＋ GatewayWireDecoder / JsonValue / FailureDetails / ToolImages / ComposerQuoteDraft / Schedule*Editor
  network/     ✅ 现有：GatewayClient（平台 WebSocket effect，保留）
  state/       ✅ 现有：SessionStore / EventProjector / ScheduleStore / PluginStore / CredentialStore / HistoryPageMatcher
  common/      ✅ 现有：Logger / PreferencesStore / NotificationService / Attachment* / VoiceDictation / ThemeManager
  crypto/      ✅ 现有：Sodium / RelaySession / DshCrypto
  components/  ✅ 现有：GlassCard / OceanBackground / ParticleBackground
  domain/      🆕 Approval / Question / SessionControl / SessionList Reducer
  projection/  🆕 Conversation / Trajectory / ToolActivitySummary
  sync/        🆕 HistoryReducer / HistorySyncEngine / AssistantStreamState
  facade/      🆕 30 个 Store 与共用格式化/交互助手（MVI 门面层）
  gateway/     🆕 GatewayRuntime / GatewayProtocol / GatewayProfile / BoundedQueue / SplitTransport
  platform/    🆕 GatewayPlatformContracts（连接契约与平台实现分离）
  transport/   🆕 GatewayTransportPolicy / MgwCodec / RtcUpgradeMachine / RtcSelectedPath / RtcDiagnostics
  cache/       🆕 ChatCache* / SharedChatHistoryCache（Room → relationalStore/RDB + fileIo）
  diagnostics/ 🆕 NetworkDiagnosticsStore
  tailscale/   ⏸ 平台独占，暂缓
tests/         ✅ 现有 8 个 .test.mjs；阶段 6 承接 62 个 commonTest 的行为
```

## 4. 逐模块映射表（73 个文件，全量）

### 4.1 `shared/` — 根包 / 模块元信息（1）

| 参考文件（相对 `.reference/kmp/`） | 建议 native-core 目标 ArkTS 模块 | 是否已有等价实现 | 优先级 |
| --- | --- | --- | :---: |
| `SharedModuleInfo.kt` | `common/SharedModuleInfo.ets` | 🟡 部分：BuildProfile.ets 有版本常量，无 sourceSets/summary 模块元信息 | P2 |

### 4.2 `protocol/` — 协议层 DTO 与 wire 解码（9）

| 参考文件（相对 `.reference/kmp/`） | 建议 native-core 目标 ArkTS 模块 | 是否已有等价实现 | 优先级 |
| --- | --- | --- | :---: |
| `protocol/GatewayDtos.kt` | `protocol/GatewayDtos.ets` | ✅ 已有等价：同名文件（12 KB，含 GatewayTask / Goal / SlashCommand / PairingPayload / Question / Approval 等 DTO） | P0 |
| `protocol/GatewayWireDecoder.kt` | `protocol/GatewayWireDecoder.ets` | 🟡 部分：protocol/GatewayFrameCodec.ets 的 decodeFrame 仅对 kind fail-closed，缺 schema metadata / failureSummary / 缺失字段报告 / presets 归一化 | P0 |
| `protocol/JsonValue.kt` | `🆕 protocol/JsonValue.ets` | ⬜ 无：ArkTS 侧用 Object / Record<string, Object> 临时承载，无统一密封类型与序列化器 | P0 |
| `protocol/FailureDetails.kt` | `🆕 protocol/FailureDetails.ets` | ⬜ 无 | P1 |
| `protocol/ToolImages.kt` | `protocol/ToolImages.ets` | 🟡 部分：GatewayFrameCodec.ets 有 imageBlocks 归一化，缺持久附件引用白名单与容错策略 | P1 |
| `protocol/ComposerQuoteDraft.kt` | `🆕 protocol/ComposerQuoteDraft.ets` | ⬜ 无：输入框引用按 UTF-16 偏移插入的草稿模型缺失 | P2 |
| `protocol/ScheduleTargetEditor.kt` | `🆕 protocol/ScheduleTargetEditor.ets` | ⬜ 无：state/ScheduleStore.ets 仅任务列表与开关，无 target 草稿/校验 | P2 |
| `protocol/ScheduleTimingEditor.kt` | `🆕 protocol/ScheduleTimingEditor.ets` | ⬜ 无：无 RRULE / IANA 墙上时间规则草稿解析 | P2 |
| `protocol/ScheduleTaskPresentation.kt` | `protocol/ScheduleTaskPresentation.ets` | 🟡 部分：ScheduleStore.ScheduleTask 有 id/title/status，缺 statusSource / canEdit 语义 | P2 |

### 4.3 `gateway/` — 网关运行时（5）

| 参考文件（相对 `.reference/kmp/`） | 建议 native-core 目标 ArkTS 模块 | 是否已有等价实现 | 优先级 |
| --- | --- | --- | :---: |
| `gateway/GatewayRuntime.kt` | `🆕 gateway/GatewayRuntime.ets` | 🟡 部分：network/GatewayClient.ets（1006 行）有连接状态机/重连/请求关联，但缺 RuntimeEvent 单消费者队列、能力协商、keepAlive 决策、分片与 lane 调度 | P0 |
| `gateway/GatewayProtocol.kt` | `gateway/GatewayProtocol.ets` | ✅ 已有等价（分散）：protocol/GatewayRequest.ets（LanePolicy/Request/Lanes/Factory）、protocol/GatewayRequests.ets、protocol/PairingPayload.ets、protocol/RequestCorrelation.ets；缺统一 Requests 构造表与 pairing 异常类型 | P0 |
| `gateway/GatewayProfile.kt` | `gateway/GatewayProfile.ets` | 🟡 部分：GatewayClient.ets 有 GatewayProfile 接口、state/CredentialStore.ets 有 SavedGateway；缺 GatewayIdentity / endpoint 校验 / isLocalIpv4 | P0 |
| `gateway/BoundedGatewayRuntimeEventQueue.kt` | `🆕 gateway/BoundedGatewayRuntimeEventQueue.ets` | ⬜ 无：Runtime → 平台投影无有界队列，帧直达 SessionStore | P1 |
| `gateway/SplitGatewayTransport.kt` | `🆕 gateway/SplitGatewayTransport.ets` | ⬜ 无：当前仅单 WebSocket 连接（控制/对话未分离） | P2 |

### 4.4 `platform/` — 平台契约（1）

| 参考文件（相对 `.reference/kmp/`） | 建议 native-core 目标 ArkTS 模块 | 是否已有等价实现 | 优先级 |
| --- | --- | --- | :---: |
| `platform/GatewayPlatformContracts.kt` | `🆕 platform/GatewayPlatformContracts.ets` | 🟡 部分：network/GatewayClient.ets 内联了 WebSocket 连接参数与凭据头，无独立平台契约接口（ConnectionSpec / TransportState / TransportEvent 未抽象） | P1 |

### 4.5 `transport/` — 传输 / RTC 升级（5）

| 参考文件（相对 `.reference/kmp/`） | 建议 native-core 目标 ArkTS 模块 | 是否已有等价实现 | 优先级 |
| --- | --- | --- | :---: |
| `transport/GatewayTransportPolicy.kt` | `🆕 transport/GatewayTransportPolicy.ets` | ⬜ 无：无「内网直连 / 外网才尝试 RTC」的入口判定 | P2 |
| `transport/MgwCodec.kt` | `🆕 transport/MgwCodec.ets` | ⬜ 无：crypto/RelaySession.ets 是中继封包另一条路径，无 MGW 分片/序号/字节预算编解码 | P2 |
| `transport/RtcUpgradeMachine.kt` | `🆕 transport/RtcUpgradeMachine.ets` | ⬜ 无：无 RTC 升级状态机（nonce / phase / mode / tickets / 帧预算） | P2 |
| `transport/RtcSelectedPath.kt` | `🆕 transport/RtcSelectedPath.ets` | ⬜ 无：无选中候选对与本地/远端类型检查 | P2 |
| `transport/RtcDiagnostics.kt` | `🆕 transport/RtcDiagnostics.ets` | ⬜ 无：无脱敏固定元数据的 RTC 诊断事件 | P2 |

### 4.6 `domain/` — 领域 Reducer（4）

| 参考文件（相对 `.reference/kmp/`） | 建议 native-core 目标 ArkTS 模块 | 是否已有等价实现 | 优先级 |
| --- | --- | --- | :---: |
| `domain/ApprovalReducer.kt` | `🆕 domain/ApprovalReducer.ets` | 🟡 部分：SessionPage / SessionStore 内联处理 approval-response，无 Idle/Submitting/Accepted/Rejected 状态机与 rpcId 绑定 | P0 |
| `domain/QuestionReducer.kt` | `🆕 domain/QuestionReducer.ets` | 🟡 部分：同上，question-answer / question-cancel 无 reducer、无并发 prompt 隔离 | P0 |
| `domain/SessionListReducer.kt` | `🆕 domain/SessionListReducer.ets` | 🟡 部分：SessionStore.applySessions 解析 sessions 帧直写 AppStorage.sessions；无归档 / 标题序列 / blank 标记 / unread 归约 | P0 |
| `domain/SessionControlReducer.kt` | `🆕 domain/SessionControlReducer.ets` | 🟡 部分：SessionStore 直写 defaultAgentPreset / defaultModel / defaultPermission / agentPresetList / modelList / permissionList 到 AppStorage；无请求目标与 loading/超时状态机 | P1 |

### 4.7 `projection/` — 投影层（3）

| 参考文件（相对 `.reference/kmp/`） | 建议 native-core 目标 ArkTS 模块 | 是否已有等价实现 | 优先级 |
| --- | --- | --- | :---: |
| `projection/ConversationProjection.kt` | `🆕 projection/ConversationProjection.ets` | 🟡 部分：SessionStore 把 history.events 与流式事件聚合成 SessionRow[] 写 AppStorage.sessionRows；无 ConversationItemKind 全集、ProjectionOperation 增量 patch、ConversationHistoryRebase | P0 |
| `projection/TrajectoryProjection.kt` | `🆕 projection/TrajectoryProjection.ets` | 🟡 部分：state/EventProjector.ets 仅 turn → step → tool；无 RequestTokenUsage / cumulativeUsage / args / results / schema / error / timing | P1 |
| `projection/ToolActivitySummary.kt` | `🆕 projection/ToolActivitySummary.ets` | ⬜ 无：工具摘要格式化共用逻辑缺失 | P2 |

### 4.8 `sync/` — 同步层（3）

| 参考文件（相对 `.reference/kmp/`） | 建议 native-core 目标 ArkTS 模块 | 是否已有等价实现 | 优先级 |
| --- | --- | --- | :---: |
| `sync/HistoryReducer.kt` | `🆕 sync/HistoryReducer.ets` | 🟡 部分：SessionStore.mergeHistoryEvents + state/HistoryPageMatcher.ets（isOlderHistoryPage）覆盖序列合并与旧页判定；无 reducer 状态机 / 分页预算 / 批量 / 超时 / 失败码 | P0 |
| `sync/AssistantStreamState.kt` | `🆕 sync/AssistantStreamState.ets` | ⬜ 无：无流代际、重订阅、chunk 提交/回滚、退休订阅 | P0 |
| `sync/HistorySyncEngine.kt` | `🆕 sync/HistorySyncEngine.ets` | ⬜ 无：GatewayClient.connectionGeneration 是连接代际，非 history 请求代际与超时协调器 | P1 |

### 4.9 `facade/` — 门面 Store 与共用助手（30）

| 参考文件（相对 `.reference/kmp/`） | 建议 native-core 目标 ArkTS 模块 | 是否已有等价实现 | 优先级 |
| --- | --- | --- | :---: |
| `facade/SharedMviEvents.kt` | `🆕 facade/SharedMviEvents.ets` | ⬜ 无：无 MVI 事件信封（sequence / transactionId / statePayloadJson / effectsJson）与订阅/派发结果，架构根本差异 | P0 |
| `facade/SharedMobileStore.kt` | `🆕 facade/SharedMobileStore.ets` | ⬜ 无：无统一门面快照，页面直连 GatewayClient + AppStorage 投影 | P0 |
| `facade/SharedConversationStore.kt` | `🆕 facade/SharedConversationStore.ets` | 🟡 部分：SessionStore 聚合会话行；无 per-session ConversationProjector、patch / replacesAll / lastSequence、历史准备 | P0 |
| `facade/SharedHistoryStore.kt` | `🆕 facade/SharedHistoryStore.ets` | 🟡 部分：SessionStore 有 historyFormatVersion / hasMore / oldestSeq / rawEvents；无 Bootstrap / EventPatch / Reference / Effect 与缓存联动 | P0 |
| `facade/SharedApprovalStore.kt` | `🆕 facade/SharedApprovalStore.ets` | 🟡 部分：SessionPage 内联 approval 提交与回执；无快照 / effect / errorCode 边界 | P0 |
| `facade/SharedQuestionStore.kt` | `🆕 facade/SharedQuestionStore.ets` | 🟡 部分：SessionPage 内联 question 提交与回执；无快照 / effect / 提交状态 | P0 |
| `facade/CachedHistoryWindow.kt` | `🆕 facade/CachedHistoryWindow.ets` | 🟡 部分：SessionStore 有 historyFormatVersion / hasMore / oldestSeq；无版本化正文缓存与 validate() | P1 |
| `facade/ConversationHistoryPatch.kt` | `🆕 facade/ConversationHistoryPatch.ets` | ⬜ 无：历史重校验后「只传变化行」与次序改变回退原子替换的 patch 算法缺失 | P1 |
| `facade/SharedQueueStore.kt` | `🆕 facade/SharedQueueStore.ets` | 🟡 部分：SessionStore.queueItems / queueCount + GatewayClient.requestQueue / queueUpdate；无 pending / draft / beginAction 事务边界 | P1 |
| `facade/SharedSessionListStore.kt` | `🆕 facade/SharedSessionListStore.ets` | 🟡 部分：SessionStore.applySessions 直写 AppStorage；无快照 / result / reducer 边界 | P1 |
| `facade/SharedSessionControlStore.kt` | `🆕 facade/SharedSessionControlStore.ets` | ⬜ 无：无 SessionControl effect「应且仅应执行一次」的 requestToken 语义 | P1 |
| `facade/SharedSessionAgentPresetStore.kt` | `🆕 facade/SharedSessionAgentPresetStore.ets` | 🟡 部分：SessionStore 有 agentPresetList / agentPresetDefault；无 per-Gateway 独立状态与 loading/saving/submitting | P1 |
| `facade/SharedTrajectoryStore.kt` | `🆕 facade/SharedTrajectoryStore.ets` | 🟡 部分：state/EventProjector.ets；无节点级高频 patch（subtitle / records 增量） | P1 |
| `facade/SharedFileUploadStore.kt` | `🆕 facade/SharedFileUploadStore.ets` | 🟡 部分：common/AttachmentTransfer.ets（uploadAttachment 分块 + sha256 + generation）；无 draft / confirmedBytes / receiptId / abandonedOpens 状态机 | P1 |
| `facade/SharedWorkspaceFileStore.kt` | `🆕 facade/SharedWorkspaceFileStore.ets` | 🟡 部分：common/AttachmentTransfer.ets（downloadAttachment）+ SessionStore.dirEntries；无目录树 / 下载校验 / 缓存查询状态机 | P1 |
| `facade/SharedVoiceInputStore.kt` | `🆕 facade/SharedVoiceInputStore.ets` | 🟡 部分但路径不同：common/VoiceDictation.ets 用本地 CoreSpeechKit 离线听写；参考为「音频发到主机官方 speech-input-v1 插件转写」，且有 phase / waveform / cancelArmed / pendingTranscript 状态机 | P1 |
| `facade/VoiceInputProtocol.kt` | `🆕 facade/VoiceInputProtocol.ets` | ⬜ 无：PCM 预处理 / WAV 边界 / VoiceCatalogState 协议缺失；是切换主机插件转写路径的前置 | P1 |
| `facade/CodeSyntaxHighlighting.kt` | `🆕 facade/CodeSyntaxHighlighting.ets` | ⬜ 无：聊天代码块高亮（UTF-16 偏移 + 语言别名 + 调色板）缺失 | P2 |
| `facade/ConversationFileReferences.kt` | `🆕 facade/ConversationFileReferences.ets` | ⬜ 无：Markdown AST 交付文件链接解析缺失 | P2 |
| `facade/FileCardDescription.kt` | `🆕 facade/FileCardDescription.ets` | ⬜ 无：文件卡简介清理缺失 | P2 |
| `facade/FileIconCatalog.kt` | `🆕 facade/FileIconCatalog.ets` | ⬜ 无：扩展名 / MIME → 图标映射缺失 | P2 |
| `facade/FileIconKind.kt` | `🆕 facade/FileIconKind.ets` | ⬜ 无：文件类型配色与色值表缺失（依赖 Design 资源生成） | P2 |
| `facade/MarkdownSelectionHtml.kt` | `🆕 facade/MarkdownSelectionHtml.ets` | ⬜ 无：选择页共用排版缺失 | P2 |
| `facade/MarkdownTableExport.kt` | `🆕 facade/MarkdownTableExport.ets` | ⬜ 无：表格 plainText / csv 导出共用单元格矩阵缺失 | P2 |
| `facade/WorkspaceCodePreviewSupport.kt` | `🆕 facade/WorkspaceCodePreviewSupport.ets` | ⬜ 无：代码预览分词 / 缩进归一化 / 语言判定缺失 | P2 |
| `facade/VoiceInputInteraction.kt` | `🆕 facade/VoiceInputInteraction.ets` | ⬜ 无：按住说话 / 上滑取消两端共用交互参数缺失 | P2 |
| `facade/SharedOfflineCatalogCodec.kt` | `🆕 facade/SharedOfflineCatalogCodec.ets` | ⬜ 无：离线导航目录（sessionList / workspaces / targets / avatars）编解码缺失 | P2 |
| `facade/SharedSlashCommandStore.kt` | `🆕 facade/SharedSlashCommandStore.ets` | 🟡 部分：protocol/GatewayDtos.ets 有 SlashCommand DTO 与 slashCommandStableId；无 selection / execution / transition store | P2 |
| `facade/SharedTeamStore.kt` | `🆕 facade/SharedTeamStore.ets` | ⬜ 无：团队 / 成员 / 任务 / 头像投影存储缺失 | P2 |
| `facade/SharedTurnTimingStore.kt` | `🆕 facade/SharedTurnTimingStore.ets` | ⬜ 无：轮次边界与计时快照缺失 | P2 |

### 4.10 `cache/` — 聊天缓存（7）

| 参考文件（相对 `.reference/kmp/`） | 建议 native-core 目标 ArkTS 模块 | 是否已有等价实现 | 优先级 |
| --- | --- | --- | :---: |
| `cache/SharedChatHistoryCache.kt` | `🆕 cache/SharedChatHistoryCache.ets` | 🟡 部分：common/AttachmentCache.ets 是附件缓存、SessionStore.rawEvents 仅内存；无会话历史磁盘缓存 / 搜索 / 统计 / 写入准入 | P1 |
| `cache/ChatCacheDatabase.kt` | `🆕 cache/ChatCacheDatabase.ets` | ⬜ 无：无 Room/SQLite 等价（鸿蒙需用 relationalStore / RDB 重写实体与 DAO） | P2 |
| `cache/ChatCacheDiagnostics.kt` | `🆕 cache/ChatCacheDiagnostics.ets` | ⬜ 无：脱敏缓存恢复诊断日志缺失 | P2 |
| `cache/ChatCacheMemoryEstimator.kt` | `🆕 cache/ChatCacheMemoryEstimator.ets` | ⬜ 无：保守内存估算（原始事件 3 份 / 投影 2 份）缺失 | P2 |
| `cache/ChatCacheWindowPolicy.kt` | `🆕 cache/ChatCacheWindowPolicy.ets` | ⬜ 无：两端统一窗口预算与裁旧事件策略缺失 | P2 |
| `cache/ChatMemoryCache.kt` | `🆕 cache/ChatMemoryCache.ets` | ⬜ 无：LRU 内存缓存 + 搜索 gram 索引缺失 | P2 |
| `cache/ChatPrefetchPolicy.kt` | `🆕 cache/ChatPrefetchPolicy.ets` | ⬜ 无：会话预取热度排序缺失 | P2 |

### 4.11 `diagnostics/` — 网络诊断（1）

| 参考文件（相对 `.reference/kmp/`） | 建议 native-core 目标 ArkTS 模块 | 是否已有等价实现 | 优先级 |
| --- | --- | --- | :---: |
| `diagnostics/NetworkDiagnosticsStore.kt` | `🆕 diagnostics/NetworkDiagnosticsStore.ets` | ⬜ 无：RTT / jitter / loss / 吞吐采样与 p95 快照缺失 | P2 |

### 4.12 `tailscale/` — Tailscale 隧道（4）

| 参考文件（相对 `.reference/kmp/`） | 建议 native-core 目标 ArkTS 模块 | 是否已有等价实现 | 优先级 |
| --- | --- | --- | :---: |
| `tailscale/TailscaleAccountCatalog.kt` | `⏸ tailscale/TailscaleAccountCatalog.ets` | ⏸ 平台独占/暂缓：HarmonyOS 无 tsnet 等价；凭证目录与账号模型需按 AssetStoreKit / VPN 能力重设计 | P2 |
| `tailscale/TailscalePolicy.kt` | `⏸ tailscale/TailscalePolicy.ets` | ⏸ 平台独占/暂缓：Tailscale status JSON → stage / authUrl / peerCount 解析依赖原生后端 | P2 |
| `tailscale/TailscaleSessionFacade.kt` | `⏸ tailscale/TailscaleSessionFacade.ets` | ⏸ 平台独占/暂缓：NativeNode / 恢复节点接口无鸿蒙对应 | P2 |
| `tailscale/TailscaleSessionManager.kt` | `⏸ tailscale/TailscaleSessionManager.ets` | ⏸ 平台独占/暂缓：多账号会话与登录 URL 协调无鸿蒙对应 | P2 |

## 5. 优先级汇总

| 优先级 | 数量 | 主要模块 | 建议批次 |
| --- | ---: | --- | --- |
| P0 | 18 | protocol（DTO/解码/JsonValue）、gateway（Runtime/Protocol/Profile）、domain（4 Reducer）、projection（Conversation）、sync（History/Stream）、facade（MVI/Mobile/Conversation/History/Approval/Question） | 阶段 1–2（协议 1:1 + 状态层 1:1） |
| P1 | 19 | platform 契约、BoundedQueue、FailureDetails/ToolImages、SessionControl、Trajectory、缓存主体、附件/上传/语音 store 与协议 | 阶段 3（平台 effect）+ 阶段 5 前半 |
| P2 | 36 | facade 格式化助手、Schedule 编辑器、cache 细项、transport/RTC、tailscale、diagnostics | 阶段 4（ArkUI 视图）+ 阶段 5 后半 |

## 6. 建议移植顺序

沿用 `docs/harmonyos-1to1-rewrite-plan.md` 的阶段划分，收敛为可验收的 6 批：

1. **协议层 1:1（P0）**：`protocol/GatewayDtos.ets` 与 `GatewayFrameCodec.ets` 交叉核对 `GatewayDtos.kt`；新建 `JsonValue.ets`、`GatewayWireDecoder.ets`（schema metadata + fail-closed 报告）、`FailureDetails.ets`。与 `miniprogram/utils/protocol.js` 三方比对。
2. **状态层 1:1（P0）**：先 `SharedMviEvents.ets`（事件信封 / sequence / effects），再 `domain/` 4 Reducer、`projection/ConversationProjection.ets`、`sync/HistoryReducer.ets` + `AssistantStreamState.ets`，最后 `facade/` 的 Mobile / Conversation / History / Approval / Question Store。页面撤离业务状态，只订阅快照。
3. **平台 effect 层（P0/P1）**：把 `network/GatewayClient.ets` 收敛为 `platform/GatewayPlatformContracts.ets` 的实现；新建 `gateway/GatewayRuntime.ets` 与 `BoundedGatewayRuntimeEventQueue.ets`，补齐能力协商、strict sequence、丢序/unknown schema fail-closed。
4. **附件/语音/会话控制（P1）**：`SharedFileUploadStore` / `SharedWorkspaceFileStore` 复用并扩展 `AttachmentTransfer.ets`；语音按 `VoiceInputProtocol.ets` + `SharedVoiceInputStore.ets` 切到主机 `speech-input-v1` 插件转写路径（现状本地 CoreSpeechKit 是不同路径，需显式决策）。
5. **缓存 / 诊断 / RTC / Tailscale（P1/P2）**：`cache/` 用 `relationalStore` 重写 Room 实体与 DAO；`transport/` 与 `tailscale/` 依赖平台 RTC/VPN 能力，按可用性排期。
6. **ArkUI 视图 + 测试门禁（P2→全阶段）**：facade 格式化助手配合 `native-atomic` / `native-app` 页面；把 62 个 commonTest 的行为翻成 `native-core/tests/*.test.mjs`（现有 8 个文件），每批附编译 + 测试 + 真机/真网关证据。

## 7. 关键差异与风险（移植前必须确认）

- **fail-closed 边界不同**：`GatewayWireDecoder.kt` 报告缺失字段/schema 元数据且不复制正文与凭据；`GatewayFrameCodec.ets` 目前仅对 `kind` 缺失或非 string 抛错，未知 schema 未阻断。这是 P0 验收项。
- **sequence 与分片 patch**：参考以 `SharedMviEvent.sequence` + `transactionId` + `ConversationProjectionOperation` 增量 patch 驱动 UI；现状 `SessionStore` 直接 `AppStorage.setOrCreate` 全量覆盖，高频流下会丢序/重排。
- **history 代际**：`HistorySyncEngine.kt` 是平台无关的请求代际 + 超时协调器；`GatewayClient.connectionGeneration` 是连接代际，二者不可互相替代。
- **语音路径分歧**：`VoiceInputProtocol.kt` 明确「客户端不打包 ASR 模型，识别由官方主机插件处理」；`common/VoiceDictation.ets` 用 `@kit.CoreSpeechKit` 本地离线听写。是否切换需用户/Lead 决策（见 rewrite plan 第 8 节问题 4）。
- **Room → 鸿蒙持久化**：`ChatCacheDatabase.kt` 依赖 androidx.room / bundled SQLite；鸿蒙需用 `@ohos.data.relationalStore` 重写实体、DAO、索引与 gram 搜索表，不能直译。
- **Tailscale 平台独占**：4 个文件依赖 `tsnetgo` 原生节点与 Keychain 状态目录，鸿蒙无直接对应；标 ⏸，需 VPN/AssetStoreKit 等价方案或明确不纳入。
- **凭据与日志脱敏**：`GatewayPlatformContracts.kt` 与 `RtcDiagnostics.kt` 要求凭据只传 transport、诊断仅固定元数据；现有 `CredentialStore` 落 Preferences、日志需复核是否泄露地址/token。
- **外部依赖**：真机/真网关 E2E、DevEco API 26 签名、官方 speech 插件与 RTC 网关能力，均不能靠写代码补齐；P0/P1 验收需显式证据。

## 8. 本文件约束

- ✅ 本文件是本次唯一写入：`docs/kmp-to-harmonyos-map.md`。
- ✅ `.reference/` 全程只读（仅读取 `MANIFEST.md` 与 73 个 `.kt`），未 curl、未下载、未覆盖、未重复落地。
- ✅ 未改产品代码、未改 docs 下其它文件、未改构建文件、未改 `.reference/`、未认领或改动 task 板。
- ✅ 所有「已有等价」判断基于 `harmonyos/native-core/Index.ets` 与 31 个 `.ets` 的实际导出/声明，以及 `SessionStore.ets` / `GatewayClient.ets` / `GatewayFrameCodec.ets` / `VoiceDictation.ets` 的源码核对；非推测。
