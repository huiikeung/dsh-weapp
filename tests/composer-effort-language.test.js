const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const labels=require('../miniprogram/utils/labels');
test('composer effort pill preserves English labels in either application language',()=>{
 const xml=fs.readFileSync(require.resolve('../miniprogram/pages/session/session.wxml'),'utf8');
 assert.match(xml,/class="effort-pill" catchtap="pickEffort">\{\{effortLabel\}\}<\/view>/);
 const previous=global.wx;
 try {for(const locale of ['zh','en']){global.wx={getStorageSync:()=>locale};for(const [value,label]of [['off','Off'],['none','Off'],['minimal','Minimal'],['low','Low'],['medium','Medium'],['high','High'],['xhigh','XHigh'],['max','Max'],['ultra','Ultra']])assert.equal(labels.reasoningEffortName(value),label);}}
 finally {if(previous===undefined)delete global.wx;else global.wx=previous;}
});
