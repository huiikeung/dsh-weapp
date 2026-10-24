#!/usr/bin/env node
// ============================================================
//  监听 miniprogram/ 文件变化 → 自动推送预览到手机
//  用法:  node scripts/watch-preview.cjs
//  依赖:  微信开发者工具（已登录、服务端口开启），纯 Node 无第三方依赖
// ============================================================
'use strict';

const { spawn } = require('node:child_process');
const { watch } = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const WATCH_DIR = path.join(ROOT, 'miniprogram');
const CLI = '/Applications/wechatwebdevtools.app/Contents/MacOS/cli';
const DEBOUNCE_MS = 2000; // 变更防抖：最后一次改动 2s 后推送
// 忽略噪音文件，避免无意义的重复推送
const IGNORE = /(^|[\\/])(\.git|node_modules)([\\/]|$)|\.DS_Store$|~$|\.log$/;

let timer = null;
let pushing = false;
let pending = false;

function ts() {
  return new Date().toLocaleTimeString('zh-CN', { hour12: false });
}

function push(reason) {
  if (pushing) { pending = true; return; } // 正在推送时合并为一次后续推送
  pushing = true;
  console.log(`[${ts()}] 变更（${reason}）→ 推送预览…`);
  const child = spawn(CLI, ['auto-preview', '--project', ROOT], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  child.on('close', (code) => {
    const key = out.split('\n').filter((l) => /✔|✖|error|AppID/i.test(l));
    if (key.length) console.log(key.map((l) => `  ${l.trim()}`).join('\n'));
    console.log(code === 0
      ? `[${ts()}] ✓ 预览已推送到手机（微信扫码账号）`
      : `[${ts()}] ✖ 推送失败（exit ${code}），检查 IDE 是否打开且已登录`);
    pushing = false;
    if (pending) { pending = false; push('推送期间的合并变更'); }
  });
}

function schedule(file) {
  if (!file || IGNORE.test(file)) return;
  clearTimeout(timer);
  timer = setTimeout(() => push(path.relative(ROOT, file)), DEBOUNCE_MS);
}

try {
  watch(WATCH_DIR, { recursive: true }, (_event, file) => schedule(file));
} catch (err) {
  console.error(`无法监听 ${WATCH_DIR}:`, err.message);
  process.exit(1);
}

console.log(`👀 监听中: ${WATCH_DIR}`);
console.log('   保存改动约 2s 后自动推送预览到手机，Ctrl+C 退出');
push('启动初始推送');
