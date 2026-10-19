const KEY = 'dsh_voice_input_enabled';
const SETTINGS_URL = '/pages/plugin-detail/plugin-detail?bundle=' + encodeURIComponent('@deepseek-ai/dsh-experimental-voice-input-bundle');
function enabled() { try { return wx.getStorageSync(KEY) === true; } catch (_) { return false; } }
function save(value) { wx.setStorageSync(KEY, value === true); return value === true; }
function view() { const voiceEnabled = enabled(); return { voiceEnabled, composerPlaceholder: voiceEnabled ? '输入内容或按住说话' : '输入内容' }; }
module.exports = { enabled, save, view, SETTINGS_URL };
