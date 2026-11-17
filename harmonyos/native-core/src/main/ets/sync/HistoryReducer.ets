import { SessionEvent } from '../protocol/GatewayDtos';

export interface HistorySyncConfiguration { pageMessageLimit: number; pageByteBudget: number; pagesPerBatch: number; }
export interface HistoryLoadProgress { loaded: number; total: number | null; }
export interface HistorySessionState {
  hasMore: boolean; isLoading: boolean; isLoadingOlder: boolean; progress: HistoryLoadProgress | null;
  seenCursors: Set<number>; nextBeforeSequence: number | null; pageCount: number; batchKind: string | null;
  loadedEventCount: number; loadedByteCount: number; syncedActivityTimestamp: number | null;
}
export interface HistoryState { sessions: Map<string, HistorySessionState>; pendingSessionId: string | null; }
export interface HistoryAction {
  kind: string; sessionId: string; older?: boolean; hasLocalEvents?: boolean; earliestLocalSequence?: number | null;
  rawEventCount?: number; hasMore?: boolean; eventCount?: number; byteCount?: number;
  nextBeforeSequence?: number | null; remoteActivityTimestamp?: number | null; activityTimestamp?: number;
}
export interface HistoryResult { kind: string; beforeSequence?: number; eventCount?: number; byteCount?: number; hasMore?: boolean; code?: string; cursor?: number; }
export interface HistoryReduction { state: HistoryState; result: HistoryResult; }
const CONFIG: HistorySyncConfiguration = { pageMessageLimit: 60, pageByteBudget: 4 * 1024 * 1024, pagesPerBatch: 2 };
export class HistoryReducer {
  static initial(): HistoryState { return { sessions: new Map(), pendingSessionId: null }; }
  static reduce(state: HistoryState, action: HistoryAction, config: HistorySyncConfiguration = CONFIG): HistoryReduction {
    const old = state.sessions.get(action.sessionId);
    if (action.kind === 'AwaitSnapshot') {
      const session = HistoryReducer.session(old);
      session.isLoading = true; session.isLoadingOlder = false; session.progress = { loaded: 0, total: null };
      session.seenCursors = new Set(); session.pageCount = 0; session.batchKind = 'LATEST';
      session.loadedEventCount = 0; session.loadedByteCount = 0;
      return HistoryReducer.update(state, action.sessionId, session);
    }
    if (action.kind === 'Start') {
      const session = HistoryReducer.session(old);
      if (session.isLoading || (action.older === true && !session.hasMore)) return HistoryReducer.none(state);
      const before = action.older === true ? (session.nextBeforeSequence ?? action.earliestLocalSequence ?? null) : null;
      session.isLoading = true; session.isLoadingOlder = action.older === true; session.progress = { loaded: 0, total: null };
      session.seenCursors = new Set(); if (before !== null) session.seenCursors.add(before);
      session.pageCount = 0; session.batchKind = action.older === true ? 'OLDER' : 'LATEST';
      session.loadedEventCount = 0; session.loadedByteCount = 0;
      if (action.older !== true && action.hasLocalEvents !== true) { session.hasMore = false; session.nextBeforeSequence = null; }
      if (action.older === true && before === null) {
        session.hasMore = false; HistoryReducer.finish(session);
        return HistoryReducer.update(state, action.sessionId, session, { kind: 'Stopped' });
      }
      return { state: { sessions: HistoryReducer.withSession(state.sessions, action.sessionId, session), pendingSessionId: action.sessionId }, result: { kind: 'RequestPage', beforeSequence: before ?? undefined } };
    }
    if (action.kind === 'ProcessingStarted') {
      if (old === undefined || !old.isLoading) return HistoryReducer.none(state);
      const session = HistoryReducer.session(old); session.progress = { loaded: session.loadedEventCount,
        total: action.hasMore === true ? null : session.loadedEventCount + (action.rawEventCount ?? 0) };
      return HistoryReducer.update(state, action.sessionId, session);
    }
    if (action.kind === 'PageCommitted') {
      if (old === undefined || !old.isLoading) return HistoryReducer.none(state);
      const session = HistoryReducer.session(old);
      session.loadedEventCount += action.eventCount ?? 0; session.loadedByteCount += action.byteCount ?? 0;
      session.hasMore = action.hasMore === true; session.pageCount += 1;
      session.progress = { loaded: session.loadedEventCount, total: session.hasMore ? null : session.loadedEventCount };
      session.nextBeforeSequence = session.hasMore && action.earliestLocalSequence != null ? action.earliestLocalSequence
        : action.nextBeforeSequence ?? (session.hasMore ? session.nextBeforeSequence : null);
      if (session.hasMore && session.pageCount < config.pagesPerBatch) {
        const cursor = action.nextBeforeSequence;
        if (cursor === undefined || cursor === null) return HistoryReducer.failed(state, action.sessionId, session, 'MISSING_NEXT_CURSOR');
        if (session.seenCursors.has(cursor)) return HistoryReducer.failed(state, action.sessionId, session, 'REPEATED_CURSOR', cursor);
        session.seenCursors.add(cursor);
        return HistoryReducer.update(state, action.sessionId, session, { kind: 'RequestPage', beforeSequence: cursor });
      }
      if (session.batchKind === 'LATEST' && action.remoteActivityTimestamp != null) session.syncedActivityTimestamp = action.remoteActivityTimestamp;
      const result: HistoryResult = { kind: 'Completed', eventCount: session.loadedEventCount, byteCount: session.loadedByteCount, hasMore: session.hasMore };
      HistoryReducer.finish(session); return HistoryReducer.update(state, action.sessionId, session, result, true);
    }
    if (action.kind === 'LiveEventReceived') {
      if (old === undefined || old.syncedActivityTimestamp === null || action.activityTimestamp === undefined) return HistoryReducer.none(state);
      const session = HistoryReducer.session(old); session.syncedActivityTimestamp = Math.max(session.syncedActivityTimestamp ?? 0, action.activityTimestamp);
      return HistoryReducer.update(state, action.sessionId, session);
    }
    if (action.kind === 'TimedOut' || action.kind === 'Cancelled') {
      if (old === undefined) return HistoryReducer.none(state);
      const session = HistoryReducer.session(old); HistoryReducer.finish(session);
      return HistoryReducer.update(state, action.sessionId, session, { kind: 'Stopped' }, true);
    }
    throw new Error('invalid history action');
  }
  private static session(old?: HistorySessionState): HistorySessionState {
    if (old !== undefined) return { hasMore: old.hasMore, isLoading: old.isLoading, isLoadingOlder: old.isLoadingOlder,
      progress: old.progress === null ? null : { loaded: old.progress.loaded, total: old.progress.total },
      seenCursors: new Set(old.seenCursors), nextBeforeSequence: old.nextBeforeSequence, pageCount: old.pageCount,
      batchKind: old.batchKind, loadedEventCount: old.loadedEventCount, loadedByteCount: old.loadedByteCount,
      syncedActivityTimestamp: old.syncedActivityTimestamp };
    return { hasMore: false, isLoading: false, isLoadingOlder: false, progress: null, seenCursors: new Set(), nextBeforeSequence: null,
      pageCount: 0, batchKind: null, loadedEventCount: 0, loadedByteCount: 0, syncedActivityTimestamp: null };
  }
  private static finish(s: HistorySessionState): void { s.isLoading = false; s.isLoadingOlder = false; s.progress = null; s.seenCursors.clear(); s.pageCount = 0; s.batchKind = null; s.loadedEventCount = 0; s.loadedByteCount = 0; }
  private static withSession(sessions: Map<string, HistorySessionState>, id: string, value: HistorySessionState): Map<string, HistorySessionState> { const next = new Map(sessions); next.set(id, value); return next; }
  private static update(state: HistoryState, id: string, session: HistorySessionState, result: HistoryResult = { kind: 'None' }, clear: boolean = false): HistoryReduction {
    return { state: { sessions: HistoryReducer.withSession(state.sessions, id, session), pendingSessionId: clear && state.pendingSessionId === id ? null : state.pendingSessionId }, result };
  }
  private static failed(state: HistoryState, id: string, session: HistorySessionState, code: string, cursor?: number): HistoryReduction {
    HistoryReducer.finish(session); session.hasMore = false; session.nextBeforeSequence = null;
    return HistoryReducer.update(state, id, session, { kind: 'Failed', code, cursor }, true);
  }
  private static none(state: HistoryState): HistoryReduction { return { state, result: { kind: 'None' } }; }
}

export interface HistoryEventMergeResult { events: SessionEvent[]; replacedOrInsertedOutOfOrder: boolean; }
export class HistoryEventMerger {
  static merge(record: SessionEvent, events: SessionEvent[]): HistoryEventMergeResult {
    const next = events.slice();
    if (next.length === 0 || record.seq > next[next.length - 1].seq) return { events: next.concat([record]), replacedOrInsertedOutOfOrder: false };
    let low = 0; let high = next.length;
    while (low < high) { const mid = Math.floor((low + high) / 2); if (next[mid].seq < record.seq) low = mid + 1; else high = mid; }
    if (low < next.length && next[low].seq === record.seq) next[low] = record; else next.splice(low, 0, record);
    return { events: next, replacedOrInsertedOutOfOrder: true };
  }
  static mergePage(events: SessionEvent[], page: SessionEvent[]): SessionEvent[] {
    const bySeq = new Map<number, SessionEvent>();
    for (const event of events) if (!bySeq.has(event.seq)) bySeq.set(event.seq, event);
    for (const event of page) bySeq.set(event.seq, event);
    return Array.from(bySeq.values()).sort((a: SessionEvent, b: SessionEvent) => a.seq - b.seq);
  }
}
