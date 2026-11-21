/**
 * APP 玻璃标准（Liquid Glass）
 *
 * 这是本 App 唯一的「xx 玻璃」标准样式：底色/不透明度对齐系统原生弹窗
 * （右上角「⋯」菜单：深 rgba(61,61,61,0.72) / 浅 rgba(248,248,250,0.78)），
 * 模糊、圆角、高光细边、投影沿用会话侧栏面板定稿的那一档。
 * 以后任何需求说「加个玻璃样式 / 做成玻璃效果」，默认直接用这里的常量与函数，不要再各写一套。
 *
 * 观感：中性半透明底 + 纯背景模糊（不叠系统主题材质）+ 白色高光细边 + 中性投影。
 *
 * 用法：
 *   .backgroundColor(appGlassFill(this.isDark))
 *   .backdropBlur(APP_GLASS_BLUR)
 *   .borderRadius(APP_GLASS_RADIUS)
 *   .clip(true)
 *   .border({ width: 1, color: appGlassBorderColor(this.isDark) })
 *   .shadow(appGlassShadow(this.isDark))
 */

/** 标准圆角（vp） */
export const APP_GLASS_RADIUS: number = 16;

/** 标准背景模糊强度（浅色）；深色用 appGlassBlur() 的更强档以对齐原生菜单 */
export const APP_GLASS_BLUR: number = 26;

/** 深色下模糊更强：原生菜单（COMPONENT_THICK 材质）实测背景内容糊得更彻底，浅色不变 */
export function appGlassBlur(isDark: boolean): number {
  return isDark ? 56 : APP_GLASS_BLUR;
}

/**
 * 标准玻璃底色：直接对齐系统原生弹窗（右上角「⋯」菜单）的材质色/不透明度，
 * 深色 rgba(61,61,61,0.72)、浅色 rgba(248,248,250,0.78)；模糊由 backdropBlur 提供。
 */
export function appGlassFill(isDark: boolean): string {
  // 深色底：原生那种「透黑」——基色压暗、保留较多透光，靠中等模糊打散背景细节：
  //   36 * 0.72 ≈ 25.9（纯黑底 ≈ #1A1A1B），透光 28%（比上一档更透一丢丢）
  return isDark ? 'rgba(36,36,38,0.72)' : 'rgba(248,248,250,0.78)';
}

/** 标准高光细边：深色 20% 白（实测原生菜单描边比旧值亮一档）、浅色 90% 白 */
export function appGlassBorderColor(isDark: boolean): string {
  return isDark ? 'rgba(255,255,255,0.20)' : 'rgba(255,255,255,0.90)';
}

/** 标准投影：与系统菜单同档悬浮感 */
export function appGlassShadow(isDark: boolean): ShadowOptions {
  return {
    radius: 14,
    color: isDark ? 'rgba(0,0,0,0.45)' : 'rgba(16,19,24,0.12)',
    offsetX: 0,
    offsetY: 6
  };
}
