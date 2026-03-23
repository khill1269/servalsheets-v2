# Circuit Breaker API Reference

**File:** `src/utils/circuit-breaker.ts`
**Class:** `CircuitBreaker`

## Quick Reference

```typescript
import { CircuitBreaker } from '../utils/circuit-breaker.js';

// Create circuit breaker
const breaker = new CircuitBreaker({
  failureThreshold: 5, // Open after 5 failures
  successThreshold: 2, // Close after 2 successes in half-open
  timeout: 60000, // Stay open for 60s
  name: 'my-operation', // For logging
});

// Execute with protection
const result = await breaker.execute(async () => {
  return await riskyOperation();
});

// Get statistics
const stats = breaker.getStats();
console.log(stats.state); // 'closed' | 'open' | 'half_open'
console.log(stats.failureCount); // number
console.log(stats.successCount); // number
console.log(stats.lastFailure); // ISO 8601 string | undefined
```

## Methods

### `execute<T>(operation: () => Promise<T>, fallback?: () => Promise<T>): Promise<T>`

Execute an operation with circuit breaker protection.

**Parameters:**

- `operation` - Async function to execute
- `fallback` - Optional fallback function if circuit is open

**Throws:** `CircuitBreakerError` if circuit is open and no fallback

**Example:**

```typescript
const data = await breaker.execute(
  async () => api.fetchData(),
  async () => cache.get('fallback-data')
);
```

### `getStats(): CircuitBreakerStats`

Get current statistics.

**Returns:**

```typescript
{
  state: 'closed' | 'open' | 'half_open',
  failureCount: number,
  successCount: number,
  totalRequests: number,
  lastFailure?: string,        // ISO 8601 timestamp
  nextAttempt?: string,         // ISO 8601 timestamp
  fallbackUsageCount: number,
  registeredFallbacks: number
}
```

### `reset(): void`

Manually reset circuit breaker to closed state.

**Example:**

```typescript
breaker.reset();
console.log(breaker.getState()); // 'closed'
```

### `getState(): CircuitState`

Get current state.

**Returns:** `'closed' | 'open' | 'half_open'`

### `isOpen(): boolean`

Check if circuit is currently blocking requests.

**Returns:** `true` if circuit is open and still within timeout period

## Advanced: Fallback Strategies

Register multiple fallback strategies in priority order:

```typescript
import { FallbackStrategies } from '../utils/circuit-breaker.js';

// Priority: 100 (highest) - try cached data first
breaker.registerFallback(FallbackStrategies.cachedData(dataCache, 'key:123', 100));

// Priority: 80 - retry with backoff
breaker.registerFallback(FallbackStrategies.retryWithBackoff(operation, 3, 1000, 80));

// Priority: 50 - degraded mode
breaker.registerFallback(FallbackStrategies.degradedMode({ data: [], warning: 'degraded' }, 50));
```

## Common Patterns

### Pattern 1: API Call Protection

```typescript
const apiBreaker = new CircuitBreaker({
  failureThreshold: 5,
  successThreshold: 2,
  timeout: 60000,
  name: 'google-sheets-api',
});

const response = await apiBreaker.execute(async () => {
  return await googleClient.sheets.spreadsheets.get({ spreadsheetId });
});
```

### Pattern 2: With Cached Fallback

```typescript
const cache = new Map();

const data = await breaker.execute(
  async () => await api.fetchData(id),
  async () => {
    const cached = cache.get(id);
    if (!cached) throw new Error('No fallback data');
    return cached;
  }
);
```

### Pattern 3: Monitoring Stats

```typescript
setInterval(() => {
  const stats = breaker.getStats();
  if (stats.state === 'open') {
    logger.warn('Circuit breaker opened', {
      failures: stats.failureCount,
      nextAttempt: stats.nextAttempt,
    });
  }
}, 10000); // Check every 10s
```

## Error Handling

**CircuitBreakerError:**

```typescript
try {
  await breaker.execute(async () => riskyOp());
} catch (error) {
  if (error instanceof CircuitBreakerError) {
    console.log('Circuit is open');
    console.log('Next attempt at:', error.nextAttemptTime);
  }
}
```

## States & Transitions

```
CLOSED (normal operation)
  ↓ (failureCount >= failureThreshold)
OPEN (blocking requests)
  ↓ (timeout expires)
HALF_OPEN (testing recovery)
  ↓ (successCount >= successThreshold)
CLOSED
```

## Performance Notes

- Minimal overhead: ~0.1ms per operation
- State transitions recorded to metrics
- Supports jitter (0-30%) to prevent thundering herd
- Thread-safe for concurrent operations

## Related

- `src/services/circuit-breaker-registry.ts` - Global registry
- `src/services/google-api.ts` - Auto-instrumented with circuit breakers
- `src/utils/retry.ts` - Complementary retry logic
