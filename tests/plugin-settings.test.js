const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {PluginSettings}=require('../miniprogram/pages/plugin-detail/plugin-settings');
const bridge=require('../scripts/install-plugin-settings-bridge.cjs');
const {GatewayClient}=require('../miniprogram/utils/gateway');
const root = path.resolve(__dirname, '..', 'miniprogram');
function section(ns,value,base={},user={}){return {ns,value,base,user,revision:7};}
function form(kind,sections,writable=true){return new PluginSettings(kind,{writable,namespaces:sections});}
function fixture(kind='shell',sections=[section('pwsh-sandbox',{timeoutMs:30000,maxOutputBytes:1000},{timeoutMs:30000,maxOutputBytes:1000})]){
  const calls=[],store={state:{activeID:'a',connection:'connected',endpoint:'wss://a'},client:{requestPlugin(type,payload){return new Promise((resolve,reject)=>calls.push({type,payload,resolve,reject}));},requestModels(){return new Promise((resolve,reject)=>calls.push({type:'models',resolve,reject}));}}};
  const cache={};function load(file){const full=path.resolve(root,file);if(cache[full])return cache[full].exports;const module={exports:{}};cache[full]=module;vm.runInNewContext(fs.readFileSync(full,'utf8'),{module,setTimeout,clearTimeout,require:id=>id.endsWith('/store')?store:id.startsWith('.')&&path.resolve(path.dirname(full),id).startsWith(path.join(root,'pages'))?load(path.relative(root,path.resolve(path.dirname(full),id))+'.js'):require(path.resolve(path.dirname(full),id))});return module.exports;}
  const page={...load('pages/plugin-detail/settings-actions.js'),officialId:kind,configForm:form(kind,sections),configGeneration:1,configOwner:'a|wss://a|',configConnected:true,configInputs:{},data:{configStatus:'ready',configSaving:false},setData(p){Object.assign(this.data,p);}};page.renderSettings();return {page,store,calls};
}
const tick=()=>new Promise(r=>setImmediate(r));
test('Shell selects PowerShell and writes only edited values with revisions',()=>{
  const f=form('shell',[section('bash-sandbox',{timeoutMs:10}),section('pwsh-sandbox',{timeoutMs:20},{timeoutMs:10},{timeoutMs:20})]);
  assert.equal(f.fields()[0].ns,'pwsh-sandbox');f.stage('pwsh-sandbox','timeoutMs',10);assert.deepEqual(f.operations(),[{ns:'pwsh-sandbox',expectedRevision:7,ops:[{op:'unset',path:['timeoutMs']}]}]);
  f.discard();f.stage('pwsh-sandbox','timeoutMs',20);assert.equal(f.dirty,false);
});
test('missing and read-only scopes never create edits',()=>{const f=form('shell',[],false);assert.equal(f.fields()[0].available,false);f.stage('pwsh-sandbox','timeoutMs',5);assert.equal(f.dirty,false);});
test('Subagent numeric bounds and blank resets match desktop',()=>{
  const f=form('subagent',[section('subagent',{maxDepth:1,maxActiveSubagents:3})]),[depth,capacity]=f.definitions();
  assert.throws(()=>f.parse(depth,'-1'));assert.throws(()=>f.parse(depth,'1.5'));assert.throws(()=>f.parse(capacity,'0'));assert.equal(f.parse(depth,'0').value,0);assert.equal(f.parse(depth,'').reset,true);
});
test('saved unavailable models remain removable and enabled requires a model',()=>{
  const f=form('subagent',[section('subagent-model-selection-settings',{enabled:true,allowedModels:[{provider:'old',model:'gone'}]})]);assert.equal(f.modelRows([])[0].available,false);f.stage('subagent-model-selection-settings','allowedModels',[]);assert.throws(()=>f.validate());
});
test('Search API stages both selectors after provider settings with count validation',()=>{
  const f=form('web-search',[section('web',{searchProvider:'deepseek-official',fetchProvider:'http'}),section('web-search-deepseek',{maxUses:5}),section('web-deepseek-api',{count:10,apiKeyEnv:'CUSTOM_KEY'})]);f.selectApi(true);f.stage('web-deepseek-api','count',20);assert.equal(f.credentialRef(),'CUSTOM_KEY');assert.equal(f.operations().at(-1).ns,'web');assert.equal(f.operations().at(-1).ops.length,2);assert.throws(()=>f.parse(f.definitions()[1],'51'));assert.throws(()=>f.parse(f.definitions()[1],'1.2'));
});
test('save validates first and submits edits without copying untouched fields',async()=>{
  const {page,calls}=fixture();page.onConfigInput({currentTarget:{dataset:{id:'pwsh-sandbox:timeoutMs'}},detail:{value:'45000'}});const save=page.saveSettings();assert.equal(calls[0].type,'plugin-settings-mutate');assert.equal(calls[0].payload.ops.length,1);assert.equal(calls[0].payload.ops[0].value,45000);calls[0].resolve({});await tick();assert.equal(calls[1].type,'plugin-settings');calls[1].resolve({writable:true,namespaces:[section('pwsh-sandbox',{timeoutMs:45000})]});await save;assert.equal(page.data.config.fields[0].value,'45000');assert.equal(page.data.config.dirty,false);
});
test('revision conflicts preserve draft and block unsafe repeat until discard',async()=>{
  const {page,calls}=fixture();page.onConfigInput({currentTarget:{dataset:{id:'pwsh-sandbox:timeoutMs'}},detail:{value:'45000'}});const save=page.saveSettings();calls[0].reject(Object.assign(new Error('conflict'),{code:'settings/conflict'}));await save;assert.equal(page.data.config.fields[0].value,'45000');assert.equal(page.data.config.disabled,true);await page.saveSettings();assert.equal(calls.length,1);
});
test('host changes invalidate a pending read and clear secret drafts',async()=>{
  const {page,calls,store}=fixture();const pending=page.loadSettings();page.configSecret='not-for-new-host';store.state.activeID='b';page.syncSettings();calls[0].resolve({writable:true,namespaces:[section('pwsh-sandbox',{timeoutMs:999})]});await pending;assert.notEqual(page.configForm&&page.configForm.get('pwsh-sandbox','timeoutMs'),999);assert.equal(page.configSecret,'');calls[1].resolve({writable:true,namespaces:[]});await tick();
});
test('disconnect and reconnect retain drafts but require a fresh read',()=>{const {page,store}=fixture();page.configInputs['pwsh-sandbox:timeoutMs']='500';store.state.connection='disconnected';page.syncSettings();store.state.connection='connected';page.syncSettings();assert.equal(page.data.config.disabled,true);assert.equal(page.data.config.fields[0].value,'500');});
test('English configuration copy includes hints and does not alter model identities',()=>{
  global.wx={getStorageSync:()=> 'en'};try{const f=form('subagent',[section('subagent',{maxDepth:1,maxActiveSubagents:4})]);assert.doesNotMatch(f.fields().map(x=>x.label+x.hint).join(''),/[\u3400-\u9fff]/);assert.equal(f.modelRows([{id:'provider',name:'My Provider',models:[{id:'model',name:'自定义模型'}]}])[0].model,'model');}finally{delete global.wx;}
});
test('translation supports exact desktop services and valid language identifiers',()=>{const f=form('cot-translation',[section('cot-translation',{provider:'bing',targetLanguage:'auto'})]);assert.deepEqual(f.definitions()[0].choices,['bing','google','deepseek-account','deepseek-official']);assert.throws(()=>f.parse(f.definitions()[1],'bad language'));assert.equal(f.parse(f.definitions()[1],'zh-CN').value,'zh-CN');});
test('credential bridge is idempotent, scoped, write-only and rejects unbound references',async()=>{
  const adapter=bridge.adapter('    settings: {');assert.equal(bridge.adapter(adapter),adapter);assert.throws(()=>bridge.adapter('bad'));
  const source="const types = [\n  'plugin-settings',\n];\nasync function handle(api,msg){const type=msg.type,requestId=msg.requestId;let value;if(type==='noop'){\n    } else if (type === 'plugin-settings') {}return value;}";
  const updated=bridge.management(source);assert.equal(bridge.management(updated),updated);const context={badRequest:()=>({error:true})};vm.createContext(context);vm.runInContext(updated,context);let saved;
  const api={settings:{describe:async()=>({writable:true,namespaces:[section('web-search-deepseek',{})]})},pluginConfiguration:{credentialDescribe:async()=>({DEEPSEEK_API_KEY:{configured:true,writable:true,value:'DO_NOT_RETURN'}}),credentialSet:async(ref,value)=>{saved=[ref,value];}}};
  const result=await context.handle(api,{type:'plugin-credential-describe',ref:'DEEPSEEK_API_KEY',requestId:'a'});assert.equal(result.configured,true);assert.ok(!JSON.stringify(result).includes('DO_NOT_RETURN'));
  assert.equal((await context.handle(api,{type:'plugin-credential-set',ref:'OTHER_SECRET',value:'x',requestId:'a'})).error,true);assert.equal(saved,undefined);
  await context.handle(api,{type:'plugin-credential-set',ref:'DEEPSEEK_API_KEY',value:'new-key',requestId:'a'});assert.deepEqual(saved,['DEEPSEEK_API_KEY','new-key']);
  api.pluginConfiguration.credentialSet=async()=>{throw Error('secret-value')};const error=await context.handle(api,{type:'plugin-credential-set',ref:'DEEPSEEK_API_KEY',value:'new-key',requestId:'a'});assert.ok(!JSON.stringify(error).includes('secret-value'));
});
test('speech operations use existing gateway response kinds',async()=>{
  const client=Object.create(GatewayClient.prototype);client.pendingRequests={};client.send=()=>true;for(const[type,kind]of [['speech-configure','speech-configured'],['speech-prepare','speech-preparing'],['speech-cancel-preparation','speech-preparation-cancelled']]){const result=client.requestPlugin(type,{requestId:type},1000);client.resolveCorrelated({kind,requestId:type});assert.equal((await result).kind,kind);}
});
test('ClawBot owner controls use a correlated paired-gateway request',async()=>{
  const sent=[];const client=Object.create(GatewayClient.prototype);client.pendingRequests={};client.send=frame=>{sent.push(frame);return true;};
  const pending=client.requestClawbot({action:'status'});assert.equal(sent[0].type,'clawbot-control');assert.equal(sent[0].action,'status');
  assert.equal(client.pendingRequests['clawbot:'+sent[0].requestId].expectedKind,'clawbot-control');
  assert.equal(client.pendingRequests['plugin:'+sent[0].requestId],undefined,'ClawBot controls do not use the plugin-management request lane');
  client.resolveCorrelated({kind:'clawbot-control',requestId:sent[0].requestId,value:{supported:true,revision:1}});
  assert.equal((await pending).value.supported,true);
});
test('voice view renders actual progress, failure reason and available download sources',()=>{
  const {page}=fixture();page.voiceCatalog={selection:{providerId:'local',language:'zh'},providers:[{id:'local',name:'Local',location:'host-local',languages:['auto','zh'],downloadSources:['https://hf-mirror.com'],preparation:{phase:'failed',message:'bad',download:{reason:'dns',resource:'model',source:'https://hf-mirror.com',code:'DNS'},steps:[{kind:'model',status:'failed'}]}}]};page.renderVoiceSettings();assert.match(page.data.voice.providers[0].failure,/解析/);assert.equal(page.data.voice.providers[0].sources[0],'https://hf-mirror.com');assert.equal(page.data.voice.languageName,'中文');assert.equal(page.data.voice.providers[0].canPrepare,true);
});
test('no namespace-only placeholders remain in builtin details',()=>{const xml=fs.readFileSync(path.join(root,'pages/plugin-detail/plugin-detail.wxml'),'utf8');assert.ok(xml.includes('include src="settings-form.wxml"'));assert.ok(!xml.includes('wx:for="{{official.namespaces}}"'));});

test('all configuration template handlers are implemented by the detail page',()=>{
  const {page}=fixture();const detail=fs.readFileSync(path.join(root,'pages/plugin-detail/plugin-detail.js'),'utf8');
  for(const name of ['settings-form.wxml','voice-settings.wxml']){const xml=fs.readFileSync(path.join(root,'pages/plugin-detail',name),'utf8');for(const match of xml.matchAll(/(?:bind|catch)(?:tap|change|input)="([^"]+)"/g))assert.ok(typeof page[match[1]]==='function'||detail.includes(match[1]+'('),match[1]);}
});
test('unknown credential endpoints fail promptly without touching other requests',async()=>{
  const client=Object.create(GatewayClient.prototype);client.pendingRequests={};client.send=()=>true;
  const pending=client.requestPlugin('plugin-credential-describe',{requestId:'key'},1000);
  client.resolveCorrelated({kind:'error',message:'unknown message type: plugin-credential-describe'});
  await assert.rejects(pending);assert.equal(Object.keys(client.pendingRequests).length,0);
});
