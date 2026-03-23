---
title: Context Layers Architecture
category: architecture
last_updated: 2026-01-31
description: ServalSheets Context Management System
version: 1.6.0
---

# Context Layers Architecture

**ServalSheets Context Management System**

This document describes the three-layer context hierarchy used in ServalSheets to manage state across different scopes and lifetimes.

---

## Overview

ServalSheets maintains three distinct context layers, each with a specific purpose, lifetime, and scope:

```
┌─────────────────────────────────────────────────────────────┐
│  Layer 1: RequestContext (Protocol Layer)                   │
│  ├─ Lifetime: Single tool call (1-30 seconds)              │
│  ├─ Scope: Thread-local (AsyncLocalStorage)                │
│  └─ Purpose: MCP protocol request tracking                  │
└─────────────────────────────────────────────────────────────┘
                            ↓ contains
┌─────────────────────────────────────────────────────────────┐
│  Layer 2: SessionContext (Business Layer)                   │
│  ├─ Lifetime: Client connection (minutes to hours)         │
│  ├─ Scope: One instance per MCP client                     │
│  └─ Purpose: Domain-specific conversation state            │
└─────────────────────────────────────────────────────────────┘
                            ↓ contains
┌─────────────────────────────────────────────────────────────┐
│  Layer 3: ContextManager (Inference Layer)                  │
│  ├─ Lifetime: Active elicitation (seconds to minutes)      │
│  ├─ Scope: One instance per elicitation flow               │
│  └─ Purpose: Parameter inference and smart defaults        │
└─────────────────────────────────────────────────────────────┘
```

---

## Layer 1: RequestContext (Protocol Layer)

**File**: [src/utils/request-context.ts](../../src/utils/request-context.ts)

### Purpose

Tracks MCP protocol-specific metadata for a single tool invocation.

### Lifetime

- **Start**: When MCP tool call begins
- **End**: When tool returns response
- **Duration**: 1-30 seconds (typical), up to request timeout

### Scope

- **Storage**: AsyncLocalStorage (thread-local)
- **Visibility**: Available to any function in the call stack
- **Isolation**: Each tool call has independent context

### Contains

- `requestId`: UUID for distributed tracing
- `logger`: Request-scoped logger instance
- `timeoutMs`: Request timeout duration
- `deadline`: Absolute timestamp when request expires
- `sendNotification()`: MCP progress notification channel (optional)
- `progressToken`: MCP progress token from `_meta.progressToken` (optional)
- `traceId`, `spanId`, `parentSpanId`: W3C Trace Context for distributed tracing

### When to Use

- ✅ Logging with request ID
- ✅ Sending MCP progress notifications
- ✅ Enforcing request timeouts
- ✅ Distributed tracing across microservices
- ❌ NOT for business logic or conversation state

### Example

```typescript
import { runWithContext, getContext } from '../utils/request-context.js';

// Handler creates context
await runWithContext({ requestId: '123', timeoutMs: 30000 }, async () => {
  // Any function in call stack can access it
  const ctx = getContext();
  ctx.logger.info('Processing request', { requestId: ctx.requestId });

  // Send MCP progress notification
  await ctx.sendNotification?.({
    method: 'notifications/progress',
    params: {
      progressToken: ctx.progressToken,
      progress: 50,
      total: 100,
    },
  });
});
```

---

## Layer 2: SessionContext (Business Layer)

**File**: [src/services/session-context.ts](../../src/services/session-context.ts)

### Purpose

Maintains domain-specific conversation state and spreadsheet tracking.

### Lifetime

- **Start**: When MCP client connects
- **End**: When client disconnects or session times out
- **Duration**: Minutes to hours

### Scope

- **Storage**: Instance per MCP connection (in-memory)
- **Visibility**: Passed to handlers via HandlerContext
- **Isolation**: Each client connection has independent state

### Contains

- **Active Spreadsheet**: Current working spreadsheet (ID, title, sheet names, last range)
- **Recent Spreadsheets**: Last 10 accessed (for "open my Budget")
- **Operation History**: Last 100 operations (for "undo that", "what did I just do?")
- **User Preferences**: Timezone, locale, naming patterns, default formats
- **Pending Operations**: Multi-step workflow state (confirmations, wizards)

### When to Use

- ✅ Resolving conversational references ("the spreadsheet", "my CRM")
- ✅ Supporting undo/redo operations
- ✅ Tracking active spreadsheet context
- ✅ Maintaining conversation history
- ✅ User preference lookups
- ❌ NOT for MCP protocol metadata or parameter caching

### Example

```typescript
import { SessionContextManager } from '../services/session-context.js';

// One instance per client connection
const sessionContext = new SessionContextManager();

// Set active spreadsheet
sessionContext.setActiveSpreadsheet({
  spreadsheetId: '1ABC',
  title: 'Q1 Budget 2026',
  sheetNames: ['Income', 'Expenses', 'Summary'],
});

// Natural language reference resolution
const spreadsheetId = sessionContext.findSpreadsheetByReference('the budget');
// Returns: '1ABC'

// Record operation for undo
sessionContext.recordOperation({
  tool: 'sheets_data',
  action: 'write',
  spreadsheetId: '1ABC',
  range: 'Expenses!A1:D10',
  description: 'Updated Q1 expenses',
});

// Later: "undo that"
const lastOp = sessionContext.getLastOperation();
// Returns: { tool: 'sheets_data', action: 'write', ... }
```

---

## Layer 3: ContextManager (Inference Layer)

**File**: [src/services/context-manager.ts](../../src/services/context-manager.ts)

### Purpose

Parameter inference for MCP Elicitation (SEP-1036) - auto-fills missing parameters and suggests smart defaults.

### Lifetime

- **Start**: When elicitation flow begins
- **End**: When form is submitted or cancelled
- **Duration**: Seconds to minutes

### Scope

- **Storage**: Instance per elicitation request (in-memory)
- **Visibility**: Used by elicitation handlers
- **Isolation**: Each elicitation flow has independent cache

### Contains

- **Last Used Values**: spreadsheetId, sheetId, sheetName, range
- **Parameter History**: Last 10 values per parameter (LRU)
- **Inference Timestamps**: TTL tracking (default: 1 hour)
- **Request Metadata**: Which request last updated each parameter

### When to Use

- ✅ Auto-filling missing parameters in tool calls
- ✅ Suggesting next values in MCP Elicitation forms
- ✅ Reducing user input friction ("use same spreadsheet")
- ✅ Parameter validation hints ("last used: Budget.xlsx")
- ✅ Powering MCP `parameterDescriptions` field
- ❌ NOT for protocol tracking or conversation history

### Example

```typescript
import { ContextManager } from '../services/context-manager.js';

// One instance per elicitation flow
const contextManager = new ContextManager({ contextTTL: 3600000 });

// Record parameter usage
contextManager.recordSpreadsheet('1ABC');
contextManager.recordRange('Sheet1!A1:Z10');

// Later: User calls tool without specifying spreadsheet
const inferred = contextManager.inferSpreadsheet();
// Returns: '1ABC' (last used)

// Suggest next range (adjacent)
const nextRange = contextManager.suggestNextRange();
// Returns: 'Sheet1!A11:Z20' (adjacent to last)

// MCP Elicitation integration
const paramDescriptions = {
  spreadsheetId: {
    description: 'Spreadsheet ID',
    defaultValue: inferred, // Auto-fill with last used
    hint: `Last used: ${inferred}`,
  },
};
```

---

## Layer Interactions

### How Layers Work Together

```typescript
// Layer 1: RequestContext (Protocol)
await runWithContext({ requestId: '123', timeoutMs: 30000 }, async () => {

  // Layer 2: SessionContext (Business)
  const sessionContext = getSessionContext();
  const activeSpreadsheet = sessionContext.getActiveSpreadsheet();

  // Layer 3: ContextManager (Inference)
  const contextManager = new ContextManager();
  const inferredSpreadsheet = contextManager.inferSpreadsheet()
    ?? activeSpreadsheet?.spreadsheetId
    ?? throwError('No spreadsheet context');

  // Use inferred value
  const data = await readSpreadsheet(inferredSpreadsheet);

  // Update all layers
  getContext().logger.info('Read completed', { spreadsheetId: inferredSpreadsheet });
  sessionContext.recordOperation({ tool: 'sheets_data', action: 'read', ... });
  contextManager.recordSpreadsheet(inferredSpreadsheet);
});
```

### Separation of Concerns

| Layer              | Concerns                         | NOT Responsible For                |
| ------------------ | -------------------------------- | ---------------------------------- |
| **RequestContext** | MCP protocol, tracing, timeouts  | Business logic, conversation state |
| **SessionContext** | Conversation state, user context | MCP protocol, parameter caching    |
| **ContextManager** | Parameter inference, defaults    | Conversation history, protocol     |

---

## Design Rationale

### Why Three Layers?

1. **Separation of Concerns**
   - Each layer has distinct responsibilities
   - Changes to MCP protocol don't affect business logic
   - Parameter inference is decoupled from session state

2. **Different Lifetimes**
   - Request: 1-30 seconds
   - Session: minutes to hours
   - Elicitation: seconds to minutes
   - Mixing these would cause memory leaks or stale data

3. **Different Scopes**
   - Request: Thread-local (AsyncLocalStorage)
   - Session: Per-client connection
   - Elicitation: Per-form flow

4. **Testability**
   - Each layer can be tested independently
   - Mock RequestContext without affecting SessionContext
   - Test parameter inference without MCP client

### Alternative Approaches Considered

❌ **Single Unified Context**

- Problem: Lifetime confusion (when to clear what?)
- Problem: Scope mixing (thread-local vs connection-scoped)
- Problem: Tight coupling (protocol changes affect business logic)

❌ **Two Layers (Request + Session)**

- Problem: Where does parameter inference go?
- Problem: SessionContext becomes a dumping ground
- Problem: Can't distinguish conversation state from UI hints

✅ **Three Layers (Current)**

- Clear responsibilities and boundaries
- Independent lifetimes and scopes
- Easy to reason about and test

---

## Common Patterns

### Pattern 1: Conversational Reference Resolution

```typescript
// User says: "Read from the budget"
const sessionContext = getSessionContext();
const spreadsheetId = sessionContext.findSpreadsheetByReference('the budget');
// Uses SessionContext - business logic

// User omits spreadsheet entirely: "Read A1:B10"
const contextManager = new ContextManager();
const inferred = contextManager.inferSpreadsheet();
// Uses ContextManager - parameter inference
```

### Pattern 2: Progress Notifications

```typescript
// MCP-specific progress updates
const ctx = getContext();
await ctx.sendNotification?.({
  method: 'notifications/progress',
  params: {
    progressToken: ctx.progressToken,
    progress: 50,
    total: 100,
  },
});
// Uses RequestContext - protocol layer
```

### Pattern 3: Undo/Redo

```typescript
// User says: "Undo that"
const sessionContext = getSessionContext();
const lastOp = sessionContext.getLastOperation();
await reverseOperation(lastOp);
// Uses SessionContext - conversation history
```

---

## Migration Guide

### From RequestContext to SessionContext

❌ **Wrong**: Storing conversation state in RequestContext

```typescript
// BAD: Dies when request ends
const ctx = getContext();
ctx.activeSpreadsheet = '1ABC'; // Lost after 30 seconds!
```

✅ **Correct**: Use SessionContext

```typescript
// GOOD: Persists across requests
const sessionContext = getSessionContext();
sessionContext.setActiveSpreadsheet({ spreadsheetId: '1ABC', ... });
```

### From SessionContext to ContextManager

❌ **Wrong**: Using SessionContext for parameter caching

```typescript
// BAD: Mixing concerns
sessionContext.lastSpreadsheet = '1ABC'; // Wrong layer!
```

✅ **Correct**: Use ContextManager

```typescript
// GOOD: Proper inference layer
contextManager.recordSpreadsheet('1ABC');
const inferred = contextManager.inferSpreadsheet();
```

---

## Testing

### Unit Testing Each Layer

```typescript
// Layer 1: RequestContext
test('request timeout', () => {
  runWithContext({ timeoutMs: 100 }, async () => {
    await sleep(200);
    // Should timeout
  });
});

// Layer 2: SessionContext
test('resolves spreadsheet reference', () => {
  const ctx = new SessionContextManager();
  ctx.setActiveSpreadsheet({ spreadsheetId: '1ABC', title: 'Budget' });
  expect(ctx.findSpreadsheetByReference('the budget')).toBe('1ABC');
});

// Layer 3: ContextManager
test('infers last used spreadsheet', () => {
  const mgr = new ContextManager();
  mgr.recordSpreadsheet('1ABC');
  expect(mgr.inferSpreadsheet()).toBe('1ABC');
});
```

---

## Future Enhancements

### Potential Improvements

1. **Persistent SessionContext**
   - Store session state in Redis
   - Resume conversations across disconnects
   - Multi-device sync

2. **ML-Powered Inference**
   - Learn user patterns over time
   - Predict next action (not just parameter)
   - Personalized suggestions

3. **Distributed RequestContext**
   - Propagate across microservices
   - W3C Trace Context baggage
   - Cross-service correlation

---

## See Also

- [MCP Elicitation (SEP-1036)](https://github.com/modelcontextprotocol/specification/blob/main/docs/extensions/SEP-1036-elicitation.md)
- [W3C Trace Context](https://www.w3.org/TR/trace-context/)
- [AsyncLocalStorage Documentation](https://nodejs.org/api/async_context.html#class-asynclocalstorage)

---

## Questions?

For questions about context management, see:

- `src/utils/request-context.ts` - Protocol layer implementation
- `src/services/session-context.ts` - Business layer implementation
- `src/services/context-manager.ts` - Inference layer implementation
