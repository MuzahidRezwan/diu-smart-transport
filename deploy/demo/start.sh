#!/bin/sh
# Starts the public demo: ML service, fresh sample data, forecast, API + web.
set -eu
cd /app

PORT="${PORT:-7860}"
if [ -z "${PUBLIC_URL:-}" ]; then
  if [ -n "${SPACE_HOST:-}" ]; then PUBLIC_URL="https://${SPACE_HOST}"                                     # Hugging Face Spaces
  elif [ -n "${CODESPACE_NAME:-}" ]; then PUBLIC_URL="https://${CODESPACE_NAME}-${PORT}.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}"  # GitHub Codespaces
  else PUBLIC_URL="http://localhost:${PORT}"; fi
fi
PUBLIC_URL="${PUBLIC_URL%/}"
rand() { node -e "console.log(require('crypto').randomBytes($1).toString('$2'))"; }

export NODE_ENV=development DEMO_MODE=true PORT
export PUBLIC_API_URL="${PUBLIC_URL}/api" WEB_APP_URL="${PUBLIC_URL}" CORS_ORIGINS="${PUBLIC_URL}"
export WEB_DIST_DIR=/app/apps/web/dist TRUST_PROXY=true
export JWT_SECRET="${JWT_SECRET:-$(rand 48 base64url)}"
export DATA_ENCRYPTION_KEY="${DATA_ENCRYPTION_KEY:-$(rand 32 base64)}"
export ML_SERVICE_URL=http://127.0.0.1:8000 ML_SERVICE_TOKEN="${ML_SERVICE_TOKEN:-$(rand 24 base64url)}"
export DEMO_ADMIN_PASSWORD="${DEMO_ADMIN_PASSWORD:-diu-demo-2026}"
export SEED_ADMIN_PASSWORD="$DEMO_ADMIN_PASSWORD"
export PGLITE_DIR="${PGLITE_DIR:-/tmp/diu-demo/db}"

echo "DIU Smart Transport demo starting at ${PUBLIC_URL}"

(cd services/ml && MODEL_DIR=/app/ml-models exec /opt/ml/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --log-level warning) &
node deploy/demo/wait-for.mjs http://127.0.0.1:8000/health 60

# Fresh sample data on every start, then a forecast for today and the next 7 days.
rm -rf "$PGLITE_DIR"
cd apps/api
node dist/db/seed.js > /dev/null
node dist/db/demo.js
node dist/jobs/worker.js --run=forecast > /dev/null
node dist/server.js &
API_PID=$!
cd /app
node deploy/demo/wait-for.mjs "http://127.0.0.1:${PORT}/api/health" 60
# Publish suggested buses for the next few service days, so the student app shows bus numbers at once.
node deploy/demo/warmup.mjs "http://127.0.0.1:${PORT}/api" || echo "warm-up skipped"
# Simulated GPS trackers, so the live map moves.
node deploy/demo/gps-sim.mjs "http://127.0.0.1:${PORT}/api" &
echo "Ready: ${PUBLIC_URL}  (transport office 710215 / ${DEMO_ADMIN_PASSWORD})"
wait "$API_PID"
