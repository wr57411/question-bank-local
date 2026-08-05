#!/bin/bash
set -e
cd "$(dirname "$0")"

PYTHON=${PYTHON:-python3.12}

if ! command -v "$PYTHON" >/dev/null 2>&1; then
  echo "未找到 $PYTHON，请先安装 Python 3.12（paddlepaddle 不支持 3.13+）"
  exit 1
fi

if [ ! -d .venv ]; then
  echo "创建虚拟环境并安装依赖（首次需下载模型，耗时较长，占用约 3GB 磁盘）..."
  "$PYTHON" -m venv .venv
  .venv/bin/pip install --upgrade pip
  .venv/bin/pip install -r requirements.txt --index-url https://pypi.org/simple
fi

echo "启动本地 OCR 服务: http://localhost:8766"
exec .venv/bin/uvicorn main:app --host 0.0.0.0 --port 8766
