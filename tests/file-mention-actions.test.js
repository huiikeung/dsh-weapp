const test = require('node:test');
const assert = require('node:assert/strict');
const composerMenu = require('../miniprogram/pages/session/utils/composer-menu');
const createActions = require('../miniprogram/pages/session/file-mention-actions');
const util = require('../miniprogram/utils/util');

// 与 session.js 的同名方法保持同一套语义：composerValue 是 textarea 显示值
// （引用位置为零宽占位符），draft 保存原始引用文本，composerRefs 是 chip 行数据。
function mockPage(actions, data) {
  return {
    data: Object.assign({ tab: 'conversation', draft: '', images: [] }, data),
    setData(patch) { Object.assign(this.data, patch); },
    composerDisplay() { return this._composerDisplay == null ? String(this.data.composerValue || '') : this._composerDisplay; },
    setComposerValue(value, patch) {
      const { display, refs } = composerMenu.referencesToDisplay(value);
      this._composerDisplay = display;
      this.composerValue = display;
      this.data.draft = value;
      this.data.composerRefs = composerMenu.referenceChips(refs);
      Object.assign(this.data, patch);
    },
    setComposerDisplay(display, refs, patch, slash) {
      this._composerDisplay = String(display == null ? '' : display);
      this.composerValue = this._composerDisplay;
      this.data.composerRefs = refs;
      const body = composerMenu.displayToDraft(this._composerDisplay, refs);
      this.data.draft = slash ? slash.token + ' ' + body : body;
      Object.assign(this.data, patch);
    },
    // 与 session.js 同名方法同语义：当前草稿对应的指令 token（mock 无指令目录时为 null）。
    composerSlash(raw) {
      const text = String(raw == null ? this.data.draft || '' : raw);
      const groups = this.data.commandGroups;
      return composerMenu.presentation(text, composerMenu.commands(Array.isArray(groups) ? groups : []));
    },
    syncCommandMenu() {}
  };
}

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
  const page = Object.assign(mockPage(actions), { closeFileMention: actions.closeFileMention }, actions);

  page.trackFileMention('@', 1);
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(page.data.fileMentionSessionGroups.map(group => [group.key, group.items.map(item => item.id)]), [
    ['subagents', ['child']], ['sessions', ['other', 'archived']]
  ]);
  assert.equal(page.data.fileMentionEntries[0].iconFile, 'menu-chat-file.svg');

  page.selectSessionMention({ currentTarget: { dataset: { id: 'other', title: 'Other chat' } } });
  // 草稿保存原始引用文本；显示值只留一个零宽占位符；chip 行带图标和标题。
  assert.equal(page.data.draft, '@[Other chat](dsh-session:' + util.encodeBase64URL(JSON.stringify('other')) + ')');
  assert.equal(page.composerValue, composerMenu.REF_PLACEHOLDER);
  assert.deepEqual(page.data.composerRefs.map(ref => [ref.kind, ref.label, ref.icon]), [['session', 'Other chat', 'menu-chat-session-blue.svg']]);
  assert.equal(page.data.fileMentionOpen, false);
});

test('quoted paths and drilled paths suppress session candidates while file candidates remain available', async () => {
  const store = {
    sessionState: { sessionId: 'current' },
    state: { connection: 'connected', sessions: [{ sessionId: 'other', title: 'Other chat' }] },
    client: { requestFileList: () => Promise.resolve({ entries: [{ name: 'file.txt', kind: 'file' }] }) }
  };
  const actions = createActions({ store, composerMenu, uiText: key => key });
  const page = Object.assign(mockPage(actions, { draft: '@"file' }), actions);
  page.trackFileMention('@"file', 6);
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(page.data.fileMentionSessionGroups, []);
  assert.equal(page.data.fileMentionEntries[0].iconFile, 'menu-chat-file.svg');
});

test('picked files become inline chips while drilled folders stay literal until a file is chosen', async () => {
  const store = {
    sessionState: { sessionId: 'current' },
    state: { connection: 'connected', sessions: [] },
    client: {
      requestFileList: (id, directory) => Promise.resolve({
        path: directory || '.',
        entries: directory === 'src' ? [{ name: 'a file.js', path: 'src/a file.js', kind: 'file' }]
          : [{ name: 'src', path: 'src', kind: 'dir' }]
      })
    }
  };
  const actions = createActions({ store, composerMenu, uiText: key => key });
  const page = Object.assign(mockPage(actions, { draft: 'Review @' }), actions);
  page.trackFileMention('Review @', 8);
  await Promise.resolve();
  await Promise.resolve();

  page.drillFileMention({ currentTarget: { dataset: { index: 0 } } });
  // 半开引用 token 保持字面文本，@ 菜单继续列出目录内容。
  assert.equal(page.composerValue, 'Review @src/');
  assert.equal(page.data.draft, 'Review @src/');
  assert.deepEqual(page.data.composerRefs, []);
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(Array.from(page.data.fileMentionEntries, row => row.name), ['a file.js']);

  page.selectFileMention({ currentTarget: { dataset: { index: 0 } } });
  // 选中文件后换成零宽占位符 + chip，草稿里是带引号的完整引用。
  assert.equal(page.composerValue, 'Review ' + composerMenu.REF_PLACEHOLDER);
  assert.equal(page.data.draft, 'Review @"src/a file.js"');
  assert.deepEqual(page.data.composerRefs.map(ref => [ref.kind, ref.label, ref.icon]), [['file', 'src/a file.js', 'menu-chat-file-blue.svg']]);
});

test('selecting two references back to back keeps both as chips without a space', async () => {
  const store = {
    sessionState: { sessionId: 'current' },
    state: { connection: 'connected', sessions: [{ sessionId: 'other', title: 'Other chat', cwd: '/repo', updatedAt: Date.now() }] },
    client: { requestFileList: () => Promise.resolve({ entries: [{ name: 'a.txt', path: 'a.txt', kind: 'file' }] }) }
  };
  const actions = createActions({ store, composerMenu, uiText: key => key });
  const page = Object.assign(mockPage(actions), actions);
  // 第一个引用：会话
  page.trackFileMention('@', 1);
  await Promise.resolve();
  await Promise.resolve();
  page.selectSessionMention({ currentTarget: { dataset: { id: 'other', title: 'Other chat' } } });
  assert.equal(page.data.composerRefs.length, 1);
  // 紧接着选第二个引用（中间不打空格）：@ 紧跟占位符也要能开菜单
  page.trackFileMention(page.composerDisplay() + '@', page.composerDisplay().length + 1);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(page.data.fileMentionOpen, true, 'typing @ right after a chip opens the menu again');
  page.selectFileMention({ currentTarget: { dataset: { index: 0 } } });
  // 两个引用都应该是 chip，草稿里是两个相邻的原始引用
  assert.deepEqual(page.data.composerRefs.map(ref => [ref.kind, ref.label]), [['session', 'Other chat'], ['file', 'a.txt']]);
  assert.equal(page.composerValue, composerMenu.REF_PLACEHOLDER + composerMenu.REF_PLACEHOLDER);
  assert.equal(page.data.draft, composerMenu.sessionReference('other', 'Other chat') + composerMenu.fileReference('a.txt'));
});
