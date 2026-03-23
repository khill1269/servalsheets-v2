---
title: 'ServalSheets: Google Sheets API v4 & MCP Protocol Reference'
category: general
last_updated: 2026-01-31
description: Comprehensive reference for Google Sheets API v4 and MCP protocol integration
version: 1.6.0
tags: [api, mcp, sheets]
---

# ServalSheets: Google Sheets API v4 & MCP Protocol Reference

**Version**: 1.6.0
**MCP Protocol**: 2025-11-25
**Last Updated**: 2026-01-31

This document provides the authoritative reference for how ServalSheets integrates with Google Sheets API v4 and implements the MCP protocol, based on comprehensive codebase analysis.

---

## Table of Contents

1. [Google Sheets API v4 Integration](#google-sheets-api-v4-integration)
2. [MCP Protocol Implementation](#mcp-protocol-implementation)
3. [Schema Structure Requirements](#schema-structure-requirements)
4. [Request/Response Patterns](#requestresponse-patterns)
5. [Common Pitfalls & Solutions](#common-pitfalls--solutions)
6. [Validation Checklist](#validation-checklist)
7. [Testing Tools](#testing-tools)

---

## Google Sheets API v4 Integration

### Request Construction Pattern

ServalSheets uses a **three-layer architecture** for API requests:

#### Layer 1: RequestBuilder (Type-Safe Factory)

**File**: `src/core/request-builder.ts`

```typescript
// Example: Adding a named range
static addNamedRange(
  options: BaseRequestOptions & {
    namedRange: sheets_v4.Schema$NamedRange;
  }
): WrappedRequest {
  return {
    request: {
      addNamedRange: {
        namedRange: options.namedRange,
      },
    },
    metadata: {
      sourceTool: options.sourceTool,
      sourceAction: options.sourceAction,
      destructive: false,
      highRisk: false,
      // ...
    },
  };
}
```

**✅ DO:**

- Use static factory methods from `RequestBuilder`
- Return `WrappedRequest` with both request and metadata
- Use `sheets_v4.Schema$*` types from googleapis

**❌ DON'T:**

- Manually construct request objects
- Use JSON.stringify in request building
- Create custom type definitions

#### Layer 2: BatchCompiler (Grouping & Validation)

**File**: `src/core/batch-compiler.ts`

```typescript
// Validation before execution
const payloadSize = JSON.stringify(requestPayload).length;
const MAX_PAYLOAD_SIZE = 9_000_000;  // 9MB (1MB buffer)

if (payloadSize > MAX_PAYLOAD_SIZE) {
  return { error: { code: 'PAYLOAD_TOO_LARGE', ... } };
}

// Execute batchUpdate
const response = await sheetsApi.spreadsheets.batchUpdate({
  spreadsheetId: batch.spreadsheetId,
  requestBody: {
    requests: batch.requests.map(wr => wr.request), // Extract raw requests
  },
});
```

**Key Requirements:**

- ✅ 9MB payload limit enforced (MAX_PAYLOAD_SIZE)
- ✅ Groups requests by spreadsheetId
- ✅ Validates before execution
- ✅ No JSON.stringify in actual API call (only for size check)

#### Layer 3: Handler Execution (Direct API Calls)

**File**: `src/handlers/advanced.ts` (example)

```typescript
const response = await this.sheetsApi.spreadsheets.batchUpdate({
  spreadsheetId: req.spreadsheetId!,
  requestBody: {
    requests: [
      {
        addNamedRange: {
          namedRange: {
            name: req.name!,
            range: toGridRange(gridRange),
          },
        },
      },
    ],
  },
});
```

**✅ DO:**

- Pass `requestBody` as direct object
- Use helper functions (`toGridRange`, `parseRange`)
- Extract response metadata immediately

**❌ DON'T:**

- JSON.stringify the requestBody
- Construct GridRange objects manually
- Skip response parsing

---

### Response Handling Pattern

#### Response Structure

**File**: `src/core/response-parser.ts`

Google Sheets API v4 batchUpdate responses have this structure:

```typescript
{
  spreadsheetId: string;
  replies: [
    { addSheet: { properties: {...} } },        // With response data
    { findReplace: { occurrencesChanged: 42 } }, // With response data
    {},                                          // Without response data (common!)
  ];
  updatedSpreadsheet?: { ... }  // Only if fields mask includes it
}
```

#### Operations WITH Response Data

These return specific response objects:

- `addSheet` → `AddSheetResponse` (sheetId, gridProperties)
- `duplicateSheet` → `DuplicateSheetResponse`
- `findReplace` → `FindReplaceResponse` (occurrencesChanged, rowsChanged)
- `trimWhitespace` → `TrimWhitespaceResponse`
- `addNamedRange`, `addFilterView`, `addChart`, `addSlicer`
- Conditional format rules, developer metadata, banding

#### Operations WITHOUT Response Data

These return empty objects `{}`:

- `updateCells`, `appendCells`
- `insertDimension`, `deleteDimension`
- `updateSheetProperties`, `updateDimensionProperties`
- `mergeCells`, `unmergeCells`
- `copyPaste`, `cutPaste`
- `setDataValidation`, `deleteSheet`
- **Most operations** fall into this category

#### Response Parser Implementation

**File**: `src/core/response-parser.ts:88-107`

```typescript
static parseBatchUpdateResponse(
  response: sheets_v4.Schema$BatchUpdateSpreadsheetResponse
): ParsedResponseMetadata {
  const replies = response.replies ?? [];
  const parsedReplies = replies.map((reply, index) =>
    this.parseReply(reply, index)
  );

  return {
    spreadsheetId: response.spreadsheetId ?? '',
    totalCellsAffected: sum(parsedReplies.map(r => r.cellsAffected)),
    totalRowsAffected: sum(parsedReplies.map(r => r.rowsAffected)),
    totalColumnsAffected: sum(parsedReplies.map(r => r.columnsAffected)),
    replies: parsedReplies,
    summary: this.generateSummary(parsedReplies),
  };
}
```

**Phase 3 Optimization**: This eliminates the compensatory diff pattern:

- **OLD**: 3 API calls (before-capture → mutation → after-capture)
- **NEW**: 1 API call (mutation → parse response metadata)
- **Savings**: 66% reduction in API calls

---

### Error Handling Pattern

**File**: `src/core/batch-compiler.ts:829-890`

Google Sheets API errors are mapped to structured error codes:

```typescript
// Rate limit (429)
{
  code: 'RATE_LIMITED',
  message: 'API rate limit exceeded. Rate limiter automatically throttled for 60 seconds.',
  retryable: true,
  retryAfterMs: 60000
}

// Permission denied (403)
{
  code: 'PERMISSION_DENIED',
  message: 'The user does not have permission to access the spreadsheet',
  retryable: false
}

// Not found (404)
{
  code: 'SPREADSHEET_NOT_FOUND',
  message: 'Spreadsheet not found or has been deleted',
  retryable: false
}

// Quota exceeded
{
  code: 'QUOTA_EXCEEDED',
  message: 'Google Sheets API quota exceeded',
  retryable: true,
  retryAfterMs: 3600000
}

// Payload too large
{
  code: 'PAYLOAD_TOO_LARGE',
  message: 'Request payload (X.XXmb) exceeds Google's 9MB limit',
  retryable: false
}
```

**✅ DO:**

- Use structured error codes from `ErrorCode` enum
- Set `retryable` flag appropriately
- Provide `retryAfterMs` for rate limits
- Log all errors with context

**❌ DON'T:**

- Return generic "Error" objects
- Silent fallbacks (return `{}` without logging)
- Skip the retryable flag

---

## MCP Protocol Implementation

### Current State (January 2026)

**Validation Results**: 17 schema structure errors found

**Issue**: Schemas are currently **direct discriminated unions**, but MCP best practice requires **wrapped structure**.

#### Current Implementation (INCORRECT)

**File**: `src/schemas/auth.ts:34-39`

```typescript
// ❌ CURRENT (Direct discriminated union)
export const SheetsAuthInputSchema = z.discriminatedUnion('action', [
  StatusActionSchema,
  LoginActionSchema,
  CallbackActionSchema,
  LogoutActionSchema,
]);
```

**Problem**: When handlers receive input, they expect:

```typescript
input.action; // Direct access
```

But MCP protocol expects:

```typescript
input.request.action; // Wrapped access
```

#### Required Implementation (CORRECT)

**File**: Based on MCP 2025-11-25 specification

```typescript
// ✅ CORRECT (Wrapped in request envelope)
export const SheetsAuthInputSchema = z.object({
  request: z.discriminatedUnion('action', [
    StatusActionSchema,
    LoginActionSchema,
    CallbackActionSchema,
    LogoutActionSchema,
  ]),
});

// Output schema (discriminated on success)
export const SheetsAuthOutputSchema = z.object({
  response: z.discriminatedUnion('success', [
    z.object({
      success: z.literal(true),
      action: z.string(),
      // ... success fields
    }),
    z.object({
      success: z.literal(false),
      error: ErrorDetailSchema,
    }),
  ]),
});
```

**Handler Update Required**:

```typescript
// Current (incorrect)
async handle(input: SheetsAuthInput): Promise<SheetsAuthOutput> {
  switch (input.action) { ... }
}

// Required (correct)
async handle(input: SheetsAuthInput): Promise<SheetsAuthOutput> {
  const req = input.request; // Extract request envelope
  switch (req.action) { ... }
}
```

---

### MCP Response Format

**File**: `src/mcp/registration/tool-handlers.ts:109-150`

```typescript
function buildToolResponse(result: unknown): CallToolResult {
  // Extract or wrap response
  let structuredContent: Record<string, unknown>;

  if ('response' in result) {
    structuredContent = result as Record<string, unknown>;
  } else if ('success' in result) {
    structuredContent = { response: result };
  } else {
    // Invalid response shape
    structuredContent = {
      response: {
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Invalid response shape',
          retryable: false,
        },
      },
    };
  }

  // MCP 2025-11-25 compliant format
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(structuredContent, null, 2),
      },
    ],
    structuredContent: structuredContent,
    isError: isErrorResponse ? true : undefined,
  };
}
```

**Requirements**:

- ✅ `content` array with text block containing JSON string
- ✅ `structuredContent` matching the outputSchema
- ✅ `isError: true` only on errors (undefined on success)

---

### Schema Registration Pattern

**File**: `src/server.ts:254-360`

```typescript
private registerTools(): void {
  for (const tool of TOOL_DEFINITIONS) {
    const inputSchemaForRegistration = prepareSchemaForRegistration(
      tool.inputSchema
    ) as unknown as AnySchema;

    // CRITICAL: Keep Zod schema as-is, DO NOT convert to JSON Schema
    // The SDK uses safeParseAsync() at runtime (requires Zod)
    // JSON Schema conversion happens internally for tools/list

    this._server.registerTool(tool.name, {
      title: tool.annotations.title,
      description: tool.description,
      inputSchema: inputSchemaForRegistration, // Native Zod schema
      outputSchema: outputSchemaForRegistration, // Native Zod schema
      annotations: tool.annotations,
    }, async (args, extra) => {
      return this.handleToolCall(tool.name, args, extra);
    });
  }
}
```

**✅ DO:**

- Keep Zod schemas as-is for registration
- Let SDK handle JSON Schema conversion
- Use `prepareSchemaForRegistration()` wrapper

**❌ DON'T:**

- Manually convert to JSON Schema before registration
- Pass JSON Schema objects (causes "safeParseAsync is not a function")

---

## Schema Structure Requirements

### Input Schema Pattern (ALL 17 Tools)

```typescript
export const ToolNameInputSchema = z.object({
  request: z.discriminatedUnion('action', [
    // Action 1
    z.object({
      action: z.literal('action_name'),
      // Required fields for this action
      field1: z.string(),
      // Optional fields
      field2: z.boolean().optional(),
    }),
    // Action 2
    z.object({
      action: z.literal('another_action'),
      // ...
    }),
  ]),
});

export type ToolNameInput = z.infer<typeof ToolNameInputSchema>;
```

### Output Schema Pattern (ALL 17 Tools)

```typescript
export const ToolNameOutputSchema = z.object({
  response: z.discriminatedUnion('success', [
    // Success response
    z.object({
      success: z.literal(true),
      action: z.string(),
      // Action-specific success fields
      data: z.object({ ... }),
    }),
    // Error response
    z.object({
      success: z.literal(false),
      error: ErrorDetailSchema, // { code, message, retryable }
    })
  ])
});

export type ToolNameOutput = z.infer<typeof ToolNameOutputSchema>;
```

### ErrorDetailSchema (Standard Across All Tools)

```typescript
const ErrorDetailSchema = z.object({
  code: z.enum([
    'SPREADSHEET_NOT_FOUND',
    'PERMISSION_DENIED',
    'RATE_LIMITED',
    'QUOTA_EXCEEDED',
    'INVALID_PARAMS',
    'INTERNAL_ERROR',
    // ... 40+ error codes total
  ]),
  message: z.string(),
  retryable: z.boolean(),
  retryAfterMs: z.number().optional(),
  resolution: z.string().optional(),
  resolutionSteps: z.array(z.string()).optional(),
});
```

---

## Request/Response Patterns

### Example 1: Simple Read Operation

**Input**:

```json
{
  "request": {
    "action": "read",
    "spreadsheetId": "1BxiMVs0XRA5nFMdKUqnKDh9...",
    "range": "Sheet1!A1:B10"
  }
}
```

**Google API Call**:

```typescript
await sheetsApi.spreadsheets.values.get({
  spreadsheetId: '1BxiMVs0XRA5nFMdKUqnKDh9...',
  range: 'Sheet1!A1:B10',
});
```

**Output (Success)**:

```json
{
  "response": {
    "success": true,
    "action": "read",
    "range": "Sheet1!A1:B10",
    "values": [
      ["Name", "Age"],
      ["Alice", "30"]
      // ...
    ],
    "rowCount": 10,
    "columnCount": 2
  }
}
```

**Output (Error)**:

```json
{
  "response": {
    "success": false,
    "error": {
      "code": "PERMISSION_DENIED",
      "message": "The user does not have permission to access the spreadsheet",
      "retryable": false
    }
  }
}
```

### Example 2: Mutation with Response Metadata

**Input**:

```json
{
  "request": {
    "action": "find_replace",
    "spreadsheetId": "1BxiMVs0XRA5nFMdKUqnKDh9...",
    "find": "old_value",
    "replacement": "new_value",
    "matchCase": true
  }
}
```

**Google API Call**:

```typescript
await sheetsApi.spreadsheets.batchUpdate({
  spreadsheetId: '1BxiMVs0XRA5nFMdKUqnKDh9...',
  requestBody: {
    requests: [
      {
        findReplace: {
          find: 'old_value',
          replacement: 'new_value',
          matchCase: true,
          allSheets: true,
        },
      },
    ],
  },
});
```

**Google API Response**:

```typescript
{
  spreadsheetId: '1BxiMVs0XRA5nFMdKUqnKDh9...',
  replies: [{
    findReplace: {
      occurrencesChanged: 42,
      rowsChanged: 15,
      sheetsChanged: 3,
      valuesChanged: 42,
      formulasChanged: 0
    }
  }]
}
```

**Parsed Output**:

```json
{
  "response": {
    "success": true,
    "action": "find_replace",
    "occurrencesChanged": 42,
    "rowsChanged": 15,
    "sheetsChanged": 3,
    "summary": "Find/Replace: 42 occurrence(s) in 15 rows across 3 sheets"
  }
}
```

---

## Common Pitfalls & Solutions

### Pitfall 1: Manual GridRange Construction

**❌ WRONG**:

```typescript
const gridRange = {
  sheetId: 123,
  startRowIndex: 0,
  endRowIndex: 10,
  startColumnIndex: 0,
  endColumnIndex: 5,
};
```

**✅ CORRECT**:

```typescript
const gridRange = await this.toGridRange(spreadsheetId, 'Sheet1!A1:E10');
// Or
const gridRange = parseRange('Sheet1!A1:E10', sheetId);
```

### Pitfall 2: RGB Color Values (0-255 vs 0-1)

**❌ WRONG**:

```typescript
backgroundColor: {
  red: 255,    // Google API expects 0-1, not 0-255!
  green: 128,
  blue: 0,
}
```

**✅ CORRECT**:

```typescript
backgroundColor: {
  red: 1.0,    // 255/255 = 1.0
  green: 0.5,  // 128/255 ≈ 0.5
  blue: 0.0,   // 0/255 = 0.0
}

// Or use helper
backgroundColor: normalizeRgb(255, 128, 0)
```

### Pitfall 3: Missing Payload Size Check

**❌ WRONG**:

```typescript
await sheetsApi.spreadsheets.batchUpdate({
  spreadsheetId,
  requestBody: { requests }, // No size check!
});
```

**✅ CORRECT**:

```typescript
const payloadSize = JSON.stringify({ requests }).length;
if (payloadSize > 9_000_000) {
  throw new PayloadTooLargeError(...);
}

await sheetsApi.spreadsheets.batchUpdate({
  spreadsheetId,
  requestBody: { requests }
});
```

### Pitfall 4: Silent Fallbacks

**❌ WRONG**:

```typescript
async handle(input) {
  if (!input.spreadsheetId) {
    return {}; // Silent failure!
  }
}
```

**✅ CORRECT**:

```typescript
async handle(input) {
  if (!input.spreadsheetId) {
    return {
      response: {
        success: false,
        error: {
          code: 'INVALID_PARAMS',
          message: 'spreadsheetId is required',
          retryable: false,
        }
      }
    };
  }
}
```

### Pitfall 5: Not Wrapping Schema Requests

**❌ CURRENT (NEEDS FIX)**:

```typescript
export const ToolInputSchema = z.discriminatedUnion('action', [...]);
```

**✅ REQUIRED**:

```typescript
export const ToolInputSchema = z.object({
  request: z.discriminatedUnion('action', [...])
});
```

---

## Validation Checklist

Use `npm run validate:compliance` to check all 25 tools for:

### Google Sheets API v4 Compliance

- [ ] No JSON.stringify in request construction
- [ ] Payload size validation (9MB limit)
- [ ] Response parser integrated (Phase 3)
- [ ] Proper error code mapping (40+ codes)
- [ ] GridRange helpers used (not manual construction)
- [ ] RGB color normalization (0-1 range)
- [ ] Field masks specified where needed

### MCP Protocol Compliance

- [ ] Input schemas wrapped in `{ request: ... }`
- [ ] Output schemas wrapped in `{ response: ... }`
- [ ] Response discriminates on `success` field
- [ ] Request discriminates on `action` field
- [ ] Zod schemas kept native (not converted to JSON Schema)
- [ ] Handler extracts `input.request` envelope
- [ ] MCP response format includes `content` + `structuredContent`
- [ ] `isError` flag set correctly

### Handler Implementation

- [ ] Switch-case routing by action
- [ ] Structured error handling (no silent returns)
- [ ] Google API calls present (where applicable)
- [ ] Request builder usage (not manual requests)
- [ ] Response parser usage (Phase 3 pattern)

---

## Testing Tools

### 1. Compliance Validator

```bash
npm run validate:compliance
```

Checks all 25 tools and 402 actions for:

- Schema structure compliance
- Google API pattern adherence
- Handler implementation quality
- Common pitfalls

### 2. Metadata Drift Check

```bash
npm run check:drift
```

Verifies synchronization between:

- `package.json` tool/action counts
- `src/schemas/index.ts` constants
- `src/schemas/annotations.ts` per-tool breakdown
- `src/mcp/completions.ts` action lists
- `server.json` metadata

### 3. Silent Fallback Check

```bash
npm run check:silent-fallbacks
```

Finds instances of `return {}` or `return undefined` without:

- Proper error logging
- `// OK: Explicit empty` comment

### 4. Full Verification Suite

```bash
npm run verify
```

Runs all checks:

- TypeScript compilation (strict mode)
- ESLint (code quality)
- Vitest (1700+ tests)
- Metadata drift
- Placeholder detection
- Silent fallback detection
- Build validation

---

## Quick Reference: File Locations

| Component            | File                                       | Purpose                                   |
| -------------------- | ------------------------------------------ | ----------------------------------------- |
| Request builders     | `src/core/request-builder.ts`              | Type-safe Google API request construction |
| Response parser      | `src/core/response-parser.ts`              | Extract metadata from API responses       |
| Batch compiler       | `src/core/batch-compiler.ts`               | Group requests, validate payload, execute |
| Tool definitions     | `src/mcp/registration/tool-definitions.ts` | MCP tool registration                     |
| Tool handlers        | `src/mcp/registration/tool-handlers.ts`    | Handler routing & response building       |
| Schema validation    | `src/utils/schema-compat.ts`               | Zod ↔ JSON Schema compatibility           |
| Compliance validator | `scripts/validate-api-mcp-compliance.ts`   | Automated validation script               |

| Tool Schema                  | Handler                       | Actions |
| ---------------------------- | ----------------------------- | ------- |
| `src/schemas/auth.ts`        | `src/handlers/auth.ts`        | 4       |
| `src/schemas/core.ts`        | `src/handlers/core.ts`        | 15      |
| `src/schemas/data.ts`        | `src/handlers/data.ts`        | 20      |
| `src/schemas/format.ts`      | `src/handlers/format.ts`      | 18      |
| `src/schemas/dimensions.ts`  | `src/handlers/dimensions.ts`  | 39      |
| `src/schemas/visualize.ts`   | `src/handlers/visualize.ts`   | 16      |
| `src/schemas/collaborate.ts` | `src/handlers/collaborate.ts` | 28      |
| `src/schemas/advanced.ts`    | `src/handlers/advanced.ts`    | 19      |
| `src/schemas/transaction.ts` | `src/handlers/transaction.ts` | 6       |
| `src/schemas/quality.ts`     | `src/handlers/quality.ts`     | 4       |
| `src/schemas/history.ts`     | `src/handlers/history.ts`     | 7       |
| `src/schemas/confirm.ts`     | `src/handlers/confirm.ts`     | 2       |
| `src/schemas/analyze.ts`     | `src/handlers/analyze.ts`     | 11      |
| `src/schemas/fix.ts`         | `src/handlers/fix.ts`         | 1       |
| `src/schemas/composite.ts`   | `src/handlers/composite.ts`   | 4       |
| `src/schemas/session.ts`     | `src/handlers/session.ts`     | 13      |

**Total**: 25 tools, 402 actions

---

## Summary

This reference provides the complete pattern for implementing Google Sheets API v4 integration with MCP protocol compliance. Use the validation tools to catch issues early and follow the patterns shown here for consistent, reliable implementation across all 402 actions.

**Next Steps**:

1. Run `npm run validate:compliance` to find current issues
2. Fix schema structure (wrap in request/response envelopes)
3. Update handlers to extract request envelope
4. Re-run validation until all checks pass
5. Add contract tests for schema guarantees
