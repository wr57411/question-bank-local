@echo off
cd /d %~dp0
set DB_PATH=./data.db
set PORT=3001
set PRIMARY_SERVER_URL=
set SYNC_PHONE=
set SYNC_PASSWORD=
set SERVER_SYNC_INTERVAL=300000
if exist .env for /f "tokens=*" %%a in (.env) do set %%a
node node_modules/tsx/dist/cli.mjs src/index.ts
