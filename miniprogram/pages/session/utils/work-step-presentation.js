const { t: uiText } = require('../../../utils/ui-preferences');
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
  if(entry.kind==='turnProcess'){
   // 回合级 disclosure：详细模式遵循独立的收起时机，其他模式保留原有默认状态。
   if(prefs.mode==='detailed'){
    const before=prior.get(entry.key), hasInputAfter=index<lastUser;
    const autoOpen=prefs.timing==='next-input' && !hasInputAfter;
    const transition=before && prefs.timing==='next-input' && hasInputAfter && !before.hasInputAfter;
    if(reset || !Object.prototype.hasOwnProperty.call(folds,entry.key))folds[entry.key]=autoOpen;
    if(transition)folds[entry.key]=false;
    entry.hasInputAfter=hasInputAfter;
   }else if(reset || !Object.prototype.hasOwnProperty.call(folds,entry.key))folds[entry.key]=prefs.mode==='verbose';
   return;
  }
  if(entry.kind!=='processGroup')return;
  const before=prior.get(entry.key), hasInputAfter=index<lastUser;
  const defer=entry.completed && prefs.timing==='next-input' && !hasInputAfter;
  // 对齐桌面端 ChatGroupSeat：回合进行中（liveProcess）过程组始终展开，与模式无关；
  // standard 此前只在 detailed 下展开，运行中看不到步骤，与桌面端标准模式不一致。
  const liveOpen=prefs.mode==='standard' || prefs.mode==='detailed';
  // 桌面端 stepGrouping：compact/standard=collapsed（永远分组）、detailed=history
  // （回合进行中平铺、结束后才分组）、verbose=none（永不分组）。平铺时组头不显示
  // （没有「已调用/已搜索xx」这类总结标题），子过程直接展开，也因此不能自动折叠——
  // 折了就什么都看不见了。
  const flat=prefs.mode==='verbose';
  const autoOpen=flat || entry.failed || entry.stopped || ((entry.running || defer) && liveOpen);
  const collapsedNow=!flat && prefs.mode!=='verbose' && entry.completed && (prefs.timing==='completion' || hasInputAfter);
  entry.detailFlat=flat;
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
