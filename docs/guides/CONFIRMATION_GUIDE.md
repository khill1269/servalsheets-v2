---
title: ServalSheets - Confirmation & Elicitation Guide
category: guide
last_updated: 2026-01-31
description: 'ServalSheets provides multiple layers of guidance for Claude to know when and how to confirm:'
version: 1.6.0
audience: user
difficulty: intermediate
---

# ServalSheets - Confirmation & Elicitation Guide

## How Claude Does More Confirmations

ServalSheets provides multiple layers of guidance for Claude to know when and how to confirm:

---

## 1. Tool Description Emphasis

Every destructive tool has prominent warnings in its description:

```
sheets_dimensions: "⚠️ DELETE OPERATIONS ARE DESTRUCTIVE - always confirm first"

sheets_confirm: "🔴 WHEN YOU MUST USE THIS (Critical):"
```

---

## 2. Knowledge Base: `confirmation-guide.json`

A comprehensive JSON guide Claude can reference:

```json
{
  "ALWAYS_CONFIRM": {
    "operations": [
      {
        "trigger": "Deleting a sheet",
        "reason": "Entire sheet with all data will be permanently lost"
      },
      { "trigger": "Deleting more than 10 rows", "threshold": 10 },
      { "trigger": "Clearing more than 100 cells", "threshold": 100 },
      { "trigger": "Writing to more than 500 cells", "threshold": 500 },
      { "trigger": "Multi-step operations (3+ steps)" },
      { "trigger": "Sharing with new users" }
    ]
  }
}
```

---

## 3. Confirmation Policy Service

Programmatic decision-making for when to confirm:

```typescript
import { shouldConfirm, analyzeOperation } from './confirmation-policy.js';

// Check if operation needs confirmation
const decision = shouldConfirm({
  tool: 'sheets_dimensions',
  action: 'delete_rows',
  rowCount: 25,
});
// Returns: { confirm: true, reason: "Deleting 25 rows", suggestSnapshot: true }
```

### Thresholds

| Category       | Low Risk | Medium | High    | Critical |
| -------------- | -------- | ------ | ------- | -------- |
| Cells          | <50      | 50-100 | 100-500 | >1000    |
| Rows Delete    | <10      | -      | >10     | -        |
| Columns Delete | <3       | -      | >3      | -        |
| Operations     | <3       | -      | ≥3      | -        |

---

## 4. MCP Resources

Claude can query resources to check confirmation requirements:

```
sheets:///confirmation/guide          → Full confirmation guide
sheets:///confirmation/destructive    → List of destructive operations
sheets:///confirmation/check/{tool}/{action} → Check specific operation
```

Example:

```
GET sheets:///confirmation/check/dimensions/delete_rows
→ { "shouldConfirm": true, "reason": "Destructive operation", "suggestSnapshot": true }
```

---

## 5. MCP Prompts

Two new prompts for Claude to understand confirmation:

### `when_to_confirm`

Complete guide with all rules:

- 🔴 ALWAYS CONFIRM list
- 🟡 SUGGEST CONFIRMATION list
- ✅ NO CONFIRMATION NEEDED list
- How to use sheets_confirm

### `confirmation_examples`

Good vs bad examples:

- Delete rows: Show which ones first
- Clear column: Warn about cell count
- Simple update: Just do it (don't over-confirm)
- Multi-step: Show plan first
- Share: Ask permission level

---

## 6. The `sheets_confirm` Tool

The formal MCP Elicitation tool:

```json
{
  "request": {
    "action": "request",
    "plan": {
      "title": "Delete Empty Rows",
      "description": "Remove 47 rows with no data",
      "steps": [
        {
          "stepNumber": 1,
          "description": "Delete 47 empty rows",
          "tool": "sheets_dimensions",
          "action": "delete_rows",
          "risk": "high",
          "isDestructive": true,
          "canUndo": true
        }
      ],
      "willCreateSnapshot": true,
      "additionalWarnings": ["Cannot be undone without snapshot"]
    }
  }
}
```

User sees an interactive UI:

```
┌─────────────────────────────────────────┐
│ Plan: Delete Empty Rows                 │
│ Risk: HIGH | Affects: 47 rows           │
│                                         │
│ Step 1: Delete 47 empty rows (HIGH)     │
│                                         │
│ Snapshot will be created for undo       │
│                                         │
│ [✓ Approve] [✎ Modify] [✗ Cancel]       │
└─────────────────────────────────────────┘
```

---

## 7. Session Preferences

Claude learns user's confirmation preference:

```typescript
// User says "just do it" repeatedly
session.learnPreference('skipConfirmation', true);

// Later, check preference
const prefs = session.getPreferences();
// prefs.confirmationLevel = "never"
```

Preference levels:

- `"always"` - Confirm everything
- `"destructive"` - Only destructive ops (default)
- `"never"` - User said "just do it"

---

## 8. Safety Parameters

Every write operation supports safety flags:

```json
{
  "action": "write",
  "range": "A1:Z1000",
  "values": [...],
  "safety": {
    "dryRun": true,           // Preview only
    "createSnapshot": true,   // Backup before
    "effectLimit": 100        // Max cells to affect
  }
}
```

---

## Golden Rules for Claude

1. **Deletion = ALWAYS confirm**
2. **>100 cells = ALWAYS confirm**
3. **Sharing = ALWAYS confirm**
4. **Multi-step = ALWAYS show plan first**
5. **Small explicit requests = No confirmation needed**
6. **When uncertain = ASK**
7. **Offer snapshots for destructive ops**
8. **Offer dryRun when user seems unsure**
9. **Respect "just do it" preferences**
10. **Track preferences in session**

---

## Files Created

| File                                                | Purpose                             |
| --------------------------------------------------- | ----------------------------------- |
| `src/services/confirmation-policy.ts`               | Programmatic confirmation decisions |
| `src/knowledge/confirmation-guide.json`             | Knowledge base for Claude           |
| `src/resources/confirmation.ts`                     | MCP Resources for checking          |
| Prompts: `when_to_confirm`, `confirmation_examples` | Guidance prompts                    |

---

## How It All Works Together

```
User: "Delete all empty rows"
          │
          ▼
┌─────────────────────────────┐
│ Claude checks:              │
│ 1. Tool description warns   │
│ 2. confirmation-guide.json  │
│ 3. shouldConfirm() returns  │
│    { confirm: true }        │
└─────────────────────────────┘
          │
          ▼
┌─────────────────────────────┐
│ Claude builds plan:         │
│ • Count empty rows (47)     │
│ • Risk = high               │
│ • isDestructive = true      │
└─────────────────────────────┘
          │
          ▼
┌─────────────────────────────┐
│ Claude calls sheets_confirm │
│ → User sees UI form         │
│ → User approves/declines    │
└─────────────────────────────┘
          │
          ▼
┌─────────────────────────────┐
│ If approved:                │
│ • Create snapshot           │
│ • Execute deletion          │
│ • Record in session history │
│ • Confirm completion        │
└─────────────────────────────┘
```
