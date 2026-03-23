#!/bin/bash

set -euo pipefail

if [ -f "SCHEMA_HANDLER_ALIGNMENT_AUDIT.md" ] || compgen -G "*_AUDIT.md" > /dev/null || compgen -G "*_ANALYSIS.md" > /dev/null; then
  echo "Validating audit claims..."
  bash scripts/verify-audit-claims.sh
fi

npm run audit:quick
node scripts/check-audit-score.mjs
