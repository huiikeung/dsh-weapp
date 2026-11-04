# 分享封面设计稿（Flukit Harness 微信小程序）

微信小程序分享卡片使用 **5:4** 比例，推荐 **500×400**。全站（含会话页）共用同一张封面：
`miniprogram/assets/brand/app-icon-share-500x400.jpg`（`utils/share.js` 注入默认分享，
`settings.js` / `share-activity.js` 显式引用同一路径）。

## 当前版本：A 极简明亮（2026-11-04 起）

- 设计稿：`share-cover.html`，由 `new-a-light.html` 定稿而来
- 白底 `#F4F6F9` + 右上角蓝色光晕；左侧品牌行、主标题「探索 / 未至之境」、
  副标题与三个胶囊标签；右下角是**品牌真实鲸尾**（`brand-tail-blue.svg`，
  由 `miniprogram/assets/brand/app-icon-whale.svg` 裁紧并染色）配同心圆
- 文字与图形都收在左右各 116px 安全区内，5:4 / 宽横幅 / 朋友圈 1:1 三种裁切都不切字
- 颗粒噪点保留（`.grain`，`feTurbulence` + overlay），导出时不要关闭
- 深色版 `new-a-dark.html`、B 渐变玻璃 `new-b-glass.html` 作为备选保留，未接入

## 成品文件

| 文件 | 尺寸 | 用途 |
| --- | --- | --- |
| `app-icon-share-500x400.jpg` | 500×400 | **包内正式封面**，JPEG q90，约 25.4 KiB |
| `share-cover-package-500x400.jpg` | 500×400 | 与包内文件逐字节一致 |
| `share-cover-500x400.jpg` | 500×400 | 展示版（q94，约 32.6 KB） |
| `share-cover-1000x800.png/.jpg` | 1000×800 | 2 倍图，海报/高清预览 |
| `share-cover-square-preview.png` | 500×500 | 朋友圈 1:1 裁切预览 |
| `share-cover-wide-preview.png` | 900×~397 | 宽横幅卡片裁切预览 |
| `share-cover-compare.png` | — | 三种裁切对比 |
| `new-a-options.png` | — | A 浅/A 深/B 三版对比 |

## 修改与重新导出

设计稿是纯 HTML/CSS，浏览器渲染，无需设计软件：

```bash
# 输出 1000×800 / 500×400（中间 2000×1600 原图自动清理）
bash render.sh share-cover.html share-cover
```

`render.sh` 用无头 Chrome 以 2 倍像素密度渲染，再用 `sips` 降采样。导出包内 JPEG：

```bash
python3 - <<'PY'
from PIL import Image
im = Image.open('share-cover-500x400.png').convert('RGB')
im.save('share-cover-package-500x400.jpg', 'JPEG',
        quality=90, optimize=True, progressive=False, subsampling=2)
PY
cp share-cover-package-500x400.jpg ../../miniprogram/assets/brand/app-icon-share-500x400.jpg
```

导出后跑 `node scripts/check-miniprogram-package.cjs` 确认预算（开发者工具「代码质量」
要求图片+音频资源总量不超过 200 KiB；当前约 198 KiB，余量很小，不要再加图）。

## 备选（未接入）

| 文件 | 说明 |
| --- | --- |
| `new-a-dark.html` / `new-a-dark-1000x800.png` | A 的深色版：深海军蓝渐变 + 亮蓝鲸尾 |
| `new-b-glass.html` / `new-b-glass-1000x800.png` | B 渐变玻璃：蓝紫渐变 + 毛玻璃卡片 |
| `brand-tail-{blue,bright,white}.svg` | 品牌真实鲸尾的三种染色 |
