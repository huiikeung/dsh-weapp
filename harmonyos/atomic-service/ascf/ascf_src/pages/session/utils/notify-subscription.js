const { t: uiText } = require('../../../utils/ui-preferences');
const accessApi = require('../../../utils/access-api');
const notifyPref = require('./notify-pref');
const { TEMPLATE_ID } = require('./notify-config');

function requestCompletionTicket() {
  if (!notifyPref.enabled() || !TEMPLATE_ID || typeof has.requestSubscribeMessage !== 'function') return Promise.resolve('');
  return new Promise(resolve => has.requestSubscribeMessage({
    tmplIds: [TEMPLATE_ID],
    success(result) {
      if (!result || result[TEMPLATE_ID] !== 'accept') {
        // 用户拒绝，或模板 ID 无效时微信返回非 accept；打印出来便于排查。
        try { console.warn('[notify] subscribe not accepted:', result && result[TEMPLATE_ID], 'template:', TEMPLATE_ID); } catch (e) {}
        resolve(''); return;
      }
      accessApi.issueCompletionNotificationTicket(TEMPLATE_ID).then(value => {
        resolve(value && /^[A-Za-z0-9_-]{43}$/.test(value.ticket || '') ? value.ticket : '');
      }).catch(() => {
        has.showToast({ title: uiText('通知服务暂不可用，任务仍会发送'), icon: 'none' });
        resolve('');
      });
    },
    fail(error) {
      // 常见错误码：20001 模板 ID 无效/不属于该小程序；20002 模板未发布；20003 频控。
      // 静默失败会让「通知收不到」无从排查，这里显式提示错误码。
      const errCode = error && error.errCode ? error.errCode : 0;
      const errMsg = error && error.errMsg ? error.errMsg : '';
      try { console.warn('[notify] requestSubscribeMessage failed:', errCode, errMsg, 'template:', TEMPLATE_ID); } catch (e) {}
      if (errCode) {
        has.showToast({ title: uiText('订阅授权失败') + ' (' + errCode + ')', icon: 'none' });
      }
      resolve('');
    }
  }));
}

module.exports = { requestCompletionTicket };
