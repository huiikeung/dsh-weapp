export interface ToolActivitySummary { label: string; detail: string; annotation: string; }
export class ToolActivitySummaryFormatter {
  static summarize(name: string, argumentsText: string): ToolActivitySummary {
    let fields: Record<string, Object> | undefined;
    try {
      let parsed: Object = JSON.parse(argumentsText) as Object;
      if (typeof parsed === 'string') parsed = JSON.parse(parsed as string) as Object;
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) fields = parsed as Record<string, Object>;
    } catch (ignored) { fields = undefined; }
    const value = (keys: string[]): string | undefined => {
      if (fields === undefined) return undefined;
      for (const key of keys) { const item=fields[key]; if(typeof item==='string' && item.trim().length>0)return item; }
      return undefined;
    };
    const normalized=name.toLowerCase().split(/[./]/).pop()??name;
    const path=value(['file_path','filePath','path','filename','file']); const command=value(['command','cmd','script','code']);
    const query=value(['pattern','query','search','regex']); const content=value(['content','text']);
    const old=value(['old_string','oldText','old_text']); const replacement=value(['new_string','newText','new_text']);
    let label='';
    if(['write','write_file','writefile'].indexOf(normalized)>=0)label='写入';
    else if(['edit','edit_file','editfile','apply_patch'].indexOf(normalized)>=0)label='修改';
    else if(['read','read_file','readfile'].indexOf(normalized)>=0)label='读取';
    else if(['bash','shell','exec','exec_command','run_code','terminal'].indexOf(normalized)>=0)label='执行';
    else if(['grep','search','ripgrep','glob','find'].indexOf(normalized)>=0)label='搜索';
    else if(['list','ls','list_directory'].indexOf(normalized)>=0)label='列出';
    else if(['webfetch','web_fetch','fetch'].indexOf(normalized)>=0)label='获取';
    else label=name.trim().length>0?name:'工具';
    const description=value(['description']); let raw=description;
    if(raw===undefined){ if(label==='执行')raw=command; else if(label==='搜索')raw=[query,path].filter((x:string|undefined)=>x!==undefined).join(' · '); else if(label==='获取')raw=value(['url']); else raw=path??command??query??value(['url']); }
    const detail=(raw??'').replace(/\s+/g,' ').trim().substring(0,240);
    let annotation=''; if(label==='写入'&&content!==undefined)annotation=ToolActivitySummaryFormatter.lines(content)+' 行';
    else if(label==='修改'&&old!==undefined&&replacement!==undefined)annotation='替换 '+ToolActivitySummaryFormatter.lines(old)+' → '+ToolActivitySummaryFormatter.lines(replacement)+' 行';
    else if(label==='读取')annotation=value(['limit','num_lines'])!==undefined?value(['limit','num_lines'])+' 行':'';
    return {label,detail,annotation};
  }
  private static lines(value:string):number { return value.trim().length===0?1:value.replace(/[\r\n]+$/g,'').split('\n').length; }
}
