# 2026-10-19 网关更新与验证

## 安装内容

- 官方 `dsh-plugin-mobile-gateway` 从 0.10.2 更新到 0.10.3。GitHub main 的核对提交为 `9ce0b33fd67de4bdbdf368bf4c5db4e727cfc05b`，npm latest 同为 0.10.3。
- 原始发布包通过 `npm pack dsh-plugin-mobile-gateway@0.10.3 --ignore-scripts` 获取；没有执行第三方安装脚本。依赖声明与旧版本一致。
- 合入用户提供的 `dsh-plugin-mobile-gateway-0.10.3-bridge-patch-20261019-165402.zip`。归档 SHA-256 为 `d62d6b32dc54a539b75dd87208ba55e4e118eff07bf4a969e88a39941a4e7240`。
- 两个安装脚本已存在于本仓库；在官方 0.10.3 上执行后，两个修改文件的 SHA-256 与补丁 manifest 完全一致。没有直接覆盖不同版本的完整 lib 文件。

新增接口：`plugin-market-indexes`、`plugin-market-set-indexes`、`plugin-market-search`（含分类参数）、`plugin-credential-describe`、`plugin-credential-set`、`plugin-translation-limits`。凭据读取只返回配置状态，不返回密钥原文。

## 本机实际运行的插件

DSH desktop profile 的启用项是 `dsh-plugin-weapp-gateway` 0.8.6，它提供已有的公网中继扩展；不是官方 mobile 插件。因此也对这个启用中的插件应用了同样的两组兼容桥接，并正常退出、重新启动 DSH。未强行切换启用项，也未更改配对身份、授权服务、域名配置、局域网设置或公网开关。

官方 mobile 插件的 `local-plugins` 与 `node_modules` 两份安装均已更新到 0.10.3 并打补丁；weapp 插件的两份安装均已补齐接口。不要把 weapp 0.8.6 的版本号伪装成 mobile 0.10.3。

当前运行模式为 `direct`，Cloudflare 公网 WSS 开启。原有 relay 注册信息保留；relay connector 在此模式下不运行。本次公网实测覆盖 Cloudflare WSS，不代表已验证付费中继服务。

## 验证结果与边界

- 官方 0.10.3 源码合入桥接后，完整 `npm test` 通过。
- 小程序及公网后台回归（含新增检查脚本安全测试）：305 通过，4 跳过，0 失败；插件相关专项 54 项全部通过。
- 小程序分包体积检查通过。
- 重启前，实际网关的市场请求返回不支持；重启后，市场、翻译能力、凭据状态接口全部通过。
- 使用本仓库真实 `miniprogram/utils/gateway.js`，只将 `wx.connectSocket` 与内存存储映射到 Node，对运行中的 DSH 分别完成本机 WS 与公网 WSS 配对和业务查询：3 个工作区、37 条会话、Session V4 历史、模型、23 个插件、设置、市场索引、翻译能力、凭据配置状态。
- 每次验证创建的临时配对设备均在结束后撤销；未发送聊天消息，未写入插件设置或用户凭据。
- 微信开发者工具登录已过期，扫码仍待完成；尚未完成模拟器/手机画面验证，未上传体验版。上述 Node 传输验证不替代真机域名白名单和 UI 验证。

## 下次更新

先安装官方插件，再对实际安装目录运行；启用的是 weapp 时，也应对 weapp 实际目录执行。不要对一个目录打补丁，却重启另一个未更新的安装。

```sh
node scripts/install-plugin-market-bridge.cjs /absolute/gateway/package --check
node scripts/install-plugin-settings-bridge.cjs /absolute/gateway/package --check
node scripts/install-plugin-market-bridge.cjs /absolute/gateway/package
node scripts/install-plugin-settings-bridge.cjs /absolute/gateway/package
```

两个检查都成功才继续；失败不强行覆盖。安装脚本会备份原文件。正常重启 DSH 后可执行：

```sh
node scripts/check-installed-gateway.cjs \
  --gateway /absolute/gateway/package \
  --management http://127.0.0.1:DSH_PORT
# 加 --public 验证网关已经配置的公网 WSS；不修改公网模式。
```

管理地址必须是本机回环地址。DSH desktop 的管理端口可能随重启变化。脚本只输出数量和状态，不输出配对凭据或会话正文。

## 本机备份

- 官方插件升级前完整备份：`/Users/0the/.dsh/mobile-gateway-update-20261019.TSUxop/`，含 `mobile-source` 与 `mobile-installed`。
- weapp 插件桥接前备份位于其 `lib/` 下，文件后缀为 `.before-market-1792410033282` 与 `.before-plugin-settings-1792410033310`。
- 如需回滚，先退出 DSH，恢复对应安装目录；weapp 按相反顺序恢复 settings、market 备份，再启动 DSH。不要删除设备状态、会话目录或公网身份文件。
