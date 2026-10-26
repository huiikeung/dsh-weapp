# Session implementation notes

Long inline explanations moved out of the uploaded runtime to keep the existing package budget.
The first comment line remains beside the implementation. The sections below preserve the full original notes.

## miniprogram/pages/session/session.js

Store protocol rows are reused across emits; only a few row kinds are mutated
in place. Snapshot their shallow render-facing fields without serializing large
message bodies into temporary signature strings on every stream flush.

## miniprogram/pages/session/session.js

旧历史分页在途标志。must be mirrored into page data: maybePrefetchOlderHistory
用它避免请求叠加，此前只读不写，导致"已在分页"判断永远为假。

## miniprogram/pages/session/session.js

输入框 Markdown 预览：composerPreview 开时用 composerPreviewBlocks 渲染，
与发送后的用户消息共用 mdBlocks，保证"看到的就是发出去的"。

## miniprogram/pages/session/session.js

首帧把 textarea 高度直接定成一行（原生组件默认 150px，auto-height 在真机上
要等测量才收回来，日志里它一直停在 150px），量到内容后由 auto-height 接管。

## miniprogram/pages/session/session.js

记录本次隐藏的原因：原生选择器/预览浮层会把小程序切到后台，
此时 onShow 不是「页面切换」，不能重置滚动、也不能强制整页重投影。

## miniprogram/pages/session/session.js

从原生浮层（chooseMedia / chooseMessageFile / previewImage）返回：
页面并未真正切换，强制 syncFromStore 与 resetConversationScroll 会让
会话区闪一下并把滚动位置拽走。数据更新交给 subscribe 流推进即可。

## miniprogram/pages/session/session.js

首次进入时 onLoad 刚同步过同一份快照：再同步一次等于把整份 rows 重新投影 + 跨桥一次，
冷启动最贵的重复工作就在这里。返回本页（间隔久了）才补同步，避免漏帧。

## miniprogram/pages/session/session.js

投影缓存里的同一行也要写回：复用缓存的投影时如果不带 blocks，
已经显示出来的正文会在下一帧整段消失（真机上表现为"某一轮对话没了"）。

## miniprogram/pages/session/session.js

大会话（上千行）每次投影 + 分组 + 差分的成本远高于 32ms：帧率换平滑没有意义，
行数多时把合并窗口放大到 96ms，流式输出仍然连贯，但主线程不再被 sync 占满。

## miniprogram/pages/session/session.js

dsh-mobile 同款两段投影：protocol 只产生语义行，conversation-workflow
再组合成 message / processGroup 展示节点。页面不再直接解释事件协议。

## miniprogram/pages/session/session.js

行投影缓存：静态协议行按对象身份复用；少数会被协议原地修改的行用浅快照验证，
避免每次流式帧都把长文本、工具参数和结果拼成巨型签名字符串。

## miniprogram/pages/session/session.js

兜底：历史懒格式化可能晚于投影产生，缓存的 blocks 还是空的；
Markdown 缓存里已经解析过就直接补上，避免正文空白。

## miniprogram/pages/session/session.js

用户消息也按 Markdown 渲染，但沿用助手消息的懒解析策略：只有接近尾部
的行才立即 parse，更早的进 _pendingHistoryFormat，滚进窗口再格式化。

## miniprogram/pages/session/session.js

顶部标题：实时标题优先；其次回查会话列表（直连打开/列表迟到时）；
都没有则显示「会话」（新会话等 Host 生成标题后经 title 帧实时更新）

## miniprogram/pages/session/session.js

上下文/编队面板只在对应 Tab（或弹窗）可见时才派生视图模型。
否则每次流式 emit 都会重算整棵上下文浏览器与编队卡片，导致页面卡顿。

## miniprogram/pages/session/session.js

没有任何可显示的行时必须给占位（加载中 / 空态）。原来这里用
`!this.data.running` 把运行中的会话排除掉，结果打开一个正在执行的会话时
（无本地缓存 + 历史还没回来）四个占位分支全部落空：对话区一片空白，
只剩底部鲸尾运行条，用户以为内容没有同步过来。

## miniprogram/pages/session/session.js

更早历史页到达后，若用户仍在顶部附近，继续预取下一页，保证继续上滑时已就绪。
必须挂在 historyMerged 上：原来每个 emit 都跑一遍，配合失效的在途判断，
只要用户停在顶部附近就会每 350ms 补拉一页，每页又全量重放整段会话，
主线程被占满 → 横幅一直转"正在同步"、新插入的旧内容始终画不出来。

## miniprogram/pages/session/session.js

DSH 的队列项是 UserMessage：正文在 content[] block 中，而不是顶层字符串。
Gateway 不同版本还可能包在 message/source/payload 下，统一在这里解包。

## miniprogram/pages/session/session.js

DSH 会在 Host 回执前展示本地 pending submission，避免快速连续发送时数量短暂少算。
local: true 的项是本机暂存（尚未发给网关），始终展示在最后。
本地待发项按会话隔离：切到别的会话后不显示、也不会被误发。

## miniprogram/pages/session/session.js

上下文与编队合并成一个滚动（对齐客户端侧栏 Context 面板）：两个 Tab 共享
上下文与编队是两个独立面板：各自派生、各自清理，互不干扰。

## miniprogram/pages/session/session.js

只挂载当前 Tab 的面板：离开后销毁对应节点树，避免隐藏面板保留大量
节点/绑定拖慢对话页（数据仍在 store 缓存，切回时按需重建）。

## miniprogram/pages/session/session.js

A downward finger drag means the reader is moving toward older messages.
Stop live auto-follow immediately; streamed row growth can otherwise pull the viewport back down.

## miniprogram/pages/session/session.js

高度与布局一次 setData 写完：键盘弹起/收起会连发多次事件，分开写等于把整页布局
重算两遍（这正是大会话里"开关输入法要卡半天"的主要来源之一）。

## miniprogram/pages/session/session.js

没有回合在跑时内容高度不会变，滚动位置交给 bindscroll 驱动即可：
之前空闲时也每 350ms 发三连 selector 查询，进页面/阅读时白白吃掉大量桥接与布局时间。

## miniprogram/pages/session/session.js

空对话的空态（鲸鱼 + 说明）本身要垂直居中，贴底滚动会把整块内容顶高；
有消息后再贴底，所以空态下直接跳过这次贴底。

## miniprogram/pages/session/session.js

边输入边渲染：语法一完成就切渲染（键盘不收、焦点不丢，继续打字继续刷新）。
用户点「编辑」改原文后加锁：保持原文，直到语法消失再出现才重新渲染。

## miniprogram/pages/session/session.js

关键：textarea 的 class 会随 composerPreview 切换，微信在属性变化时
用绑定的 composerValue 重新初始化原生组件。不同步最新值 → 粘贴内容被清空（闪一下就没）。

## miniprogram/pages/session/session.js

运行中发送：消息进本机队列等待用户点“发送”箭头，
不再走网关 queue 模式（会被宿主在回合结束时自动发出）。

## miniprogram/pages/session/session.js

运行中发送：只进本机队列，等用户点队列行的发送箭头再真正发出。
之前走网关 queue 模式，宿主会在回合结束时把消息自动发出，绕过了队列的发送按钮。

## miniprogram/pages/session/session.js

乐观回显：消息立即可见（对齐桌面端），网关回显到达时自动合并。
图片带上临时路径，发送后先显示本地图片，不必等附件回填。

## miniprogram/pages/session/session.js

竖向布局：上排两节点 → 中间会话 → 下排两节点
竖排（手机恒走窄态）：上排两节点 0.5 处汇入会话节点 1/3、2/3；下行由 1/3、2/3 分叉。

## miniprogram/pages/session/session.js

子智能体会话必须带持久父地址：父会话是它在 subagentCatalog 里的归属会话
（顶层列表=当前会话；预览内「下级子智能体」=被预览会话），否则网关以
session/agent-busy 拒绝且错误帧无 sessionId，只能等 8s 超时。

## miniprogram/utils/store.js

全局状态仓库：持有 Gateway 连接、工作区/会话列表、当前会话投影与待处理
人类交互请求（question / approval）。页面通过 subscribe(listener) 订阅，
在 onShow/onHide 时注册/注销，与 iOS AppStore 的职责对齐。

## miniprogram/utils/store.js

上下文面板是否处于可见分段（页面切入「上下文」时置 true）：
只在可见时随回合结束刷新，避免每次事件都传一份 context-dashboard。

## miniprogram/utils/store.js

v2 动态刷新：上下文/编队面板可见且会话运行中时每 2.5s 拉一次快照。
上一帧未返回时跳过下一拍（不叠加请求）；切走/停止/切会话立即清 timer。

## miniprogram/utils/store.js

切换主机/重连会先清空业务状态；网络请求返回前先恢复该主机
最近一次成功快照，避免远端旧网关报错时首页整页白屏。

## miniprogram/utils/store.js

候选地址循环轮换（中继 ↔ 直连互为备份，3s 节流防紧密循环）：
此前沿单一方向死磕会导致自动连接永远回不到可达的那条路。

## miniprogram/utils/store.js

上下文/编队面板：会话内即时复用上次结果，避免二次进入重新等待网关回放
缓存键带数据版本：面板投影的 schema 变化后，旧形状的缓存不应再被渲染。

## miniprogram/utils/store.js

Rows survive reconnects, but this new connection still needs an authoritative
tail refresh. Mark them as the local display copy so retries are not blocked
by the previous connection's `loaded:*` state.

## miniprogram/utils/store.js

重连后网关不保留订阅与推送状态：需要重拉会话内容。
但不要清空 rows/rowsAgg —— 原始事件缓冲 rawBuffer 仍然完整，
新 history 帧到达后会经 rebuildWithMore 合并去重后原地重建。
清空只会让页面在两次帧之间闪出空态/骨架屏（用户看到的「页面重新加载」）。

## miniprogram/utils/store.js

快照优先：openSession 依赖订阅后的 session-snapshot，不再立即补 history。
这里记录「哪个会话还在等快照」，快照一到就撤销；超时则回落到 history。

## miniprogram/utils/store.js

An empty bounded tail with a positive host cursor is not an empty chat.
Read the newest history page directly; another tail request can return
the same empty snapshot forever on gateways whose follow stream is thin.

## miniprogram/utils/store.js

通用错误帧不属于普通会话事件，且通常不携带 sessionId。
必须在主路由中显式交给错误处理器，否则 workspaces/sessions/history
等请求即使收到服务端 error，首页仍会错误地显示“已连接 + 空列表”。

## miniprogram/utils/store.js

A sessions response may have been produced before a live turn
event but arrive later through the public relay. Prefer the
just-observed stream state until the stream has gone quiet.

## miniprogram/utils/store.js

会话域：已打开会话时，匹配 sessionId 或省略 sessionId 的会话域帧都按当前会话处理
（0.8.x 主机对 history/session-snapshot/session-stats 等响应帧缺省 sessionId，iOS 同样按上下文接受）

## miniprogram/utils/store.js

---------- 会话统计补拉 ----------
公网中继下首帧可能丢失/变慢，输入框下方三个指标依赖它。
有界补拉：2.5s 起逐次翻倍最多 4 次，收到帧或切会话即停。

## miniprogram/utils/store.js

---------- 运行态兜底 ----------

运行状态的主信号是事件流里的 turn/start、turn/end。移动端可能在回合中途
才订阅（拿不到 turn/start），也可能漏掉 turn/end，于是桌面端已经结束、
小程序却一直显示"处理中"。这里在长时间没有新事件时向主机核实 sessions
列表里的权威 running 标志，避免永久卡住。

## miniprogram/utils/store.js

安静太久：拉一次会话列表校准 running，并补拉会话尾部，
防止个别实时帧丢失后对话过程/回复长时间不更新。
sessions 是轻量投影可以每拍都拉；history 要读整段会话日志，必须限流，
否则长任务里每 4 秒就把 Host 拖去重读一次会话。

## miniprogram/utils/store.js

助手消息结算后：若该条消息不含工具调用、也没有未完成工具，
说明本回合已经产出最终答复；短暂宽限后结束运行态（若期间无新事件）。

## miniprogram/utils/store.js

assistant/message 是 durable settlement，不等于 turn 关闭；
但若该条消息没有工具调用、也没有未完成工具，说明已是最终答复，
短暂宽限后结束运行态（turn/end 或新事件会打断这个判定）。

## miniprogram/utils/store.js

Tail refreshes can finish while an older-page request is still in flight.
Their generic `history` frame must not clear the older-page spinner or move
its cursor forward; only the response matching the requested cursor does.

## miniprogram/utils/store.js

快照本身就是权威历史帧：无论有没有 assistantStream，都要把
historyState 推到 loaded，否则页面会一直显示「正在同步」转圈。

## miniprogram/utils/store.js

The gateway could not prove a complete replay interval (e.g. its
bounded ring expired), or returned an empty bounded opening page for
a non-empty session; keep any snapshot visible and reconcile the tail.

## miniprogram/utils/store.js

插件相关错误帧：requestType 或 requestId 任一匹配即可
（网关 catch-all 错误保证回显 requestId；旧版网关的 unknown-type 错误两者皆无，
  用 message 前缀兜底，避免页面干等 12 秒超时）。

## miniprogram/utils/store.js

归一化指纹判重：live 帧与 history 页形状不同，按原始 JSON 比会把已收到的事件
误判为"已修订"，每次补拉历史尾部都全量重放整段会话。

## miniprogram/utils/store.js

同一事件有两种序列化形状（live 帧扁平 text vs history 页 content blocks），按原始
JSON 判重会误判为"已修订"，每次补拉历史尾部都全量重放整段会话。

## miniprogram/utils/store.js

桌面端发消息时队列帧先到、user/message 事件可能稍晚，这里补拉一次 history 尾部。
但实时流本身就在推同一个会话：刚收到过事件就说明流是通的，补拉只是重复劳动
（还会和本机发送触发的队列帧叠加）。

## miniprogram/utils/store.js

上下文/编队面板只在可见时随回合结束刷新（turn/end 后 800ms 已收敛为非运行态），
避免流式期间反复传整份 request/event 历史或家族快照。

## miniprogram/utils/store.js

「刚完成」标记：会话从运行中变成结束时记下完成时刻，首页绿点只在 24h 内显示，
超过就回到默认灰点。落本地存储，重进小程序仍生效；过期项顺手清掉。

## miniprogram/utils/store.js

设备类型：显式 deviceKind > 配对载荷 hostPlatform > 主机名特征 > 默认电脑。
payload / platform 属于网关明确给的信息，按 payload 来源保存，连接后不再推翻。

## miniprogram/utils/store.js

重新扫码代表用户重新确认了这台主机：自动识别的类型可以刷新；
「编辑主机」里手动选过的类型（user）保持不变，明确来源优先于旧推断。

## miniprogram/utils/store.js

中继链路没有 paired/hello 提交帧（E2EE 握手是二进制协议）：
配对即入库并设为激活，否则档案只在内存里，重启后主机消失。

## miniprogram/utils/store.js

---------- 原生浮层期间的连接抑制 ----------
chooseMedia / chooseMessageFile / previewImage 等原生浮层会触发 app.onHide→onShow，
浮层期间挂起前台健康检查；关闭后用短 ping 验证现有连接，避免重握手和整页重投影。

## miniprogram/utils/store.js

连接静默自检：socket 掉线时 onClose 不一定及时（弱网/息屏），
前台期间周期性 ping 一次，失败即按断链处理 → 指示灯变红并重连。

## miniprogram/utils/store.js

onLaunch is commonly followed immediately by onShow, and native pickers
also generate an onShow when they close. Check the existing socket rather
than replacing a healthy one and replaying the whole session bootstrap.

## miniprogram/utils/store.js

本地缓存立即可呈现（对齐 iOS「Cached content is immediately presentable」）：
冷启动不等连接，先把上次的会话/工作区渲染出来，帧到达后无缝替换

## miniprogram/utils/store.js

v3 中继端点每次换节点/重新配对都会变化，且 E2EE 的 agentPubKey
在 AgentHello 阶段已做密码学验签，端点白名单对它只会阻碍重配对；
因此白名单仅对 v2 直连地址生效。

## miniprogram/utils/store.js

运行态以主机为准：先用已知会话列表播种，再主动补拉一次，
避免打开一个正在运行的会话时被误判为空闲（或反过来）。

## miniprogram/utils/store.js

订阅成功后网关会推一份 session-snapshot（内容与 history 等价，且已经
放到 1 MiB）。两者都会让宿主重读整段会话日志——日志是「每次追加一个
独立 zstd 帧」，没有尾部索引，长会话读一次要好几秒。所以这里不再立即
补一发 history：等快照落地，只有快照没来才回落到 history。

## miniprogram/utils/store.js

Session summaries are the authoritative fallback when the subscription
joins after a turn boundary. 但这一帧在旧网关上仍是全量 projections
（实测 2.9MB）：每开一个会话都重拉一次，中继线路上会和会话快照抢带宽。
列表 10 秒内刚拉过就跳过，首页连接时已经会拉一次。

## miniprogram/utils/store.js

必须先提升缓存行：openSession 恢复缓存时只填了 sessionState.rows，
rowsAgg 还是空聚合器。直接 push 会用一行乐观回显顶掉整段缓存对话，
用户看到的就是"发一条消息、整个会话被清空重载"。
