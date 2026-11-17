export interface TurnTimingSnapshot { sessionId:string; startedAt:number; elapsedSeconds:number; serverEpoch?:number; }
export class SharedTurnTimingStore {
  private sessions:Map<string,TurnTimingSnapshot>=new Map();
  awaitStart(sessionId:string,afterSequence:number):void{
    const value:TurnTimingSnapshot={sessionId:sessionId,startedAt:Date.now()/1000,elapsedSeconds:0};
    this.sessions.set(sessionId,value);
  }
  observeServerTime(epochSeconds:number,now:number):void{ /* platform clock anchor retained for parity */ }
  receiveLiveEvent(sessionId:string,epochSeconds:number):void{
    const value=this.sessions.get(sessionId);if(value===undefined)return;
    const next:TurnTimingSnapshot={sessionId:sessionId,startedAt:value.startedAt,elapsedSeconds:Math.max(0,epochSeconds-value.startedAt),serverEpoch:epochSeconds};
    this.sessions.set(sessionId,next);
  }
  snapshot(sessionId:string):TurnTimingSnapshot|null{return this.sessions.get(sessionId)??null;}
  clear(sessionId:string):void{this.sessions.delete(sessionId);}
}
