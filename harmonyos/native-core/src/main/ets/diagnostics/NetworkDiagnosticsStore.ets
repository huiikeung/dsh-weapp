export interface NetworkDiagnosticsSample { elapsedSeconds:number; roundTripMs:number; jitterMs:number; lossPercent:number; receivedBytesPerSecond:number; sentBytesPerSecond:number; segment:number; }
export interface NetworkDiagnosticsSnapshot { active:boolean; connected:boolean; supported:boolean; samples:NetworkDiagnosticsSample[]; }
export class NetworkDiagnosticsStore {
  private samples:NetworkDiagnosticsSample[]=[];private active:boolean=false;
  start():void{this.active=true;this.samples=[];}
  stop():void{this.active=false;}
  add(sample:NetworkDiagnosticsSample):void{if(this.active)this.samples.push(sample);}
  snapshot():NetworkDiagnosticsSnapshot{return {active:this.active,connected:false,supported:true,samples:this.samples.slice()};}
}
