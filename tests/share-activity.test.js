'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
function fixture() {
  let definition; const calls=[];
  const state={rules:{enabled:true,tiers:[{from:1,days:3},{from:11,days:7},{from:16,days:30}],momentsDays:3},earnedDays:0,validOpens:0,moments:[],records:[],inviteToken:''};
  const api={ensureAccount:async()=>({isAdmin:false}),shareStatus:async()=>state,shareInvite:async()=>({...state,inviteToken:'X'.repeat(32)}),recordShareOpen:async token=>{calls.push(token);return {counted:true};}};
  const wx={showModal:o=>{wx.modal=o;},showToast(){},chooseMedia:o=>{wx.choice=o;},reLaunch(){},getFileSystemManager:()=>({readFileSync:()=> 'iVBOR-test'})};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../pages/share-activity/share-activity.js'),'utf8'),{Page:x=>{definition=x;},require:n=>n.endsWith('access-api')?api:{applyTo(){}},wx,Date});
  const page={...definition,data:JSON.parse(JSON.stringify(definition.data)),setData(v){Object.assign(this.data,v);}};
  return {page,api,state,calls,wx};
}
test('share callbacks only return links; explicit verified visitor confirmation awards once',async()=>{
  const {page,calls}=fixture();page.onLoad({ref:'R'.repeat(32)});await page.onShow();
  assert.equal(calls.length,0);assert.equal(page.data.incoming,true);
  assert.equal(page.onShareTimeline().query,'timeline=1');page.onShareAppMessage();assert.equal(calls.length,0);
  await page.acceptInvitation();await page.acceptInvitation();assert.equal(calls.length,1);assert.equal(page.data.accepted,true);
});
test('own sharing gets a referral link, paused campaign stays disabled, stale load cannot populate',async()=>{
  const {page,api,state}=fixture();page.onLoad({rules:'1'});await page.onShow();
  assert.equal(page.data.rulesOpen,true);assert.match(page.onShareAppMessage().path,/[?]ref=X/);
  state.rules.enabled=false;await page.refresh();assert.equal(page.data.enabled,false);assert.equal(page.data.inviteToken,'');
  let done;api.shareStatus=()=>new Promise(r=>{done=r;});
  const pending=page.refresh();await new Promise(resolve=>setImmediate(resolve));page.onUnload();done({...state,earnedDays:999});await pending;
  assert.equal(page.data.earnedDays,0);
});
test('Moments explains review and only uploads after consent; picker return preserves pending work',async()=>{
  const {page,api,wx}=fixture();page.onLoad({});await page.onShow();
  page.momentsGuide();assert.match(wx.modal.content,/人工审核/);
  let uploads=0;api.momentsStart=async()=>{uploads++;return await api.shareStatus();};
  page.uploadProof({currentTarget:{dataset:{}}});assert.equal(uploads,0);
  wx.modal.success({confirm:true});assert.ok(wx.choice);const generation=page._generation;
  page.onShow();assert.equal(page._generation,generation);
  await wx.choice.success({tempFiles:[{size:999999,tempFilePath:'test'}]});assert.equal(uploads,0);assert.match(page.data.error,/330KB/);
});
test('settings hides ordinary identity, removes admin pairing entry, keeps node scanning and sharing',()=>{
  const html=fs.readFileSync(path.join(__dirname,'../pages/settings/settings.wxml'),'utf8');
  const at=html.indexOf('<view class="group-title">微信身份</view>');
  assert.ok(html.slice(at-48,at).includes('wx:if="{{isWechatAdmin}}"'));
  assert.ok(!html.includes('bindtap="openPairingManagement"'));
  assert.ok(html.includes('bindtap="addNode"'));
  assert.ok(html.includes('open-type="share" data-referral="true"'));
  assert.ok(html.includes('bindtap="openShareRules"'));
});
