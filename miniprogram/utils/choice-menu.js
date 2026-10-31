// 选项弹层布局：沿用首页工作区选择弹窗的宽高规则（280/224/0.624 取宽、16px 边距、
// 安全区内收起、锚定触发行的中心），但高度按实际选项数精确计算——工作区菜单的公式
// 额外预留了「未分组 / 添加工作区」两行，直接用会多出一块空白。
function choiceMenuLayout(rect, windowInfo, count, navigationBottom) {
  const info = windowInfo || {};
  const windowWidth = info.windowWidth || 375;
  const windowHeight = info.windowHeight || 667;
  const scale = windowWidth / 750;
  const edge = 16;
  const width = Math.min(232, Math.max(192, windowWidth * 0.53), windowWidth - edge * 2);
  const safeTop = Math.max(edge, (navigationBottom || info.statusBarHeight || 44) + 8);
  const safeBottom = Math.min(windowHeight, (info.safeArea && info.safeArea.bottom) || windowHeight) - edge;
  const rowHeight = Math.max(44, 84 * scale);
  const contentHeight = count * rowHeight + 32 * scale + 2;
  const height = Math.min(contentHeight, Math.max(0, safeBottom - safeTop));
  const centerX = rect ? rect.left + rect.width / 2 : windowWidth / 2;
  const centerY = rect ? rect.top + rect.height / 2 : safeTop + height / 2;
  const left = Math.max(edge, Math.min(centerX - width / 2, windowWidth - edge - width));
  const top = Math.max(safeTop, Math.min(centerY - height / 2, safeBottom - height));
  return {
    choiceLeft: left,
    choiceTop: top,
    choiceWidth: width,
    choiceHeight: height,
    choiceOriginY: Math.max(0, Math.min(height, centerY - top))
  };
}

module.exports = { choiceMenuLayout };
