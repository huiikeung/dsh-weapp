export interface TeamTarget { sessionId:string; parentSessionId?:string; workspaceSessionId?:string; }
export class SharedTeamStore {
  private targets:Map<string,TeamTarget>=new Map();
  routingJson():string{const list:TeamTarget[]=[];this.targets.forEach(v=>list.push(v));return JSON.stringify(list.sort((a,b)=>a.sessionId.localeCompare(b.sessionId)));}
  restoreRoutingJson(json:string):boolean{try{const rows=JSON.parse(json) as TeamTarget[];this.targets.clear();for(const row of rows)this.targets.set(row.sessionId,row);return true;}catch(e){return false;}}
  snapshot(leadSessionId:string):string{const children:TeamTarget[]=[];this.targets.forEach(v=>{if(v.parentSessionId===leadSessionId)children.push(v);});return JSON.stringify({leadSessionId:leadSessionId,children:children});}
  isChild(sessionId:string):boolean{return this.targets.get(sessionId)?.parentSessionId!==undefined;}
}
