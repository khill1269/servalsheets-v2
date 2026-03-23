#!/usr/bin/env bash
# Regenerate tool hash baseline after intentional tool description changes.
# Usage: npm run tool-hashes
#
# Run this script whenever you intentionally change a tool's name or description,
# then commit the updated src/security/tool-hashes.baseline.json.
# CI will fail if tool descriptions drift from the baseline without regenerating.
set -euo pipefail

BUILD_DIR="${BUILD_DIR:-dist}"
PORT="${PORT:-3099}"
BASELINE="src/security/tool-hashes.baseline.json"

echo "Building server..."
npm run build

echo "Starting server on port $PORT..."
node "$BUILD_DIR/cli.js" --http --port "$PORT" &
SERVER_PID=$!

cleanup() {
  kill "$SERVER_PID" 2>/dev/null || true
}
trap cleanup EXIT

echo "Waiting for server to be ready..."
for i in $(seq 1 10); do
  if curl -fsS "http://127.0.0.1:$PORT/health/ready" >/dev/null 2>&1; then
    echo "Server ready."
    break
  fi
  sleep 1
done

echo "Generating tool hashes..."
npx @anthropics/mcp-scan hash --server "http://127.0.0.1:$PORT" --output "$BASELINE"

echo ""
echo "Baseline updated at $BASELINE"
echo "Commit this file to record the intentional change."
