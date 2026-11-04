# 小程序虚拟支付接入清单（个人主体 · 工具类目）

> **实现状态（2026-11-03）**：服务端与小程序端已按本清单落地。代码级验收项见 [虚拟支付部署与验收手册](virtual-pay-deploy.md) 第 5 节；账号侧（虚拟支付开通/签约/道具/推送配置）仍需人工在 MP 后台完成。实现契约见 [virtual-pay-contract.md](virtual-pay-contract.md)。

> 结论先行：个人主体小程序**可以**开通虚拟支付，硬门槛是「个人主体 + 服务类目含『工具』+ 已认证 + 已备案」，月支付限额 **10 万元**；Android 等终端抽 1%，iOS 走 Apple IAP 抽 12%。
>
> 本文按「账号 → 商品 → 服务端 → 小程序 → 验收 → 发布」拆成 6 个阶段。P0 项全部完成才允许提审。
> 官方文档：[虚拟支付：个人](https://developers.weixin.qq.com/miniprogram/dev/platform-capabilities/business-capabilities/virtual-payment/person.html) ·
> [虚拟支付：企业、个体户（客户端/服务端 API 与消息推送细节在此页）](https://developers.weixin.qq.com/miniprogram/dev/platform-capabilities/business-capabilities/virtual-payment.html) ·
> [wx.requestVirtualPayment](https://developers.weixin.qq.com/miniprogram/dev/api/payment/wx.requestVirtualPayment.html)

---

## 0. 现状与改造边界（先看这一节）

| 项 | 现状 | 本期结论 |
| --- | --- | --- |
| 付费方式 | 管理员在「设置 → 公网访问」发兑换码，用户手动兑换 | 新增「付款后自动发天数」通道，兑换码保留（线下/补偿/测试） |
| 权益模型 | `dsh-console/services/public-access/server.cjs` 里 `state.access[accountId].expiresAt` | **不改**。购买成功 = 走和兑换码完全相同的「累加天数」写入 |
| 中继 | `dsh-console/relay/` 只认 `state.access` | **不动**。支付与中继解耦，改错也伤不到连接 |
| 商品形态 | — | 只做**道具直购**（`short_series_goods`）；不做代币、不做订阅/自动续费 |
| 涉及目录 | — | 服务端 `dsh-console/services/public-access/`；客户端 `miniprogram/` |

一句话：虚拟支付在本项目里不是新业务，只是给「公网有效期」换一个收款入口。

---

## 1. 账号与资质（MP 后台，全部是非代码工作）

- [ ] **主体**：小程序主体为个人，开发者持中国大陆居民身份证
- [ ] **类目**：服务类目包含「工具」。课程、内容、资讯类不在开放范围；需要电信业务资质的服务（邮件、语音信箱、存储转发、信息发布平台、信息搜索查询）也不支持
- [ ] **认证**：小程序已完成微信认证
- [ ] **备案**：小程序已完成 ICP 备案
- [ ] **开通虚拟支付**：MP 后台 →「支付与交易 → 虚拟支付」→ 开通 → 勾选协议 → 填个人资料（身份信息/提现账户/支付管理员）→ 提交（审核一般 5 分钟内）→ 审核通过后扫码签约
- [ ] **记录三个凭证**（**只落服务端，绝不进小程序包**）：
  - `AppID`（已有：`wx46765c19a7d97682`，以 MP 后台为准）
  - `OfferID`（虚拟支付 → 基本配置）
  - `现网 AppKey`（虚拟支付 → 基本配置）；沙箱环境另有独立 AppKey
- [ ] **小程序简称**：MP 后台 → 左下角图标 → 账号设置 → 基本信息，配置简称（Apple 支付展示 display name 用）
- [ ] **iOS IAP 开通**：虚拟支付 → 基本配置 → 开通苹果 IAP 支付
- [ ] **道具管理**：建商品（道具 ID、名称、价格「分」、发布）。**道具发布后约 10 分钟生效**（错误码 15014）
- [ ] **发货推送配置**：虚拟支付「基本配置 → 发货推送配置」（或开发管理 → 消息推送）填写 URL / Token / EncodingAESKey / 加密方式 / 数据格式。推送复用公众号消息推送的验签与解密机制
- [ ] **提现账户**：个人银行卡与主体一致；首笔会打 0.01 元验卡
- [ ] **运营物料**：用户协议、退款说明、客服入口（`open-type="contact"`，需在 MP 后台配置客服）、隐私保护指引补充

> 常见被拒原因：类目里没有「工具」；认证/备案未完成；主体信息与提现账户不一致；小程序实际内容与类目不符。

---

## 2. 商品与权益设计

### 2.1 商品表（建议档位，最终以运营定价为准）

| 道具 ID（建议） | 名称 | 价格（分） | 权益 | 备注 |
| --- | --- | --- | --- | --- |
| `pub_7d` | 公网访问 7 天 | 300 | +7 天 | 试用档 |
| `pub_30d` | 公网访问 30 天 | 990 | +30 天 | 主力档 |
| `pub_365d` | 公网访问 365 天 | 8800 | +365 天 | 年付档 |

规则：

- 价格**同时**存在于三处：MP 后台道具价、服务端商品目录、小程序展示。三处必须一致，否则下单报 **15013**（goodsPrice 错误）
- iOS 最低支付金额 **1 元**（100 分）；Android 等终端可到 0.01 元
- 同一道具 ID 跨 Android/iOS 通用，无需分端建商品
- 权益写入沿用兑换码逻辑（`server.cjs` 的 `/redemptions` 分支）：
  ```js
  const previous = Number(state.access[accountId]?.expiresAt) || 0;
  const expiresAt = (previous > now() ? previous : now()) + days * DAY;
  commit(next => { next.access[accountId] = { expiresAt, updatedAt: now() }; /* 同时写订单状态 */ });
  ```
- 不做：代币充值、自动续费、按次/按 Token 计费（无法映射成道具；订阅/自动续费本期不评估，个人主体也不适用）
- 退款口径：Android 等终端开发者可主动退（`/xpay/refund_order` 或后台操作），180 天内平台退手续费；iOS 由 Apple 决定，开发者只能通过「iOS 退款问询推送」表态

### 2.2 服务端商品目录（唯一可信来源）

新增 `dsh-console/services/public-access/pay-catalog.cjs`，只放「道具 ID → 价格(分)/天数」：

```js
module.exports = Object.freeze({
  pub_7d:   { price: 300,  days: 7 },
  pub_30d:  { price: 990,  days: 30 },
  pub_365d: { price: 8800, days: 365 }
});
```

小程序通过接口拿商品，不硬编码价格；服务端下单时按此校验 `goodsPrice`。

---

## 3. 服务端改造（`dsh-console/services/public-access/`）

### 3.1 文件与配置

| 文件 | 改动 | 优先级 |
| --- | --- | --- |
| `.env.example` | 追加 `XPAY_OFFER_ID`、`XPAY_APP_KEY_ENV0`、`XPAY_APP_KEY_ENV1`、`XPAY_ENV`、`XPAY_MSG_TOKEN`、`XPAY_MSG_AES_KEY` | P0 |
| 新增 `pay-catalog.cjs` | 商品目录（见 2.2） | P0 |
| 新增 `virtual-payment.cjs` | 签名、下单、查单、退款、推送验签解密；依赖注入 fetch 便于测试 | P0 |
| `server.cjs` | 路由、状态模型、定时对账、env 读取 | P0 |
| `README.md` / `README-deploy.md` | 新变量、推送配置、公网 URL 说明 | P1 |
| `console.cjs` | 可选：把 AppKey 放网页配置并加密存储（复用 `ACCESS_MASTER_KEY` seal/unseal）；否则仅用 env | P2 |
| `deploy/install.sh` / `upgrade.sh` | 不改逻辑；upgrade 已备份 `.env` 与 data 卷，新增变量手工补到 `.env` | P1 |

**注意部署形态**：`compose.yaml` 里容器是 `read_only: true` + `tmpfs /tmp`，**不能写文件系统**。状态只能写 `/app/data` 卷；定时任务只能用进程内 `setInterval`（本项目已有 `proofCleanup` 先例，记得 `.unref()`），不要引入 cron/systemd。

**状态文件单实例约束**：订单和权益同在 `ACCESS_STATE_FILE` 这一个 JSON 里，`server.cjs` 注释明确「不能让多个进程或服务器共用」。订单量预计每月 ≤1000 单，同一文件可接受；若日单量上百，再考虑拆表/迁 DB。

### 3.2 状态模型：state v2 → v3

```js
// server.cjs 初始化时
let state = { version: 3, codes: {}, redemptions: {}, access: {}, huaweiDevices: {},
              huaweiAdmins: {}, notificationTickets: {}, orders: {}, monthGmv: {} };

// orders[outTradeNo] = {
//   outTradeNo, accountId, openidHash, productId, amount, days, env,
//   status: 'created' | 'paid' | 'delivered' | 'closed' | 'refunded',
//   createdAt, paidAt, deliveredAt,
//   wxOrderId, mchOrderNo, transactionId, attach,
//   refund: { status, wxRefundId, refundedAt, amount } | null,
//   source: 'wechat' | 'apple'
// }
```

- 迁移：读取到 `version === 2` 时补空对象并升到 3；**不要**校验失败就重置（现有代码这一点做得对，保持）
- `monthGmv[YYYY-MM] = { cents, count }` 用于月限额告警/拦截，避免全表扫描
- 尺寸控制：订单只保留必要字段；推送原始报文（脱敏后）单独只存最近 30 天，或只记日志

### 3.3 session_key 与两套签名（最容易踩坑）

`wx.requestVirtualPayment` 需要两个签名：

| 签名 | 密钥 | 消息 | 谁算 |
| --- | --- | --- | --- |
| `paySig` | AppKey（服务端） | `'requestVirtualPayment' + '&' + signData 原字符串` | 服务端 |
| `signature` | session_key（用户态） | `signData 原字符串` | 服务端（需 session_key） |

推荐做法：**下单时现取 session_key，算完即丢**。

1. 小程序点购买 → 先 `wx.login()` 拿新 code
2. `POST /pay/order { code, productId }`
3. 服务端用 `exchangeWithWechat` 同款 `jscode2session` 换 `{ openid, session_key }`
4. 生成 `signData` 字符串 → 算 `paySig` + `signature` → 返回给客户端；session_key 只留在本次请求内存里，不落盘、不打日志
5. 客户端把 `signData` **按字符串原样**传给 `wx.requestVirtualPayment`（传对象会失败）
6. 返回 15007（session_key 过期）时服务端回 `PAY_SESSION_EXPIRED`，客户端重新 `wx.login` 重试一次

```js
// virtual-payment.cjs
const crypto = require('node:crypto');
const hmac = (key, msg) => crypto.createHmac('sha256', key).update(msg).digest('hex');

function signPayload({ appKey, sessionKey, offerId, env, productId, price, outTradeNo, attach }) {
  const signData = JSON.stringify({
    offerId, buyQuantity: 1, env, currencyType: 'CNY',
    productId, goodsPrice: price, outTradeNo, attach
  });
  return {
    signData,
    paySig: hmac(appKey, 'requestVirtualPayment&' + signData),
    signature: hmac(sessionKey, signData)
  };
}
```

AppKey 规则：

- 现网（`env=0`）与沙箱（`env=1`）各一把，配置分开
- 生产环境强制 `env=0`（错误码 15011：现网版本 env 只能是 0）
- 服务端调用 `/xpay/*` 时用 `/xpay/query_order` 这类真实路径 + `'&' + body` 算 `pay_sig`
- AppKey/AppSecret 只存在服务端 env 或加密配置里，绝不进小程序、不进日志、不进 git

### 3.4 接口清单

| 方法 | 路径 | 鉴权 | 作用 | 优先级 |
| --- | --- | --- | --- | --- |
| GET | `/pay/catalog` | 无需 | 返回商品目录（价格/天数/文案 key） | P0 |
| POST | `/pay/order` | Bearer | `{ code, productId }` → `{ outTradeNo, signData, paySig, signature, mode, env }` | P0 |
| POST | `/xpay/notify` | 消息推送验签 | 收 `xpay_goods_deliver_notify` / `xpay_refund_notify` 等，返回 `ErrCode:0` | P0 |
| POST | `/pay/order/query` | Bearer | `{ outTradeNo }` → 本地订单；必要时内部调 `query_order` 兜底 | P0 |
| POST | `/admin/orders` | 管理员 | 订单列表（后台/客服查单） | P1 |
| POST | `/admin/orders/:outTradeNo/refund` | 管理员 | 启动 `/xpay/refund_order`（仅 Android 等终端） | P1 |
| POST | `/admin/pay/summary` | 管理员 | 月度 GMV、限额余量 | P1 |

**路由落点**：继续用 `server.cjs` 里现有的 if/else 风格（`route === '/pay/order'`），不要另起 HTTP 框架。`/xpay/notify` 必须放在 `auth(req)` 之前（和 `/session`、`/internal` 一样是公开入口），并加 `limit('notify:' + ip, ...)`。

**推送 URL 可用性**：`deploy/Caddyfile` 已把除 `/relay/*`、`/internal/*` 外全部反代到 `console:8790`，所以 `https://dsh.ahwe.top/xpay/notify` 天然可达；注意 Caddy 对普通路径 `request_body max_size 16KB`，推送报文很小，够用。

### 3.5 下单接口要点

- 校验 `productId` 在白名单、`env` 只能取配置值（生产恒 0）
- `outTradeNo`：**8–32 字符**，只允许数字/大小写字母/`_-`（官方限制 `[0-9A-Za-z_-|*@]`，不能以 `_` 开头）。建议 `'P' + Date.now().toString(36) + randomBytes(4).toString('hex')`
- 同一 openid 的未支付订单不做无限堆积：创建前把超过 2 小时的 `created` 订单置 `closed`
- 金额只信服务端目录；客户端传的价格一律忽略
- 限流：`limit('pay-order:' + rateIdentity(user), 10)`，防刷单
- 返回体只含下单必需字段（`signData` / `paySig` / `signature` / `outTradeNo` / `mode` / `env`），不含 AppKey、session_key

### 3.6 发货（推送）要点

1. 验签 + 解密（消息推送的 `signature` / `msg_signature` + `timestamp` / `nonce`，Token/EncodingAESKey 用后台配置值）。**验签失败直接丢弃**，别写库
2. 解析字段（XML 或 JSON，取决于后台「数据格式」选择；建议后台选 JSON，Node 端最省事）：
   `Event`、`OutTradeNo`、`Env`、`OpenId`、`GoodsInfo{ProductId,Quantity,OrigPrice,ActualPrice,Attach}`、`WeChatPayInfo{MchOrderNo,TransactionId,PaidTime}`
3. 校验：订单存在、`order.env === push.Env`、`order.productId === GoodsInfo.ProductId`、`order.amount === GoodsInfo.ActualPrice`
4. **幂等**：`if (order.status === 'delivered') return respondErrCode0()`。同一 `outTradeNo` 会被重推（最多 15 次）
5. 一次 `commit()` 内完成：订单 `delivered` + `access[accountId].expiresAt` 累加 + 月度 GMV 累加
6. 响应：XML 数据格式返回 `<xml><ErrCode>0</ErrCode>...</xml>`；JSON 数据格式返回 `{"ErrCode":0,"ErrMsg":"success"}`。**响应格式必须和推送格式一致**，否则微信会重推
7. 推送里不要做外部慢调用（微信超时会重推）；发货推送成功就**不需要**再调 `/xpay/notify_provide_goods`

### 3.7 查单兜底 + 定时对账

- 推送可能丢：`/pay/order/query` 在前端轮询时，如果本地订单 30 秒仍非 `delivered`，服务端调一次 `/xpay/query_order`（body：`{ openid, env, order_id }`，带 `pay_sig`）复核
- 进程内定时器每 5 分钟扫 `status='paid'` 或 `created` 超过 30 分钟的订单，逐单查单补发；单次处理上限 ~50 单，避免阻塞事件循环
- 每日 0 点（用 `now()` 判断跨天）汇总 `monthGmv`，写日志/通知管理员，不落额外文件

### 3.8 安全、限额与合规

- [ ] `AppKey`/`AppSecret` 不进日志、不进响应、不进小程序
- [ ] 推送只做「验签通过 + 订单存在 + 金额一致」才发货；不要信任 `FromUserName`
- [ ] 下单限流 + 单账号未支付订单上限（建议 10 单）
- [ ] 月 GMV 统计：达到 **9.5 万元** 告警，达到 **10 万元** 停止新单（回 `MONTHLY_LIMIT_REACHED`，小程序展示「本月额度已满，下月再来」）。个人主体超限会影响结算，宁可自己先拦
- [ ] 退款：Android 主动退要把天数扣回（`expiresAt = max(now(), expiresAt - days*DAY)`，只扣本次购买的天数，不扣别的）；iOS 退款由 Apple 决定，收到 `xpay_refund_notify` 只记状态 + 扣回，不主动退
- [ ] 对账：每日把 `orders` 的 `delivered` 单和 MP 后台「虚拟支付 → 交易订单」按 `MchOrderNo/WxOrderId` 抽样核对
- [ ] 状态文件备份：`upgrade.sh` 已打包 data 卷，新增订单后确认备份包含 `state.json`

### 3.9 服务端测试

沿用现有测试写法：`dsh-console/services/public-access/test/*.test.cjs`，用 `createService({ stateFile, now, exchangeCode, grantAccess, ... })` 起真服务；微信侧 HTTP 用**依赖注入的 fetch**（仿照 `huaweiFetch` 的参数模式，新增 `xpayFetch`）打桩。

必测用例：

- [ ] 下单签名与官方算法一致（固定 AppKey/session_key/固定时间，断言 hex）
- [ ] 同一 `outTradeNo` 重复推送只发一次货
- [ ] 推送金额/道具与订单不一致时拒绝且不写库
- [ ] 推送验签失败被拒绝
- [ ] 15007 时返回 `PAY_SESSION_EXPIRED`
- [ ] 查单兜底：无推送也发得出货
- [ ] 退款推送扣回天数、重复退款幂等
- [ ] 月 GMV 达阈值后拒单
- [ ] state v2 文件能平滑升级到 v3

运行命令（仓库根目录）：

```bash
node --test --test-reporter=spec tests/*.test.js \
  dsh-console/services/public-access/test/*.test.cjs \
  dsh-console/relay/public-access.test.cjs
```

---

## 4. 小程序端改造（`miniprogram/`）

### 4.1 新增/修改文件

| 文件 | 改动 | 优先级 |
| --- | --- | --- |
| `utils/access-api.js` | 导出内部 `request`（或新增 `payRequest`），避免复制登录/401 逻辑；新增 `catalog()`、`createOrder(code, productId)`、`queryOrder(outTradeNo)` | P0 |
| 新增 `utils/virtual-pay.js` | 能力检查、调起支付、轮询订单、错误码映射 | P0 |
| 新增 `pages/store/`（独立分包） | 商品列表、权益说明、购买按钮、结果态 | P0 |
| `app.json` | `subPackages` 增加 `pages/store`；可选加 `preloadRule` | P0 |
| `pages/settings/settings.js` / `.wxml` | 公网访问面板：未开通/已到期时按钮从「兑换续期」改为「开通/续期」跳 store；兑换码入口保留为次要入口 | P0 |
| `utils/privacy-policy.js` | 补充支付/订单信息处理说明 | P0 |
| `resources/i18n/interface.json` | 新增文案英文条目，然后跑 `node scripts/sync-i18n.cjs` | P1 |
| `docs/privacy-guideline-filing.md` | 补提审用的隐私接口说明（如新增客服/位置等则不涉及） | P1 |

### 4.2 页面入口与状态

- 入口一：设置 → 公网访问面板（已到期/未开通时主按钮「开通/续期」）
- 入口二：侧栏额度卡片/连接失败提示里的「公网已到期」气泡（现有 `public-access-prompt` 文案可复用）
- store 页首行要能说明「这是给公网中继续期的虚拟商品；局域网直连不受影响」，避免用户误以为必须购买

### 4.3 下单流程（前端时序）

```js
async function buy(productId) {
  // 1. 能力检查（见 4.4）
  // 2. 新鲜 code：wx.login
  const code = await new Promise((res, rej) => wx.login({ success: r => r.code ? res(r.code) : rej(), fail: rej }));
  // 3. 服务端下单 + 双签名
  const order = await api.createOrder(code, productId);
  // 4. 调起支付（signData 必须是字符串）
  wx.requestVirtualPayment({
    signData: order.signData, paySig: order.paySig, signature: order.signature,
    mode: 'short_series_goods',
    success: () => poll(order.outTradeNo),
    fail: (e) => handlePayError(e) // -2 取消不报错
  });
}
```

- **success 回调不能作为发货依据**（官方明确可能丢失），页面只负责轮询 `/pay/order/query`
- 轮询：1s/2s/3s 三次，仍未确认则显示「支付结果确认中，到账后自动生效」，并允许手动刷新
- 未支付订单 30 分钟后失效，重试购买会生成新 `outTradeNo`
- iOS 端在支付前先校验微信版本 ≥ 8.0.68（官方要求 iOS 15+、中国大陆 App Store 账号）

### 4.4 能力与版本检查

```js
// 基础库 2.19.2+ 支持；低版本用 canIUse 兜底
function paySupported() {
  const sdk = wx.getAppBaseInfo ? wx.getAppBaseInfo().SDKVersion : wx.getSystemInfoSync().SDKVersion;
  return compareVersion(sdk, '2.19.2') >= 0 || wx.canIUse('requestVirtualPayment');
}
```

- 不支持时按钮置灰 + 提示「升级微信后可用」，不要静默失败
- 沙箱环境（`env=1`）只在 Android 等终端可用，Apple 支付不支持沙箱；开发期用 `XPAY_ENV=1` + 测试道具

### 4.5 文案与合规（提审会看）

- [ ] 明确「虚拟商品，支付后即时生效，不适用七天无理由退货」
- [ ] 价格、权益天数、有效期展示与后台道具一致
- [ ] 退款说明：Android 等终端可联系客服退款；iOS 需在 App Store 申请，开发者无法主动退款
- [ ] 客服入口（`button open-type="contact"`，MP 后台配置客服）
- [ ] 隐私政策补充：处理微信 openid、订单号、支付结果；不收集支付密码/银行卡信息
- [ ] 用户协议/购买须知可从小程序内打开（本地页面即可，避免外链限制）

### 4.6 包体积与 i18n

- store 页放**独立分包**，不占主包预算（`scripts/check-miniprogram-package.cjs` 主包源码预算 1.40 MiB）
- 新文案中文直接作为 key，英文加到 `resources/i18n/interface.json`，再 `node scripts/sync-i18n.cjs`
- 改动后按 README 流程：`node scripts/check-miniprogram-package.cjs` → `node scripts/stamp-build.cjs` → 开发者工具编译

---

## 5. 验收清单

### 5.1 沙箱（仅 Android）

- [ ] `env=1` 下单 → 微信支付沙箱收银台 → 支付成功 → 推送到达 → 天数增加
- [ ] 取消支付（-2）：无订单残留、无报错弹窗
- [ ] 重复点购买：生成新单号，不重复发货
- [ ] 停掉推送配置 → 支付 → 查单兜底补发
- [ ] 伪造推送（错误签名）→ 被拒
- [ ] 篡改金额/道具 ID → 下单即拒

### 5.2 现网 Android

- [ ] 1 分钱测试道具全链路（正式道具建议 1 元以上）
- [ ] 支付成功但立刻杀进程 → 重新进入后权益已到账
- [ ] 退款：后台/接口发起 → `xpay_refund_notify` → 天数扣回

### 5.3 iOS 真机（无沙箱）

- [ ] 微信 8.0.68+、iOS 15+、中国大陆 Apple 账号
- [ ] 支付面板显示小程序简称（display name）
- [ ] 支付成功 → 权益到账；Apple 扣费 12%
- [ ] 测试退款问询推送能正常应答（否则 Apple 按「不确定」处理）

### 5.4 安全与异常

- [ ] 未登录调 `/pay/order` → 401
- [ ] 越权查询别人订单 → 403/404
- [ ] `outTradeNo` 重放 → 15002 或服务端幂等
- [ ] 推送重试 15 次内不重复发货
- [ ] 月 GMV 达阈值 → 停单提示正确

### 5.5 对账与限额

- [ ] 交易订单页与本地 `orders` 抽样一致（单号、金额、状态）
- [ ] 月度 GMV 与后台账单一致（T+3 结算后复核）
- [ ] 限额告警在 9.5 万触发

---

## 6. 发布顺序与回滚

1. 服务端先上（推送 URL 可达、验签通过），小程序先不发购买入口
2. MP 后台建道具并发布（等 ~10 分钟生效）
3. 小程序提审（类目/虚拟支付/文案/隐私）
4. 灰度：先放开 store 入口给管理员/内测名单，观察 1~2 天
5. 全量

回滚：关闭 store 入口按钮即可（服务端保留接口，兑换码链路不受影响）；中继与权益模型没有改动，回滚风险低。

---

## 7. 风险与限制

| 风险 | 影响 | 对策 |
| --- | --- | --- |
| 类目里没有「工具」 | 无法开通，直接被拒 | 先补类目再开工 |
| 个人主体月限额 10 万 | 超限后无法收款 | 服务端提前拦单 + 告警 |
| iOS 退款不可控 | 用户退款后权益仍在 | 收退款推送扣回；接受 Apple 裁决 |
| iOS 结算 45–60 天 | 现金流慢 | 定价/备货考虑周期 |
| 道具发布 10 分钟生效 | 联调误报 15014 | 建道具后等待再测 |
| 推送丢失/格式错误 | 发货延迟 | 查单兜底 + 响应格式严格匹配 |
| 状态文件单实例 | 多进程写入损坏 | 保持单实例；扩容前改数据库 |
| 兑换码与支付并存 | 权益重复发放 | 两条路径共用同一累加逻辑，天然去重 |
| Apple 审核 3.1.1 | 虚拟商品必须走 IAP | 走官方虚拟支付即合规，不接第三方支付 |

---

## 8. 待办汇总（按优先级）

**P0（不做完不能提审）**

- [ ] MP 后台：类目/认证/备案/虚拟支付开通/签约/简称/iOS IAP/道具发布/推送配置
- [ ] 服务端：`pay-catalog.cjs`、`virtual-payment.cjs`、`server.cjs` 路由 + state v3 + 发货 + 查单 + 限额
- [ ] 小程序：`access-api` 导出 request、`virtual-pay.js`、`pages/store` 分包、settings 入口、隐私政策
- [ ] 测试：签名、幂等、金额校验、15007、兜底查单
- [ ] 真机验收：Android 沙箱 + 现网、iOS 现网

**P1（上线后 1~2 周）**

- [ ] 订单管理页（`/admin/orders`，不含退款也能查单）
- [ ] 退款接口与扣回逻辑
- [ ] 月度 GMV 告警（9.5 万）
- [ ] i18n 英文文案、README/部署文档更新
- [ ] 对账脚本/日志

**P2（有余力再做）**

- [ ] AppKey 迁移到网页加密配置（`console.cjs`）
- [ ] 订单导出、账单核对自动化
- [ ] 优惠价 `activitySellingPrice`（优惠券/活动）

---

## 附录 A：关键接口与签名速查

- 客户端：`wx.requestVirtualPayment({ signData, paySig, signature, mode })`，基础库 ≥ 2.19.2；`mode: 'short_series_goods'`
- 服务端：`https://api.weixin.qq.com/xpay/query_order?access_token=...&pay_sig=...`，`pay_sig = HMAC-SHA256(AppKey, '/xpay/query_order&' + body)`
- access_token：用 `/cgi-bin/stable_token` 获取并缓存（避免与其它服务互踢）
- 推送事件：发货 `xpay_goods_deliver_notify`、退款 `xpay_refund_notify`、投诉 `xpay_complaint_notify`、风控 `xpay_wxpay_callback_notify`、iOS 退款问询 `xpay_subscribe_ios_refund_query_notify`
- 推送响应：`ErrCode: 0`（XML/JSON 与推送格式一致），失败会重试最多 15 次
- 发货完成通知：推送返回成功即可，无需调 `/xpay/notify_provide_goods`

## 附录 B：错误码速查

| 码 | 含义 | 处理 |
| --- | --- | --- |
| -1 | 支付失败 | 提示重试 |
| -2 | 支付取消 | 静默返回 |
| -4 | 风控拦截 | 提示联系客服 |
| -5 | 签约结果未知 | 轮询订单 |
| 15002 | outTradeNo 重复 | 换新单号重试 |
| 15005 | signature 错误 | 检查 session_key 是否新 |
| 15006 | paySig 错误 | 检查 AppKey/uri/拼接 |
| 15007 | session_key 过期 | 重新 wx.login |
| 15010 | 道具未发布 | 后台发布等 10 分钟 |
| 15011 | 现网 env 只能 0 | 检查 XPAY_ENV |
| 15013 | 道具价格错误 | 三处价格对齐 |
| 15014 | 道具发布未生效 | 等 ~10 分钟 |
| 15017/15019 | 商家违规受限 | 看商户平台通知 |
| 15021 | 小程序被限频 | 降低下单频率 |

## 附录 C：官方链接

- [虚拟支付：个人](https://developers.weixin.qq.com/miniprogram/dev/platform-capabilities/business-capabilities/virtual-payment/person.html)
- [虚拟支付：企业、个体户（API/推送/费率/结算）](https://developers.weixin.qq.com/miniprogram/dev/platform-capabilities/business-capabilities/virtual-payment.html)
- [wx.requestVirtualPayment](https://developers.weixin.qq.com/miniprogram/dev/api/payment/wx.requestVirtualPayment.html)
- [云端 AI 接入虚拟支付（个人主体注意事项）](https://developers.weixin.qq.com/miniprogram/dev/wxcloudservice/wxcloud/guide/wechatpay/ai-virtualpayl-person.html)
