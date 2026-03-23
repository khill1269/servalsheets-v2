---
title: Troubleshooting Guide
category: guide
last_updated: 2026-02-03
description: This guide helps diagnose and resolve common issues with ServalSheets.
version: 1.6.0
tags: [troubleshooting, sheets, docker]
audience: user
difficulty: intermediate
---

# Troubleshooting Guide

This guide helps diagnose and resolve common issues with ServalSheets.

## Table of Contents

- [Quick Diagnostics](#quick-diagnostics)
- [Authentication Issues](#authentication-issues)
- [Rate Limiting and Quotas](#rate-limiting-and-quotas)
- [Permission Errors](#permission-errors)
- [Performance Issues](#performance-issues)
- [Memory Issues](#memory-issues)
- [Network and Connectivity](#network-and-connectivity)
- [Data Integrity](#data-integrity)
- [MCP Integration](#mcp-integration)
- [Common Error Messages](#common-error-messages)

---

## Quick Diagnostics

### Check Service Health

```bash
# Check if ServalSheets is running
ps aux | grep servalsheets

# Check health endpoint
curl http://localhost:3000/health/ready | jq .

# Check logs (last 100 lines)
tail -n 100 ~/Library/Logs/Claude/mcp-server-servalsheets.log
```

### Check Configuration

```bash
# Verify Claude Desktop config
cat ~/Library/Application\ Support/Claude/claude_desktop_config.json | jq .

# Check environment variables
env | grep GOOGLE
env | grep SERVALSHEETS
```

### Enable Debug Logging

```bash
# Enable debug mode
export LOG_LEVEL=debug
export LOG_FORMAT=json

# Restart ServalSheets
# (or restart Claude Desktop with ⌘+Q then reopen)

# Watch logs in real-time
tail -f ~/Library/Logs/Claude/mcp-server-servalsheets.log | jq .
```

### VS Code MCP Diagnostics

If you're working in VS Code, expose diagnostics to MCP clients:

1. Open the **Problems** panel and confirm diagnostics are populated.
2. Open Command Palette and run the MCP Diagnostics command.
3. Start the diagnostics MCP server from the extension.
4. Check **Output** for the server URL/port and confirm it's running.
5. Verify diagnostics are visible in your MCP client or MCP Inspector.

---

## Authentication Issues

### Issue: "Authentication failed"

**Symptoms**:

```json
{
  "error": {
    "code": "UNAUTHENTICATED",
    "message": "Request is missing required authentication credential"
  }
}
```

**Causes**:

1. No credentials configured
2. Invalid credentials
3. Expired OAuth token
4. Wrong environment variable

**Solutions**:

#### Check Credentials Exist

```bash
# Service Account
ls -la ~/.config/google/servalsheets-sa.json
# Should show: -rw------- (600 permissions)

# OAuth Token
echo $GOOGLE_ACCESS_TOKEN
# Should show: ya29.xxx (not empty)
```

#### Verify Credentials Format

```bash
# Service Account: Should be valid JSON
cat ~/.config/google/servalsheets-sa.json | jq .

# Check for required fields
cat ~/.config/google/servalsheets-sa.json | jq '.type, .project_id, .private_key, .client_email'
```

#### Fix Service Account Path

```bash
# Check current path
echo $GOOGLE_APPLICATION_CREDENTIALS

# Fix if wrong
export GOOGLE_APPLICATION_CREDENTIALS=~/.config/google/servalsheets-sa.json

# Update Claude Desktop config
cat > ~/Library/Application\ Support/Claude/claude_desktop_config.json <<EOF
{
  "mcpServers": {
    "servalsheets": {
      "command": "node",
      "args": ["$HOME/.config/servalsheets/dist/cli.js"],
      "env": {
        "GOOGLE_APPLICATION_CREDENTIALS": "$HOME/.config/google/servalsheets-sa.json"
      }
    }
  }
}
EOF

# Restart Claude Desktop (⌘+Q then reopen)
```

#### Refresh OAuth Token

```bash
# OAuth tokens expire in 1 hour
# Get new token from OAuth Playground:
# https://developers.google.com/oauthplayground/

# Update environment
export GOOGLE_ACCESS_TOKEN=ya29.new_token

# Or update Claude Desktop config
# (see above, replace GOOGLE_APPLICATION_CREDENTIALS with GOOGLE_ACCESS_TOKEN)
```

### Issue: "Service account does not exist"

**Symptoms**:

```json
{
  "error": {
    "code": "PERMISSION_DENIED",
    "message": "Service account does not exist"
  }
}
```

**Causes**:

- Service account was deleted in Google Cloud Console
- Using wrong project
- Service account disabled

**Solutions**:

```bash
# 1. Verify service account exists
# Google Cloud Console → IAM & Admin → Service Accounts
# Look for: servalsheets-prod@project-id.iam.gserviceaccount.com

# 2. Check service account email in JSON
cat ~/.config/google/servalsheets-sa.json | jq -r '.client_email'

# 3. If missing, create new service account:
# https://console.cloud.google.com/iam-admin/serviceaccounts
# Then download new key and update path
```

---

## Rate Limiting and Quotas

### Issue: "Rate limit exceeded" (429 errors)

**Symptoms**:

```json
{
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Quota exceeded for quota metric 'Read requests' and limit 'Read requests per minute per user'"
  }
}
```

**Causes**:

- Too many API requests in short time
- Rate limiter configured above actual quota
- Multiple applications using same project
- Batch operations not used

**Solutions**:

#### Check Current Quota Usage

```bash
# Check logs for quota usage
cat logs.json | jq 'select(.quotaType) | {timestamp, operation, quotaType}'

# Count operations in last minute
cat logs.json | jq -r 'select(.timestamp > "'$(date -u -v-1M +%Y-%m-%dT%H:%M:%S)'") | .quotaType' | sort | uniq -c
```

#### Reduce Rate Limits

```bash
# Lower read rate limit
export SERVALSHEETS_READS_PER_MINUTE=250   # Was 300

# Lower write rate limit
export SERVALSHEETS_WRITES_PER_MINUTE=50   # Was 60

# Update Claude Desktop config
cat > ~/Library/Application\ Support/Claude/claude_desktop_config.json <<EOF
{
  "mcpServers": {
    "servalsheets": {
      "command": "node",
      "args": ["$HOME/.config/servalsheets/dist/cli.js"],
      "env": {
        "GOOGLE_APPLICATION_CREDENTIALS": "$HOME/.config/google/servalsheets-sa.json",
        "SERVALSHEETS_READS_PER_MINUTE": "250",
        "SERVALSHEETS_WRITES_PER_MINUTE": "50"
      }
    }
  }
}
EOF

# Restart Claude Desktop
```

#### Enable Caching to Reduce API Calls

```bash
# Increase cache TTLs
export SERVALSHEETS_CACHE_METADATA_TTL=600000   # 10 minutes (was 5)
export SERVALSHEETS_CACHE_DATA_TTL=300000       # 5 minutes (was 1)

# Update config and restart
```

#### Use Batch Operations

```typescript
// Bad: Multiple individual calls
await read({ action: 'read', spreadsheetId: 'xxx', range: 'A1' });
await read({ action: 'read', spreadsheetId: 'xxx', range: 'B1' });
await read({ action: 'read', spreadsheetId: 'xxx', range: 'C1' });
// 3 API calls

// Good: Single batch call
await read({
  action: 'read',
  spreadsheetId: 'xxx',
  ranges: ['A1', 'B1', 'C1'],
});
// 1 API call
```

#### Request Quota Increase

```bash
# If you need higher quotas:
# 1. Go to Google Cloud Console
# 2. APIs & Services → Quotas
# 3. Filter: "Google Sheets API"
# 4. Select quota to increase
# 5. Click "EDIT QUOTAS"
# 6. Fill out request form

# Note: Increases typically processed within 1-2 business days
```

### Issue: "Quota exceeded" immediately on startup

**Symptoms**: Quota errors right after starting ServalSheets

**Causes**:

- Rate limiter misconfigured (too high)
- Burst of operations at startup
- Previous quota exhaustion not yet recovered

**Solutions**:

```bash
# Wait for quota to refill (1 minute)
sleep 60

# Start with conservative limits
export SERVALSHEETS_READS_PER_MINUTE=100
export SERVALSHEETS_WRITES_PER_MINUTE=20

# Gradually increase if no errors
```

---

## Permission Errors

### Issue: "Permission denied" when accessing spreadsheet

**Symptoms**:

```json
{
  "error": {
    "code": "PERMISSION_DENIED",
    "message": "The caller does not have permission"
  }
}
```

**Causes**:

- Spreadsheet not shared with service account
- Using OAuth but not owner of spreadsheet
- Insufficient permission level (Viewer instead of Editor)

**Solutions**:

#### Check Service Account Has Access

```bash
# 1. Get service account email
cat ~/.config/google/servalsheets-sa.json | jq -r '.client_email'
# Example: servalsheets-prod@project-id.iam.gserviceaccount.com

# 2. Open spreadsheet in Google Sheets
# 3. Click "Share" button
# 4. Add service account email
# 5. Grant "Editor" permission (or "Viewer" for read-only)
# 6. Uncheck "Notify people" (service accounts don't have email)
# 7. Click "Share"
```

#### Verify Spreadsheet ID is Correct

```bash
# Spreadsheet URL format:
# https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit

# Extract ID from URL:
# https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit
# ID: 1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms

# Test access
curl "https://sheets.googleapis.com/v4/spreadsheets/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms?fields=spreadsheetId,properties.title" \
  -H "Authorization: Bearer $(gcloud auth application-default print-access-token)"
```

#### Check OAuth Scopes

```bash
# Required scopes for OAuth:
# - https://www.googleapis.com/auth/spreadsheets
# - https://www.googleapis.com/auth/drive.file

# If using OAuth Playground, verify scopes are selected:
# https://developers.google.com/oauthplayground/
```

### Issue: "Insufficient permissions" for specific action

**Symptoms**:

```json
{
  "error": {
    "code": "PERMISSION_DENIED",
    "message": "The caller does not have permission to execute the operation: sheets.spreadsheets.values.update"
  }
}
```

**Causes**:

- Service account has Viewer permission (read-only)
- OAuth token missing required scope
- Protected range or sheet

**Solutions**:

```bash
# For Service Account:
# Change permission level to "Editor" in sharing settings

# For OAuth:
# Re-authorize with correct scopes (see above)

# For protected ranges:
# Spreadsheet → Data → Protected sheets and ranges
# Remove protection or add service account to editors list
```

---

## Performance Issues

### Issue: Operations taking too long (> 5 seconds)

**Symptoms**: Slow response times, timeouts

**Causes**:

- Using FULL diff on large spreadsheets
- Not using batch operations
- Cache disabled or expired
- Large cell ranges
- Network latency

**Solutions**:

#### Use Faster Diff Tier

```typescript
// Bad: FULL diff on large sheet (slow)
await diff({
  action: 'diff',
  spreadsheetId: 'xxx',
  diffTier: 'FULL', // Slow for > 10k cells
});

// Good: METADATA diff (fast)
await diff({
  action: 'diff',
  spreadsheetId: 'xxx',
  diffTier: 'METADATA', // Always fast
});
```

#### Enable and Tune Caching

```bash
# Enable aggressive caching
export SERVALSHEETS_CACHE_METADATA_TTL=600000   # 10 min
export SERVALSHEETS_CACHE_DATA_TTL=300000       # 5 min

# Increase cache size
export SERVALSHEETS_CACHE_METADATA_SIZE=200
export SERVALSHEETS_CACHE_DATA_SIZE=2000
```

#### Reduce Cell Range Size

```typescript
// Bad: Reading entire sheet
await read({
  action: 'read',
  spreadsheetId: 'xxx',
  range: 'Sheet1!A1:ZZ100000', // Huge range
});

// Good: Read only needed cells
await read({
  action: 'read',
  spreadsheetId: 'xxx',
  range: 'Sheet1!A1:D100', // Specific range
});
```

#### Use Streaming for Large Data

```typescript
// For large datasets, use streaming
for await (const batch of streamRows('xxx', 'Sheet1', 1000)) {
  // Process 1000 rows at a time
  processBatch(batch);
}
// Memory: ~100 KB (constant)
// vs. loading all at once: ~1 GB
```

#### Check Network Latency

```bash
# Test Google Sheets API latency
time curl -s -o /dev/null -w "%{time_total}\n" \
  "https://sheets.googleapis.com/v4/spreadsheets/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms?fields=spreadsheetId" \
  -H "Authorization: Bearer $(gcloud auth application-default print-access-token)"

# Should be < 500ms
# If > 1s, check network/firewall
```

### Issue: High CPU usage

**Symptoms**: CPU at 100%, slow operations

**Causes**:

- Large diff operations
- Complex formula calculations
- Many concurrent operations

**Solutions**:

```bash
# Reduce concurrent operations
export SERVALSHEETS_MAX_CONCURRENT=5  # Default: 10

# Use METADATA diff instead of FULL
# (see above)

# Check for formula recalculation issues
# (may be Google Sheets, not ServalSheets)
```

---

## Memory Issues

### Issue: High memory usage (> 1 GB)

**Symptoms**: Memory usage growing, eventual OOM crash

**Causes**:

- Loading large datasets into memory
- Cache size too large
- Memory leak (rare)
- Not using streaming

**Solutions**:

#### Use Streaming for Large Data

```typescript
// Bad: Load all data into memory
const allData = await read({
  action: 'read',
  spreadsheetId: 'xxx',
  range: 'A1:Z100000',
});
// Memory: ~100 MB

// Good: Stream data
for await (const batch of streamRows('xxx', 'Sheet1', 1000)) {
  processBatch(batch);
}
// Memory: ~1 MB (constant)
```

#### Reduce Cache Size

```bash
# Reduce cache limits
export SERVALSHEETS_CACHE_METADATA_SIZE=50   # Was 100
export SERVALSHEETS_CACHE_DATA_SIZE=500      # Was 1000

# Restart
```

#### Clear Cache Manually

```bash
# Clear cache via API
curl -X POST http://localhost:3000/cache/clear

# Or set shorter TTLs
export SERVALSHEETS_CACHE_METADATA_TTL=60000   # 1 min
export SERVALSHEETS_CACHE_DATA_TTL=30000       # 30 sec
```

#### Monitor Memory Usage

```bash
# Watch memory usage
watch -n 1 'ps aux | grep servalsheets | grep -v grep'

# Or use htop
htop -p $(pgrep -f servalsheets)

# Check for memory leaks (memory should stabilize, not grow indefinitely)
```

### Issue: Out of Memory (OOM) crash

**Symptoms**: Process killed with exit code 137

**Solutions**:

```bash
# Check system logs for OOM
dmesg | grep -i "killed process"

# Increase memory limit (if using Docker)
docker run -m 1g servalsheets

# Or reduce memory usage (see above)

# Set Node.js memory limit
export NODE_OPTIONS="--max-old-space-size=512"  # 512 MB
```

---

## Network and Connectivity

### Issue: "Network timeout" or "ECONNREFUSED"

**Symptoms**:

```json
{
  "error": {
    "code": "UNAVAILABLE",
    "message": "Connection timeout"
  }
}
```

**Causes**:

- No internet connection
- Firewall blocking Google APIs
- Proxy configuration issues
- Google Sheets API down (rare)

**Solutions**:

#### Check Internet Connectivity

```bash
# Test connection to Google
ping -c 3 sheets.googleapis.com

# Test HTTPS connection
curl -I https://sheets.googleapis.com/v4/
# Should return: HTTP/2 404
```

#### Check Firewall

```bash
# Ensure outbound HTTPS (443) is allowed to:
# - sheets.googleapis.com
# - www.googleapis.com
# - oauth2.googleapis.com

# Test with curl
curl -v https://sheets.googleapis.com/v4/
```

#### Configure Proxy (if needed)

```bash
# Set proxy environment variables
export HTTP_PROXY=http://proxy.example.com:8080
export HTTPS_PROXY=http://proxy.example.com:8080
export NO_PROXY=localhost,127.0.0.1

# Restart ServalSheets
```

#### Check Google API Status

```bash
# Check Google Workspace Status Dashboard:
# https://www.google.com/appsstatus/dashboard/

# If Google Sheets API is down, wait for restoration
```

---

## Data Integrity

### Issue: Data not updating as expected

**Symptoms**: Writing data but not seeing changes in spreadsheet

**Causes**:

- Cache returning stale data
- Wrong spreadsheet/sheet name
- Protected range preventing writes
- Formula overwriting values

**Solutions**:

#### Clear Cache

```bash
# Clear cache to see fresh data
curl -X POST http://localhost:3000/cache/clear

# Or disable cache temporarily
export SERVALSHEETS_CACHE_DATA_TTL=0
```

#### Verify Spreadsheet ID and Range

```bash
# Check spreadsheet ID in logs
cat logs.json | jq 'select(.operation == "sheets_core:write") | .spreadsheetId'

# Verify range
cat logs.json | jq 'select(.operation == "sheets_core:write") | .range'
```

#### Check for Protected Ranges

```bash
# In Google Sheets:
# Data → Protected sheets and ranges
# Verify no protection on target range
```

#### Use expectedState for Safety

```typescript
// Ensure data hasn't changed before writing
await write({
  action: 'write',
  spreadsheetId: 'xxx',
  range: 'A1:A10',
  values: [[1], [2], [3]],
  expectedState: {
    checksums: { 'A1:A10': 'abc123' },
  },
});
// Will fail if data changed since last read
```

### Issue: Formulas not calculating

**Symptoms**: Formula shows as text or doesn't calculate

**Causes**:

- Writing formula as string value instead of formula
- Formula syntax error
- Circular reference

**Solutions**:

```typescript
// Bad: Writing formula as string
await write({
  action: 'write',
  spreadsheetId: 'xxx',
  range: 'A1',
  values: [['=SUM(B1:B10)']], // Treated as text
});

// Good: Write with userEnteredValue
await write({
  action: 'write',
  spreadsheetId: 'xxx',
  range: 'A1',
  values: [['=SUM(B1:B10)']],
  valueInputOption: 'USER_ENTERED', // Parses as formula
});
```

---

## MCP Integration

### Issue: ServalSheets not appearing in Claude Desktop

**Symptoms**: No 🔨 icon (standard MCP indicator), tools not available

**Causes**:

- Config file missing or invalid
- JSON syntax error in config
- Wrong CLI path
- ServalSheets not installed

**Solutions**:

#### Verify Config File

```bash
# Check config exists
ls -la ~/Library/Application\ Support/Claude/claude_desktop_config.json

# Validate JSON
cat ~/Library/Application\ Support/Claude/claude_desktop_config.json | jq .

# If error, fix JSON syntax
```

#### Verify CLI Path

```bash
# Check CLI exists
ls -la ~/.config/servalsheets/dist/cli.js

# Or if globally installed
which servalsheets
```

#### Check Logs

```bash
# View Claude Desktop logs
cat ~/Library/Logs/Claude/mcp.log

# View ServalSheets logs
cat ~/Library/Logs/Claude/mcp-server-servalsheets.log

# Look for errors
tail -f ~/Library/Logs/Claude/mcp-server-servalsheets.log | jq 'select(.level == "error")'
```

#### Restart Claude Desktop

```bash
# Fully quit Claude Desktop
# ⌘+Q

# Wait 2 seconds

# Reopen Claude Desktop
open -a "Claude"

# Look for 🔨 icon in bottom-right (custom ServalSheets icon may not appear yet)
```

### Issue: Tools fail silently

**Symptoms**: No error, but tool doesn't work

**Causes**:

- MCP stdio communication error
- ServalSheets crashed
- Malformed tool input

**Solutions**:

```bash
# Check if ServalSheets process is running
ps aux | grep servalsheets

# Check logs for crashes
tail -n 100 ~/Library/Logs/Claude/mcp-server-servalsheets.log | jq 'select(.level == "error")'

# Enable debug logging
# Edit config to add:
{
  "mcpServers": {
    "servalsheets": {
      "command": "node",
      "args": ["~/.config/servalsheets/dist/cli.js"],
      "env": {
        "LOG_LEVEL": "debug"
      }
    }
  }
}

# Restart Claude Desktop
```

---

## Common Error Messages

### "Spreadsheet not found"

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Requested entity was not found"
  }
}
```

**Solutions**:

- Verify spreadsheet ID is correct
- Ensure spreadsheet not deleted
- Check service account has access

### "Invalid range"

```json
{
  "error": {
    "code": "INVALID_ARGUMENT",
    "message": "Unable to parse range: Sheet1!A1:B"
  }
}
```

**Solutions**:

- Fix range format: `Sheet1!A1:B10` (not `Sheet1!A1:B`)
- Use valid A1 notation
- Ensure sheet name exists

### "Field mask not found"

```json
{
  "error": {
    "code": "INVALID_ARGUMENT",
    "message": "Unable to parse field mask"
  }
}
```

**Solutions**:

- This is a ServalSheets bug - report to developers
- Workaround: Use simpler operation

### "Request payload size exceeds the limit"

```json
{
  "error": {
    "code": "INVALID_ARGUMENT",
    "message": "Request payload size exceeds the limit: 10485760 bytes"
  }
}
```

**Solutions**:

- Reduce batch size (< 10 MB)
- Split large writes into multiple batches
- Use effect scope limits to prevent this

---

## Getting Help

### Collect Diagnostic Information

```bash
# Create diagnostic report
cat > diagnostic-report.txt <<EOF
ServalSheets Diagnostic Report
Generated: $(date)

=== Environment ===
NODE_ENV: ${NODE_ENV:-not set}
LOG_LEVEL: ${LOG_LEVEL:-not set}
$(node --version)

=== Configuration ===
$(cat ~/Library/Application\ Support/Claude/claude_desktop_config.json 2>/dev/null | jq . || echo "Config not found")

=== Recent Logs ===
$(tail -n 50 ~/Library/Logs/Claude/mcp-server-servalsheets.log 2>/dev/null || echo "Logs not found")

=== Health Check ===
$(curl -s http://localhost:3000/health/ready 2>/dev/null | jq . || echo "Health check failed")

=== Metrics ===
$(curl -s http://localhost:9090/metrics 2>/dev/null || echo "Metrics not available")
EOF

cat diagnostic-report.txt
```

### Report Issues

1. **GitHub Issues**: https://github.com/khill1269/servalsheets/issues
2. **Security Issues**: security@anthropic.com
3. **Documentation**: See `README.md`, `SECURITY.md`, `PERFORMANCE.md`

### Include in Bug Reports

- ServalSheets version
- Operating system
- Node.js version
- Error message (full text)
- Recent logs (last 50 lines)
- Steps to reproduce
- Configuration (redact credentials!)

---

## Summary

Common issues and quick fixes:

| Issue                 | Quick Fix                                    |
| --------------------- | -------------------------------------------- |
| Authentication failed | Check credentials path, verify JSON format   |
| Rate limit exceeded   | Reduce `SERVALSHEETS_*_PER_MINUTE` values    |
| Permission denied     | Share spreadsheet with service account email |
| Slow operations       | Use METADATA diff, enable caching            |
| High memory           | Use streaming, reduce cache size             |
| Network timeout       | Check firewall, verify internet connection   |
| Not in Claude Desktop | Verify config JSON, check CLI path, restart  |

**Key Takeaway**: Enable debug logging (`LOG_LEVEL=debug`) to diagnose most issues. Check logs at `~/Library/Logs/Claude/mcp-server-servalsheets.log`.

For more information:

- Security: `SECURITY.md`
- Performance: `PERFORMANCE.md`
- Monitoring: `MONITORING.md`
- Deployment: `DEPLOYMENT.md`
