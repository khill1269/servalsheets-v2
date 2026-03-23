#!/bin/bash
# ServalSheets Change Validation Script
# Run this before any code changes to ensure nothing breaks
set -e

echo "🛡️  ServalSheets Change Validation"
echo "=================================="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Track failures
FAILURES=0

# Function to run a gate
run_gate() {
    local gate_name="$1"
    local command="$2"
    
    echo -n "📋 Gate: $gate_name... "
    
    if eval "$command" > /tmp/gate_output.log 2>&1; then
        echo -e "${GREEN}✓ PASSED${NC}"
        return 0
    else
        echo -e "${RED}✗ FAILED${NC}"
        echo "   └─ See /tmp/gate_output.log for details"
        FAILURES=$((FAILURES + 1))
        return 1
    fi
}

# Gate 1: TypeScript compilation
run_gate "TypeScript Check" "npm run typecheck"

# Gate 2: ESLint
run_gate "ESLint" "npm run lint"

# Gate 3: Prettier format check
run_gate "Format Check" "npm run format:check"

# Gate 4: Schema tests
run_gate "Schema Tests" "npm run test -- tests/schemas --run --reporter=dot"

# Gate 5: Unit tests
run_gate "Unit Tests" "npm run test:unit -- --run --reporter=dot"

# Gate 6: Build
run_gate "Build" "npm run build"

# Gate 7: Metadata sync check
run_gate "Metadata Sync" "npm run check:drift"

# Gate 8: Server JSON validation
run_gate "Server JSON" "npm run validate:server-json"

# Gate 9: Quick smoke test
run_gate "Smoke Test" "npm run smoke:quick"

echo ""
echo "=================================="

if [ $FAILURES -eq 0 ]; then
    echo -e "${GREEN}✅ All gates passed! Safe to proceed with changes.${NC}"
    exit 0
else
    echo -e "${RED}❌ $FAILURES gate(s) failed. Fix issues before proceeding.${NC}"
    exit 1
fi
