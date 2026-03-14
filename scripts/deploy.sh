#!/usr/bin/env bash
# digr deploy script — build static frontend and verify API server
set -euo pipefail

echo "==> Building static frontend..."
bun run build

echo "==> Build output:"
ls -lh build/

echo "==> Checking API server health..."
if curl -sf http://localhost:${PORT:-3001}/api/health > /dev/null 2>&1; then
	echo "    API server is running"
else
	echo "    API server not running. Start with: PORT=${PORT:-3001} bun scripts/api-server.ts"
fi

echo "==> Done. Serve build/ with a web server and proxy /api to port ${PORT:-3001}"
