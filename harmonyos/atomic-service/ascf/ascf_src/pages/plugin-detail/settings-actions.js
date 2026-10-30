const store = require('../../utils/store');
const { t } = require('../../utils/ui-preferences');
const { PluginSettings, kindFor, routeKey } = require('./plugin-settings');
const copy = require('./plugin-settings-copy');
// Keep this dependency explicit so lazy subpackage builds include voice actions.
const voiceActions = require('./voice-actions');
module.exports = Object.assign({}, voiceActions, {
  settingsOwner() { return [store.state.activeID,store.state.endpoint,store.state.gatewayId].join('|'); },
  syncSettings() {
    const owner=this.settingsOwner(), connected=store.state.connection === 'connected';
    if (owner !== this.configOwner) { this.configOwner=owner; this.configGeneration=(this.configGeneration||0)+1; this.configForm=null; this.configInputs={}; this.configSecret=''; this.configModels=[]; this.configCredential=null; this.configBlocked=false; this.configProviders=null; this.voiceCatalog=null; this.voiceSources={}; this.voiceExpanded={}; clearTimeout(this.voiceTimer); this.setData({voice:null,voiceBusy:false,voiceError:'',config:null,configError:'',configStatus:'idle',configSaving:false}); }
    const kind=kindFor(this.officialId,this.bundleName);
    if (!kind) return;
    if (!connected) { if(this.configConnected) {this.configGeneration++;this.setData({configStatus:'idle',configSaving:false});} this.configConnected=false; this.configBlocked=true;clearTimeout(this.voiceTimer); this.renderSettings(); return; }
    if (!this.configConnected) { this.configConnected=true; if(this.configForm && this.configDirty()) {this.setData({configError:t('连接已变化，请放弃修改后重新加载设置。')});this.renderSettings();return;} this.configForm=null;this.setData({configStatus:'idle'}); }
    if(this.data.configStatus === 'idle' && !this.configForm) this.loadSettings();
    else this.renderSettings();
  },
  configDirty() {return !!(this.configForm && this.configForm.dirty || Object.keys(this.configInputs||{}).length || this.configSecret);},
  async loadSettings() {
    if (store.state.connection !== 'connected' || this.data.configSaving) return;
    const kind=kindFor(this.officialId,this.bundleName); if(!kind) return;
    const generation=this.configGeneration=(this.configGeneration||0)+1, owner=this.settingsOwner();
    this.configBlocked=true;this.setData({configStatus:'loading',configError:''});this.renderSettings();
    try {
      const response=await store.client.requestPlugin('plugin-settings');
      if(this.configDisposed || generation!==this.configGeneration || owner!==this.settingsOwner()) return;
      if(!Array.isArray(response.namespaces)) throw new Error('invalid settings');
      this.configForm=new PluginSettings(kind,response);this.configInputs={};this.configSecret='';this.configCredential=null;this.configBlocked=false;this.configProviders=null;
      this.setData({configStatus:'ready'});this.renderSettings();
      if(kind==='subagent') this.loadConfigModels();
      if(kind==='web-search') this.loadConfigCredential();
      if(kind==='cot-translation') this.loadConfigProviders();
      if(kind==='voice') this.loadVoiceSettings();
    } catch(error) {if(!this.configDisposed && generation===this.configGeneration && owner===this.settingsOwner())this.setData({configStatus:'error',configError:t('无法加载插件设置，请确认网关版本并重试。')});}
  },
  renderSettings() {
    const f=this.configForm;if(!f)return;const c=copy[f.kind]||{},labels={};for(const k of Object.keys(c))labels[k]=t(c[k]);
    const fields=f.fields().map(field=>({...field,value:Object.prototype.hasOwnProperty.call(this.configInputs||{},field.id)?this.configInputs[field.id]:field.value}));
    if(f.kind==='cot-translation') for(const field of fields) if(field.key==='provider') {field.choices=this.configProviders||[];field.choiceLabels=field.choices.map(x=>t(c[{bing:'bing',google:'google','deepseek-account':'deepseekAccount','deepseek-official':'deepseekOfficial'}[x]]||x));field.choiceIndex=field.choices.indexOf(field.value);field.choiceLabel=field.choiceLabels[field.choiceIndex]||t(c[{bing:'bing',google:'google','deepseek-account':'deepseekAccount','deepseek-official':'deepseekOfficial'}[field.value]]||field.value);}
    const ns='subagent-model-selection-settings';
    this.setData({configProvidersUnavailable:f.kind==='cot-translation'&&!this.configProviders,config:{kind:f.kind,labels,fields,writable:f.writable,disabled:!f.writable||store.state.connection!=='connected'||this.data.configSaving||this.configBlocked,dirty:this.configDirty(),useSearchApi:f.searchApi(),switchAvailable:!!f.sections.web&&!!f.sections['web-deepseek-api'],modelAvailable:!!f.sections[ns],modelEnabled:!!f.get(ns,'enabled'),models:f.modelRows(this.configModels||[]),credential:this.configCredential,secret:this.configSecret||'',translationPaid:['deepseek-account','deepseek-official'].includes((this.configInputs||{})['cot-translation:provider'] || f.get('cot-translation','provider'))}});
  },
  onConfigInput(e) {if(!this.configForm||this.data.config.disabled)return;this.configInputs[e.currentTarget.dataset.id]=e.detail.value;this.setData({configError:''});this.renderSettings();},
  onConfigChoice(e) {const field=this.data.config.fields.find(f=>f.id===e.currentTarget.dataset.id);if(field && !this.data.configProvidersUnavailable && field.choices[Number(e.detail.value)] !== undefined)this.onConfigInput({currentTarget:e.currentTarget,detail:{value:field.choices[Number(e.detail.value)]}});},
  resetConfigField(e) {if(!this.configForm||this.data.config.disabled)return;const field=this.configForm.definitions().find(f=>f.ns+':'+f.key===e.currentTarget.dataset.id);if(!field)return;delete this.configInputs[e.currentTarget.dataset.id];this.configForm.stage(field.ns,field.key,null,true);this.setData({configError:''});this.renderSettings();},
  stageConfigInputs() {
    const definitions=this.configForm.definitions();
    for(const id of Object.keys(this.configInputs||{})){const field=definitions.find(f=>f.ns+':'+f.key===id);if(!field)continue;const parsed=this.configForm.parse(field,this.configInputs[id]);this.configForm.stage(field.ns,field.key,parsed.value,parsed.reset);}
    this.configInputs={};
  },
  onSearchApiChange(e) {if(!this.configForm||this.data.config.disabled)return;try{this.stageConfigInputs();const previousRef=this.configForm.credentialRef();this.configForm.selectApi(e.detail.value);if(this.configSecret && previousRef!==this.configForm.credentialRef()){this.configForm.selectApi(!e.detail.value);throw new Error(t('请先保存或放弃当前密钥，再切换搜索接口。'));}this.configCredential=null;this.setData({configError:''});this.renderSettings();this.loadConfigCredential();}catch(error){this.setData({configError:error.message});this.renderSettings();}},
  onModelSelectionChange(e) {if(!this.configForm||this.data.config.disabled)return;this.configForm.stage('subagent-model-selection-settings','enabled',e.detail.value);this.renderSettings();},
  onConfigModelToggle(e) {
    if(!this.configForm||this.data.config.disabled)return;const r=this.data.config.models[Number(e.currentTarget.dataset.index)];if(!r||!r.available&&!r.selected)return;const ns='subagent-model-selection-settings',routes=this.configForm.get(ns,'allowedModels')||[];
    this.configForm.stage(ns,'allowedModels',r.selected?routes.filter(x=>routeKey(x)!==r.key):routes.concat([{provider:r.provider,model:r.model}]));this.setData({configError:''});this.renderSettings();
  },
  async loadConfigModels() {
    const generation=this.configGeneration,owner=this.settingsOwner();this.setData({configModelsStatus:'loading'});
    try{const response=await store.client.requestModels();if(this.configDisposed||generation!==this.configGeneration||owner!==this.settingsOwner())return;this.configModels=response.groups||[];this.setData({configModelsStatus:response.failures&&response.failures.length?'partial':'ready'});this.renderSettings();}
    catch(error){if(!this.configDisposed&&generation===this.configGeneration)this.setData({configModelsStatus:'error'});}
  },
  async loadConfigCredential() {
    const form=this.configForm;if(!form||form.kind!=='web-search')return;const ref=form.credentialRef(),generation=this.configGeneration,owner=this.settingsOwner();
    try{const response=await store.client.requestPlugin('plugin-credential-describe',{ref},5000);if(this.configDisposed||generation!==this.configGeneration||owner!==this.settingsOwner()||ref!==this.configForm.credentialRef())return;this.configCredential={configured:response.result.configured===true,writable:response.result.writable===true};}
    catch(error){if(this.configDisposed||generation!==this.configGeneration||ref!==this.configForm.credentialRef())return;this.configCredential={unavailable:true,writable:false};}
    this.renderSettings();
  },
  onConfigSecret(e) {if(!this.data.config||this.data.config.disabled||!this.configCredential||!this.configCredential.writable)return;this.configSecret=e.detail.value;this.renderSettings();},
  discardSettings() {if(this.data.configSaving)return;this.configForm=null;this.configInputs={};this.configSecret='';this.setData({config:null});this.loadSettings();},
  async saveSettings() {
    const form=this.configForm;if(!form||this.data.config.disabled)return;
    try{this.stageConfigInputs();form.validate();}catch(error){this.setData({configError:error.message});this.renderSettings();return;}
    const generation=this.configGeneration,owner=this.settingsOwner();let changed=false;
    this.setData({configSaving:true,configError:''});this.renderSettings();
    const current=()=>!this.configDisposed&&generation===this.configGeneration&&owner===this.settingsOwner()&&store.state.connection==='connected';
    try{
      for(const operation of form.operations()){if(!current())return;await store.client.requestPlugin('plugin-settings-mutate',operation);if(!current())return;delete form.edits[operation.ns];changed=true;}
      if(this.configSecret){if(!current())return;if(!this.configCredential||!this.configCredential.writable)throw new Error('credential unavailable');await store.client.requestPlugin('plugin-credential-set',{ref:form.credentialRef(),value:this.configSecret});if(!current())return;this.configSecret='';changed=true;}
      if(!current())return;this.setData({configSaving:false});await this.loadSettings();
    }catch(error){if(current()){this.configBlocked=true;this.setData({configSaving:false,configError:t(changed?'部分设置已保存；其余修改未提交，请核对后重试。':/conflict|revision/i.test((error.code||'')+' '+error.message)?'设置已在其他位置更新。请放弃修改后重试。':'本部署没有接受这些值，已保留供你修改。')});this.renderSettings();}}
  },
  async loadConfigProviders() {
    const generation=this.configGeneration,owner=this.settingsOwner();
    try { const response=await store.client.requestPlugin('plugin-translation-limits',{},5000);if(this.configDisposed||generation!==this.configGeneration||owner!==this.settingsOwner())return;this.configProviders=response.result.availableProviders||[]; }
    catch(error){if(this.configDisposed||generation!==this.configGeneration)return;this.configProviders=null;}
    this.renderSettings();
  },
  openSearchGuide() {has.setClipboardData({data:t(copy['web-search'].searchGuideUrl)});}
});
