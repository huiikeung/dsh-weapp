'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildGroups, UNGROUPED_KEY } = require('../miniprogram/pages/session/utils/conversation-sidebar');

const text = (value) => ({ 工作区: 'Workspace', 未分组: 'Ungrouped', 未命名会话: 'Untitled session' }[value] || value);
const relativeTime = (ms) => (ms ? '刚刚' : '');

test('sidebar groups visible sessions by workspace and keeps an ungrouped bucket', () => {
  const result = buildGroups({
    workspaces: [
      { workspaceId: 'w1', title: 'Alpha', sessionIds: ['s1', 's3'] },
      { workspaceId: 'w2', title: '', sessionIds: ['s2'] }
    ],
    sessions: [
      { sessionId: 's1', title: '旧会话', updatedAt: 10 },
      { sessionId: 's2', title: '', updatedAt: 20, running: true },
      { sessionId: 's3', title: '新会话', updatedAt: 30 },
      { sessionId: 's4', title: '未分组会话', updatedAt: 5 },
      { sessionId: 's5', title: '空白', blank: true, updatedAt: 50 },
      { sessionId: 's6', title: '归档', updatedAt: 60 }
    ],
    archivedSessionIds: ['s6'],
    currentSessionId: 's3',
    text,
    relativeTime,
    expanded: []
  });
  assert.equal(result.groups.length, 3);
  assert.deepEqual(result.groups[0].sessions.map((s) => s.id), ['s3', 's1'], 'sorted by activity');
  assert.equal(result.groups[1].title, 'Workspace', 'falls back to localized workspace label');
  assert.equal(result.groups[1].sessions[0].title, 'Untitled session');
  assert.equal(result.groups[1].sessions[0].running, true);
  assert.equal(result.groups[2].id, UNGROUPED_KEY);
  assert.deepEqual(result.groups[2].sessions.map((s) => s.id), ['s4'], 'blank and archived sessions stay hidden');
  assert.equal(result.groups[0].containsCurrent, true);
  assert.equal(result.groups[0].sessions.find((s) => s.id === 's3').selected, true, 'current session is selected');
  assert.equal(result.groups[0].sessions.find((s) => s.id === 's1').selected, false);
  assert.equal(result.groups[0].expanded, true, 'current workspace auto expands');
  assert.deepEqual(result.expanded, ['w1']);
});

test('sidebar keeps caller expansion and toggling is persisted by the page', () => {
  const result = buildGroups({
    workspaces: [{ workspaceId: 'w1', title: 'Alpha', sessionIds: ['s1'] }],
    sessions: [{ sessionId: 's1', title: 'One', updatedAt: 1 }],
    currentSessionId: 's1',
    text,
    relativeTime,
    expanded: ['w1']
  });
  assert.deepEqual(result.expanded, ['w1'], 'no duplicate keys');
  const js = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/session/session.js'), 'utf8');
  assert.match(js, /toggleConvSidebarGroup\(e\)[\s\S]{0,700}?writeConvSidebarExpanded/);
  assert.match(js, /selectConvSidebarSession\(e\)[\s\S]{0,600}?store\.openSession\(id/);
  assert.ok(!/selectConvSidebarSession[\s\S]{0,600}?redirectTo/.test(js), 'sidebar switches sessions in place instead of reopening the page');
  assert.match(js, /\.select\(\'\.composer\'\)\.boundingClientRect\(\)[\s\S]{0,900}?composerBottom - anchorTop/);
  assert.match(js, /openConvSidebarPlugins\(\)[\s\S]{0,160}?pages\/plugins\/plugins/);
  assert.match(js, /openConvSidebarSchedule\(\)[\s\S]{0,160}?pages\/schedule\/schedule/);
  assert.match(js, /openConvSidebarSettings\(\)[\s\S]{0,160}?pages\/settings\/settings/);
});

test('session header renders the sidebar button left of the more button and the floating panel', () => {
  for (const base of ['../resources/runtime-markup/pages/session/session.wxml', '../miniprogram/pages/session/session.wxml']) {
    const wxml = fs.readFileSync(path.join(__dirname, base), 'utf8');
    const more = wxml.indexOf('class="nav-more glass-press"');
    const sidebar = wxml.indexOf('nav-sidebar glass-press');
    assert.ok(sidebar > 0 && more > sidebar, base + ': sidebar button sits left of more');
    assert.ok(wxml.includes('class="conv-sidebar {{sessionGlassEnabled ? \'conv-sidebar-glass\' : \'\'}}"'), base + ': panel toggles the glass skin');
    assert.ok(wxml.includes('convSidebarOpen ? \'is-hidden\''), base + ': button hides while the panel is open');
    assert.ok(wxml.includes('transform-origin: {{convSidebarOriginX}}px {{convSidebarOriginY}}px'), base + ': panel scales from the button anchor');
    assert.ok(wxml.includes('bindtap="toggleConversationSidebar"'));
    assert.ok(wxml.includes('bindtap="closeConversationSidebar"'));
    assert.ok(wxml.includes('bindtap="openConvSidebarPlugins"'));
    assert.ok(wxml.includes('bindtap="openConvSidebarSchedule"'));
    assert.ok(wxml.includes('bindtap="openConvSidebarSettings"'));
    assert.ok(wxml.includes('bindtap="toggleConvSidebarGroup"'));
    assert.ok(wxml.includes('bindtap="selectConvSidebarSession"'));
    assert.ok(wxml.includes("conv-sidebar-session {{session.selected ? 'selected' : ''}}"), base + ': current session is highlighted on open');
    assert.ok(wxml.includes('conv-sidebar-brand') && wxml.includes('conv-sidebar-section') && wxml.includes('conv-sidebar-footer'), base + ': panel content sections');
    assert.ok(wxml.includes("theme === 'dark' ? 'pinwheel-white.png' : 'pinwheel-ink.png'"), base + ': plugins icon matches the drawer');
    assert.ok(wxml.includes("theme === 'dark' ? 'automation-white.svg' : 'automation.svg'"), base + ': schedule icon matches the drawer');
    assert.ok(wxml.includes("item.ungrouped ? (theme === 'dark' ? 'tray-white.png' : 'tray-ink.png')"), base + ': ungrouped tray icon matches the workspace popup');
    assert.ok(wxml.includes("theme === 'dark' ? 'workspace-folder-white.svg' : 'workspace-folder-blue.svg'"), base + ': folder icon matches the workspace popup');
    assert.ok(wxml.includes("item.expanded ? 'workspace-folder-blue.svg'"), base + ': expanded folder turns blue');
  }
});

test('sidebar native and glass skins follow the composer recipe', () => {
  for (const base of ['../resources/runtime-markup/pages/session/session.wxss', '../miniprogram/pages/session/session.wxss']) {
    const css = fs.readFileSync(path.join(__dirname, base), 'utf8');
    assert.match(css, /\.conv-sidebar \{[^}]*background: var\(--surface\)/);
    const glass = css.slice(css.indexOf('.conv-sidebar.conv-sidebar-glass {'));
    assert.ok(glass.includes('var(--glass-alpha-top, 0.06)'), base + ': glass gradient');
    assert.ok(glass.includes('var(--glass-composer-edge, 0.11)'), base + ': same hairline as composer');
    assert.ok(glass.includes('var(--glass-composer-blur, 20px)'), base + ': same blur as composer');
    assert.ok(css.includes('.theme-light .conv-sidebar.conv-sidebar-glass'), base + ': light glass recipe');
    assert.ok(css.includes('.nav-sidebar-glyph-line'), base + ': header glyph');
    assert.ok(css.includes('animation: conv-sidebar-in 180ms cubic-bezier(0.2, 0.8, 0.2, 1)'), base + ': ws-pop style timing');
    const anim = css.slice(css.indexOf('@keyframes conv-sidebar-in'));
    assert.ok(anim.includes('scale(0.92)'), base + ': ws-pop style appear animation');
    assert.ok(css.includes('.nav-sidebar.is-hidden'), base + ': toggle button hides during the animation');
    assert.ok(!css.includes('.conv-sidebar-workspace.current .conv-sidebar-workspace-title'), base + ': expanded title keeps the default colour');
  }
});

test('users can collapse the current workspace and it stays collapsed', () => {
  const base = {
    workspaces: [{ workspaceId: 'w1', title: 'Alpha', sessionIds: ['s1'] }],
    sessions: [{ sessionId: 's1', title: 'One', updatedAt: 1 }],
    currentSessionId: 's1',
    text,
    relativeTime
  };
  // 首次打开：自动展开当前工作区
  const first = buildGroups(Object.assign({}, base, { expanded: [] }));
  assert.equal(first.groups[0].expanded, true);
  // 用户手动收起后重建：保持收起
  const collapsed = buildGroups(Object.assign({}, base, { expanded: [], autoExpandCurrent: false }));
  assert.equal(collapsed.groups[0].expanded, false, 'manual collapse is respected');
  assert.deepEqual(collapsed.expanded, []);
  // 再次展开其它组时不会把当前组强行加回来
  const other = buildGroups(Object.assign({}, base, { expanded: ['w2'], autoExpandCurrent: false }));
  assert.equal(other.groups[0].expanded, false);
  const js = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/session/session.js'), 'utf8');
  assert.match(js, /convSidebarData\(expandedIds, autoExpandCurrent\)/);
  assert.match(js, /const expandedIds = this\.readConvSidebarExpanded\(\)/);
  assert.match(js, /const autoExpand = true/);
  assert.match(js, /convSidebarData\(expanded, false\)/, 'toggling never force expands');
  assert.match(js, /_convSidebarOpening = true/, 'opening is guarded');
  assert.match(js, /setData\(Object\.assign\(\{ convSidebarOpen: true \}, basePatch/, 'panel is shown only after measuring its final position');
});

test('opening the panel always expands the current session group', () => {
  const js = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/session/session.js'), 'utf8');
  assert.match(js, /const autoExpand = true/);
  const base = {
    workspaces: [{ workspaceId: 'w1', title: 'Alpha', sessionIds: ['s1'] }],
    sessions: [{ sessionId: 's1', title: 'One', updatedAt: 1 }],
    currentSessionId: 's1',
    text,
    relativeTime
  };
  const reopened = buildGroups(Object.assign({}, base, { expanded: [] }));
  assert.equal(reopened.groups[0].expanded, true);
});
