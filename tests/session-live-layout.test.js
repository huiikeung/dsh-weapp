const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const { buildEntries } = require('../miniprogram/pages/session/utils/conversation-workflow');
const policy = require('../miniprogram/pages/session/utils/work-step-presentation');
const root = path.resolve(__dirname, '../miniprogram');
const xml = fs.readFileSync(path.join(root, 'pages/session/session.wxml'), 'utf8');
const runtimeXml = fs.readFileSync(path.resolve(__dirname, '../resources/runtime-markup/pages/session/session.wxml'), 'utf8');
const css = fs.readFileSync(path.join(root, 'pages/session/session.wxss'), 'utf8');

test('live status title sits below details while completed headers stay above them', () => {
  // 组头下方的分隔横线已去掉：运行中组体在上、实时状态标题在下，中间不再有分割线。
  assert.doesNotMatch(css, /\.process-hairline/);
  assert.match(css, /\.process-block\.running\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;/);
  for (const [name, order] of [['process-body',0], ['process-head',1]]) {
    const rule = css.match(new RegExp('\\.process-block\\.running\\s*>\\s*\\.' + name + '\\s*\\{([^}]+)\\}'));
    assert.ok(rule, name);
    assert.match(rule[1], new RegExp('order:\\s*' + order + ';'));
    assert.doesNotMatch(css, new RegExp('(?:^|\\n)\\.' + name + '\\s*\\{[^}]*order:'));
  }
  for (const row of [
    {kind:'context',key:'ctx',text:'Time sample',title:'上下文'},
    {kind:'assistant',key:'think',reasoning:'正在分析',tools:[]}
  ]) {
    const entries=buildEntries([{kind:'user',key:'u',text:'任务'},row],{running:true});
    assert.equal(entries.at(-1).running,true);
    assert.ok(['正在整理上下文','正在推理'].includes(entries.at(-1).title));
    const folds=policy.apply(entries,{mode:'detailed'}, {}, [], true);
    assert.equal(folds[entries.at(-1).key],false,'process body is visible without opening a disclosure');
    assert.equal(entries.at(-1).processBodyVisible,true,'detailed mode shows the process during the conversation');
    assert.equal(entries.at(-1).processBodyCapped,true,'the live detailed process rides in the capped scroll container');
  }
});

test('all step disclosures share touch feedback with no trailing arrows', () => {
  const process = xml.slice(xml.indexOf('class="process-block'), xml.indexOf('class="row-assistant"'));
  assert.doesNotMatch(process, /class="event-chevron|class="process-chevron/);
  // 收起时显示工具图标，展开后才由 .disclosed 换成箭头（不再用 completed-chevron 顶替图标）
  assert.match(process, /wx:if="\{\{!item.running\}\}" class="process-command-icon command-tool-icon"/);
  assert.doesNotMatch(process, /completed-chevron/);
  assert.doesNotMatch(css, /completed-chevron/);
  // 回合级「已完成」行前面只有箭头，常驻可见
  assert.match(process, /turn-process-slot/);
  assert.match(css, /\.turn-process-slot \.command-chevron\s*\{\s*opacity:\s*\.65/);
  assert.match(process, /wx:if="\{\{tool.phase !== 'preparing'\}\}" class="command-icon-slot \{\{folds\[tool.key\]/);
  // 4 个过程组/disclosure 头 + 1 个回合级「已完成」disclosure 头
  const heads = [...process.matchAll(/<view[^>]*class="(?:process-head|disclosure-head[^"]*)"[^>]*>/g)];
  assert.equal(heads.length, 5);
  assert.match(xml, /item.kind === 'turnProcess'/, '回合级已完成 disclosure 行');
  heads.forEach(([head]) => {
    assert.match(head, /hover-class="[^"]*tool-head-hover/);
    assert.match(head, /hover-start-time="0"/);
    assert.match(head, /hover-stay-time="200"/);
    assert.match(head, /bindtap=/);
  });
});

test('process-group bodies collapse to their heading and mount only when the policy opens them', () => {
  const process = xml.slice(xml.indexOf('class="process-block {{item.running'), xml.indexOf('class="row-assistant"'));
  assert.match(process, /<scroll-view wx:if="\{\{item\.processBodyVisible\}\}" id="process-body-\{\{item\.key\}\}" class="process-body \{\{item\.processBodyCapped/);
  assert.doesNotMatch(process, /wx:if="\{\{folds\[item\.key\]\}\}" class="process-body/);
  assert.match(css, /\.process-body-capped\s*\{[^}]*max-height:\s*min\(400px,\s*50vh\)/);
  assert.match(process, /node\.showPreview/);
});

test('a live process body follows the newest step anchor instead of leaving it below the scroll viewport', () => {
  const tools = [
    {callId:'call-1',key:'tool-1',name:'read_file',status:'running'},
  ];
  const build = reasoning => buildEntries([
    {kind:'assistant',key:'assistant-1',turn:1,reasoning,tools}
  ], {running:true}).find(row => row.kind === 'processGroup');
  const first = build('Thinking');
  assert.equal(first.processScrollTarget, first.children.at(-1).key);

  const sameStep = build('Thinking with more detail');
  assert.equal(sameStep.processScrollTarget, first.processScrollTarget,
    'text updates in the same step do not repeatedly move the scroll position');

  tools.push({callId:'call-2',key:'tool-2',name:'search',status:'running'});
  const nextStep = build('Thinking with more detail');
  assert.equal(nextStep.processScrollTarget, nextStep.children.at(-1).key);
  assert.notEqual(nextStep.processScrollTarget, first.processScrollTarget,
    'a new step advances the target to its anchor');

  const process = xml.slice(xml.indexOf('class="process-block {{item.running'), xml.indexOf('class="row-assistant"'));
  assert.match(process, /scroll-top="\{\{item\.processBodyScrollTop \|\| 0\}\}"/, 'a running body follows measured scroll geometry');
  assert.match(process, /scroll-anchoring="\{\{false\}\}"/, 'manual scrollTop corrections do not double with native anchoring');
  assert.match(runtimeXml, /class="process-body[^\"]*"[^>]*scroll-top="\{\{item\.processBodyScrollTop \|\| 0\}\}"[^>]*scroll-anchoring="\{\{false\}\}"/,
    'the packaged runtime template uses the same measured inner-scroll behavior');
  assert.match(process, /bindscroll="onProcessBodyScroll"/, 'user scrolling inside the body can pause the follow');
  assert.match(process, /bindtouchmove="onProcessBodyTouchMove"/, 'only a manual gesture pauses live following');
  assert.match(process, /id="\{\{item\.key\}\}\/tail"[^>]*class="process-step-anchor"/, 'the tail anchor the follow scrolls to');
  assert.match(process, /class="process-body[^>]*show-scrollbar="\{\{false\}\}"/,
    'the process body remains scrollable without drawing a scrollbar');
  assert.match(process, /<view id="\{\{node\.key\}\}" class="process-step-anchor"/);
  assert.match(css, /\.process-step-anchor\s*\{[^}]*height:\s*1rpx/);
  assert.match(xml, /class="conversation[^\"]*"[\s\S]*?scroll-anchoring="\{\{false\}\}"/,
    'the conversation uses explicit visible-row compensation instead of native double anchoring');
  assert.match(runtimeXml, /class="conversation[^\"]*"[\s\S]*?scroll-anchoring="\{\{false\}\}"/,
    'the packaged runtime also disables native anchoring to avoid double scroll corrections');
});

test('independent narration rows keep a tight rhythm under the collapsed group heading', () => {
  for (const [name, markup] of [['source', xml], ['runtime', runtimeXml]]) {
    assert.match(markup, /class="row-assistant \{\{item\.processNarration \? 'narration-row' : ''\}\}"/,
      name + ' tags process narration rows');
  }
  for (const base of ['../miniprogram/pages/session/session.wxss', '../resources/runtime-markup/pages/session/session.wxss']) {
    const sheet = fs.readFileSync(path.resolve(__dirname, base), 'utf8');
    const narration = sheet.match(/\.row-assistant\.narration-row \{[^}]*\}/);
    assert.ok(narration, base);
    assert.match(narration[0], /padding:\s*10rpx 0;/);
    // 块 margin 归零后，组标题↔过程文字两个方向都是 12rpx；块与块之间保留 10rpx 段距
    assert.match(sheet, /\.row-assistant\.narration-row \.md-block \{[^}]*margin:\s*0;/);
    assert.match(sheet, /\.row-assistant\.narration-row \.md-block \+ \.md-block \{[^}]*margin-top:\s*10rpx;/);
    // 比普通消息行（20rpx）紧，标题与过程文字之间不再是整条消息的间距
    assert.ok(/padding:\s*20rpx 0;/.test(sheet));
  }
});

test('compact group headings wrap instead of truncating with an ellipsis', () => {
  for (const [name, markup] of [['source', xml], ['runtime', runtimeXml]]) {
    assert.match(markup, /class="process-title \{\{item\.failed \? 'failed' : ''\}\} \{\{item\.titleWrap \? 'title-wrap' : ''\}\}"/,
      name + ' tags wrappable titles');
  }
  for (const base of ['../miniprogram/pages/session/session.wxss', '../resources/runtime-markup/pages/session/session.wxss']) {
    const sheet = fs.readFileSync(path.resolve(__dirname, base), 'utf8');
    assert.match(sheet, /\.process-title\.title-wrap\s*\{[^}]*white-space:\s*normal/, base + ' wraps the title');
    assert.match(sheet, /\.process-title\.title-wrap\s*\{[^}]*max-width:\s*none/, base + ' takes the full row width');
    assert.doesNotMatch(sheet, /\.process-title\.title-wrap\s*\{[^}]*text-overflow:\s*ellipsis/);
  }
});

test('turn-process disclosure is disabled in verbose and always-open outcomes', () => {
  const process = xml.slice(xml.indexOf("item.kind === 'turnProcess'"), xml.indexOf("item.kind === 'processGroup'"));
  assert.match(process, /bindtap="toggleFold"/);
  assert.match(process, /wx:if="\{\{item\.foldable\}\}" class="command-chevron/);
  const runtimeTurn = runtimeXml.slice(runtimeXml.indexOf("item.kind === 'turnProcess'"), runtimeXml.indexOf("item.kind === 'processGroup'"));
  assert.match(runtimeTurn, /bindtap="toggleFold"/, 'source runtime markup uses a static handler too');
});

test('completed turn summaries switch from duration to tool count and keep one heading per group', () => {
  const turn = xml.slice(xml.indexOf("item.kind === 'turnProcess'"), xml.indexOf("item.kind === 'processGroup'"));
  assert.match(turn, /item\.summary \|\| item\.expandedSummary/);
  assert.match(turn, /folds\[item\.key\] && item\.expandedSummary \? item\.expandedSummary/);
  const group = xml.slice(xml.indexOf("item.kind === 'processGroup'"), xml.indexOf('class="turn-error-card"'));
  assert.match(group, /<view wx:if="\{\{!item\.headingHidden\}\}" class="process-head"/);
  assert.doesNotMatch(group, /turnGroupHeadingHidden/);
});

const compiler = process.env.WECHAT_WCC || 'D:/Program Files (x86)/Tencent/微信web开发者工具/resources/app.asar.unpacked/node_modules/wcc-exec/wcc.exe';
test('native session template puts live work before whale and keeps completed arrow', { skip: !fs.existsSync(compiler) }, () => {
  const output = path.join(os.tmpdir(), 'dsh-session-live-' + process.pid + '.js');
  execFileSync(compiler, ['-o', output, 'pages/session/session.wxml'], { cwd: root });
  const context = vm.createContext({ window: {}, console });
  vm.runInContext(fs.readFileSync(output, 'utf8'), context);
  const render = context.$gwx('pages/session/session.wxml');
  const semantic = [{kind:'user',key:'u',text:'任务',images:[]},
    {kind:'assistant',key:'a',turn:1,text:'执行说明',reasoning:'思考过程',streaming:true,tools:[
      {callId:'c',name:'bash',phase:'start',status:'running',argumentsText:'{}',isCommand:true}
    ]}];
  const rows = buildEntries(semantic, { running:true });
  const folds = policy.apply(rows, {mode:'detailed'}, {}, [], true);
  const data = {tab:'conversation',theme:'light',rows,folds,running:true,images:[],queue:[],ui:{},stats:{},tasks:[],commandMenu:null};
  const tree = JSON.stringify(render(data, {}, {}));
  assert.ok(tree.indexOf('执行说明') < tree.indexOf('process-block'));
  assert.ok(tree.indexOf('process-block') < tree.indexOf('progress-strip'));
  // 详细模式对话过程中组体照常展开（过程可见），组头只有 loader
  assert.ok(tree.includes('proc-loader'));
  assert.ok(tree.includes('process-body'), 'detailed live groups keep the process visible');
  assert.ok(tree.includes('process-body-capped'), 'and it rides in the bounded scroll container');
  assert.ok(tree.includes('command-tool-icon'));
  assert.ok(tree.includes('hoverStayTime'));
  assert.ok(!tree.includes('event-chevron'));
  semantic[1].streaming=false;semantic[1].turnClosed=true;semantic[1].turnEndReason='completed';
  const done = buildEntries(semantic);
  data.rows=done;data.running=false;data.folds=policy.apply(done,{mode:'detailed',timing:'completion'},folds,rows,false);
  const completed=JSON.stringify(render(data,{},{}));
  // 收工后组头显示默认工具图标（箭头只在展开时由 .disclosed 交出），过程已折叠
  assert.ok(completed.includes('command-tool-icon'));
  assert.ok(!completed.includes('completed-chevron'));
  assert.ok(!completed.includes('process-body'), 'completed groups collapse to a single heading');
  assert.ok(completed.includes('process-head'));
  assert.ok(!completed.includes('progress-strip'));
});
