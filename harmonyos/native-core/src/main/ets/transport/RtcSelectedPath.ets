export interface RtcSelectedPath { kind:string; protocol:string; localEndpoint:string; remoteEndpoint:string; localCandidateType:string; remoteCandidateType:string; }
export class RtcPathInspector {
  static inspect(statsJson:string):RtcSelectedPath|null{try{const v=JSON.parse(statsJson) as RtcSelectedPath;return v.kind!==undefined?v:null;}catch(e){return null;}}
}
