export interface PrefetchCandidate { id:string; lastActivityEpochSeconds:number; isRunning:boolean; hasUnread:boolean; hasConversation:boolean; }
interface ScoredCandidate { id:string; score:number; }
export class ChatPrefetchPolicy {
  static readonly HALF_LIFE_SECONDS:number=3600;
  static decay(value:number,age:number):number{return value*Math.pow(0.5,Math.max(0,age)/ChatPrefetchPolicy.HALF_LIFE_SECONDS);}
  static rank(candidates:PrefetchCandidate[],now:number,limit:number):string[]{
    const scored:ScoredCandidate[]=[];
    for(const c of candidates){let score=ChatPrefetchPolicy.decay(1,now-c.lastActivityEpochSeconds);if(c.isRunning)score+=2;if(c.hasUnread)score+=1;if(!c.hasConversation)score-=0.5;const entry:ScoredCandidate={id:c.id,score:score};scored.push(entry);}
    scored.sort((a,b)=>b.score-a.score);const out:string[]=[];for(let i=0;i<Math.min(limit,scored.length);i++)out.push(scored[i].id);return out;
  }
  static validIdentifier(value:string):boolean{return value.trim().length>0&&value.length<=128;}
}
