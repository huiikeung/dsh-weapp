// 主包体积/代码质量：dsh-switch 只被子包使用，主包放置会被微信判定
// 「主包内不应存在主包未使用的组件」。以 resources 为唯一源，编译前同步到各子包。
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const SOURCE = path.join(root, 'resources/components/dsh-switch');
const TARGETS = ['pages/settings', 'pages/plugins', 'pages/cost-meter', 'pages/plugin-detail'];
const FILES = ['dsh-switch.js', 'dsh-switch.json', 'dsh-switch.wxml', 'dsh-switch.wxss'];

function build() {
  for (const target of TARGETS) {
    const dir = path.join(root, 'miniprogram', target, 'components/dsh-switch');
    fs.mkdirSync(dir, { recursive: true });
    for (const name of FILES) {
      let content = fs.readFileSync(path.join(SOURCE, name), 'utf8');
      // 子包内深两层：pages/<pkg>/components/dsh-switch -> ../../../../utils/theme
      if (name.endsWith('.js')) content = content.replace("require('../../utils/theme')", "require('../../../../utils/theme')");
      const out = path.join(dir, name);
      if (!fs.existsSync(out) || fs.readFileSync(out, 'utf8') !== content) fs.writeFileSync(out, content);
    }
  }
}

if (require.main === module) build();
module.exports = { build, TARGETS, FILES };
