---
title: Adaptive Batch Window User Guide
category: guide
last_updated: 2026-01-31
description: The adaptive batch window is enabled by default in ServalSheets. No configuration is required to benefit from it.
version: 1.6.0
tags: [sheets]
audience: user
difficulty: intermediate
---

# Adaptive Batch Window User Guide

## Quick Start

The adaptive batch window is **enabled by default** in ServalSheets. No configuration is required to benefit from it.

## What It Does

The adaptive batch window automatically adjusts the time the system waits to collect operations before sending them to Google Sheets API. This optimization:

- **Increases batch sizes** during low traffic periods
- **Decreases latency** during high traffic bursts
- **Maintains efficiency** across varying workload patterns

## Configuration

### Using Default Settings (Recommended)

The default configuration works well for most use cases:

```typescript
import { BatchingSystem } from './services/batching-system.js';

const batchingSystem = new BatchingSystem(sheetsApi);
// Adaptive window is enabled by default with optimal settings
```

### Custom Configuration

Adjust the adaptive window behavior for specific needs:

```typescript
const batchingSystem = new BatchingSystem(sheetsApi, {
  adaptiveWindow: true,
  adaptiveConfig: {
    minWindowMs: 20, // Minimum wait time (default: 20ms)
    maxWindowMs: 200, // Maximum wait time (default: 200ms)
    initialWindowMs: 50, // Starting wait time (default: 50ms)
    lowThreshold: 3, // Increase window if fewer operations (default: 3)
    highThreshold: 50, // Decrease window if more operations (default: 50)
    increaseRate: 1.2, // Window growth rate (default: 1.2x)
    decreaseRate: 0.8, // Window shrink rate (default: 0.8x)
  },
});
```

### Disable Adaptive Window

If you prefer fixed timing:

```typescript
const batchingSystem = new BatchingSystem(sheetsApi, {
  adaptiveWindow: false, // Use fixed window
  windowMs: 50, // Fixed wait time in milliseconds
});
```

## Monitoring

Check the adaptive window status via statistics:

```typescript
const stats = batchingSystem.getStats();

console.log('Adaptive Window Status:');
console.log(`- Current Window: ${stats.currentWindowMs}ms`);
console.log(`- Average Window: ${stats.avgWindowMs}ms`);
console.log(`- Batch Efficiency: ${stats.reductionPercentage.toFixed(1)}%`);
```

## Configuration Scenarios

### Scenario 1: API Rate Limit Concerns

**Problem**: You're frequently hitting Google Sheets API rate limits.

**Solution**: Use a higher minimum window to batch more aggressively.

```typescript
{
  adaptiveConfig: {
    minWindowMs: 50,   // Higher minimum for more batching
    lowThreshold: 5,   // Increase sooner
  }
}
```

### Scenario 2: Real-Time Updates Required

**Problem**: You need faster response times for user interactions.

**Solution**: Use tighter bounds to minimize latency.

```typescript
{
  adaptiveConfig: {
    minWindowMs: 15,   // Faster minimum
    maxWindowMs: 80,   // Lower maximum
    highThreshold: 30, // Flush sooner
  }
}
```

### Scenario 3: High-Volume Background Processing

**Problem**: Processing large datasets in batch jobs.

**Solution**: Allow larger batches with wider bounds.

```typescript
{
  adaptiveConfig: {
    minWindowMs: 10,
    maxWindowMs: 300,
    lowThreshold: 10,
    highThreshold: 100,
  }
}
```

### Scenario 4: Mixed Workload

**Problem**: Both interactive and batch operations in same application.

**Solution**: Use default settings - they handle mixed workloads well.

```typescript
// Just use defaults
const batchingSystem = new BatchingSystem(sheetsApi);
```

## How It Works

### Low Traffic Pattern

```
Operations: [1] → [2] → [0] → [1]
Windows:    50ms → 60ms → 72ms → 86ms
Result:     Window grows to collect more operations together
```

### High Traffic Pattern

```
Operations: [45] → [60] → [55] → [70]
Windows:    50ms → 40ms → 32ms → 26ms
Result:     Window shrinks to flush queue faster
```

### Optimal Traffic Pattern

```
Operations: [15] → [20] → [18] → [25]
Windows:    50ms → 50ms → 50ms → 50ms
Result:     Window stays stable in sweet spot
```

## Performance Impact

### Steady Low Traffic

- **Improvement**: +66.7% batch size, -40.0% API calls
- **Why**: Longer windows allow sparse operations to batch together

### Steady High Traffic

- **Improvement**: ~0% (matches fixed window)
- **Why**: Queue fills quickly regardless of window size

### Variable Traffic

- **Improvement**: -10.0% API calls
- **Why**: Adapts to changing patterns automatically

## Troubleshooting

### Issue: Adaptive window not adjusting

**Check 1**: Verify adaptive mode is enabled

```typescript
const stats = batchingSystem.getStats();
if (!stats.currentWindowMs) {
  console.log('Adaptive window is disabled');
}
```

**Check 2**: Ensure sufficient traffic variation

- Need traffic above and below thresholds to see adjustments
- Single-operation batches won't show much adaptation

### Issue: Too much latency

**Solution**: Lower the window bounds

```typescript
{
  adaptiveConfig: {
    maxWindowMs: 100,  // Reduce maximum
  }
}
```

### Issue: Too many API calls

**Solution**: Raise the minimum window

```typescript
{
  adaptiveConfig: {
    minWindowMs: 40,  // Increase minimum
  }
}
```

## Best Practices

1. **Start with defaults**: The default configuration is well-tuned for most scenarios

2. **Monitor before tuning**: Check `currentWindowMs` and `avgWindowMs` in stats before adjusting

3. **Test changes**: Use the benchmark script to verify custom configurations:

   ```bash
   npx tsx scripts/benchmark-adaptive-window.ts
   ```

4. **Consider workload**: Match configuration to your traffic patterns:
   - Interactive UI: Tighter bounds (15-80ms)
   - Background jobs: Wider bounds (10-300ms)
   - Mixed workload: Default bounds (20-200ms)

5. **Use observability**: Export window metrics to your monitoring system to track behavior over time

## Environment Variables

Configure adaptive window via environment variables (optional):

```bash
# Disable adaptive window
BATCHING_ADAPTIVE_WINDOW=false

# Custom minimum window
BATCHING_MIN_WINDOW_MS=25

# Custom maximum window
BATCHING_MAX_WINDOW_MS=150
```

## API Reference

### AdaptiveBatchWindow Class

```typescript
class AdaptiveBatchWindow {
  constructor(config?: AdaptiveBatchWindowConfig);
  getCurrentWindow(): number;
  getAverageWindow(): number;
  adjust(operationsInWindow: number): void;
  reset(): void;
  getConfig(): Required<AdaptiveBatchWindowConfig>;
}
```

### BatchingSystem Extensions

```typescript
interface BatchingSystemOptions {
  adaptiveWindow?: boolean; // Enable adaptive window (default: true)
  adaptiveConfig?: AdaptiveBatchWindowConfig;
  // ... other options
}

interface BatchingStats {
  currentWindowMs?: number; // Current window size (only with adaptive)
  avgWindowMs?: number; // Average window size over history
  // ... other stats
}
```

## Further Reading

- [Complete Implementation Documentation](../ADAPTIVE_BATCH_WINDOW_IMPLEMENTATION.md)
- [Batching System Overview](../README.md#batching-system)
- [Performance Benchmarks](../../scripts/benchmark-adaptive-window.ts)

## Support

If you encounter issues or have questions about the adaptive batch window:

1. Check this guide for common scenarios
2. Review the benchmark results for your traffic pattern
3. Enable verbose logging: `verboseLogging: true`
4. File an issue with your configuration and observed behavior
