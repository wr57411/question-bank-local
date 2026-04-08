#!/bin/bash
# 自动 Git 提交脚本
# 监控项目目录，有改动自动 commit + push
# 用法: ./auto-commit.sh

PROJECT_DIR="/Users/john/question-bank-local"
cd "$PROJECT_DIR"

echo "🔄 自动备份已启动，监控目录: $PROJECT_DIR"
echo "按 Ctrl+C 停止"

# 初始提交（如果有未提交的改动）
if [ -n "$(git status --porcelain)" ]; then
    git add -A
    git commit -m "auto: $(date '+%Y-%m-%d %H:%M:%S') 自动备份" --quiet
    git push origin main --quiet 2>/dev/null
    echo "✅ 初始备份完成"
fi

# 监听文件变化
fswatch -r -o --exclude '\.git' --exclude 'node_modules' --exclude 'android/app/build' --exclude '\.gradle' "$PROJECT_DIR" | while read; do
    sleep 2  # 等待文件写入完成
    if [ -n "$(git status --porcelain)" ]; then
        git add -A
        git commit -m "auto: $(date '+%Y-%m-%d %H:%M:%S')" --quiet
        git push origin main --quiet 2>/dev/null
        echo "✅ $(date '+%H:%M:%S') 自动备份完成"
    fi
done
