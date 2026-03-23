#!/usr/bin/env python3
"""
Watch parallel Track A slice runs and auto-merge + compare when all finish.

Usage:
    python watch_and_merge.py \
        --slice-dirs results/slice0 results/slice1 results/slice2 results/slice3 \
        --expected 100 \
        --output results/combined \
        --track-b-summary results/track_b_mcp_.../summary.json
"""

import json
import sys
import time
import argparse
from pathlib import Path
from datetime import datetime

POLL_INTERVAL = 30  # seconds


def count_done(result_dir: Path) -> int:
    cp = result_dir / "checkpoint.jsonl"
    if not cp.exists():
        return 0
    with open(cp) as f:
        return sum(1 for line in f if line.strip())


def all_finished(slice_dirs: list[Path], expected: int) -> bool:
    return all(count_done(d) >= expected for d in slice_dirs)


def print_progress(slice_dirs: list[Path], expected: int):
    total_done = 0
    total_expected = len(slice_dirs) * expected
    for d in slice_dirs:
        done = count_done(d)
        total_done += done
        bar = "#" * (done * 20 // expected) + "." * ((expected - done) * 20 // expected)
        print(f"  {d.name[-8:]}  [{bar}]  {done}/{expected}")
    pct = total_done * 100 // total_expected
    print(f"  Total: {total_done}/{total_expected} ({pct}%)")


def run_merge(slice_dirs: list[Path], output_dir: Path):
    import subprocess
    script = Path(__file__).parent / "merge_results.py"
    cmd = [
        sys.executable, str(script),
        "--result-dirs", *[str(d) for d in slice_dirs],
        "--output", str(output_dir),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    print(result.stdout)
    if result.returncode != 0:
        print("MERGE ERROR:", result.stderr, file=sys.stderr)
        sys.exit(1)


def compare_with_track_b(combined_summary: Path, track_b_summary_path: str | None):
    with open(combined_summary) as f:
        a = json.load(f)

    a_soft = a["scores"]["overall"]["soft_pct"]
    a_hard = a["scores"]["overall"]["hard_pct"]
    a_soft_f = a["scores"]["overall"]["soft_avg"] * 100
    a_hard_f = a["scores"]["overall"]["hard_avg"] * 100

    print(f"\n{'='*62}")
    print(f"  FINAL COMPARISON: Track A (code gen) vs Track B (MCP)")
    print(f"{'='*62}")
    print(f"  Dataset:  {a['dataset_size']} verified instructions")
    print(f"  Model:    {a['model']}")
    print()
    print(f"  {'Metric':<30} {'Track A':>10} {'Track B':>10} {'Winner':>10}")
    print(f"  {'-'*60}")

    b_soft_f = b_hard_f = None
    if track_b_summary_path:
        try:
            with open(track_b_summary_path) as f:
                b = json.load(f)
            b_soft_f = b["scores"]["overall"]["soft_avg"] * 100
            b_hard_f = b["scores"]["overall"]["hard_avg"] * 100
            b_soft = b["scores"]["overall"]["soft_pct"]
            b_hard = b["scores"]["overall"]["hard_pct"]

            def winner(a_val, b_val):
                if a_val > b_val + 0.5: return "Track A ✓"
                if b_val > a_val + 0.5: return "Track B ✓"
                return "  tie  "

            print(f"  {'Soft score (partial credit)':<30} {a_soft:>10} {b_soft:>10} {winner(a_soft_f, b_soft_f):>10}")
            print(f"  {'Hard score (all-or-nothing)':<30} {a_hard:>10} {b_hard:>10} {winner(a_hard_f, b_hard_f):>10}")

            # By type
            for type_key, label in [("cell_level", "Cell-Level"), ("sheet_level", "Sheet-Level")]:
                a_s = a["scores"][type_key]["soft_avg"] * 100
                b_s = b["scores"][type_key]["soft_avg"] * 100
                a_h = a["scores"][type_key]["hard_avg"] * 100
                b_h = b["scores"][type_key]["hard_avg"] * 100
                print(f"  {f'{label} soft':<30} {a_s:>9.1f}% {b_s:>9.1f}% {winner(a_s, b_s):>10}")
                print(f"  {f'{label} hard':<30} {a_h:>9.1f}% {b_h:>9.1f}% {winner(a_h, b_h):>10}")

        except Exception as e:
            print(f"  (Could not load Track B summary: {e})")
            b_soft_f = b_hard_f = None

    if b_soft_f is None:
        print(f"  Soft score (partial credit):  {a_soft}")
        print(f"  Hard score (all-or-nothing):  {a_hard}")

    print(f"\n  {'Published baselines (NeurIPS 2024 paper, code gen)':}")
    print(f"  {'GPT-4o multi-react':<30} {'':>10} {'54.2% soft':>10}")
    print(f"  {'Claude-3.5 multi-react':<30} {'':>10} {'49.4% soft':>10}")
    print(f"  {'GPT-4o single':<30} {'':>10} {'44.1% soft':>10}")
    print(f"  {'ServalSheets Track A (this run)':<30} {a_soft:>10}")
    print()

    if b_soft_f is not None:
        if b_soft_f > a_soft_f:
            delta = b_soft_f - a_soft_f
            print(f"  ✅ MCP WINS: Track B (MCP) beats code generation by {delta:.1f}pp (soft)")
            print(f"     Publishable claim: 'ServalSheets MCP outperforms Claude code generation")
            print(f"     on {a['dataset_size']}-task verified SpreadsheetBench subset'")
        elif a_soft_f > b_soft_f:
            delta = a_soft_f - b_soft_f
            print(f"  📊 Code gen leads by {delta:.1f}pp — MCP needs improvement on this task type")
            print(f"     Publishable claim: 'First MCP system benchmarked; {b_soft_f:.1f}% soft vs")
            print(f"     {a_soft_f:.1f}% code gen baseline on verified SpreadsheetBench'")
        else:
            print(f"  🤝 TIE: MCP matches code generation — strong result for a tool-use system")

    print(f"{'='*62}\n")


def launch_912_run(bench_dir: Path, api_key: str, track_b_summary: str | None):
    """After 400-verified completes, auto-launch 8-agent Track A on full 912."""
    import subprocess, os
    print("\n" + "="*62)
    print("  LAUNCHING 912-TASK FULL RUN (8 parallel agents)")
    print("="*62)

    results_dir = bench_dir / "results"
    slices = [(0, 114), (114, 228), (228, 342), (342, 456),
              (456, 570), (570, 684), (684, 798), (798, 912)]

    env = os.environ.copy()
    env["ANTHROPIC_API_KEY"] = api_key

    pids = []
    slice_result_dirs = []
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    for i, (start, end) in enumerate(slices):
        out_log = f"/tmp/bench_912_slice_{i}.log"
        cmd = [
            sys.executable, str(bench_dir / "run_benchmark.py"),
            "--track", "a", "--dataset", "full",
            "--start-index", str(start), "--end-index", str(end),
            "--api-key", api_key,
        ]
        with open(out_log, "w") as f:
            proc = subprocess.Popen(cmd, stdout=f, stderr=subprocess.STDOUT,
                                    env=env, cwd=str(bench_dir))
        pids.append(proc.pid)
        # Result dir will be created by runner; we'll discover it after first task lands
        print(f"  Slice {i} ({start}-{end}): PID {proc.pid} → {out_log}")

    print(f"\n  8 agents running. Watching for completion...\n")

    # Poll until each slice has 114 tasks (last slice: 114 too, 912-798=114)
    tasks_per_slice = [end - start for start, end in slices]

    def find_slice_dirs(n_slices):
        """Find result dirs created after ts — one per slice."""
        dirs = sorted(results_dir.glob("track_a_single_*"), key=lambda d: d.stat().st_mtime)
        # Return the most-recently-created n dirs
        return dirs[-n_slices:] if len(dirs) >= n_slices else None

    # Wait for all slice dirs to appear
    while True:
        dirs = find_slice_dirs(len(slices))
        if dirs:
            break
        time.sleep(10)

    print(f"  Slice result dirs found. Monitoring...")
    while True:
        done = [count_done(d) for d in dirs]
        total = sum(done)
        print(f"  [{datetime.now().strftime('%H:%M:%S')}] 912-run: {total}/912 ({total*100//912}%)")
        if all(count_done(d) >= tps for d, tps in zip(dirs, tasks_per_slice)):
            break
        time.sleep(60)

    print("\n  ✅ 912-task run complete! Merging...\n")
    output_912 = results_dir / "track_a_full_912_combined"
    run_merge(dirs, output_912)
    compare_with_track_b(output_912 / "summary.json", track_b_summary)
    print(f"  912-task results: {output_912}/summary.json")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--slice-dirs", nargs="+", required=True)
    parser.add_argument("--expected", type=int, required=True,
                        help="Tasks per slice (e.g. 100)")
    parser.add_argument("--output", required=True)
    parser.add_argument("--track-b-summary", default=None,
                        help="Path to Track B summary.json for comparison")
    parser.add_argument("--then-run-912", action="store_true",
                        help="After 400-verified finishes, auto-launch full 912-task run")
    args = parser.parse_args()

    slice_dirs = [Path(d) for d in args.slice_dirs]
    output_dir = Path(args.output)

    print(f"\nWatching {len(slice_dirs)} slice(s) × {args.expected} tasks = {len(slice_dirs) * args.expected} total")
    print(f"Polling every {POLL_INTERVAL}s. Ctrl+C to stop.\n")

    while not all_finished(slice_dirs, args.expected):
        now = datetime.now().strftime("%H:%M:%S")
        print(f"[{now}] Progress:")
        print_progress(slice_dirs, args.expected)
        print()
        time.sleep(POLL_INTERVAL)

    print("\n✅ 400-verified run finished! Merging...\n")
    run_merge(slice_dirs, output_dir)

    combined_summary = output_dir / "summary.json"
    compare_with_track_b(combined_summary, args.track_b_summary)

    print(f"Full results: {output_dir}/results.json")
    print(f"Summary:      {output_dir}/summary.json\n")

    if args.then_run_912:
        import os
        api_key = os.environ.get("ANTHROPIC_API_KEY", "")
        bench_dir = Path(__file__).parent
        launch_912_run(bench_dir, api_key, args.track_b_summary)


if __name__ == "__main__":
    main()
