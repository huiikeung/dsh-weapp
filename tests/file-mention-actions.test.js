const test = require('node:test');
const assert = require('node:assert/strict');
const composerMenu = require('../miniprogram/utils/composer-menu');
const createActions = require('../miniprogram/pages/session/file-mention-actions');
const util = require('../miniprogram/utils/util');

test('@ candidate list includes recent conversations and direct subagents while excluding the current and blank sessions', async () => {
  const store = {
    sessionState: { sessionId: 'current' },
    state: {
      connection: 'connected',
      sessions: [
        { sessionId: 'current', title: 'Current', cwd: '/repo' },
        { sessionId: 'other', title: 'Other chat', cwd: '/repo', updatedAt: Date.now() - 60000 },
        { sessionId: 'child', title: 'Direct child', cwd: '/repo', parentSessionId: 'current', updatedAt: Date.now() },
        { sessionId: 'archived', title: 'Archived' },
        { sessionId: 'blank', title: 'Blank', blank: true }
      ]
    },
    client: { requestFileList: () => Promise.resolve({ entries: [{ name: 'readme.md', kind: 'file' }] }) }
  };
  const actions = createActions({ store, composerMenu, uiText: key => key });
  const page = {
    data: { tab: 'conversation', draft: '@', images: [] },
    setData(patch) { Object.assign(this.data, patch); },
    setComposerValue(value, patch) { this.composerValue = value; Object.assign(this.data, patch); },
    syncCommandMenu() {},
    closeFileMention: actions.closeFileMention,
    ...actions
  };

  page.trackFileMention('@', 1);
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(page.data.fileMentionSessionGroups.map(group => [group.key, group.items.map(item => item.id)]), [
    ['subagents', ['child']], ['sessions', ['other', 'archived']]
  ]);
  assert.equal(page.data.fileMentionEntries[0].iconFile, 'menu-chat-file.svg');

  page.selectSessionMention({ currentTarget: { dataset: { id: 'other', title: 'Other chat' } } });
  assert.equal(page.composerValue, '@[Other chat](dsh-session:' + util.encodeBase64URL(JSON.stringify('other')) + ')');
  assert.equal(page.data.fileMentionOpen, false);
});

test('quoted paths and drilled paths suppress session candidates while file candidates remain available', async () => {
  const store = {
    sessionState: { sessionId: 'current' },
    state: { connection: 'connected', sessions: [{ sessionId: 'other', title: 'Other chat' }] },
    client: { requestFileList: () => Promise.resolve({ entries: [{ name: 'file.txt', kind: 'file' }] }) }
  };
  const actions = createActions({ store, composerMenu, uiText: key => key });
  const page = {
    data: { tab: 'conversation', draft: '@"file', images: [] },
    setData(patch) { Object.assign(this.data, patch); },
    setComposerValue(value, patch) { this.composerValue = value; Object.assign(this.data, patch); },
    syncCommandMenu() {}, ...actions
  };
  page.trackFileMention('@"file', 6);
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(page.data.fileMentionSessionGroups, []);
  assert.equal(page.data.fileMentionEntries[0].iconFile, 'menu-chat-file.svg');
});
