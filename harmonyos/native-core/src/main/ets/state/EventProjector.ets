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

const MAX_TURNS: number = 40;

export class EventProjector {
  private static instance: EventProjector = new EventProjector();
  private turns: ProjTurn[] = [];
  private currentTurn: number = -1;
  private currentStep: number = 1;

  static get(): EventProjector {
    return EventProjector.instance;
  }

  reset(): void {
    this.turns = [];
    this.currentTurn = -1;
    this.currentStep = 1;
    this.publish();
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

  private publish(): void {
    AppStorage.setOrCreate<ProjTurn[]>('projectedTurns', this.turns.slice());
    AppStorage.setOrCreate<number>('projectedTurnCount', this.turns.length);
    Logger.debug('projector turns=' + this.turns.length);
  }
}
