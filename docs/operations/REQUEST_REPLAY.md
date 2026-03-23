---
title: Request Replay System
category: runbook
last_updated: 2026-03-10
description: 'Purpose: Debug and analyze failed MCP operations by replaying recorded requests with timing preservation and response comparison.'
version: 1.6.0
estimated_time: 15-30 minutes
---

# Request Replay System

**Purpose**: Debug and analyze failed MCP operations by replaying recorded requests with timing preservation and response comparison.

---

## Overview

The Request Replay system automatically records all MCP tool calls to a SQLite database and provides CLI tools to:

- **Replay** individual or batches of requests
- **Compare** original vs replayed responses
- **Analyze** request patterns and failures
- **Preserve timing** for realistic replay scenarios

---

## Quick Start

### 1. Enable Recording (Default: ON)

Recording is enabled by default. To disable:

```bash
export RECORD_REQUESTS=false
```

### 2. List Recorded Requests

```bash
npm run replay:list
npm run replay:list -- --tool sheets_data
npm run replay:list -- --action read --limit 20
npm run replay:list -- --errors  # Only failed requests
```

### 3. Replay a Request

```bash
# Replay with maximum speed (no timing delays)
npm run replay:run 123

# Replay with original timing
npm run replay:run 123 -- --mode realtime

# Replay at 10x speed
npm run replay:run 123 -- --mode 10x
```

### 4. View Request Details

```bash
npm run replay:show 123
```

---

## CLI Commands

### List Requests

```bash
npm run replay:list [options]

Options:
  -t, --tool <tool>         Filter by tool name (e.g., sheets_data)
  -a, --action <action>     Filter by action (e.g., read)
  -s, --spreadsheet <id>    Filter by spreadsheet ID
  -e, --errors              Show only failed requests
  -l, --limit <n>           Limit results (default: 50)

Examples:
  npm run replay:list -- --tool sheets_data --limit 10
  npm run replay:list -- --spreadsheet abc123
  npm run replay:list -- --errors
```

### Show Request Details

```bash
npm run replay:show <id>

Displays:
  - Request metadata (tool, action, timestamp, duration)
  - Full request body (JSON)
  - Full response body (JSON)
  - Error message (if failed)

Example:
  npm run replay:show 42
```

### Replay Single Request

```bash
npm run replay:run <id> [options]

Options:
  -m, --mode <mode>    Replay mode: realtime, 10x, max (default: max)
  --no-compare         Skip response comparison

Replay Modes:
  - realtime: Preserve original timing (same delays between requests)
  - 10x: 10x faster than realtime
  - max: No delays, maximum speed

Example:
  npm run replay:run 42 -- --mode realtime
```

### Replay Batch

```bash
npm run replay:batch [options]

Options:
  -t, --tool <tool>         Filter by tool name
  -a, --action <action>     Filter by action
  -s, --spreadsheet <id>    Filter by spreadsheet ID
  -l, --limit <n>           Limit requests (default: 10)
  -m, --mode <mode>         Replay mode: realtime, 10x, max (default: max)

Example:
  npm run replay:batch -- --tool sheets_data --limit 5 --mode 10x
```

### Statistics

```bash
npm run replay:stats

Displays:
  - Total requests recorded
  - Error count
  - Date range (earliest/latest)
  - Requests by tool
  - Requests by status code
```

### Cleanup

```bash
npm run replay:cleanup [options]

Options:
  -d, --days <n>    Delete requests older than N days (default: 30)

Example:
  npm run replay:cleanup -- --days 7
```

---

## Database Schema

Location: `.data/requests.db` (SQLite)

```sql
CREATE TABLE recorded_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp INTEGER NOT NULL,              -- Unix timestamp (ms)
  tool_name TEXT NOT NULL,                  -- MCP tool name
  action TEXT NOT NULL,                     -- Action discriminator
  spreadsheet_id TEXT,                      -- Spreadsheet ID (if applicable)
  request_body TEXT NOT NULL,               -- JSON request
  response_body TEXT NOT NULL,              -- JSON response
  status_code INTEGER NOT NULL,             -- HTTP-like status (200, 500, etc.)
  duration_ms INTEGER NOT NULL,             -- Request duration
  error_message TEXT,                       -- Error message (if failed)
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX idx_timestamp ON recorded_requests(timestamp);
CREATE INDEX idx_tool_action ON recorded_requests(tool_name, action);
CREATE INDEX idx_spreadsheet ON recorded_requests(spreadsheet_id);
CREATE INDEX idx_status ON recorded_requests(status_code);
```

---

## Programmatic Usage

### Recording Requests

Recording happens automatically in `tool-handlers.ts`:

```typescript
import { getRequestRecorder } from './services/request-recorder.js';

const recorder = getRequestRecorder();

// Record a request/response
recorder.record({
  timestamp: Date.now(),
  tool_name: 'sheets_data',
  action: 'read',
  spreadsheet_id: 'abc123',
  request_body: JSON.stringify(request),
  response_body: JSON.stringify(response),
  status_code: 200,
  duration_ms: 150,
  error_message: null,
});
```

### Replaying Requests

```typescript
import { createReplayEngine, type ToolExecutor } from './services/replay-engine.js';

// Create tool executor
const executor: ToolExecutor = {
  async execute(toolName: string, request: any): Promise<any> {
    // Execute tool and return response
    return await handlers[toolName].executeAction(request);
  },
};

// Create replay engine
const engine = createReplayEngine(executor);

// Replay single request
const result = await engine.replaySingle(42, 'max');

if (result.success && result.diff) {
  console.log('Response differences:', result.diff);
}

// Replay batch
const batchResult = await engine.replayBatch([1, 2, 3], '10x', (result, index, total) => {
  console.log(
    `[${index}/${total}] Request ${result.requestId} - ${result.success ? 'OK' : 'FAIL'}`
  );
});
```

### Response Comparison

```typescript
import { diffResponses, formatDiffReport } from './utils/response-diff.js';

const original = { success: true, values: [['A', 'B']] };
const actual = { success: true, values: [['A', 'C']] };

const diff = diffResponses(original, actual);

console.log(diff.identical); // false
console.log(diff.changeCount); // 1
console.log(diff.modifications); // [{ type: 'modified', path: 'values[0][1]', ... }]

// Human-readable report
console.log(formatDiffReport(diff));
// ❌ Responses differ: 1 change(s) detected: 1 modification(s)
// 🔄 Modifications:
//   Modified: values[0][1] from "B" to "C"
```

---

## Integration with MCP Server

### HTTP Server Integration

Add recording middleware in `http-server.ts`:

```typescript
import { getRequestRecorder } from './services/request-recorder.js';

app.use(async (req, res, next) => {
  const recorder = getRequestRecorder();

  // Capture original response
  const originalSend = res.send;
  let responseBody: any;

  res.send = function (data) {
    responseBody = data;
    return originalSend.call(this, data);
  };

  // Record after response
  res.on('finish', () => {
    recorder.record({
      timestamp: Date.now(),
      tool_name: extractToolName(req),
      action: extractAction(req),
      spreadsheet_id: extractSpreadsheetId(req),
      request_body: JSON.stringify(req.body),
      response_body: JSON.stringify(responseBody),
      status_code: res.statusCode,
      duration_ms: Date.now() - req.startTime,
      error_message: res.statusCode >= 400 ? extractError(responseBody) : null,
    });
  });

  next();
});
```

### STDIO Server Integration

In `tool-handlers.ts`, wrap tool execution:

```typescript
import { getRequestRecorder } from './services/request-recorder.js';

async function handleToolCall(toolName: string, args: any): Promise<any> {
  const recorder = getRequestRecorder();
  const startTime = Date.now();

  try {
    const response = await executeToolInternal(toolName, args);

    recorder.record({
      timestamp: startTime,
      tool_name: toolName,
      action: args.request?.action || 'unknown',
      spreadsheet_id: args.request?.spreadsheetId || null,
      request_body: JSON.stringify(args),
      response_body: JSON.stringify(response),
      status_code: 200,
      duration_ms: Date.now() - startTime,
      error_message: null,
    });

    return response;
  } catch (error) {
    recorder.record({
      timestamp: startTime,
      tool_name: toolName,
      action: args.request?.action || 'unknown',
      spreadsheet_id: args.request?.spreadsheetId || null,
      request_body: JSON.stringify(args),
      response_body: JSON.stringify({ error: String(error) }),
      status_code: 500,
      duration_ms: Date.now() - startTime,
      error_message: error instanceof Error ? error.message : String(error),
    });

    throw error;
  }
}
```

---

## Use Cases

### 1. Debug Intermittent Failures

```bash
# Find all failed requests
npm run replay:list -- --errors

# Replay failed request to reproduce
npm run replay:run 42

# Compare original vs replayed response
# Diff will show what changed
```

### 2. Performance Regression Analysis

```bash
# Find all requests for a specific spreadsheet
npm run replay:list -- --spreadsheet abc123 --limit 100

# Replay batch and compare durations
npm run replay:batch -- --spreadsheet abc123 --mode max
```

### 3. Integration Testing

```bash
# Capture production requests
export RECORD_REQUESTS=true

# Later, replay in staging environment
npm run replay:batch -- --tool sheets_data --limit 50
```

### 4. API Contract Validation

```bash
# Replay old requests against new code
npm run replay:batch -- --limit 100

# Check for breaking changes in responses
# Diff will highlight any schema changes
```

---

## Configuration

### Environment Variables

```bash
# Disable request recording
RECORD_REQUESTS=false

# Custom database path (default: .data/requests.db)
REQUEST_DB_PATH=/path/to/custom.db

# Required for replay (Google API access)
GOOGLE_ACCESS_TOKEN=ya29.xxx
GOOGLE_REFRESH_TOKEN=1//xxx
```

### Automatic Cleanup

Schedule cleanup via cron:

```bash
# Delete requests older than 7 days (runs daily at 2am)
0 2 * * * cd /path/to/servalsheets && npm run replay:cleanup -- --days 7
```

---

## Troubleshooting

### Database Locked

**Symptom**: `Error: database is locked`

**Solution**: Close other connections or enable WAL mode (already enabled by default)

### Replay Fails with Auth Error

**Symptom**: `Error: GOOGLE_ACCESS_TOKEN environment variable is required`

**Solution**: Set Google OAuth tokens in environment:

```bash
export GOOGLE_ACCESS_TOKEN="ya29.xxx"
export GOOGLE_REFRESH_TOKEN="1//xxx"
npm run replay:run 42
```

### Large Database File

**Symptom**: `.data/requests.db` grows too large

**Solution**: Run cleanup regularly:

```bash
npm run replay:cleanup -- --days 7
```

---

## Performance Considerations

- **Recording overhead**: <1ms per request (WAL mode, prepared statements)
- **Database size**: ~1KB per request (depends on request/response size)
- **Replay speed**: Depends on mode
  - `max`: No delays, ~50-100 requests/sec
  - `10x`: Original timing / 10
  - `realtime`: Original timing

---

## Related Documentation

- [Error Handling Guide](../guides/ERROR_HANDLING.md)
- [Testing Strategy](../development/TESTING_STRATEGY.md)
- [Performance Optimization](../development/PERFORMANCE.md)

---

**Last Updated**: 2026-02-17 | **Version**: 1.0.0
