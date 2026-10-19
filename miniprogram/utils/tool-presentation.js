const { t: uiText } = require('./ui-preferences');
// DSH SUMMARY_KEYS: shell description first, then actual command.
function toolPresentation(name, input, sessionCwd) {
  const n = String(name || '').toLowerCase().split(/[./]/).pop().replace(/[^a-z0-9]/g, '');
  const raw = typeof input === 'string' ? input : '';
  let args = input && typeof input === 'object' && !Array.isArray(input) ? input : null;
  if (!args && raw.trim()) {
    try { const parsed = JSON.parse(raw); if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) args = parsed; } catch (_) {}
  }
  const wrapped = /^[\s]*[\[{]/.test(raw);
  const pick = keys => {
    for (const key of keys) {
      if (args && typeof args[key] === 'string' && args[key].trim()) return args[key];
      // Partial streams may already contain complete description fields.
      if (!args && wrapped) {
        const match = raw.match(new RegExp('"' + key + '"\\s*:\\s*("(?:[^"\\\\]|\\\\.)*")'));
        if (match) { try { const value = JSON.parse(match[1]); if (value.trim()) return value; } catch (_) {} }
      }
    }
    return '';
  };
  const isCommand = ['bash','pwsh','shell','exec','execcommand','terminal','terminalsend','writestdin'].includes(n);
  let label = !name || n === 'tool' ? uiText('工具调用') : name, keys = ['description','title','path','file_path','query','url'];
  if (isCommand) { label = uiText('运行命令'); keys = ['description','command','cmd','text','chars']; }
  else if (['read','readfile','viewimage','readimage'].includes(n)) { label = uiText('读取文件'); keys = ['path','file_path','filePath']; }
  else if (['write','writefile'].includes(n)) { label = uiText('写入文件'); keys = ['path','file_path','filePath']; }
  else if (['edit','editfile','applypatch','strreplaceeditor'].includes(n)) { label = uiText('修改文件'); keys = ['path','file_path','filePath','description']; }
  else if (['grep','search','glob','find','websearch'].includes(n)) { label = uiText('搜索'); keys = ['query','pattern','url']; }
  else if (['webfetch','fetch'].includes(n)) { label = uiText('读取网页'); keys = ['url']; }
  else if (['runcode','code','python'].includes(n)) { label = uiText('运行代码'); keys = ['description','code']; }
  let detail = pick(keys);
  // DSH's PartialArguments shows description text before the JSON is complete.
  if (!detail && !args && wrapped) {
    const match = raw.match(/"description"\s*:\s*"((?:[^"\\]|\\.)*)$/);
    if (match) {
      const partial = match[1].replace(/\\(?:u[0-9a-f]{0,3})?$/i, '');
      try { detail = JSON.parse('"' + partial + '"'); } catch (_) {}
    }
  }
  if (!detail && args && Array.isArray(args.queries)) detail = args.queries.filter(v => typeof v === 'string').join('、');
  if (!detail && !wrapped && !args) detail = raw;
  detail = detail.split(/\r?\n/)[0].trim().slice(0,240);
  const commandText = isCommand ? pick(['command','cmd','text','chars']) || (!wrapped && !args ? raw : '') : '';
  const cwd = isCommand ? pick(['workdir','cwd','workingDirectory','working_directory']) || sessionCwd || '' : '';
  return { label, detail, isCommand, commandText, commandLines: commandText ? commandText.split(/\r?\n/).map((text,index)=>({index,text})) : [], cwd, cwdLabel: cwd ? cwd.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || cwd : '' };
}
module.exports = { toolPresentation };
