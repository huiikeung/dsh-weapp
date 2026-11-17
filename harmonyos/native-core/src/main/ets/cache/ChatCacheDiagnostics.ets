export enum ChatCacheRestoreSkipReason { ALREADY_LOADED='ALREADY_LOADED',SELECTION_CHANGED='SELECTION_CHANGED',FORMAT_CHANGED='FORMAT_CHANGED',INVALID_WINDOW='INVALID_WINDOW' }
export class ChatCacheDiagnostics {
  private events:string[]=[];
  databaseUnavailable():void{this.log('cache:database-unavailable');}
  restoreSkipped(reason:ChatCacheRestoreSkipReason):void{this.log('cache:restore-skipped:'+reason);}
  log(message:string):void{this.events.push(message);}
  snapshot():string{return JSON.stringify(this.events);}
}
