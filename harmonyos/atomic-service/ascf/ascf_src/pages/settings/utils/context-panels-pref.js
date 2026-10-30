// Visibility preferences for the context and fleet tabs in a session.
const KEY = 'dsh_session_panel_visibility';
const DEFAULTS = { context: true, fleet: true };

function read() {
  let stored;
  try { stored = has.getStorageSync(KEY); } catch (_) { stored = null; }
  return {
    context: stored && typeof stored.context === 'boolean' ? stored.context : DEFAULTS.context,
    fleet: stored && typeof stored.fleet === 'boolean' ? stored.fleet : DEFAULTS.fleet
  };
}

function set(panel, value) {
  if (panel !== 'context' && panel !== 'fleet') throw Error('Invalid session panel');
  const next = { ...read(), [panel]: value === true };
  has.setStorageSync(KEY, next);
  return next;
}

module.exports = { KEY, DEFAULTS, read, set };
