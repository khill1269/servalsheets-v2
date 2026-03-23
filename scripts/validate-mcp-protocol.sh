#!/bin/bash
# Validates MCP protocol compliance for ServalSheets
# Called by: pre-commit hook, CI pipeline, manual validation

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "MCP Protocol 2025-11-25 Compliance Check"
echo "========================================="

echo ""
echo "1) Validating schema/tool metadata alignment..."
node --import tsx scripts/validate-mcp-protocol.ts

if [[ "${VALIDATE_MCP_PROTOCOL_SKIP_TESTS:-false}" == "true" ]]; then
  echo ""
  echo "2) Skipping MCP protocol tests (VALIDATE_MCP_PROTOCOL_SKIP_TESTS=true)"
else
  echo ""
  echo "2) Running MCP protocol compliance test suite..."
  npx vitest run \
    tests/contracts/mcp-protocol.test.ts \
    tests/compliance/mcp-features.test.ts \
    tests/compliance/mcp-2025-11-25.test.ts
fi

echo ""
echo "MCP protocol validation passed."
