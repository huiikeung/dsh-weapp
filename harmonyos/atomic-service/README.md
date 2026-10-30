# 鸿蒙元服务（ASCF）

此目录是从仓库的微信小程序转换出的独立华为 ASCF 元服务工程，不是微信开发者工具的多端 App，也不是上级目录原有的 ArkTS 应用。页面和业务代码位于 `ascf/ascf_src/`。

## 当前状态

这是迁移中的开发工程，尚未完成所有平台适配或真机验收。`AppScope/app.json5` 中的 `com.example.whaletail.atomicservice` 和 `example` 只是开发占位值，不是已注册的元服务信息。发布前需在 HarmonyOS 开发者中心注册元服务并替换 Bundle Name/vendor，配置发布签名、权限和 HTTPS/WSS 域名。

华为身份服务端已增加 `/session/huawei`，部署 `dsh-console/services/public-access/` 时需配置 `HUAWEI_CLIENT_ID`、`HUAWEI_CLIENT_SECRET`，并在需要时配置 `HUAWEI_ADMIN_OPENIDS`。缺少 Client ID/Secret 时接口按 `HUAWEI_NOT_CONFIGURED` 失败关闭。元服务使用 Account Kit 前，还需在开发者中心配置 Client ID、签名与公钥指纹；当前模拟器没有真实华为账号或对应指纹，因此尚未实测 OAuth 登录。微信/华为身份和权益使用不同命名空间，旧微信权益不会自动迁移。旧版外部节点 grant adapter 对 `huawei:<sha256>` 账号 ID 的兼容性仍待目标服务联调。

原始转换记录在 `ascf/ascf_src/transform.log`，详细报告在 `ascf/ascf_src/__ascfConvertReport/index.html`。报告仅反映自动转换结果，不能证明页面、登录或网络行为已适配。不要对本目录再次运行带 `-c` 的转换命令：它会清空转换后的源码并覆盖后续适配。

## 本地编译

使用华为 ASCF Toolkit 1.0.17，例如在仓库根目录执行：

```sh
npm exec --yes --package=@atomicservice/ascf-toolkit@1.0.17 -- ascf compile "$PWD/harmonyos/atomic-service" --disableSubpackages false
```

构建 HAP 还需要 DevEco Studio、对应 HarmonyOS SDK 和工程依赖。模拟器调试、真机签名与华为账号能力的要求不同，按华为开发者文档配置。

本机 HarmonyOS 7.0 ARM 模拟器验证记录：包含华为登录客户端的 ASCF release 编译成功；entry HAP 为 1,120,951 B，15 个 HSP 与 HAP 合计 4,636,651 B（最大单包 1,120,951 B）。Hvigor 构建任务成功；因工程没有签名配置，输出为 unsigned HAP/HSP。使用 HDC 安装全部包并通过 ASCF 启动命令运行，首页和设置页可显示，扫码入口触发系统相机权限提示。以上只验证编译、安装、启动与基本页面渲染，不代表真实华为 OAuth、网关连接、所有功能或上架审核通过。

ASCF 编译会将 `ascf/ascf_src/` 转换到 `ascf/ascf_build/` 并更新根 `build-profile.json5`，这两者为生成产物，不要手工编辑。开发工具提示的图标规范、HarmonyOS 模拟器 ASCF Runtime 版本及 ASCF compile warning 仍需处理。

## 微信多端 App

微信开发者工具路线使用独立目录：从仓库根目录执行 `node scripts/prepare-native-app.cjs`，再在微信开发者工具导入 `native-app/generated-miniprogram/`。该目录为忽略的生成副本，原始页面仍由 `miniprogram/` 维护。它与本 ASCF 元服务工程不是同一个产物。当前副本已打开在微信开发者工具 2.02.2608080 多端应用模式，内置 iPhone 预览首页正常、控制台无错误；工具已识别并选中本地 HarmonyOS 模拟器 `127.0.0.1:5555`。本次尚未成功触发 HarmonyOS App 构建，也没有生成微信多端鸿蒙包；仅验证了小程序在开发者工具预览环境运行。下一步仍需在微信开放平台确认多端应用与小程序绑定、完善鸿蒙 Bundle ID/签名等配置，并由工具成功产出后在模拟器/真机验收。该多端 App 流程不同于 ASCF 元服务。

## 已知迁移限制

- ASCF 客户端固定访问 `https://dsh.ahwe.top`，托管中继使用其对应的 `wss://` 域名；两者必须在华为开发者中心按 HTTPS/WSS 配置且 TLS 证书有效。本地代码只做 WSS 格式筛选，不会绕过或验证域名白名单。不能假定原小程序的局域网 `ws://` 或任意动态域名可用。
- 微信 `wx.login` 凭证不等于华为账号授权码。服务端已实现华为 code 验证和分离身份，但需部署时设置 `HUAWEI_CLIENT_ID`、`HUAWEI_CLIENT_SECRET`（管理员名单可选 `HUAWEI_ADMIN_OPENIDS`），并由真实华为 Client ID 和签名指纹联调。微信与华为权益不自动合并；外部 grant adapter 是否接受 `huawei:<sha256>` account ID 尚未验证。
- 离屏画布、消息文件选择等接口在转换报告中标为不支持；分享、订阅消息、语音、文件以及跨平台存储还需要逐项验证和适配。
- 元服务有包体、隐私、导航和账号规范；自动转换及源码体积检查不能代替构建、设备测试和上架审核。
