#!/usr/bin/env bash
#
# Build Time Benchmark Script
#
# Tests build performance with and without cache
#

set -euo pipefail

echo "🏗️  ServalSheets Build Time Benchmark"
echo "======================================"
echo ""

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to time a command
time_command() {
  local description="$1"
  local command="$2"

  echo -e "${BLUE}▶ ${description}${NC}"

  local start=$(date +%s)
  eval "$command"
  local end=$(date +%s)
  local duration=$((end - start))

  echo -e "${GREEN}✓ Completed in ${duration}s${NC}"
  echo ""

  echo "$duration"
}

# Clean build artifacts
clean_build() {
  echo -e "${YELLOW}🧹 Cleaning build artifacts...${NC}"
  rm -rf dist/ .turbo/ .tsbuildinfo .tsbuildinfo.build 2>/dev/null || true
  echo ""
}

echo "Test 1: Clean build (no cache)"
echo "-------------------------------"
clean_build
CLEAN_TIME=$(time_command "Clean build" "npm run build > /dev/null 2>&1")

echo "Test 2: Incremental build (with cache)"
echo "---------------------------------------"
echo -e "${YELLOW}Making small change to trigger rebuild...${NC}"
touch src/version.ts
INCREMENTAL_TIME=$(time_command "Incremental build" "npm run build > /dev/null 2>&1")

echo "Test 3: No-op build (no changes)"
echo "---------------------------------"
NOOP_TIME=$(time_command "No-op build" "npm run build > /dev/null 2>&1")

echo "Test 4: Turbo-cached build"
echo "--------------------------"
clean_build
time_command "First build (turbo)" "npx turbo run build > /dev/null 2>&1"
clean_build
TURBO_TIME=$(time_command "Cached build (turbo)" "npx turbo run build > /dev/null 2>&1")

# Summary
echo ""
echo "📊 Build Time Summary"
echo "====================="
echo ""
printf "%-30s %10s\n" "Clean build (no cache):" "${CLEAN_TIME}s"
printf "%-30s %10s\n" "Incremental build:" "${INCREMENTAL_TIME}s"
printf "%-30s %10s\n" "No-op build:" "${NOOP_TIME}s"
printf "%-30s %10s\n" "Turbo cached build:" "${TURBO_TIME}s"
echo ""

# Calculate improvements
IMPROVEMENT=$((100 - (INCREMENTAL_TIME * 100 / CLEAN_TIME)))
echo -e "${GREEN}✨ Incremental build is ${IMPROVEMENT}% faster than clean build${NC}"

if [ "$INCREMENTAL_TIME" -le 15 ]; then
  echo -e "${GREEN}✅ Target achieved: Incremental build ≤ 15s${NC}"
else
  echo -e "${YELLOW}⚠️  Target not met: Incremental build should be ≤ 15s (current: ${INCREMENTAL_TIME}s)${NC}"
fi

echo ""
echo "🎯 Goals:"
echo "  - First build: 45-60s (baseline)"
echo "  - Incremental: ≤ 15s (75% improvement)"
echo "  - CI with cache: 15-20s"
