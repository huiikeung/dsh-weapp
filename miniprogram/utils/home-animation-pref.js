// Homepage ocean motion preference; enabled by default for existing installs.
const KEY = 'dsh_home_animation_enabled';

function enabled() {
  try { return wx.getStorageSync(KEY) !== false; } catch (_) { return true; }
}

function setEnabled(value) {
  const next = value === true;
  wx.setStorageSync(KEY, next);
  return next;
}

module.exports = { KEY, enabled, setEnabled };
