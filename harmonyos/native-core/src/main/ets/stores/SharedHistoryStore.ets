import { SharedStoreKernel } from './SharedStoreKernel';
import { SharedMviEvent, SharedMviSubscription, SharedMviDispatchResult } from '../facade/SharedMviEvents';

export interface SharedHistorySessionState { cursor: number; hasMore: boolean; events: Object[]; pendingSessionId: string | null; }

/** Ported skeleton of KMP SharedHistoryStore; HistorySyncEngine remains the projection authority. */
export class SharedHistoryStore extends SharedStoreKernel {
  constructor() { super('history'); }
  replacePage(sessionId: string, events: Object[], cursor: number, hasMore: boolean): SharedMviDispatchResult {
    return this.dispatch('page', () => {
      if (!Number.isSafeInteger(cursor) || cursor < 0) throw new Error('invalid history cursor');
      const state: SharedHistorySessionState = { cursor: cursor, hasMore: hasMore, events: events, pendingSessionId: null };
      this.setSession(sessionId, state);
    });
  }
  appendLive(sessionId: string, event: Object): SharedMviDispatchResult {
    return this.dispatch('live', () => {
      const state = this.getSession(sessionId) as Object as SharedHistorySessionState;
      const events = Array.isArray(state.events) ? state.events.slice() : [];
      events.push(event);
      const next: SharedHistorySessionState = { cursor: state.cursor ?? 0, hasMore: state.hasMore === true, events: events, pendingSessionId: null };
      this.setSession(sessionId, next);
    });
  }
  state(sessionId: string): SharedHistorySessionState {
    return this.getSession(sessionId) as Object as SharedHistorySessionState;
  }
}
