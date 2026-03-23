#!/usr/bin/env bash

set -euo pipefail

HOTSPOT_FILES=(
  "src/analysis/comprehensive.ts"
  "src/services/google-api.ts"
  "src/services/agent-engine.ts"
  "src/mcp/sampling.ts"
  "src/handlers/base.ts"
  "src/handlers/dimensions.ts"
  "src/handlers/bigquery.ts"
  "src/services/session-context.ts"
  "src/mcp/registration/tool-response.ts"
  "src/mcp/registration/tool-execution-side-effects.ts"
)

mkdir -p audit-output

echo "Release audit: release gate"
npm run verify:release

echo "Release audit: quick audit score"
npm run audit:quick

echo "Release audit: targeted hotspot analysis"
node --import tsx scripts/analysis/cli.ts analyze \
  --exclude=CodeQuality,Testing,Consistency,Security,DocumentationValidator \
  --format json \
  "${HOTSPOT_FILES[@]}" > audit-output/hotspot-analysis.json
node scripts/summarize-hotspot-analysis.mjs \
  audit-output/hotspot-analysis.json \
  audit-output/hotspot-summary.json

HAS_LIVE_CREDENTIALS=false
if [ -n "${GOOGLE_TEST_CREDENTIALS_PATH:-}" ]; then
  HAS_LIVE_CREDENTIALS=true
elif [ -n "${GOOGLE_APPLICATION_CREDENTIALS:-}" ]; then
  HAS_LIVE_CREDENTIALS=true
elif [ -f "tests/config/test-credentials.json" ]; then
  HAS_LIVE_CREDENTIALS=true
fi

if [ "${TEST_REAL_API:-false}" = "true" ] && [ "${HAS_LIVE_CREDENTIALS}" = "true" ]; then
  echo "Release audit: live Google fast suite"
  npm run test:live:fast
else
  echo "Release audit: live Google fast suite skipped (set TEST_REAL_API=true and configure GOOGLE_TEST_CREDENTIALS_PATH, GOOGLE_APPLICATION_CREDENTIALS, or tests/config/test-credentials.json)"
fi

echo "Release audit completed."
