# Google Docs MCP Server

**Real-time Google API documentation sync for ServalSheets**

Eliminates documentation drift by fetching latest Google Sheets API docs on-demand.

## Features

- ✅ **Real-time docs** - Fetches latest from developers.google.com
- ✅ **Breaking change detection** - Monitors API changelog
- ✅ **Quota information** - Current limits and recommendations
- ✅ **Best practices** - Category-specific guidance
- ✅ **Deprecation tracking** - Upcoming API changes
- ✅ **1-hour cache** - Fast responses with automatic refresh

## Installation

```bash
cd tools/google-docs-server
npm install
npm run build
```

## Configuration

Add to your Claude Desktop config (`~/.config/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "google-docs": {
      "command": "node",
      "args": ["/path/to/servalsheets/tools/google-docs-server/dist/index.js"]
    }
  }
}
```

Or for development:

```json
{
  "mcpServers": {
    "google-docs": {
      "command": "npx",
      "args": ["-y", "tsx", "/path/to/servalsheets/tools/google-docs-server/src/index.ts"]
    }
  }
}
```

## Tools Provided

### 1. `google_api_docs`

Fetch latest documentation for specific endpoint.

**Input:**

```json
{
  "endpoint": "spreadsheets.values.batchGet"
}
```

**Output:**

```json
{
  "endpoint": "spreadsheets.values.batchGet",
  "url": "https://developers.google.com/sheets/api/reference/rest/v4/spreadsheets.values/batchGet",
  "httpMethod": "GET",
  "requestUrl": "https://sheets.googleapis.com/v4/spreadsheets/{spreadsheetId}/values:batchGet",
  "parameters": [...],
  "requestBody": {...},
  "responseBody": {...},
  "scopes": [...],
  "examples": [...]
}
```

### 2. `google_api_changelog`

Get API changes and breaking changes.

**Input:**

```json
{
  "since": "2024-01-01" // Optional
}
```

**Output:**

```json
{
  "changes": [...],
  "breakingChanges": [...],
  "deprecations": [...]
}
```

### 3. `google_quota_limits`

Get current quota limits.

**Input:**

```json
{
  "method": "batchGet" // Optional
}
```

**Output:**

```json
{
  "readRequests": {
    "perMinPerUser": 300,
    "perDayPerProject": 500000
  },
  "writeRequests": {
    "perMinPerUser": 300,
    "perDayPerProject": 500000
  },
  "general": [...]
}
```

### 4. `google_best_practices`

Get best practices for category.

**Input:**

```json
{
  "category": "quota" // quota | performance | security | errors
}
```

**Output:**

```json
{
  "category": "quota",
  "practices": [
    {
      "title": "Use batch operations",
      "description": "...",
      "category": "quota"
    }
  ]
}
```

### 5. `google_deprecations`

Get deprecation schedule.

**Input:**

```json
{}
```

**Output:**

```json
{
  "deprecations": [...],
  "breakingChanges": [...]
}
```

## Usage with Agents

### With google-api-expert agent:

```bash
# Before reviewing code, fetch latest docs
claude-code --agent google-api-expert "
  First, fetch docs for spreadsheets.values.batchGet using google_api_docs tool.
  Then review src/handlers/data.ts for compliance with latest docs.
"
```

### Automated weekly sync:

```yaml
# .github/workflows/google-docs-sync.yml
name: Google Docs Sync

on:
  schedule:
    - cron: '0 0 * * 1' # Weekly on Monday
  workflow_dispatch:

jobs:
  check-drift:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install
        run: |
          cd tools/google-docs-server
          npm install
          npm run build

      - name: Check for breaking changes
        run: |
          # Fetch changes since last week
          SINCE=$(date -d '7 days ago' +%Y-%m-%d)
          node dist/index.js google_api_changelog --since $SINCE > changes.json

          # Check for breaking changes
          BREAKING=$(cat changes.json | jq '.breakingChanges | length')

          if [ $BREAKING -gt 0 ]; then
            echo "⚠️  Breaking changes detected!"
            cat changes.json | jq '.breakingChanges'

            # Create PR with warning
            gh pr create \
              --title "⚠️  Google API Breaking Changes Detected" \
              --body "$(cat changes.json | jq -r '.breakingChanges[] | "- \(.title): \(.description)"')"
          fi
```

## Caching

- Cache TTL: 1 hour (3600000ms)
- Cache storage: In-memory (per server instance)
- Cache keys: `{type}:{identifier}` (e.g., `docs:spreadsheets.values.batchGet`)

## Development

```bash
# Watch mode
npm run dev

# Build
npm run build

# Type check
npm run typecheck

# Test
npm test
```

## Error Handling

All tools return structured errors on failure:

```json
{
  "content": [
    {
      "type": "text",
      "text": "Error: Failed to fetch docs for invalid-endpoint: 404 Not Found"
    }
  ],
  "isError": true
}
```

## Performance

- **First request:** ~500-1000ms (fetches from Google)
- **Cached requests:** <5ms (in-memory cache)
- **Cache duration:** 1 hour
- **Timeout:** 10 seconds per request

## Troubleshooting

### Server not starting

```bash
# Check Node version (requires 18+)
node --version

# Check dependencies
cd tools/google-docs-server
npm install

# Test server
npm run dev
```

### Tools not appearing in Claude

1. Check Claude Desktop config:

   ```bash
   cat ~/.config/Claude/claude_desktop_config.json
   ```

2. Restart Claude Desktop

3. Check server logs:
   ```bash
   # Server logs to stderr
   tail -f ~/.config/Claude/logs/mcp-server-google-docs.log
   ```

### Fetch errors

- Check internet connection
- Verify Google docs URLs are accessible
- Check for rate limiting (should be rare with 1hr cache)

## License

MIT
