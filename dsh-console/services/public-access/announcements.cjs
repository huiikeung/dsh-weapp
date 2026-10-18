'use strict';
const crypto = require('node:crypto');
const fail = (status, code, message) => Object.assign(new Error(message), { status, code });
const uuid = /^[a-f0-9-]{36}$/;
function createAnnouncements({ getState, commit, now }) {
  const state = () => getState().announcements || { items: [] };
  const valid = item => item && uuid.test(item.id) && typeof item.title === 'string' && item.title.trim().length > 0 && item.title.length <= 60 &&
    typeof item.content === 'string' && item.content.trim().length > 0 && item.content.length <= 3000 &&
    Number.isSafeInteger(item.revision) && item.revision > 0 && Number.isSafeInteger(item.createdAt) && Number.isSafeInteger(item.updatedAt);
  if (!Array.isArray(state().items) || state().items.length > 100 || state().items.some(item => !valid(item)) || new Set(state().items.map(x => x.id)).size !== state().items.length) throw new Error('Invalid announcement state; refusing to discard content');
  function list() { return { items: state().items.slice().sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id)).map(x => ({ ...x })) }; }
  function save(input) {
    if (typeof input.title !== 'string' || !input.title.trim() || input.title.length > 60 || typeof input.content !== 'string' || !input.content.trim() || input.content.length > 3000) throw fail(400, 'INVALID_ANNOUNCEMENT', '标题为 1–60 字，正文为 1–3000 字');
    if (input.id !== undefined && (typeof input.id !== 'string' || !uuid.test(input.id))) throw fail(400, 'INVALID_ANNOUNCEMENT', '公告标识无效');
    return commit(next => {
      next.announcements ||= { items: [] };
      const items = next.announcements.items;
      const old = input.id ? items.find(x => x.id === input.id) : null;
      if (input.id && !old) throw fail(404, 'NOT_FOUND', '公告已删除，请刷新列表');
      if (old && input.revision !== old.revision) throw fail(409, 'CONTENT_CONFLICT', '公告已在另一端修改，请刷新后再编辑');
      if (!old && items.length >= 100) throw fail(409, 'ANNOUNCEMENT_LIMIT', '最多保留 100 条公告，请先删除旧公告');
      const record = { id: old ? old.id : crypto.randomUUID(), title: input.title.trim(), content: input.content.trim(),
        createdAt: old ? old.createdAt : now(), updatedAt: now(), revision: old ? old.revision + 1 : 1 };
      if (old) items[items.indexOf(old)] = record; else items.push(record);
      return { item: record };
    });
  }
  function remove(id, revision) {
    return commit(next => {
      const item = (next.announcements?.items || []).find(x => x.id === id);
      if (!item) throw fail(404, 'NOT_FOUND', '公告不存在或已删除');
      if (revision !== item.revision) throw fail(409, 'CONTENT_CONFLICT', '公告已在另一端修改，请刷新后确认');
      next.announcements.items = next.announcements.items.filter(x => x.id !== id);
      return { ok: true };
    });
  }
  return { list, save, remove };
}
module.exports = { createAnnouncements };
