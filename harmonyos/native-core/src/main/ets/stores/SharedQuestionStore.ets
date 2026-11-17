import { SharedStoreKernel } from './SharedStoreKernel';
import { SharedMviEvent, SharedMviSubscription, SharedMviDispatchResult } from '../facade/SharedMviEvents';

export interface QuestionRequest { rpcId: string; sessionId: string; questions: Object[]; replay: boolean; }
export interface QuestionResult { snapshotJson: string | null; effectJson: string | null; errorCode: string | null; errorMessage: string | null; }
interface QuestionSessionState { rpcId: string; status?: string; }
interface QuestionEffect { action: string; rpcId: string; sessionId: string; answers?: Object[]; }

/** Ported skeleton of KMP SharedQuestionStore with RPC-scoped pending requests and effects. */
export class SharedQuestionStore extends SharedStoreKernel {
  private pending: Map<string, QuestionRequest> = new Map();
  private statuses: Map<string, string> = new Map();
  constructor() { super('question'); }
  requestReceived(request: QuestionRequest): QuestionResult {
    if (request.rpcId.trim().length === 0 || request.sessionId.trim().length === 0) {
      return this.error('INVALID_QUESTION_REQUEST');
    }
    this.pending.set(request.rpcId, request);
    this.statuses.set(request.rpcId, 'pending');
    const result = this.dispatch('request-received', () => {
      const state: QuestionSessionState = { rpcId: request.rpcId };
      this.setSession(request.sessionId, state);
    });
    return this.ok(result, null);
  }
  submitAnswer(rpcId: string, answers: Object[], isConnected: boolean): QuestionResult {
    const request = this.pending.get(rpcId);
    if (request === undefined) return this.error('UNKNOWN_RPC_ID');
    if (!isConnected) return this.error('NOT_CONNECTED');
    if (!Array.isArray(answers) || answers.length === 0) return this.error('EMPTY_ANSWERS');
    this.statuses.set(rpcId, 'submitting');
    const descriptor: QuestionEffect = { action: 'send-question-answer', rpcId: rpcId, sessionId: request.sessionId, answers: answers };
    const effect = JSON.stringify(descriptor);
    const result = this.dispatch('answer', () => {
      const state: QuestionSessionState = { rpcId: rpcId, status: 'submitting' };
      this.setSession(request.sessionId, state);
    });
    return this.ok(result, effect);
  }
  submitCancel(rpcId: string, isConnected: boolean): QuestionResult {
    const request = this.pending.get(rpcId);
    if (request === undefined) return this.error('UNKNOWN_RPC_ID');
    if (!isConnected) return this.error('NOT_CONNECTED');
    const descriptor: QuestionEffect = { action: 'send-question-cancel', rpcId: rpcId, sessionId: request.sessionId };
    const effect = JSON.stringify(descriptor);
    const result = this.dispatch('cancel', () => { this.statuses.set(rpcId, 'cancelling'); });
    return this.ok(result, effect);
  }
  responseReceived(rpcId: string, accepted: boolean): QuestionResult {
    if (!this.pending.has(rpcId)) return this.error('UNKNOWN_RPC_ID');
    const result = this.dispatch('response', () => { this.statuses.set(rpcId, accepted ? 'accepted' : 'rejected'); });
    return this.ok(result, null);
  }
  resolved(rpcId: string): QuestionResult {
    if (!this.pending.has(rpcId)) return this.error('UNKNOWN_RPC_ID');
    const result = this.dispatch('resolved', () => { this.pending.delete(rpcId); this.statuses.delete(rpcId); });
    return this.ok(result, null);
  }
  snapshot(): string {
    const statuses: Record<string, string> = {};
    this.statuses.forEach((value: string, key: string) => { statuses[key] = value; });
    const requests: QuestionRequest[] = [];
    this.pending.forEach((value: QuestionRequest) => { requests.push(value); });
    return JSON.stringify({ pendingRequests: requests, requestStatuses: statuses });
  }
  private ok(result: SharedMviDispatchResult, effect: string | null): QuestionResult {
    const output: QuestionResult = { snapshotJson: this.snapshot(), effectJson: effect, errorCode: result.errorCode, errorMessage: result.errorMessage };
    return output;
  }
  private error(code: string): QuestionResult {
    const output: QuestionResult = { snapshotJson: null, effectJson: null, errorCode: code, errorMessage: code };
    return output;
  }
}
