#!/bin/bash
##
# Dead Code Verification Script
#
# Validates claims of "dead code" by checking test coverage.
# If code has >0% coverage, it's NOT dead code.
#
# Usage: ./verify-dead-code-claims.sh <file> <start-line> <end-line>
# Example: ./verify-dead-code-claims.sh src/handlers/format.ts 1091 1207
#
# Exit codes:
# 0 - Code is covered (NOT dead)
# 1 - Code is uncovered (possibly dead)
# 2 - Error or invalid arguments
##

set -e

if [ $# -ne 3 ]; then
  echo "Usage: $0 <file> <start-line> <end-line>"
  echo "Example: $0 src/handlers/format.ts 1091 1207"
  exit 2
fi

FILE="$1"
START_LINE="$2"
END_LINE="$3"

echo "═══════════════════════════════════════════════════════"
echo "  Dead Code Verification"
echo "═══════════════════════════════════════════════════════"
echo ""
echo "File: $FILE"
echo "Lines: $START_LINE-$END_LINE"
echo ""

# Check if file exists
if [ ! -f "$FILE" ]; then
  echo "❌ Error: File not found: $FILE"
  exit 2
fi

# Extract tool name from file path (e.g., src/handlers/format.ts → format)
TOOL_NAME=$(basename "$FILE" .ts)

# Find corresponding test file
TEST_FILE="tests/handlers/${TOOL_NAME}.test.ts"

if [ ! -f "$TEST_FILE" ]; then
  echo "⚠️  Warning: Test file not found: $TEST_FILE"
  echo "    Trying live API test..."
  TEST_FILE="tests/live-api/tools/sheets-${TOOL_NAME}.live.test.ts"

  if [ ! -f "$TEST_FILE" ]; then
    echo "❌ Error: No test file found for $TOOL_NAME"
    exit 2
  fi
fi

echo "Running tests with coverage..."
echo "Test file: $TEST_FILE"
echo ""

# Run tests with coverage
npm test -- "$TEST_FILE" --coverage --reporter=json --outputFile=.coverage-temp.json > /dev/null 2>&1 || {
  echo "⚠️  Warning: Some tests failed, but checking coverage anyway..."
}

# Check if coverage file was generated
if [ ! -f ".coverage-temp.json" ]; then
  echo "❌ Error: Coverage report not generated"
  exit 2
fi

# Parse coverage using node
COVERED_LINES=$(node -e "
const coverage = require('./.coverage-temp.json');
let coveredCount = 0;
let totalCount = 0;

// Find coverage for the specific file
for (const [filePath, fileCoverage] of Object.entries(coverage)) {
  if (filePath.includes('$FILE')) {
    const statementMap = fileCoverage.statementMap || {};

    for (const [stmtId, stmt] of Object.entries(statementMap)) {
      const stmtStart = stmt.start.line;
      const stmtEnd = stmt.end.line;

      // Check if statement overlaps with target range
      if ((stmtStart >= $START_LINE && stmtStart <= $END_LINE) ||
          (stmtEnd >= $START_LINE && stmtEnd <= $END_LINE) ||
          (stmtStart <= $START_LINE && stmtEnd >= $END_LINE)) {
        totalCount++;

        // Check if this statement was executed
        const executionCount = fileCoverage.s[stmtId] || 0;
        if (executionCount > 0) {
          coveredCount++;
        }
      }
    }

    break;
  }
}

console.log(coveredCount + '/' + totalCount);
" 2>/dev/null || echo "0/0")

# Clean up temp file
rm -f .coverage-temp.json

echo "Coverage for lines $START_LINE-$END_LINE: $COVERED_LINES"
echo ""

# Parse covered/total
COVERED=$(echo "$COVERED_LINES" | cut -d'/' -f1)
TOTAL=$(echo "$COVERED_LINES" | cut -d'/' -f2)

if [ "$TOTAL" -eq 0 ]; then
  echo "⚠️  Warning: No statements found in specified range"
  echo "    This could mean:"
  echo "    - Lines contain only comments/whitespace"
  echo "    - Line numbers are outside file bounds"
  echo "    - Coverage instrumentation didn't capture this range"
  exit 2
fi

PERCENTAGE=$((COVERED * 100 / TOTAL))

echo "═══════════════════════════════════════════════════════"
if [ "$COVERED" -gt 0 ]; then
  echo "  ✅ CODE IS NOT DEAD"
  echo "  Coverage: $PERCENTAGE% ($COVERED/$TOTAL statements)"
  echo "  This code is executed by tests!"
  echo "═══════════════════════════════════════════════════════"
  exit 0
else
  echo "  ⚠️  CODE APPEARS UNCOVERED"
  echo "  Coverage: 0% (0/$TOTAL statements)"
  echo "  This code may be dead, but verify manually:"
  echo "  - Run tests with --reporter=verbose"
  echo "  - Check if code is in error paths"
  echo "  - Verify with runtime debugging"
  echo "═══════════════════════════════════════════════════════"
  exit 1
fi
