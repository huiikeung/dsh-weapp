#!/bin/bash
# 构建并签名 HarmonyOS 上架包（.app）
# 用法: bash scripts/release-sign.sh [签名材料目录] [产物输出目录]
# 材料目录需包含: flukit.cer / flukitRelease.p7b / release.p12 / keystore-password.txt
set -euo pipefail

MATERIAL_DIR="${1:-/Users/0the/Downloads/material(1)}"
OUT_DIR="${2:-$(cd "$(dirname "$0")/.." && pwd)/local-artifacts}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/harmonyos/native-app"
BUILD_DIR="/tmp/flukit-release-build"

KEY_ALIAS="release"
SIGN_ALG="SHA256withECDSA"

export JAVA_HOME="${JAVA_HOME:-/Applications/DevEco-Studio.app/Contents/jbr/Contents/Home}"
export PATH="$JAVA_HOME/bin:$PATH"
export DEVECO_SDK_HOME="${DEVECO_SDK_HOME:-/Applications/DevEco-Studio.app/Contents/sdk}"
HVIGOR="${HVIGOR:-/Applications/DevEco-Studio.app/Contents/tools/hvigor/bin/hvigorw}"
SIGN_TOOL="$DEVECO_SDK_HOME/default/openharmony/toolchains/lib/hap-sign-tool.jar"

PASS="$(head -1 "$MATERIAL_DIR/keystore-password.txt" | tr -d '\n')"
VERSION="$(grep -m1 '"versionName"' "$SRC/AppScope/app.json5" | sed -E 's/.*"versionName"\s*:\s*"([^"]+)".*/\1/')"

echo "== 1/4 准备构建目录（不含签名配置，出 unsigned 包）=="
rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR"
rsync -a \
  --exclude 'build' --exclude 'entry/build' --exclude 'native-core/build' \
  --exclude '.hvigor' --exclude 'entry/.preview' --exclude 'build-profile.json5' \
  "$ROOT/harmonyos/" "$BUILD_DIR/harmonyos/"
cat > "$BUILD_DIR/harmonyos/native-app/build-profile.json5" <<'PROFILE'
{
  "app": {
    "products": [{
      "name": "default",
      "compatibleSdkVersion": "26.0.0",
      "targetSdkVersion": "26.0.0",
      "runtimeOS": "HarmonyOS",
      "buildOption": { "strictMode": { "caseSensitiveCheck": true, "useNormalizedOHMUrl": true } }
    }],
    "buildModeSet": [{ "name": "debug" }, { "name": "release" }]
  },
  "modules": [
    { "name": "nativecore", "srcPath": "../native-core", "targets": [{ "name": "default", "applyToProducts": ["default"] }] },
    { "name": "entry", "srcPath": "./entry", "targets": [{ "name": "default", "applyToProducts": ["default"] }] }
  ]
}
PROFILE

echo "== 2/4 release 构建 unsigned .app =="
cd "$BUILD_DIR/harmonyos/native-app"
"$HVIGOR" --mode project -p product=default -p buildMode=release assembleApp --no-daemon
UNSIGNED="$BUILD_DIR/harmonyos/native-app/build/outputs/default/native-app-default-unsigned.app"
[ -f "$UNSIGNED" ] || { echo "未找到 unsigned 产物: $UNSIGNED"; exit 1; }

echo "== 3/4 用发布证书签名 =="
mkdir -p "$OUT_DIR"
SIGNED="$OUT_DIR/flukit-$VERSION-release-signed.app"
java -jar "$SIGN_TOOL" sign-app \
  -keyAlias "$KEY_ALIAS" -signAlg "$SIGN_ALG" -mode localSign \
  -appCertFile "$MATERIAL_DIR/flukit.cer" \
  -profileFile "$MATERIAL_DIR/flukitRelease.p7b" \
  -inFile "$UNSIGNED" \
  -keystoreFile "$MATERIAL_DIR/release.p12" \
  -outFile "$SIGNED" \
  -keyPwd "$PASS" -keystorePwd "$PASS"

echo "== 4/4 校验签名 =="
java -jar "$SIGN_TOOL" verify-app -inFile "$SIGNED" -outCertChain /tmp/flukit-verify.cer -outProfile /tmp/flukit-verify.p7b | tail -3

echo
echo "产物: $SIGNED"
ls -la "$SIGNED"
