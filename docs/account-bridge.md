# 账号与余额桥接（移动端）

小程序设置页「账号与余额」的数据来自 DSH 宿主，经 `dsh-plugin-weapp-gateway` 中转：

```
小程序  --{type:'account', requestId, client}-->  网关  --accountController.getState/getProfile/getBalance-->  DSH 宿主（DeepSeek 账号）
        <--{kind:'account', requestId, state, profile, balance}--
```

- `client` 为 `{ version, locale, timezoneOffsetSeconds }`，宿主用它生成平台请求头与语言。
- `state` 形如 `{ status: 'signed-out' | 'credential-stored', links: { usageUrl, topUpUrl }, attempt }`。
- `profile` 为 `{ status: 'ready', value: { name, contact, avatarUrl } }` 或 `null`。
- `balance` 为 `{ status: 'ready', value: [{ currency: 'CNY' | 'USD', balance }], bonusWallets }` 或 `null`。

## 安装

老版本网关（≤0.8.14）没有 `account` 请求类型，需要补桥接：

```sh
node scripts/install-account-bridge.cjs <网关包绝对路径> --check
node scripts/install-account-bridge.cjs <网关包绝对路径>
```

脚本会备份 `lib/index.mjs`，写入 `lib/account-bridge.mjs`，并注入：

- `handleQuery` 的 `account` 路由；
- `ctx.inject(['accountController'])`（宿主没有账号服务时自动降级为 `account-unavailable`）；
- 请求白名单与配对设备校验；
- `hello.capabilities` 中的 `account-v1`。

装完需**重启 DSH**（或在插件管理里停用/启用该网关插件）后生效；随后重新连接小程序即可看到真实账号与余额。宿主未提供账号服务时返回 `account-unavailable`，客户端回落到「未登录 / 登录后查看」。
