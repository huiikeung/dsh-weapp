# 分享封面设计稿（whaletail Harness 微信小程序）

微信小程序分享卡片使用 **5:4** 比例，推荐 **500×400**。本目录包含深色主视觉
（推荐，已接入小程序）与浅色备选的设计稿和成品。深色版保留设计稿里的颗粒噪点，
不做降噪处理。

## 已接入小程序的版本

| 项目 | 值 |
| --- | --- |
| 包内文件 | `miniprogram/assets/brand/app-icon-share-500x400.jpg` |
| 尺寸 / 体积 | 500×400 / 28.4 KiB（JPEG q87，baseline，4:2:0，**保留颗粒噪点**） |
| 引用位置 | `miniprogram/utils/share.js`、`pages/settings/settings.js`、`pages/share-activity/share-activity.js` |
| 旧文件 | `app-icon-share-500x400.png`（256×205，5.9 KB）已移除 |

分享封面是本地图片，不能换成 WXML/CSS 渲染：不传 `imageUrl` 时微信会截当前页面
作为封面，内容和裁切都不可控；传 WXML 也没有对应能力。想要 0 包体只能把图片放到
公网 URL，但依赖服务在线，断网或公网到期时封面会空。

压缩取舍：颗粒噪点是高频信息，会让 JPEG 体积变大（同为 500×400，去噪点版 q82 约
24 KB，保留噪点版 q87 约 28.4 KiB）。这里按设计稿保留噪点，用 q87；再往上 q92
约 36 KB，会把图片资源总量顶出开发者工具 200 K 的提示线。

媒体预算：开发者工具「代码质量」要求图片+音频资源总量不超过 200 K，`scripts/check-miniprogram-package.cjs`
的 `MEDIA_BUDGET` 因此守回 200 KiB。当前图片+音频约 **199 KB / 194.4 KiB**（余约 5.6 KiB）。
为放回封面，还做了两类无损压缩：94 个 SVG 用 svgo（保留 viewBox/颜色，不改可见效果）、
静态 PNG 用 zlib 重编码（像素完全一致）。

## 成品文件

| 文件 | 尺寸 | 用途 |
| --- | --- | --- |
| `share-cover-package-500x400.jpg` | 500×400 | 与包内文件逐字节一致（25.3 KiB，q87） |
| `share-cover-500x400.jpg` | 500×400 | 展示版（q92，约 32 KB，含颗粒） |
| `share-cover-1000x800.png/.jpg` | 1000×800 | 2 倍图，海报/高清预览 |
| `share-cover-light-500x400.jpg` | 500×400 | 浅色备选（约 31 KB） |
| `share-cover-light-1000x800.png/.jpg` | 1000×800 | 浅色 2 倍图 |

## 设计说明

- 视觉语言取自首页深海背景与鲸尾徽标：深海蓝 `#07182B`、海洋蓝 `#2E6BE6`、
  雾蓝 `#BFD4FF`；主标题沿用首页 hero 文案「探索未至之境」。
- 左侧文案区留出约 8% 边距，避免微信卡片的圆角裁切；标题 88px，
  缩到 500×400 时约 44px，聊天列表中仍可读。
- 鲸尾取 `resources/artwork/brand/app-icon-black-1024-3d.png`，按亮度提取
  Alpha 后合成，保留原图的高光与蓝色描边。
- 品牌字标使用 `miniprogram/assets/icons/wordmark-white.png`（深色）/
  `wordmark-ink.png`（浅色），与小程序内品牌行一致。
- 背景颗粒是设计稿的一部分（`.grain`，`feTurbulence` + overlay），导出时不要关闭。

## 修改与重新导出

设计稿是纯 HTML/CSS，浏览器渲染，无需设计软件：

```bash
# 深色主视觉（带颗粒）：输出 2000×1600 原始图，并生成 1000×800 / 500×400
bash render.sh share-cover.html share-cover
# 浅色
bash render.sh share-cover-light.html share-cover-light
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
