---
title: Debugging and Testing ServalSheets
category: development
last_updated: 2026-01-31
description: This document describes tools and techniques for debugging and testing the ServalSheets MCP server.
version: 1.6.0
tags: [testing, sheets]
---

# Debugging and Testing ServalSheets

This document describes tools and techniques for debugging and testing the ServalSheets MCP server.

## MCP Inspector

The MCP Inspector is a powerful debugging tool for MCP servers that provides:

- **Interactive Testing**: Test tools and resources directly in a GUI
- **Request/Response Inspection**: View detailed request and response data
- **Resource Browsing**: Explore available resources and their content
- **Real-time Monitoring**: Track server operations and performance
- **Schema Validation**: Verify tool inputs and outputs match schemas

### Installation

```bash
npm install -g @modelcontextprotocol/inspector
```

Or use npx:

```bash
npx @modelcontextprotocol/inspector
```

### Usage with ServalSheets

1. **Build the server first:**

   ```bash
   npm run build
   ```

2. **Launch MCP Inspector:**

   ```bash
   npx @modelcontextprotocol/inspector inspector.json
   ```

3. **Or specify the server directly:**

   ```bash
   npx @modelcontextprotocol/inspector
   # Then connect to: node dist/index.js
   ```

4. **Access the Inspector UI:**
   Open your browser to `http://localhost:5173` (default port)

### Inspector Configuration

The `inspector.json` file provides:

- **Pre-configured sample requests** for all major tools
- **Resource URIs** for quick access to monitoring data
- **Environment variables** optimized for development
- **Documentation links** for quick reference

### Sample Requests Included

The inspector configuration includes ready-to-use examples:

1. **Read Spreadsheet Values** - Basic read operation
2. **Write Values (Dry Run)** - Write with safety features
3. **Get Spreadsheet Metadata** - Retrieve structure information
4. **Format Cells** - Apply cell formatting
5. **List Resources** - Discover available resources

**Note:** Replace `YOUR_SPREADSHEET_ID` with an actual spreadsheet ID from your Google account.

## Health Endpoints

ServalSheets provides HTTP health endpoints for monitoring and orchestration:

### Liveness Probe

Check if the server process is running:

```bash
curl http://localhost:3000/health/live
```

**Returns:**

```json
{
  "status": "healthy",
  "timestamp": "2026-01-06T17:00:00.000Z",
  "uptime": 123456,
  "version": "1.3.0",
  "checks": [
    {
      "name": "process",
      "status": "ok",
      "message": "Server process is running",
      "metadata": {
        "pid": 12345,
        "nodeVersion": "v20.10.0",
        "platform": "darwin",
        "memoryUsageMB": 45
      }
    }
  ]
}
```

### Readiness Probe

Check if the server is ready to handle requests:

```bash
curl http://localhost:3000/health/ready
```

**Returns:**

```json
{
  "status": "healthy",
  "timestamp": "2026-01-06T17:00:00.000Z",
  "uptime": 123456,
  "version": "1.3.0",
  "checks": [
    {
      "name": "auth",
      "status": "ok",
      "message": "Authenticated",
      "latency": 5,
      "metadata": {
        "hasAuth": true,
        "hasElevatedAccess": false
      }
    },
    {
      "name": "google_api",
      "status": "ok",
      "message": "API client ready",
      "latency": 3
    },
    {
      "name": "cache",
      "status": "ok",
      "message": "Cache operational, hit rate: 75.5%",
      "latency": 1
    },
    {
      "name": "request_deduplication",
      "status": "ok",
      "message": "Deduplication active, 45.2% savings",
      "latency": 1
    }
  ]
}
```

**Status Codes:**

- `200`: Healthy or degraded (can serve requests)
- `503`: Unhealthy (not ready for traffic)

## Performance Monitoring Resources

ServalSheets exposes several MCP resources for monitoring:

### Cache Statistics

```bash
# Via MCP Inspector or client
resource://cache://stats
```

**Provides:**

- Total cache entries and size
- Hit rate and miss rate
- Namespace breakdown
- Performance recommendations

### Request Deduplication Statistics

```bash
resource://cache://deduplication
```

**Provides:**

- Total requests vs actual API calls
- Deduplication rate and savings
- Result cache hit rate
- Efficiency breakdown

### Performance Metrics

```bash
resource://metrics://performance
```

**Provides:**

- Operation counts and latencies
- Circuit breaker status
- Rate limit tracking
- Error rates by category

### Active Conflicts

```bash
resource://conflict://active
```

**Provides:**

- Currently detected conflicts
- Conflict severity and resolution status
- Affected operations

## Unit Testing

Run the full test suite:

```bash
npm test
```

Run specific test files:

```bash
npm test -- circuit-breaker
npm test -- request-deduplication
npm test -- health
```

Run with coverage:

```bash
npm test -- --coverage
```

## Integration Testing

Test against a real Google Sheets API:

```bash
# Set credentials
export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json

# Run integration tests
npm run test:integration
```

## Debugging with VS Code

Create `.vscode/launch.json`:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "node",
      "request": "launch",
      "name": "Debug MCP Server",
      "skipFiles": ["<node_internals>/**"],
      "program": "${workspaceFolder}/dist/index.js",
      "preLaunchTask": "npm: build",
      "env": {
        "NODE_ENV": "development",
        "LOG_LEVEL": "debug",
        "GOOGLE_APPLICATION_CREDENTIALS": "/path/to/credentials.json"
      }
    },
    {
      "type": "node",
      "request": "launch",
      "name": "Debug Tests",
      "skipFiles": ["<node_internals>/**"],
      "runtimeExecutable": "npm",
      "runtimeArgs": ["test", "--", "--run"],
      "console": "integratedTerminal"
    }
  ]
}
```

## Log Levels

Control logging verbosity with the `LOG_LEVEL` environment variable:

```bash
# Minimal logging (errors only)
export LOG_LEVEL=error

# Standard production logging
export LOG_LEVEL=info

# Verbose logging for debugging
export LOG_LEVEL=debug
```

## Circuit Breaker Debugging

Monitor circuit breaker status via performance metrics resource or logs:

```typescript
// Check circuit breaker stats in code
const stats = circuitBreaker.getStats();
console.log({
  state: stats.state, // 'closed' | 'open' | 'half_open'
  failureCount: stats.failureCount,
  fallbackUsageCount: stats.fallbackUsageCount,
  registeredFallbacks: stats.registeredFallbacks,
});
```

## Request Deduplication Debugging

Monitor deduplication effectiveness:

```bash
# View deduplication stats resource
resource://cache://deduplication

# Check logs for deduplication events
grep "deduplicated" logs/servalsheets.log
```

## Common Debugging Scenarios

### Authentication Issues

```bash
# Check auth status
curl http://localhost:3000/health/ready | jq '.checks[] | select(.name=="auth")'

# Verify credentials
echo $GOOGLE_APPLICATION_CREDENTIALS
cat $GOOGLE_APPLICATION_CREDENTIALS | jq .client_email
```

### API Rate Limiting

```bash
# Check rate limit status in metrics
resource://metrics://performance

# Monitor circuit breaker state
grep "Circuit breaker state transition" logs/servalsheets.log
```

### Cache Performance

```bash
# View cache statistics
resource://cache://stats

# Check for low hit rates
curl http://localhost:3000/health/ready | jq '.checks[] | select(.name=="cache")'
```

### Memory Issues

```bash
# Monitor memory usage
curl http://localhost:3000/health/live | jq '.checks[0].metadata.memoryUsageMB'

# Check for cache size issues
resource://cache://stats | jq '.stats.totalSizeFormatted'
```

## Production Debugging

For production environments:

1. **Enable structured logging:**

   ```bash
   export LOG_FORMAT=json
   export LOG_LEVEL=info
   ```

2. **Monitor health endpoints:**
   - Set up liveness probe: `GET /health/live`
   - Set up readiness probe: `GET /health/ready`
   - Alert on 503 responses from readiness probe

3. **Track performance metrics:**
   - Query `resource://metrics://performance` periodically
   - Monitor cache hit rates via `resource://cache://stats`
   - Track API call reduction via `resource://cache://deduplication`

4. **Circuit breaker monitoring:**
   - Alert when circuit opens (check `state: 'open'` in metrics)
   - Monitor fallback usage counts
   - Track recovery (transition to `half_open` then `closed`)

## Troubleshooting Guide

| Issue                 | Diagnostic                               | Solution                               |
| --------------------- | ---------------------------------------- | -------------------------------------- |
| Server won't start    | Check `LOG_LEVEL=debug` output           | Verify credentials, dependencies       |
| Authentication fails  | `curl /health/ready` check auth          | Verify GOOGLE_APPLICATION_CREDENTIALS  |
| High latency          | Check `resource://metrics://performance` | Enable caching, review circuit breaker |
| Low cache hit rate    | Check `resource://cache://stats`         | Increase TTL, review cache strategy    |
| Circuit breaker opens | Check logs for repeated failures         | Investigate API errors, rate limits    |
| Memory issues         | Check `/health/live` memory usage        | Reduce cache size, check for leaks     |

## Further Resources

- [MCP Specification](https://modelcontextprotocol.io/specification)
- [MCP Inspector Documentation](https://github.com/modelcontextprotocol/inspector)
- [ServalSheets Architecture](./architecture-diagrams.md)
- [Development Log](./DEVELOPMENT_LOG.md)
