export class RtcDiagnostics {
  static message(phase:string,reason:string):string{return JSON.stringify({phase:phase,reason:reason,supported:false,platform:'HarmonyOS'});}
}
