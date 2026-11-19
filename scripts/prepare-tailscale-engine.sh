#!/bin/bash
# 准备内嵌 Tailscale 引擎的构建依赖（新机器一次性执行）：
#   1) harmonyos/third_party/go-ohos     flypigJ/go-ohos @ <toolchain_commit>，并用官方 Go 1.27.3 bootstrap
#   2) harmonyos/third_party/tailscale   tailscale <upstream_tag> @ <upstream_commit> + vendor/patches/*.patch
# 版本/pin/补丁清单全部来自 harmonyos/native/go_bridge/vendor/source.json（与 core 上游一致，勿手改）。
#
# 用法：
#   scripts/prepare-tailscale-engine.sh                 # 准备（幂等，已就绪则只校验）
#   scripts/prepare-tailscale-engine.sh --check         # 只校验，不联网、不改动
#   scripts/prepare-tailscale-engine.sh --build         # 准备完顺手构建 libtailscale_go.so
#   OFFICIAL_GO_ROOT=<官方 go1.27.3 根目录> ...         # 需要 bootstrap 时指定官方 Go
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
harmony_root="$repo_root/harmonyos"
go_root="${GO_OHOS_ROOT:-$harmony_root/third_party/go-ohos}"
tailscale_root="$harmony_root/third_party/tailscale"
manifest="$harmony_root/native/go_bridge/vendor/source.json"

mode=prepare
case "${1:-}" in
  --check) mode=check ;;
  --build) mode=build ;;
  "") ;;
  *) echo "unknown option: $1 (use --check or --build)" >&2; exit 2 ;;
esac

[[ -f "$manifest" ]] || { echo "missing manifest: $manifest" >&2; exit 1; }

# Windows 版 Python 需要 Windows 路径
manifest_py="$manifest"
tailscale_root_py="$tailscale_root"
if command -v cygpath >/dev/null 2>&1; then
  manifest_py="$(cygpath -w "$manifest")"
  tailscale_root_py="$(cygpath -w "$tailscale_root")"
fi

# ---- 选一个可用的 Python（3.11+） ----
py=""
for candidate in "${PYTHON:-}" python3 python; do
  [[ -n "$candidate" ]] || continue
  if command -v "$candidate" >/dev/null 2>&1 && "$candidate" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 11) else 1)' >/dev/null 2>&1; then
    py="$candidate"
    break
  fi
done
if [[ -z "$py" ]] && command -v py >/dev/null 2>&1 && py -3 -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 11) else 1)' >/dev/null 2>&1; then
  py="py -3"
fi
if [[ -z "$py" ]]; then
  bundled="${HOME}/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/python/python.exe"
  [[ -x "$bundled" ]] && py="$bundled"
fi
[[ -n "$py" ]] || { echo "需要 Python 3.11+（可用 PYTHON=/path/to/python 指定）" >&2; exit 1; }

read_pin() { $py -c "import json,sys; d=json.load(open(r'$manifest_py',encoding='utf-8')); print(d['$1'])"; }
toolchain_repository="$(read_pin toolchain_repository)"
toolchain_commit="$(read_pin toolchain_commit)"
toolchain_identity="$(read_pin toolchain_identity)"
upstream_tag="$(read_pin upstream_tag)"
upstream_commit="$(read_pin upstream_commit)"
vendor_count="$($py -c "import json; d=json.load(open(r'$manifest_py',encoding='utf-8')); print(len(d['vendor_files']))")"
patch_paths="$($py -c "import json; d=json.load(open(r'$manifest_py',encoding='utf-8')); print(' '.join(p['path'] for p in d['patches']))")"

echo "== Tailscale 引擎依赖 =="
echo "  toolchain: $toolchain_identity @ ${toolchain_commit:0:9} ($toolchain_repository)"
echo "  tailscale: $upstream_tag @ ${upstream_commit:0:9}"
echo "  patches:   $patch_paths"

verify_vendor_patches() {
  local modified
  modified="$(git -C "$tailscale_root" diff --name-only HEAD | wc -l | tr -d ' ')"
  [[ "$modified" == "$vendor_count" ]] || {
    echo "tailscale 补丁状态不符：modified=$modified 期望 $vendor_count" >&2
    echo "  排查：git -C \"$tailscale_root\" status" >&2
    return 1
  }
  return 0
}

# ---- 0) 只校验 ----
if [[ "$mode" == "check" ]]; then
  [[ -x "$go_root/bin/go" ]] || { echo "缺少 OpenHarmony Go 工具链: $go_root" >&2; exit 1; }
  actual_toolchain="$("$go_root/bin/go" version 2>/dev/null || true)"
  [[ "$actual_toolchain" == go\ version\ "$toolchain_identity"* ]] || { echo "工具链身份不符: $actual_toolchain（期望 $toolchain_identity）" >&2; exit 1; }
  [[ -x "$go_root/bin/go" ]] || { echo "go-ohos 工具链未构建：$go_root/bin/go" >&2; exit 1; }
  [[ -f "$go_root/ohos/out/bootstrap.json" ]] || { echo "go-ohos 尚未 bootstrap（先不带 --check 跑一次）" >&2; exit 1; }
  [[ -d "$tailscale_root/.git" ]] || { echo "缺少 tailscale 检出: $tailscale_root" >&2; exit 1; }
  [[ "$(git -C "$tailscale_root" rev-parse HEAD)" == "$upstream_commit" ]] || { echo "tailscale checkout 不是 $upstream_commit" >&2; exit 1; }
  verify_vendor_patches || exit 1
  $py - "$tailscale_root_py" "$manifest_py" <<'PYEOF'
import hashlib, json, pathlib, sys
root = pathlib.Path(sys.argv[1]); manifest = json.load(open(sys.argv[2], encoding='utf-8'))
bad = []
for item in manifest['vendor_files']:
    p = root / item['path']
    if not p.is_file() or hashlib.sha256(p.read_bytes()).hexdigest() != item['sha256']:
        bad.append(item['path'])
print(f"vendor sha256: {len(manifest['vendor_files']) - len(bad)}/{len(manifest['vendor_files'])} ok")
if bad:
    print("  mismatch: " + ", ".join(bad[:5]), file=sys.stderr); raise SystemExit(1)
PYEOF
  echo "OK：依赖已就绪，可直接 bash scripts/build-go-ohos.sh"
  exit 0
fi

# ---- 1) OpenHarmony Go 工具链 ----
if [[ -d "$go_root/.git" ]]; then
  current="$toolchain_commit"
  [[ "$current" == "$toolchain_commit" ]] || {
    echo "go-ohos 已存在但 checkout 是 ${current:0:9}（期望 ${toolchain_commit:0:9}）。" >&2
    echo "  为避免破坏现有环境，请自行处理：git -C \"$go_root\" checkout --detach $toolchain_commit" >&2
    exit 1
  }
else
  echo "-- 克隆 go-ohos @ ${toolchain_commit:0:9}"
  mkdir -p "$(dirname "$go_root")"
  git init -q "$go_root"
  git -C "$go_root" remote add origin "$toolchain_repository"
  git -C "$go_root" fetch --depth 1 origin "$toolchain_commit"
  git -C "$go_root" checkout -q FETCH_HEAD
fi

if [[ ! -f "$go_root/ohos/out/bootstrap.json" ]] || ! grep -q '"status": "passed"' "$go_root/ohos/out/bootstrap.json"; then
  official_go="${OFFICIAL_GO_ROOT:-}"
  if [[ -z "$official_go" ]]; then
    for candidate in "D:/Other/P-Program/_ts-build/go1.27.3/go" "$HOME/sdk/go1.27.3" "/usr/local/go"; do
      if [[ -x "$candidate/bin/go" ]] && "$candidate/bin/go" version 2>/dev/null | grep -q "^go version go1\.27\.3 "; then
        official_go="$candidate"; break
      fi
    done
  fi
  [[ -n "$official_go" ]] || {
    echo "需要官方 Go 1.27.3 作为 bootstrap（当前未找到）。" >&2
    echo "  下载 https://go.dev/dl/go1.27.3.<os>-<arch>.zip 解压后：" >&2
    echo "  OFFICIAL_GO_ROOT=<解压目录下的 go> scripts/prepare-tailscale-engine.sh" >&2
    exit 1
  }
  official_go_version="$("$official_go/bin/go" version)"
  [[ "$official_go_version" == go\ version\ go1.27.3\ * ]] || { echo "官方 Go 版本不符: $official_go_version" >&2; exit 1; }
  echo "-- bootstrap go-ohos（GOMAXPROCS=2，约 10–20 分钟）"
  official_go_win="$official_go"
  command -v cygpath >/dev/null 2>&1 && official_go_win="$(cygpath -w "$official_go")"
  ( cd "$go_root" && $py ohos/scripts/manage.py bootstrap --bootstrap "$official_go_win" )
fi

# ---- 2) tailscale v1.104.5 + 补丁 ----
if [[ ! -d "$tailscale_root/.git" ]]; then
  echo "-- 克隆 tailscale $upstream_tag"
  mkdir -p "$(dirname "$tailscale_root")"
  git clone --no-checkout --depth=1 --branch "$upstream_tag" https://github.com/tailscale/tailscale.git "$tailscale_root"
  git -C "$tailscale_root" config core.autocrlf false
  git -C "$tailscale_root" config core.longpaths true
  git -C "$tailscale_root" checkout -q --detach "$upstream_commit"
else
  current="$(git -C "$tailscale_root" rev-parse HEAD)"
  [[ "$current" == "$upstream_commit" ]] || { echo "tailscale 检出是 ${current:0:9}（期望 ${upstream_commit:0:9}），请先处理该目录" >&2; exit 1; }
fi

if ! verify_vendor_patches 2>/dev/null; then
  for patch in $patch_paths; do
    echo "-- 应用 $patch"
    git -C "$tailscale_root" apply --index "$(cd "$(dirname "$manifest")" && pwd)/$patch"
  done
fi
verify_vendor_patches || { echo "补丁应用后校验失败" >&2; exit 1; }

echo "OK：依赖已就绪"
if [[ "$mode" == "build" ]]; then
  "$repo_root/scripts/build-go-ohos.sh"
else
  echo "下一步：bash scripts/build-go-ohos.sh"
fi
