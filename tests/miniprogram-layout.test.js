const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),os=require('node:os');
const {execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'../miniprogram');
const app=JSON.parse(fs.readFileSync(path.join(root,'app.json'),'utf8'));
const routes=require('./helpers/routes.cjs')(app);
test('WeChat root contains only runtime files and all packages stay inside source budget',()=>{
  const checker=require('../scripts/check-miniprogram-package.cjs');const report=checker.check();assert.ok(report.groups[0].bytes<checker.MAIN_SOURCE_BUDGET);assert.ok(report.groups[0].mediaBytes<checker.MEDIA_BUDGET);assert.ok(report.packagedMediaBytes<checker.MEDIA_BUDGET);
  assert.equal(routes.length,19);assert.equal(new Set(routes).size,19);
  assert.ok(app.subPackages.some(pkg=>pkg.root==='pages/session'&&pkg.pages.includes('session')),'the large conversation page stays in its own on-demand package');
  assert.ok(app.preloadRule['pages/home/home'].packages.includes('pages/session'),'the conversation package preloads from home to keep navigation responsive');
  for(const route of routes)for(const ext of ['js','json','wxml','wxss'])assert.ok(fs.existsSync(path.join(root,route+'.'+ext)),route+'.'+ext);
  assert.equal(fs.existsSync(path.join(root,'../app.js')),false);
  for(const file of ['plugin-artwork.js','plugin-presentation.js','plugin-settings.js','plugin-settings-copy.js'])assert.equal(fs.existsSync(path.join(root,'utils',file)),false);
  assert.equal(fs.existsSync(path.join(root,'utils/schedule-editor.js')),false);
  assert.ok(fs.existsSync(path.join(root,'pages/plugin-detail/plugin-settings-copy.js')));
  assert.ok(report.groups.find(group=>group.name==='session').bytes<checker.BUDGET);
});
test('running whale status artwork is a compact 3x gray+alpha mask',()=>{
  // Keep the native status image crisp on high-density iPhone screens without restoring animated frames.
  const image=fs.readFileSync(path.join(root,'assets/icons/dsh-running-whale.png'));
  assert.equal(image.subarray(1,4).toString(),'PNG');
  assert.equal(image.readUInt32BE(16),84);assert.equal(image.readUInt32BE(20),84);
  assert.equal(image.readUInt8(24),8,'8-bit');assert.equal(image.readUInt8(25),4,'gray + alpha');
  assert.ok(image.length<8192,'mask must stay compact');
});
test('subpackages do not import each other and main package does not import subpackages',()=>{
  const roots=app.subPackages.map(p=>p.root+'/');const owner=f=>roots.find(r=>f.startsWith(r))||'';
  for(const f of fs.readdirSync(root,{recursive:true}).filter(f=>f.endsWith('.js'))){const file=f.replace(/\\/g,'/'),source=fs.readFileSync(path.join(root,file),'utf8');for(const m of source.matchAll(/require\(['"](\.[^'"]+)['"]\)/g)){
    const target=path.relative(root,path.resolve(root,path.dirname(file),m[1])).replace(/\\/g,'/');assert.ok(!target.startsWith('../'));assert.ok(!owner(target)||owner(file)===owner(target),'cross-package require '+file+' -> '+target);
  }}
});
function runtime(language,connected){
  const modules=new Map(),pages=[];
  const context=vm.createContext({console,setTimeout,clearTimeout,setInterval,clearInterval,App(){},Page:p=>pages.push(p),wx:{getStorageSync:key=>key==='appLanguage'?language:'',getAppBaseInfo:()=>({language:'zh_CN'}),getWindowInfo:()=>({windowWidth:375,windowHeight:812,statusBarHeight:44}),setNavigationBarTitle(){}}});
  function load(file){file=path.resolve(file);if(modules.has(file))return modules.get(file).exports;const module={exports:{}};modules.set(file,module);vm.runInContext('(function(require,module,exports){'+fs.readFileSync(file,'utf8')+'\n})',context,{filename:file})(id=>id==='crypto'?{}:load(path.resolve(path.dirname(file),id+'.js')),module,module.exports);return module.exports;}
  load(path.join(root,'app.js'));const store=load(path.join(root,'utils/store.js'));store.state.connection=connected?'connected':'disconnected';store.state.pluginCatalog=null;
  store.client.requestPlugin=async type=>type==='plugin-settings'?{writable:true,namespaces:[{ns:'pwsh-sandbox',revision:0,value:{timeoutMs:30000,maxOutputBytes:10000},base:{},user:{}},{ns:'agent-loop',revision:0,value:{maxParallelToolCalls:4},base:{},user:{}},{ns:'subagent',revision:0,value:{maxDepth:2,maxActiveSubagents:4},base:{},user:{}},{ns:'web-search-deepseek',revision:0,value:{baseURL:'https://example.test',maxUses:5},base:{},user:{}}]}:{result:{configured:false,writable:false}};
  store.client.requestModels=async()=>({groups:[]});load(path.join(root,'pages/plugin-detail/plugin-detail.js'));const definition=pages[0];
  return {page:{...definition,data:JSON.parse(JSON.stringify(definition.data)),route:'pages/plugin-detail/plugin-detail',setData(patch){Object.assign(this.data,JSON.parse(JSON.stringify(patch)));}},load};
}
const next=()=>new Promise(resolve=>setImmediate(resolve));
for(const language of ['zh','en'])for(const id of ['shell','agent-loop','subagent','web-search'])test('builtin '+id+' executes onLoad and shows form without catalog ('+language+')',async()=>{
  const {page}=runtime(language,true);page.onLoad({official:id});page.onShow();await next();await next();assert.equal(page.data.official.id,id);assert.equal(page.data.configStatus,'ready');assert.ok(page.data.detailScrollHeight>500);assert.ok(page.data.config.fields.length>0);if(language==='en')assert.doesNotMatch(page.data.config.fields.map(f=>f.label+f.hint).join(''),/[\u3400-\u9fff]/);page.onUnload();
});
test('offline direct entry remains visible with explicit disconnected state',()=>{const {page}=runtime('zh',false);page.onLoad({official:'subagent'});assert.equal(page.data.official.title,'子智能体');assert.equal(page.data.connected,false);assert.ok(page.data.detailScrollHeight>0);page.onUnload();});
const compiler=process.env.WECHAT_WCC || 'D:/Program Files (x86)/Tencent/微信web开发者工具/resources/app.asar.unpacked/node_modules/wcc-exec/wcc.exe';
test('every page WXML compiles: an unbalanced <block>/<view> breaks the whole build',{skip:!fs.existsSync(compiler)},()=>{
  // wcc 只报第一个错误就退出，所以逐个编译，让失败的页面名直接出现在信息里。
  const pages=routes.map(route=>route+'.wxml');
  const failures=[];
  for(const page of pages){
    try{execFileSync(compiler,['-o',path.join(os.tmpdir(),'dsh-wxml-check.js'),page],{cwd:root,stdio:'pipe'});}
    catch(err){failures.push(page+': '+String(err.stderr||err.message).split('\n').filter(l=>l.trim()).slice(0,3).join(' | '));}
  }
  assert.deepEqual(failures,[],'WXML 编译失败');
});
test('native-compiled WXML renders all builtin form labels and error/offline states',{skip:!fs.existsSync(compiler)},()=>{
  const output=path.join(os.tmpdir(),'dsh-detail-render-'+process.pid+'.js');execFileSync(compiler,['-o',output,'pages/plugin-detail/plugin-detail.wxml','pages/plugin-detail/settings-form.wxml','pages/plugin-detail/voice-settings.wxml'],{cwd:root});
  const context=vm.createContext({window:{},console});vm.runInContext(fs.readFileSync(output,'utf8'),context);const render=context.$gwx('pages/plugin-detail/plugin-detail.wxml');const prefs=require('../miniprogram/utils/ui-preferences'),{PluginSettings}=require('../miniprogram/pages/plugin-detail/plugin-settings');
  for(const id of ['shell','agent-loop','subagent','web-search']){const model=new PluginSettings(id,{namespaces:[],writable:false}),fields=model.fields();const tree=JSON.stringify(render({mode:'official',official:{title:id},detailScrollHeight:600,configStatus:'ready',config:{kind:id,fields,labels:{}},...prefs.snapshot()},{},{}));for(const field of fields)assert.ok(tree.includes(field.label),id+' missing '+field.label);assert.ok(tree.includes('height: 600px'));}
  const snapshot=prefs.snapshot();const offline=JSON.stringify(render({mode:'official',official:{title:'终端'},connected:false,...snapshot},{},{}));assert.ok(offline.includes('网关已断开'));
  const failed=JSON.stringify(render({mode:'official',official:{title:'终端'},connected:true,configStatus:'error',configError:'无法加载插件设置，请确认网关版本并重试。',...snapshot},{},{}));assert.ok(failed.includes('无法加载插件设置'));assert.ok(failed.includes('重试'));
});
