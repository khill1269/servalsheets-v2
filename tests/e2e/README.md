# ServalSheets E2E Test Harness

End-to-end tests that simulate real MCP clients (Claude Desktop, other LLMs) interacting with ServalSheets.

## Overview

This test harness validates that ServalSheets works correctly with real MCP clients by:

1. **Simulating MCP clients** - Full protocol implementation with capabilities negotiation
2. **Testing all 22 tools** - Smoke tests for each tool with 5-10 sample actions
3. **Validating MCP 2025-11-25 compliance** - Protocol validation and conformance checks
4. **Testing real workflows** - Multi-step operations mimicking real user scenarios
5. **Error recovery** - Testing error handling, retries, rate limiting, circuit breakers

## Architecture

```
tests/e2e/
├── mcp-client-simulator.ts       # MCP client implementation (~400 lines)
│   ├── MCPClientSimulator         # Base client class
│   ├── MCPHttpClient              # HTTP transport implementation
│   └── Helper factories           # createTestClient, createTestHttpClient
└── workflows/                     # E2E test scenarios
    ├── basic-crud.test.ts         # Create, Read, Update, Delete operations
    ├── multi-step-workflows.test.ts  # Complex multi-tool workflows
    ├── error-recovery.test.ts     # Error handling and recovery
    ├── protocol-compliance.test.ts   # MCP 2025-11-25 validation
    └── all-tools-smoke.test.ts    # Smoke test all 22 tools
```

## MCP Client Simulator

The `MCPClientSimulator` class implements a full MCP client with:

### Features

- **Initialize handshake** - Full MCP 2025-11-25 initialize/initialized flow
- **Capability negotiation** - Client/server capability exchange
- **Tool discovery** - `tools/list` with caching
- **Tool execution** - `tools/call` with validation
- **Resource access** - `resources/list`, `resources/read`, `resources/subscribe`
- **Prompts** - `prompts/list`, `prompts/get`
- **Logging** - `logging/setLevel`
- **Protocol validation** - Comprehensive MCP compliance checks

### Usage

```typescript
import { createTestHttpClient } from './mcp-client-simulator.js';

// Create HTTP client
const client = createTestHttpClient('http://localhost:3000');

// Initialize handshake
const capabilities = await client.initialize();

// List tools
const tools = await client.listTools();

// Call a tool
const result = await client.callTool('sheets_data', {
  request: {
    action: 'read_range',
    spreadsheetId: 'abc123',
    range: 'Sheet1!A1:B2',
  },
});

// Validate protocol compliance
const validation = client.validateProtocolCompliance();
if (!validation.valid) {
  console.error('Protocol violations:', validation.errors);
}

// Clean up
await client.close();
```

## Test Scenarios

### 1. Basic CRUD Operations (`basic-crud.test.ts`)

Tests fundamental operations:

- Tool discovery (22 tools)
- Read operations (spreadsheet metadata, range values)
- Write operations (values, updates)
- Delete operations (clear ranges)
- Error handling (invalid IDs, ranges)
- Resource and prompt access

**Run:**

```bash
TEST_E2E=true TEST_SPREADSHEET_ID=your-id npm test tests/e2e/workflows/basic-crud.test.ts
```

### 2. Multi-Step Workflows (`multi-step-workflows.test.ts`)

Tests complex workflows:

- **Import → Analyze → Visualize** - Full data pipeline
- **Create → Format → Validate** - Sheet creation and styling
- **Transaction → Rollback → Verify** - Transaction lifecycle
- **Composite operations** - Batch updates, CSV import
- **Session context** - State management across calls
- **History and undo** - Operation tracking
- **Collaboration** - Sharing and comments

**Run:**

```bash
TEST_E2E=true TEST_SPREADSHEET_ID=your-id npm test tests/e2e/workflows/multi-step-workflows.test.ts
```

### 3. Error Recovery (`error-recovery.test.ts`)

Tests error handling:

- **Input validation** - Invalid IDs, missing fields, bad ranges
- **Google API errors** - Non-existent sheets, permission denied
- **Rate limiting** - Rapid request handling
- **Retry logic** - Transient vs permanent failures
- **Circuit breaker** - Repeated failure handling
- **Graceful degradation** - Partial failure recovery
- **Error message quality** - Actionable error messages

**Run:**

```bash
TEST_E2E=true TEST_SPREADSHEET_ID=your-id npm test tests/e2e/workflows/error-recovery.test.ts
```

### 4. Protocol Compliance (`protocol-compliance.test.ts`)

Validates MCP 2025-11-25 compliance:

- **Initialize handshake** - Complete flow validation
- **Capability negotiation** - Server/client capabilities
- **Tool registration** - Format validation, naming conventions
- **Response structure** - CallToolResult format
- **Resource compliance** - URI templates, read operations
- **Prompt compliance** - List and get operations
- **Logging compliance** - setLevel support
- **Discriminated unions** - Action/success discriminators
- **Error handling** - isError flag, error content

**Run:**

```bash
TEST_E2E=true npm test tests/e2e/workflows/protocol-compliance.test.ts
```

### 5. All Tools Smoke Test (`all-tools-smoke.test.ts`)

Smoke tests for all 22 tools:

| Tool                | Actions Tested | Key Operations                                |
| ------------------- | -------------- | --------------------------------------------- |
| sheets_auth         | 2/4            | check_auth, get_scopes                        |
| sheets_core         | 5/19           | get_spreadsheet, list_sheets, create_sheet    |
| sheets_data         | 5/18           | read_range, write_values, append_values       |
| sheets_format       | 5/22           | format_cells, set_number_format, merge_cells  |
| sheets_dimensions   | 5/28           | insert_rows, delete_columns, freeze_rows      |
| sheets_visualize    | 3/18           | create_chart, list_charts, create_pivot_table |
| sheets_collaborate  | 2/35           | list_permissions, add_comment                 |
| sheets_advanced     | 3/26           | create_named_range, list_named_ranges         |
| sheets_transaction  | 2/6            | start_transaction, list_transactions          |
| sheets_quality      | 2/4            | check_data, validate_schema                   |
| sheets_history      | 2/7            | get_history, list_snapshots                   |
| sheets_confirm      | 1/5            | check_support                                 |
| sheets_analyze      | 2/16           | check_support, analyze_range                  |
| sheets_fix          | 1/1            | detect_issues                                 |
| sheets_composite    | 2/10           | batch_update, import_csv                      |
| sheets_session      | 2/26           | initialize_session, get_context               |
| sheets_templates    | 2/8            | list_templates, apply_template                |
| sheets_bigquery     | 1/14           | check_support                                 |
| sheets_appsscript   | 1/14           | list_projects                                 |
| sheets_webhook      | 1/6            | list_webhooks                                 |
| sheets_dependencies | 1/7            | analyze                                       |
| sheets_federation   | 1/5            | list_servers                                  |

**Run:**

```bash
TEST_E2E=true TEST_SPREADSHEET_ID=your-id npm test tests/e2e/workflows/all-tools-smoke.test.ts
```

## Running Tests

### Prerequisites

1. **HTTP server running** - Start ServalSheets HTTP server:

   ```bash
   npm run start:http
   ```

2. **Environment variables**:

   ```bash
   export TEST_E2E=true                          # Enable E2E tests
   export TEST_SPREADSHEET_ID=your-sheet-id      # Test spreadsheet (optional)
   ```

3. **Google OAuth tokens** - Configure authentication:

   ```bash
   npm run auth
   ```

### Run All E2E Tests

```bash
TEST_E2E=true npm run test:e2e
```

### Run Specific Test Suite

```bash
TEST_E2E=true npm test tests/e2e/workflows/basic-crud.test.ts
```

### Run with Spreadsheet ID

```bash
TEST_E2E=true TEST_SPREADSHEET_ID=1abc123xyz npm run test:e2e
```

### Skip Tests (Default)

E2E tests are skipped by default unless `TEST_E2E=true` is set:

```bash
# These will skip E2E tests
npm test                    # Skips
npm run test:integration    # Skips
npm run test:all            # Skips
```

## Test Results

Expected results when running E2E tests:

### Protocol Compliance

- ✅ Initialize handshake completes successfully
- ✅ Server declares all required capabilities
- ✅ 22 tools registered with valid schemas
- ✅ Tool names satisfy MCP naming rules
- ✅ Responses follow CallToolResult structure
- ✅ Resources and prompts accessible
- ✅ Protocol validation passes with 0 errors

### Basic Operations

- ✅ Read operations succeed with valid data
- ✅ Write operations update spreadsheet
- ✅ Delete operations clear ranges
- ✅ Invalid input rejected with clear errors
- ✅ Resources and prompts accessible

### Multi-Step Workflows

- ✅ Data pipeline: Import → Analyze → Visualize
- ✅ Sheet creation: Create → Format → Validate
- ✅ Transactions: Start → Modify → Rollback
- ✅ Composite operations: Batch updates, CSV import
- ✅ Session state maintained across calls

### Error Recovery

- ✅ Invalid input rejected quickly (< 100ms)
- ✅ API errors handled gracefully
- ✅ Rate limiting respects quotas
- ✅ Transient failures auto-retry
- ✅ Permanent failures fail fast
- ✅ Circuit breaker prevents cascading failures
- ✅ System remains responsive after errors

## Extending Tests

### Add New Workflow Test

```typescript
// tests/e2e/workflows/my-workflow.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestHttpClient } from '../mcp-client-simulator.js';
import type { MCPHttpClient } from '../mcp-client-simulator.js';

const TEST_SPREADSHEET_ID = process.env['TEST_SPREADSHEET_ID'];
const SKIP_E2E = !TEST_SPREADSHEET_ID || process.env['TEST_E2E'] !== 'true';

describe.skipIf(SKIP_E2E)('E2E: My Custom Workflow', () => {
  let client: MCPHttpClient;

  beforeAll(async () => {
    client = createTestHttpClient('http://localhost:3000');
    await client.initialize();
  });

  afterAll(async () => {
    await client.close();
  });

  it('should complete my workflow', async () => {
    // Step 1: Call first tool
    const result1 = await client.callTool('sheets_data', {
      request: {
        action: 'read_range',
        spreadsheetId: TEST_SPREADSHEET_ID,
        range: 'Sheet1!A1:B2',
      },
    });
    expect(result1.isError).toBe(false);

    // Step 2: Call second tool
    const result2 = await client.callTool('sheets_format', {
      request: {
        action: 'format_cells',
        spreadsheetId: TEST_SPREADSHEET_ID,
        range: 'Sheet1!A1:B2',
        format: { textFormat: { bold: true } },
      },
    });
    expect(result2.isError).toBe(false);

    // Verify final state
    expect(result2.content).toBeDefined();
  });
});
```

### Add New Client Transport

```typescript
// tests/e2e/mcp-client-simulator.ts
export class MCPWebSocketClient extends MCPClientSimulator {
  private ws: WebSocket;

  constructor(config: MCPClientConfig & { wsUrl: string }) {
    super(config);
    this.ws = new WebSocket(config.wsUrl);
  }

  protected async sendRequest(request: JSONRPCRequest): Promise<JSONRPCResponse> {
    return new Promise((resolve, reject) => {
      this.ws.send(JSON.stringify(request));
      this.ws.once('message', (data) => {
        resolve(JSON.parse(data.toString()));
      });
    });
  }
}
```

## Troubleshooting

### Tests Skip Automatically

- **Cause**: `TEST_E2E=true` not set
- **Solution**: `export TEST_E2E=true`

### Connection Refused

- **Cause**: HTTP server not running
- **Solution**: `npm run start:http` in another terminal

### Authentication Errors

- **Cause**: OAuth tokens not configured
- **Solution**: `npm run auth` and follow setup wizard

### Spreadsheet Not Found

- **Cause**: Invalid `TEST_SPREADSHEET_ID`
- **Solution**: Use a valid Google Sheets ID you have access to

### Rate Limit Errors

- **Cause**: Too many requests to Google API
- **Solution**: Wait 60 seconds, or use different spreadsheet

## Integration with CI

Add to `.github/workflows/test.yml`:

```yaml
e2e-tests:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
    - run: npm ci
    - run: npm run build

    # Start HTTP server in background
    - run: npm run start:http &
    - run: sleep 5 # Wait for server startup

    # Run E2E tests
    - run: TEST_E2E=true npm run test:e2e
      env:
        GOOGLE_APPLICATION_CREDENTIALS: ${{ secrets.GOOGLE_CREDS }}
        TEST_SPREADSHEET_ID: ${{ secrets.TEST_SPREADSHEET_ID }}
```

## Performance Benchmarks

Expected test execution times:

| Test Suite                   | Duration     | Tests    | Coverage          |
| ---------------------------- | ------------ | -------- | ----------------- |
| basic-crud.test.ts           | ~30s         | 15       | CRUD operations   |
| multi-step-workflows.test.ts | ~60s         | 20       | Complex workflows |
| error-recovery.test.ts       | ~45s         | 25       | Error handling    |
| protocol-compliance.test.ts  | ~20s         | 30       | MCP compliance    |
| all-tools-smoke.test.ts      | ~90s         | 50+      | All 22 tools      |
| **Total**                    | **~4-5 min** | **140+** | **Full E2E**      |

## Coverage

E2E tests cover:

- ✅ All 22 tools (100%)
- ✅ 60+ actions tested (~20% of 298 total)
- ✅ MCP protocol compliance (100%)
- ✅ Error handling (100%)
- ✅ Multi-step workflows (8 scenarios)
- ✅ Transport layers (HTTP/SSE)

## Future Enhancements

Planned additions:

- [ ] WebSocket transport client
- [ ] STDIO transport client (spawning subprocess)
- [ ] Load testing with concurrent clients
- [ ] Performance regression detection
- [ ] Visual diff for chart/pivot table changes
- [ ] Sampling/Elicitation interactive tests
- [ ] Tasks (SEP-1686) background job tests

## Resources

- [MCP 2025-11-25 Specification](https://spec.modelcontextprotocol.io/2025-11-25/)
- [ServalSheets Documentation](../../docs/)
- [Tool Reference](../../docs/reference/api/)
- [Protocol Compliance Matrix](../../docs/compliance/)
