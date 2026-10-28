const test=require('node:test'),assert=require('node:assert/strict');
const policy=require('../miniprogram/pages/session/utils/work-step-presentation');
const protocol=require('../miniprogram/utils/protocol');
const {buildEntries}=require('../miniprogram/pages/session/utils/conversation-workflow');
const group=(extra)=>({kind:'processGroup',key:'g',running:true,completed:false,children:[],...extra});
test('four desktop modes expose the same distinct live/header/detail policy',()=>{
 for(const mode of ['compact','standard','detailed','verbose']){
  const rows=[group({activityDetail:'Inspect repository'})],folds=policy.apply(rows,{mode}, {}, [],true);
  // compact/standard 永远分组（折叠成标题）；detailed 对话过程中不分组、过程照常展开；
  // verbose 永远展开
  assert.equal(folds.g,false);
  assert.equal(rows[0].processBodyVisible,mode==='detailed'||mode==='verbose');
  assert.equal(rows[0].processBodyCapped,mode!=='verbose');
  assert.equal(rows[0].liveDetail,['standard','detailed'].includes(mode)?'Inspect repository':'');
 }
});
test('standard mode adapts to running and finished turns like the desktop client',()=>{
 // 运行中：步骤始终挂载在可滚动组体内；标题带实时详情
 const live=[group({activityDetail:'Inspect repository'})];
 const liveFolds=policy.apply(live,{mode:'standard',timing:'completion'},{},[],true);
 assert.equal(liveFolds.g,false,'the process disclosure starts in its default state');
 assert.equal(live[0].processBodyCapped,true,'standard mode uses the DSH capped-scroll body');
 assert.equal(live[0].liveDetail,'Inspect repository');
 // 回答结束后保持同样的 capped-scroll body；只有 live title/detail clears.
 const done=[group({running:false,completed:true})];
 const doneFolds=policy.apply(done,{mode:'standard',timing:'completion'},liveFolds,live,false);
 assert.equal(doneFolds.g,false);
 assert.equal(done[0].processBodyCapped,true);
 assert.equal(done[0].liveDetail,'','the live detail clears once finished');
 // next-input timing allows an uncapped process body until the user explicitly caps it.
 const pending=[group({running:false,completed:true})];
 const pendingFolds=policy.apply(pending,{mode:'standard',timing:'next-input'},liveFolds,live,false);
 assert.equal(pendingFolds.g,false);
 assert.equal(pending[0].processBodyCapped,false);
 const manuallyCappedRows=[group({running:false,completed:true})];
 const manuallyCapped=policy.apply(manuallyCappedRows,{mode:'standard',timing:'next-input'},{g:true},pending,false);
 assert.equal(manuallyCapped.g,true);
 assert.equal(manuallyCappedRows[0].processBodyCapped,true);
 const next=[group({running:false,completed:true}),{kind:'user',key:'u'}];
 assert.equal(policy.apply(next,{mode:'standard',timing:'next-input'},liveFolds,pending,false).g,false);
 // Failure/stopped remain visible without forcing a local scroll-cap state.
 const failed=[group({running:false,failed:true})];
 assert.equal(policy.apply(failed,{mode:'standard'},{},[],true).g,false);
 assert.equal(failed[0].processBodyCapped,true);
 const stopped=[group({running:false,stopped:true})];
 assert.equal(policy.apply(stopped,{mode:'standard'},{},[],true).g,false);
 assert.equal(stopped[0].processBodyCapped,true);
 // Manual disclosure state survives ticks and controls the local body cap.
 assert.equal(policy.apply(live,{mode:'standard',timing:'completion'},{g:false},live,false).g,false);
});
test('completion collapse and next-input collapse are independent',()=>{
 const running=[group()],done=[group({running:false,completed:true})];
 const completionFolds=policy.apply(done,{mode:'detailed',timing:'completion'},{g:true},running,false);
 assert.equal(completionFolds.g,true,'group disclosure state is independent from turn folding');
 assert.equal(done[0].processBodyCapped,true,'completed detailed history is grouped and capped at completion');
 const pending=[group({running:false,completed:true})];
 const pendingFolds=policy.apply(pending,{mode:'detailed',timing:'next-input'},{g:false},running,false);
 assert.equal(pendingFolds.g,false);
 assert.equal(pending[0].processBodyCapped,false,'latest deferred detailed group remains uncapped');
 const next=[group({running:false,completed:true}),{kind:'user',key:'u'}];
 policy.apply(next,{mode:'detailed',timing:'next-input'},{g:false},pending,false);
 assert.equal(next[0].processBodyCapped,false,'next-input mode keeps bodies uncapped until opened');
 const verbose=[group()];
 assert.equal(policy.apply(verbose,{mode:'verbose',timing:'completion'},{},running,true).g,false);
 assert.equal(verbose[0].processBodyCapped,false,'verbose mode never caps process bodies');
});
test('detailed mode restores grouped live steps and honors the turn collapse timing',()=>{
 const running=[group()];
 const liveFolds=policy.apply(running,{mode:'detailed',timing:'completion'},{},[],true);
 assert.equal(liveFolds.g,false,'the process group body is visible by default');
 assert.equal(running[0].processBodyVisible,true,'detailed shows the process while the turn runs');
 assert.equal(running[0].processBodyCapped,true,'detailed live process rides in the capped scroll container');
 // 回合一收工就折叠回标题（history 分组），点组头才再展开
 const done=[group({running:false,completed:true})];
 policy.apply(done,{mode:'detailed',timing:'completion'},{},[],true);
 assert.equal(done[0].processBodyVisible,false,'detailed collapses to a heading once the turn closes');

 const turn=()=>({kind:'turnProcess',key:'turn-g'});
 const latest=[turn()];
 const open=policy.apply(latest,{mode:'detailed',timing:'next-input'},{},[],true);
 assert.equal(open['turn-g'],true,'keep the completed details open until another user message');
 const next=[turn(),{kind:'user',key:'u'}];
 assert.equal(policy.apply(next,{mode:'detailed',timing:'next-input'},open,latest,false)['turn-g'],false,
  'collapse when the next user message arrives');
 assert.equal(policy.apply([turn()],{mode:'detailed',timing:'completion'},{},[],true)['turn-g'],false,
  'completion timing still collapses immediately');
 for(const mode of ['compact','standard','detailed']){
  assert.equal(policy.apply([turn()],{mode,timing:'next-input'},{},[],true)['turn-g'],true,
   mode+' defers the latest completed turn until next input');
 }
 assert.equal(policy.apply([turn()],{mode:'compact',timing:'completion'},{},[],true)['turn-g'],false,
  'completion timing folds all non-verbose modes immediately');
 const failure=[{kind:'turnProcess',key:'failure',alwaysOpen:true}];
 assert.equal(policy.apply(failure,{mode:'compact',timing:'completion'},{},[],true).failure,true,
  'DSH error/interrupt turns remain expanded regardless of the selected mode');
 const verbose=[{kind:'turnProcess',key:'verbose-turn',expandable:true}];
 const verboseOpen=policy.apply(verbose,{mode:'verbose',timing:'completion'},{},[],true);
 assert.equal(verboseOpen['verbose-turn'],true);
 assert.equal(verbose[0].foldable,false,'verbose turns are not user-collapsible');
 assert.equal(policy.apply([{kind:'turnProcess',key:'verbose-turn',expandable:true}],
  {mode:'verbose',timing:'completion'},{'verbose-turn':false},verbose,false)['verbose-turn'],true,
  'manual state cannot collapse turns while foldCompletedTurns is disabled');
});
test('manual disclosure survives ticks and reopening a completed turn',()=>{
 assert.equal(policy.apply([group()],{mode:'detailed'},{g:false},[group()],false).g,false);
 const done=()=>group({running:false,completed:true});
 assert.equal(policy.apply([done()],{mode:'detailed'},{g:true},[done()],false).g,true);
 const fail=[group({running:false,failed:true})];
 assert.equal(policy.apply(fail,{mode:'compact'},{},[],false).g,false);
 assert.equal(fail[0].processBodyCapped,true);
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
 assert.equal(folds[live.at(-1).key],false,'process detail is visible in its mounted body');
 rows[1].streaming=false;rows[1].turnClosed=true;rows[1].turnEndReason='completed';
 const done=buildEntries(rows);
 assert.deepEqual(done.map(r=>r.kind),['user','turnProcess','processGroup','assistant']);
 const groupEntry=done.find(r=>r.kind==='processGroup');
 const turnEntry=done.find(r=>r.kind==='turnProcess');
 assert.equal(groupEntry.key,live.at(-1).key);
 const completionFolds=policy.apply(done,{mode:'detailed',timing:'completion'},folds,live,false);
 assert.equal(completionFolds[turnEntry.key],false,'the outer turn follows completion timing');
 assert.equal(completionFolds[groupEntry.key],false,'the process group keeps its independent disclosure state');
 const nextInputFolds=policy.apply(done,{mode:'detailed',timing:'next-input'},folds,live,false);
 assert.equal(nextInputFolds[turnEntry.key],true,'the latest turn stays open until another input');
 assert.equal(groupEntry.processBodyCapped,false,'the latest group remains uncapped in next-input mode');
 const verboseFolds=policy.apply(done,{mode:'verbose',timing:'completion'},folds,live,false);
 assert.equal(verboseFolds[turnEntry.key],true,'verbose never collapses a completed turn');
});
test('compact strips count suffixes from group headings while standard keeps them',()=>{
 for(const [mode,expected] of [['compact',''],['standard','2 次工具调用 · 1 项上下文']]){
  const rows=[group({summary:'2 次工具调用 · 1 项上下文'})];
  policy.apply(rows,{mode},{},[],true);
  assert.equal(rows[0].summary,expected,mode+' heading summary');
 }
 // 失败回合的工作汇总文案不是计数，保留
 const failed=[group({running:false,failed:true,summary:'已读取文件，修改了文件'})];
 policy.apply(failed,{mode:'compact'},{},[],true);
 assert.equal(failed[0].summary,'已读取文件，修改了文件');
});

test('compact keeps one live status line and folds settled group headings while running',()=>{
 const running=[group({turnRunning:true}),group({key:'g2',turnRunning:true,running:false,completed:false})];
 policy.apply(running,{mode:'compact'},{},[],true);
 assert.equal(running[0].headingHidden,false,'the active group keeps its line');
 assert.equal(running[1].headingHidden,true,'settled group headings fold away during the run');
 // 标准/详细不收标题
 for(const mode of ['standard','detailed']){
  const rows=[group({turnRunning:true}),group({key:'g2',turnRunning:true,running:false})];
  policy.apply(rows,{mode},{},[],true);
  assert.ok(rows.every(row=>!row.headingHidden),mode+' keeps every heading');
 }
 // 回合收工后标题回来
 const done=[group({running:false,turnRunning:false,completed:true})];
 policy.apply(done,{mode:'compact'},{},[],true);
 assert.equal(done[0].headingHidden,false,'settled turns show their headings again');
});

test('compact group headings show in full instead of ellipsis',()=>{
 for(const mode of ['compact','standard','detailed','verbose']){
  const rows=[group({title:'已读取文件，已搜索代码，修改了文件，执行了命令等'})];
  policy.apply(rows,{mode},{},[],true);
  assert.equal(rows[0].titleWrap,mode==='compact',mode+' titleWrap');
 }
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
  assert.equal(folds[liveGroups[1].key], false);
  // 对话结束：过程内容上方出现一个「已完成」disclosure，默认自动折叠
  const done = clone(base).map(r => Object.assign({}, r, { streaming: false }));
  done[4].turnClosed = true; done[4].turnEndReason = 'completed'; done[4].durationMs = 12500;
  entries = buildEntries(done, {});
  folds = policy.apply(entries, { mode: 'standard', timing: 'completion' }, folds, entries, false);
  const turn = entries.find(e => e.kind === 'turnProcess');
  assert.ok(turn, 'the turn disclosure appears once the turn closes');
  assert.equal(turn.title, '已完成');
  assert.equal(turn.summary, '用时 13 秒', '回合用时只挂回合行');
  assert.equal(turn.expandedSummary, '4 次工具调用', 'expanded turn header summarizes calls across its groups');
  assert.equal(folds[turn.key], false, '对话结束自动折叠');
  // 折叠时整轮过程折成回合行那一行，只留下最终答复
  assert.deepEqual(entries.filter(e => !e.turnProcessKey || folds[e.turnProcessKey]).map(e => e.kind),
    ['user', 'turnProcess', 'assistant']);
  // 点击展开：各轮过程组与中间叙述照原顺序显示，各组按子内容命名
  folds[turn.key] = true;
  assert.deepEqual(entries.filter(e => e.turnProcessKey === turn.key).map(e => e.kind === 'processGroup' ? e.title : e.text),
    ['执行了命令并已读取文件', '中间叙述', '修改了文件并运行了代码']);
  assert.deepEqual(entries.filter(e => e.turnProcessKey === turn.key && e.kind === 'processGroup').map(e => e.summary),
    ['2 次工具调用', '2 次工具调用'], '完成的回合每组标题后仍带本组工具次数');
  // 展开回合后每个过程组仍是一个标题行，组体继续收着，点组头才展开
  assert.ok(entries.filter(e => e.turnProcessKey === turn.key && e.kind === 'processGroup')
    .every(e => !e.turnGroupHeadingHidden && e.processBodyVisible === false && e.processBodyCapped),
  'successful turn expansion keeps one collapsed heading per process group');
  // 最终答复留在 disclosure 外面，始终可见
  assert.deepEqual(entries.map(e => e.kind), ['user', 'turnProcess', 'processGroup', 'assistant', 'processGroup', 'assistant']);
  assert.equal(entries[entries.length - 1].turnProcessKey, undefined);
  // 失败/停止同理：一个回合级标题
  const failed = clone(base).map(r => Object.assign({}, r, { streaming: false }));
  failed[4].turnClosed = true; failed[4].turnEndReason = 'error';
  entries = buildEntries(failed, {});
  const failedTurn = entries.find(e => e.kind === 'turnProcess');
  assert.equal(failedTurn.title, '执行失败');
  assert.equal(failedTurn.alwaysOpen, true);

  const maxTokens = clone(base).map(r => Object.assign({}, r, { streaming: false }));
  maxTokens[4].turnClosed = true; maxTokens[4].turnEndReason = 'max-tokens';
  const limitedTurn = buildEntries(maxTokens, {}).find(e => e.kind === 'turnProcess');
  assert.equal(limitedTurn.alwaysOpen, false,'max-token completion is not in DSH turnProcessAlwaysOpen');
});

test('a finished single-group turn gets the same outer disclosure as the desktop client', () => {
  const rows = [
    { kind: 'user', key: 'u', text: '任务' },
    { kind: 'assistant', key: 'work', turn: 1, tools: [
      { key: 'tool-1', callId: 'tool-1', name: 'read', status: 'done', argumentsText: '{}' }
    ] },
    { kind: 'assistant', key: 'answer', turn: 1, text: '完成', turnClosed: true, turnEndReason: 'completed' }
  ];
  const entries = buildEntries(rows);
  const turn = entries.find(entry => entry.kind === 'turnProcess');
  const groupEntry = entries.find(entry => entry.kind === 'processGroup');
  assert.ok(turn, 'the outer turn disclosure is present even with one process group');
  assert.equal(groupEntry.turnProcessKey, turn.key);
  assert.deepEqual(entries.map(entry => entry.kind), ['user', 'turnProcess', 'processGroup', 'assistant']);

  const folds = policy.apply(entries, { mode: 'standard', timing: 'completion' }, {}, [], true);
  assert.equal(folds[turn.key], false, 'completion timing hides the settled process group');
  assert.deepEqual(entries.filter(entry => !entry.turnProcessKey || folds[entry.turnProcessKey]).map(entry => entry.kind),
    ['user', 'turnProcess', 'assistant']);
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

    for (const [id, label] of [['standard', '标准'], ['detailed', '详细'], ['verbose', '完全展开'], ['compact', '简洁']]) {
      page.toggleWorkStepMenu({ currentTarget: { dataset: { field: 'mode' } } });
      page.chooseWorkStep({ currentTarget: { dataset: { field: 'mode', id } } });
      assert.equal(page.data.workStepMode, id);
      assert.equal(page.data.workStepModeLabel, label);
      assert.deepEqual(memory.get('workStepPresentation'), { mode: id, timing: 'completion' }, id + ' mode persists');
    }

    // Both timing choices round-trip through the same tap path.
    page.toggleWorkStepMenu({ currentTarget: { dataset: { field: 'timing' } } });
    page.chooseWorkStep({ currentTarget: { dataset: { field: 'timing', id: 'next-input' } } });
    assert.equal(page.data.workStepTiming, 'next-input');
    assert.deepEqual(memory.get('workStepPresentation'), { mode: 'compact', timing: 'next-input' });
    page.toggleWorkStepMenu({ currentTarget: { dataset: { field: 'timing' } } });
    page.chooseWorkStep({ currentTarget: { dataset: { field: 'timing', id: 'completion' } } });
    assert.equal(page.data.workStepTiming, 'completion');
    assert.deepEqual(memory.get('workStepPresentation'), { mode: 'compact', timing: 'completion' });
    page.toggleWorkStepMenu({ currentTarget: { dataset: { field: 'timing' } } });
    page.chooseWorkStep({ currentTarget: { dataset: { field: 'timing', id: 'next-input' } } });
    assert.equal(page.data.workStepTiming, 'next-input');

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
  // Group content always flows with the page; modes still control titles and reasoning previews.
  for (const mode of ['compact', 'standard', 'detailed', 'verbose']) {
    const entries = buildEntries(live.map(r => Object.assign({}, r)), { running: true });
    policy.apply(entries, { mode, timing: 'completion' }, {}, [], true);
    const groups = entries.filter(e => e.kind === 'processGroup');
    assert.deepEqual(groups.map(g => g.processBodyCapped), mode === 'verbose' ? [false, false] : [true, true],
      mode + ' keeps a visible body inside the capped scroll container');
    assert.deepEqual(groups.map(g => g.processBodyVisible), mode === 'compact' || mode === 'standard'
      ? [false, false] : [true, true], mode + ' shows the live process only when its grouping keeps the body open');
  }
  const compactFolds = policy.apply(buildEntries(live.map(r => Object.assign({}, r)), { running: true }), { mode: 'compact', timing: 'completion' }, {}, [], true);
  const standardFolds = policy.apply(buildEntries(live.map(r => Object.assign({}, r)), { running: true }), { mode: 'standard', timing: 'completion' }, {}, [], true);
  const compactEntries = buildEntries(live.map(r => Object.assign({}, r)), { running: true });
  const standardEntries = buildEntries(live.map(r => Object.assign({}, r)), { running: true });
  assert.deepEqual(compactEntries.filter(e => e.kind === 'processGroup').map(g => compactFolds[g.key]), [false, false], 'compact local disclosure starts closed');
  assert.deepEqual(standardEntries.filter(e => e.kind === 'processGroup').map(g => standardFolds[g.key]), [false, false], 'standard local disclosure starts closed');
  // 已结束：compact/standard/detailed 自动折叠回合行；verbose 永不折叠且永远平铺
  for (const [mode, turnOpen] of [['compact', false], ['standard', false], ['detailed', false], ['verbose', true]]) {
    const entries = buildEntries(done.map(r => Object.assign({}, r)), {});
    const folds = policy.apply(entries, { mode, timing: 'completion' }, {}, [], true);
    const turn = entries.find(e => e.kind === 'turnProcess');
    assert.equal(folds[turn.key], turnOpen, mode + ' 回合行默认状态');
    const groups = entries.filter(e => e.kind === 'processGroup');
    assert.deepEqual(groups.map(g => g.processBodyCapped), mode === 'verbose' ? [false, false] : [true, true],
      mode + ' preserves its process-container scrolling after duplicate headings are hidden');
  }
});

test('collapse timing applies to every mode and compact hides settled reasoning preview', () => {
  for (const mode of ['compact', 'standard', 'detailed', 'verbose']) {
    const rows = [{kind:'turnProcess',key:'turn'}];
    const completion = policy.apply(rows, {mode,timing:'completion'}, {}, [], true);
    assert.equal(completion.turn, mode === 'verbose', mode + ' completion behavior');
    const deferredRows = [{kind:'turnProcess',key:'turn'}];
    const deferred = policy.apply(deferredRows, {mode,timing:'next-input'}, {}, [], true);
    assert.equal(deferred.turn, true, mode + ' keeps latest turn open with next-input timing');
    const withNextInput = [{kind:'turnProcess',key:'turn'},{kind:'user',key:'later'}];
    assert.equal(policy.apply(withNextInput, {mode,timing:'next-input'}, deferred, deferredRows, false).turn,
      mode === 'verbose', mode + ' folds on next input when foldCompletedTurns is enabled');
  }

  const presetRows = [group({running:false,completed:true})];
  const presetFolds = policy.apply(presetRows,{mode:'standard',timing:'completion',agentPreset:'ptc'},{},[],true);
  const standardRows = [group({running:false,completed:true})];
  const standardFolds = policy.apply(standardRows,{mode:'standard',timing:'completion',agentPreset:'standard'},{},[],true);
  assert.deepEqual(presetFolds,standardFolds,'Agent preset does not select the transcript presentation mode');
  assert.equal(presetRows[0].processBodyCapped,standardRows[0].processBodyCapped);

  const reasoning = text => ({kind:'processGroup',key:'r',running:false,completed:true,children:[
    {kind:'reasoning',key:'reasoning',preview:text,running:false}
  ]});
  for (const mode of ['compact', 'standard', 'detailed', 'verbose']) {
    const rows = [reasoning('Reasoning preview')];
    policy.apply(rows,{mode,timing:'completion'},{},[],true);
    assert.equal(rows[0].children[0].showPreview, mode !== 'compact', mode + ' settled reasoning preview policy');
  }
});

test('reasoning stays expanded for the full live turn and collapses when it settles', () => {
  for (const mode of ['compact', 'standard', 'detailed', 'verbose']) {
    const live = [group({running:false,turnRunning:true, children:[
      {kind:'reasoning',key:'thought',preview:'Live thought',running:false}
    ]})];
    const liveFolds = policy.apply(live, {mode,timing:'completion'}, {}, [], true);
    assert.equal(liveFolds.thought, true, mode + ' keeps thought expanded while its turn is active');

    const done = [group({running:false,turnRunning:false,completed:true,children:[
      {kind:'reasoning',key:'thought',preview:'Settled thought',running:false}
    ]})];
    const doneFolds = policy.apply(done, {mode,timing:'completion'}, liveFolds, live, false);
    assert.equal(doneFolds.thought, false, mode + ' collapses thought when its turn ends');

    const manuallyExpanded = Object.assign({}, doneFolds, {thought:true});
    const rerendered = [group({running:false,turnRunning:false,completed:true,children:[
      {kind:'reasoning',key:'thought',preview:'Settled thought',running:false}
    ]})];
    assert.equal(policy.apply(rerendered, {mode,timing:'completion'}, manuallyExpanded, done, false).thought,
      true, mode + ' preserves a user reopening settled thought');
  }
});
