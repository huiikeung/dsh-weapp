# APP 玻璃标准（Liquid Glass）

App 里所有「玻璃样式」统一用这一套参数，来源：对话页底部「回到底部」玻璃按钮，
在会话侧栏面板上定稿。代码在
`harmonyos/native-app/entry/src/main/ets/common/AppGlass.ets`。

## 参数

| 项 | 值 |
|---|---|
| 底色 | 深色 `rgba(44,44,48,0.46)` / 浅色 `rgba(255,255,255,0.34)` |
| 背景模糊 | `backdropBlur(26)` |
| 圆角 | `16` |
| 高光细边 | 1vp，深色 `rgba(255,255,255,0.16)` / 浅色 `rgba(255,255,255,0.90)` |
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
- 需要更透/更糊时，只在本标准里改一处，全 App 一起变，避免各组件参数漂移。
- 系统 `ImmersiveMaterial`（`systemMaterial`）在本设备上对普通组件不生效，只有系统容器
  （bindMenu / bindSheet）能用；自绘组件一律用本标准。
