#!/bin/bash
ADB="/Users/john/Library/Android/sdk/platform-tools/adb"
PACKAGE="com.questionbank.local"

echo "🔍 [1/3] 检查进程与包名..."
$ADB shell ps | grep $PACKAGE
$ADB shell pm list packages | grep $PACKAGE

echo "📊 [2/3] 原始内存快照 (前 10 行)..."
$ADB shell dumpsys meminfo $PACKAGE | head -n 10

echo "🔥 [3/3] 暴力抓取原生日志 (不限 Tag, 查找关键字符串)..."
# 同时查找 MainActivity 埋点和插件埋点
$ADB logcat -d | grep -iE "NATIVE CODE|Gemma4|QUESTION BANK" | tail -n 20
