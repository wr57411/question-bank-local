#!/bin/bash
export PATH="/Users/john/.hermes/node/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
cd /Users/john/.codex/worktrees/f640/question-bank-local/server
exec node node_modules/tsx/dist/cli.mjs src/index.ts
