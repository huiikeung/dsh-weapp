'use strict';
const { t: uiText } = require('./ui-preferences');
// Never put Host diagnostics or package-manager output in the catalog banner.
function installSummary(task) {
  if (!task) return '';
  const labels = { checking: uiText('正在准备插件安装'), ready: uiText('插件待安装'), installing: uiText('正在安装插件'),
    applying: uiText('正在应用插件配置'), cancelling: uiText('正在取消安装'), unconfirmed: uiText('安装结果待确认'),
    failed: uiText('插件安装失败'), cancelled: uiText('插件安装已取消'), unknown: uiText('需要核对安装状态') };
  if (task.phase === 'done') return task.result && task.result.application === 'restart-required'
    ? uiText('插件已安装，需要重启 DSH') : task.result && task.result.application === 'overridden'
      ? uiText('插件配置被其他设置覆盖') : uiText('插件安装完成');
  return labels[task.phase] || uiText('插件安装任务');
}
module.exports = { installSummary };
