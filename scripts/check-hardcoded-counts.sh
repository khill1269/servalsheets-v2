#!/bin/bash
# ServalSheets - Check for Hardcoded Count Mismatches
#
# Fails if documentation contains hardcoded counts that don't match source of truth.
# Prevents documentation drift by detecting stale references to tool/action counts.
#
# Usage: bash scripts/check-hardcoded-counts.sh
# CI: npm run check:hardcoded-counts

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "═══════════════════════════════════════════════════════════"
echo "  Check Hardcoded Counts - ServalSheets"
echo "═══════════════════════════════════════════════════════════"
echo ""

# Build first to ensure action-counts.js is available
cd "$PROJECT_DIR"
if [ ! -f "dist/schemas/action-counts.js" ]; then
    echo "⚠️  Building project to generate dist/ files..."
    npm run build > /dev/null 2>&1 || {
        echo "❌ Build failed. Cannot extract source of truth."
        exit 1
    }
fi

# Extract source of truth from action-counts.ts
SOURCE_TOOL_COUNT=$(node -e "const {TOOL_COUNT} = require('./dist/schemas/action-counts.js'); console.log(TOOL_COUNT);")
SOURCE_ACTION_COUNT=$(node -e "const {ACTION_COUNT} = require('./dist/schemas/action-counts.js'); console.log(ACTION_COUNT);")

echo "Source of truth: $SOURCE_TOOL_COUNT tools, $SOURCE_ACTION_COUNT actions"
echo ""

ISSUES_FOUND=0

# Function to check for hardcoded counts in docs
check_doc_file() {
    local file=$1
    local issues_in_file=0

    # Check for hardcoded TOOL_COUNT assignments
    if grep -q "TOOL_COUNT.*=.*[0-9]" "$file" 2>/dev/null; then
        local line=$(grep "TOOL_COUNT.*=.*[0-9]" "$file" | head -1)
        if ! echo "$line" | grep -q "$SOURCE_TOOL_COUNT"; then
            echo "❌ $file: TOOL_COUNT mismatch"
            echo "   Found: $line"
            echo "   Expected: $SOURCE_TOOL_COUNT"
            issues_in_file=$((issues_in_file + 1))
        fi
    fi

    # Check for hardcoded ACTION_COUNT assignments
    if grep -q "ACTION_COUNT.*=.*[0-9]" "$file" 2>/dev/null; then
        local line=$(grep "ACTION_COUNT.*=.*[0-9]" "$file" | head -1)
        if ! echo "$line" | grep -q "$SOURCE_ACTION_COUNT"; then
            echo "❌ $file: ACTION_COUNT mismatch"
            echo "   Found: $line"
            echo "   Expected: $SOURCE_ACTION_COUNT"
            issues_in_file=$((issues_in_file + 1))
        fi
    fi

    # Check for "[number] tools" references
    if grep -q "[0-9]\+ tools" "$file" 2>/dev/null; then
        local line=$(grep -o "[0-9]\+ tools" "$file" | head -1)
        if ! echo "$line" | grep -q "^$SOURCE_TOOL_COUNT tools"; then
            echo "❌ $file: Tool count reference mismatch"
            echo "   Found: $line"
            echo "   Expected: $SOURCE_TOOL_COUNT tools"
            issues_in_file=$((issues_in_file + 1))
        fi
    fi

    # Check for "[number] actions" references
    if grep -q "[0-9]\+ actions" "$file" 2>/dev/null; then
        local line=$(grep -o "[0-9]\+ actions" "$file" | head -1)
        if ! echo "$line" | grep -q "^$SOURCE_ACTION_COUNT actions"; then
            echo "❌ $file: Action count reference mismatch"
            echo "   Found: $line"
            echo "   Expected: $SOURCE_ACTION_COUNT actions"
            issues_in_file=$((issues_in_file + 1))
        fi
    fi

    if [ $issues_in_file -gt 0 ]; then
        echo ""
    fi

    return $issues_in_file
}

# Check key documentation files
echo "Checking documentation files..."
echo ""

DOCS_TO_CHECK=(
    "README.md"
    "docs/development/SOURCE_OF_TRUTH.md"
    "docs/development/CLAUDE_CODE_RULES.md"
    "src/schemas/index.ts"
    "CLAUDE.md"
)

# Temporarily disable exit-on-error for the check loop
set +e
for doc in "${DOCS_TO_CHECK[@]}"; do
    if [ -f "$PROJECT_DIR/$doc" ]; then
        check_doc_file "$PROJECT_DIR/$doc"
        doc_issues=$?
        ISSUES_FOUND=$((ISSUES_FOUND + doc_issues))
    fi
done
set -e

# Summary
echo "═══════════════════════════════════════════════════════════"
if [ $ISSUES_FOUND -eq 0 ]; then
    echo "✅ No hardcoded count mismatches found"
    echo "   All documentation references $SOURCE_TOOL_COUNT tools and $SOURCE_ACTION_COUNT actions"
    exit 0
else
    echo "❌ Found $ISSUES_FOUND hardcoded count mismatches"
    echo ""
    echo "Fix by updating documentation to match source of truth:"
    echo "  - src/schemas/action-counts.ts defines $SOURCE_TOOL_COUNT tools and $SOURCE_ACTION_COUNT actions"
    echo "  - Always reference the source file instead of hardcoding counts"
    exit 1
fi
