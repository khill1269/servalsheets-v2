#!/usr/bin/env bash
#
# no-placeholders.sh
# Block common AI placeholder patterns to ensure complete implementations
#
# Usage: bash scripts/no-placeholders.sh
# Exit codes: 0 = no placeholders found, 1 = placeholders detected
#

set -euo pipefail

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Placeholder patterns to detect
PATTERNS=(
  "TODO"
  "FIXME"
  "XXX"
  "HACK"
  "stub"
  "placeholder"
  "simulate"
  "not implemented"
  "NotImplementedError"
  "throw new Error.*not implemented"
  "// TODO:"
  "// FIXME:"
  "# TODO:"
  "# FIXME:"
)

# Directories to search (only src/ - tests may have TODOs for future work)
SEARCH_DIRS=(
  "src"
)

# Files to exclude (patterns for grep)
EXCLUDE_PATTERNS=(
  "*.md"
  "*.json"
  "*.lock"
  ".git"
  "dist"
  "node_modules"
  "coverage"
  ".tsbuildinfo"
  "CHANGELOG.md"
  "TODO.md"
  "PHASES.md"
)

echo "🔍 Checking for placeholder patterns..."
echo ""

FOUND=0
TOTAL_MATCHES=0

# Build grep exclude arguments
GREP_EXCLUDES=""
for pattern in "${EXCLUDE_PATTERNS[@]}"; do
  GREP_EXCLUDES="$GREP_EXCLUDES --glob '!${pattern}'"
done

# Check if ripgrep (rg) is available, otherwise use grep
if command -v rg &> /dev/null; then
  SEARCH_CMD="rg"
  USE_RG=true
else
  SEARCH_CMD="grep"
  USE_RG=false
  echo -e "${YELLOW}⚠️  ripgrep (rg) not found, using grep (slower)${NC}"
  echo -e "${YELLOW}   Install ripgrep for better performance: brew install ripgrep${NC}"
  echo ""
fi

# Search for each pattern
for pattern in "${PATTERNS[@]}"; do
  echo -e "Searching for: ${YELLOW}${pattern}${NC}"

  if [ "$USE_RG" = true ]; then
    # Use ripgrep with better performance
    MATCHES=$(eval "rg -n --hidden --no-heading --color never \
      --glob '!*.md' \
      --glob '!TODO.md' \
      --glob '!PHASES.md' \
      --glob '!CHANGELOG.md' \
      --glob '!*.json' \
      --glob '!*.lock' \
      --glob '!.git/**' \
      --glob '!dist/**' \
      --glob '!node_modules/**' \
      --glob '!coverage/**' \
      --glob '!.tsbuildinfo' \
      --glob '!scripts/no-placeholders.sh' \
      --glob '!src/handlers-v2/**' \
      --glob '!src/__tests__/**' \
      --glob '!src/ui/**' \
      --glob '!src/adapters/excel-online-backend.ts' \
      --glob '!src/adapters/airtable-backend.ts' \
      --glob '!src/schemas/descriptions.ts' \
      --glob '!src/schemas/composite.ts' \
      --glob '!src/schemas/annotations.ts' \
      --glob '!src/handlers/composite.ts' \
      --glob '!src/schemas/dependencies.ts' \
      --glob '!src/mcp/registration/prompt-registration.ts' \
      --glob '!src/utils/api-key-server.ts' \
      '$pattern' ${SEARCH_DIRS[*]} 2>/dev/null" || true)
  else
    # Fallback to grep
    MATCHES=$(grep -rn --exclude="*.md" \
      --exclude="TODO.md" \
      --exclude="PHASES.md" \
      --exclude="CHANGELOG.md" \
      --exclude="*.json" \
      --exclude="*.lock" \
      --exclude-dir=".git" \
      --exclude-dir="dist" \
      --exclude-dir="node_modules" \
      --exclude-dir="coverage" \
      --exclude-dir="handlers-v2" \
      --exclude-dir="__tests__" \
      --exclude-dir="ui" \
      --exclude="descriptions.ts" \
      --exclude="annotations.ts" \
      --exclude="composite.ts" \
      --exclude="dependencies.ts" \
      --exclude="excel-online-backend.ts" \
      --exclude="airtable-backend.ts" \
      --exclude="prompt-registration.ts" \
      --exclude="api-key-server.ts" \
      --exclude="no-placeholders.sh" \
      "$pattern" "${SEARCH_DIRS[@]}" 2>/dev/null || true)
  fi

  if [ -n "$MATCHES" ]; then
    FOUND=1
    COUNT=$(echo "$MATCHES" | wc -l | tr -d ' ')
    TOTAL_MATCHES=$((TOTAL_MATCHES + COUNT))
    echo -e "${RED}❌ Found ${COUNT} occurrence(s):${NC}"
    echo "$MATCHES" | head -20  # Limit output to first 20 matches per pattern
    if [ "$(echo "$MATCHES" | wc -l)" -gt 20 ]; then
      echo -e "${YELLOW}   ... and more (showing first 20)${NC}"
    fi
    echo ""
  else
    echo -e "${GREEN}✅ None found${NC}"
    echo ""
  fi
done

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

if [ "$FOUND" -eq 1 ]; then
  echo -e "${RED}❌ PLACEHOLDER CHECK FAILED${NC}"
  echo ""
  echo "Found ${TOTAL_MATCHES} placeholder(s) in source code."
  echo ""
  echo "Remove the following markers before committing:"
  echo "  - TODO, FIXME, XXX, HACK"
  echo "  - stub, placeholder, simulate"
  echo "  - 'not implemented' text or errors"
  echo ""
  echo "Complete all implementations before marking phase as DONE ✅"
  echo ""
  exit 1
else
  echo -e "${GREEN}✅ NO PLACEHOLDERS FOUND${NC}"
  echo ""
  echo "All implementations are complete. Ready to proceed!"
  echo ""
  exit 0
fi
