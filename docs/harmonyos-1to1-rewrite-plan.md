# 为什么鸿蒙版与 dsh-mobile 差距大，以及"一比一复刻"的真实含义

## 1. 结论先行

**可以做到行为/协议/交互一比一，但不能做到源码一比一，也不能"照着抄一遍"就完成。**
更重要的：此前实现方向确实偏了——它主要照着**当前小程序 + 早期审查文档**做，而不是把 `dsh-mobile` 的 KMP 共享业务层当作唯一状态源逐模块移植。这是差距大的根本原因。

## 2. 已核实的真实规模（2026-11-06，仓库 HEAD c9e8e8b）

来源：GitHub API 完整 tree，1958 个 blob，未截断。

| 指标 | dsh-mobile 参考 | 当前 harmonyos/native-app + native-core |
| --- | --- | --- |
| 总文件 | 1958 | 45 个 .ets |
| 业务源 | 404 个 Kotlin + 213 个 Swift + 143 个 shared 文件 | 45 个 ArkTS |
| 业务代码量 | Kotlin 约 4.2 MB、Swift 约 3.6 MB | 约 11,327 行 ArkTS |
| KMP `shared/commonMain` | **73 个业务模块** | 无对应分层 |
| iOS Core | 37 个平台服务 | 无对应分层 |
| iOS 视图/组件 | 22 个 | 11 个页面 |
| 资源 | 512 个 iOS 资源、487 个 SVG | 少量 |
| 测试 | 62 个 commonTest + 17 个 XCTest + 2 个 UITest | 33 个 Node VM mock 测试 |

架构文档明确：KMP `shared` 是**唯一业务状态源**，Swift/Compose 只做平台 effect 与可重建 UI 镜像；Event 带 state patch + effect，Adapter 在丢序/unknown schema 时必须 fail-closed。当前鸿蒙实现是"页面直连 GatewayClient + AppStorage 投影"，**没有 Reducer / Projection / HistorySync / MVI Event / 分片 patch 这一整层**。

## 3. 73 个共享业务模块 = 当前真正缺的东西

按目录分组（每个都需要在 native-core 有等价实现）：

- `facade/` 25 个 Store：Conversation / History / Trajectory / Question / Approval / Queue / SessionList / SessionControl / SessionAgentPreset / SlashCommand / Team / TurnTiming / VoiceInput / WorkspaceFile / FileUpload / Mobile 门面、离线目录编解码、MVI Event。
- `domain/` 4 个 Reducer：Approval / Question / SessionControl / SessionList。
- `projection/` 3 个：Conversation / Trajectory / ToolActivitySummary。
- `sync/` 3 个：HistoryReducer / HistorySyncEngine / AssistantStreamState。
- `protocol/` 12 个：GatewayDtos / WireDecoder / JsonValue / FailureDetails / ComposerQuoteDraft / ScheduleTaskPresentation / ScheduleTarget+TimingEditor / ToolImages。
- `gateway/` 5 个：GatewayRuntime / GatewayProtocol / GatewayProfile / BoundedEventQueue / SplitGatewayTransport。
- `transport/` 6 个：GatewayTransportPolicy / MgwCodec / RtcUpgradeMachine / RtcSelectedPath / RtcDiagnostics（RTC/WebRTC 升级状态机）。
- `cache/` 7 个：ChatCacheDatabase / WindowPolicy / MemoryEstimator / Diagnostics / ChatMemoryCache / ChatPrefetchPolicy / SharedChatHistoryCache。
- `tailscale/` 4 个：AccountCatalog / Policy / SessionFacade / SessionManager。
- `facade` 还含：CodeSyntaxHighlighting / MarkdownSelectionHtml / MarkdownTableExport / FileCardDescription / FileIconCatalog / FileIconKind / ConversationFileReferences / ConversationHistoryPatch / WorkspaceCodePreviewSupport / VoiceInputProtocol / VoiceInputInteraction。

这不是"补几个页面"，而是**把 KMP 共享层用 ArkTS 重写一遍**，再让 ArkUI 只做渲染。

## 4. iOS 平台侧还缺的能力（37 个 Core 服务中可见）

从仓库清单确认存在、当前鸿蒙无等价或只有简化版：
- AgentBackgroundExecutionController / AgentBackgroundKeepAliveManager（后台持续执行）
- AgentUserNotificationManager / LiveActivity（灵动岛、Live Activity 等价）
- ChatSessionPrefetcher / WorkspacePreviewCache（会话预取、预览缓存）
- CodeSyntaxHighlighter（代码高亮）
- Markdown 渲染与数学公式、表格导出
- ConversationViewport（display-link/FIFO 批量高频刷新）
- GatewaySwitcherView、ConversationSidebar、LogExportView、DocumentPageChrome
- 语音：按住说话、上滑取消、真实音量粒子遮罩、官方 speech 插件 `speech-input-v1` 协议（当前鸿蒙用的是**本地 CoreSpeechKit 离线听写**，与参考"音频发到主机官方插件转写"根本不是同一条路径）
- 资源：512 项 iOS 资源、头像、SVG 图标、动画背景 Metal shader

## 5. "一比一"按什么粒度定义

| 目标 | 能否做到 | 说明 |
| --- | --- | --- |
| 源码逐行一致 | **不可能** | Swift/Kotlin → ArkTS，UIKit/SwiftUI/Compose → ArkUI，平台 API 全不同 |
| 像素级 UI | **高成本、需设计稿 + 真机逐屏校准** | 有 512 资源与 Design/Docs 设计资产，但需人工对齐 |
| 协议/状态机 1:1 | **可以，且是必须先做的** | 73 个 shared 模块 → ArkTS 等价；Gateway wire 不变 |
| 功能/交互 1:1 | **可以，分阶段** | 按模块 + 测试门禁逐项验收 |
| 平台独占能力 1:1 | **只能等价替换** | Live Activity→鸿蒙通知/卡片、Keychain→AssetStoreKit、AVAudioEngine→AudioCapturer、URLSessionWebSocket→webSocket |

## 6. 如果要真正重写，建议的执行顺序

阶段 0：把完整参考源码落地到工作区（当前仅 33 MB 压缩包，尾部损坏，已能读 ARCHITECTURE.md 与部分 iOS/Core 源码）。
阶段 1：**协议层 1:1**：照 `shared/protocol` + `GatewayWireDecoder` 重写 GatewayDtos、帧解码、错误结构；与 `miniprogram/utils/protocol.js` 交叉验证。
阶段 2：**状态层 1:1**：照 `domain` reducers + `projection` + `sync` + `facade` Stores 重写 native-core 的 Store/Reducer/Event 层，引入严格 sequence 与 fail-closed，页面不再持有业务状态。
阶段 3：**平台 effect 层**：GatewayClient 拆分 transport/effect；AssetStore、fileIo、通知、音频采集只做 effect 执行。
阶段 4：**ArkUI 视图 1:1**：按 iOS Views/Components 逐个建 ArkUI 组件（会话时间线、Markdown/代码高亮、轨迹、侧边栏、文件卡、语音遮罩、自适应布局）。
阶段 5：**缓存/预取/诊断/RTC/Tailscale**：照 cache / transport / tailscale 模块补齐。
阶段 6：**测试门禁**：把 62 个 commonTest + 17 个 XCTest 的**行为**翻成 ArkTS/Node 测试；再上真机 + 真网关 E2E。

## 7. 现实约束（必须说清）

- 这是一套**双平台成熟产品**（约 8 MB 纯业务源码 + 大量资源 + 完整测试），此前 24 轮目标里我们做的是"可用子集 + 协议加固 + 模拟器冒烟"，不是全量移植。
- "完全照着写一遍"需要多轮、按模块提交、每阶段编译 + 测试 + 截图/网关证据，不是一次回答能交付。
- 缺少：真机/真网关 E2E、签名配置、设计稿逐屏校准、官方 speech 插件与 RTC 网关能力，这些是外部依赖，不能靠写代码凭空补齐。
- 当前工作区已有 11,327 行可用 ArkTS 与 33 项测试、可安装启动的 HAP；**全量重写应基于它增量替换状态层，不必全部推倒**。

## 8. 下一步需要用户确认

1. 是否批准按上述阶段 0–6 **分多轮执行全量重写**（每轮交付可编译 + 可测试增量）？
2. "一比一"验收以什么为准：**协议/功能/交互**（可达成）还是**像素级视觉**（需额外设计资源与真机校准）？
3. 是否提供可达的 `dsh-plugin-mobile-gateway` 与有效二维码/凭据，用于每阶段的真实网关验收？
4. 语音路径是否改为参考的 **speech-input-v1 主机插件转写**（放弃本地 CoreSpeechKit）？
