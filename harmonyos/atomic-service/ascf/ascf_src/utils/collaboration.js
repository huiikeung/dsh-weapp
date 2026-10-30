// DSH agentTeam / subagentCatalog wire projections and their durable events.
// Never infer membership from prose, tool counts, or a spawn request.
const { t } = require('./ui-preferences');
const text = value => typeof value === 'string' ? value : '';
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const id = value => typeof value === 'string' && value.trim().length > 0;
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
function create(sessionId) {
  return { sessionId, baselines: {}, events: [], members: [], children: [], tasks: [], failure: '', known: false };
}
function member(value) {
  if (!object(value) || !id(value.id) || !id(value.name) || !['provisioning','active','failed'].includes(value.phase)) return null;
  return { id: value.id, name: value.name, role: value.role === 'lead' ? 'lead' : 'teammate', phase: value.phase,
    description: text(value.description), provider: text(value.provider), error: text(value.error) };
}
function child(value) {
  if (!object(value) || !id(value.id) || !['one-shot','continuable','unknown'].includes(value.mode)) return null;
  return { id: value.id, mode: value.mode, label: text(value.label) };
}
function task(value) {
  if (!object(value) || !id(value.id) || typeof value.subject !== 'string' || !['pending','in_progress','completed','deleted'].includes(value.status)) return null;
  return { id: value.id, subject: value.subject, description: text(value.description), status: value.status,
    ownerId: text(value.ownerId), ownerName: text(value.ownerName), blockedBy: Array.isArray(value.blockedBy) ? value.blockedBy.filter(id) : [] };
}
function rebuild(state) {
  const team = state.baselines.agentTeam, catalog = state.baselines.subagentCatalog;
  const members = new Map(), children = new Map(), tasks = new Map();
  const put = (map, parse, value) => { const item = parse(value); if (item) map.set(item.id, item); };
  state.failure = '';
  if (team && object(team.value)) {
    (Array.isArray(team.value.members) ? team.value.members : []).forEach(v => put(members, member, v));
    (Array.isArray(team.value.tasks) ? team.value.tasks : []).forEach(v => put(tasks, task, v));
    state.failure = text(team.value.failure);
  }
  if (catalog && Array.isArray(catalog.value)) catalog.value.forEach(v => put(children, child, v));
  for (const event of state.events) {
    const data = event.data || {};
    if (event.type === 'subagent/catalog') {
      if (catalog && event.seq <= catalog.seq || ![0,1].includes(data.version)) continue;
      put(children, child, { id: data.childId, mode: data.mode, label: data.label });
    } else {
      if (team && event.seq <= team.seq || data.teamId !== state.sessionId) continue;
      if (data.version !== 2) { state.failure = t('团队数据版本暂不支持'); continue; }
      if (event.type === 'team/member') put(members, member, data.member);
      if (event.type === 'team/task') put(tasks, task, data.task);
    }
  }
  if ((members.size || tasks.size) && !members.has(state.sessionId)) {
    members.set(state.sessionId, { id: state.sessionId, name: 'lead', role: 'lead', phase: 'active' });
  }
  state.members = [...members.values()].sort((a,b) => (b.role === 'lead') - (a.role === 'lead'));
  state.children = [...children.values()];
  state.tasks = [...tasks.values()].filter(v => v.status !== 'deleted');
  state.known = !!(team || catalog || state.events.length);
  return state;
}
function baseline(state, projections) {
  if (!object(projections) || !object(projections.values) || !Number.isSafeInteger(projections.asOfSeq)) return state;
  for (const key of ['agentTeam','subagentCatalog']) {
    if (!own(projections.values,key)) continue;
    const old = state.baselines[key];
    if (!old || projections.asOfSeq >= old.seq) state.baselines[key] = { seq: projections.asOfSeq, value: projections.values[key] };
  }
  return rebuild(state);
}
function ingest(state, events) {
  const relevant = events.filter(e => e && ['team/member','team/task','subagent/catalog'].includes(e.type) && Number.isSafeInteger(e.seq));
  if (!relevant.length) return state;
  const bySeq = new Map(state.events.map(e => [e.seq,e]));
  relevant.forEach(e => bySeq.set(e.seq,e));
  state.events = [...bySeq.values()].sort((a,b) => a.seq-b.seq);
  return rebuild(state);
}
function view(state, sessions, current, connected) {
  state = state || create(current.sessionId);
  const byId = new Map((sessions || []).map(s => [s.sessionId,s]));
  const status = row => {
    if (row.phase === 'failed') return { status: 'failed', statusText: t('失败') };
    if (row.phase === 'provisioning') return { status: 'pending', statusText: t('创建中') };
    const summary = byId.get(row.id);
    const running = row.id === current.sessionId ? current.running : summary && summary.runningKnown !== false ? summary.running : undefined;
    return !connected || running === undefined ? { status:'unknown', statusText:t('状态待同步') } :
      running ? { status:'running', statusText:t('运行中') } : { status:'idle', statusText:t('空闲') };
  };
  const members = state.members.map(row => ({ ...row, ...status(row), title: row.name,
    subtitle: row.role === 'lead' ? t('主智能体') : row.description || t('团队成员'), current:row.id === current.sessionId,
    canOpen:row.id !== current.sessionId && row.phase === 'active' }));
  const children = state.children.map(row => ({ ...row, ...status(row), title:row.label || row.id,
    subtitle:row.mode === 'one-shot' ? t('一次性子智能体') : row.mode === 'continuable' ? t('可继续子智能体') : t('子智能体'), canOpen:true }));
  const tasks = state.tasks.map(row => ({ ...row, title:row.subject, subtitle:row.ownerName || (members.find(m => m.id === row.ownerId) || {}).title || t('未分配'),
    statusText:t(({ pending:'待处理',in_progress:'进行中',completed:'已完成' })[row.status]),
    status:row.status === 'in_progress' ? 'running' : row.status === 'completed' ? 'done' : 'pending' }));
  const unique = new Map(members.concat(children).map(row => [row.id,row]));
  return { members, children, tasks, total:unique.size, active:[...unique.values()].filter(row=>row.status==='running').length,
    note:!connected ? t('连接断开，状态可能已过期') : state.failure || (!state.known ? t('暂无协作记录，创建成员或子智能体后会自动显示') : '') };
}
module.exports = { create, baseline, ingest, view };
