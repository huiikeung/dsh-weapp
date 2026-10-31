const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', 'harmonyos/atomic-service/ascf/ascf_src');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('home directory creation uses the consolidated folder-plus SVG', () => {
  const markup = read('pages/home/home.hxml');
  const css = read('pages/home/home.css');
  assert.match(markup, /dir-head-folder-add-white\.svg/);
  assert.doesNotMatch(markup, /dir-head-badge/);
  assert.match(css, /\.dir-head-folder[\s\S]*?42rpx/);
});

test('models page matches latest capsule header, icon refresh and footer note', () => {
  const markup = read('pages/models/models.hxml');
  const css = read('pages/models/models.css');
  assert.match(markup, /models-nav-row/);
  assert.match(markup, /models-section-refresh-ic/);
  assert.match(markup, /models-intro-footer/);
  assert.match(css, /\.models-section-refresh-ic/);
  assert.match(css, /\.sheet-btn\.primary[\s\S]*?box-shadow: none/);
  assert.match(css, /\.level-chip\.on[^}]*var\(--text\)/);
});

test('settings language and work-step choices use centered full-row tappable card', () => {
  const markup = read('pages/settings/settings.hxml');
  const script = read('pages/settings/settings.js');
  assert.match(markup, /class="pair-sheet-mask"[^>]*catchtap="closeChoiceMenu"/);
  assert.match(markup, /pair-sheet-subtitle[^>]*>\{\{choiceSubtitle\}\}/);
  assert.match(markup, /preference-language-row" bindtap="pickLanguage/);
  assert.match(markup, /work-step-mode-row[^>]*bindtap="toggleWorkStepMenu/);
  assert.match(markup, /work-step-timing-row[^>]*bindtap="toggleWorkStepMenu/);
  assert.doesNotMatch(markup, /choiceMenu && choiceSheet|choiceMenu && !choiceSheet/);
  assert.match(script, /language: uiText\('界面语言，选择后立即生效'\)/);
});

test('project registers generated model HSP module', () => {
  const profile = fs.readFileSync(path.join(__dirname, '..', 'harmonyos/atomic-service/build-profile.json5'), 'utf8');
  assert.match(profile, /"name": \"pages_models\"/);
  assert.match(profile, /ascf\/ascf_build\/pages_models/);
});
