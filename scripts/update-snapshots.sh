#!/bin/bash
set -euo pipefail

echo "Updating snapshots for handler tests..."
vitest tests/handlers/*.snapshot.test.ts -u

echo ""
echo "Review snapshot changes with:"
echo "  git diff tests/**/__snapshots__"
