# DeepSeek Harness iOS v1.7.3 — 会话页（ConversationView）一比一复刻布局规格

> 源码基线：`/tmp/dsh-mobile`（只读分析，未修改任何文件）。
> 主文件：`DeepSeekHarnessMobile/Views/ConversationView.swift`（4239 行）、`DeepSeekHarnessMobile/Components/ConversationViewport.swift`（2351 行）、`Core/Theme.swift`、`Components/Glass.swift`、`Core/ConversationTimeline.swift`、`shared/.../ToolActivitySummary.kt`。
> 行号格式 `文件:行号`，均为本次检出版本。
> 本文是**逐像素可执行规格**：所有 pt 数值均为 iOS 逻辑点；小程序换算 `rpx = pt × 2`（375pt 宽设计基准）。

---

## 0. 总体结构（从顶到底）

```
NavigationStack（RootView.swift:835-901，页面外壳）
├─ 导航栏：inline 标题 = 会话标题（实时跟随服务器改名）；背景透明；
│  右侧 = 连接圆点 8×8 + 模式名(caption medium secondary) + "…"菜单(ellipsis)
│  返回键 toolbarRole(.editor)（只有箭头无文字）
├─ 分段控件 Picker "对话"|"轨迹"，.segmented 样式
│  .padding(.horizontal, 66) .padding(.vertical, 6)          ConversationView.swift:331-337
└─ PersistentSessionPager（双页常驻横滑，非 TabView，不虚拟化）  :339-347, 2346-2458
   └─ 对话页 chat = ZStack(alignment: .bottom)：              :386-579
      (1) ConversationViewport（消息时间线）
          .padding(.horizontal, 20) .padding(.top, 8)         :425-426
          .id(sessionID)   ← 切会话整体重建，禁止上一会话 cell 参与首帧 :422-424
          bottomInset = composerHeight + 22                   :325, 397
      (2) 全屏状态覆盖层（zIndex 1，均 .padding(.bottom, composerHeight)）:
          加载失败 / 历史遮罩 / (加载中 | 空态)                 :429-446
      (3) composerBackdrop：高 composerHeight + 28，不吃事件    :448-450, 1374-1399
      (4) 底部堆叠 VStack(spacing: 0)（zIndex 2）              :452-563
      (5) 语音全屏遮罩 VoiceRipplePanel（zIndex 3，
          高 = 窗口高 × 0.4）                                  :566-578
```

### 0.1 时间线内部（ConversationViewport.swift）

- 技术栈：`UICollectionView` + 第三方 `ChatLayout`（`CollectionViewChatLayout`），单 section，`UICollectionViewDiffableDataSource`。
- 布局常量（:233-240）：`interItemSpacing = 0`；`estimatedItemSize = (390, 80)`；`keepContentOffsetAtBottomOnBatchUpdates = false`；`alignmentForItem = .fullWidth`（所有行全宽，行内自管对齐）。
  → **行与行之间没有任何全局间距，全部垂直节奏由每一行自己的 padding 提供**（用户/助手行 12pt，过程组头 7pt，事件行 2pt，状态行 6pt）。
- `contentInsetAdjustmentBehavior = .never`、`alwaysBounceVertical = true`、`keyboardDismissMode = .interactive`、背景透明、点击空白收键盘（非消耗型手势，不吞链接/复制/展开点击）:391-416。
- 条目顺序 = `supplementalEntries + 消息条目 + (会话运行中时的 deep-search-progress)` :349, 1894-1914。
- 三种 cell：
  | cell | 用途 |
  |---|---|
  | `UserMessageCell`（UIKit）:1624-2024 | 所有用户消息（含图片堆叠卡） |
  | `StreamingAssistantCell`（UIKit TextKit）:2251-2342 | 流式中的助手正文（title == `DeepSeek · 正在生成` 且无图） |
  | `HostedConversationCell`（SwiftUI 托管）:1544-1623 | 其余一切行（助手完成态、过程组、系统行…） |
- 高度：80pt 估算 → `sizeForItem` 返回 exact/estimated，按 `(id, revision, 宽度像素)` 缓存 :1087-1122, 1446-1456。

### 0.2 关键全局常量

| 常量 | 值 | 位置 |
|---|---|---|
| `conversationBottomClearance` | 22pt | :325 |
| `composerCapsuleHeight` | 34pt（@ScaledMetric relativeTo .caption） | :324 |
| `composerHeight` 默认值 | 168pt（实测变化 >0.5pt 才更新） | :310, 2516-2522 |
| `composerBottomPadding` | 窗口底部安全区 + 10 | :1366-1372 |
| 视口 bottomInset | composerHeight + 22 | :397 |
| 吸底判定阈值 | 28pt | ConversationViewport.swift:1287-1296 |
| 触顶自动加载更早历史阈值 | 420pt | ConversationViewport.swift:1231-1235 |

---

## 1. 消息行（cell）规格

### 1.1 用户消息（`UserMessageCell`，ConversationViewport.swift:1624-2024）

```
cell（contentView）
└─ UIStackView(axis:.vertical, alignment:.trailing, spacing:8)   :1784-1786
   ├─ imageGrid(vertical stack, alignment:.trailing, spacing:6)  :1789-1791
   ├─ bubbleView                                                :1793-1796
   │   └─ messageLabel（四边内嵌 10/10/14/14）                   :1836-1839
   └─ copyButton（与气泡自定义间距 5）                            :1816
```

| 属性 | 值 |
|---|---|
| 行内缩进 | stack.leading ≥ contentView.leading + **34pt**（长文本也保持尾随气泡，不撑满）:1833 |
| 行上下外边距 | top **12**、bottom **12**（provisionalBottom 常量 -12，优先级 999）:1818-1831 |
| 气泡圆角 | **15**，`.continuous` :1794 |
| 气泡填充 | ocean，alpha **dark 0.24 / light 0.11** :2011-2016 |
| 气泡描边 | ocean，alpha **dark 0.34 / light 0.08**，宽 **0.7** :2017-2022 |
| 文本内边距 | 上 10 / 下 10 / 左 14 / 右 14 :1836-1839 |
| 正文字体 | `.preferredFont(forTextStyle: .body)` = **17pt**，色 `.label`，多行 :1798-1801 |
| 图片↔文本间距 | stack spacing 8 :1786 |
| 复制按钮 | 16×26，图标资产 `CopyMessage` 模板 16×16，tint `.secondaryLabel`；复制后 `checkmark` 14pt semibold + ocean，**1.4s** 复原 :1804-1808, 1988-2007 |
| 复制显示规则 | 用户消息恒显示（文本非空）；助手消息仅当它是"下一个 user/assistant 之前的最后一条正式回复" :2945-2962 |
| 按压反馈 | 图片预览控件 highlight alpha 0.78 :1704-1708 |

**用户消息图片（UIKit 实际渲染，注意与 SwiftUI 兜底不同）**（:1653-1735, 1937-1967）：

- 可用宽度 `availableWidth = cell 宽 − 34`。
- **单图**：`scale = min(1, min(320/源宽, 320/源高))`，取 floor；即最大 **320×320**，`scaleAspectFill`；圆角 **11**；无边。
- **多图（≥2，最多展示前 3 张）**：堆叠扇形卡——
  - 卡边长 `side = min(164, max(96, floor(availableWidth − 12×(可见数−1))))`，整体尺寸 `side + 12×(可见数−1)` :1946-1951
  - 卡偏移 12pt：第 index 张 frame = `(12×index, 12×(count−1−index), side, side)`；**第一张在最上层且最靠消息** :1719-1725
  - 卡圆角 **18**、`.continuous`、`scaleAspectFill`、边框 **2pt `systemBackground`** :1673-1676
  - 计数徽标：`"{N}张"`，caption1 semibold 白字，底黑 58%，圆角 12，尺寸 **45×26**，位于首图右下 `(maxX−51, maxY−32)`；N<2 时隐藏 :1682-1690, 1726-1732
- 高度公式 :1755-1777：`ceil(24 + 图高 + (有文本? 8 + 文本高 + 20 : 0) + (有复制钮? 5+26 : 0))`。
- 图片字节后到不重建网格（只换 image 内容），避免自 sizing cell 跳动 :1890-1893。

### 1.2 助手正文（ConversationView.swift:3791-3807）

| 属性 | 值 |
|---|---|
| 对齐 | 左对齐、全宽、无气泡 |
| 结构 | VStack(alignment:.leading, spacing: **7**)：图片网格 → Markdown → 复制钮 |
| 行外边距 | `.padding(.vertical, 3)`（内层）+ `.frame(maxWidth:.infinity, alignment:.leading)` + `.padding(.vertical, 12)`（外层）→ **内容上下各 15pt** |
| 正文 | `MarkdownContent(item.text)`，非 compact 模式（见 §1.6） |
| 图片网格（助手/兜底行，SwiftUI `AttachmentImageGrid` :3710-3750） | LazyVGrid，1 列（单图）/ 2 列（多图），间距 6，alignment .trailing；单元格 `aspectRatio` 保持源比例，`maxWidth` 单图 320 / 多图 180，`maxHeight 280`；圆角 **11**，描边 white 16% 宽 0.7；数据未到显示 `secondarySystemFill` + 小菊花 |
| 复制按钮 | `.padding(.bottom, 8)` :3802 |

**流式中的助手行**（`StreamingAssistantCell` :2251-2342）：
- 纯文本 UITextView：body 17pt、`.label` 色、不可选、不滚动、`textContainerInset = 0`、`lineFragmentPadding = 0`。
- 内边距：上 **15** / 下 **15** / 左 **2** / 右 **2**；高度公式 `ceil(15 + 文本高 + 15 + 2)` :2290。
- 增量渲染：新文本是旧文本前缀时只 append 增量（跨帧保留 TextKit 布局状态）:2320-2325。
- 流式结束（revision 变化）整行 reconfigure 回 Markdown 渲染。

### 1.3 推理（Think）行

组内标准形态（`ConversationReasoningHeaderRow` :3450-3484）：

| 属性 | 值 |
|---|---|
| 图标 | 资产 `DshThink`，模板渲染 14×14，槽宽 **18**，色 **DSHColor.purple** |
| 标题 | `Think`，`.subheadline.weight(.medium)`，purple |
| 摘要 | `·`（tertiary）+ 单行预览（subheadline secondary，空白折叠为单空格）:3464-3471 |
| 展开箭头 | `chevron.right`，`.caption.weight(.semibold)`，tertiary，展开旋转 **90°** |
| 行内边距 | `.padding(.leading, 2) .padding(.vertical, 2)` |
| 展开态详情（`ConversationReasoningDetailRow` :3486-3513） | compact Markdown，secondary 色；**左缩进 28**，bottom 5；文本 >4000 字符或 >60 行 → 改为高 **320pt** 内滚动容器（底 `secondarySystemFill` 圆角 10，padding 10） |
| 交互 | 整行按钮，点击切换 expanded（每会话 Set<节点ID> 记忆） |

组外兜底（`ConversationFallbackEventRow` :3912-3965，仅当事件逃出分组时使用）：图标 18 槽 + 标题 tint 色 + `·` + 单行预览（subheadline）；正文 1pt 竖线（gray 24%）+ compact Markdown，`.padding(.leading,5).padding(.top,5).padding(.bottom,3)`。

### 1.4 工具调用行

**工具束头**（`ConversationToolBundleHeaderRow` :3515-3552）：
- 图标 `wrench.and.screwdriver` SF，色 **DSHColor.orange**，槽宽 18；标题 subheadline secondary 单行：`使用了 {前2个工具名、连接}` +（>2 个）` 等工具`；无名字时 `查看 {N} 个工具结果`；箭头 tertiary；padding leading 2 / vertical 2。

**工具头**（`ConversationProcessToolHeaderRow` :3554-3618）：
- 行内边距 `.padding(.leading, 16) .padding(.vertical, 6)`。
- 图标槽宽 **17**；错误 → `exclamationmark.triangle` 红；否则按工具名映射（见 §1.5），色 orange。
- 第一行（HStack spacing 7）：摘要 label（subheadline medium secondary）+ annotation（`.caption.monospacedDigit()`，tertiary）+ 状态徽标：
  - 失败：`失败`，`.caption2.weight(.semibold)`，红
  - 等待结果：`等待结果`，`.caption2`，secondary
- 第二行：detail，`.caption.monospaced()`，secondary，最多 2 行、**中部截断**（truncationMode .middle）。
- 箭头 `chevron.right` caption semibold tertiary，展开 90°。

**工具详情**（`ConversationProcessToolDetailRow` :3620-3641）：`.padding(.leading, 40) .padding(.bottom, 5)`，VStack spacing 9：
- 有调用参数：小标题 `调用参数`（caption semibold secondary）+ `ToolArgumentsView`（把参数包成 ```` ```json ```` 代码块；>3000 字符 → 高 **220pt** 双向滚动，padding 8；容器圆角 9）。
- 有结果：小标题 `结果` / `错误`（caption semibold，错误时红）+ `ToolOutputView`。

**工具输出**（`ToolOutputView` :3967-4014）：
- 顶部 `OUT` 标签（`.caption2.monospaced()`，secondary）。
- 文本 >1500 字符或 >24 行 → 高 **280pt** 双向滚动，逐行 `.caption.monospaced()` 主色、横向固定宽、`defaultScrollAnchor(.topLeading)`、padding 10。
- 否则整段 `.caption.monospaced()` 主色、可选中、padding 10。
- 容器 `secondarySystemFill`、圆角 **10**、VStack spacing 7、裁切。
- **耗时显示**：iOS 会话页的工具行**不显示单次耗时**；耗时只出现在①过程组头（`耗时 N 秒`/`耗时 X 分钟 Y 秒`）②运行指示条（`用时 N 秒…`）③统计胶囊/sheet（LLM/工具调用总时长）。这是与 WebUI 的差异点，复刻时不要自己加。

### 1.5 工具图标映射（conversationToolGlyph :3672-3688）

工具名先小写并剔除非字母数字字符：

| 归一化名 | 图标 |
|---|---|
| write / edit / writefile / editfile / applypatch | SF `pencil` |
| glob / grep / websearch | 资产 `DshSearch` |
| read / webfetch / cordispackageinspect / cordisruntimeinspect | 资产 `DshRead` |
| bash / pwsh | 资产 `DshBash` |
| 其他 | SF `wrench.and.screwdriver` |

资产图标统一：模板渲染、resizable、14×14（`ConversationGlyphImage` :3654-3670）。

### 1.6 过程组（process group）

**分组规则**（`ConversationDisplayEntry.make` :2917-2964）：连续 context/reasoning/tool/jsonTool/toolResult 合并为一组；`status` 先 flush 上一组再自成一组（组 id `message-<首项id>`，其余 `process-<首项id>`）；user/assistant/system 各自成消息行（id `message-<id>`）。

**节点树**（`ConversationProcessNode.make` :3144-3260）——组投影为互相独立的列表行，**头行高度恒定**，展开只是在头行后插入/移除子孙行：

```
groupHeader                     depth 0
├─ commandDetail（status 项，仅当命令文本含换行或 >96 字）  depth 1
├─ 每个 context: eventHeader → (展开) eventDetail          depth 1/2
├─ reasoningHeader → (展开) reasoningDetail                depth 1/2
└─ toolBundleHeader → (展开) 每个工具:
     toolHeader → (展开) toolDetail                        depth 2/3
```

**组头行**（`ConversationProcessHeaderRow` :3285-3336）：
- 上下 padding **7**；底部 1pt 分隔线（`.gray.opacity(0.16)`）:3300-3303。
- 有命令（status 项）：`terminal` 图标 13pt medium（错误红 / secondary）+ 命令标题 subheadline medium（primary/红，单行）+ `·`（tertiary）+ 命令预览 subheadline（secondary/红，单行，空白折叠）。
- 无命令：`processTitle`，subheadline medium secondary 单行，规则（:3073-3105）：
  - 只有 context（无工具无推理）→ `上下文` 或 `{N} 项上下文`
  - 否则按时长：≥60s → `耗时 {X} 分钟 {Y} 秒`；≥1s → `耗时 {N} 秒`；<1s → `思考过程`
  - 追加 ` · {N} 项上下文`、` · {N} 次工具调用`
- 可展开性：无命令恒可展开；有命令需命令文本含换行或 >96 字，或组内有细节项 :3064-3071。
- 箭头 `chevron.right` caption semibold tertiary，展开 90°；整行 contentShape(Rectangle)。

**commandDetail**（:3338-3357）：命令全文 `.system(.subheadline, design: .monospaced)`（错误红/主色，可选中）；卡片 `ultraThinMaterial` 底、圆角 **14**、描边 primary 8% 1pt、padding H14 V12、外层 leading 2 / vertical 4。

**context 行**（:3359-3448）：图标资产 `DshContextInjection` + 标题 + `·` + 预览，**绿色**（tint `.green`），subheadline；箭头 secondary。详情行：1pt 竖线（gray 24%）+ compact Markdown secondary，leading 7 / bottom 5；>900 字符或 >20 行 → 高 320pt 内滚动（底 secondarySystemFill 圆角 10、padding 10）。

### 1.7 其他行类型

- **status 行**（:3835-3849）：`terminal` 图标 13pt medium（红/secondary）+ 标题（primary/红）+ `·` + 文本（secondary/红）；`.font(.subheadline)`；`.padding(.vertical, 6)`；firstTextBaseline 对齐，spacing 9。
- **system 行**（:3850-3861）：图标 `antenna.radiowaves.left.and.right`（ocean）/ 错误 `exclamationmark.circle.fill`（红）；标题 caption semibold + 文本 caption secondary（可选中），spacing 3；外层 padding 10；底色 (ocean/red) **6%**，圆角 **11**。
- **context / reasoning / tool / jsonTool 兜底行**：见 §1.3 末尾（仅逃出分组时出现）。

### 1.8 Markdown 渲染要求（Theme.deepSeek，ConversationView.swift:4066-4131）

| 元素 | 规格 |
|---|---|
| 正文 | **17pt**（compact 模式 **13pt**），前景 `.primary`，无背景；段落 `relativeLineSpacing(.em(0.22))`，margin top 0 / bottom **10**（compact 6） |
| 行内代码 | 等宽、`FontSize(.em(0.86))`（≈14.6pt，compact ≈11.2pt）、主色；iOS≥18 用 TextRenderer 画圆角 chip，<18 回退底色 `systemGray5` 68% |
| 列表项 | `markdownMargin(top: .em(0.18))` |
| 代码块 | 语言标签（存在且非空）`.caption2.monospaced()` secondary **大写** + 6pt 间距；代码横向 ScrollView 不换行，等宽 **13pt**（compact 11）；外层 padding **12**（compact 10）、底色 `secondarySystemFill`、圆角 **9** continuous、margin top 2 / bottom 10（compact 6）；**无复制按钮** |
| 分隔线 | 0.5pt，`separator` 55% 不透明度，margin 上下 **18**（compact 10） |
| JSON 高亮（:4181-4239） | language 为 json/jsonc 或内容本身合法 JSON 时：key → **ocean**；字符串值 → RGB(0.10,0.55,0.38) `#1A8C61`；true/false → **purple**；null → 红 80%；数字 → **orange**；其余主色 |
| 预处理（:4139-4179） | 反引号代码内插入细空格 U+2009；utf16 长度 >24 的 token 在 `/ \ _ . - :` 后插零宽空格 U+200B 以允许换行 |
| 解析缓存（:4039-4064） | NSCache 256 条 / 16MB，按源文缓存解析树 |

---

## 2. 状态区（全屏覆盖层，均 .padding(.bottom, composerHeight)）

### 2.1 空态（:696-706）

```
VStack(spacing: 14)，frame(maxWidth:.infinity)，padding(.horizontal, 28)
├─ WhalenessOrcaIcon(size: 52)   ← 资产 "DshOrcaMark"，模板渲染
│    foregroundStyle: dark → 白 / light → 黑
├─ Text("操作远端 DSH Agent")            .title3.weight(.semibold)   = 20pt semibold
└─ Text("发送任务后，工具调用、推理进度和最终回复会通过 Mobile Gateway 实时返回。")
     .subheadline(15pt) .secondary .multilineTextAlignment(.center)
```

### 2.2 历史加载中（整页不透明遮罩 :763-799）

```
ZStack { conversationBackground(不透明); VStack(spacing:14) {
   ProgressView().controlSize(.large).tint(DSHColor.ocean)
   Text("正在加载历史记录" / 定位期 "正在准备会话")  .title3.weight(.semibold)
   Text(进度文案)  .subheadline .secondary
} padding(.horizontal, 28) }
```

进度文案（:813-829）：`正在从 Mobile Gateway 同步会话内容…` / `正在加载历史记录 · {loaded}/{total}` / `正在加载更早记录…` / `正在加载更早记录 · 已同步 {N} 个事件` / `正在自动加载更早记录 · 已同步 {N} 个事件`。

### 2.3 加载失败（:712-728）

```
VStack(spacing: 14)，padding(.horizontal, 28)，a11y id "history-load-failure"
├─ Image(systemName: "exclamationmark.triangle").font(.largeTitle)(34pt) .orange
├─ Text("历史记录加载失败")  .title3.weight(.semibold)
├─ Text(错误文案，lineLimit 6，居中)  .subheadline .secondary
│    旧格式错误固定为："Host 无法读取旧格式会话，请修复或升级 Host 后重试。原始记录未修改。"
└─ Button("重新加载历史").buttonStyle(.bordered)
```

### 2.4 顶部"加载更早历史"入口（supplemental entries :801-811, 1823-1838）

位于**列表最顶部**（supplemental 条目前置）：

- 加载横幅（列表非空且正在加载时）：`HStack(spacing: 9) { ProgressView().tint(ocean); Text(进度文案).font(.caption)(12pt).secondary; Spacer() }`，`.padding(.horizontal, 10).padding(.vertical, 8)`。
- 分页按钮（未加载且有更多历史时）：`Button("加载更早记录").font(.caption).frame(maxWidth: .infinity)`——**占满整行、12pt 字号**。
- 自动触发：用户拖动中 `contentOffset.y + topInset < 420pt` 且有更多 → 自动请求更早历史（ConversationViewport.swift:1231-1235）。

---

## 3. 底部固定区（自下而上）

### 3.1 输入区 composer

**外层容器**（:866-878）：`VStack(spacing: 队列为空 ? 0 : −24)`：队列 dock（padding h14）在上、composerCard 在下（zIndex 1）——**负 24pt 使 dock 与输入卡叠压**；队列出入动画 `queueLayoutAnimation`。

**composerCard**（:886-1061）：

| 属性 | 值 |
|---|---|
| 结构 | VStack(alignment:.leading, spacing: **12**) |
| 外边距 | `.padding(.horizontal, 14)`，`.padding(.bottom, composerBottomPadding)`（= 底部安全区 + 10） |
| 内边距 | `.padding(.horizontal, 14) .padding(.top, 14) .padding(.bottom, 12)` |
| 背景 | `glassSurface(radius: 24, tint: glassTint)`（iOS 26 为 `.glassEffect(.regular.tint)`，见 §4.2） |
| 描边 | RoundedRectangle(cornerRadius: 24, .continuous).stroke(glassEdge, lineWidth: **0.7**) |
| 阴影 | glassShadow，radius **18**，y **8** |

**输入框**（`VoiceComposerTextInput` :163-185 + `SlashCommandTextView` :36-161）：
- UIKit UITextView：`.preferredFont(forTextStyle: .body)`（17pt，动态字体）、背景透明、`textContainerInset = 0`、`lineFragmentPadding = 0`、tint `systemBlue`、文字 `.label`。
- SwiftUI 包装：`.padding(.horizontal, 3).frame(minHeight: 38, alignment: .top)`。
- 高度钳制：`clamp(实测, 1×行高, 5×行高)`；超过 5 行才允许滚动 :72-87。
- **占位文案**（SharedVoiceInputStore.kt:37）：键盘未聚焦 → `输入内容或按住说话`；键盘聚焦 → `描述你想要构建的内容`。占位符颜色 `secondaryLabel` 62% :246-252。
- 斜杠命令态：token 染 systemBlue；token 后无参数时行内灰色绘制参数 hint（secondaryLabel 62%）:255-275。

**待发图片条**（:1274-1305）：水平 ScrollView 高 **82**，HStack spacing 8；缩略图 `scaledToFit`、最大边 **72**、圆角 **10**；删除钮 `xmark.circle.fill` 20pt palette[白, 黑68%]，offset (+5,−5)，外层 padding 上5 右5；上限 20 张、单条 100MiB。

**底部工具行**（HStack spacing **7**，:915-1016）从左到右：

1. **图片选择**：`photo.on.rectangle.angled` 16pt semibold，容器 **32×32** 圆形；导入中显示小菊花；禁用条件：网关不支持图片 / 已达 20 张 / 导入中。
2. **权限胶囊**（:1540-1634）：新会话=静态 caption medium secondary 宽 **92** 左对齐（`读取默认权限…`+mini 菊花 / 图标+名称 / `shield`+`默认权限`）；有会话=原生 Menu 宽 **78**。图标：`read-only`→`checkmark.shield`、`workspace-write`→`pencil.and.outline`、`danger-full-access`→`exclamationmark.shield`、其他 `shield`。
3. `Spacer(minLength: 2)`。
4. **模型胶囊**（:1566-1706）：新会话=静态右对齐（默认模型名 + 推理等级徽章）；有会话=Menu，标签 = 模型名（minimumScaleFactor 0.72）+ 等级徽章 + `chevron.up.chevron.down` 8pt semibold tertiary。等级徽章：`.caption2.weight(.semibold)`、primary 色、padding H6 V3、底 **purple 14%（新会话）/16%（菜单）** 胶囊。
5. **上下文用量环**（:2584-2600）：**18×18**（外 padding 2），轨道 `secondary` 22% 3pt，进度 **ocean** 3pt 圆帽、从 12 点方向顺时针；无数据禁用；加载中且无快照 → 26×26 小菊花。
6. **发送/停止按钮**（:957-1015）：
   - 容器 **42×42** 圆形，底 **DSHColor.ocean**。
   - 发送态：`arrow.up` 17pt bold 白色；空内容 opacity **0.48**；禁用条件 = 模式禁止发送 / 无内容 / 等待新会话 / 图片导入中 / 命令提交中 / 消息提交中。
   - 停止态（条件：`supportsSessionCancel && 会话运行中 && 输入为空`）：白色圆角方块 **14×14**（圆角 **3** continuous）；取消请求中 opacity 0.66 且禁用。

**背景遮罩 composerBackdrop**（:1374-1399）：高 composerHeight + 28，`Rectangle().fill(.ultraThinMaterial)` + 自底向上 LinearGradient（conversationBackground 透明度 0.02 → 0.78 → 1，startPoint .top → .bottom），再用垂直渐变蒙版（0 → 34% 处黑 58% → 68% 处黑 100%）裁切；`allowsHitTesting(false)`。

### 3.2 排队队列 dock（queueDock :1170-1218）

| 属性 | 值 |
|---|---|
| 位置 | 输入卡上方，与输入卡**叠压 24pt**（负 spacing）；自身 `.padding(.bottom, 24)` 让操作区完整落在输入框外 |
| 形状 | `UnevenRoundedRectangle(topLeading: 24, topTrailing: 24, bottom: 0)` |
| 背景 | `Color(uiColor: .secondarySystemBackground)` |
| 描边 | `shape.strokeBorder(Color.primary.opacity(dark 0.22 / light 0.14), lineWidth: **0.5**)` |
| 其他 | `.clipped()` + `.geometryGroup()`（父布局与内部位置同步插值） |
| 出入动画 | reduceMotion ? easeOut 0.15 : **easeInOut 0.25** :880-882 |

**折叠头**（仅 >1 条时显示，:1181-1194）：`HStack { Image("text.bubble"); Text("排队消息 · {N}") ; Spacer(); Image("chevron.up").rotationEffect(展开?180:0) }`，`.font(.subheadline)`，`.padding(10)`。

**行**（:1221-1254）：
- `HStack(spacing: 4)`：单条时 `text.bubble` 图标（secondary）→ VStack(leading, spacing 3){ 预览 `.subheadline` lineLimit 2；`{N} 个附件` `.caption` secondary } → 动作按钮。
- 动作按钮（36×40，图标 `.system(size: 15)`，foreground secondary，:1256-1264）：
  | 图标 | 无障碍标签 | 启用条件 |
  |---|---|---|
  | `pencil` | 编辑排队消息 | `item.editable` |
  | `trash` | 删除排队消息 | 恒可点 |
  | `arrow.up` | 立即插话 | 会话运行中 |
  - 统一禁用：`!supportsQueueControl` / 网关未连接 / 有 pending 操作。
- 行间分隔线：`Rectangle().fill(Color.primary.opacity(dark 0.14 / light 0.08)).frame(height: 0.5)`，`.padding(.horizontal, 10)`，最后一行不画。
- 执行中（pendingItemId 命中）：该行显示 `ProgressView().frame(36×40)`。
- ≤3 条按内容高度布局；>3 条 → ScrollView 限高 **192pt**。
- 编辑动作：`draft = draft.isEmpty ? text : draft + "\n\n" + text` 并聚焦 :1162-1168。

### 3.3 胶囊行（:488-497）

`HStack(spacing: 8) { sessionAgentPresetControl; sessionStatsBanner 或 Spacer }`，`.padding(.horizontal, 14) .padding(.bottom, 6)`。

- **模式胶囊**（:1401-1487）：高 `composerCapsuleHeight`(34)，padding h12；内容 = `DshAgentPreset` 资产图标 16×16 模板 + 模式名 `.subheadline.weight(.medium)` 单行尾截断 + `chevron.down` `.caption2.weight(.semibold)` secondary；`glassSurface(radius: 16, tint: glassTint.opacity(0.88))` + clipShape(R16) + 描边 glassEdge 0.9 宽 **0.6**；文案：`切换中…` / `读取模式…` / `重试模式` / 模式名。
- **统计胶囊**（:1499-1538）：右对齐，padding h16，高 34；内容 = 摘要 `.caption.monospacedDigit()` secondary 单行（如 `3 轮 · 12 步`）+ `chevron.up` `.caption2.weight(.semibold)` tertiary，spacing 7；同样 glass radius 16 / 描边 0.6；无数据 `正在读取会话统计…`。

### 3.4 任务 / Goal 面板（TaskGoalPanels :2166-2344，位于胶囊行上方）

`.padding(.horizontal, 14).padding(.bottom, 8)`，VStack spacing 8；**仅在没有审批/提问卡时挂载** :483-547。

- 面板容器：`.padding(15)` + `glassSurface(radius: 18, tint: panelGlassTint)` + 描边 R18 `strokeBorder(panelGlassEdge, 1)` + 阴影 `panelShadow radius 8 y 3`。
  - `panelGlassTint` = secondarySystemBackground，dark 0.52 / light 0.48
  - `panelGlassEdge` = dark white 0.22 / light black 0.13
  - `panelShadow` = black dark 0.30 / light 0.10
- 任务头：`list.bullet` 18pt medium secondary + `任务` `.headline` + 摘要 `.subheadline` secondary 单行（`{X} 已完成 · {Y} 进行中 · {Z} 待处理`，仅非零段）+ chevron（`chevron.up`/`chevron.down` subheadline semibold secondary）。
- 任务展开列表：spacing 9；状态图标固定 **20×20** 槽（completed `checkmark.circle` 绿 16×16 / in_progress 小菊花 ocean / 其他 `circle.dotted` tertiary 16×16）；文本 `.body`（completed 为 secondary）。
- Goal 行：`target` 21pt medium secondary + 阶段标题 `.headline`（`进行中的目标`/`已暂停的目标`/`受阻的目标`/`当前目标`）+ 目标文本 `.body` 单行尾截断；动作按钮 **30×30**（`pause.circle`/`play.circle`、`pencil`、`trash`，20pt medium secondary）。

### 3.5 运行指示条（鲸尾动画 + 短语 + 耗时）

**位置：不是固定浮层，而是时间线最后一行**（会话 `isRunning` 时追加，id 固定 `deep-search-progress`，:1894-1914）。起始时间 = 最近一条用户消息时间。

- 行高 **56pt**，顶对齐；顶部 **0.5pt** 分隔线（`Color.primary.opacity(0.025)`）；外层 padding top 8，内层 padding top 13。
- `HStack(spacing: 8)`：
  - 鲸尾动图 **18×18**，模板渲染染 base 色（`RunningWhaleTailFrames`，资产 `RunningWhaleTailSprite` = **1680×28 雪碧图，60 帧 × 28×28**，播放 **20fps**，reduceMotion 停第 0 帧）:2121-2128, 2152-2160
  - 文案 `"{短语}，用时 {N} 秒…"`，`.system(size: 14, weight: .medium)`，单行；`N` = 自起始起的整秒。
- 文字流光：`TimelineView(.animation(minimumInterval: 1/30))`（reduceMotion 1s）；相位 `phase = (t mod 2.2)/2.2×1.8 − 0.4`（周期 **2.2s**）；渐变 = [base, highlight, base]，锚点 `phase ± 0.24` 水平。
  - 颜色：dark base `#A8BEDB` / highlight `#D5E3F4`；light base `#18365A` / highlight `#5B7FA9` :2101-2106
- 短语轮换：**30s 一个桶**；按"起始后事件流"推断活动（context→gathering、tool→exploring、toolResult 非错→reviewing、toolResult 错→revisiting、reasoning→thinking/revisiting、assistant→composing、status→working），取 `(起始Unix秒 + 桶序) % 词数`。词库（:2066-2074）：

| 活动 | 短语 |
|---|---|
| thinking | 梳理脉络中 / 推敲细节中 / 酝酿下一步中 / 沿着思路前行中 |
| gathering | 翻阅已有线索中 / 收拢相关信息中 / 寻找切入点中 / 铺开问题脉络中 |
| exploring | 向外寻找线索中 / 打捞新线索中 / 沿途探查中 / 搜集更多拼图中 |
| reviewing | 对照新发现中 / 拼合新线索中 / 检视所得中 / 把发现串起来中 |
| revisiting | 回看已有线索中 / 重新校准方向中 / 再推敲一遍中 / 换个角度审视中 |
| composing | 组织回应中 / 整理表达中 / 将思路落成文字中 / 勾勒答案中 |
| working | 继续推进中 / 稳步探索中 / 梳理当前进展中 / 逐步展开中 |

### 3.6 滚动到底按钮（:452-459, 831-864）

- 位置：底部堆叠最上方，`.padding(.bottom, 8)`。
- 尺寸 **36×36** 圆形；iOS 26 = `.buttonStyle(.glass) + .buttonBorderShape(.circle)`；更低版本 = `glassSurface(radius: 18)`。
- 图标：生成中 → `ProgressView().controlSize(.regular).tint(ocean)`；否则 `arrow.down` `.system(size: 15, weight: .semibold)`。
- 显示条件：`!冷加载遮罩 && 有内容 && !吸底` :740-742。
- 动效：出现/消失 `.transition(.scale(scale: 0.85).combined(with: .opacity))`，动画 `.easeOut(duration: 0.16)` :592。

---

## 4. 配色与字号

### 4.1 品牌色（Core/Theme.swift:3-14）

| 名称 | RGB | Hex | 主要用途 |
|---|---|---|---|
| ocean | (0.18, 0.42, 0.90) | **#2E6BE6** | 发送键、进度、用户气泡、上下文环、JSON key、链接、checkmark |
| purple | (0.48, 0.33, 0.78) | **#7A54C7** | Think/推理、推理等级徽章、Token 工具/缓存行 |
| orange | (0.94, 0.49, 0.08) | **#F07D14** | 工具调用、JSON 数字 |
| amber | (1.0, 0.68, 0.12) | **#FFAD1F** | 连接中状态点 |
| success | (0.18, 0.72, 0.36) | **#2EB85C** | 已连接状态点 |
| navy | (0.025, 0.09, 0.17) | #06172B | 品牌深底 |
| navyRaised | (0.05, 0.14, 0.25) | #0D2440 | — |
| mist | (0.75, 0.84, 1) | #BFD6FF | 品牌浅色 |
| ink | (0.055, 0.075, 0.1) | #0E131A | 设计稿文字色 |
| paper | (0.975, 0.98, 0.99) | #F9FAFC | 设计稿底色 |

JSON 高亮专用绿：RGB(0.10, 0.55, 0.38) = **#1A8C61**（ConversationView.swift:4227）。

### 4.2 玻璃（glass）三件套（ConversationView.swift:371-384 + Components/Glass.swift:3-49）

| 变量 | Dark | Light |
|---|---|---|
| `glassTint` | `secondarySystemBackground` @ **0.52** | `secondarySystemBackground` @ **0.48** |
| `glassEdge` | white @ **0.13** | white @ **0.56** |
| `glassShadow` | black @ **0.34** | black @ **0.10** |

- iOS 26+：`.glassEffect(.regular.tint(tint), in: .rect(cornerRadius: radius))`。
- iOS <26 回退（Glass.swift:29-41）：`RoundedRectangle(radius, .continuous)` 填 dark ? `.ultraThinMaterial.opacity(0.82)` : `.thinMaterial` + 叠加 tint 色 + 描边 white（dark 0.2 / light 0.7）宽 **0.8** + 阴影 `DSHColor.navy @0.18` radius 16 y 8。
- 小程序近似：`backdrop-filter: blur(20rpx)` + 半透明底 + 1rpx 白色描边。

### 4.3 文字色 / 发丝线

- 正文/主文字：`.primary` / `.label`（= 系统 label，亮 `#000000`、暗 `#FFFFFF`）。
- 次要文字：`.secondary` / `.secondaryLabel`（亮 #3C3C4399(60%)、暗 #EBEBF599）。
- 第三级：`.tertiary` / `.tertiaryLabel`（亮 #3C3C434D(30%)、暗 #EBEBF54D）。
- 占位符：`secondaryLabel @ 62%`。
- 发丝线/分隔线取值汇总：
  - 过程组头底部：`.gray.opacity(0.16)` 高 1pt
  - 详情竖线：`.gray.opacity(0.24)` 宽 1pt
  - 队列行间：`primary` dark 0.14 / light 0.08，高 0.5
  - 运行指示条顶线：`primary @ 0.025`，高 0.5
  - Markdown 分隔线：`separator @ 0.55`，高 0.5
  - 命令详情卡描边：`primary @ 0.08` 1pt

### 4.4 字号表（SwiftUI 语义样式 → iOS pt；小程序 rpx = pt × 2）

| 样式 | pt | 字重 | 页面中的使用 |
|---|---|---|---|
| `.largeTitle` | 34 | regular | 失败态警告图标 |
| `.title3` | 20 | semibold（`.weight(.semibold)`） | 空态标题、加载中标题、失败态标题、提问卡问题 |
| `.headline` | 17 | semibold | `任务`、Goal 阶段标题、统计 sheet 分组标题 |
| `.body` | 17 | regular | 用户气泡正文、任务文本、Goal 文本、流式助手文本、markdown 正文 |
| `.subheadline` | 15 | regular / medium | 过程组头、工具行、状态行、空态副标题、队列预览、模式胶囊、统计胶囊正文 |
| `.footnote` | 13 | regular | （未用） |
| `.caption` | 12 | regular / medium / monospacedDigit | 统计胶囊摘要、附件数、进度文案、`加载更早记录`、`OUT` 上文的标签、system 行文本 |
| `.caption2` | 11 | regular / semibold | `失败`/`等待结果` 徽标、代码块语言标签、`OUT`、chevron 图标、等级徽章 |

自定义字号：`.system(size: 14, weight: .medium)`（运行指示条文案）、`.system(size: 15)`（队列按钮）、`.system(size: 16)`（图片按钮）、`.system(size: 17, weight: .bold)`（发送箭头）、`.system(size: 8)`（模型 chevron）、`.system(size: 13)`（terminal 图标）。

### 4.5 圆角 / 间距速查

| 元素 | 圆角 | 关键间距 |
|---|---|---|
| composer 卡片 | 24 continuous | 外边距 h14、bottom 安全区+10；内边距 h14/t14/b12；内部 spacing 12 |
| 排队 dock | 上 24 / 下 0 | 与输入卡叠压 −24；自身 bottom 24 |
| 模式/统计胶囊 | 16 continuous | 高 34；padding h12 / h16 |
| 任务/Goal 面板 | 18 continuous | padding 15；面板间 8 |
| 用户气泡 | 15 continuous | 文本内 14/10；行 leading 34；行上下 12 |
| 用户单图 | 11 | 最大 320×320 |
| 用户多图卡 | 18 continuous | 卡 164、偏移 12、边框 2 |
| 助手图片网格 | 11 | 间距 6、单图 maxW 320 / 多图 180、maxH 280 |
| markdown 代码块 | 9 | padding 12（compact 10）；语言标签间距 6 |
| 工具输出/详情容器 | 10 | padding 10；VStack spacing 7 / 9 |
| system 行 | 11 | padding 10 |
| 待发图片缩略图 | 10 | 条高 82、间距 8、最大边 72 |
| 上下文环 | 圆形 | 18×18 + padding 2、线宽 3 |
| 发送/停止钮 | 圆形 | 42×42 |
| 图片选择钮 | 圆形 | 32×32 |
| 复制钮 | — | 16×26，与气泡距 5 |
| 队列动作钮 | — | 36×40，图标 15pt |
| 视口 | — | 左右 20、上 8 |

---

## 5. 交互动效

| 场景 | 参数 |
|---|---|
| 滚动到底按钮出入 | `.easeOut(duration: 0.16)`；transition `.scale(0.85) + .opacity` :592, 458 |
| 队列 dock 出入 | `.easeInOut(duration: 0.25)`；reduceMotion `.easeOut(0.15)` :880-882 |
| 审批/提问卡出入 | `.move(edge: .bottom) + .opacity`（系统默认时长）:472, 482 |
| 审批卡折叠/展开 | `.snappy(duration: 0.24)` ApprovalRequestView.swift |
| 提问卡翻页 | `.snappy(duration: 0.22)`；单选后 180ms 自动跳题 |
| 双页横滑回弹 | `.snappy(duration: 0.28)` :2444 |
| 语音遮罩入/出 | 160ms `timingCurve(0,0,0.2,1)` / 280ms easeInOut；reduceMotion linear 0.08 |
| 鲸尾 + 流光 | 鲸尾 20fps；流光周期 2.2s；TimelineView 30fps（reduceMotion 1fps） |
| 复制回执 | 1.4s 后图标复原 :3882-3883 |
| 语音 toast | 2s 自动消失；黑 78% 胶囊、白字 14pt medium、padding H18 V11、位于输入条上方 16pt |
| 折展开头行稳定 | 点击前记录头行相对视口顶部偏移，提交后最多 3 轮恢复（ ConversationViewport.swift:1042-1085） |
| 滚到底（按钮/发送/聚焦） | invalidate + scrollToItem(.bottom) + 偏移钳制，最多 10 轮、连续 2 轮 contentHeight 变化 <0.5pt 视为稳定 :1148-1193 |
| 流式跟随 | 吸底时每次布局提交后无动画直贴底部；用户 beginDragging 立即暂停流式渲染并挂起增量快照 :1135-1146, 1238-1273 |
| 历史前置锚点 | 加载更早历史后用"首行锚点"恢复视觉位置，不触发底部跟随 :1309-1340 |
| 冷会话遮罩 | 直到 diffable 快照真正提交 + 连续 2 轮高度稳定才撤下 :738-743, 624-637 |
| 数据节流 | 会话按 CADisplayLink 逐帧投影（ConversationTimeline.swift:83-139） |

---

## 6. 对既有 `dsh-mobile-session-page-spec.md` 的校正（重要）

本次逐行核对发现既有文档两处与生产渲染路径不符，复刻时以本文为准：

1. **用户消息图片布局**：既有文档 §1.3 描述为"2 列网格、单格 180×280、圆角 11"——那是 SwiftUI `AttachmentImageGrid`（ConversationView.swift:3710-3750），只用于**助手消息**的图片。用户消息实际走 UIKit `UserMessageCell`（ConversationViewport.swift:1624-2024），图片是**堆叠扇形卡**：单图最大 320×320 圆角 11；多图（展示前 3 张）卡边长 `min(164, max(96, availableWidth−12×(n−1)))`、偏移 12、圆角 18、2pt `systemBackground` 边框、首图在最上层，配 `"{N}张"` 45×26 徽标。详见 §1.1。
2. **用户气泡内边距**：既有文档写 H10/V10（SwiftUI 兜底值）；生产路径为 **H14 / V10**（messageLabel 四边常量 10/10/14/14，ConversationViewport.swift:1836-1839）。
3. 补充：既有文档缺少"语义字号 → pt"对照表（见 §4.4）、玻璃三件套精确值（见 §4.2）、运行指示条是**列表行而非固定浮层**（见 §3.5）、以及 composerCard 的双层 padding 关系（见 §3.1）。

其余内容（过程组、工具行、状态区、dock、动画、字符串）经核对与源码一致。
