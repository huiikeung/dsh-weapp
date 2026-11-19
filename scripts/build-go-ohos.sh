#!/bin/bash
# 构建内嵌 Tailscale（OpenHarmony Go）引擎 v1.104.5：
#   harmonyos/native/go_bridge → native-app/entry/libs/arm64-v8a/libtailscale_go.so/.h
#
# 前置（一次性，见 harmonyos/native/go_bridge/README.md）：
#   1) harmonyos/third_party/go-ohos     flypigJ/go-ohos @ 9f8bcc7（go1.27.3-ohos-devel，已 bootstrap）
#   2) harmonyos/third_party/tailscale   tailscale v1.104.5 + vendor/patches/{platform,cold-peer}.patch
# 用法：scripts/build-go-ohos.sh [--check]
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
harmony_root="$repo_root/harmonyos"
go_root="${GO_OHOS_ROOT:-$harmony_root/third_party/go-ohos}"
tailscale_root="$harmony_root/third_party/tailscale"
bridge_dir="$harmony_root/native/go_bridge"
out_dir="$harmony_root/native-app/entry/libs/arm64-v8a"
engine_version=1.104.5
export_count=50

if [[ -n "${DEVECO_SDK_HOME:-}" ]]; then
  sdk="${DEVECO_SDK_HOME}/default/openharmony/native"
elif [[ -d "/d/Program Files/DevEco Studio/sdk" ]]; then
  sdk="D:/Program Files/DevEco Studio/sdk/default/openharmony/native"
elif [[ -d "/Applications/DevEco-Studio.app/Contents/sdk" ]]; then
  sdk="/Applications/DevEco-Studio.app/Contents/sdk/default/openharmony/native"
else
  sdk="${DEVECO_STUDIO_HOME:-/Applications/DevEco-Studio.app/Contents}/sdk/default/openharmony/native"
fi

if [[ "${1:-}" == "--check" ]]; then
  [[ -x "$go_root/bin/go" ]] || { echo "missing OpenHarmony Go toolchain: $go_root" >&2; exit 1; }
  "$go_root/bin/go" version | grep -q "go1.27.3-ohos-devel" || { echo "toolchain is not go1.27.3-ohos-devel: $($go_root/bin/go version)" >&2; exit 1; }
  [[ -f "$tailscale_root/VERSION.txt" ]] || { echo "missing tailscale checkout: $tailscale_root" >&2; exit 1; }
  grep -q "$engine_version" "$tailscale_root/VERSION.txt" || { echo "tailscale is not v$engine_version" >&2; exit 1; }
  modified="$(git -C "$tailscale_root" diff --name-only HEAD | wc -l | tr -d ' ')"
  [[ "$modified" == "22" ]] || { echo "vendor patches not applied cleanly (modified=$modified, expect 22)" >&2; exit 1; }
  [[ -d "$sdk" ]] || { echo "HarmonyOS native SDK not found: $sdk" >&2; exit 1; }
  echo "OK ($engine_version, go1.27.3-ohos-devel)"
  exit 0
fi

[[ -d "$sdk" ]] || { echo "HarmonyOS native SDK not found: $sdk" >&2; exit 1; }

if command -v cygpath >/dev/null 2>&1; then
  go_root_win="$(cygpath -w "$go_root")"
else
  go_root_win="$go_root"
fi
export GOROOT="$go_root_win"
export PATH="$go_root/bin:$PATH"
export GOOS=openharmony GOARCH=arm64 CGO_ENABLED=1 GOTOOLCHAIN=local GOENV=off GOWORK=off
export GOCACHE="${GOCACHE:-${XDG_CACHE_HOME:-$HOME/.cache}/dsh-weapp/ohos-go-build}"
export GOMODCACHE="${GOMODCACHE:-${XDG_CACHE_HOME:-$HOME/.cache}/dsh-weapp/ohos-go-mod}"
export GOPATH="${GOPATH:-${XDG_CACHE_HOME:-$HOME/.cache}/dsh-weapp/ohos-go-path}"
export GOPROXY="${GOPROXY:-https://goproxy.cn,https://proxy.golang.org,direct}"
export CC="\"$sdk/llvm/bin/clang\" --target=aarch64-linux-ohos \"--sysroot=$sdk/sysroot\" -D__MUSL__"
export CXX="\"$sdk/llvm/bin/clang++\" --target=aarch64-linux-ohos \"--sysroot=$sdk/sysroot\" -D__MUSL__"

mkdir -p "$out_dir"
cd "$bridge_dir"
go build -p 2 -mod=readonly -trimpath -buildvcs=false -buildmode=c-shared \
  -ldflags "-extldflags=-Wl,-soname,libtailscale_go.so,--build-id=sha1 -X tailscale.com/version.longStamp=$engine_version -X tailscale.com/version.shortStamp=$engine_version -X main.pathDiagnosticBuild=dsh-weapp-local" \
  -o "$out_dir/libtailscale_go.so" .

echo "built: $out_dir/libtailscale_go.so"
if [[ -x "$sdk/llvm/bin/llvm-nm" || -x "$sdk/llvm/bin/llvm-nm.exe" ]]; then
  nm="$sdk/llvm/bin/llvm-nm"; [[ -x "$nm" ]] || nm="$nm.exe"
  count="$("$nm" -D --defined-only "$out_dir/libtailscale_go.so" | awk '{print $NF}' | grep -c '^TS')"
  echo "exports: $count (expected $export_count)"
  [[ "$count" == "$export_count" ]] || { echo "ABI export count mismatch" >&2; exit 1; }
fi
