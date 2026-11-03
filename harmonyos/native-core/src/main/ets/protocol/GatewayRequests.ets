/**
 * 发送侧帧构造（ArkTS 版）。
 * 帧格式与小程序/元服务 utils/gateway.js 保持一致：{ type, ... }。
 */
export class GatewayRequests {
  private static encode(frame: Record<string, Object>): string {
    return JSON.stringify(frame);
  }

  static ping(): string {
    const frame: Record<string, Object> = { 'type': 'ping' };
    return GatewayRequests.encode(frame);
  }

  static workspaces(): string {
    const frame: Record<string, Object> = { 'type': 'workspaces' };
    return GatewayRequests.encode(frame);
  }

  static sessions(): string {
    const frame: Record<string, Object> = { 'type': 'sessions', 'view': 'summary' };
    return GatewayRequests.encode(frame);
  }

  static host(): string {
    const frame: Record<string, Object> = { 'type': 'host' };
    return GatewayRequests.encode(frame);
  }

  static history(sessionId: string, maxMessages: number = 40, maxBytes: number = 262144): string {
    const frame: Record<string, Object> = {
      'type': 'history',
      'sessionId': sessionId,
      'maxMessages': maxMessages,
      'maxBytes': maxBytes,
      'view': 'conversation'
    };
    return GatewayRequests.encode(frame);
  }

  static subscribe(sessionId: string): string {
    const frame: Record<string, Object> = {
      'type': 'subscribe',
      'sessionId': sessionId,
      'assistantStream': true
    };
    return GatewayRequests.encode(frame);
  }

  static unsubscribe(): string {
    const frame: Record<string, Object> = { 'type': 'unsubscribe' };
    return GatewayRequests.encode(frame);
  }

  static message(text: string, sessionId: string, timeZone: string): string {
    const frame: Record<string, Object> = {
      'type': 'message',
      'text': text,
      'images': [],
      'attachments': [],
      'clientTimeZone': timeZone
    };
    if (sessionId.length > 0) {
      frame['sessionId'] = sessionId;
    }
    return GatewayRequests.encode(frame);
  }

  static sessionCancel(sessionId: string): string {
    const frame: Record<string, Object> = { 'type': 'session-cancel', 'sessionId': sessionId };
    return GatewayRequests.encode(frame);
  }

  static sessionRename(sessionId: string, title: string): string {
    const frame: Record<string, Object> = { 'type': 'session-rename', 'sessionId': sessionId, 'title': title };
    return GatewayRequests.encode(frame);
  }
}
