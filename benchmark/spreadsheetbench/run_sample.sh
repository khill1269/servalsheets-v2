#!/bin/bash
# Quick test: run Track A on 5 instructions from the sample dataset
# Requires: ANTHROPIC_API_KEY environment variable

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

if [ -z "$ANTHROPIC_API_KEY" ]; then
    echo "ERROR: Set ANTHROPIC_API_KEY environment variable"
    echo "  export ANTHROPIC_API_KEY=sk-ant-..."
    exit 1
fi

echo "Running Track A on 5 sample instructions..."
python3 run_benchmark.py \
    --track a \
    --dataset sample \
    --model claude-sonnet-4-20250514 \
    --setting single \
    --limit 5 \
    --api-key "$ANTHROPIC_API_KEY"

echo ""
echo "Generating reports..."
LATEST=$(ls -td results/track_a_* 2>/dev/null | head -1)
if [ -n "$LATEST" ]; then
    python3 generate_report.py --results-dir "$LATEST"
    echo ""
    echo "View dashboard: open $LATEST/dashboard.html"
    echo "View spreadsheet: open $LATEST/report.xlsx"
fi
