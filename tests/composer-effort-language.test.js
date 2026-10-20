const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const labels=require('../miniprogram/utils/labels');
test('composer effort text preserves English labels in either application language',()=>{
 const xml=fs.readFileSync(require.resolve('../miniprogram/pages/session/session.wxml'),'utf8');
 assert.match(xml,/class="model-trigger-effort">\{\{effortLabel\}\}<\/text>/);
 assert.ok(!xml.includes('effort-pill'));
 assert.ok(!xml.includes('catchtap="pickEffort"'));
 const previous=global.wx;
 try {for(const locale of ['zh','en']){global.wx={getStorageSync:()=>locale};for(const [value,label]of [['off','Off'],['none','Off'],['minimal','Minimal'],['low','Low'],['medium','Medium'],['high','High'],['xhigh','XHigh'],['max','Max'],['ultra','Ultra']])assert.equal(labels.reasoningEffortName(value),label);}}
 finally {if(previous===undefined)delete global.wx;else global.wx=previous;}
});

test('localized reasoning labels stay separate from the composer English labels',()=>{
 const previous=global.wx;
 try {
  global.wx={getStorageSync:key=>key==='appLanguage'?'zh':undefined};
  assert.equal(labels.reasoningEffortDisplayName('low'),'低');
  assert.equal(labels.reasoningEffortDisplayName('high'),'高');
  assert.equal(labels.reasoningEffortDisplayName('xhigh'),'超高');
  assert.equal(labels.reasoningEffortDisplayName('max'),'最大');
  assert.equal(labels.reasoningEffortDisplayName('ultra'),'极致');
  assert.equal(labels.reasoningEffortName('low'),'Low');
  global.wx={getStorageSync:key=>key==='appLanguage'?'en':undefined};
  assert.equal(labels.reasoningEffortDisplayName('low'),'Low');
  assert.equal(labels.reasoningEffortDisplayName('xhigh'),'XHigh');
 } finally {if(previous===undefined)delete global.wx;else global.wx=previous;}
});
