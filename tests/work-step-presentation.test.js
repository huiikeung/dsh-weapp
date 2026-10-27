const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const policy=require('../miniprogram/pages/session/utils/work-step-presentation');
const protocol=require('../miniprogram/utils/protocol');
const {buildEntries}=require('../miniprogram/pages/session/utils/conversation-workflow');
const group=(extra)=>({kind:'processGroup',key:'g',running:true,completed:false,children:[],...extra});
test('four work-step modes map to distinct disclosure, activity and reasoning policies',()=>{
 const expected={
  compact:{open:false,headerHidden:false,detail:'',preview:false,summary:false,runningChevron:true,subprocesses:false},
  standard:{open:true,headerHidden:false,detail:'Inspect repository',preview:true,summary:true,runningChevron:true,subprocesses:false},
  detailed:{open:true,headerHidden:false,detail:'Inspect repository',preview:true,summary:true,runningChevron:false,subprocesses:true},
  verbose:{open:true,headerHidden:false,detail:'Inspect repository',preview:true,summary:true,runningChevron:false,subprocesses:true}
 };
 for(const mode of ['compact','standard','detailed','verbose']){
  const rows=[group({activityDetail:'Inspect repository',children:[{kind:'reasoning',key:'r',running:false}]})];
  const folds=policy.apply(rows,{mode}, {}, [],true);
  assert.equal(folds.g,expected[mode].open,mode+' initial disclosure');
  assert.equal(folds.r,true,mode+' reasoning starts as an open, bounded reading card');
  assert.equal(rows[0].headerHidden,expected[mode].headerHidden,mode+' activity heading visibility');
  assert.equal(rows[0].forceOpen,mode==='detailed');
  assert.equal(rows[0].runningChevron,expected[mode].runningChevron,mode+' running disclosure icon');
  assert.equal(rows[0].liveDetail,expected[mode].detail,mode+' live detail');
  assert.equal(rows[0].showProcessSummary,expected[mode].summary,mode+' running summary');
  assert.equal(rows[0].showSubprocesses,expected[mode].subprocesses,mode+' subprocess visibility');
  assert.equal(rows[0].children[0].previewVisible,expected[mode].preview,mode+' settled reasoning preview');
 }
});
test('only detailed and fully expanded modes show live subprocess rows by default',()=>{
 for(const mode of ['compact','standard','detailed','verbose']){
  const rows=[group({children:[
   {kind:'narration',key:'narration'},
   {kind:'reasoning',key:'reason',running:false},
   {kind:'toolBundle',key:'bundle',tools:[{key:'tool'}]},
   {kind:'context',key:'context'},
   {kind:'status',key:'status'}
  ]})];
  const folds=policy.apply(rows,{mode},{},[],true);
  assert.equal(!!folds.g,['standard','detailed','verbose'].includes(mode),mode+' process body');
  assert.equal(rows[0].children.find(child=>child.kind==='narration').visible,true,mode+' keeps narration at the main level');
  assert.equal(rows[0].children.find(child=>child.kind==='reasoning').visible,true,mode+' keeps reasoning at the main level');
  assert.equal(rows[0].children.find(child=>child.kind==='toolBundle').visible,['detailed','verbose'].includes(mode),mode+' tool subprocess visibility');
  assert.equal(rows[0].children.find(child=>child.kind==='status').visible,['detailed','verbose'].includes(mode),mode+' status subprocess visibility');
  assert.equal(!!folds.tool,false,mode+' keeps tool arguments/results collapsed by default');
  assert.equal(!!folds.context,false,mode+' keeps context body collapsed by default');
 }
 const wxml=fs.readFileSync(path.join(__dirname,'../miniprogram/pages/session/session.wxml'),'utf8');
 assert.match(wxml,/wx:if="\{\{node\.visible !== false\}\}"/,'hidden subprocess rows are excluded by the template');
 assert.match(wxml,/item\.showCommandDetail && item\.commandDetail/,'root command details follow the subprocess visibility policy');
});
test('fully expanded process headers keep their completion disclosure arrow and tap handler',()=>{
 const wxml=fs.readFileSync(path.join(__dirname,'../miniprogram/pages/session/session.wxml'),'utf8');
 const header=wxml.slice(wxml.indexOf('class="process-head"'),wxml.indexOf('class="process-hairline"'));
 assert.match(header,/bindtap="\{\{item\.expandable && !item\.forceOpen \? 'toggleFold' : ''\}\}"/);
 assert.match(header,/class="command-chevron \{\{item\.completed \? 'completed-chevron' : ''\}\} \{\{item\.mode === 'verbose' \? 'process-verbose-chevron' : ''\}\}/);
 const css=fs.readFileSync(path.join(__dirname,'../miniprogram/pages/session/session.wxss'),'utf8');
 assert.match(css,/\.process-verbose-chevron\s*\{[^}]*opacity:\s*\.65/);
});
test('compact and standard briefly swap the loader for a leading arrow on tap',()=>{
 const wxml=fs.readFileSync(path.join(__dirname,'../miniprogram/pages/session/session.wxml'),'utf8');
 assert.match(wxml,/item\.showProcessSummary && item\.summary/);
 assert.match(wxml,/hover-class="\{\{item\.running && item\.runningChevron \? 'process-running-head-hover'/);
 assert.match(wxml,/hover-stay-time="120"/);
 assert.match(wxml,/item\.running && item\.expandable && item\.runningChevron\}\}" class="command-chevron process-running-chevron"/);
 assert.doesNotMatch(wxml,/folds\[item\.key\][^\n]*process-running-chevron/);
 const css=fs.readFileSync(path.join(__dirname,'../miniprogram/pages/session/session.wxss'),'utf8');
 assert.match(css,/\.process-block\.running > \.process-body\s*\{\s*order:0;/);
 assert.match(css,/\.process-block\.running > \.process-head\s*\{\s*order:2;/);
 assert.doesNotMatch(css,/\.process-mode-(?:compact|standard)\.running > \.process-head/);
 assert.match(css,/\.process-running-head-hover \.proc-loader\s*\{\s*opacity:0/);
 assert.match(css,/\.process-running-head-hover \.process-running-chevron\s*\{\s*opacity:\.65/);
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
test('standard auto-opens the main execution summary but hides subprocesses until detailed mode',()=>{
 const live=[group({activityDetail:'Inspect repository',children:[
  {kind:'narration',key:'narration',text:'Checking files'},
  {kind:'reasoning',key:'reason',text:'Inspecting the relevant code'},
  {kind:'toolBundle',key:'bundle',tools:[{key:'tool'}]},
  {kind:'context',key:'context'}
 ]})];
 const liveFolds=policy.apply(live,{mode:'standard',timing:'completion'},{},[],true);
 assert.equal(liveFolds.g,true,'standard opens the main execution content automatically');
 assert.equal(live[0].children.find(child=>child.kind==='narration').visible,true);
 assert.equal(live[0].children.find(child=>child.kind==='reasoning').visible,true);
 assert.equal(live[0].children.find(child=>child.kind==='toolBundle').visible,false,'tool subprocess rows stay hidden');
 assert.equal(live[0].children.find(child=>child.kind==='context').visible,false,'context subprocess rows stay hidden');
 assert.equal(live[0].liveDetail,'Inspect repository');
 assert.equal(policy.apply(live,{mode:'standard',timing:'completion'},{g:false},live,false).g,false,'the expanded summary can still be manually folded');

 const done=[group({running:false,completed:true,children:live[0].children})];
 assert.equal(policy.apply(done,{mode:'standard',timing:'completion'},{g:true},live,false).g,false,'completion timing collapses the finished group');
 assert.equal(policy.apply(done,{mode:'standard',timing:'next-input'},{g:true},live,false).g,true,'next-input timing keeps it expanded until the next user message');
});
test('manual disclosure survives ticks and reopening a completed turn',()=>{
 assert.equal(policy.apply([group()],{mode:'detailed'},{g:false},[group()],false).g,false);
 const reasoningGroup=group({children:[{kind:'reasoning',key:'reason',running:false}]});
 assert.equal(policy.apply([reasoningGroup],{mode:'detailed'},{reason:false},[],false).reason,false);
 const done=()=>group({running:false,completed:true});
 assert.equal(policy.apply([done()],{mode:'detailed'},{g:true},[done()],false).g,true);
 assert.equal(policy.apply([group({running:false,failed:true})],{mode:'compact'},{},[],false).g,true);
});
test('fully expanded matches detailed subprocess disclosure and stays open after completion',()=>{
 const live=group({activityDetail:'reading',children:[{kind:'reasoning',key:'reason',running:true}]});
 const liveFolds=policy.apply([live],{mode:'detailed',timing:'completion'},{},[],true);
 assert.equal(live.headerHidden,false,'the active status heading stays visible in detailed mode');
 assert.equal(live.forceOpen,true);
 assert.equal(live.liveDetail,'reading');
 assert.equal(live.children[0].previewVisible,true,'streaming reasoning previews remain visible in compact-capable modes');

 const wxml=fs.readFileSync(path.join(__dirname,'../miniprogram/pages/session/session.wxml'),'utf8');
 const css=fs.readFileSync(path.join(__dirname,'../miniprogram/pages/session/session.wxss'),'utf8');
 assert.match(wxml,/wx:if="\{\{!item\.headerHidden\}\}" class="process-head"/,'the current activity heading is rendered');
 assert.match(css,/\.process-block\.running > \.process-body\s*\{\s*order:0;/);
 assert.match(css,/\.process-block\.running > \.process-head\s*\{\s*order:2;/,'the active heading sits after process detail');

 const done=group({running:false,completed:true,children:live.children});
 const doneFolds=policy.apply([done],{mode:'detailed',timing:'completion'},liveFolds,[live],false);
 assert.equal(done.headerHidden,false);
 assert.equal(done.forceOpen,false);
 assert.equal(doneFolds.g,false,'the process collapses only after the enclosing turn ends');

 const verboseLive=group({activityDetail:'reading',children:[
  {kind:'reasoning',key:'verbose-reason',running:true},
  {kind:'toolBundle',key:'verbose-bundle',tools:[{key:'verbose-tool'}]},
  {kind:'context',key:'verbose-context'}
 ]});
 const verboseFolds=policy.apply([verboseLive],{mode:'verbose',timing:'completion'},{},[],true);
 assert.equal(verboseFolds.g,true,'fully expanded starts with the process open');
 assert.equal(verboseFolds['verbose-tool'],false,'command bodies are not auto-expanded');
 assert.equal(verboseFolds['verbose-context'],false,'context bodies are not auto-expanded');
 assert.equal(verboseLive.liveDetail,'reading','the active activity label remains visible');

 const verboseDone=group({running:false,completed:true,title:'已完成',children:verboseLive.children});
 const completedFolds=policy.apply([verboseDone],{mode:'verbose',timing:'completion'},verboseFolds,[verboseLive],false);
 assert.equal(completedFolds.g,true,'completion does not collapse the process group');
 assert.equal(verboseDone.title,'已完成','the finished state remains clear while its details stay open');

 const manuallyCollapsed=policy.apply([verboseDone],{mode:'verbose',timing:'completion'},{g:false},[verboseDone],false);
 assert.equal(manuallyCollapsed.g,false,'manual folding is still allowed');
 const stillCollapsed=policy.apply([verboseDone],{mode:'verbose',timing:'completion'},manuallyCollapsed,[verboseDone],false);
 assert.equal(stillCollapsed.g,false,'later projections respect a manual fold');
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
test('one turn keeps every model step and command status in one process group until turn end',()=>{
 const rows=[
  {kind:'user',key:'u',text:'修复页面',turn:1},
  {kind:'assistant',key:'a1',turn:1,text:'先确认标题结构',reasoning:'检查模板',events:[{kind:'think',text:'检查模板'},{kind:'text',text:'先确认标题结构'},{kind:'tool',callId:'read'}],tools:[{key:'t1',callId:'read',name:'read',status:'done',argumentsText:'{"path":"page.wxml"}',resultText:'标题结构'}]},
  {kind:'status',key:'cmd-1',turn:1,title:'code',phase:'command/completed',text:'已完成'},
  {kind:'assistant',key:'a2',turn:1,text:'再应用修改',events:[{kind:'text',text:'再应用修改'},{kind:'tool',callId:'edit'}],tools:[{key:'t2',callId:'edit',name:'edit',status:'done',argumentsText:'{}',resultText:'已修改'}]},
  {kind:'assistant',key:'a2b',turn:1,text:'检查修改结果'},
  {kind:'assistant',key:'a3',turn:1,text:'问题已修复。',blocks:[{type:'para',html:'<p>问题已修复。</p>'}],tools:[]}
 ];
 const live=buildEntries(rows,{running:true});
 const liveGroups=live.filter(entry=>entry.kind==='processGroup');
 assert.equal(liveGroups.length,1);
 assert.equal(liveGroups[0].completed,false);
 assert.notEqual(liveGroups[0].title,'已完成');
 assert.deepEqual(liveGroups[0].children.map(child=>child.kind),['reasoning','narration','toolBundle','status','narration','toolBundle','narration']);
 assert.equal(liveGroups[0].children.find(child=>child.kind==='status').text,'命令已完成');
 assert.equal(live.filter(entry=>entry.kind==='assistant').length,1,'only the final answer is a standalone assistant message');

 rows.forEach(row=>{if(row.turn===1)row.turnClosed=true;});
 rows.at(-1).turnEndReason='completed';
 const done=buildEntries(rows);
 const groups=done.filter(entry=>entry.kind==='processGroup');
 assert.equal(groups.length,1);
 assert.equal(groups[0].completed,true);
 assert.equal(groups[0].title,'已完成');
});
test('plain intermediate assistant text is grouped only when turn metadata identifies its process',()=>{
 const tracked=buildEntries([
  {kind:'assistant',key:'step-1',turn:4,text:'准备检查文件'},
  {kind:'assistant',key:'step-2',turn:4,text:'检查完成，开始修改'},
  {kind:'assistant',key:'answer',turn:4,text:'已经修复。',turnClosed:true,turnEndReason:'completed'}
 ]);
 assert.deepEqual(tracked.map(row=>row.kind),['processGroup','assistant']);
 assert.deepEqual(tracked[0].children.map(node=>node.text),['准备检查文件','检查完成，开始修改']);
 assert.equal(tracked[0].completed,true);

 const legacy=buildEntries([
  {kind:'assistant',key:'legacy-1',text:'旧回复'},
  {kind:'assistant',key:'legacy-2',text:'最终回复'}
 ]);
 assert.deepEqual(legacy.map(row=>row.kind),['assistant','assistant']);
 assert.equal(legacy.some(row=>row.title==='已完成'),false);
});
test('assistant narration before a tool call stays inside the process group as a sibling of reasoning',()=>{
 const narration='The edit tool echoes whole files; let me switch to a precise patch script.';
 const rows=buildEntries([
  {kind:'assistant',key:'narration',turn:8,text:narration},
  {kind:'assistant',key:'tool-step',turn:8,tools:[{callId:'patch',name:'bash',status:'error',isError:true}],events:[{kind:'tool',callId:'patch'}]}
 ],{running:true});
 const groups=rows.filter(row=>row.kind==='processGroup');
 assert.equal(groups.length,1);
 assert.deepEqual(groups[0].children.map(child=>child.kind),['narration','toolBundle']);
 assert.equal(groups[0].children[0].text,narration);
 assert.equal(rows.some(row=>row.kind==='assistant'),false,'intermediate progress is not presented as a final reply');

 const sameStep=buildEntries([{kind:'assistant',key:'mixed',turn:9,text:narration,
  tools:[{callId:'patch',name:'bash',status:'running'}],
  events:[{kind:'text',text:narration},{kind:'tool',callId:'patch'}]
 }],{running:true});
 assert.deepEqual(sameStep[0].children.map(child=>child.kind),['narration','toolBundle']);
 assert.equal(sameStep.some(row=>row.kind==='assistant'),false);

 const legacy=buildEntries([
  {kind:'assistant',key:'legacy-narration',text:narration},
  {kind:'assistant',key:'legacy-tool',tools:[{callId:'patch',name:'bash',status:'running'}]}
 ],{running:true});
 assert.deepEqual(legacy[0].children.map(child=>child.kind),['narration','toolBundle']);
 assert.equal(legacy.some(row=>row.kind==='assistant'),false,'adjacent process activity is sufficient without model turn metadata');
});
test('tool and narration images survive as process children, and intermediate answers do not complete the turn',()=>{
 const rows=[
  {kind:'assistant',key:'a1',turn:2,text:'处理中：![图](https://example.test/a.png)',images:[{attachmentId:'assistant-image'}],tools:[{key:'t1',callId:'c1',name:'inspect',status:'done',resultText:'done',resultImages:[{attachmentId:'tool-image'}]}],blocks:[{type:'image',src:'https://example.test/a.png',imageState:'remote'}],events:[{kind:'text',text:'处理中：![图](https://example.test/a.png)'},{kind:'tool',callId:'c1'},{kind:'image',image:{attachmentId:'assistant-image'}}]},
  {kind:'assistant',key:'a2',turn:2,text:'中间答复',tools:[]},
  {kind:'status',key:'cmd-2',turn:2,phase:'command/completed',text:'已完成'}
 ];
 const group=buildEntries(rows,{running:true}).find(entry=>entry.kind==='processGroup');
 assert.ok(group);
 assert.equal(group.completed,false);
 assert.equal(group.children.find(child=>child.kind==='narration').blocks[0].type,'image');
 assert.equal(group.children.find(child=>child.kind==='narration' && child.images.length).images[0].attachmentId,'assistant-image');
 assert.equal(group.children.find(child=>child.kind==='narration').blocks[0].type,'image');
 assert.equal(group.children.find(child=>child.kind==='toolBundle').tools[0].resultImages[0].attachmentId,'tool-image');
 assert.ok(!buildEntries(rows,{running:true}).some(entry=>entry.title==='已完成'));
});
test('settings persistence validates modes and leaves failed writes visible to caller',()=>{
 let stored;global.wx={getStorageSync:()=>stored,setStorageSync:(key,v)=>{assert.equal(key,policy.KEY);stored=v;}};
 try{assert.deepEqual(policy.read(),{mode:'detailed',timing:'completion'});policy.save({mode:'verbose',timing:'next-input'});assert.equal(policy.read().mode,'verbose');assert.equal(policy.view(policy.read()).workStepTimingLabel,'下次有新消息时');wx.setStorageSync=()=>{throw Error('full')};assert.throws(()=>policy.save({mode:'compact'}));}finally{delete global.wx;}
});
