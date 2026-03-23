#!/bin/bash
#
# Run Chaos Engineering Test Suite
#
# Executes resilience tests that inject various failure scenarios
# to validate ServalSheets' fault tolerance and recovery capabilities.
#
# Prerequisites:
# - npm run build (compiled dist/ directory)
# - TEST_SPREADSHEET_ID environment variable (optional)
# - TEST_TOKEN for authentication (optional)
#
# Usage:
#   ./scripts/run-chaos-tests.sh [test-name]
#
# Examples:
#   ./scripts/run-chaos-tests.sh                    # Run all chaos tests
#   ./scripts/run-chaos-tests.sh "network failure"  # Run specific test
#

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}╔═══════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║    ServalSheets Chaos Engineering Suite       ║${NC}"
echo -e "${BLUE}║    Resilience & Fault Tolerance Testing       ║${NC}"
echo -e "${BLUE}╚═══════════════════════════════════════════════╝${NC}"
echo ""

# Check prerequisites
if [ ! -d "dist" ]; then
  echo -e "${RED}❌ Error: dist/ directory not found${NC}"
  echo "   Run 'npm run build' first"
  exit 1
fi

# System resource checks
echo -e "${BLUE}📊 System Resources:${NC}"
echo "   CPUs: $(sysctl -n hw.ncpu 2>/dev/null || nproc 2>/dev/null || echo 'unknown')"
echo "   Memory: $(sysctl -n hw.memsize 2>/dev/null | awk '{print $1/1024/1024/1024 " GB"}' || free -h 2>/dev/null | awk '/^Mem:/{print $2}' || echo 'unknown')"
echo "   Node Version: $(node --version)"
echo ""

# Increase system limits for chaos testing
echo -e "${BLUE}⚙️  Adjusting system limits...${NC}"

# macOS
if [[ "$OSTYPE" == "darwin"* ]]; then
  ulimit -n 10000 2>/dev/null || echo "   Note: Could not increase file descriptor limit"
# Linux
else
  ulimit -n 65536 2>/dev/null || echo "   Note: Could not increase file descriptor limit"
fi

# Increase Node.js memory limit
export NODE_OPTIONS="--max-old-space-size=4096"

echo "   File descriptors: $(ulimit -n)"
echo "   Node memory: 4GB"
echo ""

# Run chaos tests
echo -e "${GREEN}🌪️  Injecting chaos...${NC}"
echo ""

if [ -n "$1" ]; then
  # Run specific test
  npx vitest run tests/chaos/resilience.test.ts -t "$1" --config vitest.config.chaos.ts
else
  # Run all chaos tests
  npx vitest run tests/chaos/resilience.test.ts --config vitest.config.chaos.ts
fi

EXIT_CODE=$?

echo ""
if [ $EXIT_CODE -eq 0 ]; then
  echo -e "${GREEN}╔═══════════════════════════════════════════════╗${NC}"
  echo -e "${GREEN}║  ✅ System is resilient to chaos!             ║${NC}"
  echo -e "${GREEN}╚═══════════════════════════════════════════════╝${NC}"
else
  echo -e "${RED}╔═══════════════════════════════════════════════╗${NC}"
  echo -e "${RED}║  ❌ Some resilience tests failed               ║${NC}"
  echo -e "${RED}║     Review failures above                      ║${NC}"
  echo -e "${RED}╚═══════════════════════════════════════════════╝${NC}"
fi

exit $EXIT_CODE
