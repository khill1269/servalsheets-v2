#!/bin/bash
# ServalSheets - 4-Level Gate Pipeline
#
# MUST pass in order: G0 → G1 → G2 → G3 → G4
# Any gate failure stops the pipeline immediately
#
# G0: Baseline integrity (typecheck, lint, drift)
# G1: Metadata consistency (cross-map, hardcoded counts)
# G2: Phase behavior (handlers, integration, compliance)
# G3: API/protocol/docs quality (compliance, docs)
# G4: Final truth check (ESM-safe constants)
#
# Usage: bash scripts/validation-gates.sh
# CI: npm run gates

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

echo "═══════════════════════════════════════"
echo "  GATE PIPELINE - ServalSheets"
echo "═══════════════════════════════════════"
echo ""

# G0: Baseline integrity
echo ""
echo "▶ G0: BASELINE INTEGRITY"
echo "───────────────────────────────────────"
npm run typecheck
npm run lint
npm run check:placeholders
npm run check:silent-fallbacks
npm run check:debug-prints
npm run check:drift
npm run validate:server-json
npm run test:fast
echo "✅ G0 passed"

# G1: Metadata/map consistency
echo ""
echo "▶ G1: METADATA CONSISTENCY"
echo "───────────────────────────────────────"
npm test -- --run tests/contracts/cross-map-consistency.test.ts
npm test -- --run tests/contracts/schema-handler-alignment.test.ts
bash scripts/check-hardcoded-counts.sh
node --import tsx scripts/validate-schema-handler-alignment.ts
npm run validate:action-config
echo "✅ G1 passed"

# G2: Phase behavior
echo ""
echo "▶ G2: PHASE BEHAVIOR"
echo "───────────────────────────────────────"
npm run test:handlers
npm run test:integration
npm run test:compliance
npm run test:simulation
npm run audit:memory
npx vitest run tests/benchmarks/performance-regression.test.ts
echo "✅ G2 passed"

# G3: API/protocol/docs quality
echo ""
echo "▶ G3: API/PROTOCOL/DOCS"
echo "───────────────────────────────────────"
npm run validate:compliance
npm run docs:lint:baseline
npm run docs:check-links
npm run docs:freshness:ci
echo "✅ G3 passed"

# G4: Final truth check (ESM-safe)
echo ""
echo "▶ G4: FINAL TRUTH CHECK"
echo "───────────────────────────────────────"
npm run build > /dev/null 2>&1
node scripts/check-source-truth.mjs
echo "✅ G4 passed"

# G5: Audit validation & score
echo ""
echo "▶ G5: AUDIT VALIDATION & SCORE"
echo "───────────────────────────────────────"

# Validate any audit documents present
if [ -f "SCHEMA_HANDLER_ALIGNMENT_AUDIT.md" ] || \
   compgen -G "*_AUDIT.md" > /dev/null || \
   compgen -G "*_ANALYSIS.md" > /dev/null; then
  echo "Validating audit claims..."
  bash scripts/verify-audit-claims.sh || {
    echo "❌ Audit claims validation failed"
    exit 1
  }
fi

# Check npm audit score
npm run audit:quick > /dev/null 2>&1
node scripts/check-audit-score.mjs
echo "✅ G5 passed"

echo ""
echo "═══════════════════════════════════════"
echo "  ✅ ALL GATES PASSED (G0-G5)"
echo "═══════════════════════════════════════"
