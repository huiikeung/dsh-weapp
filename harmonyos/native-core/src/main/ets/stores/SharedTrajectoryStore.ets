import { SharedStoreKernel } from './SharedStoreKernel';
interface TrajectorySession { events:Object[]; }
export class SharedTrajectoryStore extends SharedStoreKernel {
  constructor(){super('trajectory');}
  receiveEvents(sessionId:string,events:Object[]):void{this.dispatch('events',()=>{const s:TrajectorySession={events:events};this.setSession(sessionId,s);});}
  clearSession(sessionId:string):void{this.dispatch('clear',()=>{this.clearState(sessionId);});}
  protected clearState(sessionId:string):void{super.clearSession(sessionId);}
  snapshot(sessionId:string):Object[]{const s=this.getSession(sessionId) as Object as TrajectorySession;return s.events??[];}
}
