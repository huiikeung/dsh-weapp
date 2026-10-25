#!/bin/bash
# 用无头 Chrome 把设计稿渲染成 2x PNG，再生成 1000×800 / 500×400 成品。
# 用法: bash render.sh [设计稿.html] [输出前缀]
set -u
cd "$(dirname "$0")"
HTML="${1:-share-cover.html}"
OUT="${2:-share-cover}"
ABS_HTML="$(cd "$(dirname "$HTML")" && pwd)/$(basename "$HTML")"
RAW="$(pwd)/${OUT}-2000x1600.png"
PROFILE="$(mktemp -d /tmp/chrome-promo-XXXXXX)"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

rm -f "$RAW"
"$CHROME" \
  --headless=new --no-sandbox --disable-gpu --disable-breakpad \
  --disable-crash-reporter --disable-component-update --disable-background-networking \
  --no-first-run --no-default-browser-check --allow-file-access-from-files \
  --user-data-dir="$PROFILE" --hide-scrollbars \
  --force-device-scale-factor=2 --window-size=1000,800 \
  --screenshot="$RAW" "file://$ABS_HTML" >/dev/null 2>&1 &
PID=$!

for _ in $(seq 1 120); do
  [ -s "$RAW" ] && break
  sleep 0.25
done
sleep 1
kill "$PID" 2>/dev/null
wait "$PID" 2>/dev/null
rm -rf "$PROFILE"

if [ ! -s "$RAW" ]; then echo "render failed" >&2; exit 1; fi

sips -z 800 1000 "$RAW" --out "${OUT}-1000x800.png" >/dev/null
sips -z 400 500  "${RAW}" --out "${OUT}-500x400.png"  >/dev/null
sips -g pixelWidth -g pixelHeight "${OUT}-1000x800.png" "${OUT}-500x400.png" | tail -6

# 2 倍原图只是中间产物，保留会让目录多出 3 MB 文件。
rm -f "$RAW"
