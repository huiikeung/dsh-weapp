# 原生鸿蒙工程（ArkTS）总览

> 目标：**元服务与应用都能用，元服务优先**，用原生 ArkTS/ArkUI 重写，替代 ASCF 转译版本。
> 旧的 `harmonyos/atomic-service`（ASCF 元服务）保持可用，作为原生版本的对照与回退。

## 三个工程的职责

```
harmonyos/
├── atomic-service/     ASCF 元服务（Web 技术栈转译，现状可用，保留）
├── native-core/        原生共享核心（HAR 静态库）★ 一份代码
├── native-atomic/      原生元服务壳（HAP，bundleType=atomicService）★ 优先
└── native-app/         原生应用壳（HAP，bundleType=app）
```

- `native-core`：主题（跟随系统/浅色/深色）、偏好存储、全局状态键、网关 WebSocket 客户端、
  **协议层（DTO + fail-closed 帧解码，自旧 `harmonyos/entry` 工程迁入并按 ArkTS 26 改写）**、
  日志、发送侧帧构造、会话数据层（`SessionStore`）。两个壳共用，避免两份实现漂移。
- `native-atomic`：元服务壳。`AppScope/app.json5` 里 `bundleType: "atomicService"`，
  `module.json5` 里 `installationFree: true`。**后续功能优先在这里落地。**
- `native-app`：应用壳。`bundleType: "app"`，无元服务包体限制，用来承载鸿蒙应用特性
  （服务卡片、实况窗、通知、后台保活、多设备布局等）。

两个壳的页面各自持有（`pages/`），共享逻辑与后续的协议层、组件库放在 `native-core`，
避免出现「两份实现漂移」。壳与核心通过本地依赖连接：

```json5
// native-atomic/entry/oh-package.json5
"dependencies": { "nativecore": "file:../../native-core" }
```

`native-core` 同时注册为两个壳 `build-profile.json5` 的 module（`srcPath: "../native-core"`）。

## 构建（本机已验证）

```sh
export JAVA_HOME=/Applications/DevEco-Studio.app/Contents/jbr/Contents/Home
export PATH="$JAVA_HOME/bin:$PATH"
export DEVECO_SDK_HOME=/Applications/DevEco-Studio.app/Contents/sdk
HVIGOR=/Applications/DevEco-Studio.app/Contents/tools/hvigor/bin/hvigorw
OHPM=/Applications/DevEco-Studio.app/Contents/tools/ohpm/bin/ohpm

# 元服务（优先）
cd harmonyos/native-atomic
$OHPM install --all
$HVIGOR --mode module -p product=default assembleHap --no-daemon

# 应用
cd ../native-app
$OHPM install --all
$HVIGOR --mode module -p product=default assembleHap --no-daemon
```

产物与打包类型（`pack.info`）：

| 工程 | bundleName（占位） | bundleType | installationFree | 产物 |
| --- | --- | --- | --- | --- |
| native-atomic | com.whaletail.atomicservice | atomicService | true | entry-default-unsigned.hap |
| native-app | com.whaletail.app | app | false | entry-default-unsigned.hap |

安装/签名：模拟器可用 hdc 安装；真机需要在 AGC 分别注册**元服务**与**应用**，
自动签名后 Run ▶。bundleName 目前是占位值，正式发布前替换。

## 已实现（原生）

- 工程可编译（两个壳均 BUILD SUCCESSFUL，API 26 / HarmonyOS 26.0.0）；
- 主题：`ThemeManager` 跟随系统/浅色/深色，持久化到 Preferences，页面 `@StorageLink` 响应；
- 导航：`Navigation + NavDestination`（Index 路由表：session / settings）；
- 页面骨架：首页（工作区、快捷入口、连接状态）、会话页（List 气泡 + 原生 TextArea）、
  设置页（外观切换真实生效、连接状态、关于）；
- 网络：`GatewayClient` WebSocket 连接、X-DSH-* 凭据头、dsh-mobile-v1 子协议、状态机与日志；
- 协议：`decodeFrame` + `GatewayRequests`（发送侧）已接入 `GatewayClient`：文本帧 fail-closed
  解码 → 请求/响应按 `requestId` 或帧 kind 关联 → `onFrame` 分发；中继二进制帧待 E2EE 会话层。
- 数据流：连接成功后自动拉 host/workspaces/sessions；`SessionStore` 解析会话列表、自动打开最近
  会话，把 `history.events` 与流式事件聚合成 `SessionRow[]` 写进 `AppStorage.sessionRows`。
- 页面：首页显示真实会话列表（点按打开）、会话页渲染真实消息并可发送、设置页可手动连接/断开；
- 发送侧：`GatewayRequests` 已覆盖 ping / sessions / workspaces / host / history / subscribe /
  message / session-cancel / session-rename；
- 会话列表：`SessionStore` 解析 `sessions` 帧 → `AppStorage.sessions`，首次自动打开最近会话。
- 凭据持久化：`state/CredentialStore.ets` 保存 gatewayId/地址/token/relay 凭据到 Preferences；
  配对成功（`paired` / `relay-authorized` 帧）自动落盘；启动时 `GatewayClient.autoConnect()`
  免扫码重连；设置页可查看网关名并「忘记网关」。
- 中继 E2EE：`crypto/Sodium.ets`（X25519 + XSalsa20-Poly1305，移植自 tweetnacl）+
  `crypto/RelaySession.ets`（ClientHello/AgentHello/Ed25519 验签/计数器封包）+ SHA-512 与
  Ed25519 走鸿蒙 cryptoFramework；**已用 tweetnacl 向量在 Node 中验证通过**
  （公钥/box/boxOpen 三者一致），启动时也会跑一次自检并打日志。
- 上下文面板：`context-dashboard / context-usage` 帧 → `AppStorage.contextDashboard`，
  展示请求数、上下文窗口、轮次与最近请求的输入/输出 token。
- 编队面板：`context-fleet` 帧 → `AppStorage.contextFleet`；当前 Agent 作根节点、
  其余作子节点，按容器宽度两列排布，节点间用「视图旋转」画直线连接（纯 ArkUI，无需 Canvas 重绘）。
- 会话体验：新消息自动贴底（用户上滑后暂停并出现「回到底部」）；`history.beforeSeq` 分页
  「加载更早记录」；长列表改 `LazyForEach + IDataSource`（cachedCount 12）。
- 会话管理：首页「＋ 新建会话」（`session-create` → `session-created` 回执拿 sessionId 后自动打开）；
  会话变更后自动刷新列表；已封装 `renameSession / archiveSession`。
- 插件页：`plugin-catalog` 帧 → 列表（标题/说明/版本/实验性标记），开关下发 `plugin-bundle-set-enabled`；首页新增「插件」入口。
- 自动化任务页：`schedule-catalog` 帧 → 任务列表，开关下发 `schedule-update`；首页新增「自动化任务」入口。
- 连接信息：设置页显示「连接方式」（直连 / 公网中继 E2EE）与「公网状态」（中继授权结果）。
- 事件投影：`state/EventProjector.ets` 把归一化事件聚合成 turn → step → 工具调用，
  写入 `AppStorage.projectedTurns`；轨迹面板按轮次展示工具状态（执行中/完成/失败）。
- 队列面板：`session-queue/session-queues` 帧 → `AppStorage.queueItems`；会话页顶部分段
  （对话/排队/轨迹/上下文/编队），排队项支持「立刻发送（steer）」与「删除（remove）」。
- 扫码配对：设置页「扫码配对」用 ScanKit 扫 DSH 二维码 → `parsePairingPayload` 解析
  （Base64URL / v2 直连 / v3 中继元信息）→ `GatewayClient.connectPairing` 按候选地址顺序尝试
  （原生可直接用 `ws://` 局域网地址，不受元服务域名白名单限制）；相机权限已声明。

## 迁移路线（元服务优先）

1. ~~协议层（控制帧 + 发送侧）~~、~~扫码配对（直连候选）~~、~~中继 E2EE~~ 已完成；
   ~~凭据持久化 + 免扫码自动重连~~ 也已完成；剩余：断线重连指数退避、失败重试策略。
2. **元服务页面补齐**（native-atomic）：首页/会话页/设置/扫码配对/队列面板已接真实数据；
   已完成：四面板 + 编队连线 + 自动贴底/分页历史 + LazyForEach + 连接/公网状态展示；
   剩余：真机键盘避让验证、账号身份（华为账号 OAuth）与兑换。
3. **元服务验收**：与 ASCF 版逐屏对照，功能对齐后再作为默认版本。
4. **应用增强**（native-app）：服务卡片、实况窗、通知、后台保活、折叠屏/多设备、无障碍。
5. 两壳共用核心，任何业务改动只改 `native-core` 与对应壳页面。

## 关于旧工程 `harmonyos/entry`

仓库根目录还有一套更早的原生工程（`bundleName: com.whaletail.hmos`，API 12），它的
`protocol/GatewayDtos.ets` 与 `protocol/GatewayFrameCodec.ets` 已全部迁入
`native-core/src/main/ets/protocol/`（并按 API 26 的 ArkTS 规则改写），页面仍是占位实现。
后续以 `native-core` 为准，旧工程仅作参考，不再作为构建目标。

## 注意

- 元服务与应用**分别**在 AGC 注册，bundleName / 签名 / 隐私声明互不相同；
- 原生 WebSocket 支持真正的 subprotocol，后续把 `dsh-mobile-v1` 从头部挪到协议字段会更标准；
- ASCF 版本继续保留，出问题时可随时回退。
