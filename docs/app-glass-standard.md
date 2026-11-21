# APP 玻璃标准（Liquid Glass）

App 里所有「玻璃样式」统一用这一套参数。**底色与不透明度以系统原生弹窗
（右上角「⋯」菜单）为基准**，模糊/圆角/高光边/投影沿用会话侧栏面板上定稿的那一档。
代码在 `harmonyos/native-app/entry/src/main/ets/common/AppGlass.ets`，
会话侧栏（`ConversationPage.sidebarMenuPanel`）是本标准的基准实现。

## 参数

| 项 | 值 |
|---|---|
| 底色 | 与原生弹窗一致：深色 `rgba(34,34,36,0.78)`（黑底合成 #1B1B1C，透光 22%）/ 浅色 `rgba(248,248,250,0.78)` |
| 背景模糊 | 浅色 `backdropBlur(26)` / 深色 `backdropBlur(96)`（深色用强模糊把背景亮部摊薄，替代高不透明度） |
| 圆角 | `16` |
| 高光细边 | 1vp，深色 `rgba(255,255,255,0.20)` / 浅色 `rgba(255,255,255,0.90)` |
| 投影 | `radius 14 / offsetY 6`，深色 `rgba(0,0,0,0.45)` / 浅色 `rgba(16,19,24,0.12)` |

## 用法

```ts
import {
  APP_GLASS_BLUR, APP_GLASS_RADIUS,
  appGlassBorderColor, appGlassFill, appGlassShadow
} from '../common/AppGlass';

Column() { /* ... */ }
  .backgroundColor(appGlassFill(this.isDark))
  .backdropBlur(APP_GLASS_BLUR)
  .borderRadius(APP_GLASS_RADIUS)
  .clip(true)
  .border({ width: 1, color: appGlassBorderColor(this.isDark) })
  .shadow(appGlassShadow(this.isDark))
```

## 约定

- 需求里说「xx 玻璃 / 玻璃效果 / 毛玻璃」时，默认用本标准的常量，不再另调一套参数。
- 不透明度基准 = 系统原生弹窗（深 0.72 / 浅 0.78）；要调整透明度只改 `appGlassFill()` 一处。
- 需要更糊/更圆/更重投影时，同样只改本标准，全 App 一起变，避免各组件参数漂移。
- 系统 `ImmersiveMaterial`（`systemMaterial`）在本设备上对普通组件不生效，只有系统容器
  （bindMenu / bindSheet）能用；自绘组件一律用本标准。
