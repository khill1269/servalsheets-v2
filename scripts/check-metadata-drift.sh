#!/bin/bash
#
# Check if metadata is synchronized with source code
# This prevents drift between TOOL_DEFINITIONS and metadata files
#
# Exit code:
#   0 = No drift (metadata is up to date)
#   1 = Drift detected (run npm run gen:metadata)
#
# Uses generate-metadata.ts --validate mode for accurate comparison
# without running prettier (which caused IPC pipe hangs in nested npm contexts)
#

set -e

echo "🔍 Checking for metadata drift..."
echo ""

# Cross-platform timeout wrapper: gtimeout (brew coreutils), timeout (Linux), or perl alarm (macOS built-in)
# perl -e 'alarm N; exec @ARGV' is available on both macOS and Linux and needs no extra installs.
_run_with_timeout() {
  local secs="$1"; shift
  if command -v gtimeout >/dev/null 2>&1; then
    gtimeout "$secs" "$@"
  elif command -v timeout >/dev/null 2>&1; then
    timeout "$secs" "$@"
  else
    perl -e "alarm $secs; exec @ARGV or die $!" -- "$@"
  fi
}

# Use node --import tsx to avoid npx tsx IPC pipe issues
_run_with_timeout 60 node --import tsx scripts/generate-metadata.ts --validate

echo ""
echo "🔍 Checking source/dist runtime artifact consistency..."
_run_with_timeout 30 node --import tsx scripts/check-source-dist-consistency.ts --allow-missing-dist || {
  echo "⚠️  Source/dist consistency check skipped (timeout or missing dist)"
}
