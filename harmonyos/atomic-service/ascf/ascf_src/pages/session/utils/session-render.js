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
      // Move the live tail in one setData patch without resending old history.
      if (after.length < before.length) { patch[key] = after; return; }
      after.forEach((item, i) => {
        if (before[i] && before[i].key != null && (!item || item.key !== before[i].key)) patch[key + '[' + i + ']'] = item;
        else visit(before[i], item, key + '[' + i + ']');
      });
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

function createMarkdownCache(parse, seed) {
  const entries = new Map(seed || []);
  return {
    textSnapshot() {
      return new Map([...entries].filter(([, value]) =>
        !value.blocks.some(block => block.type === 'image')));
    },
    peek(key, text) {
      const cached = entries.get(key);
      return cached && cached.text === text ? cached.blocks : null;
    },
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
