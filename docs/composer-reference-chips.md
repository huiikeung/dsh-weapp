# 输入框引用 chip（对话 / 文件夹 / 文件）

## 目标

输入框里 @ 选中的引用从「原始文本」改为桌面端同款 chip：图标 + 主色标题，
排在输入框上方，多个自动换行，chip 上的 × 可整个移除。发送、草稿持久化、
Markdown 预览的口径不变——草稿里始终是原始引用文本。

| 引用 | 线格式（草稿） | chip |
| --- | --- | --- |
| 对话 | @[标题](dsh-session:<base64url>) | 会话图标 + 会话标题 |
| 文件夹 | @licenses/ 或 @"my dir/" | 文件夹图标 + 路径（保留结尾 /） |
| 文件 | @README.md 或 @"src/a b.js" | 文件图标 + 路径 |

## 为什么用零宽占位符

微信 textarea 是原生组件，渲染不了行内富文本；覆盖一层镜像文本又要和原生
光标打架（chip 宽度和原始文本宽度不一致，光标必然错位）。所以：

- draft（data）保存原始引用文本，发送 / 持久化 / 预览都读它；
- composerValue（textarea 显示值）里每个引用只放一个零宽空格
  （composer-menu.js 的 REF_PLACEHOLDER），不占宽度、不影响光标；
- composerRefs（data）按序保存引用 chips（kind/label/raw/icon/key），
  WXML 的 composer-refs 行负责渲染。

用户打字仍然不走 setData 回写（沿用原有低延迟策略）：onDraftInput 用
_composerDisplay 镜像读取 textarea 当前内容，编辑后经 applyDisplayEdit
差分对齐 chips，再把占位符还原成原始文本拼回草稿。

## 指令 token 与引用 chip 共用一套机制

指令 token（/goal 等 input 类指令）和引用 chip 一样只由 chip 渲染：草稿保存
token + ' ' + 参数，textarea 显示值只留参数（空参数时占位文案就是指令提示）。
setComposerValue 负责剥掉 token 前缀，setComposerDisplay 负责拼回去——语音
插入、钻取目录、移除引用 chip 都不会把 token 弄丢。选一个指令只会出现一份
（chip），不会 chip 和原文各一份。

## 关键不变量

- displayToDraft(display, refs) 与 parseReferences(draft) 互为逆运算：
  第 i 个占位符对应第 i 个 ref，错位就表现为 chip 与草稿不一致。
- 只有完整引用 token 会变成占位符。钻取目录时插入的半开 token
  （@src/ 、@"src/）保持字面文本，@ 菜单继续跟着它；用户手打的半截
  会话引用（@[标题](dsh-session:abc）同样保持字面文本。
- 相邻引用（连续选两个、中间不打空格）在草稿里是 @a@b：'@' 紧接上一个
  引用 token 时也开新引用，否则整段会粘成一个 token、第二个引用退化成
  原始文本。邮箱（mail@host.com）这类 '@' 不在锚点上，仍是字面文本。
- 删掉占位符（退格 / 选区覆盖）= 移除对应引用；chip 上的 ×
  （removeComposerRef）做同样的事，并把光标放回 chip 原位。
- 光标坐标一律是显示值坐标（_composerCursor、e.detail.cursor），
  不再是草稿坐标。

## 涉及文件

- miniprogram/pages/session/utils/composer-menu.js：占位符与解析/还原/差分
  （parseReferences / referencesToDisplay / displayToDraft /
  applyDisplayEdit / referenceChips），referenceAtCursor 把占位符
  当作与空白一样的 token 边界。
- miniprogram/pages/session/session.js：composerRefs 数据、
  setComposerValue（原始草稿 → 显示值 + chips）、setComposerDisplay
  （直接写显示值）、composerDisplay（镜像读取）、onDraftInput、
  removeComposerRef；会话切换恢复草稿也走同一条派生。
- miniprogram/pages/session/file-mention-actions.js：insertFileMention
  在显示值里换占位符并插入 chip；drillFileMention 保持半开 token 字面文本。
- miniprogram/pages/session/voice-actions.js：语音识别文字插入显示值。
- resources/runtime-markup/pages/session/session.wxml 与 session.wxss：
  chip 行与样式（蓝色 #5483E8，暗色主题提亮；[hidden] 守卫见
  tests/session-hidden-panels.test.js 的约定）。改动后运行
  node scripts/compact-runtime-markup.cjs 重新生成 miniprogram 副本。
- miniprogram/assets/icons/menu-*-blue.svg：chip 用蓝色图标变体。

## 测试

- tests/composer-refs.test.js：解析 / 还原 / 差分 / 光标边界的单元测试。
- tests/file-mention-actions.test.js：选中会话 / 文件出 chip，钻取保持字面 token。
- tests/composer-actions.test.js：onDraftInput 增删 chip、removeComposerRef、
  chip 行 WXML/WXSS 结构。
