# 费用计量（`cost-meter-v1`）

当 Host 提供 `costMeter` 服务时，配对连接的 `hello.capabilities` 包含 `cost-meter-v1`，客户端可通过控制连接调用该服务。Host 未提供该服务时能力不出现，请求返回 `cost-meter-unavailable`。

## 请求格式

```json
{ "type": "cost-meter", "requestId": "req-1", "method": "getState", "args": [] }
```

| 字段 | 说明 |
| --- | --- |
| `type` | 固定为 `cost-meter` |
| `requestId` | 请求唯一标识，最多 128 字符 |
| `method` | 调用的方法名（见下表） |
| `args` | 方法参数数组（可选） |
| `client` | 客户端信息（可选） |

## 响应格式

```json
{ "kind": "cost-meter", "requestId": "req-1", "method": "getState", "result": { ... } }
```

## 可用方法

| 方法 | 参数 | 返回值 | 说明 |
| --- | --- | --- | --- |
| `getState` | - | `CostState` | 读取今日/本月/累计聚合、历史记录与当前配置 |
| `getStateSince` | `pricesRev` | `CostState` | 按已知价格版本读取状态 |
| `getBillingStatistics` | `StatisticsQuery` | `BillingStatistics` | 读取费用统计（日期范围、供应商、模型过滤） |
| `getSessionBilling` | `StatisticsQuery` | `SessionBilling` | 读取会话费用明细 |
| `getSessionCost` | `sessionId` | `SessionCost` | 读取单个会话的成本 |
| `getSessionListCosts` | `{ sessionIds, period }` | `Session[]` | 批量读取会话费用 |
| `getTurnCost` | `sessionId, startSeq, endSeq, displayCurrency?` | `TurnCost` | 读取轮次用量与估算费用 |
| `getTopSessions` | `limit, sort?, dir?` | `TopSessions` | 获取费用最高的前 N 个会话 |
| `getDaySessions` | `date` | `DayRecord` | 读取某一天的完整记录 |
| `getTurnInspection` | `TurnInspectionQuery` | `TurnInspection` | 轮次检查详情 |
| `getCallInspection` | `CallInspectionQuery` | `CallInspection` | 调用检查详情 |
| `getSessionTrajectory` | `TrajectoryQuery` | `Trajectory` | 会话轨迹 |
| `getContextCosts` | `ContextCostsQuery` | `ContextCosts` | 上下文成本 |
| `updateConfig` | `ConfigPatch` | `CostState` | 深合并配置并持久化 |
| `fetchPrices` | - | `FetchPricesResult` | 从官方页面同步价格 |
| `getRepricingHistory` | - | `RepricingHistory` | 读取历史重算前后的金额 |
| `getPriceCatalog` | - | `PriceCatalog` | 读取内置价格目录 |
| `getOpenRouterCatalog` | - | `OpenRouterCatalog` | 读取公开模型价格 |
| `refreshBalance` | - | `FetchPricesResult` | 立即查询官方账户余额 |
| `refreshGoQuota` | - | `FetchPricesResult` | 立即查询 OpenCode Go 订阅额度 |
| `refreshGatewayQuota` | `sourceId?` | `FetchPricesResult` | 立即刷新 CLIProxyAPI gateway 额度 |
| `refreshCustomBalance` | `index?` | `FetchPricesResult` | 立即查询自定义 Provider 余额 |
| `refreshCodingPlan` | `provider` | `FetchPricesResult` | 立即查询指定厂商的 Coding Plan 额度 |
| `repriceHistory` | `confirmed` | `FetchPricesResult` | 确认后按当前价格重算历史 |
| `resetHistory` | - | `CostState` | 清空全部历史记录 |
| `setCredential` | `target, value` | `FetchPricesResult` | 写入凭据到 DSH 凭据库 |
| `clearCredential` | `target` | `FetchPricesResult` | 从凭据库移除凭据 |

## 错误码

- `bad-request`：请求参数无效
- `cost-meter-unavailable`：费用计量服务不可用或调用失败

## 关键数据结构（`CostState`）

```json
{
  "today": { "date": "2026-10-22", "input": 1000, "output": 2000, "cost": 0.025, ... },
  "month": { "date": "2026-10", "input": 30000, "output": 50000, "cost": 0.75, ... },
  "total": { "input": 100000, "output": 200000, "cost": 3.5, ... },
  "history": [ /* 过去 N 天的汇总 */ ],
  "balance": { "value": [{ "currency": "USD", "total": 50 }], "status": "ready" } | null,
  "config": { "prices": { "currency": "USD", "default": { "cacheHit": 0.003, ... } }, ... },
  "codingPlans": { "deepseek": { "quota": 1000, "used": 100 }, ... },
  "gatewayQuotas": [ /* CLIProxyAPI 额度 */ ],
  "customBalances": [ /* 自定义余额配置 */ ]
}
```