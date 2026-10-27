const { t: uiText } = require('../../../utils/ui-preferences');

// Keep this policy aligned with DSH's client presentation-policy module.
const KEY = 'workStepPresentation';
const MODES = [
  { id: 'compact', label: uiText('简洁') },
  { id: 'standard', label: uiText('标准') },
  { id: 'detailed', label: uiText('详细') },
  { id: 'verbose', label: uiText('完全展开') }
];
const TIMINGS = [
  { id: 'completion', label: uiText('回答结束后') },
  { id: 'next-input', label: uiText('下次有新消息时') }
];
const MODE_POLICY = {
  compact: { foldCompletedTurns: true, stepGrouping: 'collapsed', liveProcessDetail: false, settledReasoningPreview: false },
  standard: { foldCompletedTurns: true, stepGrouping: 'collapsed', liveProcessDetail: true, settledReasoningPreview: true },
  detailed: { foldCompletedTurns: true, stepGrouping: 'history', liveProcessDetail: true, settledReasoningPreview: true },
  verbose: { foldCompletedTurns: false, stepGrouping: 'none', liveProcessDetail: false, settledReasoningPreview: true }
};

function normalize(value) {
  const v = value || {};
  return {
    mode: MODES.some(item => item.id === v.mode) ? v.mode : 'detailed',
    timing: TIMINGS.some(item => item.id === v.timing) ? v.timing : 'completion'
  };
}

function read() {
  try { return normalize(wx.getStorageSync(KEY)); } catch (_) { return normalize(); }
}

function save(value) {
  const normalized = normalize(value);
  wx.setStorageSync(KEY, normalized);
  return normalized;
}

function view(value) {
  const normalized = normalize(value);
  return {
    workStepMode: normalized.mode,
    workStepTiming: normalized.timing,
    workStepModeLabel: uiText(MODES.find(item => item.id === normalized.mode).label),
    workStepTimingLabel: uiText(TIMINGS.find(item => item.id === normalized.timing).label)
  };
}

function apply(entries, value, manual, previous, reset) {
  const prefs = normalize(value);
  const modePolicy = MODE_POLICY[prefs.mode];
  const folds = Object.assign({}, reset ? {} : manual);
  const prior = new Map((previous || []).map(entry => [entry.key, entry]));
  const lastUser = (entries || []).reduce((last, entry, index) => entry.kind === 'user' ? index : last, -1);
  const groupIndices = [];
  (entries || []).forEach((entry, index) => {
    if (entry.kind === 'processGroup') groupIndices.push(index);
  });
  const lastGroupIndex = groupIndices.length ? groupIndices[groupIndices.length - 1] : -1;

  entries.forEach((entry, index) => {
    if (entry.kind === 'turnProcess') {
      const before = prior.get(entry.key);
      const hasInputAfter = index < lastUser;
      const alwaysOpen = entry.alwaysOpen === true;
      const foldable = modePolicy.foldCompletedTurns && entry.expandable !== false && !alwaysOpen;
      const deferred = prefs.timing === 'next-input' && !hasInputAfter;
      const autoOpen = !foldable || deferred;
      const hasFold = Object.prototype.hasOwnProperty.call(folds, entry.key);
      const transition = before && prefs.timing === 'next-input' && hasInputAfter && !before.hasInputAfter;
      if (!foldable || reset || !hasFold) folds[entry.key] = autoOpen;
      if (transition && foldable) folds[entry.key] = false;
      entry.hasInputAfter = hasInputAfter;
      entry.alwaysOpen = alwaysOpen;
      entry.foldable = foldable;
      return;
    }

    if (entry.kind !== 'processGroup') return;

    const hasInputAfter = index < lastUser;
    // DSH defers only the bottom process group from detailed-mode history grouping.
    const deferCollapse = prefs.timing === 'next-input' && !hasInputAfter && index === lastGroupIndex;
    const turnClosed = entry.completed === true || entry.failed === true || entry.stopped === true;
    const grouped = modePolicy.stepGrouping === 'collapsed'
      || modePolicy.stepGrouping === 'history' && turnClosed && !deferCollapse;
    const expanded = !!folds[entry.key];
    entry.processBodyCapWhenCollapsed = grouped && prefs.timing !== 'next-input';
    entry.processBodyCapWhenExpanded = grouped;
    entry.processBodyCapped = expanded ? entry.processBodyCapWhenExpanded : entry.processBodyCapWhenCollapsed;
    entry.liveDetail = modePolicy.liveProcessDetail && entry.running ? entry.activityDetail || '' : '';

    (entry.children || []).forEach(child => {
      if (child.kind !== 'reasoning') return;
      child.showPreview = !!child.preview && (child.running === true || modePolicy.settledReasoningPreview);
    });

    const hasFold = Object.prototype.hasOwnProperty.call(folds, entry.key);
    if (reset || !hasFold) folds[entry.key] = false;
  });

  return folds;
}

module.exports = { KEY, MODES, TIMINGS, MODE_POLICY, normalize, read, save, view, apply };
