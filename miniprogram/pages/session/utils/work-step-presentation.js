const { t: uiText } = require('../../../utils/ui-preferences');

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

// Keep the mobile transcript aligned with DSH Chat's presentation-policy table.
const POLICIES = {
  compact: {
    foldCompletedTurns: true,
    stepGrouping: 'collapsed',
    showSubprocesses: false,
    expandSubprocessDetails: false,
    liveProcessDetail: false,
    settledReasoningPreview: false
  },
  standard: {
    foldCompletedTurns: true,
    stepGrouping: 'summary',
    showSubprocesses: false,
    expandSubprocessDetails: false,
    liveProcessDetail: true,
    settledReasoningPreview: true
  },
  detailed: {
    foldCompletedTurns: true,
    stepGrouping: 'history',
    showSubprocesses: true,
    expandSubprocessDetails: false,
    liveProcessDetail: true,
    settledReasoningPreview: true
  },
  verbose: {
    foldCompletedTurns: false,
    stepGrouping: 'none',
    showSubprocesses: true,
    expandSubprocessDetails: false,
    liveProcessDetail: true,
    settledReasoningPreview: true
  }
};

function normalize(value) {
  const v = value || {};
  return {
    mode: MODES.some(item => item.id === v.mode) ? v.mode : 'detailed',
    timing: TIMINGS.some(item => item.id === v.timing) ? v.timing : 'completion'
  };
}

function read() {
  try {
    return normalize(wx.getStorageSync(KEY));
  } catch (_) {
    return normalize();
  }
}

function save(value) {
  const v = normalize(value);
  wx.setStorageSync(KEY, v);
  return v;
}

function view(value) {
  const v = normalize(value);
  return {
    workStepMode: v.mode,
    workStepTiming: v.timing,
    workStepModeLabel: uiText(MODES.find(item => item.id === v.mode).label),
    workStepTimingLabel: uiText(TIMINGS.find(item => item.id === v.timing).label)
  };
}

function apply(entries, value, manual, previous, reset) {
  const prefs = normalize(value);
  const policy = POLICIES[prefs.mode];
  const folds = Object.assign({}, reset ? {} : manual);
  const prior = new Map((previous || []).map(entry => [entry.key, entry]));
  let lastUser = -1;
  entries.forEach((entry, index) => {
    if (entry.kind === 'user') lastUser = index;
  });

  entries.forEach((entry, index) => {
    if (entry.kind !== 'processGroup') return;

    const before = prior.get(entry.key);
    const hasInputAfter = index < lastUser;
    const defer = entry.completed && prefs.timing === 'next-input' && !hasInputAfter;
    const showLiveSteps = entry.running && policy.stepGrouping === 'history';
    const detailedLive = policy.stepGrouping === 'history' && entry.running;
    const forceOpen = detailedLive;
    const autoOpen = policy.stepGrouping === 'none' || showLiveSteps || forceOpen
      || (policy.stepGrouping === 'summary' && entry.running) || entry.failed || entry.stopped
      || (defer && prefs.mode === 'detailed');
    const collapsedNow = policy.foldCompletedTurns && entry.completed
      && (prefs.timing === 'completion' || hasInputAfter);
    const completedTransition = before && !before.completed && entry.completed
      && prefs.timing === 'completion';
    const inputTransition = before && prefs.timing === 'next-input'
      && hasInputAfter && !before.hasInputAfter;

    if (reset || !Object.prototype.hasOwnProperty.call(folds, entry.key)) {
      folds[entry.key] = !!autoOpen;
    }
    if ((completedTransition || inputTransition) && collapsedNow) folds[entry.key] = false;

    entry.hasInputAfter = hasInputAfter;
    entry.mode = prefs.mode;
    entry.headerHidden = false;
    entry.forceOpen = forceOpen;
    entry.runningChevron = prefs.mode === 'compact' || prefs.mode === 'standard';
    entry.liveDetail = policy.liveProcessDetail && entry.running ? entry.activityDetail || '' : '';
    entry.showProcessSummary = prefs.mode !== 'compact' || !entry.running;
    entry.showSubprocesses = policy.showSubprocesses;
    entry.showCommandDetail = policy.showSubprocesses;
    entry.settledReasoningPreview = policy.settledReasoningPreview;
    let hasVisibleChild = false;
    (entry.children || []).forEach(child => {
      child.visible = policy.showSubprocesses || child.kind === 'reasoning' || child.kind === 'narration';
      if (child.visible) hasVisibleChild = true;
      if (child.kind === 'reasoning') {
        // Keep the reasoning card open by default; its content stays in a bounded reader.
        if (!Object.prototype.hasOwnProperty.call(folds, child.key)) folds[child.key] = true;
        child.previewVisible = child.running === true || policy.settledReasoningPreview;
      } else if (child.kind === 'context') {
        if (!Object.prototype.hasOwnProperty.call(folds, child.key)) folds[child.key] = policy.expandSubprocessDetails;
      } else if (child.kind === 'toolBundle') {
        (child.tools || []).forEach(tool => {
          if (!Object.prototype.hasOwnProperty.call(folds, tool.key)) folds[tool.key] = policy.expandSubprocessDetails;
        });
      }
    });
    if (!policy.showSubprocesses) entry.expandable = hasVisibleChild;
  });

  return folds;
}

module.exports = { KEY, MODES, TIMINGS, POLICIES, normalize, read, save, view, apply };
