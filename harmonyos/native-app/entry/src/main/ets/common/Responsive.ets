/**
 * 平板 / 宽屏布局常量与工具（对齐 iOS iPad 布局）。
 *
 * 实测 iPad（2752×2064px，≈1376vp）：
 *   · 对话正文/输入条是居中的一栏，宽度约 1000vp，两侧留白；
 *   · 首页是两栏（左：Hero/工作区/新建会话；右：最近会话），整体限宽约 1180vp；
 *   · 设置页居中一栏约 720vp。
 *
 * 手机上（< WIDE_BREAKPOINT）所有函数返回 0 / false，布局保持原样。
 */

/** 宽屏断点（vp）：>= 该宽度按平板/大屏布局渲染 */
export const WIDE_BREAKPOINT: number = 840;

/** 对话正文 / 输入条在宽屏下的最大宽度（vp，对齐 iOS iPad 阅读栏） */
export const CONVERSATION_MAX_WIDTH: number = 1000;

/** 首页两栏整体最大宽度（vp） */
export const HOME_MAX_WIDTH: number = 1180;

/** 设置页居中一栏最大宽度（vp） */
export const SETTINGS_MAX_WIDTH: number = 720;

/** 是否宽屏（平板 / 大窗口 / PC） */
export function isWideWidth(widthVp: number): boolean {
  return widthVp >= WIDE_BREAKPOINT;
}

/** 宽屏下为了让内容居中限宽，左右各需要留出的边距（vp）；手机返回 0 */
export function wideSideInset(widthVp: number, maxContentWidth: number = CONVERSATION_MAX_WIDTH): number {
  if (!isWideWidth(widthVp)) {
    return 0;
  }
  return Math.max(0, (widthVp - maxContentWidth) / 2);
}
