# Phase 2 Integration Testing Guide

## Overview

Comprehensive test suite validating all 6 Phase 2 performance features work together correctly and achieve target metrics.

**Status:** ✅ Complete
**Coverage:** Integration, Performance, Load Testing
**Test Files:** 3 files, 20+ test scenarios

---

## Test Files

### 1. Integration Tests

**File:** `tests/integration/phase-2-integration.test.ts`
**Purpose:** Verify features integrate correctly
**Duration:** ~5 minutes
**Run:** `npm run test:phase2`

**Test Scenarios:**

1. Range merging + cache invalidation
2. Prefetch + streaming responses
3. Adaptive concurrency + worker pool
4. All features together (realistic workload)
5. Cache invalidation graph correctness
6. Streaming large datasets without OOM
7. Performance regression detection

### 2. Performance Benchmarks

**File:** `tests/benchmarks/phase-2-performance.bench.ts`
**Purpose:** Measure performance characteristics
**Duration:** ~10 minutes
**Run:** `npm run bench:phase2`

**Benchmark Categories:**

1. Request merging throughput (sequential vs overlapping)
2. Prefetch prediction speed (learning + generation)
3. Cache invalidation graph performance
4. Worker pool scalability (1, 4, 8 workers)
5. Combined features (realistic workload)
6. Scalability tests (10, 50, 100, 500 concurrent ops)

### 3. Load Tests

**File:** `tests/load/phase-2-load.test.ts`
**Purpose:** Validate stability under production load
**Duration:** ~30 minutes
**Run:** `npm run test:phase2:load`

**Load Scenarios:**

1. Sustained 1000+ req/s for 5 minutes
2. Spike load (5000 req/s burst for 30 seconds)
3. Memory stability over 100K operations
4. Cache hit rate under load (target: 60%+)
5. Prefetch effectiveness under load
6. Worker pool scalability under load

---

## Performance Targets

All tests validate against these Phase 2 targets:

| Metric         | Baseline  | Target      | Validation          |
| -------------- | --------- | ----------- | ------------------- |
| API Calls      | 1000      | 700         | -30% reduction      |
| P95 Latency    | 400ms     | 240ms       | -40% improvement    |
| Cache Hit Rate | 30%       | 60%+        | +100% increase      |
| Memory OOM     | Variable  | 0 events    | Stable on 100K rows |
| 429 Errors     | Variable  | 0           | No rate limits      |
| Throughput     | 500 req/s | 1000+ req/s | +100% increase      |

---

## Running Tests

### Quick Integration Test

```bash
npm run test:phase2
```

**Duration:** 5 minutes
**What it tests:** Feature integration, correctness, basic performance

### Full Performance Benchmark

```bash
npm run bench:phase2
```

**Duration:** 10 minutes
**What it tests:** Detailed performance metrics, scalability, regression detection

### Full Load Test (CI only)

```bash
npm run test:phase2:load
```

**Duration:** 30 minutes
**What it tests:** Production-level load, sustained throughput, memory stability

### Complete Phase 2 Test Suite

```bash
npm run test:phase2:all
```

**Duration:** 45 minutes
**What it tests:** Everything - integration + benchmarks + load

---

## Test Architecture

### MetricsTracker Class

Collects performance metrics across all tests:

- API call counts
- Cache hit/miss ratios
- Latency percentiles (P50, P95, P99)
- Memory usage snapshots
- Error tracking (including 429 rate limits)

### LoadMetrics Class

Specialized for load testing:

- Throughput calculation (ops/sec)
- Memory trend analysis (stable/increasing/decreasing)
- Error rate tracking
- Time-series memory snapshots

### Mock Infrastructure

Uses existing `tests/helpers/google-api-mocks.ts`:

- Realistic Google Sheets API responses
- Configurable spreadsheet data
- Error simulation
- Large dataset support (100K+ rows)

---

## Feature Coverage

### 1. Request Merging (request-merger.ts)

**Tests:**

- Overlapping range detection
- Merge window timing (50ms)
- API call reduction calculation
- Response splitting accuracy

**Validation:**

- Merging reduces API calls by 30%+
- Merged responses correctly split to requesters
- No data loss or corruption

### 2. Adaptive Concurrency (adaptive-concurrency.ts)

**Tests:**

- Concurrency adjustment based on CPU load
- Backpressure handling
- Throughput optimization

**Validation:**

- Adapts to system load dynamically
- Maintains P95 latency < 400ms
- No event loop blocking

### 3. Predictive Prefetch (prefetch-predictor.ts)

**Tests:**

- Pattern learning from history
- Sequential range prediction
- Background prefetch execution
- Accuracy tracking

**Validation:**

- Prediction accuracy > 70%
- Prefetch improves P95 latency by 20%+
- Cache hit rate improvement

### 4. Worker Thread Pool (worker-pool.ts)

**Tests:**

- Task distribution
- Worker lifecycle (create/restart/shutdown)
- Pool size scaling (1, 2, 4, 8 workers)

**Validation:**

- Linear scaling up to CPU count
- No deadlocks or starvation
- Graceful shutdown

### 5. Streaming Responses (streaming-response-writer.ts)

**Tests:**

- Large dataset streaming (100K rows)
- Memory efficiency
- Chunked response handling

**Validation:**

- Memory stays below 512MB
- No OOM events
- Reasonable latency (< 5s for 100K rows)

### 6. Cache Invalidation Graph (cache-invalidation-graph.ts)

**Tests:**

- Dependency tracking
- Overlap detection
- Selective invalidation
- Performance at scale

**Validation:**

- Only dependent ranges invalidated
- Query speed < 10ms for 1000 ranges
- No false positives/negatives

---

## CI Integration

### Fast CI (PR validation)

```yaml
- name: Phase 2 Integration Tests
  run: npm run test:phase2
  timeout-minutes: 10
```

### Nightly CI (full validation)

```yaml
- name: Phase 2 Full Test Suite
  run: npm run test:phase2:all
  timeout-minutes: 60
```

### Performance Monitoring

```yaml
- name: Phase 2 Benchmarks
  run: npm run bench:phase2
- name: Upload Benchmark Results
  uses: benchmark-action/github-action-benchmark@v1
  with:
    tool: 'vitest'
    output-file-path: benchmark-results.json
```

---

## Interpreting Results

### Successful Test Run

```json
{
  "apiCalls": 670,
  "apiCallReduction": 32.5,
  "cacheHitRate": 65.2,
  "latency": { "p50": 45, "p95": 230, "p99": 380 },
  "errors429": 0,
  "memoryMB": { "max": 245, "avg": 180 }
}
```

✅ All targets met

### Failed Test Run

```json
{
  "apiCalls": 950,
  "apiCallReduction": 5.0,
  "cacheHitRate": 35.0,
  "latency": { "p50": 120, "p95": 480, "p99": 850 },
  "errors429": 12,
  "memoryMB": { "max": 780, "avg": 520 }
}
```

❌ Multiple targets missed:

- API call reduction < 30% target
- Cache hit rate < 60% target
- P95 latency > 400ms baseline
- Rate limit errors detected
- Memory usage concerning

---

## Debugging Test Failures

### API Call Reduction Below Target

**Symptom:** `apiCallReduction < 30%`
**Possible causes:**

- Request merger disabled or misconfigured
- Merge window too short (< 50ms)
- No overlapping requests in test
  **Fix:** Check RequestMerger config, verify test generates overlapping ranges

### Cache Hit Rate Below Target

**Symptom:** `cacheHitRate < 60%`
**Possible causes:**

- Cache disabled
- TTL too short
- No repeated reads in test
- Cache invalidation too aggressive
  **Fix:** Verify cache config, check invalidation graph logic

### Latency Above Baseline

**Symptom:** `p95 > 400ms`
**Possible causes:**

- Worker pool not initialized
- Adaptive concurrency not enabled
- Mock API slow
  **Fix:** Check worker pool stats, verify adaptive concurrency config

### Rate Limit Errors

**Symptom:** `errors429 > 0`
**Possible causes:**

- Request merging not working
- Too many parallel requests
- Mock API misconfigured
  **Fix:** Verify mock API setup, check request merging stats

### Memory Issues

**Symptom:** `memoryMB.max > 512` or `trend = 'increasing'`
**Possible causes:**

- Memory leak in feature
- No garbage collection
- Streaming not working
  **Fix:** Profile with `--inspect`, check for retained references

---

## Property-Based Testing

### Range Merging Properties

```typescript
// Property: Merged ranges always produce same data as individual reads
fc.assert(
  fc.property(
    fc.array(fc.tuple(fc.nat(100), fc.nat(100))), // Generate random ranges
    async (ranges) => {
      const merged = await mergeRead(...ranges);
      const individual = await Promise.all(ranges.map((r) => read(r)));
      expect(merged).toEqual(individual);
    }
  )
);
```

### Cache Invalidation Properties

```typescript
// Property: Write to range R invalidates all overlapping cached ranges
fc.assert(
  fc.property(
    fc.array(fc.range()), // Generate cached ranges
    fc.range(), // Generate write range
    (cached, write) => {
      const invalidated = invalidateWrite(write);
      cached.forEach((c) => {
        if (overlaps(c, write)) {
          expect(invalidated).toContain(c);
        } else {
          expect(invalidated).not.toContain(c);
        }
      });
    }
  )
);
```

---

## Maintenance

### Updating Performance Targets

When baseline performance improves, update targets in:

1. `phase-2-integration.test.ts` - Integration test assertions
2. `phase-2-performance.bench.ts` - Benchmark thresholds
3. `phase-2-load.test.ts` - Load test targets
4. This guide - Target table

### Adding New Features

1. Add feature-specific tests to `phase-2-integration.test.ts`
2. Add performance benchmarks to `phase-2-performance.bench.ts`
3. Add load tests if feature affects throughput/memory
4. Update this guide with new coverage

### Test Data Updates

Mock data in `tests/helpers/google-api-mocks.ts`:

- Spreadsheet structure
- Sheet dimensions
- Value ranges
- Error conditions

---

## Related Documentation

- **Phase 0 Implementation:** `docs/releases/PHASE_0_IMPLEMENTATION_REPORT.md`
- **Performance Optimization:** `docs/performance/OPTIMIZATION_GUIDE.md`
- **Load Testing:** `tests/load/stress-1k.test.ts`
- **Benchmarking:** `tests/benchmarks/README.md`

---

## Appendix: Complete Test Matrix

| Feature              | Integration | Benchmark       | Load            | Property   |
| -------------------- | ----------- | --------------- | --------------- | ---------- |
| Request Merging      | ✅ 3 tests  | ✅ 4 benchmarks | ✅ 2 load tests | ⬜ Planned |
| Adaptive Concurrency | ✅ 2 tests  | ⬜ Future       | ✅ 1 load test  | ⬜ Planned |
| Predictive Prefetch  | ✅ 2 tests  | ✅ 3 benchmarks | ✅ 1 load test  | ⬜ Planned |
| Worker Pool          | ✅ 2 tests  | ✅ 3 benchmarks | ✅ 1 load test  | ⬜ Planned |
| Streaming            | ✅ 1 test   | ⬜ Future       | ⬜ Future       | ⬜ Planned |
| Cache Invalidation   | ✅ 2 tests  | ✅ 4 benchmarks | ✅ 1 load test  | ⬜ Planned |

**Total Coverage:**

- Integration tests: 12 scenarios
- Benchmarks: 14 scenarios
- Load tests: 6 scenarios
- Property tests: Planned (Phase 2.1)

**Estimated Total Duration:** 45 minutes (full suite)
