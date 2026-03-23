#!/bin/bash
#
# Run Load Testing Suite
#
# Executes comprehensive load tests against ServalSheets HTTP server.
# Tests 1000+ concurrent requests with performance validation.
#
# Prerequisites:
# - npm run build (compiled dist/ directory)
# - TEST_SPREADSHEET_ID environment variable
# - TEST_TOKEN for authentication
#
# Usage:
#   ./scripts/run-load-tests.sh [test-name]
#
# Examples:
#   ./scripts/run-load-tests.sh                    # Run all load tests
#   ./scripts/run-load-tests.sh "read operations"  # Run specific test
#

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}╔═══════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║    ServalSheets Load Testing Suite           ║${NC}"
echo -e "${BLUE}║    Target: 1000+ Concurrent Requests          ║${NC}"
echo -e "${BLUE}╚═══════════════════════════════════════════════╝${NC}"
echo ""

# Check prerequisites
if [ ! -d "dist" ]; then
  echo -e "${RED}❌ Error: dist/ directory not found${NC}"
  echo "   Run 'npm run build' first"
  exit 1
fi

if [ -z "$TEST_SPREADSHEET_ID" ]; then
  echo -e "${YELLOW}⚠️  Warning: TEST_SPREADSHEET_ID not set${NC}"
  echo "   Using default test-sheet-id (will fail without real credentials)"
fi

if [ -z "$TEST_TOKEN" ]; then
  echo -e "${YELLOW}⚠️  Warning: TEST_TOKEN not set${NC}"
  echo "   Using default test-token (authentication may fail)"
fi

# System resource checks
echo -e "${BLUE}📊 System Resources:${NC}"
echo "   CPUs: $(sysctl -n hw.ncpu 2>/dev/null || nproc 2>/dev/null || echo 'unknown')"
echo "   Memory: $(sysctl -n hw.memsize 2>/dev/null | awk '{print $1/1024/1024/1024 " GB"}' || free -h 2>/dev/null | awk '/^Mem:/{print $2}' || echo 'unknown')"
echo "   Node Version: $(node --version)"
echo ""

# Increase system limits for load testing
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

# Run load tests
echo -e "${GREEN}🚀 Starting load tests...${NC}"
echo ""

if [ -n "$1" ]; then
  # Run specific test
  npx vitest run tests/load/stress-1k.test.ts -t "$1" --reporter=verbose
else
  # Run all load tests
  npx vitest run tests/load/stress-1k.test.ts --reporter=verbose
fi

EXIT_CODE=$?

echo ""
if [ $EXIT_CODE -eq 0 ]; then
  echo -e "${GREEN}╔═══════════════════════════════════════════════╗${NC}"
  echo -e "${GREEN}║  ✅ All load tests passed!                    ║${NC}"
  echo -e "${GREEN}╚═══════════════════════════════════════════════╝${NC}"
else
  echo -e "${RED}╔═══════════════════════════════════════════════╗${NC}"
  echo -e "${RED}║  ❌ Some load tests failed                     ║${NC}"
  echo -e "${RED}╚═══════════════════════════════════════════════╝${NC}"
fi

exit $EXIT_CODE
