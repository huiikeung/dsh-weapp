const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const protocol = require('../miniprogram/utils/protocol');
const { buildEntries } = require('../miniprogram/pages/session/utils/conversation-workflow');
test('reasoning card preserves full text and real step number from history', () => {
 const text = 'First paragraph.\n\n' + 'Detailed reasoning. '.repeat(70);
 const rows = protocol.buildRows([{seq:1,type:'assistant/message',data:{turn:1,step:2,message:{content:[{type:'reasoning',text}]}}}], 's');
 const node = buildEntries(rows)[0].children[0];
 assert.equal(node.stepLabel,'步骤 2');assert.equal(node.text,text);assert.equal(node.readingHeight,360);assert.equal(node.readingLong,true);
});
test('streaming card key stays stable while content grows', () => {
 const agg=protocol.newAggregator();
 const push=(seq,text)=>protocol.applyEvent(agg,{seq,sessionId:'s',event:{type:'assistant/chunk',turn:1,step:3,chunkType:'reasoning',text}});
 push(1,'Start');const first=buildEntries(agg.rows,{running:true})[0].children[0];
 push(2,'\n\nMore detail');const next=buildEntries(agg.rows,{running:true})[0].children[0];
 assert.equal(next.key,first.key);assert.equal(next.stepLabel,'步骤 3');assert.equal(next.text,'Start\n\nMore detail');
});
test('missing step metadata is not replaced with an invented number', () => {
 const node=buildEntries([{kind:'assistant',key:'a',reasoning:'Brief thought'}])[0].children[0];
 assert.equal(node.stepLabel,'');assert.equal(node.readingLong,false);assert.equal(node.readingHeight,88);
});
test('reasoning defaults to the bounded reading card rather than unbounded full-content mode', () => {
 const wxml=fs.readFileSync(path.join(__dirname,'../miniprogram/pages/session/session.wxml'),'utf8');
 const card=wxml.slice(wxml.indexOf('class="reasoning-card '),wxml.indexOf('wx:elif="{{node.kind === \'context\'}}"'));
 assert.match(card,/reasoning-card-head/);assert.match(card,/node.stepLabel/);
 assert.match(card,/reading-preview/);assert.match(card,/scroll-y="\{\{true\}\}"/);assert.match(card,/height:\{\{node\.readingHeight\}\}rpx/);assert.match(card,/selectable>\{\{node.text\}\}/);
 assert.match(card,/完整内容/);assert.match(card,/收起阅读/);assert.doesNotMatch(card,/展开阅读|reading-expanded/);assert.match(card,/data-key="\{\{node.key\}\}"/);
 assert.doesNotMatch(card,/reasoning-preview-row/);
 assert.doesNotMatch(card,/event-glyph|event-rule/);
});
test('completed process hides its leading icon without hiding running icons', () => {
 const wxml=fs.readFileSync(path.join(__dirname,'../miniprogram/pages/session/session.wxml'),'utf8');
 assert.match(wxml,/<view wx:if="\{\{item.running && !item.completed\}\}" class="proc-loader proc-look-\{\{procIconStyle\}\}">/);
 assert.match(wxml,/<template is="procIconGlyph" data="\{\{styleId: procIconStyle\}\}" \/>/);
 const glyph=fs.readFileSync(path.join(__dirname,'../miniprogram/styles/proc-icon.wxml'),'utf8');
 for(const style of ['cells','terra','morph','grid','orbit','ripple','wave'])assert.ok(glyph.includes(`styleId === '${style}'`)||style==='wave');
 assert.doesNotMatch(wxml,/procIconFile|\.gif/);
 // 收起时显示工具图标（含已完成的组），展开后才由 .disclosed 换成箭头
 assert.match(wxml,/<image wx:if="\{\{!item.running\}\}" class="process-command-icon command-tool-icon"/);
 assert.match(wxml,/<image class="command-chevron \{\{folds\[item.key\] \? 'open' : ''\}\}"/);
 assert.doesNotMatch(wxml,/completed-chevron/);
 const done=buildEntries([{kind:'assistant',key:'a',reasoning:'Done',turnClosed:true,turnEndReason:'completed'}])[0];
 const running=buildEntries([{kind:'assistant',key:'a',reasoning:'Thinking'}],{running:true})[0];
 assert.equal(done.completed,true);assert.equal(running.completed,false);
});
