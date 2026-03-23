---
title: Durable MCP Schema Pattern
category: development
last_updated: 2026-01-31
description: 'Root Cause: MCP SDK''s normalizeObjectSchema() expects top-level z.object() schemas. Root-level discriminated unions cause empty schemas {"type":"object"}'
version: 1.6.0
---

# Durable MCP Schema Pattern

## Problem Statement

**Root Cause**: MCP SDK's `normalizeObjectSchema()` expects top-level `z.object()` schemas. Root-level discriminated unions cause empty schemas `{"type":"object","properties":{}}` in tools/list.

**Previous Approach (BRITTLE)**:

- Custom `zodToJsonSchemaCompat()` (historical; sdk-patch removed)
- Runtime schema transformation at registration
- Breaks with MCP SDK upgrades
- 252 lines of workaround code
- Requires ongoing maintenance

**New Approach (DURABLE)**:

- All schemas are top-level `z.object()`
- Unions nested inside `request` property
- Works natively with MCP SDK - no patching
- Stable across SDK versions

---

## Pattern Implementation

### Old Pattern (Brittle)

```typescript
// ❌ ROOT-LEVEL DISCRIMINATED UNION (breaks MCP SDK)
export const SheetsValuesInputSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('read'), spreadsheetId: z.string(), ... }),
  z.object({ action: z.literal('write'), spreadsheetId: z.string(), ... }),
  ...
]);

export const SheetsValuesOutputSchema = z.discriminatedUnion('success', [
  z.object({ success: z.literal(true), ... }),
  z.object({ success: z.literal(false), error: ... }),
]);
```

**Result**: MCP SDK serializes as `{"type":"object","properties":{}}` ❌

### New Pattern (Durable)

```typescript
// ✅ TOP-LEVEL z.object() WITH NESTED UNION
const ValuesActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('read'), spreadsheetId: z.string(), ... }),
  z.object({ action: z.literal('write'), spreadsheetId: z.string(), ... }),
  ...
]);

// Wrap in top-level object
export const SheetsValuesInputSchema = z.object({
  request: ValuesActionSchema,  // Union nested here
});

const ValuesResponseSchema = z.discriminatedUnion('success', [
  z.object({ success: z.literal(true), ... }),
  z.object({ success: z.literal(false), error: ... }),
]);

// Wrap in top-level object
export const SheetsValuesOutputSchema = z.object({
  response: ValuesResponseSchema,  // Union nested here
});

// Export action/response types for handler use
export type ValuesAction = z.infer<typeof ValuesActionSchema>;
export type ValuesResponse = z.infer<typeof ValuesResponseSchema>;
```

**Result**: MCP SDK serializes correctly with full schema structure ✅

---

## Handler Adaptation

Handlers must unwrap/wrap the request/response envelopes:

### Before

```typescript
async handle(input: SheetsValuesInput): Promise<SheetsValuesOutput> {
  switch (input.action) {
    case 'read':
      return await this.handleRead(input);
    ...
  }
}

private async handleRead(
  input: Extract<SheetsValuesInput, { action: 'read' }>
): Promise<SheetsValuesOutput> {
  // Direct access to properties
  const value = input.spreadsheetId;
  return { success: true, ... };
}
```

### After

```typescript
async handle(input: SheetsValuesInput): Promise<SheetsValuesOutput> {
  // UNWRAP request from envelope
  const req = input.request;

  let response: ValuesResponse;
  switch (req.action) {
    case 'read':
      response = await this.handleRead(req);
      break;
    ...
  }

  // WRAP response in envelope
  return { response };
}

private async handleRead(
  input: Extract<ValuesAction, { action: 'read' }>  // Use action type, not input type
): Promise<ValuesResponse> {                       // Return response type
  // Direct access to properties (same as before)
  const value = input.spreadsheetId;
  return { success: true, ... };
}

protected createIntents(input: SheetsValuesInput): Intent[] {
  // UNWRAP for intent creation
  const req = input.request;
  // Use req.action, req.spreadsheetId, etc.
}
```

**Key Changes**:

1. `handle()`: Unwrap `input.request` → pass to handlers → wrap `response`
2. Private handler methods: Use `ValuesAction` / `ValuesResponse` types
3. `createIntents()`: Unwrap `input.request` at the start

---

## Complete Example: values.ts

**File**: `src/schemas/values.ts`

```typescript
/**
 * SCHEMA PATTERN: Top-level z.object() with union inside 'request' property
 * This pattern is durable across MCP SDK upgrades - no custom patching needed.
 */

import { z } from 'zod';
import { /* ...shared schemas... */ } from './shared.js';

const BaseSchema = z.object({
  spreadsheetId: SpreadsheetIdSchema,
});

// Action union (nested inside top-level object)
const ValuesActionSchema = z.discriminatedUnion('action', [
  BaseSchema.extend({ action: z.literal('read'), range: RangeInputSchema, ... }),
  BaseSchema.extend({ action: z.literal('write'), range: RangeInputSchema, values: ValuesArraySchema, ... }),
  BaseSchema.extend({ action: z.literal('append'), range: RangeInputSchema, values: ValuesArraySchema, ... }),
  BaseSchema.extend({ action: z.literal('clear'), range: RangeInputSchema, ... }),
  // ... more actions
]);

// TOP-LEVEL INPUT SCHEMA (z.object with union inside)
export const SheetsValuesInputSchema = z.object({
  request: ValuesActionSchema,
});

// Output response union
const ValuesResponseSchema = z.discriminatedUnion('success', [
  z.object({ success: z.literal(true), action: z.string(), values: ValuesArraySchema.optional(), ... }),
  z.object({ success: z.literal(false), error: ErrorDetailSchema }),
]);

// TOP-LEVEL OUTPUT SCHEMA (z.object with union inside)
export const SheetsValuesOutputSchema = z.object({
  response: ValuesResponseSchema,
});

// Export action/response types for handler use
export type SheetsValuesInput = z.infer<typeof SheetsValuesInputSchema>;
export type SheetsValuesOutput = z.infer<typeof SheetsValuesOutputSchema>;
export type ValuesAction = z.infer<typeof ValuesActionSchema>;
export type ValuesResponse = z.infer<typeof ValuesResponseSchema>;
```

**Handler**: `src/handlers/values.ts` (see above for unwrap/wrap pattern)

---

## Migration Steps

### For Each Schema File

1. **Rename discriminated union to intermediate const**

   ```typescript
   // Old: export const SheetsXInputSchema = z.discriminatedUnion(...)
   // New: const XActionSchema = z.discriminatedUnion(...)
   ```

2. **Wrap input in top-level z.object()**

   ```typescript
   export const SheetsXInputSchema = z.object({
     request: XActionSchema,
   });
   ```

3. **Wrap output in top-level z.object()**

   ```typescript
   const XResponseSchema = z.discriminatedUnion('success', [...]);
   export const SheetsXOutputSchema = z.object({
     response: XResponseSchema,
   });
   ```

4. **Export action/response types**

   ```typescript
   export type XAction = z.infer<typeof XActionSchema>;
   export type XResponse = z.infer<typeof XResponseSchema>;
   ```

5. **Update handler imports**

   ```typescript
   import type { SheetsXInput, SheetsXOutput, XAction, XResponse } from '../schemas/index.js';
   ```

6. **Update handler.handle() method**

   ```typescript
   async handle(input: SheetsXInput): Promise<SheetsXOutput> {
     const req = input.request;
     let response: XResponse;
     // ... dispatch to private methods ...
     return { response };
   }
   ```

7. **Update private handler methods**

   ```typescript
   private async handleRead(input: Extract<XAction, { action: 'read' }>): Promise<XResponse> {
     // ...
   }
   ```

8. **Update createIntents() if present**

   ```typescript
   protected createIntents(input: SheetsXInput): Intent[] {
     const req = input.request;
     // Use req.action, req.spreadsheetId, etc.
   }
   ```

---

## Tools/List Verification

After migration, verify schemas serialize correctly:

```bash
# Test tools/list returns non-empty schemas
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node dist/cli.js 2>/dev/null | jq '.result.tools[0].inputSchema'
```

**Expected Output**:

```json
{
  "type": "object",
  "properties": {
    "request": {
      "oneOf": [
        { "type": "object", "properties": { "action": { "const": "read" }, ... } },
        { "type": "object", "properties": { "action": { "const": "write" }, ... } }
      ]
    }
  },
  "required": ["request"]
}
```

**NOT**:

```json
{ "type": "object", "properties": {} } // ❌ Empty schema (old pattern)
```

---

## Benefits

### ✅ Durability

- **Native MCP SDK support**: No custom transformation code
- **SDK upgrade-proof**: Pattern works with any MCP SDK version
- **Type-safe**: Full TypeScript inference maintained

### ✅ Simplicity

- **Removed 252 lines of workaround code** (sdk-patch)
- **Standard Zod**: No custom schema utilities
- **Clear pattern**: Top-level object → easy to understand

### ✅ Maintainability

- **No workarounds to update**: Changes stay in schema definitions
- **Standard handler pattern**: Unwrap → process → wrap
- **Future-proof**: Stable foundation for new tools

---

## Files to Update

### Schemas (15 files)

1. ✅ `src/schemas/values.ts` - **COMPLETE** (reference implementation)
2. ⏳ `src/schemas/spreadsheet.ts`
3. ⏳ `src/schemas/sheet.ts`
4. ⏳ `src/schemas/cells.ts`
5. ⏳ `src/schemas/format.ts`
6. ⏳ `src/schemas/dimensions.ts`
7. ⏳ `src/schemas/rules.ts`
8. ⏳ `src/schemas/charts.ts`
9. ⏳ `src/schemas/pivot.ts`
10. ⏳ `src/schemas/filter-sort.ts`
11. ⏳ `src/schemas/sharing.ts`
12. ⏳ `src/schemas/comments.ts`
13. ⏳ `src/schemas/versions.ts`
14. ⏳ `src/schemas/analysis.ts`
15. ⏳ `src/schemas/advanced.ts`

### Handlers (15 files)

1. ✅ `src/handlers/values.ts` - **COMPLETE**
2. ⏳ `src/handlers/spreadsheet.ts`
3. ⏳ `src/handlers/sheet.ts`
4. ⏳ `src/handlers/cells.ts`
5. ⏳ `src/handlers/format.ts`
6. ⏳ `src/handlers/dimensions.ts`
7. ⏳ `src/handlers/rules.ts`
8. ⏳ `src/handlers/charts.ts`
9. ⏳ `src/handlers/pivot.ts`
10. ⏳ `src/handlers/filter-sort.ts`
11. ⏳ `src/handlers/sharing.ts`
12. ⏳ `src/handlers/comments.ts`
13. ⏳ `src/handlers/versions.ts`
14. ⏳ `src/handlers/analysis.ts`
15. ⏳ `src/handlers/advanced.ts`

### Cleanup

- ✅ Removed `src/utils/sdk-patch.ts` workaround
- ✅ No custom transformation in server/registration

---

## Testing Strategy

### Unit Tests

```typescript
describe('Schema Serialization', () => {
  it('should have top-level object with request property', () => {
    const schema = zodToJsonSchema(SheetsValuesInputSchema);
    expect(schema.type).toBe('object');
    expect(schema.properties).toHaveProperty('request');
    expect(schema.required).toContain('request');
  });

  it('should have non-empty request schema', () => {
    const schema = zodToJsonSchema(SheetsValuesInputSchema);
    const requestSchema = schema.properties.request;
    expect(requestSchema).toBeDefined();
    // Should have oneOf or properties
    expect(requestSchema.oneOf || requestSchema.properties).toBeDefined();
  });
});
```

### Integration Test

```typescript
describe('MCP tools/list', () => {
  it('should return non-empty schemas for all tools', async () => {
    const response = await mcpServer.listTools();
    for (const tool of response.tools) {
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.inputSchema.properties).toBeDefined();
      expect(Object.keys(tool.inputSchema.properties).length).toBeGreaterThan(0);
    }
  });
});
```

---

## Performance Impact

**Before**: Custom transformation at registration

- Transformation overhead: ~1-2ms per tool × 15 = 15-30ms startup
- Memory: 252 lines of code + transformation logic

**After**: Native Zod → JSON Schema

- No transformation overhead: 0ms
- Memory: Only schema definitions

**Improvement**: Faster startup, lower memory footprint

---

## Rollout Strategy

### Phase 1: Proof of Concept ✅

- Implement pattern for `values.ts` (most complex tool)
- Verify handler adaptation works
- Test with MCP protocol

### Phase 2: Batch Migration

- Apply pattern to remaining 14 schemas
- Use automation script (see below)
- Update handlers systematically

### Phase 3: Cleanup ✅

- Removed sdk-patch workaround
- Removed custom transformation hooks
- Updated tests/docs

### Phase 4: Verification

- Run full test suite
- Test tools/list with all 25 tools
- Verify no empty schemas

---

## Automation Script

See `scripts/migrate-schema-pattern.sh` for automated migration tooling.

---

## Summary

**Pattern**: Wrap discriminated unions in top-level `z.object({ request: Union })`

**Benefits**:

- ✅ Native MCP SDK compatibility
- ✅ No custom patching code
- ✅ SDK upgrade-proof
- ✅ Simpler, more maintainable

**Status**: ✅ Pattern established; cleanup complete for sdk-patch

**Next Steps**: Apply to remaining schemas using the durable pattern
