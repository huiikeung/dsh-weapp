import { common } from '@kit.AbilityKit';
import { fileIo } from '@kit.CoreFileKit';
import { abilityAccessCtrl } from '@kit.AbilityKit';
import {
  asRec, bool, GatewayClient, GatewayPendingApprovalRequest, GatewayPendingQuestionRequest, GatewayQuestion,
  GatewayQuestionAnswer, GatewayQuestionOption, num, PreferencesStore, ProjStep, ProjTool, ProjTurn, QueueItem,
  SessionRow, SessionStore, SessionSummary, str, pickDocuments, uploadAttachment, downloadAttachment, AttachmentCache, VoiceDictation
} from 'nativecore';
import type { DownloadResult } from 'nativecore';
import type { UploadResult } from 'nativecore';
import type { PickedAttachment } from 'nativecore';
import { FileTypeIcon } from '../components/FileTypeIcon';
import { CodeSyntaxHighlighter } from '../components/CodeSyntaxHighlighter';

interface UploadReceipt {
  receiptId: string;
}

interface QuestionAnswerRequest {
  type: string;
  rpcId: string;
  sessionId: string;
  answers: GatewayQuestionAnswer[];
}

interface QuestionCancelRequest {
  type: string;
  rpcId: string;
  sessionId: string;
}

interface ApprovalResponseRequest {
  type: string;
  rpcId: string;
  sessionId: string;
  approvalId: string;
  outcome: string;
}

interface FleetNode {
  key: string;
  title: string;
  subtitle: string;
  current: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface FleetLink {
  key: string;
  x: number;
  y: number;
  len: number;
  angle: number;
}

class RowsDataSource implements IDataSource {
  private rows: SessionRow[] = [];
  private listeners: DataChangeListener[] = [];

  totalCount(): number {
    return this.rows.length;
  }

  getData(index: number): SessionRow {
    return this.rows[index];
  }

  registerDataChangeListener(listener: DataChangeListener): void {
    if (this.listeners.indexOf(listener) < 0) {
      this.listeners.push(listener);
    }
  }

  unregisterDataChangeListener(listener: DataChangeListener): void {
    const index: number = this.listeners.indexOf(listener);
    if (index >= 0) {
      this.listeners.splice(index, 1);
    }
  }

  reset(rows: SessionRow[]): void {
    this.rows = rows;
    for (const listener of this.listeners) {
      listener.onDataReloaded();
    }
  }
}

interface TabItem {
  key: string;
  label: string;
}

interface SessionFileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  bytes: number;
  modifiedAt: number;
  hidden: boolean;
}

@Component
export struct SessionPage {
  /** 主题切换时重置一次列表数据源：LazyForEach 已建好的气泡不跟随父级状态重建 */
  @StorageLink('isDark') @Watch('onRowsChanged') isDark: boolean = false;
  @Consume('pageStack') pageStack: NavPathStack;
  @StorageLink('connectionState') @Watch('onPromptConnectionChanged') connection: string = 'disconnected';
  @StorageLink('appLifecycle') @Watch('onVoiceLifecycleChanged') appLifecycle: string = 'foreground';
  @StorageLink('sessions') sessions: SessionSummary[] = [];
  @StorageLink('sessionRows') @Watch('onRowsChanged') rows: SessionRow[] = [];
  @StorageLink('queueItems') queue: QueueItem[] = [];
  @StorageLink('projectedTurns') turns: ProjTurn[] = [];
  @StorageLink('contextDashboard') dashboard: Object | null = null;
  @StorageLink('contextFleet') fleet: Object | null = null;
  @State fleetWidth: number = 0;
  @StorageLink('historyHasMore') hasMoreHistory: boolean = false;
  @State pendingQuestion: GatewayPendingQuestionRequest | null = null;
  @State pendingApproval: GatewayPendingApprovalRequest | null = null;
  @State questionSelections: Record<string, string[]> = {};
  @State questionCustom: Record<string, string> = {};
  @State questionBusy: boolean = false;
  @State approvalBusy: boolean = false;
  @State sessionPickerOpen: boolean = false;
  @State processExpandedTurns: Record<string, boolean> = {};
  @State processMode: string = 'detailed';
  @State processTiming: string = 'completion';
  @State queueBusyId: string = '';
  @State fileEntries: SessionFileEntry[] = [];
  @State filePath: string = '';
  @State fileLoading: boolean = false;
  @State fileHint: string = '';
  @State selectedFile: SessionFileEntry | null = null;
  @State fileDownloadHint: string = '';
  @State fileDownloadBusy: boolean = false;
  @State filePreviewText: string = '';
  @State lastDownloadPath: string = '';
  @State dictating: boolean = false;
  @State dictationHint: string = '';
  private dictation: VoiceDictation = new VoiceDictation();
  private voicePageActive: boolean = false;
  private voicePermissionPending: boolean = false;
  @State pickedAttachments: PickedAttachment[] = [];
  @State attachmentSending: boolean = false;
  @State attachmentHint: string = '';
  private fileLoadGeneration: number = 0;
  private queueActionTimer: number = -1;
  private frameUnsubscribe: (() => void) | null = null;
  private scroller: Scroller = new Scroller();
  private rowsSource: RowsDataSource = new RowsDataSource();
  private autoStick: boolean = true;
  @State draft: string = '';
  @State hint: string = '';
  @State tab: string = 'conversation';

  private tabs: TabItem[] = [
    { key: 'conversation', label: '对话' },
    { key: 'queue', label: '排队' },
    { key: 'trajectory', label: '轨迹' },
    { key: 'context', label: '上下文' },
    { key: 'fleet', label: '编队' },
    { key: 'files', label: '文件' }
  ];

  private pageBg(): string {
    return this.isDark ? '#000000' : '#F2F2F7';
  }

  private cardBg(): string {
    return this.isDark ? '#1C1C1E' : '#FFFFFF';
  }

  private textColor(): string {
    return this.isDark ? '#F1F4FA' : '#101318';
  }

  private subColor(): string {
    return this.isDark ? 'rgba(241, 244, 250, 0.62)' : 'rgba(16, 19, 24, 0.62)';
  }

  build() {
    NavDestination() {
      Column() {
        this.sessionHeader()
        this.tabBar()
        if (this.tab === 'conversation') {
          this.conversationPanel()
        } else if (this.tab === 'queue') {
          this.queuePanel()
        } else if (this.tab === 'trajectory') {
          this.trajectoryPanel()
        } else if (this.tab === 'context') {
          this.contextPanel()
        } else if (this.tab === 'fleet') {
          this.fleetPanel()
        } else if (this.tab === 'files') {
          this.filesPanel()
        } else {
          this.placeholderPanel()
        }
        if (this.hint.length > 0) {
          Text(this.hint)
            .fontSize(12)
            .fontColor('#FF3B30')
            .padding({ left: 16, right: 16, bottom: 4 })
        }
        if (this.sessionPickerOpen) {
          this.sessionPicker()
        }
      }
      .width('100%')
      .height('100%')
      .backgroundColor(this.pageBg())
    }
    .title('会话')
    .backgroundColor(this.pageBg())
  }

  private activeSessionTitle(): string {
    const id: string = SessionStore.get().currentSessionId();
    for (const session of this.sessions) {
      if (session.id === id) {
        return session.title.length > 0 ? session.title : id.substring(0, 8);
      }
    }
    return id.length > 0 ? id.substring(0, 8) : '会话';
  }

  @Builder
  sessionHeader() {
    Row() {
      Text('‹')
        .fontSize(28)
        .fontColor(this.textColor())
        .width(40)
        .height(42)
        .textAlign(TextAlign.Center)
        .onClick(() => {
          this.pageStack.pop();
        })
      Row({ space: 4 }) {
        Text(this.activeSessionTitle())
          .fontSize(16)
          .fontWeight(FontWeight.Medium)
          .fontColor(this.textColor())
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .layoutWeight(1)
        Text('⌄').fontSize(14).fontColor(this.subColor())
      }
      .layoutWeight(1)
      .height(42)
      .onClick(() => {
        this.sessionPickerOpen = true;
      })
      Text('⚙')
        .fontSize(18)
        .fontColor(this.textColor())
        .width(42)
        .height(42)
        .textAlign(TextAlign.Center)
        .onClick(() => {
          this.pageStack.pushPathByName('session-settings', null);
        })
    }
    .width('100%')
    .padding({ left: 8, right: 8, top: 4 })
  }

  @Builder
  sessionPicker() {
    Stack({ alignContent: Alignment.Bottom }) {
      Column()
        .width('100%')
        .height('100%')
        .backgroundColor('rgba(0,0,0,0.45)')
        .onClick(() => { this.sessionPickerOpen = false; })
      Column() {
        Row() {
          Text('切换会话').fontSize(17).fontWeight(FontWeight.Medium).fontColor(this.textColor())
          Blank()
          Text('关闭').fontSize(14).fontColor(this.subColor())
            .onClick(() => { this.sessionPickerOpen = false; })
        }
        .width('100%')
        .height(48)
        .padding({ left: 16, right: 16 })
        List({ space: 2 }) {
          ForEach(this.sessions, (session: SessionSummary) => {
            ListItem() {
              Row({ space: 10 }) {
                Circle({ width: 7, height: 7 }).fill(session.running ? '#34C759' : this.subColor())
                Text(session.title.length > 0 ? session.title : session.id.substring(0, 8))
                  .fontSize(15)
                  .fontColor(this.textColor())
                  .layoutWeight(1)
                  .maxLines(1)
                  .textOverflow({ overflow: TextOverflow.Ellipsis })
                if (session.id === SessionStore.get().currentSessionId()) {
                  Text('当前').fontSize(12).fontColor('#2E6BE6')
                }
              }
              .width('100%')
              .height(48)
              .padding({ left: 16, right: 16 })
              .onClick(() => {
                if (session.id !== SessionStore.get().currentSessionId()) {
                  SessionStore.get().open(session.id);
                  this.restorePendingPrompts();
                  this.questionSelections = {};
                  this.questionCustom = {};
                }
                this.sessionPickerOpen = false;
                this.tab = 'conversation';
              })
            }
          }, (session: SessionSummary) => session.id + '|' + (session.running ? '1' : '0') + '|' + session.title)
        }
        .width('100%')
        .height(320)
        .scrollBar(BarState.Off)
      }
      .width('100%')
      .padding({ top: 8, bottom: 24 })
      .borderRadius({ topLeft: 18, topRight: 18 })
      .backgroundColor(this.pageBg())
    }
    .width('100%')
    .height('100%')
  }

  @Builder
  tabBar() {
    Row({ space: 18 }) {
      ForEach(this.tabs, (tab: TabItem) => {
        Column({ space: 6 }) {
          Text(tab.key === 'queue' && this.queue.length > 0
            ? tab.label + ' ' + this.queue.length
            : tab.label)
            .fontSize(15)
            .fontWeight(this.tab === tab.key ? FontWeight.Medium : FontWeight.Normal)
            .fontColor(this.tab === tab.key ? this.textColor() : this.subColor())
          Divider()
            .width(18)
            .color(this.tab === tab.key ? '#2E6BE6' : 'rgba(0,0,0,0)')
        }
        .onClick(() => {
          this.tab = tab.key;
          if (tab.key === 'files') this.loadSessionFiles('');
          if (tab.key === 'conversation') {
            this.autoStick = true;
            setTimeout(() => {
              this.scroller.scrollEdge(Edge.Bottom);
            }, 30);
          }
        })
      })
    }
    .width('100%')
    .padding({ left: 16, right: 16, top: 10, bottom: 6 })
  }

  @Builder
  conversationPanel() {
    Column() {
      if (this.pendingApproval !== null) {
        this.approvalCard()
      }
      if (this.pendingQuestion !== null) {
        this.questionCard()
      }
      if (this.hasMoreHistory && this.rows.length > 0) {
        Button('加载更早记录')
          .fontSize(12)
          .fontColor('#2E6BE6')
          .backgroundColor(Color.Transparent)
          .height(34)
          .onClick(() => { this.loadOlder(); })
      }
      List({ space: 10, scroller: this.scroller }) {
        if (this.rows.length === 0) {
          ListItem() {
            Column({ space: 6 }) {
              Text(this.connection === 'connected' ? '等待消息…' : '未连接网关')
                .fontSize(15)
                .fontColor(this.textColor())
              Text(this.connection === 'connected'
                ? '已连接：会话历史与流式回复会实时出现在这里。'
                : '到「设置 → 扫码配对」连接 DSH 网关。')
                .fontSize(12)
                .fontColor(this.subColor())
                .textAlign(TextAlign.Center)
            }
            .width('100%')
            .padding(24)
          }
        }
        LazyForEach(this.rowsSource, (row: SessionRow) => {
          ListItem() {
            this.bubble(row)
          }
        }, (row: SessionRow) => row.id)
      }
      .layoutWeight(1)
      .width('100%')
      .padding({ left: 16, right: 16, top: 8, bottom: 8 })
      .scrollBar(BarState.Off)
      .cachedCount(12)
      .onScrollStart(() => {
        this.autoStick = false;
      })

      if (!this.autoStick && this.rows.length > 0) {
        Button('回到底部')
          .height(30)
          .fontSize(12)
          .backgroundColor(this.isDark ? '#2C2C2E' : '#FFFFFF')
          .fontColor('#2E6BE6')
          .margin({ bottom: 6 })
          .onClick(() => {
            this.autoStick = true;
            this.scroller.scrollEdge(Edge.Bottom);
          })
      }
      if (this.turns.length > 0) {
        this.conversationProcessPanel()
      }
      if (this.pickedAttachments.length > 0 || this.attachmentHint.length > 0) {
        Row({ space: 6 }) {
          ForEach(this.pickedAttachments, (attachment: PickedAttachment) => {
            Text(attachment.name)
              .fontSize(11)
              .fontColor(this.textColor())
              .maxLines(1)
              .textOverflow({ overflow: TextOverflow.Ellipsis })
              .padding({ left: 8, right: 8, top: 5, bottom: 5 })
              .borderRadius(6)
              .backgroundColor(this.isDark ? '#2C2C2E' : '#E5E5EA')
              .onClick(() => { this.removeAttachment(attachment.uri); })
          }, (attachment: PickedAttachment) => attachment.uri)
          if (this.attachmentHint.length > 0) {
            Text(this.attachmentHint).fontSize(11).fontColor('#D9413A')
          }
        }
        .width('100%')
        .padding({ left: 12, right: 12, top: 4 })
      }
      if (this.dictating) {
        // 旧工具页只留一个小的音量条；全屏特效在对话页（VoiceRipplePanel 现在是整页覆盖层）
        Row({ space: 3 }) {
          ForEach([0.3, 0.6, 1, 0.6, 0.3], (factor: number) => {
            Column()
              .width(3)
              .height(10 + factor * 18)
              .borderRadius(2)
              .backgroundColor('#2E6BE6')
          }, (factor: number) => factor.toString())
        }
        .height(30)
        .padding({ left: 12, right: 12 })
        .alignItems(VerticalAlign.Center)
      }
      if (this.dictationHint.length > 0) {
        Text(this.dictationHint).fontSize(11).fontColor(this.subColor())
          .width('100%').padding({ left: 12, right: 12 });
      }
      Row() {
        Button('附件')
          .height(44)
          .fontSize(12)
          .backgroundColor(this.cardBg())
          .fontColor(this.textColor())
          .onClick(() => { this.pickAttachments(); })
        Button(this.dictating ? '停止' : '语音')
          .height(44).fontSize(12)
          .backgroundColor(this.dictating ? '#D9413A' : this.cardBg())
          .fontColor(this.dictating ? '#FFFFFF' : this.textColor())
          .margin({ left: 8 })
          .onClick(() => { this.toggleDictation(); })
        TextArea({ text: this.draft, placeholder: '输入内容并发送到 DSH' })
          .caretStyle({ width: 1 })
          .onChange((value: string) => {
            this.draft = value;
          })
          .layoutWeight(1)
          .height(44)
          .fontSize(15)
          .fontColor(this.textColor())
          .backgroundColor(this.isDark ? '#2C2C2E' : '#FFFFFF')
          .borderRadius(12)
        Button('发送')
          .height(44)
          .margin({ left: 8 })
          .backgroundColor('#2E6BE6')
          .onClick(() => {
            this.send();
          })
      }
      .width('100%')
      .padding(12)
      .backgroundColor(this.cardBg())
    }
    .layoutWeight(1)
    .width('100%')
  }

  @Builder
  conversationProcessPanel() {
    Column({ space: 8 }) {
      Row({ space: 4 }) {
        ForEach(['compact', 'standard', 'detailed', 'verbose'], (mode: string) => {
          Text(this.processModeLabel(mode))
            .fontSize(10)
            .fontColor(this.processMode === mode ? '#2E6BE6' : this.subColor())
            .padding({ left: 6, right: 6, top: 4, bottom: 4 })
            .borderRadius(6)
            .backgroundColor(this.processMode === mode ? 'rgba(46,107,230,0.12)' : Color.Transparent)
            .onClick(() => { this.setProcessMode(mode); })
        }, (mode: string) => mode)
        Blank()
        ForEach(['completion', 'next-input'], (timing: string) => {
          Text(timing === 'completion' ? '回答结束后' : '下次输入时')
            .fontSize(10)
            .fontColor(this.processTiming === timing ? '#2E6BE6' : this.subColor())
            .padding({ left: 5, right: 5, top: 4, bottom: 4 })
            .onClick(() => { this.setProcessTiming(timing); })
        }, (timing: string) => timing)
      }
      .width('100%')
      Scroll() {
        Column({ space: 6 }) {
          ForEach(this.processTurns(), (turn: ProjTurn) => {
            this.processTurnCard(turn)
          }, (turn: ProjTurn) => turn.turn.toString())
        }
        .width('100%')
      }
      .height(190)
      .width('100%')
      .scrollBar(BarState.Off)
    }
    .alignItems(HorizontalAlign.Start)
    .width('calc(100% - 24vp)')
    .padding(8)
    .margin({ left: 12, right: 12, bottom: 4 })
    .borderRadius(8)
    .backgroundColor(this.cardBg())
    .border({ width: 1, color: this.isDark ? 'rgba(241,244,250,0.10)' : 'rgba(16,19,24,0.08)' })
  }

  @Builder
  processTurnCard(turn: ProjTurn) {
    Column({ space: 5 }) {
      Row({ space: 8 }) {
        Column({ space: 2 }) {
          Text(this.processSummary(turn))
            .fontSize(12)
            .fontWeight(FontWeight.Medium)
            .fontColor(this.textColor())
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
          Text('第 ' + turn.turn + ' 轮' + (turn.status === 'running' ? ' · 正在进行' : ' · 已结束'))
            .fontSize(10)
            .fontColor(this.subColor())
        }
        .alignItems(HorizontalAlign.Start)
        .layoutWeight(1)
        Text(this.showProcessDetails(turn) ? '收起' : '查看过程')
          .fontSize(11)
          .fontColor('#2E6BE6')
          .onClick(() => { this.toggleProcessTurn(turn); })
      }
      .width('100%')
      if (this.showProcessDetails(turn)) {
        ForEach(turn.steps, (step: ProjStep) => {
          Column({ space: 4 }) {
            Row({ space: 6 }) {
              Text('步骤 ' + step.step).fontSize(10).fontColor(this.subColor())
              Blank()
              Text(step.status === 'running' ? '进行中' : '完成')
                .fontSize(9).fontColor(step.status === 'running' ? '#E0A400' : this.subColor())
            }.width('100%')
            ForEach(step.tools, (tool: ProjTool) => {
              Column({ space: 2 }) {
                Row({ space: 6 }) {
                  Circle().width(6).height(6)
                    .fill(tool.status === 'running' ? '#E0A400' : (tool.status === 'error' ? '#D9413A' : '#34C759'))
                  Text(this.processToolLabel(tool.name)).fontSize(11).fontColor(this.textColor()).layoutWeight(1)
                  Text(tool.status === 'running' ? '运行中' : (tool.status === 'error' ? '失败' : '完成'))
                    .fontSize(9).fontColor(this.subColor())
                }.width('100%')
                if (tool.detail.length > 0) {
                  Text(this.processToolDetail(tool.detail)).fontSize(10).fontColor(this.subColor())
                    .width('100%').maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis })
                }
              }
              .width('100%').padding({ left: 10, top: 2, bottom: 2 })
            }, (tool: ProjTool) => tool.callId)
          }
          .alignItems(HorizontalAlign.Start).width('100%')
        }, (step: ProjStep) => step.step.toString())
      }
    }
    .alignItems(HorizontalAlign.Start)
    .width('100%')
    .padding(8)
    .borderRadius(6)
    .backgroundColor(this.isDark ? 'rgba(255,255,255,0.03)' : 'rgba(16,19,24,0.03)')
  }

  private loadProcessPreferences(): void {
    const raw: string = PreferencesStore.get().getString('workStepPresentation', '');
    if (raw.length === 0) return;
    try {
      const record = asRec(JSON.parse(raw) as Object);
      if (record === undefined) return;
      const mode: string | undefined = str(record, 'mode');
      const timing: string | undefined = str(record, 'timing');
      if (mode === 'compact' || mode === 'standard' || mode === 'detailed' || mode === 'verbose') {
        this.processMode = mode;
      }
      if (timing === 'completion' || timing === 'next-input') this.processTiming = timing;
    } catch (err) {
      this.processMode = 'detailed';
      this.processTiming = 'completion';
    }
  }

  private saveProcessPreferences(): void {
    PreferencesStore.get().putString('workStepPresentation', JSON.stringify({
      mode: this.processMode, timing: this.processTiming
    }));
  }

  private setProcessMode(mode: string): void {
    this.processMode = mode;
    this.processExpandedTurns = {};
    this.saveProcessPreferences();
  }

  private setProcessTiming(timing: string): void {
    this.processTiming = timing;
    this.saveProcessPreferences();
  }

  private processModeLabel(mode: string): string {
    if (mode === 'compact') return '简洁';
    if (mode === 'standard') return '标准';
    if (mode === 'verbose') return '完全展开';
    return '详细';
  }

  private processTurns(): ProjTurn[] {
    return this.turns.slice().reverse();
  }

  private showProcessDetails(turn: ProjTurn): boolean {
    const key: string = turn.turn.toString();
    const manual: boolean | undefined = this.processExpandedTurns[key];
    if (manual !== undefined) return manual;
    if (this.processMode === 'verbose') return true;
    const latest: ProjTurn | null = this.latestTurn();
    if (this.processMode === 'detailed' && this.processTiming === 'next-input' && latest !== null &&
      turn.turn === latest.turn && turn.status !== 'running') return true;
    return turn.status === 'running' && this.processMode !== 'compact';
  }

  private toggleProcessTurn(turn: ProjTurn): void {
    const key: string = turn.turn.toString();
    this.processExpandedTurns[key] = !this.showProcessDetails(turn);
  }

  private latestTurn(): ProjTurn | null {
    return this.turns.length > 0 ? this.turns[this.turns.length - 1] : null;
  }

  private processSummary(turn: ProjTurn): string {
    let count: number = 0;
    let running: string = '';
    let failed: boolean = false;
    for (const step of turn.steps) {
      for (const tool of step.tools) {
        count += 1;
        if (tool.status === 'running') running = this.processToolLabel(tool.name);
        if (tool.status === 'error') failed = true;
      }
    }
    if (turn.status === 'running') return running.length > 0 ? '正在' + running : '正在思考';
    if (failed) return '本轮运行失败';
    return count > 0 ? '已完成 · ' + count + ' 次工具调用' : '已完成分析';
  }

  private processToolLabel(name: string): string {
    const n: string = name.toLowerCase().split(/[./]/).pop() ?? name;
    if (n === 'bash' || n === 'exec_command' || n.startsWith('terminal')) return '执行命令';
    if (n === 'read' || n === 'read_file' || n === 'web_fetch') return '读取内容';
    if (n === 'grep' || n === 'glob' || n === 'web_search') return '搜索';
    if (n === 'write') return '写入文件';
    if (n === 'edit' || n === 'apply_patch') return '修改文件';
    if (n === 'run_code') return '运行代码';
    return name.length > 0 ? '执行 ' + name : '工具调用';
  }

  private processToolDetail(raw: string): string {
    try {
      const value: Object = JSON.parse(raw) as Object;
      const description: string | undefined = str(value, 'description');
      const path: string | undefined = str(value, 'path') ?? str(value, 'file_path');
      const query: string | undefined = str(value, 'query') ?? str(value, 'pattern');
      return description ?? path ?? query ?? raw;
    } catch (err) {
      return raw;
    }
  }

  @Builder
  approvalCard() {
    Column({ space: 8 }) {
      Text('需要批准')
        .fontSize(14)
        .fontWeight(FontWeight.Medium)
        .fontColor(this.textColor())
      Text(this.pendingApproval !== null ? this.pendingApproval.toolName : '')
        .fontSize(15)
        .fontColor(this.textColor())
        .width('100%')
      if (this.pendingApproval !== null && this.pendingApproval.reason !== undefined) {
        Text(this.pendingApproval.reason)
          .fontSize(12)
          .fontColor(this.subColor())
          .width('100%')
      }
      Row({ space: 8 }) {
        Button(this.approvalBusy ? '处理中…' : '允许一次')
          .layoutWeight(1)
          .height(38)
          .backgroundColor('#2E6BE6')
          .enabled(!this.approvalBusy)
          .onClick(() => { this.respondApproval('allowed-once'); })
        Button('拒绝')
          .layoutWeight(1)
          .height(38)
          .backgroundColor('#D9413A')
          .enabled(!this.approvalBusy)
          .onClick(() => { this.respondApproval('rejected'); })
      }
      .width('100%')
    }
    .alignItems(HorizontalAlign.Start)
    .width('calc(100% - 32vp)')
    .padding(14)
    .margin({ left: 16, right: 16, top: 8 })
    .borderRadius(8)
    .backgroundColor(this.cardBg())
    .border({ width: 1, color: '#E8A23A' })
  }

  @Builder
  questionCard() {
    Column({ space: 10 }) {
      Text(this.pendingQuestion !== null && this.pendingQuestion.questions.length > 0
        ? (this.pendingQuestion.questions[0].header ?? '需要你回答') : '需要你回答')
        .fontSize(14)
        .fontWeight(FontWeight.Medium)
        .fontColor(this.textColor())
      if (this.pendingQuestion !== null) {
        ForEach(this.pendingQuestion.questions, (question: GatewayQuestion) => {
          Column({ space: 7 }) {
            Text(question.question)
              .fontSize(14)
              .fontColor(this.textColor())
              .width('100%')
            if (question.detail !== undefined && question.detail.length > 0) {
              Text(question.detail).fontSize(12).fontColor(this.subColor()).width('100%')
            }
            if (question.options !== undefined) {
              ForEach(question.options, (option: GatewayQuestionOption) => {
                Row({ space: 8 }) {
                  Text(question.multiSelect === true
                    ? (this.questionSelections[question.id] !== undefined &&
                      this.questionSelections[question.id].indexOf(option.label) >= 0 ? '☑' : '□')
                    : (this.questionSelections[question.id] !== undefined &&
                      this.questionSelections[question.id].indexOf(option.label) >= 0 ? '●' : '○'))
                    .fontSize(15)
                    .fontColor('#2E6BE6')
                  Text(option.label).fontSize(13).fontColor(this.textColor()).layoutWeight(1)
                  if (option.description !== undefined && option.description.length > 0) {
                    Text(option.description).fontSize(11).fontColor(this.subColor())
                  }
                }
                .width('100%')
                .padding({ top: 4, bottom: 4 })
                .onClick(() => { this.toggleQuestionOption(question, option.label); })
              }, (option: GatewayQuestionOption) => option.label)
            }
            TextInput({ text: this.questionCustom[question.id] ?? '', placeholder: '或输入自定义答案' })
              .fontSize(13)
              .height(38)
              .backgroundColor(this.isDark ? '#2C2C2E' : '#F2F2F7')
              .onChange((value: string) => { this.updateQuestionCustom(question.id, value); })
          }
          .alignItems(HorizontalAlign.Start)
          .width('100%')
          .padding({ top: 4, bottom: 4 })
        }, (question: GatewayQuestion) => question.id)
      }
      Row({ space: 8 }) {
        Button(this.questionBusy ? '提交中…' : '提交答案')
          .layoutWeight(1)
          .height(38)
          .backgroundColor('#2E6BE6')
          .enabled(!this.questionBusy)
          .onClick(() => { this.submitQuestion(); })
        Button('放弃')
          .height(38)
          .backgroundColor(this.isDark ? '#3A3A3C' : '#E5E5EA')
          .fontColor(this.textColor())
          .enabled(!this.questionBusy)
          .onClick(() => { this.cancelQuestion(); })
      }
      .width('100%')
    }
    .alignItems(HorizontalAlign.Start)
    .width('calc(100% - 32vp)')
    .padding(14)
    .margin({ left: 16, right: 16, top: 8 })
    .borderRadius(8)
    .backgroundColor(this.cardBg())
    .border({ width: 1, color: '#2E6BE6' })
  }

  @Builder
  queuePanel() {
    Column() {
      if (this.queue.length === 0) {
        Column({ space: 6 }) {
          Text('队列为空')
            .fontSize(15)
            .fontColor(this.textColor())
          Text('回合进行中发送的消息会排在队列里，可「立刻发送」或删除。')
            .fontSize(12)
            .fontColor(this.subColor())
            .textAlign(TextAlign.Center)
        }
        .width('100%')
        .padding(24)
      } else {
        List({ space: 10 }) {
          ForEach(this.queue, (item: QueueItem) => {
            ListItem() {
              Column({ space: 8 }) {
                Text(item.preview.length > 0 ? item.preview : '（无文本）')
                  .fontSize(15)
                  .fontColor(this.textColor())
                  .width('100%')
                  .maxLines(3)
                  .textOverflow({ overflow: TextOverflow.Ellipsis })
                Row({ space: 8 }) {
                  Button('编辑')
                    .height(32)
                    .fontSize(12)
                    .backgroundColor(this.isDark ? '#3A3A3C' : '#E5E5EA')
                    .fontColor(this.textColor())
                    .enabled(this.queueBusyId.length === 0)
                    .onClick(() => {
                      this.editQueueItem(item);
                    })
                  Button(this.queueBusyId === item.id ? '处理中…' : '立刻发送')
                    .height(32)
                    .fontSize(12)
                    .backgroundColor('#2E6BE6')
                    .enabled(this.queueBusyId.length === 0)
                    .onClick(() => {
                      this.queueAction(item.id, 'steer');
                    })
                  Button('删除')
                    .height(32)
                    .fontSize(12)
                    .backgroundColor('#8E8E93')
                    .enabled(this.queueBusyId.length === 0)
                    .onClick(() => {
                      this.queueAction(item.id, 'remove');
                    })
                }
                .width('100%')
              }
              .alignItems(HorizontalAlign.Start)
              .padding(14)
              .borderRadius(14)
              .backgroundColor(this.cardBg())
            }
          }, (item: QueueItem) => item.id)
        }
        .layoutWeight(1)
        .width('100%')
        .padding(16)
        .scrollBar(BarState.Off)
      }
    }
    .layoutWeight(1)
    .width('100%')
  }

  @Builder
  trajectoryPanel() {
    Column() {
      if (this.turns.length === 0) {
        Column({ space: 6 }) {
          Text('暂无轨迹')
            .fontSize(15)
            .fontColor(this.textColor())
          Text('收到回合事件后会按「轮次 → 步骤 → 工具调用」显示在这里。')
            .fontSize(12)
            .fontColor(this.subColor())
            .textAlign(TextAlign.Center)
        }
        .width('100%')
        .padding(24)
      } else {
        List({ space: 10 }) {
          ForEach(this.turns, (turn: ProjTurn) => {
            ListItem() {
              Column({ space: 8 }) {
                Row() {
                  Text('第 ' + turn.turn + ' 轮')
                    .fontSize(14)
                    .fontWeight(FontWeight.Medium)
                    .fontColor(this.textColor())
                  Blank()
                  Text(turn.status === 'running' ? '进行中' : '已完成')
                    .fontSize(11)
                    .fontColor(turn.status === 'running' ? '#34C759' : this.subColor())
                }
                .width('100%')
                if (turn.userText.length > 0) {
                  Text(turn.userText)
                    .fontSize(12)
                    .fontColor(this.subColor())
                    .width('100%')
                    .maxLines(2)
                    .textOverflow({ overflow: TextOverflow.Ellipsis })
                }
                if (turn.assistantText.length > 0) {
                  Text(turn.assistantText)
                    .fontSize(13)
                    .fontColor(this.textColor())
                    .width('100%')
                    .maxLines(4)
                    .textOverflow({ overflow: TextOverflow.Ellipsis })
                }
                ForEach(turn.steps, (step: ProjStep) => {
                  Column({ space: 6 }) {
                    Text('步骤 ' + step.step + (step.status === 'running' ? ' · 执行中' : ''))
                      .fontSize(12)
                      .fontColor(this.subColor())
                      .width('100%')
                    ForEach(step.tools, (tool: ProjTool) => {
                      Row({ space: 8 }) {
                        Circle()
                          .width(7)
                          .height(7)
                          .fill(tool.status === 'running' ? '#FFCC00'
                            : (tool.status === 'error' ? '#FF3B30' : '#34C759'))
                        Text(tool.name)
                          .fontSize(14)
                          .fontColor(this.textColor())
                          .layoutWeight(1)
                        Text(tool.status === 'running' ? '执行中' : (tool.status === 'error' ? '失败' : '完成'))
                          .fontSize(11)
                          .fontColor(this.subColor())
                      }
                      .width('100%')
                      .padding({ top: 2, bottom: 2 })
                      if (tool.detail.length > 0) {
                        Text(tool.detail)
                          .fontSize(11)
                          .fontColor(this.subColor())
                          .width('100%')
                          .maxLines(3)
                          .textOverflow({ overflow: TextOverflow.Ellipsis })
                      }
                    }, (tool: ProjTool) => tool.callId)
                  }
                  .alignItems(HorizontalAlign.Start)
                  .width('100%')
                }, (step: ProjStep) => step.step.toString())
              }
              .alignItems(HorizontalAlign.Start)
              .padding(14)
              .borderRadius(14)
              .backgroundColor(this.cardBg())
            }
          }, (turn: ProjTurn) => turn.turn.toString())
        }
        .layoutWeight(1)
        .width('100%')
        .padding(16)
        .scrollBar(BarState.Off)
      }
    }
    .layoutWeight(1)
    .width('100%')
  }

  @Builder
  contextPanel() {
    Column({ space: 10 }) {
      Row({ space: 10 }) {
        this.metricTile('请求数', this.dashNumber('requests', true))
        this.metricTile('上下文窗口', this.dashText('contextWindow'))
        this.metricTile('轮次', this.dashText('stats.turns'))
      }
      .padding({ left: 16, right: 16, top: 12 })
      List({ space: 8 }) {
        if (this.dashRequests().length === 0) {
          ListItem() {
            Column({ space: 6 }) {
              Text('暂无上下文数据')
                .fontSize(15)
                .fontColor(this.textColor())
              Text('连接会话后会自动拉取 context-dashboard。')
                .fontSize(12)
                .fontColor(this.subColor())
                .textAlign(TextAlign.Center)
            }
            .width('100%')
            .padding(24)
          }
        }
        ForEach(this.dashRequests(), (request: Object) => {
          ListItem() {
            Row() {
              Text('#' + (str(request, 'seq') ?? '-'))
                .fontSize(13)
                .fontColor(this.subColor())
                .width(64)
              Text('输入 ' + (num(asRec(str(request, 'usage')) ?? undefined, 'uncachedInputTokens') ?? 0).toString() + ' tok')
                .fontSize(13)
                .fontColor(this.textColor())
                .layoutWeight(1)
              Text('输出 ' + (num(asRec(str(request, 'usage')) ?? undefined, 'outputTokens') ?? 0).toString() + ' tok')
                .fontSize(13)
                .fontColor(this.subColor())
            }
            .width('100%')
            .padding(12)
            .borderRadius(12)
            .backgroundColor(this.cardBg())
          }
        }, (request: Object, index: number) => index.toString())
      }
      .layoutWeight(1)
      .width('100%')
      .padding(16)
      .scrollBar(BarState.Off)
    }
    .layoutWeight(1)
    .width('100%')
  }

  @Builder
  filesPanel() {
    Column({ space: 10 }) {
      Row({ space: 8 }) {
        Button('上级')
          .height(34)
          .fontSize(12)
          .enabled(this.filePath.length > 0 && !this.fileLoading)
          .backgroundColor(this.cardBg())
          .fontColor(this.textColor())
          .onClick(() => { this.goUpSessionFiles(); })
        Text(this.filePath.length > 0 ? this.filePath : '工作区根目录')
          .fontSize(11)
          .fontColor(this.subColor())
          .layoutWeight(1)
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
        Button('刷新')
          .height(34)
          .fontSize(12)
          .backgroundColor(this.cardBg())
          .fontColor('#2E6BE6')
          .onClick(() => { this.loadSessionFiles(this.filePath); })
      }
      .width('100%')
      .padding({ left: 16, right: 16, top: 8 })
      if (this.fileLoading) {
        Text('正在读取工作区文件…').fontSize(12).fontColor(this.subColor()).padding(16)
      } else if (this.fileHint.length > 0) {
        Text(this.fileHint).fontSize(12).fontColor('#D9413A').padding(16)
      } else if (this.fileEntries.length === 0) {
        Text('此目录为空').fontSize(13).fontColor(this.subColor()).padding(16)
      } else {
        List({ space: 1 }) {
          ForEach(this.fileEntries, (entry: SessionFileEntry) => {
            ListItem() {
              Row({ space: 10 }) {
                Image(entry.isDirectory ? $r('app.media.workspace_folder_blue') : $r('app.media.workspace_folder_blue'))
                  .width(20).height(20).objectFit(ImageFit.Contain).opacity(entry.isDirectory ? 1 : 0.55)
                Column({ space: 3 }) {
                  Text(entry.name).fontSize(14).fontColor(this.textColor()).maxLines(1)
                    .textOverflow({ overflow: TextOverflow.Ellipsis });
                  Text(entry.path + (entry.isDirectory ? '' : (entry.bytes > 0 ? ' · ' + this.fileSizeLabel(entry.bytes) : '')))
                    .fontSize(10).fontColor(this.subColor()).maxLines(1)
                    .textOverflow({ overflow: TextOverflow.Ellipsis });
                }.alignItems(HorizontalAlign.Start).layoutWeight(1);
                if (entry.isDirectory) Text('›').fontSize(20).fontColor(this.subColor());
              }
              .width('100%')
              .padding({ left: 14, right: 14, top: 11, bottom: 11 })
              .onClick(() => { this.openSessionFile(entry); })
            }
          }, (entry: SessionFileEntry) => entry.path)
        }
        .layoutWeight(1)
        .width('100%')
        .padding({ left: 16, right: 16 })
        .scrollBar(BarState.Off)
      }
      if (this.selectedFile !== null) {
        this.selectedFileCard(this.selectedFile)
      }
    }
    .layoutWeight(1)
    .width('100%')
  }

  @Builder
  selectedFileCard(entry: SessionFileEntry) {
    Column({ space: 6 }) {
      Row({ space: 6 }) {
        FileTypeIcon({ name: entry.name, isDirectory: entry.isDirectory });
        Text(entry.name).fontSize(14).fontWeight(FontWeight.Medium).fontColor(this.textColor());
      }
      Text(entry.path + (entry.bytes > 0 ? ' · ' + this.fileSizeLabel(entry.bytes) : ''))
        .fontSize(11).fontColor(this.subColor()).width('100%');
      if (this.filePreviewText.length > 0) {
        if (this.isCodeFile(entry.name)) {
          CodeSyntaxHighlighter({ code: this.filePreviewText, language: this.codeLanguage(entry.name) });
        } else {
          Text(this.filePreviewText)
            .fontSize(11).fontColor(this.textColor()).width('100%')
            .maxLines(12).textOverflow({ overflow: TextOverflow.Ellipsis })
            .padding(8).backgroundColor(this.isDark ? '#101116' : '#F2F2F7')
        }
      }
      if (this.fileDownloadHint.length > 0) {
        Text(this.fileDownloadHint).fontSize(11).fontColor(this.fileDownloadBusy ? this.subColor() : '#D9413A').width('100%');
      }
      Row({ space: 8 }) {
        Button(this.fileDownloadBusy ? '下载中…' : '下载到本地')
          .height(34).fontSize(12).backgroundColor('#2E6BE6').fontColor('#FFFFFF')
          .enabled(!this.fileDownloadBusy)
          .onClick(() => { this.downloadSelectedFile(entry); });
        if (this.lastDownloadPath.length > 0) {
          Button('打开文件')
            .height(34).fontSize(12).backgroundColor(this.cardBg()).fontColor(this.textColor())
            .onClick(() => { this.openLastDownload(); });
        }
        Button('插入路径到输入框')
          .height(34).fontSize(12).backgroundColor('#2E6BE6').fontColor('#FFFFFF')
          .onClick(() => { this.insertSelectedFilePath(entry.path); });
        Button('关闭').height(34).fontSize(12).backgroundColor(this.cardBg()).fontColor(this.textColor())
          .onClick(() => { this.selectedFile = null; });
      }
      .width('100%')
    }
    .alignItems(HorizontalAlign.Start)
    .width('100%')
    .padding(12)
    .backgroundColor(this.cardBg())
  }

  private async downloadSelectedFile(entry: SessionFileEntry): Promise<void> {
    const sessionId: string = SessionStore.get().currentSessionId();
    if (sessionId.length === 0 || !GatewayClient.get().isConnected()) {
      this.fileDownloadHint = '请先连接网关并打开会话';
      return;
    }
    try {
      this.fileDownloadBusy = true;
      this.fileDownloadHint = '正在下载 0%';
      const context = getContext(this) as common.UIAbilityContext;
      const result: DownloadResult = await downloadAttachment(context, GatewayClient.get(), sessionId, entry.path, (percent: number) => {
        this.fileDownloadHint = '正在下载 ' + percent + '%';
      });
      this.filePreviewText = '';
      if (result.size <= 256 * 1024) {
        try {
          const preview: string = await fileIo.readText(result.localPath);
          this.filePreviewText = preview.substring(0, 12000);
        } catch (err) {
          this.filePreviewText = '';
        }
      }
      this.lastDownloadPath = result.localPath;
      this.fileDownloadHint = '已保存：' + result.localPath;
    } catch (error) {
      this.fileDownloadHint = error instanceof Error ? error.message : '下载失败，请重试';
    } finally {
      this.fileDownloadBusy = false;
    }
  }

  private onVoiceLifecycleChanged(): void {
    if (this.appLifecycle === 'background') {
      this.dictation.cancel();
      this.dictating = false;
      this.dictationHint = '';
    }
  }

  private async toggleDictation(): Promise<void> {
    if (this.dictation.isActive()) {
      this.dictation.stop();
      this.dictating = false;
      this.dictationHint = '';
      return;
    }
    if (this.voicePermissionPending) return;
    this.voicePermissionPending = true;
    try {
      this.dictationHint = '正在请求麦克风权限…';
      const context = getContext(this) as common.UIAbilityContext;
      const permission = await abilityAccessCtrl.createAtManager().requestPermissionsFromUser(context, ['ohos.permission.MICROPHONE']);
      if (!this.voicePageActive || this.appLifecycle !== 'foreground') return;
      if (permission.authResults.length === 0 || permission.authResults[0] !== 0) {
        this.dictationHint = '未获得麦克风权限';
        return;
      }
      this.dictationHint = '正在启动语音识别…';
      await this.dictation.start(
        (partial: string) => {
          this.dictationHint = '识别中：' + partial;
        },
        (finalText: string) => {
          this.draft = this.draft.length > 0 ? this.draft + finalText : finalText;
          this.dictating = false;
          this.dictationHint = '';
        },
        (message: string) => {
          this.dictationHint = '语音识别失败：' + message;
          this.dictating = false;
        },
        () => { this.dictating = false; this.dictationHint = ''; }
      );
      if (!this.voicePageActive || !this.dictation.isActive()) return;
      this.dictating = true;
      this.dictationHint = '正在聆听，点击停止结束';
    } catch (err) {
      this.dictating = false;
      this.dictationHint = '语音识别不可用';
    } finally {
      this.voicePermissionPending = false;
    }
  }

  private async openLastDownload(): Promise<void> {
    if (this.lastDownloadPath.length === 0) return;
    try {
      const context = getContext(this) as common.UIAbilityContext;
      const mime: string = this.mimeForPath(this.lastDownloadPath);
      await AttachmentCache.openExternally(context, this.lastDownloadPath, mime);
    } catch (err) {
      this.fileDownloadHint = '无法打开该文件，未找到支持的应用';
    }
  }

  private isCodeFile(name: string): boolean {
    const lower: string = name.toLowerCase();
    return lower.endsWith('.ts') || lower.endsWith('.ets') || lower.endsWith('.js') ||
      lower.endsWith('.json') || lower.endsWith('.kt') || lower.endsWith('.swift') || lower.endsWith('.md');
  }

  private codeLanguage(name: string): string {
    const lower: string = name.toLowerCase();
    if (lower.endsWith('.ts')) return 'typescript';
    if (lower.endsWith('.ets')) return 'arkts';
    if (lower.endsWith('.js')) return 'javascript';
    if (lower.endsWith('.json')) return 'json';
    if (lower.endsWith('.kt')) return 'kotlin';
    if (lower.endsWith('.swift')) return 'swift';
    return 'markdown';
  }

  private mimeForPath(path: string): string {
    const lower: string = path.toLowerCase();
    if (lower.endsWith('.png')) return 'image/png';
    if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
    if (lower.endsWith('.gif')) return 'image/gif';
    if (lower.endsWith('.pdf')) return 'application/pdf';
    if (lower.endsWith('.txt') || lower.endsWith('.md')) return 'text/plain';
    if (lower.endsWith('.json')) return 'application/json';
    return '';
  }

  private insertSelectedFilePath(path: string): void {
    this.draft = this.draft.length > 0 ? this.draft + '\n' + path : path;
    this.selectedFile = null;
    this.tab = 'conversation';
  }

  private loadSessionFiles(path: string): void {
    const sessionId: string = SessionStore.get().currentSessionId();
    if (sessionId.length === 0 || !GatewayClient.get().isConnected()) {
      this.fileHint = '请先连接网关并打开会话';
      this.fileEntries = [];
      return;
    }
    this.fileLoadGeneration += 1;
    const generation: number = this.fileLoadGeneration;
    this.fileLoading = true;
    this.fileHint = '';
    this.selectedFile = null;
    GatewayClient.get().requestFileList(sessionId, path).then((frame) => {
      if (generation !== this.fileLoadGeneration || sessionId !== SessionStore.get().currentSessionId()) return;
      const raw = asRec(frame as Object);
      const value: Object | undefined = raw !== undefined ? raw['entries'] : undefined;
      const list: Object[] = Array.isArray(value) ? value as Object[] : (frame.items !== undefined ? frame.items : []);
      const entries: SessionFileEntry[] = [];
      for (const item of list) {
        const itemPath: string = str(item, 'path') ?? '';
        if (itemPath.length === 0) continue;
        const kind: string = str(item, 'kind') ?? '';
        entries.push({
          name: str(item, 'name') ?? str(item, 'title') ?? itemPath,
          path: itemPath,
          isDirectory: kind === 'dir' || kind === 'directory' || bool(item, 'isDirectory') === true,
          bytes: num(item, 'bytes') ?? num(item, 'size') ?? 0,
          modifiedAt: num(item, 'modifiedAt') ?? 0,
          hidden: bool(item, 'hidden') === true
        });
      }
      this.fileEntries = entries;
      this.filePath = str(frame, 'path') ?? path;
      this.fileLoading = false;
    }).catch((error: Error) => {
      if (generation !== this.fileLoadGeneration) return;
      this.fileLoading = false;
      this.fileHint = error.message.length > 0 ? error.message : '读取目录失败，请重试';
    });
  }

  private openSessionFile(entry: SessionFileEntry): void {
    if (entry.isDirectory) this.loadSessionFiles(entry.path);
    else this.selectedFile = entry;
  }

  private goUpSessionFiles(): void {
    const value: string = this.filePath.endsWith('/') ? this.filePath.substring(0, this.filePath.length - 1) : this.filePath;
    const index: number = value.lastIndexOf('/');
    this.loadSessionFiles(index > 0 ? value.substring(0, index) : '');
  }

  private fileSizeLabel(bytes: number): string {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  @Builder
  fleetPanel() {
    Stack() {
      ForEach(this.fleetLinks(), (link: FleetLink) => {
        Row()
          .width(link.len)
          .height(1)
          .backgroundColor(this.isDark ? 'rgba(241,244,250,0.28)' : 'rgba(16,19,24,0.22)')
          .position({ x: link.x, y: link.y })
          .rotate({ angle: link.angle })
      }, (link: FleetLink) => link.key)

      ForEach(this.fleetNodes(), (node: FleetNode) => {
        Column({ space: 6 }) {
          Row() {
            Text(node.title)
              .fontSize(14)
              .fontWeight(FontWeight.Medium)
              .fontColor(this.textColor())
              .layoutWeight(1)
              .maxLines(1)
              .textOverflow({ overflow: TextOverflow.Ellipsis })
            Text(node.current ? '当前' : '子 Agent')
              .fontSize(10)
              .fontColor(node.current ? '#34C759' : this.subColor())
          }
          .width('100%')
          Text(node.subtitle)
            .fontSize(10)
            .fontColor(this.subColor())
            .width('100%')
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
        }
        .alignItems(HorizontalAlign.Start)
        .padding(12)
        .width(node.w)
        .height(node.h)
        .borderRadius(14)
        .backgroundColor(this.cardBg())
        .border({ width: node.current ? 1.5 : 1, color: node.current ? '#2E6BE6' : (this.isDark ? 'rgba(241,244,250,0.10)' : 'rgba(16,19,24,0.08)') })
        .position({ x: node.x, y: node.y })
      }, (node: FleetNode) => node.key)
    }
    .width('100%')
    .height(this.fleetHeight())
    .onAreaChange((oldValue: Area, newValue: Area) => {
      const width: number = Number(newValue.width);
      if (width > 0 && Math.abs(width - this.fleetWidth) > 1) {
        this.fleetWidth = width;
      }
    })
    .layoutWeight(1)
  }

  private fleetNodes(): FleetNode[] {
    const agents: Object[] = this.fleetAgents();
    if (agents.length === 0) {
      return [];
    }
    const width: number = this.fleetWidth > 0 ? this.fleetWidth - 32 : 328;
    const nodes: FleetNode[] = [];
    const rootH: number = 76;
    const childH: number = 72;
    const gapY: number = 34;
    const cols: number = width >= 320 ? 2 : 1;
    const gapX: number = 10;
    const childW: number = (width - (cols - 1) * gapX) / cols;
    const titles: Object[] = agents;
    // 当前 Agent 作为根节点；其余作为子节点。
    let rootIndex: number = -1;
    for (let i = 0; i < titles.length; i++) {
      if (this.agentCurrent(titles[i])) {
        rootIndex = i;
        break;
      }
    }
    const root: Object | undefined = rootIndex >= 0 ? titles[rootIndex] : titles[0];
    const children: Object[] = [];
    for (let i = 0; i < titles.length; i++) {
      if (i !== rootIndex && titles[i] !== root) {
        children.push(titles[i]);
      }
    }
    nodes.push({
      key: 'root',
      title: this.agentTitle(root),
      subtitle: (str(root, 'sessionId') ?? '').substring(0, 18),
      current: true,
      x: 16,
      y: 8,
      w: width,
      h: rootH
    });
    for (let i = 0; i < children.length; i++) {
      const row: number = Math.floor(i / cols);
      const col: number = i % cols;
      nodes.push({
        key: 'child-' + i,
        title: this.agentTitle(children[i]),
        subtitle: (str(children[i], 'sessionId') ?? '').substring(0, 18),
        current: false,
        x: 16 + col * (childW + gapX),
        y: 8 + rootH + gapY + row * (childH + 12),
        w: childW,
        h: childH
      });
    }
    return nodes;
  }

  private fleetLinks(): FleetLink[] {
    const nodes: FleetNode[] = this.fleetNodes();
    if (nodes.length <= 1) {
      return [];
    }
    const root: FleetNode = nodes[0];
    const links: FleetLink[] = [];
    const startX: number = root.x + root.w / 2;
    const startY: number = root.y + root.h;
    for (let i = 1; i < nodes.length; i++) {
      const node: FleetNode = nodes[i];
      const endX: number = node.x + node.w / 2;
      const endY: number = node.y;
      const dx: number = endX - startX;
      const dy: number = endY - startY;
      const len: number = Math.sqrt(dx * dx + dy * dy);
      const angle: number = Math.atan2(dy, dx) * 180 / Math.PI;
      links.push({
        key: 'link-' + i,
        x: (startX + endX) / 2 - len / 2,
        y: (startY + endY) / 2 - 0.5,
        len: len,
        angle: angle
      });
    }
    return links;
  }

  private fleetHeight(): number {
    const nodes: FleetNode[] = this.fleetNodes();
    if (nodes.length === 0) {
      return 240;
    }
    let maxBottom: number = 0;
    for (const node of nodes) {
      const bottom: number = node.y + node.h;
      if (bottom > maxBottom) {
        maxBottom = bottom;
      }
    }
    return maxBottom + 24;
  }

  @Builder
  metricTile(label: string, value: string) {
    Column({ space: 4 }) {
      Text(value)
        .fontSize(18)
        .fontWeight(FontWeight.Medium)
        .fontColor(this.textColor())
      Text(label)
        .fontSize(11)
        .fontColor(this.subColor())
    }
    .alignItems(HorizontalAlign.Start)
    .padding(12)
    .borderRadius(12)
    .backgroundColor(this.cardBg())
    .layoutWeight(1)
  }

  private dashRecord(): Record<string, Object> | undefined {
    return this.dashboard === null ? undefined : asRec(this.dashboard);
  }

  private dashNumber(key: string, isArray: boolean): string {
    const record = this.dashRecord();
    if (record === undefined) {
      return '—';
    }
    const value = record[key];
    if (isArray && Array.isArray(value)) {
      return (value as Object[]).length.toString();
    }
    if (typeof value === 'number') {
      return (value as number).toString();
    }
    return '—';
  }

  private dashText(path: string): string {
    const record = this.dashRecord();
    if (record === undefined) {
      return '—';
    }
    const parts: string[] = path.split('.');
    if (parts.length === 1) {
      const value = record[parts[0]];
      return typeof value === 'number' ? (value as number).toString() : '—';
    }
    const nested = asRec(record[parts[0]]);
    if (nested === undefined) {
      return '—';
    }
    const inner = num(nested, parts[1]);
    return inner !== undefined ? inner.toString() : '—';
  }

  private dashRequests(): Object[] {
    const record = this.dashRecord();
    if (record === undefined) {
      return [];
    }
    const value = record['requests'];
    if (!Array.isArray(value)) {
      return [];
    }
    const all: Object[] = value as Object[];
    return all.slice(Math.max(0, all.length - 8)).reverse();
  }

  private fleetAgents(): Object[] {
    if (this.fleet === null) {
      return [];
    }
    const record = asRec(this.fleet);
    if (record === undefined) {
      return [];
    }
    const value = record['agents'];
    return Array.isArray(value) ? (value as Object[]) : [];
  }

  private agentTitle(agent: Object): string {
    return str(agent, 'title') ?? str(agent, 'name') ?? str(agent, 'sessionId') ?? 'Agent';
  }

  private agentCurrent(agent: Object): boolean {
    const flag = asRec(agent);
    if (flag !== undefined && flag['isCurrent'] === true) {
      return true;
    }
    return (str(agent, 'sessionId') ?? '') === SessionStore.get().currentSessionId();
  }

  @Builder
  placeholderPanel() {
    Column({ space: 8 }) {
      Text('暂无可用数据')
        .fontSize(15)
        .fontColor(this.textColor())
      Text('连接网关并打开会话后，数据会显示在这里。')
        .fontSize(12)
        .fontColor(this.subColor())
        .textAlign(TextAlign.Center)
    }
    .width('100%')
    .padding(24)
    .layoutWeight(1)
  }

  @Builder
  bubble(row: SessionRow) {
    Row() {
      Column({ space: 4 }) {
        Text(row.role === 'user' ? '你' : (row.role === 'tool' ? '工具' : 'DSH'))
          .fontSize(11)
          .fontColor(this.subColor())
        Text(row.text.length > 0 ? row.text : '…')
          .fontSize(15)
          .lineHeight(22)
          .fontColor(this.textColor())
      }
      .alignItems(HorizontalAlign.Start)
      .padding(12)
      .borderRadius(14)
      .backgroundColor(row.role === 'user'
        ? (this.isDark ? '#0A3D91' : '#DCE8FF')
        : this.cardBg())
      .width('100%')
    }
    .width('100%')
    .justifyContent(row.role === 'user' ? FlexAlign.End : FlexAlign.Start)
  }

  private onPromptConnectionChanged(): void {
    if (this.connection !== 'connected') {
      this.pendingQuestion = null;
      this.pendingApproval = null;
      this.questionBusy = false;
      this.approvalBusy = false;
    }
  }

  private restorePendingPrompts(): void {
    const sessionId: string = SessionStore.get().currentSessionId();
    this.pendingQuestion = SessionStore.get().pendingQuestion(sessionId);
    this.pendingApproval = SessionStore.get().pendingApproval(sessionId);
    this.questionBusy = false;
    this.approvalBusy = false;
  }

  aboutToAppear(): void {
    // 从对话页「更多 → 工作区文件」进入时直接落到文件分组
    const initialTab: string = AppStorage.get<string>('sessionToolsTab') ?? '';
    if (initialTab.length > 0) {
      this.tab = initialTab;
      AppStorage.setOrCreate<string>('sessionToolsTab', '');
      // 文件分组内容只在点击分组时加载，直接从「更多 → 工作区文件」进来要手动拉一次
      if (initialTab === 'files') {
        this.loadSessionFiles('');
      }
    }
    this.voicePageActive = true;
    this.restorePendingPrompts();
    this.loadProcessPreferences();
    this.rowsSource.reset(this.rows);
    if (this.frameUnsubscribe === null) {
      this.frameUnsubscribe = GatewayClient.get().onFrame((frame) => {
        const activeId: string = SessionStore.get().currentSessionId();
        if ((frame.kind === 'question-requested' && frame.sessionId === activeId) ||
          frame.kind === 'question-resolved') {
          const previousId: string = this.pendingQuestion !== null ? this.pendingQuestion.rpcId : '';
          this.pendingQuestion = SessionStore.get().pendingQuestion(activeId);
          const nextId: string = this.pendingQuestion !== null ? this.pendingQuestion.rpcId : '';
          if (previousId !== nextId) {
            this.questionSelections = {};
            this.questionCustom = {};
            this.questionBusy = false;
          }
        } else if ((frame.kind === 'approval-requested' && frame.sessionId === activeId) ||
          frame.kind === 'approval-resolved') {
          const previousId: string = this.pendingApproval !== null ? this.pendingApproval.rpcId : '';
          this.pendingApproval = SessionStore.get().pendingApproval(activeId);
          const nextId: string = this.pendingApproval !== null ? this.pendingApproval.rpcId : '';
          if (previousId !== nextId) this.approvalBusy = false;
        } else if (frame.kind === 'session-queue' || frame.kind === 'queue-item-updated' || frame.kind === 'queue-updated') {
          this.releaseQueueAction();
        }
      });
    }
  }

  aboutToDisappear(): void {
    this.voicePageActive = false;
    this.dictation.cancel();
    this.dictating = false;
    if (this.queueActionTimer >= 0) {
      clearTimeout(this.queueActionTimer);
      this.queueActionTimer = -1;
    }
    if (this.frameUnsubscribe !== null) {
      this.frameUnsubscribe();
      this.frameUnsubscribe = null;
    }
  }

  onRowsChanged(): void {
    this.rowsSource.reset(this.rows);
    if (this.tab !== 'conversation' || !this.autoStick) {
      return;
    }
    setTimeout(() => {
      this.scroller.scrollEdge(Edge.Bottom);
    }, 30);
  }

  private loadOlder(): void {
    if (!SessionStore.get().loadOlder()) {
      this.hint = '没有更早的记录了';
    }
  }

  private async pickAttachments(): Promise<void> {
    if (this.attachmentSending) return;
    try {
      const context = getContext(this) as common.UIAbilityContext;
      const picked: PickedAttachment[] = await pickDocuments(context, 4);
      this.pickedAttachments = picked;
      this.attachmentHint = picked.length > 0 ? '已选择 ' + picked.length + ' 个附件（发送前需上传）' : '';
    } catch (err) {
      this.attachmentHint = '未选择附件';
    }
  }

  private removeAttachment(uri: string): void {
    if (this.attachmentSending) return;
    this.pickedAttachments = this.pickedAttachments.filter((item: PickedAttachment) => item.uri !== uri);
    this.attachmentHint = this.pickedAttachments.length > 0 ? '已选择 ' + this.pickedAttachments.length + ' 个附件（发送前需上传）' : '';
  }

  private async send(): Promise<void> {
    const text: string = this.draft.trim();
    if (this.attachmentSending || (text.length === 0 && this.pickedAttachments.length === 0)) return;
    const client = GatewayClient.get();
    if (!client.isConnected()) {
      this.hint = '未连接网关：请先在设置页扫码配对';
      return;
    }
    const sessionId: string = SessionStore.get().currentSessionId();
    if (sessionId.length === 0) {
      this.hint = '请先打开一个会话';
      return;
    }
    this.attachmentSending = true;
    const generation: number = client.generation();
    const selected: PickedAttachment[] = this.pickedAttachments.slice();
    try {
      const uploaded: UploadResult[] = [];
      for (const attachment of selected) {
        if (client.generation() !== generation || sessionId !== SessionStore.get().currentSessionId()) {
          throw new Error('连接或会话已变化，草稿已保留');
        }
        this.attachmentHint = '正在上传 ' + attachment.name;
        const result: UploadResult = await uploadAttachment(client, sessionId, attachment, (percent: number) => {
          this.attachmentHint = '正在上传 ' + attachment.name + ' · ' + percent + '%';
        });
        uploaded.push(result);
      }
      if (client.generation() !== generation || sessionId !== SessionStore.get().currentSessionId()) {
        throw new Error('连接或会话已变化，草稿已保留');
      }
      if (uploaded.length > 0) {
        const receipts: UploadReceipt[] = uploaded.map((item: UploadResult): UploadReceipt => ({ receiptId: item.receiptId }));
        const ack = await client.sendUserMessageWithAttachments(text, sessionId, receipts);
        if (ack.sessionId !== sessionId) throw new Error('发送确认无效，草稿已保留');
      } else if (!client.sendUserMessage(text, sessionId)) {
        throw new Error('发送失败，请检查连接');
      }
      if (sessionId !== SessionStore.get().currentSessionId() || this.draft.trim() !== text) return;
      this.hint = '';
      this.attachmentHint = '';
      this.pickedAttachments = [];
      this.draft = '';
    } catch (error) {
      this.attachmentHint = error instanceof Error ? error.message : '附件发送失败，已保留选择内容';
    } finally {
      this.attachmentSending = false;
    }
  }

  private queueAction(itemId: string, action: string): void {
    const client = GatewayClient.get();
    if (!client.isConnected()) {
      this.hint = '未连接网关';
      return;
    }
    if (this.queueBusyId.length > 0) return;
    const sessionId: string = SessionStore.get().currentSessionId();
    this.queueBusyId = itemId;
    this.queueActionTimer = setTimeout(() => {
      this.queueBusyId = '';
      this.queueActionTimer = -1;
      client.requestQueue(sessionId).catch(() => {});
      this.hint = '队列状态已刷新，请确认操作结果';
    }, 20000);
    if (!client.queueUpdate(sessionId, itemId, action)) {
      this.releaseQueueAction();
      this.hint = '操作失败，请重试';
    }
  }

  private releaseQueueAction(): void {
    if (this.queueActionTimer >= 0) {
      clearTimeout(this.queueActionTimer);
      this.queueActionTimer = -1;
    }
    this.queueBusyId = '';
  }

  private editQueueItem(item: QueueItem): void {
    this.draft = item.preview;
    this.queueAction(item.id, 'remove');
    this.tab = 'conversation';
  }

  private toggleQuestionOption(question: GatewayQuestion, label: string): void {
    const current: string[] = this.questionSelections[question.id] !== undefined
      ? this.questionSelections[question.id].slice() : [];
    if (question.multiSelect === true) {
      const index: number = current.indexOf(label);
      if (index >= 0) { current.splice(index, 1); } else { current.push(label); }
    } else {
      current.splice(0, current.length, label);
    }
    this.questionSelections[question.id] = current;
    if (current.length > 0) {
      this.questionCustom[question.id] = '';
    }
  }

  private updateQuestionCustom(questionId: string, value: string): void {
    this.questionCustom[questionId] = value;
    if (value.trim().length > 0) {
      this.questionSelections[questionId] = [];
    }
  }

  private sameQuestion(pending: GatewayPendingQuestionRequest): boolean {
    return this.pendingQuestion !== null && this.pendingQuestion.rpcId === pending.rpcId &&
      this.pendingQuestion.sessionId === pending.sessionId && SessionStore.get().currentSessionId() === pending.sessionId;
  }

  private sameApproval(pending: GatewayPendingApprovalRequest): boolean {
    return this.pendingApproval !== null && this.pendingApproval.rpcId === pending.rpcId &&
      this.pendingApproval.sessionId === pending.sessionId && SessionStore.get().currentSessionId() === pending.sessionId;
  }

  private submitQuestion(): void {
    const pending = this.pendingQuestion;
    if (pending === null || this.questionBusy) return;
    const answers: GatewayQuestionAnswer[] = [];
    for (const question of pending.questions) {
      const selected: string[] = this.questionSelections[question.id] !== undefined
        ? this.questionSelections[question.id].slice() : [];
      const custom: string = this.questionCustom[question.id] !== undefined
        ? this.questionCustom[question.id].trim() : '';
      if (question.options !== undefined && question.options.length > 0 && selected.length === 0 && custom.length === 0) {
        this.hint = '请选择一个选项或填写自定义答案。';
        return;
      }
      const answer: GatewayQuestionAnswer = custom.length > 0
        ? { id: question.id, selected: selected, custom: custom }
        : { id: question.id, selected: selected };
      answers.push(answer);
    }
    this.questionBusy = true;
    const payload: QuestionAnswerRequest = {
      type: 'question-answer', rpcId: pending.rpcId, sessionId: pending.sessionId, answers: answers
    };
    GatewayClient.get().request(JSON.stringify(payload), 'question-response').then((frame) => {
      if (!this.sameQuestion(pending)) return;
      if (frame.accepted === true) this.hint = '答案已提交，等待处理';
      else { this.questionBusy = false; this.hint = frame.reason ?? '提交失败，请重试'; }
    }).catch((error: Error) => {
      if (!this.sameQuestion(pending)) return;
      this.questionBusy = false;
      this.hint = error.message.length > 0 ? error.message : '提交失败，请重试';
    });
  }

  private cancelQuestion(): void {
    const pending = this.pendingQuestion;
    if (pending === null || this.questionBusy) return;
    this.questionBusy = true;
    const payload: QuestionCancelRequest = {
      type: 'question-cancel', rpcId: pending.rpcId, sessionId: pending.sessionId
    };
    GatewayClient.get().request(JSON.stringify(payload), 'question-response').then((frame) => {
      if (!this.sameQuestion(pending)) return;
      if (frame.accepted !== true) { this.questionBusy = false; this.hint = frame.reason ?? '放弃失败，请重试'; }
    }).catch((error: Error) => {
      if (!this.sameQuestion(pending)) return;
      this.questionBusy = false;
      this.hint = error.message.length > 0 ? error.message : '放弃失败，请重试';
    });
  }

  private respondApproval(outcome: string): void {
    const pending = this.pendingApproval;
    if (pending === null || this.approvalBusy) return;
    this.approvalBusy = true;
    const payload: ApprovalResponseRequest = {
      type: 'approval-response', rpcId: pending.rpcId, sessionId: pending.sessionId,
      approvalId: pending.approvalId, outcome: outcome
    };
    GatewayClient.get().request(JSON.stringify(payload), 'approval-response').then((frame) => {
      if (!this.sameApproval(pending)) return;
      if (frame.accepted !== true) { this.approvalBusy = false; this.hint = frame.reason ?? '操作失败，请重试'; }
    }).catch((error: Error) => {
      if (!this.sameApproval(pending)) return;
      this.approvalBusy = false;
      this.hint = error.message.length > 0 ? error.message : '操作失败，请重试';
    });
  }
}
