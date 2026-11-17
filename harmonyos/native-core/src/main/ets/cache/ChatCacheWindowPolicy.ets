export interface CachedHistoryWindow { sessionId:string; events:Object[]; cursor:number; hasMore:boolean; bytes:number; }
export class ChatCacheWindowPolicy {
  static readonly MAX_BYTES:number=8*1024*1024;static readonly MAX_EVENTS:number=5000;
  static trim(events:Object[],estimateBytes:number):Object[]{let result=events.slice();while(result.length>ChatCacheWindowPolicy.MAX_EVENTS||estimateBytes>ChatCacheWindowPolicy.MAX_BYTES){result.shift();estimateBytes=Math.floor(estimateBytes*0.9);}return result;}
  static shouldPersist(bytes:number):boolean{return bytes>0&&bytes<=ChatCacheWindowPolicy.MAX_BYTES;}
}
