'use strict';

const fs = require('node:fs');

const candidates = [
  process.env.WECHAT_WCC,
  'D:/Program Files (x86)/Tencent/微信web开发者工具/resources/app.asar.unpacked/node_modules/wcc-exec/wcc.exe',
].filter(Boolean);

module.exports = candidates.find(candidate => fs.existsSync(candidate)) || null;
