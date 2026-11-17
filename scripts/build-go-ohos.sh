#!/bin/bash
# 构建内嵌 Tailscale（OpenHarmony Go）引擎：
#   go_bridge → entry/libs/arm64-v8a/libtailscale_go.so/.h
#
# 前置（一次性，见 docs/ARCHITECTURE-native-app.md）：
#   1) harmonyos/third_party/ohos-go  (OpenHarmony Go 1.24.5，已 make.bash)
#   2) harmonyos/third_party/tailscale (v1.86.5，已打 patches/tailscale-ohos.patch)
# 用法：scripts/build-go-ohos.sh [--check]
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
harmony_root="$repo_root/harmonyos"
go_root="${OHOS_GO_ROOT:-$harmony_root/third_party/ohos-go}"
tailscale_root="$harmony_root/third_party/tailscale"
bridge_dir="$harmony_root/native/go_bridge"
out_dir="$harmony_root/native-app/entry/libs/arm64-v8a"

if [[ "${1:-}" == "--check" ]]; then
  [[ -x "$go_root/bin/go" ]] || { echo "missing OHOS Go toolchain: $go_root" >&2; exit 1; }
  [[ -d "$tailscale_root" ]] || { echo "missing tailscale checkout: $tailscale_root" >&2; exit 1; }
  echo "OK"
  exit 0
fi

sdk="${DEVECO_SDK_HOME:-${DEVECO_STUDIO_HOME:-/Applications/DevEco-Studio.app/Contents}/sdk}/default/openharmony/native"
[[ -d "$sdk" ]] || { echo "HarmonyOS native SDK not found: $sdk" >&2; exit 1; }

export GOROOT="$go_root"
export PATH="$go_root/bin:$PATH"
export GOOS=openharmony GOARCH=arm64 CGO_ENABLED=1 GOTOOLCHAIN=local
export GOCACHE="${GOCACHE:-/tmp/ohos-go-cache}"
export GOMODCACHE="${GOMODCACHE:-/tmp/ohos-go-modcache}"
export GOPATH="${GOPATH:-/tmp/ohos-go-path}"
export GOPROXY="${GOPROXY:-https://goproxy.cn,https://proxy.golang.org,direct}"
export CC="$sdk/llvm/bin/clang --target=aarch64-linux-ohos --sysroot=$sdk/sysroot -D__MUSL__"
export CXX="$sdk/llvm/bin/clang++ --target=aarch64-linux-ohos --sysroot=$sdk/sysroot -D__MUSL__"

mkdir -p "$out_dir"
cd "$bridge_dir"
go build -buildmode=c-shared -trimpath \
  -ldflags="-extldflags=-Wl,-soname,libtailscale_go.so -X tailscale.com/version.longStamp=1.86.5 -X tailscale.com/version.shortStamp=1.86.5" \
  -o "$out_dir/libtailscale_go.so" .
SDK=/Applications/DevEco-Studio.app/Contents/sdk/default/openharmony/native
"$SDK/llvm/bin/llvm-strip" --strip-all "$OUT_SO" 2>/dev/null || true
echo "built: $out_dir/libtailscale_go.so"
SDK=/Applications/DevEco-Studio.app/Contents/sdk/default/openharmony/native
SO=/Users/0the/Downloads/dsh-weapp/harmonyos/native-app/entry/libs/arm64-v8a/libtailscale_go.so
"$SDK/llvm/bin/llvm-strip" --strip-all "$SO" || true
ls -lh "$SO" | awk '{print "stripped size:", $5}'
