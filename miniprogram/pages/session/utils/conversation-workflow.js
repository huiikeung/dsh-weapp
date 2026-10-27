const { t: uiText } = require('../../../utils/ui-preferences');
const { toolIconFile } = require('../../../utils/protocol');
const { toolPresentation } = require('./tool-presentation');

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
  if (seconds >= 60) return Math.floor(seconds / 60) + uiText(' 分钟 ') + (seconds % 60) + uiText(' 秒');
  return seconds + uiText(' 秒');
}

function isProcessRow(row) {
  return !!row && ['context', 'reasoning', 'tool', 'toolResult', 'status'].indexOf(row.kind) >= 0;
}

function normalizeTools(row) {
  if (!row) return [];
  // DSH publishes preparing calls only after their tool name is available.
  if (Array.isArray(row.tools)) return row.tools.filter(tool => tool.phase !== 'preparing' || tool.name && tool.name !== 'tool');
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
      if (/压缩/.test(status)) return uiText('正在压缩上下文');
      if (/失败/.test(status)) return uiText('命令执行失败');
      if (/完成/.test(status)) return uiText('命令已完成');
      return uiText('正在执行命令');
    }

    const tools = normalizeTools(item);
    const activeTool = tools.slice().reverse().find((tool) => tool.status !== 'done' && tool.status !== 'error');
    if (activeTool) {
      const name = String(activeTool.name || '').toLowerCase().split(/[./]/).pop().replace(/[^a-z0-9]/g, '');
      if (['bash', 'pwsh', 'shell', 'exec', 'terminal', 'runcode', 'execcommand', 'writestdin'].indexOf(name) >= 0) return uiText('正在执行命令');
      if (['read', 'readfile', 'webfetch'].indexOf(name) >= 0) return uiText('正在读取内容');
      if (['grep', 'search', 'glob', 'find', 'websearch'].indexOf(name) >= 0) return uiText('正在搜索');
      if (['write', 'writefile', 'edit', 'editfile', 'applypatch'].indexOf(name) >= 0) return uiText('正在修改内容');
      return name && name !== 'tool' ? uiText('正在执行 ') + name : uiText('正在执行工具');
    }
    if (tools.length || item.kind === 'toolResult') return uiText('正在整理工具结果');
    if (item.kind === 'context') return uiText('正在整理上下文');
    if (item.kind === 'reasoning') return uiText('正在推理');
  }
  return uiText('正在思考');
}

// DSH 失败文案口径（dsh-client-ui-chat failureMessage/turnError）：仅几个可稳定
// 路由的编码替换成人话，其余一律展示服务端原文。
const FAILURE_COPY = {
  ACCOUNT_SIGNED_OUT: '任务已因退出 DeepSeek 登录而停止。',
  ACCOUNT_SIGN_IN_REQUIRED: '请先登录 DeepSeek，并确认请求地址支持账号认证。',
  QUOTA: '当前请求的额度已用尽',
  ACCOUNT_QUOTA: '当前请求的额度已用尽',
  AUTH: 'API 密钥无效'
};
function turnFailureCopy(failure) {
  if (!failure) return { title: '', message: '', code: '' };
  const code = failure.code || '';
  const title = code === 'ACCOUNT_SIGNED_OUT' ? uiText('任务已停止') : uiText('本轮运行失败');
  return { title: title, message: uiText(FAILURE_COPY[code]) || failure.message || '', code: code };
}

// 对话结束（或失败/停止）后，桌面端（TurnProcessNodeView）会在回合的过程内容上方
// 放一个「已完成」disclosure，且只在回合关闭后出现。这里给多过程组的回合插这一行：
// 展开时各轮过程组与中间叙述照原顺序显示，收起时整轮过程折成这一行；最终答复留在
// 外面，始终可见。单组回合不插——那一组自己就是回合行。运行中的回合不插。
// 回合是否真的结束了：运行中上面会把「已收工但不是活动组」的组标成 running=false，
// 所以不能只看 running——要以回合级状态（completed / failed / stopped）为准。
function turnSettled(entry) {
  return !entry.running && (entry.completed === true || entry.failed === true || entry.stopped === true);
}
function insertTurnDisclosures(list) {
  const out = [];
  let i = 0;
  while (i < list.length) {
    const entry = list[i];
    if (entry.kind !== 'processGroup' || !turnSettled(entry)) { out.push(entry); i += 1; continue; }
    // 收集同一回合的连续过程组与夹在中间的叙述；最终答复（后面不再有组）留在外面
    const run = [entry];
    let j = i + 1;
    while (j < list.length) {
      const next = list[j];
      if (next.kind === 'processGroup' && turnSettled(next)) { run.push(next); j += 1; continue; }
      if (next.kind === 'assistant' && j + 1 < list.length && list[j + 1].kind === 'processGroup' && turnSettled(list[j + 1])) { run.push(next); j += 1; continue; }
      break;
    }
    const groups = run.filter(item => item.kind === 'processGroup');
    if (groups.length > 1) {
      const key = 'turn-' + entry.key;
      const duration = groups.map(g => (g.summary || '').split(' · ').find(part => part.indexOf(uiText('用时 ')) === 0)).find(Boolean) || '';
      out.push({
        kind: 'turnProcess',
        key,
        title: groups[groups.length - 1].title,   // 回合级标题：已完成 / 执行失败 / 已停止
        summary: duration,
        iconFile: entry.iconFile,
        darkIconFile: entry.darkIconFile,
        expandable: true
      });
      run.forEach((item) => {
        item.turnProcessKey = key;
        // 里面各组按自己的子内容命名（运行了代码 / 已完成分析……），不再重复回合行的
        // 「已完成」；回合用时也只挂回合行，各组不重复显示。
        if (item.kind === 'processGroup') {
          item.title = processActivityTitle(groupTools(item));
          item.summary = (item.summary || '').split(' · ').filter(part => part.indexOf(uiText('用时 ')) !== 0).join(' · ');
        }
      });
    }
    run.forEach(item => out.push(item));
    i = j;
  }
  return out;
}

// 过程组按子内容命名（对齐桌面端 message.stepProcess.done.* / processTitle）：跑过
// 代码就是「运行了代码」，只思考过就是「已完成分析」，多种活动拼接（两种用「并」合并
// 并去重共享前缀「已」，三种以上逗号相接、超过三种加「等」）。
const ACTIVITY_LABELS = {
  thinking: '已完成分析', read: '已读取文件', readImage: '已读取图片', write: '已写入文件',
  search: '已搜索代码', edit: '修改了文件', commands: '执行了命令', code: '运行了代码',
  webSearch: '已搜索网页', webFetch: '已访问网页', subagents: '已协调子智能体',
  plan: '更新了计划', questions: '向用户提出了问题', tools: '已调用工具'
};
function toolActivityKind(name) {
  const raw = String(name || '').toLowerCase().split(/[./]/).pop();
  const n = raw.replace(/[^a-z0-9]/g, '');
  if (['write', 'writefile'].includes(n)) return 'write';
  if (['edit', 'editfile', 'applypatch', 'strreplaceeditor'].includes(n)) return 'edit';
  if (['readimage', 'viewimage'].includes(n)) return 'readImage';
  if (['read', 'readfile'].includes(n)) return 'read';
  if (['glob', 'grep', 'search', 'find', 'lsp'].includes(n) || raw.startsWith('session_')) return 'search';
  if (['webfetch', 'fetch'].includes(n)) return 'webFetch';
  if (['websearch', 'browse'].includes(n)) return 'webSearch';
  if (['bash', 'pwsh', 'shell', 'exec', 'execcommand', 'writestdin', 'terminal'].includes(n)) return 'commands';
  if (['runcode', 'code', 'python'].includes(n) || raw.startsWith('terminal_')) return 'code';
  if (['spawnteammate', 'listagents', 'sendmessage', 'interruptagent', 'waitagent', 'spawnagent', 'subagent', 'followuptask'].includes(n)) return 'subagents';
  if (['plan', 'updateplan'].includes(n)) return 'plan';
  if (['askuser', 'requestuserinput'].includes(n)) return 'questions';
  return 'tools';
}
/** 工具清单 → [{kind,count}]（按首次出现顺序，供标题拼接用）。 */
function activityCounts(tools) {
  const counts = [];
  (tools || []).forEach((tool) => {
    const kind = toolActivityKind(tool && tool.name);
    const found = counts.find((item) => item.kind === kind);
    if (found) found.count += 1;
    else counts.push({ kind, count: 1 });
  });
  return counts;
}
/** 过程组的工具清单（供按内容命名用）。 */
function groupTools(entry) {
  return (entry.children || []).reduce((list, child) => list.concat(child.kind === 'toolBundle' ? child.tools : []), []);
}
function processActivityTitle(tools) {
  const counts = activityCounts(tools);
  if (!counts.length) return uiText(ACTIVITY_LABELS.thinking);
  const labels = counts.slice(0, 3).map((item) => uiText(ACTIVITY_LABELS[item.kind] || ACTIVITY_LABELS.tools));
  const first = labels[0];
  const second = labels[1];
  if (second === undefined) return first;
  if (labels.length === 2) {
    const prefix = uiText('已');
    const trimmed = prefix !== '' && first.startsWith(prefix) && second.startsWith(prefix) ? second.slice(prefix.length) : second;
    return uiText('{first}并{second}', { first, second: trimmed });
  }
  const title = [first].concat(labels.slice(1)).join(uiText('，'));
  return counts.length > 3 ? uiText('{title}等', { title }) : title;
}

function buildProcessGroup(items, meta) {
  const first = items[0];
  const facts = processFacts(items);
  const key = (first.kind === 'status' ? 'message-' : 'process-') + first.key;
  const children = [];
  const seenTools = new Set();
  items.forEach((item, index) => {
    const text = item.kind === 'context' ? item.text : item.reasoning || (item.kind === 'reasoning' ? item.text : '');
    if (text) children.push({
      kind: item.kind === 'context' ? 'context' : 'reasoning',
      key: key + '/' + (item.kind === 'context' ? 'context/' : 'reasoning/') + (item.key || index),
      title: item.kind === 'context' ? item.title || uiText('上下文') : uiText('思考'),
      preview: preview(text), text: text,
      stepLabel: item.step !== undefined && item.step !== null ? uiText('步骤 ') + item.step : '',
      readingLong: text.length > 220 || text.split('\n').length > 6,
      readingHeight: Math.min(360, Math.max(88, text.split('\n').reduce((lines, line) => lines + Math.max(1, Math.ceil(line.length / 36)), 0) * 44)),
      iconFile: item.kind === 'context' ? 'dsh-context.svg' : 'dsh-think.svg',
      darkIconFile: item.kind === 'context' ? 'dsh-context-dark.svg' : 'dsh-think-dark.svg'
    });
    const tools = normalizeTools(item).filter(tool => {
      const id = tool.callId || tool.key || tool;
      if (seenTools.has(id)) return false;
      seenTools.add(id); return true;
    }).map((tool, i) => {
      const latest = facts.tools.find(t => t.callId === (tool.callId || tool.key)) || tool;
      const waiting = latest.status !== 'done' && latest.status !== 'error' && !latest.isError;
      const activity = toolPresentation(latest.name, latest.argumentsText);
      return Object.assign({}, latest, {
        actLabel: activity.label,
        actDetail: activity.detail,
        key: key + '/tools/' + (latest.callId || latest.key || index + '-' + i),
        iconFile: toolIconFile(latest.name),
        darkIconFile: toolIconFile(latest.name).replace('.svg', '-dark.svg'),
        waiting: waiting && !meta.closed && !meta.stopped && !meta.failed,
        statusText: latest.isError || latest.status === 'error' ? uiText('失败')
          : waiting ? (meta.stopped ? uiText('已中断') : meta.closed || meta.failed ? uiText('未返回结果') : latest.phase === 'preparing' ? uiText('正在准备…') : uiText('运行中')) : '',
        resultLabel: latest.isError ? uiText('错误') : uiText('结果')
      });
    });
    if (tools.length) children.push({ kind: 'toolBundle', key: key + '/tools/' + (item.key || index), tools: tools });
  });
  const running = meta.running;
  const completed = !running && !meta.failed && !meta.stopped && meta.completed;
  const title = running ? runningStepTitle(items) : meta.failed ? uiText('执行失败') : meta.stopped ? uiText('已停止')
    : completed ? uiText('已完成') : facts.tools.some(t => t.isError || t.status === 'error') ? uiText('工具执行失败') : uiText('执行过程');
  const details = [];
  if (facts.tools.length) details.push(facts.tools.length + uiText(' 次工具调用'));
  if (facts.contexts.length) details.push(facts.contexts.length + uiText(' 项上下文'));
  if (completed && meta.durationMs >= 1000) details.push(uiText('用时 ') + durationLabel(meta.durationMs));
  const lastTool = facts.tools[facts.tools.length - 1];
  // 失败时透出 DSH 原文/编码，视图层渲染红色错误卡
  const failure = meta.failed && meta.failure ? turnFailureCopy(meta.failure) : null;
  return {
    kind: 'processGroup', key, title, summary: details.join(' · '),
    activityDetail: lastTool ? toolPresentation(lastTool.name, lastTool.argumentsText).detail : '',
    iconFile: lastTool ? toolIconFile(lastTool.name) : facts.command ? 'dsh-bash.svg' : 'dsh-think.svg',
    darkIconFile: (lastTool ? toolIconFile(lastTool.name) : facts.command ? 'dsh-bash.svg' : 'dsh-think.svg').replace('.svg', '-dark.svg'),
    command: facts.command, commandDetail: facts.command ? facts.command.text || '' : '',
    children, expandable: !!(children.length || facts.command), running, completed,
    failed: meta.failed, stopped: meta.stopped,
    failureTitle: failure ? failure.title : '',
    failureMessage: failure ? failure.message : '',
    failureCode: failure ? failure.code : '',
    sourceKeys: items.map(item => item.key).filter(Boolean)
  };
}

function buildEntries(rows, options) {
  const list = Array.isArray(rows) ? rows : [];
  const opts = options || {};
  let entries = [];  // 回合结束后可能被 mergeSettledGroups 收拢成一个
  let processItems = [];

  const outcomes = new Map();
  let turnRows = [];
  function finishTurn(isLast) {
    if (!turnRows.length) return;
    const ended = turnRows.find(row => row.turnClosed);
    const reason = ended && ended.turnEndReason || '';
    const stopped = /^(aborted|interrupted|cancelled|canceled)$/.test(reason) || turnRows.some(row => row.interrupted);
    const failed = /^(error|failed|max-tokens)$/.test(reason) || turnRows.some(row => row.phase === 'command/failed');
    const running = opts.running === true && isLast && !ended && !stopped && !failed;
    const hasAnswer = turnRows.some(row => row.kind === 'assistant' && !row.streaming && (compactText(row.text) || (row.images || []).length));
    const pending = turnRows.some(row => normalizeTools(row).some(t => t.status !== 'done' && t.status !== 'error'));
    const marked = turnRows.some(row => row.key === opts.completedEntryKey);
    const completed = !running && !stopped && !failed && (!!ended || (hasAnswer && !pending) || (marked && hasAnswer && !pending) || turnRows.some(row => row.phase === 'command/completed' || row.phase === 'compaction/summarized'));
    const meta = { running, stopped, failed, completed, closed: !!ended,
      durationMs: ended && ended.durationMs || (marked ? Number(opts.lastDurationMs || 0) : 0),
      // 失败原因：DSH 的 {message,code,status}，供错误卡按桌面端口径展示
      failure: (ended && ended.turnFailure) || null };
    turnRows.forEach(row => outcomes.set(row, meta));
    turnRows = [];
  }
  let currentTurn;
  list.forEach(row => {
    if (!row) return;
    if (row.kind === 'user' || (row.turn !== undefined && currentTurn !== undefined && row.turn !== currentTurn)) {
      finishTurn(false);
      currentTurn = undefined;
    }
    if (row.turn !== undefined) currentTurn = row.turn;
    turnRows.push(row);
  });
  finishTurn(true);
  let processMeta = {};
  const groupsByOutcome = new Set();
  function flushProcess() {
    if (!processItems.length) return;
    entries.push(buildProcessGroup(processItems, processMeta));
    groupsByOutcome.add(processMeta);
    processItems = [];
  }

  list.forEach((row) => {
    if (!row) return;
    const meta = outcomes.get(row) || {};
    if (processItems.length && processMeta !== meta) flushProcess();
    processMeta = meta;
    // Assistant tool-call steps are process content, not turn boundaries.
    // Keep them together until a real assistant answer or user message arrives.
    if (row.kind === 'assistant') {
      if (compactText(row.reasoning) || normalizeTools(row).length || (row.turnClosed && !groupsByOutcome.has(meta) && !processItems.length)) {
        const processCopy = Object.assign({}, row, { kind: 'reasoning', text: row.reasoning || '' });
        processItems.push(processCopy);
      }
      if (compactText(row.text) || (row.images || []).length || (row.attachments || []).length) {
        flushProcess();
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
  flushProcess();

  // Only the latest process block in a live turn owns its current activity.
  let activeSeen = false;
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i];
    if (entry.kind === 'user') break;
    if (entry.kind !== 'processGroup' || !entry.running) continue;
    // 已收工的轮次按自己的子内容命名（运行了代码 / 修改了文件并运行了代码……），
    // 不再出现光秃秃的「工作步骤」；只有最后一个活动组保留实时标题。
    if (activeSeen) { entry.running = false; entry.title = processActivityTitle(groupTools(entry)); }
    else {
      activeSeen = true;
      const tail = list[list.length - 1];
      if (tail && tail.kind === 'assistant' && tail.streaming && !tail.reasoningStreaming) {
        entry.title = uiText('正在生成回复'); entry.activityDetail = ''; entry.iconFile = 'dsh-think.svg'; entry.darkIconFile = 'dsh-think-dark.svg';
      }
    }
  }

  // 对话结束：多过程组的回合在过程内容上方插一个「已完成」disclosure 行，收起时
  // 整轮过程折成这一行。运行中的回合不插，各组照常各自显示。
  entries = insertTurnDisclosures(entries);

  // DSH places declared files beneath the turn's closing reply.
  entries.filter(entry => entry.kind === 'files' || entry.kind === 'changes').forEach(files => {
    const index = entries.indexOf(files);
    let closing = index;
    for (let i = index + 1; i < entries.length; i += 1) {
      const next = entries[i];
      if (next.kind === 'user' || (next.turn !== undefined && next.turn !== files.turn)) break;
      if (next.kind === 'assistant') closing = i;
    }
    if (closing > index) { entries.splice(index, 1); entries.splice(closing, 0, files); }
  });

  // Keep live work below narration; live whale status is in the fixed dock.
  const activeIndex = entries.findIndex(entry => entry.kind === 'processGroup' && entry.running);
  if (activeIndex >= 0 && activeIndex < entries.length - 1) {
    entries.push(entries.splice(activeIndex, 1)[0]);
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
