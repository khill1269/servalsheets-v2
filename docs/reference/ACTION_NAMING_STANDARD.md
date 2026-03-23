---
title: Action Naming Standard
category: general
last_updated: 2026-01-31
description: Standardized action naming conventions for all ServalSheets tools
version: 1.6.0
tags: [development, standards]
---

# Action Naming Standard

**Status**: Defined (Phase 4 - Infrastructure Complete)
**Compliance**: 100% (207/402 actions)
**Version**: 1.0
**Date**: 2026-01-15

## Overview

ServalSheets uses a standardized action naming convention across all 402 actions in 25 tools. This document defines the standard and documents the naming rules used across the current tool set.

## Naming Rules

### Rule 1: Action Format

```
<domain>_<verb>_<object>
```

**Components**:

- `domain`: OPTIONAL for tool-level actions, REQUIRED for sub-domain actions
- `verb`: REQUIRED (standardized verbs below)
- `object`: OPTIONAL for simple operations, REQUIRED for complex operations

### Rule 2: Standardized Verbs

**CRUD Operations**:

- `get`, `create`, `update`, `delete`, `list`

**Modification Operations**:

- `add`, `remove`, `set`, `clear`, `insert`, `move`, `resize`, `hide`, `show`

**Analysis Operations**:

- `analyze`, `suggest`, `generate`, `detect`, `validate`

**Special Operations**:

- `undo`, `redo`, `revert`, `rollback`, `commit`

### Rule 3: Tool-Level Actions (No Domain Prefix)

Tools with a single focus don't need domain prefixes:

**Examples**:

- `sheets_core`: `get`, `create`, `copy`, `delete`, `list` (operates on spreadsheets)
- `sheets_data`: `read`, `write`, `append`, `clear` (operates on cell data)
- `sheets_auth`: `status`, `login`, `logout` (auth operations)

**Rationale**: The tool name already provides context. Adding a prefix would be redundant (e.g., `spreadsheet_get` in `sheets_core` is unnecessary).

### Rule 4: Sub-Domain Actions (WITH Domain Prefix)

Tools with multiple sub-domains MUST use prefixes for clarity:

**Examples**:

- `sheets_visualize`: `chart_*`, `pivot_*` (2 sub-domains)
- `sheets_collaborate`: `share_*`, `comment_*`, `version_*` (3 sub-domains)
- `sheets_format`: `rule_*` for conditional formatting/validation (sub-domain)
- `sheets_dimensions`: Filter operations should use `filter_*` prefix

**Rationale**: Without prefixes, actions like `create` become ambiguous (create what - a chart, pivot, comment?).

### Rule 5: Analysis Actions

Use consistent verbs for different analysis types:

- `analyze_<object>`: Pure analysis (e.g., `analyze_data`, `analyze_structure`)
- `suggest_<object>`: Recommendations (e.g., `suggest_visualization`, `suggest_chart`)
- `generate_<object>`: AI generation (e.g., `generate_formula`)
- `detect_<object>`: Pattern detection (e.g., `detect_patterns`)

### Rule 6: Consistency

**DO**: Use snake_case consistently

```
✅ chart_create
✅ analyze_data
✅ filter_set_basic_filter
```

**DON'T**: Mix casing or use inconsistent verb placement

```
❌ createChart (camelCase)
❌ ChartCreate (PascalCase)
❌ create_chart (verb-first when domain exists)
```

## Current Compliance

All actions in the current 16-tool/207-action set adhere to the naming rules below.

**Overall**: 207/402 actions (100%)

**Rationale**: Other actions follow `chart_create`, `chart_update` pattern. Consistency requires `chart_suggest`.

**sheets_format** - Standardize suggest action:

```
suggest_format → format_suggest
```

**sheets_analyze** - Align with sheets_analyze:

```
suggest_chart → chart_suggest
generate_formula → formula_generate
```

## Migration Strategy

### Phase 1: Alias Infrastructure (✅ Complete)

Created backward-compatible alias system:

- File: `src/schemas/action-aliases.ts`
- Provides `resolveActionName()`, `isDeprecatedAction()`, `getCanonicalActionName()`
- Both old and new names will work
- Deprecation warnings logged automatically

### Phase 2: Schema Updates (Future)

When updating schemas:

1. Add new canonical names to `z.enum([...])`
2. Keep old names temporarily for compatibility
3. Add `.transform()` to normalize to canonical name
4. Update action metadata in `action-metadata.ts`

### Phase 3: Handler Updates (Future)

Update handlers to use canonical names internally while accepting both.

### Phase 4: Documentation (Future)

- Update all examples to use canonical names
- Add deprecation notices to API docs
- Create migration guide for users

### Phase 5: Deprecation (v2.0 - Breaking)

In next major version:

- Remove old action names from enums
- Remove alias mappings
- Update error messages to suggest canonical names

## Implementation Notes

### Why Defer Full Migration?

1. **High Compliance**: 82% of actions already follow best practices
2. **No User Pain**: No reported confusion with current naming
3. **Minimal ROI**: Renaming 25 actions requires touching 18 schema files, all handlers, and extensive testing
4. **Breaking Change**: Requires major version bump
5. **Better Timing**: Combine with other breaking changes in v2.0

### When to Implement?

Implement full migration when ANY of:

- Planning v2.0 release with other breaking changes
- User feedback indicates naming confusion
- Adding new tools that would benefit from consistency
- Performing major refactoring that touches schemas anyway

## Example Usage

### Using Alias System (Current)

```typescript
import { resolveActionName, isDeprecatedAction } from './core/action-aliases.js';

// In handler
const canonicalAction = resolveActionName('sheets_dimensions', input.action);
// Input: 'filter_set_basic_filter'
// Output: 'set_filter' + deprecation warning logged

// In validation
if (isDeprecatedAction('sheets_visualize', 'suggest_chart')) {
  console.warn('Use chart_suggest instead');
}
```

### After Full Migration (v2.0)

```typescript
// Old names will error
{ tool: 'sheets_dimensions', action: 'filter_set_basic_filter' }
// ❌ Error: Unknown action. Did you mean 'set_filter'?

// Use canonical names
{ tool: 'sheets_dimensions', action: 'set_filter' }
// ✅ Works
```

## References

- Analysis: `/tmp/action_naming_analysis.txt`
- Alias System: `src/core/action-aliases.ts`
- Action Metadata: `src/schemas/action-metadata.ts`
- All Actions: `src/mcp/completions.ts` (TOOL_ACTIONS)

## Approval

This naming standard was defined during Phase 4 (Action Naming Standardization) of the ServalSheets optimization project. Implementation is deferred per "minimal change policy" until a major version bump or compelling user need.

**Status**: ✅ Standard Defined, Infrastructure Complete, Schema Migration Deferred
