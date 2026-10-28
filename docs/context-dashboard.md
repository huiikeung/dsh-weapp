# 会话「上下文」面板（移植 dsh-context）实现契约 v1

目标：把 `dsh-context` 插件的上下文洞察能力移植进小程序会话页，作为与
「对话」「轨迹」同一排的第三个分段 **「上下文」**。数据由小程序网关
（`dsh-plugin-mobile-gateway` / `dsh-plugin-weapp-gateway`）内新增的
session projection + 查询帧提供；小程序端只渲染，不重算事件日志。

参考实现：`bowenliang123/dsh-context` v0.74.0（Apache-2.0），本仓库只移植
其「Context tab」核心卡片，不含 Fleet/编队、Context Browser 全文、File Activity、
记忆系统与 Context Insights 独立页。

## 1. 数据来源与分块

| 数据 | 来源 |
| --- | --- |
| 当前组成 `current`、请求趋势 `requests`、上下文事件 `events`、工具调用计数、耗时 `wallMs`、注入/压缩/剪枝计数、技能加载数 | 本仓库网关桥新增投影 `mobileContext` |
| 官方组成 `breakdown`（system/tools/messages） | DSH 自带 `contextBreakdown` 投影（同一次 history 快照里读取） |
| 计费 token `usage` | DSH 自带 `tokenUsage` 投影 |
| 轮次/步骤/耗时 | DSH 自带 `sessionStats` 投影 |

投影由 `scripts/install-context-bridge.cjs` 注入**实际生效的**网关插件（两种网关都支持。
桌面 profile 的 `dependencies` 可能用 `link:` 指向独立 checkout，先
`readlink ~/.dsh/profiles/desktop/node_modules/dsh-plugin-weapp-gateway` 解析真实目录再安装），
小程序通过 `context-dashboard` 帧读取。旧网关/未安装桥时返回
`context-unavailable`，小程序显示可操作的空态（提示升级网关），不报错崩溃。

## 2. Host 侧：`mobileContext` 投影

- key：`mobileContext`，`stateVersion: 1`。
- 注册：网关插件 `apply()` 内 `ctx.inject(['sessionProjections'], ...)` 注册；
  桥文件 `scripts/lib/context-bridge.mjs` 自包含（除 `zod` 外不依赖 DSH 包）。
- fold 规则对齐 DSH `dsh-token-meter`（保证 `systemTokens/toolsTokens/messageTokens`
  与官方 `contextBreakdown` 精确一致），分类对齐 `dsh-context/src/host/fold.ts`：
  - 事件集合：`system/message`、`developer/message`、`user/message`、
    `assistant/message`、`tool/result`（仅当事件带 `surfaceOp`）。
  - token 估算：DSH 固定密度启发式（4 字符 ≈ 1 token，每 block +4，role +4；
    image block 按结构 JSON 估算；`system/message` 用系统提示词公式）。
  - `request/header` → `toolsTokens = ceil(JSON.stringify(canonicalHeader(header).tools).length/4)+4`，
    并记录 `config.model/provider`。
  - `request/context` → `contextWindow/model/provider`。
  - `surfaceOp` 为 `{op:'replace',startSeq,endSeq}` 的替换事件：找到节点区间
    splice 替换（与 DSH breakdown 一致）；找不到端点时退化为 append。
  - 分类：`assistant/message`→assistant；`tool/result`→tool；
    `developer/message`→inject；`source.kind` 为 `user` 或缺失→user；
    `source.kind` 为 `skill-invocation`/`skill-catalog`→skill；其余→inject。
    配对的 tool 名为 `skill` 且结果文本含 `<skill_content name="…">` 时，该
    tool/result 改判 skill（技能加载），并从 tool 移到 skill。
    `system/message` 不计入 5 类，只更新 `systemTokens`。
  - 计数：`humanInputs`（非注入 user/message）、`answers`（有文本的 assistant/message，
    客户端显示为「模型回复」）、`toolCalls`（有成对 call 名的 tool/result，按名计数）、
    `skillLoads`（skill 工具加载 + `/skill` 调用，不含 skills 目录注入）、
    `injects`、`compactions`、`prunes`。
  - **休眠 system 节点**：replace 型 `system/message` 会就地替换旧节点；从未被替换、
    且不是当前生效节点的旧 system 节点（append 后残留）称为 dormant。
    `current.system` 只取「最后一个非空 system 节点」（与 harness 的规则一致），
    其余 dormant system 节点不计入 5 类。因此 `sums` 合计 = 官方 `messageTokens` −
    dormant system 节点 token；客户端 Token 卡用官方 `breakdown` 锚定总数，比例来自
    `current`，与 dsh-context 行为一致。
  - `requests`：每个 `assistant/message` 在把该回复加入 surface **之前**记录一条
    `{seq,time,turn,step,system,tools,user,inject,skill,assistant,tool,total}`；
    只保留最近 300 条（v2 起为 200 条），超出置 `truncated.requests=true`。
    `assistant/message` 同时把该步的请求序号记成 `stepRequestSeq`，`step/end`
    把本步活跃时长（`step/end`−`step/start`，减去审批与 `ask_user_question`
    等待的钳制并集）盖回该记录成为 `activeMs`——趋势图耗时折线的数据源
    （与 dsh-context fold.ts 的 `step/end` 同规则）。记录被裁剪或步未闭合时
    不盖章（序号对不上就跳过），绝不误盖到更新的记录。
  - `events`：`inject/compaction/prune`（注入来自 user/developer 非普通用户消息、
    技能加载；压缩/剪枝来自 `compaction/summary` / `compaction/prune`），保留最近 120 条。
  - `wallMs`：`step/start`→`step/end` 累计，减去审批等待（`approval/asked`→`approval/decided`）
    与 `ask_user_question` 工具等待。
  - `tool/call` 记录 `callId → {name,start}`，`tool/result` 消费并配对。
  - 压缩/剪枝的 token 回收量：`compaction/summary|prune.data.shadowedTokenCount` 原样计入事件。

状态上限（防止缓存膨胀）：surface 节点 4000、requests 300、events 120；
裁剪 surface 时同步扣减分类合计，并置 `truncated.surface=true`。

### 2.1 投影 wire view

```json
{
  "v": 1,
  "model": "glm-5.3-flash",
  "provider": "zaicoding",
  "contextWindow": 262144,
  "current": {"system":2154,"tools":10439,"user":123,"inject":456,"skill":78,"assistant":9000,"tool":3000,"total":25250},
  "counts": {"humanInputs":12,"answers":16,"toolCalls":4304,"skillLoads":0,"injects":700,"compactions":12,"prunes":42},
  "tools": {"total":4304,"names":[{"name":"bash","count":221},{"name":"read","count":32}]},
  "timing": {"wallMs":4980000},
  "requests": [{"seq":53,"time":1791807408490,"turn":2,"step":1,"system":2154,"tools":10439,"total":12593}],
  "events": [{"seq":1065,"time":1791818836065,"kind":"compaction","tokens":128609,"count":279}],
  "truncated": {"requests":false,"events":false,"surface":false}
}
```

`tools.names` 按 count 降序，最多 20 项；其余由客户端显示为「其他 +N」。
`requests` 记录只输出大于 0 的分类键（`system`/`tools`/`total` 恒有），客户端
缺失键按 0 处理。所有字段必须是无 `undefined` 的纯 JSON。

## 3. 网关查询帧

请求：`{"type":"context-dashboard","sessionId":"<id>"}`

响应：
```json
{
  "kind": "context-dashboard",
  "sessionId": "session-abc",
  "asOfSeq": 32619,
  "value": {
    "...": "mobileContext wire view",
    "breakdown": {"systemTokens":2154,"toolsTokens":10439,"messageTokens":475830},
    "usage": {"uncachedInputTokens":18428410,"outputTokens":2005193,"cacheReadTokens":1418019922,"cacheWriteTokens":757534},
    "stats": {"turns":476,"steps":4586,"llmMs":42456270,"toolMs":12253849,"ttftMs":19504165,"ttftSteps":4566,"decodeMs":22898931,"decodeTokens":2005193}
  }
}
```

不可用：`{"kind":"error","code":"context-unavailable","requestType":"context-dashboard","sessionId":"…","message":"…"}`
（旧网关：未知 type 会回 `unknown-command`；小程序两种都按「需升级网关」处理。）

## 4. 客户端派生规则（对齐 dsh-context）

- `input = uncachedInputTokens + cacheReadTokens + cacheWriteTokens`；
  `total = input + outputTokens`（与输入框统计条同一口径）。
- 组成分类（固定顺序与颜色语义）：
  1. 系统提示词 `system`
  2. 工具定义 `tools`
  3. 用户消息 `user`
  4. 注入内容 `inject`
  5. 技能注入 `skill`
  6. 助手消息 `assistant`
  7. 工具结果 `tool`
  8. 输出 `output`（provider 精确值，不参与 ≈）
- 官方值锚定：`system = breakdown.systemTokens ?? current.system`，
  `tools = breakdown.toolsTokens ?? current.tools`，
  `messages = breakdown.messageTokens ?? (user+inject+skill+assistant+tool)`；
  五类消息按 `current` 比例拆分（最大类吸收四舍五入残差）。
- 计费分摊：把上面估算的 prompt 组成按比例缩放到 `input`，`output` 原值。
  估算项显示 `≈`，`output` 精确；总数为精确值。
- 缓存命中率：`cacheReadTokens / input * 100`（一位小数）。
- 耗时：模型等待 = `ttftMs`/`ttftSteps` 次；模型回复 = `decodeMs`/`answers` 次
  （answers 为 0 时退回 `stats.steps`）；工具执行 = `toolMs`/`toolCalls` 次；
  活跃时长 = `timing.wallMs`。
- 上下文事件：注入 = `injects`、压缩 = `compactions`、剪枝 = `prunes`。
- 趋势图：`requests` 升序，每根柱按 7 类组成堆叠（system/tools/user/inject/skill/assistant/tool），
  柱高 = `total`；`events` 中 compaction/prune 在对应 seq 处标 `✂`。
  `requests.length > 120` 时按 turn 聚合（取该轮最后一条），避免柱子过密。
- 耗时折线：`requests[].activeMs` 画成一条折线骑在柱区上（y 按 `maxActiveMs`
  缩放，右侧配 5 档时长轴），孤立单点用圆点；轮次聚焦时随柱子一起淡出。无
  `activeMs` 数据时不画曲线也不画右轴（客户端 `hasDuration` 门控）。
  **渲染方式**：小程序对内联 `<svg>` 支持不稳定（会话页 ctx-flow 的连接带同为
  此改用原生线段），折线由旋转细条拼成——每相邻两点一根 halo（卡面色，垫对比）
  加一根 core（灰，曲线本身），圆头（border-radius=半高）代替 round linecap；
  柱模式 x 落在柱心（与实时探针竖线同坐标），总览模式 x 由记录序号中心按实测
  可视宽换算（量不到时退回 375pt 解析值，页面量到后重建对齐）。
- 实时探针（触摸）：手指在柱区/总览带上滑动时，命中的柱子描边高亮，一条
  品牌色竖线钉在该柱上，线顶浮动一张指标卡（轮次·步号、估算合计、耗时、Δ），
  卡片锚点按可视宽钳制，首/末柱也不会伸出图表；抬手后恢复选中态的详情。
  点击柱子=钉住（选中），图表上的手势不再冒泡成面板级左右滑切换分段。

## 5. 界面要求（v1）

会话页分段新增「上下文」：`对话 | 轨迹 | 上下文`，与现有 segmented control
同排同风格（含滑动手势：conversation ⇄ trajectory 保持，trajectory ⇄ context 也支持）。
面板滚动区，卡片：

1. **统计**
   - 工具调用卡：总数 + 前 3 工具名及次数 + 「其他 +N」。
   - 当前会话卡：轮次、步数、技能加载、模型回复（2×2）。
   - 上下文事件卡：注入 / 压缩 / 剪枝 三个 chip 计数。
   - 会话用量卡：总 token（75.2M 格式）+ 缓存命中率。
2. **Token 统计**：组成条（横向堆叠色条或环形）+ 8 行图例（色点、名称、百分比、≈token）；
   标题右侧缓存命中率；总数居中/置顶。
3. **耗时统计**：活跃时长大字 + 三段横向条（模型等待/模型回复/工具执行），
   每段显示百分比、时长、次数。
4. **上下文趋势**：横向滚动堆叠柱图 + 压缩标记 + 轮次轴；无需交互详情。
5. **上下文事件**（可选）：最近事件列表（时间、类型、名称、token 变化）。

> 统计卡中的 Agent 网络/编队属后续版本；v1 用「会话用量」卡（总 token + 缓存命中率）替代。

### 5.1 已在真实会话上验证的口径（32620 事件、v4 日志）

- `current.system` = 2154、`current.tools` = 10439，与 DSH `contextBreakdown` 精确一致；
  5 类合计 471523 = `messageTokens`(475830) − 休眠 system 节点(4307)。
- 计数：humanInputs 502、answers 1233、toolCalls 4262、skillLoads 5、injects 278、
  compactions 12、prunes 42；`tools.names` 前 20 截断。
- `requests` 截断为 200 条（v2；`truncated.requests=true`）、`events` 120 条、`spans` 600 段；
  wire 大小 ≈ 90KB（< 250KB 预算），fold 全量 32.6k 事件耗时 ≈ 130ms。
- v2 真实日志数值：activity 502/333/460/81/75；timing wall 54,545,763、ttft 17,109,907、
  reasoning 13,664,807、text 2,463,399、toolArg 8,790,429、tools 12,253,849、other 263,372；
  speed 2,005,193 tok / 22,898,931 ms；stateVersion 升为 2（旧缓存整段 refold）。

状态：
- 加载中：骨架/spinner；
- 无会话/未连接：提示；
- `context-unavailable`/`unknown-command`：提示「需升级网关以显示上下文」；
- 其他错误：错误文案 + 重试按钮。
刷新：进入 tab、回合结束（turn/end 后 800ms 内）、手动点卡片区刷新。
深浅色、i18n（中文/英文）与现有页面一致。数字缩写：`k`/`M`（一位小数）。

## 6. 文件与职责

| 文件 | 负责 |
| --- | --- |
| `scripts/lib/context-bridge.mjs` | 投影 fold + 查询 handler |
| `scripts/install-context-bridge.cjs` | 注入两种已安装网关 |
| `tests/context-bridge.test.js` | fold 单测 + 真实会话 oracle |
| `miniprogram/utils/context-view.js` | 纯数据派生（token 分摊、耗时、趋势聚合） |
| `miniprogram/utils/gateway.js` | `requestContextDashboard` |
| `miniprogram/utils/store.js` | 帧处理与状态 |
| `miniprogram/pages/session/session.{js,wxml,wxss}` | 分段与面板 |
| `resources/i18n/*.json` + `miniprogram/i18n/*.js` | 文案 |
| `tests/context-view.test.js` | 派生规则单测 |
| `README.md`、`CHANGELOG.md`、`docs/` | 文档 |

## 7. 「编队」分段（Fleet，v1.1）

同一排第四个分段「编队」展示当前 Agent 的家族网络（当前 Agent、父链、全部
子 Agent）。数据由网关桥新增 `context-fleet` 请求在宿主侧汇总，小程序只渲染。

### 7.1 Host 侧数据来源

- `ctx.sessions.list()`：每行的 `header` 含 `parentSession` / `origin` / `createdAt`；
  `origin === 'subagent'` 的行是子 Agent。
- 由当前会话沿 `parentSession` 上溯到 root，再从 root 按 `origin === 'subagent'`
  的 `parentSession` 关系下溯，得到家族（最多 40 个 Agent）。
- 每个家族会话读取一次投影快照（`ctx.sessionProjections.snapshot(session)`）：
  `title`、`contextPressure`、`tokenUsage`、`sessionStats`、`subagentTiming`、
  `subagent`（mode/label）、本桥的 `mobileContext.current`。
- `running`：`ctx.agents.get(sessionId)?.status === 'running'`（无 agents 服务时一律 false）。

### 7.2 请求/响应

请求：`{"type":"context-fleet","sessionId":"<当前会话 id>"}`

响应：
```json
{
  "kind": "context-fleet",
  "sessionId": "session-abc",
  "value": {
    "rootSessionId": "session-root",
    "currentSessionId": "session-abc",
    "agents": [
      {
        "sessionId": "session-root", "title": "主会话", "depth": 0,
        "isCurrent": false, "isRoot": true, "running": false,
        "mode": null, "createdAt": 1791806835279,
        "model": "glm-5.3-flash", "provider": "zaicoding",
        "contextWindow": 262144, "pressureTokens": 1500,
        "tokensTotal": 10461, "turns": 2, "steps": 3, "activeMs": 12000,
        "composition": {"system":2154,"tools":10439,"user":120,"inject":0,"skill":0,"assistant":900,"tool":300,"total":13913}
      }
    ],
    "counts": {"agents": 1, "running": 0, "subagents": 0}
  }
}
```

- 顺序：root 起 DFS 先序，同层按 `createdAt` 升序；`isCurrent` 标记当前会话。
- `mode`：`one-shot` / `continuable` / `null`（root 或未记录）。
- `parentSessionId`：非根会话的直接父会话；`origin: "subagent"` 仅标记真实子 Agent 边，供通讯扫描按直接父地址读取历史（fork 不作为子 Agent）。
- 不可用时与 `context-dashboard` 相同：`context-unavailable` / `unknown-command`。
- 所有字段纯 JSON、无 `undefined`；单个会话快照失败时该 Agent 保留基础字段
  （sessionId/title/parent/depth），其余字段省略。

### 7.3 客户端展示

- 顶部总览：Agent 数、运行中数量、家族总 token。
- Agent 卡片按 depth 缩进：标题（子 Agent 用 label/title）、运行中脉冲点、
  上下文占用条（`pressureTokens/contextWindow`）、7 类组成色条、token、轮次/步数、
  模式徽标；当前 Agent 高亮描边。
- 点击卡片打开该 Agent 的会话并切到「上下文」分段。
- 状态：loading / 未连接 / 无会话 / unsupported（需升级网关）/ error+重试；
  进入分段、回合结束、手动刷新时拉取。

## 8. v2（对齐 dsh-context 完整卡片）

v1 只覆盖了核心统计；v2 补齐 dsh-context Context tab 与 Fleet tab 的主要卡片，
并让面板在 Agent 运行中自动刷新。以下为增量契约（与第 2/7 节合并生效）。

### 8.1 `mobileContext` wire 增量

```json
{
  "activity": { "userInputs": 16, "reads": 36, "writes": 38, "searches": 26, "images": 4 },
  "timing": {
    "wallMs": 4980000, "ttftMs": 1598000, "reasoningMs": 1825000, "textMs": 99000,
    "toolArgMs": 617000, "toolsMs": 840000, "otherMs": 1500,
    "waitCount": 313, "reasoningCount": 201, "textCount": 16, "toolArgCount": 313, "toolCount": 318,
    "speedTokens": 204000, "speedMs": 2550000
  },
  "spans": [[0, 1791806835279, 1791807000000], [1, 1791807000000, 1791807500000]],
  "lastAnswer": "同步完成，本地已经和 GitHub…（≤240 字）",
  "requests": [{
    "seq": 53, "time": 1791807408490, "turn": 2, "step": 1,
    "system": 2154, "tools": 10439, "total": 12593,
    "items": { "system": 1, "tools": 79, "user": 3 },
    "prompt": 11200, "output": 191
  }]
}
```

- `activity`：`userInputs` = 非注入 user/message 数；`reads/writes/searches` 按配对
  工具名分类（read*/read_image→reads；write*/edit/apply_patch/str_replace_editor→writes；
  grep/glob/list/search/web_search/ripgrep→searches）；`images` = 全部 user/message 中
  image block 数。
- `timing`：流式事件解码得到 `ttftMs`（step/start→首个 token/首个 block 起点）、
  `reasoningMs/textMs/toolArgMs`（block-start 标记切分的 span 合计）、`toolsMs`
  （tool/call→tool/result 配对）、`otherMs` = 活跃时长 − 前五项（≥0）；
  `speedTokens/speedMs` 用于输出速度 = tokens/(ms/1000)；对应 count 为段数/次数。
- `spans`：时间轴条，`[kindIndex, start, end]`，kindIndex 0=wait,1=reasoning,
  2=text,3=toolarg,4=tools,5=other；保留最近 600 段（可裁剪，不比 wire 超预算）。
- `lastAnswer`：最近一条有文本的 assistant 消息，压缩空白后截断 240 字。
- `requests[].items`：该请求发出时 surface 各类节点数（system 恒 1，tools=header.tools.length）；
  `prompt/output` 为 provider 实报（input+cacheRead+cacheWrite / output）。
- `requests[].activeMs`：该请求所在步骤的活跃时长（见 §2 的 `stepRequestSeq`
  规则），耗时折线与右侧时长轴的数据源；步骤未闭合时缺省。
- 兼容：所有字段 additive-optional，缺省时客户端回退到 v1 展示。

### 8.2 `context-fleet` wire 增量

```json
{
  "team": {
    "members": [{ "id": "session-a", "name": "lead", "role": "lead", "phase": "active" }],
    "tasks": [{ "id": "task-1", "subject": "实现组件", "status": "in_progress", "ownerName": "阿青", "ownerId": "session-b" }],
    "failure": ""
  },
  "agents": [{ "sessionId": "session-a", "phase": "active", "lastAnswer": "…" }]
}
```

- `team` 来自宿主 `agentTeam` 投影（members/tasks 各截断 20 条），没有该投影时省略。
- `agents[].lastAnswer` 取该会话 `mobileContext.lastAnswer`；`phase` 取 team 成员 phase
  （当前会话缺省 `active`）。
- 摘要数值（总 token/运行中/子 Agent 数）由客户端从 agents 汇总。

### 8.3 客户端展示（v2）

Context tab 卡片顺序：
1. **统计**：输入输出（用户输入/读取/写入/搜索/图片五个 chip）、当前会话（2×2）、
   工具调用（总数+前 3+其他）、Agent 网络（当前 Agent tokens、子 Agent ×N）、
   上下文事件（注入/压缩/剪枝）。
2. **当前上下文**：`pressureTokens/contextWindow` 百分比 + 占满窗口的组成条
   （7 类比例）+ 图例（估算 token 与占比）；窗口剩余/压缩保留区用浅色/斜纹表示。
3. **Token 统计**：环形图（conic-gradient 或 canvas）+ 8 行图例（≈/精确、百分比、
   缓存命中率）。
4. **耗时统计**：环形图（活跃时长）+ 6 行（模型等待/思考/回复/工具参数/工具执行/其他开销，
   每行百分比、时长、次数）+ 输出速度 + 时间轴条（`spans`）。
5. **上下文浏览器**：上一次/下一次请求切换 + 请求下拉（最近 30 条）；显示该请求
   估算合计/实际 prompt；7 类折叠行（类名、项数、≈token、占比、对比上一步 ±）；
   点开分类可列出该请求时仍在上下文中的消息、系统提示与工具名；点击单项后再通过
   `context-content` 按 seq 读取正文/schema，不在 2.5s 刷新帧中发送整段会话内容。
6. **上下文趋势**（保留 v1）。
7. **最近上下文事件**（保留 v1）。

Fleet tab 卡片顺序：
1. 顶部汇总 chips：Agent 数、运行中、家族总 token。
2. **编队成员**：每个 Agent 卡（当前高亮、role/phase、运行脉冲、最新回答 2 行截断、
   token/轮次/步数/活跃时长、占用条、组成条）；只有一个 Agent 时显示
   「还没有子 Agent —— 当 Agent 通过 subagent 工具委派任务时，协作网络会在这里展开」。
3. **任务**：`team.tasks` 列表（subject、status 徽标、ownerName）；为空时
   「暂无任务，可以通过对话创建」。
4. 网络关系仍用 depth 缩进/连线表示（移动端不做自由节点图）。

动态刷新：Context/Fleet 面板在可见且会话运行中时每 2.5s 自动刷新一次
（请求去重、上一帧未返回不叠加）；切走/停止后停止轮询；刷新按钮可手动触发。
条形/环形使用 CSS transition 让数值变化有过渡；运行中显示脉冲/转圈。

## 9. v3（按需上下文正文）

为了避免把长提示词和工具 schema 放进周期性仪表盘响应，v3 在投影值内补充轻量浏览器索引：
`surface`（当前活动节点）、`archive`（被 replace/compact 移除节点，最多 400 个）、
`headerEpochs`（请求头 epoch 及工具名，最多 100 个）。替换时旧节点被归档并写入 `gone`；
历史请求按其 seq 重建当时可见的节点列表。档案裁剪时给出 `archiveFloor`，客户端不会把缺失的旧节点
误称为空上下文。

正文由新的 `context-content` 请求按需拉取：`{ type, sessionId, seq }`。Host 通过精确的
`session/page` seq 窗口只读取被点开的事件，投影索引和正文路由都限定在成对设备认证下。单条文本
上限 24,000 字符，工具 schema 单块上限 5,000 字符；图片只显示附件占位，不传输图像数据。旧网关
未提供此能力时，仪表盘仍可展示组成和索引，但单项正文不可用。

## 10. v4（File Activity）

投影在 tool/call 读出文件工具的参数，并在配对 tool/result 到达时记录 bounded `fileOps`：
read/write/search 类型、路径、工具名、耗时点、失败标记以及 write/edit 的估算增删行数。只解析
`read`、`read_image`、`write`、`edit`、`grep`、`glob`、`str_replace_editor` 等已知文件工具，其他工具参数
不进入投影状态。搜索结果仅在 Host 明确给出完整 (`truncated: false`) 的文件列表时按文件展开；否则记为
搜索目标/Pattern。最多保留 400 条，裁剪水位通过 `fileOpsFloor` 表示。

小程序将同一路径按 read/write/search 聚合，支持按当前/选中请求 seq 截止查看、按操作类型过滤、按活动量或最近活动排序，
并列出估算行变化与失败次数。历史浏览器请求如果落在 `archiveFloor` 之前，会明确提示明细可能不完整；
按需正文响应触及长度上限时返回 `value.truncated: true`，客户端显示截断提示。
这是桌面 File Activity 的移动端紧凑视图；桌面端的丰富文件类型徽标、按工具/日期过滤、
定位到浏览器步骤和直接打开工作区资源尚未全部移植。

Context Insights 跨会话活动页已在 `pages/insights` 落地（KPI、7 日用量/费用、8 周热力图、
Token/耗时环、技能、工作区分组与会话卡片；页头插件设置与余额胶囊；子 Agent 家族归并），
详见 `docs/context-parity.md` §12 与 `README.md` 功能对照。当前与 dsh-context 仍有的明显差距：
File Activity 工具/日期筛选与定位跳转、DNA/Adaptive/Overview 趋势交互，以及 Fleet 的详情检查器
（插件 Fleet tab 本身不渲染 inspector）与个别筛选/排序项；洞察页的插件更新胶囊因移动端没有
npm registry 数据源而不渲染。这些差异不能据此宣称已实现与桌面插件的全部功能一致。
