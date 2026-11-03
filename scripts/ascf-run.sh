#!/usr/bin/env bash
# 手动构建 + 安装 + 启动 HarmonyOS 元服务（ASCF + hvigor，命令行即可完成）。
#
# 用法：
#   bash scripts/ascf-run.sh                  # 自动选择唯一设备/模拟器
#   HDC_TARGET=127.0.0.1:5555 bash scripts/ascf-run.sh   # 指定设备
#
# 说明：build-profile.json5 里的 16 个 pages_* 子包模块由 ascf 编译生成。
# hvigorfile.ts 已显式传 disableSubpackages=false，构建不会再删掉它们；
# 脚本仍保留备份/恢复作为兜底，并先跑一次 --sync 刷新 DevEco 读的工程模型
#（.hvigor/outputs/sync/output.json）。
# 启动后排查连接问题：
#   hdc shell hilog | grep -E '\[gateway\]|\[hosts\]'
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE="$ROOT/harmonyos/atomic-service"
DEVECO="/Applications/DevEco-Studio.app/Contents"
JAVA_HOME="$DEVECO/jbr/Contents/Home"
NODE_HOME="$DEVECO/tools/node"
HVIGOR="$DEVECO/tools/hvigor/bin/hvigorw"
HDC="$DEVECO/sdk/default/openharmony/toolchains/hdc"
BUNDLE="com.atomicservice.6917620513768602995"
ABILITY="EntryAbility"

[ -x "$HVIGOR" ] || { echo "找不到 hvigor：$HVIGOR" >&2; exit 1; }
[ -x "$HDC" ] || { echo "找不到 hdc：$HDC" >&2; exit 1; }

BACKUP="$(mktemp)"
cp "$SERVICE/build-profile.json5" "$BACKUP"
restore() {
  cp "$BACKUP" "$SERVICE/build-profile.json5"
  rm -f "$BACKUP"
}
trap restore EXIT

run_hvigor() {
  ( cd "$SERVICE" && \
    JAVA_HOME="$JAVA_HOME" NODE_HOME="$NODE_HOME" DEVECO_SDK_HOME="$DEVECO/sdk" \
    PATH="$JAVA_HOME/bin:$NODE_HOME/bin:$PATH" "$HVIGOR" "$@" )
}

echo "[1/4] 同步工程模型（DevEco 读 .hvigor/outputs/sync；同步后「目标」才有 default）"
run_hvigor --sync > /tmp/ascf-sync.log 2>&1 || { echo "同步失败，日志见 /tmp/ascf-sync.log" >&2; exit 1; }

echo "[2/4] 构建 HAP"
run_hvigor --mode module -p product=default -p module=entry@default -p buildMode=debug assembleHap --no-daemon \
  | tee /tmp/ascf-build.log | tail -3
grep -q "BUILD SUCCESSFUL" /tmp/ascf-build.log || { echo "构建失败，日志见 /tmp/ascf-build.log" >&2; exit 1; }

HAP="$SERVICE/entry/build/default/outputs/default/entry-default-signed.hap"
[ -f "$HAP" ] || { echo "HAP 未生成：$HAP" >&2; exit 1; }

TARGET_ARGS=()
if [ -n "${HDC_TARGET:-}" ]; then
  TARGET_ARGS=(-t "$HDC_TARGET")
  echo "使用设备：$HDC_TARGET"
fi

echo "[3/4] 安装到设备"
"$HDC" "${TARGET_ARGS[@]}" install -r "$HAP"

echo "[4/4] 启动元服务"
"$HDC" "${TARGET_ARGS[@]}" shell aa start -a "$ABILITY" -b "$BUNDLE"

echo "完成。连接日志："
echo "  \"$HDC\" ${HDC_TARGET:+-t $HDC_TARGET} shell hilog | grep -E '\[gateway\]|\[hosts\]'"
