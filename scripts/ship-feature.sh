#!/bin/bash
# ship-feature.sh - 构建 APK 并记录到 PROJECT_MEMORY.md
# 用法: ./scripts/ship-feature.sh "功能描述"
# 可选环境变量: BUILD_SOURCE=main|worktree（默认 worktree）

set -e

DESCRIPTION="${1:-功能更新}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
DATE=$(date +%Y-%m-%d)

# 构建目录（源码所在位置）
if [ "$BUILD_SOURCE" = "main" ]; then
  PROJECT_DIR="/Users/john/question-bank-local"
else
  PROJECT_DIR="/Users/john/.codex/worktrees/f640/question-bank-local"
fi

# 输出目录（APK + 记录文件，固定为原项目根目录）
OUTPUT_DIR="/Users/john/question-bank-local"

cd "$PROJECT_DIR"
echo ">>> 构建来源: $PROJECT_DIR"
echo ">>> 输出目录: $OUTPUT_DIR"

# 0. TypeScript 类型检查
echo ">>> TypeScript 类型检查..."
npx tsc --noEmit || {
  echo "❌ TypeScript 类型检查失败，请修复后重试"
  exit 1
}

# 1. Vite 构建前端
echo ">>> 构建前端 (Vite)..."
npx vite build || {
  echo "❌ Vite 构建失败"
  exit 1
}

# 2. 同步 Capacitor
echo ">>> 同步 Capacitor 资源..."
npx cap sync android

# 3. 修复 proguard 兼容性（AGP 9.x）
echo ">>> 修复 proguard 兼容性..."
find node_modules/@capacitor node_modules/@hotend -name "build.gradle" -exec grep -l "proguard-android\.txt" {} \; 2>/dev/null | while read f; do
  sed -i '' 's/proguard-android\.txt/proguard-android-optimize.txt/g' "$f"
done

# 4. 构建 APK
echo ">>> 构建 debug APK..."
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
cd android && ./gradlew clean assembleDebug
cd ..

# 5. 复制 APK 到原项目根目录
APK_NAME="question-bank-local_${TIMESTAMP}.apk"
cp android/app/build/outputs/apk/debug/app-debug.apk "$OUTPUT_DIR/$APK_NAME"
echo ">>> APK 已生成: $OUTPUT_DIR/$APK_NAME"

# 6. 更新原项目的 PROJECT_MEMORY.md
MEMORY_FILE="$OUTPUT_DIR/PROJECT_MEMORY.md"
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

# 7. 运行 UI 健康检测
echo ">>> 运行 UI 健康检测..."
cd "$PROJECT_DIR"
npx playwright test tests/ui-health.spec.js --reporter=list 2>&1 || echo "⚠️ 部分测试未通过，请检查"

# 8. 显示手动验证清单提示
echo ""
echo ">>> 手动验证清单: $PROJECT_DIR/MANUAL_TEST_CHECKLIST.md"
echo ">>> 请打开清单文件，逐项验证核心功能"

echo ""
echo "✅ 完成！APK: $OUTPUT_DIR/$APK_NAME"
