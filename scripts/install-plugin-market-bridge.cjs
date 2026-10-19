'use strict';
// Optional deployment bridge. Does not change profiles, install packages, or restart DSH.
const fs = require('node:fs');
const path = require('node:path');
function replaceOne(source, before, after) {
  if (source.includes(after)) return source;
  if (source.indexOf(before) < 0 || source.indexOf(before) !== source.lastIndexOf(before)) throw new Error('Unrecognized gateway source; no files changed');
  return source.replace(before, after);
}
function adapter(source) {
  return replaceOne(source, '    plugins: {', `    pluginMarket: {
      listIndexes: () => invoke('pluginMarket', 'listIndexes', {}),
      setIndexes: (urls) => invoke('pluginMarket', 'setIndexes', { urls }),
      search: (url, query) => invoke('pluginMarket', 'search', { url, query }),
    },
    plugins: {`);
}
function management(source) {
  // Normalize our previous/new bridge variant before applying the idempotent base patch.
  const oldSearch = "      value = await api.pluginMarket.search(msg.url, { offset: query.offset, limit: query.limit, sort: { kind: 'index' }, ...(query.text ? { text: query.text } : {}), ...(query.fetchedAt === undefined ? {} : { fetchedAt: query.fetchedAt }) })";
  const newSearch = "      if (query.category !== undefined && !nonempty(query.category, 2048)) return badRequest(type, requestId, 'invalid category')\n" + oldSearch.replace("...(query.text ?", "...(query.category === undefined ? {} : { category: query.category }), ...(query.text ?");
  if (source.includes(newSearch)) source = source.replace(newSearch, oldSearch);
  source = replaceOne(source, "  'plugin-catalog',\n", "  'plugin-catalog',\n  'plugin-market-indexes',\n  'plugin-market-set-indexes',\n  'plugin-market-search',\n");
  source = replaceOne(source, "    if (type === 'plugin-catalog') {", `    if (type === 'plugin-market-indexes') {
      value = await api.pluginMarket.listIndexes()
    } else if (type === 'plugin-market-set-indexes') {
      if (!Array.isArray(msg.urls) || msg.urls.length > 100 || msg.urls.some(url => !nonempty(url, 2048))) return badRequest(type, requestId, 'urls must be an array of index URLs')
      // Host validates and normalizes new URLs and preserves existing invalid sources for removal.
      await api.pluginMarket.setIndexes(msg.urls)
      value = { saved: true }
    } else if (type === 'plugin-market-search') {
      if (!nonempty(msg.url, 2048) || !record(msg.query)) return badRequest(type, requestId, 'url and query are required')
      const query = msg.query
      if (!Number.isSafeInteger(query.offset) || query.offset < 0 || !Number.isInteger(query.limit) || query.limit < 1 || query.limit > 100 || (query.text !== undefined && (typeof query.text !== 'string' || query.text.length > 2048))) return badRequest(type, requestId, 'invalid market query')
      if (!record(query.sort) || query.sort.kind !== 'index') return badRequest(type, requestId, 'unsupported sort')
      if (query.fetchedAt !== undefined && (typeof query.fetchedAt !== 'number' || !Number.isFinite(query.fetchedAt))) return badRequest(type, requestId, 'invalid fetchedAt')
      value = await api.pluginMarket.search(msg.url, { offset: query.offset, limit: query.limit, sort: { kind: 'index' }, ...(query.text ? { text: query.text } : {}), ...(query.fetchedAt === undefined ? {} : { fetchedAt: query.fetchedAt }) })
    } else if (type === 'plugin-catalog') {`);
  return replaceOne(source, oldSearch, newSearch);
}
function install(root, checkOnly) {
  if (!root || !path.isAbsolute(root)) throw new Error('An absolute gateway package directory is required');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  if (!['dsh-plugin-mobile-gateway', 'dsh-plugin-weapp-gateway'].includes(manifest.name)) throw new Error('Not a supported gateway package');
  const edits = [['lib/dsh-host-adapter.mjs', adapter], ['lib/plugin-management.mjs', management]].map(([file, transform]) => {
    const target = path.join(root, file), original = fs.readFileSync(target, 'utf8');
    return { target, original, updated: transform(original) };
  }).filter(x => x.original !== x.updated);
  if (checkOnly) return { compatible: true, files: edits.map(x => x.target) };
  const stamp = Date.now();
  for (const edit of edits) fs.writeFileSync(edit.target + '.before-market-' + stamp, edit.original, { flag: 'wx' });
  const applied = [];
  try { for (const edit of edits) { applied.push(edit); fs.writeFileSync(edit.target, edit.updated); } }
  catch (error) { for (const edit of applied) fs.writeFileSync(edit.target, edit.original); throw error; }
  return { updated: edits.length, restartRequired: edits.length > 0 };
}
if (require.main === module) {
  try { console.log(JSON.stringify(install(process.argv[2], process.argv.includes('--check')), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { adapter, management, install };
