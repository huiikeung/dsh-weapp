// ASCF exposes secure random bytes asynchronously; there is no safe synchronous
// fallback for TweetNaCl's optional randomBytes API.
const RANDOM_TIMEOUT_MS = 10000;

function randomBytes() {
  throw new Error('Synchronous secure random bytes are unavailable');
}

function secureRandomBytes(length) {
  return new Promise((resolve, reject) => {
    if (!Number.isSafeInteger(length) || length < 1 || length > 1048576) {
      reject(new Error('Invalid secure random byte length'));
      return;
    }
    if (typeof has === 'undefined' || !has || typeof has.getRandomValues !== 'function') {
      reject(new Error('Secure random values are unavailable'));
      return;
    }
    let settled = false;
    const timer = setTimeout(() => finish(new Error('Secure random values timed out')), RANDOM_TIMEOUT_MS);
    function finish(error, bytes) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(bytes);
    }
    try {
      has.getRandomValues({
        length: length,
        success: function (result) {
          if (settled) return;
          try {
            const buffer = result && result.randomValues;
            const getLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength').get;
            if (getLength.call(buffer) !== length) {
              finish(new Error('Invalid secure random values'));
              return;
            }
            const bytes = new Uint8Array(length);
            bytes.set(new Uint8Array(buffer));
            finish(null, bytes);
          } catch (e) {
            finish(new Error('Invalid secure random values'));
          }
        },
        fail: function () { finish(new Error('Secure random values failed')); }
      });
    } catch (e) {
      finish(new Error('Secure random values failed'));
    }
  });
}

module.exports = { randomBytes, secureRandomBytes };
