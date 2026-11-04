# 虚拟支付接入契约（实现用，勿对外发布）

> 目标：把「公网有效期」改成可在线购买。管理员在「设置 → 公网权限」打开总开关并配置档位；普通用户在小程序「设置 → 公网访问」看到支付卡片，付款后**自动**给当前微信账号加天数，无需手动填兑换码。
>
> 身份：沿用现有 `wx.login` → `/session` → openid 账号体系。**不新增绑定流程**；下单时小程序静默 `wx.login` 取新 code，服务端同时拿到 openid 和 session_key（用于用户态签名），付款直接加到该 openid 的 `state.access` 上。没有新注册、没有手填码。

## 1. 范围

- 只做**道具直购**（`mode: 'short_series_goods'`），不做代币、不做订阅。
- 档位 = 「天数 + 价格（分）」，天数取自服务端 `CODE_DAYS`（与兑换码档位同一套），价格由管理员设置。
- 道具 ID（微信后台 productId）由天数确定：`pub_<days>d`（例如 30 天 → `pub_30d`）。管理员在小程序里配好档位后，必须去 MP 后台「虚拟支付 → 道具管理」按同一 ID 建道具并发布。
- 权益写入完全复用兑换码逻辑：`expiresAt = max(now, prev) + days*DAY`。
- 开关/档位存服务端状态文件（`ACCESS_STATE_FILE`），不新增数据库。

## 2. 状态模型（server.cjs，state version 3）

```js
state.version = 3
state.payment = {
  enabled: false,
  tiers: [ { id: 'pub_30d', days: 30, price: 990 } ],   // price 单位：分
  updatedAt: 0
}
state.orders = {
  [outTradeNo]: {
    outTradeNo: 'P...', accountId: '<sha256(openid)>', productId: 'pub_30d',
    days: 30, amount: 990, env: 0,
    status: 'created' | 'paid' | 'delivered' | 'closed' | 'refunded',
    createdAt: 0, paidAt: 0, deliveredAt: 0,
    wxOrderId: '', mchOrderNo: '', transactionId: '', attach: '',
    refund: { refundOrderId: '', refundedAt: 0, amount: 0 } | null
  }
}
state.payGmv = { 'YYYY-MM': { cents: 0, count: 0 } }   // 月限额统计
```

- 迁移：读到 v2 时补 `payment/orders/payGmv` 并升 v3；现有 `version` 校验 [1,2] 放宽到 [1,2,3]。
- 校验规则（读取时）：`payment.enabled` 布尔；`tiers` 数组 ≤ 10；每项 `id` 匹配 `/^pub_[0-9]{1,4}d$/` 且 `id === 'pub_' + days + 'd'`；`days` 必须 ∈ `CODE_DAYS`；`price` 整数 1..1000000；id 唯一。
- `orders` 每条按上面字段校验；脏数据要拒启动（沿用现有「Cannot read authorization state; refusing to reset it」风格）。

## 3. 服务端接口

### 3.1 公开配置（无鉴权）

`GET /app-content` 现有响应追加：

```json
{
  "payment": {
    "enabled": true,
    "ready": true,
    "tiers": [{ "id": "pub_30d", "days": 30, "price": 990 }]
  }
}
```

- `ready` = 服务端已配置 OfferID + AppKey + 小程序 AppID/AppSecret（缺一不可）。
- 开关关闭时也要返回 `enabled:false` 和空/原档位，前端据此隐藏卡片。
- 新增公开 `GET /pay/config` 作为兜底（与 app-content 同 payload），避免旧后端。

### 3.2 用户接口（Bearer）

**POST /pay/order**

请求：`{ "code": "<wx.login code>", "tierId": "pub_30d" }`

响应 200：
```json
{
  "outTradeNo": "P1a2b3c4d5e6f",
  "signData": "{\"offerId\":\"...\",\"buyQuantity\":1,\"env\":0,\"currencyType\":\"CNY\",\"productId\":\"pub_30d\",\"goodsPrice\":990,\"outTradeNo\":\"P...\",\"attach\":\"<accountId>\"}",
  "paySig": "<hex>",
  "signature": "<hex>",
  "mode": "short_series_goods",
  "env": 0
}
```

- `signData` 必须是**最终字符串**（键顺序固定为 offerId/buyQuantity/env/currencyType/productId/goodsPrice/outTradeNo/attach），客户端原样传，不得再 `JSON.stringify` 或重排。
- 签名：`paySig = HMAC_SHA256(appKey, 'requestVirtualPayment&' + signData)`；`signature = HMAC_SHA256(sessionKey, signData)`。
- session_key 只活在本请求内：`jscode2session` 取到后算完即丢，不落盘、不入日志。
- `outTradeNo`：`'P' + Date.now().toString(36).toUpperCase() + randomBytes(5).toString('hex')`，8–32 位，不以 `_` 开头。
- 金额：只信服务端 `payment.tiers`，忽略客户端价格。
- 下单前把该账号超过 2 小时仍 `created` 的订单置 `closed`；每个账号未支付订单最多 10 单。

错误：
| HTTP | code | 场景 |
| --- | --- | --- |
| 400 | `INVALID_TIER` | tierId 不存在/档位已删 |
| 403 | `PAY_DISABLED` | 开关关闭 |
| 503 | `PAY_NOT_CONFIGURED` | OfferID/AppKey/AppID/Secret 缺失 |
| 401 | `PAY_LOGIN_FAILED` | jscode2session 失败（code 过期等） |
| 429 | `MONTHLY_LIMIT_REACHED` | 当月 GMV ≥ 10,000,000 分 |
| 503 | `WECHAT_PAY_UNAVAILABLE` | 微信接口异常 |

**POST /pay/query**

请求：`{ "outTradeNo": "..." }`；只能查自己的单。

响应：
```json
{ "order": { "outTradeNo": "...", "status": "delivered", "days": 30, "amount": 990, "deliveredAt": 0, "expiresAt": 0 } }
```

- `expiresAt` 取该账号当前 `state.access[accountId].expiresAt`（发货后）。
- 本地状态是 `created/paid` 且已超过 15 秒 → 内部调一次 `query_order` 兜底（失败不报错，只返回本地状态）。
- 错误：404 `ORDER_NOT_FOUND`、403 `FORBIDDEN`。

**GET /pay/notify（URL 验证）** 与 **POST /pay/notify（推送）**

- GET：参数 `signature/timestamp/nonce/echostr`；`sha1(sorted([token,timestamp,nonce]).join(''))` 等于 signature 就原样返回 `echostr`，否则 403。Token 用 `XPAY_MSG_TOKEN`。
- POST：先验签（同上，`token+timestamp+nonce`），再按 `XPAY_MSG_ENCRYPT`：
  - `plaintext`：body 即明文 JSON/XML
  - `aes`（推荐）：body `{"Encrypt":"...","ToUserName":"..."}`，用 `XPAY_MSG_AES_KEY` 做 AES-256-CBC 解密（WXBizMsgCrypt 兼容：key=base64(AESKey+'='), iv=key[0..16]，去 16 字节随机 + 4 字节长度 + msg + appid）；`msg_signature = sha1(sorted([token,timestamp,nonce,encrypt]).join(''))` 必须匹配
  - `compatible`：明文/密文都接受
- 解析：JSON 优先；以 `<` 开头按 XML 解析（只取已知字段，白名单，不引入重型依赖）。
- 事件分发：
  - `xpay_goods_deliver_notify` → 校验 `OutTradeNo` 存在、`Env` 与订单一致、`GoodsInfo.ProductId === order.productId`、`GoodsInfo.ActualPrice === order.amount`；已 `delivered` 直接成功（幂等，用 `outTradeNo`；有 `WeChatPayInfo.TransactionId` 时同时查重）；否则一次 `commit` 内：订单 → `delivered` + `access` 累加 + `payGmv` 累加
  - `xpay_refund_notify`：订单 → `refunded`，扣回对应天数（`expiresAt = max(now, expiresAt - days*DAY)`），重复推送幂等
  - `xpay_subscribe_ios_refund_query_notify` / 其它：记录日志，返回成功
- 响应格式必须与请求一致：JSON → `{"ErrCode":0,"ErrMsg":"success"}`；XML → `<xml><ErrCode>0</ErrCode><ErrMsg>success</ErrMsg></xml>`。失败（临时错误）返回非 0 让微信重试；验签失败 403 并记日志。
- 推送里禁止外部慢调用（微信 3s 超时）。

### 3.3 管理员接口（Bearer + 管理员）

**POST /admin/pay/config**
```json
{ "enabled": true, "tiers": [ { "days": 30, "price": 990 } ] }
```
- 服务端生成 id：`'pub_' + days + 'd'`，忽略客户端 id。
- 响应：`{ "payment": { "enabled": true, "ready": true, "tiers": [...] } }`
- 错误：400 `INVALID_PAY_CONFIG`；403 `FORBIDDEN`。
- 关闭开关时不删档位（保留配置，用户端隐藏）。

**POST /admin/pay/orders**（P1）
`{ "limit": 50 }` → `{ "items": [ { outTradeNo, productId, days, amount, status, createdAt, deliveredAt, refund } ] }`（不返回 openid）。

**POST /admin/pay/refund**（P1）
`{ "outTradeNo": "...", "reason": 3 }` → 调 `/xpay/refund_order`（`order_id=outTradeNo`、`left_fee` 取 query_order、`refund_fee=amount`、`refund_order_id` 生成、`biz_meta`、`refund_reason`、`req_from: 1`、`env`），返回 `{ refundOrderId }`。只允许 Android/Windows/鸿蒙单。（iOS 不允许主动退，返回 400 `IOS_REFUND_UNSUPPORTED`。）

**POST /admin/pay/summary**（P1）
→ `{ "month": "2026-11", "cents": 0, "count": 0, "limit": 10000000, "warnAt": 9500000 }`

## 4. 服务端实现要点

- 新增 `dsh-console/services/public-access/payment.cjs`，导出 `createPayment({ getState, commit, now, limit, config, fetch }) `，职责：catalog / saveConfig / createOrder / queryOrder / notify / refund / summary / tick（每 5 分钟扫未发货单查单补发）。
- `server.cjs` 只做接线：
  - 新增 options：`xpay: { offerId, appKey, env, msgToken, msgAesKey, msgEncrypt }`、`xpayFetch`（默认 globalThis.fetch）、`exchangeSession`（默认用 consoleApp.wechat()/env 做 jscode2session，返回 `{openid, sessionKey}`）
  - 路由与 `/app-content` 字段
  - state 初始化/校验/迁移
  - `setInterval` 调 `payment.tick()`（`.unref()`，与 `proofCleanup` 同风格）
- access_token：`POST https://api.weixin.qq.com/cgi-bin/stable_token`（`grant_type=client_credential`），进程内缓存到过期前 5 分钟；`xpayFetch` 注入便于测试。
- 签名/解密只依赖 `node:crypto`，不引入新依赖。
- 日志脱敏：不打印 AppKey、session_key、完整 signData（可打 outTradeNo/状态）。
- 测试：新增 `test/payment.test.cjs`，用现有 `createService({ stateFile, now, exchangeCode, grantAccess, ... })` fixture 风格 + 注入 `xpayFetch`；覆盖：签名向量（固定输入断言 hex）、开关关闭、档位校验、下单、推送发货、重复推送幂等、金额/道具不符拒绝、验签失败、GET URL 验证、查单兜底、退款扣回、月限额、v2→v3 迁移。

## 5. 小程序端

### 5.1 数据/接口

- `accessApi.appContent()` 返回值新增 `payment`；`accessApi` 新增：
  - `createPayOrder(code, tierId)` → POST `/pay/order`
  - `queryPayOrder(outTradeNo)` → POST `/pay/query`
  - `savePayConfig({ enabled, tiers })` → POST `/admin/pay/config`
  - `payOrders(limit)` → POST `/admin/pay/orders`
- 新增 `miniprogram/utils/virtual-pay.js`：
  - `supported()`：基础库 ≥ 2.19.2 或 `wx.canIUse('requestVirtualPayment')`
  - `checkIosVersion()`：iOS 需微信 ≥ 8.0.68（官方要求 iOS 15+、中国大陆 App Store）
  - `purchase(tierId, { onStatus })`：`wx.login` → `createPayOrder` → `wx.requestVirtualPayment({signData, paySig, signature, mode})` → 轮询 `queryPayOrder`（1s/2s/3s）→ 返回订单；`-2` 取消视为静默失败；其余错误映射成人话
  - 明确：success 回调不作为发货依据

### 5.2 设置页

- `settings.wxml` 管理员区（`managementPanel === 'admin'` 的「管理员」卡片）新增一行：
  - 「虚拟支付」开关（`dsh-switch`，与「分享活动」同一行样式），保存中禁用
  - 「支付档位」入口（与「兑换码管理」同风格）→ 跳转 `/pages/pay-admin/pay-admin`
  - 开关关闭时提示「关闭后用户端隐藏支付卡片，已购买天数不变」
- 普通用户「公网访问」面板（`managementPanel === 'public'`）在兑换码入口下方新增支付卡片区（`payment.enabled && payment.tiers.length` 时显示）：
  - 每档一张卡：天数、价格（分 → 元展示）、购买按钮
  - 未登录也能看到卡片（`/app-content` 是公开的）；点购买时才静默 `wx.login`
  - 下方固定小字：虚拟商品、支付后即时生效、退款规则（Android 可联系客服退 / iOS 走 App Store）、客服按钮 `open-type="contact"`
  - 购买成功：toast + 刷新 `_publicAccount` + 展示新的有效期；失败：错误文案
- 新增分包页 `pages/pay-admin/pay-admin`：
  - 顶部开关（与设置页同一状态，保存走 `/admin/pay/config`）
  - 档位列表：每行「天数选择器（CODE_DAYS 同款：1/3/7/30/60/90/180/365/730/1095/3650 天）+ 价格输入（元，转分）+ 删除」
  - 「添加档位」+「保存」；保存成功回写
  - 提示：档位改完要去 MP 后台按 `pub_<days>d` 建道具并发布（约 10 分钟生效）
  - 管理员校验（`ensureAccount({freshLogin:true})`，非管理员显示无权限）

### 5.3 其他

- `app.json` 增加 `pages/pay-admin` 分包；`preloadRule` 可选。
- 所有新文案：中文直接作为 key，英文加到 `resources/i18n/interface.json`，再 `node scripts/sync-i18n.cjs`。
- 隐私政策（`miniprogram/utils/privacy-policy.js`）补充：处理订单号、支付结果、openid；不接触支付密码/银行卡。
- 包体积：`node scripts/check-miniprogram-package.cjs` 必须通过（主包源码 ≤ 1.40 MiB）。

## 6. 验收（对应官方「部署前检查清单」）

代码侧：
- [ ] 签名函数向量测试通过（与官方算法一致）
- [ ] 发货推送幂等（重复推送只发一次）
- [ ] 推送验签失败被拒；GET URL 验证返回 echostr
- [ ] 兜底 query_order 在无推送时补发
- [ ] 退款推送扣回天数且幂等
- [ ] 开关关闭时下单 403、用户端卡片隐藏
- [ ] 月 GMV 达 1000 万分级拒单
- [ ] 小程序基础库/微信版本不满足时按钮禁用并提示
- [ ] iOS 8.0.68 版本校验
- [ ] 支付成功但 success 回调丢失时，轮询/查单仍能到账

账号侧（需人工在 MP 后台完成）：
- [ ] 主体个人 + 类目含「工具」+ 认证 + 备案
- [ ] 虚拟支付开通、签约；记录 AppID/OfferID/现网 AppKey
- [ ] 小程序简称（iOS display name）+ 苹果 IAP 开通
- [ ] 道具按 `pub_<days>d` 建好并发布
- [ ] 发货推送 URL = `https://dsh.ahwe.top/pay/notify`，Token/EncodingAESKey 与 `XPAY_MSG_*` 一致，加密方式与 `XPAY_MSG_ENCRYPT` 一致
- [ ] 用 1 分/1 元测试道具完成一笔真实支付并收到推送
- [ ] 后台交易订单金额与本地订单一致

## 6.1 实现偏差（已落地）

- **退款推送匹配更宽**：除了 `MchOrderId/OutTradeNo`，还会用 `MchRefundId`（Android 主动退款的 refund_order_id）和 `WxTransactionId`（iOS 退款推送附带）反查订单，避免退款推送找不到订单导致天数不扣回。
- **同账号校验**：`/pay/order` 会校验 `wx.login` 的 openid 与当前登录 token 属于同一微信账号，不一致返回 403 `PAY_ACCOUNT_MISMATCH`；客户端强制重新登录后重试一次。
- **未知订单的发货推送**返回非 0（触发微信重试），与官方「发货失败重试」语义一致；同一订单重复推送按 `outTradeNo` + `TransactionId` 幂等。
- **P1 接口已实现**：`/admin/pay/orders`、`/admin/pay/refund`、`/admin/pay/summary`；退款先在订单上记 `refundOrderId`，收到退款推送才置 `refunded` 并扣回天数。
- **AES 解密按微信 PKCS#7 32 字节块**处理（pad 1..32），不是 AES 的 16 字节块。
- **不依赖消息推送也能闭环**（2026-11-04 补）：发货推送未配成时，query_order 兜底发货后会调 /xpay/notify_provide_goods 把微信侧订单标记为已发货（同样需要 pay_sig），否则后台账单停留在 status=3；定时对账同时复查已发货单，通过 left_fee<=0 / status 5,8 识别退款并自动扣回天数。
- **管理员查单**：新增 POST /admin/pay/inspect（以微信侧为准返回 status/orderType/paidFee/leftFee/wxOrderId 并同步本地退款状态）；交易记录页每笔订单带「核对 / 退款」按钮。服务端 server.payTick() 暴露给测试手动触发对账。

## 7. 文件归属（并行开发边界）

| 范围 | 归属 | 禁止改 |
| --- | --- | --- |
| `dsh-console/services/public-access/**`（含 test、.env.example、README） | 服务端 | 不改 `miniprogram/`、`docs/`、根 README |
| `miniprogram/**`、`resources/i18n/**` | 客户端 | 不改 `dsh-console/`、`docs/`、根 README |
| `docs/**`、根 README | Lead | — |
