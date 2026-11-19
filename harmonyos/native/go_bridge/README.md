# 内嵌 Tailscale Go 引擎（go_bridge）

`scripts/build-go-ohos.sh` 把本目录编译成 `native-app/entry/libs/arm64-v8a/libtailscale_go.so` + 同名 `.h`，
由 `entry/src/main/cpp/napi_init.cpp` 直接链接（NAPI 直连，不 dlopen）。

| 项 | 值 |
| --- | --- |
| Tailscale | **v1.104.5**（`tailscale.com v1.104.5`） |
| 工具链 | **go1.27.3-ohos-devel**（`flypigJ/go-ohos` @ `9f8bcc7`，见 `vendor/source.json`） |
| 目标 | HarmonyOS API 26 / arm64（`GOOS=openharmony GOARCH=arm64`） |
| C ABI | **50 个 `TS*` 导出** = 上游 core 41 + 本仓库扩展 9（`TSLocalProxyStart/Stop`、`TSQ*`） |
| 来源 | `flypigJ/tailscale-ohos-core`（MeshArc 桥）+ 本仓库原有的轻量 tsnet 内嵌隧道扩展 |

## 目录

- 引擎主体：`main.go`（cgo 导出表）、`backend.go`（tsd 引擎生命周期）、`engine_upgrade.go`（状态迁移 / 租约）、
  `auth_key.go`、`harmony_tun.go`、`mesharc_devices.go`、`taildrive.go`、`control_probe.go`、`path_diagnostics.go`、`vpnroute/`
- 本仓库扩展：`proxy.go`（`TSLocalProxy*`，应用内 tailnet TCP 代理）、`tsnet_node.go`（`TSQ*`，轻量 tsnet 节点 = 首页「内嵌隧道」）
- 契约：`include/tailscale_ohos.h`（公共 C 头，构建脚本会核对导出数量）
- 补丁：`vendor/patches/{platform,cold-peer}.patch` + `vendor/patches/LICENSE-Tailscale`
- 溯源：`vendor/source.json`（上游 tag/commit、工具链 pin、22 个 vendor 文件的 sha256）

## 一次性准备

新机器一条命令（幂等；已就绪时只做校验，不联网、不改动）：

```bash
scripts/prepare-tailscale-engine.sh           # 克隆 go-ohos / tailscale 并打补丁
scripts/prepare-tailscale-engine.sh --build   # 准备好后直接构建 libtailscale_go.so
scripts/prepare-tailscale-engine.sh --check   # 只读校验（工具链身份 / 版本 / 补丁数 / 22 个 sha256）
```

需要 bootstrap 时用 `OFFICIAL_GO_ROOT=<官方 go1.27.3 根目录>` 指定官方 Go；脚本也会自动探测
`D:/Other/P-Program/_ts-build/go1.27.3/go`、`$HOME/sdk/go1.27.3`、`/usr/local/go`。

手动等价步骤：

1. 官方 Go 1.27.3（仅用于 bootstrap 工具链）：解压到任意目录。
2. OpenHarmony Go 工具链：

   ```bash
   git clone https://github.com/flypigJ/go-ohos.git harmonyos/third_party/go-ohos
   git -C harmonyos/third_party/go-ohos checkout --detach 9f8bcc797b210e67c32e538df4af4293cf420d0e
   python harmonyos/third_party/go-ohos/ohos/scripts/manage.py bootstrap \
     --bootstrap <官方 Go 1.27.3 根目录>
   ```

3. Tailscale v1.104.5 + 本仓库补丁：

   ```bash
   git clone --no-checkout --depth=1 --branch v1.104.5 https://github.com/tailscale/tailscale.git harmonyos/third_party/tailscale
   git -C harmonyos/third_party/tailscale checkout 73a4805
   git -C harmonyos/third_party/tailscale apply --index \
     "$PWD/harmonyos/native/go_bridge/vendor/patches/platform.patch" \
     "$PWD/harmonyos/native/go_bridge/vendor/patches/cold-peer.patch"
   ```

   `third_party/` 被 git 忽略，`.so` 也不入库。

## 构建

```bash
scripts/build-go-ohos.sh --check   # 校验工具链/版本/补丁/ABI
scripts/build-go-ohos.sh           # → native-app/entry/libs/arm64-v8a/libtailscale_go.{so,h}
```

产物约 47 MB（HAP 打包时由 hvigor strip 到 ~25 MB）。校验：

```bash
third_party/go-ohos/bin/go version -m native-app/entry/libs/arm64-v8a/libtailscale_go.so | grep tailscale.com
third_party/../../(llvm-nm) -D --defined-only .../libtailscale_go.so | grep -c '^TS'   # 50
```

## 与旧基线（v1.86.5）的差异

- 版本 1.86.5 → 1.104.5，工具链 ohos-go 1.24.5 → go-ohos go1.27.3-ohos-devel。
- 上游把 `ipn.NotifyInitialNetMap` 标记为废弃（订阅会被拒），轻量引擎的未使用导入哨兵改为 `ipn.NeedsLogin`。
- 旧的 `vpn_config.go`（WatchIPNBus 取 NetMap）已删除：1.104 的 `Notify.NetMap` 被移除，`backend.go` 自带适配后的 `vpnConfig()`。
- 新增 `TSBackendLoginWithAuthKey`、`TSBackendPathDiagnostic`（上游 core 能力），导出总数 48 → 50。
- 旧补丁 `harmonyos/patches/tailscale-ohos.patch` 仅对应 v1.86.5，保留作历史参考，不再使用。
