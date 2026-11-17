export enum TailscaleStage { DISABLED='DISABLED',UNSUPPORTED='UNSUPPORTED' }
export interface TailscaleStatus { stage:TailscaleStage; supported:boolean; reason:string; }
export class TailscalePlatformStatus {
  static snapshot():TailscaleStatus{return {stage:TailscaleStage.UNSUPPORTED,supported:false,reason:'HarmonyOS has no tsnet/Tailscale VPN extension in this port; use LAN/WSS gateway endpoints instead.'};}
  static accountCatalog():string{return JSON.stringify({accounts:[],selectedID:null,supported:false});}
  static sessionFacade():string{return JSON.stringify({supported:false,reason:'No native Tailscale node on HarmonyOS.'});}
}
