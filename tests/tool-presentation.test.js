const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { toolPresentation } = require('../miniprogram/pages/session/utils/tool-presentation');
test('shell summary matches DSH description priority; full command remains intact', () => {
 const command = '$ws="C:\\Users\\demo"\nforeach($f in @("a")){ Write-Output $f }';
 const p = toolPresentation('pwsh', JSON.stringify({description:'Clean temp files and confirm final uninstalled state',command,workdir:'C:\\Users\\demo\\default-workspace'}));
 assert.equal(p.label,'运行命令'); assert.equal(p.detail,'Clean temp files and confirm final uninstalled state');
 assert.equal(p.commandText,command); assert.equal(p.commandLines.length,2); assert.equal(p.cwdLabel,'default-workspace');
});
test('fallback uses command first line, not serialized braces or metadata', () => {
 const p=toolPresentation('functions.exec_command',JSON.stringify({timeout:100,cmd:'echo "hello"\necho done'}));
 assert.equal(p.detail,'echo "hello"'); assert.equal(p.isCommand,true);
 assert.equal(toolPresentation('bash','{}').detail,'');
 assert.equal(toolPresentation('bash','{"command":').detail,'');
 assert.equal(toolPresentation('bash','{"description":"检查文件","command":').detail,'检查文件');
 assert.equal(toolPresentation('bash','{"description":"检查文件","command":"echo hi"').commandText,'echo hi');
});
test('file, query and URL summaries use semantic fields', () => {
 assert.equal(toolPresentation('read_file',JSON.stringify({path:'src/app.js',offset:1})).detail,'src/app.js');
 assert.equal(toolPresentation('web_search',JSON.stringify({queries:['alpha','beta']})).detail,'alpha、beta');
 assert.equal(toolPresentation('web_fetch',JSON.stringify({url:'https://example.com'})).detail,'https://example.com');
 assert.equal(toolPresentation('custom_tool','{"nested":{"flag":true}}').detail,'');
 assert.equal(toolPresentation('bash','echo hello').commandText,'echo hello');
});
test('command card has exact-copy action and does not show raw JSON input', () => {
 const template=fs.readFileSync(require.resolve('../miniprogram/pages/session/session.wxml'),'utf8');
 const card=template.slice(template.indexOf('class="command-card"'),template.indexOf('<view wx:elif="{{folds[tool.key] && tool.phase'));
 assert.match(card,/tool.commandLines/);assert.match(card,/tool.resultText/);assert.doesNotMatch(card,/tool.argumentsText/);
 assert.match(card,/catchtap="copyToolCommand"/);
});

test('copy command preserves literal shell characters and line breaks', () => {
 const source=fs.readFileSync(require.resolve('../miniprogram/pages/session/session.js'),'utf8');
 const body=source.match(/copyToolCommand\(e\) \{([\s\S]*?)\n  \},/)[1];
 let copied;
 const command='echo **literal**\n$items = @(1, 2)';
 require('node:vm').runInNewContext(body,{e:{currentTarget:{dataset:{text:command}}},wx:{setClipboardData:({data})=>copied=data}});
 assert.equal(copied,command);
});

test('command glyph changes to persistent arrow only while the step is expanded', () => {
 const template=fs.readFileSync(require.resolve('../miniprogram/pages/session/session.wxml'),'utf8');
 const css=fs.readFileSync(require.resolve('../miniprogram/pages/session/session.wxss'),'utf8');
 const head=template.slice(template.indexOf('<view class="disclosure-head tool"'),template.indexOf('<view wx:if="{{folds[tool.key] && tool.isCommand'));
 assert.match(head,/hover-class="tool-head-hover"/);
 assert.match(head,/hover-stay-time="200"/);
 const slot=head.slice(head.indexOf('class="command-icon-slot '),head.indexOf('<image wx:else'));
 assert.ok(slot.includes("folds[tool.key] ? 'disclosed' : ''"));
 assert.match(slot,/class="event-glyph tool-glyph-small command-tool-icon"/);
 assert.match(slot,/theme === 'dark' \? tool.darkIconFile : tool.iconFile/);
 assert.match(slot,/class="command-chevron \{\{folds\[tool.key\] \? 'open' : ''\}\}"/);
 assert.doesNotMatch(slot,/completed|revealed/);
 assert.match(css,/\.command-tool-icon\s*\{\s*opacity:1;/);
 assert.match(css,/\.command-chevron\s*\{[^}]*opacity:0;/);
 assert.doesNotMatch(css.match(/\.command-chevron\.open\s*\{([^}]*)\}/)[1],/opacity|visibility|display/);
 for(const selector of ['.command-icon-slot.disclosed']) {
   assert.ok(css.includes(selector+' .command-tool-icon { opacity:0; }'));
   assert.ok(css.includes(selector+' .command-chevron { opacity:.65; }'));
 }
 assert.ok(!css.includes('.tool-head-hover .command-tool-icon'), 'touch feedback must not override expanded state');
 const { buildEntries }=require('../miniprogram/pages/session/utils/conversation-workflow');
 const group=buildEntries([{kind:'assistant',key:'a',turnClosed:true,turnEndReason:'completed',tools:[{callId:'c',name:'bash',status:'done',argumentsText:'{"command":"echo ok"}'}]}]).find(row=>row.kind==='processGroup');
 assert.equal(group.completed,true);
 const tool=group.children[0].tools[0];
 assert.equal(tool.iconFile,'dsh-bash.svg');
 assert.equal(tool.darkIconFile,'dsh-bash-dark.svg');
});
