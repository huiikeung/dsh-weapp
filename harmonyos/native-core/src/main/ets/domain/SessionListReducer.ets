import { GatewaySessionSummary, SessionEvent } from '../protocol/GatewayDtos';
import { asRec, str } from '../protocol/GatewayFrameCodec';

export interface SessionListItem {
  id: string; title: string; lastActivityEpochSeconds: number; isRunning: boolean; hasUnread: boolean;
  agentPreset?: string; hasConversation?: boolean; parentSessionId?: string; origin?: string; cwd?: string;
}
export interface SessionListLabels { newSessionTitle: string; remoteSessionPrefix: string; blankSessionPrefix: string; }
export interface SessionListState {
  sessions: SessionListItem[]; archivedSessionIds: Set<string>; selectedSessionId: string | null; titleSequences: Map<string, number>;
}
export interface SessionListAction {
  kind: string; sessionId?: string | null; sessionIds?: Set<string>; sessions?: GatewaySessionSummary[];
  agentPreset?: string; insertedAtEpochSeconds?: number; hasConversation?: boolean; event?: SessionEvent; events?: SessionEvent[];
}
export class SessionListReducer {
  static initial(): SessionListState { return { sessions: [], archivedSessionIds: new Set(), selectedSessionId: null, titleSequences: new Map() }; }
  static visible(item: SessionListItem): boolean { return item.hasConversation !== false && item.origin !== 'subagent'; }
  static reduce(state: SessionListState, action: SessionListAction,
    labels: SessionListLabels = { newSessionTitle: 'New session', remoteSessionPrefix: 'Remote session ', blankSessionPrefix: 'Blank session ' }): SessionListState {
    let sessions = state.sessions.slice();
    let selected = state.selectedSessionId;
    let archived = new Set<string>(state.archivedSessionIds);
    const sequences = new Map<string, number>(state.titleSequences);
    const id = action.sessionId ?? '';
    const now = action.insertedAtEpochSeconds ?? 0;
    if (action.kind === 'Select') selected = action.sessionId ?? null;
    else if (action.kind === 'SetArchivedSessionIds' && action.sessionIds !== undefined) archived = new Set<string>(action.sessionIds);
    else if (action.kind === 'RemoteSessionsReceived' && action.sessions !== undefined) {
      const merged: Map<string, SessionListItem> = new Map();
      for (const item of action.sessions) {
        if (archived.has(item.sessionId)) continue;
        const previous = sessions.find((row: SessionListItem) => row.id === item.sessionId);
        const projections = asRec(item.projections); const values = projections !== undefined ? asRec(projections['values']) : undefined;
        const cwd = item.cwd !== undefined ? item.cwd.replace(/\/+$/, '').split('/').pop() : undefined;
        const title = (values !== undefined ? str(values, 'title') : undefined) ?? (cwd !== undefined && cwd.length > 0 ? cwd : labels.remoteSessionPrefix + item.sessionId.substring(0, 8));
        merged.set(item.sessionId, { id: item.sessionId, title: previous === undefined && item.blank ? labels.blankSessionPrefix + item.sessionId.substring(0, 8) : title,
          lastActivityEpochSeconds: SessionListReducer.epoch(item.updatedAt), isRunning: item.running,
          hasUnread: previous !== undefined ? previous.hasUnread : false, agentPreset: item.agentPreset ?? previous?.agentPreset,
          hasConversation: !item.blank, parentSessionId: item.parentSessionId ?? previous?.parentSessionId,
          origin: item.origin ?? previous?.origin, cwd: item.cwd ?? previous?.cwd });
      }
      sessions = Array.from(merged.values()).sort((a: SessionListItem, b: SessionListItem) => b.lastActivityEpochSeconds - a.lastActivityEpochSeconds);
    } else if ((action.kind === 'MessageSent' || action.kind === 'KnownSessionAdded') && id.length > 0) {
      sessions = SessionListReducer.upsert(sessions, id, action.kind === 'MessageSent' ? labels.newSessionTitle : labels.remoteSessionPrefix + id.substring(0, 8), labels, now);
      sessions = sessions.map((row: SessionListItem): SessionListItem => {
        if (row.id !== id) return row;
        const copy: SessionListItem = SessionListReducer.copyItem(row);
        if (action.kind === 'MessageSent') { copy.agentPreset = action.agentPreset; copy.hasConversation = true; }
        else if (action.hasConversation === true) copy.hasConversation = true;
        return copy;
      });
      if (action.kind === 'MessageSent' && selected === null) selected = id;
    } else if (action.kind === 'MarkRead' && id.length > 0) {
      sessions = sessions.map((row: SessionListItem): SessionListItem => row.id === id ? SessionListReducer.withRead(row) : row);
    } else if (action.kind === 'HistoryReceived' && id.length > 0 && action.events !== undefined) {
      let boundary: SessionEvent | undefined;
      for (const event of action.events) if (event.sessionId === id &&
        (event.event.type === 'user/message' || event.event.type === 'turn/start' || event.event.type === 'turn/end') &&
        (boundary === undefined || event.seq > boundary.seq)) boundary = event;
      if (boundary !== undefined && boundary.event.type === 'turn/end') sessions = sessions.map((row: SessionListItem): SessionListItem => row.id === id ? SessionListReducer.withStopped(row) : row);
    } else if (action.kind === 'EventReceived' && action.event !== undefined) {
      const record = action.event; const type = record.event.type; const text = record.event.text;
      if (type === 'session/title') {
        if (text === undefined || text.trim().length === 0 || (sequences.has(record.sessionId) && record.seq <= (sequences.get(record.sessionId) as number))) return state;
        sessions = SessionListReducer.upsert(sessions, record.sessionId, text, labels, now);
        sessions = sessions.map((row: SessionListItem): SessionListItem => row.id === record.sessionId ? SessionListReducer.withTitle(row, text) : row);
        sequences.set(record.sessionId, record.seq);
      } else {
        sessions = SessionListReducer.upsert(sessions, record.sessionId, type === 'user/message' ? text?.substring(0, 28) : undefined, labels, now);
        if (type === 'user/message' || type === 'turn/start' || type === 'turn/end' || type === 'assistant/message') {
          sessions = sessions.map((row: SessionListItem): SessionListItem => row.id !== record.sessionId ? row : SessionListReducer.withEvent(row, record, selected)).sort((a: SessionListItem, b: SessionListItem) => b.lastActivityEpochSeconds - a.lastActivityEpochSeconds);
        }
      }
    } else throw new Error('invalid session list action');
    return { sessions: sessions, selectedSessionId: selected, archivedSessionIds: archived, titleSequences: sequences };
  }
  private static copyItem(row: SessionListItem): SessionListItem {
    return { id: row.id, title: row.title, lastActivityEpochSeconds: row.lastActivityEpochSeconds,
      isRunning: row.isRunning, hasUnread: row.hasUnread, agentPreset: row.agentPreset,
      hasConversation: row.hasConversation, parentSessionId: row.parentSessionId, origin: row.origin, cwd: row.cwd };
  }
  private static withRead(row: SessionListItem): SessionListItem { const next = SessionListReducer.copyItem(row); next.hasUnread = false; return next; }
  private static withStopped(row: SessionListItem): SessionListItem { const next = SessionListReducer.copyItem(row); next.isRunning = false; return next; }
  private static withTitle(row: SessionListItem, title: string): SessionListItem { const next = SessionListReducer.copyItem(row); next.title = title; return next; }
  private static withEvent(row: SessionListItem, record: SessionEvent, selected: string | null): SessionListItem {
    const next = SessionListReducer.copyItem(row);
    next.lastActivityEpochSeconds = SessionListReducer.epoch(record.time); next.hasConversation = true;
    if (record.event.type === 'turn/start') next.isRunning = true;
    else if (record.event.type === 'turn/end') next.isRunning = false;
    next.hasUnread = selected !== record.sessionId; return next;
  }
  static epoch(value: number): number { return value > 10000000000 ? value / 1000 : value; }
  private static upsert(sessions: SessionListItem[], id: string, title: string | undefined, labels: SessionListLabels, now: number): SessionListItem[] {
    const index = sessions.findIndex((row: SessionListItem) => row.id === id);
    if (index < 0) return [{ id: id, title: title ?? labels.remoteSessionPrefix + id.substring(0, 8), lastActivityEpochSeconds: now,
      isRunning: false, hasUnread: false, hasConversation: false }, ...sessions];
    const row = sessions[index];
    if (title !== undefined && title.length > 0 && (row.title === labels.newSessionTitle || row.title.startsWith(labels.remoteSessionPrefix))) sessions[index] = SessionListReducer.withTitle(row, title);
    return sessions;
  }
}
