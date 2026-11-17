import { GatewayPendingApprovalRequest } from '../protocol/GatewayDtos';

export interface ApprovalFailure { code: string; argument?: string; }
export interface ApprovalRequestStatus { kind: string; outcome?: string; failure?: ApprovalFailure; }
export interface ApprovalState {
  pendingRequests: GatewayPendingApprovalRequest[];
  requestStatuses: Map<string, ApprovalRequestStatus>;
}
export interface ApprovalAction {
  kind: string;
  request?: GatewayPendingApprovalRequest;
  outcome?: string;
  isConnected?: boolean;
  rpcId?: string;
  accepted?: boolean;
  reason?: string;
  message?: string;
  sessionId?: string;
}
export class ApprovalReducer {
  static initial(): ApprovalState { return { pendingRequests: [], requestStatuses: new Map() }; }
  static reduce(state: ApprovalState, action: ApprovalAction): ApprovalState {
    if (action.kind === 'Reset') return ApprovalReducer.initial();
    const pending = state.pendingRequests.slice();
    const statuses = new Map<string, ApprovalRequestStatus>(state.requestStatuses);
    if (action.kind === 'RequestReceived' && action.request !== undefined) {
      const request = action.request;
      const index = pending.findIndex((item: GatewayPendingApprovalRequest) => item.rpcId === request.rpcId);
      if (index >= 0) pending[index] = request;
      else { pending.push(request); statuses.set(request.rpcId, { kind: 'Idle' }); }
    } else if (action.kind === 'Submit' && action.request !== undefined && action.outcome !== undefined) {
      statuses.set(action.request.rpcId, action.isConnected === true
        ? { kind: 'Submitting', outcome: action.outcome }
        : { kind: 'Rejected', failure: { code: 'DISCONNECTED' } });
    } else if (action.kind === 'ResponseReceived' && action.rpcId !== undefined && action.outcome !== undefined) {
      if (action.accepted === true) statuses.set(action.rpcId, { kind: 'Accepted', outcome: action.outcome });
      else if (action.reason === 'not-pending') return ApprovalReducer.remove(pending, statuses, action.rpcId);
      else statuses.set(action.rpcId, { kind: 'Rejected', failure: { code: 'SERVER_REJECTED', argument: action.reason ?? 'bad-response' } });
    } else if (action.kind === 'Resolved' && action.rpcId !== undefined) {
      return ApprovalReducer.remove(pending, statuses, action.rpcId);
    } else if (action.kind === 'RequestFailed' && action.rpcId !== undefined) {
      statuses.set(action.rpcId, ApprovalReducer.failure(action.message));
    } else if (action.kind === 'SessionRequestsFailed' && action.sessionId !== undefined) {
      for (const request of pending) if (request.sessionId === action.sessionId) statuses.set(request.rpcId, ApprovalReducer.failure(action.message));
    } else { throw new Error('invalid approval action'); }
    return { pendingRequests: pending, requestStatuses: statuses };
  }
  private static failure(message?: string): ApprovalRequestStatus {
    return { kind: 'Rejected', failure: { code: 'REQUEST_FAILED', argument: message !== undefined && message.trim().length > 0 ? message : undefined } };
  }
  private static remove(pending: GatewayPendingApprovalRequest[], statuses: Map<string, ApprovalRequestStatus>, id: string): ApprovalState {
    statuses.delete(id);
    return { pendingRequests: pending.filter((item: GatewayPendingApprovalRequest) => item.rpcId !== id), requestStatuses: statuses };
  }
}
