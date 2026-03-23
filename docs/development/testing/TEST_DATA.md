---
title: ServalSheets Test Data Guide
category: development
last_updated: 2026-01-31
description: This guide documents test data patterns, factories, and mocks used in the
version: 1.6.0
tags: [testing]
---

# ServalSheets Test Data Guide

This guide documents test data patterns, factories, and mocks used in the
ServalSheets test suite. It is meant for quick copy/paste when writing tests.

---

## Input Factories

Factory helpers live in `tests/helpers/input-factories.ts`.

Common factories:

- `createValuesReadInput`
- `createValuesWriteInput`
- `createSpreadsheetGetInput`
- `createFormatApplyInput`
- `createAnalyzeInput`
- `createMockSheetsResponse`

Example usage (from a test under `tests/handlers/`):

```ts
import {
  createValuesReadInput,
  createValuesWriteInput,
  createFormatApplyInput,
  createAnalyzeInput,
} from '../helpers/input-factories.js';

const readInput = createValuesReadInput({
  spreadsheetId: 'test-sheet-values-read',
  range: { a1: 'Sheet1!A1:B2' },
});

const writeInput = createValuesWriteInput({
  values: [
    ['Name', 'Score'],
    ['Alice', 5],
  ],
});

const formatInput = createFormatApplyInput({
  range: { a1: 'Sheet1!A1:B2' },
  format: { backgroundColor: { red: 1, green: 1, blue: 0 } },
});

const analyzeInput = createAnalyzeInput({
  range: { a1: 'Sheet1!A1:B2' },
  analysisTypes: ['summary', 'quality'],
});
```

Use factories for standard cases and override only what matters. For edge
cases or invalid inputs, build the input inline.

---

## Mock API Factories

Mock helpers live in `tests/helpers/google-api-mocks.ts`.

```ts
import { createMockSheetsApi, createMockDriveApi } from '../helpers/google-api-mocks.js';

const sheetsApi = createMockSheetsApi();
const driveApi = createMockDriveApi();
```

For simple response objects, `createMockSheetsResponse` from
`tests/helpers/input-factories.ts` is often enough:

```ts
import { createMockSheetsResponse } from '../helpers/input-factories.js';

const response = createMockSheetsResponse({
  values: [
    ['Name', 'Score'],
    ['Alice', 5],
  ],
  sheets: [{ properties: { sheetId: 0, title: 'Sheet1' } }],
});
```

OAuth mocks are in `tests/helpers/oauth-mocks.ts`. See `tests/TEST_PATTERNS.md`
for the canonical usage patterns.

---

## Integration Test Data

Integration tests require real credentials. Use helpers in
`tests/helpers/credential-loader.ts`:

```ts
import { shouldRunIntegrationTests, checkCredentialsOrSkip } from '../helpers/credential-loader.js';

if (!shouldRunIntegrationTests()) {
  // Skip integration tests
}

const credentials = await checkCredentialsOrSkip();
```

When creating real spreadsheets/sheets, clean them up in `afterAll` or
`afterEach` to avoid resource leaks.

---

## Best Practices

1. Use descriptive IDs

```ts
// Good
const input = createValuesReadInput({ spreadsheetId: 'test-sheet-values-read' });
```

1. Keep data small and focused

```ts
// Good
const values = [
  ['Name', 'Score'],
  ['Alice', 5],
];
```

1. Prefer realistic data

```ts
const values = [
  ['Name', 'Email'],
  ['Alice Johnson', 'alice@example.com'],
];
```

1. Avoid shared mutable fixtures

```ts
// Bad
const SHARED = [['A']];

// Good
const values = [['A']];
```

1. Clean up singleton state when needed

```ts
import { resetAllSingletons } from '../helpers/singleton-reset.js';

beforeEach(() => {
  resetAllSingletons();
});
```

---

## Anti-Patterns

- Hard-coded production IDs
- Large fixtures that obscure intent
- Dynamic values (timestamps, UUIDs) in snapshots
- Shared mutable arrays/objects across tests
