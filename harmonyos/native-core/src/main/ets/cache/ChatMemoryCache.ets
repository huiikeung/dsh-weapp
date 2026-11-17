import { CachedHistoryWindow } from './ChatCacheWindowPolicy';
export interface CacheKey { gatewayId:string; sessionId:string; }
export class ChatMemoryCache {
  private entries:Map<string,CachedHistoryWindow>=new Map();private hits:number=0;private misses:number=0;
  private key(k:CacheKey):string{return JSON.stringify([k.gatewayId,k.sessionId]);}
  get(k:CacheKey):CachedHistoryWindow|undefined{const v=this.entries.get(this.key(k));if(v===undefined)this.misses++;else this.hits++;return v;}
  put(k:CacheKey,window:CachedHistoryWindow):void{this.entries.set(this.key(k),window);}
  remove(k:CacheKey):void{this.entries.delete(this.key(k));}
  clear(gatewayId?:string):void{if(gatewayId===undefined){this.entries.clear();return;}const keep=new Map<string,CachedHistoryWindow>();this.entries.forEach((v,k)=>{if(!k.startsWith('["'+gatewayId+'"'))keep.set(k,v);});this.entries=keep;}
  get size():number{return this.entries.size;}
  stats():string{return JSON.stringify({entries:this.entries.size,hits:this.hits,misses:this.misses});}
}
