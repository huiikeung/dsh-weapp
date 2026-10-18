#!/usr/bin/env bash
set -Eeuo pipefail
cd -- "$(dirname -- "$0")"
[[ -f .env ]] || { echo '缺少 deploy/.env；升级不能重新初始化。' >&2; exit 1; }
if ! grep -q '^RELAY_AUTH_SECRET=' .env; then
  command -v openssl >/dev/null || { echo '请安装 openssl 后重试。' >&2; exit 1; }
  umask 077
  printf '\nRELAY_AUTH_SECRET=%s\n' "$(openssl rand -hex 32)" >> .env
fi
grep -Eq '^RELAY_AUTH_SECRET=[A-Za-z0-9_-]{32,128}$' .env || { echo 'RELAY_AUTH_SECRET 格式无效，请检查私有 .env；不要把密钥发到聊天。' >&2; exit 1; }
chmod 600 .env
