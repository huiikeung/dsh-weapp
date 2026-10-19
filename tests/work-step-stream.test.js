const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
test('live stream names without argument tokens are not dropped by store',()=>{
 const filename=path.join(__dirname,'../miniprogram/utils/store.js'),module={exports:{}};
 class Client{constructor(callbacks){this.callbacks=callbacks;}}
 vm.runInNewContext(fs.readFileSync(filename,'utf8'),{module,Date,console,wx:{getStorageSync(){},setStorageSync(){},removeStorageSync(){}},setTimeout:()=>1,clearTimeout(){},setInterval:()=>1,clearInterval(){},require(name){if(name==='./gateway')return {GatewayClient:Client};return require(path.resolve(path.dirname(filename),name));}});
 const store=module.exports;store.sessionState.sessionId='live-test';
 store.client.callbacks.onFrame({kind:'assistant-stream',sessionId:'live-test',frame:{type:'chunk',turn:1,step:1,chunk:{type:'tool-call-delta',id:'c',name:'bash'}}});
 assert.equal(store.sessionState.running,true);
 assert.equal(store.sessionState.rows[0].tools[0].name,'bash');
});
