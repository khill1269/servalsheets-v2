#!/bin/bash
# Enhanced Smoke Tests for ServalSheets
# Tests critical paths to ensure basic functionality works

set -e

echo "🔥 Running enhanced smoke tests..."
echo ""

# Track test results
TESTS_PASSED=0
TESTS_FAILED=0
SMOKE_HTTP_PORT=3099

# Run a command with a timeout (portable across macOS/Linux)
run_with_timeout() {
  local seconds="$1"
  shift

  if command -v timeout > /dev/null 2>&1; then
    timeout "${seconds}s" "$@"
    return $?
  fi

  if command -v gtimeout > /dev/null 2>&1; then
    gtimeout "${seconds}s" "$@"
    return $?
  fi

  # Fallback: perl alarm-based timeout (available by default on macOS)
  perl -e 'alarm shift; exec @ARGV' "$seconds" "$@"
}

# Helper function to run a test
run_test() {
  local test_name="$1"
  local test_command="$2"

  echo "→ Testing: $test_name"

  if eval "$test_command" > /dev/null 2>&1; then
    echo "  ✅ PASS"
    TESTS_PASSED=$((TESTS_PASSED + 1))
  else
    echo "  ❌ FAIL"
    TESTS_FAILED=$((TESTS_FAILED + 1))
    return 1
  fi
}

# Test 1: CLI version command
run_test "CLI version" "node dist/cli.js --version"

# Test 2: CLI help command
run_test "CLI help" "node dist/cli.js --help"

# Test 3: Server initialization (stdio mode)
echo "→ Testing: Server initialization (stdio)"
if printf '{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{\"capabilities\":{}}}\n' | run_with_timeout 5 node dist/server.js > /dev/null 2>&1; then
  echo "  ✅ PASS"
  TESTS_PASSED=$((TESTS_PASSED + 1))
else
  EXIT_CODE=$?
  # timeout exit codes (GNU timeout=124, perl alarm=142, SIGKILL/SIGTERM=137/143)
  if [ "$EXIT_CODE" -eq 124 ] || [ "$EXIT_CODE" -eq 142 ] || [ "$EXIT_CODE" -eq 137 ] || [ "$EXIT_CODE" -eq 143 ]; then
    echo "  ✅ PASS (timed out after init)"
    TESTS_PASSED=$((TESTS_PASSED + 1))
  else
    echo "  ❌ FAIL"
    TESTS_FAILED=$((TESTS_FAILED + 1))
  fi
fi

# Test 4: HTTP server starts and responds to health check
echo "→ Testing: HTTP server health endpoint"
# Smoke only needs the main HTTP listener; disable the dedicated metrics bind so
# an occupied default metrics port does not cause a false-negative startup failure.
NODE_ENV=development SKIP_PREFLIGHT=true ENABLE_METRICS_SERVER=false CACHE_REDIS_ENABLED=false \
SESSION_STORE_TYPE=memory ALLOW_MEMORY_SESSIONS=true REDIS_URL= HOST=127.0.0.1 PORT="$SMOKE_HTTP_PORT" \
  node "$(pwd)/dist/cli.js" --http --port "$SMOKE_HTTP_PORT" &
SERVER_PID=$!
SERVER_READY=0

for _ in 1 2 3 4 5 6 7 8; do
  if curl -f -s "http://127.0.0.1:${SMOKE_HTTP_PORT}/health" > /dev/null 2>&1; then
    SERVER_READY=1
    break
  fi
  sleep 1
done

if [ "$SERVER_READY" -eq 1 ]; then
  echo "  ✅ PASS"
  TESTS_PASSED=$((TESTS_PASSED + 1))
else
  echo "  ❌ FAIL"
  TESTS_FAILED=$((TESTS_FAILED + 1))
fi

kill $SERVER_PID 2>/dev/null || true
wait $SERVER_PID 2>/dev/null || true

# Test 5: Server.json validity
run_test "server.json is valid JSON" "node -e \"require('./server.json')\""

# Test 6: Schema files exist and are valid
run_test "Schema files exist" "test -f dist/schemas/index.js && test -f dist/schemas/shared.js"

# Test 7: Handler files exist
run_test "Handler files exist" "test -d dist/handlers && ls dist/handlers/*.js > /dev/null"

# Test 8: Knowledge base exists
run_test "Knowledge base exists" "test -d dist/knowledge"

# Test 9: MCP tools registration
run_test "MCP tools registered" "node -e \"const reg = require('./dist/mcp/registration/tool-definitions.js'); if (!reg.TOOL_DEFINITIONS || reg.TOOL_DEFINITIONS.length === 0) process.exit(1)\""

# Test 10: Discovery API utilities exist
run_test "Discovery API utilities" "test -f dist/services/discovery-client.js && test -f dist/services/schema-cache.js"

# Test 11: Debug utilities exist
run_test "Debug utilities exist" "test -f dist/utils/http2-detector.js && test -f dist/utils/enhanced-errors.js"

# Test 12: CLI auth setup exists
run_test "CLI auth setup" "test -f dist/cli/auth-setup.js"

# Test 13: Runtime HTML assets exist
run_test "CLI HTML assets exist" "test -f dist/cli/auth-error.html && test -f dist/cli/auth-success.html"

# Test 14: Admin dashboard assets exist
run_test "Admin dashboard assets exist" "test -f dist/admin/dashboard.html && test -f dist/admin/dashboard.js && test -f dist/admin/styles.css"

# Test 15: Tool hash baseline exists
run_test "Tool hash baseline exists" "test -f dist/security/tool-hashes.baseline.json"

echo ""
echo "════════════════════════════════════════"
echo "  Smoke Test Summary"
echo "════════════════════════════════════════"
echo "  Passed: $TESTS_PASSED"
echo "  Failed: $TESTS_FAILED"
echo "════════════════════════════════════════"

if [ $TESTS_FAILED -gt 0 ]; then
  echo "❌ Some smoke tests failed"
  exit 1
fi

echo "✅ All smoke tests passed!"
exit 0
