# APP 玻璃标准（Liquid Glass）

App 里所有「玻璃样式」统一用这一套参数。**底色与不透明度以系统原生弹窗
（右上角「⋯」菜单）为基准**，模糊/圆角/高光边/投影沿用会话侧栏面板上定稿的那一档。
代码在 `harmonyos/native-app/entry/src/main/ets/common/AppGlass.ets`，
会话侧栏（`ConversationPage.sidebarMenuPanel`）是本标准的基准实现。

## 参数

| 项 | 深色 | 浅色 |
|---|---|---|
| 底色 | `rgba(0,0,0,0.72)`（透黑：黑底 = 页面黑，背景亮部 28% 透光后被模糊摊开） | `rgba(248,248,250,0.78)` |
| 背景模糊 | `backdropBlur(44)`（中等偏轻，背景明暗层次清楚） | `backdropBlur(26)` |
| 圆角 | `16` | `16` |
| 高光细边 | 1vp `rgba(255,255,255,0.20)` | 1vp `rgba(255,255,255,0.90)` |
| 投影 | `radius 14 / offsetY 6`，`rgba(0,0,0,0.45)` | `radius 14 / offsetY 6`，`rgba(16,19,24,0.12)` |

### 深色档的定位（2026-11-21 定稿）

深色按「和系统原生弹窗（右上角「⋯」菜单）同档」逐项实测对齐，最终落在**透黑**观感：

- **底色必须是黑，不是灰**：`rgba(0,0,0,0.72)`。纯黑页面上面板与页面黑融合，
  只有背后的亮部以 ~28% 透进来；这正是原生菜单的观感——「接近页面黑 + 一点模糊」。
  之前用灰色基色（rgba(37,37,39) / rgba(46,46,48) / rgba(81,81,83) 等）无论配多少不透明度，
  都会让面板整体偏灰或偏亮（实测 #2C2C2C、#1B1B1C 都不如黑底自然）；
- **模糊 44**：透进来的亮部被摊成柔和光晕，不再形成清晰灰块；靠模糊而不是靠高不透明度去压亮部；
- 描边亮度实测与原生一致（峰值 ≈ 78/255），黑底时靠这圈细边 + 投影撑出面板边界。

试过但**不采用**的方案：

- 系统 `BlurStyle.COMPONENT_THICK` 材质：在自绘面板上过于透明（页面大字直接透出来），
  与原生菜单观感不符，已回退；
- 高不透明度灰底（0.86~0.92）：太实、没有玻璃感。

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
