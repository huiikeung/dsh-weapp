import { SharedMviEvent, SharedMviEventEmitter, SharedMviSubscription, SharedMviDispatchResult } from '../facade/SharedMviEvents';

interface StoreStateSnapshot { sessions: Record<string, Object>; }

/** Minimal KMP facade kernel shared by the ported P0 stores. */
export class SharedStoreKernel {
  private emitter: SharedMviEventEmitter;
  private snapshots: Map<string, string> = new Map();
  private dispatchCount: number = 0;
  private domain: string;
  constructor(domain: string) { this.domain = domain; this.emitter = new SharedMviEventEmitter(domain); }

  subscribe(observer: (event: SharedMviEvent) => void): SharedMviSubscription {
    const initial: StoreStateSnapshot = { sessions: {} };
    return this.emitter.subscribe(observer, JSON.stringify(initial));
  }

  protected dispatch(kind: string, mutate: () => void): SharedMviDispatchResult {
    this.dispatchCount += 1;
    const id: string = this.domain + ':' + kind + ':' + this.dispatchCount;
    try {
      mutate();
      const event: SharedMviEvent = this.emitter.emitTransition(id, this.stateJson(), '[]');
      return { accepted: true, transactionId: id, eventSequence: event.sequence, errorCode: null, errorMessage: null };
    } catch (err) {
      const message: string = err instanceof Error ? err.message : 'store mutation failed';
      const event: SharedMviEvent = this.emitter.emitError(id, 'STORE_MUTATION_FAILED', message);
      return { accepted: false, transactionId: id, eventSequence: event.sequence, errorCode: event.errorCode, errorMessage: message };
    }
  }

  protected setSession(sessionId: string, payload: Object): void {
    if (sessionId.trim().length === 0) throw new Error('sessionId must not be blank');
    this.snapshots.set(sessionId, JSON.stringify(payload));
  }

  protected clearSession(sessionId: string): void { this.snapshots.delete(sessionId); }
  protected hasSession(sessionId: string): boolean { return this.snapshots.has(sessionId); }
  protected getSession(sessionId: string): Object { return JSON.parse(this.snapshots.get(sessionId) ?? '{}') as Object; }
  private stateJson(): string {
    const sessions: Record<string, Object> = {};
    this.snapshots.forEach((value: string, key: string) => { sessions[key] = JSON.parse(value) as Object; });
    const state: StoreStateSnapshot = { sessions: sessions };
    return JSON.stringify(state);
  }
}
