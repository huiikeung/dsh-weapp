# 上下文面板对齐 dsh-context（执行计划与进度）

> 参考源码：`bowenliang123/dsh-context` v0.74.0（Apache-2.0）。本地参考副本放在
> `.reference/dsh-context-main`（不入库、已 gitignore），逐控件规格在
> `.reference/parity/spec-*.md`。本文件是入库的进度与验收清单。

# dsh-context 一比一移植 · 执行计划（v0.74.0 → 小程序）

基线：`.reference/dsh-context-main`（v0.74.0，Apache-2.0，源码为准，截图仅视觉核对）。
规格：`.reference/parity/spec-{stats,trend,browser,fleet}.md`（含逐控件尺寸/色值/文案/交互、file:line）。
换算：px × 2 = rpx（375pt 屏）；WXSS 无 `color-mix`/`@container`/`:has`，一律预混为 rgba、用卡宽测量落 class。
验收基线：`node --test tests/*.test.js` 必须全绿；i18n 改 `resources/i18n/interface.json` 后跑 `node scripts/sync-i18n.cjs`。

## 模块状态

| # | 模块 | 规格 | 状态 | 备注 |
|---|---|---|---|---|
| 0 | 设计 token / 调色板 | spec-stats §1 | ✅ 已完成 | 7 类 + output + 6 段耗时全部换成 v0.74.0 精确 hex；窗口轨道/hatch 底色改 rgba(115,115,115,.18)/rgba(65,118,230,.24) |
| 0 | 卡片骨架 / 标题 / 副标 | spec-stats §2 | ✅ 已完成 | padding 14×16rpx、radius 20rpx、标题 26rpx/600、副标 24rpx/secondary |
| 1 | Context Stats（flow） | spec-stats §3 | ✅ 已完成 | 竖排三段、锚点 1/3·2/3、ribbon 14px/.13、dash 1.5px/.55 流动、胶囊、零值 dim/隐藏、工具「其他 +N」、会话两行 kv、Agent 网络两行、`?` 说明 |
| 2 | Token Stats | spec-stats §4 | ✅ 已完成 | 96 环、8 段两列网格、缓存命中两位截断、output「含思考」不带 ≈、零值类隐藏 |
| 3 | Timing Stats + 时间轴 | spec-stats §5、§7 | ✅ 已完成 | 6 段含 other 残差、环窗口钳制、TPS、副标「会话累计」、按占比铺排 + 四分位刻度 |
| 4 | Current Composition | spec-stats §6 | ✅ 已完成 | 16px 条、一位小数占用率、45°/5-10px 双段 hatch、触发线、7 行两列图例、点图例/段高亮联动 |
| 5 | Context Trend | spec-trend | ✅ 主体完成（Overview/DNA 吸附待打磨） | Step brief 三行（本轮/输入/回复，chip 可定位、+N 折叠）、✂ 事件钉柱、pin 详情（末步/增量 tag、实际 prompt/输出/缓存%、Δ） |
| 6 | Context Browser | spec-browser §2 | ✅ 主体完成（附件卡/树图待做） | 七类手风琴 + 双 delta、基线、组成条、搜索、kind chips、行标签/预览/T·S/错误点、正文行数+复制、DNA `#pos`；工具行来源 chip + 描述 + 参数表（140/90/56/1fr） |
| 7 | Context Events | spec-browser §3 | ✅ 已完成 | 5 chips 多选语义、行图标与 5 色、T/S 位置、注入/压缩增量配色、640rpx 通道 |
| 8 | File Activity | spec-browser §4 | ✅ 已完成 | 5 计数 chips、路径搜索、5 种排序（次数/行数/最新/路径/文件名）、语言+emoji 字形、读写搜徽标、+/−、op 日志（工具胶囊/读行/增减/错误点/步骤戳）与跳浏览器 |
| 9 | Fleet 编队 | spec-fleet §1 | ✅ 主体完成（成员板/通讯待做） | 汇总 chips + 进度条、Agent 网络图（116px 卡 / 180px 层高 / tidy-tree + 折带 / 三次贝塞尔连线 / 黄金角色相 / 当前与选中态 / 组成条 / 压力色）、任务卡沿用 |
| 13 | 成员板 / 通讯面板 | spec-fleet §5、§7 | ✅ 已完成（适配 DSH rc.3） | 成员板：roster+Agent 合并、色相顶边、搜索/状态/排序、任务计数、失败串、→ 打开；搜索框/排序框/任务计数胶囊/任务搜索框透明底；通讯面板：宿主 context-comms 按需扫描 relay/mailbox/settled，rc.3 `send_message.target` 成员名由客户端名册解析为会话 id，发送/接收双日志按路由+文本去重，参与方筛选与路由显示成员名 |
| 10 | /context 弹窗 | spec-fleet §2 | ✅ 已完成 | 工具栏入口 + 居中 82vh/100vw-64rpx 弹窗、Current Composition + Browser 概览、遮罩/× 关闭、类别行跳回页面浏览器 |
| 11 | 上下文设置卡 | spec-fleet §3 | ✅ 已完成（System Prompt 前后缀 host 侧只读说明） | 设置页「上下文面板」分组：趋势粒度/模式、耗时曲线、对比基线、文件活动排序；本机 context-prefs；会话读取默认值 |
| 12 | Context Insights 页 | spec-fleet §12 | ✅ 已完成（适配 DSH rc.3 host） | 页头：原生导航栏标题 + 「插件设置」直达设置页上下文面板 + DeepSeek 余额胶囊（网关 `account` 帧，未登录/旧网关静默隐藏）；KPI 六项、日用量/费用（空态）、8 周热力图（按日期筛选/少多图例）、Token 环 + 8 段图例、耗时环 + 6 段图例（两环图例点按聚焦/淡出，再点取消）、技能卡（搜索/排序/目录来源 chip/路径复制/空态）、工作区分组面包屑、活跃/归档覆盖、会话卡片（运行点/当前/归档/占用环/团队用量与费用/最后消息/无上下文空态）、搜索/排序/分页、日期/技能联动筛选；价格由网关拉取 models.dev 价本缓存并按 `contextActivity` 逐日模型/峰谷用量估算；wire 保持最近 120 会话和 56 天每日明细 |
| 14 | 命令执行卡 | spec-fleet §10（可落地部分） | ✅ 已完成 | 网关命令账本（tool/call↔result 配对、参数、耗时、退出码/信号/超时、输出字符、stderr、后台，≤30 条）；客户端 KPI、全部/失败/慢/后台 chips、命令行、展开详情（命令/facts）、复制、跳浏览器 |

## 宿主侧（网关桥）缺口

| 需求 | 现状 | 影响模块 |
|---|---|---|
| 跨 Agent 通讯（relay/mailbox/settled） | ✅ 已补 `context-comms`（≤12 会话、≤200 条、240 字摘录） | Fleet 通讯面板 |
| 模型切换 / 计划模式事件 | ✅ 已补（`request/header` change/resume + `plan/mode`） | Events |
| `maxOutputTokens`（输出预留） | ✅ 已补 | Current Composition |
| 工具定义总数（其他 +N） | ✅ 已补 `tools.count` | Stats |
| 模型计价（models.dev 价本、DeepSeek 峰谷、币种） | ✅ Insights 网关按需缓存价本，利用日账本模型、缓存、输出及峰谷桶估算费用；小程序按中文/英文界面显示 CNY/USD | Insights KPI、近 7 天费用、会话费用；价本不可用或模型未映射时保留 `—` |
| `headerEpochs[].tools[]` 仅名字 | 无 description / JSON schema / 来源插件 | Browser 工具行、参数表、来源 chip |
| 工具总数（当前只有前 20 名 + 调用总数） | 无 | Stats「其他 +N」精确值（暂用 `names.length - 3`） |
| 附件块（图片尺寸/存储大小/image token） | 部分（attachment 帧拉图） | Browser 附件卡 |
| 工具 description / inputSchema / 来源插件 | ✅ 已补（最新纪元 20 个工具的精简 meta；旧纪元仅名字） | Browser 工具行、参数表、来源 chip |
| 节点预览与 assistant 块计数 | ✅ 已补（最近 120 节点，避免撑爆 wire） | Browser 行预览、kind chips |
| 跨会话聚合（Insights） | ✅ 已补 `context-insights`；最多 120 会话，56 天逐会话日桶；**兼容 DSH 0.2.1-rc.3**：会话头可为 header / 顶层 / metadata 三代形状；head 优先读原生 `contextTimeline/contextActivity`，旧宿主机回退网关 `mobileContext` 的 `current/timing/requests/events`；技能从 `inject{sub:'skill'}` 事件按日归集；缺少计费账本时按请求账本 + models.dev 价本估算日费用与会话费用；标题取原生 `title` 投影；子 Agent 家族按 `parentSession`/`origin=subagent` 归并到最近的非子 Agent 会话（子会话不单列，其 token/费用/日账本/技能计入父会话） | Context Insights 页；工作区与归档由小程序已有 workspace/archived 状态联动 |

## 约束与风险

- WXML 无内联 SVG 渲染保证：趋势/总览沿用「view 线段拟合贝塞尔」，曲线颜色与几何按规格更新。
- 无 hover：一律 `hover-class="press-dim"` + tap 选中态；`?` 气泡改 `wx.showModal`；成本多行气泡改底部 sheet。
- 虚滚动（useRowWindow）不移植：分类列表用 `slice` 上限 + 「还有更多项目」占位，避免 setData 过大。
- 主文件是 `pages/session/session.{wxml,wxss,js}` 单文件面板：按模块顺序串行改，每完成一个模块跑一次全量测试。
- 主包源码预算 1.81MiB 已接近上限：上下文面板后续模块改动要同步清理失效样式，并保持 `node scripts/check-miniprogram-package.cjs` 通过。
- `tests/context-parity-{stats,events,browser,files,trend,fleet,modal,settings}.test.js`、`tests/context-insights-view.test.js`、`tests/context-insights-view.test.js` 已把统计四卡、事件卡与浏览器主体的视觉契约钉成回归测试；后续模块同样补一组 parity 测试。
- `pages/session-settings`、`pages/add-node`、`pages/workspace-picker` 已迁入分包（按需预下载），主包源码 1806 KiB / 1853 KiB。

## 结构完整性守卫（tests/parity-integrity.test.js）

- 事件绑定 ↔ 页面方法：会话页 179 个 bind/catch 全部有同名实现（含拆分 actions 文件）。
- 三张大 WXML 标签配平（改造成本最高的 session.wxml / insights / settings）。
- app.json 注册的每个页面四件套齐全，分包根不得同时出现在主包。
- 上下文 / 编队 / 洞察用到的 class 必须有 wxss 定义（含 @import 链）。

## 已知差异（本轮环境不可消除）

| 项 | 说明 |
|---|---|
| 真机/微信开发者工具验证 | 本机 DevTools CLI 初始化被沙箱拒绝（`EPERM: ~/Library`），无法在此环境起 GUI/预览；已用单元/契约测试 + 包预算脚本代替，真机验收清单见 README/下方。 |
| 洞察页历史范围 | 网关 wire 为控制体积保留最多 120 个会话与最近 56 天逐日明细；更早的会话生命周期费用仍按最多 400 日的宿主活动账本累计。旧网关无活动投影时按可用请求账本回退。 |
| 洞察页费用（¥/$） | 价本从 models.dev 按需拉取并缓存 6 小时；网络不可用或模型无映射时该项显示 `—`，不会用 0 冒充免费。 |
| 洞察页旧网关数据 | DSH 0.2.1-rc.3 不提供 `contextTimeline/contextActivity/costMeter` 投影，网关端已回退到 `mobileContext`（含 timing/current/requests/events）并从事件与请求账本重建技能/费用；若仍在运行旧桥，耗时卡显示空态、技能/费用为空，需重新运行 `install-context-bridge.cjs` 并重启 DSH。 |
| 洞察页标题 / 更新胶囊 | 标题由微信原生导航栏（`navigationBarTitleText: 上下文洞察`）承担，正文不再重复；插件的「新版本 ↑ vX」胶囊依赖 npm registry 最新版本，移动端没有对应网关数据源且小程序不能直接开外链，故不渲染（微信侧版本更新走平台机制）。其余页头按钮（插件设置、余额胶囊）已移植。 |
| 洞察页自定义日期 | 桌面插件的日历弹层改为原生 `picker mode="date"` 起止两段（spec 允许的移动端替代），区间语义与桌面一致。 |
| Context Stats/Trend 费用 | 仍未接入洞察页价本，沿用现有缺失数据显示 `—` 的降级策略。 |
| 浏览器附件卡 / 矩形树图 | 需要结构化 content 与逐块元数据；当前 content 为扁平文本，按规格降级（不渲染附件卡，树图不做）。 |
| 命令执行卡（spec-fleet §10） | 已实现原生 shell（bash/pwsh/shell/exec/execCommand/terminal）的 call↔result 配对与详情；PTC/嵌套工具调用、后台任务交接（job 事件）、慢/后台统计的极端分支未覆盖。 |
| AgentInspector 详情条（§8） | 插件 Fleet tab 明确不渲染（`inspector={false}`），小程序同样不渲染。 |

## 最终验证（第 14 轮）

- `node --test tests/*.test.js`：**984 项、972 通过、12 跳过（缺少原生 GUI 能力）、0 失败**。
- `node scripts/check-miniprogram-package.cjs`：主包 **1958 KiB**，洞察分包 **103.4 KiB**；包检查通过。
- 与插件对照的模块：统计四卡、事件、浏览器（主体 + 工具参数 + 文件活动 + DNA）、趋势（brief/✂/pin）、编队（汇总/网络/成员/通讯/任务）、/context 弹窗、设置卡、洞察页（页头设置/余额、KPI、7 日用量与费用、8 周热力图、Token/耗时环与图例聚焦、技能、分组/覆盖/搜索/排序/分页、会话卡片与空态、子 Agent 家族归并）、命令执行卡。
- **真机核对清单**（需在微信开发者工具/真机执行，本环境无法启动 GUI）：
  1. 上下文：统计段排布、✂ 事件钉柱、brief 三行、pin 详情（实际/输出/缓存/末步/增量）。
  2. 浏览器：类别行双 delta、助手 kind chips、工具参数表、点类别/行展开与复制。
  3. 文件活动：字形、读写搜徽标、op 日志展开与跳浏览器。
  4. 趋势：步骤/轮次、全量/增量、DNA、总览带、耗时曲线。
  5. 编队：汇总→网络图（折带不横向溢出）→成员板→通讯扫描→任务。
  6. 工具栏 `⤢` 弹窗与 `▦` 洞察页；在洞察页核对页头「插件设置」直达上下文面板、DeepSeek 余额胶囊（登录后显示，未登录隐藏）、KPI 六项、7 日柱图与空态、Token/耗时环点图例聚焦、热力图日期筛选与少/多图例、技能卡搜索/排序/详情/路径复制、工作区面包屑与活跃/归档覆盖、会话卡片占用环与团队用量、无上下文卡空态、分页；价格加载后费用、技能目录详情；设置页「上下文面板」偏好对新会话生效。
  7. 命令执行卡：跑一条 bash 后应出现 KPI/行/展开详情，复制与「定位」正常。
