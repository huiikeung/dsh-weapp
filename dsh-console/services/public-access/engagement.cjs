'use strict';
const crypto = require('node:crypto');
const DAY = 86400000;
const hash = s => crypto.createHash('sha256').update(s).digest('hex');
const fail = (status, code, message) => Object.assign(new Error(message), { status, code });
const DEFAULT_RULES = { enabled: false, tiers: [{ from: 1, days: 3 }, { from: 11, days: 7 }, { from: 16, days: 30 }], momentsDays: 3 };
// WeChat OpenID is the identity boundary, never a caller-chosen device ID.
function createEngagement({ getState, commit, now, limit }) {
  const saved = getState().engagement;
  if (saved) {
    const object = value => value && typeof value === 'object' && !Array.isArray(value);
    if (!object(saved) || ['identities','invites','visitors','rewards','moments'].some(key => !object(saved[key])) ||
      !object(saved.rules) || typeof saved.rules.enabled !== 'boolean' || !Array.isArray(saved.rules.tiers) || saved.rules.tiers.length !== 3 || saved.rules.tiers[0]?.from !== 1 ||
      saved.rules.tiers.some((r,i,a) => !Number.isSafeInteger(r.from) || r.from < 1 || r.from > 10000 || !Number.isSafeInteger(r.days) || r.days < 1 || r.days > 365 || i && r.from <= a[i-1].from) ||
      !Number.isSafeInteger(saved.rules.momentsDays) || saved.rules.momentsDays < 1 || saved.rules.momentsDays > 365 ||
      Object.entries(saved.identities).some(([key,r]) => !r || typeof r.openid !== 'string' || hash(r.openid) !== key || !/^WX-[A-F0-9]{24}$/.test(r.deviceId) || !Number.isSafeInteger(r.lastSeenAt)) ||
      Object.entries(saved.invites).some(([key,r]) => !r || r.token !== key || !/^[A-Za-z0-9_-]{32}$/.test(key) || !saved.identities[r.owner]) ||
      Object.values(saved.visitors).some(r => !r || !saved.identities[r.owner]) ||
      Object.values(saved.rewards).some(r => !r || !saved.identities[r.owner] || !Number.isSafeInteger(r.days) || r.days < 1) ||
      Object.values(saved.moments).some(r => !r || !saved.identities[r.owner] || !Number.isSafeInteger(r.createdAt) || !Number.isSafeInteger(r.eligibleAt) || !['waiting','pending','approved','rejected','expired'].includes(r.status)))
      throw new Error('Invalid engagement state; refusing to discard identities or rewards');
  }
  const state = () => getState().engagement || { identities: {}, invites: {}, visitors: {}, rewards: {}, moments: {}, rules: DEFAULT_RULES };
  function update(fn) { return commit(next => { next.engagement ||= { identities: {}, invites: {}, visitors: {}, rewards: {}, moments: {}, rules: DEFAULT_RULES }; return fn(next.engagement, next); }); }
  function identify(openid) {
    const key = hash(openid), old = state().identities[key];
    if (!old || now() - old.lastSeenAt > 60000) update(s => {
      s.identities[key] ||= { deviceId: 'WX-' + crypto.randomBytes(12).toString('hex').toUpperCase(), openid, createdAt: now() };
      s.identities[key].lastSeenAt = now();
    });
    return state().identities[key];
  }
  function resolveDevice(id) {
    if (!/^WX-[A-F0-9]{24}$/.test(id || '')) throw fail(400, 'INVALID_DEVICE_ID', '请输入小程序公网访问中的 WX- 设备 ID，不是电脑节点 ID');
    const found = Object.values(state().identities).find(x => x.deviceId === id);
    if (!found || now() - found.lastSeenAt > DAY) throw fail(404, 'DEVICE_NOT_VERIFIED', '请先让该微信打开小程序设置完成身份识别，再输入设备 ID（24 小时内有效）');
    return found;
  }
  function rules() { return structuredClone(state().rules || DEFAULT_RULES); }
  function cleanup() {
    const stale = Object.values(state().moments).filter(x => (x.initialProof || x.finalProof) && now() - x.createdAt >= 7 * DAY);
    if (stale.length) update(s => { for (const old of stale) { const item = s.moments[old.id]; delete item.initialProof; delete item.finalProof; if (['waiting','pending'].includes(item.status)) { item.status = 'expired'; item.note = '凭证超过 7 天未完成审核，已删除'; } } });
  }
  function saveRules(input) {
    const tiers = input.tiers;
    if (typeof input.enabled !== 'boolean' || !Array.isArray(tiers) || tiers.length !== 3 || tiers[0]?.from !== 1 || tiers.some((t,i) => !t || !Number.isSafeInteger(t.from) || t.from < 1 || t.from > 10000 || !Number.isSafeInteger(t.days) || t.days < 1 || t.days > 365 || i && t.from <= tiers[i-1].from) || !Number.isSafeInteger(input.momentsDays) || input.momentsDays < 1 || input.momentsDays > 365) throw fail(400, 'INVALID_RULES', '请填写递增的人数门槛和 1–365 天奖励');
    update(s => { s.rules = { enabled: input.enabled, tiers: tiers.map(({from,days})=>({from,days})), momentsDays: input.momentsDays }; });
    return rules();
  }
  function grant(next, owner, days, rewardId, metadata) {
    if (next.engagement.rewards[rewardId]) return next.engagement.rewards[rewardId];
    const expiresAt = Math.max(next.access[owner]?.expiresAt || 0, now()) + days * DAY;
    if (!Number.isSafeInteger(expiresAt)) throw fail(400, 'INVALID_EXPIRY', '累计有效期过长');
    const reward = { id: rewardId, owner, days, expiresAt, createdAt: now(), ...metadata };
    next.access[owner] = { expiresAt, updatedAt: now() };
    next.engagement.rewards[rewardId] = reward;
    return reward;
  }
  function summary(openid) {
    cleanup();
    const owner = hash(openid), s = state();
    const invites = Object.values(s.invites).find(x => x.owner === owner);
    const rewards = Object.values(s.rewards).filter(x=>x.owner===owner);
    const moments = Object.values(s.moments).filter(x=>x.owner===owner).sort((a,b)=>b.createdAt-a.createdAt).slice(0,30).map(({initialProof,finalProof,owner,...rest})=>rest);
    return { deviceId: identify(openid).deviceId, rules: rules(), inviteToken: invites?.token || '',
      validOpens: Object.values(s.visitors).filter(x=>x.owner===owner).length,
      earnedDays: rewards.reduce((n,r)=>n+r.days,0), moments,
      records: rewards.sort((a,b)=>b.createdAt-a.createdAt).slice(0,30).map(({owner,...r})=>r) };
  }
  function invitation(openid) {
    if (!rules().enabled) throw fail(409, 'CAMPAIGN_PAUSED', '分享活动暂未开放');
    identify(openid);
    const owner = hash(openid);
    if (!Object.values(state().invites).some(x=>x.owner===owner)) update(s=>{const token=crypto.randomBytes(24).toString('base64url');s.invites[token]={token,owner,createdAt:now()};});
    return summary(openid);
  }
  function open(openid, token) {
    const rule = rules();
    if (!rule.enabled) throw fail(409, 'CAMPAIGN_PAUSED', '分享活动暂未开放');
    limit('referral-open:'+openid, 10);
    if (!/^[A-Za-z0-9_-]{32}$/.test(token || '')) throw fail(400, 'INVALID_INVITE', '分享链接无效');
    const invite=state().invites[token], visitor=hash(openid);
    if (!invite) throw fail(404, 'INVALID_INVITE', '分享链接不存在');
    if (invite.owner===visitor) return { counted:false, reason:'self' };
    if (state().visitors[visitor]) return { counted:false, reason:'duplicate' };
    return update((s,next)=>{
      // A single synchronous durable transaction deduplicates across all links.
      if (s.visitors[visitor]) return {counted:false,reason:'duplicate'};
      const count=Object.values(s.visitors).filter(x=>x.owner===invite.owner).length+1;
      const days=rule.tiers.filter(t=>count>=t.from).at(-1).days;
      s.visitors[visitor]={owner:invite.owner,createdAt:now()};
      grant(next,invite.owner,days,'friend:'+visitor,{kind:'friend',ordinal:count});
      return {counted:true};
    });
  }
  function proof(value) {
    if (typeof value!=='string' || value.length>460000 || !/^data:image[/](png|jpeg);base64,[A-Za-z0-9+/]+=*$/.test(value)) throw fail(400,'INVALID_PROOF','请上传 330KB 内的 PNG/JPEG 截图');
    const bytes=Buffer.from(value.split(',')[1],'base64');
    const png=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
    const jpg=bytes[0]===255 && bytes[1]===216 && bytes[2]===255;
    if(bytes.length<16||bytes.length>337920||!(value.startsWith('data:image/png;')?png:jpg))throw fail(400,'INVALID_PROOF','截图格式不正确');
    return value;
  }
  const dayKey = () => new Date(now()+8*3600000).toISOString().slice(0,10);
  function momentsStart(openid,input) {
    const rule=rules();if(!rule.enabled)throw fail(409,'CAMPAIGN_PAUSED','分享活动暂未开放');
    limit('moments-start:'+openid,5);
    identify(openid); cleanup();
    const owner=hash(openid),day=dayKey(),id=hash(owner+':'+day);
    if(state().moments[id])return summary(openid);
    const initialProof=proof(input.proof);
    update(s=>{s.moments[id]={id,owner,deviceId:identifyExisting(owner),day,status:'waiting',createdAt:now(),eligibleAt:now()+DAY,days:rule.momentsDays,initialProof};});
    return summary(openid);
  }
  function identifyExisting(owner){return state().identities[owner]?.deviceId||'';}
  function momentsSubmit(openid,input) {
    if(!rules().enabled)throw fail(409,'CAMPAIGN_PAUSED','分享活动暂未开放');
    cleanup();
    const owner=hash(openid),item=state().moments[input.id];
    if(!item||item.owner!==owner)throw fail(404,'NOT_FOUND','记录不存在');
    if(item.status!=='waiting')return summary(openid);
    if(now()<item.eligibleAt)throw fail(409,'WAIT_24H','需保留满 24 小时后提交复核截图');
    const finalProof=proof(input.proof);
    update(s=>Object.assign(s.moments[item.id],{status:'pending',submittedAt:now(),finalProof}));
    return summary(openid);
  }
  function reviewList(){cleanup();return {rules:rules(),items:Object.values(state().moments).sort((a,b)=>b.createdAt-a.createdAt).slice(0,100).map(({owner,initialProof,finalProof,...r})=>({...r,hasProof:!!initialProof}))};}
  function reviewProof(id){cleanup();const r=state().moments[id];if(!r)throw fail(404,'NOT_FOUND','记录不存在');return {initialProof:r.initialProof||'',finalProof:r.finalProof||''};}
  function review(input){
    cleanup();
    const item=state().moments[input.id];
    if(!item)throw fail(404,'NOT_FOUND','记录不存在');
    if(!['approve','reject'].includes(input.action))throw fail(400,'INVALID_REVIEW','请选择通过或拒绝');
    if(['approved','rejected'].includes(item.status)) {
      if (item.status !== (input.action === 'approve' ? 'approved' : 'rejected')) throw fail(409,'ALREADY_REVIEWED','该记录已被另一审核结果处理，请刷新');
      return {ok:true};
    }
    if(item.status!=='pending'||now()<item.eligibleAt)throw fail(409,'NOT_READY','尚未满足 24 小时及双截图复核条件');
    update((s,next)=>{
      Object.assign(s.moments[item.id],{status:input.action==='approve'?'approved':'rejected',reviewedAt:now(),note:String(input.note||'').slice(0,200)});
      if(input.action==='approve')grant(next,item.owner,item.days,'moments:'+item.id,{kind:'moments',day:item.day});
      // Remove screenshots after the decision; keep the immutable reward ledger.
      delete s.moments[item.id].initialProof;delete s.moments[item.id].finalProof;
    });return {ok:true};
  }
  const deviceIdFor = openid => state().identities[hash(openid)]?.deviceId || '';
  return {identify,deviceIdFor,resolveDevice,summary,invitation,open,momentsStart,momentsSubmit,reviewList,reviewProof,review,rules,saveRules,cleanup};
}
module.exports={createEngagement,DEFAULT_RULES};
