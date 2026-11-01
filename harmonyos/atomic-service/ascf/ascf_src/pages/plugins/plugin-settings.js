const { t, localized } = require('../../utils/ui-preferences');
const copy = require('./plugin-settings-copy');
const has = (o, k) => Object.prototype.hasOwnProperty.call(o || {}, k);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const routeKey = r => JSON.stringify([r.provider, r.model]);
const COT = '@deepseek-ai/dsh-experimental-cot-translation-bundle';
const VOICE = '@deepseek-ai/dsh-experimental-voice-input-bundle';
const CONTEXT = /(^|\/)dsh-context$/i;
function kindFor(official, bundle) { return official || (bundle === COT ? 'cot-translation' : bundle === VOICE ? 'voice' : (bundle && CONTEXT.test(bundle) ? 'dsh-context' : null)); }
class PluginSettings {
  constructor(kind, response) {
    this.kind = kind; this.writable = response.writable === true; this.sections = {}; this.edits = {};
    for (const row of response.namespaces || []) this.sections[row.ns] = row;
  }
  get(ns, key) { const edit = this.edits[ns] && this.edits[ns][key]; return edit ? edit.op === 'unset' ? (this.sections[ns].base || {})[key] : edit.value : ((this.sections[ns] || {}).value || {})[key]; }
  stage(ns, key, value, reset = false) {
    const section = this.sections[ns]; if (!section || !this.writable) return;
    const edits = this.edits[ns] || (this.edits[ns] = {});
    if (reset && !has(section.user, key) || !reset && same(value, (section.value || {})[key])) delete edits[key];
    else edits[key] = reset || same(value, (section.base || {})[key]) ? { op: 'unset', path: [key] } : { op: 'set', path: [key], value };
  }
  discard() { this.edits = {}; }
  get dirty() { return Object.keys(this.edits).some(ns => Object.keys(this.edits[ns]).length); }
  operations() { return Object.keys(this.edits).filter(ns => Object.keys(this.edits[ns]).length).sort((a,b) => Number(a === 'web') - Number(b === 'web')).map(ns => ({ ns, expectedRevision: this.sections[ns].revision, ops: Object.keys(this.edits[ns]).map(key => this.edits[ns][key]) })); }
  searchApi() { return !!this.sections.web && !!this.sections['web-deepseek-api'] && this.get('web','searchProvider') === 'deepseek-search-api'; }
  credentialRef() { const ns = this.searchApi() ? 'web-deepseek-api' : 'web-search-deepseek'; return this.get(ns,'apiKeyEnv') || 'DEEPSEEK_API_KEY'; }
  selectApi(enabled) {
    if (!this.sections.web || !this.sections['web-deepseek-api']) return;
    this.stage('web','searchProvider',enabled ? 'deepseek-search-api' : 'deepseek-official');
    this.stage('web','fetchProvider',enabled ? 'deepseek-fetch-api' : 'http');
  }
  definitions() {
    const c = copy[this.kind] || {};
    if (this.kind === 'shell') {
      const ns = this.sections['pwsh-sandbox'] ? 'pwsh-sandbox' : 'bash-sandbox';
      return ['timeoutMs','maxOutputBytes'].map(key => ({ ns, key, label: c[key], hint: c[key+'Hint'], numeric: true, invalid: c.invalidNumber }));
    }
    if (this.kind === 'agent-loop') return [{ ns:'agent-loop',key:'maxParallelToolCalls',label:c.maxParallel,hint:c.maxParallelHint,numeric:true,invalid:c.invalidNumber }];
    if (this.kind === 'subagent') return [
      {ns:'subagent',key:'maxDepth',label:c.subagentMaxDepth,hint:c.subagentDepthHelp,numeric:true,min:0,integer:true,invalid:c.subagentDepthInvalid},
      {ns:'subagent',key:'maxActiveSubagents',label:c.subagentMaxActive,hint:c.subagentCapacityHelp,numeric:true,min:1,integer:true,invalid:c.subagentCapacityInvalid}
    ];
    if (this.kind === 'web-search') {
      const api = this.searchApi(), ns = api ? 'web-deepseek-api' : 'web-search-deepseek';
      return [{ ns,key:'baseURL',label:c[api?'searchApiBaseUrl':'baseUrl'],hint:c[api?'searchApiBaseUrlHint':'baseUrlHint'] }, api ? {ns,key:'count',label:c.count,hint:c.countHint,numeric:true,min:1,max:50,integer:true,invalid:c.invalidCount} : {ns,key:'maxUses',label:c.maxUses,hint:c.maxUsesHint,numeric:true,invalid:c.invalidNumber}];
    }
    if (this.kind === 'dsh-context') {
      const ns = 'dsh-context';
      const choice = (key, label, choices, labels) => ({ ns, key, label, choices, choiceLabels: labels });
      return [
        { ns, key: 'defaultPlacement', label: '上下文面板入口', group: '入口与可见性', choices: ['all','tab','sidebar','hide'], choiceLabels: ['全部','标签页','侧边栏','隐藏'] },
        { ns, key: 'insightsEntry', label: '上下文洞察', choices: ['show','hide'], choiceLabels: ['显示','隐藏'] },
        { ns, key: 'fleetTab', label: '编队标签页', choices: ['show','hide'], choiceLabels: ['显示','隐藏'] },
        { ns, key: 'defaultOverviewRange', label: '上下文洞察 · 默认时间范围', group: '视图默认值', choices: ['today','7d','30d','all'], choiceLabels: ['今天','近 7 天','近 30 天','全部'] },
        { ns, key: 'defaultGranularity', label: '趋势图 · 粒度', choices: ['step','turn'], choiceLabels: ['步骤','轮次'] },
        { ns, key: 'defaultTrendMode', label: '趋势图 · 展示方式', choices: ['total','delta'], choiceLabels: ['全量','增量'] },
        { ns, key: 'defaultDurationCurve', label: '趋势图 · 耗时曲线', choices: ['show','hide'], choiceLabels: ['显示','隐藏'] },
        { ns, key: 'overviewAutoSteps', label: '趋势图 · 自动总览', choices: ['100','200','300','off'], choiceLabels: ['100 步','200 步','300 步','关闭'] },
        { ns, key: 'defaultDeltaBase', label: '上下文浏览器 · 对比基线', choices: ['step','turn'], choiceLabels: ['比前步','比前轮'] },
        { ns, key: 'defaultToolSort', label: '工具定义 · 排序', choices: ['size','count','name'], choiceLabels: ['按大小','按次数','按名称'] },
        { ns, key: 'defaultFileSort', label: '文件活动 · 排序', choices: ['count','lines','latest','path','name'], choiceLabels: ['按次数','按行数','按最新','按路径','按文件名'] },
        { ns, key: 'promptPrefix', label: '前缀', group: '系统提示词', multiline: true, hint: '留空则不启用' },
        { ns, key: 'promptSuffix', label: '后缀', multiline: true, hint: '留空则不启用' }
      ];
    }
    if (this.kind === 'cot-translation') return [{ns:'cot-translation',key:'provider',label:c.provider,choices:['bing','google','deepseek-account','deepseek-official'],invalid:c.invalidProvider},{ns:'cot-translation',key:'targetLanguage',label:c.targetLanguage,hint:c.targetLanguageHint,language:true,invalid:c.invalidLanguage}];
    return [];
  }
  fields() { return this.definitions().map(f => {
    const section = this.sections[f.ns], value = this.get(f.ns,f.key), edit = (this.edits[f.ns] || {})[f.key];
    return { ...f, id:f.ns+':'+f.key, label:t(f.label), hint:this.kind === 'subagent' && f.key === 'maxDepth' ? [t(copy.subagent.subagentDepthHelp),'0: '+t(copy.subagent.subagentDepthZero),'1: '+t(copy.subagent.subagentDepthOne),t(copy.subagent.subagentDepthOverride)].join('\n') : t(f.hint || ''), value:value == null ? '' : String(value), available:!!section, overridden:edit ? edit.op === 'set' : has(section && section.user,f.key), placeholder:section && section.base && section.base[f.key] != null ? String(section.base[f.key]) : '', isChoice:!!f.choices, choices:f.choices || [], choiceLabels:(f.choiceLabels||[]).map(x=>t(x)), choiceIndex:(f.choices||[]).indexOf(String(value)), multiline:!!f.multiline, group:f.group ? t(f.group) : '' };
  }); }
  parse(field, text) {
    const value = String(text).trim(); if (!value && !field.language) return { reset:true };
    if (field.numeric) { const number = Number(value); if (!Number.isFinite(number) || field.integer && !Number.isSafeInteger(number) || field.min !== undefined && number < field.min || field.max !== undefined && number > field.max) throw new Error(t(field.invalid)); return {value:number}; }
    if (field.choices && !field.choices.includes(value) || field.language && !/^(?:auto|[a-zA-Z]{2,8}(?:-[a-zA-Z0-9]{1,8})*)$/.test(value)) throw new Error(t(field.invalid));
    return {value};
  }
  modelRows(groups) {
    const ns = 'subagent-model-selection-settings', selected = this.get(ns,'allowedModels') || [], rows = [], seen = new Set();
    for (const group of groups || []) for (const model of group.models || []) { const r = {provider:group.id,model:model.id}; const key=routeKey(r); seen.add(key); rows.push({...r,key,label:localized(group.name)||group.id,name:localized(model.name)||model.id,available:true,selected:selected.some(x=>routeKey(x)===key)}); }
    const stored = ((this.sections[ns] || {}).value || {}).allowedModels || [];
    for (const r of stored.concat(selected)) {const key=routeKey(r); if (!seen.has(key)) {seen.add(key);rows.push({...r,key,label:r.provider,name:r.model,available:false,selected:selected.some(x=>routeKey(x)===key)});}}
    return rows;
  }
  validate() { if (this.kind === 'subagent' && this.get('subagent-model-selection-settings','enabled') && !(this.get('subagent-model-selection-settings','allowedModels') || []).length) throw new Error(t(copy.subagent.subagentModelSelectionRequired)); }
}
module.exports = { PluginSettings, kindFor, routeKey };
