#!/bin/bash
# 服务部署态探针（2026-09-17 复盘新增）
# 背景：语义检索的 /api/embed 路由曾因"服务进程仍跑旧目录代码"而 404，真机才发现。
# 用法: ./scripts/verify-server-deploy.sh [BASE_URL]   （默认 http://127.0.0.1:3001）
set -u
BASE="${1:-http://127.0.0.1:3001}"
FAIL=0
code() { curl -s -o /dev/null -w "%{http_code}" --noproxy '*' --max-time 6 "$1" || echo "000"; }

H=$(code "$BASE/api/health")
if [ "$H" = "200" ]; then echo "  ✅ health 200"; else echo "  ❌ health=$H（服务未运行？）"; FAIL=1; fi

V=$(code "$BASE/api/embed/vectors")
case "$V" in
  401|403) echo "  ✅ embed/vectors ${V}（路由在线，鉴权生效）" ;;
  200)     echo "  ✅ embed/vectors 200" ;;
  404)     echo "  ❌ embed/vectors 404 —— 服务进程在跑旧代码"
           echo "     处置：launchctl kickstart -k gui/501/com.questionbank.ts-server（重启加载最新代码）"
           FAIL=1 ;;
  *)       echo "  ⚠️ embed/vectors=${V}（异常状态码）"; FAIL=1 ;;
esac

PID=$(lsof -nP -i :3001 -sTCP:LISTEN 2>/dev/null | tail -1 | awk '{print $2}')
if [ -n "${PID:-}" ]; then
  CWD=$(lsof -p "$PID" 2>/dev/null | awk '$4=="cwd" {print $NF}')
  echo "  ℹ️ 服务 PID=$PID  cwd=$CWD"
  case "$CWD" in
    *codex*worktrees*) echo "  ✅ 运行源 = codex worktree（预期）" ;;
    *) echo "  ⚠️ 运行源不是 codex worktree，确认是否符合预期" ;;
  esac
else
  echo "  ⚠️ 未取得监听进程（lsof 受限）"
fi

if [ "$FAIL" -eq 0 ]; then echo "✅ 部署探针通过"; else echo "❌ 部署探针失败"; exit 1; fi
