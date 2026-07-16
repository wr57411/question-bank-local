#!/bin/bash
# AI Test Harness - 一键运行测试脚本
# 用法: bash scripts/run-ai-tests.sh [unit|mock|api|all]

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# 加载 .env
if [ -f "$PROJECT_DIR/.env" ]; then
  set -a
  source "$PROJECT_DIR/.env"
  set +a
fi

# 检查 API Key
if [ -z "$OPENROUTER_API_KEY" ] || [ "$OPENROUTER_API_KEY" = "your-key-here" ]; then
  echo "⚠️  真实 API 测试需要密钥，但未找到 OPENROUTER_API_KEY"
  echo "   请设置: export OPENROUTER_API_KEY=your_key"
  echo "   或复制 .env.example 到 .env 并填写"
  echo "   将跳过真实 API 测试，仅运行 unit + stream 测试"
  echo ""
fi

MODE="${1:-all}"

case "$MODE" in
  unit)
    echo "▶ 运行单元测试 (parser + content + stream)..."
    cd "$PROJECT_DIR" && npx vitest run unit-tests/atomizer-parser.spec.js unit-tests/generator-content.spec.js unit-tests/stream.spec.js
    ;;
  api)
    echo "▶ 运行真实 API 烟雾测试..."
    cd "$PROJECT_DIR" && npx vitest run unit-tests/real-api.spec.js
    ;;
  all)
    echo "▶ 运行全部测试..."
    cd "$PROJECT_DIR" && npx vitest run
    ;;
  *)
    echo "用法: $0 {unit|api|all}"
    exit 1
    ;;
esac
