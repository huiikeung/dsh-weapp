const KEY = 'dsh_voice_input_enabled';
const DEFAULT_ENABLED = true;
const SETTINGS_URL = '/pages/plugin-detail/plugin-detail?bundle=' + encodeURIComponent('@deepseek-ai/dsh-experimental-voice-input-bundle');
function enabled() { try { return has.getStorageSync(KEY) !== false; } catch (_) { return DEFAULT_ENABLED; } }
function save(value) { has.setStorageSync(KEY, value === true); return value === true; }
function view() { const voiceEnabled = enabled(); return { voiceEnabled, composerPlaceholder: voiceEnabled ? '输入内容或按住说话' : '输入内容' }; }
module.exports = { KEY, DEFAULT_ENABLED, enabled, save, view, SETTINGS_URL };
