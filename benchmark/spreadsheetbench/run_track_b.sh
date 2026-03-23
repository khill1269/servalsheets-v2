#!/bin/bash
# Run SpreadsheetBench Track B — ServalSheets MCP benchmark
#
# This script:
# 1. Loads credentials from .env
# 2. Checks auth status
# 3. Runs the benchmark with configurable options
#
# Usage:
#   ./run_track_b.sh                    # Full 912 (default)
#   ./run_track_b.sh --limit 5          # Quick test on 5 instructions
#   ./run_track_b.sh --dataset sample   # Sample dataset (200)
#   ./run_track_b.sh --resume           # Resume from checkpoint

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Load .env from ServalSheets root
if [ -f "$REPO_ROOT/.env" ]; then
    set -a
    source "$REPO_ROOT/.env"
    set +a
    echo "Loaded credentials from $REPO_ROOT/.env"
fi

# Verify ANTHROPIC_API_KEY
if [ -z "$ANTHROPIC_API_KEY" ]; then
    echo "ERROR: ANTHROPIC_API_KEY not set."
    echo "Add it to $REPO_ROOT/.env or export it."
    exit 1
fi
echo "ANTHROPIC_API_KEY: set (${#ANTHROPIC_API_KEY} chars)"

# Auto-detect token store
if [ -z "$GOOGLE_TOKEN_STORE_PATH" ] && [ -f "$REPO_ROOT/.secrets/servalsheets.tokens.enc" ]; then
    export GOOGLE_TOKEN_STORE_PATH="$REPO_ROOT/.secrets/servalsheets.tokens.enc"
    echo "Token store: $GOOGLE_TOKEN_STORE_PATH"
fi

# Check Google auth
echo ""
echo "Checking Google auth status..."
AUTH_STATUS=$(python3 -c "
import sys, json, os
sys.path.insert(0, '.')
from track_b.executor import McpStdioClient

client = McpStdioClient('$REPO_ROOT')
try:
    client.start()
    result = client.call_tool('sheets_auth', {'request': {'action': 'status'}}, timeout=15)
    resp = result.get('response', result) if isinstance(result, dict) else {}
    if resp.get('authenticated'):
        print('authenticated')
    else:
        print('not_authenticated')
finally:
    client.stop()
" 2>/dev/null || echo "check_failed")

if [ "$AUTH_STATUS" = "authenticated" ]; then
    echo "✅ Google auth: OK"
elif [ "$AUTH_STATUS" = "not_authenticated" ]; then
    echo ""
    echo "❌ Google OAuth not authenticated."
    echo ""
    echo "To authenticate, run the ServalSheets MCP server manually and complete OAuth:"
    echo "  1. cd $REPO_ROOT"
    echo "  2. node dist/cli.js   (starts STDIO server)"
    echo "  3. Use sheets_auth login action to get OAuth URL"
    echo "  4. Complete the OAuth flow in your browser"
    echo "  5. Then re-run this script"
    echo ""
    echo "Alternatively, set GOOGLE_APPLICATION_CREDENTIALS to a service account key file."
    exit 1
else
    echo "⚠️  Could not check auth status (server may have errored)"
    echo "Continuing anyway — the benchmark will fail with clear errors if auth is missing."
fi

echo ""
echo "============================================"
echo "  SpreadsheetBench Track B — ServalSheets MCP"
echo "============================================"
echo ""

# Run benchmark
python3 run_benchmark.py \
    --track b \
    --dataset "${1:-full}" \
    --model claude-sonnet-4-20250514 \
    --api-key "$ANTHROPIC_API_KEY" \
    "${@:2}"

# Generate reports if results exist
echo ""
echo "Generating reports..."
LATEST=$(ls -td results/track_b_* 2>/dev/null | head -1)
if [ -n "$LATEST" ]; then
    python3 generate_report.py --results-dir "$LATEST"
    echo ""
    echo "View dashboard: open $LATEST/dashboard.html"
    echo "View spreadsheet: open $LATEST/report.xlsx"
fi
