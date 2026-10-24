// 连接状态展示投影：首页 / 会话 / 设置共用同一套颜色语义。
// 已连接 = 绿；连接中 = 琥珀；连接故障（从未连上）= 橙；
// 断链（曾连上又掉线）= 红；未连接 = 灰。
const { t: uiText } = require('./ui-preferences');

const LABELS = {
  connected: '已连接',
  connecting: '连接中',
  failed: '连接失败',
  dropped: '连接中断',
  disconnected: '未连接'
};

function connectionView(app) {
  const status = (app && app.connection) || 'disconnected';
  const connected = status === 'connected';
  // 曾连上又掉线才是「断链」；从没连上的失败是「连接故障」。
  const everConnected = !!(app && app.everConnected);
  let key;
  if (connected) key = 'connected';
  else if (status === 'connecting') key = everConnected ? 'dropped' : 'connecting';
  else if (status === 'failed') key = everConnected ? 'dropped' : 'failed';
  else key = 'disconnected';
  return { key, status, connected, everConnected, label: uiText(LABELS[key]) };
}

module.exports = { connectionView };
