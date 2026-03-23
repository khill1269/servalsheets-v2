---
title: ServalSheets Testing Guide
category: development
last_updated: 2026-01-31
description: '> Version: 1.0.0'
version: 1.6.0
tags: [testing, sheets]
---

# ServalSheets Testing Guide

> **Version:** 1.0.0  
> **Coverage Target:** 80%+ for core functionality  
> **Test Framework:** Vitest + fast-check

---

## Table of Contents

1. [Testing Philosophy](#testing-philosophy)
2. [Test Structure](#test-structure)
3. [Unit Testing](#unit-testing)
4. [Integration Testing](#integration-testing)
5. [Property-Based Testing](#property-based-testing)
6. [E2E Testing](#e2e-testing)
7. [Mocking Patterns](#mocking-patterns)
8. [Test Fixtures](#test-fixtures)
9. [Coverage Requirements](#coverage-requirements)
10. [CI Integration](#ci-integration)

---

## Testing Philosophy

### Test Pyramid

```
        /\
       /  \      E2E Tests (5%)
      /────\     - Full MCP client → server flows
     /      \
    /────────\   Integration Tests (25%)
   /          \  - Handler + Service + Mock API
  /────────────\
 /              \ Unit Tests (70%)
/________________\ - Schemas, utilities, services
```

### Principles

1. **Test behavior, not implementation** - Focus on what, not how
2. **Fast feedback** - Unit tests < 100ms each
3. **Deterministic** - No flaky tests allowed
4. **Isolated** - Tests don't depend on each other
5. **Property-based where possible** - Catch edge cases automatically

---

## Test Structure

### Directory Layout

```
tests/
├── unit/
│   ├── schemas/
│   │   ├── values.test.ts
│   │   ├── format.test.ts
│   │   ├── charts.test.ts
│   │   └── ...
│   ├── services/
│   │   ├── sheets.test.ts
│   │   ├── drive.test.ts
│   │   ├── cache.test.ts
│   │   └── snapshot.test.ts
│   ├── handlers/
│   │   ├── values.test.ts
│   │   ├── format.test.ts
│   │   └── ...
│   └── utils/
│       ├── a1-notation.test.ts
│       ├── colors.test.ts
│       └── tool-names.test.ts
├── integration/
│   ├── mcp-protocol.test.ts
│   ├── tool-registration.test.ts
│   ├── sheets-api.test.ts
│   └── error-handling.test.ts
├── property/
│   ├── schemas.property.test.ts
│   ├── a1-notation.property.test.ts
│   ├── colors.property.test.ts
│   └── values.property.test.ts
├── e2e/
│   ├── read-write-flow.test.ts
│   ├── format-flow.test.ts
│   └── analysis-flow.test.ts
├── fixtures/
│   ├── spreadsheets/
│   ├── responses/
│   └── errors/
├── mocks/
│   ├── google-api.ts
│   ├── mcp-client.ts
│   └── redis.ts
└── helpers/
    ├── factories.ts
    ├── assertions.ts
    └── setup.ts
```

### Naming Conventions

```typescript
// File: [module].test.ts or [module].property.test.ts
// Describe: Module/Class name
// It: should [expected behavior] when [condition]

describe('SheetsValuesHandler', () => {
  describe('read action', () => {
    it('should return values when range exists', async () => {});
    it('should return empty array when range is empty', async () => {});
    it('should throw NotFound when spreadsheet missing', async () => {});
  });
});
```

---

## Unit Testing

### Schema Validation Tests

```typescript
// tests/unit/schemas/values.test.ts
import { describe, it, expect } from 'vitest';
import { SheetsValuesInputSchema } from '../../../src/schemas/values';

describe('SheetsValuesInputSchema', () => {
  describe('read action', () => {
    it('should accept valid read input', () => {
      const input = {
        action: 'read',
        spreadsheetId: 'abc123',
        range: { a1: 'Sheet1!A1:D10' },
      };

      const result = SheetsValuesInputSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should reject missing spreadsheetId', () => {
      const input = {
        action: 'read',
        range: { a1: 'Sheet1!A1:D10' },
      };

      const result = SheetsValuesInputSchema.safeParse(input);
      expect(result.success).toBe(false);
      expect(result.error?.issues[0].path).toContain('spreadsheetId');
    });

    it('should accept all range formats', () => {
      const formats = [
        { a1: 'A1:B10' },
        { a1: 'Sheet1!A1:B10' },
        { a1: "'My Sheet'!A1:B10" },
        { namedRange: 'MyRange' },
        { semantic: { sheet: 'Sheet1', column: 'A' } },
        { grid: { sheetId: 0, startRowIndex: 0, endRowIndex: 10 } },
      ];

      formats.forEach((range) => {
        const result = SheetsValuesInputSchema.safeParse({
          action: 'read',
          spreadsheetId: 'abc123',
          range,
        });
        expect(result.success, `Failed for ${JSON.stringify(range)}`).toBe(true);
      });
    });
  });

  describe('write action', () => {
    it('should accept valid write input with 2D array', () => {
      const input = {
        action: 'write',
        spreadsheetId: 'abc123',
        range: { a1: 'Sheet1!A1' },
        values: [
          ['Hello', 'World'],
          [1, 2],
        ],
      };

      const result = SheetsValuesInputSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should reject non-array values', () => {
      const input = {
        action: 'write',
        spreadsheetId: 'abc123',
        range: { a1: 'Sheet1!A1' },
        values: 'not an array',
      };

      const result = SheetsValuesInputSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('should apply default valueInputOption', () => {
      const input = {
        action: 'write',
        spreadsheetId: 'abc123',
        range: { a1: 'A1' },
        values: [['test']],
      };

      const result = SheetsValuesInputSchema.parse(input);
      expect(result.valueInputOption).toBe('USER_ENTERED');
    });
  });

  describe('discriminated union', () => {
    it('should reject unknown action', () => {
      const input = {
        action: 'unknown',
        spreadsheetId: 'abc123',
      };

      const result = SheetsValuesInputSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });
});
```

### Service Layer Tests

```typescript
// tests/unit/services/sheets.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SheetsService } from '../../../src/services/sheets';
import { mockSheetsApi } from '../../mocks/google-api';

describe('SheetsService', () => {
  let service: SheetsService;
  let mockApi: ReturnType<typeof mockSheetsApi>;

  beforeEach(() => {
    mockApi = mockSheetsApi();
    service = new SheetsService(mockApi);
  });

  describe('readValues', () => {
    it('should return values from API response', async () => {
      mockApi.spreadsheets.values.get.mockResolvedValue({
        data: {
          values: [
            ['A1', 'B1'],
            ['A2', 'B2'],
          ],
          range: 'Sheet1!A1:B2',
        },
      });

      const result = await service.readValues('spreadsheet-id', 'Sheet1!A1:B2');

      expect(result.values).toEqual([
        ['A1', 'B1'],
        ['A2', 'B2'],
      ]);
      expect(result.range).toBe('Sheet1!A1:B2');
    });

    it('should return empty array for empty range', async () => {
      mockApi.spreadsheets.values.get.mockResolvedValue({
        data: { range: 'Sheet1!A1:B2' }, // No values property
      });

      const result = await service.readValues('spreadsheet-id', 'Sheet1!A1:B2');

      expect(result.values).toEqual([]);
    });

    it('should pass valueRenderOption to API', async () => {
      mockApi.spreadsheets.values.get.mockResolvedValue({
        data: { values: [[1, 2]], range: 'A1:B1' },
      });

      await service.readValues('id', 'A1:B1', { valueRenderOption: 'UNFORMATTED_VALUE' });

      expect(mockApi.spreadsheets.values.get).toHaveBeenCalledWith(
        expect.objectContaining({
          valueRenderOption: 'UNFORMATTED_VALUE',
        })
      );
    });
  });

  describe('writeValues', () => {
    it('should call update API with correct parameters', async () => {
      mockApi.spreadsheets.values.update.mockResolvedValue({
        data: { updatedCells: 4, updatedRange: 'Sheet1!A1:B2' },
      });

      const result = await service.writeValues(
        'spreadsheet-id',
        'Sheet1!A1',
        [
          ['A', 'B'],
          ['C', 'D'],
        ],
        'USER_ENTERED'
      );

      expect(mockApi.spreadsheets.values.update).toHaveBeenCalledWith({
        spreadsheetId: 'spreadsheet-id',
        range: 'Sheet1!A1',
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [
            ['A', 'B'],
            ['C', 'D'],
          ],
        },
      });
      expect(result.updatedCells).toBe(4);
    });
  });

  describe('batchUpdate', () => {
    it('should combine multiple requests', async () => {
      mockApi.spreadsheets.batchUpdate.mockResolvedValue({
        data: { replies: [{}, {}] },
      });

      await service.batchUpdate('id', [
        { addSheet: { properties: { title: 'New' } } },
        {
          updateCells: {
            /* ... */
          },
        },
      ]);

      expect(mockApi.spreadsheets.batchUpdate).toHaveBeenCalledWith({
        spreadsheetId: 'id',
        requestBody: {
          requests: expect.arrayContaining([
            expect.objectContaining({ addSheet: expect.any(Object) }),
            expect.objectContaining({ updateCells: expect.any(Object) }),
          ]),
        },
      });
    });
  });
});
```

### Handler Tests

```typescript
// tests/unit/handlers/values.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SheetsValuesHandler } from '../../../src/handlers/values';
import { createMockExtra, createMockSheetsService } from '../../helpers/factories';

describe('SheetsValuesHandler', () => {
  let handler: SheetsValuesHandler;
  let mockService: ReturnType<typeof createMockSheetsService>;
  let mockExtra: ReturnType<typeof createMockExtra>;

  beforeEach(() => {
    mockService = createMockSheetsService();
    mockExtra = createMockExtra();
    handler = new SheetsValuesHandler(mockService);
  });

  describe('handle - read action', () => {
    it('should return success with values', async () => {
      mockService.readValues.mockResolvedValue({
        values: [
          ['A', 'B'],
          ['C', 'D'],
        ],
        range: 'Sheet1!A1:B2',
      });

      const result = await handler.handle(
        {
          action: 'read',
          spreadsheetId: 'test-id',
          range: { a1: 'Sheet1!A1:B2' },
        },
        mockExtra
      );

      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toEqual({
        success: true,
        action: 'read',
        data: {
          values: [
            ['A', 'B'],
            ['C', 'D'],
          ],
          range: 'Sheet1!A1:B2',
          rowCount: 2,
          columnCount: 2,
        },
      });
    });

    it('should include human-readable content', async () => {
      mockService.readValues.mockResolvedValue({
        values: [['test']],
        range: 'A1',
      });

      const result = await handler.handle(
        {
          action: 'read',
          spreadsheetId: 'test-id',
          range: { a1: 'A1' },
        },
        mockExtra
      );

      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');
      expect(result.content[0].text).toContain('Read 1 row');
    });
  });

  describe('handle - write action', () => {
    it('should support dry run mode', async () => {
      const result = await handler.handle(
        {
          action: 'write',
          spreadsheetId: 'test-id',
          range: { a1: 'A1' },
          values: [['test']],
          safety: { dryRun: true },
        },
        mockExtra
      );

      expect(mockService.writeValues).not.toHaveBeenCalled();
      expect(result.structuredContent.dryRun).toBe(true);
    });

    it('should create snapshot before write when autoSnapshot enabled', async () => {
      mockService.writeValues.mockResolvedValue({ updatedCells: 1 });

      await handler.handle(
        {
          action: 'write',
          spreadsheetId: 'test-id',
          range: { a1: 'A1' },
          values: [['test']],
          safety: { autoSnapshot: true },
        },
        mockExtra
      );

      expect(mockService.createSnapshot).toHaveBeenCalledBefore(mockService.writeValues);
    });
  });

  describe('error handling', () => {
    it('should return isError for 404 not found', async () => {
      mockService.readValues.mockRejectedValue({
        code: 404,
        message: 'Spreadsheet not found',
      });

      const result = await handler.handle(
        {
          action: 'read',
          spreadsheetId: 'invalid-id',
          range: { a1: 'A1' },
        },
        mockExtra
      );

      expect(result.isError).toBe(true);
      expect(result.structuredContent.error.code).toBe('NOT_FOUND');
    });

    it('should return isError for 429 rate limit', async () => {
      mockService.readValues.mockRejectedValue({
        code: 429,
        message: 'Rate limit exceeded',
      });

      const result = await handler.handle(
        {
          action: 'read',
          spreadsheetId: 'test-id',
          range: { a1: 'A1' },
        },
        mockExtra
      );

      expect(result.isError).toBe(true);
      expect(result.structuredContent.error.code).toBe('RATE_LIMITED');
      expect(result.structuredContent.error.retryAfter).toBeDefined();
    });
  });
});
```

### Utility Tests

```typescript
// tests/unit/utils/a1-notation.test.ts
import { describe, it, expect } from 'vitest';
import {
  parseA1Notation,
  columnToIndex,
  indexToColumn,
  isValidA1Notation,
} from '../../../src/utils/a1-notation';

describe('A1 Notation Utilities', () => {
  describe('columnToIndex', () => {
    it('should convert single letters', () => {
      expect(columnToIndex('A')).toBe(0);
      expect(columnToIndex('B')).toBe(1);
      expect(columnToIndex('Z')).toBe(25);
    });

    it('should convert double letters', () => {
      expect(columnToIndex('AA')).toBe(26);
      expect(columnToIndex('AB')).toBe(27);
      expect(columnToIndex('AZ')).toBe(51);
      expect(columnToIndex('BA')).toBe(52);
    });

    it('should convert triple letters', () => {
      expect(columnToIndex('AAA')).toBe(702);
    });

    it('should be case insensitive', () => {
      expect(columnToIndex('a')).toBe(columnToIndex('A'));
      expect(columnToIndex('aa')).toBe(columnToIndex('AA'));
    });
  });

  describe('indexToColumn', () => {
    it('should convert indices to columns', () => {
      expect(indexToColumn(0)).toBe('A');
      expect(indexToColumn(25)).toBe('Z');
      expect(indexToColumn(26)).toBe('AA');
      expect(indexToColumn(702)).toBe('AAA');
    });

    it('should be inverse of columnToIndex', () => {
      for (let i = 0; i < 1000; i++) {
        expect(columnToIndex(indexToColumn(i))).toBe(i);
      }
    });
  });

  describe('parseA1Notation', () => {
    it('should parse simple range', () => {
      const result = parseA1Notation('A1:B10');
      expect(result).toEqual({
        sheet: undefined,
        startColumn: 'A',
        startRow: 1,
        endColumn: 'B',
        endRow: 10,
      });
    });

    it('should parse range with sheet name', () => {
      const result = parseA1Notation('Sheet1!A1:B10');
      expect(result.sheet).toBe('Sheet1');
    });

    it('should parse range with quoted sheet name', () => {
      const result = parseA1Notation("'My Sheet'!A1:B10");
      expect(result.sheet).toBe('My Sheet');
    });

    it('should parse single cell', () => {
      const result = parseA1Notation('C5');
      expect(result).toEqual({
        sheet: undefined,
        startColumn: 'C',
        startRow: 5,
        endColumn: 'C',
        endRow: 5,
      });
    });

    it('should parse entire column', () => {
      const result = parseA1Notation('A:A');
      expect(result).toEqual({
        sheet: undefined,
        startColumn: 'A',
        startRow: undefined,
        endColumn: 'A',
        endRow: undefined,
      });
    });
  });

  describe('isValidA1Notation', () => {
    it('should accept valid notations', () => {
      const valid = [
        'A1',
        'A1:B2',
        'Sheet1!A1',
        'Sheet1!A1:B2',
        "'My Sheet'!A1:B2",
        'A:A',
        '1:1',
        'AA100:ZZ999',
      ];
      valid.forEach((notation) => {
        expect(isValidA1Notation(notation), notation).toBe(true);
      });
    });

    it('should reject invalid notations', () => {
      const invalid = ['', '!A1', 'Sheet1!', '1A', 'A', '1', 'A1:B', 'Sheet1!!A1', 'A1:B2:C3'];
      invalid.forEach((notation) => {
        expect(isValidA1Notation(notation), notation).toBe(false);
      });
    });
  });
});
```

---

## Integration Testing

### MCP Protocol Tests

```typescript
// tests/integration/mcp-protocol.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { spawn } from 'child_process';

describe('MCP Protocol Integration', () => {
  let client: Client;
  let serverProcess: ReturnType<typeof spawn>;

  beforeAll(async () => {
    // Start server process
    serverProcess = spawn('node', ['dist/index.js'], {
      env: { ...process.env, NODE_ENV: 'test' },
    });

    // Create client
    client = new Client({ name: 'test-client', version: '1.0.0' });
    const transport = new StdioClientTransport({
      command: 'node',
      args: ['dist/index.js'],
    });
    await client.connect(transport);
  });

  afterAll(async () => {
    await client.close();
    serverProcess.kill();
  });

  describe('initialization', () => {
    it('should report correct server info', async () => {
      const serverInfo = client.getServerInfo();
      expect(serverInfo.name).toBe('servalsheets');
      expect(serverInfo.version).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it('should advertise tools capability', async () => {
      const capabilities = client.getServerCapabilities();
      expect(capabilities.tools).toBeDefined();
    });
  });

  describe('tools/list', () => {
    it('should return all 25 tools', async () => {
      const tools = await client.listTools();
      expect(tools.tools).toHaveLength(21);
    });

    it('should have valid tool names per SEP-986', async () => {
      const tools = await client.listTools();
      const nameRegex = /^[A-Za-z0-9._-]{1,128}$/;

      tools.tools.forEach((tool) => {
        expect(tool.name).toMatch(nameRegex);
        expect(tool.name).toMatch(/^sheets_/); // Our convention
      });
    });

    it('should have all required annotations', async () => {
      const tools = await client.listTools();

      tools.tools.forEach((tool) => {
        expect(tool.annotations).toBeDefined();
        expect(typeof tool.annotations.readOnlyHint).toBe('boolean');
        expect(typeof tool.annotations.destructiveHint).toBe('boolean');
        expect(typeof tool.annotations.idempotentHint).toBe('boolean');
        expect(typeof tool.annotations.openWorldHint).toBe('boolean');
      });
    });

    it('should have input schemas with type object', async () => {
      const tools = await client.listTools();

      tools.tools.forEach((tool) => {
        expect(tool.inputSchema.type).toBe('object');
      });
    });
  });

  describe('tools/call', () => {
    it('should return both content and structuredContent', async () => {
      const result = await client.callTool('sheets_auth', {
        action: 'status',
      });

      expect(result.content).toBeDefined();
      expect(Array.isArray(result.content)).toBe(true);
      expect(result.structuredContent).toBeDefined();
    });

    it('should return isError for invalid input', async () => {
      const result = await client.callTool('sheets_data', {
        action: 'read',
        // Missing spreadsheetId
      });

      expect(result.isError).toBe(true);
      expect(result.structuredContent.error).toBeDefined();
    });
  });
});
```

### Google Sheets API Integration

```typescript
// tests/integration/sheets-api.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { google } from 'googleapis';
import { SheetsService } from '../../src/services/sheets';

// Only run if GOOGLE_TEST_CREDENTIALS is set
const runIntegration = process.env.GOOGLE_TEST_CREDENTIALS !== undefined;

describe.skipIf(!runIntegration)('Google Sheets API Integration', () => {
  let service: SheetsService;
  let testSpreadsheetId: string;

  beforeAll(async () => {
    const auth = new google.auth.GoogleAuth({
      credentials: JSON.parse(process.env.GOOGLE_TEST_CREDENTIALS!),
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const sheetsApi = google.sheets({ version: 'v4', auth });
    service = new SheetsService(sheetsApi);

    // Create test spreadsheet
    const response = await sheetsApi.spreadsheets.create({
      requestBody: {
        properties: { title: `Test-${Date.now()}` },
      },
    });
    testSpreadsheetId = response.data.spreadsheetId!;
  });

  afterAll(async () => {
    // Delete test spreadsheet
    if (testSpreadsheetId) {
      const drive = google.drive({ version: 'v3', auth: service.auth });
      await drive.files.delete({ fileId: testSpreadsheetId });
    }
  });

  describe('read/write cycle', () => {
    it('should write and read values', async () => {
      const testData = [
        ['Name', 'Age', 'City'],
        ['Alice', 30, 'NYC'],
        ['Bob', 25, 'LA'],
      ];

      // Write
      await service.writeValues(testSpreadsheetId, 'Sheet1!A1', testData, 'USER_ENTERED');

      // Read
      const result = await service.readValues(testSpreadsheetId, 'Sheet1!A1:C3');

      expect(result.values).toEqual(testData);
    });

    it('should handle formulas with USER_ENTERED', async () => {
      await service.writeValues(
        testSpreadsheetId,
        'Sheet1!E1:E3',
        [['=1+1'], ['=SUM(1,2,3)'], ['=TODAY()']],
        'USER_ENTERED'
      );

      const result = await service.readValues(testSpreadsheetId, 'Sheet1!E1:E3', {
        valueRenderOption: 'UNFORMATTED_VALUE',
      });

      expect(result.values[0][0]).toBe(2);
      expect(result.values[1][0]).toBe(6);
      expect(typeof result.values[2][0]).toBe('number'); // Serial date
    });
  });

  describe('formatting', () => {
    it('should apply background color', async () => {
      await service.batchUpdate(testSpreadsheetId, [
        {
          repeatCell: {
            range: { sheetId: 0, startRowIndex: 0, endRowIndex: 1 },
            cell: {
              userEnteredFormat: {
                backgroundColor: { red: 0.2, green: 0.6, blue: 0.8 },
              },
            },
            fields: 'userEnteredFormat.backgroundColor',
          },
        },
      ]);

      // Verify by reading cell format
      const response = await service.getSpreadsheet(testSpreadsheetId, {
        includeGridData: true,
        ranges: ['Sheet1!A1'],
      });

      const cellFormat = response.sheets[0].data[0].rowData[0].values[0].userEnteredFormat;
      expect(cellFormat?.backgroundColor?.red).toBeCloseTo(0.2, 1);
    });
  });
});
```

---

## Property-Based Testing

### Setup with fast-check

```typescript
// tests/property/setup.ts
import * as fc from 'fast-check';

// Custom arbitraries for ServalSheets
export const arbitraries = {
  // Spreadsheet ID (alphanumeric + dash/underscore)
  spreadsheetId: fc.stringOf(
    fc.constantFrom(
      ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_'.split('')
    ),
    { minLength: 1, maxLength: 100 }
  ),

  // Sheet ID (positive integer)
  sheetId: fc.nat({ max: 2147483647 }),

  // Column letter (A-ZZZ)
  column: fc.integer({ min: 0, max: 18277 }).map(indexToColumn),

  // Row number (1-based)
  row: fc.integer({ min: 1, max: 1000000 }),

  // Cell reference
  cellRef: fc
    .tuple(fc.integer({ min: 0, max: 702 }).map(indexToColumn), fc.integer({ min: 1, max: 10000 }))
    .map(([col, row]) => `${col}${row}`),

  // A1 notation
  a1Notation: fc.oneof(
    // Simple range: A1:B10
    fc
      .tuple(
        fc.integer({ min: 0, max: 100 }).map(indexToColumn),
        fc.integer({ min: 1, max: 1000 }),
        fc.integer({ min: 0, max: 100 }).map(indexToColumn),
        fc.integer({ min: 1, max: 1000 })
      )
      .map(([c1, r1, c2, r2]) => `${c1}${r1}:${c2}${r2}`),
    // With sheet: Sheet1!A1:B10
    fc
      .tuple(
        fc.stringOf(fc.alphanumeric(), { minLength: 1, maxLength: 50 }),
        fc.integer({ min: 0, max: 100 }).map(indexToColumn),
        fc.integer({ min: 1, max: 1000 }),
        fc.integer({ min: 0, max: 100 }).map(indexToColumn),
        fc.integer({ min: 1, max: 1000 })
      )
      .map(([sheet, c1, r1, c2, r2]) => `${sheet}!${c1}${r1}:${c2}${r2}`)
  ),

  // Color (0-1 scale)
  color: fc.record({
    red: fc.float({ min: 0, max: 1, noNaN: true }),
    green: fc.float({ min: 0, max: 1, noNaN: true }),
    blue: fc.float({ min: 0, max: 1, noNaN: true }),
    alpha: fc.option(fc.float({ min: 0, max: 1, noNaN: true })),
  }),

  // Cell value (string, number, boolean, null)
  cellValue: fc.oneof(fc.string(), fc.double({ noNaN: true }), fc.boolean(), fc.constant(null)),

  // 2D values array
  values2D: fc.array(
    fc.array(fc.oneof(fc.string(), fc.double({ noNaN: true }), fc.boolean(), fc.constant(null)), {
      minLength: 1,
      maxLength: 26,
    }),
    { minLength: 1, maxLength: 1000 }
  ),

  // Tool name (SEP-986 compliant)
  toolName: fc.stringOf(
    fc.constantFrom(
      ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-'.split('')
    ),
    { minLength: 1, maxLength: 128 }
  ),
};
```

### Schema Property Tests

```typescript
// tests/property/schemas.property.test.ts
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { arbitraries } from './setup';
import { SheetsValuesInputSchema } from '../../src/schemas/values';
import { ColorSchema } from '../../src/schemas/common';

describe('Schema Property Tests', () => {
  describe('SheetsValuesInputSchema', () => {
    it('should accept any valid read input', () => {
      fc.assert(
        fc.property(arbitraries.spreadsheetId, arbitraries.a1Notation, (spreadsheetId, a1) => {
          const input = {
            action: 'read',
            spreadsheetId,
            range: { a1 },
          };
          const result = SheetsValuesInputSchema.safeParse(input);
          return result.success;
        }),
        { numRuns: 1000 }
      );
    });

    it('should accept any valid write input', () => {
      fc.assert(
        fc.property(
          arbitraries.spreadsheetId,
          arbitraries.a1Notation,
          arbitraries.values2D,
          (spreadsheetId, a1, values) => {
            const input = {
              action: 'write',
              spreadsheetId,
              range: { a1 },
              values,
            };
            const result = SheetsValuesInputSchema.safeParse(input);
            return result.success;
          }
        ),
        { numRuns: 500 }
      );
    });

    it('should preserve action type through parse', () => {
      const actions = ['read', 'write', 'append', 'clear', 'batch_read', 'batch_write'];

      fc.assert(
        fc.property(
          fc.constantFrom(...actions),
          arbitraries.spreadsheetId,
          (action, spreadsheetId) => {
            const input = {
              action,
              spreadsheetId,
              range: { a1: 'A1:B2' },
              ...(action === 'write' || action === 'append' ? { values: [['test']] } : {}),
              ...(action === 'batch_read' ? { ranges: [{ a1: 'A1:B2' }] } : {}),
              ...(action === 'batch_write'
                ? { data: [{ range: { a1: 'A1' }, values: [['test']] }] }
                : {}),
            };
            const result = SheetsValuesInputSchema.safeParse(input);
            return result.success && result.data.action === action;
          }
        )
      );
    });
  });

  describe('ColorSchema', () => {
    it('should accept any valid color', () => {
      fc.assert(
        fc.property(arbitraries.color, (color) => {
          const result = ColorSchema.safeParse(color);
          return result.success;
        }),
        { numRuns: 1000 }
      );
    });

    it('should reject colors outside 0-1 range', () => {
      fc.assert(
        fc.property(fc.float({ min: 1.01, max: 255, noNaN: true }), (value) => {
          const result = ColorSchema.safeParse({ red: value, green: 0, blue: 0 });
          return !result.success;
        })
      );
    });

    it('should clamp or reject negative values', () => {
      fc.assert(
        fc.property(fc.float({ min: -255, max: -0.01, noNaN: true }), (value) => {
          const result = ColorSchema.safeParse({ red: value, green: 0, blue: 0 });
          return !result.success;
        })
      );
    });
  });
});
```

---

## E2E Testing

```typescript
// tests/e2e/read-write-flow.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { McpTestClient } from '../helpers/mcp-test-client';

describe('E2E: Read-Write Flow', () => {
  let client: McpTestClient;
  let testSpreadsheetId: string;

  beforeAll(async () => {
    client = await McpTestClient.create();

    // Create test spreadsheet
    const result = await client.callTool('sheets_core', {
      action: 'create',
      title: `E2E-Test-${Date.now()}`,
    });
    testSpreadsheetId = result.structuredContent.data.spreadsheetId;
  });

  afterAll(async () => {
    // Cleanup
    if (testSpreadsheetId) {
      await client.callTool('sheets_core', {
        action: 'delete',
        spreadsheetId: testSpreadsheetId,
        permanent: true,
      });
    }
    await client.close();
  });

  it('should complete full read-write-format cycle', async () => {
    // 1. Write data
    const writeResult = await client.callTool('sheets_data', {
      action: 'write',
      spreadsheetId: testSpreadsheetId,
      range: { a1: 'Sheet1!A1' },
      values: [
        ['Product', 'Price', 'Quantity', 'Total'],
        ['Widget', 10, 5, '=B2*C2'],
        ['Gadget', 25, 3, '=B3*C3'],
      ],
    });
    expect(writeResult.isError).toBeFalsy();

    // 2. Read back
    const readResult = await client.callTool('sheets_data', {
      action: 'read',
      spreadsheetId: testSpreadsheetId,
      range: { a1: 'Sheet1!A1:D3' },
    });
    expect(readResult.structuredContent.data.values[1][3]).toBe(50); // Calculated
    expect(readResult.structuredContent.data.values[2][3]).toBe(75);

    // 3. Format header
    const formatResult = await client.callTool('sheets_format', {
      action: 'apply',
      spreadsheetId: testSpreadsheetId,
      range: { a1: 'Sheet1!A1:D1' },
      format: {
        backgroundColor: { red: 0.2, green: 0.2, blue: 0.3 },
        textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } },
      },
    });
    expect(formatResult.isError).toBeFalsy();

    // 4. Create chart
    const chartResult = await client.callTool('sheets_visualize', {
      action: 'create',
      spreadsheetId: testSpreadsheetId,
      chartType: 'COLUMN',
      dataRange: { a1: 'Sheet1!A1:D3' },
      title: 'Sales Summary',
    });
    expect(chartResult.structuredContent.data.chartId).toBeDefined();

    // 5. Scout/analyze
    const analysisResult = await client.callTool('sheets_analyze', {
      action: 'scout',
      spreadsheetId: testSpreadsheetId,
    });
    expect(analysisResult.structuredContent.data.sheets).toHaveLength(1);
    expect(analysisResult.structuredContent.data.charts).toHaveLength(1);
  });
});
```

---

## E2E Workflow Tests (Phase 2B)

> **New in v1.6.0**: Workflow-based E2E tests for multi-step operations

E2E workflow tests validate complete user journeys across multiple tools. These tests use the Test Orchestrator to coordinate complex multi-step operations.

### Test Orchestrator

The Test Orchestrator provides high-level workflow coordination:

```typescript
// tests/e2e/setup/test-orchestrator.ts
import { createTestOrchestrator } from '../setup/test-orchestrator.js';

// Create orchestrator
const orchestrator = createTestOrchestrator('My Workflow Test');

// Setup creates test spreadsheet automatically
const spreadsheetId = await orchestrator.setup();

// Execute workflow steps
await orchestrator.executeStep({
  name: 'Write data',
  tool: 'sheets_data',
  action: 'write',
  args: {
    spreadsheetId,
    range: 'Data!A1:B2',
    values: [
      ['A', 'B'],
      ['1', '2'],
    ],
  },
  validate: (result) => {
    expect(result.success).toBe(true);
  },
});

// Cleanup (automatic)
await orchestrator.cleanup();
```

### Workflow Types

#### 1. Analysis Workflow (`tests/e2e/workflows/analysis-workflow.test.ts`)

Tests the complete analysis pipeline:

1. Create spreadsheet
2. Populate with sample data (100-1000 rows)
3. Read data to verify
4. Perform quick analysis
5. Perform comprehensive analysis
6. Verify analysis results

```typescript
describeE2E('E2E: Analysis Workflow', () => {
  let orchestrator: ReturnType<typeof createTestOrchestrator>;
  let spreadsheetId: string;

  beforeEach(async () => {
    orchestrator = createTestOrchestrator('Analysis Workflow');
    spreadsheetId = await orchestrator.setup();
  });

  afterEach(async () => {
    await orchestrator.cleanup();
  });

  it('should complete full analysis pipeline', async () => {
    const testData = generateTestData(100, 5);

    await orchestrator.executeStep({
      name: 'Populate test data',
      tool: 'sheets_data',
      action: 'write',
      args: { spreadsheetId, range: 'Data!A1:E101', values: testData },
    });

    await orchestrator.executeStep({
      name: 'Comprehensive analysis',
      tool: 'sheets_analyze',
      action: 'comprehensive',
      args: { spreadsheetId },
    });

    // Verify workflow history
    const context = orchestrator.getContext();
    expect(context.history.every((h) => h.success)).toBe(true);
  }, 60000);
});
```

#### 2. Transaction Workflow (`tests/e2e/workflows/transaction-workflow.test.ts`)

Tests transaction handling and data consistency:

1. Multi-step atomic operations
2. Batch updates
3. Data consistency verification
4. Error recovery tracking

```typescript
describeE2E('E2E: Transaction Workflow', () => {
  it('should execute successful multi-step transaction', async () => {
    // Transfer operation: Deduct from A, Add to B
    await orchestrator.executeStep({
      name: 'Deduct from Account A',
      tool: 'sheets_data',
      action: 'write',
      args: { spreadsheetId, range: 'Data!B2', values: [['500']] },
    });

    await orchestrator.executeStep({
      name: 'Add to Account B',
      tool: 'sheets_data',
      action: 'write',
      args: { spreadsheetId, range: 'Data!B3', values: [['2500']] },
    });

    // Verify both operations completed
    const context = orchestrator.getContext();
    expect(context.history.filter((h) => h.success).length).toBe(2);
  });
});
```

#### 3. Collaboration Workflow (`tests/e2e/workflows/collaboration-workflow.test.ts`)

Tests multi-user scenarios:

1. Shared spreadsheet setup
2. Concurrent-style updates
3. Collaborative editing history
4. Data validation across users

```typescript
describeE2E('E2E: Collaboration Workflow', () => {
  it('should handle concurrent-style updates', async () => {
    // Simulate 3 users updating different rows
    await orchestrator.executeStep({
      name: 'User 1: Increment counter A',
      tool: 'sheets_data',
      action: 'write',
      args: { spreadsheetId, range: 'Data!B2', values: [['1']] },
    });

    await orchestrator.executeStep({
      name: 'User 2: Increment counter B',
      tool: 'sheets_data',
      action: 'write',
      args: { spreadsheetId, range: 'Data!B3', values: [['1']] },
    });

    // Verify all updates persisted
    const context = orchestrator.getContext();
    expect(context.history.every((h) => h.success)).toBe(true);
  });
});
```

### Running E2E Workflow Tests

```bash
# Run all E2E workflow tests
npm test tests/e2e/workflows/

# Run specific workflow
npm test tests/e2e/workflows/analysis-workflow.test.ts

# Run with live API (requires credentials)
TEST_REAL_API=true npm test tests/e2e/workflows/

# Skip E2E tests if no credentials
npm test  # Workflows auto-skip via describeE2E()
```

### Workflow Test Features

1. **Automatic Cleanup**: Test spreadsheets automatically deleted after each test
2. **History Tracking**: All operations tracked with timestamps and success status
3. **Validation Hooks**: Optional validation functions per step
4. **Error Recovery**: Failed steps tracked, allows recovery testing
5. **Context Preservation**: Workflow context available for assertions

### Test Data Generation

```typescript
// Generate test data for workflow tests
function generateTestData(rows: number, cols: number): unknown[][] {
  const data: unknown[][] = [];

  // Header row
  const headers = Array.from({ length: cols }, (_, i) => `Column ${String.fromCharCode(65 + i)}`);
  data.push(headers);

  // Data rows
  for (let row = 1; row <= rows; row++) {
    const rowData: unknown[] = [];
    for (let col = 0; col < cols; col++) {
      if (col === 0) {
        rowData.push(`Item ${row}`);
      } else if (col === 1) {
        rowData.push(Math.floor(Math.random() * 1000));
      } else {
        rowData.push(`Value ${row}-${col}`);
      }
    }
    data.push(rowData);
  }

  return data;
}
```

### Best Practices

1. **Use describeE2E()**: Automatically skips tests if credentials not available
2. **Meaningful step names**: Each step should clearly describe what it does
3. **Add validation**: Use validate callback for immediate assertions
4. **Check history**: Verify workflow completed successfully via context.history
5. **Timeout generously**: E2E tests need longer timeouts (30-120s)
6. **Clean up always**: Use afterEach() to ensure cleanup runs

---

## Mocking Patterns

### Google API Mock

```typescript
// tests/mocks/google-api.ts
import { vi } from 'vitest';
import type { sheets_v4 } from 'googleapis';

export function mockSheetsApi(): {
  spreadsheets: {
    get: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    batchUpdate: ReturnType<typeof vi.fn>;
    values: {
      get: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
      append: ReturnType<typeof vi.fn>;
      batchGet: ReturnType<typeof vi.fn>;
      batchUpdate: ReturnType<typeof vi.fn>;
      clear: ReturnType<typeof vi.fn>;
    };
  };
} {
  return {
    spreadsheets: {
      get: vi.fn(),
      create: vi.fn(),
      batchUpdate: vi.fn(),
      values: {
        get: vi.fn(),
        update: vi.fn(),
        append: vi.fn(),
        batchGet: vi.fn(),
        batchUpdate: vi.fn(),
        clear: vi.fn(),
      },
    },
  };
}

// Preset responses
export const mockResponses = {
  spreadsheet: {
    basic: {
      spreadsheetId: 'test-spreadsheet-id',
      properties: { title: 'Test Spreadsheet' },
      sheets: [
        {
          properties: {
            sheetId: 0,
            title: 'Sheet1',
            gridProperties: { rowCount: 1000, columnCount: 26 },
          },
        },
      ],
    },
  },
  values: {
    simple: {
      range: 'Sheet1!A1:B2',
      majorDimension: 'ROWS',
      values: [
        ['A1', 'B1'],
        ['A2', 'B2'],
      ],
    },
    empty: {
      range: 'Sheet1!A1:B2',
      majorDimension: 'ROWS',
    },
  },
  errors: {
    notFound: {
      code: 404,
      message: 'Requested entity was not found.',
      errors: [{ domain: 'global', reason: 'notFound' }],
    },
    forbidden: {
      code: 403,
      message: 'The caller does not have permission',
      errors: [{ domain: 'global', reason: 'forbidden' }],
    },
    rateLimited: {
      code: 429,
      message: 'Rate Limit Exceeded',
      errors: [{ domain: 'usageLimits', reason: 'rateLimitExceeded' }],
    },
  },
};
```

### MCP Client Mock

```typescript
// tests/mocks/mcp-client.ts
import { vi } from 'vitest';
import type { RequestHandlerExtra } from '@modelcontextprotocol/server';

export function createMockExtra(): RequestHandlerExtra<any, any> {
  return {
    signal: new AbortController().signal,
    sendNotification: vi.fn(),
    sendRequest: vi.fn(),
    sendProgress: vi.fn(),
  };
}

export function createMockTaskStore() {
  return {
    createTask: vi.fn().mockResolvedValue({ taskId: 'task-123', status: 'working' }),
    updateTask: vi.fn(),
    completeTask: vi.fn(),
    failTask: vi.fn(),
    getTask: vi.fn(),
  };
}
```

---

## Test Fixtures

### Sample Spreadsheet Data

```typescript
// tests/fixtures/spreadsheets/index.ts
export const fixtures = {
  // Simple data
  simple: {
    headers: ['Name', 'Age', 'City'],
    rows: [
      ['Alice', 30, 'NYC'],
      ['Bob', 25, 'LA'],
      ['Charlie', 35, 'Chicago'],
    ],
  },

  // Financial data
  financial: {
    headers: ['Date', 'Description', 'Amount', 'Category'],
    rows: [
      ['2024-01-01', 'Salary', 5000, 'Income'],
      ['2024-01-02', 'Rent', -1500, 'Housing'],
      ['2024-01-03', 'Groceries', -200, 'Food'],
    ],
  },

  // With formulas
  withFormulas: {
    data: [
      ['Product', 'Price', 'Qty', 'Total'],
      ['Widget', 10, 5, '=B2*C2'],
      ['Gadget', 25, 3, '=B3*C3'],
      ['Total', '', '', '=SUM(D2:D3)'],
    ],
  },

  // Large dataset generator
  generateLarge: (rows: number, cols: number) => {
    return Array.from({ length: rows }, (_, i) =>
      Array.from({ length: cols }, (_, j) => `R${i + 1}C${j + 1}`)
    );
  },
};
```

---

## Coverage Requirements

### Vitest Configuration

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', 'tests/', 'dist/', '*.config.*'],
      thresholds: {
        global: {
          statements: 80,
          branches: 75,
          functions: 80,
          lines: 80,
        },
        // Stricter for core modules
        'src/schemas/': {
          statements: 90,
          branches: 85,
        },
        'src/handlers/': {
          statements: 85,
          branches: 80,
        },
      },
    },
  },
});
```

### Coverage Scripts

```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "test:unit": "vitest run tests/unit",
    "test:integration": "vitest run tests/integration",
    "test:property": "vitest run tests/property",
    "test:e2e": "vitest run tests/e2e"
  }
}
```

---

## CI Integration

```yaml
# .github/workflows/test.yml
name: Test

on: [push, pull_request]

jobs:
  unit-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm run test:unit -- --coverage
      - uses: codecov/codecov-action@v4
        with:
          files: ./coverage/coverage-final.json

  integration-tests:
    runs-on: ubuntu-latest
    needs: unit-tests
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm run build
      - run: npm run test:integration

  property-tests:
    runs-on: ubuntu-latest
    needs: unit-tests
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm run test:property
```

---

_This guide provides patterns for comprehensive testing of MCP servers with Google Sheets integration._
