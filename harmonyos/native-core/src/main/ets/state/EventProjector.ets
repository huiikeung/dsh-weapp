import { SessionEvent } from '../protocol/GatewayDtos';
import { Logger } from '../common/Logger';

/** 轨迹投影：turn → step → 工具调用，供「轨迹」面板渲染。 */
export interface ProjTool {
  callId: string;
  name: string;
  status: string;   // running | done | error
  detail: string;
}

export interface ProjStep {
  step: number;
  tools: ProjTool[];
  text: string;
  status: string;
}

export interface ProjTurn {
  turn: number;
  status: string;   // running | done
  userText: string;
  assistantText: string;
  steps: ProjStep[];
}

/** 轨迹账本一行（对齐小程序 trajectory-presentation.js 的 row） */
export interface TraceRow {
  key: string;
  /** USER | ASSISTANT | TOOL | CONTEXT */
  badge: string;
  /** tool | user | assistant | context —— 决定详情面板用哪套页签 */
  kind: string;
  label: string;
  preview: string;
  seq: number;
  /** epoch 毫秒 */
  time: number;
  turn: number;
  startedAt: number;
  endedAt: number;
  /** 工具参数 / 工具结果 / 推理 / 完整正文（详情面板用，已按上限截断） */
  args: string;
  result: string;
  thinking: string;
  text: string;
  /** running | done | error */
  status: string;
}

/** 概览时间轴的一段（输入 / 模型 / 工具） */
export interface TraceBand {
  kind: string;
  start: number;
  end: number;
  error: boolean;
}

export interface TraceOverview {
  turns: number;
  calls: number;
  startAt: number;
  endAt: number;
  bands: TraceBand[];
}

const MAX_TURNS: number = 40;

export class EventProjector {
  private static instance: EventProjector = new EventProjector();
  private turns: ProjTurn[] = [];
  private currentTurn: number = -1;
  private currentStep: number = 1;

  // ==================== 轨迹账本（对齐小程序 TrajectoryView） ====================
  private traceRows: TraceRow[] = [];
  private traceBands: TraceBand[] = [];
  private traceTurnCount: number = 0;
  private traceCallCount: number = 0;
  private traceStart: number = 0;
  private traceEnd: number = 0;
  /** 当前正在累积的助手行下标 / 模型时间轴段下标 */
  private traceOpenAssistant: number = -1;
  private traceOpenModelBand: number = -1;
  /** callId → 行下标 / 时间轴段下标 */
  private traceToolRows: Map<string, number> = new Map<string, number>();
  private traceToolBands: Map<string, number> = new Map<string, number>();

  static get(): EventProjector {
    return EventProjector.instance;
  }

  reset(): void {
    this.turns = [];
    this.currentTurn = -1;
    this.currentStep = 1;
    this.traceRows = [];
    this.traceBands = [];
    this.traceTurnCount = 0;
    this.traceCallCount = 0;
    this.traceStart = 0;
    this.traceEnd = 0;
    this.traceOpenAssistant = -1;
    this.traceOpenModelBand = -1;
    this.traceToolRows.clear();
    this.traceToolBands.clear();
    this.publish();
    this.publishTrace();
  }

  consume(event: SessionEvent): void {
    const type: string = event.event.type;
    const declaredTurn: number | undefined = event.event.turn;
    if (declaredTurn !== undefined) {
      this.currentTurn = declaredTurn;
    }
    if (this.currentTurn < 0) {
      this.currentTurn = 1;
    }
    if (type === 'turn/start' || type === 'user/message') {
      this.currentStep = 1;
    }
    this.ensureTurn();
    this.traceEvent(event);
    if (type === 'turn/start') {
      this.turn().status = 'running';
      this.publish();
      return;
    }
    if (type === 'user/message') {
      const text: string = event.event.text !== undefined ? event.event.text : '';
      if (text.length > 0) {
        this.turn().userText = text;
      }
    } else if (type === 'assistant/chunk') {
      const text: string = event.event.text !== undefined ? event.event.text : '';
      this.turn().assistantText += text;
      this.step().text += text;
    } else if (type === 'assistant/message') {
      const text: string = event.event.text !== undefined ? event.event.text : '';
      if (text.length > 0) {
        this.turn().assistantText = text;
      }
    } else if (type === 'step/start') {
      this.currentStep = event.event.step !== undefined ? event.event.step : this.currentStep;
      this.step().status = 'running';
    } else if (type === 'step/end') {
      this.step().status = 'done';
    } else if (type === 'tool/call') {
      const callId: string = event.event.callId !== undefined ? event.event.callId : ('tool-' + event.seq);
      const name: string = event.event.name !== undefined ? event.event.name : 'tool';
      let detail: string = '';
      const args = event.event.arguments;
      if (args !== undefined) {
        try {
          detail = JSON.stringify(args);
        } catch (err) {
          detail = '';
        }
      }
      this.step().tools.push({ callId: callId, name: name, status: 'running', detail: detail });
    } else if (type === 'tool/result') {
      const callId: string = event.event.callId !== undefined ? event.event.callId : '';
      const target: ProjTool | undefined = this.findTool(callId);
      if (target !== undefined) {
        target.status = event.event.isError === true ? 'error' : 'done';
        const preview: string = event.event.preview !== undefined ? event.event.preview
          : (event.event.outcome !== undefined ? event.event.outcome : '');
        if (preview.length > 0) {
          target.detail = preview;
        }
      }
    } else if (type === 'turn/end') {
      this.turn().status = 'done';
      this.currentStep = 1;
    } else {
      return;
    }
    this.publish();
  }

  private turn(): ProjTurn {
    return this.turns[this.turns.length - 1];
  }

  private ensureTurn(): void {
    const last: ProjTurn | undefined = this.turns.length > 0 ? this.turns[this.turns.length - 1] : undefined;
    if (last !== undefined && last.turn === this.currentTurn) {
      return;
    }
    this.turns.push({
      turn: this.currentTurn,
      status: 'running',
      userText: '',
      assistantText: '',
      steps: []
    });
    if (this.turns.length > MAX_TURNS) {
      this.turns.splice(0, this.turns.length - MAX_TURNS);
    }
  }

  private step(): ProjStep {
    const turn: ProjTurn = this.turn();
    const last: ProjStep | undefined = turn.steps.length > 0 ? turn.steps[turn.steps.length - 1] : undefined;
    if (last !== undefined && last.step === this.currentStep) {
      return last;
    }
    const created: ProjStep = {
      step: this.currentStep,
      tools: [],
      text: '',
      status: 'running'
    };
    turn.steps.push(created);
    return created;
  }

  private findTool(callId: string): ProjTool | undefined {
    if (callId.length === 0 || this.turns.length === 0) {
      return undefined;
    }
    const turn: ProjTurn = this.turn();
    for (let i = turn.steps.length - 1; i >= 0; i--) {
      const tools: ProjTool[] = turn.steps[i].tools;
      for (let j = tools.length - 1; j >= 0; j--) {
        if (tools[j].callId === callId) {
          return tools[j];
        }
      }
    }
    return undefined;
  }

  // ==================== 轨迹账本维护（对齐小程序 trajectory-presentation.js） ====================
  private static epochMs(value: number): number {
    if (!Number.isFinite(value) || value <= 0) {
      return 0;
    }
    return value > 1e10 ? value : value * 1000;
  }

  private static clipText(value: string): string {
    const flat: string = value.replace(/\s+/g, ' ').trim();
    return flat.length > 160 ? flat.substring(0, 160) + '…' : flat;
  }

  /** 详情面板要保留完整一点的文本，但不能让 AppStorage 无限膨胀 */
  private static capText(value: string, max: number): string {
    if (value.length <= max) {
      return value;
    }
    return value.substring(0, max) + '\n…（已截断）';
  }

  private static prettyJson(value: Object | undefined): string {
    if (value === undefined) {
      return '';
    }
    try {
      // 网关常常把参数序列化成字符串再塞进来（'{"code":...}'），先解一层再美化，避免双重转义
      if (typeof value === 'string') {
        try {
          const parsed: Object = JSON.parse(value) as Object;
          return JSON.stringify(parsed, null, 2);
        } catch (err) {
          return value;
        }
      }
      return JSON.stringify(value, null, 2);
    } catch (err) {
      return '';
    }
  }

  private traceEvent(event: SessionEvent): void {
    const type: string = event.event.type;
    const t: number = EventProjector.epochMs(event.time);
    if (t > 0) {
      if (this.traceStart === 0 || t < this.traceStart) {
        this.traceStart = t;
      }
      if (t > this.traceEnd) {
        this.traceEnd = t;
      }
    }
    const turn: number = event.event.turn !== undefined ? event.event.turn : this.currentTurn;
    if (type === 'turn/start') {
      this.traceTurnCount += 1;
      this.traceOpenAssistant = -1;
      this.traceOpenModelBand = -1;
      this.traceToolRows.clear();
      return;
    }
    if (type === 'user/message') {
      const source: string | undefined = event.event.source;
      const isUser: boolean = source === undefined || source === 'user';
      const text: string = event.event.text !== undefined ? event.event.text : '';
      if (text.length === 0) {
        return;
      }
      this.traceRows.push({
        key: 'tr-' + event.seq, badge: isUser ? 'USER' : 'CONTEXT', kind: isUser ? 'user' : 'context',
        label: isUser ? '用户' : (source !== undefined ? source : '上下文'),
        preview: EventProjector.clipText(text),
        seq: event.seq, time: t, turn: turn,
        startedAt: t, endedAt: t,
        args: '', result: '', thinking: '',
        text: EventProjector.capText(text, 4000), status: 'done'
      });
      if (isUser) {
        this.traceBands.push({ kind: 'input', start: t, end: t, error: false });
      }
      this.traceOpenAssistant = -1;
      this.traceOpenModelBand = -1;
      this.publishTrace();
      return;
    }
    if (type === 'assistant/chunk') {
      const chunkType: string = event.event.chunkType !== undefined ? event.event.chunkType : '';
      const text: string = event.event.text !== undefined ? event.event.text : '';
      if (text.length === 0 || (chunkType.indexOf('text') < 0 && chunkType.indexOf('reasoning') < 0)) {
        return;
      }
      let index: number = this.traceOpenAssistant;
      if (index < 0 || index >= this.traceRows.length || this.traceRows[index].turn !== turn) {
        this.traceRows.push({
          key: 'tr-' + event.seq, badge: 'ASSISTANT', kind: 'assistant', label: '助手', preview: '',
          seq: event.seq, time: t, turn: turn,
          startedAt: t, endedAt: 0,
          args: '', result: '', thinking: '',
          text: '', status: 'running'
        });
        index = this.traceRows.length - 1;
        this.traceOpenAssistant = index;
      }
      const assistantRow: TraceRow = this.traceRows[index];
      if (chunkType.indexOf('reasoning') >= 0) {
        assistantRow.thinking = EventProjector.capText(assistantRow.thinking + text, 4000);
      } else {
        assistantRow.text = EventProjector.capText(assistantRow.text + text, 8000);
      }
      assistantRow.preview = EventProjector.clipText(assistantRow.thinking.length > 0 && assistantRow.text.length === 0
        ? assistantRow.thinking : assistantRow.text);
      assistantRow.endedAt = t;
      if (this.traceOpenModelBand < 0) {
        // 历史重放里可能没有 assistant/chunk：模型段从上一行时间起算
        const previous: number = this.traceRows.length > 1
          ? this.traceRows[this.traceRows.length - 2].time : t;
        this.traceBands.push({
          kind: 'model', start: previous > 0 ? previous : t, end: t, error: false
        });
        this.traceOpenModelBand = this.traceBands.length - 1;
      } else {
        this.traceBands[this.traceOpenModelBand].end = t;
      }
      this.publishTrace();
      return;
    }
    if (type === 'assistant/message') {
      const text: string = event.event.text !== undefined ? event.event.text : '';
      let index: number = this.traceOpenAssistant;
      if (index < 0 || index >= this.traceRows.length) {
        this.traceRows.push({
          key: 'tr-' + event.seq, badge: 'ASSISTANT', kind: 'assistant', label: '助手',
          preview: EventProjector.clipText(text),
          seq: event.seq, time: t, turn: turn,
          startedAt: t, endedAt: t,
          args: '', result: '', thinking: '',
          text: EventProjector.capText(text, 8000), status: 'done'
        });
        this.traceOpenAssistant = this.traceRows.length - 1;
      } else {
        const doneRow: TraceRow = this.traceRows[index];
        if (text.length > 0) {
          doneRow.text = EventProjector.capText(text, 8000);
          doneRow.preview = EventProjector.clipText(text);
        }
        doneRow.status = 'done';
        doneRow.endedAt = t;
      }
      if (this.traceOpenModelBand >= 0) {
        this.traceBands[this.traceOpenModelBand].end = t;
      } else {
        const previous: number = this.traceRows.length > 1
          ? this.traceRows[this.traceRows.length - 2].time : t;
        this.traceBands.push({
          kind: 'model', start: previous > 0 ? previous : t, end: t, error: false
        });
      }
      this.traceOpenModelBand = -1;
      this.publishTrace();
      return;
    }
    if (type === 'tool/call') {
      const name: string = event.event.name !== undefined ? event.event.name : 'tool';
      let args: string = '';
      try {
        args = event.event.arguments !== undefined ? JSON.stringify(event.event.arguments) : '';
      } catch (err) {
        args = '';
      }
      let prettyArgs: string = '';
      if (event.event.arguments !== undefined) {
        prettyArgs = EventProjector.capText(EventProjector.prettyJson(event.event.arguments), 6000);
      }
      this.traceRows.push({
        key: 'tr-' + event.seq, badge: 'TOOL', kind: 'tool', label: name,
        preview: EventProjector.clipText(args), seq: event.seq, time: t, turn: turn,
        startedAt: t, endedAt: 0,
        args: prettyArgs, result: '', thinking: '', text: '',
        status: 'running'
      });
      this.traceCallCount += 1;
      const callId: string = event.event.callId !== undefined ? event.event.callId : '';
      if (callId.length > 0) {
        this.traceToolRows.set(callId, this.traceRows.length - 1);
      }
      this.traceBands.push({ kind: 'tool', start: t, end: t, error: false });
      if (callId.length > 0) {
        this.traceToolBands.set(callId, this.traceBands.length - 1);
      }
      this.publishTrace();
      return;
    }
    if (type === 'tool/result') {
      const callId: string = event.event.callId !== undefined ? event.event.callId : '';
      const rowIndex: number | undefined = this.traceToolRows.get(callId);
      const preview: string = event.event.preview !== undefined ? event.event.preview
        : (event.event.outcome !== undefined ? event.event.outcome : '');
      if (rowIndex !== undefined && rowIndex >= 0 && rowIndex < this.traceRows.length) {
        const row: TraceRow = this.traceRows[rowIndex];
        row.result = EventProjector.capText(preview, 6000);
        row.preview = EventProjector.clipText(row.preview + (preview.length > 0 ? ' → ' + EventProjector.clipText(preview) : ''));
        row.status = event.event.isError === true ? 'error' : 'done';
        row.endedAt = t;
      }
      const bandIndex: number | undefined = this.traceToolBands.get(callId);
      if (bandIndex !== undefined && bandIndex >= 0 && bandIndex < this.traceBands.length) {
        this.traceBands[bandIndex].end = t;
        this.traceBands[bandIndex].error = event.event.isError === true;
      }
      this.publishTrace();
      return;
    }
    if (type === 'turn/end') {
      if (this.traceOpenModelBand >= 0) {
        this.traceBands[this.traceOpenModelBand].end = t;
      }
      this.traceOpenAssistant = -1;
      this.traceOpenModelBand = -1;
      this.publishTrace();
    }
  }

  private publishTrace(): void {
    AppStorage.setOrCreate<TraceRow[]>('traceRows', this.traceRows.slice());
    const overview: TraceOverview = {
      turns: this.traceTurnCount,
      calls: this.traceCallCount,
      startAt: this.traceStart,
      endAt: this.traceEnd,
      bands: this.traceBands.slice()
    };
    AppStorage.setOrCreate<TraceOverview>('traceOverview', overview);
  }

  private publish(): void {
    AppStorage.setOrCreate<ProjTurn[]>('projectedTurns', this.turns.slice());
    AppStorage.setOrCreate<number>('projectedTurnCount', this.turns.length);
    Logger.debug('projector turns=' + this.turns.length);
  }
}
