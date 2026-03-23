# Benchmark Tracking System

## Overview

The benchmark tracking system stores performance benchmark results over time and detects regressions.

## Structure

```
benchmarks/
├── README.md           # This file
├── baseline.json       # Baseline performance metrics
├── latest.json         # Most recent benchmark run
└── history/           # Historical benchmark results
    ├── benchmark-2026-01-16T12-00-00-000Z.json
    ├── benchmark-2026-01-16T13-00-00-000Z.json
    └── ...
```

## Running Benchmarks

### Quick Test (Without Real API Calls)

```bash
npm run benchmarks:track
```

This runs the benchmark test suite in mock mode and tracks the results.

### Full Benchmarks (With Real Google API)

```bash
# Set required environment variables
export GOOGLE_CLIENT_ID="your-client-id"
export GOOGLE_CLIENT_SECRET="your-client-secret"
export GOOGLE_ACCESS_TOKEN="your-access-token"
export TEST_SPREADSHEET_ID="your-test-spreadsheet-id"

# Run benchmarks with real API calls
npm run benchmarks:run
```

## Tracked Metrics

The system tracks the following performance metrics:

### Metadata Fetch

- **avgLatency**: Average latency for spreadsheet.get() calls
- **p95Latency**: 95th percentile latency
- **p99Latency**: 99th percentile latency

### Batch Request

- **avgLatency**: Average latency for batch operations

### Connection Reuse

- **firstCall**: Latency of first API call
- **avgSubsequent**: Average latency of subsequent calls
- **improvementPercent**: Connection reuse improvement

### Concurrent Requests

- **totalTime**: Total time for concurrent requests
- **avgPerRequest**: Average time per concurrent request

## Regression Detection

The system automatically detects performance regressions:

- **Threshold**: 10% slower than baseline (configurable via `BENCHMARK_THRESHOLD`)
- **Action**: CI fails if any metric regresses by >10%

### Handling Regressions

If a regression is detected:

1. **Investigate**: Determine if the regression is expected (e.g., new features, better error handling)
2. **Fix**: If unintended, optimize the code
3. **Update baseline**: If expected, update the baseline:

```bash
# After verifying the regression is acceptable
cp benchmarks/latest.json benchmarks/baseline.json
```

## CI Integration

In CI pipelines, use:

```bash
npm run benchmarks:track
```

This will:

1. Run benchmark tests
2. Compare against baseline
3. Exit with error if regressions detected

## Environment Variables

- `BENCHMARK_THRESHOLD`: Regression threshold percentage (default: 10)
- `BENCHMARK_BASELINE`: Path to baseline file (default: benchmarks/baseline.json)
- `RUN_BENCHMARKS`: Set to `true` to run real API benchmarks (default: false)

## Viewing History

Historical benchmark results are stored in `benchmarks/history/` with timestamps.

To view trends:

```bash
# List all benchmark runs
ls -lh benchmarks/history/

# View specific run
cat benchmarks/history/benchmark-2026-01-16T12-00-00-000Z.json
```

## Notes

- **Baseline**: The baseline represents expected performance. Update it when intentional changes affect performance.
- **History**: Historical results help identify performance trends over time.
- **Real API**: Full benchmarks require Google API credentials and make real API calls. Use sparingly to avoid quota usage.
- **Mock Mode**: Default mode uses mock data to verify the tracking system works without API calls.

## Example Output

```
📊 ServalSheets Benchmark Tracker

📊 Benchmark results saved: benchmark-2026-01-16T12-00-00-000Z.json

======================================================================
📊 Benchmark Tracking Report
======================================================================

Timestamp: 2026-01-16T12:00:00.000Z
Git Commit: d03a1e9
Node.js: v20.10.0

Baseline: 2026-01-15T10:00:00.000Z (abc1234)
Threshold: 10% regression tolerance

✅ Performance Improvements:
  metadata-fetch.avgLatency:
    Baseline: 250.00ms
    Current:  220.00ms
    Change:   -12.0% faster ✨

✅ No performance regressions detected

📈 Benchmark history: 15 runs tracked
======================================================================

✅ Benchmark tracking complete
```
