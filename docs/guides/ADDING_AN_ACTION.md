---
title: Adding an Action to ServalSheets
category: guide
last_updated: 2026-02-17
description: 'Step-by-step tutorial for adding a new action to an existing tool'
version: 1.0
tags: [tutorial, action, development, schema]
---

# Adding an Action to ServalSheets

**Tutorial:** Add a new action to an existing MCP tool

**Time:** 20-30 minutes
**Difficulty:** Beginner
**Prerequisites:** Completed [ONBOARDING.md](./ONBOARDING.md)

---

## Table of Contents

1. [Overview](#overview)
2. [Step 1: Modify the Schema](#step-1-modify-the-schema)
3. [Step 2: Update the Handler](#step-2-update-the-handler)
4. [Step 3: Regenerate Metadata](#step-3-regenerate-metadata)
5. [Step 4: Write Tests](#step-4-write-tests)
6. [Step 5: Verify & Commit](#step-5-verify--commit)
7. [Complete Example](#complete-example)
8. [Troubleshooting](#troubleshooting)

---

## Overview

### What You'll Build

We'll add a `clear_range` action to the existing `sheets_data` tool.

**New action will:**

- Clear values from a specified range
- Support optional clearing of formatting
- Return success confirmation with cleared range

### Files to Modify

- ✅ `src/schemas/data.ts` (add action to enum)
- ✅ `src/handlers/data.ts` (add handler method)
- ✅ `tests/handlers/data.test.ts` (add tests)
- ✅ 5 generated files (via `npm run schema:commit`)

**Total changes:** ~50-100 lines of code

---

## Step 1: Modify the Schema

### Open Schema File

```bash
code src/schemas/data.ts
```

### Add Action to Discriminated Union

Find the `SheetsDataInputSchema` and add your new action:

```typescript
// src/schemas/data.ts

export const SheetsDataInputSchema = z.discriminatedUnion('action', [
  // ... existing actions ...

  // NEW: Clear range action
  z.object({
    /** Action identifier */
    action: z.literal('clear_range'),
    /** Spreadsheet ID */
    spreadsheetId: z.string().describe('Google Sheets spreadsheet ID'),
    /** Range to clear in A1 notation */
    range: z.string().describe('Range in A1 notation (e.g., "Sheet1!A1:B10")'),
    /** Clear formatting as well as values */
    clearFormatting: z.boolean().optional().default(false).describe('Also clear formatting'),
  }),
]);
```

### Schema Best Practices

✅ **Do:**

- Add to existing `z.discriminatedUnion('action', [...])`
- Use unique `action` literal (e.g., `'clear_range'`)
- Add JSDoc comments with `/** */`
- Use `.describe()` for field descriptions
- Provide sensible defaults with `.default()`

❌ **Don't:**

- Create a new schema file (add to existing)
- Forget the `action` literal field
- Skip descriptions
- Use ambiguous action names

---

## Step 2: Update the Handler

### Open Handler File

```bash
code src/handlers/data.ts
```

### Add Case to Switch Statement

```typescript
// src/handlers/data.ts

export class DataHandler extends BaseHandler<SheetsDataInput, SheetsDataOutput> {
  async executeAction(request: SheetsDataInput): Promise<SheetsDataOutput> {
    const unwrapped = unwrapRequest(request);
    const { action, ...params } = unwrapped;

    switch (action) {
      // ... existing cases ...

      case 'clear_range':
        return this.handleClearRange(params);

      default:
        throw createValidationError(`Unknown action: ${action}`);
    }
  }

  // ... existing handler methods ...

  /**
   * Handle clear_range action
   */
  private async handleClearRange(
    params: Omit<Extract<SheetsDataInput, { action: 'clear_range' }>, 'action'>
  ): Promise<SheetsDataOutput> {
    const { spreadsheetId, range, clearFormatting = false } = params;

    // Log action
    this.context.logger.info('Clearing range', {
      spreadsheetId,
      range,
      clearFormatting,
    });

    try {
      // Clear values
      await this.context.googleClient.sheets.spreadsheets.values.clear({
        spreadsheetId,
        range,
      });

      // Optionally clear formatting
      if (clearFormatting) {
        // Get sheet ID from range
        const sheetName = range.split('!')[0];
        const spreadsheet = await this.context.googleClient.sheets.spreadsheets.get({
          spreadsheetId,
        });

        const sheet = spreadsheet.data.sheets?.find((s) => s.properties?.title === sheetName);

        if (sheet) {
          await this.context.googleClient.sheets.spreadsheets.batchUpdate({
            spreadsheetId,
            requestBody: {
              requests: [
                {
                  repeatCell: {
                    range: {
                      sheetId: sheet.properties!.sheetId,
                      // Parse A1 notation to grid range
                      // (simplified - production code would use range-helpers.ts)
                    },
                    fields: 'userEnteredFormat',
                  },
                },
              ],
            },
          });
        }
      }

      return {
        response: {
          success: true,
          action: 'clear_range',
          clearedRange: range,
          formattingCleared: clearFormatting,
        },
      };
    } catch (error) {
      this.context.logger.error('Failed to clear range', {
        spreadsheetId,
        range,
        error,
      });
      throw error;
    }
  }
}
```

### Handler Best Practices

✅ **Do:**

- Add case to switch statement
- Create private handler method
- Use proper TypeScript types with `Extract<>`
- Log important actions
- Handle errors appropriately
- Return structured response `{ response: { success, ... } }`

❌ **Don't:**

- Return MCP format directly
- Skip error handling
- Use `console.log` (use `logger`)
- Modify other actions while adding yours

---

## Step 3: Regenerate Metadata

### Run Schema Commit Workflow

ONE command regenerates all metadata:

```bash
npm run schema:commit
```

**What it does:**

1. Runs `gen:metadata` - Updates tool/action counts
2. Runs `check:drift` - Verifies synchronization
3. Runs `typecheck` - Checks TypeScript compilation
4. Runs `test:fast` - Runs unit + contract tests
5. Runs `git add` - Stages all changed files

**Expected output:**

```
📊 Analyzing 22 schema files...
  📝 data.ts → 19 actions [read_range, write_range, ..., clear_range]
  ...
✅ Total: 25 tools, 403 actions (was 299)
✅ Updated src/schemas/index.ts constants
✅ Updated src/schemas/annotations.ts ACTION_COUNTS
✅ Updated src/mcp/completions.ts TOOL_ACTIONS
✅ Generated server.json
✅ Updated package.json description

✅ Drift check passed
✅ TypeScript compilation successful (0 errors)
✅ Fast tests passed (623/623)

✓ Schema changes ready to commit
```

### Files Automatically Updated

```
Modified (GENERATED - do not edit manually):
  package.json - Description now says "403 actions"
  src/schemas/index.ts - ACTION_COUNT = 300
  src/schemas/annotations.ts - sheets_data: 19 actions
  src/mcp/completions.ts - clear_range added to TOOL_ACTIONS
  server.json - Full metadata regenerated
```

---

## Step 4: Write Tests

### Open Test File

```bash
code tests/handlers/data.test.ts
```

### Add Test Cases

```typescript
// tests/handlers/data.test.ts

describe('DataHandler', () => {
  // ... existing tests ...

  describe('clear_range', () => {
    it('should clear values from range', async () => {
      // Arrange
      const input: SheetsDataInput = {
        request: {
          action: 'clear_range',
          spreadsheetId: 'test-123',
          range: 'Sheet1!A1:B10',
          clearFormatting: false,
        },
      };

      mockContext.googleClient.sheets.spreadsheets.values.clear.mockResolvedValue({
        data: {
          clearedRange: 'Sheet1!A1:B10',
        },
      });

      // Act
      const result = await handler.executeAction(input);

      // Assert
      expect(result.response.success).toBe(true);
      expect(result.response.action).toBe('clear_range');
      expect(result.response.clearedRange).toBe('Sheet1!A1:B10');
      expect(result.response.formattingCleared).toBe(false);

      // Verify API was called correctly
      expect(mockContext.googleClient.sheets.spreadsheets.values.clear).toHaveBeenCalledWith({
        spreadsheetId: 'test-123',
        range: 'Sheet1!A1:B10',
      });
    });

    it('should clear values and formatting when requested', async () => {
      // Arrange
      const input: SheetsDataInput = {
        request: {
          action: 'clear_range',
          spreadsheetId: 'test-123',
          range: 'Sheet1!A1:B10',
          clearFormatting: true,
        },
      };

      mockContext.googleClient.sheets.spreadsheets.values.clear.mockResolvedValue({
        data: { clearedRange: 'Sheet1!A1:B10' },
      });

      mockContext.googleClient.sheets.spreadsheets.get.mockResolvedValue({
        data: {
          sheets: [
            {
              properties: {
                title: 'Sheet1',
                sheetId: 0,
              },
            },
          ],
        },
      });

      mockContext.googleClient.sheets.spreadsheets.batchUpdate.mockResolvedValue({
        data: {},
      });

      // Act
      const result = await handler.executeAction(input);

      // Assert
      expect(result.response.success).toBe(true);
      expect(result.response.formattingCleared).toBe(true);
      expect(mockContext.googleClient.sheets.spreadsheets.batchUpdate).toHaveBeenCalled();
    });

    it('should handle errors gracefully', async () => {
      // Arrange
      const input: SheetsDataInput = {
        request: {
          action: 'clear_range',
          spreadsheetId: 'test-123',
          range: 'InvalidSheet!A1:B10',
          clearFormatting: false,
        },
      };

      mockContext.googleClient.sheets.spreadsheets.values.clear.mockRejectedValue(
        new Error('Sheet not found')
      );

      // Act & Assert
      await expect(handler.executeAction(input)).rejects.toThrow('Sheet not found');
    });

    it('should use default for clearFormatting when omitted', async () => {
      // Arrange
      const input: SheetsDataInput = {
        request: {
          action: 'clear_range',
          spreadsheetId: 'test-123',
          range: 'Sheet1!A1:B10',
          // clearFormatting omitted (should default to false)
        },
      };

      mockContext.googleClient.sheets.spreadsheets.values.clear.mockResolvedValue({
        data: { clearedRange: 'Sheet1!A1:B10' },
      });

      // Act
      const result = await handler.executeAction(input);

      // Assert
      expect(result.response.formattingCleared).toBe(false);
    });
  });
});
```

### Run Tests

```bash
# Run just your tests
npm test tests/handlers/data.test.ts -- --grep="clear_range"

# Output:
# ✓ tests/handlers/data.test.ts
#   ✓ DataHandler
#     ✓ clear_range (4 tests)
#       ✓ should clear values from range
#       ✓ should clear values and formatting when requested
#       ✓ should handle errors gracefully
#       ✓ should use default for clearFormatting when omitted
```

### Test Best Practices

✅ **Do:**

- Test happy path (success case)
- Test with optional parameters
- Test error cases
- Verify API calls with `.toHaveBeenCalledWith()`
- Use descriptive test names

❌ **Don't:**

- Skip error case testing
- Forget to mock API responses
- Test multiple things in one test
- Skip arrange/act/assert structure

---

## Step 5: Verify & Commit

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
✅ Fast tests passed (627/627)

✨ All verification checks passed!
```

### Commit Changes

```bash
# All files already staged by schema:commit
# Just need to commit

git commit -m "feat(data): add clear_range action

- Add clear_range to SheetsDataInputSchema
- Implement handleClearRange in DataHandler
- Support optional formatting clearing
- Add 4 test cases with error handling

Closes #XXX"

# Push to remote
git push origin feat/clear-range
```

### Create Pull Request

```bash
# Using GitHub CLI
gh pr create --title "feat(data): add clear_range action" \
  --body "Adds ability to clear cell values and optionally formatting from a range"

# Or use GitHub web UI
```

---

## Complete Example

### Summary of Changes

```
Modified:
  src/schemas/data.ts (+15 lines)
  src/handlers/data.ts (+60 lines)
  tests/handlers/data.test.ts (+80 lines)

  # Auto-generated by schema:commit:
  package.json (description: 299 → 403 actions)
  src/schemas/index.ts (ACTION_COUNT = 300)
  src/schemas/annotations.ts (sheets_data: 18 → 19)
  src/mcp/completions.ts (added clear_range)
  server.json (regenerated)
```

### Total Lines Changed

- Schema: +15 lines
- Handler: +60 lines
- Tests: +80 lines
- **Total new code:** ~155 lines
- **Total files modified:** 8 files (3 manual, 5 generated)

### Development Time

- Schema modification: 5 minutes
- Handler implementation: 10 minutes
- Test writing: 10 minutes
- Verification & commit: 5 minutes
- **Total:** 30 minutes

---

## Troubleshooting

### Issue: Metadata Drift After Schema Change

```bash
❌ Metadata drift detected in 2 files:
  - src/schemas/index.ts (expected ACTION_COUNT = 300, found 299)
  - package.json (expected "403 actions", found "403 actions")
```

**Cause:** Didn't run `npm run schema:commit`

**Fix:**

```bash
npm run schema:commit
```

---

### Issue: Schema/Handler Alignment Failed

```bash
❌ sheets_data: 19 schema actions, 18 handler cases
Missing in handler: ['clear_range']
```

**Cause:** Added action to schema but forgot handler implementation

**Fix:** Add `case 'clear_range':` to handler switch statement

---

### Issue: TypeScript Error on Handler Method

```bash
❌ TS2339: Property 'clearedRange' does not exist on type 'SheetsDataOutput'
```

**Cause:** Output schema doesn't include new response fields

**Fix:** Update `SheetsDataOutputSchema` to include new fields:

```typescript
// src/schemas/data.ts
export const SheetsDataOutputSchema = z.object({
  response: z.discriminatedUnion('success', [
    z.object({
      success: z.literal(true),
      action: z.string(),
      // Add new fields
      clearedRange: z.string().optional(),
      formattingCleared: z.boolean().optional(),
      // ... existing fields
    }),
    // ... error case
  ]),
});
```

---

### Issue: Test Failing with "action is required"

```bash
❌ Expected true but got ValidationError: action is required
```

**Cause:** Test input not wrapped in legacy envelope

**Fix:**

```typescript
// ❌ Wrong
const input = {
  action: 'clear_range',
  spreadsheetId: 'test-123',
  range: 'A1:B10',
};

// ✅ Correct
const input = {
  request: {
    action: 'clear_range',
    spreadsheetId: 'test-123',
    range: 'A1:B10',
  },
};
```

---

### Issue: Tests Pass But Integration Fails

**Cause:** Mock doesn't match real API behavior

**Fix:** Test against real API:

```bash
# Set up credentials
npm run auth

# Run live tests
TEST_REAL_API=true npm test tests/integration/
```

---

## Next Steps

### After adding your first action

1. **Add more actions** - Practice makes perfect!
2. **Add integration tests** - Test with real Google API
3. **Improve error handling** - Add retry logic, better errors
4. **Document in user guide** - Update `docs/guides/ACTION_REFERENCE.md`

### Related Tutorials

- **[Adding a Handler](./ADDING_A_HANDLER.md)** - Create a new tool
- **[Debugging Guide](./DEBUGGING.md)** - Troubleshooting techniques
- **[Onboarding](./ONBOARDING.md)** - Project overview

---

## Tips for Success

### Do's

✅ **Always run `npm run schema:commit`** after schema changes
✅ **Write tests BEFORE implementation** (TDD approach)
✅ **Keep actions focused** - One action does one thing well
✅ **Use descriptive action names** - `clear_range` not `clear`
✅ **Add JSDoc comments** - Help other developers
✅ **Test error cases** - Don't just test happy path

### Don'ts

❌ **Don't skip metadata regeneration** - Causes drift errors
❌ **Don't manually edit generated files** - Use scripts
❌ **Don't forget to commit tests** - Tests are as important as code
❌ **Don't add multiple actions at once** - Keep PRs focused
❌ **Don't skip verification** - Always run `npm run verify`

---

**Congratulations!** You've added an action to ServalSheets. 🎉

**Next challenge:** Try adding a more complex action with nested objects or array parameters.

---

**Version:** 1.0
**Last Updated:** 2026-02-17
**Maintainers:** ServalSheets Core Team
