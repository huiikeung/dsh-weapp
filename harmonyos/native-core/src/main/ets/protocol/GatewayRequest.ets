export enum GatewayRequestLanePolicy {
  COALESCE_LATEST = 'COALESCE_LATEST', FIFO = 'FIFO', REJECT_IF_BUSY = 'REJECT_IF_BUSY'
}

export interface GatewayRequest {
  requestType: string;
  responseKind: string;
  targetSessionId?: string;
  correlationId?: string;
  lanePolicy: GatewayRequestLanePolicy;
  payload: string;
  timeoutMilliseconds?: number;
  isBackgroundHistory: boolean;
  /**
   * 超时是否视为「连接已坏」。
   * 默认 true：历史/订阅这类一旦不回就应该重连的请求。
   * 但会话控制类（goal / tasks / queue / context-*）在旧网关上可能根本不回执，
   * 那种情况绝不能再 failSocket —— 否则点一下「暂停目标」就把整条网关连接打断，
   * 页面上所有操作（发送、滑动、切换）都会跟着失灵。
   */
  timeoutIsFatal?: boolean;
}

export interface LaneSubmission { status: string; cancelled: GatewayRequest[]; }
interface RequestLane { active: GatewayRequest; queued: GatewayRequest[]; }

/** Lane bookkeeping; transport and timeout effects remain the caller's responsibility. */
export class GatewayRequestLanes {
  private lanes: Map<string, RequestLane> = new Map();
  submit(request: GatewayRequest): LaneSubmission {
    const lane: RequestLane | undefined = this.lanes.get(request.responseKind);
    if (lane === undefined) {
      this.lanes.set(request.responseKind, { active: request, queued: [] });
      return { status: 'active', cancelled: [] };
    }
    if (request.lanePolicy === GatewayRequestLanePolicy.REJECT_IF_BUSY) return { status: 'busy', cancelled: [] };
    const cancelled: GatewayRequest[] = request.lanePolicy === GatewayRequestLanePolicy.COALESCE_LATEST
      ? lane.queued.splice(0, lane.queued.length) : [];
    lane.queued.push(request);
    return { status: 'queued', cancelled: cancelled };
  }
  active(responseKind: string): GatewayRequest | undefined { return this.lanes.get(responseKind)?.active; }
  complete(responseKind: string): GatewayRequest | undefined {
    const lane: RequestLane | undefined = this.lanes.get(responseKind);
    if (lane === undefined) return undefined;
    const next: GatewayRequest | undefined = lane.queued.shift();
    if (next === undefined) this.lanes.delete(responseKind);
    else lane.active = next;
    return next;
  }
  cancel(responseKind: string): GatewayRequest[] {
    const lane: RequestLane | undefined = this.lanes.get(responseKind);
    if (lane === undefined) return [];
    this.lanes.delete(responseKind);
    return [lane.active, ...lane.queued];
  }
}

export interface GatewayOutgoingImage { mediaType: string; base64Data: string; name?: string; }
export interface GatewayTextPart { type: string; text: string; }
export interface GatewayQuestionAnswer { id: string; selected: string[]; custom?: string; }
export interface GatewayGoalReference { id: string; revision: number; }

export class GatewayRequestFactory {
  static make(type: string, responseKind: string, fields: Record<string, Object> = {},
    targetSessionId?: string, correlationId?: string,
    lanePolicy: GatewayRequestLanePolicy = GatewayRequestLanePolicy.COALESCE_LATEST,
    timeoutMilliseconds?: number, isBackgroundHistory: boolean = false): GatewayRequest {
    const wire: Record<string, Object> = {};
    Object.keys(fields).forEach((key: string) => { if (key !== 'type') wire[key] = fields[key]; });
    wire['type'] = type;
    return { requestType: type, responseKind: responseKind, targetSessionId: targetSessionId,
      correlationId: correlationId, lanePolicy: lanePolicy, payload: JSON.stringify(wire),
      timeoutMilliseconds: timeoutMilliseconds, isBackgroundHistory: isBackgroundHistory, timeoutIsFatal: true };
  }
  static simple(type: string, responseKind: string = type): GatewayRequest { return GatewayRequestFactory.make(type, responseKind); }
  static ping(): GatewayRequest { return GatewayRequestFactory.make('ping', 'pong', {}, undefined, undefined, GatewayRequestLanePolicy.REJECT_IF_BUSY); }
  static createSession(requestId: string, workspaceId?: string, agentPreset?: string): GatewayRequest {
    const fields: Record<string, Object> = { 'requestId': requestId };
    if (workspaceId !== undefined && workspaceId.trim().length > 0) fields['workspaceId'] = workspaceId;
    // 指定 Agent 预设（创造模式等），对齐小程序 createSession(workspaceId, agentPreset)
    if (agentPreset !== undefined && agentPreset.trim().length > 0) fields['agentPreset'] = agentPreset;
    return GatewayRequestFactory.make('session-create', 'session-created', fields, undefined, requestId, GatewayRequestLanePolicy.REJECT_IF_BUSY);
  }
  static subscribe(sessionId?: string): GatewayRequest {
    if (sessionId === undefined || sessionId.trim().length === 0) return GatewayRequestFactory.make('unsubscribe', 'subscribed');
    return GatewayRequestFactory.make('subscribe', 'subscribed', { 'sessionId': sessionId, 'assistantStream': true }, sessionId);
  }
  static history(sessionId: string, beforeSequence?: number, maxMessages: number = 50, maxBytes?: number,
    view?: string, historyFormatVersion?: number, isBackgroundHistory: boolean = false): GatewayRequest {
    const fields: Record<string, Object> = { 'sessionId': sessionId, 'maxMessages': maxMessages };
    if (beforeSequence !== undefined) {
      if (!Number.isInteger(beforeSequence) || beforeSequence < 0 || historyFormatVersion === undefined) throw new Error('history cursor requires format version');
      fields['beforeSeq'] = beforeSequence; fields['historyFormatVersion'] = historyFormatVersion;
    }
    if (maxBytes !== undefined) fields['maxBytes'] = maxBytes;
    if (view !== undefined && view.trim().length > 0) fields['view'] = view;
    return GatewayRequestFactory.make('history', 'history', fields, sessionId, undefined,
      GatewayRequestLanePolicy.COALESCE_LATEST, undefined, isBackgroundHistory);
  }
  /**
   * 只读预览任意会话的记录（对齐小程序 inspectSession）。
   *
   * 子智能体（subagent）会话必须带持久父地址，否则网关以 session/agent-busy 拒绝，
   * 且错误帧不带 sessionId，只能干等到超时。
   */
  static inspectHistory(sessionId: string, parentSessionId?: string, mode?: string,
    maxMessages: number = 20, maxBytes: number = 262144): GatewayRequest {
    const fields: Record<string, Object> = { 'sessionId': sessionId, 'maxMessages': maxMessages,
      'maxBytes': maxBytes, 'view': 'conversation' };
    const parent: string = parentSessionId !== undefined ? parentSessionId.trim() : '';
    if (parent.length > 0) {
      fields['parentSessionId'] = parent;
      if (mode === 'one-shot' || mode === 'continuable' || mode === 'unknown') {
        fields['mode'] = mode;
      }
    }
    return GatewayRequestFactory.make('history', 'history', fields, sessionId, undefined,
      GatewayRequestLanePolicy.REJECT_IF_BUSY, 8000);
  }

  static queueUpdate(sessionId: string, itemId: string, action: string): GatewayRequest {
    if (action !== 'remove' && action !== 'steer') throw new Error('invalid queue action');
    return GatewayRequestFactory.tolerated(
      GatewayRequestFactory.make('queue-update', 'queue-item-updated', { 'sessionId': sessionId, 'itemId': itemId, 'action': action },
        sessionId, itemId, GatewayRequestLanePolicy.REJECT_IF_BUSY));
  }
  static questionCancel(rpcId: string, sessionId: string): GatewayRequest {
    return GatewayRequestFactory.make('question-cancel', 'question-response', { 'rpcId': rpcId, 'sessionId': sessionId },
      sessionId, rpcId, GatewayRequestLanePolicy.REJECT_IF_BUSY);
  }
  static pluginBundleSetEnabled(requestId: string, name: string, enabled: boolean): GatewayRequest {
    return GatewayRequestFactory.make('plugin-bundle-set-enabled', 'plugin-bundle-set-enabled',
      { 'requestId': requestId, 'name': name, 'enabled': enabled }, undefined, requestId, GatewayRequestLanePolicy.FIFO);
  }
  static archiveSession(sessionId: string): GatewayRequest {
    return GatewayRequestFactory.make('session-archive', 'session-archived', { 'sessionId': sessionId }, sessionId);
  }
  static renameSession(sessionId: string, title: string): GatewayRequest {
    return GatewayRequestFactory.make('session-rename', 'session-renamed', { 'sessionId': sessionId, 'title': title.trim() }, sessionId);
  }
  static sessionCancel(sessionId: string): GatewayRequest {
    return GatewayRequestFactory.make('session-cancel', 'session-cancelled', { 'sessionId': sessionId },
      sessionId, undefined, GatewayRequestLanePolicy.REJECT_IF_BUSY);
  }
  static goal(sessionId: string): GatewayRequest { return GatewayRequestFactory.sessionControl('goal', sessionId); }

  /** 标记为非致命超时：网关不回执时只让这次请求失败，不打断连接。 */
  static tolerated(request: GatewayRequest): GatewayRequest {
    request.timeoutIsFatal = false;
    return request;
  }
  static editGoal(sessionId: string, ref: GatewayGoalReference, objective?: string, maxGoalRounds?: number): GatewayRequest {
    const fields: Record<string, Object> = { 'sessionId': sessionId, 'ref': ref };
    if (objective !== undefined && objective.trim().length > 0) fields['objective'] = objective.trim();
    if (maxGoalRounds !== undefined) fields['maxGoalRounds'] = maxGoalRounds;
    // 回执 kind 是 goal-edited（对齐小程序 gateway.js editGoal 的 matchType）
    const request: GatewayRequest = GatewayRequestFactory.make('goal-edit', 'goal-edited', fields, sessionId, undefined,
      GatewayRequestLanePolicy.REJECT_IF_BUSY);
    return GatewayRequestFactory.tolerated(request);
  }
  static goalAction(type: string, sessionId: string, ref: GatewayGoalReference): GatewayRequest {
    if (type !== 'goal-pause' && type !== 'goal-resume' && type !== 'goal-clear') throw new Error('invalid goal action');
    // 回执 kind 是过去式（goal-paused / goal-resumed / goal-cleared），和小程序 responseKinds 一致；
    // 之前这里直接拿 type 当 kind，永远等不到回执，超时后还会把 WebSocket 打断。
    const responseKind: string = type === 'goal-pause' ? 'goal-paused'
      : (type === 'goal-resume' ? 'goal-resumed' : 'goal-cleared');
    const request: GatewayRequest = GatewayRequestFactory.make(type, responseKind, { 'sessionId': sessionId, 'ref': ref },
      sessionId, undefined, GatewayRequestLanePolicy.REJECT_IF_BUSY);
    return GatewayRequestFactory.tolerated(request);
  }
  static slashCommands(sessionId: string, locale?: string): GatewayRequest {
    const fields: Record<string, Object> = { 'sessionId': sessionId };
    if (locale !== undefined && locale.trim().length > 0) fields['locale'] = locale;
    return GatewayRequestFactory.make('commands', 'commands', fields, sessionId);
  }
  static slashCommandOptions(sessionId: string, command: string): GatewayRequest {
    return GatewayRequestFactory.make('command-options', 'command-options', { 'sessionId': sessionId, 'command': command }, sessionId, command);
  }
  static selectSlashCommandOption(sessionId: string, command: string, optionId: string): GatewayRequest {
    return GatewayRequestFactory.make('command-select', 'command-selected',
      { 'sessionId': sessionId, 'command': command, 'optionId': optionId }, sessionId, command, GatewayRequestLanePolicy.REJECT_IF_BUSY);
  }
  static queueEdit(sessionId: string, itemId: string, requestId: string, text: string, textParts?: GatewayTextPart[]): GatewayRequest {
    const fields: Record<string, Object> = { 'sessionId': sessionId, 'itemId': itemId, 'requestId': requestId, 'action': 'edit' };
    if (textParts === undefined) fields['text'] = text;
    else {
      if (textParts.length < 1 || textParts.length > 100) throw new Error('invalid text parts');
      for (const part of textParts) {
        if (part.type !== 'text' && (part.type !== 'quote' || part.text.trim().length === 0)) throw new Error('invalid text part');
      }
      fields['textParts'] = textParts;
    }
    return GatewayRequestFactory.make('queue-update', 'queue-item-updated', fields, sessionId, itemId, GatewayRequestLanePolicy.REJECT_IF_BUSY);
  }
  static sessionControl(type: string, sessionId: string): GatewayRequest {
    // 会话控制/快照类：旧网关可以不回执，超时只让本次请求失败，不能因此重连
    return GatewayRequestFactory.tolerated(GatewayRequestFactory.make(type, type, { 'sessionId': sessionId }, sessionId));
  }
  static selectModel(sessionId: string, provider: string, model: string, reasoningEffort?: string): GatewayRequest {
    const fields: Record<string, Object> = { 'sessionId': sessionId, 'provider': provider, 'model': model };
    if (reasoningEffort !== undefined && reasoningEffort.trim().length > 0) fields['reasoningEffort'] = reasoningEffort;
    return GatewayRequestFactory.make('select-model', 'select-model', fields, sessionId, undefined, GatewayRequestLanePolicy.REJECT_IF_BUSY);
  }
  static setPermission(sessionId: string, name: string): GatewayRequest {
    return GatewayRequestFactory.make('permission', 'permission', { 'sessionId': sessionId, 'name': name },
      sessionId, undefined, GatewayRequestLanePolicy.REJECT_IF_BUSY);
  }
  static fileList(sessionId: string, path: string | undefined, requestId: string): GatewayRequest {
    const fields: Record<string, Object> = { 'sessionId': sessionId, 'requestId': requestId };
    if (path !== undefined && path.trim().length > 0) fields['path'] = path;
    return GatewayRequestFactory.make('file-list', 'file-list', fields, sessionId, requestId);
  }
  static fileDownloadOpen(sessionId: string, path: string, requestId: string): GatewayRequest {
    return GatewayRequestFactory.make('file-download-open', 'file-download-opened',
      { 'sessionId': sessionId, 'path': path, 'requestId': requestId }, sessionId, requestId, GatewayRequestLanePolicy.REJECT_IF_BUSY);
  }
  static fileDownloadRead(transferId: string, offset: number): GatewayRequest {
    return GatewayRequestFactory.make('file-download-read', 'file-download-chunk', { 'transferId': transferId, 'offset': offset },
      undefined, transferId, GatewayRequestLanePolicy.REJECT_IF_BUSY);
  }
  static fileDownloadCancel(transferId: string): GatewayRequest {
    return GatewayRequestFactory.make('file-download-cancel', 'file-download-cancelled', { 'transferId': transferId },
      undefined, transferId, GatewayRequestLanePolicy.REJECT_IF_BUSY);
  }
  static questionAnswer(rpcId: string, sessionId: string, answers: GatewayQuestionAnswer[]): GatewayRequest {
    const encoded: Record<string, Object>[] = [];
    for (const answer of answers) {
      const item: Record<string, Object> = { 'id': answer.id, 'selected': answer.selected };
      if (answer.custom !== undefined && answer.custom.trim().length > 0) item['custom'] = answer.custom.trim();
      encoded.push(item);
    }
    return GatewayRequestFactory.make('question-answer', 'question-response',
      { 'rpcId': rpcId, 'sessionId': sessionId, 'answers': encoded }, sessionId, rpcId, GatewayRequestLanePolicy.REJECT_IF_BUSY);
  }
  static approvalResponse(rpcId: string, sessionId: string, approvalId: string, outcome: string): GatewayRequest {
    if (outcome !== 'allowed-once' && outcome !== 'rejected') throw new Error('invalid approval outcome');
    return GatewayRequestFactory.make('approval-response', 'approval-response',
      { 'rpcId': rpcId, 'sessionId': sessionId, 'approvalId': approvalId, 'outcome': outcome },
      sessionId, rpcId, GatewayRequestLanePolicy.REJECT_IF_BUSY);
  }
  static message(text: string, images: GatewayOutgoingImage[], sessionId: string | undefined,
    workspaceId: string | undefined, clientTimeZone: string, mode: string = 'queue', receipts: string[] = [],
    requestId?: string, textParts?: GatewayTextPart[]): GatewayRequest {
    if (mode !== 'queue' && mode !== 'steer') throw new Error('invalid message mode');
    if (receipts.length > 20 || new Set<string>(receipts).size !== receipts.length ||
      (receipts.length > 0 && (sessionId === undefined || sessionId.trim().length === 0 ||
        requestId === undefined || requestId.trim().length === 0))) throw new Error('invalid receipts');
    const fields: Record<string, Object> = { 'mode': mode, 'clientTimeZone': clientTimeZone };
    if (sessionId !== undefined && sessionId.trim().length > 0) fields['sessionId'] = sessionId;
    else if (workspaceId !== undefined && workspaceId.trim().length > 0) fields['workspaceId'] = workspaceId;
    if (requestId !== undefined) fields['requestId'] = requestId;
    if (receipts.length > 0) {
      const files: Record<string, Object>[] = [];
      for (const receipt of receipts) files.push({ 'receiptId': receipt });
      fields['files'] = files;
    }
    if (textParts === undefined) fields['text'] = text;
    else {
      if (textParts.length < 1 || textParts.length > 100) throw new Error('invalid text parts');
      for (const part of textParts) {
        if (part.type !== 'text' && (part.type !== 'quote' || part.text.trim().length === 0)) throw new Error('invalid text part');
      }
      fields['textParts'] = textParts;
    }
    const encodedImages: Record<string, Object>[] = [];
    for (const image of images) {
      const item: Record<string, Object> = { 'mediaType': image.mediaType, 'data': image.base64Data };
      if (image.name !== undefined && image.name.trim().length > 0) item['name'] = image.name;
      encodedImages.push(item);
    }
    fields['images'] = encodedImages;
    return GatewayRequestFactory.make('message', 'sent', fields, sessionId, requestId, GatewayRequestLanePolicy.REJECT_IF_BUSY);
  }
  private static management(type: string, requestId: string, fields: Record<string, Object>, mutation: boolean = false): GatewayRequest {
    if (requestId.trim().length === 0 || requestId.length > 128) throw new Error('invalid request id');
    fields['requestId'] = requestId;
    return GatewayRequestFactory.make(type, type, fields, undefined, requestId,
      mutation ? GatewayRequestLanePolicy.REJECT_IF_BUSY : GatewayRequestLanePolicy.COALESCE_LATEST);
  }
  static hostScheduleList(requestId: string, active?: boolean, limit: number = 100, offset: number = 0): GatewayRequest {
    if (!Number.isInteger(limit) || limit < 1 || limit > 500 || !Number.isInteger(offset) || offset < 0) throw new Error('invalid pagination');
    const fields: Record<string, Object> = { 'limit': limit, 'offset': offset };
    if (active !== undefined) fields['active'] = active;
    return GatewayRequestFactory.management('schedule-list', requestId, fields);
  }
  static scheduleView(requestId: string, id: string): GatewayRequest {
    return GatewayRequestFactory.management('schedule-view', requestId, { 'id': id });
  }
  static scheduleCreate(requestId: string, title: string, prompt: string, timing: Object, target?: Object): GatewayRequest {
    if (title.trim().length < 1 || title.trim().length > 120 || prompt.trim().length === 0) throw new Error('invalid schedule');
    const fields: Record<string, Object> = { 'title': title.trim(), 'prompt': prompt, 'timing': timing };
    if (target !== undefined) fields['target'] = target;
    return GatewayRequestFactory.management('schedule-create', requestId, fields, true);
  }
  static scheduleEdit(requestId: string, id: string, expectedUpdatedAt: Object | null,
    patch?: Record<string, Object>, deleteTask: boolean = false): GatewayRequest {
    if (!deleteTask && (patch === undefined || Object.keys(patch).length === 0)) throw new Error('empty schedule patch');
    const fields: Record<string, Object | null> = { 'id': id, 'action': deleteTask ? 'delete' : 'update', 'expectedUpdatedAt': expectedUpdatedAt };
    if (!deleteTask && patch !== undefined) fields['patch'] = patch;
    return GatewayRequestFactory.management('schedule-edit', requestId, fields as Record<string, Object>, true);
  }
  static hostScheduleHistory(requestId: string, id: string, limit: number = 100, before?: string): GatewayRequest {
    const fields: Record<string, Object> = { 'id': id, 'limit': limit };
    if (before !== undefined) fields['before'] = before;
    return GatewayRequestFactory.management('schedule-history', requestId, fields);
  }
  static scheduleRun(requestId: string, id: string): GatewayRequest {
    return GatewayRequestFactory.management('schedule-run', requestId, { 'id': id }, true);
  }
  static scheduleDeleteInactive(requestId: string, confirmed: boolean): GatewayRequest {
    if (!confirmed) throw new Error('confirmation required');
    return GatewayRequestFactory.management('schedule-delete-inactive', requestId, { 'confirm': true }, true);
  }
  static scheduleCatalog(): GatewayRequest { return GatewayRequestFactory.simple('schedule-catalog'); }

  /** 可配置的模型提供商列表（对齐小程序 requestProviders） */
  static providers(): GatewayRequest { return GatewayRequestFactory.simple('providers'); }

  /** 读取 llm 插件命名空间设置（对齐小程序 requestPlugin('plugin-settings')） */
  static pluginSettings(ns: string, requestId: string): GatewayRequest {
    return GatewayRequestFactory.make('plugin-settings', 'plugin-settings', { 'ns': ns, 'requestId': requestId }, undefined, undefined, GatewayRequestLanePolicy.REJECT_IF_BUSY);
  }

  /** 自动获取提供商可用模型（对齐小程序 requestPlugin('llm-discover-models')） */
  static modelDiscover(ns: string, provider: string, baseURL: string, api: string, apiKey: string, requestId: string): GatewayRequest {
    const fields: Record<string, Object> = { 'ns': ns, 'provider': provider, 'requestId': requestId };
    if (baseURL.length > 0) fields['baseURL'] = baseURL;
    if (api.length > 0) fields['api'] = api;
    if (apiKey.length > 0) fields['apiKey'] = apiKey;
    return GatewayRequestFactory.make('llm-discover-models', 'llm-discover-models', fields, undefined, requestId,
      GatewayRequestLanePolicy.REJECT_IF_BUSY, 30000);
  }

  /** 按 ops 路径操作变更 llm 命名空间（模型增删改，对齐小程序 plugin-settings-mutate） */
  static pluginSettingsMutate(ns: string, expectedRevision: number, ops: Object[], requestId: string): GatewayRequest {
    return GatewayRequestFactory.make('plugin-settings-mutate', 'plugin-settings-mutated',
      { 'ns': ns, 'expectedRevision': expectedRevision, 'ops': ops, 'requestId': requestId },
      undefined, undefined, GatewayRequestLanePolicy.REJECT_IF_BUSY);
  }
  static scheduleList(sessionId: string): GatewayRequest { return GatewayRequestFactory.sessionControl('schedule-list', sessionId); }
  static scheduleHistory(sessionId: string, id: string, limit: number = 100, before?: string): GatewayRequest {
    const fields: Record<string, Object> = { 'sessionId': sessionId, 'id': id, 'limit': limit };
    if (before !== undefined) fields['before'] = before;
    return GatewayRequestFactory.make('schedule-history', 'schedule-history', fields, sessionId);
  }
  static scheduleUpdate(sessionId: string, id: string, expected: Object, title?: string, prompt?: string,
    change?: Object, requestId?: string): GatewayRequest {
    const fields: Record<string, Object> = { 'sessionId': sessionId, 'id': id, 'expected': expected };
    if (title !== undefined) fields['title'] = title;
    if (prompt !== undefined) fields['prompt'] = prompt;
    if (change !== undefined) fields['change'] = change;
    if (requestId !== undefined) fields['requestId'] = requestId;
    return GatewayRequestFactory.make('schedule-update', 'schedule-update', fields, sessionId, requestId,
      GatewayRequestLanePolicy.REJECT_IF_BUSY);
  }
  static scheduleDelete(sessionId: string, id: string, requestId?: string): GatewayRequest {
    const fields: Record<string, Object> = { 'sessionId': sessionId, 'id': id };
    if (requestId !== undefined) fields['requestId'] = requestId;
    return GatewayRequestFactory.make('schedule-delete', 'schedule-delete', fields, sessionId, requestId,
      GatewayRequestLanePolicy.REJECT_IF_BUSY);
  }
  static pluginVersions(requestId: string, name: string): GatewayRequest {
    return GatewayRequestFactory.management('plugin-versions', requestId, { 'name': name });
  }
  static pluginDetail(requestId: string, name: string, language: string): GatewayRequest {
    return GatewayRequestFactory.management('plugin-detail', requestId, { 'name': name, 'language': language });
  }
  static pluginCatalog(requestId: string): GatewayRequest {
    return GatewayRequestFactory.make('plugin-catalog', 'plugin-catalog', { 'requestId': requestId }, undefined, requestId);
  }
  static pluginEntrySetEnabled(requestId: string, entryId: string, enabled: boolean): GatewayRequest {
    return GatewayRequestFactory.make('plugin-entry-set-enabled', 'plugin-entry-set-enabled',
      { 'requestId': requestId, 'entryId': entryId, 'enabled': enabled }, undefined, requestId, GatewayRequestLanePolicy.FIFO);
  }
  /** 安装前检查（对齐小程序 plugin-inspect → plugin-inspection） */
  static pluginInspect(requestId: string, spec: string, registry?: string): GatewayRequest {
    const fields: Record<string, Object | null> = { 'requestId': requestId, 'spec': spec, 'registry': registry ?? null };
    return GatewayRequestFactory.make('plugin-inspect', 'plugin-inspection', fields as Record<string, Object>, undefined, requestId,
      GatewayRequestLanePolicy.REJECT_IF_BUSY, 60000);
  }

  /** 安装插件（对齐小程序 plugin-install → plugin-install-result） */
  static pluginInstall(requestId: string, spec: string, registry: string | null, enable: boolean): GatewayRequest {
    const fields: Record<string, Object | null> = { 'requestId': requestId, 'spec': spec, 'registry': registry ?? null, 'enable': enable };
    return GatewayRequestFactory.make('plugin-install', 'plugin-install-result', fields as Record<string, Object>, undefined, requestId,
      GatewayRequestLanePolicy.REJECT_IF_BUSY, 600000);
  }

  /** 安装状态查询（对齐小程序 plugin-install-status） */
  static pluginInstallStatus(requestId: string, installId: string): GatewayRequest {
    return GatewayRequestFactory.make('plugin-install-status', 'plugin-install-result',
      { 'requestId': requestId, 'installId': installId }, undefined, requestId,
      GatewayRequestLanePolicy.REJECT_IF_BUSY, 600000);
  }

  /** 取消安装（对齐小程序 plugin-install-cancel） */
  static pluginInstallCancel(requestId: string, installId: string): GatewayRequest {
    return GatewayRequestFactory.make('plugin-install-cancel', 'plugin-install-result',
      { 'requestId': requestId, 'installId': installId }, undefined, requestId,
      GatewayRequestLanePolicy.REJECT_IF_BUSY, 60000);
  }

  /** 读取凭据状态（对齐小程序 plugin-credential-describe） */
  static pluginCredentialDescribe(requestId: string, ref: string): GatewayRequest {
    return GatewayRequestFactory.management('plugin-credential-describe', requestId, { 'ref': ref });
  }

  /** 写入凭据（对齐小程序 plugin-credential-set） */
  static pluginCredentialSet(requestId: string, ref: string, secret: string): GatewayRequest {
    return GatewayRequestFactory.management('plugin-credential-set', requestId, { 'ref': ref, 'secret': secret }, true);
  }

  /** 卸载（新网关 plugin-remove，旧网关回退 plugin-uninstall） */
  static pluginRemove(requestId: string, name: string): GatewayRequest {
    return GatewayRequestFactory.make('plugin-remove', 'plugin-removed', { 'requestId': requestId, 'name': name }, undefined, requestId,
      GatewayRequestLanePolicy.REJECT_IF_BUSY, 120000);
  }

  static pluginUninstall(requestId: string, name: string): GatewayRequest {
    return GatewayRequestFactory.make('plugin-uninstall', 'plugin-uninstall-result', { 'requestId': requestId, 'name': name }, undefined, requestId,
      GatewayRequestLanePolicy.REJECT_IF_BUSY, 120000);
  }

  /** 插件市场索引源（对齐小程序 plugin-market-indexes） */
  static pluginMarketIndexes(requestId: string): GatewayRequest {
    return GatewayRequestFactory.management('plugin-market-indexes', requestId, {});
  }

  /** 插件市场搜索（对齐小程序 plugin-market-search） */
  static pluginMarketSearch(requestId: string, indexUrl: string, query: string, category: string,
    cursor: string, limit: number): GatewayRequest {
    const fields: Record<string, Object> = {
      'indexUrl': indexUrl, 'query': query, 'category': category, 'cursor': cursor, 'limit': limit
    };
    return GatewayRequestFactory.management('plugin-market-search', requestId, fields);
  }

  /** 写入索引源列表（对齐小程序 plugin-market-set-indexes） */
  static pluginMarketSetIndexes(requestId: string, indexes: Object[]): GatewayRequest {
    return GatewayRequestFactory.management('plugin-market-set-indexes', requestId, { 'indexes': indexes }, true);
  }

  static pluginUpdate(requestId: string, name: string, version: string, registry?: string): GatewayRequest {
    if (requestId.trim().length === 0 || requestId.length > 128) throw new Error('invalid request id');
    const fields: Record<string, Object | null> = { 'requestId': requestId, 'name': name, 'version': version, 'registry': registry ?? null };
    return GatewayRequestFactory.make('plugin-update', 'plugin-update-result', fields as Record<string, Object>, undefined, requestId,
      GatewayRequestLanePolicy.REJECT_IF_BUSY, 600000);
  }
}
