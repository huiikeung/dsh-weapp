// Glass popup presentation for the session settings page.
// ON  (default) keeps the glass bottom sheet (handle + title + close + list) used by the preset picker.
// OFF falls back to the anchored glass menu that the default-model picker used before.
const KEY = 'settingsGlassSheetEnabled';
const DEFAULT = true;

function read() {
  let stored;
  try { stored = has.getStorageSync(KEY); } catch (_) { stored = null; }
  return typeof stored === 'boolean' ? stored : DEFAULT;
}

function set(value) {
  const next = value === true;
  try { has.setStorageSync(KEY, next); } catch (_) { /* keep the requested value in memory */ }
  return next;
}

module.exports = { KEY, DEFAULT, read, set };
