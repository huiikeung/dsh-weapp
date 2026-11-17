# dsh-mobile → HarmonyOS 1:1 重写进度

用户确认（2026-11-06）：**分阶段全量重写**；验收以**协议/功能/交互 1:1**为准；用户可提供可达网关/二维码。

## 基线

- 参考源码：`dsh-mobile @ c9e8e8b`，完整 84 MB tarball 已下载并 gzip 校验。
- 工作区持久基线：[`.reference/`](../.reference/MANIFEST.md)，645 文件 / 13 MB：73 个 KMP commonMain、62 个 commonTest、79 个 iOS Swift、架构文档与 README。
- 规模对比：参考 1958 文件（404 Kotlin + 213 Swift + 143 shared）；当前产品 45 个 .ets / 11,327 行。
- 逐模块映射：[docs/kmp-to-harmonyos-map.md](kmp-to-harmonyos-map.md)：73 项，✅2 / 🟡28 / ⬜39 / ⏸4；P0 18、P1 19、P2 36。
- 蓝图：[docs/harmonyos-1to1-rewrite-plan.md](harmonyos-1to1-rewrite-plan.md)。

## 任务板

| 任务 | 阶段 | 状态 | 负责人 |
| --- | --- | --- | --- |
| task-11 | 1A GatewayRequest metadata/lane + ping 接线 | **completed** | gateway-core |
| task-17 | 1B P0 KMP 请求工厂（37 static） | **completed** | gateway-core |
| task-18 | 1C runtime 接线两批（ping/file-open/fileList lane） | **completed** | gateway-core |
| task-19 | 1D 剩余 KMP 请求工厂 | **completed** | gateway-core |
| task-12 | 2 Reducer + MVI Event / fail-closed | **completed** | conversation-parity |
| task-13 | 3A HistorySync + Projection 基线 | **completed** | conversation-parity |
| task-21 | 3B 逐字段对齐基线 | **completed** | lead |
| task-22 | 4B 其余 facade Store 基线 | **completed** | lead |
| task-14 | 4A P0 facade Store 基线（Lead 接管） | **completed** | lead |
| task-22 | 4B 其余 ~10 个 Store + 逐字段扩展 | pending | — |
| task-20 | 1E runtime lane 基线 | **completed** | gateway-core |
| task-14 | 4 facade Stores | pending（依赖 13） | — |
| task-15 | 5 ArkUI 组件基线 | **completed** | lead |
| task-16 | 6 cache/RTC/Tailscale/diagnostics | **completed** | lead |

## 已验证的代码增量

- `protocol/GatewayRequest.ets`：GatewayRequest metadata（requestType/responseKind/targetSessionId/correlationId/lanePolicy/timeoutMilliseconds/payload/isBackgroundHistory）、GatewayRequestLanes（COALESCE_LATEST / FIFO / REJECT_IF_BUSY）、GatewayRequestFactory 首批工厂。
- `network/GatewayClient.ets` 的 `ping()` 已使用新 lane；pong / 失败后释放。
- `protocol/PairingPayload.ets`：publicUrl 必填、gatewayId UUID、候选端点类型/有效性 fail-closed。
- `tests/protocol-1to1.test.mjs`：lane、wire 字段、配对边界、ping 接线与释放。
- [docs/gateway-requests-coverage.md](gateway-requests-coverage.md)：57 个 Kotlin 工厂逐项状态；当前仅 ping 完整接线。

## 验证记录

- `node --test harmonyos/native-core/tests/*.test.mjs`：Lead 独立复核 **46/46 通过**（阶段 2 后）。
- DevEco JBR `assembleHap`：Lead 独立复核 **BUILD SUCCESSFUL**。
- **强制编译证明**：`hvigor clean` 后重新 assembleHap，40 个任务重跑，`CompileArkTS after 4s 637ms`、BUILD SUCCESSFUL；证明 GatewayRequest.ets、domain/ 4 个 Reducer、facade/SharedMviEvents.ets 均通过 ArkTS 编译，而非 UP-TO-DATE 假证据。
- 阶段 1B 新增 37 个 static 工厂方法；阶段 1C 已把 ping / openFileDownload / requestFileList 接入真实 lane。
- 模拟器 `127.0.0.1:5555`：此前一轮已安装并冷启动成功；本阶段尚未重装验证新代码。

## 明确未完成（不能宣称 1:1）

- KMP 57 个请求工厂中约 48 个未移植；已实现的工厂多数未接入 GatewayClient；runtime timeout / 迟到 pong 归属 / 重连隔离未完成。
- Reducer / Projection / HistorySync / MVI Event / Stores / 缓存预取 / RTC / Tailscale 等整层业务状态尚未移植。
- ArkUI 仍为 11 个页面，无 Markdown/代码高亮/轨迹详情/语音手势遮罩/自适应逐屏对齐。
- 语音路径仍是本地 CoreSpeechKit，与参考 `speech-input-v1` 主机插件转写不一致。
- 真实网关 E2E、签名 HAP、权限/通知/后台真机验收均待用户提供可达网关与设备条件。

## 已完成阶段门禁

- 1A：请求元数据/lane + ping 接线，37/37 测试 + build。
- 1B：P0 工厂，40/40 测试 + build。
- 1C：runtime 两批接线，45/45 测试 + build。
- 2：Reducer + MVI 初版，46/46 测试 + **clean build 强制编译证明**。


- 1D：剩余工厂，47 static / 47/47 测试 + clean build。
- 1E：runtime lane 基线（ping / openFileDownload / requestFileList），clean build + 54/54 测试。
- 3A：sync/ 3 + projection/ 3 + Index 导出，**Lead 修复半成品后** clean build CompileArkTS 3s807ms + BUILD SUCCESSFUL、54/54 测试。
- 4A：stores/ 4 个文件（Kernel + Conversation/History/Question），57/57 测试、clean build CompileArkTS 4s13ms + BUILD SUCCESSFUL、冷启动 PID 18442 稳定。

## 关键教训（本轮实测）

- **增量 assembleHap 的 UP-TO-DATE / BUILD SUCCESSFUL 不能证明新增 ArkTS 模块被编译**：阶段 2/3 的新模块未被引用或写了一半时，缓存构建仍报成功；必须 `hvigor clean` 后全量重编，查 `CompileArkTS` 实际执行。
- **真机/模拟器冷启动是第二道门禁**：clean build 暴露 AssistantStreamState 缺失 acceptHello/acceptHistory/invalidateHistory；实验性移除 @Provide 又造成 @Consume 崩溃（jscrash 140112）。二者都靠 HDC 安装 + hilog/faultlog 发现。
- 最新稳定证据：HAP 1.9M，安装成功，冷启动 PID 13290 存活 12s+，sodium 自检、loadContent done，无 @Consume 崩溃；`pageStack changed during render` 是 API 26 模拟器上系统 AIBarView 也出现的非致命框架告警。

## 本轮团队异常与 Lead 接管

`conversation-parity` / `feature-parity` 两个子代理解读阶段 3B/4 任务时反复异常退出且未写文件；Lead 未反复重启，而是亲自完成阶段 4A 的 3 个 P0 Store，并修复 ArkTS 严格模式错误（构造器属性、untyped object literal、Indexed access、重名导出）。这再次证明 clean build 是必须门禁。


## 本轮完成（用户要求「继续完成所有的」）

- **3B**：ConversationItem 扩展 files/knownFiles/textParts/requestId、全量 labels、foldWithOperations/rebase/命令/压缩/模型重试状态；TrajectoryNode 扩展 schema/arguments/result/error/timing/usage；projection-3b.test.mjs 3 项；修复 ArkTS 严格模式与测试 loader。
- **4B**：13 个剩余 Store + SharedMobileStore 统一 facade；stores-4b.test.mjs 4 项；修复 18 处 ArkTS 严格模式错误（untyped literal、any/unknown、obj-literals-as-types）。
- **5**：components/ 下 10 个 ArkUI 组件 + Index；SessionPage 引用 FileTypeIcon / CodeSyntaxHighlighter / VoiceRipplePanel 并增加代码预览。
- **6**：cache/ 5 个、transport/ 5 个、tailscale/ 显式 unsupported、diagnostics/ 1 个；phase6.test.mjs 5 项；修复 3 处 ArkTS 严格模式错误。

## 最终统一验收（Lead 独立执行）

- `node --test harmonyos/native-core/tests/*.test.mjs`：**69/69 通过**，0 失败。
- `hvigor clean` + `assembleHap`：`CompileArkTS after 4s245ms` + **BUILD SUCCESSFUL**。
- HAP **2.1 MB**，HDC `127.0.0.1:5555` 安装成功、冷启动 **PID 1781 稳定**、sodium 自检 / EntryAbility onCreate / loadContent done，**无 @Consume / JS crash**。
- `git diff --check` 通过；任务板 task-11～task-22 全部 completed；目标 re-armed（active，48 轮上限）。

## 仍未完成 / 外部依赖（不能宣称生产 1:1）

1. **真实网关 E2E**：配对、鉴权拒绝、hello 顺序、流式、审批/问答并发、队列、上传下载、断线重连、网关切换均无 live gateway 证据；需用户提供可达 `dsh-plugin-mobile-gateway` 与有效二维码。
2. **平台独占能力**：HarmonyOS 无 iOS Live Activity / tsnet Tailscale / 原生 WebRTC DataChannel；当前为通知、WSS 直连、RTC 状态机等价或显式 unsupported。
3. **语音路径分歧**：当前仍用本地 CoreSpeechKit + 点击切换；参考是 `speech-input-v1` 发 PCM 给主机官方 speech 插件、按住说话/上滑取消。
4. **UI 逐屏像素级**：参考 22 个 iOS Views/Components + 512 资源 + Design 设计稿；当前 10 个 ArkUI 组件为可编译基线，未逐屏截图/平板/旋转校准。
5. **KMP 逐分支全量**：ConversationProjection 760 行、SharedHistoryStore 585 行、RtcUpgradeMachine 555 行、SharedChatHistoryCache 831 行等仍为语义骨架，不是逐字段逐分支移植；16 个 Store 均为「可编译语义基线」。
6. **签名与真机**：HAP 未签名；权限弹窗、麦克风采集、通知点击、后台恢复需 signed HAP + 真机。

