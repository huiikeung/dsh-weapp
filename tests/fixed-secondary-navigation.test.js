const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../miniprogram');
const read=f=>fs.readFileSync(path.join(root,f),'utf8');
function rule(css,selector){const start=css.indexOf(selector+' {');assert.ok(start>=0,selector);return css.slice(start,css.indexOf('}',start)+1);}
for(const [page,selector,spacer] of [['settings','.settings .nav','nav-placeholder'],['session-settings','.session-nav','session-nav-placeholder']])test(page+' pins opaque navigation and reserves capsule-safe space',()=>{
 const base='pages/'+page+'/'+page,header=rule(read(base+'.wxss'),selector),xml=read(base+'.wxml');
 for(const property of ['position: fixed','top: 0','left: 0','right: 0','background: var(--bg)','box-sizing: content-box','z-index: 10','padding-left: 40rpx'])assert.ok(header.includes(property),property);
 const at=xml.indexOf('class="'+spacer+'"');assert.ok(at>xml.indexOf('bindtap="goBack"'));assert.ok(at<xml.indexOf('class="group-title"'));
 assert.ok(xml.includes('height:{{navPadTop + navHeight}}px;" aria-hidden="true"'));
 assert.notEqual(JSON.parse(read(base+'.json')).disableScroll,true,'body still needs native page scrolling');
});
for(const [page,selector]of [['add-node','.body'],['plugins','.plugins-scroll'],['schedule','.sched-scroll'],['plugin-detail','.pdetail-scroll']])test(page+' keeps navigation outside a bounded content scroll area',()=>{
 const base='pages/'+page+'/'+page,css=read(base+'.wxss'),xml=read(base+'.wxml');assert.equal(JSON.parse(read(base+'.json')).disableScroll,true);
 assert.match(css,/height:\s*100vh/);assert.match(css,/overflow:\s*hidden/);
 const scroll=rule(css,selector);assert.match(scroll,/min-height:\s*0/);
 assert.ok(xml.indexOf('bindtap="goBack"')<xml.indexOf('<scroll-view'));
 if(page!=='plugin-detail')assert.match(scroll,/height:\s*0/);
 else assert.match(xml,/height: {{detailScrollHeight}}px/);
});
