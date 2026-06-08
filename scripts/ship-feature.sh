#!/bin/bash
# ship-feature.sh - 构建 APK 并记录到 PROJECT_MEMORY.md
# 用法: ./scripts/ship-feature.sh "功能描述"
# 可选环境变量: BUILD_SOURCE=main|worktree（默认 main）

set -e

DESCRIPTION="${1:-功能更新}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
DATE=$(date +%Y-%m-%d)

if [ "$BUILD_SOURCE" = "worktree" ]; then
  PROJECT_DIR="/Users/john/.codex/worktrees/f640/question-bank-local"
else
  PROJECT_DIR="/Users/john/question-bank-local"
fi

cd "$PROJECT_DIR"
echo ">>> 构建来源: $PROJECT_DIR"

# 1. 同步 Capacitor
echo ">>> 同步 Capacitor 资源..."
npx cap sync android

# 2. 修复 proguard 兼容性（AGP 9.x）
echo ">>> 修复 proguard 兼容性..."
find node_modules/@capacitor node_modules/@hotend -name "build.gradle" -exec grep -l "proguard-android\.txt" {} \; 2>/dev/null | while read f; do
  sed -i '' 's/proguard-android\.txt/proguard-android-optimize.txt/g' "$f"
done

# 3. 构建 APK
echo ">>> 构建 debug APK..."
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
cd android && ./gradlew assembleDebug
cd ..

# 4. 复制 APK
APK_NAME="question-bank-local_${TIMESTAMP}.apk"
cp android/app/build/outputs/apk/debug/app-debug.apk "$APK_NAME"
echo ">>> APK 已生成: $APK_NAME"

# 5. 更新 PROJECT_MEMORY.md
MEMORY_FILE="PROJECT_MEMORY.md"
if [ ! -f "$MEMORY_FILE" ]; then
  echo "# PROJECT_MEMORY.md" > "$MEMORY_FILE"
  echo "" >> "$MEMORY_FILE"
fi

if ! grep -q "$DATE" "$MEMORY_FILE" 2>/dev/null; then
  echo "" >> "$MEMORY_FILE"
  echo "## $DATE" >> "$MEMORY_FILE"
fi

echo "- **$TIMESTAMP** - $DESCRIPTION ($APK_NAME)" >> "$MEMORY_FILE"
echo ">>> PROJECT_MEMORY.md 已更新"

echo ""
echo "✅ 完成！APK: $APK_NAME"
