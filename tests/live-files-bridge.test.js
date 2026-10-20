const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), vm = require('node:vm');
const { transform, install } = require('../scripts/install-live-files-bridge.cjs');
const source = `function buildWireEvent(session, event) {
  const base = {kind:'event',sessionId:String(session.id),seq:event.seq,time:event.time,surfaceOp:event.surfaceOp};
  const d = event.data || {};
  switch(event.type) {
    case 'turn/start': return Object.assign(base,{event:{type:event.type,turn:d.turn}});
    default: return Object.assign(base,{event:{type:event.type}});
  }
}
function parseWireImages() {}`;
function checkEncoder(encode) {
  const data={turn:1,callId:'p',files:[{path:'report.pdf',description:'Final report',secret:'not wire data'},null]};data.cycle=data;
  const frame=JSON.parse(JSON.stringify(encode({id:'s'},{type:'deliverables/presented',seq:7,time:20,surfaceOp:'append',data})));
  assert.deepEqual(frame,{kind:'event',sessionId:'s',seq:7,time:20,surfaceOp:'append',event:{type:'deliverables/presented',turn:1,callId:'p',files:[{path:'report.pdf',description:'Final report'}]}});
  assert.deepEqual(JSON.parse(JSON.stringify(encode({id:'s'},{type:'workspace/changes',seq:8,data:{turn:1}}))).event,{type:'workspace/changes',turn:1});
  assert.equal(encode({id:'s'},{type:'turn/start',data:{turn:2}}).event.turn,2);
}
test('gateway repair preserves live file fields and metadata without arbitrary host objects',()=>{
  const patched=transform(source);assert.equal(transform(patched),patched);
  checkEncoder(vm.runInNewContext(patched+'\nbuildWireEvent;'));
  assert.throws(()=>transform('incompatible source'));
  assert.throws(()=>transform(source.replace("    case 'turn/start':","    case 'workspace/changes': return null;\n    case 'turn/start':")));
});
test('installer checks compatibility, backs up the original and applies only once',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'dsh-live-files-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.mkdirSync(path.join(root,'lib'));fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({name:'dsh-plugin-weapp-gateway'}));
  const file=path.join(root,'lib/index.mjs');fs.writeFileSync(file,source);
  assert.equal(install(root,true).changes,1);assert.equal(fs.readFileSync(file,'utf8'),source);
  const result=install(root);assert.equal(result.updated,1);assert.equal(fs.readFileSync(result.backup,'utf8'),source);
  assert.equal(install(root).updated,0);assert.equal(install(root,true).changes,0);
});
const gateway=process.env.DSH_TEST_GATEWAY;
test('real gateway encoder forwards file and snapshot announcements',{skip:!gateway},()=>{
  const code=transform(fs.readFileSync(path.join(gateway,'lib/index.mjs'),'utf8'));
  const start=code.indexOf('function buildWireEvent(session, event) {'),end=code.indexOf('function parseWireImages(',start);
  checkEncoder(vm.runInNewContext(code.slice(start,end)+'\nbuildWireEvent;'));
});
