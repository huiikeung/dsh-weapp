// Mirrors DSH's durable turn-deliverables contract; never infer files from prose.
const record = value => value && typeof value === 'object' && !Array.isArray(value);
const pathValue = value => typeof value === 'string' && value.trim() ? value : null;
const count = value => Number.isSafeInteger(value) && value >= 0;

function mutationPath(name, raw) {
  let args;
  try { args = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (_) { return null; }
  if (!record(args)) return null;
  if (name === 'write') return typeof args.content === 'string' ? pathValue(args.file_path) : null;
  if (name === 'edit') return typeof args.old_string === 'string' && args.old_string.length > 0 &&
    typeof args.new_string === 'string' && args.old_string !== args.new_string &&
    (args.replace_all === undefined || typeof args.replace_all === 'boolean') ? pathValue(args.file_path) : null;
  if (name !== 'str_replace_editor') return null;
  const path = pathValue(args.path);
  if (!path) return null;
  if (args.command === 'create' && typeof args.file_text === 'string') return path;
  if (args.command === 'str_replace' && typeof args.old_str === 'string' && args.old_str.length &&
    (args.new_str === undefined || typeof args.new_str === 'string')) return path;
  if (args.command === 'insert' && count(args.insert_line) && typeof args.new_str === 'string') return path;
  return null;
}

function validSummary(value, turn) {
  return !!(record(value) && Number.isSafeInteger(value.turn) && value.turn > 0 &&
    (turn === undefined || value.turn === turn) && count(value.total) && count(value.added) && count(value.deleted) &&
    Array.isArray(value.files) && value.files.length <= value.total && value.files.every(file =>
      record(file) && pathValue(file.path) && pathValue(file.display) && count(file.added) && count(file.deleted) &&
      (file.binary === undefined || file.binary === true) && (file.oversized === undefined || file.oversized === true)));
}

function validDiff(value) {
  return !!(record(value) && pathValue(value.path) && pathValue(value.display) &&
    (value.kind === 'binary' || value.kind === 'oversized' || value.kind === 'text' &&
      typeof value.before === 'boolean' && typeof value.after === 'boolean' && typeof value.coarse === 'boolean' &&
      Array.isArray(value.hunks) && value.hunks.every(hunk => record(hunk) &&
        [hunk.oldStart, hunk.oldLines, hunk.newStart, hunk.newLines].every(count) &&
        Array.isArray(hunk.lines) && hunk.lines.every(line => typeof line === 'string' && /^[+ -]/.test(line)))));
}

module.exports = { mutationPath, validSummary, validDiff };
