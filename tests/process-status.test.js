const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const protocol = require('../miniprogram/utils/protocol');
const { buildEntries } = require('../miniprogram/pages/session/utils/conversation-workflow');
const appearance = require('../miniprogram/pages/session/utils/status-appearance');
const settingsAppearance = require('../miniprogram/pages/settings/utils/status-appearance');
const procIcon = require('../miniprogram/pages/session/utils/proc-icon-style');
const statusTailAnimation = require('../scripts/generate-status-tail-animation.cjs');
function events(reason) { return [
  { seq: 1, time: 1000, type: 'user/message', data: { content: '检查文件' } },
  { seq: 2, time: 1001, type: 'turn/start', data: { turn: 1 } },
  { seq: 3, time: 1002, type: 'assistant/message', data: { turn: 1, message: { content: [{ type: 'reasoning', text: '检查' }, { type: 'tool-call', id: 'c', name: 'read_file', arguments: { path: 'a.js' } }] } } },
  { seq: 4, time: 1003, type: 'tool/result', data: { turn: 1, message: { source: { callId: 'c' }, content: [{ type: 'tool-result', content: [{type:'text',text:'ok'}] }] } } },
  { seq: 5, time: 1004, type: 'assistant/message', data: { turn: 1, message: { content: [{ type: 'text', text: '检查完毕' }] } } },
  { seq: 6, time: 1005, type: 'turn/end', data: { turn: 1, reason: { kind: reason } } }
]; }
function processGroup(entries) { return entries.find(entry => entry.kind === 'processGroup'); }
function turnProcess(entries) { return entries.find(entry => entry.kind === 'turnProcess'); }
for (const [reason,title] of [['completed','已完成'],['aborted','已停止'],['interrupted','已停止'],['error','执行失败'],['max-tokens','执行失败']]) {
  test('history and live turn outcome: ' + reason, () => {
    const raw = events(reason);
    const historical = buildEntries(protocol.buildRows(raw, 's'));
    assert.equal(turnProcess(historical).title, title);
    assert.equal(processGroup(historical).completed, title === '已完成');
    const agg = protocol.newAggregator();
    raw.forEach(e => protocol.applyEvent(agg, protocol.normalizeRawEvent(e, 's')));
    assert.deepEqual(buildEntries(agg.rows), historical);
    assert.equal(historical.at(-1).text, '检查完毕');
  });
}
test('a new user turn cannot reactivate an older completed process', () => {
  const rows = protocol.buildRows(events('completed'), 's');
  rows.push({kind:'user',key:'u-new',text:'继续'});
  const entries = buildEntries(rows,{running:true});
  const group = processGroup(entries);
  assert.equal(group.running,false);
  assert.equal(turnProcess(entries).title,'已完成');
});
test('disconnect without a final answer is not success', () => {
  const rows = [{kind:'assistant',key:'a',reasoning:'准备读取',tools:[{callId:'c',name:'read_file',status:'running'}]}];
  const group = processGroup(buildEntries(rows,{running:false,completedEntryKey:'a'}));
  assert.equal(group.completed,false);
  assert.equal(group.children[1].tools[0].waiting,true);
});
test('an interrupted pending tool no longer says waiting', () => {
  const rows = protocol.buildRows(events('aborted').filter(e=>![4,5].includes(e.seq)), 's');
  const entries = buildEntries(rows);
  const group = processGroup(entries);
  assert.equal(turnProcess(entries).title,'已停止');
  assert.equal(group.children[1].tools[0].waiting,false);
  assert.equal(group.children[1].tools[0].statusText,'已中断');
});
test('plain completed answers have a completion header', () => {
  const rows = protocol.buildRows(events('completed').filter(e=>![3,4].includes(e.seq)), 's');
  assert.equal(turnProcess(buildEntries(rows)).title,'已完成');
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
test('execution icon choice persists, defaults to the spinning ring, invalid values fall back and storage failures surface', () => {
  let stored; global.wx = { getStorageSync:()=>stored, setStorageSync:(key,value)=>{ assert.equal(key,procIcon.KEY);assert.equal(key,'procIconStyle');stored=value; } };
  try {
    assert.equal(procIcon.read(),'spin-ring');
    assert.equal(procIcon.OPTIONS[0].id,'spin-ring', 'the default style is listed first');
    assert.match(procIcon.OPTIONS[0].detail,/默认/,'the default is labelled as such');
    assert.equal('file' in procIcon.OPTIONS.find(item=>item.id==='cells'),false);
    assert.deepEqual(procIcon.view('spin-ring'),{procIconStyle:'spin-ring',procIconLabel:'旋转圆环'});
    for (const item of procIcon.OPTIONS) {
      procIcon.save(item.id);assert.equal(procIcon.read(),item.id);
      const view=procIcon.view(item.id);assert.equal(view.procIconStyle,item.id);assert.equal(view.procIconLabel,item.label);assert.equal('procIconFile' in view,false);
    }
    stored='invalid';assert.equal(procIcon.read(),'spin-ring');
    // 多元素图标必须是横向 flex 容器：漏了 display:flex 会让子元素竖排（typing-dots 就这样竖过）。
    const iconCss=fs.readFileSync(path.join(__dirname,'../miniprogram/styles/proc-icon.wxss'),'utf8');
    // styleId -> 承载子元素的根类
    const flexRoots={ 'pulse-ring':'proc-pulse', 'breathe-bars':'proc-breathe', 'typing-dots':'proc-typing', 'spin-ring':'proc-spin-ring' };
    for (const [id, root] of Object.entries(flexRoots)) {
      const inline=new RegExp('\\.'+root+'\\s*\\{[^}]*display:\\s*flex');
      const grouped=new RegExp('\\.'+root+'\\s*,[^{]*\\{[^}]*display:\\s*flex');
      assert.ok(inline.test(iconCss)||grouped.test(iconCss), id+' ('+root+') must lay its children out horizontally');
    }
    wx.setStorageSync=()=>{throw Error('storage full');};assert.throws(()=>procIcon.save('terra'));
  } finally { delete global.wx; }
});
// 鲸尾必须和文字同色，而且是「各端一致」的同色。
// 早先用 CSS filter 从纯黑染出颜色：一是关键帧之间按 filter 参数插值会串色，
// 二是 Chromium 与 WebKit 渲染 filter 的结果不同（iOS 上更亮更饱和），
// 于是出现「文字深绿、鲸尾薄荷绿」且只有苹果端不对。
// 现在鲸尾改为 mask 裁轮廓 + background-color 关键帧，颜色是普通色值，
// 与文字渐变同一套 sRGB 插值，误差应为 0（只剩 8 位取整）。
test('whale tail keyframes track the text palette between keyframes', () => {
  const result = statusTailAnimation.measure(120);
  assert.ok(result.worst <= 1, 'worst channel error must stay within rounding, got ' + result.worst.toFixed(2));
  assert.equal(result.rows.length, appearance.OPTIONS.length * 2);
  for (const row of result.rows) {
    assert.ok(row.maxError <= 1, row.style + ' ' + row.mode + ' deviates by ' + row.maxError);
  }
});

test('all status styles animate the DSH whale through the same selected text palette', () => {
  assert.deepEqual(settingsAppearance.OPTIONS,appearance.OPTIONS,'settings preview and live status use the same palettes');
  const template=fs.readFileSync(path.join(__dirname,'../miniprogram/pages/session/session.wxml'),'utf8');
  assert.match(template,/\{\{runPhrase\}\}\{\{ui\['，用时'\]\}\} \{\{runElapsedText\}\}…/);
  // 鲸尾是 mask 裁出来的色块（不是 image + filter），滚动时仍是同层合成，不会像 canvas 那样滞后。
  assert.match(template,/<view class="status-tail"><view class="status-tail-ink status-tail-\{\{statusAppearance\}\} \{\{theme === 'dark' \? 'status-tail-dark' : 'status-tail-light'\}\}" style="\{\{theme === 'dark' \? statusDarkTailAnimationStyle : statusLightTailAnimationStyle\}\}animation-delay:\{\{statusFlowDelay\}\}s;"\/>/);
  assert.doesNotMatch(template,/status-tail-image/);
  assert.doesNotMatch(template,/statusTailCanvas/);
  const css=fs.readFileSync(path.join(__dirname,'../miniprogram/styles/status-appearance.wxss'),'utf8');
  const sessionCss=fs.readFileSync(path.join(__dirname,'../miniprogram/pages/session/session.wxss'),'utf8');
  assert.match(sessionCss,/@import "\.\.\/\.\.\/styles\/status-tail-animation\.wxss"/);
  assert.match(css,/\.status-tail\s*\{[^}]*width:36rpx[^}]*height:36rpx/);
  const animationCss=fs.readFileSync(path.join(__dirname,'../miniprogram/styles/status-tail-animation.wxss'),'utf8');
  // 鲸尾轮廓来自内联 data URI 遮罩：WXSS 不涉及本地路径解析，iOS 的 WKWebView 也能用。
  assert.match(animationCss,/\.status-tail-ink\{[^}]*-webkit-mask-image:url\("data:image\/png;base64,/);
  assert.match(animationCss,/\.status-tail-ink\{[^}]*mask-image:url\("data:image\/png;base64,/);
  assert.match(animationCss,/\.status-tail-ink\{[^}]*width:28rpx[^}]*height:28rpx/);
  assert.equal(animationCss,statusTailAnimation.render(),'all per-stop image filters stay in sync with the selected text palettes');
  const preview=fs.readFileSync(path.join(__dirname,'../miniprogram/pages/settings/settings.wxml'),'utf8');
  assert.match(preview,/class="status-style-preview status-look-\{\{item\.id\}\}"><view class="status-tail"><canvas type="2d" id="statusPreviewCanvas-\{\{item\.id\}\}" class="status-tail-canvas" style="width:28rpx;height:28rpx;"><\/canvas><\/view>/);
  // 每个样式/主题都有关键帧，并带静态 filter 兜底（系统关掉动画时鲸尾仍有正确颜色）。
  for (const item of appearance.OPTIONS) {
    for (const [mode, suffix] of [['light', 'Light'], ['dark', 'Dark']]) {
      const name = 'statusTail' + item.id[0].toUpperCase() + item.id.slice(1) + suffix;
      // 关键帧动的是 background-color（普通色值），不再经过 filter 数学。
      assert.match(animationCss, new RegExp('@keyframes ' + name + '\\{0%\\{background-color:rgb\\('), item.id + ' ' + mode);
      assert.match(animationCss, new RegExp('\\.status-tail-ink\\.status-tail-' + item.id + '\\.status-tail-' + mode + '\\{animation-name:' + name + ';background-color:rgb\\('), item.id + ' ' + mode);
      assert.doesNotMatch(animationCss, new RegExp('@keyframes ' + name + '\\{[^}]*filter:'), item.id + ' ' + mode + ' must not tint through filters');
    }
  }
  for(const choice of appearance.choices()) {
    assert.equal(choice.lightTailAnimationStyle.match(/animation-duration:[^;]+/)[0],choice.lightStyle.match(/animation-duration:[^;]+/)[0],choice.id);
    assert.equal(choice.darkTailAnimationStyle.match(/animation-duration:[^;]+/)[0],choice.darkStyle.match(/animation-duration:[^;]+/)[0],choice.id);
    assert.equal(choice.lightTailAnimationStyle.match(/animation-direction:[^;]+/)[0],choice.lightStyle.match(/animation-direction:[^;]+/)[0],choice.id);
    assert.equal(choice.darkTailAnimationStyle.match(/animation-direction:[^;]+/)[0],choice.darkStyle.match(/animation-direction:[^;]+/)[0],choice.id);
  }
  const simple=appearance.choices().find(choice=>choice.id==='original');
  assert.equal(simple.light[0],'rgb(52.4,93.7,186.2)');
  assert.equal(simple.dark[0],'rgb(125.15,153.8,222.5)');
  // Keep one native image layer and enough source pixels for 3x iPhone screens.
  const whale=fs.readFileSync(path.join(__dirname,"../miniprogram/assets/icons/dsh-running-whale.png"));
  assert.equal(whale.subarray(1,4).toString(),"PNG");
  assert.equal(whale.readUInt32BE(16),84);assert.equal(whale.readUInt32BE(20),84);
  assert.equal(whale.readUInt8(24),8,"8-bit");assert.equal(whale.readUInt8(25),4,"gray + alpha mask");
  assert.ok(whale.length < 8192,"3x static mask stays compact");
  assert.equal(whale.includes(Buffer.from('acTL')),false,'the live image remains a static compositor-friendly mask');
  const glyph=fs.readFileSync(path.join(__dirname,'../miniprogram/styles/proc-icon.wxml'),'utf8');
  const procCss=fs.readFileSync(path.join(__dirname,'../miniprogram/styles/proc-icon.wxss'),'utf8');
  for (const choice of procIcon.OPTIONS) assert.ok(glyph.includes(`styleId === '${choice.id}'`) || choice.id === 'wave');
  assert.match(glyph,/wx:else class="proc-wave"/);
  for (const animation of ['procTerraSpin','procMorphShape','procGridPulse','procOrbitSpin','procRipple','procWave']) assert.match(procCss,new RegExp('@keyframes '+animation));
  assert.equal(fs.readdirSync(path.join(__dirname,'../miniprogram/assets/icons')).some(name=>name.startsWith('proc-icon-')),false);
  for(const choice of appearance.choices()){assert.match(choice.lightStyle,/linear-gradient/);assert.match(choice.darkStyle,/linear-gradient/);}
});

test('statistics and tool summaries stay in their label rows', () => {
  const wxml=fs.readFileSync(path.join(__dirname,'../miniprogram/pages/session/session.wxml'),'utf8');
  const header=wxml.slice(wxml.indexOf('<view class="process-head"'),wxml.indexOf('class="process-body '));
  assert.ok(header.indexOf('process-summary') < header.indexOf('event-spacer'));
  const tool=wxml.slice(wxml.indexOf('<view class="tool-line-1"'),wxml.indexOf('<image class="event-chevron',wxml.indexOf('<view class="tool-line-1"')));
  assert.ok(tool.indexOf('tool-note') < tool.indexOf('</view>'));
});
test('a failed turn surfaces the DSH failure verbatim for the error card', () => {
  const failure = { type: 'api_error', code: '1311', message: '[1311][当前订阅套餐暂未开放 GLM-5.3-FlashX权限]' };
  const raw = events('error');
  raw[raw.length - 1] = { seq: 6, time: 1005, type: 'turn/end', data: { turn: 1, reason: { kind: 'error', error: failure } } };
  const group = processGroup(buildEntries(protocol.buildRows(raw, 's')));
  assert.equal(group.failed, true);
  assert.equal(group.failureTitle, '本轮运行失败');
  assert.equal(group.failureMessage, '[1311][当前订阅套餐暂未开放 GLM-5.3-FlashX权限]');
  assert.equal(group.failureCode, '1311');
});
test('routable failure codes use the DSH wording and unmapped codes keep the raw message', () => {
  const row = code => [{ kind: 'assistant', key: 'a-' + code, turn: 1, turnClosed: true,
    turnEndReason: 'error', turnFailure: { message: 'raw provider text', code: code }, text: 'x', tools: [] }];
  const auth = processGroup(buildEntries(row('AUTH')));
  assert.equal(auth.failureMessage, 'API 密钥无效');
  assert.equal(auth.failureTitle, '本轮运行失败');
  const signedOut = processGroup(buildEntries(row('ACCOUNT_SIGNED_OUT')));
  assert.equal(signedOut.failureMessage, '任务已因退出 DeepSeek 登录而停止。');
  assert.equal(signedOut.failureTitle, '任务已停止');
  const quota = processGroup(buildEntries(row('ACCOUNT_QUOTA')));
  assert.equal(quota.failureMessage, '当前请求的额度已用尽');
  const other = processGroup(buildEntries(row('429')));
  assert.equal(other.failureMessage, 'raw provider text', 'unmapped codes keep the server message');
  assert.equal(other.failureCode, '429');
});
test('aborted and completed turns never render the error card', () => {
  const aborted = processGroup(buildEntries(protocol.buildRows(events('aborted'), 's')));
  assert.equal(aborted.failed, false);
  assert.equal(aborted.stopped, true);
  assert.equal(aborted.failureMessage, '');
  const done = processGroup(buildEntries(protocol.buildRows(events('completed'), 's')));
  assert.equal(done.failed, false);
  assert.equal(done.failureMessage, '');
});
