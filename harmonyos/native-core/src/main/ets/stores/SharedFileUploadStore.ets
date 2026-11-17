export interface UploadDraft { id:string; name:string; size:number; sha256:string; status:string; receiptId?:string; }
export interface UploadTransition { snapshot:string; effect:string|null; errorCode:string|null; }
interface UploadEffect { action:string; id?:string; receiptId?:string; }
export class SharedFileUploadStore {
  private drafts:UploadDraft[]=[];private available:boolean=false;private connectionKey:string='';
  bind(sessionId:string|null,key:string|null,available:boolean):UploadTransition{this.available=available;this.connectionKey=key??'';if(!available)this.drafts=[];return this.ok(null);}
  add(id:string,name:string,size:number,sha256:string):UploadTransition{if(!this.available)return this.fail('UPLOAD_UNAVAILABLE');const d:UploadDraft={id:id,name:name,size:size,sha256:sha256,status:'pending'};this.drafts.push(d);const e:UploadEffect={action:'open-upload',id:id};return this.ok(JSON.stringify(e));}
  retry(id:string):UploadTransition{const d=this.drafts.find(x=>x.id===id);if(d===undefined)return this.fail('UNKNOWN_UPLOAD');d.status='pending';return this.ok(null);}
  remove(id:string):UploadTransition{this.drafts=this.drafts.filter(x=>x.id!==id);return this.ok(null);}
  clear():UploadTransition{this.drafts=[];return this.ok(null);}
  acceptFrame(uploadId:string,receiptId:string):UploadTransition{const d=this.drafts.find(x=>x.id===uploadId);if(d===undefined)return this.fail('UNKNOWN_UPLOAD');d.status='ready';d.receiptId=receiptId;return this.ok(null);}
  canSend():boolean{return this.available&&this.drafts.length>0&&this.drafts.every(x=>x.status==='ready');}
  receipts():string[]{if(!this.canSend())return [];const out:string[]=[];for(const d of this.drafts)if(d.receiptId!==undefined)out.push(d.receiptId);return out;}
  snapshot():string{return JSON.stringify({available:this.available,drafts:this.drafts});}
  private ok(effect:string|null):UploadTransition{return {snapshot:this.snapshot(),effect:effect,errorCode:null};}
  private fail(code:string):UploadTransition{return {snapshot:this.snapshot(),effect:null,errorCode:code};}
}
