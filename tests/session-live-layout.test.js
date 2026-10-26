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
const css = fs.readFileSync(path.join(root, 'pages/session/session.wxss'), 'utf8');

test('live status title sits below details while completed headers stay above them', () => {
  assert.match(css, /\.process-block\.running\s*>\s*\.process-hairline\s*\{[^}]*display:\s*none;/);
  assert.match(css, /\.process-block\.running\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;/);
  for (const [name, order] of [['process-body',0], ['process-hairline',1], ['process-head',2]]) {
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
    assert.equal(policy.apply(entries,{mode:'detailed'}, {}, [], true)[entries.at(-1).key],true);
  }
});

test('all step disclosures share touch feedback with no trailing arrows', () => {
  const process = xml.slice(xml.indexOf('class="process-block'), xml.indexOf('class="row-assistant"'));
  assert.doesNotMatch(process, /class="event-chevron|class="process-chevron/);
  assert.match(process, /item.completed \? 'completed-chevron' : ''/);
  assert.match(process, /wx:if="\{\{tool.phase !== 'preparing'\}\}" class="command-icon-slot \{\{folds\[tool.key\]/);
  const heads = [...process.matchAll(/<view[^>]*class="(?:process-head|disclosure-head[^"]*)"[^>]*>/g)];
  assert.equal(heads.length, 4);
  heads.forEach(([head]) => {
    assert.match(head, /hover-class="[^"]*tool-head-hover/);
    assert.match(head, /hover-start-time="0"/);
    assert.match(head, /hover-stay-time="200"/);
    assert.match(head, /bindtap=/);
  });
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
  assert.ok(tree.includes('command-tool-icon'));
  assert.ok(tree.includes('hoverStayTime'));
  assert.ok(!tree.includes('event-chevron'));
  semantic[1].streaming=false;semantic[1].turnClosed=true;semantic[1].turnEndReason='completed';
  const done = buildEntries(semantic);
  data.rows=done;data.running=false;data.folds=policy.apply(done,{mode:'detailed',timing:'completion'},folds,rows,false);
  const completed=JSON.stringify(render(data,{},{}));
  assert.ok(completed.includes('completed-chevron'));
  assert.ok(!completed.includes('process-body'));
  assert.ok(!completed.includes('progress-strip'));
});
