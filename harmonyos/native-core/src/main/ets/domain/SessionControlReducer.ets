import { GatewayAgentPreset, GatewayContextSnapshot, GatewayModelCatalog, GatewayModelGroup, GatewayModelSelection,
  GatewayPermissionOption, GatewaySessionPermissions, GatewaySessionStatsSnapshot, GatewayTokenUsage,
  GatewayContextPressure, GatewayContextBreakdown, GatewaySessionStats, GatewaySessionTokenUsageTotals } from '../protocol/GatewayDtos';

export interface SessionControlRequestTarget { kind: string; isDefault: boolean; sessionId?: string; provider?: string; model?: string; reasoningEffort?: string; target?: string; value?: string; }
export interface SessionControlState {
  modelCatalogs: Map<string, GatewayModelCatalog>; globalModelCatalog: GatewayModelCatalog | null;
  sessionPermissions: Map<string, GatewaySessionPermissions>; contextSnapshots: Map<string, GatewayContextSnapshot>;
  sessionStatsSnapshots: Map<string, GatewaySessionStatsSnapshot>; agentPresets: GatewayAgentPreset[];
  agentPresetsAuthorable: boolean; agentPresetsHasDocument: boolean; agentPresetDefault: string | null;
  permissionDefault: string | null; permissionDefaultOptions: GatewayPermissionOption[]; defaultModelSelection: GatewayModelSelection | null;
  loadingKinds: Set<string>; defaultConfigurationLoadingKinds: Set<string>; pendingModelsSessionId: string | null;
  isPendingGlobalModelsRequest: boolean; pendingModelSelectionSessionId: string | null; pendingPermissionOptionsSessionId: string | null;
  requestTokens: Map<string, string>; activeRequestTargets: Map<string, SessionControlRequestTarget>;
  queuedRequestTargets: Map<string, SessionControlRequestTarget>; previousCompletedRequestTargets: Map<string, SessionControlRequestTarget>;
  explicitSessionRequiredKinds: Set<string>; drainingRequestKinds: Set<string>; quarantinedRequestKinds: Set<string>;
}
export interface SessionControlAction {
  kind: string; requestKind?: string; token?: string; sessionId?: string | null; presets?: GatewayAgentPreset[];
  authorable?: boolean; hasDocument?: boolean; agentPreset?: string | null; permission?: string | null;
  permissionOptions?: GatewayPermissionOption[]; selection?: GatewayModelSelection | null; target?: string; value?: string;
  current?: GatewayModelSelection; routable?: boolean; groups?: GatewayModelGroup[]; isGlobalRequest?: boolean;
  permissions?: GatewaySessionPermissions; asOfSequence?: number; tokenUsage?: GatewayTokenUsage;
  pressure?: GatewayContextPressure; breakdown?: GatewayContextBreakdown; stats?: GatewaySessionStats;
  tokenUsageTotals?: GatewaySessionTokenUsageTotals; contextPressure?: GatewayContextPressure;
}
export class SessionControlReducer {
  static initial(): SessionControlState { return {
    modelCatalogs: new Map(), globalModelCatalog: null, sessionPermissions: new Map(), contextSnapshots: new Map(),
    sessionStatsSnapshots: new Map(), agentPresets: [], agentPresetsAuthorable: false, agentPresetsHasDocument: false,
    agentPresetDefault: null, permissionDefault: null, permissionDefaultOptions: [], defaultModelSelection: null,
    loadingKinds: new Set(), defaultConfigurationLoadingKinds: new Set(), pendingModelsSessionId: null,
    isPendingGlobalModelsRequest: false, pendingModelSelectionSessionId: null, pendingPermissionOptionsSessionId: null,
    requestTokens: new Map(), activeRequestTargets: new Map(), queuedRequestTargets: new Map(), previousCompletedRequestTargets: new Map(),
    explicitSessionRequiredKinds: new Set(), drainingRequestKinds: new Set(), quarantinedRequestKinds: new Set()
  }; }
  static reduce(state: SessionControlState, a: SessionControlAction): SessionControlState {
    const s: SessionControlState = { modelCatalogs: new Map(state.modelCatalogs), globalModelCatalog: state.globalModelCatalog,
      sessionPermissions: new Map(state.sessionPermissions), contextSnapshots: new Map(state.contextSnapshots),
      sessionStatsSnapshots: new Map(state.sessionStatsSnapshots), agentPresets: state.agentPresets,
      agentPresetsAuthorable: state.agentPresetsAuthorable, agentPresetsHasDocument: state.agentPresetsHasDocument,
      agentPresetDefault: state.agentPresetDefault, permissionDefault: state.permissionDefault,
      permissionDefaultOptions: state.permissionDefaultOptions, defaultModelSelection: state.defaultModelSelection,
      loadingKinds: new Set(state.loadingKinds), defaultConfigurationLoadingKinds: new Set(state.defaultConfigurationLoadingKinds),
      pendingModelsSessionId: state.pendingModelsSessionId, isPendingGlobalModelsRequest: state.isPendingGlobalModelsRequest,
      pendingModelSelectionSessionId: state.pendingModelSelectionSessionId, pendingPermissionOptionsSessionId: state.pendingPermissionOptionsSessionId,
      requestTokens: new Map(state.requestTokens), activeRequestTargets: state.activeRequestTargets,
      queuedRequestTargets: state.queuedRequestTargets, previousCompletedRequestTargets: state.previousCompletedRequestTargets,
      explicitSessionRequiredKinds: state.explicitSessionRequiredKinds, drainingRequestKinds: state.drainingRequestKinds,
      quarantinedRequestKinds: state.quarantinedRequestKinds };
    const id = a.sessionId ?? ''; const kind = a.requestKind ?? '';
    switch (a.kind) {
      case 'AgentPresetsReceived':
        if (a.presets === undefined || a.authorable === undefined || a.hasDocument === undefined) throw new Error('invalid action');
        s.agentPresets = a.presets; s.agentPresetsAuthorable = a.authorable; s.agentPresetsHasDocument = a.hasDocument;
        if (s.agentPresetDefault === null) { const preset = a.presets.find((x: GatewayAgentPreset) => x.isDefault); s.agentPresetDefault = preset?.id ?? null; } break;
      case 'DefaultsReceived': s.agentPresetDefault = a.agentPreset ?? null; s.permissionDefault = a.permission ?? null; s.permissionDefaultOptions = a.permissionOptions ?? []; break;
      case 'DefaultModelReceived': s.defaultModelSelection = a.selection ?? null; break;
      case 'GlobalDefaultApplied':
        if (a.value === undefined) throw new Error('invalid action');
        if (a.target === 'agent-preset') s.agentPresetDefault = a.value; else if (a.target === 'permission') s.permissionDefault = a.value; break;
      case 'ModelsReceived':
        if (a.groups === undefined || a.routable === undefined) throw new Error('invalid action');
        if (id.length > 0) s.modelCatalogs.set(id, { current: a.current, routable: a.routable, groups: a.groups });
        else if (a.isGlobalRequest === true) s.globalModelCatalog = { routable: false, groups: a.groups }; break;
      case 'ModelSelected': {
        if (id.length === 0 || a.selection === undefined || a.selection === null) throw new Error('invalid action');
        const old = s.modelCatalogs.get(id) ?? { routable: true, groups: [] } as GatewayModelCatalog;
        s.modelCatalogs.set(id, { current: a.selection, routable: old.routable, groups: old.groups }); break;
      }
      case 'PermissionsReceived': {
        if (id.length === 0 || a.permissions === undefined) throw new Error('invalid action');
        const old = s.sessionPermissions.get(id); s.sessionPermissions.set(id, { options: a.permissions.options ?? old?.options, currentValue: a.permissions.currentValue, preset: a.permissions.preset, sandbox: a.permissions.sandbox, approval: a.permissions.approval }); break;
      }
      case 'PermissionSelected': {
        if (id.length === 0 || a.value === undefined) throw new Error('invalid action');
        const old = s.sessionPermissions.get(id) ?? {} as GatewaySessionPermissions;
        s.sessionPermissions.set(id, { options: old.options, currentValue: a.value, preset: a.value, sandbox: old.sandbox, approval: old.approval }); break;
      }
      case 'ContextReceived': {
        if (id.length === 0) throw new Error('invalid action');
        const old = s.contextSnapshots.get(id) ?? {} as GatewayContextSnapshot;
        s.contextSnapshots.set(id, { asOfSeq: a.asOfSequence ?? old.asOfSeq, tokenUsage: a.tokenUsage ?? old.tokenUsage,
          pressure: a.pressure ?? old.pressure, breakdown: a.breakdown ?? old.breakdown }); break;
      }
      case 'StatsReceived': {
        if (id.length === 0) throw new Error('invalid action');
        const old = s.sessionStatsSnapshots.get(id) ?? {} as GatewaySessionStatsSnapshot;
        s.sessionStatsSnapshots.set(id, { asOfSeq: a.asOfSequence ?? old.asOfSeq, stats: a.stats ?? old.stats,
          tokenUsage: a.tokenUsageTotals !== undefined ? { totals: a.tokenUsageTotals } : old.tokenUsage,
          contextPressure: a.contextPressure ?? old.contextPressure }); break;
      }
      case 'RequestStarted': case 'DefaultRequestStarted':
        if (kind.length === 0) throw new Error('invalid action');
        (a.kind === 'RequestStarted' ? s.loadingKinds : s.defaultConfigurationLoadingKinds).add(kind);
        if (a.token !== undefined) s.requestTokens.set(kind, a.token); break;
      case 'RequestFinished': case 'RequestTimedOut': case 'DefaultRequestFinished': case 'DefaultRequestTimedOut':
        if (kind.length === 0) throw new Error('invalid action');
        if (a.kind === 'RequestFinished' || a.kind === 'RequestTimedOut') {
          s.loadingKinds.delete(kind); if (kind === 'models') { s.pendingModelsSessionId = null; s.isPendingGlobalModelsRequest = false; }
        } else s.defaultConfigurationLoadingKinds.delete(kind);
        s.requestTokens.delete(kind); break;
      case 'ModelsRequestTargeted': s.pendingModelsSessionId = a.sessionId ?? null; s.isPendingGlobalModelsRequest = a.sessionId == null; break;
      case 'ModelSelectionTargeted': if (id.length === 0) throw new Error('invalid action'); s.pendingModelSelectionSessionId = id; break;
      case 'ModelSelectionResolved': s.pendingModelSelectionSessionId = null; break;
      case 'PermissionOptionsTargeted': if (id.length === 0) throw new Error('invalid action'); s.pendingPermissionOptionsSessionId = id; break;
      case 'PermissionOptionsResolved': s.pendingPermissionOptionsSessionId = null; break;
      default: throw new Error('invalid session control action');
    }
    return s;
  }
}
