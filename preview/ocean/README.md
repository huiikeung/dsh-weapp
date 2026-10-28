# 首页深海背景 · Chrome 预览（BEFORE / AFTER / NATIVE）

390×844 CSS @3x 的静态复现 + Chrome 性能基准。用于回答：

1. 现状（低分辨率整帧 WebGL → JPEG → 拉伸）到底糊在哪；
2. 分层渲染（设备像素网格 + SVG 鲸鱼点阵 + 0.7× 流体帧）是否解决糊、是否引入 JPEG 块效应/接缝；
3. 0.4–1.0× 渲染比例与 q0.62–0.78 的 draw+toDataURL 代价，给组件选 ratio/fps。

## 用法

    node scripts/build-ocean-preview.cjs   # 重建 component-*.css / ocean-module-*.js / config.js / native-reference.jpg
    node preview/ocean/shoot.cjs           # 内置静态服务器 + Chrome 截图 + 基准表（--no-benchmark 只截图）

产物：

| 文件 | 内容 |
| --- | --- |
| before.png | BEFORE 稳态：整帧 WebGL 1.066×（416×900）→ JPEG q0.68 → 拉伸到 1170×2532 |
| fallback.png | BEFORE 首屏：WebGL 就绪前的 CSS 兜底（渐变 + 115vw 的 bg-whale.png） |
| after.png | AFTER 稳态：海报底 + 网格 + SVG 鲸鱼点阵 + 0.7× 流体帧（t=8s） |
| after-base.png | AFTER 首屏：海报底 + 网格 + 鲸鱼，流体帧 opacity 0 |
| after-crossfade.png | AFTER 淡入中：首个流体帧 t≈0.2s 与海报各 50%（检查接缝） |
| native.png | 原生 iOS 参考（harness-background-simulator-v2.png 裁到同布局） |
| compare.png | BEFORE / AFTER / NATIVE + 首屏行 的对比总表 |
| crops/whale-{before,after,native}.png | 同一 CSS 区域 1:1 放大（810×480 @3x），看鲸鱼点阵锐度 |
| benchmark-{before,after}.json | 原始基准数据（含 seam/blockiness 指标） |
| screens.json | 截图与渲染配置元数据 |

直接看页面：cd preview/ocean && python3 -m http.server 8080，然后打开 http://localhost:8080/index.html
（页面用相对路径加载生成的 CSS/JS；shoot.cjs 自带同样的静态服务器。）

## 数据来源与保真方式

scripts/build-ocean-preview.cjs 是唯一生成入口，所有样式/着色器/素材都从真实小程序源码读取，不从截图或手写数值复制：

* **BEFORE 快照**：preview/ocean/before-sources/ 冻结了分层改造前的 ocean-background.{js,wxml,wxss} 与旧版 ocean-renderer.js（行为：整帧网格+鲸鱼着色器、ratio = min(pixelRatio, 480/w, 900/h)、toDataURL('image/jpeg', 0.68)、150ms/120ms 延迟、CSS 兜底）。live 源码随后被分层改造覆盖，因此 BEFORE 用快照保证可复现；快照 js 里的 device-probe 埋点只影响日志，渲染比例/质量仍由脚本从快照中解析得到（1.066× / q0.68）。
* **AFTER**：每次构建读取 live 的 miniprogram/components/ocean-background/*、miniprogram/utils/ocean-renderer.js、miniprogram/assets/ocean/whale-body.svg + whale-tail.svg。流体比例（390×844 → 0.6972）、JPEG 质量（0.72）、crossfade 时长（520ms）都从源码解析，不硬编码。
* **WXSS → CSS**：rpx 按 750rpx = 390pt 换算（×0.52），vw/vh 按 390×844 换算；url("data:...") 载荷先保护再还原，避免 base64 被 rpx/vw 正则误改。BEFORE/AFTER 两套 wxss 分别加 .ocean-before / .ocean-after 作用域共存。
* **着色器/粒子**：ocean-renderer.js 与 ocean-particles.js 原文嵌入（CommonJS require/module.exports shim），BEFORE/AFTER 各一份，保证 shader 不漂移。
* **层 DOM**：构建时解析 shipped wxml（build 脚本里的 parseWxmlLayers）得到层序、标签和 class，写进 config.js；page.js 只按配置建 DOM。解析结果与 wxml 的层序/条件分支差异会用断言的 7 个首层 class 校验，失败则退回内置层表并打印 fallback 提示。（BEFORE: fallback → frame → grain/depth/settle；AFTER: base → fluid(frames) → grain → grid → whale → depth → settle。）
* **原生参考**：1206×2622 @3x 的 dsh-mobile 设计稿 cover 到 1170×2532（q95 JPEG）。它带原生 UI 文字/玻璃卡片，只作观感基准，不是逐像素目标。
* **截图口径**：390×844 CSS 页面，deviceScaleFactor 3；动画冻结在固定相位（grain 25% 关键帧、settle 8s、鲸鱼漂移 0 相位、crossfade 用 t=0.2s 首帧），保证可逐像素比较。

Chrome 的 --window-size 有 500px 下限，本预览不依赖窗口尺寸：手机 stage 是页面里固定 390×844 的 DOM，vw 已在生成 CSS 时换算成 px，所以 390 视口不受影响。

## 基准（Chrome headless, ANGLE Metal Apple M4, 390×844 CSS, 30 帧平均）

完整表见 benchmark-before.json / benchmark-after.json。关键行（draw + toDataURL；dataURL bytes 为 JPEG base64 解码后大小）：

### AFTER（分层后的流体-only shader）

| ratio | buffer | q | draw ms | encode ms | draw+encode ms | p95 ms | dataURL bytes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0.62 | 242×523 | 0.70 | 0.007 | 2.283 | 2.29 | 4.2 | 3,931 |
| 0.62 | 242×523 | 0.72 | 0.007 | 2.430 | 2.44 | 4.4 | 4,043 |
| 0.62 | 242×523 | 0.78 | 0.017 | 3.003 | 3.02 | 6.5 | 4,799 |
| 0.70（shipped 0.6972） | 273×591 | 0.70 | 0.003 | 2.430 | 2.43 | 4.4 | 4,507 |
| 0.70（shipped 0.6972） | 273×591 | 0.72 | 0.010 | 2.580 | 2.59 | 4.9 | 4,635 |
| 0.70（shipped 0.6972） | 273×591 | 0.78 | 0.003 | 2.550 | 2.55 | 4.4 | 5,608 |
| 0.72 | 281×608 | 0.70 | 0.007 | 2.937 | 2.94 | 5.2 | 4,582 |
| 0.72 | 281×608 | 0.72 | 0.010 | 2.497 | 2.51 | 4.1 | 4,718 |
| 0.72 | 281×608 | 0.78 | 0.007 | 2.507 | 2.51 | 4.7 | 5,625 |
| 1.00 | 390×844 | 0.72 | 0.027 | 4.503 | 4.53 | 7.0 | 6,897 |

### BEFORE（整帧 shader，含网格+鲸鱼）

| ratio | buffer | q | draw ms | encode ms | draw+encode ms | p95 ms | dataURL bytes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1.066（shipped） | 416×900 | 0.68 | 0.020 | 5.260 | 5.28 | 8.2 | 20,987 |
| 0.70 | 273×591 | 0.70 | 0.017 | 3.303 | 3.32 | 6.3 | 12,072 |
| 1.00 | 390×844 | 0.70 | 0.023 | 5.260 | 5.28 | 8.2 | 20,242 |

（旧 renderer 内部把 ratio 下限钳到 0.5，所以 BEFORE 表里 0.4 实际是 0.5 缓冲。）

端到端代理（draw → encode → 解码成可显示的 data URL 图片）：

* BEFORE 1.066×/q0.68：encode 6.36 ms + decode 1.41 ms = 7.78 ms，23,053 B
* AFTER 0.6972×/q0.72：encode 2.86 ms + decode 0.65 ms = 3.53 ms，4,734 B

## 判定

* **鲸鱼/网格锐度**：AFTER 点阵是设备像素 SVG，1:1 下点的 blob 面积中位数 71 px²（DPR3）vs 原生参考 68 px²（约 4% 以内），点边缘无晕染；网格线对比度 7.0/6.1（残差单位）vs 原生 7.1/5.1，基本持平。BEFORE 的点是 1.07× 缓冲上采样 + JPEG 压缩，blob 中位数 79 px² 且大量互相粘连（最大 287 px²，视觉上是毛球），网格也偏弱（5.5/4.1）。
* **JPEG 块效应/banding（0.7×、q0.72）**：流体帧原位解码后逐像素看，8×8 块边界梯度均值 0.9 灰阶、块内 0.32 灰阶（通常 <1 级，8bit 下不可表达）；上采样到 1170×2532 后 1:1 观察平滑光带与暗部均无可见块/色带，grain（opacity .06、约 1 设备像素颗粒）进一步打散残差。0.4×–0.62× 也没有明显块效应（字节更小），但 0.62× 的细光带会略软。
* **crossfade 接缝**：海报（着色器 t=0 静态帧）vs 首个流体帧（t=0）平均像素差 0.98/255（p95 = 2，0% 像素 >4 级），200ms 后仍是 1.04/255。即淡入起点几乎逐像素一致，不会闪一下/亮暗跳变。after-crossfade.png 是 50% 中间态，肉眼无接缝。
* **首屏**：BEFORE 首屏是 115vw 的模糊 bg-whale.png 大环 + 单层径向光；AFTER 首屏已经是清晰的网格 + 鲸鱼点阵 + 海报底（after-base.png），没有“先糊后清”阶段。流体帧到达后只补上平滑光带，接缝指标同上。
* **与原生参考的差异**（非缺陷，供决策）：AFTER 整体更暗、鲸鱼点更暗。同区域背景亮度 29 vs 原生 43.7（/255），点峰值 86 vs 104；原生设计稿的玻璃卡片会整体提亮观感。若想更接近原生“亮蓝 + 高对比点阵”，可把 .ocean-whale opacity 从 .56 提到 .62–.66，或把海报/流体整体提亮一档；纯锐度层面已与原生一致。
* **性能**：AFTER 0.7×/q0.72 在桌面 Chrome 的 draw+encode ≈2.6ms（p95 4.9ms），对 8fps 的 125ms 预算几乎无感；缓冲像素从 416×900=374k 降到 273×591=161k（-57%），dataURL 从 20–23KB 降到 4.6KB（-78%~-80%）。手机上 toDataURL 的 GPU 回读+编码仍是主要成本，但面积和体积都降了一个量级。

## 建议

* **保持 0.70× / q0.72 / 8fps**（当前实现）。桌面基准里 0.62× 只快 ~0.3ms、体积小 ~0.6KB，但细光带略软；0.72× 与 0.70× 差异在噪声范围内；0.78 质量收益被 grain 掩盖、体积 +21%。
* 若 device-probe 真机测得单帧 encode >30ms：退到 0.62× / q0.70（2.29ms、3.9KB，仍无可见块效应），不要继续降质量。
* 0.4×（156×338）体积仅 2.6KB，但光带明显发软，不建议常驻（可作极端省电档）。
* 提升观感优先调 CSS 层（鲸鱼 opacity/亮度、海报底亮度），比提高流体比例更划算：流体帧只有平滑渐变，比例 0.7→1.0 只多 0.9KB 且对锐度无贡献（网格/鲸鱼早已是设备像素绘制）。

## 限制

* 桌面 Chrome（Metal/ANGLE）只作为相对代价的代理；真机 WebView 的 GPU 回读/JPEG 编码绝对耗时以 device-probe 实测为准。
* 原生参考是 AI 生成的设计稿（含 UI 文字/玻璃），色调/曝光不能当作逐像素目标。
* 截图冻结了动画相位；流体动态、grain 动画观感请结合真机/录屏。
