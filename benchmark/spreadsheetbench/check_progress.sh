#!/bin/bash
# Quick progress check for SpreadsheetBench benchmark
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LATEST=$(ls -td "$SCRIPT_DIR/results/"* 2>/dev/null | head -1)

if [ -z "$LATEST" ]; then
    echo "No results directory found."
    exit 1
fi

CP="$LATEST/checkpoint.jsonl"
if [ ! -f "$CP" ]; then
    echo "No checkpoint file found."
    exit 1
fi

# Check if process is running
RUNNING=$(ps aux | grep "run_benchmark" | grep -v grep | wc -l)

python3 << PYEOF
import json

results = []
with open("$CP") as f:
    for line in f:
        if line.strip():
            try:
                results.append(json.loads(line))
            except:
                pass

total = len(results)
if total == 0:
    print("No results yet.")
    exit()

soft_sum = sum(r.get('soft_restriction', 0) for r in results)
hard_sum = sum(r.get('hard_restriction', 0) for r in results)
dur_sum = sum(r.get('duration_sec', 0) for r in results)
passes = sum(1 for r in results if r.get('hard_restriction', 0) == 1)

# By type
cell = [r for r in results if 'Cell' in r.get('instruction_type', '')]
sheet = [r for r in results if 'Sheet' in r.get('instruction_type', '')]

cell_soft = sum(r.get('soft_restriction', 0) for r in cell) / len(cell) * 100 if cell else 0
sheet_soft = sum(r.get('soft_restriction', 0) for r in sheet) / len(sheet) * 100 if sheet else 0

print(f"{'='*50}")
print(f"  SpreadsheetBench Progress")
print(f"{'='*50}")
print(f"  Completed:  {total}/912 ({total/912*100:.1f}%)")
print(f"  Running:    {'YES' if $RUNNING > 0 else 'NO'}")
print(f"")
print(f"  SCORES (so far):")
print(f"    Soft (partial):   {soft_sum/total*100:.1f}%")
print(f"    Hard (all-or-0):  {hard_sum/total*100:.1f}%")
print(f"    Full passes:      {passes}/{total}")
print(f"")
print(f"  BY TYPE:")
print(f"    Cell-Level  ({len(cell):3d}): soft={cell_soft:.1f}%")
print(f"    Sheet-Level ({len(sheet):3d}): soft={sheet_soft:.1f}%")
print(f"")
print(f"  TIMING:")
print(f"    Avg per instruction: {dur_sum/total:.1f}s")
print(f"    Total elapsed:       {dur_sum/60:.1f} min")
print(f"    ETA remaining:       {(912-total) * (dur_sum/total) / 3600:.1f} hours")
print(f"")
print(f"  LAST 5:")
for r in results[-5:]:
    tc = r.get('test_case_results', [])
    print(f"    {str(r['id']):>8s} | {tc} | soft={r.get('soft_restriction',0):.2f} | {r.get('duration_sec',0):.0f}s")
print(f"{'='*50}")
PYEOF
