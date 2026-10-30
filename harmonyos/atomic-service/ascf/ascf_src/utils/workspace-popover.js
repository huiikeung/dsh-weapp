// Match the iOS Menu around the source card, without moving the page content.
function workspacePopoverLayout(rect, windowInfo, count, navigationBottom) {
  const info = windowInfo || {};
  const windowWidth = info.windowWidth || 375;
  const windowHeight = info.windowHeight || 667;
  const scale = windowWidth / 750;
  const edge = 16;
  const width = Math.min(280, Math.max(224, windowWidth * 0.624), windowWidth - edge * 2);
  const safeTop = Math.max(edge, (navigationBottom || info.statusBarHeight || 44) + 8);
  const safeBottom = Math.min(windowHeight, (info.safeArea && info.safeArea.bottom) || windowHeight) - edge;
  // Match CSS sizing, keeping every row a 44px minimum touch target.
  const contentHeight = (count + 2) * Math.max(44, 84 * scale) + (32 + (count ? 50 : 25)) * scale + 2;
  const height = Math.min(contentHeight, Math.max(0, safeBottom - safeTop));
  const centerX = rect ? rect.left + rect.width / 2 : windowWidth / 2;
  const centerY = rect ? rect.top + rect.height / 2 : safeTop + height / 2;
  const left = Math.max(edge, Math.min(centerX - width / 2, windowWidth - edge - width));
  const top = Math.max(safeTop, Math.min(centerY - height / 2, safeBottom - height));
  return {
    popLeft: left, popTop: top, popWidth: width, popHeight: height,
    popOriginY: Math.max(0, Math.min(height, centerY - top))
  };
}

module.exports = { workspacePopoverLayout };
