'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createService } = require('../server.cjs');
const { DEFAULT_RULES } = require('../engagement.cjs');
const DAY = 86400000, ORIGIN = 'http://127.0.0.1:8790';
const PASSWORD = 'engagement-fixture-password-only';
const PROOF = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aOioAAAAASUVORK5CYII=';
test('deploy images include engagement and only proof endpoints receive larger request bodies',()=>{
  const dockerfile=fs.readFileSync(path.join(__dirname,'../Dockerfile'),'utf8');assert.ok(dockerfile.includes('durations.cjs engagement.cjs'));
  for(const file of ['../Caddyfile','../../../deploy/Caddyfile']) {
    const source=fs.readFileSync(path.join(__dirname,file),'utf8');
    assert.ok(source.includes('@shareProof path /share/moments/start /share/moments/submit'));
    assert.ok(source.includes('max_size 470000'));assert.ok(source.includes('max_size 16KB'));
  }
});
async function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-engagement-test-'));
  let clock = Date.parse('2026-10-18T01:00:00Z'), cookie = '', csrf = '', server, base;
  const stateFile = path.join(dir,'state.json');
  const options = { stateFile, now:()=>clock, exchangeCode:async code => /^[a-z0-9-]+$/.test(code) ? 'wechat-verified-' + code : '', consoleOptions:{origin:ORIGIN,masterKey:'ab'.repeat(32),setupToken:'fixture-setup-token-never-use-in-production'} };
  async function start() { server=createService(options); await new Promise(r=>server.listen(0,'127.0.0.1',r)); base='http://127.0.0.1:'+server.address().port; }
  async function stop() { server.closeAllConnections(); await new Promise(r=>server.close(r)); }
  await start();
  t.after(async()=>{await stop();fs.rmSync(dir,{recursive:true,force:true});});
  async function call(route,data,token,extra={}) {
    const isWeb = route.startsWith('/console/api');
    const response=await fetch(base+route,{method:data===undefined?'GET':'POST',headers:{'Content-Type':'application/json',Origin:ORIGIN,...(isWeb?{Cookie:cookie,'X-CSRF-Token':csrf}:{}),...(token?{Authorization:'Bearer '+token}:{}),...extra},...(data===undefined?{}:{body:JSON.stringify(data)})});
    if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];
    const value=await response.json();if(value.csrf)csrf=value.csrf;
    return {...value,status:response.status};
  }
  await call('/console/api/setup',{password:PASSWORD,setupToken:options.consoleOptions.setupToken});
  return {call,login:code=>call('/session',{code}),stateFile,options,
    tick:ms=>{clock+=ms;},now:()=>clock,
    webLogin:()=>call('/console/api/login',{password:PASSWORD}),
    enable:()=>call('/console/api/share/rules',{...DEFAULT_RULES,enabled:true}),
    restart:async()=>{await stop();await start();cookie='';csrf='';await call('/console/api/login',{password:PASSWORD});}
  };
}
test('device binding maps only server-issued IDs to verified WeChat identity and requires console CSRF',async t=>{
  const f=await fixture(t), user=await f.login('alice');
  assert.match(user.account.deviceId,/^WX-[A-F0-9]{24}$/);
  assert.equal(user.account.isAdmin,false);
  const forged=await f.call('/session',{code:'mallory',deviceId:user.account.deviceId,openid:'wechat-verified-alice',isAdmin:true});
  assert.notEqual(forged.account.deviceId,user.account.deviceId);assert.equal(forged.account.isAdmin,false);
  assert.equal((await f.login('alice')).account.deviceId,user.account.deviceId);
  assert.equal((await f.call('/console/api/admins/device',{deviceId:user.account.deviceId},{},{'X-CSRF-Token':'wrong'})).status,403);
  assert.equal((await f.call('/console/api/admins/device',{deviceId:'WX-'+'F'.repeat(24)})).status,404);
  assert.equal((await f.call('/console/api/admins/device',{deviceId:'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'})).status,400);
  assert.equal((await f.call('/console/api/admins/device',{deviceId:user.account.deviceId,label:'Alice'})).status,200);
  assert.equal((await f.call('/me',undefined,user.token)).account.isAdmin,true);
  assert.equal((await f.call('/me',undefined,forged.token)).account.isAdmin,false);
  await f.call('/console/api/admins/remove',{openid:'wechat-verified-alice'});
  assert.equal((await f.call('/admin/codes',undefined,user.token)).status,403);
  f.tick(DAY+1);await f.webLogin();
  assert.equal((await f.call('/console/api/admins/device',{deviceId:user.account.deviceId})).status,404);
  await f.restart();assert.equal((await f.login('alice')).account.deviceId,user.account.deviceId);
});
test('web and miniapp copy encrypted codes and deletion retains redeemed access across restart',async t=>{
  const f=await fixture(t), admin=await f.login('admin'), user=await f.login('user');
  await f.call('/console/api/admins/device',{deviceId:admin.account.deviceId});
  const code=await f.call('/admin/codes',{days:7,uses:5},admin.token);
  assert.equal(code.status,201);assert.equal(code.canCopy,true);
  assert.equal(fs.readFileSync(f.stateFile,'utf8').includes(code.code),false);
  assert.equal((await f.call('/console/api/codes/'+code.id+'/copy',{})).code,code.code);
  assert.equal((await f.call('/admin/codes/'+code.id+'/copy',{},user.token)).status,403);
  assert.equal((await f.call('/admin/codes/'+code.id+'/delete',{},user.token)).status,403);
  const redeemed=await f.call('/redemptions',{code:code.code},user.token);assert.equal(redeemed.status,200);
  assert.throws(()=>createService({...f.options,consoleOptions:{...f.options.consoleOptions,masterKey:'cd'.repeat(32)}}));
  await f.restart();
  const admin2=await f.login('admin');
  assert.equal((await f.call('/admin/codes/'+code.id+'/copy',{},admin2.token)).code,code.code);
  assert.equal((await f.call('/console/api/codes/'+code.id+'/delete',{})).status,200);
  assert.equal((await f.call('/admin/codes',undefined,admin2.token)).items.length,0);
  assert.equal((await f.call('/admin/codes/'+code.id+'/copy',{},admin2.token)).status,404);
  const second=await f.login('second');
  assert.equal((await f.call('/redemptions',{code:code.code},second.token)).code,'CODE_UNAVAILABLE');
  const oldUser=await f.login('user');assert.equal(oldUser.account.publicAccessExpiresAt,redeemed.expiresAt);
  const stored=Object.values(JSON.parse(fs.readFileSync(f.stateFile)).codes)[0];
  assert.ok(stored.deletedAt);assert.equal(stored.sealedCode,undefined);
});
test('friend campaign is opt-in, deduplicates across links/restart, and tier boundaries grant atomically',async t=>{
  const f=await fixture(t), owner=await f.login('owner');
  assert.equal((await f.call('/share/invite',{},owner.token)).code,'CAMPAIGN_PAUSED');
  assert.equal((await f.call('/share/open',{token:'x'.repeat(32)})).status,401);
  assert.equal((await f.enable()).status,200);
  const invitation=await f.call('/share/invite',{},owner.token);
  assert.equal((await f.call('/share/open',{token:invitation.inviteToken},owner.token)).reason,'self');
  for(let i=1;i<=16;i++) {
    const visitor=await f.login('visitor'+i);
    const results=await Promise.all([1,2].map(()=>f.call('/share/open',{token:invitation.inviteToken,days:36500,expiresAt:99999999999999},visitor.token)));
    assert.equal(results.filter(x=>x.counted).length,1);
    if([10,11,15,16].includes(i)) {
      const summary=await f.call('/share',undefined,owner.token);
      assert.equal(summary.validOpens,i);assert.equal(summary.earnedDays,i<=10?30:i===11?37:i===15?65:95);
    }
  }
  assert.equal((await f.call('/me',undefined,owner.token)).account.publicAccessExpiresAt,f.now()+95*DAY);
  f.tick(60001);await f.restart();
  const another=await f.login('another'),again=await f.login('visitor1');
  const otherInvite=await f.call('/share/invite',{},another.token);
  assert.equal((await f.call('/share/open',{token:otherInvite.inviteToken},again.token)).reason,'duplicate');
  assert.equal((await f.call('/share',undefined,another.token)).earnedDays,0);
  assert.equal((await f.call('/share/open',{token:'__proto__'},again.token)).status,400);
  const stored=JSON.parse(fs.readFileSync(f.stateFile));assert.deepEqual(stored.codes,{});assert.deepEqual(stored.redemptions,{});
});
test('Moments requires two proofs, elapsed 24h, owner match, admin review, and one reward per day',async t=>{
  const f=await fixture(t);await f.enable();
  let user=await f.login('poster'),other=await f.login('other');
  assert.equal((await f.call('/share/moments/start',{proof:'data:image/png;base64,AAAA'},user.token)).status,400);
  const start=await f.call('/share/moments/start',{proof:PROOF,days:365,status:'approved'},user.token);
  const item=start.moments[0];assert.equal(item.status,'waiting');assert.equal(item.days,3);assert.equal(item.initialProof,undefined);
  assert.equal((await f.call('/share/moments/start',{proof:PROOF},user.token)).moments.length,1);
  assert.equal((await f.call('/share/moments/submit',{id:item.id,proof:PROOF},user.token)).code,'WAIT_24H');
  assert.equal((await f.call('/share/moments/submit',{id:item.id,proof:PROOF},other.token)).status,404);
  assert.equal((await f.call('/console/api/share/review',{id:item.id,action:'approve'})).status,409);
  f.tick(DAY);user=await f.login('poster');await f.webLogin();
  const pending=await f.call('/share/moments/submit',{id:item.id,proof:PROOF},user.token);
  assert.equal(pending.moments[0].status,'pending');assert.equal(pending.earnedDays,0);
  const review=await f.call('/console/api/share');assert.equal(review.items[0].initialProof,undefined);assert.equal(review.items[0].hasProof,true);
  assert.equal((await f.call('/console/api/share/proof/'+item.id)).finalProof,PROOF);
  const decisions=await Promise.all([1,2].map(()=>f.call('/console/api/share/review',{id:item.id,action:'approve'})));
  assert.ok(decisions.every(x=>x.status===200));
  const summary=await f.call('/share',undefined,user.token);assert.equal(summary.earnedDays,3);assert.equal(summary.records.length,1);
  assert.equal((await f.call('/console/api/share/proof/'+item.id)).initialProof,'');
  assert.equal((await f.call('/me',undefined,user.token)).account.publicAccessExpiresAt,f.now()+3*DAY);
  const next=await f.call('/share/moments/start',{proof:PROOF},user.token);assert.equal(next.moments.length,2);
  f.tick(7*DAY);await f.webLogin();
  const cleaned=await f.call('/console/api/share');assert.equal(cleaned.items[0].status,'expired');
  assert.equal(fs.readFileSync(f.stateFile,'utf8').includes(PROOF),false);
});
test('rules reject malformed tiers, are admin-only, and paused campaigns cannot award or submit',async t=>{
  const f=await fixture(t);await f.enable();const user=await f.login('pause');
  assert.equal((await f.call('/console/api/share/rules',{...DEFAULT_RULES,enabled:true,tiers:[{from:1,days:0},{from:2,days:3},{from:2,days:5}]})).status,400);
  const invitation=await f.call('/share/invite',{},user.token);
  const started=await f.call('/share/moments/start',{proof:PROOF},user.token);
  assert.equal((await f.call('/console/api/share/rules',DEFAULT_RULES,undefined,{Cookie:'','X-CSRF-Token':''})).status,401);
  await f.call('/console/api/share/rules',DEFAULT_RULES);
  assert.equal((await f.call('/share/open',{token:invitation.inviteToken},user.token)).code,'CAMPAIGN_PAUSED');
  assert.equal((await f.call('/share/moments/submit',{id:started.moments[0].id,proof:PROOF},user.token)).code,'CAMPAIGN_PAUSED');
});
