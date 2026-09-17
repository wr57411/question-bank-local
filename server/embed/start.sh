#!/bin/bash
cd "$(dirname "$0")"
exec /Users/john/.workbuddy/binaries/python/envs/default/bin/uvicorn embed_service:app --host 127.0.0.1 --port 3002
