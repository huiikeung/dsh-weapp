#!/usr/bin/env bash
# 恢复 ASCF 元服务构建配置：命令行 hvigor 打包会裁掉 build-profile.json5 里的
# 16 个 pages_* 子包模块，导致 DevEco Studio 报「目标不能为空」。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ASC_SERVICE="$ROOT/harmonyos/atomic-service"
EXPECTED=16

cd "$ROOT"
echo "[1/2] ascf compile（-c 重建 pages_* 子包模块）"
npm exec --yes --package=@atomicservice/ascf-toolkit@1.0.17 -- \
  ascf compile "$ASC_SERVICE" --disableSubpackages false -c

echo "[2/2] 校验 build-profile.json5 模块"
COUNT="$(grep -c '"name": "pages_' "$ASC_SERVICE/build-profile.json5" || true)"
if [ "$COUNT" -ne "$EXPECTED" ]; then
  echo "子包模块数量异常：$COUNT（期望 $EXPECTED）" >&2
  exit 1
fi
if ! grep -q 'applyToProducts' "$ASC_SERVICE/build-profile.json5"; then
  echo "build-profile.json5 缺少 applyToProducts 配置" >&2
  exit 1
fi
echo "OK：entry + $COUNT 个 pages_* 模块就绪，可直接在 DevEco Studio 里 Build Hap(s)。"
echo "注意：不要在 DevEco 打包前再跑命令行 hvigor，它会把子包模块裁掉。"
