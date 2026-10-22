/**
 * 每轮 token 用量：移植 DSH @deepseek-ai/dsh-token-meter 与
 * dsh-client-ui-chat 的 deriveTurnTokenUsage 折叠算法（精确尝试生命周期）。
 * 输入为原始会话事件（含 turn/start、step/start、assistant/attempt、
 * assistant/message、llm/retry*、step/end、turn/end），输出单轮用量或 null。
 */

function isCount(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function safeSum(values) {
  let total = 0;
  for (let i = 0; i < values.length; i += 1) {
    total += values[i];
    if (!Number.isSafeInteger(total)) return undefined;
  }
  return total;
}

/** 流式 chunk 中最后一个 usage 样本。 */
function streamUsage(stream) {
  if (!Array.isArray(stream)) return undefined;
  for (let i = stream.length - 1; i >= 0; i -= 1) {
    const chunk = stream[i];
    if (chunk && chunk.usage && typeof chunk.usage === 'object') return chunk.usage;
  }
  return undefined;
}

function messageRoute(message) {
  const source = message && message.source;
  if (!source) return undefined;
  const provider = typeof source.provider === 'string' ? source.provider : '';
  const model = typeof source.model === 'string' ? source.model : '';
  return provider.length > 0 && model.length > 0 ? { provider, model } : undefined;
}

function normalizeUsage(usage, route) {
  if (!usage || typeof usage !== 'object') return undefined;
  const inputTokens = usage.inputTokens;
  const outputTokens = usage.outputTokens;
  const cacheReadTokens = usage.cacheReadTokens;
  const cacheWriteTokens = usage.cacheWriteTokens;
  const reasoningTokens = usage.reasoningTokens;
  const totalTokens = usage.totalTokens;
  if (!isCount(inputTokens) || !isCount(outputTokens)) return undefined;
  if (cacheReadTokens !== undefined && !isCount(cacheReadTokens)) return undefined;
  if (cacheWriteTokens !== undefined && !isCount(cacheWriteTokens)) return undefined;
  if (reasoningTokens !== undefined && (!isCount(reasoningTokens) || reasoningTokens > outputTokens)) return undefined;
  const knownPrompt = safeSum([
    inputTokens,
    ...(cacheReadTokens === undefined ? [] : [cacheReadTokens]),
    ...(cacheWriteTokens === undefined ? [] : [cacheWriteTokens])
  ]);
  if (knownPrompt === undefined) return undefined;
  let exactTotal;
  if (totalTokens !== undefined) {
    if (!isCount(totalTokens)) return undefined;
    const exactPrompt = totalTokens - outputTokens;
    if (!isCount(exactPrompt) || exactPrompt < knownPrompt) return undefined;
    if (cacheReadTokens !== undefined && cacheWriteTokens !== undefined && exactPrompt !== knownPrompt) return undefined;
    exactTotal = totalTokens;
  } else {
    if (cacheReadTokens === undefined || cacheWriteTokens === undefined) return undefined;
    const derivedTotal = safeSum([knownPrompt, outputTokens]);
    if (derivedTotal === undefined) return undefined;
    exactTotal = derivedTotal;
  }
  return {
    inputTokens,
    outputTokens,
    totalTokens: exactTotal,
    ...(cacheReadTokens === undefined ? {} : { cacheReadTokens }),
    ...(cacheWriteTokens === undefined ? {} : { cacheWriteTokens }),
    ...(reasoningTokens === undefined ? {} : { reasoningTokens }),
    ...(route === undefined ? {} : { route })
  };
}

function aggregateAttempts(attempts) {
  if (!attempts.length) return null;
  const inputTokens = safeSum(attempts.map((item) => item.inputTokens));
  const outputTokens = safeSum(attempts.map((item) => item.outputTokens));
  const totalTokens = safeSum(attempts.map((item) => item.totalTokens));
  if (inputTokens === undefined || outputTokens === undefined || totalTokens === undefined) return null;
  const cacheRead = attempts.map((item) => item.cacheReadTokens);
  const cacheWrite = attempts.map((item) => item.cacheWriteTokens);
  const reasoning = attempts.map((item) => item.reasoningTokens);
  const cacheReadTokens = cacheRead.every(isCount) ? safeSum(cacheRead) : undefined;
  const cacheWriteTokens = cacheWrite.every(isCount) ? safeSum(cacheWrite) : undefined;
  const reasoningTokens = reasoning.every(isCount) ? safeSum(reasoning) : undefined;
  let routes;
  const attributed = attempts.map((item) => item.route);
  if (attributed.every((route) => route !== undefined)) {
    const unique = new Map();
    attributed.forEach((route) => unique.set(route.provider + '\u0000' + route.model, route));
    routes = Array.from(unique.values());
  }
  return {
    uncachedInputTokens: inputTokens,
    outputTokens,
    totalTokens,
    ...(cacheReadTokens === undefined ? {} : { cacheReadTokens }),
    ...(cacheWriteTokens === undefined ? {} : { cacheWriteTokens }),
    ...(reasoningTokens === undefined ? {} : { reasoningTokens }),
    ...(routes === undefined ? {} : { routes })
  };
}

function sameAttempt(state, turn, step) {
  return state.turn === turn && state.step === step;
}

/**
 * 单轮精确用量。事件必须是同一轮的持久事件（turn/start … turn/end）。
 * 任一边界缺失、用量不完整或口径矛盾都返回 null（与 DSH 一致）。
 */
function derive(events) {
  let state = { kind: 'idle' };
  const attempts = [];
  let turn;
  let sawEnd = false;
  let invalid = false;
  const closeOpen = (route) => {
    if (state.kind !== 'open' || state.sample === undefined) return false;
    const normalized = normalizeUsage(state.sample, route);
    if (normalized === undefined) return false;
    attempts.push(normalized);
    return true;
  };
  for (let i = 0; i < events.length; i += 1) {
    if (invalid) break;
    const event = events[i];
    const data = event.data || {};
    if (event.type === 'turn/start') {
      if (turn !== undefined || state.kind !== 'idle') invalid = true;
      else turn = data.turn;
      continue;
    }
    if (turn === undefined) { invalid = true; break; }
    if (event.type === 'turn/end') {
      if (data.turn !== turn || state.kind !== 'idle' || sawEnd) invalid = true;
      else sawEnd = true;
      continue;
    }
    if (sawEnd) { invalid = true; break; }
    if (event.type === 'step/start') {
      if (data.turn !== turn || state.kind !== 'idle') invalid = true;
      else state = { kind: 'open', turn, step: data.step };
      continue;
    }
    if (event.type === 'llm/retry-started') {
      if (data.turn !== turn || state.kind !== 'settled' || state.by !== 'retry' || !sameAttempt(state, data.turn, data.step)) invalid = true;
      else state = { kind: 'open', turn, step: data.step };
      continue;
    }
    if (event.type === 'assistant/attempt') {
      if (data.turn !== turn || state.kind !== 'open' || !sameAttempt(state, data.turn, data.step)) { invalid = true; continue; }
      const sample = streamUsage(data.stream) !== undefined ? streamUsage(data.stream) : state.sample;
      state = { kind: 'open', turn, step: data.step };
      if (sample !== undefined) state.sample = sample;
      if (!closeOpen()) invalid = true;
      else state = { kind: 'finishClosed', turn, step: data.step };
      continue;
    }
    if (event.type === 'assistant/message') {
      if (data.turn !== turn || state.kind !== 'open' || !sameAttempt(state, data.turn, data.step)) { invalid = true; continue; }
      const sample = data.usage !== undefined ? data.usage : streamUsage(data.stream);
      if (sample !== undefined) state.sample = sample;
      if (!closeOpen(messageRoute(data.message))) invalid = true;
      else state = { kind: 'settled', turn, step: data.step, by: 'message' };
      continue;
    }
    if (event.type === 'llm/retry') {
      if (data.turn !== turn || state.kind === 'idle' || !sameAttempt(state, data.turn, data.step)) { invalid = true; continue; }
      if (state.kind === 'settled' || (state.kind === 'open' && !closeOpen())) invalid = true;
      if (!invalid) state = { kind: 'settled', turn, step: data.step, by: 'retry' };
      continue;
    }
    if (event.type === 'step/end') {
      if (data.turn !== turn || state.kind === 'idle' || !sameAttempt(state, data.turn, data.step)) { invalid = true; continue; }
      if (state.kind === 'open' && !closeOpen()) invalid = true;
      if (!invalid) state = { kind: 'idle' };
    }
  }
  if (invalid || !sawEnd || state.kind !== 'idle') return null;
  return aggregateAttempts(attempts);
}

/** 按 turn 分组折叠（事件需按 seq 升序）。返回 { [turn]: usage }。 */
function deriveAll(events) {
  const result = {};
  const list = Array.isArray(events) ? events : [];
  let bucket = null;
  let turn;
  for (let i = 0; i < list.length; i += 1) {
    const event = list[i];
    if (!event || !event.type) continue;
    if (event.type === 'turn/start') {
      turn = event.data && event.data.turn;
      bucket = [event];
      continue;
    }
    if (!bucket) continue;
    bucket.push(event);
    if (event.type === 'turn/end') {
      const usage = derive(bucket);
      if (usage && turn !== undefined) result[turn] = usage;
      bucket = null;
      turn = undefined;
    }
  }
  return result;
}

function compact(value) {
  const n = Number(value) || 0;
  if (n >= 1000000) return (n / 1000000).toFixed(n % 1000000 === 0 ? 0 : 1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(n % 1000 === 0 ? 0 : 1) + 'K';
  return String(Math.round(n));
}

function exact(value) {
  const n = Math.round(Number(value) || 0);
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** 缓存命中率：cacheRead / (totalTokens - outputTokens)。 */
function cacheHit(usage) {
  if (!usage || usage.cacheReadTokens === undefined || !usage.totalTokens) return null;
  const base = usage.totalTokens - usage.outputTokens;
  if (!(base > 0)) return null;
  return Math.round(Math.min(1, Math.max(0, usage.cacheReadTokens / base)) * 10000) / 100;
}

module.exports = { derive, deriveAll, compact, exact, cacheHit, normalizeUsage };
