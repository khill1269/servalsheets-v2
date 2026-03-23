# Test Helpers

## Overview

This directory contains test utilities for both unit tests (mocks) and integration tests (credential loading).

## Credential Loader

The `credential-loader.ts` provides utilities for loading Google service account credentials for integration tests.

### Usage in Integration Tests

```typescript
import { shouldRunIntegrationTests, checkCredentialsOrSkip } from '../helpers/credential-loader.js';

const SKIP_INTEGRATION = !shouldRunIntegrationTests();

describe.skipIf(SKIP_INTEGRATION)('My Integration Test', () => {
  let credentials: TestCredentials;
  let testSpreadsheetId: string;

  beforeAll(async () => {
    // Load credentials and skip with helpful message if not found
    credentials = await checkCredentialsOrSkip();
    testSpreadsheetId = credentials.testSpreadsheet.id;
  });

  it('should do something with real API', async () => {
    // Your test using credentials.serviceAccount
  });
});
```

### Functions

- `shouldRunIntegrationTests()` - Check if `TEST_REAL_API=true` is set
- `loadTestCredentials()` - Load credentials from file or environment
- `checkCredentialsOrSkip()` - Load credentials or throw with helpful setup message
- `validateCredentials()` - Validate credentials have required fields
- `getMissingCredentialsMessage()` - Get formatted setup instructions

See [Integration Test Setup Guide](../INTEGRATION_TEST_SETUP.md) for credential configuration.

## Google API Mock Factory

The `google-api-mocks.ts` file provides comprehensive, reusable mocks for Google Sheets and Drive APIs.

### Usage

```typescript
import {
  createMockSheetsApi,
  createMockDriveApi,
  createMockContext,
} from '../helpers/google-api-mocks.js';
import { YourHandler } from '../../src/handlers/your-handler.js';

describe('YourHandler', () => {
  let handler: YourHandler;
  let mockSheetsApi: ReturnType<typeof createMockSheetsApi>;
  let mockDriveApi: ReturnType<typeof createMockDriveApi>;
  let mockContext: ReturnType<typeof createMockContext>;

  beforeEach(() => {
    mockSheetsApi = createMockSheetsApi();
    mockDriveApi = createMockDriveApi();
    mockContext = createMockContext();
    handler = new YourHandler(mockContext, mockSheetsApi, mockDriveApi);
  });

  it('should do something', async () => {
    // Mock returns realistic data automatically
    const result = await handler.handle({
      request: { action: 'read', spreadsheetId: 'test-spreadsheet-id' },
    });
    expect(result.response.success).toBe(true);
  });
});
```

### Custom Mock Data

```typescript
// Create mock with custom spreadsheet data
const mockSheetsApi = createMockSheetsApi({
  spreadsheets: {
    'custom-id': {
      spreadsheetId: 'custom-id',
      title: 'Custom Spreadsheet',
      sheets: [{ sheetId: 0, title: 'Data', rowCount: 500, columnCount: 10 }],
      values: {
        'Data!A1:B5': [
          ['Name', 'Value'],
          ['Item 1', '100'],
          ['Item 2', '200'],
        ],
      },
    },
  },
});
```

### Mock Context

```typescript
// Create context with custom overrides
const mockContext = createMockContext({
  auth: {
    hasElevatedAccess: true,
    scopes: ['https://www.googleapis.com/auth/drive'],
  },
});
```

### Benefits

1. **Consistency**: All tests use the same realistic mock data
2. **Maintainability**: Change mock behavior in one place
3. **Simplicity**: No need to write vi.fn() mocks inline
4. **Realism**: Mocks behave like real Google APIs
5. **Type Safety**: Full TypeScript support

## HTTP Transport Integration Tests

Some HTTP transport integration tests require binding to a local port. They are opt-in:

```bash
TEST_HTTP_INTEGRATION=true npm test -- tests/integration/http-transport.test.ts
```

### API Coverage

**Sheets API:**

- `spreadsheets.get()` - Returns full spreadsheet metadata
- `spreadsheets.create()` - Creates new spreadsheet
- `spreadsheets.batchUpdate()` - Batch updates
- `spreadsheets.values.get()` - Get values
- `spreadsheets.values.update()` - Update values
- `spreadsheets.values.append()` - Append values
- `spreadsheets.values.clear()` - Clear values
- `spreadsheets.values.batchGet()` - Batch get
- `spreadsheets.values.batchUpdate()` - Batch update

**Drive API:**

- `files.copy()` - Copy files
- `files.get()` - Get file metadata
- `files.list()` - List files
- `files.delete()` - Delete files
- `permissions.*` - Permission operations
- `comments.*` - Comment operations
- `revisions.*` - Revision operations

### Extending the Mocks

To add new mock methods:

```typescript
// In google-api-mocks.ts
export function createMockSheetsApi(options: MockSheetsApiOptions = {}) {
  const api = {
    spreadsheets: {
      // ... existing mocks ...

      // Add your new mock
      yourNewMethod: vi.fn().mockImplementation((params) => {
        return Promise.resolve({
          data: {
            // Your mock response
          },
        });
      }),
    },
  };

  return api as unknown as sheets_v4.Sheets;
}
```
