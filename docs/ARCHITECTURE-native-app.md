# native-app 架构与内嵌 Tailscale（tsnet）实现

> 范围：`harmonyos/native-app`（HAP 应用壳）及其内嵌 Go 引擎链路。更新于 2026-11-16。

## 1. 模块与构建配置

- 模块：`entry`，`type: entry`，`mainElement: EntryAbility`，deviceTypes: phone/tablet。
- 应用 = 普通 HAP（`bundleType: app`，`installationFree: false`），无元服务包体限制。
- 应用级系统材质：`metadata: ohos.arkui.UIMaterial.state = enable`（沉浸光感，targetAPI 26+）。
- 权限：`ohos.permission.INTERNET`、`GET_NETWORK_INFO`、`CAMERA`（扫码配对）。
- VPN 扩展：`extensionAbilities: [{ name: VpnAbility, type: vpn, srcEntry: ./ets/vpnextension/VpnAbility.ets }]`。
- 原生构建：`entry/build-profile.json5 → buildOption.externalNativeOptions.path = ./src/main/cpp/CMakeLists.txt`，`abiFilters: [arm64-v8a]`。

## 2. 源码结构

```
entry/src/main/
├── ets/
│   ├── entryability/EntryAbility.ets      # 窗口创建、主题 colorMode、安全区、热启动路由
│   ├── pages/
│   │   ├── Index.ets                      # NavPathStack + PageMap 路由表
│   │   ├── HomePage.ets                   # 首页（会话列表/工作区/主机切换/搜索）
│   │   ├── SessionPage.ets / ConversationPage.ets   # 会话与对话（流式渲染、审批/提问）
│   │   ├── SessionSettingsPage.ets / AppSettingsPage.ets / SettingsPage.ets
│   │   ├── PluginsPage.ets                # 插件（已安装/实验性/发现市场/添加安装/详情配置）
│   │   ├── ModelsPage.ets                 # 模型与提供商管理
│   │   ├── SchedulePage.ets               # 自动化任务
│   │   ├── NodeManagePage.ets / AddNodePage.ets     # 主机节点与配对
│   │   └── TailscalePage.ets              # 内嵌 Tailscale（起点/状态/登录）
│   ├── services/TsnetBridge.ets           # NAPI 封装（唯一原生桥出口）
│   ├── vpnextension/VpnAbility.ets        # VPN Extension：建 TUN、路由、（待）fd 交接
│   └── components/                        # 对话渲染/玻璃卡片/背景/输入框等 15 个组件
├── cpp/
│   ├── CMakeLists.txt                     # 链接 libtailscale_go.so + napi_init
│   ├── napi_init.cpp                      # NAPI 方法表（48 个导出）
│   ├── types/libtailscale_ohos/index.d.ts # ArkTS 类型声明
│   ├── libs(→entry/libs/arm64-v8a)/libtailscale_go.so   # Go c-shared 引擎
│   └── tsnetbridge.cpp                    # 旧实验实现（已不参与编译，可删）
└── resources/                             # 图标、深海背景、深浅色资源
```

路由（Index.PageMap）：`session`、`plugins`、`schedule`、`node-manage`、`add-node`、`session-settings`、`app-settings`、`settings`、`models`、`tailscale`。

## 3. 内嵌 Tailscale 子系统

### 3.1 组成

| 层 | 文件/产物 | 职责 |
|---|---|---|
| UI | `pages/TailscalePage.ets` | 开关、状态机（Starting/NeedsLogin/WaitingRoutes/Ready/Failed）、登录链接弹窗、节点/在线数展示 |
| 桥 | `services/TsnetBridge.ets` | 统一封装 NAPI：hello/probe/start/stop/status/authURL/vpnConfig/peers/exitNodes/restartWithTun |
| NAPI | `cpp/napi_init.cpp` + `types/libtailscale_ohos` | ArkTS ↔ C 方法表、异步版（Promise）封装 |
| 引擎 | `entry/libs/arm64-v8a/libtailscale_go.so` | Go c-shared：tailscale tsd 引擎 + magicsock + WireGuard + harmony TUN |
| Go 源码 | `harmonyos/native/go_bridge/` | `main.go`(cgo 导出 50 个 TS\* 接口)、`backend.go`(引擎生命周期)、`engine_upgrade.go`(状态迁移/租约)、`auth_key.go`、`harmony_tun.go`(TUN 适配)、`vpnroute/`(路由计算)、taildrop/taildrive、`proxy.go`+`tsnet_node.go`(轻量 tsnet 内嵌隧道) |
| 工具链 | `harmonyos/third_party/go-ohos`(go1.27.3-ohos-devel)、`third_party/tailscale`(v1.104.5) | `GOOS=openharmony GOARCH=arm64` 交叉编译 |
| 补丁 | `harmonyos/native/go_bridge/vendor/patches/*.patch` | tailscale v1.104.5 的 OHOS 适配（platform.patch：netmon/wgengine/magicsock/ipn/tsnet，cold-peer.patch） |

### 3.2 构建管线

```
third_party/go-ohos/bin/go  (go1.27.3-ohos-devel)
   + third_party/tailscale (v1.104.5，已打 vendor/patches/{platform,cold-peer}.patch)
   + native/go_bridge/*.go
        │  GOOS=openharmony GOARCH=arm64 CGO_ENABLED=1
        │  CC=<sdk>/llvm/bin/clang --target=aarch64-linux-ohos --sysroot=<sdk>/sysroot -D__MUSL__
        ▼
entry/libs/arm64-v8a/libtailscale_go.so (+ .h)      ← c-shared，约 60MB
        │  CMake: add_library(... SHARED IMPORTED) + target_link_libraries
        ▼
libtailscale_ohos.so  (NAPI 模块，随 HAP 打包)
        │  ArkTS: import { backendStart, ... } from 'libtailscale_ohos.so'
        ▼
TsnetBridge → TailscalePage / VpnAbility
```

关键决策：**静态链接而非 dlopen**。Go c-shared 库随进程由动态链接器在启动时加载，避免 `dlopen` 触发的 musl initial-exec TLS 崩溃（旧方案失败根因）。

### 3.3 NAPI 能力面（48 个导出，按用途分组）

- 探针/版本：`hello`、`probeEngine`、`controlProbe`、`tailscaleVersion`、`tunFdProbe`
- 后端生命周期：`backendStart`、`backendStop`、`backendStopAsync`、`backendLogout`、`backendStatus`、`backendSnapshot`
- 网络接管：`backendVpnConfig`、`backendRestartWithTun`、`backendNetworkChangedAsync`、`backendNetworkSettings`、`backendSetNetworkSetting`
- 账号/节点：`backendPeers`、`backendAccount`、`backendExitNodes`、`backendSetExitNode`、`backendAuthURL`
- Taildrop/Taildrive：`backendTaildropSend/Receive/Cancel/IncomingSnapshot`、`backendTaildriveList/Stat/Mutate/Download/Upload/...`

### 3.4 数据契约（来自 Go 桥）

| 方法 | 返回格式 |
|---|---|
| `backendStatus()` | `OK \| state=Running \| loginURLReady=true \| tailscaleIPs=1 \| tun=true \| exitNode=false \| ... \| phase=...`（失败为 `FAILED \| ...`） |
| `backendVpnConfig()` | `"<IPv4>\|<IPv6或空>\|<逗号分隔路由>"`，如 `100.64.0.5\|fd7a:...\|0.0.0.0/0,100.64.0.0/10` |
| `backendPeers()` / `backendExitNodes()` / `backendAccount()` | JSON（仅展示字段；密钥/控制面细节不下发） |
| `backendAuthURL()` | 登录 URL（空串表示暂不需要登录） |
| `backendRestartWithTun(stateDir, model, osVersion, controlURL, fd)` | 状态字符串（同 backendStatus 格式） |

### 3.5 运行期时序（目标态）

```
TailscalePage 开关 ON
  └─ TsnetBridge.start(stateDir, model, osVersion, "")
        └─ Go backendStart → tsd 引擎启动（app 进程内）
  └─ 轮询 TsnetBridge.status()/authURL()
        ├─ NeedsLogin → 弹窗展示登录链接
        └─ Running → 展示节点 IP / 在线节点数
启用 VPN（接管系统流量）
  └─ VpnAbility(VPN Extension) onCreate
        ├─ backendVpnConfig() → 解析 IPv4/IPv6/路由
        ├─ vpnExtension.createVpnConnection → create(config) → TUN fd
        └─ backendRestartWithTun(..., fd) → harmony_tun 接管读写 → 系统流量进 tailnet
```

### 3.6 当前完成度

| 项 | 状态 |
|---|---|
| OHOS Go 工具链 + tailscale 补丁 | ✅ 本机构建通过 |
| libtailscale_go.so 构建（c-shared/arm64） | ✅ 产物 60MB |
| NAPI 链接方式（非 dlopen） | ✅ HAP 构建通过（33MB） |
| TsnetBridge + TailscalePage（启动/状态/登录链接） | ✅ 代码接通 |
| VpnAbility 的 TUN fd → `backendRestartWithTun` 交接 | ⏳ 待实现（当前仍是旧 WireGuard 桩） |
| 真机验证（hello/status/登录/路由） | ⏳ 待设备 hdc 恢复后安装验证 |
| exit node / subnet routes / taildrop UI | ⏳ 后续 |

## 4. 与 native-core 的边界

- `native-app` 只做 **UI + 平台能力**（Ability、VPN Extension、NAPI 桥、权限、资源）。
- 网关协议、状态、投影、加密、缓存全部在 `native-core`（HAR），页面通过 `@StorageLink` 和 Store 方法与核心交互。
- Tailscale 是唯一「外壳直连原生引擎」的子系统（不在 native-core 内），原因是 NAPI 与 VPN Extension 都绑在 HAP 上；Go 引擎通过 `TsnetBridge` 统一暴露，页面不直接 import .so。
