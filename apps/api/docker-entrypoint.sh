#!/bin/sh
set -e

echo "[docker-entrypoint] Applying database migrations..."
npx prisma migrate deploy

# Demo data is opt-in: the seed is idempotent, so it is safe on every start.
if [ "${SEED_DEMO_DATA:-false}" = "true" ]; then
  echo "[docker-entrypoint] Seeding reference prompts (SEED_DEMO_DATA=true)..."
  node dist/database/seed.js
fi

echo "[docker-entrypoint] Starting PromptLab API..."
exec "$@"
