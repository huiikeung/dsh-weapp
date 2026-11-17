export interface VoiceSnapshot { mode:string; context:string; draftAtOpen:string; recording:boolean; cancelling:boolean; level:number; }
export interface VoiceTransition { snapshot:string; effect:string|null; errorCode:string|null; }
interface VoiceEffect { action:string; sampleRate?:number; channels?:number; bitDepth?:number; transcript?:string; }
interface VoiceCaptureEffect { action:string; transcript:string; }
export class SharedVoiceInputStore {
  private state:VoiceSnapshot={mode:'idle',context:'',draftAtOpen:'',recording:false,cancelling:false,level:0};
  snapshot():string{return JSON.stringify(this.state);}
  open(context:string,currentDraft:string):VoiceTransition{
    const next:VoiceSnapshot={mode:'ready',context:context,draftAtOpen:currentDraft,recording:false,cancelling:false,level:0};
    this.state=next;
    const effect:VoiceEffect={action:'request-permission'};
    return {snapshot:this.snapshot(),effect:JSON.stringify(effect),errorCode:null};
  }
  press():VoiceTransition{const next:VoiceSnapshot={mode:'pressing',context:this.state.context,draftAtOpen:this.state.draftAtOpen,recording:false,cancelling:false,level:this.state.level};this.state=next;return this.ok(null);}
  permissionResult(granted:boolean):VoiceTransition{
    if(!granted){const next:VoiceSnapshot={mode:'permission-denied',context:this.state.context,draftAtOpen:this.state.draftAtOpen,recording:false,cancelling:false,level:0};this.state=next;return this.fail('PERMISSION_DENIED');}
    const next:VoiceSnapshot={mode:'recording',context:this.state.context,draftAtOpen:this.state.draftAtOpen,recording:true,cancelling:false,level:0};this.state=next;
    const effect:VoiceEffect={action:'start-capture',sampleRate:16000,channels:1,bitDepth:16};
    return this.ok(JSON.stringify(effect));
  }
  level(value:number):VoiceTransition{const next:VoiceSnapshot={mode:this.state.mode,context:this.state.context,draftAtOpen:this.state.draftAtOpen,recording:this.state.recording,cancelling:this.state.cancelling,level:Math.max(0,Math.min(1,value))};this.state=next;return this.ok(null);}
  pointerMoved(distance:number):VoiceTransition{const cancelling=distance>80||this.state.cancelling;const next:VoiceSnapshot={mode:this.state.mode,context:this.state.context,draftAtOpen:this.state.draftAtOpen,recording:this.state.recording,cancelling:cancelling,level:this.state.level};this.state=next;return this.ok(null);}
  release():VoiceTransition{
    if(this.state.cancelling){const next:VoiceSnapshot={mode:'cancelled',context:this.state.context,draftAtOpen:this.state.draftAtOpen,recording:false,cancelling:false,level:0};this.state=next;const effect:VoiceEffect={action:'cancel-capture'};return this.ok(JSON.stringify(effect));}
    const next:VoiceSnapshot={mode:'transcribing',context:this.state.context,draftAtOpen:this.state.draftAtOpen,recording:false,cancelling:false,level:0};this.state=next;
    const effect:VoiceEffect={action:'send-speech-input'};
    return this.ok(JSON.stringify(effect));
  }
  captureFinished(transcript:string,draftChanged:boolean):VoiceTransition{
    const next:VoiceSnapshot={mode:'done',context:this.state.context,draftAtOpen:this.state.draftAtOpen,recording:false,cancelling:false,level:0};this.state=next;
    const effect:VoiceCaptureEffect=draftChanged?{action:'show-transcript-confirmation',transcript:transcript}:{action:'focus-editor',transcript:transcript};
    return this.ok(JSON.stringify(effect));
  }
  cancel():VoiceTransition{this.state={mode:'idle',context:'',draftAtOpen:'',recording:false,cancelling:false,level:0};const effect:VoiceEffect={action:'stop-capture'};return this.ok(JSON.stringify(effect));}
  private ok(effect:string|null):VoiceTransition{return {snapshot:this.snapshot(),effect:effect,errorCode:null};}
  private fail(code:string):VoiceTransition{return {snapshot:this.snapshot(),effect:null,errorCode:code};}
}
