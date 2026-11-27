# HarmonyOS 设备验收

本文覆盖 native-app（bundle com.whaletail.app）的可复现构建、HAP 安装、模拟器冒烟和真实网关配对验收。此工程要求 HarmonyOS / API 26 工具链；不要把 native-atomic 元服务包当作本应用产物。

## 外部条件

- macOS 主机已安装 DevEco Studio，且以下路径存在：
  - JBR：/Applications/DevEco-Studio.app/Contents/jbr/Contents/Home
  - SDK：/Applications/DevEco-Studio.app/Contents/sdk
  - Hvigor：/Applications/DevEco-Studio.app/Contents/tools/hvigor/bin/hvigorw
  - OHPM：/Applications/DevEco-Studio.app/Contents/tools/ohpm/bin/ohpm
  - HDC：/Applications/DevEco-Studio.app/Contents/sdk/default/openharmony/toolchains/hdc
- 工程 harmonyos/native-app/build-profile.json5 的 default product 编译和目标 SDK 均为 26.0.0，运行时为 HarmonyOS。安装的 SDK 应包含对应 API 26 SDK/工具链。
- 应用签名配置当前为空（signingConfigs: []）。模拟器调试使用 unsigned HAP；真机验收需要测试者在 DevEco/AGC 配置匹配的应用签名和设备/应用注册。不要为本验收修改签名配置或提交证书、密钥、profile。
- 真网关 E2E 需要一台可访问的电脑端 DSH、已安装并启用 dsh-plugin-mobile-gateway，并在 DSH WebUI「移动设备」中启用移动连接和设备鉴权、生成尚未过期的一次性配对二维码/信息。仅有应用或模拟器不能替代网关。
- LAN 直连验收要求手机/模拟器与 DSH 网关网络互通，防火墙允许对应 WebSocket 端口。默认示例地址是 ws://<电脑局域网地址>:3081/ws/mobile；实际端口和路径以网关配置/生成的二维码为准。可选 wss:// 仅在网关已提供 TLS WebSocket 且模拟器/设备信任其证书链时使用；不要求公网域名或中继。
- 扫码需要设备相机权限和可用相机。模拟器没有可用相机时，以手动粘贴二维码载荷的路径验证配对解析，或者在手动连接页输入 WebSocket URL 与一次性配对码。

## 构建

在仓库根目录执行。命令使用本机 DevEco 安装路径；如安装在别处，只替换这些工具路径，不改工程签名配置。

~~~sh
export JAVA_HOME=/Applications/DevEco-Studio.app/Contents/jbr/Contents/Home
export PATH="$JAVA_HOME/bin:$PATH"
export DEVECO_SDK_HOME=/Applications/DevEco-Studio.app/Contents/sdk
HVIGOR=/Applications/DevEco-Studio.app/Contents/tools/hvigor/bin/hvigorw
OHPM=/Applications/DevEco-Studio.app/Contents/tools/ohpm/bin/ohpm

cd harmonyos/native-app
"$OHPM" install --all
"$HVIGOR" --mode module -p product=default assembleHap --no-daemon
~~~

成功条件：Hvigor 输出 BUILD SUCCESSFUL，且产物存在：

harmonyos/native-app/entry/build/default/outputs/default/entry-default-unsigned.hap

检查产物：

~~~sh
ls -lh harmonyos/native-app/entry/build/default/outputs/default/entry-default-unsigned.hap
shasum -a 256 harmonyos/native-app/entry/build/default/outputs/default/entry-default-unsigned.hap
~~~

如果失败在 CompileArkTS，按编译错误修复代码/SDK问题；若 ArkTS 编译完成但 PackageHap 报「Unable to locate a Java Runtime」，先确认 $JAVA_HOME/bin/java -version 可运行，再重跑完整 Hvigor 命令。该失败不表示 ArkTS 编译失败，也不表示已经产生了本次源码对应的新 HAP。

## HDC 与安装

先只读确认 HDC 能发现目标设备：

~~~sh
HDC=/Applications/DevEco-Studio.app/Contents/sdk/default/openharmony/toolchains/hdc
"$HDC" -v
"$HDC" list targets
~~~

应出现目标序列号（下文以 127.0.0.1:5555 为例）。仅在这是测试者已准备且可用的模拟器/设备时继续；如果目标为空、offline 或未连接，先在 DevEco 启动/连接目标设备。本文不执行配对、授权或签名变更操作。

在已授权供开发使用的模拟器上安装/更新 unsigned HAP：

~~~sh
HDC=/Applications/DevEco-Studio.app/Contents/sdk/default/openharmony/toolchains/hdc
"$HDC" -t 127.0.0.1:5555 install -r harmonyos/native-app/entry/build/default/outputs/default/entry-default-unsigned.hap
"$HDC" -t 127.0.0.1:5555 shell bm dump -n com.whaletail.app
~~~

成功条件：安装命令成功，且 bundle 查询显示 com.whaletail.app、版本 1.0.0。安装是写设备操作；不要把上面的查询命令误认为安装验证之外的授权命令。

如需启动应用：

~~~sh
HDC=/Applications/DevEco-Studio.app/Contents/sdk/default/openharmony/toolchains/hdc
"$HDC" -t 127.0.0.1:5555 shell aa start -b com.whaletail.app -a EntryAbility
~~~

## 模拟器冒烟

逐项手工验收并记录目标型号/API、HAP SHA-256、测试日期和结果：

1. 冷启动进入首页，无白屏/崩溃；返回/前进导航可用，状态栏安全区正常。
2. 打开「设置」，浅色/深色/跟随系统切换后页面状态一致；离开再进入仍无崩溃。
3. 进入「添加节点」引导，检查插件名称是 dsh-plugin-mobile-gateway、步骤文案指向 DSH WebUI「移动设备」设置。
4. 打开配对页和手动输入面板，检查 WebSocket 地址和一次性配对码字段可编辑、清空按钮有效；空值应显示输入提示，合法的 ws:// / wss:// 前缀可继续提交。错误/不可达地址应显示失败状态，不应导致应用退出。
5. 设置页的 QR 扫描入口可打开系统扫码器并可取消返回。模拟器没有相机时记录为「相机扫码未测」，不要将无相机当作扫码通过。
6. 用无效/过期的配对载荷测试错误提示；应用应留在前台且可继续编辑。成功结果需要真实可达网关，属于下节 E2E，不在离线冒烟中伪造成功。

只在确有崩溃或启动异常时收集日志：

~~~sh
HDC=/Applications/DevEco-Studio.app/Contents/sdk/default/openharmony/toolchains/hdc
"$HDC" -t 127.0.0.1:5555 shell hilog -x
~~~

根据设备 HDC/hilog 版本用其支持的过滤参数抓取应用崩溃/ArkUI 错误；验收报告保留相关错误上下文即可，避免附带无关用户日志。

## 真实网关 E2E

前置：可登录的电脑端 DSH，已启动并启用 dsh-plugin-mobile-gateway；DSH WebUI「移动设备」的移动连接和设备鉴权已开启；准备一次性有效二维码/载荷；手机/模拟器可以路由到电脑端网关。二维码是 Base64URL(JSON)，本客户端解析直连 v2 信息（含 publicUrl、endpoints、一次性 pairingCode 和到期时间），并按载荷候选地址连接。

1. 在模拟器/手机打开「添加节点」，扫描电脑端生成的二维码。无相机时，在设置页粘贴二维码的 Base64URL 配对载荷。不要手工解码后把长期 token 当作配对码。
2. LAN 场景中确认使用的候选地址是可路由的 ws:// 局域网 WebSocket 地址；网关端口必须从测试设备可达。也可在手动表单填该地址和一次性配对码。TLS 已配置时，可另测 wss://。
3. 观察连接状态变为已连接，节点名/连接方式出现；若网关协议支持，首页应加载工作区和会话列表。打开最近会话并发送一条无敏感内容的测试消息，确认回复/状态帧回到应用。
4. 断开或关闭应用后重启，确认保存的设备凭据可自动重连；设置页「忘记网关」后确认下次启动不再自动连接。按需清理测试节点和一次性配对码。
5. 再用已过期/已消费的配对码验证失败提示，确认不出现已连接状态；需要重新生成二维码后才能重新配对。

E2E 不通过时依次记录：设备型号/HarmonyOS 与 API 版本、应用版本/HAP SHA-256、连接的 ws(s):// endpoint（日志中脱敏主机/路径时保留 scheme 和端口）、网关/插件版本、二维码生成时间与是否过期、设备与电脑网络关系、失败阶段和错误提示。不要记录完整二维码、一次性配对码、Bearer/长期凭据或私钥。

## 当前环境状态（2026-11-06）

本文件编写时做过只读状态检查：HDC 3.2.0f 可用，hdc list targets 返回 127.0.0.1:5555（Linux aarch64 emulator）；该模拟器的 Bundle Manager 查询显示 com.whaletail.app 1.0.0 已安装。工作区有 entry-default-unsigned.hap（约 1.7 MB，观察到的文件时间为 2026-11-06 20:08 本地时间）。文件存在不证明它由当前源码重新构建，也不证明其安装状态与当前文件相同。此前一次 full assemble 已通过 CompileArkTS，但在 PackageHap 因 shell 找不到 Java Runtime 失败；需使用本节构建命令中的 DevEco JBR 设置重新跑完整构建。

这次状态检查仅读取目标列表、HAP 文件信息和模拟器安装清单；没有安装 HAP、启动应用、申请设备权限、触发授权、修改签名配置或访问真网关。真实设备/网关 E2E 尚未执行。
