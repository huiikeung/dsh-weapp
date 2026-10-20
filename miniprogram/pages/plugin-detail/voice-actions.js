const store = require('../../utils/store');
const { t, localized } = require('../../utils/ui-preferences');
const copy = require('./plugin-settings-copy').voice;
function text(key, args={}) {let result=t(copy[key]||key);for(const name of Object.keys(args))result=result.split('{'+name+'}').join(String(args[name]));return result;}
function metric(state) {
  if(typeof state.completedBytes==='number') {const completed=(state.completedBytes/1e6).toFixed(1);return state.totalBytes>0?text('downloadBytes',{completed,total:(state.totalBytes/1e6).toFixed(1),percent:Math.floor(state.completedBytes/state.totalBytes*100)}):text('downloadUnknown',{completed});}
  return state.startedAt ? text('elapsed',{seconds:Math.max(0,Math.floor((Date.now()-state.startedAt)/1000))}) : '';
}
module.exports={
  async loadVoiceSettings() {
    if(this.configDisposed||this.voiceHidden||store.state.connection!=='connected'||this.voiceReading===this.configGeneration)return;
    this.voiceReading=this.configGeneration;const generation=this.configGeneration,owner=this.settingsOwner();clearTimeout(this.voiceTimer);
    try{const response=await store.client.requestPlugin('speech-catalog',{},6000);if(this.configDisposed||generation!==this.configGeneration||owner!==this.settingsOwner())return;
      if(response.available===false)throw new Error('unavailable');this.voiceCatalog=response;this.setData({voiceError:''});this.renderVoiceSettings();
      if(!this.voiceHidden)this.voiceTimer=setTimeout(()=>this.loadVoiceSettings(),3000);
    }catch(error){if(!this.configDisposed&&generation===this.configGeneration)this.setData({voiceError:t('当前网关尚未开放此功能，请更新网关后重试。')});}
    finally{if(this.voiceReading===generation)this.voiceReading=null;}
  },
  renderVoiceSettings() {
    const catalog=this.voiceCatalog;if(!catalog)return;const selection=catalog.selection||{},sources=this.voiceSources||{},expanded=this.voiceExpanded||{};
    const providers=(catalog.providers||[]).map(p=>{
      const state=p.preparation||{},steps=(state.steps||[]).map((step,index)=>({...step,key:String(index),label:text('step.'+step.kind,{name:localized(p.name)||p.id}),statusLabel:text('stepStatus.'+step.status)}));
      const downloads=p.downloadSources||[],choices=downloads.length===1?downloads:[''].concat(downloads),source=downloads.includes(sources[p.id])?sources[p.id]:downloads.length===1?downloads[0]:'';
      const names=choices.map(x=>x==='https://hf-mirror.com'?text('sourceMirror'):x==='https://huggingface.co'?text('sourceHuggingFace'):x||text('sourceAuto'));
      const estimate=p.setupEstimate,estimates=state.phase==='unprepared'&&p.location==='host-local'&&estimate?[text('setup.local'),text('setup.disk')+': '+text('setup.diskValue',{gb:estimate.recommendedDiskBytes/1e9}),text('setup.memory')+': '+text('setup.memoryValue',{gb:estimate.expectedMemoryBytes/1e9}),text('setup.time')+': '+text('setup.timeValue',{min:estimate.minimumMinutes,max:estimate.maximumMinutes}),text('setup.estimateNote')]:[];
      const failure=state.download;
      return {...p,name:localized(p.name)||p.id,steps,estimates,expanded:!!expanded[p.id],sources:choices,sourceNames:names,sourceIndex:choices.indexOf(source),sourceName:names[choices.indexOf(source)],manualSource:!!source,summary:text(state.phase==='downloading'?'short.downloading':state.phase==='failed'?'short.failed':state.phase==='ready'&&p.location==='cloud'?'cloudReady':'preparation.'+state.phase,{name:localized(p.name)||p.id}),metric:metric(state),progress:state.totalBytes>0?Math.max(0,Math.min(100,Math.floor(state.completedBytes/state.totalBytes*100))):null,sourceDetail:failure&&failure.source?text('downloadSource',{source:failure.source}):'',errorCode:failure&&failure.code?text('downloadCode',{code:failure.code}):'',failure:state.phase==='failed'?failure?text('download.'+failure.reason,{resource:failure.resource||p.name,status:failure.status||''}):text('preparationFailed',{message:state.message||''}):'',advice:state.phase==='failed'&&failure?text('downloadAdvice.'+failure.reason):'',canPrepare:['unprepared','cancelled','failed'].includes(state.phase),failed:state.phase!=='unprepared',canCancel:['checking','downloading','loading'].includes(state.phase)};
    });
    const selected=providers.find(p=>p.id===selection.providerId),languages=selected&&selected.languages||[],languageNames=languages.map(code=>copy[code]?text(code):code);
    this.setData({voice:{providers,providerNames:providers.map(p=>p.name),providerIndex:providers.findIndex(p=>p.id===selection.providerId),providerName:selected?selected.name:selection.providerId,languages,languageNames,languageIndex:languages.indexOf(selection.language),languageName:copy[selection.language]?text(selection.language):selection.language,cloud:selected&&selected.location==='cloud'}});
  },
  changeVoiceSource(e) {if(this.data.voiceBusy)return;const p=this.data.voice.providers.find(p=>p.id===e.currentTarget.dataset.id);if(!p)return;this.voiceSources=this.voiceSources||{};this.voiceSources[p.id]=p.sources[Number(e.detail.value)];this.renderVoiceSettings();},
  toggleVoiceSteps(e) {this.voiceExpanded=this.voiceExpanded||{};const id=e.currentTarget.dataset.id;this.voiceExpanded[id]=!this.voiceExpanded[id];this.renderVoiceSettings();},
  changeVoiceSetting(e) {const field=e.currentTarget.dataset.field,index=Number(e.detail.value);const value=field==='providerId'?this.data.voice.providers[index].id:this.data.voice.languages[index];return this.runVoiceAction('speech-configure',{[field]:value});},
  prepareVoice(e) {const p=this.data.voice.providers.find(p=>p.id===e.currentTarget.dataset.id);if(!p||!p.canPrepare)return;const source=p.sources[p.sourceIndex];return this.runVoiceAction('speech-prepare',{providerId:p.id,...(source?{downloadSource:source}:{})});},
  cancelVoicePreparation(e) {const p=this.data.voice.providers.find(p=>p.id===e.currentTarget.dataset.id);if(p&&p.canCancel)return this.runVoiceAction('speech-cancel-preparation',{providerId:p.id});},
  async runVoiceAction(type,payload) {if(this.data.voiceBusy||store.state.connection!=='connected')return;const generation=this.configGeneration,owner=this.settingsOwner();this.setData({voiceBusy:true,voiceError:''});
    try{await store.client.requestPlugin(type,payload);if(this.configDisposed||generation!==this.configGeneration||owner!==this.settingsOwner())return;await this.loadVoiceSettings();}
    catch(error){if(!this.configDisposed&&generation===this.configGeneration)this.setData({voiceError:t('本部署没有接受这些值，已保留供你修改。')});}
    finally{if(!this.configDisposed&&generation===this.configGeneration)this.setData({voiceBusy:false});}
  }
};
