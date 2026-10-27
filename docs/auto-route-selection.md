# 全网络自动选路（Auto Route Selection）

一个二维码同时携带**局域网 / 公网直连 / 托管中继**三类线路，客户端按自己的网络能力自动挑选：
手机在局域网内就连局域网，在外网就自动走各自的公网线路。用户不需要判断当前在哪个网络，也不需要切换主机。

两类客户端能用的公网线路完全不同，这是整个设计的前提：

| 客户端 | 公网线路 | 原因 |
| --- | --- | --- |
| 微信小程序 | **托管中继**（域名已列入小程序 socket 合法域名列表） | 小程序 socket 必须命中合法域名；运营者自己的 Cloudflare 快速隧道每次重启换域名、反代域名也不会逐个登记，硬连只会拿到 url not in domain list——这就是历史上「手机扫码显示地址主机未确认」的来源 |
| 多端 App / 原生 App | **公网直连**（Cloudflare/反代/隧道，任意 wss） | 没有合法域名限制；也没有微信登录，换不到托管中继租赁，不使用中继 |

## 1. 二维码载荷：routes 字段

v2 配对载荷新增可选的 routes 字段（老客户端直接忽略，向后兼容）：

```json
{
  "version": 2,
  "publicUrl": "wss://nas.example.com/ws/mobile",
  "pairingCode": "…",
  "expiresAt": 1790000000000,
  "gatewayId": "…",
  "endpoints": ["wss://nas.example.com/ws/mobile", "ws://192.168.1.10:3081/ws/mobile"],
  "routes": {
    "lan": ["ws://192.168.1.10:3081/ws/mobile"],
    "public": ["wss://nas.example.com/ws/mobile"],
    "relay": {
      "relay": "wss://dsh.ahwe.top/relay",
      "nodeId": "…",
      "agentPubKey": "…",
      "gatewayName": "家里电脑",
      "authMode": "gateway"
    }
  },
  "miniProgramRoute": { "…": "保持不变，旧版小程序仍按它选路" }
}
```

字段规则：

| 字段 | 含义 | 约束 |
| --- | --- | --- |
| lan | 局域网直连地址 | ws:// 私网/本机，或 wss:// 私网（套了 TLS 仍算局域网） |
| public | 公网直连地址（用户自己的域名/反代/隧道） | 必须 wss:// 非私网主机；仅 App 使用 |
| relay | 托管中继条目 | relay 必须公网 wss://；nodeId 8–128 位 URL 安全字符；agentPubKey 32 字节 Base64；authMode 为 gateway（连接器回拨） |

v3 中继载荷（mode: 'relay'）不变：只有中继一条线路，小程序与 App 都只连中继地址。

### 插件什么时候输出 routes

dsh-plugin-weapp-gateway 的 POST /mgw/pair：

- 多客户端二维码（带 route）：auto / cloudflare / custom 输出完整路由表；lan 是运营者明确选择的「只给局域网」，不输出 routes
- 旧版单二维码（不带 route）：v2 直连载荷总是输出路由表——即使配对模式是 direct，已注册的中继也一并带上，小程序在外网时才有公网线路可用

## 2. 客户端选路顺序

首选 = 上次真正连通的地址（档案 preferredEndpoint），其后按客户端能力排序：

| 客户端 | 候选顺序 |
| --- | --- |
| 微信小程序 | 首选 → **托管中继** → 局域网（不碰公网直连） |
| 多端 App / 原生 App | 首选 → **公网直连** → 局域网（不碰托管中继） |
| v3 中继二维码 | 中继（唯一） |

三条硬规则：

1. **小程序不拨公网直连地址**。Cloudflare/反代域名基本不在 socket 合法域名里，拨了只会快速失败并浪费一个候选；中继才是小程序的公网。手动输入公网地址时直接返回明确错误（见下），不做无谓尝试。
2. **中继授权失败必须继续回退**。托管中继取不到租赁（未兑换/已到期/服务不可用）时，配对流程继续尝试局域网候选——否则没兑换公网的用户即使和电脑在同一局域网也连不上。配对码本身仍然有效，错误信息不谎称「配对码已失效」。
3. **档案的认证模型跟随真正连通的线路**。v2 直连载荷一律先按直连档案配对；只有真正经中继连通后才把档案升级成中继档案（gatewayId 换成中继 nodeId，与 v3 一致），后续重连才会带 E2EE 元信息。反过来，局域网配对的档案不会保留中继候选——没有中继凭据，硬连只会认证失败。

## 3. 连接过程

- 每个候选有独立短超时（直连 8s，中继/已保存凭据 30s）：不可达的内网地址不会把「换下一条线路」拖到一分钟以上
- 传输建立后换回长超时：握手/鉴权慢 ≠ 线路不可达
- 任候选失败即按顺序尝试下一个；配对码只在真正握手的候选上消耗；中继候选的回退携带完整 E2EE 元信息（relay/nodeId/agentPubKey），不会降级成普通 socket
- 中继侧的拒绝（连接器离线 4001、连接器版本过旧 4004、授权不通过、E2EE 验签失败）在**配对期不是终止性错误**：二维码里还有局域网候选，继续往下试；已保存凭据的重连保持原语义——直接把原因显示出来，不悄悄换线
- 托管中继取不到租赁（未兑换/已到期）同理：配对期继续试局域网，且错误信息不会谎称「配对码已失效」
- 连接成功记住该地址为首选
- 所有候选都是局域网且全部失败时，错误信息会点明「二维码只包含局域网地址，请配置公网地址或中继」——对小程序而言就是「去配置中继」
- 小程序手动输入公网地址：返回「微信小程序不能直接连接公网地址……」，不做连接尝试

## 4. 原生 App（鸿蒙 / iOS）实现要点

1. 解析 routes（缺省时从 publicUrl + endpoints 按地址特征推导，与小程序 route-table.parseRouteTable 同规则）
2. 候选顺序：首选 → public → lan；不使用 relay（没有微信登录换不到租赁）
3. relay 条目的 endpoint 为 relay 去尾斜杠后拼 /c/ + nodeId
4. 每个候选独立超时；失败即下一个；成功后记住首选

## 5. 代码位置

| 位置 | 职责 |
| --- | --- |
| miniprogram/utils/route-table.js | 纯选路逻辑：地址分类、路由表解析/校验、候选排序（allowedFamilies 决定两端顺序） |
| miniprogram/utils/runtime.js | 运行时识别（微信小程序 vs 多端容器） |
| miniprogram/utils/pairing.js | 解析 routes 并挂到载荷；老载荷自动推导 |
| miniprogram/utils/store.js | 按运行时排序候选、路由表持久化、中继档案升级、按候选线路族构建连接参数 |
| miniprogram/utils/gateway.js | 候选短超时、中继授权失败继续回退、中继回退元信息、局域网-only 提示 |
| dsh-plugin-weapp-gateway/lib/index.mjs | /mgw/pair 输出路由表（两个分支） |
| tests/auto-route-selection.test.js | 选路、运行时识别、回退、租赁失败回退、store 集成测试 |

