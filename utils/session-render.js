// Keep unchanged history off the mini-program logic/view bridge.
function dataPatch(previous, next) {
  const patch = {};
  function visit(before, after, key) {
    if (before === after || after === undefined) return;
    if (before == null || after == null || typeof before !== 'object' || typeof after !== 'object') {
      patch[key] = after; return;
    }
    if (Array.isArray(before) !== Array.isArray(after)) { patch[key] = after; return; }
    if (Array.isArray(after)) {
      // Prepend/reorder/reset must remain atomic; streaming appends can be sparse.
      if (after.length < before.length || before.some((item, i) => item && item.key != null
        && (!after[i] || after[i].key !== item.key))) { patch[key] = after; return; }
      after.forEach((item, i) => visit(before[i], item, key + '[' + i + ']'));
      return;
    }
    const keys = Object.keys(after);
    if (Object.keys(before).some(name => !Object.prototype.hasOwnProperty.call(after, name))
      || keys.some(name => !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name))) {
      if (JSON.stringify(before) !== JSON.stringify(after)) patch[key] = after;
      return;
    }
    keys.forEach(name => visit(before[name], after[name], key + '.' + name));
  }
  Object.keys(next).forEach(key => visit(previous[key], next[key], key));
  return patch;
}

function createMarkdownCache(parse) {
  const entries = new Map();
  return {
    parse(key, text) {
      const cached = entries.get(key);
      if (cached && cached.text === text) return cached.blocks;
      const blocks = parse(text);
      entries.set(key, { text, blocks });
      return blocks;
    },
    retain(keys) {
      const alive = new Set(keys);
      entries.forEach((_value, key) => { if (!alive.has(key)) entries.delete(key); });
    }
  };
}

module.exports = { dataPatch, createMarkdownCache };
