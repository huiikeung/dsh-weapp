// ASCF is its own HarmonyOS runtime. Its network requests must follow the
// configured WSS domain policy; it is neither the WeChat mini program runtime
// nor an unrestricted native-app socket.
function isASCFRuntime() {
  try {
    return typeof has !== 'undefined' && has !== null &&
      typeof has.connectSocket === 'function' && typeof has.getStorageSync === 'function'
  } catch (e) {
    return false
  }
}

/** This package is ASCF-only and has no WeChat mini program runtime. */
function isWeChatMiniProgram() {
  return false
}

/** ASCF has its own WSS-only route family and must not use native-app rules. */
function clientKind() {
  return 'ascf'
}

module.exports = { isASCFRuntime: isASCFRuntime, isWeChatMiniProgram: isWeChatMiniProgram, clientKind: clientKind }
