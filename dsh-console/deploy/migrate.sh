#!/usr/bin/env bash
set -Eeuo pipefail

DEPLOY_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$DEPLOY_DIR"
PROJECT="dsh-public"
VOLUMES=(dsh-public-console-data dsh-public-relay-data dsh-public-caddy-data dsh-public-caddy-config)

usage() {
  echo "用法："
  echo "  ./migrate.sh backup /绝对路径/dsh-public-backup.tar.gz"
  echo "  ./migrate.sh restore /绝对路径/dsh-public-backup.tar.gz"
  echo "  ./migrate.sh import-relay-state /绝对路径/relay-state.json"
}

[[ $# -eq 2 ]] || { usage >&2; exit 2; }
ACTION="$1"
ARCHIVE="$2"
case "$ACTION" in
  backup)
    mkdir -p "$(dirname -- "$ARCHIVE")"
    TMP_DIR="$(mktemp -d)"
    trap 'rm -rf "$TMP_DIR"' EXIT
    docker compose -p "$PROJECT" stop
    for volume in "${VOLUMES[@]}"; do
      docker run --rm -v "$volume:/data:ro" -v "$TMP_DIR:/backup" alpine:3.20 \
        sh -c "tar -czf /backup/$volume.tar.gz -C /data ."
    done
    cp .env "$TMP_DIR/env"
    tar -czf "$ARCHIVE" -C "$TMP_DIR" .
    docker compose -p "$PROJECT" start
    echo "备份完成：$ARCHIVE"
    ;;
  restore)
    [[ -f "$ARCHIVE" ]] || { echo "备份文件不存在：$ARCHIVE" >&2; exit 1; }
    TMP_DIR="$(mktemp -d)"
    trap 'rm -rf "$TMP_DIR"' EXIT
    tar -xzf "$ARCHIVE" -C "$TMP_DIR"
    [[ -f "$TMP_DIR/env" ]] || { echo "备份缺少 env，拒绝恢复。" >&2; exit 1; }
    echo "恢复会覆盖当前四个 Docker 数据卷，并重启服务。"
    read -r -p "确认继续？输入 RESTORE: " CONFIRM
    [[ "$CONFIRM" == RESTORE ]] || { echo "已取消。"; exit 1; }
    cp "$TMP_DIR/env" .env
    bash ensure-relay-auth.sh
    docker compose -p "$PROJECT" down
    for volume in "${VOLUMES[@]}"; do
      docker volume create "$volume" >/dev/null
      docker run --rm -v "$volume:/data" -v "$TMP_DIR:/backup:ro" alpine:3.20 \
        sh -c "find /data -mindepth 1 -maxdepth 1 -exec rm -rf {} +; tar -xzf /backup/$volume.tar.gz -C /data"
    done
    docker compose -p "$PROJECT" up -d
    echo "恢复完成。"
    ;;
  import-relay-state)
    [[ -f "$ARCHIVE" ]] || { echo "relay 状态文件不存在：$ARCHIVE" >&2; exit 1; }
    echo "这会覆盖统一部署中的 relay 状态，并重启 relay。"
    read -r -p "确认继续？输入 IMPORT: " CONFIRM
    [[ "$CONFIRM" == IMPORT ]] || { echo "已取消。"; exit 1; }
    STATE_DIR="$(cd -- "$(dirname -- "$ARCHIVE")" && pwd)"
    STATE_NAME="$(basename -- "$ARCHIVE")"
    docker compose -p "$PROJECT" stop relay caddy
    docker volume create dsh-public-relay-data >/dev/null
    docker run --rm -v dsh-public-relay-data:/data -v "$STATE_DIR:/source:ro" alpine:3.20 \
      sh -c 'cp "/source/$1" /data/relay-state.json && chown 1000:1000 /data/relay-state.json' sh "$STATE_NAME"
    docker compose -p "$PROJECT" up -d relay caddy
    echo "旧 relay 状态已导入。确认新地址可用后，再停止旧 relay 服务。"
    ;;
  *) usage >&2; exit 2 ;;
esac
