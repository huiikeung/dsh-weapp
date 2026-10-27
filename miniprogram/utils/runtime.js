// 运行时识别：微信小程序 vs 多端 App（native-app 生成的 iOS/Android 容器）。
// 两者的网络能力不同（见 docs/auto-route-selection.md）：
//   · 微信小程序：socket 必须命中合法域名；托管中继需要微信登录换取的公网租赁；
//   · 多端 App：没有合法域名限制，公网直连即可；也没有微信登录，不走中继。
// 识别失败（旧基础库/测试沙箱）时按微信小程序处理：最坏是多一次快速失败的公网尝试，
// 选路学习会记住结果，不会影响后续连接。

/** 是否运行在微信小程序里。多端容器不提供 getAccountInfoSync 或拿不到 appId。 */
function isWeChatMiniProgram() {
  try {
    if (typeof wx === 'undefined' || wx === null) return false
    if (typeof wx.getAccountInfoSync !== 'function') return false
    const info = wx.getAccountInfoSync()
    return !!(info && info.miniProgram && info.miniProgram.appId)
  } catch (e) {
    return false
  }
}

/** 选路用的客户端类型：'wechat' | 'native'。 */
function clientKind() {
  return isWeChatMiniProgram() ? 'wechat' : 'native'
}

module.exports = { isWeChatMiniProgram: isWeChatMiniProgram, clientKind: clientKind }
