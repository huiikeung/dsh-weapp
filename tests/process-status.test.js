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
test('all status styles animate the DSH whale through the same selected text palette', () => {
  const template=fs.readFileSync(path.join(__dirname,'../miniprogram/pages/session/session.wxml'),'utf8');
  assert.match(template,/\{\{runPhrase\}\}\{\{ui\['，用时'\]\}\} \{\{runElapsedText\}\}…/);
  assert.match(template,/<view class="status-tail status-tail-\{\{statusAppearance\}\} \{\{theme === 'dark' \? 'status-tail-dark' : 'status-tail-light'\}\}" style="\{\{theme === 'dark' \? statusDarkTailAnimationStyle : statusLightTailAnimationStyle\}\}"><image class="status-tail-image" mode="aspectFit" src="\/assets\/icons\/dsh-running-whale\.png" style="filter:\{\{theme === 'dark' \? statusDarkTailFilter : statusLightTailFilter\}\}"\/>/);
  const css=fs.readFileSync(path.join(__dirname,'../miniprogram/styles/status-appearance.wxss'),'utf8');
  assert.match(css,/\.status-tail\s*\{[^}]*width:36rpx[^}]*height:36rpx/);
  assert.match(css,/\.status-tail-image\s*\{[^}]*width:28rpx[^}]*height:28rpx/);
  const preview=fs.readFileSync(path.join(__dirname,'../miniprogram/pages/settings/settings.wxml'),'utf8');
  assert.match(preview,/class="status-tail status-tail-\{\{item\.id\}\} \{\{theme === 'dark' \? 'status-tail-dark' : 'status-tail-light'\}\}" style="\{\{theme === 'dark' \? item\.darkTailAnimationStyle : item\.lightTailAnimationStyle\}\}"/);
  assert.match(css,/@keyframes statusTailNeonHue[\s\S]*?hue-rotate\(82deg\)/);
  assert.match(css,/@keyframes statusTailClassicHue[\s\S]*?hue-rotate\(360deg\)/);
  assert.match(css,/@keyframes statusTailTerminalLight[\s\S]*?brightness\(83%\)/);
  assert.match(css,/@keyframes statusTailTerminalDark[\s\S]*?brightness\(130%\)/);
  for(const choice of appearance.choices()) {
    assert.equal(choice.lightTailAnimationStyle.match(/animation-duration:[^;]+/)[0],choice.lightStyle.match(/animation-duration:[^;]+/)[0],choice.id);
    assert.equal(choice.darkTailAnimationStyle.match(/animation-duration:[^;]+/)[0],choice.darkStyle.match(/animation-duration:[^;]+/)[0],choice.id);
    assert.equal(choice.lightTailAnimationStyle.match(/animation-direction:[^;]+/)[0],choice.lightStyle.match(/animation-direction:[^;]+/)[0],choice.id);
    assert.equal(choice.darkTailAnimationStyle.match(/animation-direction:[^;]+/)[0],choice.darkStyle.match(/animation-direction:[^;]+/)[0],choice.id);
  }
  const simple=appearance.choices().find(choice=>choice.id==='original');
  assert.equal(simple.light[0],'rgb(52.4,93.7,186.2)');
  assert.equal(simple.dark[0],'rgb(125.15,153.8,222.5)');
  assert.match(simple.lightTailFilter,/invert\(0\.634\).*hue-rotate\(185\.7deg\)/);
  assert.match(simple.darkTailFilter,/invert\(0\.431\).*hue-rotate\(184\.5deg\)/);
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
  // This is the 28x28, 60-frame APNG used by the DSH desktop client.
  const whale=fs.readFileSync(path.join(__dirname,'../miniprogram/assets/icons/dsh-running-whale.png'));
  assert.equal(whale.subarray(1,4).toString(),'PNG');
  assert.equal(whale.readUInt32BE(16),28);assert.equal(whale.readUInt32BE(20),28);
  let chunkOffset=8,animationFrames=0,animationDuration=0;
  while(chunkOffset<whale.length){
    const size=whale.readUInt32BE(chunkOffset),type=whale.toString('ascii',chunkOffset+4,chunkOffset+8);
    if(type==='acTL') animationFrames=whale.readUInt32BE(chunkOffset+8);
    if(type==='fcTL') animationDuration+=whale.readUInt16BE(chunkOffset+28)/(whale.readUInt16BE(chunkOffset+30)||100)*1000;
    chunkOffset+=size+12;
  }
  assert.equal(animationFrames,60);assert.equal(animationDuration,3000);
  for(const choice of appearance.choices()) assert.notEqual(choice.lightTailFilter,choice.darkTailFilter,choice.id);
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
