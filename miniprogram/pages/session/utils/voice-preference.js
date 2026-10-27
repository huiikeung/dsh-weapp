const KEY = 'dsh_voice_input_enabled';
const DEFAULT_ENABLED = true;
const SETTINGS_URL = '/pages/plugin-detail/plugin-detail?bundle=' + encodeURIComponent('@deepseek-ai/dsh-experimental-voice-input-bundle');
function enabled() { try { return wx.getStorageSync(KEY) !== false; } catch (_) { return DEFAULT_ENABLED; } }
function save(value) { wx.setStorageSync(KEY, value === true); return value === true; }
function view() { const voiceEnabled = enabled(); return { voiceEnabled, composerPlaceholder: '输入内容, / 调用指令, @ 文件或对话, 或按住说话' }; }
module.exports = { KEY, DEFAULT_ENABLED, enabled, save, view, SETTINGS_URL };
