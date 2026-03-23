---
title: Adding a Handler to ServalSheets
category: guide
last_updated: 2026-02-17
description: 'Step-by-step tutorial for adding a new MCP tool handler'
version: 1.0
tags: [tutorial, handler, tool, development]
---

# Adding a Handler to ServalSheets

**Tutorial:** Create a new MCP tool with complete handler implementation

**Time:** 60-90 minutes
**Difficulty:** Intermediate
**Prerequisites:** Completed [ONBOARDING.md](./ONBOARDING.md)

---

## Table of Contents

1. [Overview](#overview)
2. [Step 1: Define the Schema](#step-1-define-the-schema)
3. [Step 2: Create the Handler](#step-2-create-the-handler)
4. [Step 3: Register the Tool](#step-3-register-the-tool)
5. [Step 4: Generate Metadata](#step-4-generate-metadata)
6. [Step 5: Write Tests](#step-5-write-tests)
7. [Step 6: Verify & Commit](#step-6-verify--commit)
8. [Complete Example](#complete-example)
9. [Troubleshooting](#troubleshooting)

---

## Overview

### What You'll Build

We'll create a new `sheets_export` tool that exports spreadsheets in various formats (CSV, PDF, XLSX).

**New tool will have:**

- 3 actions: `export_as_csv`, `export_as_pdf`, `export_as_xlsx`
- Type-safe Zod schema
- Handler with Google Drive API integration
- Comprehensive tests
- Auto-generated metadata

### File Checklist

By the end, you'll have created/modified:

- ✅ `src/schemas/export.ts` (new)
- ✅ `src/handlers/export.ts` (new)
- ✅ `tests/handlers/export.test.ts` (new)
- ✅ `src/mcp/registration/tool-definitions.ts` (modified)
- ✅ 5 generated files (via `npm run schema:commit`)

---

## Step 1: Define the Schema

Schemas are the **source of truth** in ServalSheets.

### Create Schema File

```bash
# Create new schema file
touch src/schemas/export.ts
```

### Write Schema Definition

```typescript
// src/schemas/export.ts
import { z } from 'zod';

/**
 * Export format options
 */
export const ExportFormatSchema = z.enum(['csv', 'pdf', 'xlsx']);

/**
 * Sheets Export Tool Input Schema
 *
 * Supports exporting spreadsheets in various formats
 */
export const SheetsExportInputSchema = z.discriminatedUnion('action', [
  // Action 1: Export as CSV
  z.object({
    /** Action identifier */
    action: z.literal('export_as_csv'),
    /** Spreadsheet ID to export */
    spreadsheetId: z.string().describe('Google Sheets spreadsheet ID'),
    /** Optional sheet name (exports all if omitted) */
    sheetName: z.string().optional().describe('Specific sheet to export'),
    /** Include header row */
    includeHeaders: z.boolean().optional().default(true),
  }),

  // Action 2: Export as PDF
  z.object({
    /** Action identifier */
    action: z.literal('export_as_pdf'),
    /** Spreadsheet ID to export */
    spreadsheetId: z.string().describe('Google Sheets spreadsheet ID'),
    /** Optional sheet name (exports all if omitted) */
    sheetName: z.string().optional().describe('Specific sheet to export'),
    /** PDF orientation */
    orientation: z.enum(['portrait', 'landscape']).optional().default('portrait'),
  }),

  // Action 3: Export as XLSX
  z.object({
    /** Action identifier */
    action: z.literal('export_as_xlsx'),
    /** Spreadsheet ID to export */
    spreadsheetId: z.string().describe('Google Sheets spreadsheet ID'),
    /** Include formatting */
    includeFormatting: z.boolean().optional().default(true),
  }),
]);

/**
 * Sheets Export Tool Output Schema
 */
export const SheetsExportOutputSchema = z.object({
  response: z.discriminatedUnion('success', [
    // Success response
    z.object({
      success: z.literal(true),
      action: z.string(),
      /** Download URL for exported file */
      downloadUrl: z.string(),
      /** File size in bytes */
      fileSize: z.number(),
      /** MIME type */
      mimeType: z.string(),
      /** Export format */
      format: ExportFormatSchema,
    }),
    // Error response
    z.object({
      success: z.literal(false),
      error: z.string(),
      code: z.string(),
    }),
  ]),
});

// Infer TypeScript types
export type SheetsExportInput = z.infer<typeof SheetsExportInputSchema>;
export type SheetsExportOutput = z.infer<typeof SheetsExportOutputSchema>;
export type ExportFormat = z.infer<typeof ExportFormatSchema>;

// Extract individual action types
type ExportAsCsvInput = Extract<SheetsExportInput, { action: 'export_as_csv' }>;
type ExportAsPdfInput = Extract<SheetsExportInput, { action: 'export_as_pdf' }>;
type ExportAsXlsxInput = Extract<SheetsExportInput, { action: 'export_as_xlsx' }>;
```

### Schema Best Practices

✅ **Do:**

- Use `z.discriminatedUnion('action', [...])` for actions
- Add JSDoc comments with `/** */`
- Use `.describe()` for field descriptions
- Provide defaults with `.default()`
- Export types with `z.infer<typeof Schema>`

❌ **Don't:**

- Use manual TypeScript interfaces
- Forget the `action` discriminator
- Mix validation logic into schemas
- Hard-code values that might change

---

## Step 2: Create the Handler

Handlers contain the business logic for your tool.

### Create Handler File

```bash
touch src/handlers/export.ts
```

### Write Handler Implementation

```typescript
// src/handlers/export.ts
import { BaseHandler } from './base.js';
import type { HandlerContext } from './base.js';
import type { SheetsExportInput, SheetsExportOutput } from '../schemas/export.js';
import { createValidationError, createNotFoundError } from '../utils/error-factory.js';
import { unwrapRequest } from '../utils/request-helpers.js';

/**
 * Handler for sheets_export tool
 *
 * Exports spreadsheets in various formats (CSV, PDF, XLSX)
 */
export class ExportHandler extends BaseHandler<SheetsExportInput, SheetsExportOutput> {
  constructor(context: HandlerContext) {
    super(context);
  }

  /**
   * Execute export action
   */
  async executeAction(request: SheetsExportInput): Promise<SheetsExportOutput> {
    // Step 1: Unwrap legacy envelope
    const unwrapped = unwrapRequest(request);

    // Step 2: Extract discriminated union
    const { action, ...params } = unwrapped;

    // Step 3: Switch on action
    switch (action) {
      case 'export_as_csv':
        return this.handleExportAsCsv(params);
      case 'export_as_pdf':
        return this.handleExportAsPdf(params);
      case 'export_as_xlsx':
        return this.handleExportAsXlsx(params);
      default:
        throw createValidationError(`Unknown action: ${action}`);
    }
  }

  /**
   * Handle export_as_csv action
   */
  private async handleExportAsCsv(
    params: Omit<Extract<SheetsExportInput, { action: 'export_as_csv' }>, 'action'>
  ): Promise<SheetsExportOutput> {
    const { spreadsheetId, sheetName, includeHeaders = true } = params;

    // Verify spreadsheet exists
    const spreadsheet = await this.context.googleClient.sheets.spreadsheets.get({
      spreadsheetId,
    });

    if (!spreadsheet.data) {
      throw createNotFoundError('Spreadsheet not found', { spreadsheetId });
    }

    // Export using Google Drive API
    const exportUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv`;

    // If specific sheet requested, add gid parameter
    let finalUrl = exportUrl;
    if (sheetName) {
      const sheet = spreadsheet.data.sheets?.find((s) => s.properties?.title === sheetName);
      if (!sheet) {
        throw createNotFoundError('Sheet not found', { spreadsheetId, sheetName });
      }
      finalUrl += `&gid=${sheet.properties!.sheetId}`;
    }

    // For production, you'd download the file and get actual size
    // For this example, we'll return the URL
    return {
      response: {
        success: true,
        action: 'export_as_csv',
        downloadUrl: finalUrl,
        fileSize: 0, // Would be calculated from actual download
        mimeType: 'text/csv',
        format: 'csv',
      },
    };
  }

  /**
   * Handle export_as_pdf action
   */
  private async handleExportAsPdf(
    params: Omit<Extract<SheetsExportInput, { action: 'export_as_pdf' }>, 'action'>
  ): Promise<SheetsExportOutput> {
    const { spreadsheetId, sheetName, orientation = 'portrait' } = params;

    // Verify spreadsheet exists
    const spreadsheet = await this.context.googleClient.sheets.spreadsheets.get({
      spreadsheetId,
    });

    if (!spreadsheet.data) {
      throw createNotFoundError('Spreadsheet not found', { spreadsheetId });
    }

    // Build export URL with PDF parameters
    let exportUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=pdf&portrait=${orientation === 'portrait'}`;

    // Add sheet-specific parameters if needed
    if (sheetName) {
      const sheet = spreadsheet.data.sheets?.find((s) => s.properties?.title === sheetName);
      if (!sheet) {
        throw createNotFoundError('Sheet not found', { spreadsheetId, sheetName });
      }
      exportUrl += `&gid=${sheet.properties!.sheetId}`;
    }

    return {
      response: {
        success: true,
        action: 'export_as_pdf',
        downloadUrl: exportUrl,
        fileSize: 0,
        mimeType: 'application/pdf',
        format: 'pdf',
      },
    };
  }

  /**
   * Handle export_as_xlsx action
   */
  private async handleExportAsXlsx(
    params: Omit<Extract<SheetsExportInput, { action: 'export_as_xlsx' }>, 'action'>
  ): Promise<SheetsExportOutput> {
    const { spreadsheetId, includeFormatting = true } = params;

    // Verify spreadsheet exists
    const spreadsheet = await this.context.googleClient.sheets.spreadsheets.get({
      spreadsheetId,
    });

    if (!spreadsheet.data) {
      throw createNotFoundError('Spreadsheet not found', { spreadsheetId });
    }

    // Export as XLSX
    const exportUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=xlsx`;

    return {
      response: {
        success: true,
        action: 'export_as_xlsx',
        downloadUrl: exportUrl,
        fileSize: 0,
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        format: 'xlsx',
      },
    };
  }
}
```

### Handler Best Practices

✅ **Do:**

- Extend `BaseHandler<Input, Output>`
- Use `unwrapRequest()` for envelope handling
- Switch on `action` field
- Create private methods for each action
- Use error factory functions
- Add JSDoc comments

❌ **Don't:**

- Call `buildToolResponse()` (tool layer does this)
- Return MCP format directly
- Skip error handling
- Use `console.log` (use `logger` instead)

---

## Step 3: Register the Tool

Add your tool to the MCP registry.

### Update Tool Definitions

```typescript
// src/mcp/registration/tool-definitions.ts
import { SheetsExportInputSchema, SheetsExportOutputSchema } from '../schemas/export.js';

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  // ... existing tools ...

  // Add new tool at the end
  {
    name: 'sheets_export',
    description: 'Export Google Sheets in various formats (CSV, PDF, XLSX)',
    longDescription: `
Export spreadsheets or individual sheets in different formats:
- CSV: Comma-separated values for data analysis
- PDF: Portable document format for sharing
- XLSX: Excel format with full formatting

Supports custom export options like orientation, headers, and formatting.
    `.trim(),
    inputSchema: SheetsExportInputSchema,
    outputSchema: SheetsExportOutputSchema,
    category: 'export',
    annotations: {
      readOnly: false,
      requiresAuth: true,
      idempotent: true,
    },
  },
];
```

### Update Handler Factory

```typescript
// src/handlers/index.ts
import { ExportHandler } from './export.js';

export function createHandler(toolName: string, context: HandlerContext): BaseHandler<any, any> {
  switch (toolName) {
    // ... existing handlers ...
    case 'sheets_export':
      return new ExportHandler(context);
    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}
```

---

## Step 4: Generate Metadata

ONE command regenerates all metadata:

```bash
npm run schema:commit
```

This automatically:

1. Runs `gen:metadata`
2. Verifies with `check:drift`
3. Runs `typecheck`
4. Runs `test:fast`
5. Stages changed files with `git add`

**Output:**

```
📊 Analyzing 23 schema files...
  📝 export.ts → 3 actions [export_as_csv, export_as_pdf, export_as_xlsx]
  ...
✅ Total: 25 tools, 302 actions
✅ Updated src/schemas/index.ts constants
✅ Updated src/schemas/annotations.ts ACTION_COUNTS
✅ Updated src/mcp/completions.ts TOOL_ACTIONS
✅ Generated server.json
✅ Updated package.json description

✅ Drift check passed
✅ TypeScript compilation successful
✅ Fast tests passed (623/623)
✓ Schema changes ready to commit
```

---

## Step 5: Write Tests

### Create Test File

```bash
touch tests/handlers/export.test.ts
```

### Write Handler Tests

```typescript
// tests/handlers/export.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ExportHandler } from '../../src/handlers/export.js';
import type { HandlerContext } from '../../src/handlers/base.js';
import type { SheetsExportInput } from '../../src/schemas/export.js';

describe('ExportHandler', () => {
  let handler: ExportHandler;
  let mockContext: HandlerContext;

  beforeEach(() => {
    // Create mock context
    mockContext = {
      googleClient: {
        sheets: {
          spreadsheets: {
            get: vi.fn(),
          },
        },
      },
      logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
    } as any;

    handler = new ExportHandler(mockContext);
  });

  describe('export_as_csv', () => {
    it('should export spreadsheet as CSV', async () => {
      // Arrange
      const input: SheetsExportInput = {
        request: {
          action: 'export_as_csv',
          spreadsheetId: 'test-123',
          includeHeaders: true,
        },
      };

      mockContext.googleClient.sheets.spreadsheets.get.mockResolvedValue({
        data: {
          spreadsheetId: 'test-123',
          sheets: [{ properties: { title: 'Sheet1', sheetId: 0 } }],
        },
      });

      // Act
      const result = await handler.executeAction(input);

      // Assert
      expect(result.response.success).toBe(true);
      expect(result.response.action).toBe('export_as_csv');
      expect(result.response.format).toBe('csv');
      expect(result.response.downloadUrl).toContain('test-123');
      expect(result.response.mimeType).toBe('text/csv');
    });

    it('should export specific sheet as CSV', async () => {
      // Arrange
      const input: SheetsExportInput = {
        request: {
          action: 'export_as_csv',
          spreadsheetId: 'test-123',
          sheetName: 'Sheet2',
          includeHeaders: true,
        },
      };

      mockContext.googleClient.sheets.spreadsheets.get.mockResolvedValue({
        data: {
          spreadsheetId: 'test-123',
          sheets: [
            { properties: { title: 'Sheet1', sheetId: 0 } },
            { properties: { title: 'Sheet2', sheetId: 1 } },
          ],
        },
      });

      // Act
      const result = await handler.executeAction(input);

      // Assert
      expect(result.response.success).toBe(true);
      expect(result.response.downloadUrl).toContain('gid=1');
    });

    it('should throw NotFoundError for invalid spreadsheet', async () => {
      // Arrange
      const input: SheetsExportInput = {
        request: {
          action: 'export_as_csv',
          spreadsheetId: 'invalid',
          includeHeaders: true,
        },
      };

      mockContext.googleClient.sheets.spreadsheets.get.mockResolvedValue({
        data: null,
      });

      // Act & Assert
      await expect(handler.executeAction(input)).rejects.toThrow('Spreadsheet not found');
    });
  });

  describe('export_as_pdf', () => {
    it('should export spreadsheet as PDF with portrait orientation', async () => {
      // Arrange
      const input: SheetsExportInput = {
        request: {
          action: 'export_as_pdf',
          spreadsheetId: 'test-123',
          orientation: 'portrait',
        },
      };

      mockContext.googleClient.sheets.spreadsheets.get.mockResolvedValue({
        data: {
          spreadsheetId: 'test-123',
          sheets: [{ properties: { title: 'Sheet1', sheetId: 0 } }],
        },
      });

      // Act
      const result = await handler.executeAction(input);

      // Assert
      expect(result.response.success).toBe(true);
      expect(result.response.format).toBe('pdf');
      expect(result.response.mimeType).toBe('application/pdf');
      expect(result.response.downloadUrl).toContain('portrait=true');
    });

    it('should export spreadsheet as PDF with landscape orientation', async () => {
      // Arrange
      const input: SheetsExportInput = {
        request: {
          action: 'export_as_pdf',
          spreadsheetId: 'test-123',
          orientation: 'landscape',
        },
      };

      mockContext.googleClient.sheets.spreadsheets.get.mockResolvedValue({
        data: {
          spreadsheetId: 'test-123',
          sheets: [{ properties: { title: 'Sheet1', sheetId: 0 } }],
        },
      });

      // Act
      const result = await handler.executeAction(input);

      // Assert
      expect(result.response.downloadUrl).toContain('portrait=false');
    });
  });

  describe('export_as_xlsx', () => {
    it('should export spreadsheet as XLSX', async () => {
      // Arrange
      const input: SheetsExportInput = {
        request: {
          action: 'export_as_xlsx',
          spreadsheetId: 'test-123',
          includeFormatting: true,
        },
      };

      mockContext.googleClient.sheets.spreadsheets.get.mockResolvedValue({
        data: {
          spreadsheetId: 'test-123',
          sheets: [{ properties: { title: 'Sheet1', sheetId: 0 } }],
        },
      });

      // Act
      const result = await handler.executeAction(input);

      // Assert
      expect(result.response.success).toBe(true);
      expect(result.response.format).toBe('xlsx');
      expect(result.response.mimeType).toBe(
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
    });
  });

  describe('unknown action', () => {
    it('should throw ValidationError for unknown action', async () => {
      // Arrange
      const input = {
        request: {
          action: 'invalid_action',
          spreadsheetId: 'test-123',
        },
      } as any;

      // Act & Assert
      await expect(handler.executeAction(input)).rejects.toThrow('Unknown action');
    });
  });
});
```

### Run Tests

```bash
# Run just your tests
npm test tests/handlers/export.test.ts

# Output:
# ✓ tests/handlers/export.test.ts (8 tests passed)
#   ✓ ExportHandler
#     ✓ export_as_csv (3 tests)
#     ✓ export_as_pdf (2 tests)
#     ✓ export_as_xlsx (1 test)
#     ✓ unknown action (1 test)
```

---

## Step 6: Verify & Commit

### Run Full Verification

```bash
npm run verify
```

**Expected:**

```
✅ Drift check passed
✅ No placeholders found
✅ Doc action counts valid
✅ Type check passed (0 errors)
✅ Lint passed
✅ Format check passed
✅ Schema/handler alignment passed
✅ Fast tests passed (631/631)

✨ All verification checks passed!
```

### Commit Changes

```bash
# Stage all files
git add src/ tests/ docs/

# Commit with conventional commit message
git commit -m "feat(export): add sheets_export tool with CSV/PDF/XLSX export

- Add export schema with 3 actions
- Implement ExportHandler with Google Drive API
- Add comprehensive test coverage (8 tests)
- Update tool registry and metadata

Closes #XXX"

# Push to remote
git push origin feat/sheets-export
```

### Create Pull Request

```bash
# Using GitHub CLI
gh pr create --title "feat(export): add sheets_export tool" \
  --body "Adds new sheets_export tool with CSV/PDF/XLSX export capabilities"

# Or visit GitHub UI
# https://github.com/khill1269/servalsheets/compare
```

---

## Complete Example

### Files Created/Modified

```
Modified:
  src/mcp/registration/tool-definitions.ts
  src/handlers/index.ts
  src/schemas/index.ts (GENERATED)
  src/schemas/annotations.ts (GENERATED)
  src/mcp/completions.ts (GENERATED)
  server.json (GENERATED)
  package.json (GENERATED)

Created:
  src/schemas/export.ts
  src/handlers/export.ts
  tests/handlers/export.test.ts
```

### Total Lines of Code

- Schema: ~100 lines
- Handler: ~200 lines
- Tests: ~150 lines
- **Total:** ~450 lines

### Development Time

- Schema: 15 minutes
- Handler: 30 minutes
- Tests: 30 minutes
- Documentation: 15 minutes
- **Total:** 90 minutes

---

## Troubleshooting

### Issue: Metadata Drift Detected

```bash
❌ Metadata drift detected in 2 files
```

**Fix:**

```bash
npm run schema:commit
```

### Issue: Schema/Handler Alignment Failed

```bash
❌ sheets_export: 3 schema actions, 2 handler cases
Missing in handler: ['export_as_xlsx']
```

**Fix:** Add missing case to handler switch statement.

### Issue: TypeScript Errors

```bash
❌ Type 'X' is not assignable to type 'Y'
```

**Fix:** See [TYPESCRIPT_ERROR_GUIDE.md](../development/TYPESCRIPT_ERROR_GUIDE.md)

### Issue: Tests Failing

```bash
❌ Expected true but got false
```

**Fix:** Check mock setup - ensure Google API client is properly mocked.

---

## Next Steps

1. **Add more actions** - Follow [ADDING_AN_ACTION.md](./ADDING_AN_ACTION.md)
2. **Improve error handling** - Add retry logic, better error messages
3. **Add integration tests** - Test with real Google API
4. **Document in user guide** - Add to `docs/guides/`

---

**Congratulations!** You've added a complete handler to ServalSheets. 🎉

**Questions?** See [ONBOARDING.md](./ONBOARDING.md) or open a GitHub Discussion.

---

**Version:** 1.0
**Last Updated:** 2026-02-17
**Maintainers:** ServalSheets Core Team
