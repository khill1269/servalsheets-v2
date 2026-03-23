#!/bin/bash
##
# Audit Claims Verification Script
#
# Validates that audit documents include required evidence:
# - Command outputs proving the claim
# - Test results showing the issue
# - Coverage data for dead code claims
#
# Usage: ./verify-audit-claims.sh [audit-file]
# Default: Checks SCHEMA_HANDLER_ALIGNMENT_AUDIT.md
#
# Exit codes:
# 0 - Audit valid and verified
# 1 - Audit claims are invalid
# 2 - Audit missing required evidence
##

set -e

AUDIT_FILE="${1:-SCHEMA_HANDLER_ALIGNMENT_AUDIT.md}"

echo "═══════════════════════════════════════════════════════"
echo "  Audit Claims Verification"
echo "═══════════════════════════════════════════════════════"
echo ""
echo "Audit file: $AUDIT_FILE"
echo ""

if [ ! -f "$AUDIT_FILE" ]; then
  echo "⚠️  No audit file found: $AUDIT_FILE"
  echo "    Skipping audit validation"
  exit 0
fi

echo "Checking audit requirements..."
echo ""

# Check 1: Does audit claim "dead code"?
if grep -q "DEAD CODE\|dead code\|unreachable" "$AUDIT_FILE"; then
  echo "✓ Audit claims dead code found"

  # Extract file and line numbers from audit
  # Pattern: "lines 1091-1207" or "lines 1091 to 1207"
  DEAD_CODE_CLAIM=$(grep -E "lines? [0-9]+-[0-9]+|lines? [0-9]+ to [0-9]+" "$AUDIT_FILE" | head -1 || echo "")

  if [ -z "$DEAD_CODE_CLAIM" ]; then
    echo "❌ Dead code claim found but no line numbers specified"
    echo "   Required format: 'lines 1091-1207' or 'lines 1091 to 1207'"
    exit 2
  fi

  echo "  Found claim: $DEAD_CODE_CLAIM"

  # Extract line numbers (handle both formats: 1091-1207 and 1091 to 1207)
  START_LINE=$(echo "$DEAD_CODE_CLAIM" | grep -oE '[0-9]{3,5}' | head -1)
  END_LINE=$(echo "$DEAD_CODE_CLAIM" | grep -oE '[0-9]{3,5}' | tail -1)

  # Extract file name from audit
  FILE_CLAIM=$(grep -oE "src/[a-z/]+\.(ts|js)" "$AUDIT_FILE" | head -1 || echo "")

  if [ -z "$FILE_CLAIM" ]; then
    echo "❌ Dead code claim found but no file specified"
    echo "   Required format: 'src/handlers/format.ts' or similar"
    exit 2
  fi

  echo "  File: $FILE_CLAIM"
  echo "  Lines: $START_LINE-$END_LINE"
  echo ""
  echo "Verifying dead code claim with coverage..."
  echo ""

  # Run dead code verification
  if bash scripts/verify-dead-code-claims.sh "$FILE_CLAIM" "$START_LINE" "$END_LINE"; then
    echo ""
    echo "❌ AUDIT CLAIM INVALID"
    echo "   Code at $FILE_CLAIM:$START_LINE-$END_LINE has test coverage"
    echo "   This is NOT dead code!"
    echo ""
    echo "Recommendation:"
    echo "  1. Review the audit methodology"
    echo "  2. Distinguish action-level vs parameter-level switches"
    echo "  3. Run tests to verify claims before creating audit"
    exit 1
  else
    echo ""
    echo "✓ Dead code claim appears valid (0% coverage)"
  fi
fi

# Check 2: Does audit include command outputs?
echo ""
echo "Checking for required evidence..."

EVIDENCE_COUNT=0

if grep -q '```bash\|```sh\|```console\|```' "$AUDIT_FILE"; then
  EVIDENCE_COUNT=$((EVIDENCE_COUNT + 1))
  echo "✓ Audit includes command outputs"
else
  echo "⚠️  Audit missing command outputs (recommended)"
fi

if grep -q 'npm test\|npm run\|vitest\|jest' "$AUDIT_FILE"; then
  EVIDENCE_COUNT=$((EVIDENCE_COUNT + 1))
  echo "✓ Audit includes test commands"
else
  echo "⚠️  Audit missing test commands (recommended)"
fi

# Check 3: Does audit include alignment check output?
if grep -q 'validate:schema-handler-alignment\|Schema.*actions.*Handler.*cases' "$AUDIT_FILE"; then
  EVIDENCE_COUNT=$((EVIDENCE_COUNT + 1))
  echo "✓ Audit includes alignment check results"
else
  echo "⚠️  Audit missing alignment check (recommended)"
fi

echo ""
echo "Evidence score: $EVIDENCE_COUNT/3"

if [ "$EVIDENCE_COUNT" -lt 2 ]; then
  echo ""
  echo "⚠️  AUDIT MISSING REQUIRED EVIDENCE"
  echo "   Recommended: Include command outputs, test results, and alignment checks"
  echo "   See .github/AUDIT_TEMPLATE.md for proper format"
  exit 2
fi

echo ""
echo "═══════════════════════════════════════════════════════"
echo "  ✅ AUDIT VALIDATION COMPLETE"
echo "═══════════════════════════════════════════════════════"
exit 0
