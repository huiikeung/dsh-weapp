#!/usr/bin/env bash
# 手动运行 ASCF 元服务的单元/回归测试（不依赖 DevEco）。
# 用法：bash scripts/ascf-test.sh        （在仓库根目录或任意目录执行均可）
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
# 目录形式在部分 Node 版本会被当成模块解析（MODULE_NOT_FOUND），这里显式展开文件列表。
shopt -s nullglob
FILES=(harmonyos/atomic-service/tests/*.test.js)
if [ ${#FILES[@]} -eq 0 ]; then
  echo "未找到测试文件" >&2
  exit 1
fi
echo "运行 ${#FILES[@]} 个测试文件..."
node --test "${FILES[@]}"
