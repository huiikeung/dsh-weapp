# dsh-weapp 代码架构总览

> 生成时间：2026-11-16 ｜ 覆盖：微信小程序参照端、鸿蒙原生端（应用/元服务/共享核心）、内嵌 Tailscale（tsnet）引擎、网关协议层。

## 1. 仓库全景

```
dsh-weapp/
├── miniprogram/          微信小程序（功能与视觉的参照实现，26 个页面）
├── miniapp/              小程序相关补充工程/产物
├── dsh-console/          控制台与中继（relay-server.js 等）
├── harmonyos/            鸿蒙原生工程（本仓库主战场）
│   ├── native-core/      ★ 共享核心 HAR（协议/网络/状态/投影/组件/加密）
│   ├── native-app/       ★ 原生应用壳 HAP（bundleType=app，主力）
│   ├── native-atomic/    原生元服务壳 HAP（bundleType=atomicService）
│   ├── atomic-service/   旧 ASCF 元服务（回退/对照）
│   ├── native/go_bridge/ ★ 内嵌 Tailscale Go 引擎（tsd + harmony TUN）
│   ├── paths/patches/    OHOS Go / Tailscale 适配补丁
│   ├── third_party/      ohos-go 1.24.5 工具链、tailscale v1.86.5
│   ├── entry/            HAR 形态的公共模块（历史/资源）
│   └── docs (PARITY.md / NATIVE.md)
├── docs/                 协议、对齐矩阵、验收、专项设计
├── scripts/              构建、真机探针、校验脚本
├── tests/                Node 侧回归测试
├── assets/ resources/    图标与静态资源
└── release-artifacts/    发版产物
```

## 2. 运行时拓扑

```
DSH 网关（dsh-plugin-mobile-gateway，独立仓库/插件）
        ▲ WebSocket 帧协议（kind 化 fail-closed JSON）
        │
┌───────┴─────────────────────────────┐
│ 客户端                               │
│  ├─ 鸿蒙原生（native-app）           │
│  │    ArkUI 页面 → native-core 状态层 │
│  │    → GatewayClient(ws) → 网关      │
│  └─ 微信小程序（miniprogram）         │
│       pages → utils/store.js          │
│       → utils/gateway.js(ws) → 网关   │
└─────────────────────────────────────┘

内嵌 Tailscale（可选旁路网络）：
VPN Extension(VpnAbility) ──TUN fd──► libtailscale_go.so(tsd+magicsock+WireGuard)
                                        ▲
                        native-app 页面 ─┴─ NAPI(libtailscale_ohos.so)
```

## 3. 鸿蒙端分层

### 3.1 native-core（HAR，一份代码两个壳共用）

| 目录 | 职责 |
|---|---|
| protocol/ | GatewayDtos 帧 DTO、GatewayFrameCodec（fail-closed 解码）、GatewayRequest(s)（发送帧构造）、PairingPayload、RequestCorrelation |
| network/ | GatewayClient：WebSocket 连接、握手、重连、请求关联、帧分发（分发给各 Store） |
| transport/ | GatewayTransportPolicy、MgwCodec、RTC 升级状态机（直连/中继切换） |
| state/ | SessionStore、PluginStore、ScheduleStore、ModelSettingsStore、CredentialStore、EventProjector 等 |
| stores/ | Shared* 共享状态（会话/历史/审批/提问/队列/上传/MVI 事件） |
| projection/ | ConversationFeed、ConversationProjection、Trajectory、ToolActivity（帧 → 展示模型） |
| domain/ | SessionList/Approval/Question/SessionControl 等纯函数 reducer |
| sync/ | HistorySyncEngine、HistoryReducer、AssistantStreamState（流式渲染） |
| components/ | MarkdownLite（块级解析）、OceanBackground/ParticleBackground、GlassCard |
| common/ | ThemeManager（浅深/跟随系统）、PreferencesStore、SecureCredentialStore、Logger、Attachment*、NotificationService、VoiceDictation |
| crypto/ | Sodium（X25519/密封盒）、WireGuardProtocol/Crypto/Tunnel、RelaySession（中继加密） |
| cache/ | 历史窗口策略、内存缓存、预取 |
| facade/ | SharedMviEvents |
| diagnostics/ | 网络诊断、TailscalePlatformStatus |
| Index.ets | 统一 barrel 导出（页面只依赖这个） |

### 3.2 native-app（HAP 应用壳）

```
entry/src/main/
├── ets/entryability/     EntryAbility（窗口/主题 colorMode/安全区/热启动路由）
├── ets/pages/            Index(路由) + Home/Session/Conversation/Settings/Plugins/
│                         Models/Schedule/AppSettings/SessionSettings/NodeManage/
│                         AddNode/Tailscale（13 页）
├── ets/services/         TsnetBridge（NAPI 封装：hello/start/status/authURL/vpnConfig）
├── ets/vpnextension/     VpnAbility（VPN Extension：建立 TUN、路由、把 fd 交给 Go 引擎）
├── cpp/                  napi_init.cpp（NAPI 方法表）+ CMakeLists（链接 libtailscale_go.so）
├── libs/arm64-v8a/       libtailscale_go.so（Go c-shared 引擎，60MB）
└── resources/            深海背景、图标、深浅资源
```

### 3.3 native-atomic / atomic-service

- native-atomic：元服务壳（bundleType=atomicService、installationFree），复用 native-core。
- atomic-service：旧 ASCF（Web 技术栈转译）版本，保留作回退与对照。

## 4. 数据流（会话为例）

```
ArkUI Page
  ├─ @StorageLink 读 stores 暴露的状态
  └─ 用户操作 → native-core（GatewayClient / Store 方法）
GatewayClient
  ├─ 发送：GatewayRequest → JSON 帧 → WebSocket
  └─ 接收：JSON → GatewayFrameCodec（校验 kind）→ 分发
        ├─ EventProjector / HistoryReducer / AssistantStreamState（流式增量）
        ├─ Store（SessionStore/PluginStore/ScheduleStore/…）→ AppStorage
        └─ ConversationFeed/Projection → MarkdownBodyView 渲染
持久化：PreferencesStore（偏好/主题）、SecureCredentialStore（令牌）、cache/（历史窗口）
```

## 5. 内嵌 Tailscale（tsnet）架构 ★ 新增

```
构建期：
  third_party/ohos-go (OpenHarmony Go 1.24.5，已打补丁)
  third_party/tailscale (v1.86.5，已打 tailscale-ohos.patch)
  native/go_bridge (Go 桥：tsd 引擎 + harmony TUN + vpnroute + taildrop/taildrive)
      └─ go build -buildmode=c-shared → entry/libs/arm64-v8a/libtailscale_go.so
  cpp/CMakeLists: IMPORTED 链接 libtailscale_go.so → libtailscale_ohos.so(NAPI)
                  （不再 dlopen，规避 musl initial-exec TLS）

运行期：
  TailscalePage ──TsnetBridge(NAPI)──► backendStart / status / authURL / peers
  VpnAbility(VPN Extension) ──create TUN──► fd
                                     └──► backendRestartWithTun(fd) → 接管 tailnet 流量
```

## 6. 小程序参照端（miniprogram/）

- pages/：home、session、session-settings、settings、plugins、plugin-detail、models、schedule、workspace-picker、files、cost-meter、announcements、pairing-admin、privacy 等 26 个页面。
- utils/：gateway.js（WS 协议/请求关联）、store.js（全局状态）、plugins.js（插件目录模型）、ui-preferences、theme 等。
- plugin-settings/：内置插件动态配置表单（终端/Agent 循环/子智能体/网页搜索等）。
- 视觉系统：styles/、theme.json、i18n/；HarmonyOS 端按 PARITY.md 与其逐项对齐（rpx→vp = /2）。

## 7. 构建与发布

```bash
# 1) 依赖
pnpm install && ohpm install --all        # 小程序/工具链 + 鸿蒙依赖
# 2) 鸿蒙原生应用
export JAVA_HOME=/Applications/DevEco-Studio.app/Contents/jbr/Contents/Home
export DEVECO_SDK_HOME=/Applications/DevEco-Studio.app/Contents/sdk
hvigorw --mode module -p product=default -p buildMode=debug assembleHap
# 3) Tailscale Go 引擎（单独构建，产物进 entry/libs）
bash /tmp/build_tsnet.sh    # 仓库内等价脚本建议 scripts/build-go-ohos.sh
# 4) 真机
hdc install -r entry/build/default/outputs/default/entry-default-signed.hap
```

## 8. 关键文档索引

| 文档 | 内容 |
|---|---|
| harmonyos/NATIVE.md | 三工程职责与构建 |
| harmonyos/PARITY.md | 与小程序逐项视觉/交互对齐 |
| docs/gateway-requests-coverage.md | 协议请求覆盖矩阵 |
| docs/harmonyos-parity-matrix.md | 鸿蒙对齐矩阵 |
| docs/plugin-management.md、plugin-detail-parity.md | 插件管理与详情 |
| docs/harmonyos-device-acceptance.md | 真机验收清单 |
| docs/auto-route-selection.md、cost-meter-protocol.md 等 | 专项协议 |
