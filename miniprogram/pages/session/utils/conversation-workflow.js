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

function hasVisibleAssistantContent(row) {
  return !!row && row.kind === 'assistant'
    && (compactText(row.text) || (row.images || []).length || (row.attachments || []).length);
}

function hasAssistantToolCall(row) {
  return !!row && row.kind === 'assistant'
    && (normalizeTools(row).length > 0 || (row.events || []).some(event => event && event.kind === 'tool'));
}

function hasProcessActivity(row) {
  return isProcessRow(row) || !!(row && row.kind === 'assistant'
    && (compactText(row.reasoning) || hasAssistantToolCall(row)
      || (row.events || []).some(event => event && event.kind === 'think')));
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

function processCategory(name) {
  const tool = String(name || '');
  if (tool === 'read') return 'read';
  if (tool === 'read_image') return 'readImage';
  if (tool === 'grep' || tool === 'glob' || tool.endsWith('_inspect')) return 'search';
  if (tool === 'write') return 'write';
  if (tool === 'edit' || tool === 'apply_patch') return 'edit';
  if (['bash', 'pwsh', 'exec_command', 'write_stdin'].includes(tool) || tool.startsWith('terminal_')) return 'commands';
  if (tool === 'run_code') return 'code';
  if (tool === 'web_search') return 'webSearch';
  if (tool === 'web_fetch') return 'webFetch';
  if (tool === 'subagent' || tool.startsWith('subagent_')) return 'subagents';
  if (['todo_write', 'create_goal', 'update_goal', 'get_goal'].includes(tool)) return 'plan';
  if (tool === 'ask_user_question' || tool === 'request_user_input') return 'questions';
  return 'tools';
}

function completedWorkSummary(facts) {
  const labels = {
    thinking: uiText('已完成分析'), read: uiText('已读取文件'), readImage: uiText('已读取图片'),
    write: uiText('已写入文件'), search: uiText('已搜索代码'), edit: uiText('修改了文件'),
    commands: uiText('执行了命令'), code: uiText('运行了代码'), webSearch: uiText('已搜索网页'),
    webFetch: uiText('已访问网页'), subagents: uiText('已协调子智能体'), plan: uiText('更新了计划'),
    questions: uiText('向用户提出了问题'), tools: uiText('已调用工具')
  };
  const counts = new Map();
  function add(name) {
    if (!name) return;
    const category = processCategory(name);
    const current = counts.get(category);
    if (current) current.count += 1;
    else counts.set(category, { count: 1, index: counts.size });
  }
  facts.tools.forEach(tool => add(tool.name));
  if (!facts.tools.length && facts.command) add(facts.command.title || facts.command.name);
  const ranked = Array.from(counts.entries()).sort((a, b) => b[1].count - a[1].count || a[1].index - b[1].index);
  const shown = ranked.length ? ranked.slice(0, 3).map(([kind]) => labels[kind]) : [labels.thinking];
  const english = uiText('已完成分析') !== '已完成分析';
  const sharedPrefix = english ? '' : '已';
  const lowercaseContinuation = label => label.charAt(0).toLowerCase() + label.slice(1);
  if (shown.length === 2) {
    let second = shown[1];
    if (sharedPrefix && shown[0].startsWith(sharedPrefix) && second.startsWith(sharedPrefix)) second = second.slice(sharedPrefix.length);
    return shown[0] + (english ? ' and ' : '并') + lowercaseContinuation(second);
  }
  const summary = [shown[0], ...shown.slice(1).map(lowercaseContinuation)].join(english ? ', ' : '，');
  return ranked.length > 3 ? summary + (english ? ', etc.' : '等') : summary;
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
    if (item.kind === 'reasoning' || item.kind === 'assistantProcess' && (compactText(item.reasoning) || (item.events || []).some(event => event.kind === 'think'))) return uiText('正在推理');
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
// 放一个「已完成」disclosure，且只在回合关闭后出现。单组、多组回合都需要此行：
// 展开时过程组与中间叙述照原顺序显示，收起时整轮过程折成这一行；最终答复留在
// 外面，始终可见。运行中的回合不插。
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
    if (groups.length > 0) {
      const key = 'turn-' + entry.key;
      const duration = groups.map(g => (g.summary || '').split(' · ').find(part => part.indexOf(uiText('用时 ')) === 0)).find(Boolean) || '';
      out.push({
        kind: 'turnProcess',
        key,
        title: groups[groups.length - 1].title,   // 回合级标题：已完成 / 执行失败 / 已停止
        summary: duration,
        iconFile: entry.iconFile,
        darkIconFile: entry.darkIconFile,
        expandable: groups.some(group => group.expandable === true),
        alwaysOpen: groups.some(group => group.turnAlwaysOpen === true),
        sourceKeys: Array.from(new Set(groups.flatMap(group => group.sourceKeys || [])))
      });
      run.forEach((item) => {
        item.turnProcessKey = key;
        // 里面各组按自己的子内容命名（运行了代码 / 已完成分析……），不再重复回合行的
        // 「已完成」；回合用时也只挂回合行，各组不重复显示。
        if (item.kind === 'processGroup') {
          item.title = processActivityTitle(groupTools(item));
          const summaryParts = (item.summary || '').split(' · ').filter(part => part && part.indexOf(uiText('用时 ')) !== 0);
          const toolCount = groupTools(item).length;
          if (!summaryParts.length && toolCount) summaryParts.push(toolCount + uiText(' 次工具调用'));
          item.summary = summaryParts.join(' · ');
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
  const toolsById = new Map(facts.tools.map((tool, index) => [tool.callId || tool.key || ('tool-' + index), tool]));
  function pushReasoning(item, text, id) {
    if (!text) return;
    children.push({
      kind: 'reasoning', key: key + '/reasoning/' + id, sourceKey: item.key,
      title: uiText('思考'), preview: preview(text), text,
      running: item.reasoningStreaming === true && item.streaming !== false,
      stepLabel: item.step !== undefined && item.step !== null ? uiText('步骤 ') + item.step : '',
      readingLong: text.length > 220 || text.split('\n').length > 6,
      readingHeight: Math.min(360, Math.max(88, text.split('\n').reduce((lines, line) => lines + Math.max(1, Math.ceil(line.length / 36)), 0) * 44)),
      iconFile: 'dsh-think.svg', darkIconFile: 'dsh-think-dark.svg'
    });
  }
  function pushTool(item, index, callId) {
    const id = callId || item.callId || item.key || ('tool-' + index);
    if (seenTools.has(id)) return;
    seenTools.add(id);
    const latest = toolsById.get(id) || item;
    const waiting = latest.status !== 'done' && latest.status !== 'error' && !latest.isError;
    const activity = toolPresentation(latest.name, latest.argumentsText);
    const tool = Object.assign({}, latest, {
      actLabel: activity.label,
      actDetail: activity.detail,
      isCommand: activity.isCommand,
      commandText: activity.commandText,
      commandLines: activity.commandLines,
      cwdLabel: activity.cwdLabel,
      key: key + '/tools/' + id,
      sourceKey: latest.key || '',
      iconFile: toolIconFile(latest.name),
      darkIconFile: toolIconFile(latest.name).replace('.svg', '-dark.svg'),
      waiting: waiting && !meta.closed && !meta.stopped && !meta.failed,
      statusText: latest.isError || latest.status === 'error' ? uiText('失败')
        : waiting ? (meta.stopped ? uiText('已中断') : meta.closed || meta.failed ? uiText('未返回结果') : latest.phase === 'preparing' ? uiText('正在准备…') : uiText('运行中')) : '',
      resultLabel: latest.isError ? uiText('错误') : uiText('结果')
    });
    children.push({ kind: 'toolBundle', key: tool.key + '/bundle', tools: [tool] });
  }
  items.forEach((item, index) => {
    if (item.kind === 'context') {
      if (item.text) children.push({
        kind: 'context', key: key + '/context/' + (item.key || index), sourceKey: item.key,
        title: item.title || uiText('上下文'), preview: preview(item.text), text: item.text,
        iconFile: 'dsh-context.svg', darkIconFile: 'dsh-context-dark.svg'
      });
      return;
    }
    if (item.kind === 'reasoning') { pushReasoning(item, item.text || item.reasoning, item.key || index); return; }
    if (item.kind === 'status') {
      const text = item.phase === 'command/completed' ? uiText('命令已完成') : item.text || '';
      children.push({ kind: 'status', key: key + '/status/' + (item.key || index), title: item.title || uiText('命令'), text, phase: item.phase || '' });
      return;
    }
    if (item.kind !== 'assistantProcess') {
      normalizeTools(item).forEach((tool, toolIndex) => pushTool(tool, index + '-' + toolIndex, tool.callId || tool.key));
      return;
    }

    const tools = normalizeTools(item);
    const events = Array.isArray(item.events) ? item.events : [];
    const seenImages = new Set();
    const seenAttachments = new Set();
    function pushNarration(text, media, id) {
      const content = typeof text === 'string' ? text : '';
      const images = media && Array.isArray(media.images) ? media.images : id === undefined ? item.images || [] : [];
      const attachments = media && Array.isArray(media.attachments) ? media.attachments : id === undefined ? item.attachments || [] : [];
      if (!content && !images.length && !attachments.length) return;
      images.forEach(image => { if (image && image.attachmentId) seenImages.add(image.attachmentId); });
      attachments.forEach(att => { if (att) seenAttachments.add(att.attachmentId || att.path || att.name || att); });
      const sourceKey = item.key || '';
      const formatKey = sourceKey && id !== undefined ? sourceKey + '/process/' + id : sourceKey;
      const blocks = content === (item.text || '') ? item.blocks || [] : [];
      children.push({
        kind: 'narration', key: key + '/narration/' + (sourceKey || index) + (id === undefined ? '' : '-' + id),
        sourceKey: sourceKey, formatKey: formatKey,
        text: content, blocks, images, attachments,
        preview: preview(content), stepLabel: item.step !== undefined && item.step !== null ? uiText('步骤 ') + item.step : ''
      });
    }
    if (!events.length) pushNarration(item.text, null, undefined);
    events.forEach((event, eventIndex) => {
      if (event.kind === 'think') pushReasoning(item, event.text, (item.key || index) + '-' + eventIndex);
      else if (event.kind === 'tool') {
        const tool = toolsById.get(event.callId);
        // Anonymous preparing deltas are deliberately hidden until the host
        // supplies a tool name; don't synthesize an empty tool card from events.
        if (tool) pushTool(tool, index + '-' + eventIndex, event.callId);
      }
      else if (event.kind === 'text') pushNarration(event.text || '', null, eventIndex);
      else if (event.kind === 'image') pushNarration('', {
        images: event.image ? [event.image] : [],
        attachments: event.attachment ? [event.attachment] : []
      }, eventIndex);
      else if (event.kind === 'attachment') pushNarration('', { images: [], attachments: event.attachment ? [event.attachment] : [] }, eventIndex);
    });
    if (item.reasoning && !events.some(event => event.kind === 'think')) pushReasoning(item, item.reasoning, item.key || index);
    if (events.length) {
      const remainingImages = (item.images || []).filter(image => !seenImages.has(image && image.attachmentId));
      const remainingAttachments = (item.attachments || []).filter(att => !seenAttachments.has(att && (att.attachmentId || att.path || att.name || att)));
      if (remainingImages.length || remainingAttachments.length) pushNarration('', { images: remainingImages, attachments: remainingAttachments }, 'remaining');
      if (!events.some(event => ['text', 'image', 'attachment'].includes(event.kind)) && item.text) pushNarration(item.text, { images: [], attachments: [] });
    }
    tools.forEach((tool, toolIndex) => pushTool(tool, index + '-' + toolIndex, tool.callId || tool.key));
  });
  applyToolBranchTracks(children);
  const running = meta.running;
  const completed = !running && !meta.failed && !meta.stopped && meta.completed;
  const title = running ? runningStepTitle(items) : meta.failed ? uiText('执行失败') : meta.stopped ? uiText('已停止')
    : completed || facts.command && facts.command.phase === 'command/completed' ? uiText('已完成')
      : facts.tools.some(t => t.isError || t.status === 'error') ? uiText('工具执行失败') : uiText('执行过程');
  const details = [];
  if (meta.failed || meta.stopped) details.push(completedWorkSummary(facts));
  else if (!completed && facts.tools.length) details.push(facts.tools.length + uiText(' 次工具调用'));
  if (facts.contexts.length && !completed && !meta.failed && !meta.stopped) details.push(facts.contexts.length + uiText(' 项上下文'));
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
    children, processScrollTarget: children.length ? children[children.length - 1].key : '',
    expandable: !!(children.length || facts.command), running, turnRunning: meta.running === true, completed,
    durationMs: Number(meta.durationMs) || 0,
    failed: meta.failed, stopped: meta.stopped,
    failureTitle: failure ? failure.title : '',
    failureMessage: failure ? failure.message : '',
    failureCode: failure ? failure.code : '',
    turnAlwaysOpen: meta.alwaysOpen === true,
    sourceKeys: items.map(item => item.key).filter(Boolean)
  };
}

function applyToolBranchTracks(children) {
  (children || []).forEach(child => {
    if (child.kind !== 'toolBundle') return;
    (child.tools || []).forEach(tool => {
      const depth = Math.max(0, Math.floor(Number(tool.depth) || 0));
      const visibleDepth = Math.min(depth, 8);
      tool.depth = depth;
      tool.indentStyle = visibleDepth ? 'margin-left:' + (visibleDepth * 28) + 'rpx;' : '';
      tool.branchTracks = Array.from({ length: visibleDepth }, (_, index) => {
        const level = index + 1;
        const left = (level - visibleDepth) * 28 - 14;
        return { key: String(level), style: 'left:' + left + 'rpx;' };
      });
    });
  });
}

function buildEntries(rows, options) {
  const list = Array.isArray(rows) ? rows : [];
  const opts = options || {};
  let entries = [];  // 回合结束后可能被 mergeSettledGroups 收拢成一个
  let processItems = [];

  const outcomes = new Map();
  const finalAnswers = new Set();
  const processNarrations = new Set();
  let turnRows = [];
  function finishTurn(isLast) {
    if (!turnRows.length) return;
    const ended = turnRows.find(row => row.turnClosed);
    const reason = ended && ended.turnEndReason || '';
    const stopped = /^(aborted|interrupted|cancelled|canceled)$/.test(reason) || turnRows.some(row => row.interrupted);
    const failed = /^(error|failed|max-tokens)$/.test(reason);
    const alwaysOpen = /^(aborted|interrupted|cancelled|canceled|error)$/.test(reason) || turnRows.some(row => row.interrupted);
    const running = opts.running === true && isLast && !ended && !stopped && !failed;
    let finalAnswer = null;
    const hasTurnProcessActivity = turnRows.some(hasProcessActivity);
    let laterProcessActivity = false;
    for (let i = turnRows.length - 1; i >= 0; i -= 1) {
      const row = turnRows[i];
      const processActivity = hasProcessActivity(row);
      if (hasVisibleAssistantContent(row) && !hasAssistantToolCall(row) && !laterProcessActivity) {
        finalAnswer = row;
        break;
      }
      if (processActivity) laterProcessActivity = true;
    }
    if (hasTurnProcessActivity) {
      turnRows.forEach(row => {
        if (row.kind === 'assistant' && hasVisibleAssistantContent(row) && row !== finalAnswer) processNarrations.add(row);
      });
    }
    const pending = turnRows.some(row => normalizeTools(row).some(t => t.status !== 'done' && t.status !== 'error'));
    const marked = turnRows.some(row => row.key === opts.completedEntryKey);
    // A settled assistant message may be an intermediate model step. Only the
    // authoritative turn boundary (or the session lifecycle completion marker)
    // can finish the whole process group.
    const completed = !running && !stopped && !failed && (!!ended || (marked && !pending));
    const meta = { running, stopped, failed, completed, closed: !!ended, alwaysOpen,
      durationMs: ended && ended.durationMs || (marked ? Number(opts.lastDurationMs || 0) : 0),
      // 失败原因：DSH 的 {message,code,status}，供错误卡按桌面端口径展示
      failure: (ended && ended.turnFailure) || null };
    turnRows.forEach(row => outcomes.set(row, meta));
    if (finalAnswer) finalAnswers.add(finalAnswer);
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
  let deferredAnswers = [];
  function flushProcess() {
    if (!processItems.length) return;
    entries.push(buildProcessGroup(processItems, processMeta));
    groupsByOutcome.add(processMeta);
    processItems = [];
  }
  function flushOutcome() {
    flushProcess();
    deferredAnswers.forEach(answer => entries.push(answer));
    deferredAnswers = [];
  }

  list.forEach((row) => {
    if (!row) return;
    const meta = outcomes.get(row) || {};
    if (processMeta !== meta) flushOutcome();
    processMeta = meta;
    if (row.kind === 'user') {
      flushOutcome();
      entries.push(row);
      return;
    }
    if (row.kind === 'assistant') {
      const isFinalAnswer = finalAnswers.has(row);
      if (meta.running && !isFinalAnswer && processNarrations.has(row) && hasVisibleAssistantContent(row)
        && normalizeTools(row).length > 0 && !(row.events || []).length) {
        flushOutcome();
        const narrativeEvents = (row.events || []).filter(event => event
          && ['text', 'image', 'attachment'].includes(event.kind));
        entries.push(Object.assign({}, row, {
          kind: 'assistant', reasoning: '', tools: [], events: narrativeEvents,
          processNarration: true
        }));
        const processCopy = Object.assign({}, row, {
          kind: 'assistantProcess', text: '', blocks: [], images: [], attachments: [],
          events: (row.events || []).filter(event => event
            && !['text', 'image', 'attachment'].includes(event.kind))
        });
        processItems.push(processCopy);
        return;
      }
      const isIntermediateNarration = !isFinalAnswer && processNarrations.has(row)
        && hasVisibleAssistantContent(row) && !hasAssistantToolCall(row)
        && !compactText(row.reasoning)
        && !(row.events || []).some(event => event && event.kind === 'think');
      if (isIntermediateNarration) {
        flushOutcome();
        entries.push(Object.assign({}, row, { kind: 'assistant' }));
        return;
      }
      const hasProcessContent = compactText(row.reasoning) || normalizeTools(row).length
        || (row.events || []).some(event => event && (event.kind === 'think' || event.kind === 'tool'))
        || processNarrations.has(row)
        // DSH groups prior assistant-step output into the Turn process even if
        // a provider emits plain text between tool cycles. Without turn metadata
        // retain the conservative evidence-based fallback for legacy history.
        || (!isFinalAnswer && row.turn !== undefined && row.turn !== null && hasVisibleAssistantContent(row));
      if (hasProcessContent || (row.turnClosed && !groupsByOutcome.has(meta) && !processItems.length)) {
        const processCopy = Object.assign({}, row, { kind: 'assistantProcess' });
        if (isFinalAnswer) {
          processCopy.text = '';
          processCopy.blocks = [];
          processCopy.images = [];
          processCopy.attachments = [];
          processCopy.events = (row.events || []).filter(event => event && !['text', 'image', 'attachment'].includes(event.kind));
        }
        processItems.push(processCopy);
      }
      if (isFinalAnswer) {
        deferredAnswers.push(Object.assign({}, row, { kind: 'assistant' }));
      } else if (!hasProcessContent && !row.turnClosed && hasVisibleAssistantContent(row)) {
        // Old history may omit Turn/Step identity. Keep ambiguous prose visible
        // as a normal reply rather than guessing that it belongs to a process.
        flushOutcome();
        entries.push(Object.assign({}, row, { kind: 'assistant' }));
      }
      return;
    }
    if (row.kind === 'status') {
      processItems.push(row);
      return;
    }
    if (isProcessRow(row)) {
      processItems.push(row);
      return;
    }
    flushOutcome();
    entries.push(row);
  });
  flushOutcome();

  // Older histories may end a turn with a separate, reasoning-only completion
  // record. Keep that thought in the preceding completion instead of showing
  // a second completion header for the same work.
  for (let i = 1; i < entries.length; i += 1) {
    const previous = entries[i - 1];
    const current = entries[i];
    if (previous.kind !== 'processGroup' || !previous.completed
      || current.kind !== 'processGroup' || !current.completed
      || current.children.length !== 1 || current.children[0].kind !== 'reasoning') continue;

    previous.children.push(current.children[0]);
    previous.sourceKeys = Array.from(new Set((previous.sourceKeys || []).concat(current.sourceKeys || [])));
    previous.durationMs = Math.max(Number(previous.durationMs) || 0, Number(current.durationMs) || 0);
    previous.summary = previous.durationMs >= 1000
      ? uiText('用时 ') + durationLabel(previous.durationMs)
      : '';
    entries.splice(i, 1);
    i -= 1;
  }

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

  // 对话结束：回合在过程内容上方插一个「已完成」disclosure 行，收起时
  // 整轮过程折成这一行。运行中的回合不插，各组照常各自显示。
  entries = insertTurnDisclosures(entries);

  // DSH places declared files beneath the turn's closing reply.
  entries.filter(entry => entry.kind === 'files' || entry.kind === 'changes').reverse().forEach(files => {
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
