#!/usr/bin/env bash
# In-place upgrade: preserve domain, ports, identities, volumes and master key.
set -Eeuo pipefail
DEPLOY_DIR="$(cd -- "$(dirname -- "$0")" && pwd)"
cd -- "$DEPLOY_DIR"
[[ $# -eq 0 ]] || { echo '用法：bash upgrade.sh' >&2; exit 2; }
[[ -f .env ]] || { echo '缺少 deploy/.env，拒绝重建密钥。请恢复原配置再升级。' >&2; exit 1; }
command -v docker >/dev/null && docker compose version >/dev/null || { echo '需要 Docker Compose Plugin。' >&2; exit 1; }
docker compose up --help | grep -q -- '--wait-timeout' || { echo '请先升级 Docker Compose Plugin（需要 --wait 支持）。' >&2; exit 1; }
for volume in dsh-public-console-data dsh-public-relay-data dsh-public-caddy-data dsh-public-caddy-config; do
  docker volume inspect "$volume" >/dev/null || { echo "未找到原数据卷 $volume，拒绝创建空数据。" >&2; exit 1; }
done
umask 077
# Outside the website root: backups include private credentials.
BACKUP_ROOT=/var/backups/dsh-public
mkdir -p -- "$BACKUP_ROOT"
STAGE="$(mktemp -d "$BACKUP_ROOT/upgrade-$(date +%Y%m%d-%H%M%S)-XXXXXX")"
cp -- .env "$STAGE/env.before-upgrade"
STOPPED=0
recover() {
  local status=$?
  if [[ $status -ne 0 ]]; then
    echo "升级中止；原配置与备份保留在 ${STAGE}，未删除任何卷。" >&2
    if [[ $STOPPED -eq 1 ]]; then docker compose start || true; fi
  fi
}
trap recover EXIT
bash ensure-relay-auth.sh
docker compose config --quiet
echo '构建新镜像；当前服务保持运行…'
docker compose build console relay
docker image inspect alpine:3.20 >/dev/null 2>&1 || docker pull alpine:3.20
echo '短暂停服备份，保留所有账号、兑换记录和配对状态…'
STOPPED=1
docker compose stop
for volume in dsh-public-console-data dsh-public-relay-data dsh-public-caddy-data dsh-public-caddy-config; do
  docker run --rm -v "$volume:/data:ro" -v "$STAGE:/backup" alpine:3.20 \
    sh -c 'tar -czf "/backup/$1.tar.gz" -C /data .' sh "$volume"
done
cp -- .env "$STAGE/env"
# --force-local：暂存路径含冒号时（Windows 上形如 C:\Users\...）GNU tar 会把冒号
# 前半段当成远端主机去调 rsh，报 "Cannot connect to C: resolve failed"。这里明确
# 声明归档文件是本地的；Linux 上路径不含冒号，该选项无副作用。
tar --force-local -czf "$STAGE/backup.tar.gz" -C "$STAGE" env \
  dsh-public-console-data.tar.gz dsh-public-relay-data.tar.gz dsh-public-caddy-data.tar.gz dsh-public-caddy-config.tar.gz
echo '启动新服务并等待健康检查…'
docker compose up -d --wait --wait-timeout 120
STOPPED=0
docker compose ps
echo "升级完成。可恢复备份：$STAGE/backup.tar.gz"
echo '保留原域名、宝塔端口、管理员、兑换记录和设备配对；未重新初始化。'
echo '小程序代码需要另外编译发布。旧版公网客户端无授权票据将被拒绝；局域网不变。'
