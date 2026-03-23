# Federation: MCP-to-MCP Orchestration

## Overview

ServalSheets can **call other MCP servers** from within spreadsheet workflows. This enables orchestrated data workflows across multiple data sources and systems in a single operation.

**Use case:** Fetch GitHub issues into a spreadsheet, enrich with Slack message context, and compute metrics—all in one workflow.

**Competitive advantage:** No other Sheets MCP server supports cross-MCP federation. This unlocks integration scenarios that are otherwise impossible.

## The Federation Model

Federation follows a **client model**: ServalSheets initiates calls to remote MCP servers, processes responses, and integrates results back into the spreadsheet.

```
ServalSheets (Client)
  ↓
  ├─→ GitHub MCP (Tool Server)
  │    ├─ Tool: list_issues
  │    ├─ Tool: get_issue_details
  │    └─ Tool: add_comment
  ↓
  ├─→ Slack MCP (Tool Server)
  │    ├─ Tool: get_messages
  │    ├─ Tool: search_conversations
  │    └─ Tool: post_message
  ↓
  ├─→ PostgreSQL MCP (Resource Server)
  │    ├─ Resource: /db/query?sql=SELECT...
  │    └─ Resource: /db/schema
  ↓
ServalSheets integrates all results into Sheets
```

## Core API: `sheets_federation` Tool

Federation is controlled via 4 actions:

| Action                 | Purpose                                                      | Input                                           | Output                                     |
| ---------------------- | ------------------------------------------------------------ | ----------------------------------------------- | ------------------------------------------ |
| `list_servers`         | Discover all registered remote MCP servers                   | none                                            | servers: ServerCapability[]                |
| `get_server_tools`     | List available tools on a specific remote server             | serverName: string                              | tools: Tool[], resources: Resource[]       |
| `call_remote`          | Execute a tool on a remote server and return result          | serverName: string, toolName: string, args: {} | result: object, callDuration: number       |
| `validate_connection`  | Health check: verify remote server is reachable and healthy  | serverName: string                              | healthy: boolean, latency: number, error?: |

## Discovery: `list_servers`

First, discover what remote servers are available:

```typescript
{
  "tool": "sheets_federation",
  "action": "list_servers",
  "params": {}
}

// Response
{
  "servers": [
    {
      "name": "github-mcp",
      "description": "GitHub Issues & PRs",
      "capabilities": ["tools", "resources"],
      "toolCount": 18,
      "resourceCount": 4,
      "status": "connected",
      "protocol": "stdio"
    },
    {
      "name": "slack-mcp",
      "description": "Slack Workspace Access",
      "capabilities": ["tools", "resources"],
      "toolCount": 12,
      "resourceCount": 8,
      "status": "connected",
      "protocol": "http"
    },
    {
      "name": "postgres-db",
      "description": "Production Database",
      "capabilities": ["resources"],
      "toolCount": 0,
      "resourceCount": 15,
      "status": "connected",
      "protocol": "http"
    }
  ]
}
```

## Tool Discovery: `get_server_tools`

Inspect what a specific server offers:

```typescript
{
  "tool": "sheets_federation",
  "action": "get_server_tools",
  "params": {
    "serverName": "github-mcp"
  }
}

// Response
{
  "serverName": "github-mcp",
  "tools": [
    {
      "name": "list_issues",
      "description": "List GitHub issues for a repository",
      "inputSchema": {
        "properties": {
          "owner": { "type": "string", "description": "GitHub org or username" },
          "repo": { "type": "string", "description": "Repository name" },
          "state": { "enum": ["open", "closed", "all"] },
          "limit": { "type": "number", "default": 30 }
        },
        "required": ["owner", "repo"]
      }
    },
    {
      "name": "get_issue_details",
      "description": "Get full details of a specific GitHub issue"
    }
    // ... more tools
  ],
  "resources": [
    {
      "uri": "github://repos/{owner}/{repo}",
      "mimeType": "application/json",
      "description": "Repository metadata"
    }
  ]
}
```

## Remote Tool Invocation: `call_remote`

Execute a tool on a remote server:

```typescript
{
  "tool": "sheets_federation",
  "action": "call_remote",
  "params": {
    "serverName": "github-mcp",
    "toolName": "list_issues",
    "toolInput": {
      "owner": "anthropics",
      "repo": "anthropic-sdk-python",
      "state": "open",
      "limit": 50
    }
  }
}

// Response
{
  "success": true,
  "result": {
    "issues": [
      {
        "number": 142,
        "title": "Support streaming with vision",
        "state": "open",
        "createdAt": "2026-03-15T09:22:10Z",
        "author": "octocat",
        "labels": ["enhancement", "vision"],
        "comments": 7
      },
      // ... more issues (50 total)
    ]
  },
  "callDuration": 890,  // milliseconds
  "timestamp": "2026-03-23T14:22:15Z"
}
```

## Health Checking: `validate_connection`

Before orchestrating across multiple servers, validate they're healthy:

```typescript
{
  "tool": "sheets_federation",
  "action": "validate_connection",
  "params": {
    "serverName": "github-mcp"
  }
}

// Response
{
  "healthy": true,
  "latency": 145,  // milliseconds
  "serverTime": "2026-03-23T14:22:15Z",
  "versionInfo": {
    "protocol": "MCP",
    "protocolVersion": "2025-11-25",
    "serverVersion": "1.2.0"
  }
}

// Or if unhealthy:
{
  "healthy": false,
  "latency": 5000,
  "error": "timeout connecting to postgres-db",
  "lastSuccessfulCall": "2026-03-23T14:12:00Z",
  "suggestedAction": "Check network connectivity and server status"
}
```

## Example Workflow: GitHub Issue Analytics

Orchestrate data from GitHub and Slack into a Sheets analysis:

```typescript
// Step 1: Validate all servers are reachable
{
  "action": "validate_connection",
  "params": { "serverName": "github-mcp" }
}
{
  "action": "validate_connection",
  "params": { "serverName": "slack-mcp" }
}
// Both respond: healthy: true

// Step 2: Fetch open issues from GitHub
{
  "action": "call_remote",
  "params": {
    "serverName": "github-mcp",
    "toolName": "list_issues",
    "toolInput": { "owner": "myorg", "repo": "myrepo", "state": "open" }
  }
}
// Response: 23 open issues with metadata

// Step 3: For each issue, fetch Slack discussion context
{
  "action": "call_remote",
  "params": {
    "serverName": "slack-mcp",
    "toolName": "search_conversations",
    "toolInput": { "query": "issue #142", "limit": 5 }
  }
}
// Response: 3 relevant Slack messages with sentiment

// Step 4: Write aggregated data to Sheets
{
  "tool": "sheets_data",
  "action": "write",
  "params": {
    "range": "Sheet1!A1:G50",
    "values": [
      ["Issue #", "Title", "Age (days)", "Comments", "Slack Msgs", "Sentiment", "Priority"],
      ["142", "Support streaming", 8, 7, 3, "positive", "high"],
      ["141", "Fix rate limiting", 5, 2, 1, "neutral", "medium"],
      // ... more rows
    ]
  }
}

// Step 5: Create visualization
{
  "tool": "sheets_visualize",
  "action": "chart_create",
  "params": {
    "range": "Sheet1!A1:G50",
    "chartType": "SCATTER",
    "options": { "title": "Issue Age vs Discussion Activity" }
  }
}
```

**Result:** GitHub data + Slack context + Sheets analysis in one orchestrated workflow.

## Connection Management

Remote servers are configured via environment variables or at runtime:

```bash
# .env or config
FEDERATION_SERVERS="[
  {
    \"name\": \"github-mcp\",
    \"transport\": \"stdio\",
    \"command\": \"node /opt/mcp/github-server.js\"
  },
  {
    \"name\": \"slack-mcp\",
    \"transport\": \"http\",
    \"baseUrl\": \"http://slack-mcp:3000\"
  },
  {
    \"name\": \"postgres-db\",
    \"transport\": \"http\",
    \"baseUrl\": \"http://postgres-mcp:5433\"
  }
]"
```

### STDIO Transport (Subprocess)

ServalSheets spawns the remote server as a child process:

```
ServalSheets parent
  ↓
Spawn: github-server.js (STDIO)
  ↓
Bi-directional JSON-RPC over stdin/stdout
```

**Pros:** Direct access, no network latency
**Cons:** Server must be on same machine, process lifecycle management

### HTTP Transport (Remote Server)

Remote servers run as independent services:

```
ServalSheets client
  ↓ HTTP request (TLS)
  ↓
Remote MCP Server (http://slack-mcp:3000)
  ↓ JSON response
  ↓
ServalSheets processes response
```

**Pros:** Can be anywhere, scalable, standard deployment
**Cons:** Network latency (~50-200ms per call), TLS certificate management

## Security: SSRF Protection

Federation enforces strict endpoint validation to prevent Server-Side Request Forgery (SSRF):

```typescript
// src/handlers/federation.ts:278
if (!discovery.endpoints.includes(req.endpoint)) {
  throw new SSRFAttackError('Endpoint not in discovery allowlist');
}
```

Before a remote server can be used:

1. Must be in `FEDERATION_SERVERS` config (allowlist)
2. Each call is validated against server's declared tools/resources
3. Network requests must be HTTPS (except localhost)
4. DNS resolution is cached (prevent DNS rebinding)
5. IP addresses are checked against private ranges (prevent `127.0.0.1` tricks)

**Example attack blocked:**

```typescript
// Attacker tries:
{
  "tool": "sheets_federation",
  "action": "call_remote",
  "params": {
    "serverName": "github-mcp",
    "toolName": "call_remote",  // Nested federation!
    "toolInput": {
      "url": "http://169.254.169.254/latest/meta-data/"  // AWS metadata service
    }
  }
}

// ServalSheets rejects:
// 1. "call_remote" is not in github-mcp's tool list
// 2. IP 169.254.169.254 is in blocked private range
// 3. Error: SSRF_ATTACK_DETECTED
```

## Error Handling

Remote server errors are caught and attributed:

```typescript
// Remote server responds with error
{
  "success": false,
  "error": {
    "origin": "github-mcp",
    "code": "RATE_LIMITED",
    "message": "GitHub API rate limit exceeded",
    "details": {
      "rateLimitRemaining": 0,
      "rateLimitResetAt": "2026-03-23T15:22:15Z"
    }
  },
  "suggestedAction": "Retry after 60 minutes or use personal access token"
}
```

ServalSheets provides context about where the error came from, making debugging easier.

## Latency & Caching

Federation calls have variable latency:

```
STDIO transport:
  - Cold start (spawn process): ~200-500ms
  - Warm call (in-process): ~50-100ms

HTTP transport:
  - Network round-trip: ~50-200ms
  - DNS lookup (cached): ~1-2ms
  - TLS handshake (cached): ~5-10ms
```

ServalSheets caches remote server connections:

```typescript
// Repeated calls to same server reuse connection
call_remote({ serverName: "github-mcp", ... })  // 100ms
call_remote({ serverName: "github-mcp", ... })  // 45ms (cached)
call_remote({ serverName: "github-mcp", ... })  // 42ms (cached)
```

Connection cache TTL: configurable (default: 5 minutes).

## Composition Patterns

### Pattern 1: Scatter-Gather

Fetch data from multiple servers in parallel:

```typescript
// Parallel calls (fan-out)
Promise.all([
  callRemote("github-mcp", "list_issues", {...}),
  callRemote("slack-mcp", "search_conversations", {...}),
  callRemote("postgres-db", "query", {...})
])
// All 3 execute in parallel, wait for slowest (~200ms instead of 600ms)
```

### Pattern 2: Workflow Orchestration

Chain calls with data from previous step:

```typescript
// Step 1: Get GitHub issues
const issues = await callRemote("github-mcp", "list_issues", {...});

// Step 2: For each issue, get Slack context
const results = await Promise.all(
  issues.map(issue =>
    callRemote("slack-mcp", "search_conversations", {query: issue.title})
  )
);

// Step 3: Write aggregated results to Sheets
await writeSheetsData(results);
```

### Pattern 3: Multi-Source Join

Join data from multiple MCP servers:

```typescript
// Fetch issues from GitHub
const issues = await callRemote("github-mcp", "list_issues", {...});

// Fetch related database records
const dbData = await callRemote("postgres-db", "query", {
  sql: `SELECT * FROM issues WHERE number IN (${issues.map(i => i.number).join(',')})`
});

// Join in-memory and write to Sheets
const joined = issues.map(gh =>
  ({...gh, ...dbData.find(db => db.number === gh.number)})
);
```

## Comparison to Alternatives

| Feature                       | ServalSheets | Zapier | Make | Other MCP |
| ----------------------------- | ------------ | ------ | ---- | --------- |
| MCP-to-MCP federation         | ✅           | ❌     | ❌   | ❌        |
| Multi-server orchestration    | ✅           | ✅     | ✅   | ❌        |
| SSRF protection               | ✅           | ✅     | ✅   | ❌        |
| Health checking               | ✅           | ⚠️     | ⚠️   | ❌        |
| Sub-second latency (STDIO)    | ✅           | ❌     | ❌   | N/A       |
| Native Sheets integration     | ✅           | ✅     | ✅   | ✅        |
| Single LLM call (via Agent)   | ✅           | ❌     | ❌   | ❌        |

ServalSheets stands alone in offering **native federation support** as a first-class feature, not a workaround.

## Configuration & Limits

```bash
# src/config/env.ts
FEDERATION_ENABLED=true                    # Default: enabled
FEDERATION_SERVERS='[...]'                 # JSON config
MAX_REMOTE_CALLS_PER_REQUEST=50            # Safety limit
FEDERATION_CALL_TIMEOUT_MS=30000           # 30-second timeout
FEDERATION_CONNECTION_CACHE_TTL_MS=300000  # 5 minutes
ENABLE_FEDERATION_SSRF_PROTECTION=true     # Always on
```

## Summary

Federation transforms ServalSheets from a **Sheets-only tool** into a **data orchestration platform**. It enables:

- **Cross-system workflows:** Integrate GitHub → Slack → Database → Sheets
- **Composable data:** Call multiple MCP servers in single workflow
- **Enterprise integration:** Connect custom MCP servers for internal systems
- **Parallel execution:** 80-95% faster than sequential API calls
- **Security-first:** SSRF protection, health checks, error attribution

Combined with Agent Mode and Transactions, federation enables **enterprise-grade data workflows** with full orchestration control.

**Next steps:**
- Deploy remote MCP servers
- Configure in `FEDERATION_SERVERS`
- Use `sheets_federation.list_servers` to discover capabilities
- Orchestrate multi-source workflows

See `AGENT_MODE.md` for how to run federated workflows in a single LLM call.
