// 上下文/编队/洞察改造后的结构完整性守卫：
// 1) 页面里所有事件绑定都能在页面 JS（含拆分 actions）里找到同名方法；
// 2) 大文件 WXML 标签配平（改造时最容易漏闭合）；
// 3) app.json 注册的每个页面都有 .js/.wxml/.json；
// 4) 上下文/编队/弹窗用到的 class 至少有一个 wxss 定义（含 @import 链）。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', 'miniprogram');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const SESSION_FILES = ['pages/session/session.wxml'];
const PAGE_SCRIPTS = {
  'pages/session/session.wxml': ['pages/session/session.js', 'pages/session/changes-actions.js', 'pages/session/file-actions.js', 'pages/session/voice-actions.js', 'pages/session/viewport-actions.js', 'pages/session/image-blocks.js'],
  'pages/insights/insights.wxml': ['pages/insights/insights.js'],
  'pages/settings/settings.wxml': ['pages/settings/settings.js']
};

// WXML 组件允许自闭合；只把编译器内置的声明式标签视为 void，其余必须成对。
const VOID_TAGS = new Set(['import', 'include', 'wxs']);

function boundHandlers(text) {
  const names = new Set();
  for (const match of text.matchAll(/(?:bind|catch)(?:tap|input|change|confirm|blur|longpress|scroll|touchstart|touchmove|touchend|touchcancel|submit|focus|load|error)="([a-zA-Z_][\w]*)"/g)) names.add(match[1]);
  return names;
}

function definedHandlers(sources) {
  const defined = new Set();
  for (const source of sources) {
    for (const match of source.matchAll(/\b([a-zA-Z_][\w]*)\s*\([^)]*\)\s*\{/g)) defined.add(match[1]);
    for (const match of source.matchAll(/\n\s{2}([a-zA-Z_][\w]*):\s*(?:async\s*)?(?:function|\()/g)) defined.add(match[1]);
  }
  return defined;
}

test('every event binding on the touched pages resolves to a page method', () => {
  for (const [wxmlFile, scripts] of Object.entries(PAGE_SCRIPTS)) {
    const handlers = boundHandlers(read(wxmlFile));
    const defined = definedHandlers(scripts.map(read));
    const missing = [...handlers].filter(name => !defined.has(name));
    assert.deepEqual(missing, [], wxmlFile + ' binds unknown handlers: ' + missing.join(', '));
  }
});

test('touched WXML files keep their tags balanced', () => {
  for (const file of ['pages/session/session.wxml', 'pages/insights/insights.wxml', 'pages/settings/settings.wxml']) {
    let text = read(file).replace(/<!--[\s\S]*?-->/g, '');
    text = text.replace(/\{\{[\s\S]*?\}\}/g, 'X');
    const stack = [];
    for (const match of text.matchAll(/<\/?([a-zA-Z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g)) {
      const [raw, tag, , selfClose] = match;
      if (raw.startsWith('</')) {
        const open = stack.pop();
        assert.equal(open, tag, file + ': closing </' + tag + '> does not match <' + open + '>');
      } else if (selfClose !== '/' && !VOID_TAGS.has(tag)) {
        stack.push(tag);
      }
    }
    assert.deepEqual(stack, [], file + ' leaves unclosed tags: ' + stack.join(', '));
  }
});

test('every registered page has its four runtime files', () => {
  const app = JSON.parse(read('app.json'));
  const routes = app.pages.concat((app.subPackages || []).flatMap(pkg => pkg.pages.map(page => pkg.root + '/' + page)));
  for (const route of routes) {
    for (const ext of ['.js', '.wxml', '.json']) {
      assert.ok(fs.existsSync(path.join(root, route + ext)), route + ext + ' is missing');
    }
  }
  for (const pkg of app.subPackages || []) {
    assert.ok(!app.pages.some(page => page.startsWith(pkg.root + '/')), pkg.root + ' must not also live in the main package');
  }
});

test('context, fleet, modal and insights class names all have a definition', () => {
  const cssFiles = [];
  for (const dir of ['pages/session', 'pages/insights', 'pages/settings']) {
    for (const file of fs.readdirSync(path.join(root, dir))) {
      if (file.endsWith('.wxss')) cssFiles.push(read(path.join(dir, file)));
    }
  }
  // Follow the @import chain once so shared chrome (trajectory/proc-icon/status) counts.
  for (const file of fs.readdirSync(path.join(root, 'styles'))) {
    if (file.endsWith('.wxss')) cssFiles.push(read(path.join('styles', file)));
  }
  cssFiles.push(read('app.wxss'));
  const css = cssFiles.join('\n');
  const literalClasses = (file) => {
    const set = new Set();
    for (const match of read(file).matchAll(/class="([^"]+)"/g)) {
      const literal = match[1].replace(/\{\{[\s\S]*?\}\}/g, ' ');
      for (const token of literal.split(/\s+/)) {
        if (!token || !/^[a-zA-Z][\w-]*$/.test(token) || token.endsWith('-')) continue;
        set.add(token);
      }
    }
    return set;
  };
  const scopes = [
    ['pages/session/session.wxml', ['pages/session/session.wxss', 'styles/trajectory.wxss', 'styles/proc-icon.wxss', 'styles/status-appearance.wxss', 'app.wxss']],
    ['pages/insights/insights.wxml', ['pages/insights/insights.wxss', 'app.wxss']],
  ];
  for (const [wxmlFile, cssScope] of scopes) {
    const scope = cssScope.map(read).join('\n');
    const missing = [...literalClasses(wxmlFile)]
      .filter(name => /^(ctx-|fleet-|ins-)/.test(name))
      .filter(name => scope.indexOf('.' + name) < 0);
    assert.deepEqual(missing, [], wxmlFile + ' uses undefined classes: ' + missing.join(', '));
  }
});
