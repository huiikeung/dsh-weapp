const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const protocol = require('../miniprogram/utils/protocol');
const { buildEntries } = require('../miniprogram/pages/session/utils/conversation-workflow');
const { toolPresentation } = require('../miniprogram/pages/session/utils/tool-presentation');
const appearance = require('../miniprogram/pages/session/utils/status-appearance');
function fixture() {
  const agg = protocol.newAggregator(); let seq = 0;
  return { agg, push(type, data) { protocol.applyEvent(agg, protocol.normalizeRawEvent({ type, seq: ++seq, data }, 'session')); } };
}
function tools(agg) { return buildEntries(agg.rows, { running: true }).flatMap(e => (e.children || []).flatMap(c => c.tools || [])); }
test('desktop lifecycle hides anonymous preparation and updates the named activity in place', () => {
  const {agg, push} = fixture();
  push('assistant/live-chunk', {turn:1, chunk:{type:'tool-call-delta',id:'c',argumentsDelta:''}});
  assert.equal(tools(agg).length, 0);
  push('assistant/live-chunk', {turn:1, chunk:{type:'tool-call-delta',id:'c',name:'bash',argumentsDelta:'{"description":"检查文件'}});
  assert.equal(tools(agg)[0].actLabel, '运行命令');
  assert.equal(tools(agg)[0].actDetail, '检查文件');
  assert.equal(tools(agg)[0].statusText, '正在准备…');
  const key = tools(agg)[0].key;
  push('assistant/live-chunk', {turn:1, chunk:{type:'block-end',block:{type:'tool-call',id:'c',name:'bash',arguments:'{"description":"检查文件","command":"ls"}'}}});
  push('tool/call', {turn:1,callId:'c',name:'bash',arguments:'{"description":"检查文件","command":"ls"}'});
  assert.equal(tools(agg)[0].key, key);
  assert.equal(tools(agg)[0].statusText, '运行中');
  push('tool/result', {turn:1,message:{source:{callId:'c'},content:[{type:'text',text:'ok'}]}});
  assert.equal(tools(agg).length, 1);
  assert.equal(tools(agg)[0].statusText, '');
  assert.equal(tools(agg)[0].resultText, 'ok');
  assert.equal(tools(agg)[0].isCommand,true);
  assert.equal(tools(agg)[0].commandText,'ls');
  assert.equal(tools(agg)[0].commandLines[0].text,'ls');
});
test('a late result settles its original call instead of creating an unnamed tool row', () => {
  const {agg,push} = fixture();
  push('assistant/message',{turn:1,message:{content:[{type:'reasoning',text:'检查网页'},{type:'tool-call',id:'c',name:'web_fetch',arguments:{url:'https://example.test'}}]}});
  push('tool/call',{turn:1,callId:'c',name:'web_fetch',arguments:{url:'https://example.test'}});
  push('assistant/chunk',{turn:1,chunk:{type:'reasoning-delta',text:'继续分析'}});
  assert.equal(agg.rows.length,2);
  push('tool/result',{turn:1,message:{source:{callId:'c'},content:[{type:'text',text:'page content'}]}});
  assert.equal(agg.rows.flatMap(r=>r.tools||[]).length,1);
  assert.equal(agg.rows[0].tools[0].status,'done');
  assert.equal(agg.rows[1].tools.length,0);
  assert.equal(tools(agg)[0].actLabel,'读取网页');
  assert.equal(tools(agg)[0].actDetail,'https://example.test');
});
test('reused call identifiers in a later turn do not settle the earlier call', () => {
  const {agg,push}=fixture();
  push('tool/call',{turn:1,callId:'c',name:'read',arguments:{path:'a'}});
  push('tool/call',{turn:2,callId:'c',name:'write',arguments:{path:'b'}});
  push('tool/result',{turn:2,message:{source:{callId:'c'},content:[]}});
  assert.equal(agg.rows[0].tools[0].status,'running');
  assert.equal(agg.rows[1].tools[0].status,'done');
});
test('an uncorrelated result is generic and never invents a running task', () => {
  const {agg,push}=fixture();
  push('tool/result',{turn:1,message:{source:{callId:'orphan'},content:[]}});
  assert.equal(tools(agg)[0].actLabel,'工具调用');
  assert.equal(tools(agg)[0].waiting,false);
  assert.equal(toolPresentation('tool','').label,'工具调用');
});
test('assistant process blocks keep text/tool order and tool results retain image attachments',()=>{
  const {agg,push}=fixture();
  push('assistant/message',{turn:3,message:{content:[
    {type:'text',text:'先检查截图'},
    {type:'tool-call',id:'image-call',name:'inspect',arguments:{}},
    {type:'image',attachment:{attachmentId:'assistant-image',mediaType:'image/png',name:'screen.png'}}
  ]}});
  const assistant=agg.rows.find(row=>row.kind==='assistant');
  assert.deepEqual(assistant.events.map(item=>item.kind),['text','tool','image']);
  assert.equal(assistant.images[0].attachmentId,'assistant-image');
  push('tool/result',{turn:3,message:{source:{callId:'image-call'},content:[{type:'tool-result',content:[
    {type:'text',text:'检查完成'},
    {type:'image',attachment:{attachmentId:'tool-image',mediaType:'image/png',name:'result.png'}},
    {type:'file',attachment:{path:'output/report.md',name:'report.md'}}
  ]}]} });
  const tool=assistant.tools[0];
  assert.equal(tool.resultText,'检查完成');
  assert.equal(tool.resultImages[0].attachmentId,'tool-image');
  assert.equal(tool.resultAttachments.find(item=>item.kind==='file').path,'output/report.md');
  push('command/completed',{turn:3,commandId:'cmd-3',name:'bash'});
  assert.equal(agg.rows.find(row=>row.kind==='status').turn,3);
  assert.equal(buildEntries(agg.rows,{running:true}).find(row=>row.kind==='processGroup').completed,false);
  push('assistant/message',{turn:3,message:{content:[{type:'text',text:'截图已检查。'}]}});
  const group=buildEntries(agg.rows,{running:true}).find(row=>row.kind==='processGroup');
  assert.deepEqual(group.children.map(child=>child.kind),['narration','toolBundle','narration','status']);
  assert.equal(group.children[2].images[0].attachmentId,'assistant-image');
});
test('nested PTC calls remain in the process sequence with their outputs',()=>{
  const {agg,push}=fixture();
  push('tool/call',{turn:4,callId:'root',name:'run_code',arguments:{description:'分析代码',code:'run()'}});
  push('tool/ptc-dispatch-start',{turn:4,rootCallId:'root',parentCallId:'root',subCallId:'child-1',name:'read',arguments:{path:'src/app.js'}});
  push('tool/ptc-dispatch',{turn:4,rootCallId:'root',parentCallId:'root',subCallId:'child-1',name:'read',arguments:{path:'src/app.js'},content:[
    {type:'text',text:'源码'}, {type:'image',attachment:{attachmentId:'nested-image',mediaType:'image/png',name:'capture.png'}}
  ]});
  push('tool/ptc-dispatch-start',{turn:4,rootCallId:'root',parentCallId:'child-1',subCallId:'child-2',name:'grep',arguments:{pattern:'run'}});
  push('tool/ptc-dispatch',{turn:4,rootCallId:'root',parentCallId:'child-1',subCallId:'child-2',name:'grep',arguments:{pattern:'run'},content:[{type:'text',text:'匹配行'}]});
  push('tool/result',{turn:4,message:{source:{callId:'root'},content:[{type:'text',text:'完成'}]}});
  push('assistant/message',{turn:4,message:{content:[{type:'text',text:'已完成分析。'}]}});
  push('turn/end',{turn:4,reason:'completed'});

  const entries=buildEntries(agg.rows);
  const group=entries.find(row=>row.kind==='processGroup');
  const calls=group.children.flatMap(child=>child.tools||[]);
  assert.deepEqual(calls.map(tool=>tool.name),['run_code','read','grep']);
  assert.equal(calls[1].depth,1);
  assert.equal(calls[2].depth,2);
  assert.deepEqual(calls[1].branchTracks,[{key:'1',style:'left:-14rpx;'}]);
  assert.deepEqual(calls[2].branchTracks,[{key:'1',style:'left:-42rpx;'},{key:'2',style:'left:-14rpx;'}]);
  assert.equal(calls[1].resultImages[0].attachmentId,'nested-image');
  assert.equal(calls[2].resultText,'匹配行');
  const turn=entries.find(row=>row.kind==='turnProcess');
  assert.equal(group.summary,'');
  assert.equal(turn.expandedSummary,'3 次工具调用');
  const wxml=fs.readFileSync(require.resolve('../miniprogram/pages/session/session.wxml'),'utf8');
  assert.match(wxml,/class="tool-node \{\{tool\.isCommand \? 'command-node' : ''\}\}" style="\{\{tool\.indentStyle\}\}"/);
  assert.match(wxml,/class="tool-branch-track" style="\{\{track\.style\}\}"/);
});
test('simple status colors resolve the installed DSH light and dark theme tokens', () => {
  const mix=(a,b,w)=>a.map((n,i)=>Number((n*w+b[i]*(1-w)).toFixed(2)));
  const rgb=v=>'rgb('+v.join(',')+')';
  const style=appearance.selected('original');
  assert.equal(style.light[0],rgb(mix([65,118,230],[23,37,84],.7)));
  assert.equal(style.light[1],rgb(mix([65,118,230],[23,37,84],.3)));
  assert.equal(style.dark[0],rgb(mix([86,134,254],[173,178,184],.55)));
  assert.equal(style.dark[1],rgb(mix([147,197,253],[122,170,255],.65)));
});
test('status text stays lighter and its line box does not exceed the icon height', () => {
  const css=fs.readFileSync(require.resolve('../miniprogram/styles/status-appearance.wxss'),'utf8');
  const rule=css.match(/\.status-gradient\s*\{([^}]+)\}/)[1];
  assert.match(rule,/font-size:24rpx/);
  assert.match(rule,/font-weight:400/);
  assert.match(rule,/line-height:36rpx/);
  assert.match(css,/\.status-tail\s*\{[^}]*height:36rpx/);
});
