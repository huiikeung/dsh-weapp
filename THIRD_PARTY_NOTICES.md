# DSH Mobile 首页背景

utils/ocean-renderer.js 和生成的 utils/ocean-particles.js 改编自
Clarklevis1995/dsh-mobile，提交 70b60b7f0b0e75d87554a77d4892203484c6591e：
HarnessAnimatedBackground.swift、HarnessBackground.metal、HeroWhaleMask/hero-whale.svg。
Metal 手机流体场与粒子运动移植为 WebGL，保留原作者许可。

MIT License

components/voice-overlay/voice-field.js 的粒子几何及 voice-overlay 的蒙层、
配色和动画参数改编自同一项目的 VoiceRipplePanel.swift（2026-10-19 主分支）。
下列 MIT 许可同样适用于这些改编内容。

Copyright (c) 2026 Chaofan Li

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

# 品牌字标字体

miniprogram/assets/icons/wordmark-white.png 与 wordmark-ink.png 由 Outfit 600
（Google Fonts，https://fonts.google.com/specimen/Outfit）栅格化生成，该字体使用
SIL Open Font License 1.1（https://openfontlicense.org）。仓库只分发栅格化后的
字标图片，不分发字体文件；源图位于 resources/artwork/brand/。

# 执行状态图标动效

miniprogram/assets/icons/proc-icon-terra-*.gif 与 proc-icon-morph-*.gif 的点阵
球体旋转与圆/三角/方形变形参考自 Jakub Antalík 的 thinking-orbs
（https://github.com/Jakubantalik/thinking-orbs），按小程序 32 x 32、72 帧、
4 秒循环重新实现，未引入其源码。该项目的 MIT 许可全文见
docs/licenses/thinking-orbs.txt。

# 上下文面板（Context tab）口径与算法

会话页「上下文」分段的数据口径、token 估算与组成分类移植自以下项目；本仓库
为小程序/网关运行环境用 JavaScript 独立重写，未直接分发其源码：

- `bowenliang123/dsh-context`（Apache-2.0）：Context tab 的组成分类
  （system/tools/user/inject/skill/assistant/tool/output）、请求趋势与事件
  语义、计费分摊规则。完整许可见 `docs/licenses/dsh-context-apache-2.0.txt`。
- `@deepseek-ai/dsh-token-meter`（MIT）：固定密度 token 启发式
  （4 字符 ≈ 1 token、每 block +4、role +4）与 context breakdown 的
  surface 替换/定价规则，用于保证与宿主官方 `contextBreakdown` 口径一致。
  完整许可见 `docs/licenses/dsh-token-meter-mit.txt`。
