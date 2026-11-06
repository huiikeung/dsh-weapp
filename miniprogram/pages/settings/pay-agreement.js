// 付费服务协议内容（与微信小程序虚拟支付能力对齐）。
// 文案全部走 i18n key，便于英文界面同步；章节结构由页面循环渲染。
const { t: uiText } = require('../../utils/ui-preferences');

const VERSION = 'v1.0';
const EFFECTIVE_KEY = '2026年11月6日';

function metaLine() {
  return uiText('生效日期：{date} · 版本 {version}', { date: uiText(EFFECTIVE_KEY), version: VERSION });
}

function sections() {
  return [
    {
      key: 'scope',
      heading: uiText('一、协议主体与适用范围'),
      paragraphs: [
        uiText('本协议是你与「鲸尾 Harness」微信小程序（以下简称“本小程序”）之间，关于购买和使用公网访问服务的约定。你在本小程序内完成支付，即视为已阅读并同意本协议全部内容。')
      ]
    },
    {
      key: 'service',
      heading: uiText('二、服务内容'),
      paragraphs: [
        uiText('付费服务的核心权益为「公网访问」：在有效期内，你可以通过公网域名从任意网络访问自己电脑上运行的 DSH 控制台，无需与电脑处于同一局域网，也无需保持本小程序在前台。'),
        uiText('服务不含任何硬件、网络接入、电脑端软件或第三方服务的费用。')
      ]
    },
    {
      key: 'price',
      heading: uiText('三、价格与支付'),
      paragraphs: [
        uiText('1. 各档位价格以下单页面实时展示为准，价格由服务端下发，可能因活动或调整而变化；'),
        uiText('2. 支付通过微信小程序虚拟支付能力完成，本小程序不接触、不存储你的支付账户信息、银行卡号或支付密码；'),
        uiText('3. 支付成功后权益立即生效，到期时间可在「设置 → 公网访问」卡片内查看；'),
        uiText('4. iOS 设备受 Apple 支付规则限制，部分低价档位可能不可购买。')
      ]
    },
    {
      key: 'refund',
      heading: uiText('四、退款规则'),
      paragraphs: [
        uiText('付费服务属于虚拟服务，开通后即产生成本，原则上不支持退款。'),
        uiText('若因本服务故障导致权益未能生效，可在 7 日内通过页面底部的「联系客服」与我们核实处理。'),
        uiText('因你自身原因（误购、不再使用等）申请退款的，Android 等平台可联系客服协助处理，iOS 购买需通过 App Store 申请退款。退款成功后，对应天数按规则扣回。')
      ]
    },
    {
      key: 'availability',
      heading: uiText('五、服务可用性与免责'),
      paragraphs: [
        uiText('1. 本服务按“现状”提供，我们会尽力保障可用性，但不承诺 100% 无中断；'),
        uiText('2. 因你本地设备关机、断网、DSH 未运行或微信连接未开启导致无法访问的，不属于服务故障；'),
        uiText('3. 因不可抗力、云服务商故障、政策调整导致服务中断的，我们将按剩余有效期顺延或退还相应费用。')
      ]
    },
    {
      key: 'conduct',
      heading: uiText('六、使用规范'),
      paragraphs: [
        uiText('你不得利用本服务从事违反法律法规的活动，不得将公网访问能力转售、出借或用于攻击、扫描他人网络。违规账号我们有权暂停或终止服务，已支付费用不予退还。')
      ]
    },
    {
      key: 'changes',
      heading: uiText('七、协议变更与联系'),
      paragraphs: [
        uiText('本协议内容可能随服务调整而更新，更新后在本页面公布，继续使用即视为接受。如对本协议有疑问，请联系客服。')
      ]
    }
  ];
}

module.exports = { VERSION, EFFECTIVE_KEY, metaLine, sections };
