#!/usr/bin/env bash
# ============================================================
#  微信小程序预览推送（macOS 版，对齐 push-preview.ps1）
#  用法:
#    scripts/push-preview.sh            # 单次推送预览到手机
#    scripts/push-preview.sh --auto     # 开启 IDE 自动预览（保存即推送）
#    scripts/push-preview.sh --off      # 关闭 IDE 自动预览
#    scripts/push-preview.sh --info     # 登录/环境信息
# ============================================================
set -euo pipefail

CLI="/Applications/wechatwebdevtools.app/Contents/MacOS/cli"
PROJECT="$(cd "$(dirname "$0")/.." && pwd)"

case "${1:-}" in
  --auto|-Auto)
    "$CLI" auto-preview --enable --project "$PROJECT" && \
      echo "✓ 自动预览已开启：IDE 检测到文件变化即推送到手机"
    ;;
  --off|-Off)
    "$CLI" auto-preview --disable --project "$PROJECT" && \
      echo "✓ 自动预览已关闭"
    ;;
  --info|-Project)
    echo "Project: $PROJECT"
    echo "CLI:     $CLI"
    "$CLI" islogin --project "$PROJECT"
    ;;
  *)
    "$CLI" auto-preview --project "$PROJECT"
    ;;
esac
