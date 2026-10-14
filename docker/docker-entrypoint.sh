#!/bin/bash

# Check if STORAGE_DIR is set
if [ -z "$STORAGE_DIR" ]; then
    echo "================================================================"
    echo "⚠️  ⚠️  ⚠️  WARNING: STORAGE_DIR environment variable is not set! ⚠️  ⚠️  ⚠️"
    echo ""
    echo "Not setting this will result in data loss on container restart since"
    echo "the application will not have a persistent storage location."
    echo "It can also result in weird errors in various parts of the application."
    echo ""
    echo "Please run the container with the official docker command at"
    echo "https://docs.anythingllm.com/installation-docker/quickstart"
    echo ""
    echo "⚠️  ⚠️  ⚠️  WARNING: STORAGE_DIR environment variable is not set! ⚠️  ⚠️  ⚠️"
    echo "================================================================"
fi

{
  cd /app/server/ &&
    # Disable Prisma CLI telemetry (https://www.prisma.io/docs/orm/tools/prisma-cli#how-to-opt-out-of-data-collection)
    export CHECKPOINT_DISABLE=1 &&
    npx prisma generate --schema=./prisma/schema.prisma &&
    npx prisma migrate deploy --schema=./prisma/schema.prisma &&
    node /app/server/index.js
} &
{ node /app/collector/index.js; } &
# FTS 精灵 Python 服务：只监听容器内 127.0.0.1；异常退出后自动重启，
# 避免 wait -n 因为它退出而导致整个容器退出。
{
  cd /app/fts_sprite &&
    while true; do
      /app/fts_sprite/.venv/bin/python -m uvicorn main:app \
        --host 127.0.0.1 --port "${FTS_SPRITE_PORT:-8890}" --log-level warning
      echo "[fts_sprite] service exited with code $?, restarting in 2s..."
      sleep 2
    done
} &
wait -n
exit $?