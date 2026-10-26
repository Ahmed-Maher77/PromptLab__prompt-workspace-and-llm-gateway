#!/bin/sh
set -e

echo "[docker-entrypoint] Applying database migrations..."
npx prisma migrate deploy

echo "[docker-entrypoint] Starting PromptLab API..."
exec "$@"
