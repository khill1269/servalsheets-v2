#!/usr/bin/env python3
"""
Merge parallel benchmark slice results into a single combined summary.

Usage:
    python merge_results.py \\
        --result-dirs results/slice_0 results/slice_1 results/slice_2 \\
        --output results/combined_track_a

Each --result-dir must contain a checkpoint.jsonl produced by run_benchmark.py.
The merged output writes:
  <output>/checkpoint.jsonl  — all results concatenated
  <output>/summary.json      — recomputed aggregate scores
  <output>/results.json      — full results + summary

Example parallel Track A run then merge:
    python run_benchmark.py --track a --start-index 0   --end-index 114 --api-key $KEY
    python run_benchmark.py --track a --start-index 114 --end-index 228 --api-key $KEY
    ...
    python merge_results.py --result-dirs results/slice_* --output results/track_a_full
"""

import json
import sys
import argparse
from datetime import datetime, timezone
from pathlib import Path


def load_checkpoint(result_dir: Path) -> list[dict]:
    checkpoint = result_dir / "checkpoint.jsonl"
    if not checkpoint.exists():
        print(f"WARNING: No checkpoint.jsonl in {result_dir} — skipping", file=sys.stderr)
        return []
    results = []
    with open(checkpoint) as f:
        for line in f:
            line = line.strip()
            if line:
                results.append(json.loads(line))
    return results


def infer_track_meta(result_dirs: list[Path]) -> dict:
    """Read track/model/setting from first available summary.json."""
    for d in result_dirs:
        s = d / "summary.json"
        if s.exists():
            with open(s) as f:
                meta = json.load(f)
            return {
                "track": meta.get("track", "Track ?"),
                "setting": meta.get("setting", "unknown"),
                "model": meta.get("model", "unknown"),
            }
    return {"track": "Track ?", "setting": "unknown", "model": "unknown"}


def compute_summary(all_results: list[dict], meta: dict, run_id: str) -> dict:
    total = len(all_results)
    completed = [r for r in all_results if r.get("status") == "completed"]
    errors = [r for r in all_results if r.get("status") != "completed"]

    soft_scores = [r.get("soft_restriction", 0) for r in all_results]
    hard_scores = [r.get("hard_restriction", 0) for r in all_results]

    avg_soft = sum(soft_scores) / total if total > 0 else 0
    avg_hard = sum(hard_scores) / total if total > 0 else 0

    cell_level = [r for r in all_results if r.get("instruction_type") == "Cell-Level Manipulation"]
    sheet_level = [r for r in all_results if r.get("instruction_type") == "Sheet-Level Manipulation"]

    cell_soft = sum(r.get("soft_restriction", 0) for r in cell_level) / len(cell_level) if cell_level else 0
    cell_hard = sum(r.get("hard_restriction", 0) for r in cell_level) / len(cell_level) if cell_level else 0
    sheet_soft = sum(r.get("soft_restriction", 0) for r in sheet_level) / len(sheet_level) if sheet_level else 0
    sheet_hard = sum(r.get("hard_restriction", 0) for r in sheet_level) / len(sheet_level) if sheet_level else 0

    # Aggregate costs from per-result fields if present
    total_input_tokens = sum(r.get("input_tokens", 0) for r in all_results)
    total_output_tokens = sum(r.get("output_tokens", 0) for r in all_results)
    total_api_calls = sum(r.get("api_calls", 0) for r in all_results)
    total_tool_calls = sum(r.get("tool_calls", 0) for r in all_results)
    total_duration_sec = sum(r.get("duration_sec", 0) for r in all_results)

    pricing = {"claude-sonnet-4-20250514": {"input": 3.0, "output": 15.0}}
    p = pricing.get(meta["model"], {"input": 3.0, "output": 15.0})
    estimated_usd = round(
        (total_input_tokens / 1_000_000) * p["input"]
        + (total_output_tokens / 1_000_000) * p["output"],
        4,
    )

    return {
        "run_id": run_id,
        "track": meta["track"],
        "setting": meta["setting"],
        "model": meta["model"],
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "dataset_size": total,
        "completed": len(completed),
        "errors": len(errors),
        "scores": {
            "overall": {
                "soft_avg": round(avg_soft, 4),
                "hard_avg": round(avg_hard, 4),
                "soft_pct": f"{avg_soft * 100:.1f}%",
                "hard_pct": f"{avg_hard * 100:.1f}%",
            },
            "cell_level": {
                "count": len(cell_level),
                "soft_avg": round(cell_soft, 4),
                "hard_avg": round(cell_hard, 4),
                "soft_pct": f"{cell_soft * 100:.1f}%",
                "hard_pct": f"{cell_hard * 100:.1f}%",
            },
            "sheet_level": {
                "count": len(sheet_level),
                "soft_avg": round(sheet_soft, 4),
                "hard_avg": round(sheet_hard, 4),
                "soft_pct": f"{sheet_soft * 100:.1f}%",
                "hard_pct": f"{sheet_hard * 100:.1f}%",
            },
        },
        "cost": {
            "input_tokens": total_input_tokens,
            "output_tokens": total_output_tokens,
            "api_calls": total_api_calls,
            "estimated_usd": estimated_usd,
        },
        "timing": {
            "total_minutes": round(total_duration_sec / 60, 1),
            "avg_seconds": round(total_duration_sec / total, 1) if total > 0 else 0,
            "total_tool_calls": total_tool_calls,
        },
    }


def print_summary(summary: dict) -> None:
    s = summary["scores"]
    o = s["overall"]
    c = s["cell_level"]
    sh = s["sheet_level"]
    cost = summary["cost"]
    timing = summary.get("timing", {})

    print(f"\n{'='*60}")
    print(f"  MERGED: {summary['track']} | {summary['setting']} | {summary['model']}")
    print(f"{'='*60}")
    print(f"  Instructions: {summary['dataset_size']} ({summary['completed']} completed, {summary['errors']} errors)")
    print()
    print(f"  OVERALL SCORES:")
    print(f"    Soft (partial credit):  {o['soft_pct']}")
    print(f"    Hard (all-or-nothing):  {o['hard_pct']}")
    print()
    print(f"  BY TYPE:")
    print(f"    Cell-Level  ({c['count']:3d}):  soft={c['soft_pct']}  hard={c['hard_pct']}")
    print(f"    Sheet-Level ({sh['count']:3d}):  soft={sh['soft_pct']}  hard={sh['hard_pct']}")
    print()
    if timing.get("total_minutes"):
        print(f"  TIMING: {timing['total_minutes']} min total  |  {timing['avg_seconds']}s avg/task  |  {timing['total_tool_calls']} tool calls")
    print(f"  COST:   ${cost['estimated_usd']:.2f}  ({cost['input_tokens']:,} in + {cost['output_tokens']:,} out tokens)")
    print(f"{'='*60}\n")


def main():
    parser = argparse.ArgumentParser(description="Merge parallel benchmark slice results")
    parser.add_argument("--result-dirs", nargs="+", required=True,
                        help="Directories containing checkpoint.jsonl files (glob-expandable)")
    parser.add_argument("--output", required=True,
                        help="Output directory for merged results")
    args = parser.parse_args()

    result_dirs = [Path(d) for d in args.result_dirs]
    output_dir = Path(args.output)
    output_dir.mkdir(parents=True, exist_ok=True)

    # Load all results, deduplicate by task id (last write wins)
    seen: dict[int, dict] = {}
    total_loaded = 0
    for d in result_dirs:
        results = load_checkpoint(d)
        total_loaded += len(results)
        for r in results:
            seen[r["id"]] = r
    all_results = sorted(seen.values(), key=lambda r: str(r["id"]))

    duplicates = total_loaded - len(all_results)
    print(f"Loaded {total_loaded} results from {len(result_dirs)} slice(s)")
    if duplicates:
        print(f"  Deduplicated {duplicates} overlapping task IDs (last write kept)")
    print(f"  Unique tasks: {len(all_results)}")

    meta = infer_track_meta(result_dirs)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    run_id = f"{meta['track'].lower().replace(' ', '_')}_{meta['setting']}_{meta['model']}_{timestamp}_merged"

    summary = compute_summary(all_results, meta, run_id)

    # Write merged checkpoint.jsonl
    checkpoint_path = output_dir / "checkpoint.jsonl"
    with open(checkpoint_path, "w") as f:
        for r in all_results:
            f.write(json.dumps(r, default=str) + "\n")

    # Write summary.json
    with open(output_dir / "summary.json", "w") as f:
        json.dump(summary, f, indent=2)

    # Write results.json
    with open(output_dir / "results.json", "w") as f:
        json.dump({"summary": summary, "results": all_results}, f, indent=2, default=str)

    print_summary(summary)
    print(f"Merged results written to: {output_dir}")


if __name__ == "__main__":
    main()
