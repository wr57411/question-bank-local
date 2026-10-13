#!/bin/bash
# setup-worktree.sh - 新 worktree 一次性前置：node_modules / local.properties / llama.cpp
# 这三项都被 gitignore（或体积过大），worktree 重建后跑一次本脚本即可打包
set -e

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"
echo ">>> worktree: $PROJECT_DIR"

if [ -d node_modules ]; then
  echo ">>> [1/3] node_modules 已存在，跳过"
else
  echo ">>> [1/3] npm install..."
  npm install --no-audit --no-fund
fi

SDK_FILE="android/local.properties"
if [ -f "$SDK_FILE" ]; then
  echo ">>> [2/3] $SDK_FILE 已存在，跳过"
else
  for SRC in /Users/john/.codex/worktrees/f640/question-bank-local /Users/john/question-bank-local; do
    if [ -f "$SRC/android/local.properties" ]; then
      cp "$SRC/android/local.properties" "$SDK_FILE"
      echo ">>> [2/3] 已从 $SRC 复制 local.properties"
      break
    fi
  done
  if [ ! -f "$SDK_FILE" ]; then
    echo 'sdk.dir=/Users/john/Library/Android' > "$SDK_FILE"
    echo ">>> [2/3] 未找到可复制的源，已写入默认 sdk.dir"
  fi
fi

LLAMA_LINK="android/app/src/main/cpp/llama.cpp"
if [ -L "$LLAMA_LINK" ] && [ ! -e "$LLAMA_LINK" ]; then
  echo ">>> [3/3] 发现断链，删除重建"
  rm "$LLAMA_LINK"
fi
if [ -e "$LLAMA_LINK" ]; then
  echo ">>> [3/3] llama.cpp 已存在，跳过"
else
  LLAMA_SRC=""
  for SRC in /Users/john/.codex/worktrees/f640/question-bank-local /Users/john/question-bank-local; do
    if [ -d "$SRC/android/app/src/main/cpp/llama.cpp" ]; then
      LLAMA_SRC="$SRC/android/app/src/main/cpp/llama.cpp"
      break
    fi
  done
  if [ -n "$LLAMA_SRC" ]; then
    ln -s "$LLAMA_SRC" "$LLAMA_LINK"
    echo ">>> [3/3] 已软链 llama.cpp -> $LLAMA_SRC"
  else
    echo ">>> [3/3] 本机无可复用的 llama.cpp，从上游 clone（锁定项目当前用的 ff6b106）..."
    git clone https://github.com/ggml-org/llama.cpp.git "$LLAMA_LINK" \
      && git -C "$LLAMA_LINK" checkout ff6b106 \
      && echo ">>> [3/3] llama.cpp 已就绪（若构建报 JNI 接口错误，对照旧 worktree 的 llama.cpp 对齐版本）" \
      || { echo "❌ llama.cpp 获取失败，请手动 clone https://github.com/ggml-org/llama.cpp.git 到 $LLAMA_LINK"; exit 1; }
  fi
fi

echo ""
echo "✅ 前置就绪。打包：BUILD_SOURCE=current npm run ship -- \"功能描述\""
