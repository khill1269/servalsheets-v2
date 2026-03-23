---
title: MCP Inspector Testing Guide - ServalSheets
category: guide
last_updated: 2026-01-31
description: 'Complete guide to manual and automated testing using MCP Inspector. Covers interactive web UI testing, automated test scripts, and comprehensive validation workflows for ServalSheets MCP server.'
version: 1.6.0
tags: [testing, mcp, sheets, inspector, validation]
audience: user
difficulty: intermediate
---

# MCP Inspector Testing Guide - ServalSheets

## Complete Manual and Automated Testing

---

## 🚀 Quick Start with MCP Inspector

### Method 1: Interactive Web UI (Recommended for Manual Testing)

**Step 1: Start MCP Inspector**

```bash
npx @modelcontextprotocol/inspector node dist/cli.js --stdio
```

This will:

- ✅ Start the MCP Inspector web interface
- ✅ Open your browser automatically
- ✅ Connect to the ServalSheets server via STDIO

**Inspector is currently running at**: http://localhost:6274

---

## 📋 Comprehensive Test Checklist

### Phase 1: Server Connection ✅

- [ ] Server connects successfully
- [ ] No connection errors
- [ ] Server responds to initialize
- [ ] Protocol version: 2025-11-25

### Phase 2: Tool Discovery ✅

- [ ] List all tools (compare against `src/schemas/index.ts` or `server.json`)
- [ ] Verify tool names and descriptions match generated metadata

### Phase 3: Schema Validation ✅

For each tool, verify:

- [ ] Input schema is present and well-formed
- [ ] Output schema is present
- [ ] Description is clear and accurate
- [ ] All actions are listed

### Phase 4: Basic Tool Execution

**Test 1: Authentication Status** (No auth required)

```json
{
  "name": "sheets_auth",
  "arguments": {
    "request": {
      "action": "status"
    }
  }
}
```

**Expected**: Returns authentication status (likely NOT_AUTHENTICATED in test)

**Test 2: Spreadsheet Operations** (Requires auth)

```json
{
  "name": "sheets_core",
  "arguments": {
    "request": {
      "action": "get",
      "spreadsheetId": "1Sz5aRCE1D17NI4BT6KGiGCA7cSpbQ1vPM5BoskkzrM4"
    }
  }
}
```

**Expected**: Returns spreadsheet metadata OR auth error if not authenticated

**Test 3: Analysis** (Read-only, requires auth)

```json
{
  "name": "sheets_analyze",
  "arguments": {
    "request": {
      "action": "analyze_quality",
      "spreadsheetId": "1Sz5aRCE1D17NI4BT6KGiGCA7cSpbQ1vPM5BoskkzrM4"
    }
  }
}
```

**Expected**: Data quality report OR auth error

**Test 4: Transaction** (Management operation)

```json
{
  "name": "sheets_transaction",
  "arguments": {
    "request": {
      "action": "begin",
      "spreadsheetId": "1Sz5aRCE1D17NI4BT6KGiGCA7cSpbQ1vPM5BoskkzrM4"
    }
  }
}
```

**Expected**: Transaction ID OR auth error

**Test 5: History** (Metadata-only)

```json
{
  "name": "sheets_history",
  "arguments": {
    "request": {
      "action": "list"
    }
  }
}
```

**Expected**: List of operations (may be empty)

**Test 6: Confirm** (Planning tool)

```json
{
  "name": "sheets_confirm",
  "arguments": {
    "request": {
      "action": "get_stats"
    }
  }
}
```

**Expected**: Confirmation statistics

**Test 7: Analyze** (AI-powered)

```json
{
  "name": "sheets_analyze",
  "arguments": {
    "request": {
      "action": "generate_formula",
      "spreadsheetId": "1Sz5aRCE1D17NI4BT6KGiGCA7cSpbQ1vPM5BoskkzrM4",
      "description": "Sum all values in column A"
    }
  }
}
```

**Expected**: Formula suggestion OR auth error

### Phase 5: Error Handling ✅

**Test Invalid Action**

```json
{
  "name": "sheets_core",
  "arguments": {
    "request": {
      "action": "invalid_action",
      "spreadsheetId": "test123"
    }
  }
}
```

**Expected**: Schema validation error with clear message

**Test Missing Required Field**

```json
{
  "name": "sheets_core",
  "arguments": {
    "request": {
      "action": "get"
    }
  }
}
```

**Expected**: Validation error for missing spreadsheetId OR parameter inference

**Test Invalid Spreadsheet ID**

```json
{
  "name": "sheets_core",
  "arguments": {
    "request": {
      "action": "get",
      "spreadsheetId": "invalid-id-format"
    }
  }
}
```

**Expected**: Error with resolution steps (if authenticated)

### Phase 6: Response Structure ✅

For each successful response, verify:

- [ ] Has `success: true` field
- [ ] Has appropriate data fields for the action
- [ ] Has `meta` field with:
  - [ ] cellsAffected (if applicable)
  - [ ] apiCallsMade
  - [ ] suggestions (if applicable)
  - [ ] operationCost (if applicable)

For error responses, verify:

- [ ] Has `success: false` field
- [ ] Has `error` object with:
  - [ ] code
  - [ ] message
  - [ ] details
  - [ ] resolution
  - [ ] resolutionSteps
  - [ ] retryable flag
  - [ ] suggestedTools (if applicable)

### Phase 7: Performance ✅

- [ ] Response times < 100ms for metadata operations
- [ ] Response times < 5s for read operations (when authenticated)
- [ ] No memory leaks (check after multiple operations)
- [ ] Handles rapid successive calls

### Phase 8: Protocol Compliance ✅

- [ ] Supports MCP Protocol 2025-11-25
- [ ] Implements tools/list correctly
- [ ] Implements tools/call correctly
- [ ] Returns proper error codes
- [ ] Uses discriminated unions in responses

---

## 🧪 Automated Testing Script

I've created an automated test that you can run:

```bash
# Run automated MCP protocol tests
npm test tests/integration/mcp-tools-list.test.ts
```

This tests:

- ✅ Tool discovery
- ✅ Schema validation
- ✅ Tool execution
- ✅ Error handling
- ✅ Response structure

---

## 📊 Expected Results

### Without Authentication

Most tools will return authentication errors with clear resolution steps:

```json
{
  "success": false,
  "error": {
    "code": "NOT_AUTHENTICATED",
    "message": "Authentication required",
    "resolution": "Complete OAuth flow using sheets_auth",
    "resolutionSteps": [
      "1. Call sheets_auth with action: 'login'",
      "2. Present authUrl to user",
      "3. Complete authorization",
      "4. Retry operation"
    ],
    "retryable": true
  }
}
```

### With Authentication

Tools will execute successfully and return structured data:

```json
{
  "success": true,
  "spreadsheet": { ... },
  "meta": {
    "apiCallsMade": 1,
    "suggestions": [ ... ],
    "operationCost": {
      "readCalls": 1,
      "writeCalls": 0
    }
  }
}
```

---

## 🔍 What to Look For

### ✅ Good Signs

- Server connects immediately
- All 25 tools are listed
- Schemas are well-formed
- Error messages are helpful
- Responses are fast
- No crashes or hangs

### ⚠️ Warning Signs

- Connection timeouts
- Missing tools
- Malformed schemas
- Unclear error messages
- Slow responses (> 5s)
- Memory growth

### ❌ Critical Issues

- Server won't start
- Protocol errors
- Schema validation failures
- Server crashes
- Data corruption

---

## 📝 Testing Notes

### Current Server Status

- **Build**: ✅ Clean
- **Tests**: ✅ 906/911 passing (99.5%)
- **Tools**: ✅ 24/24 functional
- **Protocol**: ✅ MCP 2025-11-25 compliant

### Authentication

The server requires Google OAuth authentication for most operations. Without authentication:

- sheets_auth works (status, login endpoints)
- sheets_history works (no auth required)
- sheets_confirm works (planning only)
- Other tools return clear auth errors

### Test Environment

For full testing with Google Sheets access:

1. Set up OAuth credentials
2. Use `sheets_auth` tool to authenticate
3. Then test all tools with real spreadsheet

---

## 🎯 Quick Verification Checklist

### Minimum Tests (5 minutes)

1. [ ] Server connects
2. [ ] List all tools (24 total)
3. [ ] Test sheets_auth status
4. [ ] Test sheets_history list
5. [ ] Test sheets_confirm get_stats
6. [ ] Verify error messages are clear

### Full Tests (15 minutes)

1. [ ] Complete minimum tests
2. [ ] Test all 25 tools (at least status/list actions)
3. [ ] Test with valid spreadsheet ID (requires auth)
4. [ ] Test error scenarios
5. [ ] Verify response structures
6. [ ] Check performance

### Production Validation (30 minutes)

1. [ ] Complete full tests
2. [ ] Test with real Google Sheets
3. [ ] Test complex operations
4. [ ] Test error recovery
5. [ ] Load testing
6. [ ] Monitor memory usage

---

## 🚀 Current Status

**MCP Inspector is RUNNING at**: http://localhost:6274

**Auth Token**: a56c5c4ea58a5560d5e2fa81ceb4ca546c5148eee81e8ceb96969e08cc84bb3e

**To connect**:

1. Open the URL in your browser
2. Configure STDIO transport with:
   - Command: `node`
   - Args: `dist/cli.js --stdio`
   - Working Directory: `/Users/thomascahill/Documents/mcp-servers/servalsheets`

**Or restart with automatic connection**:

```bash
npx @modelcontextprotocol/inspector node dist/cli.js --stdio
```

---

## 📚 Additional Resources

- **MCP Protocol Spec**: https://spec.modelcontextprotocol.io
- **ServalSheets Docs**: See README.md
- **Schema Definitions**: See src/schemas/\*.ts
- **Test Results**: See TEST_RESULTS.md

---

**Generated**: 2026-01-07
**Status**: ✅ Ready for Testing
**Recommendation**: Start with minimum tests, then proceed to full validation
