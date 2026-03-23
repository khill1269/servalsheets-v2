#!/bin/bash
# Run the full 912-instruction SpreadsheetBench benchmark
# Logs to benchmark_run.log, saves progress to checkpoint.jsonl
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Load .env
if [ -f "$REPO_ROOT/.env" ]; then
    set -a
    source "$REPO_ROOT/.env"
    set +a
fi

# Verify API key
if [ -z "$ANTHROPIC_API_KEY" ]; then
    echo "ERROR: ANTHROPIC_API_KEY not set"
    exit 1
fi

echo "Starting full SpreadsheetBench benchmark at $(date -u)"
echo "API key: ${#ANTHROPIC_API_KEY} chars"
echo "Dataset: full (912 instructions)"
echo "Model: claude-sonnet-4-20250514"
echo "Resume: yes"
echo ""

# Run with --resume to pick up from latest checkpoint
python3 run_benchmark.py \
    --track b \
    --dataset full \
    --model claude-sonnet-4-20250514 \
    --resume \
    2>&1

echo ""
echo "Benchmark completed at $(date -u)"
