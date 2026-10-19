const { t: uiText } = require('./ui-preferences');
// DSH Chat presentation-policy: four detail modes and independent collapse timing.
const KEY = 'workStepPresentation';
const MODES = [{id:'compact',label:uiText('简洁')},{id:'standard',label:uiText('标准')},{id:'detailed',label:uiText('详细')},{id:'verbose',label:uiText('完全展开')}];
const TIMINGS = [{id:'completion',label:uiText('回答结束后')},{id:'next-input',label:uiText('下次有新消息时')}];
function normalize(value) {
 const v=value || {};
 return {mode:MODES.some(x=>x.id===v.mode)?v.mode:'detailed',timing:TIMINGS.some(x=>x.id===v.timing)?v.timing:'completion'};
}
function read(){try{return normalize(wx.getStorageSync(KEY));}catch(_){return normalize();}}
function save(value){const v=normalize(value);wx.setStorageSync(KEY,v);return v;}
function view(value){const v=normalize(value);return {workStepMode:v.mode,workStepTiming:v.timing,workStepModeLabel:uiText(MODES.find(x=>x.id===v.mode).label),workStepTimingLabel:uiText(TIMINGS.find(x=>x.id===v.timing).label)};}
function apply(entries, value, manual, previous, reset) {
 const prefs=normalize(value), folds=Object.assign({},reset?{}:manual), prior=new Map((previous||[]).map(e=>[e.key,e]));
 let lastUser=-1;entries.forEach((e,i)=>{if(e.kind==='user')lastUser=i;});
 entries.forEach((entry,index)=>{
  if(entry.kind!=='processGroup')return;
  const before=prior.get(entry.key), hasInputAfter=index<lastUser;
  const defer=entry.completed && prefs.timing==='next-input' && !hasInputAfter;
  const autoOpen=prefs.mode==='verbose' || entry.failed || entry.stopped || ((entry.running || defer) && prefs.mode==='detailed');
  const collapsedNow=prefs.mode!=='verbose' && entry.completed && (prefs.timing==='completion' || hasInputAfter);
  const transition=before && ((!before.completed && entry.completed && prefs.timing==='completion') || (prefs.timing==='next-input' && hasInputAfter && !before.hasInputAfter));
  if(reset || !Object.prototype.hasOwnProperty.call(folds,entry.key))folds[entry.key]=!!autoOpen;
  if(transition && collapsedNow)folds[entry.key]=false;
  entry.hasInputAfter=hasInputAfter;
  entry.liveDetail=(prefs.mode==='standard'||prefs.mode==='detailed') && entry.running ? entry.activityDetail || '' : '';
  entry.compactReasoning=prefs.mode==='compact';
 });
 return folds;
}
module.exports={KEY,MODES,TIMINGS,normalize,read,save,view,apply};
