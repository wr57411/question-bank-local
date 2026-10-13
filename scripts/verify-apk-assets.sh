#!/bin/bash
# APK 产物断言：确认打包产物真的包含关键功能（2026-09-17 复盘新增）
# 背景：语义检索曾出现"手机上的包有按钮但没有接线代码"，E2E 跑 dev 源码抓不到。
# 用法: ./scripts/verify-apk-assets.sh [APK路径]   （默认取原项目根最新 APK）
set -u
APK="${1:-$(ls -t /Users/john/question-bank-local/question-bank-local_*.apk 2>/dev/null | head -1)}"
if [ -z "$APK" ] || [ ! -f "$APK" ]; then
  echo "❌ 未找到 APK（可显式传路径）"
  exit 1
fi
echo ">>> 校验 APK: $APK"
FAIL=0
check() {
  local label="$1" path="$2" marker="$3" hit
  hit=$(unzip -p "$APK" "$path" 2>/dev/null | grep -c "$marker" || true)
  if [ "${hit:-0}" -gt 0 ]; then
    echo "  ✅ $label"
  else
    echo "  ❌ $label —— 缺少标记: $marker（该 APK 可能不含此功能）"
    FAIL=1
  fi
}
check "index.html 含以图搜按钮"   "assets/public/index.html"   "btn-image-search"
check "index.html 含语义结果区"   "assets/public/index.html"   "semantic-results"
check "JS 含向量拉取接线"         "assets/public/index-*.js"   "refreshEmbeddings"
check "JS 含语义检索模块"         "assets/public/index-*.js"   "semantic-results"
if [ "$FAIL" -eq 0 ]; then
  echo "✅ 产物断言通过：该 APK 含语义检索功能"
else
  echo "❌ 产物断言失败：不要把这个包装到手机上（先确认 BUILD_SOURCE=current 重打）"
  exit 1
fi
