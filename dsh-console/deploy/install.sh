#!/usr/bin/env bash
set -Eeuo pipefail

DEPLOY_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$DEPLOY_DIR"
MODE="standalone"
if [[ "${1:-}" == "--baota" ]]; then
  MODE="baota"
elif [[ -n "${1:-}" ]]; then
  echo "用法：./install.sh [--baota]" >&2
  exit 2
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "未找到 Docker。请先安装 Docker Engine 和 Docker Compose Plugin。" >&2
  exit 1
fi
if ! docker compose version >/dev/null 2>&1; then
  echo "未找到 Docker Compose Plugin，请执行 docker compose version 检查。" >&2
  exit 1
fi

if [[ ! -f .env ]]; then
  if [[ -z "${PUBLIC_DOMAIN:-}" ]]; then
    read -r -p "请输入公网域名（例如 dsh.example.com）: " PUBLIC_DOMAIN
  fi
  if [[ ! "$PUBLIC_DOMAIN" =~ ^[A-Za-z0-9.-]+$ || "$PUBLIC_DOMAIN" != *.* ]]; then
    echo "公网域名格式不正确。" >&2
    exit 1
  fi
  if ! command -v openssl >/dev/null 2>&1; then
    echo "未找到 openssl，无法自动生成密钥。" >&2
    exit 1
  fi
  umask 077
  cat > .env <<EOF
PUBLIC_DOMAIN=$PUBLIC_DOMAIN
CONSOLE_ORIGIN=https://$PUBLIC_DOMAIN
ACCESS_MASTER_KEY=$(openssl rand -hex 32)
CONSOLE_SETUP_TOKEN=$(openssl rand -hex 32)
EOF
  echo "已生成 deploy/.env 和两组随机密钥。请妥善备份，不要提交 Git。"
else
  echo "检测到已有 deploy/.env，沿用现有域名和密钥。"
fi

set_env() {
  local key="$1" value="$2"
  if grep -q "^${key}=" .env; then
    sed -i "s#^${key}=.*#${key}=${value}#" .env
  else
    printf '%s=%s\n' "$key" "$value" >> .env
  fi
}

if [[ "$MODE" == "baota" ]]; then
  set_env CADDY_SITE_SCHEME http
  set_env CADDY_HTTP_BIND 127.0.0.1:18080
  set_env CADDY_HTTPS_BIND 127.0.0.1:18443
else
  set_env CADDY_SITE_SCHEME https
  set_env CADDY_HTTP_BIND 0.0.0.0:80
  set_env CADDY_HTTPS_BIND 0.0.0.0:443
fi

bash ensure-relay-auth.sh
docker compose config --quiet
docker compose up -d --build

DOMAIN="$(sed -n 's/^PUBLIC_DOMAIN=//p' .env)"
echo
echo "部署完成："
echo "  管理后台: https://$DOMAIN"
echo "  relay:    wss://$DOMAIN/relay"
if [[ "$MODE" == "baota" ]]; then
  echo "  宝塔反向代理目标: http://127.0.0.1:18080"
fi
echo
echo "查看状态: docker compose ps"
echo "查看日志: docker compose logs -f --tail=100"
echo "迁移备份: ./migrate.sh backup /绝对路径/dsh-public-backup.tar.gz"
