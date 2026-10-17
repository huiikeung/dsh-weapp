/**
 * DSH Mobile conversation presentation layer.
 *
 * Protocol projection remains responsible for turning gateway events into
 * semantic rows. This module mirrors dsh-mobile's ConversationDisplayEntry /
 * ConversationProcessGroup layer: consecutive context, reasoning, tool and
 * status rows become one stable expandable process group; user, assistant and
 * system messages remain first-class timeline entries.
 */

function compactText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function preview(value, limit) {
  const text = compactText(value);
  const max = limit || 72;
  return text.length > max ? text.slice(0, max) + '…' : text;
}

function durationLabel(ms) {
  const seconds = Math.max(0, Math.round(Number(ms || 0) / 1000));
  if (seconds >= 60) return Math.floor(seconds / 60) + ' 分钟 ' + (seconds % 60) + ' 秒';
  return seconds + ' 秒';
}

function isProcessRow(row) {
  return !!row && ['context', 'reasoning', 'tool', 'toolResult', 'status'].indexOf(row.kind) >= 0;
}

function normalizeTools(row) {
  if (!row) return [];
  if (Array.isArray(row.tools)) return row.tools;
  if (row.kind === 'tool' || row.kind === 'toolResult') return [row];
  return [];
}

function processFacts(items) {
  const contexts = [];
  const reasoning = [];
  const tools = [];
  const toolByCallId = {};
  let command = null;

  items.forEach((item) => {
    if (item.kind === 'status' && !command) {
      command = item;
      return;
    }
    if (item.kind === 'context') {
      contexts.push(item);
      return;
    }
    if (item.kind === 'reasoning') {
      reasoning.push(item);
    }
    normalizeTools(item).forEach((tool) => {
      const callId = tool.callId || tool.key || ('tool-' + tools.length);
      if (toolByCallId[callId]) {
        Object.assign(toolByCallId[callId], tool);
      } else {
        const copy = Object.assign({}, tool, { callId: callId });
        toolByCallId[callId] = copy;
        tools.push(copy);
      }
    });
  });

  return { command: command, contexts: contexts, reasoning: reasoning, tools: tools };
}

function runningStepTitle(items) {
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const item = items[i];
    if (item.kind === 'status') {
      const status = compactText(item.text);
      if (/压缩/.test(status)) return '正在压缩上下文';
      if (/失败/.test(status)) return '命令执行失败';
      if (/完成/.test(status)) return '命令已完成';
      return '正在执行命令';
    }

    const tools = normalizeTools(item);
    const activeTool = tools.slice().reverse().find((tool) => tool.status !== 'done' && tool.status !== 'error');
    if (activeTool) {
      const name = String(activeTool.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      if (['bash', 'pwsh', 'shell', 'exec', 'terminal', 'run_code'].indexOf(name) >= 0) return '正在执行命令';
      if (['read', 'readfile', 'webfetch'].indexOf(name) >= 0) return '正在读取内容';
      if (['grep', 'search', 'glob', 'find', 'websearch'].indexOf(name) >= 0) return '正在搜索';
      if (['write', 'writefile', 'edit', 'editfile', 'applypatch'].indexOf(name) >= 0) return '正在修改内容';
      return name ? '正在执行 ' + name : '正在执行工具';
    }
    if (tools.length || item.kind === 'toolResult') return '正在整理工具结果';
    if (item.kind === 'context') return '正在整理上下文';
    if (item.kind === 'reasoning') return '正在推理';
  }
  return '正在思考';
}

function processTitle(items, facts, meta) {
  if (facts.command) {
    if (meta.running && meta.isTail) return runningStepTitle(items);
    const commandPreview = preview(facts.command.text, 54);
    return commandPreview ? facts.command.title + ' · ' + commandPreview : facts.command.title;
  }
  if (meta.running && meta.isTail) return runningStepTitle(items);
  if (meta.completed) {
    return meta.durationMs >= 1000
      ? '已完成，用时 ' + durationLabel(meta.durationMs)
      : '已完成';
  }
  const details = [];
  if (facts.contexts.length) details.push(facts.contexts.length + ' 项上下文');
  if (facts.tools.length) details.push(facts.tools.length + ' 次工具调用');
  let base = '思考过程';
  if (meta.durationMs >= 1000) base = '耗时 ' + durationLabel(meta.durationMs);
  return details.length ? base + ' · ' + details.join(' · ') : base;
}

function buildProcessGroup(items, meta) {
  const first = items[0];
  const facts = processFacts(items);
  const key = (first.kind === 'status' ? 'message-' : 'process-') + first.key;
  const reasoningText = facts.reasoning.map((item) => item.text || item.reasoning || '').filter(Boolean).join('\n\n');
  const title = processTitle(items, facts, meta);
  const children = [];

  facts.contexts.forEach((item, index) => {
    children.push({
      kind: 'context',
      key: key + '/context/' + (item.key || index),
      title: item.title || '上下文',
      preview: preview(item.text),
      text: item.text || '',
      iconFile: 'context-green.png',
      tint: 'green'
    });
  });

  if (reasoningText) {
    children.push({
      kind: 'reasoning',
      key: key + '/reasoning',
      title: 'Think',
      preview: preview(reasoningText),
      text: reasoningText,
      iconFile: 'dsh-think.svg',
      tint: 'purple'
    });
  }

  if (facts.tools.length) {
    const names = facts.tools.slice(0, 2).map((tool) => tool.name).filter(Boolean);
    children.push({
      kind: 'toolBundle',
      key: key + '/tools',
      title: names.length
        ? '使用了 ' + names.join('、') + (facts.tools.length > 2 ? ' 等工具' : '')
        : '查看 ' + facts.tools.length + ' 个工具结果',
      tools: facts.tools.map((tool, index) => Object.assign({}, tool, {
        key: key + '/tools/' + (tool.callId || index),
        waiting: tool.status !== 'done' && tool.status !== 'error',
        resultLabel: tool.isError ? '错误' : '结果'
      }))
    });
  }

  return {
    kind: 'processGroup',
    key: key,
    title: title,
    command: facts.command,
    commandDetail: facts.command && compactText(facts.command.text).length > 96 ? facts.command.text : '',
    children: children,
    expandable: !!(children.length || (facts.command && facts.command.text)),
    running: meta.running && meta.isTail,
    completed: meta.completed === true,
    sourceKeys: items.map((item) => item.key).filter(Boolean)
  };
}

function buildEntries(rows, options) {
  const list = Array.isArray(rows) ? rows : [];
  const opts = options || {};
  const entries = [];
  let processItems = [];

  function flushProcess(isTail) {
    if (!processItems.length) return;
    const times = processItems.map((item) => Number(item.at || item.time || 0)).filter((value) => value > 0);
    const eventDurationMs = times.length > 1 ? Math.max.apply(null, times) - Math.min.apply(null, times) : 0;
    const toolDurationMs = processItems.reduce((max, item) => Math.max(max, Number(item.toolDurationMs || 0)), 0);
    const completed = !!(opts.completedEntryKey && processItems.some((item) => item.key === opts.completedEntryKey));
    entries.push(buildProcessGroup(processItems, {
      running: opts.running === true,
      isTail: isTail === true,
      completed: completed,
      durationMs: (completed ? Number(opts.lastDurationMs || 0) : 0)
        || eventDurationMs
        || toolDurationMs
    }));
    processItems = [];
  }

  list.forEach((row) => {
    if (!row) return;
    // Assistant tool-call steps are process content, not turn boundaries.
    // Keep them together until a real assistant answer or user message arrives.
    if (row.kind === 'assistant') {
      if (compactText(row.reasoning) || (row.tools || []).length) {
        const processCopy = Object.assign({}, row, { kind: 'reasoning', text: row.reasoning || '' });
        processItems.push(processCopy);
      }
      if (compactText(row.text) || (row.images || []).length) {
        flushProcess(false);
        entries.push(Object.assign({}, row, { kind: 'assistant' }));
      }
      return;
    }
    // A status command starts a new process group; following context/reasoning
    // and tool items belong beneath that stable command header.
    if (row.kind === 'status') {
      flushProcess(false);
      processItems.push(row);
      return;
    }
    if (isProcessRow(row)) {
      processItems.push(row);
      return;
    }
    flushProcess(false);
    entries.push(row);
  });
  flushProcess(true);

  // The final assistant text can arrive before turn/end. Keep the last process
  // group live during that settlement window, using its latest actual step.
  if (opts.running === true) {
    for (let i = entries.length - 1; i >= 0; i -= 1) {
      if (entries[i].kind !== 'processGroup') continue;
      entries[i].title = runningStepTitle(
        list.filter((row) => entries[i].sourceKeys.indexOf(row.key) >= 0)
      );
      entries[i].running = true;
      break;
    }
  }

  // Like dsh-mobile, only the final assistant response before the next user
  // message receives message actions. Intermediate narration stays quiet.
  entries.forEach((entry, index) => {
    if (entry.kind === 'user') {
      entry.showCopy = !!compactText(entry.text);
      return;
    }
    if (entry.kind !== 'assistant') return;
    let nextKind = null;
    for (let i = index + 1; i < entries.length; i += 1) {
      if (entries[i].kind === 'user' || entries[i].kind === 'assistant') {
        nextKind = entries[i].kind;
        break;
      }
    }
    entry.showCopy = nextKind !== 'assistant' && !!compactText(entry.text);
  });

  return entries;
}

module.exports = {
  buildEntries,
  compactText,
  preview
};
