#!/usr/bin/env python3
"""
Replay stored solution code from a checkpoint without making API calls.

Use after fixing the execution environment (e.g. openpyxl upgrade) to
re-execute all checkpointed solutions and produce missing output files.

Usage:
    python replay_solutions.py --checkpoint results/<run>/checkpoint.jsonl \
        --dataset full|verified [--workers 8]
"""
import json
import sys
import os
import tempfile
import subprocess
import argparse
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed
from tqdm import tqdm

BENCH_DIR = Path(__file__).parent.resolve()
_LOCAL_DATA = BENCH_DIR / "data"

LOCAL_NAMES = {
    "sample": "sample_data_200",
    "full": "all_data_912_v0.1",
    "verified": "spreadsheetbench_verified_400",
}

CODE_EXEC_TIMEOUT = 120


def execute_code(code, timeout=CODE_EXEC_TIMEOUT):
    with tempfile.NamedTemporaryFile(mode='w', suffix='.py', delete=False) as f:
        f.write(code)
        script_path = f.name
    try:
        result = subprocess.run(
            [sys.executable, script_path],
            capture_output=True, text=True, timeout=timeout,
        )
        if result.returncode != 0:
            return False, result.stderr[:500]
        return True, ""
    except subprocess.TimeoutExpired:
        return False, "timeout"
    except Exception as e:
        return False, str(e)
    finally:
        try:
            os.unlink(script_path)
        except Exception:
            pass


def replay_entry(entry, dataset_path, model, setting):
    task_id = entry["id"]
    solution = entry.get("solution", "")
    if not solution.strip():
        return task_id, False, "no solution stored"

    output_dir = dataset_path / "outputs" / f"{setting}_{model}"
    output_dir.mkdir(parents=True, exist_ok=True)

    # Determine input convention for this dataset
    tc1_init = dataset_path / "spreadsheet" / str(task_id) / f"1_{task_id}_init.xlsx"
    tc_suffix = "init" if tc1_init.exists() else "input"

    file_name = f"1_{task_id}_{tc_suffix}.xlsx"

    results = []
    # TC1 is embedded in the stored solution; TC2 and TC3 need filename swap
    for tc_idx in [1, 2, 3]:
        tc_input = f"{tc_idx}_{task_id}_{tc_suffix}.xlsx"
        tc_output_name = f"{tc_idx}_{task_id}_output.xlsx"
        tc_output_path = output_dir / tc_output_name

        # Already exists — skip
        if tc_output_path.exists():
            results.append(True)
            continue

        if tc_idx == 1:
            code = solution
        else:
            code = solution.replace(file_name, tc_input)
            code = code.replace(f"1_{task_id}_output.xlsx", tc_output_name)
            # Also replace absolute output path if present
            old_abs = str(output_dir / f"1_{task_id}_output.xlsx")
            new_abs = str(tc_output_path)
            code = code.replace(old_abs, new_abs)

        ok, err = execute_code(code)
        results.append(ok)

    all_pass = all(results)
    return task_id, all_pass, "" if all_pass else f"tc failures: {results}"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--checkpoint", required=True)
    parser.add_argument("--dataset", required=True, choices=["sample", "full", "verified"])
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--model", default="claude-sonnet-4-20250514")
    parser.add_argument("--setting", default="single")
    args = parser.parse_args()

    checkpoint_path = Path(args.checkpoint)
    if not checkpoint_path.exists():
        print(f"ERROR: checkpoint not found: {checkpoint_path}", file=sys.stderr)
        sys.exit(1)

    dataset_path = _LOCAL_DATA / LOCAL_NAMES[args.dataset]
    if not dataset_path.exists():
        print(f"ERROR: dataset not found: {dataset_path}", file=sys.stderr)
        sys.exit(1)

    entries = []
    with open(checkpoint_path) as f:
        for line in f:
            line = line.strip()
            if line:
                entries.append(json.loads(line))

    print(f"Replaying {len(entries)} solutions from {checkpoint_path}")
    print(f"Dataset: {dataset_path}")
    print(f"Workers: {args.workers}")
    print()

    succeeded = 0
    failed = 0

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {
            pool.submit(replay_entry, e, dataset_path, args.model, args.setting): e["id"]
            for e in entries
        }
        with tqdm(total=len(futures), desc="Replaying") as bar:
            for fut in as_completed(futures):
                task_id, ok, err = fut.result()
                if ok:
                    succeeded += 1
                else:
                    failed += 1
                    tqdm.write(f"  FAIL {task_id}: {err}")
                bar.update(1)

    print(f"\nDone: {succeeded} succeeded, {failed} failed")
    print(f"Output files in: {dataset_path / 'outputs' / f'{args.setting}_{args.model}'}")


if __name__ == "__main__":
    main()
