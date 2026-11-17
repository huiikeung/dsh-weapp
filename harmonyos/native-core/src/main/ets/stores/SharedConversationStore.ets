import { SharedStoreKernel } from './SharedStoreKernel';
import { SharedMviEvent, SharedMviSubscription, SharedMviDispatchResult } from '../facade/SharedMviEvents';

interface ConversationSnapshot { items: Object[]; replacesAll: boolean; }

/** Ported skeleton of KMP SharedConversationStore; full field-level projection lives in phase 3B. */
export class SharedConversationStore extends SharedStoreKernel {
  constructor() { super('conversation'); }
  hasProjection(sessionId: string): boolean { return this.hasSession(sessionId); }
  replaceSession(sessionId: string, items: Object[]): SharedMviDispatchResult {
    return this.dispatch('replace', () => {
      const snapshot: ConversationSnapshot = { items: items, replacesAll: true };
      this.setSession(sessionId, snapshot);
    });
  }
  clearSessionProjection(sessionId: string): SharedMviDispatchResult {
    return this.dispatch('clear', () => { this.clearSessionState(sessionId); });
  }
  protected clearSessionState(sessionId: string): void { super.clearSession(sessionId); }
  snapshot(sessionId: string): Object[] {
    const state = this.getSession(sessionId) as Object as ConversationSnapshot;
    return state.items ?? [];
  }
}
