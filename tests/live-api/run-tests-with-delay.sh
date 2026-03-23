#!/bin/bash
# Test runner with delays between test files to avoid quota limits

cd "/Users/thomascahill/Documents/servalsheets 2"

DELAY_SECONDS=30
TEST_DIR="tests/live-api/tools"

# Array of test files to run
TEST_FILES=(
  "sheets-format.live.test.ts"
  "sheets-dimensions.live.test.ts"
  "sheets-visualize.live.test.ts"
  "sheets-collaborate.live.test.ts"
  "sheets-composite.live.test.ts"
  "sheets-transaction.live.test.ts"
)

TOTAL_PASSED=0
TOTAL_FAILED=0

for file in "${TEST_FILES[@]}"; do
  echo ""
  echo "============================================"
  echo "Running: $file"
  echo "============================================"
  
  TEST_REAL_API=true npm test -- --run "$TEST_DIR/$file" 2>&1 | tee /tmp/test_output.txt
  
  # Parse results
  PASSED=$(grep -oE "[0-9]+ passed" /tmp/test_output.txt | head -1 | grep -oE "[0-9]+")
  FAILED=$(grep -oE "[0-9]+ failed" /tmp/test_output.txt | head -1 | grep -oE "[0-9]+")
  
  if [ -n "$PASSED" ]; then
    TOTAL_PASSED=$((TOTAL_PASSED + PASSED))
  fi
  if [ -n "$FAILED" ]; then
    TOTAL_FAILED=$((TOTAL_FAILED + FAILED))
  fi
  
  echo ""
  echo "Waiting ${DELAY_SECONDS}s for quota reset..."
  sleep $DELAY_SECONDS
done

echo ""
echo "============================================"
echo "FINAL RESULTS"
echo "============================================"
echo "Total Passed: $TOTAL_PASSED"
echo "Total Failed: $TOTAL_FAILED"
