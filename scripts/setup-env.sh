#!/bin/bash
# 环境变量配置引导脚本
# 用法: bash scripts/setup-env.sh

echo "=== 本地题库 - 环境变量配置 ==="
echo ""

read -p "OpenRouter API Key（留空跳过）: " api_key
read -p "测试手机号（留空跳过）: " phone
read -p "测试密码（留空跳过）: " password

ENV_FILE=".env.local"

echo "# 本地环境变量（不被 git 追踪）" > "$ENV_FILE"

if [ -n "$api_key" ]; then
  echo "OPENROUTER_API_KEY=$api_key" >> "$ENV_FILE"
fi

echo "TEST_SERVER_URL=http://localhost:3001" >> "$ENV_FILE"

if [ -n "$phone" ]; then
  echo "TEST_PHONE=$phone" >> "$ENV_FILE"
fi

if [ -n "$password" ]; then
  echo "TEST_PASSWORD=$password" >> "$ENV_FILE"
fi

echo ""
echo "已写入 $ENV_FILE"
echo "如需在当前 shell 中生效，请运行: source $ENV_FILE"
