// crypto 垫片：nacl.min.js 在小程序环境中执行 require('crypto') 时会解析到本文件。
// 小程序没有 Node crypto，也没有同步的 crypto.getRandomValues：
// - 提供 randomBytes(n)：基于 xorshift128 PRNG 填充；
// - 种子混合 Date.now / 性能时间 / 计数器，并在 wx.getRandomValues 可用时
//   异步取 64 字节真随机重播种（wx.getRandomValues 为基础库 2.14.0+ 能力）。
// 注意：在 wx.getRandomValues 回调到达之前产生的随机数熵源较弱，
// 仅影响启动最初几百毫秒内的随机字节；配对与 E2EE 建链通常发生在其后。

var state0 = 0;
var state1 = 0;
var counter = 0;

function mix(value) {
  // splitmix32 混入
  value = (value + 0x9e3779b9) | 0;
  var z = value;
  z = Math.imul(z ^ (z >>> 16), 0x21f0aaad);
  z = Math.imul(z ^ (z >>> 15), 0x735a2d97);
  state0 = (state1 ^ (state1 >>> 9)) | 0;
  state1 = (z ^ (z >>> 14)) | 0;
}

function nowMs() {
  try { return Date.now(); } catch (e) { return 0; }
}

(function seed() {
  var initial = [
    nowMs() | 0,
    (nowMs() * 2654435761) | 0,
    (Math.random() * 0xffffffff) | 0,
    (Math.random() * 0xffffffff) | 0
  ];
  for (var i = 0; i < initial.length; i++) mix(initial[i]);
  try {
    // 性能时间（若存在）进一步去相关
    if (typeof wx !== 'undefined' && wx.getPerformance) {
      var perf = wx.getPerformance();
      if (perf && perf.now) mix(perf.now() * 1000 | 0);
    }
  } catch (e) { /* 忽略 */ }
})();

function nextUint32() {
  // xorshift128+ 简化变体：两状态交替扰动
  var x = state0, y = state1;
  state0 = y;
  x ^= x << 13; x |= 0;
  x ^= x >>> 7;
  x ^= y ^ (y << 9); x |= 0;
  state1 = x;
  counter = (counter + 1) | 0;
  mix(counter ^ nowMs());
  return (state1 >>> 0);
}

function randomBytes(length) {
  var out = new Uint8Array(length);
  for (var i = 0; i < length; i++) {
    var word = nextUint32();
    out[i] = word & 0xff;
  }
  return out;
}

// 用真随机重播种（wx.getRandomValues 异步回调）
function reseedFromSystem() {
  try {
    if (typeof wx === 'undefined' || !wx.getRandomValues) return;
    wx.getRandomValues({
      length: 64,
      success: function (res) {
        var buf = res.randomValues;
        if (!buf || !buf.length) return;
        for (var i = 0; i + 4 <= buf.length; i += 4) {
          mix((buf[i] | (buf[i + 1] << 8) | (buf[i + 2] << 16) | (buf[i + 3] << 24)) | 0);
        }
      },
      fail: function () { /* 保持现有种子 */ }
    });
  } catch (e) { /* 忽略 */ }
}

reseedFromSystem();

module.exports = {
  randomBytes: randomBytes
};
