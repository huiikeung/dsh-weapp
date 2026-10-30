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
  try { return normalize(has.getStorageSync(KEY)); } catch (_) { return normalize(); }
}

function save(value) {
  const normalized = normalize(value);
  has.setStorageSync(KEY, normalized);
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

/** 「N 次工具调用 / N 项上下文」这类纯计数后缀（简洁档组标题不挂）。 */
function isCountPart(part, suffix) {
  if (!suffix || part.length <= suffix.length) return false;
  if (part.slice(part.length - suffix.length) !== suffix) return false;
  const head = part.slice(0, part.length - suffix.length).trim();
  return head.length > 0 && /^[0-9]+$/.test(head);
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
    const previousGroup = prior.get(entry.key);
    // Keep thoughts open across tool steps; entry.running only marks the current activity group.
    const processRunning = entry.turnRunning === true
      || (entry.turnRunning === undefined && entry.running === true);
    const wasRunning = previousGroup && (previousGroup.turnRunning === true
      || (previousGroup.turnRunning === undefined && previousGroup.running === true));
    const turnClosed = entry.completed === true || entry.failed === true || entry.stopped === true;
    const grouped = modePolicy.stepGrouping === 'collapsed'
      || modePolicy.stepGrouping === 'history' && turnClosed && !deferCollapse;
    // verbose（stepGrouping=none，完全展开）：默认和其他档一样收起，点组头才展开；
    // 区别在展开后——组体不设限高、不自动跟随，整段过程一次铺开。
    const verbose = modePolicy.stepGrouping === 'none';
    const hasGroupFold = Object.prototype.hasOwnProperty.call(folds, entry.key);
    // 详细模式（history 分组）：回合 disclosure 展开时，里面各组默认跟着展开——桌面端
    // 收工后点开「已完成」就是直接看过程，不用再逐个点组头。其余档仍旧默认收起。
    const turnOpen = entry.turnProcessKey ? folds[entry.turnProcessKey] === true : false;
    const openInExpandedTurn = modePolicy.stepGrouping === 'history' && turnOpen;
    if (reset || !hasGroupFold) folds[entry.key] = openInExpandedTurn;
    const expanded = !!folds[entry.key];
    entry.processBodyCapWhenCollapsed = grouped && prefs.timing !== 'next-input';
    // 组体一可见就限高（max-height min(400px,50vh) 的滚动容器）：分组模式点开组体时、
    // 详细模式对话过程中（组体自动可见）都要限高——长过程不会把页面撑爆，组内自行
    // 滚动并跟着最新步骤锚点；「完全展开」永不设上限。
    const capWhenOpen = grouped
      || modePolicy.stepGrouping === 'history' && (processRunning || expanded);
    entry.processBodyCapWhenExpanded = capWhenOpen;
    // 限高跟着可见性走：组体一可见（分组模式点开 / 详细模式对话过程中自动可见）就装进
    // 定高滚动容器；收起时组体不挂载，限高值无所谓，沿用原有口径。
    entry.processBodyCapped = (!grouped || expanded) ? capWhenOpen : entry.processBodyCapWhenCollapsed;
    entry.liveDetail = modePolicy.liveProcessDetail && entry.running ? entry.activityDetail || '' : '';
    // 简洁模式：组标题不带「N 次工具调用 / N 项上下文」这类计数后缀——标题本身已经
    // 按子内容命名（已读取文件，已搜索代码），再挂计数在简洁档里只剩噪音。
    // 标准档同样恒分组，但计数对它是有信息量的，保留。
    if (prefs.mode === 'compact') {
      const counts = [uiText(' 次工具调用'), uiText(' 项上下文')];
      entry.summary = (entry.summary || '').split(' · ')
        .filter(part => part.trim() && !counts.some(suffix => isCountPart(part.trim(), suffix)))
        .join(' · ');
    }
    // 每个过程组折叠成一个标题：组体在 grouped 且未展开时整块收起，点组头才展开
    // （对齐桌面端 ChatGroupSeat 的 grouped && !open）。compact/standard 永远 grouped；
    // detailed 是 history 分组——对话过程中（回合未收工）不分组、过程照常展开，回合
    // 结束后才折叠成标题；verbose（stepGrouping=none）永远展开。
    // 过程文字已独立成行，收起组体不会连带藏掉叙述。
    entry.processGrouped = grouped;
    // verbose（stepGrouping=none，永不分组）：没有组标题，过程直接平铺，组体常开——
    // 回合收工也不折（foldCompletedTurns=false，回合行本就默认展开）。其余档维持
    // grouped && !open；详细模式对话过程中不分组，组体自动展开。
    entry.processAutoOpen = !grouped && !verbose;
    entry.processBodyVisible = verbose || expanded || entry.processAutoOpen;
    // 简洁模式运行中：只留活动组那一行「正在xxxx」，已收工组的标题也收起来；
    // 过程默认不显示，点活动组标题才展开。回合收工后（turnRunning=false）标题回来。
    // verbose 永不分组，也就没有组标题——过程直接平铺。
    entry.headingHidden = verbose || (prefs.mode === 'compact' && processRunning && entry.running !== true);
    // 简洁模式：组标题显示完全——计数后缀去掉后标题本身就是全部信息，长标题换行
    // 而不是省略号（否则「已读取文件，已搜索代码，修改了文件…」看不全）。
    entry.titleWrap = prefs.mode === 'compact';

    (entry.children || []).forEach(child => {
      if (child.kind === 'reasoning') {
        child.showPreview = !!child.preview && (child.running === true || modePolicy.settledReasoningPreview);
        const hasReasoningFold = Object.prototype.hasOwnProperty.call(folds, child.key);
        if (processRunning) folds[child.key] = true;
        else if (reset || wasRunning || !hasReasoningFold) folds[child.key] = false;
        return;
      }
    });
  });

  return folds;
}

module.exports = { KEY, MODES, TIMINGS, MODE_POLICY, normalize, read, save, view, apply };
