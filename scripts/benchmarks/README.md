# ServalSheets Performance Benchmarking Suite

Automated benchmarks to validate Phase 2 optimization improvements and track performance over time.

## Quick Start

```bash
# Run Phase 2 optimization benchmarks
npm run bench:phase2

# View current performance targets
cat docs/development/PERFORMANCE_TARGETS.md
```

## Available Benchmarks

### Phase 2 Optimization Validation

**Script**: `benchmark-optimizations.ts`
**Command**: `npm run bench:phase2`

Validates the 5 Phase 2 optimizations:

| Optimization              | What It Tests             | Expected Improvement                 |
| ------------------------- | ------------------------- | ------------------------------------ |
| **2.1: Metadata Cache**   | N+1 query elimination     | 50-70% faster, 66% fewer API calls   |
| **2.2: Range Parsing**    | Cached range parsing      | 40-60% faster                        |
| **2.3: Circuit Breaker**  | Prefetch failure handling | 50-70% fewer API calls               |
| **2.4: Array Allocation** | Pre-allocated arrays      | 10-20% faster, 90% fewer allocations |
| **Token Efficiency**      | Response truncation       | 40-95% smaller responses             |

**Sample Output**:

```
╔════════════════════════════════════════════════════════════╗
║  ServalSheets Phase 2 Optimization Validation Benchmark   ║
╚════════════════════════════════════════════════════════════╝

🔍 Phase 2.1: Metadata Cache (N+1 Query Elimination)
────────────────────────────────────────────────────────────
  Testing with 3 sheets (simulated 5ms API latency)

  📊 Results:
    Baseline:  16.8467ms avg (P95: 17.2403ms)
    Optimized: 0.0004ms avg (P95: 0.0003ms)
    Improvement: +100.0% (46741.78x faster) ✨

  📉 API Call Reduction: 66.7% (300 → 100 calls)
```

### Handler Optimization Benchmark

**Script**: `benchmark-handlers.ts`
**Purpose**: Benchmarks handler-level optimizations (action dispatch, cache keys, cell counting)

### Response Builder Benchmark

**Script**: `benchmark-responses.ts`
**Purpose**: Benchmarks MCP response construction and serialization

### Adaptive Window Benchmark

**Script**: `benchmark-adaptive-window.ts`
**Purpose**: Benchmarks batch window adaptation algorithm

## Benchmark Metrics

All benchmarks report:

- **Average time**: Mean execution time
- **P50 (median)**: 50th percentile
- **P95**: 95th percentile (SLO target)
- **P99**: 99th percentile
- **Improvement %**: Percentage faster than baseline
- **Speedup**: How many times faster (e.g., 2.5x)

## Running Benchmarks

### Local Development

```bash
# Quick validation of Phase 2 optimizations
npm run bench:phase2

# Full benchmark suite (requires test data)
npm run bench

# Live API benchmarks (requires Google credentials)
npm run bench:live
```

### CI/CD Integration

```bash
# Track benchmarks over time
npm run benchmarks:track

# Run with explicit benchmark flag
npm run benchmarks:run
```

## Performance Targets

See [docs/development/PERFORMANCE_TARGETS.md](../../docs/development/PERFORMANCE_TARGETS.md) for:

- Response time SLOs (P50/P95/P99)
- Resource efficiency targets
- Token efficiency targets
- Reliability targets

## Interpreting Results

### Good Results ✅

- **Improvement > 0%**: Optimization is faster
- **Speedup > 1.0x**: Clear performance gain
- **P95 < SLO target**: Meeting service level objectives

### Needs Investigation ⚠️

- **Improvement < 0%**: Regression (slower than baseline)
- **Speedup < 1.0x**: Optimization not effective
- **P95 > SLO target**: Missing performance targets

### Action Required ❌

- **Improvement < -10%**: Significant regression
- **P95 > 2x SLO**: Critical performance degradation

## Benchmark Design

### Warmup

All benchmarks include a warmup phase (10% of iterations) to:

- Allow JIT compilation to stabilize
- Prime caches
- Reduce measurement noise

### Iterations

- **High-frequency operations**: 100,000 iterations (e.g., range parsing)
- **Medium operations**: 10,000 iterations (e.g., response building)
- **Async operations**: 100 iterations (e.g., API calls)

### Statistical Validity

- Results include P50/P95/P99 for outlier detection
- Multiple runs recommended for production baselines
- Use `benchmarks:track` for historical comparison

## Adding New Benchmarks

### Benchmark Structure

```typescript
import { performance } from 'node:perf_hooks';

function benchmark(name: string, iterations: number, fn: () => void): BenchmarkResult {
  const samples: number[] = [];

  // Warmup
  for (let i = 0; i < Math.floor(iterations * 0.1); i++) {
    fn();
  }

  // Measure
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    fn();
    const end = performance.now();
    samples.push(end - start);
  }

  // Calculate statistics
  samples.sort((a, b) => a - b);
  return {
    avgTime: samples.reduce((sum, t) => sum + t, 0) / samples.length,
    p50Time: samples[Math.floor(samples.length * 0.5)] ?? 0,
    p95Time: samples[Math.floor(samples.length * 0.95)] ?? 0,
    p99Time: samples[Math.floor(samples.length * 0.99)] ?? 0,
  };
}
```

### Best Practices

1. **Compare baseline vs optimized**: Always benchmark both implementations
2. **Use realistic data**: Test with production-like datasets
3. **Isolate variables**: Test one optimization at a time
4. **Report context**: Include dataset size, iteration count, environment

## Continuous Performance Monitoring

### Pre-Merge Validation

```bash
# Run before merging optimization PRs
npm run bench:phase2

# Verify no regressions
npm run bench
```

### Production Baseline

```bash
# Establish baseline after deployment
npm run benchmarks:track

# Compare against previous runs
git log scripts/benchmark-history.json
```

### Performance Regression Detection

If benchmarks show regression:

1. **Identify affected optimization**: Check which phase regressed
2. **Bisect commits**: Use `git bisect` to find the regression
3. **Profile**: Use Node.js profiler to identify bottleneck
4. **Fix and re-benchmark**: Validate fix restores performance

## Related Documentation

- [PERFORMANCE_TARGETS.md](../../docs/development/PERFORMANCE_TARGETS.md) - SLO targets
- [OPTIMIZATION_IMPLEMENTATION_PLAN.md](../../docs/development/OPTIMIZATION_IMPLEMENTATION_PLAN.md) - Optimization roadmap
- [PERFORMANCE.md](../../docs/guides/PERFORMANCE.md) - Performance tuning guide

## Troubleshooting

### Benchmark Fails to Run

```bash
# Ensure tsx is available
npx tsx --version

# Install dependencies
npm install
```

### Inconsistent Results

- **CPU throttling**: Disable background processes
- **Thermal throttling**: Ensure adequate cooling
- **Network latency**: Use local mocks for API benchmarks
- **GC interference**: Increase heap size (`NODE_OPTIONS=--max-old-space-size=4096`)

### Benchmark Takes Too Long

- Reduce iterations for local development
- Use `bench:fast` for quick validation
- Skip live API benchmarks (`bench:live` requires credentials)

---

**Last Updated**: 2026-01-25
**Maintainer**: Development Team
