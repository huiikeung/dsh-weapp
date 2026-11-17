import { GatewayPendingQuestionRequest, GatewayQuestionAnswer } from '../protocol/GatewayDtos';

export interface QuestionFailure { code: string; argument?: string; }
export interface QuestionRequestStatus { kind: string; action?: string; failure?: QuestionFailure; }
export interface QuestionState { pendingRequests: GatewayPendingQuestionRequest[]; requestStatuses: Map<string, QuestionRequestStatus>; }
export interface QuestionSubmission { kind: string; answers?: GatewayQuestionAnswer[]; }
export interface QuestionAction {
  kind: string; request?: GatewayPendingQuestionRequest; submission?: QuestionSubmission; isConnected?: boolean;
  rpcId?: string; action?: string; accepted?: boolean; reason?: string; message?: string; sessionId?: string;
}
export class QuestionReducer {
  static initial(): QuestionState { return { pendingRequests: [], requestStatuses: new Map() }; }
  static reduce(state: QuestionState, action: QuestionAction): QuestionState {
    if (action.kind === 'Reset') return QuestionReducer.initial();
    const pending = state.pendingRequests.slice();
    const statuses = new Map<string, QuestionRequestStatus>(state.requestStatuses);
    if (action.kind === 'RequestReceived' && action.request !== undefined) {
      const request = action.request;
      const index = pending.findIndex((item: GatewayPendingQuestionRequest) => item.rpcId === request.rpcId);
      if (index >= 0) pending[index] = request;
      else { pending.push(request); statuses.set(request.rpcId, { kind: 'Idle' }); }
    } else if (action.kind === 'Submit' && action.request !== undefined && action.submission !== undefined) {
      const submission = action.submission;
      let status: QuestionRequestStatus;
      if (submission.kind === 'Cancel') status = action.isConnected === true ? { kind: 'Submitting', action: 'cancel' }
        : { kind: 'Rejected', failure: { code: 'DISCONNECTED_CANCEL' } };
      else if (submission.kind === 'Answer' && submission.answers !== undefined) {
        const failure = action.isConnected === true ? QuestionReducer.validate(action.request, submission.answers)
          : { code: 'DISCONNECTED_ANSWER' } as QuestionFailure;
        status = failure === null ? { kind: 'Submitting', action: 'answer' } : { kind: 'Rejected', failure: failure };
      } else throw new Error('invalid submission');
      statuses.set(action.request.rpcId, status);
    } else if (action.kind === 'ResponseReceived' && action.rpcId !== undefined && action.action !== undefined) {
      if (action.accepted === true) statuses.set(action.rpcId, { kind: 'Accepted', action: action.action });
      else if (action.reason === 'not-pending') return QuestionReducer.remove(pending, statuses, action.rpcId);
      else statuses.set(action.rpcId, { kind: 'Rejected', failure: { code: 'SERVER_REJECTED', argument: action.reason ?? 'bad-response' } });
    } else if (action.kind === 'Resolved' && action.rpcId !== undefined) return QuestionReducer.remove(pending, statuses, action.rpcId);
    else if (action.kind === 'RequestFailed' && action.rpcId !== undefined) statuses.set(action.rpcId, QuestionReducer.failure(action.message));
    else if (action.kind === 'SessionRequestsFailed' && action.sessionId !== undefined) {
      for (const request of pending) if (request.sessionId === action.sessionId) statuses.set(request.rpcId, QuestionReducer.failure(action.message));
    } else throw new Error('invalid question action');
    return { pendingRequests: pending, requestStatuses: statuses };
  }
  static validate(request: GatewayPendingQuestionRequest, answers: GatewayQuestionAnswer[]): QuestionFailure | null {
    if (request.questions.length !== answers.length) return { code: 'INVALID_ANSWER_ORDER' };
    for (let i = 0; i < answers.length; i++) {
      const question = request.questions[i]; const answer = answers[i];
      if (question.id !== answer.id) return { code: 'INVALID_ANSWER_ORDER' };
      const allowed: Set<string> = new Set();
      if (question.options !== undefined) for (const option of question.options) allowed.add(option.label);
      const selected: Set<string> = new Set();
      for (const value of answer.selected) {
        if (selected.has(value) || !allowed.has(value)) return { code: 'INVALID_OR_DUPLICATE_OPTIONS', argument: question.question };
        selected.add(value);
      }
      if (question.multiSelect !== true && (answer.selected.length > 1 ||
        (answer.selected.length === 1 && answer.custom !== undefined && answer.custom.trim().length > 0))) {
        return { code: 'SINGLE_SELECTION_REQUIRED', argument: question.question };
      }
    }
    return null;
  }
  private static failure(message?: string): QuestionRequestStatus {
    return { kind: 'Rejected', failure: { code: 'REQUEST_FAILED', argument: message !== undefined && message.trim().length > 0 ? message : undefined } };
  }
  private static remove(pending: GatewayPendingQuestionRequest[], statuses: Map<string, QuestionRequestStatus>, id: string): QuestionState {
    statuses.delete(id);
    return { pendingRequests: pending.filter((item: GatewayPendingQuestionRequest) => item.rpcId !== id), requestStatuses: statuses };
  }
}
