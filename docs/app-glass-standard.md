# APP 玻璃标准（Liquid Glass）

App 里所有「玻璃样式」统一用这一套参数。**底色与不透明度以系统原生弹窗
（右上角「⋯」菜单）为基准**，模糊/圆角/高光边/投影沿用会话侧栏面板上定稿的那一档。
代码在 `harmonyos/native-app/entry/src/main/ets/common/AppGlass.ets`，
会话侧栏（`ConversationPage.sidebarMenuPanel`）是本标准的基准实现。

## 参数

| 项 | 深色 | 浅色 |
|---|---|---|
| 底色 | `rgba(46,46,48,0.56)`（透黑：纯黑底合成 ≈ #1A1A1B，透光 44%） | `rgba(248,248,250,0.78)` |
| 背景模糊 | `backdropBlur(44)`（中等偏轻，背景明暗层次清楚） | `backdropBlur(26)` |
| 圆角 | `16` | `16` |
| 高光细边 | 1vp `rgba(255,255,255,0.20)` | 1vp `rgba(255,255,255,0.90)` |
| 投影 | `radius 14 / offsetY 6`，`rgba(0,0,0,0.45)` | `radius 14 / offsetY 6`，`rgba(16,19,24,0.12)` |

### 深色档的定位（2026-11-21 定稿）

深色按「和系统原生弹窗（右上角「⋯」菜单）同档」逐项实测对齐，最终落在**透黑**观感：

- 底色不追高不透明度：用 `41 × 0.64 ≈ 26` 的黑底合成值对齐原生 `#1B1B1C`，
  同时保留 36% 透光，**不发灰**（早期用 0.72~0.92 的高不透明度会显得「实、灰」）；
- 模糊取 44：背景亮部被摊成柔和光晕而不是清晰灰块，但仍能看出明暗层次；
- 描边亮度实测与原生一致（峰值 ≈ 78/255）。

**浅色档未做任何改动**（`0.78 / 26 / 0.90`），后续调深色不要连带改浅色。

## 用法

```ts
import {
  APP_GLASS_RADIUS,
  appGlassBlur, appGlassBorderColor, appGlassFill, appGlassShadow
} from '../common/AppGlass';

Column() { /* ... */ }
  .backgroundColor(appGlassFill(this.isDark))
  .backdropBlur(appGlassBlur(this.isDark))
  .borderRadius(APP_GLASS_RADIUS)
  .clip(true)
  .border({ width: 1, color: appGlassBorderColor(this.isDark) })
  .shadow(appGlassShadow(this.isDark))
```

## 约定

- 需求里说「xx 玻璃 / 玻璃效果 / 毛玻璃」时，默认用本标准的常量，不再另调一套参数。
- 底色/透明度基准 = 系统原生弹窗；深色 `appGlassFill()` 一处控制，浅色另一处，互不影响。
- 模糊按主题分档（`appGlassBlur(isDark)`）：深色 44、浅色 26；要调只改这一个函数。
- 需要更圆/更重投影时，同样只改本标准，全 App 一起变，避免各组件参数漂移。
- 已知限制：系统材质自带的镜面高光/饱和度提升无法用 `backdropBlur` 完全复刻。
- 系统 `ImmersiveMaterial`（`systemMaterial`）在本设备上对普通组件不生效，只有系统容器
  （bindMenu / bindSheet）能用；自绘组件一律用本标准。
