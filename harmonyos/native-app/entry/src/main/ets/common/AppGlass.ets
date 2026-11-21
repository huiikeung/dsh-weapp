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

/** 标准背景模糊强度 */
export const APP_GLASS_BLUR: number = 26;

/**
 * 标准玻璃底色：直接对齐系统原生弹窗（右上角「⋯」菜单）的材质色/不透明度，
 * 深色 rgba(61,61,61,0.72)、浅色 rgba(248,248,250,0.78)；模糊由 backdropBlur 提供。
 */
export function appGlassFill(isDark: boolean): string {
  return isDark ? 'rgba(61,61,61,0.72)' : 'rgba(248,248,250,0.78)';
}

/** 标准高光细边：深色 16% 白、浅色 90% 白（浅色下靠白边出玻璃感） */
export function appGlassBorderColor(isDark: boolean): string {
  return isDark ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.90)';
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
