#!/usr/bin/env bash

set -euo pipefail

echo "MCP HTTP task contract: protocol/auth security"
npx vitest run tests/contracts/mcp-http-transport-auth-security.test.ts

echo "MCP HTTP task contract: official SDK task execution"
TEST_HTTP_INTEGRATION=true npx vitest run tests/integration/http-transport.test.ts \
  -t "should support task-based tool execution over HTTP with the official MCP SDK client"

echo "MCP HTTP task contract: official SDK task cancellation"
TEST_HTTP_INTEGRATION=true npx vitest run tests/integration/http-transport.test.ts \
  -t "should cancel a task-based tool execution over HTTP with the official MCP SDK client"
