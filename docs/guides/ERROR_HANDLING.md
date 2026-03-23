---
title: Error Handling Guide
category: guide
last_updated: 2026-01-31
description: Comprehensive guide to error handling patterns and best practices in ServalSheets.
version: 1.6.0
audience: user
difficulty: intermediate
---

# Error Handling Guide

Comprehensive guide to error handling patterns and best practices in ServalSheets.

> **Quick Reference:** For a condensed AI agent-focused error recovery guide, see [Error Recovery Guide](error-recovery.md).

## Overview

Proper error handling is critical for production deployments. This guide covers:

- Error types and classifications
- Structured error responses
- Recovery strategies
- Logging and monitoring
- Best practices for resilience

## Error Classification

### Error Severity Levels

**CRITICAL**: System cannot function, immediate action required

- Authentication failures blocking all operations
- Database connection failures
- Configuration errors preventing startup

**ERROR**: Operation failed, requires attention

- API request failures
- Permission denied errors
- Invalid input data
- Resource not found

**WARNING**: Operation completed with issues

- Rate limit approaching
- Deprecated API usage
- Performance degradation
- Partial failures in batch operations

**INFO**: Informational messages

- Successful operations
- State changes
- Configuration updates

## Error Types

### Authentication Errors

**TOKEN_EXPIRED**

```json
{
  "error": {
    "code": "TOKEN_EXPIRED",
    "message": "Access token has expired",
    "retryable": true,
    "recoveryAction": "REFRESH_TOKEN"
  }
}
```

**Recovery**: Automatically refresh using refresh token

**INVALID_CREDENTIALS**

```json
{
  "error": {
    "code": "INVALID_CREDENTIALS",
    "message": "OAuth credentials are invalid",
    "retryable": false,
    "recoveryAction": "RE_AUTHENTICATE"
  }
}
```

**Recovery**: User must re-authenticate

### Permission Errors

**PERMISSION_DENIED**

```json
{
  "error": {
    "code": "PERMISSION_DENIED",
    "message": "Insufficient permissions to access spreadsheet",
    "requiredScopes": ["https://www.googleapis.com/auth/spreadsheets"],
    "retryable": false
  }
}
```

**Recovery**: Request additional OAuth scopes

**PROTECTED_RANGE**

```json
{
  "error": {
    "code": "PROTECTED_RANGE",
    "message": "Cannot modify protected range",
    "range": "Sheet1!A1:E10",
    "retryable": false
  }
}
```

**Recovery**: Remove protection or skip range

### Rate Limit Errors

**RATE_LIMIT_EXCEEDED**

```json
{
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Rate limit exceeded",
    "retryAfter": 60,
    "quotaType": "READ_REQUESTS",
    "retryable": true
  }
}
```

**Recovery**: Implement exponential backoff, wait retryAfter seconds

**QUOTA_EXCEEDED**

```json
{
  "error": {
    "code": "QUOTA_EXCEEDED",
    "message": "Daily quota exceeded",
    "quotaType": "DAILY_LIMIT",
    "resetTime": "2026-01-31T00:00:00Z",
    "retryable": false
  }
}
```

**Recovery**: Wait until quota resets or request quota increase

### Validation Errors

**INVALID_RANGE**

```json
{
  "error": {
    "code": "INVALID_RANGE",
    "message": "Invalid A1 notation range",
    "providedRange": "Sheet1:A1:B10",
    "expectedFormat": "Sheet1!A1:B10",
    "retryable": false
  }
}
```

**Recovery**: Fix range notation

**INVALID_INPUT**

```json
{
  "error": {
    "code": "INVALID_INPUT",
    "message": "Input validation failed",
    "field": "values",
    "reason": "Array must be rectangular",
    "retryable": false
  }
}
```

**Recovery**: Validate and correct input data

### Resource Errors

**SPREADSHEET_NOT_FOUND**

```json
{
  "error": {
    "code": "SPREADSHEET_NOT_FOUND",
    "message": "Spreadsheet does not exist or is not accessible",
    "spreadsheetId": "1abc...xyz",
    "retryable": false
  }
}
```

**Recovery**: Verify spreadsheet ID and permissions

**SHEET_NOT_FOUND**

```json
{
  "error": {
    "code": "SHEET_NOT_FOUND",
    "message": "Sheet not found in spreadsheet",
    "sheetName": "NonexistentSheet",
    "availableSheets": ["Sheet1", "Sheet2"],
    "retryable": false
  }
}
```

**Recovery**: Use existing sheet name

### Network Errors

**NETWORK_ERROR**

```json
{
  "error": {
    "code": "NETWORK_ERROR",
    "message": "Network request failed",
    "cause": "ECONNREFUSED",
    "retryable": true
  }
}
```

**Recovery**: Retry with exponential backoff

**TIMEOUT**

```json
{
  "error": {
    "code": "TIMEOUT",
    "message": "Request timed out",
    "timeoutMs": 30000,
    "retryable": true
  }
}
```

**Recovery**: Increase timeout or retry

## Error Response Structure

### Standard Error Format

```typescript
interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: {
      [key: string]: any;
    };
    retryable: boolean;
    recoveryAction?: string;
    statusCode?: number;
    timestamp: string;
    requestId: string;
  };
}
```

### Example Error Response

```json
{
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Rate limit exceeded for read requests",
    "details": {
      "quotaType": "READ_REQUESTS",
      "limit": 100,
      "used": 101,
      "resetTime": "2026-01-30T12:00:00Z"
    },
    "retryable": true,
    "recoveryAction": "EXPONENTIAL_BACKOFF",
    "statusCode": 429,
    "timestamp": "2026-01-30T11:45:23Z",
    "requestId": "req-12345"
  }
}
```

## Recovery Strategies

### Automatic Retry with Exponential Backoff

```typescript
async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000
): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (!isRetryable(error) || attempt === maxRetries) {
        throw error;
      }

      const delay = baseDelay * Math.pow(2, attempt);
      const jitter = Math.random() * delay * 0.1;
      await sleep(delay + jitter);
    }
  }
  throw new Error('Max retries exceeded');
}
```

**Use for**:

- Network errors
- Rate limit errors (with retryAfter)
- Temporary server errors (5xx)

### Graceful Degradation

When operations fail, provide partial results:

```typescript
async function batchRead(ranges: string[]) {
  const results = [];
  const errors = [];

  for (const range of ranges) {
    try {
      const data = await read(range);
      results.push({ range, data, success: true });
    } catch (error) {
      results.push({ range, error, success: false });
      errors.push({ range, error });
    }
  }

  return {
    results,
    errors,
    successCount: results.filter((r) => r.success).length,
    totalCount: ranges.length,
  };
}
```

**Use for**:

- Batch operations
- Non-critical data fetching
- Progressive enhancement

### Circuit Breaker Pattern

Prevent cascading failures:

```typescript
class CircuitBreaker {
  private failures = 0;
  private lastFailure: number = 0;
  private state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';

  constructor(
    private threshold: number = 5,
    private timeout: number = 60000
  ) {}

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailure > this.timeout) {
        this.state = 'HALF_OPEN';
      } else {
        throw new Error('Circuit breaker is OPEN');
      }
    }

    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess() {
    this.failures = 0;
    this.state = 'CLOSED';
  }

  private onFailure() {
    this.failures++;
    this.lastFailure = Date.now();

    if (this.failures >= this.threshold) {
      this.state = 'OPEN';
    }
  }
}
```

**Use for**:

- External API calls
- Database operations
- Rate-limited services

See: [Circuit Breaker Guide](./CIRCUIT_BREAKER.md)

## Error Logging

### Structured Logging

```typescript
logger.error('Operation failed', {
  error: {
    code: error.code,
    message: error.message,
    stack: error.stack,
  },
  context: {
    operation: 'read',
    spreadsheetId: '1abc...xyz',
    range: 'Sheet1!A1:B10',
    user: 'user@example.com',
  },
  metadata: {
    requestId: 'req-12345',
    timestamp: new Date().toISOString(),
    environment: 'production',
  },
});
```

### Error Metrics

Track error rates and types:

```typescript
metrics.increment('errors.total', {
  error_code: error.code,
  severity: error.severity,
  retryable: String(error.retryable),
});

metrics.gauge('errors.rate', errorRate, {
  window: '5m',
});
```

### Alerting Thresholds

Configure alerts for:

- Error rate > 5% of requests
- Critical errors occur
- Rate limit exceeded repeatedly
- Circuit breaker opens
- Quota approaching limits

## Error Handling Patterns

### Try-Catch with Context

```typescript
try {
  const data = await spreadsheet.read(range);
  return { success: true, data };
} catch (error) {
  logger.error('Read operation failed', {
    error,
    context: { spreadsheetId, range },
  });

  if (isRetryable(error)) {
    return retryWithBackoff(() => spreadsheet.read(range));
  }

  return {
    success: false,
    error: {
      code: error.code,
      message: error.message,
      retryable: false,
    },
  };
}
```

### Error Boundaries

Isolate failures to prevent propagation:

```typescript
async function safeExecute<T>(operation: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    logger.warn('Operation failed, using fallback', { error });
    return fallback;
  }
}
```

### Validation Before Execution

Fail fast with clear errors:

```typescript
function validateInput(data: unknown): void {
  if (!data) {
    throw new ValidationError('Data is required');
  }

  if (!Array.isArray(data)) {
    throw new ValidationError('Data must be an array');
  }

  if (data.length === 0) {
    throw new ValidationError('Data cannot be empty');
  }

  // Validate rectangular array
  const width = data[0].length;
  if (!data.every((row) => row.length === width)) {
    throw new ValidationError('Data must be rectangular');
  }
}
```

## Best Practices

### Do's

1. **Always catch errors** at operation boundaries
2. **Log errors with context** for debugging
3. **Return structured errors** with codes and messages
4. **Implement retries** for transient failures
5. **Validate input** before processing
6. **Monitor error rates** and set alerts
7. **Provide recovery guidance** in error messages
8. **Use circuit breakers** for external services
9. **Document error codes** and recovery procedures
10. **Test error scenarios** in development

### Don'ts

1. **Don't swallow errors** without logging
2. **Don't retry non-retryable errors**
3. **Don't expose sensitive data** in error messages
4. **Don't use generic error messages**
5. **Don't ignore error metrics**
6. **Don't retry immediately** without backoff
7. **Don't let errors crash the process**
8. **Don't skip error validation**

## Testing Error Handling

### Simulate Errors

```typescript
describe('Error handling', () => {
  it('should retry on rate limit', async () => {
    const mockApi = {
      read: jest
        .fn()
        .mockRejectedValueOnce(new RateLimitError())
        .mockResolvedValueOnce({ data: [] }),
    };

    const result = await retryWithBackoff(() => mockApi.read());
    expect(result).toEqual({ data: [] });
    expect(mockApi.read).toHaveBeenCalledTimes(2);
  });

  it('should not retry non-retryable errors', async () => {
    const mockApi = {
      read: jest.fn().mockRejectedValue(new PermissionDeniedError()),
    };

    await expect(retryWithBackoff(() => mockApi.read())).rejects.toThrow(PermissionDeniedError);
    expect(mockApi.read).toHaveBeenCalledTimes(1);
  });
});
```

## Related Resources

- [Rate Limiting Guide](./RATE_LIMITING.md) - Quota management strategies
- [Circuit Breaker Guide](./CIRCUIT_BREAKER.md) - Failure recovery patterns
- [Monitoring Guide](./MONITORING.md) - Error tracking and alerting
- [Troubleshooting](./TROUBLESHOOTING.md) - Common error solutions
