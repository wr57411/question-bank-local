#!/usr/bin/env bash
# iOS Info.plist 权限与方向补丁
# 在 `npx cap sync ios` 之后执行，防止 Capacitor 覆盖我们手动加的 key。
# 用法: bash scripts/ios-plist-patch.sh
set -euo pipefail

PLIST="ios/App/App/Info.plist"
if [ ! -f "$PLIST" ]; then
  echo "[ios-plist-patch] 未找到 $PLIST，先执行 npx cap add ios"
  exit 1
fi

PB="/usr/libexec/PlistBuddy"

add_string () {
  local key="$1" val="$2"
  if ! "$PB" -c "Print :${key}" "$PLIST" >/dev/null 2>&1; then
    "$PB" -c "Add :${key} string '${val}'" "$PLIST"
    echo "[ios-plist-patch] 添加 ${key}"
  else
    echo "[ios-plist-patch] 已存在 ${key}，跳过"
  fi
}

add_string "NSCameraUsageDescription"         "需要使用相机拍摄题目照片"
add_string "NSPhotoLibraryUsageDescription"   "需要访问相册选择题目图片"
add_string "NSPhotoLibraryAddUsageDescription" "需要保存图片到相册"

IPAD_KEY="UISupportedInterfaceOrientations~ipad"
if ! "$PB" -c "Print :${IPAD_KEY}" "$PLIST" >/dev/null 2>&1; then
  "$PB" -c "Add :${IPAD_KEY} array" "$PLIST"
  "$PB" -c "Add :${IPAD_KEY}:0 string UIInterfaceOrientationPortrait" "$PLIST"
  "$PB" -c "Add :${IPAD_KEY}:1 string UIInterfaceOrientationPortraitUpsideDown" "$PLIST"
  "$PB" -c "Add :${IPAD_KEY}:2 string UIInterfaceOrientationLandscapeLeft" "$PLIST"
  "$PB" -c "Add :${IPAD_KEY}:3 string UIInterfaceOrientationLandscapeRight" "$PLIST"
  echo "[ios-plist-patch] 添加 ${IPAD_KEY}"
else
  echo "[ios-plist-patch] 已存在 ${IPAD_KEY}，跳过"
fi

echo "[ios-plist-patch] 完成"
