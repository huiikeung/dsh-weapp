import { GatewayFrame } from './GatewayDtos';

export interface RequestCorrelation {
  id: string;
  matchType: string;
  hasRequestId: boolean;
  requestType: string;
  transferId: string;
  offset: number;
  rpcId: string;
  sessionId: string;
}

/** Match uncorrelated legacy download replies only when ownership is explicit. */
export function matchesResponse(req: RequestCorrelation, frame: GatewayFrame): boolean {
  if (req.rpcId.length > 0) {
    return frame.kind === req.matchType && frame.rpcId === req.rpcId &&
      (frame.sessionId === undefined || frame.sessionId === req.sessionId);
  }
  if (!req.hasRequestId) return frame.kind === req.matchType;
  if (frame.requestId !== undefined && frame.requestId.length > 0) {
    return frame.requestId === req.id && (frame.kind === req.matchType || frame.kind === 'error');
  }
  if (frame.kind === 'error') {
    return req.requestType.startsWith('file-download-') && frame.requestType === req.requestType;
  }
  if (frame.kind !== req.matchType || req.transferId.length === 0 || frame.transferId !== req.transferId) {
    return false;
  }
  if (req.requestType === 'file-download-read') return frame.offset === req.offset;
  return req.requestType === 'file-download-cancel';
}
