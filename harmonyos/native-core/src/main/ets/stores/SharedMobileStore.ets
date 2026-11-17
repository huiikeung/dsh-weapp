import { SharedConversationStore } from './SharedConversationStore';
import { SharedHistoryStore } from './SharedHistoryStore';
import { SharedQuestionStore } from './SharedQuestionStore';
import { SharedApprovalStore } from './SharedApprovalStore';
import { SharedQueueStore } from './SharedQueueStore';
import { SharedSessionListStore } from './SharedSessionListStore';
import { SharedTrajectoryStore } from './SharedTrajectoryStore';
import { SharedSessionControlStore } from './SharedSessionControlStore';
import { SharedTurnTimingStore } from './SharedTurnTimingStore';
import { SharedVoiceInputStore } from './SharedVoiceInputStore';
import { SharedSlashCommandStore } from './SharedSlashCommandStore';
import { SharedTeamStore } from './SharedTeamStore';
import { SharedFileUploadStore } from './SharedFileUploadStore';
import { SharedWorkspaceFileStore } from './SharedWorkspaceFileStore';
import { SharedSessionAgentPresetStore } from './SharedSessionAgentPresetStore';
export class SharedMobileStore {
  readonly conversation=new SharedConversationStore();readonly history=new SharedHistoryStore();
  readonly question=new SharedQuestionStore();readonly approval=new SharedApprovalStore();
  readonly queue=new SharedQueueStore();readonly sessionList=new SharedSessionListStore();
  readonly trajectory=new SharedTrajectoryStore();readonly sessionControl=new SharedSessionControlStore();
  readonly turnTiming=new SharedTurnTimingStore();readonly voiceInput=new SharedVoiceInputStore();
  readonly slashCommand=new SharedSlashCommandStore();readonly team=new SharedTeamStore();
  readonly fileUpload=new SharedFileUploadStore();readonly workspaceFile=new SharedWorkspaceFileStore();
  readonly agentPreset=new SharedSessionAgentPresetStore();
  moduleSummary():string{return 'SharedMobileStore: 16 facade stores';}
}
