const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { buildEntries } = require('../miniprogram/utils/conversation-workflow');
function fixture() {
  const filename = path.resolve(__dirname, '../miniprogram/utils/store.js');
  const module = { exports: {} }, timers = [];
  class Client { constructor(callbacks) { this.callbacks = callbacks; } }
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module, Date, console, wx: {getStorageSync(){},setStorageSync(){},removeStorageSync(){}},
    setTimeout(fn) {timers.push(fn);return timers.length;}, clearTimeout(){}, setInterval(){return 1;},clearInterval(){},
    require(name) {return name === './gateway' ? {GatewayClient:Client} : require(path.resolve(path.dirname(filename),name));}
  });
  const store = module.exports, views = [];
  store.sessionState.sessionId = 'open-session';
  store.subscribe(snapshot => views.push(JSON.parse(JSON.stringify(buildEntries(snapshot.session.rows,{running:snapshot.session.running})))));
  const frame = value => store.client.callbacks.onFrame({sessionId:'open-session',...value});
  const event = (seq, value) => frame({kind:'event',seq,time:1000+seq,event:value});
  return {store,views,frame,event,timers};
}
test('desktop events update an already-open page without requesting history or reopening', () => {
  const f=fixture();
  f.frame({kind:'history',events:[]});
  f.event(1,{type:'user/message',text:'电脑端的新问题',source:'user'});
  f.event(2,{type:'turn/start',turn:1});
  assert.equal(f.views.at(-1)[0].text,'电脑端的新问题');
  f.event(3,{type:'assistant/message',turn:1,step:1,text:'',reasoning:'检查网页',toolCalls:[{id:'c',name:'web_fetch',arguments:{url:'https://example.test'}}]});
  f.event(4,{type:'tool/call',turn:1,step:1,callId:'c',name:'web_fetch',arguments:{url:'https://example.test'}});
  let group=f.views.at(-1).find(row=>row.kind==='processGroup');
  assert.ok(group.children.some(row=>row.text==='检查网页'));
  let tool=group.children.flatMap(row=>row.tools||[])[0];
  assert.equal(tool.actLabel,'读取网页');assert.equal(tool.actDetail,'https://example.test');assert.equal(tool.statusText,'运行中');
  f.event(5,{type:'tool/result',turn:1,step:1,callId:'c',isError:false,preview:'网页内容'});
  group=f.views.at(-1).find(row=>row.kind==='processGroup');
  tool=group.children.flatMap(row=>row.tools||[])[0];
  assert.equal(tool.resultText,'网页内容');assert.equal(tool.waiting,false);
  f.event(6,{type:'assistant/message',turn:1,step:2,text:'这是最终回复',reasoning:'',toolCalls:[]});
  f.event(7,{type:'turn/end',turn:1,reason:'completed'});
  assert.equal(f.views.at(-1).at(-1).text,'这是最终回复');
  assert.equal(f.store.sessionState.running,false);assert.equal(f.store.sessionState.ingestErrors||0,0);
});
test('nested raw events and flattened error results both retain their payloads',()=>{
  const f=fixture();
  f.event(1,{type:'user/message',data:{content:[{type:'text',text:'原始事件'}]}});
  f.event(2,{type:'tool/call',turn:1,callId:'c',name:'read',arguments:{path:'missing.txt'}});
  f.event(3,{type:'tool/result',turn:1,callId:'c',isError:true,preview:'not found'});
  assert.equal(f.store.sessionState.rows[0].text,'原始事件');
  const tool=f.store.sessionState.rows.flatMap(row=>row.tools||[])[0];
  assert.equal(tool.isError,true);assert.equal(tool.resultText,'not found');
});
test('other sessions cannot insert messages into the currently open page',()=>{
  const f=fixture();
  f.frame({sessionId:'other',kind:'event',seq:1,event:{type:'user/message',text:'别的会话'}});
  assert.equal(f.store.sessionState.rows.length,0);
});
test('desktop live chunks and committed messages share one visible assistant step',()=>{
  const f=fixture();
  f.event(1,{type:'user/message',text:'继续检查',source:'user'});
  f.event(2,{type:'turn/start',turn:1});
  const chunk = value => f.frame({kind:'assistant-stream',frame:{type:'chunk',turn:1,step:1,chunk:value}});
  chunk({type:'reasoning-delta',text:'正在分析'});
  chunk({type:'tool-call-delta',id:'read-call',name:'read',argumentsDelta:'{"path":"README.md"}'});
  // Streaming notifications are coalesced at 120ms, not delayed until navigation.
  f.timers.at(-1)();
  let group=f.views.at(-1).find(row=>row.kind==='processGroup');
  assert.ok(group.children.some(row=>row.text==='正在分析'));
  assert.equal(group.children.flatMap(row=>row.tools||[])[0].actDetail,'README.md');
  f.event(3,{type:'assistant/message',turn:1,step:1,text:'',reasoning:'正在分析',toolCalls:[{id:'read-call',name:'read',arguments:{path:'README.md'}}]});
  assert.equal(f.store.sessionState.rows.filter(row=>row.kind==='assistant').length,1);
  assert.equal(f.store.sessionState.rows.at(-1).tools.length,1);
  assert.equal(f.store.sessionState.rows.at(-1).reasoning,'正在分析');
});
test('composer backdrop starts at its card, not above the jump button or queued work',()=>{
  const xml=fs.readFileSync(path.resolve(__dirname,'../miniprogram/pages/session/session.wxml'),'utf8');
  const css=fs.readFileSync(path.resolve(__dirname,'../miniprogram/pages/session/session.wxss'),'utf8');
  const surface=xml.indexOf('class="composer-surface"'),backdrop=xml.indexOf('class="composer-backdrop"');
  assert.ok(surface>xml.indexOf('class="jump-wrap"'));
  assert.ok(backdrop>surface);assert.ok(backdrop<xml.indexOf('class="composer"'));
  assert.equal((xml.match(/class="composer-backdrop"/g)||[]).length,1);
  const rule=css.match(/\.composer-backdrop\s*\{([^}]+)\}/)[1];
  assert.match(rule,/position:\s*absolute/);assert.match(rule,/top:\s*0/);
  assert.doesNotMatch(rule,/height:\s*320rpx|backdrop-filter/);
});

test('cached conversation displays the first live reasoning immediately',()=>{
 const f=fixture();
 f.store.sessionState.rows=[{kind:'user',key:'cached-user',text:'旧问题'},{kind:'assistant',key:'cached-answer',text:'旧答复',tools:[],settled:true}];
 f.store.sessionState.cacheDisplay=true;
 f.event(10,{type:'user/message',text:'检查项目'});
 f.frame({kind:'assistant-stream',frame:{type:'start',attemptId:'a1',turn:2,step:1}});
 f.frame({kind:'assistant-stream',frame:{type:'chunk',attemptId:'a1',index:0,turn:2,step:1,chunk:{type:'reasoning-delta',text:'开始检查'}}});
 assert.equal(f.store.sessionState.cacheDisplay,false);
 assert.equal(f.views.at(-1)[0].text,'旧问题');
 assert.equal(f.views.at(-1).at(-1).children[0].text,'开始检查');
 assert.equal(f.views.at(-1).at(-1).running,true);
});

test('active snapshot restores reasoning and tool arguments before completion',()=>{
 const f=fixture();
 f.frame({kind:'session-snapshot',replace:true,cursor:10,events:[{seq:10,type:'user/message',data:{text:'检查'}}],assistantStream:{revision:5,activeAttempt:{attemptId:'a1',turn:2,step:3,nextIndex:4,stream:[
   {type:'reasoning-chunks',texts:['正在','分析'],index:0,time0:100,dt:[1]},
   {type:'tool-call-chunks',id:'c',name:'bash',args:['{"command":','"ls"}'],index:1,time0:102,dt:[1]}
 ]}}});
 const group=f.views.at(-1).at(-1);
 assert.equal(group.running,true);assert.equal(group.children[0].text,'正在分析');
 assert.equal(group.children[1].tools[0].actLabel,'运行命令');
 assert.equal(group.children[1].tools[0].argumentsText,'{"command":"ls"}');
 assert.equal(f.store.sessionState.historyState,'loaded:1ev');
 f.frame({kind:'assistant-stream',frame:{type:'chunk',attemptId:'a1',index:3,turn:2,step:3,chunk:{type:'reasoning-delta',text:'重复'}}});
 assert.equal(f.store.sessionState.rows.at(-1).reasoning,'正在分析');
 f.frame({kind:'assistant-stream',frame:{type:'chunk',attemptId:'a1',index:4,turn:2,step:3,chunk:{type:'reasoning-delta',text:'后续'}}});
 assert.equal(f.store.sessionState.rows.at(-1).reasoning,'正在分析后续');
});

test('late history preserves live prefix and settlement does not duplicate it',()=>{
 const f=fixture();
 f.event(1,{type:'user/message',text:'检查'});
 f.frame({kind:'assistant-stream',frame:{type:'chunk',turn:1,step:1,chunk:{type:'reasoning-delta',text:'实时思考'}}});
 f.frame({kind:'history',events:[{seq:1,type:'user/message',data:{text:'检查'}}]});
 assert.equal(f.views.at(-1).at(-1).children[0].text,'实时思考');
 f.event(2,{type:'assistant/message',turn:1,step:1,reasoning:'实时思考',text:'答复'});
 f.frame({kind:'history',events:[{seq:1,type:'user/message',data:{text:'检查'}},{seq:2,type:'assistant/message',data:{turn:1,step:1,reasoning:'实时思考',text:'答复'}}]});
 assert.equal(f.store.sessionState.rows.filter(r=>r.kind==='assistant').length,1);
 assert.equal(f.store.sessionState.rows.at(-1).reasoning,'实时思考');
});

test('new snapshot replaces old transient output and abandoned attempt clears immediately',()=>{
 const f=fixture();
 const snapshot=activeAttempt=>f.frame({kind:'session-snapshot',replace:true,events:[],assistantStream:{revision:0,activeAttempt}});
 snapshot({attemptId:'a1',turn:1,step:1,nextIndex:1,stream:[{type:'reasoning-chunks',texts:['旧前缀']}]});
 snapshot({attemptId:'a2',turn:1,step:1,nextIndex:1,stream:[{type:'reasoning-chunks',texts:['新前缀']}]});
 assert.equal(f.store.sessionState.rows.length,1);
 assert.equal(f.store.sessionState.rows[0].reasoning,'新前缀');
 f.frame({kind:'assistant-stream',frame:{type:'end',attemptId:'a2',outcome:{kind:'abandoned'}}});
 assert.equal(f.store.sessionState.rows.length,0);
 snapshot(undefined);assert.equal(f.store.sessionState.rows.length,0);
});
