#!/bin/bash
# 发布新版本 APK
# 用法: ./release.sh <apk路径> <版本名> <版本号> [更新说明]
#
# 示例:
#   ./release.sh ~/Downloads/app-release.apk 1.1 2
#   ./release.sh ~/Downloads/app-release.apk 1.1 2 "修复裁剪框问题"

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
RELEASES_DIR="$PROJECT_DIR/releases"
SERVER_URL="http://127.0.0.1:3001"

APK_PATH="$1"
VERSION_NAME="$2"
VERSION_CODE="$3"
RELEASE_NOTES="${4:-}"

if [ -z "$APK_PATH" ] || [ -z "$VERSION_NAME" ] || [ -z "$VERSION_CODE" ]; then
    echo "用法: $0 <apk路径> <版本名> <版本号> [更新说明]"
    echo "示例: $0 ~/Downloads/app-release.apk 1.1 2"
    exit 1
fi

if [ ! -f "$APK_PATH" ]; then
    echo "错误: 找不到文件 $APK_PATH"
    exit 1
fi

# 复制到 releases 目录
FILENAME="question-bank-v${VERSION_NAME}.apk"
cp "$APK_PATH" "$RELEASES_DIR/$FILENAME"
echo "✓ 已复制到 releases/$FILENAME"

# 注册到服务器
RESPONSE=$(curl -s -X POST "$SERVER_URL/api/version/publish" \
    -H "Content-Type: application/json" \
    -d "{\"filename\":\"$FILENAME\",\"version_name\":\"$VERSION_NAME\",\"version_code\":$VERSION_CODE,\"release_notes\":\"$RELEASE_NOTES\"}")

echo "✓ 服务器响应:"
echo "$RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$RESPONSE"
