const test=require('node:test'),assert=require('node:assert/strict');
const policy=require('../miniprogram/pages/session/utils/work-step-presentation');
const protocol=require('../miniprogram/utils/protocol');
const {buildEntries}=require('../miniprogram/pages/session/utils/conversation-workflow');
const group=(extra)=>({kind:'processGroup',key:'g',running:true,completed:false,children:[],...extra});
test('four desktop modes have distinct live disclosure and detail policies',()=>{
 for(const mode of ['compact','standard','detailed','verbose']){
  const rows=[group({activityDetail:'Inspect repository'})],folds=policy.apply(rows,{mode}, {}, [],true);
  // 桌面端 liveProcess：回合进行中过程组始终展开（standard/detailed/verbose）；
  // compact 仍保持收起，是四档里唯一运行中不展开的。
  assert.equal(folds.g,['standard','detailed','verbose'].includes(mode));
  assert.equal(rows[0].liveDetail,['standard','detailed'].includes(mode)?'Inspect repository':'');
  assert.equal(rows[0].compactReasoning,mode==='compact');
  assert.equal(rows[0].detailFlat,mode==='verbose');
 }
});
test('standard mode adapts to running and finished turns like the desktop client',()=>{
 // 运行中：过程组展开，步骤随执行可见；标题带实时详情
 const live=[group({activityDetail:'Inspect repository'})];
 const liveFolds=policy.apply(live,{mode:'standard',timing:'completion'},{},[],true);
 assert.equal(liveFolds.g,true,'a running turn keeps its process group open');
 assert.equal(live[0].liveDetail,'Inspect repository');
 // 运行结束（回答结束后收起）：同一 group 从 running 过渡到 completed 时收起成一行
 const done=[group({running:false,completed:true})];
 const doneFolds=policy.apply(done,{mode:'standard',timing:'completion'},liveFolds,live,false);
 assert.equal(doneFolds.g,false,'a finished turn folds back to one line');
 assert.equal(done[0].liveDetail,'','the live detail clears once finished');
 // 运行结束（下次有新消息时）：完成后再看一会儿，直到用户发下一条才收起
 const pending=[group({running:false,completed:true})];
 assert.equal(policy.apply(pending,{mode:'standard',timing:'next-input'},liveFolds,live,false).g,true);
 const next=[group({running:false,completed:true}),{kind:'user',key:'u'}];
 assert.equal(policy.apply(next,{mode:'standard',timing:'next-input'},liveFolds,pending,false).g,false);
 // 失败/停止：与桌面端 turnProcessAlwaysOpen 一致，标准模式下也展开
 assert.equal(policy.apply([group({running:false,failed:true})],{mode:'standard'},{},[],true).g,true);
 assert.equal(policy.apply([group({running:false,stopped:true})],{mode:'standard'},{},[],true).g,true);
 // 手动收起优先：运行中用户手动折起来，后续 tick 不再自动展开
 assert.equal(policy.apply(live,{mode:'standard',timing:'completion'},{g:false},live,false).g,false);
});
test('completion collapse and next-input collapse are independent',()=>{
 const running=[group()],done=[group({running:false,completed:true})];
 assert.equal(policy.apply(done,{mode:'detailed',timing:'completion'},{g:true},running,false).g,false);
 const pending=[group({running:false,completed:true})];
 assert.equal(policy.apply(pending,{mode:'detailed',timing:'next-input'},{g:true},running,false).g,true);
 const next=[group({running:false,completed:true}),{kind:'user',key:'u'}];
 assert.equal(policy.apply(next,{mode:'detailed',timing:'next-input'},{g:true},pending,false).g,false);
 assert.equal(policy.apply(next,{mode:'verbose',timing:'completion'},{g:true},running,false).g,true);
});
test('detailed mode restores grouped live steps and honors the turn collapse timing',()=>{
 const running=[group()];
 const liveFolds=policy.apply(running,{mode:'detailed',timing:'completion'},{},[],true);
 assert.equal(liveFolds.g,true,'the running process group stays expanded');
 assert.equal(running[0].detailFlat,false,'detailed mode keeps its process-group header');

 const turn=()=>({kind:'turnProcess',key:'turn-g'});
 const latest=[turn()];
 const open=policy.apply(latest,{mode:'detailed',timing:'next-input'},{},[],true);
 assert.equal(open['turn-g'],true,'keep the completed details open until another user message');
 const next=[turn(),{kind:'user',key:'u'}];
 assert.equal(policy.apply(next,{mode:'detailed',timing:'next-input'},open,latest,false)['turn-g'],false,
  'collapse when the next user message arrives');
 assert.equal(policy.apply([turn()],{mode:'detailed',timing:'completion'},{},[],true)['turn-g'],false,
  'completion timing still collapses immediately');
 assert.equal(policy.apply([turn()],{mode:'compact',timing:'next-input'},{},[],true)['turn-g'],false,
  'other modes retain their existing turn disclosure policy');
});
test('manual disclosure survives ticks and reopening a completed turn',()=>{
 assert.equal(policy.apply([group()],{mode:'detailed'},{g:false},[group()],false).g,false);
 const done=()=>group({running:false,completed:true});
 assert.equal(policy.apply([done()],{mode:'detailed'},{g:true},[done()],false).g,true);
 assert.equal(policy.apply([group({running:false,failed:true})],{mode:'compact'},{},[],false).g,true);
});
test('initial tool name delta and later name repair update live activity',()=>{
 const agg=protocol.newAggregator();
 function push(seq,event){protocol.applyEvent(agg,{seq,sessionId:'s',event});}
 push(1,{type:'assistant/chunk',turn:1,chunkType:'tool-call-delta',tool:{id:'c',name:null,argumentsDelta:''}});
 assert.equal(agg.rows[0].tools.length,1);
 push(2,{type:'assistant/chunk',turn:1,chunkType:'tool-call-delta',tool:{id:'c',name:'bash',argumentsDelta:''}});
 assert.equal(agg.rows[0].tools[0].name,'bash');
 assert.equal(buildEntries(agg.rows,{running:true})[0].title,'正在执行命令');
 push(3,{type:'tool/result',turn:1,callId:'c',preview:'ok'});
 assert.equal(buildEntries(agg.rows,{running:true})[0].title,'正在整理工具结果');
 push(4,{type:'assistant/chunk',turn:1,chunkType:'text',text:'完成'});
 assert.equal(buildEntries(agg.rows,{running:true}).at(-1).title,'正在生成回复');
 push(5,{type:'turn/end',turn:1,reason:'completed'});
 assert.equal(buildEntries(agg.rows)[0].title,'已完成');
});
test('active work sits below narration and obeys completion collapse settings',()=>{
 const rows=[{kind:'user',key:'u',text:'执行任务'},
   {kind:'assistant',key:'a',turn:1,text:'先检查文件',reasoning:'检查中',tools:[],streaming:true}];
 const live=buildEntries(rows,{running:true});
 assert.deepEqual(live.map(r=>r.kind),['user','assistant','processGroup']);
 const folds=policy.apply(live,{mode:'detailed',timing:'completion'},{},[],true);
 assert.equal(folds[live.at(-1).key],true);
 rows[1].streaming=false;rows[1].turnClosed=true;rows[1].turnEndReason='completed';
 const done=buildEntries(rows);
 assert.deepEqual(done.map(r=>r.kind),['user','processGroup','assistant']);
 assert.equal(done[1].key,live.at(-1).key);
 assert.equal(policy.apply(done,{mode:'detailed',timing:'completion'},folds,live,false)[done[1].key],false);
 assert.equal(policy.apply(done,{mode:'detailed',timing:'next-input'},folds,live,false)[done[1].key],true);
 assert.equal(policy.apply(done,{mode:'verbose',timing:'completion'},folds,live,false)[done[1].key],true);
});
test('settings persistence validates modes and leaves failed writes visible to caller',()=>{
 let stored;global.wx={getStorageSync:()=>stored,setStorageSync:(key,v)=>{assert.equal(key,policy.KEY);stored=v;}};
 try{assert.deepEqual(policy.read(),{mode:'detailed',timing:'completion'});policy.save({mode:'verbose',timing:'next-input'});assert.equal(policy.read().mode,'verbose');assert.equal(policy.view(policy.read()).workStepTimingLabel,'下次有新消息时');wx.setStorageSync=()=>{throw Error('full')};assert.throws(()=>policy.save({mode:'compact'}));}finally{delete global.wx;}
});

test('a finished turn gets one 已完成 disclosure above its rounds', () => {
  const tool = (name) => ({ callId: name + Math.random(), key: name, name, status: 'done', argumentsText: '{}' });
  const base = [
    { kind: 'user', key: 'u', text: '任务' },
    { kind: 'assistant', key: 'a1', turn: 1, reasoning: '想一下', tools: [tool('bash'), tool('read')] },
    { kind: 'assistant', key: 'a2', turn: 1, text: '中间叙述' },
    { kind: 'assistant', key: 'a3', turn: 1, tools: [tool('edit'), tool('code')] },
    { kind: 'assistant', key: 'a4', turn: 1, text: '最终答复', streaming: true }
  ];
  const clone = rows => rows.map(r => Object.assign({}, r));
  // 执行中：没有回合行，各组照常各自显示（前面的组折叠、活动组展开）
  let entries = buildEntries(clone(base), { running: true });
  let folds = policy.apply(entries, { mode: 'standard', timing: 'completion' }, {}, [], true);
  assert.equal(entries.filter(e => e.kind === 'turnProcess').length, 0);
  const liveGroups = entries.filter(e => e.kind === 'processGroup');
  assert.equal(liveGroups.length, 2);
  assert.equal(folds[liveGroups[0].key], false);
  assert.equal(folds[liveGroups[1].key], true);
  // 对话结束：过程内容上方出现一个「已完成」disclosure，默认自动折叠
  const done = clone(base).map(r => Object.assign({}, r, { streaming: false }));
  done[4].turnClosed = true; done[4].turnEndReason = 'completed'; done[4].durationMs = 12500;
  entries = buildEntries(done, {});
  folds = policy.apply(entries, { mode: 'standard', timing: 'completion' }, folds, entries, false);
  const turn = entries.find(e => e.kind === 'turnProcess');
  assert.ok(turn, 'the turn disclosure appears once the turn closes');
  assert.equal(turn.title, '已完成');
  assert.equal(turn.summary, '用时 13 秒', '回合用时只挂回合行');
  assert.equal(folds[turn.key], false, '对话结束自动折叠');
  // 折叠时整轮过程折成回合行那一行，只留下最终答复
  assert.deepEqual(entries.filter(e => !e.turnProcessKey || folds[e.turnProcessKey]).map(e => e.kind),
    ['user', 'turnProcess', 'assistant']);
  // 点击展开：各轮过程组与中间叙述照原顺序显示，各组按子内容命名
  folds[turn.key] = true;
  assert.deepEqual(entries.filter(e => e.turnProcessKey === turn.key).map(e => e.kind === 'processGroup' ? e.title : e.text),
    ['执行了命令并已读取文件', '中间叙述', '修改了文件并运行了代码']);
  assert.deepEqual(entries.filter(e => e.turnProcessKey === turn.key && e.kind === 'processGroup').map(e => e.summary),
    ['2 次工具调用', '2 次工具调用']);
  // 最终答复留在 disclosure 外面，始终可见
  assert.deepEqual(entries.map(e => e.kind), ['user', 'turnProcess', 'processGroup', 'assistant', 'processGroup', 'assistant']);
  assert.equal(entries[entries.length - 1].turnProcessKey, undefined);
  // 失败/停止同理：一个回合级标题
  const failed = clone(base).map(r => Object.assign({}, r, { streaming: false }));
  failed[4].turnClosed = true; failed[4].turnEndReason = 'error';
  entries = buildEntries(failed, {});
  assert.deepEqual(entries.filter(e => e.kind === 'turnProcess').map(e => e.title), ['执行失败']);
});

test('running turns name each settled round by its own content', () => {
  const tool = (name) => ({ callId: name + Math.random(), key: name, name, status: 'done', argumentsText: '{}' });
  const rows = [
    { kind: 'user', key: 'u', text: '任务' },
    { kind: 'assistant', key: 'a1', turn: 1, reasoning: '想一下', tools: [tool('bash'), tool('read')] },
    { kind: 'assistant', key: 'a2', turn: 1, text: '中间叙述一' },
    { kind: 'assistant', key: 'a3', turn: 1, tools: [tool('edit'), tool('code')] },
    { kind: 'assistant', key: 'a4', turn: 1, text: '最终答复', streaming: true }
  ];
  const entries = buildEntries(rows, { running: true });
  // 执行中：已收工的轮次按子内容命名；活动组（正在流式输出答复）保留实时标题；不插回合行
  assert.deepEqual(entries.filter(e => e.kind === 'processGroup').map(e => e.title),
    ['执行了命令并已读取文件', '正在生成回复']);
  assert.equal(entries.filter(e => e.kind === 'turnProcess').length, 0);
  // 只思考过、没有工具的轮次叫「已完成分析」
  const thinking = buildEntries([
    { kind: 'user', key: 'u', text: '任务' },
    { kind: 'assistant', key: 'a1', turn: 1, reasoning: '想一下' },
    { kind: 'assistant', key: 'a2', turn: 1, text: '叙述' },
    { kind: 'assistant', key: 'a3', turn: 1, tools: [tool('bash')] }
  ], { running: true });
  assert.deepEqual(thinking.filter(e => e.kind === 'processGroup').map(e => e.title),
    ['已完成分析', '正在整理工具结果']);
});

// ---------- 设置页菜单端到端（此前只有 apply/view/save 的逻辑覆盖，没有点击链） ----------
test('settings page persists both work-step choices through the real tap chain', () => {
  const vm = require('node:vm');
  const fs = require('node:fs');
  const path = require('node:path');
  const memory = new Map();
  global.wx = {
    getStorageSync: (key) => memory.get(key),
    setStorageSync: (key, value) => memory.set(key, value),
    removeStorageSync: (key) => memory.delete(key),
    showToast: () => { throw new Error('save must not fail'); },
    getAccountInfoSync: () => ({ miniProgram: { appId: 'wx-fixture' } }),
    getSystemInfoSync: () => ({ windowWidth: 390 }),
    // 量行高：回调里给一个视口坐标，覆盖真实测量路径（不是兜底分支）
    createSelectorQuery: () => ({
      in: () => ({
        select: () => ({
          boundingClientRect: (cb) => { cb({ bottom: 300, right: 350 }); return { exec: () => {} }; }
        })
      })
    })
  };
  let definition;
  const file = path.resolve(__dirname, '../miniprogram/pages/settings/settings.js');
  try {
    vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
      Page: (value) => { definition = value; }, wx: global.wx, console,
      require: (name) => require(path.resolve(path.dirname(file), name))
    });
    const page = { ...definition, data: { ...definition.data }, setData(patch) { Object.assign(this.data, patch); } };

    // 打开「工作步骤展示」菜单并选「简洁」
    page.toggleWorkStepMenu({ currentTarget: { dataset: { field: 'mode' } } });
    assert.equal(page.data.workStepMenu, 'mode', 'the menu opens');
    assert.equal(page.data.workStepMenuTop, '308px', '下拉按行高定位（视口坐标）');
    assert.equal(page.data.workStepMenuRight, '40px');
    page.chooseWorkStep({ currentTarget: { dataset: { field: 'mode', id: 'compact' } } });
    assert.equal(page.data.workStepMode, 'compact');
    assert.equal(page.data.workStepModeLabel, '简洁');
    assert.equal(page.data.workStepMenu, '', 'the menu closes after choosing');
    assert.deepEqual(memory.get('workStepPresentation'), { mode: 'compact', timing: 'completion' },
      'the choice is written to storage');

    // 再选「工作步骤收起时机」
    page.toggleWorkStepMenu({ currentTarget: { dataset: { field: 'timing' } } });
    page.chooseWorkStep({ currentTarget: { dataset: { field: 'timing', id: 'next-input' } } });
    assert.equal(page.data.workStepTiming, 'next-input');
    assert.deepEqual(memory.get('workStepPresentation'), { mode: 'compact', timing: 'next-input' });

    // 会话页读同一把 KEY：设置必须对渲染生效
    assert.deepEqual(policy.read(), { mode: 'compact', timing: 'next-input' });

    // 非法的 field/id 不得写坏存储
    page.chooseWorkStep({ currentTarget: { dataset: { field: 'nope', id: 'x' } } });
    page.chooseWorkStep({ currentTarget: { dataset: { field: 'mode', id: 'not-a-mode' } } });
    assert.deepEqual(memory.get('workStepPresentation'), { mode: 'compact', timing: 'next-input' },
      'an unknown id falls back to the default instead of corrupting storage');
  } finally { delete global.wx; }
});

test('the four presentation modes each lay the process out differently', () => {
  const tool = (name) => ({ callId: name + Math.random(), key: name, name, status: 'done', argumentsText: '{}' });
  const live = [
    { kind: 'user', key: 'u', text: '任务' },
    { kind: 'assistant', key: 'a1', turn: 1, tools: [tool('bash')] },
    { kind: 'assistant', key: 'a2', turn: 1, text: '中间叙述' },
    { kind: 'assistant', key: 'a3', turn: 1, tools: [tool('code')] },
    { kind: 'assistant', key: 'a4', turn: 1, text: '答复', streaming: true }
  ];
  const done = live.map(r => Object.assign({}, r, { streaming: false }));
  done[4].turnClosed = true; done[4].turnEndReason = 'completed'; done[4].durationMs = 12500;
  // 执行中：compact 全折叠；standard/detailed 保留分组头；verbose 平铺无组头
  for (const [mode, flat] of [['compact', false], ['standard', false], ['detailed', false], ['verbose', true]]) {
    const entries = buildEntries(live.map(r => Object.assign({}, r)), { running: true });
    policy.apply(entries, { mode, timing: 'completion' }, {}, [], true);
    const groups = entries.filter(e => e.kind === 'processGroup');
    assert.deepEqual(groups.map(g => g.detailFlat), [flat, flat], mode + ' flat while running');
  }
  const compactFolds = policy.apply(buildEntries(live.map(r => Object.assign({}, r)), { running: true }), { mode: 'compact', timing: 'completion' }, {}, [], true);
  const standardFolds = policy.apply(buildEntries(live.map(r => Object.assign({}, r)), { running: true }), { mode: 'standard', timing: 'completion' }, {}, [], true);
  const compactEntries = buildEntries(live.map(r => Object.assign({}, r)), { running: true });
  const standardEntries = buildEntries(live.map(r => Object.assign({}, r)), { running: true });
  assert.deepEqual(compactEntries.filter(e => e.kind === 'processGroup').map(g => compactFolds[g.key]), [false, false], 'compact 运行中也全折叠');
  assert.deepEqual(standardEntries.filter(e => e.kind === 'processGroup').map(g => standardFolds[g.key]), [false, true], 'standard 活动组展开');
  // 已结束：compact/standard/detailed 自动折叠回合行；verbose 永不折叠且永远平铺
  for (const [mode, turnOpen] of [['compact', false], ['standard', false], ['detailed', false], ['verbose', true]]) {
    const entries = buildEntries(done.map(r => Object.assign({}, r)), {});
    const folds = policy.apply(entries, { mode, timing: 'completion' }, {}, [], true);
    const turn = entries.find(e => e.kind === 'turnProcess');
    assert.equal(folds[turn.key], turnOpen, mode + ' 回合行默认状态');
    const groups = entries.filter(e => e.kind === 'processGroup');
    assert.deepEqual(groups.map(g => g.detailFlat), [mode === 'verbose', mode === 'verbose'], mode + ' 结束后是否平铺');
  }
});
