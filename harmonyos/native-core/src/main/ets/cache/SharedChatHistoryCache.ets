import { CacheKey, ChatMemoryCache } from './ChatMemoryCache';
import { CachedHistoryWindow } from './ChatCacheWindowPolicy';
import { ChatCacheDiagnostics } from './ChatCacheDiagnostics';
export interface CacheStats { sessionCount:number; eventCount:number; memoryBytes:number; memorySessions:number; diskHits:number; misses:number; }
interface RawMemoryStats { entries:number; hits:number; misses:number; }
export class SharedChatHistoryCache {
  private memory:ChatMemoryCache=new ChatMemoryCache();readonly diagnostics:ChatCacheDiagnostics=new ChatCacheDiagnostics();
  get(key:CacheKey):CachedHistoryWindow|undefined{const v=this.memory.get(key);if(v===undefined)this.diagnostics.log('miss');return v;}
  put(key:CacheKey,window:CachedHistoryWindow):void{this.memory.put(key,window);}
  clear(gatewayId?:string):void{this.memory.clear(gatewayId);}
  stats():CacheStats{const raw=JSON.parse(this.memory.stats()) as Object as RawMemoryStats;const out:CacheStats={sessionCount:raw.entries,eventCount:0,memoryBytes:0,memorySessions:raw.entries,diskHits:0,misses:raw.misses};return out;}
}
