import { SharedMviDispatchResult } from '../facade/SharedMviEvents';
export interface QueueDraft { sessionId:string; itemId:string; text:string; }
export interface QueueTransition { snapshot:string; request:string|null; errorCode:string|null; }
interface QueueRequest { type:string; sessionId:string; itemId:string; action:string; }
export class SharedQueueStore {
  private drafts:Map<string,QueueDraft>=new Map(); private busy:boolean=false; private error:string|null=null;
  snapshot():string{const items:QueueDraft[]=[];this.drafts.forEach(v=>items.push(v));return JSON.stringify({items:items,busy:this.busy,error:this.error});}
  beginAction(sessionId:string,itemId:string,action:string):QueueTransition{
    if(this.busy)return this.result('QUEUE_BUSY');
    if(action!=='steer'&&action!=='remove')return this.result('INVALID_QUEUE_ACTION');
    this.busy=true;this.error=null;
    const request:QueueRequest={type:'queue-update',sessionId:sessionId,itemId:itemId,action:action};
    return {snapshot:this.snapshot(),request:JSON.stringify(request),errorCode:null};
  }
  failPending(message:string):QueueTransition{this.busy=false;this.error=message;return {snapshot:this.snapshot(),request:null,errorCode:'QUEUE_ACTION_FAILED'};}
  acceptFrame(accepted:boolean):QueueTransition{this.busy=false;this.error=accepted?null:this.error;return {snapshot:this.snapshot(),request:null,errorCode:accepted?null:'QUEUE_ACTION_REJECTED'};}
  reset():QueueTransition{this.drafts.clear();this.busy=false;this.error=null;return {snapshot:this.snapshot(),request:null,errorCode:null};}
  private result(code:string):QueueTransition{this.error=code;return {snapshot:this.snapshot(),request:null,errorCode:code};}
}
