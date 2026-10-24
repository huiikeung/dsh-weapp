const fs=require('fs'),path=require('path'),vm=require('node:vm');
const file=path.resolve('miniprogram/utils/store.js');
const mod={exports:{}},timers=new Map(),storage=new Map();let serial=0;
class Client{constructor(cb){this.callbacks=cb;this.connectGeneration=1;return new Proxy(this,{get(t,k){if(k in t)return t[k];return ()=>true;}});}requestHistory(){return true;}}
vm.runInNewContext(fs.readFileSync(file,'utf8'),{module:mod,Date,console,wx:{getStorageSync:()=>undefined,setStorageSync(){},removeStorageSync(){}},setTimeout(fn,d){timers.set(++serial,{fn,d});return serial;},clearTimeout:id=>timers.delete(id),setInterval(){return 0;},clearInterval(){},require:n=>n==='./gateway'?{GatewayClient:Client}:require(path.resolve(path.dirname(file),n))});
const store=mod.exports;store.state.connection='connected';store.sessionState.sessionId='s';
const frame=v=>store.client.callbacks.onFrame({sessionId:store.sessionState.sessionId,...v});
const proto=require('./miniprogram/utils/protocol');
const page=JSON.parse(fs.readFileSync('/tmp/page.json','utf8'));
console.log('page events:',page.length);

// 1) 收帧 + 指纹去重 + 可能的 replay
let apply=0;const orig=proto.applyEvent;
proto.applyEvent=function(a,e){if(store.sessionState.rowsAgg&&a===store.sessionState.rowsAgg)apply++;return orig(a,e);};
let t0=process.hrtime.bigint();
frame({kind:'history',events:page,nextBeforeSeq:page[0].seq,hasMore:true,historyFormatVersion:4});
let t1=process.hrtime.bigint();
console.log('ingestEvents        :',(Number(t1-t0)/1e6).toFixed(1),'ms  applyEvent:',apply,' rows:',store.sessionState.rows.length);

// 2) saveSessionCache（recentWindow 重新聚合 80 条）
t0=process.hrtime.bigint();
for(const [id,tt] of [...timers]) if(tt.delay===1000) tt.fn();
t1=process.hrtime.bigint();
console.log('saveSessionCache    :',(Number(t1-t0)/1e6).toFixed(1),'ms');

// 3) 页面 syncFromStore 的行循环
const workflow=require('./miniprogram/utils/conversation-workflow');
const {toolPresentation}=require('./miniprogram/utils/tool-presentation');
const {createMarkdownCache}=require('./miniprogram/utils/session-render');
const md=createMarkdownCache(t=>{try{return require('./miniprogram/utils/markdown').parse(t||'');}catch(e){return [];}});
t0=process.hrtime.bigint();
const semantic=[];
store.sessionState.rows.forEach((row,rowIndex)=>{
  let blocks=null;
  if(row.kind==='assistant'){
    blocks=md.peek(row.key,row.text);
    if(!blocks&&rowIndex>=store.sessionState.rows.length-12)blocks=md.parse(row.key,row.text);
  }
  const tools=(row.tools||[]).map(tool=>{const a=toolPresentation(tool.name,tool.argumentsText,'/w');return Object.assign({},tool,{actLabel:a.label,actDetail:a.detail});});
  semantic.push(Object.assign({},row,{blocks:blocks||[],tools}));
});
t1=process.hrtime.bigint();
console.log('row loop            :',(Number(t1-t0)/1e6).toFixed(1),'ms for',semantic.length,'rows');

// 4) buildEntries
t0=process.hrtime.bigint();
const entries=workflow.buildEntries(semantic,{running:false,completedEntryKey:'',lastDurationMs:0});
t1=process.hrtime.bigint();
console.log('buildEntries        :',(Number(t1-t0)/1e6).toFixed(1),'ms ->',entries.length,'entries');

// 5) 窗口化（只渲染 ~40 行）
t0=process.hrtime.bigint();
const {ConversationWindow}=require('./miniprogram/utils/conversation-window');
const w=new ConversationWindow();w.update(entries);
const patch=w.select(w.offsets[entries.length]-700,700,Math.max(0,entries.length-12));
t1=process.hrtime.bigint();
console.log('window select       :',(Number(t1-t0)/1e6).toFixed(3),'ms ->',patch.rows.length,'rendered rows');
console.log('');
console.log('rawBuffer size      :',store.sessionState.rows.length,'rows / rawBuffer events:',(function(){try{return store.sessionState.rows.length}catch(e){return '?'}})());
