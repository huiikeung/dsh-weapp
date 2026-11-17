import { SharedStoreKernel } from './SharedStoreKernel';
import { SharedMviDispatchResult } from '../facade/SharedMviEvents';
export interface ApprovalRequest { rpcId:string; sessionId:string; approvalId:string; toolName:string; reason?:string; }
export interface ApprovalResult { snapshot:string; effect:string|null; errorCode:string|null; }
interface ApprovalSession { rpcId:string; status?:string; }
interface ApprovalEffect { action:string; rpcId:string; sessionId:string; approvalId:string; outcome:string; }
export class SharedApprovalStore extends SharedStoreKernel {
  private pending:Map<string,ApprovalRequest>=new Map(); private statuses:Map<string,string>=new Map();
  constructor(){super('approval');}
  requestReceived(request:ApprovalRequest):ApprovalResult{
    if(request.rpcId.length===0||request.sessionId.length===0)return this.error('INVALID_APPROVAL');
    this.pending.set(request.rpcId,request);this.statuses.set(request.rpcId,'pending');
    this.dispatch('request-received',()=>{const s:ApprovalSession={rpcId:request.rpcId};this.setSession(request.sessionId,s);});
    return {snapshot:this.snapshot(),effect:null,errorCode:null};
  }
  submitDecision(rpcId:string,outcome:string,isConnected:boolean):ApprovalResult{
    const request=this.pending.get(rpcId);if(request===undefined)return this.error('UNKNOWN_RPC_ID');
    if(!isConnected)return this.error('NOT_CONNECTED');
    if(outcome!=='allowed-once'&&outcome!=='rejected')return this.error('INVALID_OUTCOME');
    this.statuses.set(rpcId,'submitting');
    const effect:ApprovalEffect={action:'send-approval-response',rpcId:rpcId,sessionId:request.sessionId,approvalId:request.approvalId,outcome:outcome};
    this.dispatch('decision',()=>{const s:ApprovalSession={rpcId:rpcId,status:'submitting'};this.setSession(request.sessionId,s);});
    return {snapshot:this.snapshot(),effect:JSON.stringify(effect),errorCode:null};
  }
  responseReceived(rpcId:string,accepted:boolean):ApprovalResult{
    if(!this.pending.has(rpcId))return this.error('UNKNOWN_RPC_ID');
    this.dispatch('response',()=>{this.statuses.set(rpcId,accepted?'accepted':'rejected');});
    return {snapshot:this.snapshot(),effect:null,errorCode:null};
  }
  resolved(rpcId:string):ApprovalResult{
    if(!this.pending.has(rpcId))return this.error('UNKNOWN_RPC_ID');
    this.dispatch('resolved',()=>{this.pending.delete(rpcId);this.statuses.delete(rpcId);});
    return {snapshot:this.snapshot(),effect:null,errorCode:null};
  }
  snapshot():string{const requests:ApprovalRequest[]=[];const statuses:Record<string,string>={};this.pending.forEach(v=>requests.push(v));this.statuses.forEach((v,k)=>{statuses[k]=v;});return JSON.stringify({pendingRequests:requests,requestStatuses:statuses});}
  private error(code:string):ApprovalResult{return {snapshot:'',effect:null,errorCode:code};}
}
