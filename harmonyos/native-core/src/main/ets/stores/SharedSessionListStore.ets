import { SharedStoreKernel } from './SharedStoreKernel';
export interface SessionRow { id:string; title:string; running:boolean; unread:boolean; updatedAt:number; }
interface SessionListState { rows?:SessionRow[]; selected?:string; read?:boolean; }
export class SharedSessionListStore extends SharedStoreKernel {
  constructor(){super('session-list');}
  receiveRemoteSessions(rows:SessionRow[]):void{this.dispatch('remote-sessions',()=>{const s:SessionListState={rows:rows};this.setSession('global',s);});}
  selectSession(sessionId:string):void{this.dispatch('select',()=>{const s:SessionListState={selected:sessionId};this.setSession('global',s);});}
  markRead(sessionId:string):void{this.dispatch('mark-read',()=>{const s:SessionListState={read:true};this.setSession(sessionId,s);});}
  snapshot():SessionRow[]{const state=this.getSession('global') as Object as SessionListState;return state.rows??[];}
}
