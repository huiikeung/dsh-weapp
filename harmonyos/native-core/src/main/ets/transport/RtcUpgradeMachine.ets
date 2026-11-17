export interface RtcAction { kind:string; channel:string; text:string; }
export class RtcUpgradeMachine {
  phase:string='initial';mode:string='';diagnosticReason:string='';timeoutMs:number=12000;maxFrameBytes:number=16384;
  start(mode:string):RtcAction{this.mode=mode;this.phase='offering';const a:RtcAction={kind:'offer',channel:'control',text:JSON.stringify({mode:mode,maxFrameBytes:this.maxFrameBytes})};return a;}
  accepted():void{if(this.phase==='offering')this.phase='ready';}
  rejected(reason:string):void{this.phase='failed';this.diagnosticReason=reason;}
  timeout():void{if(this.phase==='offering'){this.phase='failed';this.diagnosticReason='timeout';}}
  close():void{this.phase='initial';this.mode='';this.diagnosticReason='';}
  get isReady():boolean{return this.phase==='ready';}
}
