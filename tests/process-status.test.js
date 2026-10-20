const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const protocol = require('../miniprogram/utils/protocol');
const { buildEntries } = require('../miniprogram/utils/conversation-workflow');
const appearance = require('../miniprogram/utils/status-appearance');
const procIcon = require('../miniprogram/utils/proc-icon-style');
function events(reason) { return [
  { seq: 1, time: 1000, type: 'user/message', data: { content: '检查文件' } },
  { seq: 2, time: 1001, type: 'turn/start', data: { turn: 1 } },
  { seq: 3, time: 1002, type: 'assistant/message', data: { turn: 1, message: { content: [{ type: 'reasoning', text: '检查' }, { type: 'tool-call', id: 'c', name: 'read_file', arguments: { path: 'a.js' } }] } } },
  { seq: 4, time: 1003, type: 'tool/result', data: { turn: 1, message: { source: { callId: 'c' }, content: [{ type: 'tool-result', content: [{type:'text',text:'ok'}] }] } } },
  { seq: 5, time: 1004, type: 'assistant/message', data: { turn: 1, message: { content: [{ type: 'text', text: '检查完毕' }] } } },
  { seq: 6, time: 1005, type: 'turn/end', data: { turn: 1, reason: { kind: reason } } }
]; }
for (const [reason,title] of [['completed','已完成'],['aborted','已停止'],['interrupted','已停止'],['error','执行失败'],['max-tokens','执行失败']]) {
  test('history and live turn outcome: ' + reason, () => {
    const raw = events(reason);
    const historical = buildEntries(protocol.buildRows(raw, 's'));
    assert.equal(historical[1].title, title);
    assert.equal(historical[1].completed, title === '已完成');
    const agg = protocol.newAggregator();
    raw.forEach(e => protocol.applyEvent(agg, protocol.normalizeRawEvent(e, 's')));
    assert.deepEqual(buildEntries(agg.rows), historical);
    assert.equal(historical.at(-1).text, '检查完毕');
  });
}
test('a new user turn cannot reactivate an older completed process', () => {
  const rows = protocol.buildRows(events('completed'), 's');
  rows.push({kind:'user',key:'u-new',text:'继续'});
  const group = buildEntries(rows,{running:true}).find(e=>e.kind==='processGroup');
  assert.equal(group.running,false);
  assert.equal(group.title,'已完成');
});
test('disconnect without a final answer is not success', () => {
  const rows = [{kind:'assistant',key:'a',reasoning:'准备读取',tools:[{callId:'c',name:'read_file',status:'running'}]}];
  const group = buildEntries(rows,{running:false,completedEntryKey:'a'})[0];
  assert.equal(group.completed,false);
  assert.equal(group.children[1].tools[0].waiting,true);
});
test('an interrupted pending tool no longer says waiting', () => {
  const rows = protocol.buildRows(events('aborted').filter(e=>![4,5].includes(e.seq)), 's');
  const group = buildEntries(rows)[1];
  assert.equal(group.title,'已停止');
  assert.equal(group.children[1].tools[0].waiting,false);
  assert.equal(group.children[1].tools[0].statusText,'已中断');
});
test('plain completed answers have a completion header', () => {
  const rows = protocol.buildRows(events('completed').filter(e=>![3,4].includes(e.seq)), 's');
  assert.equal(buildEntries(rows)[1].title,'已完成');
});
test('command settlement on first observed event is retained', () => {
  const rows = protocol.buildRows([{seq:1,type:'command/completed',data:{commandId:'c',name:'bash'}}], 's');
  assert.equal(rows[0].text,'已完成');
  assert.equal(buildEntries(rows)[0].title,'已完成');
});
test('desktop tool categories have paired light and dark assets', () => {
  const names = ['read_file','grep','web_search','bash','apply_patch','run_code','spawn_agent','list_agents','update_plan','ask_user','schedule_add','create_goal','cordis_install','job_list','workflow','custom_tool'];
  const icons = names.map(protocol.toolIconFile);
  assert.equal(new Set(icons).size,names.length);
  for (const icon of icons) for (const file of [icon,icon.replace('.svg','-dark.svg')]) {
    const svg = fs.readFileSync(path.join(__dirname,'../miniprogram/assets/icons',file),'utf8');
    assert.match(svg,/<svg/); assert.doesNotMatch(svg,/undefined|currentColor/);
  }
});
test('style choice persists, invalid values fall back and storage failures surface', () => {
  let stored; global.wx = { getStorageSync:()=>stored, setStorageSync:(key,value)=>{ assert.equal(key,appearance.KEY);stored=value; } };
  try {
    assert.equal(appearance.read(),'classic');
    for (const item of appearance.OPTIONS) { appearance.save(item.id);assert.equal(appearance.read(),item.id);assert.equal(appearance.view(item.id).statusAppearanceLabel,item.label); }
    stored='invalid';assert.equal(appearance.read(),'classic');
    wx.setStorageSync=()=>{throw Error('storage full');};assert.throws(()=>appearance.save('neon'));
  } finally { delete global.wx; }
});
test('execution icon choice persists, defaults to cells, invalid values fall back and storage failures surface', () => {
  let stored; global.wx = { getStorageSync:()=>stored, setStorageSync:(key,value)=>{ assert.equal(key,procIcon.KEY);assert.equal(key,'procIconStyle');stored=value; } };
  try {
    assert.equal(procIcon.read(),'cells');
    assert.equal(procIcon.OPTIONS[0].id,'cells');
    assert.equal(procIcon.OPTIONS.find(item=>item.id==='cells').file,'');
    assert.equal(procIcon.view('cells').procIconFile,'');
    for (const item of procIcon.OPTIONS) {
      procIcon.save(item.id);assert.equal(procIcon.read(),item.id);
      const view=procIcon.view(item.id);assert.equal(view.procIconStyle,item.id);assert.equal(view.procIconLabel,item.label);assert.equal(view.procIconFile,item.file);
    }
    stored='invalid';assert.equal(procIcon.read(),'cells');
    wx.setStorageSync=()=>{throw Error('storage full');};assert.throws(()=>procIcon.save('terra'));
  } finally { delete global.wx; }
});
test('all styles preserve status phrases and use the official four-second contour loop', () => {
  const template=fs.readFileSync(path.join(__dirname,'../miniprogram/pages/session/session.wxml'),'utf8');
  assert.match(template,/\{\{runPhrase\}\}\{\{ui\['，用时'\]\}\} \{\{runElapsedText\}\}…/);
  assert.match(template,/<image class="status-tail-image" mode="aspectFit" src="\/assets\/icons\/official-sway-\{\{theme === 'dark' \? 'dark' : 'light'\}\}\.gif"\/>/);
  const css=fs.readFileSync(path.join(__dirname,'../miniprogram/styles/status-appearance.wxss'),'utf8');
  assert.doesNotMatch(css,/officialTailSway|status-tail-atlas|transform:translate/);
  assert.match(template,/class="status-tail-image" mode="aspectFit"/);
  const readGif=name=>{
    const gif = fs.readFileSync(path.join(__dirname,'../miniprogram/assets/icons/'+name));
    assert.equal(gif.subarray(0,6).toString(),'GIF89a',name);
    const gct=gif[10]&0x80?3*(1<<((gif[10]&7)+1)):0;
    let at=13+gct, frames=0, duration=0;
    while (at < gif.length && gif[at] !== 0x3b) {
      if (gif[at] === 0x21) {
        const type=gif[at+1]; at+=2;
        if(type===0xf9) duration+=gif.readUInt16LE(at+2)*10;
        while(gif[at]) at+=gif[at]+1;
        at++;
      } else {
        assert.equal(gif[at],0x2c);frames++;
        assert.equal(gif.readUInt16LE(at+1),0);assert.equal(gif.readUInt16LE(at+3),0);
        at+=10;at++;
        while(gif[at]) at+=gif[at]+1;
        at++;
      }
    }
    return { width: gif.readUInt16LE(6), height: gif.readUInt16LE(8), frames, duration };
  };
  // Official sway keeps its established 40 x 40 / 96-frame contour loop.
  for (const mode of ['light','dark']) {
    const gif=readGif('official-sway-'+mode+'.gif');
    assert.equal(gif.width,40);assert.equal(gif.height,40);assert.equal(gif.frames,96);assert.equal(gif.duration,4000);
  }
  // Execution icons ship as 32 x 32 / 72-frame GIFs on the same 4-second loop.
  for (const choice of procIcon.OPTIONS.filter(item=>item.file)) for (const mode of ['light','dark']) {
    const name=choice.file+'-'+mode+'.gif', gif=readGif(name);
    assert.equal(gif.width,32,name);assert.equal(gif.height,32,name);
    assert.equal(gif.frames,72,name);assert.equal(gif.duration,4000,name);
  }
  for(const choice of appearance.choices()){assert.match(choice.lightStyle,/linear-gradient/);assert.match(choice.darkStyle,/linear-gradient/);}
});

test('statistics and tool summaries stay in their label rows', () => {
  const wxml=fs.readFileSync(path.join(__dirname,'../miniprogram/pages/session/session.wxml'),'utf8');
  const header=wxml.slice(wxml.indexOf('<view class="process-head"'),wxml.indexOf('<view class="process-hairline"'));
  assert.ok(header.indexOf('process-summary') < header.indexOf('event-spacer'));
  const tool=wxml.slice(wxml.indexOf('<view class="tool-line-1"'),wxml.indexOf('<image class="event-chevron',wxml.indexOf('<view class="tool-line-1"')));
  assert.ok(tool.indexOf('tool-note') < tool.indexOf('</view>'));
});
