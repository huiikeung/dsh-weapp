export const WORKSPACE_CHANGES_TYPES = new Set(['workspace-changes-summary', 'workspace-changes-diff'])

export async function handleWorkspaceChanges(api, msg) {
  const requestId = typeof msg.requestId === 'string' ? msg.requestId : undefined
  const failure = (code, message) => ({ kind: 'error', requestType: msg.type, requestId, code, message })
  if (!requestId || requestId.length > 128 || typeof msg.sessionId !== 'string' || !msg.sessionId.trim() ||
    msg.sessionId.length > 512 || !Number.isSafeInteger(msg.seq) || msg.seq < 0 ||
    (msg.type === 'workspace-changes-diff' && (!Number.isSafeInteger(msg.index) || msg.index < 0))) {
    return failure('bad-request', 'Invalid workspace change coordinates')
  }
  const service = api.workspaceChanges
  if (!service) return failure('workspace-changes-unavailable', 'Workspace changes are unavailable on this host')
  try {
    const summary = service.summary(msg.sessionId, msg.seq)
    let value = null
    if (summary) {
      if (msg.type === 'workspace-changes-summary') {
        // Do not expose host working directories or internal snapshot locations.
        const { turn, total, added, deleted } = summary
        value = { turn, total, added, deleted, files: summary.files.map(file => ({
          path: file.path, display: file.display, added: file.added, deleted: file.deleted,
          ...(file.binary === true ? { binary: true } : {}),
          ...(file.oversized === true ? { oversized: true } : {})
        })) }
      } else if (msg.index < summary.files.length) {
        value = await service.diff(msg.sessionId, msg.seq, msg.index, AbortSignal.timeout(15000)) ?? null
      }
    }
    return { kind: msg.type, requestId, sessionId: msg.sessionId, seq: msg.seq,
      ...(msg.type === 'workspace-changes-diff' ? { index: msg.index } : {}), value }
  } catch (_) { return failure('workspace-changes-failed', 'Unable to read workspace change snapshot') }
}
