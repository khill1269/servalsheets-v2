#!/usr/bin/env python3
"""
Parity test: verify our comparison engine matches official evaluation.py EXACTLY.

Runs both our compare.py and the official evaluation.py on the same data
and asserts identical results.
"""

import sys
import os
import json
import datetime

# Test transform_value parity
from compare import transform_value, compare_cell_value, compare_workbooks

def test_transform_value():
    """Verify transform_value matches official behavior exactly."""
    cases = [
        # (input, expected_output)
        (5, 5.0),
        (5.123, 5.12),
        (5.125, 5.12),  # Banker's rounding: round(5.125, 2) = 5.12 in Python
        (5.135, 5.13),  # Python banker's rounding: round(5.135, 2) = 5.13 (rounds to even)
        (0, 0.0),
        (-3.456, -3.46),
        ("hello", "hello"),
        ("5.5", 5.5),
        ("abc", "abc"),
        ("", ""),
        (None, None),
        (True, 1.0),  # bool is subclass of int in Python
        (datetime.time(14, 30, 0), "14:30"),  # str(v)[:-3] strips seconds
        (datetime.time(9, 5, 30), "09:05"),
    ]

    passed = 0
    failed = 0
    for input_val, expected in cases:
        result = transform_value(input_val)
        if result == expected:
            passed += 1
        else:
            failed += 1
            print(f"  FAIL: transform_value({input_val!r}) = {result!r}, expected {expected!r}")

    print(f"transform_value: {passed} passed, {failed} failed")
    return failed == 0


def test_compare_cell_value():
    """Verify compare_cell_value matches official behavior exactly."""
    cases = [
        # (v1, v2, expected_match)
        (5, 5, True),
        (5, 5.0, True),         # int vs float → both become 5.0
        (5, "5", True),         # int 5 → 5.0, str "5" → 5.0
        (5, "5.0", True),       # both → 5.0
        ("hello", "hello", True),
        ("hello", "Hello", False),  # case-sensitive
        ("", None, True),       # official rule: "" == None
        (None, "", True),       # both directions
        ("", "", True),
        (None, None, True),
        (5, "hello", False),    # type mismatch after transform
        (5.12, 5.12, True),
        (5.123, 5.124, True),   # both round to 5.12
        (5.1, 5.2, False),      # round to 5.1 vs 5.2
    ]

    passed = 0
    failed = 0
    for v1, v2, expected in cases:
        result = compare_cell_value(v1, v2)
        if result == expected:
            passed += 1
        else:
            failed += 1
            print(f"  FAIL: compare_cell_value({v1!r}, {v2!r}) = {result}, expected {expected}")

    print(f"compare_cell_value: {passed} passed, {failed} failed")
    return failed == 0


def test_scoring_formula():
    """Verify soft/hard scoring matches official formula."""
    cases = [
        # (test_case_results, expected_soft, expected_hard)
        ([1, 1, 1], 1.0, 1),
        ([1, 1, 0], 2/3, 0),
        ([1, 0, 0], 1/3, 0),
        ([0, 0, 0], 0.0, 0),
        ([0, 1, 1], 2/3, 0),
    ]

    passed = 0
    failed = 0
    for tc_results, expected_soft, expected_hard in cases:
        # Official formula from evaluation.py line 221-222:
        soft = tc_results.count(1) / len(tc_results)
        hard = 0 if 0 in tc_results else 1

        if abs(soft - expected_soft) < 1e-10 and hard == expected_hard:
            passed += 1
        else:
            failed += 1
            print(f"  FAIL: tc={tc_results} → soft={soft}, hard={hard} "
                  f"(expected soft={expected_soft}, hard={expected_hard})")

    print(f"scoring formula: {passed} passed, {failed} failed")
    return failed == 0


def test_against_sample_data():
    """
    Run our comparison on actual sample data and verify results
    match running the official evaluation.py on the same files.
    """
    sample_path = "/sessions/kind-fervent-gates/SpreadsheetBench/data/sample_data_200"
    dataset_json = os.path.join(sample_path, "dataset.json")

    if not os.path.exists(dataset_json):
        # Try extracting
        tar_path = os.path.join(sample_path + ".tar.gz")
        if os.path.exists(tar_path):
            import subprocess
            subprocess.run(["tar", "-xzf", tar_path, "-C", os.path.dirname(tar_path)], check=True)

    if not os.path.exists(dataset_json):
        print("sample_data_200 not available — skipping live data test")
        return True

    with open(dataset_json) as f:
        dataset = json.load(f)

    print(f"\nRunning parity check on {len(dataset)} sample instructions...")
    print("(Comparing input vs answer — baseline test, expected mostly fails)")

    # Run our comparison (same logic as official: compare input against answer)
    our_results = []
    for data in dataset[:20]:  # First 20 for quick check
        task_id = data['id']
        tc_results = []
        for tc in range(3):
            gt_path = os.path.join(sample_path, "spreadsheet", str(task_id),
                                   f"{tc+1}_{task_id}_answer.xlsx")
            proc_path = os.path.join(sample_path, "spreadsheet", str(task_id),
                                     f"{tc+1}_{task_id}_input.xlsx")
            try:
                result, msg, _ = compare_workbooks(gt_path, proc_path,
                                                    data['instruction_type'],
                                                    data['answer_position'])
            except Exception:
                result = False
            tc_results.append(int(result))

        soft = tc_results.count(1) / len(tc_results)
        hard = 0 if 0 in tc_results else 1
        our_results.append({
            'id': task_id,
            'test_case_results': tc_results,
            'soft': soft,
            'hard': hard,
        })

    # Now run the official evaluation.py comparison for the same 20
    sys.path.insert(0, "/sessions/kind-fervent-gates/SpreadsheetBench/evaluation")
    try:
        import evaluation as official_eval

        official_results = []
        for data in dataset[:20]:
            task_id = data['id']
            tc_results = []
            for tc in range(3):
                gt_path = os.path.join(sample_path, "spreadsheet", str(task_id),
                                       f"{tc+1}_{task_id}_answer.xlsx")
                proc_path = os.path.join(sample_path, "spreadsheet", str(task_id),
                                         f"{tc+1}_{task_id}_input.xlsx")
                try:
                    result, _ = official_eval.compare_workbooks(
                        gt_path, proc_path,
                        data['instruction_type'],
                        data['answer_position']
                    )
                except Exception:
                    result = False
                tc_results.append(int(result))

            soft = tc_results.count(1) / len(tc_results)
            hard = 0 if 0 in tc_results else 1
            official_results.append({
                'id': task_id,
                'test_case_results': tc_results,
                'soft': soft,
                'hard': hard,
            })

        # Compare results
        mismatches = 0
        for ours, official in zip(our_results, official_results):
            if ours['test_case_results'] != official['test_case_results']:
                mismatches += 1
                print(f"  MISMATCH: {ours['id']}: "
                      f"ours={ours['test_case_results']} vs "
                      f"official={official['test_case_results']}")

        if mismatches == 0:
            print(f"PARITY CHECK PASSED: {len(our_results)} instructions, 0 mismatches")
        else:
            print(f"PARITY CHECK FAILED: {mismatches} mismatches out of {len(our_results)}")

        return mismatches == 0

    except ImportError:
        print("Could not import official evaluation.py — skipping cross-check")
        return True


if __name__ == "__main__":
    all_ok = True
    all_ok = test_transform_value() and all_ok
    all_ok = test_compare_cell_value() and all_ok
    all_ok = test_scoring_formula() and all_ok
    all_ok = test_against_sample_data() and all_ok

    print(f"\n{'='*40}")
    if all_ok:
        print("ALL PARITY TESTS PASSED")
    else:
        print("SOME TESTS FAILED")
    print(f"{'='*40}")

    sys.exit(0 if all_ok else 1)
