const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const collaboration = require('../miniprogram/utils/collaboration');
const { GatewayClient } = require('../miniprogram/utils/gateway');
const { fixture, event } = require('./session-navigation.test');
const member = (id, name = id) => ({ id, name, role:'teammate', phase:'active' });
const projection = (seq, values) => ({ asOfSeq:seq, values });

test('collaboration baseline and durable updates deduplicate, isolate teams, and ignore stale history', () => {
  const s=collaboration.create('s1');
  collaboration.baseline(s,projection(10,{agentTeam:{members:[member('c1')],tasks:[]},subagentCatalog:[{id:'c1',mode:'continuable'}]}));
  const update={seq:12,type:'team/member',data:{version:2,teamId:'s1',member:member('c2','Researcher')}};
  collaboration.ingest(s,[update,update,{seq:13,type:'team/member',data:{version:2,teamId:'other',member:member('wrong')}},
    {seq:14,type:'team/task',data:{version:2,teamId:'s1',task:{id:'t1',subject:'Check',status:'in_progress',ownerId:'c2'}}}]);
  collaboration.baseline(s,projection(2,{agentTeam:{members:[],tasks:[]},subagentCatalog:[]}));
  const v=collaboration.view(s,[{sessionId:'c1',running:true,runningKnown:true}],{sessionId:'s1',running:false},true);
  assert.deepEqual(v.members.map(m=>m.id),['s1','c1','c2']);
  assert.equal(v.total,3);assert.equal(v.active,1);
  assert.equal(v.members.find(m=>m.id==='c2').status,'unknown','provisioned is not running');
  assert.equal(v.tasks[0].subtitle,'Researcher');
  assert.equal(collaboration.view(s,[],{sessionId:'s1'},false).active,0);
  collaboration.ingest(s,[{seq:15,type:'team/task',data:{version:2,teamId:'s1',task:{id:'t1',subject:'Check',status:'deleted'}}}]);
  assert.equal(s.tasks.length,0);
});
test('catalog counts real child identities, unsupported team versions expose a warning',()=>{
  const s=collaboration.create('s1');
  collaboration.ingest(s,[{seq:1,type:'tool/call',data:{name:'spawn'}},
    {seq:2,type:'subagent/catalog',data:{version:1,childId:'child',mode:'one-shot',label:'Reviewer'}},
    {seq:3,type:'team/member',data:{version:99,teamId:'s1',member:member('invalid')}}]);
  const v=collaboration.view(s,[],{sessionId:'s1'},true);
  assert.equal(v.total,1);assert.equal(v.children[0].title,'Reviewer');assert.ok(v.note);
});
test('store loads projections from truncated history and applies live collaboration events',()=>{
  const filename=path.resolve(__dirname,'../miniprogram/utils/store.js'), module={exports:{}};
  class Client {constructor(callbacks){this.callbacks=callbacks;}}
  vm.runInNewContext(fs.readFileSync(filename,'utf8'),{module,console,Date,
    wx:{getStorageSync(){},setStorageSync(){},removeStorageSync(){}},setTimeout(){return 1;},clearTimeout(){},setInterval(){return 1;},clearInterval(){},
    require:name=>name==='./gateway'?{GatewayClient:Client}:require(path.resolve(path.dirname(filename),name))});
  const store=module.exports;store.sessionState.sessionId='s1';
  store.client.callbacks.onFrame({kind:'history',sessionId:'s1',events:[],projections:projection(100,{subagentCatalog:[{id:'old-child',mode:'continuable'}]})});
  store.client.callbacks.onFrame({kind:'event',sessionId:'s1',seq:101,event:{type:'team/member',data:{version:2,teamId:'s1',member:member('new-member')}}});
  store.client.callbacks.onFrame({kind:'history',sessionId:'other',events:[],projections:projection(200,{subagentCatalog:[]})});
  assert.equal(store.sessionState.collaboration.children[0].id,'old-child');
  assert.equal(store.sessionState.collaboration.members.length,2);
  store.sessionState.sessionId='s2';
  store.client.callbacks.onFrame({kind:'history',sessionId:'s2',events:[]});
  assert.equal(store.sessionState.collaboration.children.length,0);
});
test('inspector shares pending history, never subscribes, and cannot overwrite the active conversation',async()=>{
  const forwarded=[],sent=[];const client=new GatewayClient({onFrame:f=>forwarded.push(f)});
  client.send=f=>{sent.push(f);return true;};
  client.subscribe('parent');sent.length=0;
  const p=client.inspectSession('child');assert.equal(client.inspectSession('child'),p);
  client.handleFrame(JSON.stringify({kind:'error',requestType:'history',message:'legacy error'}));
  assert.equal(forwarded.length,0,'uncorrelated inspector error must not fail the parent');
  assert.equal(sent.length,1);assert.equal(sent[0].type,'history');assert.equal(sent[0].maxMessages,20);
  client.handleFrame(JSON.stringify({kind:'history',sessionId:'child',events:[]}));
  assert.equal((await p).sessionId,'child');assert.equal(forwarded.length,0);
  client.handleFrame(JSON.stringify({kind:'history',sessionId:'parent',events:[]}));assert.equal(forwarded.length,1);
  const next=client.inspectSession('child');client.subscribe('child');
  client.handleFrame(JSON.stringify({kind:'history',sessionId:'child',events:[]}));await next;
  assert.equal(forwarded.at(-1).sessionId,'child','navigating into a child must not lose its history');
});
test('inspector timeout quarantines late responses until they arrive or disconnect',async()=>{
  const filename=path.resolve(__dirname,'../miniprogram/utils/gateway.js'), module={exports:{}},timers=[];
  vm.runInNewContext(fs.readFileSync(filename,'utf8'),{module,console,Uint8Array,ArrayBuffer,Date,
    setTimeout:fn=>{timers.push(fn);return timers.length;},clearTimeout(){},
    require:name=>require(path.resolve(path.dirname(filename),name))});
  const frames=[],client=new module.exports.GatewayClient({onFrame:f=>frames.push(f)});client.send=()=>true;
  const p=client.inspectSession('slow'), rejected=assert.rejects(p,e=>e.code==='INSPECTOR_TIMEOUT');
  timers.at(-1)();await rejected;assert.equal(client.inspectSession('slow'),p);
  client.handleFrame(JSON.stringify({kind:'history',sessionId:'slow',events:[]}));assert.equal(frames.length,0);
  assert.equal(client.pendingRequests['inspector:slow'],undefined);
});
test('collaboration preview preserves parent draft, ignores dismissed results, and prevents duplicate taps',async()=>{
  const {page,store}=fixture();store.state={connection:'connected',sessions:[]};
  store.sessionState.collaboration=collaboration.create('s1');
  collaboration.baseline(store.sessionState.collaboration,projection(5,{subagentCatalog:[{id:'child',mode:'continuable'}]}));
  page.data.draft='do not send';let resolve,requests=0;
  store.client.inspectSession=()=>{requests++;return new Promise(r=>resolve=r);};
  page.openCollaboration();page.selectCollaborationTab(event('id','children'));
  const p=page.openCollaborationItem(event('id','child'));
  await page.openCollaborationItem(event('id','child'));assert.equal(requests,1);
  page.closeCollaboration();page.openCollaboration();resolve({sessionId:'child',events:[]});await p;
  assert.equal(page.data.collaborationPreview,null);assert.equal(page.data.draft,'do not send');
  store.client.inspectSession=async()=>({sessionId:'child',events:[{seq:1,type:'assistant/message',data:{text:'Child result'}}]});
  await page.openCollaborationItem(event('id','child'));
  assert.equal(page.data.collaborationPreview.rows[0].text,'Child result');assert.equal(store.sessionState.sessionId,'s1');
});
test('stale refresh cannot unlock or mutate a newly opened collaboration panel',async()=>{
  const {page,store}=fixture();store.state={connection:'connected',sessions:[]};
  const pending=[];store.client.requestSessions=()=>new Promise(resolve=>pending.push(resolve));
  page.openCollaboration();page.closeCollaboration();page.openCollaboration();
  pending[0]();await new Promise(setImmediate);assert.equal(page.data.collaborationBusy,true);
  pending[1]();await new Promise(setImmediate);assert.equal(page.data.collaborationBusy,false);
});
test('collaboration icon tabs retain real counts, selection, and both theme assets',()=>{
  const {page,store}=fixture();store.state={connection:'connected',sessions:[],
    scheduledTasks:[{id:'t1',title:'Nightly digest',status:'active',scheduledAt:new Date().toISOString(),rule:{kind:'daily',hour:9,minute:0}}]};
  store.sessionState.collaboration=collaboration.create('s1');
  store.sessionState.trajectory=[{key:'call',badge:'TOOL',label:'Read file',completed:true}];
  collaboration.baseline(store.sessionState.collaboration,projection(8,{agentTeam:{members:[member('worker')],tasks:[{id:'task',subject:'Check',status:'pending'}]},subagentCatalog:[{id:'child',mode:'continuable'}]}));
  page.openCollaboration();
  assert.equal(JSON.stringify(page.data.collaborationTabs.map(({id,icon,count})=>({id,icon,count}))),JSON.stringify([
    {id:'members',icon:'dsh-team',count:2},{id:'children',icon:'dsh-agent',count:1},
    {id:'tasks',icon:'dsh-checklist',count:1},{id:'calls',icon:'dsh-process-tool',count:1},
    {id:'background',icon:'dsh-gauge',count:1},
    {id:'schedule',icon:'automation',count:1}
  ]));
  for(const tab of page.data.collaborationTabs){
    for(const suffix of ['', '-dark'])assert.ok(fs.existsSync(path.resolve(__dirname,'../miniprogram/assets/icons',tab.icon+suffix+'.svg')));
    page.selectCollaborationTab(event('id',tab.id));assert.equal(page.data.collaborationTab,tab.id);
    assert.ok(page.data.collaborationRows.length);
  }
  const template=fs.readFileSync(path.resolve(__dirname,'../miniprogram/pages/session/session.wxml'),'utf8');
  assert.ok(template.indexOf('class="collab-trigger nav-collab')>template.indexOf('class="nav-title"'),'collaboration entry sits in the nav bar');
  const heading=template.slice(template.indexOf('<view class="collab-heading">'),template.indexOf('class="collab-tabs"'));
  assert.match(heading,/bindtap="refreshCollaboration"/);assert.match(heading,/bindtap="closeCollaboration"/);
  assert.match(heading,/aria-disabled="{{collaborationBusy}}"/);
  assert.match(heading,/collab-close{{theme/);assert.match(heading,/sheet-refresh/);
  assert.doesNotMatch(heading,/sheet-close-x/,'collaboration close must not inherit the shared completion/checkmark styles');
  for(const suffix of ['', '-dark']){
    const svg=fs.readFileSync(path.resolve(__dirname,'../miniprogram/assets/icons/collab-close'+suffix+'.svg'),'utf8');
    assert.match(svg,/M6 6L18 18M18 6L6 18/,'both diagonals form a centered symmetric X');
  }
  assert.doesNotMatch(heading,/>{{ui['(?:刷新|关闭)']}}<\//);
});
test('refresh icon ignores repeated taps while busy and close clears its state',async()=>{
  const {page,store}=fixture();store.state={connection:'connected',sessions:[]};
  let calls=0,resolve;store.client.requestSessions=()=>{calls++;return new Promise(r=>resolve=r);};
  page.openCollaboration();page.refreshCollaboration();page.refreshCollaboration();
  assert.equal(calls,1);assert.equal(page.data.collaborationBusy,true);
  page.closeCollaboration();assert.equal(page.data.collaborationOpen,false);assert.equal(page.data.collaborationBusy,false);
  resolve();await new Promise(setImmediate);assert.equal(page.data.collaborationOpen,false);
});
test('collaboration handle toggles height without changing selected content or requesting data',()=>{
  const {page,store}=fixture();store.state={connection:'connected',sessions:[]};
  page.toggleCollaborationExpanded();assert.equal(page.data.collaborationExpanded,false);
  page.openCollaboration();page.selectCollaborationTab(event('id','children'));
  const rows=page.data.collaborationRows,preview={id:'child',title:'Research'};
  page.data.collaborationPreview=preview;page.data.draft='Keep this draft';
  store.client.requestSessions=()=>assert.fail('resizing must not refresh collaboration');
  page.toggleCollaborationExpanded();assert.equal(page.data.collaborationExpanded,true);
  assert.equal(page.data.collaborationTab,'children');assert.equal(page.data.collaborationRows,rows);
  assert.equal(page.data.collaborationPreview,preview);assert.equal(page.data.draft,'Keep this draft');
  page.toggleCollaborationExpanded();assert.equal(page.data.collaborationExpanded,false);
  page.toggleCollaborationExpanded();page.closeCollaboration();assert.equal(page.data.collaborationExpanded,false);
  store.client.requestSessions=undefined;page.openCollaboration();assert.equal(page.data.collaborationExpanded,false);
  const css=fs.readFileSync(path.resolve(__dirname,'../miniprogram/pages/session/session.wxss'),'utf8');
  assert.match(css,/\.sheet\.collab-sheet\s*\{[^}]*max-height:90vh/);
  assert.match(css,/\.sheet\.collab-sheet\.is-expanded\s*\{\s*height:90vh/);
});
test('native collaboration sheet renders all four tabs in light and dark modes', {skip:!fs.existsSync(process.env.WECHAT_WCC || '')},t=>{
  const os=require('node:os'),{execFileSync}=require('node:child_process');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dsh-collab-')),output=path.join(dir,'session.js');
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  execFileSync(process.env.WECHAT_WCC,['-o',output,'pages/session/session.wxml'],{cwd:path.resolve(__dirname,'../miniprogram')});
  const context=vm.createContext({window:{},console});vm.runInContext(fs.readFileSync(output,'utf8'),context);
  const render=context.$gwx('pages/session/session.wxml');const {page,store}=fixture();
  store.state={connection:'connected',sessions:[]};store.sessionState.collaboration=collaboration.create('s1');
  store.sessionState.trajectory=[{key:'call',badge:'TOOL',label:'Read file',preview:'README.md',completed:true}];
  collaboration.baseline(store.sessionState.collaboration,projection(8,{agentTeam:{members:[member('worker','Worker')],tasks:[{id:'task',subject:'Check result',status:'pending'}]},subagentCatalog:[{id:'child',mode:'continuable',label:'Research'}]}));
  page.openCollaboration();
  for(const theme of ['light','dark'])for(const [tab,label] of [['members','Worker'],['children','Research'],['tasks','Check result'],['calls','Read file']]){
    page.selectCollaborationTab(event('id',tab));
    for(const expanded of [false,true]){
    const data={...page.data,...require('../miniprogram/utils/ui-preferences').snapshot(),theme,themeClass:'theme-'+theme,collaborationExpanded:expanded};
    const tree=JSON.stringify(render(data,{},{}));
    for(const title of ['成员','子智能体','团队任务','工具调用',label])assert.ok(tree.includes(title),theme+'/'+tab+'/'+title);
    assert.ok(tree.includes('collab-scroll'));assert.ok(tree.includes('collab-close'));
    for(const icon of ['dsh-team','dsh-agent','dsh-checklist','dsh-process-tool','sheet-refresh','collab-close']){
      assert.ok(tree.includes('/assets/icons/'+icon+(theme==='dark'?'-dark':'')+'.svg'),theme+'/'+icon);
    }
    assert.ok(tree.includes('collab-tab-indicator'));
    assert.ok(tree.includes('toggleCollaborationExpanded'));
    assert.equal(tree.includes('collab-sheet is-expanded'),expanded);
    assert.ok(tree.includes(expanded?'收起协作面板':'展开协作面板至九成屏幕'));
    }
  }
});
