const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { identityBadge } = require('../miniprogram/pages/settings/utils/identity-badge');

const root = path.join(__dirname, '..', 'miniprogram', 'pages', 'settings');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('identity badge shows neutral authorization state and verified admin status', () => {
  assert.equal(identityBadge(null), '待识别');
  assert.equal(identityBadge({ isAdmin: true, publicAccess: true }), '管理员');
  assert.equal(identityBadge({ isAdmin: false, publicAccess: true }), '已授权');
  assert.equal(identityBadge({ isAdmin: false, publicAccess: false }), '未授权');
  assert.equal(identityBadge({ isAdmin: false }), '未授权');
  assert.equal(identityBadge({ isAdmin: false, publicAccess: true }, value => `translated:${value}`), 'translated:已授权');
});

test('non-admin node permission is a passive badge while admins retain the management entry', () => {
  const markup = read('settings.wxml');
  const styles = read('settings.wxss');
  assert.match(markup, /ui\['节点权限'\]/);
  assert.doesNotMatch(markup, /ui\['节点身份'\]/);
  assert.match(markup, /wx:if="\{\{accountIdentityReady\}\}"[\s\S]*?wx:if="\{\{isWechatAdmin\}\}"[^>]*bindtap="openAdminSheet"/);
  assert.match(markup, /wx:else class="card-row management-entry identity-entry"(?![^>]*bindtap)[\s\S]*?class="identity-badge"/);
  assert.match(markup, /class="identity-badge is-admin">\{\{identityBadgeLabel\}\}<\/view>/);
  assert.match(styles, /\.identity-badge\s*\{[^}]*font-size:\s*21rpx/);
});
