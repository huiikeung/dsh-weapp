'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const bundle = path.join(root, 'dsh-console');

test('server bundle stays separate from miniapp and retains Compose build contexts', () => {
  for (const directory of ['deploy', 'services', 'relay']) {
    assert.ok(fs.statSync(path.join(bundle, directory)).isDirectory());
    assert.equal(fs.existsSync(path.join(root, directory)), false);
  }
  const config = JSON.parse(fs.readFileSync(path.join(root, 'project.config.json'), 'utf8'));
  assert.equal(config.miniprogramRoot, 'miniprogram/');
  assert.equal(fs.existsSync(path.join(root, config.miniprogramRoot, 'dsh-console')), false);
  const compose = fs.readFileSync(path.join(bundle, 'deploy/compose.yaml'), 'utf8');
  const contexts = [...compose.matchAll(/^      context: (.+)$/gm)].map(match => match[1]);
  assert.deepEqual(contexts, ['../services/public-access', '../relay']);
  for (const context of contexts) {
    const directory = path.resolve(bundle, 'deploy', context);
    for (const file of ['Dockerfile', 'package.json', 'package-lock.json']) {
      assert.ok(fs.existsSync(path.join(directory, file)), context + '/' + file);
    }
  }
  assert.match(compose, /^name: dsh-public$/m);
  for (const volume of ['console-data', 'relay-data', 'caddy-data', 'caddy-config']) {
    assert.ok(compose.includes('name: dsh-public-' + volume));
  }
});

test('relocated secrets and runtime files remain excluded from Git', () => {
  const files = ['deploy/.env', 'services/public-access/.env', 'services/public-access/data/state.json',
    'services/public-access/node_modules/example/index.js', 'relay/node_modules/ws/index.js',
    'relay/relay-state.json', 'relay/connector.log'].map(file => 'dsh-console/' + file);
  const ignored = execFileSync('git', ['check-ignore', '--no-index', '--', ...files], { cwd: root, encoding: 'utf8' });
  assert.deepEqual(ignored.trim().split(String.fromCharCode(10)), files);
});
