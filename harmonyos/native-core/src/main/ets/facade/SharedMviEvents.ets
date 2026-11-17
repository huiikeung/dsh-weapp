export interface SharedMviEvent {
  schema: number;
  sequence: number;
  transactionId: string;
  domain: string;
  kind: string;
  statePayloadJson: string | null;
  effectsJson: string;
  metadataJson: string | null;
  errorCode: string | null;
  errorMessage: string | null;
}

export interface SharedMviDispatchResult {
  accepted: boolean;
  transactionId: string | null;
  eventSequence: number | null;
  errorCode: string | null;
  errorMessage: string | null;
}

export class SharedMviSubscription {
  private action: (() => void) | null;
  constructor(action: () => void) { this.action = action; }
  cancel(): void {
    const action = this.action;
    this.action = null;
    if (action !== null) action();
  }
}

export class SharedMviEventValidator {
  static validate(event: SharedMviEvent, expectedSequence: number, domain: string): boolean {
    if (event.schema !== 2 || event.domain !== domain || !Number.isSafeInteger(event.sequence) || event.sequence < 0 ||
      event.sequence !== expectedSequence || typeof event.transactionId !== 'string' ||
      event.transactionId.trim().length === 0) return false;
    try {
      if (event.kind === 'snapshot') {
        if (event.statePayloadJson === null) return false;
        JSON.parse(event.statePayloadJson);
        return event.effectsJson === '[]' && event.errorCode === null;
      }
      if (event.kind === 'transition') {
        if (event.sequence <= 0 || event.errorCode !== null) return false;
        if (event.statePayloadJson !== null) JSON.parse(event.statePayloadJson);
        const effects = JSON.parse(event.effectsJson) as Object;
        if (!Array.isArray(effects)) return false;
        if (event.metadataJson !== null) JSON.parse(event.metadataJson);
        return true;
      }
      if (event.kind === 'error') return event.statePayloadJson === null && event.effectsJson === '[]' &&
        event.errorCode !== null && event.errorCode.trim().length > 0;
      return false;
    } catch (ignored) { return false; }
  }
}

export class SharedMviEventConsumer {
  private sequence: number = -1;
  private domain: string;
  constructor(domain: string) { this.domain = domain; }
  get currentSequence(): number { return this.sequence; }
  apply(event: SharedMviEvent, validatePayload: (payload: string | null, metadata: string | null) => boolean,
    validateEffects: (effects: string) => boolean, publishState: (payload: string | null) => void,
    performEffects: (effects: string) => void): boolean {
    const expected = this.sequence < 0 ? event.sequence : this.sequence + 1;
    if ((this.sequence < 0 && event.kind !== 'snapshot' && event.kind !== 'error') ||
      (this.sequence >= 0 && event.kind === 'snapshot') || !SharedMviEventValidator.validate(event, expected, this.domain)) return false;
    try {
      if (!validatePayload(event.statePayloadJson, event.metadataJson) || !validateEffects(event.effectsJson)) return false;
      publishState(event.statePayloadJson);
    } catch (ignored) { return false; }
    this.sequence = event.sequence;
    performEffects(event.effectsJson);
    return true;
  }
}

export class SharedMviEventEmitter {
  private sequence: number = 0;
  private observerId: number = 0;
  private observers: Map<number, (event: SharedMviEvent) => void> = new Map();
  private pending: SharedMviEvent[] = [];
  private delivering: boolean = false;
  private domain: string;
  private finished: ((event: SharedMviEvent) => void) | null;
  constructor(domain: string, finished: ((event: SharedMviEvent) => void) | null = null) {
    this.domain = domain;
    this.finished = finished;
  }
  get currentSequence(): number { return this.sequence; }
  subscribe(observer: (event: SharedMviEvent) => void, snapshotPayloadJson: string): SharedMviSubscription {
    return this.addObserver(observer, this.event('snapshot:' + this.domain + ':' + this.sequence, 'snapshot', snapshotPayloadJson));
  }
  subscribeError(observer: (event: SharedMviEvent) => void, errorCode: string, errorMessage: string | null): SharedMviSubscription {
    const event = this.event('snapshot-error:' + this.domain + ':' + this.sequence, 'error', null);
    event.errorCode = errorCode;
    event.errorMessage = errorMessage;
    return this.addObserver(observer, event);
  }
  emitTransition(transactionId: string, statePayloadJson: string | null, effectsJson: string = '[]', metadataJson: string | null = null): SharedMviEvent {
    this.requireTransaction(transactionId);
    this.sequence += 1;
    const event = this.event(transactionId, 'transition', statePayloadJson);
    event.effectsJson = effectsJson;
    event.metadataJson = metadataJson;
    this.enqueue(event);
    return event;
  }
  emitError(transactionId: string, errorCode: string, errorMessage: string | null): SharedMviEvent {
    this.requireTransaction(transactionId);
    if (errorCode.trim().length === 0) throw new Error('errorCode must not be blank');
    this.sequence += 1;
    const event = this.event(transactionId, 'error', null);
    event.errorCode = errorCode;
    event.errorMessage = errorMessage;
    this.enqueue(event);
    return event;
  }
  private event(transactionId: string, kind: string, payload: string | null): SharedMviEvent {
    return { schema: 2, sequence: this.sequence, transactionId: transactionId, domain: this.domain, kind: kind,
      statePayloadJson: payload, effectsJson: '[]', metadataJson: null, errorCode: null, errorMessage: null };
  }
  private requireTransaction(id: string): void {
    if (id.trim().length === 0 || !Number.isSafeInteger(this.sequence + 1)) throw new Error('invalid transaction sequence');
  }
  private addObserver(observer: (event: SharedMviEvent) => void, event: SharedMviEvent): SharedMviSubscription {
    const id = ++this.observerId;
    this.observers.set(id, observer);
    this.deliver(observer, event);
    return new SharedMviSubscription(() => { this.observers.delete(id); });
  }
  private deliver(observer: (event: SharedMviEvent) => void, event: SharedMviEvent): void {
    try { observer(event); } catch (ignored) {}
  }
  private enqueue(event: SharedMviEvent): void {
    this.pending.push(event);
    if (this.delivering) return;
    this.delivering = true;
    try {
      while (this.pending.length > 0) {
        const next = this.pending.shift() as SharedMviEvent;
        const observers: Array<(event: SharedMviEvent) => void> = [];
        this.observers.forEach((observer: (event: SharedMviEvent) => void) => { observers.push(observer); });
        try { for (const observer of observers) this.deliver(observer, next); }
        finally { if (this.finished !== null) this.finished(next); }
      }
    } finally { this.delivering = false; }
  }
}
