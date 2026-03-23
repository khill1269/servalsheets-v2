# SpreadsheetBench Evaluation Harness

Automated benchmark runner for [SpreadsheetBench](https://github.com/RUCKBReasoning/SpreadsheetBench)
(NeurIPS 2024, 912 instructions, 2,729 test cases).

## Two Tracks

- **Track A (Official Protocol)**: Claude generates Python/openpyxl code → executed in sandbox → scored with official `evaluation.py`. Produces a directly comparable score.
- **Track B (ServalSheets MCP)**: Claude uses ServalSheets MCP tools on live Google Sheets → result downloaded as XLSX → scored with same comparison logic. Tests our actual product.

## Quick Start

```bash
# 1. Install dependencies
pip install -r requirements.txt --break-system-packages

# 2. Extract dataset (if not already)
cd ../../SpreadsheetBench/data
tar -xzf spreadsheetbench_912_v0.1.tar.gz

# 3. Run Track A on sample (200 questions)
python run_benchmark.py --track a --dataset sample --model claude-sonnet-4-20250514 --api-key $ANTHROPIC_API_KEY

# 4. Run Track A on full 912
python run_benchmark.py --track a --dataset full --model claude-sonnet-4-20250514 --api-key $ANTHROPIC_API_KEY

# 5. Run Track B (ServalSheets MCP)
python run_benchmark.py --track b --dataset full --model claude-sonnet-4-20250514 --api-key $ANTHROPIC_API_KEY

# 6. Generate dashboard
python generate_report.py --results-dir results/
```

## Scoring (Official Protocol — Exact Match)

- `transform_value()`: floats rounded to 2dp, datetimes → Excel serial numbers, strings parsed as floats where possible
- `compare_cell_value()`: binary match after transform. Empty string == None. Type mismatch → fail.
- **Soft score** = fraction of 3 test cases that pass (per instruction)
- **Hard score** = 1 only if all 3 test cases pass
