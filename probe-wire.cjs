const fs=require('fs');
const page=JSON.parse(fs.readFileSync('/tmp/page.json','utf8'));
// 模拟网关发出的线帧（trim 后）
const trimmed=page.filter(e=>!['assistant/chunk','request/header','request/context','system/message'].includes(e.type));
const wire=JSON.stringify({kind:'history',sessionId:'s',events:trimmed.map(e=>({event:e})),hasMore:true,nextBeforeSeq:trimmed[0].seq,historyFormatVersion:4});
console.log('wire payload:',(wire.length/1024).toFixed(0),'KB  events:',trimmed.length);
let t0=process.hrtime.bigint();
const frame=JSON.parse(wire);
let t1=process.hrtime.bigint();
console.log('client JSON.parse:',(Number(t1-t0)/1e6).toFixed(1),'ms');

// 256KB 快照 vs 762KB history 页
const cap256=trimmed.filter((e,i)=>JSON.stringify(trimmed.slice(0,i+1)).length<256*1024);
console.log('256KB snapshot gives ~',cap256.length,'events (~',Math.round(cap256.length/trimmed.length*60),'messages)');
