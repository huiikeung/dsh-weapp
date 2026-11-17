import { GatewayFrame, SessionEvent } from '../protocol/GatewayDtos';
import { asRec, num, str } from '../protocol/GatewayFrameCodec';

export interface AssistantChunk { time: number; chunk: Object; }
interface AssistantChunkFrame { time: number; chunk: Object; }
export interface AssistantStreamUpdate {
  accepted: boolean; sessionId?: string; clearTransient: boolean; chunks: AssistantChunk[];
  attemptId?: string; error?: string; resubscribe: boolean; invalidatedSessionIds: string[];
}
export class AssistantStreamState {
  private selectedSessionId: string | null = null;
  private subscriptionId: string | null = null;
  private retiredSubscriptions: Set<string> = new Set();
  private streamId: string | null = null;
  private attempt: Object | null = null;
  private revision: number = -1;
  private nextIndex: number = 0;
  private committedType: string | null = null;
  private committedSeq: number | null = null;
  private chunks: AssistantChunk[] = [];
  private cursors: Map<string, number> = new Map();
  private formats: Map<string, number | null> = new Map();
  private helloFormat: number | null = null;
  private enabled: boolean = false;
  selectSession(sessionId: string | null): void { this.selectedSessionId = sessionId; this.disconnect(); }
  disconnect(): void { if (this.subscriptionId !== null) this.retiredSubscriptions.add(this.subscriptionId); this.subscriptionId = null; this.streamId = null; this.clearAttempt(); }
  hasBaseline(sessionId: string): boolean { return this.selectedSessionId === sessionId && this.streamId !== null; }
  get persistentCursor(): number | null { return this.selectedSessionId === null ? null : this.cursors.get(this.selectedSessionId) ?? null; }
  rememberCachedFormat(sessionId: string, historyFormatVersion: number | null): void { this.formats.set(sessionId, historyFormatVersion); }
  formatVersion(sessionId: string): number | null { return this.formats.get(sessionId) ?? null; }
  retainSessions(sessionIds: string[]): void {
    const keep: Set<string> = new Set(sessionIds); if (this.selectedSessionId !== null) keep.add(this.selectedSessionId);
    for (const id of this.formats.keys()) if (!keep.has(id)) this.formats.delete(id);
    for (const id of this.cursors.keys()) if (!keep.has(id)) this.cursors.delete(id);
  }
  activeAttemptId(): string | null { return this.attempt === null ? null : str(this.attempt, 'attemptId') ?? null; }
  replayChunks(): AssistantChunk[] { return this.chunks.slice(); }
  accept(frame: GatewayFrame): AssistantStreamUpdate {
    if (frame.kind === 'hello') return this.acceptHello(frame);
    if (frame.kind === 'history' && frame.sessionId !== undefined) return this.acceptHistory(frame);
    if (frame.kind === 'error' && frame.resetRequired === true && frame.sessionId !== undefined) return this.invalidateHistory(frame.sessionId, frame.message);
    if (frame.kind === 'subscribed') return this.acceptSubscription(frame);
    if (frame.kind === 'session-stream-reset') return this.acceptReset(frame);
    if (frame.kind === 'session-snapshot') return this.acceptSnapshot(frame);
    if (frame.kind === 'event') return this.acceptEvent(frame);
    if (frame.kind === 'assistant-stream') return this.acceptStream(frame);
    return this.update(true, frame.sessionId);
  }
  private acceptHello(frame: GatewayFrame): AssistantStreamUpdate {
    const version: number | null = frame.historyFormatVersion === undefined ? null : Number(frame.historyFormatVersion);
    this.helloFormat = version !== null && Number.isSafeInteger(version) ? version : null;
    this.enabled = true;
    return this.update(true, frame.sessionId);
  }

  private acceptHistory(frame: GatewayFrame): AssistantStreamUpdate {
    const sessionId: string = frame.sessionId ?? '';
    if (sessionId.length === 0) return this.update(false);
    const format: number | null = frame.historyFormatVersion === undefined
      ? this.formats.get(sessionId) ?? this.helloFormat
      : Number(frame.historyFormatVersion);
    if (format !== null && Number.isSafeInteger(format)) this.formats.set(sessionId, format);
    if (frame.cursor !== undefined && Number.isSafeInteger(frame.cursor) && frame.cursor >= 0) {
      this.cursors.set(sessionId, frame.cursor);
    }
    return this.update(sessionId === this.selectedSessionId, sessionId);
  }

  private invalidateHistory(sessionId: string, message?: string): AssistantStreamUpdate {
    this.formats.delete(sessionId);
    this.cursors.delete(sessionId);
    if (sessionId === this.selectedSessionId) {
      this.streamId = null;
      this.clearAttempt();
    }
    const result: AssistantStreamUpdate = this.update(false, sessionId, true, [], undefined, message, true);
    result.invalidatedSessionIds = [sessionId];
    return result;
  }

  private acceptSubscription(frame: GatewayFrame): AssistantStreamUpdate {
    if (frame.sessionId !== this.selectedSessionId || frame.subscriptionId === undefined || this.retiredSubscriptions.has(frame.subscriptionId)) return this.update(false);
    if (this.subscriptionId !== null && this.subscriptionId !== frame.subscriptionId) this.retiredSubscriptions.add(this.subscriptionId);
    this.subscriptionId = frame.subscriptionId; this.streamId = null; this.clearAttempt();
    return this.update(true, frame.sessionId, true);
  }
  private acceptSnapshot(frame: GatewayFrame): AssistantStreamUpdate {
    if (frame.sessionId !== this.selectedSessionId || frame.subscriptionId !== this.subscriptionId) return this.update(false);
    const cursor = frame.cursor; const stream = asRec(frame.assistantStream);
    if (cursor === undefined || !Number.isSafeInteger(cursor) || cursor < 0 || frame.streamId === undefined || frame.streamId.length === 0) return this.fail(frame.sessionId, 'invalid snapshot baseline');
    this.streamId = frame.streamId; this.cursors.set(frame.sessionId, cursor); this.revision = num(stream, 'revision') ?? 0;
    this.clearAttempt(); const attempt = stream === undefined ? undefined : asRec(stream['activeAttempt']);
    if (attempt !== undefined) {
      this.attempt = attempt; this.nextIndex = num(attempt, 'nextIndex') ?? 0;
      const rows = attempt['stream']; if (Array.isArray(rows)) for (const row of rows as Object[]) {
        const r = asRec(row); const chunk = r !== undefined ? asRec(r['chunk']) : undefined;
        if (r !== undefined && chunk !== undefined) this.chunks.push({ time: num(r, 'time') ?? 0, chunk: chunk });
      }
    }
    return this.update(true, frame.sessionId, true, this.chunks.slice(), this.activeAttemptId() ?? undefined);
  }
  private acceptEvent(frame: GatewayFrame): AssistantStreamUpdate {
    const id = frame.sessionId; if (id !== this.selectedSessionId || this.subscriptionId === null || frame.subscriptionId !== this.subscriptionId || frame.streamId !== this.streamId) return this.update(false);
    if (frame.seq === undefined || !Number.isSafeInteger(frame.seq)) return this.update(false);
    const cursor = this.cursors.get(id) ?? -1; if (frame.seq <= cursor) return this.update(false);
    this.cursors.set(id, frame.seq);
    const type = frame.event?.type; const settled = (type === 'assistant/message' || type === 'assistant/attempt') &&
      frame.event?.turn === num(this.attempt, 'turn') && frame.event?.step === num(this.attempt, 'step');
    if (settled) { this.chunks = []; this.committedType = type ?? null; this.committedSeq = frame.seq; }
    return this.update(true, id, settled);
  }
  private acceptStream(frame: GatewayFrame): AssistantStreamUpdate {
    if (frame.sessionId !== this.selectedSessionId || frame.subscriptionId !== this.subscriptionId || frame.streamId !== this.streamId) return this.update(false);
    const value = asRec(frame.frame); if (value === undefined) return this.fail(frame.sessionId, 'missing stream frame');
    const revision = num(value, 'revision'); if (revision === undefined || !Number.isSafeInteger(revision)) return this.fail(frame.sessionId, 'missing stream revision');
    if (revision <= this.revision) return this.update(false);
    if (revision !== this.revision + 1) return this.fail(frame.sessionId, 'stream revision gap');
    const type = str(value, 'type'); const attemptId = str(value, 'attemptId');
    if (type === 'start' && attemptId !== undefined) { this.clearAttempt(); this.attempt = value; this.revision = revision; return this.update(true, frame.sessionId, true, [], attemptId); }
    if ((type !== 'chunk' && type !== 'end') || attemptId === undefined || attemptId !== this.activeAttemptId()) return this.fail(frame.sessionId, 'invalid stream attempt');
    const index = num(value, 'index'); if (index === undefined || !Number.isSafeInteger(index)) return this.fail(frame.sessionId, 'missing stream index');
    if (index < this.nextIndex) return this.update(false);
    if (index !== this.nextIndex) return this.fail(frame.sessionId, 'stream index gap');
    if (type === 'end') {
      const outcome = asRec(value['outcome']); if (outcome === undefined) return this.fail(frame.sessionId, 'missing stream outcome');
      if (str(outcome, 'kind') === 'committed' && (str(outcome, 'eventType') !== this.committedType || num(outcome, 'seq') !== this.committedSeq)) return this.fail(frame.sessionId, 'missing committed event');
      this.revision = revision; this.clearAttempt(); return this.update(true, frame.sessionId, true);
    }
    const chunk = asRec(value['chunk']); if (chunk === undefined) return this.fail(frame.sessionId, 'missing stream chunk');
    const entry: AssistantChunk = { time: num(value, 'time') ?? 0, chunk: chunk }; this.chunks.push(entry); this.nextIndex += 1; this.revision = revision;
    return this.update(true, frame.sessionId, false, [entry], attemptId);
  }
  private acceptReset(frame: GatewayFrame): AssistantStreamUpdate {
    if (frame.sessionId !== this.selectedSessionId || (frame.subscriptionId !== undefined && frame.subscriptionId !== this.subscriptionId) ||
      (frame.streamId !== undefined && this.streamId !== null && frame.streamId !== this.streamId)) return this.update(false);
    this.streamId = null; this.clearAttempt(); return this.update(true, frame.sessionId, true, [], undefined, frame.retrying === false ? frame.message : undefined);
  }
  private clearAttempt(): void { this.attempt = null; this.chunks = []; this.nextIndex = 0; this.committedType = null; this.committedSeq = null; }
  private fail(sessionId?: string, error?: string): AssistantStreamUpdate { this.streamId = null; this.clearAttempt(); return this.update(false, sessionId, true, [], undefined, error, true); }
  private update(accepted: boolean, sessionId?: string, clearTransient: boolean = false, chunks: AssistantChunk[] = [], attemptId?: string, error?: string, resubscribe: boolean = false): AssistantStreamUpdate {
    return { accepted, sessionId, clearTransient, chunks, attemptId, error, resubscribe, invalidatedSessionIds: [] };
  }
}
