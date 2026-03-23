---
title: Implementation Guardrails for Tier 7 Enterprise Tools
category: development
last_updated: 2026-01-31
description: 'Purpose: Strict checklist to prevent coding errors and debugging cycles.'
version: 1.7.0
tags: [sheets]
---

# Implementation Guardrails for Tier 7 Enterprise Tools

**Purpose:** Strict checklist to prevent coding errors and debugging cycles.

**CRITICAL:** Claude MUST follow this checklist for EVERY new tool/handler/schema.

---

## Pre-Implementation Verification

Before writing ANY code, verify:

- [ ] Read the existing pattern files completely (not just snippets)
- [ ] Run `npm run verify` to ensure clean starting state
- [ ] Confirm exact export names needed in `src/schemas/index.ts`
- [ ] Confirm tool registration pattern in `src/mcp/registration/tool-definitions.ts`

---

## 1. Schema File Pattern (`src/schemas/{toolname}.ts`)

### 1.1 Required File Structure

```typescript
/**
 * Tool: sheets_{toolname}
 * {Description}
 *
 * MCP Protocol: 2025-11-25
 */

import { z } from 'zod';
import {
  SpreadsheetIdSchema,  // Only if needed
  ErrorDetailSchema,
  ResponseMetaSchema,
  MutationSummarySchema,  // Only if tool mutates data
  type ToolAnnotations,
} from './shared.js';

// ============================================================================
// ACTION SCHEMAS (one per action)
// ============================================================================

const Action1Schema = z.object({
  action: z.literal('action_name').describe('What this action does'),
  // Required params first
  requiredParam: z.string().describe('Description'),
  // Optional params after
  optionalParam: z.string().optional().describe('Description'),
});

const Action2Schema = z.object({
  action: z.literal('action2_name').describe('What this action does'),
  // ...
});

// ============================================================================
// INPUT SCHEMA (discriminated union wrapped in request)
// ============================================================================

const {ToolName}RequestSchema = z.discriminatedUnion('action', [
  Action1Schema,
  Action2Schema,
  // ... all action schemas
]);

export const Sheets{ToolName}InputSchema = z.object({
  request: {ToolName}RequestSchema,
});

// ============================================================================
// OUTPUT SCHEMA (response union)
// ============================================================================

const {ToolName}ResponseSchema = z.discriminatedUnion('success', [
  z.object({
    success: z.literal(true),
    action: z.string(),
    // Action-specific response fields
    data1: z.string().optional(),
    data2: z.number().optional(),
    // Standard fields
    dryRun: z.boolean().optional(),
    mutation: MutationSummarySchema.optional(),
    _meta: ResponseMetaSchema.optional(),
  }),
  z.object({
    success: z.literal(false),
    error: ErrorDetailSchema,
  }),
]);

export const Sheets{ToolName}OutputSchema = z.object({
  response: {ToolName}ResponseSchema,
});

// ============================================================================
// ANNOTATIONS
// ============================================================================

export const SHEETS_{TOOLNAME}_ANNOTATIONS: ToolAnnotations = {
  title: '{Tool Title}',
  readOnlyHint: false,       // true if tool never mutates
  destructiveHint: false,    // true if tool can delete/destroy
  idempotentHint: true,      // true if repeated calls are safe
  openWorldHint: true,       // true if calls external API
};

// ============================================================================
// TYPE EXPORTS
// ============================================================================

export type Sheets{ToolName}Input = z.infer<typeof Sheets{ToolName}InputSchema>;
export type Sheets{ToolName}Output = z.infer<typeof Sheets{ToolName}OutputSchema>;
export type {ToolName}Response = z.infer<typeof {ToolName}ResponseSchema>;
export type {ToolName}Request = Sheets{ToolName}Input['request'];

// Type narrowing helpers for each action
export type {ToolName}Action1Input = Sheets{ToolName}Input['request'] & {
  action: 'action_name';
};
// ... one for each action
```

### 1.2 Schema Checklist

- [ ] File header comment with tool name and MCP protocol version
- [ ] Import from `'./shared.js'` (NOT `'./shared'`)
- [ ] Each action schema uses `z.literal('action_name')` for the action field
- [ ] Each action schema has `.describe()` on the action field
- [ ] Every field has `.describe()` with helpful description
- [ ] Required params have no `.optional()` or `.default()`
- [ ] Optional params use `.optional()` OR `.default(value)`, NOT both
- [ ] Input schema wraps discriminated union in `request` property
- [ ] Output schema wraps response union in `response` property
- [ ] Response union discriminates on `success` (literal true/false)
- [ ] Success response has `action: z.string()` field
- [ ] Error response has `error: ErrorDetailSchema`
- [ ] Annotations exported with correct naming: `SHEETS_{TOOLNAME}_ANNOTATIONS`
- [ ] All types exported with correct naming pattern

### 1.3 Naming Conventions

| Element        | Pattern                         | Example                       |
| -------------- | ------------------------------- | ----------------------------- |
| Action schema  | `{Action}ActionSchema`          | `QueryActionSchema`           |
| Request union  | `{ToolName}RequestSchema`       | `BigQueryRequestSchema`       |
| Input schema   | `Sheets{ToolName}InputSchema`   | `SheetsBigQueryInputSchema`   |
| Output schema  | `Sheets{ToolName}OutputSchema`  | `SheetsBigQueryOutputSchema`  |
| Response union | `{ToolName}ResponseSchema`      | `BigQueryResponseSchema`      |
| Annotations    | `SHEETS_{TOOLNAME}_ANNOTATIONS` | `SHEETS_BIGQUERY_ANNOTATIONS` |
| Input type     | `Sheets{ToolName}Input`         | `SheetsBigQueryInput`         |
| Output type    | `Sheets{ToolName}Output`        | `SheetsBigQueryOutput`        |
| Response type  | `{ToolName}Response`            | `BigQueryResponse`            |
| Request type   | `{ToolName}Request`             | `BigQueryRequest`             |

---

## 2. Handler File Pattern (`src/handlers/{toolname}.ts`)

### 2.1 Required File Structure

```typescript
/**
 * ServalSheets - {ToolName} Handler
 *
 * Handles sheets_{toolname} tool ({N} actions).
 *
 * MCP Protocol: 2025-11-25
 */

import type { sheets_v4, drive_v3 } from 'googleapis';
import { BaseHandler, type HandlerContext, unwrapRequest } from './base.js';
import type { Intent } from '../core/intent.js';
import type {
  Sheets{ToolName}Input,
  Sheets{ToolName}Output,
  {ToolName}Response,
  {ToolName}Request,
  {ToolName}Action1Input,
  {ToolName}Action2Input,
  // ... all action input types
} from '../schemas/index.js';

export class Sheets{ToolName}Handler extends BaseHandler<
  Sheets{ToolName}Input,
  Sheets{ToolName}Output
> {
  private sheetsApi: sheets_v4.Sheets;
  // private otherApi: OtherApi;

  constructor(
    context: HandlerContext,
    sheetsApi: sheets_v4.Sheets,
    // otherApi: OtherApi
  ) {
    super('sheets_{toolname}', context);  // MUST match tool name exactly
    this.sheetsApi = sheetsApi;
  }

  async handle(input: Sheets{ToolName}Input): Promise<Sheets{ToolName}Output> {
    // 1. Unwrap request from wrapper
    const rawReq = unwrapRequest<Sheets{ToolName}Input['request']>(input);

    // 2. Require auth (unless tool doesn't need it)
    this.requireAuth();

    // 3. Track spreadsheet ID if applicable
    const spreadsheetId = 'spreadsheetId' in rawReq ? rawReq.spreadsheetId : undefined;
    this.trackSpreadsheetId(spreadsheetId);

    try {
      // 4. Infer missing parameters from context
      const req = this.inferRequestParameters(rawReq) as {ToolName}Request;

      // 5. Dispatch to action handler
      let response: {ToolName}Response;
      switch (req.action) {
        case 'action1':
          response = await this.handleAction1(req as {ToolName}Action1Input);
          break;
        case 'action2':
          response = await this.handleAction2(req as {ToolName}Action2Input);
          break;
        // ... all actions
        default:
          response = this.error({
            code: 'INVALID_PARAMS',
            message: `Unknown action: ${(req as { action: string }).action}`,
            retryable: false,
          });
      }

      // 6. Track context after successful operation
      if (response.success && 'spreadsheetId' in req) {
        this.trackContextFromRequest({
          spreadsheetId: req.spreadsheetId,
        });
      }

      // 7. Apply verbosity filtering if needed
      const verbosity = req.verbosity ?? 'standard';
      const filteredResponse = this.applyVerbosityFilter(response, verbosity);

      // 8. Return wrapped response
      return { response: filteredResponse };
    } catch (err) {
      return { response: this.mapError(err) };
    }
  }

  // Required by BaseHandler - define intents for batch operations
  protected createIntents(input: Sheets{ToolName}Input): Intent[] {
    return []; // Return intents if using batch compiler, empty if not
  }

  // Action handlers (private methods)
  private async handleAction1(req: {ToolName}Action1Input): Promise<{ToolName}Response> {
    // Implementation
    return this.success('action1', {
      // response fields matching schema
    });
  }

  private async handleAction2(req: {ToolName}Action2Input): Promise<{ToolName}Response> {
    // Implementation
    return this.success('action2', {
      // response fields matching schema
    });
  }
}
```

### 2.2 Handler Checklist

- [ ] File header comment with tool name and action count
- [ ] Import `BaseHandler`, `HandlerContext`, `unwrapRequest` from `'./base.js'`
- [ ] Import all types from `'../schemas/index.js'` (NOT direct schema file)
- [ ] Class extends `BaseHandler<InputType, OutputType>` with correct generics
- [ ] Constructor calls `super('sheets_{toolname}', context)` with EXACT tool name
- [ ] `handle()` method starts with `unwrapRequest<...>(input)`
- [ ] `handle()` calls `this.requireAuth()` if auth is needed
- [ ] `handle()` calls `this.trackSpreadsheetId()` if applicable
- [ ] `handle()` uses `try/catch` with `this.mapError(err)` in catch
- [ ] Switch statement covers ALL actions from schema
- [ ] Default case returns error with `INVALID_PARAMS` code
- [ ] Each action handler uses `this.success(actionName, data)` for success
- [ ] Each action handler uses `this.error(errorDetail)` for errors
- [ ] Returns `{ response: ... }` wrapper (NOT raw response)
- [ ] `createIntents()` is implemented (can return empty array)

### 2.3 Common Handler Mistakes to Avoid

| Mistake                                | Correct Pattern                         |
| -------------------------------------- | --------------------------------------- |
| `return response`                      | `return { response }`                   |
| `super('bigquery', ...)`               | `super('sheets_bigquery', ...)`         |
| `import from '../schemas/bigquery.js'` | `import from '../schemas/index.js'`     |
| `this.success({ data })`               | `this.success('action_name', { data })` |
| Missing `unwrapRequest()`              | Always unwrap input first               |
| Missing action in switch               | All schema actions must be handled      |

---

## 3. Registration Pattern (`src/mcp/registration/tool-definitions.ts`)

### 3.1 Add Import

```typescript
import {
  // ... existing imports
  Sheets{ToolName}InputSchema,
  Sheets{ToolName}OutputSchema,
  SHEETS_{TOOLNAME}_ANNOTATIONS,
} from '../../schemas/index.js';
```

### 3.2 Add Tool Definition

```typescript
export const TOOL_DEFINITIONS: readonly ToolDefinition[] = [
  // ... existing tools
  {
    name: 'sheets_{toolname}',
    description: TOOL_DESCRIPTIONS.sheets_{toolname},
    inputSchema: Sheets{ToolName}InputSchema,
    outputSchema: Sheets{ToolName}OutputSchema,
    annotations: SHEETS_{TOOLNAME}_ANNOTATIONS,
  },
] as const;
```

### 3.3 Registration Checklist

- [ ] Import all 3 exports (Input, Output, Annotations) from `'../../schemas/index.js'`
- [ ] Tool name matches EXACTLY: `'sheets_{toolname}'`
- [ ] Description uses `TOOL_DESCRIPTIONS.sheets_{toolname}`
- [ ] Order: name, description, inputSchema, outputSchema, annotations

---

## 4. Index Exports (`src/schemas/index.ts`)

### 4.1 Add Export Line

```typescript
// After existing exports
export * from './{toolname}.js';
```

### 4.2 Add to TOOL_REGISTRY

```typescript
export const TOOL_REGISTRY = {
  // ... existing tools
  sheets_{toolname}: {
    name: 'sheets_{toolname}',
    title: '{Tool Title}',
    description: '...',
    schema: 'Sheets{ToolName}InputSchema',
    output: 'Sheets{ToolName}OutputSchema',
    annotations: 'SHEETS_{TOOLNAME}_ANNOTATIONS',
    actions: ['action1', 'action2', ...],
  },
};
```

### 4.3 Index Checklist

- [ ] Export line uses `.js` extension
- [ ] TOOL_REGISTRY entry has all 6 required fields
- [ ] Actions array lists ALL action names from schema

---

## 5. Description (`src/schemas/descriptions.ts`)

Add tool description:

```typescript
export const TOOL_DESCRIPTIONS = {
  // ... existing
  sheets_{toolname}: '{Brief description of what this tool does}: action1 (description) | action2 (description) | ...',
};
```

---

## 6. Completions (`src/mcp/completions.ts`)

Add to TOOL_ACTIONS:

```typescript
export const TOOL_ACTIONS: Record<string, readonly string[]> = {
  // ... existing
  sheets_{toolname}: [
    'action1',
    'action2',
    // ... all actions
  ] as const,
};
```

---

## 7. Fast Validators (`src/schemas/fast-validators.ts`)

If tool has spreadsheetId validation, add entry:

```typescript
// In createFastValidators()
sheets_{toolname}: (input: unknown) => {
  const req = (input as { request?: unknown })?.request as { spreadsheetId?: unknown } | undefined;
  if (req?.spreadsheetId) fastValidateSpreadsheet(req.spreadsheetId);
},
```

---

## 8. Handler Index (`src/handlers/index.ts`)

Add export:

```typescript
export { Sheets{ToolName}Handler } from './{toolname}.js';
```

---

## 9. Server Registration (`src/server.ts`)

Add handler instantiation and tool case:

```typescript
// In createHandlers() or equivalent
const {toolname}Handler = new Sheets{ToolName}Handler(context, sheetsApi, ...);

// In tool dispatch
case 'sheets_{toolname}':
  return await {toolname}Handler.handle(input);
```

---

## 10. Metadata Generation

After ALL files are created:

```bash
# Regenerate metadata
npm run gen:metadata

# Verify no drift
npm run check:drift
```

---

## 11. Pre-Commit Verification

Before considering implementation complete:

```bash
# Full verification (MUST pass)
npm run verify

# Individual checks if verify fails
npm run typecheck      # 0 errors required
npm run lint           # 0 errors required
npm run test           # All tests passing
npm run check:drift    # No drift detected
```

---

## 12. Contract Test Template

Create `tests/contracts/sheets-{toolname}.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  Sheets{ToolName}InputSchema,
  Sheets{ToolName}OutputSchema,
} from '../../src/schemas/index.js';

describe('sheets_{toolname} Schema Contracts', () => {
  describe('Input Schema', () => {
    it('should accept valid action1 input', () => {
      const input = {
        request: {
          action: 'action1',
          requiredParam: 'value',
        },
      };
      const result = Sheets{ToolName}InputSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should reject invalid action', () => {
      const input = {
        request: {
          action: 'invalid_action',
        },
      };
      const result = Sheets{ToolName}InputSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('should reject missing required field', () => {
      const input = {
        request: {
          action: 'action1',
          // missing requiredParam
        },
      };
      const result = Sheets{ToolName}InputSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe('Output Schema', () => {
    it('should accept valid success response', () => {
      const output = {
        response: {
          success: true,
          action: 'action1',
          // action-specific fields
        },
      };
      const result = Sheets{ToolName}OutputSchema.safeParse(output);
      expect(result.success).toBe(true);
    });

    it('should accept valid error response', () => {
      const output = {
        response: {
          success: false,
          error: {
            code: 'SOME_ERROR',
            message: 'Error message',
            retryable: false,
          },
        },
      };
      const result = Sheets{ToolName}OutputSchema.safeParse(output);
      expect(result.success).toBe(true);
    });
  });
});
```

---

## Quick Reference Checklist

For each new tool, create/modify these files in order:

1. [ ] `src/schemas/{toolname}.ts` - Schema file
2. [ ] `src/schemas/index.ts` - Add export and TOOL_REGISTRY
3. [ ] `src/schemas/descriptions.ts` - Add TOOL_DESCRIPTIONS entry
4. [ ] `src/mcp/completions.ts` - Add TOOL_ACTIONS entry
5. [ ] `src/schemas/fast-validators.ts` - Add validator if needed
6. [ ] `src/handlers/{toolname}.ts` - Handler file
7. [ ] `src/handlers/index.ts` - Add export
8. [ ] `src/mcp/registration/tool-definitions.ts` - Add tool definition
9. [ ] `src/server.ts` - Add handler and dispatch case
10. [ ] `tests/contracts/sheets-{toolname}.test.ts` - Contract tests
11. [ ] Run `npm run gen:metadata`
12. [ ] Run `npm run verify`

---

## Common Errors and Fixes

| Error Message                      | Likely Cause                 | Fix                                         |
| ---------------------------------- | ---------------------------- | ------------------------------------------- |
| `Cannot find module './shared'`    | Missing .js extension        | Use `'./shared.js'`                         |
| `'X' is not exported from...`      | Wrong export name            | Check exact naming in source                |
| `Property 'action' does not exist` | Missing unwrapRequest        | Add `unwrapRequest()` call                  |
| `Type 'X' is not assignable`       | Return type mismatch         | Check schema output matches handler return  |
| `Unknown action: X`                | Action not in switch         | Add case for every action                   |
| `INVALID_PARAMS` at runtime        | Discriminated union mismatch | Check `z.literal()` matches exactly         |
| Tests fail with "request"          | Old test format              | Tests must use `{ request: {...} }` wrapper |

---

## Verification Commands Reference

```bash
# Check TypeScript compiles
npm run typecheck

# Check linting
npm run lint

# Run all tests
npm run test

# Run specific test file
npm run test tests/contracts/sheets-{toolname}.test.ts

# Check metadata sync
npm run check:drift

# Regenerate metadata
npm run gen:metadata

# Full verification
npm run verify
```

---

**STOP AND VERIFY:** Before writing any code, run `npm run verify` to ensure a clean starting state. Do NOT proceed if there are existing errors.

---

## Lessons Learned from sheets_templates Implementation

### Issue 1: Google API Returns `null` Instead of `undefined`

**Problem:** Google Sheets API returns `null` for missing properties, but Zod schemas expect `undefined`.

```typescript
// ❌ This causes TypeScript error:
frozenRowCount: sheet.properties?.gridProperties?.frozenRowCount,
// Type 'number | null | undefined' is not assignable to type 'number | undefined'

// ✅ Correct pattern - convert null to undefined:
frozenRowCount: sheet.properties?.gridProperties?.frozenRowCount ?? undefined,
```

**Rule:** When reading from Google APIs, always use `?? undefined` to convert potential `null` values.

---

### Issue 2: Handler Dispatch Uses Fast Validators, Not Server Switch

**Problem:** New tool handlers don't work because they're not registered in fast-handler-map.ts.

**Fix:** After creating the handler, add an entry to:

- `src/mcp/registration/fast-handler-map.ts` - Handler dispatch map
- `src/schemas/fast-validators.ts` - Fast validator function

```typescript
// In fast-handler-map.ts
import { fastValidate{ToolName} } from '../../schemas/fast-validators.js';

// In the map:
sheets_{toolname}: async (args) => {
  const input = args as Record<string, unknown>;
  fastValidate{ToolName}(input);
  return handlers.{toolname}.handle(input as Parameters<typeof handlers.{toolname}.handle>[0]);
},
```

---

### Issue 3: BaseHandler Already Provides Utility Methods

**Problem:** Creating utility methods that already exist in BaseHandler causes TypeScript errors.

**Fix:** Before implementing helper methods, check BaseHandler for existing utilities:

- `letterToColumn(letter)` - Convert column letter to index
- `columnToLetter(column)` - Convert index to column letter
- `success(action, data)` - Create success response
- `error(details)` - Create error response
- `mapError(err)` - Convert exceptions to error responses

---

### Issue 4: Formatting Not Applied Automatically

**Problem:** Code passes linting but fails formatting check.

**Fix:** After creating new files, run:

```bash
npx prettier --write src/handlers/{toolname}.ts src/schemas/{toolname}.ts src/services/{service}.ts
```

---

### Issue 5: Metadata Generation Says "Updated" But Doesn't Actually Update

**Problem:** `npm run gen:metadata` reports success but TOOL_COUNT/ACTION_COUNT not updated in index.ts.

**Fix:** Manually verify and update the constants in `src/schemas/index.ts`:

```typescript
// Verify these match actual counts
export const TOOL_COUNT = X; // Must match number of tools
export const ACTION_COUNT = Y; // Must match sum of all actions
```

---

### Issue 6: Test File Counts Out of Sync

**Problem:** Contract tests expect old tool/action counts after adding new tool.

**Fix:** Update these test files after adding a new tool:

1. `tests/contracts/schema-contracts.test.ts` - Update TOOL_SCHEMAS array and expected counts
2. `tests/schemas/fast-validators.test.ts` - Update "should have validator for all N tools" test

---

### Issue 7: Handler Factory Not Updated

**Problem:** Handler instantiation fails because factory doesn't know about new handler.

**Fix:** Add to `src/handlers/index.ts`:

1. Export type: `export type { Sheets{ToolName}Handler } from './{toolname}.js';`
2. Add to Handlers interface
3. Add loader function in `createHandlers()`

---

## Updated Quick Reference Checklist

For each new tool, create/modify these files IN THIS EXACT ORDER:

**Phase A: Schema (must be first)**

1. [ ] `src/schemas/{toolname}.ts` - Schema file
2. [ ] `src/schemas/index.ts` - Add export and TOOL_REGISTRY entry
3. [ ] `src/schemas/descriptions.ts` - Add TOOL_DESCRIPTIONS entry
4. [ ] `src/mcp/completions.ts` - Add TOOL_ACTIONS entry

**Phase B: Fast Validators** 5. [ ] `src/schemas/fast-validators.ts` - Add ACTIONS set and validator function

**Phase C: Handler** 6. [ ] `src/handlers/{toolname}.ts` - Handler file (use BaseHandler utilities) 7. [ ] `src/handlers/index.ts` - Add export AND Handlers interface AND createHandlers loader

**Phase D: Registration** 8. [ ] `src/mcp/registration/tool-definitions.ts` - Add tool definition 9. [ ] `src/mcp/registration/fast-handler-map.ts` - Add handler dispatch entry

**Phase E: Tests** 10. [ ] `tests/contracts/schema-contracts.test.ts` - Add to VALID_INPUTS, TOOL_SCHEMAS, update counts 11. [ ] `tests/schemas/fast-validators.test.ts` - Add tool to registry test

**Phase F: Metadata & Verification** 12. [ ] Run `npm run gen:metadata` 13. [ ] Manually verify `src/schemas/index.ts` TOOL_COUNT and ACTION_COUNT are correct 14. [ ] Run `npx prettier --write` on all new files 15. [ ] Run `npm run verify`

---

## Pre-Implementation Template Verification

Before writing any code for a new tool, copy-paste this verification:

```bash
# 1. Verify clean state
npm run verify

# 2. Check current counts (note these for later)
grep "TOOL_COUNT\|ACTION_COUNT" src/schemas/index.ts

# 3. List existing tools for reference
grep "name: 'sheets_" src/mcp/registration/tool-definitions.ts

# 4. Verify fast-handler-map matches tool-definitions
grep "sheets_" src/mcp/registration/fast-handler-map.ts | wc -l
```
