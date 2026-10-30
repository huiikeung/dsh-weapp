/**
 * 选择弹层布局：对齐首页工作区选择弹窗的锚点玻璃菜单。
 *
 * 以触发行为锚点：优先在行下方展开（顶对齐、向下生长），
 * 下方空间不足且上方更宽裕时翻到行上方（底对齐、向上生长）。
 * 内容高度自适应，这里只给上限，超出后弹窗内部滚动。
 */
const EDGE = 16;
const GAP = 8;
const MIN_HEIGHT = 120;
const PREFERRED_MAX_HEIGHT = 420;

function pickerPopoverLayout(rect, windowInfo, navigationBottom, options) {
  const info = windowInfo || {};
  const opts = options || {};
  const windowWidth = info.windowWidth || 375;
  const windowHeight = info.windowHeight || 667;
  const edge = EDGE;
  // 诊断信息 / 清理缓存内容偏长，允许更宽的档位；其余选择项保持首页工作区弹层的窄菜单宽度。
  const width = opts.wide
    ? Math.min(340, Math.max(280, windowWidth * 0.8), windowWidth - edge * 2)
    : Math.min(280, Math.max(224, windowWidth * 0.624), windowWidth - edge * 2);
  const safeTop = Math.max(edge, (navigationBottom || info.statusBarHeight || 44) + 8);
  const safeBottom = Math.min(windowHeight, (info.safeArea && info.safeArea.bottom) || windowHeight) - edge;
  const anchor = rect && rect.height > 0 ? rect : null;
  const centerX = anchor ? anchor.left + anchor.width / 2 : windowWidth / 2;
  const left = Math.max(edge, Math.min(centerX - width / 2, windowWidth - edge - width));
  if (!anchor) {
    // 量不到锚点行时退回视口上部居中，保证弹窗仍然可见。
    const top = Math.max(safeTop, Math.min(Math.round(windowHeight * 0.22), safeBottom - MIN_HEIGHT));
    return {
      pickerPopLeft: left,
      pickerPopTop: top,
      pickerPopWidth: width,
      pickerPopMaxH: Math.min(PREFERRED_MAX_HEIGHT, Math.max(MIN_HEIGHT, safeBottom - top)),
      pickerPopOrigin: '50% 0'
    };
  }
  const anchorBottom = anchor.top + anchor.height;
  const below = safeBottom - (anchorBottom + GAP);
  const above = anchor.top - GAP - safeTop;
  if (below < MIN_HEIGHT * 1.5 && above > below) {
    const room = Math.min(PREFERRED_MAX_HEIGHT, above);
    const bottom = Math.min(anchor.top - GAP, safeBottom);
    const top = Math.max(safeTop, bottom - room);
    return {
      pickerPopLeft: left,
      pickerPopTop: top,
      pickerPopWidth: width,
      pickerPopMaxH: Math.max(0, Math.min(room, bottom - top)),
      pickerPopOrigin: '50% 100%'
    };
  }
  const top = Math.max(safeTop, Math.min(anchorBottom + GAP, safeBottom - MIN_HEIGHT));
  return {
    pickerPopLeft: left,
    pickerPopTop: top,
    pickerPopWidth: width,
    pickerPopMaxH: Math.min(PREFERRED_MAX_HEIGHT, Math.max(MIN_HEIGHT, safeBottom - top)),
    pickerPopOrigin: '50% 0'
  };
}

module.exports = { pickerPopoverLayout };
