export interface PresetTransition { snapshot:string; request:string|null; errorCode:string|null; }
interface PresetRequest { type:string; sessionId:string; requestId:string; }
interface PresetSnapshot { sessionId:string; supported:boolean; connected:boolean; presets:Object[]; selected?:string; }
interface PresetSelectRequest { type:string; sessionId:string; agentPreset:string; requestId:string; }
export class SharedSessionAgentPresetStore {
  private state:PresetSnapshot={sessionId:'',supported:false,connected:false,presets:[]};
  open(sessionId:string|null,supported:boolean,connected:boolean):PresetTransition{this.state={sessionId:sessionId??'',supported:supported,connected:connected,presets:[]};return this.query();}
  query():PresetTransition{if(!this.state.supported||!this.state.connected)return this.fail('PRESET_UNSUPPORTED');const r:PresetRequest={type:'session-agent-preset',sessionId:this.state.sessionId,requestId:'preset-' + this.state.sessionId};return this.ok(JSON.stringify(r));}
  select(presetId:string):PresetTransition{this.state={sessionId:this.state.sessionId,supported:this.state.supported,connected:this.state.connected,presets:this.state.presets,selected:presetId};const r:PresetSelectRequest={type:'select-agent-preset',sessionId:this.state.sessionId,agentPreset:presetId,requestId:'select-' + presetId};return this.ok(JSON.stringify(r));}
  acceptFrame(presets:Object[]):PresetTransition{this.state={sessionId:this.state.sessionId,supported:this.state.supported,connected:this.state.connected,presets:presets};return this.ok(null);}
  snapshot():string{return JSON.stringify(this.state);}
  private ok(request:string|null):PresetTransition{return {snapshot:this.snapshot(),request:request,errorCode:null};}
  private fail(code:string):PresetTransition{return {snapshot:this.snapshot(),request:null,errorCode:code};}
}
