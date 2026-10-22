# DeepSeek Harness Mobile v1.7.3 — 会话页（ConversationView）完整功能规格

> 用途：在微信小程序（WXML/WXSS/JS）中重建该页面。
> 源码基线：`/tmp/dsh-mobile`（iOS SwiftUI + UIKit 混合）。
> 行号引用格式 `文件:行号`。所有行号均为 2026-10-14 检出的 v1.7.3 源码。

## 0. 页面总体结构

```
NavigationStack 页面（由 RootView push 进入）
├─ 系统导航栏（inline 标题 + 右侧状态点/模式名 + "…"菜单）   RootView.swift:835-901
├─ 分段控件 "对话" | "轨迹"（Picker, segmented）            ConversationView.swift:331-337
├─ 双页横滑容器 PersistentSessionPager（对话页 / 轨迹页）    ConversationView.swift:339-347, 2346-2458
│   └─ 对话页 chat：
│       ├─ ConversationViewport（UIKit 列表时间线，左右边距20，顶部8）
│       ├─ 历史加载遮罩 / 加载失败 / 空态（居中覆盖层）
│       ├─ composerBackdrop（输入区背后渐隐遮罩）
│       └─ 底部堆叠（自上而下）：滚动到底按钮 → 审批卡/提问卡（互斥，
│           二者存在时不再挂载任务面板与输入条）→ 模式胶囊+统计胶囊行
│           → 任务/Goal 面板 → 斜杠命令菜单 + 输入条 → 语音全屏遮罩
└─ SessionStatsSheet（从统计胶囊的 popover 里"查看完整统计"进入）
```

关键坐标常量（ConversationView.swift:324-325, 2516-2522）：
- `composerCapsuleHeight` = 34pt（@ScaledMetric relativeTo .caption，随系统字号缩放）
- `conversationBottomClearance` = 22pt；视口 bottomInset = composerHeight + 22（:397）
- composerHeight 默认 168pt（PreferenceKey 默认值 :2517，实测值变化 >0.5pt 才更新 :593-596）

全局色板（Core/Theme.swift:3-14）：

| 名称 | RGB | Hex | 用途 |
|---|---|---|---|
| ocean | (0.18, 0.42, 0.90) | #2E6BE6 | 主色：发送键、进度、用户气泡、JSON key、链接色 |
| purple | (0.48, 0.33, 0.78) | #7A54C7 | Think/推理、推理等级徽章、Token"工具/缓存"行 |
| orange | (0.94, 0.49, 0.08) | #F07D14 | 工具调用、JSON 数字 |
| amber | (1.0, 0.68, 0.12) | #FFAD1F | 连接中状态点 |
| success | (0.18, 0.72, 0.36) | #2EB85C | 已连接状态点 |
| navy | (0.025, 0.09, 0.17) | #06172B | 品牌深底 |
| mist | (0.75, 0.84, 1) | #BFD6FF | 品牌浅色 |

玻璃拟态参数（ConversationView.swift:371-384 + Glass.swift:3-49）：
- glassTint = `secondarySystemBackground`，透明度 dark 0.52 / light 0.48
- glassEdge 描边 = dark `white 13%` / light `white 56%`，宽 0.7pt（小胶囊 0.6pt、透明度 0.9）
- glassShadow = dark `black 34%` / light `black 10%`，radius 18，y 8
- iOS≥26 用系统 `glassEffect(.regular/.clear, tint)`；旧系统用材质+描边+阴影（小程序用 `backdrop-filter: blur(20px)` + 半透明底近似）

页面底色：`systemBackground`（纯系统底，dark #000/light #fff 级别）ConversationView.swift:367-369。

---

## 1. 会话时间线

### 1.1 数据模型与行类型

事件→条目投影（shared/projection/ConversationProjection.kt:13, 89-290；中文标签注入 Core/KMPSharedAdapter.swift:149-172，Core/L10n.swift:35-45）：

| Kind | 中文 title（字面量） | 产生条件 | isError |
|---|---|---|---|
| user | `你` | `user/message`(source=user) 有文本或图片 | 否 |
| context | `上下文注入 · {来源}` | `user/message` 非用户来源（如插件注入） | 否 |
| assistant（流式中） | `DeepSeek · 正在生成` | `assistant/chunk` text-delta 累积 | 否 |
| reasoning（流式中） | `Think · 正在推理` | reasoning-delta 累积 | 否 |
| tool（流式中） | 工具名 | tool-call-delta 累积参数 | 否 |
| jsonTool | 工具名 | 同上，但工具名为 `run_code` 时 | 否 |
| assistant（最终） | `DeepSeek`；被中断时 `生成已中断` | `assistant/message` | interrupted=true |
| reasoning（最终） | `Think` | assistant/message 携带 reasoning | interrupted=true |
| assistant（attempt 中断） | `生成已中断` | `assistant/attempt`（无最终消息） | 是 |
| tool | 工具名 | `tool/call`（run_code→jsonTool） | 否 |
| toolResult | `工具完成` / `工具失败` | `tool/result` | 按事件 |
| status | 命令名 | `command/run`→文本`正在执行…`；`compaction/start`→`正在压缩…`；完成→`已完成`/`执行失败`；压缩汇总→`已压缩 {items} 条历史记录（约 {tokens} tokens）` | 失败时 |

标题比较必须用常量而非本地化文案（L10n.swift:28-40 注释）：流式判定=title == `DeepSeek · 正在生成`，流式推理判定=title == `Think · 正在推理`。

### 1.2 分组规则（ConversationView.swift:2907-2965）

`ConversationDisplayEntry.make`：连续的 context/reasoning/tool/jsonTool/toolResult 合并为一个"过程组"；`status` 会先结束上一组再自成一组（组 id `message-<首项id>`，其余组 id `process-<首项id>`）；user/assistant/system 各自成消息行（id `message-<id>`）。

**复制按钮规则**（ConversationView.swift:2945-2962）：
- 用户消息：始终可复制（text 非空才显示按钮）。
- 助手消息：仅当它是"下一个用户/助手消息之前的最后一条正式回复"时显示复制按钮（中间的过程性叙述如果后面还跟着另一条助手回复则不显示）。
- 过程组行（process/tool/context/system 等）一律无复制按钮。
- 复制按钮组件 CopyMessageButton（ConversationView.swift:3873-3905）：资产图标 `CopyMessage` 16×16，容器 16×26；点击写入剪贴板，图标变 `checkmark` 14pt semibold、颜色 ocean，1.4s 后复原；无障碍标签 `复制正文` / `已复制`。

### 1.3 各行渲染规格（ConversationRow，ConversationView.swift:3752-3871）

| 行 | 布局/颜色 |
|---|---|
| user（:3760-3783） | 尾随气泡。气泡内 padding H10 V10，圆角 15 continuous；填充 ocean 透明度 dark 0.24 / light 0.11；描边 ocean dark 0.34 / light 0.08，宽 0.7；整行左缩进 34pt（长文本仍保持尾随气泡不撑满），上下外边距 12。正文 `Text` body(17pt)。图片网格 AttachmentImageGrid（:3710-3750）：1 图 → 单列最大 320×280、aspectFit；≥2 图 → 2 列、单格最大 180×280、aspectFill、圆角 11、白 16% 描边 0.7、格间距 6；数据未到时显示灰底+小菊花占位（宽高先占位，字节后到不触发重排）。 |
| assistant（:3791-3807） | 顶头左对齐，spacing 7，上下外边距 12；图片网格同上；正文 Markdown（见 1.5）；复制按钮 bottom padding 8。 |
| context（组外兜底 :3784-3790） | Fallback 行：图标资产 `DshContextInjection`（模板 14×14，行内槽宽 18），绿色；标题 + `·` + 单行预览；正文：1pt 竖线（gray 24%）+ compact Markdown，左缩进 5。 |
| reasoning（组外兜底 :3808-3814） | 同上但图标 `DshThink`、紫色、标题 `Think`。 |
| tool / toolResult（兜底 :3815-3826） | 图标：错误→`exclamationmark.triangle` 红；tool→按工具名映射（见 2.6）；toolResult→`wrench.and.screwdriver`；橙色。结果类 title 为 `工具完成`/`工具失败` 时正文走 ToolOutputView（见 2.6）。jsonTool（:3827-3834）图标 `curlybraces.square`，正文按 JSON 围栏渲染。 |
| status（:3835-3849） | `terminal` 图标 13pt medium；标题 primary/错误红；`·`；文本 secondary/红；subheadline(15pt)；上下 padding 6。 |
| system（:3850-3861） | 图标 `antenna.radiowaves.left.and.right`（ocean）/错误时 `exclamationmark.circle.fill`（红）；标题 caption semibold + 文本 caption secondary（可选中）；外层 padding 10，底色 ocean/red 6%，圆角 11。 |

### 1.4 流式渲染（专属原生单元格，性能关键）

- 流式助手行（title==`DeepSeek · 正在生成` 且无图片）不走 Markdown：使用 TextKit 纯文本 cell（ConversationViewport.swift:2251-2342）。body(17pt) 系统字体、label 色、不可选不滚动；内边距上下 15、左右 2；高度公式 `ceil(15 + 文本高 + 15 + 2)`（:2290）。增量渲染：新文本是旧文本后缀时只 append 增量（:2320-2325）。**结束后换回 Markdown 渲染**（revision 变化触发整行 reconfigure）。
- 流式高度测量缓存（ConversationViewport.swift:1376-1444）：`ceil(15 + 26 + 7 + 文本高 + 15)`；跨帧保留 TextKit 布局状态，只有跨行时才触发列表布局失效。
- 所有估算高度 80pt、行间距 0（ConversationViewport.swift:236-237）；高度缓存按 `(id, revision, 宽度像素)` 键控（:1446-1456），完成后不可变行允许缓存。
- 小程序对应：流式行用纯文本节点 + 增量 setData（按行 diff），完成后切 markdown 组件；避免每个 token 重渲染富文本。

### 1.5 Markdown / 代码块（MarkdownUI 主题 deepSeek，ConversationView.swift:4066-4131）

| 元素 | 规格 |
|---|---|
| 正文 | 17pt（compact 模式 13pt），主色，行距 `em 0.22`，段落 margin bottom 10（compact 6） |
| 行内代码 | 等宽，`em 0.86`，主色；iOS≥18 用 TextRenderer 画圆角 chip；<18 回退底色 `systemGray5` 68%（:4133-4137）。渲染前对源码做 InlineCodePadding（:4139-4179）：反引号内插入细空格 U+2009（`` `x` ``→`` `<thin>x<thin>` ``），utf16 长度>24 的 token 在 `/ \ _ . - :` 后插入零宽空格 U+200B 允许换行 |
| 代码块 | 语言标签（存在且非空时）caption2 等宽 secondary 大写；代码横向滚动不换行、等宽 13pt（compact 11）；外层 padding 12（compact 10）、底色 `secondarySystemFill`、圆角 9、margin top2 bottom10（compact 6）。**代码块没有复制按钮**（复制靠消息级按钮） |
| 分隔线 | 0.5pt `separator` 55%，margin 上下 18（compact 10） |
| JSON 高亮 | DSHCodeSyntaxHighlighter（:4181-4239）：language 为 json/jsonc 或内容本身是合法 JSON 时高亮——key=ocean、字符串值=RGB(0.10,0.55,0.38)、true/false=purple、null=红 80%、数字=orange，其余主色 |
| 解析缓存 | ParsedMarkdownCache（:4039-4064）：NSCache 256 条 / 16MB，按源文缓存解析树（滚动复用不重复解析） |

### 1.6 中断/异常状态

- 生成中断：助手行 title 变 `生成已中断` 且 isError（ConversationProjection.kt:217-226, 243）；渲染上仍是 Markdown 气泡，无额外横幅。
- 历史加载失败（整页覆盖，ConversationView.swift:712-728）：`exclamationmark.triangle` largeTitle 橙色 + `历史记录加载失败` title3 semibold + 错误文案（旧格式错误固定文案：`Host 无法读取旧格式会话，请修复或升级 Host 后重试。原始记录未修改。`）+ bordered 按钮 `重新加载历史`。a11y id `history-load-failure`。
- 历史加载中（冷会话整页遮罩 :763-799）：不透明底 + 大号菊花（ocean）+ `正在加载历史记录` /（定位期）`正在准备会话` + 进度文案（`正在从 Mobile Gateway 同步会话内容…`、`正在加载历史记录 · loaded/total`、`正在加载更早记录…`、`正在加载更早记录 · 已同步 N 个事件`、`正在自动加载更早记录 · 已同步 N 个事件`）。遮罩在列表真正提交且对齐到底部后才撤下（ConversationViewport.swift:738-743, ConversationView.swift:624-637）。
- 顶部"加载更早"横幅（:801-811, 1823-1825）：HStack spacing 9：小菊花(ocean) + caption 进度文案，padding H10 V8。分页按钮（:1829-1837）：caption 文案 `加载更早记录`，占满整行。
- 空会话（:696-706）：鲸鱼 logo（`DshOrcaMark`）52pt，dark 白 / light 黑；`操作远端 DSH Agent` title3 semibold；`发送任务后，工具调用、推理进度和最终回复会通过 Mobile Gateway 实时返回。` subheadline secondary 居中。

---

## 2. 过程/工具分组（process groups）

### 2.1 节点树（ConversationProcessNode，ConversationView.swift:3120-3283）

每个过程组投影为**互相独立的列表行**（头行高度不变，展开=在头行后插入子孙行）：

```
groupHeader(组, isExpanded, isExpandable)            depth0
├─ commandDetail(status 项, 仅当命令文本含换行或>96字)  depth1
├─ context 行: eventHeader → (展开) eventDetail       depth1/2
├─ reasoning 行: reasoningHeader → (展开) reasoningDetail  depth1/2
└─ tools 行: toolBundleHeader → (展开) 每个工具:
     toolHeader → (展开) toolDetail                  depth2/3
```

展开状态 = 每会话的 Set<节点id>（`expandedConversationNodeIDsBySession`，:313, 1936-1949）；点击前先记录锚点行做位置稳定（:1941-1949 → ConversationViewport.prepareForDisclosureUpdate :1042-1059，提交后按锚点恢复，最多 3 轮 :1061-1085）。

### 2.2 组头行（ConversationProcessHeaderRow :3285-3336）

- 可展开则整行是按钮；上下 padding 7，底部 1pt 分隔线（gray 16%）。
- 有命令（status 项）时：`terminal` 图标 13pt medium + 命令标题（subheadline medium，primary/错误红）+ `·` + 命令单行预览（subheadline secondary/红，空白折叠成单空格）。
- 无命令时：processTitle（subheadline medium secondary 单行），规则（:3073-3105）：
  - 只有 context（无工具无推理）→ `上下文` 或 `N 项上下文`；
  - 否则按时长：≥60s → `耗时 X 分钟 Y 秒`；≥1s → `耗时 N 秒`；<1s → `思考过程`；
  - 追加细节：` · N 项上下文`、` · N 次工具调用`。
- 可展开性：无命令（纯过程事件）恒可展开；有命令时需要命令文本含换行或长度>96，或组内有细节项（:3064-3071）。
- 折叠箭头：`chevron.right` caption semibold tertiary，展开时旋转 90°（:3329-3333）。

### 2.3 展开后的内容

| 节点 | 渲染 |
|---|---|
| commandDetail（:3338-3357） | 命令全文，subheadline 等宽，可选中；卡片：`ultraThinMaterial` 底、圆角 14、描边 primary 8% 1pt、padding H14 V12、左缩进 2/上下 4 |
| context 头（:3359-3412） | 图标 `DshContextInjection` 绿 + 标题 + `·` + 单行预览；文本非空才可展开；箭头 chevron.right caption semibold secondary，展开转 90° |
| context 详情（:3414-3448） | 左侧 1pt 竖线（gray 24%）+ compact Markdown（secondary 色）；文本>900 字符或>20 行 → 改为高 320pt 的内滚动容器（底 `secondarySystemFill` 圆角 10、padding 10） |
| reasoning 头（:3450-3484） | 图标 `DshThink` 紫 + `Think`（subheadline medium 紫）+ `·` + 单行预览 + 箭头（tertiary） |
| reasoning 详情（:3486-3513） | 左缩进 28；compact Markdown secondary；>4000 字符或>60 行 → 高 320pt 内滚动（底 `secondarySystemFill` 圆角 10） |
| 工具束头（:3515-3552） | `wrench.and.screwdriver` 橙 + 标题：取前 2 个工具名顿号连接 → `使用了 A、B 等工具`（>2 个加` 等工具`）；无名字 → `查看 N 个工具结果`；箭头 tertiary |
| 工具头（:3554-3618，左缩进 16 上下 6） | 图标（见 2.4）17pt 槽宽，橙/错误红；第一行：摘要标签（subheadline medium secondary）+ 注释（caption monospacedDigit tertiary）+ `失败`（caption2 semibold 红）/`等待结果`（caption2 secondary，结果未到）；第二行：参数摘要 caption 等宽 secondary，最多 2 行、中部截断；箭头 tertiary |
| 工具详情（:3620-3641，左缩进 40 bottom 5） | 有调用参数时：小标题 `调用参数`（caption semibold secondary）+ 参数 JSON 代码块（>3000 字符 → 高 220pt 双向滚动）；有结果时：`结果`/`错误`（caption semibold，错误红）+ ToolOutputView |

### 2.4 工具图标映射（conversationToolGlyph :3672-3688）

| 工具名（小写去符号） | 图标 |
|---|---|
| write/edit/writefile/editfile/applypatch | SF `pencil` |
| glob/grep/websearch | 资产 `DshSearch` |
| read/webfetch/cordispackageinspect/cordisruntimeinspect | 资产 `DshRead` |
| bash/pwsh | 资产 `DshBash` |
| 其他 | SF `wrench.and.screwdriver` |

### 2.5 工具摘要（ToolActivitySummary.kt:11-54，两端共用）

- 标签：write→`写入`、edit/apply_patch→`修改`、read→`读取`、bash/shell/exec/run_code/terminal→`执行`、grep/search/glob/find→`搜索`、list/ls→`列出`、webfetch/fetch→`获取`、其他→原工具名或`工具`。
- detail：优先参数 `description`；执行类取 `command`；搜索类取 `pattern · path`；获取类取 `url`；默认取 path/command/query/url；空白折叠、截断 240 字符。
- annotation：写入→`N 行`；修改→`替换 X → Y 行`；读取→limit/num_lines→`N 行`。

### 2.6 工具输出（ToolOutputView :3967-4014）

- 顶部 `OUT` 标签（caption2 等宽 secondary）。
- 文本>1500 字符或>24 行 → 高 280pt 双向滚动，逐行 Text（caption 等宽主色，横向固定宽）锚定左上；否则整段 caption 等宽主色可选中，padding 10。
- 容器：`secondarySystemFill` 圆角 10，行距 7。

---

## 3. 运行中指示器（deep-search-progress 行）

会话 `isRunning` 时追加在时间线末尾、id 固定 `deep-search-progress`（ConversationView.swift:1894-1914）。起始时间为"最近一条用户消息时间"。

### 3.1 布局（DeepSearchProgressRow :2057-2150）

- 顶部 0.5pt 分隔线（primary 2.5%）；行高 56pt 顶对齐；内容上 padding 8（外层）+13（内层）。
- HStack spacing 8：鲸尾动图 18×18（模板渲染染成 base 色，无障碍隐藏）+ 文案 14pt medium。
- 文案格式（字面量）：`{短语}，用时 {N} 秒…`，单行截断；`N` 为自起始起的整秒。

### 3.2 鲸尾素材（:2152-2160）

资产 `RunningWhaleTailSprite`：1680×28 PNG = **60 帧、每帧 28×28** 横排雪碧图；播放 20fps（`index = floor(t*20) % 60`）；reduceMotion 停在第 0 帧。与 Web UI 的 APNG 鲸尾共用素材——小程序可直接用同一雪碧图做 CSS steps 动画。

### 3.3 文字流光

- TimelineView 30fps 驱动（reduceMotion 1fps）。
- 相位 `phase = (t mod 2.2) / 2.2 * 1.8 - 0.4`（周期 2.2s）；渐变锚点在 `phase ± 0.24`（单位点，水平）。
- 颜色（:2101-2106）：

| 变量 | Dark | Light |
|---|---|---|
| base | RGB(0.659, 0.745, 0.859) #A8BEDB | RGB(0.094, 0.212, 0.353) #18365A |
| highlight | RGB(0.835, 0.890, 0.957) #D5E3F4 | RGB(0.357, 0.498, 0.663) #5B7FA9 |

渐变 = [base, highlight, base]（reduceMotion 时 highlight=base）。

### 3.4 短语表与轮换（:2064-2098）

30 秒一个桶（`phraseIntervalSeconds = 30`）。对"最近一条用户消息之后"的事件流（cue：context/reasoning/tool/toolResult/assistant/status）按时间顺序推断当前活动，再从对应词库取第 `(起始Unix秒 + 桶序) % 词数` 条：

| 活动 | 推断规则（后者覆盖前者，仅统计截止时间前的事件） | 短语（按序轮换） |
|---|---|---|
| thinking（默认） | — | `梳理脉络中` `推敲细节中` `酝酿下一步中` `沿着思路前行中` |
| gathering | 出现 context | `翻阅已有线索中` `收拢相关信息中` `寻找切入点中` `铺开问题脉络中` |
| exploring | 出现 tool（调用） | `向外寻找线索中` `打捞新线索中` `沿途探查中` `搜集更多拼图中` |
| reviewing | toolResult 且非错误 | `对照新发现中` `拼合新线索中` `检视所得中` `把发现串起来中` |
| revisiting | reasoning 且已有推理或已有结果；或 toolResult 为错误 | `回看已有线索中` `重新校准方向中` `再推敲一遍中` `换个角度审视中` |
| composing | 出现 assistant（最终文本） | `组织回应中` `整理表达中` `将思路落成文字中` `勾勒答案中` |
| working | 出现 status | `继续推进中` `稳步探索中` `梳理当前进展中` `逐步展开中` |

---

## 4. 输入条（Composer）

### 4.1 背景与高度

- composerBackdrop（:1374-1399）：高 composerHeight+28，`ultraThinMaterial` + 自底向上渐变（透明度 0.02→0.78→1），再乘垂直渐变蒙版（0→34% 处 58%→68% 处 100%），不可点击。
- 卡片（composerCard :886-1061）：VStack spacing 12；内边距 H14 T14 B12；glassSurface 圆角 24（tint=glassTint）；描边 glassEdge 0.7；阴影 radius 18 y8；外边距 H14，bottom = 窗口底部安全区 + 10（:1366-1372）。
- 高度经 PreferenceKey 上报（默认 168，变化 >0.5 才生效），用于视口 bottomInset 与按钮避让。

### 4.2 文本输入区（SlashCommandTextView :36-161 + VoiceComposerTextInput :163-185）

- UIKit UITextView：body(17pt) 动态字体、tint=systemBlue、背景透明、不滚动（超过 5 行才滚动：高度 = clamp(实测, 1×行高, 5×行高) :72-87）；水平 padding 3，最小高 38。
- 占位符：直接绘制的文本，色 = secondaryLabel 62%（:246-252）。文案来自语音状态：键盘可见 → `描述你想要构建的内容`；否则 → `输入内容或按住说话`（SharedVoiceInputStore.kt:37）。
- 斜杠命令高亮（:224-241）：草稿以活动命令 token（`/xxx`）开头时，token 染 systemBlue；token 后无参数时在行内灰色绘制参数提示（hint，同样 62% secondary，:255-275）。
- 中文输入法安全：外部赋值只在 binding 与 textStorage 真不一致时同步，避免打断 marked text（:202-211）。
- 失焦策略：点击时间线任意处结束编辑（非消耗型 tap，ConversationViewport.swift:409-416）；键盘交互式下滑跟随（keyboardDismissMode=.interactive :396）；切到"轨迹"页强制失焦（ConversationView.swift:356-358）；审批/提问卡出现时失焦并按需回底（:602-611）；聚焦瞬间触发一次滚到底（:597-601）。

### 4.3 底部工具行（HStack spacing 7，:915-1016）

从左到右：

1. **图片选择**（:916-934）：`photo.on.rectangle.angled` 16pt semibold，容器 32×32 圆形；导入中显示小菊花；上限 20 张（剩余额度=20-已有）；不支持图片的网关禁用。无障碍标签 `添加图片` / `当前网关不支持图片`。系统 PhotosPicker（小程序→`wx.chooseMedia`）。
2. **权限胶囊 permissionControl**（:1540-1564, 1603-1634）：
   - 无会话（新会话）：静态 caption medium secondary，宽 92 左对齐；加载中 `读取默认权限…`+mini 菊花；有默认值→图标+名称；否则 `shield`+`默认权限`。无障碍 `新会话默认权限：X` / 未读取为 `未读取`。
   - 有会话：原生 Menu（小程序→自绘弹出层），宽 78；图标+名称 caption medium secondary；选项=网关权限预设；当前项图标换 `checkmark`；加载中 mini 菊花；空选项禁用。
   - 图标映射（:1782-1789）：`read-only`→`checkmark.shield` `只读`；`workspace-write`→`pencil.and.outline` `工作区写入`；`danger-full-access`→`exclamationmark.shield` `完全访问`；其他→`shield`。
3. Spacer。
4. **模型胶囊 modelControl**（:1566-1601, 1636-1706）：
   - 无会话：静态 caption medium secondary 右对齐，显示默认模型名（`deepseek-chat`→`DeepSeek Chat`、`deepseek-reasoner`→`DeepSeek Reasoner`，其他原样 :1754-1760）+ 推理等级徽章（caption2 semibold、primary 色、H6 V3 底 purple 14% 胶囊）；加载中 `读取默认模型…`；无值 `默认模型`。
   - 有会话：原生 Menu。标签=当前模型名（可缩至 0.72 缩放）+ 等级徽章（底 purple 16%）+ `chevron.up.chevron.down` 8pt semibold tertiary。菜单内容：按 provider 分组列出模型（当前项 `checkmark`），底部 `推理等级` 分区（low/medium/high→`Low/Medium/High` :1761-1768）。空目录显示 `正在读取模型…`。当前名兜底 `DeepSeek Agent`（:1748）。
5. **上下文环**（见 §5）。
6. **发送/停止按钮**（:957-1015）：42×42 圆形 ocean 底。
   - 停止态：白色圆角方块 14×14（圆角 3，continuous）——条件 `supportsSessionCancel && 会话运行中 && 输入为空`（:1270-1272）；点击=取消会话；取消请求中透明度 0.66 且禁用。
   - 发送态：`arrow.up` 17pt bold 白色；空内容透明度 0.48；禁用条件 = 模式禁止发送 || 无内容 || 等待新会话 || 图片导入中 || 命令提交中 || 消息提交中（:1001-1005）。
   - 发送成功后：清空草稿/图片、清斜杠命令态、失焦、滚到底（:975-984）。发送进入"提交中"（20s 超时）时不立即清空，等 `messageAcceptedRevision` 后再清（:965-970, 1029-1040；超时文案 `发送确认超时，请确认队列状态后重试` AppStore.swift:1635）。
   - 无障碍：`停止生成` / `发送`。

### 4.4 待发图片条（pendingImageStrip :1274-1305, 1319-1364）

- 水平 ScrollView 高 82，间距 8；每张缩略图按比例适配、最大 72×72、圆角 10。
- 删除按钮：`xmark.circle.fill` 20pt，palette [白, 黑 68%]，偏移 (+5,-5)，外层 padding 上5 右5；无障碍 `移除图片`。
- 导入流程：仅支持 PNG/JPEG/WebP/GIF（魔数嗅探 :1354-1364）；单条消息总字节 ≤ 100 MiB（:1345-1347）；错误文案：`所选图片不是受支持的 PNG、JPEG、WebP 或 GIF。`、`处理所选图片失败：{原因}`、`一条消息中的图片总大小不能超过 100 MiB。`
- **文件附件：会话页不支持发送文件**，只有图片；文件浏览在导航栏"…"→工作区文件 sheet。

### 4.5 语音输入（按住说话；小程序可裁剪，但状态机如下）

- 入口手势：**在输入框上长按 80ms**（`LONG_PRESS_MILLISECONDS=80`，VoiceInputInteraction.kt:6；仅当未聚焦时手势生效，ConversationView.swift:120-131）。遮罩高度=窗口高 × 0.4（`OVERLAY_HEIGHT_FRACTION`）；淡入 160ms `timingCurve(0,0,0.2,1)`、淡出 280ms easeInOut（:5-12）。激活时整条底部堆叠 opacity 0（:564）。
- 状态机（SharedVoiceInputStore.kt:188-397, 513-565）：
  `idle → authorizing（权限） → starting（开麦） → recording → stopping（收尾200ms CAPTURE_TAIL） → transcribing → idle`
  - 上滑 ≥64pt → `cancelArmed`（再回滑解除），状态文案变 `松手取消`，伴随 selection 触感。
  - 100ms 心跳计时；录音上限 120s（`MAX_DURATION_SECONDS`，VoiceInputProtocol.kt:22）或 4MiB；非录音阶段超时 30s、转写阶段 180s（:390-394）；转写请求超时 185s。
- 顶部状态文案（SharedVoiceInputStore.kt:41-51）：`松手取消` / `正在转成文字` / `正在获取麦克风权限` / `正在开启麦克风` / `正在整理录音` / `松手转文字 · 上滑取消` / `正在准备语音模型`。
- 触感（VoiceInputAdapter.swift:23-25, 77-84）：开始=soft impact 强度 0.8；取消=selection；松手=light impact 强度 0.6。（小程序：`wx.vibrateShort({type:'light/medium'})`）
- 录音遮罩 VoiceRipplePanel（VoiceRipplePanel.swift:15-174）：底部椭圆渐隐蒙版（60% 高度渐变）；45 列×13 粒子；音量>0.08 后自由漂浮粒子收束成柱状波形（列高 5+level×56×边缘包络），30fps；转写阶段显示 `取消` 胶囊按钮（caption medium，底 ink 10%）。
- 遮罩配色（:68-90，含取消态分支）：

| 状态 | base | glow | ink（前景/文字） |
|---|---|---|---|
| Dark 正常 | #101F35 | #1B3B61 | #D4E1F1 |
| Dark 取消 | #4C2733 | #754050 | #F1D8DE |
| Light 正常 | #15335C | #2C5D9C | #FFFFFF |
| Light 取消 | #DC8799 | #F0B1B8 | #642434 |

- 转写结果：草稿未被外部改动（revision 一致）→ 直接追加到草稿（换行连接）；否则进入"待确认"卡（:904-914）：转写文本 caption 3 行 + `草稿已更改，请确认插入识别文字` caption2 secondary + `插入` / `丢弃` caption 按钮。
- Toast（:580-591）：底部黑 78% 胶囊，白字 14pt medium，padding H18 V11，位于输入条上方 16pt，2s 自动消失；文案如 `未识别到人声`（SharedVoiceInputStore.kt:556）。
- 错误弹窗（:638-645）：alert 标题 `语音输入暂不可用`，按钮 `知道了`；正文如 `请在系统设置中允许麦克风权限`、`请先连接网关，再使用语音输入。`、`当前网关尚不支持语音输入。请在桌面端升级移动网关插件，并在「插件」模块启用官方「语音输入」插件，完成模型初始化准备。完成后重新连接网关。` 等（:192-196）。
- App 退后台立即取消录音（:654-657）。

### 4.6 斜杠命令菜单（slashCommandMenus :1063-1160）

- 触发：草稿以 `/` 开头（KMP 状态机 SharedSlashCommandStore.kt:111-164）→ 在输入条上方显示玻璃面板（圆角 22，同 glass 样式），内容高度自适应、上限 300pt（:2498-2514）。
- 目录态：分组标题（subheadline medium secondary，H14 V9）+ 命令行（name subheadline? 实际 `body medium` primary + description subheadline secondary 单行，H14 V11，间距 10）；`ui.kind=="select"` 的命令尾部 `chevron.right` caption semibold tertiary；加载中显示线性菊花。
- 选项态：顶部显示当前命令 `/name` caption secondary；选项行=主文案 body medium + 描述 caption secondary 单行 + 选中 `checkmark`（ocean）；选择加载中禁用。
- 发送：命令行经 `composedSlashMessage` 直接以文本发出；`commandSubmissionPending` 期间发送键禁用且发送后失焦不清草稿（:971-974）；`commandDraftClearToken` 到来时清空草稿与图片（:1055-1060）。

### 4.7 排队消息 dock（queueDock :1170-1264）

- 有排队消息时显示在输入条上方，与输入条叠压 24pt（VStack spacing -24 :867）：背景 `secondarySystemBackground`，顶部圆角 24（其余 0），底部延伸 24 到输入条圆角后方；描边 primary 22%(dark)/14%(light) 0.5pt。
- 头部（>1 条时）：`text.bubble` + `排队消息 · N`（subheadline）+ `chevron.up`（展开时旋转 180°），padding 10；单条时不显示头部。
- 行（:1221-1254）：预览 subheadline 2 行 + `N 个附件` caption secondary；行尾动作按钮 36×40（图标 15pt）：`pencil` 编辑排队消息、`trash` 删除排队消息、`arrow.up` 立即插话（仅会话运行中可用）；行间 0.5pt 分隔线（primary dark14%/light8%，H padding 10）；执行中显示菊花；任一操作 pending 时全部禁用；>3 条时列表限高 192 滚动。
- 小程序实现差异：运行中发送的普通消息**不直接走网关 queue 模式**，而是先存本机待发队列（`local: true`），只有用户点该行的 `arrow.up` 才真正发给网关（运行中按 steer 插话、回合结束后按普通发送并补一条乐观回显）。这样宿主不会在回合结束时自动把消息发出去；本地队列行的 `arrow.up` 因此在非运行状态也可用，`pencil` 可把正文与附件取回草稿。
- 队列动画：easeInOut 0.25（reduceMotion easeOut 0.15）（:880-882）。
- "编辑排队消息"把文本取回草稿：`draft = draft.isEmpty ? text : draft + "\n\n" + text` 并聚焦（:1162-1168）。

### 4.8 任务 / Goal 面板（TaskGoalPanels :2166-2344，显示在输入条上方）

- 仅在无审批/提问卡时挂载（:483-547）。每进入会话先收起任务面板（:677-678）。
- 任务面板：圆角 18 玻璃卡（tint 同输入条），padding 15，描边 dark `white22%`/light `black13%` 1pt，阴影 radius 8 y3。头行：`list.bullet` 18pt medium secondary + `任务` headline + 摘要（subheadline secondary 单行，`X 已完成 · Y 进行中 · Z 待处理`，空段省略，仅非零段）+ chevron（展开 `chevron.up`/收起 `chevron.down` subheadline semibold secondary）。展开列表：行间距 9，状态图标固定 20×20 槽（completed→`checkmark.circle` 绿 16；in_progress→小菊花 ocean；其他→`circle.dotted` tertiary），文本 body（completed 为 secondary）。
- Goal 面板：同行布局。`target` 21pt medium secondary + 阶段标题（headline，`进行中的目标`/`已暂停的目标`/`受阻的目标`/`当前目标`）+ 目标文本（body 单行尾截断）；动作 30×30 图标按钮（`pause.circle`/`play.circle`、`pencil`、`trash`，20pt medium secondary；无障碍 `暂停目标`/`继续目标`/`编辑目标`/`删除目标`）；变更中显示小菊花。
- Goal 编辑 alert（:612-617）：标题 `编辑目标`，多行 TextField 占位 `目标`，按钮 `取消` / `保存`（去空白后为空禁用）。删除确认 alert（:618-623）：标题 `删除当前目标？`，正文 `删除后，智能体不再持有这个持续目标。`，按钮 `取消` / `删除`（destructive）。

### 4.9 审批卡 / 提问卡（高优先级交互层，置于输入条之上）

二者出现时替代模式胶囊行+任务面板+输入条（:462-482），从底部滑入（move+opacity）。

**审批卡 ApprovalRequestView**（ApprovalRequestView.swift）：
- 圆角 24 continuous；描边 amber 78% 1pt；amber=RGB(0.96,0.61,0.05) #F59C0D；底 `systemBackground`；阴影 radius 10 y4（dark 18%/light 5.5%）；左右边距 14。
- 头部（展开态 :112-142）：amber 底条（dark 12%/light 8%）内：9×9 amber 圆点 + `等待审批`（subheadline semibold amber）+ 重放标记 `· 已恢复`（caption secondary）+ busy 菊花 + 收起按钮 `chevron.down`（30×30）。
- 折叠态（:43-69）：9pt 圆点 + `Agent 正在等待审批`（subheadline semibold）+ 原因（caption secondary 单行）+ `chevron.up`；padding H16 V13；折叠/展开动画 snappy 0.24。
- 正文（:71-110，padding 18）：原因（body medium）；命令预览（等宽 subheadline secondary，可选中，**限高 148 滚动**，长命令不撑高卡片）；`审批详情` DisclosureGroup（`curlybraces` 图标，caption semibold secondary，底 primary 4% 圆角 12，内容限高 190 滚动，键值对渲染 caption2 键/caption 等宽值）；失败信息（caption 红色 + `exclamationmark.triangle.fill`）。
- 按钮（:144-155，右对齐间距 10）：`拒绝`（bordered）/ `允许一次`（borderedProminent，tint dark=white/light=black 反色文字）；busy 时禁用。
- 原因兜底：`{工具名} 请求执行需要审批的操作`（:178-180）。

**提问卡 HumanQuestionView**（HumanQuestionView.swift）：
- 玻璃卡圆角 24（tint secondarySystemBackground dark78%/light82%），描边 dark white14%/light white72% 0.8，阴影 radius 20 y9，左右边距 14。
- 头部（:114-148）：`questionmark.bubble` 16pt semibold ocean + `需要你的回答`（subheadline semibold）+（重放）`已从断线前恢复` caption2；右侧 busy 菊花 + 收起 `chevron.down`（30×30）+ 放弃 `xmark`（14pt semibold，30×30）。
- 折叠态（:63-90）：`questionmark.bubble.fill` 18pt semibold ocean + `Agent 正在等待回答` + 当前问题单行 caption。
- 问题区（:92-112, 150-172）：滚动限高 390；头部标签（caption medium secondary）+ 问题（title3 semibold）+ Markdown 详情（subheadline secondary）+ 多选提示 `可以选择多项`（caption + `checklist`）。
- 选项行（:214-262）：19pt 图标（单选 `circle`/`largecircle.fill.circle`，多选 `square`/`checkmark.square.fill`，选中 ocean/未选中 secondary55%）；文案 body semibold + `推荐` 徽章（识别后缀 `(recommended)`/`（推荐）` 等，caption2 semibold ocean、底 ocean 12% 胶囊 H6 V3）+ 描述 subheadline secondary；容器 padding 12 圆角 14：选中底 ocean 9% 描边 ocean 48%，未选中底 primary 3.5% 描边 primary 7%。
- 自定义答案（:182-209, 364-381）：无选项→TextEditor（min 92 max 138，圆角 14 底 primary 5.5%，占位 `输入你的答案`）；有选项→行内输入 `或输入自定义答案`（pencil.line 前缀，圆角 13 底 primary 5%）；输入自定义答案会清空单选。
- 流程（:264-303, 395-428）：底部 footer——左右翻页 34×34 `chevron.left/right` + `N / M`（subheadline monospacedDigit secondary）+ `跳过问题`（bordered）+ 主按钮（最后一题 `提交`，否则 `下一题`；borderedProminent ocean 白字）。单选选中后 180ms 自动跳下一题（:395-403）；翻页动画 snappy 0.22。
- 校验（:406-421）：`请选择一个选项或填写自定义答案。`；`请先完成这道问题。`（自动跳到未答题）。
- 状态行（:305-320）：提交中 `正在提交整组答案…`/`正在跳过问题…`（caption secondary + 循环箭头）；成功 `服务端已接收，正在恢复 Agent…`（caption 绿 + 实心对勾圆）；失败显示服务端消息（caption 红）。
- 放弃确认（:54-59）：confirmationDialog `放弃这组问题？`，按钮 `跳过并让 Agent 继续`（destructive）/ `继续回答`（cancel），说明 `当前填写的答案不会提交。`
- 计划评审特化（:322-358, 445-466）：单题 + intent.kind=="plan-review" + 详情非空 + 选项≤2 时渲染为计划卡：`计划待审`（caption semibold 橙 + doc.text.magnifyingglass）+ 计划文本（title3）+ Markdown 详情；按钮 `去聊天里说`（bordered）/ `拒绝`（bordered 红，可选）/ `确认执行`（borderedProminent ocean）。

---

## 5. 上下文用量环 + 弹窗

- 环（ContextUsageRing :2584-2600）：18×18，轨道 `secondary` 22% 3pt，进度 ocean 3pt 圆帽、从 12 点方向（-90°）顺时针；外 padding 2；无数据禁用；加载中且无快照显示 26×26 小菊花（:942-947）。进度 = clamp(pressureTokens/contextWindow)（:1769-1775）。无障碍 `上下文已用 N%`。
- 触发：点击按钮 → `.popover(arrowEdge: .bottom)` + `.presentationCompactAdaptation(.popover)`（:952-955）。小程序→自绘锚点弹层，从按钮下方弹出。
- ContextUsagePopover（:2825-2895）：宽 300，padding 18，背景 `ultraThinMaterial`。
  - 首行：`上下文已用`（secondary）+ 百分比（semibold）+ 右侧 `~{已用} / {窗口}`（subheadline monospacedDigit）。数字压缩：≥1M→`%.0fM`/`%.1fM`、≥1K→`%.1fK`、否则原值（:2885-2894）。
  - 进度条：`ProgressView(value)` tint ocean。
  - 明细行（12×12 圆角 3 色块 + 标题 secondary + 右对齐 `~N` monospacedDigit，subheadline，间距 10）：
    - breakdown 模式：`系统提示词`→gray、`工具`→purple、`对话消息`→ocean；
    - tokenUsage 模式：`未缓存输入`→ocean、`缓存读取`→purple、`模型输出`→orange；
    - 都没有：`正在读取上下文用量…`（subheadline secondary + 小菊花）。

## 5b. 会话统计胶囊 + 弹层

- 胶囊（sessionStatsBanner :1499-1538）：右对齐，高 34，玻璃圆角 16；文本=统计摘要（caption monospacedDigit secondary 单行，如 `3 轮 · 12 步`）+ `chevron.up` caption2 semibold tertiary；无数据时 `正在读取会话统计…`。无障碍 `查看会话执行状态`。
- 摘要格式（SessionStatsFormatter :2602-2678）：段间 `  |  `（两空格）；段内 ` · `：`{turns} 轮 · {steps} 步`、`LLM {时长}`、`工具调用 {时长}`、`首 token 平均 {时长}`、`{n} tok/s`、`缓存命中 N%`、`输入 {n} tok`。时长格式：≥60s→`Xm Ys`；≥1s→`{n}s`；否则 `Nms`。
- popover（:2766-2823）：宽 300，padding H22 V16，`ultraThinMaterial`；行样式 subheadline（标题 secondary + 值 monospacedDigit medium）；底部分隔线 + `查看完整统计`（subheadline medium，整行）→关闭 popover 并打开 sheet。
- SessionStatsSheet（:2680-2764）：NavigationStack，标题 `会话状态`（inline），右上 `完成`；detents [medium, large]；背景 `regularMaterial`；分组（headline 标题 + thinMaterial 圆角 16 卡、行 padding V10、行高自适应）：`执行`（`轮次` `{n} 轮`、`步骤` `{n} 步`、`LLM`、`工具调用`、`首 token 平均`、`解码吞吐` `{n} tok/s`）；`Token 用量`（`输入`/`输出`/`缓存读取`/`缓存写入`/`推理`/`缓存命中`，值 `X tok`/`N%`，缺省 `—`）；`上下文`（`当前压力`/`预计用量`/`上下文窗口`）；脚注 `数据截至事件 #N`（caption monospacedDigit tertiary）。无数据：`正在读取会话统计` + 描述 `统计会在本轮结束后自动更新。`

---

## 6. 会话顶栏

RootView.swift:835-901, 1641-1655：

- 标题：`navigationTitle` inline 模式；初值来自路由（新会话固定 `新建 DeepSeek Harness`，:63；已有会话取 session.title，:153-161）；随后订阅 `store.$sessions` **实时跟随服务器改名的会话标题**（自动命名/流式改题一到就换，:848-851）。无跑马灯——inline 大小写系统自动单行截断；本地占位标题体系：`新建 Harness 会话`、`远端会话 {id前缀}`、`空白会话 {id前缀}`（L10n.swift:13-26）。
- 返回：`toolbarRole(.editor)`（:857）→ 返回键只有箭头不带文字；导航栏背景透明（:858）；系统边缘右滑返回优先于页面内横滑（ConversationView.swift:2402-2418 保留 28pt 左缘给系统手势）。会话被远端删除（selectedSessionId 由有变无）时自动 dismiss（:668-671）。
- 右侧状态：8×8 连接圆点（Glass.swift:51-73）——connected `#2EB85C` / failed 红 / connecting `#FFAD1F` / disconnected 灰，外发光 shadow（同色 65%，radius 5）+ 模式名（caption medium secondary 单行，如 `标准模式`；L10n.swift:52-60：standard→`标准模式`、code→`PTC 模式`、minimal→`极简模式`、cordis→`创造模式`）。模式名变化实时跟随（:852-855）。
- 右侧 `…` 菜单（:879-888）：唯一项 `工作区文件`（folder 图标，无会话禁用）→ 打开工作区文件 sheet（列表+下载/预览，超出本页范围）。

---

## 7. 会话页全部弹层清单

| 弹层 | 触发 | 呈现 | 内容要点 |
|---|---|---|---|
| 模式选择 popover | 点模式胶囊（ConversationView.swift:1444-1485） | popover arrowEdge bottom，compact 恒为 popover；宽 292，高 min(条数×68+12, 380) | 每行：模式名 body medium + 描述 caption secondary 单行 + 当前项 `checkmark`；损坏模式禁用且 45% 透明、显示 `模式不可用` 或原因；固定描述：standard `完整工具，适合日常开发`、code `用代码组合多步工具操作`、minimal `仅用 Shell，轻量直接`、cordis `创建和调试自定义 Agent`、其他 `自定义 Agent 模式`；胶囊态文案：`切换中…`/`读取模式…`/`重试模式`；无障碍 `选择会话模式`；未连接或不可选禁用 |
| 统计 popover | 点统计胶囊（:1529-1535） | popover bottom，宽 300 | 见 §5b |
| 统计 sheet | popover 内 `查看完整统计`（:359-364） | sheet，detents medium+large | 见 §5b |
| 上下文 popover | 点环形（:952-955） | popover bottom，宽 300 | 见 §5 |
| 权限/模型菜单 | 点胶囊 | 原生 Menu（pull-down） | 见 §4.3 |
| Goal 编辑/删除 | Goal 面板按钮 | alert | 见 §4.8 |
| 语音不可用 | 按住说话失败 | alert `语音输入暂不可用` + `知道了` | 见 §4.5 |
| 提问放弃 | 提问卡 xmark/跳过 | confirmationDialog | 见 §4.9 |
| 图片预览 | 点聊天气泡图（ConversationViewport.swift:533-546, 2026-2245） | overFullScreen 黑底 crossDissolve；UIPageViewController 横滑 | 关闭钮 38×38（白 16% 底、圆角 19、白色 `xmark` semibold）左上 (16,10)；顶部中央 `i / n`（subheadline semibold 白）；双击放大 2.5×，捏合 1–5×；占位 photo 图标 54×54 白 42%；状态栏隐藏 |
| 工作区文件 sheet | 顶栏 `…`（RootView.swift:897-899） | sheet | 超范围，略 |

---

## 8. 交互时序（滚动 / 动画 / 触感 / 阈值）

### 8.1 滚动到底/跟随规则（ConversationViewport.swift）

- **吸底判定**：`最大偏移 - 当前偏移 ≤ 28pt` 即视为在底部（:1287-1296）；底部回弹过冲不算离底（:1224-1230）。
- **跟随（流式）**：吸底且有新 revision → 每次布局提交后无动画 `setContentOffset` 直贴底部（followStreamingTail :1135-1146）。纯 token 增长不进 diffable，只在文本跨行时失效一行（:674-693）。
- **用户手势优先**：beginDragging 立即暂停流式渲染（增量快照挂起，:1238-1244, 1257-1273），递增 userInteractionGeneration 使自动跟随失效；drag/decel 结束后补渲染挂起快照。
- **滚到底按钮**：`!吸底 && 有内容 && 非冷加载遮罩` 时显示（:740-742）；点击触发多回合对齐（scrollToBottom :1148-1161：invalidate + scrollToItem(.bottom) + 偏移钳制，最多 10 轮、连续 2 轮 contentHeight 变化 <0.5pt 视为稳定）。按钮：36×36 玻璃圆（radius 18）；生成中图标换成小菊花（ocean），否则 `arrow.down` 15pt semibold；出现/消失动画 easeOut 0.16，transition scale(0.85)+opacity（:453-459, 592）；无障碍 `滚动到最新消息`/`正在生成，滚动到最新消息`。
- **加载更早**：用户拖动中 `偏移+顶部inset < 420pt` 且有更多 → 自动请求更早历史（:1231-1235）；成功后用"首行锚点"恢复视觉位置（prependAnchor :1309-1340），不入底部跟随。
- **展开/收起**：点击前记录头行相对视口顶部的偏移，提交后 3 轮恢复锚点（:1042-1085），保证头行不跳。
- **进入会话**：有本地缓存 → 立即贴底（token+1，:690-692）；冷会话 → 遮罩直到列表提交且连续 2 轮稳定后撤下（:624-637, 410-414）。
- **弹层/焦点**：popover 前先停止惯性滚动（stopInertialScrolling :552-562）；聚焦输入框触发贴底（:597-601）；发送/编辑队列后触发贴底。

### 8.2 双页横滑（PersistentSessionPager :2346-2458）

- 最小拖动 12pt；起始点 x≤28 且右滑让位系统返回手势；落点在横向可滚子视图（代码块）上时整段手势归子视图（:2398-2427）。
- 换页阈值 `min(90pt, 页宽×0.18)`，按预测位移判定（:2429-2447）；越界橡皮筋系数 0.18（:2390-2396）；回弹动画 `snappy 0.28`。
- 两页常驻（不虚拟化）保状态；切换会话时视口整体重建（.id(sessionID) :422-424）。

### 8.3 动画/触感汇总

| 场景 | 参数 | 位置 |
|---|---|---|
| 滚到底按钮 | easeOut 0.16 | ConversationView.swift:592 |
| 队列 dock 出入 | easeInOut 0.25（reduceMotion easeOut 0.15） | :880-882 |
| 审批/提问卡出入 | move(bottom)+opacity（默认时长） | :472, 482 |
| 卡片折叠/展开 | snappy 0.24 | ApprovalRequestView.swift:45,126; HumanQuestionView.swift:65,131 |
| 提问翻页 | snappy 0.22；单选自动跳题延时 180ms | HumanQuestionView.swift:427, 395-403 |
| 页切换 | snappy 0.28 | ConversationView.swift:2444 |
| 语音遮罩入/出 | 160ms timingCurve(0,0,0.2,1) / 280ms easeInOut（reduceMotion linear 0.08） | VoiceRipplePanel.swift:5-12 |
| 波形收束 | easeOut 0.16（活跃）/0.32（静默）；取消态颜色 0.2 easeInOut | VoiceRipplePanel.swift:45,61 |
| 鲸尾/流光 | 鲸尾 20fps；流光周期 2.2s；时间轴 30fps | ConversationView.swift:2112-2127 |
| 复制回执 | 1.4s 复原 | :3882-3883 |
| 语音 toast | 2s 消失 | VoiceInputAdapter.swift:89-92 |
| 触感 | 语音开始 soft 0.8 / 取消 selection / 松手 light 0.6 | VoiceInputAdapter.swift:23-25, 77-84 |
| 投影节流 | 会话按显示帧（display link），轨迹 10fps | ConversationTimeline.swift:83-139, AppStore.swift:2877-2888 |
| 队列操作/发送确认超时 | 20s | AppStore.swift:459-464, 1626-1636 |

---

## 9. iOS 专属 → 小程序替代建议

| iOS 机制 | 说明 | 小程序对策 |
|---|---|---|
| ChatLayout/UICollectionView 自 sizing 视口 | 流式性能核心（80pt 估算+显式失效） | scroll-view + 增量 setData；行高用 `createSelectorQuery` 缓存；流式行单独节点避免整页重渲染 |
| `glassEffect`/Material | 玻璃拟态 | `backdrop-filter: blur(20rpx)` + 半透明底 + 1rpx 白色描边近似；暗色描边 white 13% / 亮色 white 56% |
| UIPasteboard 复制 | `复制正文` 按钮 | `wx.setClipboardData`（会弹系统提示，可接受） |
| PhotosPicker + 魔数嗅探 | 20 张 / 100MiB / PNG-JPEG-WebP-GIF | `wx.chooseMedia({count, mediaType:['image']})`，大小校验保留 |
| UILongPressGestureRecognizer（80ms 按住说话） | 输入框长按 | `bindtouchstart/bindtouchmove/bindtouchend` 自实现 80ms 计时 + 上滑 64px 取消；触感用 `wx.vibrateShort` |
| 原生 Menu（权限/模型） | 系统下拉 | 自绘 action sheet/弹层，样式对齐 §4.3 |
| popover（compact 仍为 popover） | 锚点弹层 | 自绘绝对定位弹层 + 蒙版 |
| alert/confirmationDialog | 系统弹窗 | `wx.showModal`（可编辑目标）或自绘 |
| 键盘 `interactive` 下滑收起 + 安全区 | composerBottomPadding = 底部安全区 + 10 | `adjust-position="{{false}}"` + `bindkeyboardheightchange` 手动顶起；`env(safe-area-inset-bottom)` |
| TextKit 增量流式/MarkdownUI | 流式纯文本→完成切 markdown | towxml/自研渲染；代码块横向 scroll-view；JSON 高亮规则见 §1.5 |
| APNG 鲸尾（雪碧图 60 帧 28×28） | 20fps | CSS `steps(60)` + `image` 背景位移，或逐帧 `<image>` 切换 |
| UIPageViewController 图片预览 | 双击 2.5×、捏合 5× | swiper + movable-area/movable-view |
| @ScaledMetric 动态字体 | 胶囊高 34 随字号 | 可忽略，固定 rpx（34pt≈68rpx） |
| 状态栏隐藏的全屏图片预览 | — | 小程序无法隐藏胶囊，保留黑底全屏即可 |

## 10. 关键中文字符串速查（引号内为字面量，禁止改动作为状态比较依据的加 ★ 项）

★状态标记：`你` `DeepSeek · 正在生成` `Think · 正在推理` `Tool Call · 正在组装` `工具完成` `工具失败` `生成已中断` `上下文注入 · `（L10n.swift:35-45）

其余：`上下文` `N 项上下文` `耗时 X 分钟 Y 秒` `耗时 N 秒` `思考过程` `N 次工具调用`（组头）
`调用了 A、B 等工具`（实为 `使用了 A、B 等工具`） `查看 N 个工具结果`（工具束头，ConversationView.swift:3543-3551）
`调用参数` `结果` `错误` `OUT` `失败` `等待结果`（工具详情）
`Think`（推理头） `写入` `修改` `读取` `执行` `搜索` `列出` `获取` `工具`（摘要标签） `N 行` `替换 X → Y 行`
`正在执行…` `正在压缩…` `已完成` `执行失败` `已压缩 N 条历史记录（约 M tokens）`（命令状态）
`对话` `轨迹`（分段控件） `操作远端 DSH Agent` `发送任务后，工具调用、推理进度和最终回复会通过 Mobile Gateway 实时返回。`
`正在加载历史记录` `正在准备会话` `正在定位到最新消息…` `历史记录加载失败` `重新加载历史` `加载更早记录` `Host 无法读取旧格式会话，请修复或升级 Host 后重试。原始记录未修改。`
`输入内容或按住说话` `描述你想要构建的内容` `松手转文字 · 上滑取消` `松手取消` `正在转成文字` `正在获取麦克风权限` `正在开启麦克风` `正在整理录音` `正在准备语音模型` `未识别到人声` `取消` `插入` `丢弃` `草稿已更改，请确认插入识别文字` `语音输入暂不可用` `知道了`
`排队消息 · N` `N 个附件` `编辑排队消息` `删除排队消息` `立即插话`
`任务` `X 已完成 · Y 进行中 · Z 待处理` `展开任务` `收起任务` `进行中的目标` `已暂停的目标` `受阻的目标` `当前目标` `暂停目标` `继续目标` `编辑目标` `删除目标` `目标` `取消` `保存` `删除当前目标？` `删除后，智能体不再持有这个持续目标。` `删除`
`Agent 正在等待审批` `等待审批` `已恢复` `展开审批卡片` `收起审批卡片` `审批详情` `拒绝` `允许一次` `{工具名} 请求执行需要审批的操作`
`需要你的回答` `Agent 正在等待回答` `已从断线前恢复` `收起问题卡片` `放弃整组问题` `可以选择多项` `推荐` `输入你的答案` `或输入自定义答案` `跳过问题` `下一题` `提交` `放弃这组问题？` `跳过并让 Agent 继续` `继续回答` `当前填写的答案不会提交。` `正在提交整组答案…` `正在跳过问题…` `服务端已接收，正在恢复 Agent…` `请选择一个选项或填写自定义答案。` `请先完成这道问题。` `计划待审` `去聊天里说` `确认执行`
`上下文已用` `~X / Y` `系统提示词` `工具` `对话消息` `未缓存输入` `缓存读取` `模型输出` `正在读取上下文用量…` `上下文已用 N%`
`会话状态` `完成` `执行` `轮次` `步骤` `工具调用` `首 token 平均` `解码吞吐` `Token 用量` `输入` `输出` `缓存读取` `缓存写入` `推理` `缓存命中` `上下文` `当前压力` `预计用量` `上下文窗口` `数据截至事件 #N` `正在读取会话统计` `统计会在本轮结束后自动更新。` `查看完整统计` `N 轮 · M 步`
`滚动到最新消息` `正在生成，滚动到最新消息` `复制正文` `已复制` `移除图片` `图片附件` `查看图片` `查看N张图片` `N张` `关闭图片预览` `图片`
`新建 DeepSeek Harness` `新建 Harness 会话` `远端会话` `空白会话`（顶栏/占位）
`标准模式` `PTC 模式` `极简模式` `创造模式` `选择会话模式` `切换中…` `读取模式…` `重试模式` `模式不可用` `完整工具，适合日常开发` `用代码组合多步工具操作` `仅用 Shell，轻量直接` `创建和调试自定义 Agent` `自定义 Agent 模式`
`只读` `工作区写入` `完全访问` `默认权限` `读取默认权限…` `新会话默认权限：X` `未读取`
`DeepSeek Chat` `DeepSeek Reasoner` `DeepSeek Agent` `默认模型` `读取默认模型…` `推理等级` `正在读取模型…` `低` `中` `高`
`工作区文件`（顶栏菜单）
