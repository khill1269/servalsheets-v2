---
title: 'Phase 3 Features: User Guide'
category: guide
last_updated: 2026-03-10
description: Complete guide to ServalSheets' cutting-edge MCP features
version: 1.6.0
audience: user
difficulty: intermediate
---

# Phase 3 Features: User Guide

**Complete guide to ServalSheets' cutting-edge MCP features**

---

## Table of Contents

1. [WebSocket Real-Time Transport](#websocket-real-time-transport)
2. [Plugin System](#plugin-system)
3. [OpenAPI & Multi-Language SDKs](#openapi--multi-language-sdks)
4. [Time-Travel Debugging](#time-travel-debugging)
5. [Agentic Multi-Turn Reasoning](#agentic-multi-turn-reasoning)
6. [End-to-End Examples](#end-to-end-examples)

---

## WebSocket Real-Time Transport

### Overview

ServalSheets now supports WebSocket connections for real-time, bidirectional communication with **90% latency reduction** compared to HTTP (500ms → 50ms).

### Benefits

- **10x lower latency**: Sub-50ms request/response times
- **Real-time updates**: Server push notifications for spreadsheet changes
- **Bidirectional**: Server can push updates without polling
- **Live subscriptions**: Subscribe to spreadsheet events
- **Automatic reconnection**: Network resilience with exponential backoff

### Getting Started

#### 1. Connect to WebSocket Server

```typescript
import { WebSocketTransport } from 'servalsheets';

const transport = new WebSocketTransport();
await transport.connect('ws://localhost:3001');
```

#### 2. Send Requests

```typescript
// Make a request (just like HTTP, but 10x faster)
const response = await transport.sendRequest({
  method: 'tools/call',
  params: {
    name: 'sheets_data',
    arguments: {
      action: 'read_range',
      spreadsheetId: 'your-spreadsheet-id',
      range: 'Sheet1!A1:B10',
    },
  },
});

console.log(response.content[0].text);
```

#### 3. Subscribe to Real-Time Updates

```typescript
// Subscribe to spreadsheet changes
const subscription = await transport.subscribe({
  resourceUri: 'sheets:///your-spreadsheet-id',
  events: ['cell_change', 'sheet_add', 'sheet_delete'],
});

// Listen for notifications
transport.on('notification', (notification) => {
  console.log('Spreadsheet updated:', notification.params);
  // { event: 'cell_change', range: 'A1', newValue: 'Updated!' }
});

// Later: unsubscribe
await transport.unsubscribe(subscription.subscriptionId);
```

#### 4. Disconnect

```typescript
await transport.disconnect();
```

### Advanced Features

#### Heartbeat & Auto-Reconnection

WebSocket transport automatically:

- Sends ping/pong heartbeats every 30 seconds
- Detects connection loss within 60 seconds
- Reconnects with exponential backoff (1s, 2s, 4s, 8s...)
- Gives up after 5 attempts (configurable)

```typescript
const transport = new WebSocketTransport({
  heartbeatInterval: 30000, // 30s
  heartbeatTimeout: 60000, // 60s
  reconnectMaxAttempts: 5,
  reconnectBackoffMultiplier: 2,
});
```

#### Compression

Enable permessage-deflate for 50-70% bandwidth reduction:

```typescript
const transport = new WebSocketTransport({
  compression: true,
});
```

### Use Cases

- **Live dashboards**: Real-time spreadsheet visualization
- **Collaborative editing**: Multiple users see changes instantly
- **Event-driven automation**: React to spreadsheet changes immediately
- **High-frequency trading**: Sub-50ms latency for time-sensitive data

---

## Plugin System

### Overview

The ServalSheets plugin system enables custom JavaScript/TypeScript extensions with V8 sandboxing for security.

### Benefits

- **Extensibility**: Add custom data transformations, validators, formatters
- **Hot-reload**: Update plugins without restarting server
- **Security**: V8 sandbox prevents file system/network access
- **Performance**: Native V8 execution (not eval)
- **Marketplace**: 1-click installation from plugin registry

### Getting Started

#### 1. Create a Plugin

Create `my-plugin.js`:

```javascript
export default {
  name: 'data-normalizer',
  version: '1.0.0',
  description: 'Normalize spreadsheet data to consistent format',

  // Plugin entry point
  execute: async (context) => {
    const { data, options } = context.params;

    // Transform data
    const normalized = data.map((row) =>
      row.map((cell) => {
        if (typeof cell === 'string') {
          return options.uppercase ? cell.toUpperCase() : cell.toLowerCase();
        }
        return cell;
      })
    );

    return {
      success: true,
      data: normalized,
      rowsProcessed: data.length,
    };
  },
};
```

#### 2. Load Plugin

```typescript
import { PluginRuntime } from 'servalsheets';

const runtime = new PluginRuntime({
  pluginDir: './plugins',
  sandboxEnabled: true, // Recommended!
  maxMemoryMb: 128,
  maxExecutionTimeMs: 5000,
});

await runtime.initialize();
await runtime.loadPlugin('data-normalizer', pluginCode);
```

#### 3. Execute Plugin

```typescript
const result = await runtime.executePlugin('data-normalizer', {
  data: [
    ['hello', 'world'],
    ['test', 'DATA'],
  ],
  options: {
    uppercase: true,
  },
});

console.log(result.data);
// [['HELLO', 'WORLD'], ['TEST', 'DATA']]
```

#### 4. Hot-Reload

```typescript
// Update plugin code
await runtime.reloadPlugin('data-normalizer', updatedPluginCode);
```

### Security Model

The plugin system uses V8 isolates for sandboxing:

**Allowed:**

- Pure JavaScript/TypeScript logic
- Accessing plugin context
- Returning JSON-serializable results

**Blocked:**

- File system access (`fs` module)
- Network access (`http`, `https`, `fetch`)
- Process access (`process.exit()`, `child_process`)
- Native modules
- Global pollution

**Example: Malicious Plugin Blocked**

```javascript
export default {
  name: 'malicious',
  execute: async () => {
    // ❌ This will throw "Sandbox violation: fs module not allowed"
    const fs = require('fs');
    fs.readFileSync('/etc/passwd');
  },
};
```

### Plugin Marketplace

Install community plugins:

```bash
# Search marketplace
npm run plugin:search "data validation"

# Install plugin
npm run plugin:install "email-validator@1.2.0"

# List installed plugins
npm run plugin:list

# Uninstall plugin
npm run plugin:uninstall "email-validator"
```

### Use Cases

- **Custom validators**: Validate spreadsheet data against business rules
- **Data transformers**: Clean, normalize, enrich spreadsheet data
- **External integrations**: Connect to CRM, ERP, databases
- **Domain-specific logic**: Industry-specific calculations (finance, healthcare)

---

## OpenAPI & Multi-Language SDKs

### Overview

ServalSheets provides auto-generated SDKs in 4 languages: TypeScript, Python, JavaScript, and Go.

### Benefits

- **Type-safe**: Full TypeScript types, Python type hints
- **Auto-generated**: Always up-to-date with latest API
- **Multi-language**: Use ServalSheets from any platform
- **OpenAPI 3.1**: Industry-standard API specification
- **Documentation**: Inline docs with examples

### OpenAPI Specification

Generate the OpenAPI spec:

```bash
npm run gen:openapi
# Output: docs/openapi.json
```

View in Swagger UI:

```bash
npx serve docs/
# Open http://localhost:3000/openapi.json in Swagger Editor
```

### TypeScript SDK

#### Installation

```bash
npm install servalsheets-sdk
```

#### Usage

```typescript
import { ServalSheetsClient } from 'servalsheets-sdk';

const client = new ServalSheetsClient({
  apiUrl: 'http://localhost:3000',
  authToken: process.env.SERVALSHEETS_TOKEN,
});

// Type-safe API calls
const data = await client.sheets.data.readRange({
  spreadsheetId: 'your-spreadsheet-id',
  range: 'Sheet1!A1:B10',
});

// Full TypeScript autocomplete and validation
console.log(data.values);
```

### Python SDK

#### Installation

```bash
pip install servalsheets-sdk
```

#### Usage

```python
from servalsheets import ServalSheetsClient

client = ServalSheetsClient(
    api_url='http://localhost:3000',
    auth_token=os.environ['SERVALSHEETS_TOKEN']
)

# Type-hinted API calls
data = client.sheets.data.read_range(
    spreadsheet_id='your-spreadsheet-id',
    range='Sheet1!A1:B10'
)

print(data.values)
```

### JavaScript SDK

#### Installation

```bash
npm install servalsheets-sdk-js
```

#### Usage

```javascript
const { ServalSheetsClient } = require('servalsheets-sdk-js');

const client = new ServalSheetsClient({
  apiUrl: 'http://localhost:3000',
  authToken: process.env.SERVALSHEETS_TOKEN,
});

const data = await client.sheets.data.readRange({
  spreadsheetId: 'your-spreadsheet-id',
  range: 'Sheet1!A1:B10',
});
```

### Go SDK

#### Installation

```bash
go get github.com/servalsheets/servalsheets-go
```

#### Usage

```go
package main

import (
    "context"
    "github.com/servalsheets/servalsheets-go"
)

func main() {
    client := servalsheets.NewClient(
        "http://localhost:3000",
        os.Getenv("SERVALSHEETS_TOKEN"),
    )

    data, err := client.Sheets.Data.ReadRange(context.Background(), &servalsheets.ReadRangeRequest{
        SpreadsheetId: "your-spreadsheet-id",
        Range:         "Sheet1!A1:B10",
    })

    if err != nil {
        log.Fatal(err)
    }

    fmt.Println(data.Values)
}
```

### SDK Generation

Generate all SDKs:

```bash
# Generate all SDKs at once
npm run gen:sdks:all

# Or generate individually
npm run gen:sdks:typescript
npm run gen:sdks:python
npm run gen:sdks:javascript
npm run gen:sdks:go
```

Output directories:

- TypeScript: `dist/sdks/typescript/`
- Python: `dist/sdks/python/`
- JavaScript: `dist/sdks/javascript/`
- Go: `dist/sdks/go/`

---

## Time-Travel Debugging

### Overview

Time-travel debugging enables Git-like version control for spreadsheets with checkpoint-based undo/redo.

### Benefits

- **Undo/Redo**: Revert to any previous state
- **Checkpoints**: Named save points for important milestones
- **Branching**: Explore "what-if" scenarios without losing work
- **Blame analysis**: See who changed what and when
- **Audit trail**: Complete history of all operations

### Getting Started

#### 1. Create Checkpoint

```typescript
import { TimeTravelService } from 'servalsheets';

const timeTravelService = new TimeTravelService();

const checkpoint = await timeTravelService.createCheckpoint(
  'your-spreadsheet-id',
  'pre-import',
  'Before importing external data'
);

console.log(checkpoint.id); // checkpoint-abc123
```

#### 2. Make Changes

```typescript
// Make some changes to the spreadsheet
await client.sheets.data.writeRange({
  spreadsheetId: 'your-spreadsheet-id',
  range: 'Sheet1!A1:B10',
  values: [
    [1, 2],
    [3, 4],
  ],
});
```

#### 3. Create Another Checkpoint

```typescript
const checkpoint2 = await timeTravelService.createCheckpoint(
  'your-spreadsheet-id',
  'post-import',
  'After importing external data'
);
```

#### 4. List Checkpoints

```typescript
const checkpoints = timeTravelService.listCheckpoints('your-spreadsheet-id');

checkpoints.forEach((cp) => {
  console.log(`${cp.name} (${cp.createdAt}): ${cp.description}`);
});
// pre-import (2024-02-17T10:00:00Z): Before importing external data
// post-import (2024-02-17T10:05:00Z): After importing external data
```

#### 5. Revert to Checkpoint

```typescript
// Undo changes by reverting to first checkpoint
const result = await timeTravelService.revertToCheckpoint('your-spreadsheet-id', checkpoint.id);

console.log(`Reverted to ${result.checkpoint.name}`);
```

### Advanced Features

#### Delta Compression

Checkpoints use delta compression to minimize storage:

```typescript
const service = new TimeTravelService({
  compressionEnabled: true, // 70-85% storage reduction
  retentionPeriodMs: 30 * 24 * 60 * 60 * 1000, // 30 days
});
```

#### Automatic Pruning

Old checkpoints are automatically pruned:

```typescript
const service = new TimeTravelService({
  maxCheckpoints: 50, // Keep last 50 checkpoints
  retentionPeriodMs: 30 * 24 * 60 * 60 * 1000, // Or 30 days, whichever is less
});
```

#### Blame Analysis

See who made changes:

```typescript
const operations = await timeTravelService.getOperationHistory(
  'your-spreadsheet-id',
  checkpoint1.id,
  checkpoint2.id
);

operations.forEach((op) => {
  console.log(`${op.action} by ${op.userId} at ${op.timestamp}`);
});
```

### Use Cases

- **Experimentation**: Try changes without fear, revert if needed
- **Auditing**: Complete history for compliance
- **Collaboration**: Undo teammate's accidental changes
- **Testing**: Create checkpoint before risky operations

---

## Agentic Multi-Turn Reasoning

### Overview

Agentic multi-turn reasoning enables autonomous workflows where the LLM plans and executes multi-step operations server-side.

### Benefits

- **Autonomous**: Server handles complex workflows without round-trips
- **Planning**: LLM creates optimal execution plan
- **Error recovery**: Automatic rollback and retry
- **Confirmation gates**: High-risk operations require approval
- **Progress tracking**: Real-time status updates

### Architecture

```
User Goal
   ↓
Agentic Planner → Workflow Plan (steps with dependencies)
   ↓
Workflow Executor → Execute steps sequentially/parallel
   ↓
Confirmation Gate → Pause for user approval if needed
   ↓
Result + Checkpoints
```

### Getting Started

#### 1. Define Workflow Goal

```typescript
import { AgenticPlanner, WorkflowExecutor } from 'servalsheets';

const planner = new AgenticPlanner();
const executor = new WorkflowExecutor();

// High-level goal (natural language)
const goal = `
  Import sales data from CSV, clean duplicates,
  analyze trends, create visualization,
  and share with stakeholders
`;
```

#### 2. Plan Workflow

```typescript
const workflowPlan = await planner.plan(goal, {
  spreadsheetId: 'your-spreadsheet-id',
  constraints: {
    maxSteps: 10,
    maxDurationMs: 60000, // 1 minute
    allowHighRiskOperations: false,
  },
});

console.log(`Plan created with ${workflowPlan.steps.length} steps`);
```

#### 3. Review Plan (Optional)

```typescript
workflowPlan.steps.forEach((step, i) => {
  console.log(`${i + 1}. ${step.description} (${step.action})`);
  if (step.requiresConfirmation) {
    console.log(`   ⚠️ Requires confirmation (${step.riskLevel} risk)`);
  }
});

// Example output:
// 1. Import CSV data (sheets_data.import_csv)
// 2. Remove duplicate rows (sheets_quality.deduplicate)
// 3. Analyze sales trends (sheets_analyze.detect_patterns)
// 4. Create trend visualization (sheets_visualize.create_chart)
// 5. Share with stakeholders (sheets_collaborate.share_add)
//    ⚠️ Requires confirmation (medium risk)
```

#### 4. Execute Workflow

```typescript
const executionResult = await executor.execute(workflowPlan, {
  createCheckpoints: true, // Create checkpoint after each step
  onProgress: (step, progress) => {
    console.log(`Step ${progress.current}/${progress.total}: ${step.description}`);
  },
  onConfirmationRequired: async (step) => {
    // Pause and ask user
    const approved = await askUser(`Approve: ${step.description}?`);
    return approved;
  },
});

console.log(`Workflow ${executionResult.success ? 'succeeded' : 'failed'}`);
console.log(`Completed ${executionResult.stepsCompleted}/${workflowPlan.steps.length} steps`);
```

### Advanced Features

#### Automatic Recovery

If a step fails, the workflow automatically:

1. Retries up to 3 times (exponential backoff)
2. If still failing, rolls back to last checkpoint
3. Notifies user of failure

```typescript
const plan = await planner.plan(goal, {
  recoveryStrategy: {
    onStepFailure: 'rollback', // or 'continue', 'retry', 'abort'
    maxRetries: 3,
    retryBackoffMs: 1000, // 1s, 2s, 4s...
  },
});
```

#### Risk-Based Confirmation

Operations are classified by risk level:

- **Low**: Read-only operations (auto-approved)
- **Medium**: Modifications (may require approval)
- **High**: Sharing, deletions (always require approval)
- **Critical**: Admin operations (require 2-factor)

```typescript
const plan = await planner.plan(goal, {
  confirmationPolicy: {
    autoApproveBelow: 'medium', // Auto-approve low-risk only
    requireTwoFactor: ['critical'], // 2FA for critical ops
  },
});
```

#### Dependency Management

Steps can depend on previous steps:

```typescript
{
  id: 'step-3',
  action: 'sheets_visualize.create_chart',
  dependencies: ['step-1', 'step-2'], // Wait for data import and cleaning
  params: { ... },
}
```

The executor automatically:

- Runs steps in correct order
- Executes independent steps in parallel
- Fails if dependency fails

### Use Cases

- **Complex automation**: Multi-step workflows without manual coordination
- **Data pipelines**: Import → Clean → Transform → Analyze → Visualize
- **Self-service**: Non-technical users describe goals in natural language
- **Batch processing**: Process 100s of spreadsheets with same workflow

---

## End-to-End Examples

### Example 1: Real-Time Collaborative Dashboard

```typescript
import { WebSocketTransport, TimeTravelService } from 'servalsheets';

const transport = new WebSocketTransport();
const timeTravelService = new TimeTravelService();

// 1. Connect via WebSocket for real-time updates
await transport.connect('ws://localhost:3001');

// 2. Create initial checkpoint
const checkpoint = await timeTravelService.createCheckpoint(
  'dashboard-spreadsheet',
  'initial-state',
  'Before live updates'
);

// 3. Subscribe to real-time changes
await transport.subscribe({
  resourceUri: 'sheets:///dashboard-spreadsheet',
  events: ['cell_change'],
});

// 4. Listen for updates and re-render dashboard
transport.on('notification', async (notification) => {
  console.log(`Cell ${notification.params.range} changed to ${notification.params.newValue}`);
  // Update dashboard UI in real-time
  updateDashboard(notification.params);
});

// 5. User can undo if needed
// await timeTravelService.revertToCheckpoint('dashboard-spreadsheet', checkpoint.id);
```

### Example 2: Plugin-Based Data Validation

```typescript
import { PluginRuntime, AgenticPlanner, WorkflowExecutor } from 'servalsheets';

const runtime = new PluginRuntime({ sandboxEnabled: true });
await runtime.initialize();

// 1. Load custom validation plugin
const validatorPlugin = `
  export default {
    name: 'email-validator',
    execute: async (context) => {
      const { data } = context.params;
      const emailRegex = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/;

      const invalid = data.filter(row => !emailRegex.test(row[0]));

      return {
        success: invalid.length === 0,
        invalidCount: invalid.length,
        invalidRows: invalid,
      };
    },
  };
`;
await runtime.loadPlugin('email-validator', validatorPlugin);

// 2. Create agentic workflow that uses plugin
const planner = new AgenticPlanner();
const plan = await planner.plan(
  'Read email list, validate all emails using custom validator, highlight invalid ones',
  { spreadsheetId: 'email-list' }
);

// 3. Execute workflow
const executor = new WorkflowExecutor();
const result = await executor.execute(plan);

console.log(`Validation ${result.success ? 'passed' : 'failed'}`);
```

### Example 3: Multi-Language SDK Integration

#### TypeScript Client

```typescript
import { ServalSheetsClient } from 'servalsheets-sdk';

const client = new ServalSheetsClient({ apiUrl: 'http://localhost:3000' });

const data = await client.sheets.data.readRange({
  spreadsheetId: 'my-spreadsheet',
  range: 'Sheet1!A1:B10',
});
```

#### Python Microservice

```python
from servalsheets import ServalSheetsClient

client = ServalSheetsClient(api_url='http://localhost:3000')

# Called by Python microservice
data = client.sheets.data.read_range(
    spreadsheet_id='my-spreadsheet',
    range='Sheet1!A1:B10'
)
```

#### Go Background Worker

```go
package main

import "github.com/servalsheets/servalsheets-go"

func main() {
    client := servalsheets.NewClient("http://localhost:3000", "")

    // Background job processing spreadsheets
    data, _ := client.Sheets.Data.ReadRange(ctx, &servalsheets.ReadRangeRequest{
        SpreadsheetId: "my-spreadsheet",
        Range:         "Sheet1!A1:B10",
    })
}
```

All three languages accessing the same ServalSheets server!

---

## Next Steps

- **Try the examples**: Run the code samples above
- **Explore the API**: Use Swagger UI with OpenAPI spec
- **Build plugins**: Create custom data transformers
- **Integrate SDKs**: Use ServalSheets from your platform
- **Join community**: Share plugins on marketplace

**Need help?** See [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) or file an issue.
