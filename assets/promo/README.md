# 分享封面设计稿（whaletail Harness 微信小程序）

微信小程序分享卡片使用 **5:4** 比例，推荐 **500×400**。全站（含会话页）共用同一张
深色封面；浅色备选与旧版素材已移除。设计稿保留颗粒噪点，不做降噪处理。

## 已接入小程序的版本

| 项目 | 值 |
| --- | --- |
| 包内文件 | `miniprogram/assets/brand/app-icon-share-500x400.jpg` |
| 尺寸 / 体积 | 500×400 / 24.9 KiB（JPEG q87，baseline，4:2:0，**保留颗粒噪点**） |
| 引用位置 | `miniprogram/utils/share.js`、`pages/settings/settings.js`、`pages/share-activity/share-activity.js` |
| 旧文件 | `app-icon-share-500x400.png`（256×205，5.9 KB）已移除；浅色备选 `share-cover-light-*` 也已删除 |

分享封面是本地图片，不能换成 WXML/CSS 渲染：不传 `imageUrl` 时微信会截当前页面
作为封面，内容和裁切都不可控；传 WXML 也没有对应能力。想要 0 包体只能把图片放到
公网 URL，但依赖服务在线，断网或公网到期时封面会空。

压缩取舍：颗粒噪点是高频信息，会让 JPEG 体积变大。这里按设计稿保留噪点，用 q87
（当前 24.9 KiB）；q92 展示版约 31.8 KB，只放在本目录，不进包。

媒体预算：开发者工具「代码质量」要求图片+音频资源总量不超过 200 K，`scripts/check-miniprogram-package.cjs`
的 `MEDIA_BUDGET` 因此守回 200 KiB。当前图片+音频约 **189.8 KiB / 200 KiB**（余约 10 KiB）。
为放回封面，还做了两类无损压缩：94 个 SVG 用 svgo（保留 viewBox/颜色，不改可见效果）、
静态 PNG 用 zlib 重编码（像素完全一致）。

## 成品文件

| 文件 | 尺寸 | 用途 |
| --- | --- | --- |
| `share-cover-package-500x400.jpg` | 500×400 | 与包内文件逐字节一致（24.9 KiB，q87） |
| `share-cover-500x400.jpg` | 500×400 | 展示版（q92，约 31.8 KB，含颗粒） |
| `share-cover-1000x800.png/.jpg` | 1000×800 | 2 倍图，海报/高清预览 |
| `share-cover-compare.png` / `share-cover-square-preview.png` / `share-cover-wide-preview.png` | — | 裁切对比与预览（5:4 / 1:1 / 宽横幅） |

## 设计说明

- 视觉语言取自首页深海背景与鲸尾徽标：深海蓝 `#07182B`、海洋蓝 `#2E6BE6`、
  雾蓝 `#BFD4FF`；主标题沿用首页 hero 文案「探索未至之境」。
- 鲸尾大图作为背景层：尾鳍落在顶部空隙并做了提亮（亮度 2.1、柔化 3px，
  只保留顶部 40%），尾柄/水波延伸下来被文案压住；鲸尾整体略偏左上。
- 文案居中悬浮，标题 86px（缩到 500×400 约 43px），上方留品牌行、
  下方留页脚，朋友圈 1:1 裁切下内容完整。
- 鲸尾取 `resources/artwork/brand/app-icon-black-1024-3d.png`，按亮度提取
  Alpha 后合成，保留原图的高光与蓝色描边。
- 品牌字标使用 `miniprogram/assets/icons/wordmark-white.png`（深色）/
  `wordmark-ink.png`（浅色），与小程序内品牌行一致。
- 背景颗粒是设计稿的一部分（`.grain`，`feTurbulence` + overlay），导出时不要关闭。

## 修改与重新导出

设计稿是纯 HTML/CSS，浏览器渲染，无需设计软件：

```bash
# 深色主视觉（带颗粒）：输出 1000×800 / 500×400（中间 2000×1600 原图自动清理）
bash render.sh share-cover.html share-cover
```

`render.sh` 使用无头 Chrome 以 2 倍像素密度渲染，再用 `sips` 降采样，
保证文字边缘干净。导出包内 JPEG（从带颗粒的 500×400 原图）：

```bash
python3 - <<'PY'
from PIL import Image
im = Image.open('share-cover-500x400.png').convert('RGB')
im.save('share-cover-package-500x400.jpg', 'JPEG',
        quality=87, optimize=True, progressive=False, subsampling=2)
PY
```

导出后同步到 `miniprogram/assets/brand/app-icon-share-500x400.jpg`，并跑
`node scripts/check-miniprogram-package.cjs` 确认预算。
