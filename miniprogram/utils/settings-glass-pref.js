// Settings-page glass UI switch. Default on keeps the workspace-glass design introduced for existing screens.
const KEY = 'settingsGlassStyleEnabled';
const DEFAULT = true;

function read() {
  let stored;
  try { stored = wx.getStorageSync(KEY); } catch (_) { stored = null; }
  return typeof stored === 'boolean' ? stored : DEFAULT;
}

function set(value) {
  const next = value === true;
  try { wx.setStorageSync(KEY, next); } catch (_) { /* keep the requested value in memory */ }
  return next;
}

module.exports = { KEY, DEFAULT, read, set };
