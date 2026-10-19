const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {buildRows,normalizeRawEvent,newAggregator,applyEvent}=require('../miniprogram/utils/protocol');
const {buildEntries}=require('../miniprogram/utils/conversation-workflow');
const {describe,relativePath}=require('../miniprogram/utils/file-deliverables');
const {downloadFile,MAX_BYTES}=require('../miniprogram/utils/file-download');
const SHA256=require('../miniprogram/utils/file-sha256');
const event=(seq,type,data)=>({seq,type,data});
const file={sessionId:'session',path:'out/test.md',name:'test.md',key:'file'};

test('durable file cards replay identically, deduplicate within a turn and follow closing reply',()=>{
  const events=[event(1,'user/message',{content:'create file',source:'user'}),
    event(2,'tool/call',{turn:1,callId:'c',name:'present',arguments:{files:[{path:file.path}]}}),
    event(3,'deliverables/presented',{turn:1,callId:'c',files:[{path:''},{path:file.path,description:'first'}]}),
    event(4,'deliverables/presented',{turn:1,callId:'c2',files:[{path:file.path,description:'latest'},{path:'index.html'},{path:'bad',description:3}]}),
    event(5,'tool/result',{turn:1,callId:'c',preview:'ok'}),
    event(6,'assistant/message',{turn:1,text:'done'}),event(7,'turn/end',{turn:1,reason:'completed'})];
  assert.equal(buildRows(events.slice(0,2),'session').some(r=>r.kind==='files'),false);
  const history=buildRows(events,'session'),agg=newAggregator();
  events.forEach(raw=>applyEvent(agg,normalizeRawEvent(raw,'session')));
  applyEvent(agg,normalizeRawEvent(events[3],'session'));
  assert.deepEqual(agg.rows,history);
  const cards=history.find(row=>row.kind==='files');
  assert.equal(cards.files.length,2);assert.equal(cards.files[0].description,'latest');
  assert.equal(cards.files[0].index,0);assert.equal(cards.files[0].seq,4);assert.equal(cards.files[0].key,'file-3-1');
  assert.equal(buildEntries(history).at(-1).kind,'files');
  const second=buildRows(events.concat(event(8,'user/message',{content:'again',source:'user'}),event(9,'deliverables/presented',{turn:2,callId:'next',files:[{path:file.path}]})),'session');
  assert.equal(second.filter(r=>r.kind==='files').length,2);
  assert.equal(buildRows([event(1,'deliverables/presented',{turn:1,files:[{path:'test'}]})],'session').length,0);
});

test('cards preserve supplied descriptions, filenames and use extension-specific artwork',()=>{
  for(const name of ['preview-qr.png','移植验收报告.html','移植差异清单.md','result.pdf','sheet.xlsx','app.ipa']) {
    const card=describe({path:'/workspace/'+name,description:'说明'});
    assert.equal(card.name,name);assert.equal(card.subtitle,'说明');
    assert.ok(fs.existsSync(path.join(__dirname,'../miniprogram',card.icon)));
  }
  assert.equal(describe({path:'page.html'}).previewKind,'text');
  assert.equal(describe({path:'image.svg'}).previewKind,'text');
});

test('workspace path conversion never strips an unrelated prefix or allows traversal',()=>{
  assert.equal(relativePath('/work/a/out/test.md','/work/a'),file.path);
  assert.equal(relativePath('./out/test.md'),file.path);
  assert.equal(relativePath('C:\\work\\out\\test.md','c:\\work'),file.path);
  for(const [value,cwd] of [['/work/ab/test.md','/work/a'],['/etc/passwd','/work/a'],['/work/a/../b','/work/a'],['../secret'],['https://host/file'],['file:///etc/passwd'],['a/../../b'],['a\0b'],['/a'],[''],['.']]) assert.throws(()=>relativePath(value,cwd),value);
});

test('incremental SHA256 matches Node at all padding boundaries and across chunks',()=>{
  for(const length of [0,1,55,56,63,64,65,127,128,10000,1024*1024+3]) {
    const bytes=crypto.randomBytes(length),hash=new SHA256();
    for(let offset=0;offset<length;offset+=997) hash.update(bytes.subarray(offset,offset+997));
    assert.equal(hash.hex(),crypto.createHash('sha256').update(bytes).digest('hex'),'length '+length);
  }
});

function transferFixture(bytes=Buffer.from('hello 文件')) {
  const disk=new Map(),operations=[],progress=[],job={};let cancelled=0;
  const digest=crypto.createHash('sha256').update(bytes).digest('hex');
  const api={env:{USER_DATA_PATH:'/tmp/test'},base64ToArrayBuffer(value){return Uint8Array.from(Buffer.from(value,'base64')).buffer;},getFileSystemManager(){return {
    writeFile(o){operations.push('write');disk.set(o.filePath,Buffer.from(o.data));o.success({});},
    appendFile(o){operations.push('append');disk.set(o.filePath,Buffer.concat([disk.get(o.filePath),Buffer.from(o.data)]));o.success({});},
    rename(o){operations.push('rename');disk.set(o.newPath,disk.get(o.oldPath));disk.delete(o.oldPath);o.success({});},
    unlink(o){operations.push('unlink');disk.delete(o.filePath);o.success({});}
  };}};
  const client={connectGeneration:1,async openFileDownload(sessionId,p){return {transferId:'transfer',sessionId,path:p,name:'test.md',size:bytes.length,chunkBytes:4};},
    async readFileDownload(transferId,offset){const part=bytes.subarray(offset,offset+4),eof=offset+part.length===bytes.length;return {transferId,offset,data:part.toString('base64'),eof,...(eof?{sha256:digest}:{})};},
    async cancelFileDownload(){cancelled++;}};
  const options={api,job,onProgress:n=>progress.push(n)};
  return {api,job,client,options,disk,operations,progress,cancelled:()=>cancelled};
}

test('chunk download writes incrementally, verifies digest then atomically renames including empty files',async()=>{
  for(const bytes of [Buffer.from('hello 文件'),Buffer.alloc(0)]) {
    const f=transferFixture(bytes),result=await downloadFile(f.client,file,f.options);
    assert.deepEqual(f.disk.get(result.localPath),bytes);assert.equal(f.disk.size,1);
    assert.equal(f.operations.at(-1),'rename');assert.equal(f.progress.at(-1),100);assert.equal(f.client._activeFileDownload,null);
  }
});

test('corrupt, out-of-order, truncated, oversized and cross-session transfers are rejected and removed',async()=>{
  const mutations=[
    frame=>({...frame,offset:99}),frame=>({...frame,transferId:'other'}),
    frame=>({...frame,data:'not base64'}),frame=>({...frame,eof:true,sha256:'0'.repeat(64)}),
    frame=>({...frame,data:'',eof:false}),frame=>({...frame,sha256:'0'.repeat(64)})
  ];
  for(const mutate of mutations) {
    const f=transferFixture(),read=f.client.readFileDownload;f.client.readFileDownload=async(...args)=>mutate(await read(...args));
    await assert.rejects(downloadFile(f.client,file,f.options));assert.equal(f.disk.size,0);assert.equal(f.cancelled(),1);assert.ok(!f.operations.includes('rename'));
  }
  for(const mutation of [{size:MAX_BYTES+1},{sessionId:'different'},{path:'wrong'},{chunkBytes:0}]) {
    const f=transferFixture(),open=f.client.openFileDownload;f.client.openFileDownload=async(...args)=>({...await open(...args),...mutation});
    await assert.rejects(downloadFile(f.client,file,f.options));assert.equal(f.disk.size,0);
  }
});

test('cancel, session switch and reconnect cannot finish or open a stale download',async()=>{
  for(const mode of ['cancel','session','reconnect']) {
    const f=transferFixture();let current=true;const read=f.client.readFileDownload;
    f.options.isCurrent=()=>current;f.client.readFileDownload=async(...args)=>{
      if(mode==='cancel')f.job.cancelled=true;if(mode==='session')current=false;if(mode==='reconnect')f.client.connectGeneration++;
      return read(...args);
    };
    await assert.rejects(downloadFile(f.client,file,f.options),e=>e.cancelled);assert.equal(f.disk.size,0);
    assert.equal(f.cancelled(),mode==='reconnect'?0:1);
  }
});

test('single file transfer ownership prevents overlapping download races',async()=>{
  const f=transferFixture();let release;const open=f.client.openFileDownload;
  f.client.openFileDownload=(...args)=>new Promise(resolve=>{release=()=>resolve(open(...args));});
  const first=downloadFile(f.client,file,f.options);
  await assert.rejects(downloadFile(f.client,file,{api:f.api}),/正在下载/);
  release();await first;assert.equal(f.disk.size,1);
});

test('gateway correlates open, chunks and errors without confusing stale transfers',async()=>{
  const {GatewayClient}=require('../miniprogram/utils/gateway');
  const client=new GatewayClient();const sent=[];client.send=payload=>{sent.push(payload);return true;};
  const first=client.openFileDownload('session','out/test.md');
  client.resolveCorrelated({kind:'file-download-opened',requestId:'stale',sessionId:'session',transferId:'wrong'});
  assert.ok(client.pendingRequests['file:file-download-open']);
  client.resolveCorrelated({kind:'file-download-opened',requestId:sent[0].requestId,sessionId:'session',transferId:'correct'});
  assert.equal((await first).transferId,'correct');
  const read=client.readFileDownload('correct',0);
  client.resolveCorrelated({kind:'file-download-chunk',transferId:'wrong',offset:0,data:'',eof:true});
  assert.ok(client.pendingRequests['file:file-download-read']);
  client.resolveCorrelated({kind:'error',requestType:'file-download-read',code:'file-not-found',message:'missing'});
  await assert.rejects(read,error=>error.code==='file-not-found');
  client.send=()=>false;await assert.rejects(client.openFileDownload('session','file'));assert.equal(Object.keys(client.pendingRequests).length,0);
});

test('running whale lives outside scroll-view and inside measured fixed dock',()=>{
  const xml=fs.readFileSync(path.join(__dirname,'../miniprogram/pages/session/session.wxml'),'utf8');
  const scrollEnd=xml.indexOf('</scroll-view>'),dock=xml.indexOf('class="dock-stack'),whale=xml.indexOf('id="deep-search-progress"');
  assert.ok(whale>scrollEnd);assert.ok(whale>dock);assert.equal((xml.match(/id="deep-search-progress"/g)||[]).length,1);
  assert.match(xml.slice(dock,whale),/wx:if="{{running}}"/);
});

test('file action UI uses safe plain-text HTML and declines stale session cards',async()=>{
  const filename=path.resolve(__dirname,'../miniprogram/pages/session/file-actions.js');
  let module={exports:{}},reads=0;const calls=[];
  const store={sessionState:{sessionId:'session'},state:{sessions:[]},client:{connectGeneration:1}};
  const api={getFileSystemManager(){return {};},showModal:o=>calls.push(o),openDocument:o=>calls.push(['doc',o]),previewImage:o=>calls.push(['image',o]),shareFileMessage:o=>calls.push(['share',o])};
  vm.runInNewContext(fs.readFileSync(filename,'utf8'),{module,wx:api,require(name){
    if(name.endsWith('/store'))return store;
    if(name.endsWith('/file-download'))return {downloadFile:async(c,f)=>({...f,localPath:'/tmp/file',size:15}),removeFile:async()=>{},fsCall:async()=>{reads++;return {data:'<script>evil()</script>'};}};
    return require(path.resolve(path.dirname(filename),name));
  }});
  const page={...module.exports,data:{rows:[{files:[file]}]},setData(p){Object.assign(this.data,p);}};
  await page.presentFile({...file,path:'index.html'},'preview');
  assert.equal(reads,1);assert.equal(page.data.filePreview.text,'<script>evil()</script>');assert.equal(page.data.filePreview.sourceCode,true);assert.equal(calls.length,0);
  await page.presentFile({...file,path:'image.png'},'preview');assert.equal(calls.at(-1)[0],'image');
  await page.presentFile({...file,path:'doc.pdf'},'preview');assert.equal(calls.at(-1)[0],'doc');
  await page.presentFile(file,'share');assert.equal(calls.at(-1)[0],'share');
  store.sessionState.sessionId='different';assert.equal(page.findPresentedFile({currentTarget:{dataset:{key:'file'}}}),null);
  const count=calls.length;await page.presentFile(file,'preview');assert.equal(calls.length,count);
});
