---
title: ServalSheets Test Patterns
category: development
last_updated: 2026-01-31
description: 'Created: 2026-01-09'
version: 1.6.0
tags: [testing, sheets]
---

# ServalSheets Test Patterns

**Created**: 2026-01-09
**Purpose**: Document testing patterns, best practices, and common solutions for ServalSheets test suite.

---

## Table of Contents

1. [Mock Setup Patterns](#mock-setup-patterns)
2. [Test Structure](#test-structure)
3. [Common Assertions](#common-assertions)
4. [Snapshot Testing](#snapshot-testing)
5. [Test Data Management](#test-data-management)
6. [Error Handling](#error-handling)
7. [Known Issues & Workarounds](#known-issues--workarounds)

---

## Mock Setup Patterns

### OAuth2Client Mocking

**Problem**: OAuth2Client must be mocked as a proper class, not with `vi.fn()`.

**Solution**:

```typescript
// Define mock class inside vi.mock() factory to avoid hoisting issues
vi.mock('googleapis', () => {
  class MockOAuth2Client {
    credentials: any = {};

    generateAuthUrl = vi.fn().mockReturnValue('https://accounts.google.com/...');
    getToken = vi.fn().mockResolvedValue({
      tokens: {
        /*...*/
      },
    });
    setCredentials = vi.fn((tokens: any) => {
      this.credentials = tokens;
    });
    revokeToken = vi.fn().mockResolvedValue({ success: true });
    getAccessToken = vi.fn().mockResolvedValue({ token: 'mock-token' });
    refreshAccessToken = vi.fn().mockResolvedValue({
      credentials: {
        /*...*/
      },
    });
  }

  return {
    google: {
      auth: {
        OAuth2: MockOAuth2Client,
      },
    },
  };
});
```

**Reference**: See `tests/helpers/oauth-mocks.ts` for the canonical implementation.

**Why inline?**: Vitest hoists `vi.mock()` calls to the top of the file, so you can't import mock classes before the mock declaration.

---

### Google Sheets API Mocking

**Pattern**: Create mock factory functions for consistent setup.

```typescript
const createMockSheetsApi = () => ({
  spreadsheets: {
    values: {
      get: vi.fn(),
      update: vi.fn(),
      batchUpdate: vi.fn(),
    },
    get: vi.fn(),
    batchUpdate: vi.fn(),
  },
});
```

**Setup in beforeEach**:

```typescript
let mockApi: ReturnType<typeof createMockSheetsApi>;

beforeEach(() => {
  vi.clearAllMocks();
  mockApi = createMockSheetsApi();

  // Set up default successful responses
  mockApi.spreadsheets.values.get.mockResolvedValue({
    data: {
      values: [
        ['A', 'B'],
        ['1', '2'],
      ],
    },
  });
});
```

---

### Singleton Service Mocking

**Problem**: Services using singleton pattern retain state between tests.

**Solution**: Add reset function with environment guard.

**In service file** (`src/services/capability-cache.ts`):

```typescript
export function resetCapabilityCacheService(): void {
  if (process.env.NODE_ENV !== 'test' && process.env.VITEST !== 'true') {
    throw new Error('resetCapabilityCacheService() can only be called in test environment');
  }
  capabilityCacheService = null;
}
```

**In test file**:

```typescript
import { resetCapabilityCacheService } from '../../src/services/capability-cache.js';

beforeEach(() => {
  vi.clearAllMocks();
  resetCapabilityCacheService(); // Reset singleton
});
```

**Centralized helper**: `tests/helpers/singleton-reset.ts`

```typescript
import { resetAllSingletons, resetSingleton } from '../helpers/singleton-reset.js';

beforeEach(() => {
  vi.clearAllMocks();
  resetAllSingletons();
});

// Or, reset a specific singleton
beforeEach(() => {
  resetSingleton('validation-engine');
});
```

**Singleton services that require reset**:

| Service                | Reset Function                   |
| ---------------------- | -------------------------------- |
| access-pattern-tracker | `resetAccessPatternTracker()`    |
| batching-system        | `resetBatchingSystem()`          |
| capability-cache       | `resetCapabilityCacheService()`  |
| composite-operations   | `resetCompositeOperations()`     |
| confirm-service        | `resetConfirmationService()`     |
| conflict-detector      | `resetConflictDetector()`        |
| context-manager        | `resetContextManager()`          |
| history-service        | `resetHistoryService()`          |
| impact-analyzer        | `resetImpactAnalyzer()`          |
| metrics                | `resetMetricsService()`          |
| parallel-executor      | `resetParallelExecutor()`        |
| prefetch-predictor     | `resetPrefetchPredictor()`       |
| prefetching-system     | `resetPrefetchingSystem()`       |
| sampling-analysis      | `resetSamplingAnalysisService()` |
| sheet-resolver         | `resetSheetResolver()`           |
| token-manager          | `resetTokenManager()`            |
| transaction-manager    | `resetTransactionManager()`      |
| validation-engine      | `resetValidationEngine()`        |

---

### Module-Level Mocks

**Pattern**: Mock dependencies that need to be overridden for specific tests.

```typescript
vi.mock('../../src/services/capability-cache.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/services/capability-cache.js')>(
    '../../src/services/capability-cache.js'
  );
  return {
    ...actual,
    getCapabilitiesWithCache: vi.fn().mockResolvedValue({
      sampling: { supportedMethods: ['createMessage'] },
    }),
  };
});
```

**Override in specific tests**:

```typescript
it('should handle sampling capability not available', async () => {
  const { getCapabilitiesWithCache } = await import('../../src/services/capability-cache.js');
  vi.mocked(getCapabilitiesWithCache).mockResolvedValueOnce({});
  // Test continues...
});
```

---

## Test Structure

### Standard Test File Layout

```typescript
/**
 * ServalSheets - [Handler Name] Tests
 *
 * Brief description of what's being tested.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
// Import handler under test
// Import schemas for validation
// Import types
// Import test helpers

// Mock setup (vi.mock calls must be at module level)
vi.mock('module-to-mock', () => ({
  /* mock implementation */
}));

// Mock factory functions
const createMockApi = () => ({
  /* mock API */
});
const createMockContext = (): HandlerContext => ({
  /* mock context */
});

describe('[HandlerName]', () => {
  let handler: HandlerType;
  let mockApi: ReturnType<typeof createMockApi>;
  let mockContext: HandlerContext;

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset singletons if needed
    mockApi = createMockApi();
    mockContext = createMockContext();
    handler = new Handler(mockContext, mockApi);
    // Set up default mock responses
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('[action name]', () => {
    it('should [expected behavior]', async () => {
      // Arrange: Set up test data and mocks
      mockApi.someMethod.mockResolvedValue({
        data: {
          /* ... */
        },
      });

      // Act: Execute the handler
      const result = await handler.handle({
        action: 'someAction' as const,
        // ... input parameters
      });

      // Assert: Verify the results
      expect(result.response.success).toBe(true);
      expect(result.response).toHaveProperty('expectedProperty');

      // Validate against schema
      const parseResult = OutputSchema.safeParse(result);
      expect(parseResult.success).toBe(true);
    });
  });
});
```

---

### Type-Safe Input Construction

**Problem**: Discriminated unions require `as const` assertions.

**Bad** (Type inference fails):

```typescript
const input = {
  action: 'fix', // ❌ Type inferred as string, not literal 'fix'
  spreadsheetId: 'test',
};
```

**Good** (Explicit literal types):

```typescript
const input = {
  action: 'fix' as const, // ✅ Literal type 'fix'
  spreadsheetId: 'test',
};
```

**Best** (Use factory functions):

```typescript
import { createValuesReadInput } from '../helpers/input-factories.js';

const input = createValuesReadInput({ spreadsheetId: 'my-sheet' });
```

---

## Common Assertions

### Success Response Assertions

```typescript
// Basic success check
expect(result.response.success).toBe(true);

// With type narrowing
if (result.response.success) {
  expect(result.response.data).toBeDefined();
}

// Using helper (recommended)
import { expectSuccessResponse } from '../helpers/error-codes.js';
expectSuccessResponse(result);
```

---

### Error Response Assertions

```typescript
// Basic error check
expect(result.response.success).toBe(false);
if (!result.response.success) {
  expect(result.response.error.code).toBe('INVALID_PARAMS');
}

// Using enum (recommended)
import { ErrorCode, expectErrorResponse } from '../helpers/error-codes.js';
expectErrorResponse(result, ErrorCode.INVALID_PARAMS);

// With message assertion
expectErrorResponse(result, ErrorCode.INVALID_PARAMS, 'must be provided');
```

---

### Schema Validation

```typescript
import { SheetsValuesOutputSchema } from '../../src/schemas/values.js';

const result = await handler.handle(input);

// Validate output against schema
const parseResult = SheetsValuesOutputSchema.safeParse(result);
expect(parseResult.success).toBe(true);

// If validation fails, log the error for debugging
if (!parseResult.success) {
  console.error('Schema validation error:', parseResult.error);
}
```

---

## Snapshot Testing

Use snapshots when you want to lock the output shape for handlers with
complex responses.

### When to Use

- Handler output stability for high-traffic tools
- Error response formats
- Complex nested response objects

### When Not to Use

- Highly dynamic fields (timestamps, UUIDs)
- Very large payloads (hard to review)
- Rapidly changing prototypes

### Basic Pattern

```typescript
it('matches snapshot for successful response', async () => {
  const result = await handler.handle(input);
  expect(result.response).toMatchSnapshot();
});
```

### Masking Dynamic Fields

```typescript
const snapshot = {
  ...result.response,
  timestamp: 'MASKED',
  requestId: 'MASKED',
};
expect(snapshot).toMatchSnapshot();
```

### Updating Snapshots

```bash
npm run test:snapshots:update
```

Review changes with:

```bash
git diff tests/**/__snapshots__
```

---

## Test Data Management

For full guidance and working examples, see `tests/TEST_DATA.md`.

Quick reference:

- Input factories: `tests/helpers/input-factories.ts`
- API mocks: `tests/helpers/google-api-mocks.ts`
- OAuth mocks: `tests/helpers/oauth-mocks.ts`
- Singleton resets: `tests/helpers/singleton-reset.ts`

---

## Error Handling

### Testing Error Paths

**Pattern**: Mock errors at the API level, verify error handling.

```typescript
it('should handle API errors gracefully', async () => {
  // Arrange: Mock API to reject with error
  mockApi.spreadsheets.values.get.mockRejectedValue(new Error('API Error: 404 Not Found'));

  // Act
  const result = await handler.handle(input);

  // Assert: Verify error response
  expectErrorResponse(result, ErrorCode.INTERNAL_ERROR);
  expect(result.response.error?.message).toContain('404');
});
```

---

### Testing Validation Errors

```typescript
it('should validate required parameters', async () => {
  const result = await handler.handle({
    action: 'read' as const,
    // spreadsheetId missing
  } as any);

  expectErrorResponse(result, ErrorCode.INVALID_PARAMS);
});
```

---

## Known Issues & Workarounds

### MCP SDK v1.25.x Discriminated Union Bug

**Issue**: `normalizeObjectSchema()` returns empty schemas for `z.discriminatedUnion()`.

**Impact**:

- Tool discovery (`tools/list`) returns empty `inputSchema.properties`
- Tool invocation still works correctly (validation functions properly)

**Workaround**: Skip schema completeness assertions in tests.

```typescript
// TEMPORARY: Skip schema validation due to SDK bug
// TODO: Re-enable when SDK v1.26+ fixes discriminated union support

// Schema should have type: object
expect(tool.inputSchema.type).toBe('object');

// SKIP: Schema completeness check
// const hasProperties = tool.inputSchema.properties && ...
// expect(hasProperties || hasOneOf || hasAnyOf).toBe(true);
```

**Reference**: See `tests/integration/mcp-tools-list.test.ts` lines 197-214.

**Tracking**: Mentioned in TEST_FAILURES_ANALYSIS.md Category 4.

---

### Vitest Mock Hoisting

**Issue**: `vi.mock()` calls are hoisted to the top of the file, before imports.

**Impact**: Can't import mock classes before `vi.mock()` declarations.

**Solution**: Define mock classes inside `vi.mock()` factory functions.

```typescript
// ❌ BAD: This will fail
import { MockClass } from '../helpers/mocks.js';
vi.mock('module', () => ({ Class: MockClass }));

// ✅ GOOD: Define inline
vi.mock('module', () => {
  class MockClass {
    /* ... */
  }
  return { Class: MockClass };
});
```

**Reference**: See Vitest documentation on [vi.mock](https://vitest.dev/api/vi.html#vi-mock).

---

### OAuth2Client Constructor Warning

**Issue**: Using `vi.fn()` as a class constructor triggers Vitest warning.

**Error Message**:

```
[vitest] The vi.fn() mock did not use 'function' or 'class' in its implementation
```

**Solution**: Use proper class syntax inside `vi.mock()` factory.

**Reference**: See [OAuth2Client Mocking](#oauth2client-mocking) section above.

---

## Best Practices Summary

1. **Always use `as const` for discriminated union action fields**
2. **Clear mocks in `beforeEach`, restore in `afterEach`**
3. **Reset singletons between tests**
4. **Validate output against schemas**
5. **Use factory functions for common test inputs**
6. **Use error code enums instead of string literals**
7. **Document workarounds with TODO comments and references**
8. **Test both success and error paths**
9. **Keep mocks simple and focused**
10. **Use descriptive test names: "should [expected behavior]"**

---

## Test Helpers Reference

### Available Helpers

- **oauth-mocks.ts**: Reference implementations for OAuth2Client and TokenStore mocks
- **error-codes.ts**: ErrorCode enum and assertion helpers
- **input-factories.ts**: Factory functions for common test inputs

### Using Helpers

```typescript
// Error codes and assertions
import { ErrorCode, expectErrorResponse, expectSuccessResponse } from '../helpers/error-codes.js';

// Input factories
import { createValuesReadInput, createMockSheetsResponse } from '../helpers/input-factories.js';

// Example test
it('should read values successfully', async () => {
  const input = createValuesReadInput({ spreadsheetId: 'my-sheet' });
  mockApi.spreadsheets.values.get.mockResolvedValue(createMockSheetsResponse());

  const result = await handler.handle(input);

  expectSuccessResponse(result);
  expect(result.response.values).toBeDefined();
});
```

---

## Contributing

When adding new test patterns or discovering new issues:

1. Document the pattern/issue in this file
2. Add code examples
3. Reference the files where the pattern is used
4. Update the Table of Contents

---

**Last Updated**: 2026-01-09
**Maintainer**: ServalSheets Team
