import { SharedStoreKernel } from './SharedStoreKernel';
export interface ControlTransition { snapshot:string; request:string|null; errorCode:string|null; }
interface ControlRequest { type:string; sessionId:string; selected?:Object; value?:string; }
interface ControlState { pending?:string; selected?:Object; permission?:string; }
export class SharedSessionControlStore extends SharedStoreKernel {
  constructor(){super('session-control');}
  private request(kind:string,sessionId:string,isConnected:boolean):ControlTransition{
    if(!isConnected)return {snapshot:'{}',request:null,errorCode:'NOT_CONNECTED'};
    const payload:ControlRequest={type:kind,sessionId:sessionId};const snapshotState:ControlState={pending:kind};const snapshot:string=JSON.stringify(snapshotState);
    this.dispatch(kind,()=>{const s:ControlState={pending:kind};this.setSession(sessionId,s);});
    return {snapshot:snapshot,request:JSON.stringify(payload),errorCode:null};
  }
  requestModels(sessionId:string,isConnected:boolean):ControlTransition{return this.request('models',sessionId,isConnected);}
  requestPermissionOptions(sessionId:string,isConnected:boolean):ControlTransition{return this.request('permission-options',sessionId,isConnected);}
  requestContextUsage(sessionId:string,isConnected:boolean):ControlTransition{return this.request('context-usage',sessionId,isConnected);}
  requestDefaults(isConnected:boolean):ControlTransition{return this.request('defaults','global',isConnected);}
  selectModel(sessionId:string,selection:Object,isConnected:boolean):ControlTransition{
    if(!isConnected)return {snapshot:'{}',request:null,errorCode:'NOT_CONNECTED'};
    const payload:ControlRequest={type:'select-model',sessionId:sessionId,selected:selection};
    this.dispatch('select-model',()=>{const s:ControlState={selected:selection};this.setSession(sessionId,s);});
    const out:ControlState={selected:selection};return {snapshot:JSON.stringify(out),request:JSON.stringify(payload),errorCode:null};
  }
  setPermission(sessionId:string,value:string,isConnected:boolean):ControlTransition{
    if(!isConnected)return {snapshot:'{}',request:null,errorCode:'NOT_CONNECTED'};
    const payload:ControlRequest={type:'set-permission',sessionId:sessionId,value:value};
    this.dispatch('set-permission',()=>{const s:ControlState={permission:value};this.setSession(sessionId,s);});
    const out:ControlState={permission:value};return {snapshot:JSON.stringify(out),request:JSON.stringify(payload),errorCode:null};
  }
  snapshot(sessionId:string):Object{return this.getSession(sessionId);}
}
