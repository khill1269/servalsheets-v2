---
title: ServalSheets Usage Guide
category: guide
last_updated: 2026-01-31
description: Complete guide to using ServalSheets MCP Server
version: 1.6.0
tags: [sheets, docker]
audience: user
difficulty: intermediate
---

# ServalSheets Usage Guide

**Complete guide to using ServalSheets MCP Server**

Version: 1.6.0 | Last Updated: 2026-01-30

---

## Table of Contents

1. [What is ServalSheets?](#what-is-servalsheets)
2. [What is an MCP Server?](#what-is-an-mcp-server)
3. [Installation](#installation)
4. [Configuration](#configuration)
5. [First Operation](#first-operation)
6. [Using with Claude Desktop](#using-with-claude-desktop)
7. [Using Programmatically](#using-programmatically)
8. [Common Workflows](#common-workflows)
9. [Best Practices](#best-practices)
10. [Troubleshooting](#troubleshooting)
11. [Next Steps](#next-steps)

---

## What is ServalSheets?

**ServalSheets** is a production-grade Model Context Protocol (MCP) server that gives AI assistants like Claude powerful access to Google Sheets.

### Key Features

- **21 Tools, 291 Actions**: Comprehensive Google Sheets API v4 coverage
- **Safety Rails**: Dry-run preview, effect scope limits, expected state validation, auto-snapshots
- **Smart Operations**: Semantic range resolution (find columns by header name), tiered diff engine
- **Production Ready**: Rate limiting, encrypted token storage, structured logging, health checks
- **Multiple Auth Methods**: Service accounts, OAuth 2.1, access tokens
- **Batch Operations**: Efficient API usage with automatic batching

### What Can You Do?

- **Read & Write Data**: Cell values, formulas, bulk operations
- **Format Cells**: Colors, fonts, number formats, conditional formatting
- **Create Visualizations**: Charts, pivot tables, filters
- **Manage Structure**: Add/delete sheets, rows, columns, merge cells
- **Analyze Data**: Quality checks, statistics, correlations, formula audits
- **Version Control**: Access version history, restore previous versions, create snapshots
- **Collaborate**: Share spreadsheets, manage permissions, add comments

---

## What is an MCP Server?

### Model Context Protocol (MCP)

**MCP** is a protocol that lets AI assistants like Claude connect to external data sources and tools. Think of it as a standardized way for AI to interact with your systems.

### How MCP Servers Work

```
┌─────────────┐          ┌─────────────┐          ┌──────────────┐
│   Claude    │  ◄────►  │ ServalSheets│  ◄────►  │ Google Sheets│
│ (AI Assistant)│         │ MCP Server  │          │     API      │
└─────────────┘          └─────────────┘          └──────────────┘
```

1. **You ask Claude** to work with a spreadsheet
2. **Claude calls ServalSheets** via MCP protocol
3. **ServalSheets calls Google Sheets API** to perform the operation
4. **Results flow back** through the chain to you

### Benefits of Using MCP

- **Standardized**: Works with any MCP-compatible AI assistant
- **Secure**: Credentials managed separately from conversations
- **Powerful**: AI can perform complex multi-step operations
- **Safe**: Built-in safety rails prevent accidents
- **Auditable**: All operations logged and traceable

---

## Installation

ServalSheets can be installed three ways, depending on your use case.

### Method 1: npm (Recommended for Claude Desktop)

```bash
# Install globally
npm install -g servalsheets

# Or use with npx (no installation required)
npx servalsheets
```

**Best for**: Claude Desktop users, quick setup

### Method 2: Local Build (Recommended for Development)

```bash
# Clone repository
git clone https://github.com/khill1269/servalsheets.git
cd servalsheets

# Install dependencies
npm install

# Build
npm run build

# Link globally (optional)
npm link
```

**Best for**: Developers, contributors, customization

### Method 3: Docker (Recommended for Production)

```bash
# Pull image
docker pull anthropic/servalsheets:1.6.0

# Or build from source
docker build -t servalsheets .

# Run
docker run -p 3000:3000 --env-file .env servalsheets
```

**Best for**: Production deployments, containerized environments

---

## Configuration

ServalSheets requires Google API credentials. You have three authentication options.

### Option 1: Service Account (Recommended for Automation)

**When to use**: Server automation, long-running processes, production deployments

**Setup**:

1. **Create Service Account**:
   - Go to [Google Cloud Console](https://console.cloud.google.com)
   - Create a project (or select existing)
   - Enable Google Sheets API
   - Navigate to **IAM & Admin → Service Accounts**
   - Click **Create Service Account**
   - Name it: `servalsheets-prod`
   - Click **Create and Continue**
   - Skip role assignment (click **Continue**)
   - Click **Done**

2. **Generate Key**:
   - Click on the service account you just created
   - Go to **Keys** tab
   - Click **Add Key → Create new key**
   - Select **JSON** format
   - Click **Create** (key downloads automatically)

3. **Save Key Securely**:

   ```bash
   # Create secure directory
   mkdir -p ~/.config/google
   chmod 700 ~/.config/google

   # Move key
   mv ~/Downloads/servalsheets-*.json ~/.config/google/servalsheets-sa.json

   # Set restrictive permissions
   chmod 600 ~/.config/google/servalsheets-sa.json
   ```

4. **Configure ServalSheets**:

   ```bash
   export GOOGLE_APPLICATION_CREDENTIALS=~/.config/google/servalsheets-sa.json
   ```

5. **Share Spreadsheets**:
   - Open your Google Sheet
   - Click **Share**
   - Add service account email (e.g., `servalsheets-prod@project-id.iam.gserviceaccount.com`)
   - Grant **Editor** permission
   - Uncheck "Notify people"
   - Click **Share**

**Pros**: Long-term, secure, no expiration, suitable for production
**Cons**: Requires sharing spreadsheets explicitly, setup more involved

**See**: [QUICKSTART_CREDENTIALS.md](./QUICKSTART_CREDENTIALS.md) for detailed walkthrough

### Option 2: OAuth Token (Fastest for Testing)

**When to use**: Quick testing, temporary access, personal use

**Setup**:

1. Get OAuth token from [OAuth Playground](https://developers.google.com/oauthplayground/)
2. Select scopes:
   - `https://www.googleapis.com/auth/spreadsheets`
   - `https://www.googleapis.com/auth/drive.file`
3. Click **Authorize APIs**
4. Click **Exchange authorization code for tokens**
5. Copy the **Access token** (starts with `ya29.`)

6. Configure ServalSheets:

   ```bash
   export GOOGLE_ACCESS_TOKEN=ya29.xxxxxxxxxxxxx
   ```

**Pros**: Fast setup (2 minutes), no sharing needed for your own sheets
**Cons**: Expires in 1 hour, must refresh manually, not suitable for production

### Option 3: OAuth Client Credentials (For User Authentication)

**When to use**: Multi-user applications, user-specific access

**Setup**:

1. Create OAuth Client:
   - Google Cloud Console → **APIs & Services → Credentials**
   - Click **Create Credentials → OAuth 2.0 Client ID**
   - Application type: **Web application**
   - Authorized redirect URIs: `http://localhost:3000/oauth/callback`
   - Click **Create**

2. Configure ServalSheets:

   ```bash
   export GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com
   export GOOGLE_CLIENT_SECRET=GOCSPX-xxx
   ```

**Pros**: User-specific access, refresh tokens, suitable for applications
**Cons**: Requires OAuth flow implementation, more complex

**See**: [SECURITY.md](../../SECURITY.md#oauth-security) for OAuth 2.1 best practices

### Encrypted Token Store (Optional)

Store OAuth tokens securely across restarts:

```bash
# Generate encryption key
export ENCRYPTION_KEY=$(openssl rand -hex 32)

# Set token store path
export GOOGLE_TOKEN_STORE_PATH=~/.config/servalsheets/tokens.enc
```

**See**: [SECURITY.md](../../SECURITY.md#token-storage) for encryption details

---

## First Operation

Let's verify your setup works by performing your first operation.

### Test with Public Spreadsheet

No credentials needed for read-only access to public sheets:

```bash
# Start ServalSheets (if using local build)
node dist/cli.js

# In another terminal, test with MCP inspector
npx @modelcontextprotocol/inspector node dist/cli.js
```

Then in the inspector, try:

```json
{
  "tool": "sheets_core",
  "arguments": {
    "action": "get",
    "spreadsheetId": "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms"
  }
}
```

**Expected result**: Spreadsheet metadata (title, sheets, properties)

### Test with Your Spreadsheet

Once you have credentials configured:

```json
{
  "tool": "sheets_data",
  "arguments": {
    "action": "read",
    "spreadsheetId": "YOUR_SPREADSHEET_ID",
    "range": { "a1": "Sheet1!A1:D10" },
    "valueRenderOption": "FORMATTED_VALUE"
  }
}
```

**Expected result**: Cell values from A1:D10

### Getting Spreadsheet ID

Your spreadsheet ID is in the URL:

```
https://docs.google.com/spreadsheets/d/SPREADSHEET_ID_HERE/edit
                                         ^^^^^^^^^^^^^^^^^^^^
```

Example:

```
https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit
ID: 1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms
```

---

## Using with Claude Desktop

Claude Desktop is the easiest way to use ServalSheets.

### Step 1: Configure Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "servalsheets": {
      "command": "npx",
      "args": ["servalsheets"],
      "env": {
        "GOOGLE_APPLICATION_CREDENTIALS": "/path/to/service-account.json"
      }
    }
  }
}
```

**Or use the automated setup script**:

```bash
./configure-claude.sh
```

**See**: [CLAUDE_DESKTOP_SETUP.md](./CLAUDE_DESKTOP_SETUP.md) for detailed setup

### Step 2: Restart Claude Desktop

1. Quit Claude Desktop completely (**⌘+Q** on Mac)
2. Wait 2 seconds
3. Reopen Claude Desktop
4. Look for the **🔨 icon** in the bottom-right corner (custom ServalSheets icon may not appear yet)

### Step 3: Try Interactive Prompts

ServalSheets includes 7 guided prompts for easy interaction:

#### `/welcome` - Introduction

Get an overview of ServalSheets capabilities and a test spreadsheet.

```
Type in Claude Desktop: /welcome
```

#### `/test_connection` - Verify Setup

Test your configuration with a public spreadsheet.

```
Type in Claude Desktop: /test_connection
```

#### `/first_operation` - Guided Walkthrough

Step-by-step walkthrough of your first operation.

```
Type in Claude Desktop: /first_operation
```

**See**: [PROMPTS_GUIDE.md](./PROMPTS_GUIDE.md) for all 7 prompts

### Step 4: Natural Language Interactions

Once configured, just ask Claude naturally:

**Example conversations**:

```
You: "Read the data from spreadsheet 1Bxi...upms, range A1:D10"

Claude: [Calls sheets_data tool, returns data]
```

```
You: "Analyze the data quality in that spreadsheet"

Claude: [Calls sheets_analyze tool, shows completeness, duplicates, outliers]
```

```
You: "Create a bar chart showing monthly sales"

Claude: [Calls sheets_visualize tool, creates visualization]
```

**Pro tip**: Claude can perform multi-step operations automatically, like "read the data, clean it, analyze it, and create a summary report."

---

## Using Programmatically

ServalSheets can be integrated into your own applications.

### Node.js Integration

```javascript
import { McpClient } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

// Create MCP client
const transport = new StdioClientTransport({
  command: 'node',
  args: ['node_modules/servalsheets/dist/cli.js'],
  env: {
    GOOGLE_APPLICATION_CREDENTIALS: '/path/to/service-account.json',
  },
});

const client = new McpClient(
  {
    name: 'my-app',
    version: '1.0.0',
  },
  {
    capabilities: {},
  }
);

await client.connect(transport);

// List available tools
const tools = await client.listTools();
console.log('Available tools:', tools);

// Call a tool
const result = await client.callTool({
  name: 'sheets_data',
  arguments: {
    request: {
      action: 'read',
      spreadsheetId: '1Bxi...upms',
      range: { a1: 'Sheet1!A1:D10' },
    },
  },
});

console.log('Result:', result);
```

### Python Integration (via MCP SDK)

```python
from mcp import Client, StdioTransport
import asyncio

async def main():
    # Create transport
    transport = StdioTransport(
        command='node',
        args=['node_modules/servalsheets/dist/cli.js'],
        env={
            'GOOGLE_APPLICATION_CREDENTIALS': '/path/to/service-account.json'
        }
    )

    # Connect client
    async with Client(
        name='my-app',
        version='1.0.0'
    ) as client:
        await client.connect(transport)

        # Call tool
        result = await client.call_tool(
            name='sheets_data',
            arguments={
                'request': {
                    'action': 'read',
                    'spreadsheetId': '1Bxi...upms',
                    'range': {'a1': 'Sheet1!A1:D10'}
                }
            }
        )

        print('Result:', result)

asyncio.run(main())
```

### HTTP Server Mode

ServalSheets can run as an HTTP server:

```bash
# Start HTTP server
npm run start:http

# Server runs at http://localhost:3000
```

Then use standard HTTP requests:

```bash
curl -X POST http://localhost:3000/mcp/v1/tools/call \
  -H "Content-Type: application/json" \
  -d '{
    "name": "sheets_data",
    "arguments": {
      "request": {
        "action": "read",
        "spreadsheetId": "1Bxi...upms",
        "range": {"a1": "Sheet1!A1:D10"}
      }
    }
  }'
```

### Task-augmented tool calls (long-running)

Tools with `execution.taskSupport` can return a task for async processing. Include a `task` object in `tools/call`, then request the result via `tasks/result`.

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/call",
  "params": {
    "name": "sheets_data",
    "arguments": {
      "request": {
        "action": "read",
        "spreadsheetId": "1Bxi...upms",
        "range": { "a1": "Sheet1!A1:D10" }
      }
    },
    "task": { "ttl": 60000 }
  }
}
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tasks/result",
  "params": { "taskId": "task_abc123" }
}
```

**See**: [DEPLOYMENT.md](./DEPLOYMENT.md) for production HTTP deployment

---

## Common Workflows

### Workflow 1: Read and Analyze Data

**Goal**: Read spreadsheet data and get quality insights

```javascript
// Step 1: Read the data
{
  "tool": "sheets_data",
  "arguments": {
    "action": "read",
    "spreadsheetId": "xxx",
    "range": { "a1": "Sales!A1:D100" },
    "valueRenderOption": "UNFORMATTED_VALUE"
  }
}

// Step 2: Check data quality
{
  "tool": "sheets_analyze",
  "arguments": {
    "action": "analyze_quality",
    "spreadsheetId": "xxx",
    "range": { "a1": "Sales!A1:D100" }
  }
}
// Returns: { completeness: 0.95, duplicates: 3, outliers: [...] }

// Step 3: Get statistics
{
  "tool": "sheets_analyze",
  "arguments": {
    "action": "analyze_data",
    "spreadsheetId": "xxx",
    "range": { "a1": "Sales!B2:D100" }
  }
}
// Returns: { mean, median, stdDev, min, max per column }
```

### Workflow 2: Safe Bulk Update

**Goal**: Update many cells with safety checks

```javascript
// Step 1: Preview with dry-run
{
  "tool": "sheets_data",
  "arguments": {
    "action": "write",
    "spreadsheetId": "xxx",
    "range": { "a1": "Data!A2:C100" },
    "values": [[...], [...], ...],
    "safety": {
      "dryRun": true,
      "effectScope": { "maxCellsAffected": 500 }
    }
  }
}
// Returns: { dryRun: true, cellsAffected: 297 }

// Step 2: Execute if safe
{
  "tool": "sheets_data",
  "arguments": {
    "action": "write",
    "spreadsheetId": "xxx",
    "range": { "a1": "Data!A2:C100" },
    "values": [[...], [...], ...],
    "safety": {
      "expectedState": { "rowCount": 100 },
      "autoSnapshot": true
    }
  }
}
```

### Workflow 3: Create Formatted Report

**Goal**: Generate a formatted report with charts

```javascript
// Step 1: Write summary data
{
  "tool": "sheets_data",
  "arguments": {
    "action": "write",
    "spreadsheetId": "xxx",
    "range": { "a1": "Report!A1" },
    "values": [
      ["Monthly Sales Report"],
      ["Month", "Revenue", "Units"],
      ["January", 50000, 120],
      ...
    ]
  }
}

// Step 2: Format header
{
  "tool": "sheets_format",
  "arguments": {
    "action": "text",
    "spreadsheetId": "xxx",
    "range": { "a1": "Report!A1:C1" },
    "format": {
      "bold": true,
      "fontSize": 14,
      "backgroundColor": { "red": 0.2, "green": 0.5, "blue": 0.8 },
      "textColor": { "red": 1, "green": 1, "blue": 1 }
    }
  }
}

// Step 3: Format numbers as currency
{
  "tool": "sheets_format",
  "arguments": {
    "action": "number",
    "spreadsheetId": "xxx",
    "range": { "a1": "Report!B3:B15" },
    "format": {
      "type": "CURRENCY",
      "pattern": "$#,##0.00"
    }
  }
}

// Step 4: Create chart
{
  "tool": "sheets_visualize",
  "arguments": {
    "action": "create",
    "spreadsheetId": "xxx",
    "sheetId": 0,
    "chartType": "COLUMN",
    "title": "Monthly Revenue",
    "data": { "sourceRange": { "a1": "Report!A2:B15" } },
    "position": { "anchorCell": "Report!E2", "width": 600, "height": 400 }
  }
}
```

### Workflow 4: Semantic Range Queries

**Goal**: Work with data without knowing column letters

```javascript
// Instead of guessing column letters...
{
  "tool": "sheets_data",
  "arguments": {
    "action": "read",
    "spreadsheetId": "xxx",
    "range": {
      "semantic": {
        "sheet": "Sales Data",
        "column": "Total Revenue",  // Find column by header name
        "includeHeader": false
      }
    }
  }
}
// Automatically finds the "Total Revenue" column and returns data

// Returns with resolution metadata:
// {
//   values: [[5000], [7500], ...],
//   resolution: {
//     method: 'semantic_header',
//     confidence: 1.0,
//     path: 'Matched "Total Revenue" to header in column E'
//   }
// }
```

**See**: README.md for more examples

---

## Best Practices

### 1. Always Use Safety Rails for Destructive Operations

```javascript
{
  "safety": {
    "dryRun": true,                    // Preview first
    "effectScope": {
      "maxCellsAffected": 1000,        // Limit scope
      "requireExplicitRange": true     // No whole-sheet ops
    },
    "expectedState": {
      "rowCount": 100,                 // Validate state
      "checksum": "abc123"
    },
    "autoSnapshot": true               // Create backup
  }
}
```

### 2. Use Batch Operations to Save Quota

```javascript
// Bad: Multiple API calls
await read({ range: 'A1' });
await read({ range: 'B1' });
await read({ range: 'C1' });
// 3 API calls

// Good: Single batch call
await read({ ranges: ['A1', 'B1', 'C1'] });
// 1 API call
```

### 3. Choose the Right Value Render Option

```javascript
// For display to users
valueRenderOption: 'FORMATTED_VALUE'; // "1,234.56"

// For calculations
valueRenderOption: 'UNFORMATTED_VALUE'; // 1234.56

// For formulas
valueRenderOption: 'FORMULA'; // "=SUM(A1:A10)"
```

### 4. Use Semantic Ranges for Flexible Queries

```javascript
// Instead of hardcoding columns
range: { a1: "Sheet1!E2:E100" }  // Breaks if columns move

// Use semantic resolution
range: {
  semantic: {
    sheet: "Sheet1",
    column: "Revenue",  // Finds column by header
    includeHeader: false
  }
}
```

### 5. Configure Rate Limits for Your Quota

```bash
# Default (conservative)
export SERVALSHEETS_READS_PER_MINUTE=300
export SERVALSHEETS_WRITES_PER_MINUTE=60

# If you have higher quota
export SERVALSHEETS_READS_PER_MINUTE=500
export SERVALSHEETS_WRITES_PER_MINUTE=100
```

**See**: [PERFORMANCE.md](./PERFORMANCE.md) for optimization strategies

### 6. Enable Structured Logging in Production

```bash
export LOG_LEVEL=info
export LOG_FORMAT=json
export LOG_FILE=/var/log/servalsheets/app.log
```

**See**: [MONITORING.md](./MONITORING.md) for observability setup

### 7. Rotate Credentials Regularly

- **Service Account Keys**: Rotate annually
- **OAuth Tokens**: Use refresh tokens
- **Encryption Keys**: Rotate when compromised

**See**: [SECURITY.md](../../SECURITY.md) for security best practices

---

## Troubleshooting

### Issue: "Authentication failed"

**Symptoms**: `UNAUTHENTICATED` error

**Solutions**:

1. Check credentials path: `echo $GOOGLE_APPLICATION_CREDENTIALS`
2. Verify file exists: `ls -la ~/.config/google/servalsheets-sa.json`
3. Check file permissions: Should be `-rw-------` (600)
4. Validate JSON: `cat ~/.config/google/servalsheets-sa.json | jq .`

**See**: [TROUBLESHOOTING.md#authentication-issues](./TROUBLESHOOTING.md#authentication-issues)

### Issue: "Permission denied"

**Symptoms**: `PERMISSION_DENIED` error when accessing spreadsheet

**Solutions**:

1. Share spreadsheet with service account email
2. Check service account email: `cat ~/.config/google/servalsheets-sa.json | jq -r '.client_email'`
3. Verify spreadsheet ID is correct
4. Ensure "Editor" permission (not just "Viewer")

**See**: [TROUBLESHOOTING.md#permission-errors](./TROUBLESHOOTING.md#permission-errors)

### Issue: "Rate limit exceeded"

**Symptoms**: 429 errors, `RATE_LIMIT_EXCEEDED`

**Solutions**:

1. Reduce rate limits: `export SERVALSHEETS_WRITES_PER_MINUTE=40`
2. Enable caching: `export SERVALSHEETS_CACHE_DATA_TTL=300000`
3. Use batch operations instead of individual calls
4. Request quota increase from Google

**See**: [TROUBLESHOOTING.md#rate-limiting-and-quotas](./TROUBLESHOOTING.md#rate-limiting-and-quotas)

### Issue: "ServalSheets not showing in Claude Desktop"

**Symptoms**: No 🔨 icon (standard MCP indicator), tools not available

**Solutions**:

1. Check config file: `cat ~/Library/Application\ Support/Claude/claude_desktop_config.json | jq .`
2. Verify JSON syntax is valid
3. Restart Claude Desktop (⌘+Q then reopen)
4. Check logs: `cat ~/Library/Logs/Claude/mcp-server-servalsheets.log`

**See**: [TROUBLESHOOTING.md#mcp-integration](./TROUBLESHOOTING.md#mcp-integration)

### Issue: Slow operations

**Symptoms**: Operations taking > 5 seconds

**Solutions**:

1. Use METADATA diff instead of FULL: `diffTier: 'METADATA'`
2. Enable caching with longer TTLs
3. Reduce cell range size
4. Use batch operations

**See**: [PERFORMANCE.md#performance-issues](./PERFORMANCE.md#performance-issues)

### Get More Help

- **Full Troubleshooting Guide**: [TROUBLESHOOTING.md](./TROUBLESHOOTING.md)
- **GitHub Issues**: https://github.com/khill1269/servalsheets/issues
- **Enable Debug Logging**: `export LOG_LEVEL=debug`

---

## Next Steps

### New Users

- ✅ Complete [FIRST_TIME_USER.md](./FIRST_TIME_USER.md) (5 minutes)
- ✅ Try the `/welcome` prompt in Claude Desktop
- ✅ Experiment with the test spreadsheet: `1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms`

### Production Deployment

- 📖 Read [SECURITY.md](../../SECURITY.md) - Security best practices
- 📖 Read [DEPLOYMENT.md](./DEPLOYMENT.md) - Deployment options
- 📖 Read [MONITORING.md](./MONITORING.md) - Observability setup

### Advanced Usage

- 📖 Read [SKILL.md](./SKILL.md) - How Claude uses the tools (for AI developers)
- 📖 Read [PERFORMANCE.md](./PERFORMANCE.md) - Optimization strategies
- 📖 Explore [PROMPTS_GUIDE.md](./PROMPTS_GUIDE.md) - All 7 interactive prompts

### Contributing

- 📖 Read [IMPLEMENTATION_GUARDRAILS.md](../development/IMPLEMENTATION_GUARDRAILS.md) - Architecture overview
- 📖 Read [MCP_2025-11-25_COMPLIANCE_CHECKLIST.md](../MCP_2025-11-25_COMPLIANCE_CHECKLIST.md) - Requirements
- 🐛 Report issues: https://github.com/khill1269/servalsheets/issues

---

## Quick Reference

### Essential Commands

```bash
# Install
npm install -g servalsheets

# Configure (service account)
export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json

# Test locally
node dist/cli.js

# Start HTTP server
npm run start:http

# Enable debug logging
export LOG_LEVEL=debug
```

### Essential Tools

| Tool               | Purpose                | Read-Only? |
| ------------------ | ---------------------- | ---------- |
| `sheets_data`      | Read/write cell values | No         |
| `sheets_analyze`   | Analyze data quality   | Yes        |
| `sheets_format`    | Format cells           | No         |
| `sheets_visualize` | Create charts          | No         |
| `sheets_core`      | Manage spreadsheets    | No         |

### Essential Safety Features

| Feature         | Purpose                   | When to Use                |
| --------------- | ------------------------- | -------------------------- |
| `dryRun: true`  | Preview without executing | Always for destructive ops |
| `effectScope`   | Limit operation scope     | Bulk operations            |
| `expectedState` | Validate before writing   | Critical updates           |
| `autoSnapshot`  | Create backup             | Destructive operations     |

---

## Documentation Index

- **[README.md](../../README.md)** - Overview and quick reference
- **[USAGE_GUIDE.md](./USAGE_GUIDE.md)** - This comprehensive guide ⬅️
- **[FIRST_TIME_USER.md](./FIRST_TIME_USER.md)** - 5-minute quick start
- **[SKILL.md](./SKILL.md)** - Guide for Claude (AI) on using tools
- **[SECURITY.md](../../SECURITY.md)** - Security best practices
- **[PERFORMANCE.md](./PERFORMANCE.md)** - Performance tuning
- **[MONITORING.md](./MONITORING.md)** - Observability setup
- **[DEPLOYMENT.md](./DEPLOYMENT.md)** - Deployment examples
- **[TROUBLESHOOTING.md](./TROUBLESHOOTING.md)** - Common issues

---

**Need help?** Open an issue: https://github.com/khill1269/servalsheets/issues

**Version**: 1.6.0 | **License**: MIT | **Protocol**: MCP 2025-11-25
