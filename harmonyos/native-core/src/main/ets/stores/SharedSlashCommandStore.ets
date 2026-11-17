export interface SlashTransition { snapshot:string; request:string|null; errorCode:string|null; }
interface SlashExecution { command:string; text:string; }
export class SharedSlashCommandStore {
  private command:string='';private selected:Record<string,string>={};private catalog:Object[]=[];
  updateInput(text:string):SlashTransition{this.command=text.startsWith('/')?text.slice(1).split(' ')[0]:'';return this.result(null);}
  selectCommand(name:string):SlashTransition{this.command=name;return this.result(null);}
  selectOption(optionId:string,value:string):SlashTransition{this.selected[optionId]=value;return this.result(null);}
  commandExecutionForInput(text:string):Object|null{if(!text.startsWith('/'))return null;const e:SlashExecution={command:this.command,text:text};return e;}
  acceptFrame(catalog:Object[]):SlashTransition{this.catalog=catalog;return this.result(null);}
  snapshot():string{return JSON.stringify({command:this.command,selected:this.selected,catalog:this.catalog});}
  private result(errorCode:string|null):SlashTransition{return {snapshot:this.snapshot(),request:null,errorCode:errorCode};}
}
