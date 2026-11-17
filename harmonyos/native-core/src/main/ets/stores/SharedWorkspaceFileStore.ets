export interface FileTransition { snapshot:string; request:string|null; errorCode:string|null; }
interface FileRequest { type:string; sessionId:string; path?:string; requestId:string; }
interface FileSnapshot { sessionId:string; path:string; entries:Object[]; loading:boolean; error?:string; }
export class SharedWorkspaceFileStore {
  private state:FileSnapshot={sessionId:'',path:'',entries:[],loading:false};
  reset(sessionId:string|null):FileTransition{this.state={sessionId:sessionId??'',path:'',entries:[],loading:false};return this.ok(null);}
  load(sessionId:string,path:string|null,requestId:string):FileTransition{
    this.state={sessionId:sessionId,path:path??'',entries:[],loading:true};
    const request:FileRequest={type:'file-list',sessionId:sessionId,path:path??'',requestId:requestId};
    return this.ok(JSON.stringify(request));
  }
  acceptFrame(entries:Object[]):FileTransition{this.state={sessionId:this.state.sessionId,path:this.state.path,entries:entries,loading:false};return this.ok(null);}
  requestFailed(message:string):FileTransition{this.state={sessionId:this.state.sessionId,path:this.state.path,entries:[],loading:false,error:message};return this.fail('FILE_LIST_FAILED');}
  cancel():FileTransition{this.state={sessionId:this.state.sessionId,path:this.state.path,entries:[],loading:false};return this.ok(null);}
  snapshot():string{return JSON.stringify(this.state);}
  private ok(request:string|null):FileTransition{return {snapshot:this.snapshot(),request:request,errorCode:null};}
  private fail(code:string):FileTransition{return {snapshot:this.snapshot(),request:null,errorCode:code};}
}
