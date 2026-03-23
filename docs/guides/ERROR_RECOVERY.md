---
title: Error Recovery Guide
category: guide
last_updated: 2026-01-31
description: 'Version: 1.6.0'
version: 1.6.0
audience: user
difficulty: intermediate
---

# Error Recovery Guide

**Version**: 1.6.0
**Last Updated**: 2026-01-30

---

## Table of Contents

1. [Overview](#overview)
2. [Error Response Structure](#error-response-structure)
3. [Recovery by Error Category](#recovery-by-error-category)
4. [Recovery by Error Code](#recovery-by-error-code)
5. [Retry Strategies](#retry-strategies)
6. [Common Error Scenarios](#common-error-scenarios)
7. [Error Prevention](#error-prevention)

---

## Overview

This guide provides systematic recovery procedures for all 40+ error codes in ServalSheets. Every error includes:

- Clear error message
- Severity level (low, medium, high, critical)
- Retry strategy
- Resolution steps
- Suggested tools for fixing the issue

### Error Philosophy

ServalSheets errors are **agent-actionable**: Claude can understand and act on them without human intervention in most cases.

---

## Error Response Structure

Every error follows this structure:

```json
{
  "response": {
    "success": false,
    "error": {
      "code": "PERMISSION_DENIED",
      "message": "Permission denied: Cannot write to spreadsheet. Current access: view, required: edit",
      "category": "auth",
      "severity": "high",
      "retryable": false,
      "retryStrategy": "manual",
      "resolution": "Request edit access from the spreadsheet owner or use read-only operations",
      "resolutionSteps": [
        "1. Check current permission level: Use 'sheets_collaborate' tool with action 'share_list' to verify access",
        "2. Request edit access from the spreadsheet owner",
        "3. Alternative: Use read-only operations (sheets_data with action 'read')",
        "4. If you're the owner: Use 'sheets_collaborate' tool with action 'share_add' to give yourself edit access"
      ],
      "suggestedTools": ["sheets_collaborate", "sheets_data", "sheets_core"],
      "details": {
        "operation": "write",
        "resourceType": "spreadsheet",
        "resourceId": "1A2B3C4D5E6F7G8H9I0J",
        "currentPermission": "view",
        "requiredPermission": "edit"
      }
    }
  }
}
```

### Field Descriptions

| Field             | Type    | Description                                                               |
| ----------------- | ------- | ------------------------------------------------------------------------- |
| `code`            | string  | Error code (e.g., `PERMISSION_DENIED`)                                    |
| `message`         | string  | Human-readable error description                                          |
| `category`        | enum    | Error category: `client`, `server`, `auth`, `quota`, `network`, `unknown` |
| `severity`        | enum    | Impact level: `low`, `medium`, `high`, `critical`                         |
| `retryable`       | boolean | Whether retrying might succeed                                            |
| `retryStrategy`   | enum    | How to retry: `none`, `manual`, `exponential_backoff`, `wait_for_reset`   |
| `resolution`      | string  | One-line fix summary                                                      |
| `resolutionSteps` | array   | Step-by-step recovery instructions                                        |
| `suggestedTools`  | array   | Tools that can help fix the issue                                         |
| `details`         | object  | Error-specific context                                                    |

---

## Recovery by Error Category

### `client` Category - Client-Side Errors

**Characteristic**: Problem with the request itself

**Recovery Strategy:**

1. Fix the request parameters
2. Validate input format
3. Retry with corrected values

**Retryable**: ❌ No (fixing required)

**Examples**: `INVALID_REQUEST`, `VALIDATION_ERROR`, `INVALID_RANGE`

---

### `server` Category - Server-Side Errors

**Characteristic**: Problem on Google's servers

**Recovery Strategy:**

1. Wait a moment
2. Retry with exponential backoff
3. If persists >10 min, check Google API status

**Retryable**: ✅ Yes

**Examples**: `INTERNAL_ERROR`, `UNAVAILABLE`

---

### `auth` Category - Authentication/Authorization

**Characteristic**: Authentication or permission issue

**Recovery Strategy:**

1. Check if authenticated: Use `sheets_auth` tool
2. Verify permissions: Use `sheets_collaborate` tool
3. Re-authenticate if token expired
4. Request access if permission denied

**Retryable**: ❌ No (manual action required)

**Examples**: `PERMISSION_DENIED`, `UNAUTHENTICATED`, `INVALID_CREDENTIALS`

---

### `quota` Category - Rate/Quota Limits

**Characteristic**: Too many requests or quota exceeded

**Recovery Strategy:**

1. Wait for reset (check `retryAfterMs` in error details)
2. Use batch operations to reduce API calls
3. Enable caching
4. Implement exponential backoff

**Retryable**: ✅ Yes (after waiting)

**Examples**: `RATE_LIMITED`, `QUOTA_EXCEEDED`, `RESOURCE_EXHAUSTED`

---

### `network` Category - Network Issues

**Characteristic**: Connectivity or timeout problems

**Recovery Strategy:**

1. Check network connectivity
2. Retry with exponential backoff
3. Increase timeout if applicable
4. Consider circuit breaker pattern

**Retryable**: ✅ Yes

**Examples**: `NETWORK_ERROR`, `TIMEOUT`, `DEADLINE_EXCEEDED`

---

## Recovery by Error Code

### Authentication & Authorization Errors

#### `UNAUTHENTICATED` - Not Authenticated

**Severity**: Critical

**Cause**: No access token provided

**Recovery:**

```javascript
// 1. Check authentication status
const authResult = await sheetsAuth.handle({ action: 'status' });

if (!authResult.response.authenticated) {
  // 2. Authenticate
  console.log('Please authenticate...');
  // Follow OAuth flow or provide credentials
}

// 3. Retry original operation
```

**Resolution Steps:**

1. Run authentication: `npm run auth`
2. Follow OAuth flow in browser
3. Grant required permissions
4. Retry operation

---

#### `PERMISSION_DENIED` - Insufficient Permissions

**Severity**: High

**Cause**: User lacks required access level

**Recovery:**

```javascript
// 1. Check current permissions
const shareList = await sheetsCollaborate.handle({
  action: 'share_list',
  spreadsheetId: '1A2B3C4D5E6F7G8H9I0J',
});

// 2. Identify permission level
const myPermission = shareList.response.permissions.find(
  (p) => p.type === 'user' && p.emailAddress === myEmail
);

console.log('Current access:', myPermission.role);
// Output: "reader" (need "writer" or "owner")

// 3. Request access upgrade
console.log(
  'Request edit access from:',
  shareList.response.permissions.find((p) => p.role === 'owner').emailAddress
);

// 4. Alternative: Use read-only operations
const data = await sheetsData.handle({
  action: 'read',
  spreadsheetId: '1A2B3C4D5E6F7G8H9I0J',
  range: 'Sheet1!A1:B10',
});
```

---

#### `INVALID_CREDENTIALS` - Invalid Token

**Severity**: Critical

**Cause**: Access token is malformed or revoked

**Recovery:**

```javascript
// 1. Clear token storage
await clearStoredTokens();

// 2. Re-authenticate
console.log('Please re-authenticate...');
// Start fresh OAuth flow

// 3. Retry operation
```

---

#### `INSUFFICIENT_PERMISSIONS` - Missing Scopes

**Severity**: Critical

**Cause**: OAuth token doesn't have required scopes

**Recovery:**

```javascript
// 1. Check error details for missing scopes
const missingScopes = error.details.missingScopes;
console.log('Missing scopes:', missingScopes);

// 2. Re-authenticate with additional scopes
// Force consent screen to show all permissions
console.log('Re-run: npm run auth');

// 3. Grant all requested permissions in OAuth screen

// 4. Retry operation
```

---

### Quota & Rate Limiting Errors

#### `RATE_LIMITED` - Too Many Requests

**Severity**: Medium

**Cause**: Exceeded API rate limit (100 requests/100 seconds/user)

**Recovery:**

```javascript
const error = result.response.error;
const retryAfterMs = error.details.retryAfterMs;
const retryAfterSeconds = Math.ceil(retryAfterMs / 1000);

console.log(`Rate limited. Retry after ${retryAfterSeconds} seconds...`);

// 1. Wait for reset
await sleep(retryAfterMs);

// 2. Retry with backoff
let attempt = 0;
let success = false;

while (!success && attempt < 5) {
  const result = await retryOperation();

  if (result.response.success) {
    success = true;
  } else if (result.response.error.code === 'RATE_LIMITED') {
    attempt++;
    const backoffMs = Math.min(1000 * Math.pow(2, attempt), 60000);
    console.log(`Attempt ${attempt} failed. Retry in ${backoffMs}ms...`);
    await sleep(backoffMs);
  } else {
    throw new Error('Different error occurred');
  }
}

// 3. Future prevention: Use batch operations
const batchResult = await sheetsData.handle({
  action: 'batch_read',
  spreadsheetId: '...',
  ranges: ['Sheet1!A1:B10', 'Sheet2!C1:D20', 'Sheet3!E1:F30'],
});
// 1 API call instead of 3!
```

---

#### `QUOTA_EXCEEDED` - Quota Limit Reached

**Severity**: Medium

**Cause**: Daily quota exhausted

**Recovery:**

```javascript
// 1. Check quota details
console.log('Quota type:', error.details.quotaType);
console.log('Reset time:', error.details.resetTime);

// 2. Calculate wait time
const resetTime = new Date(error.details.resetTime);
const waitMs = resetTime.getTime() - Date.now();

if (waitMs > 0 && waitMs < 3600000) {
  // Less than 1 hour
  console.log(`Waiting ${Math.ceil(waitMs / 60000)} minutes for quota reset...`);
  await sleep(waitMs);
  return retryOperation();
} else {
  // 3. Use alternative approach
  console.log('Consider:');
  console.log('- Upgrade to Google Workspace (higher quotas)');
  console.log('- Use batch operations to reduce call count');
  console.log('- Spread operations across multiple days');
}
```

---

### Spreadsheet Errors

#### `SPREADSHEET_NOT_FOUND` - Spreadsheet Missing

**Severity**: Medium

**Cause**: Spreadsheet doesn't exist or user has no access

**Recovery:**

```javascript
// 1. Verify spreadsheet ID is correct
const spreadsheetId = '1A2B3C4D5E6F7G8H9I0J';
console.log('Check URL: https://docs.google.com/spreadsheets/d/' + spreadsheetId);

// 2. Test access
try {
  const result = await sheetsCore.handle({
    action: 'get',
    spreadsheetId: spreadsheetId,
  });
  console.log('Spreadsheet accessible:', result.response.title);
} catch (e) {
  console.log('Cannot access spreadsheet:');
  console.log('- Verify spreadsheet ID is correct');
  console.log('- Check if spreadsheet was deleted');
  console.log('- Confirm you have permission to access it');
  console.log('- Request access from owner if needed');
}
```

---

#### `SHEET_NOT_FOUND` - Sheet (Tab) Missing

**Severity**: Medium

**Cause**: Sheet name/ID doesn't exist in spreadsheet

**Recovery:**

```javascript
// 1. List all sheets
const listResult = await sheetsCore.handle({
  action: 'list_sheets',
  spreadsheetId: '1A2B3C4D5E6F7G8H9I0J',
});

console.log('Available sheets:');
listResult.response.sheets.forEach((sheet) => {
  console.log(`- "${sheet.title}" (ID: ${sheet.sheetId})`);
});

// 2. Find correct sheet
const targetSheet = listResult.response.sheets.find((s) => s.title.toLowerCase().includes('sales'));

if (targetSheet) {
  // 3. Retry with correct sheet ID
  return retryWithSheet(targetSheet.sheetId);
} else {
  console.log(
    'Sheet not found. Available: ' + listResult.response.sheets.map((s) => s.title).join(', ')
  );
}
```

---

#### `INVALID_RANGE` - Malformed Range

**Severity**: Medium

**Cause**: Invalid A1 notation format

**Recovery:**

```javascript
// Common mistakes and fixes:

// ❌ Missing sheet name (if not first sheet)
'A1:B10';
// ✅ Include sheet name
'Sheet1!A1:B10';

// ❌ Unquoted sheet name with spaces
'Sales Data!A1:B10';
// ✅ Quote sheet names with spaces
"'Sales Data'!A1:B10";

// ❌ Wrong separator
'Sheet1:A1:B10';
// ✅ Use exclamation mark
'Sheet1!A1:B10';

// ❌ Invalid cell reference
'Sheet1!AA';
// ✅ Include row number
'Sheet1!AA1';
```

---

#### `PROTECTED_RANGE` - Range is Protected

**Severity**: Medium

**Cause**: Range has protection rules preventing edits

**Recovery:**

```javascript
// 1. Check protection status
const sheetMetadata = await sheetsCore.handle({
  action: 'get',
  spreadsheetId: '1A2B3C4D5E6F7G8H9I0J',
});

const protectedRanges = sheetMetadata.response.protectedRanges || [];
console.log('Protected ranges:', protectedRanges.length);

// 2. Find overlapping protection
const myRange = 'Sheet1!A1:B10';
// Check if myRange overlaps with any protected range

// 3. Options:
// A) Request edit permissions from range owner
console.log('Request edit access from protection owner');

// B) Use unprotected range
console.log('Or write to different range');

// C) Remove protection (if you're owner)
// Use sheets_advanced tool with action 'remove_protected_range'
```

---

### Data & Formula Errors

#### `FORMULA_ERROR` - Invalid Formula

**Severity**: Medium

**Cause**: Formula syntax error

**Recovery:**

```javascript
// Common formula errors:

// ❌ Missing equals sign
'SUM(A1:A10)';
// ✅ Start with =
'=SUM(A1:A10)';

// ❌ Wrong function name
'=SUMM(A1:A10)';
// ✅ Correct spelling
'=SUM(A1:A10)';

// ❌ Unmatched parentheses
'=SUM(A1:A10';
// ✅ Close all parentheses
'=SUM(A1:A10)';

// ❌ Invalid range reference
'=SUM(A1-A10)';
// ✅ Use colon
'=SUM(A1:A10)';

// Test formula first with sheets_data:
const testResult = await sheetsData.handle({
  action: 'write',
  spreadsheetId: '...',
  range: 'TestSheet!A1',
  values: [['=SUM(A2:A10)']],
  valueInputOption: 'USER_ENTERED',
});
```

---

#### `CIRCULAR_REFERENCE` - Circular Dependency

**Severity**: High

**Cause**: Formula references itself directly or indirectly

**Recovery:**

```javascript
// Example circular reference:
// A1: =B1+1
// B1: =C1*2
// C1: =A1/3  ← Creates cycle: A1→B1→C1→A1

// 1. Detect cycles
const cycleResult = await sheetsDependencies.handle({
  action: 'detect_cycles',
  spreadsheetId: '1A2B3C4D5E6F7G8H9I0J',
});

if (cycleResult.response.circularDependencies.length > 0) {
  console.log('Found circular dependencies:');
  cycleResult.response.circularDependencies.forEach((cycle) => {
    console.log('Chain:', cycle.chain);
    console.log('Cells:', cycle.cycle.join(' → '));
  });

  // 2. Break the cycle
  // Change one formula in the chain to not reference the cycle
  // Example: Change C1 to use a different cell or static value
}
```

---

### Operation Errors

#### `MERGE_CONFLICT` - Concurrent Modification

**Severity**: Medium

**Cause**: Another user/process modified spreadsheet simultaneously

**Recovery:**

```javascript
// 1. Fetch latest state
const freshData = await sheetsData.handle({
  action: 'read',
  spreadsheetId: '1A2B3C4D5E6F7G8H9I0J',
  range: 'Sheet1!A1:B10'
});

// 2. Reapply your changes to fresh data
const updatedValues = mergeChanges(freshData.response.values, myChanges);

// 3. Write with latest data
const writeResult = await sheetsData.handle({
  action: 'write',
  spreadsheetId: '1A2B3C4D5E6F7G8H9I0J',
  range: 'Sheet1!A1:B10',
  values: updatedValues
});

// 4. For critical operations, use transactions
const txResult = await sheetsTransaction.handle({
  action: 'begin',
  spreadsheetId: '1A2B3C4D5E6F7G8H9I0J',
  operations: [
    { tool: 'sheets_data', action: 'write', ... }
  ]
});
// Transactions are atomic - all succeed or all fail
```

---

#### `TIMEOUT` / `DEADLINE_EXCEEDED` - Operation Too Slow

**Severity**: High

**Cause**: Operation took longer than timeout limit

**Recovery:**

```javascript
// 1. Reduce operation size
// ❌ Too large
const largeWrite = await sheetsData.handle({
  action: 'write',
  spreadsheetId: '...',
  range: 'Sheet1!A1:Z10000', // 260,000 cells
  values: hugeArray,
});

// ✅ Break into batches
const batchSize = 1000; // rows
for (let i = 0; i < totalRows; i += batchSize) {
  const batch = data.slice(i, i + batchSize);
  await sheetsData.handle({
    action: 'write',
    spreadsheetId: '...',
    range: `Sheet1!A${i + 1}:Z${i + batchSize}`,
    values: batch,
  });

  // Small delay between batches
  await sleep(100);
}

// 2. Increase timeout (if configurable)
// 3. Use simpler operations (avoid complex formulas)
// 4. Retry with exponential backoff
```

---

#### `PAYLOAD_TOO_LARGE` - Request Too Big

**Severity**: Medium

**Cause**: Request exceeds 10MB size limit

**Recovery:**

```javascript
// 1. Calculate payload size
const payloadSize = JSON.stringify(request).length;
console.log('Payload size:', (payloadSize / 1024 / 1024).toFixed(2), 'MB');

if (payloadSize > 10 * 1024 * 1024) {
  // 2. Split into smaller chunks
  const chunkSize = 1000;
  const chunks = [];

  for (let i = 0; i < data.length; i += chunkSize) {
    chunks.push(data.slice(i, i + chunkSize));
  }

  // 3. Send chunks sequentially
  for (const chunk of chunks) {
    await sheetsData.handle({
      action: 'append',
      spreadsheetId: '...',
      range: 'Sheet1!A:Z',
      values: chunk,
    });
  }
}

// 4. Alternative: Use import_csv for large datasets
const csvData = convertToCSV(data);
await sheetsComposite.handle({
  action: 'import_csv',
  spreadsheetId: '...',
  csvData: csvData,
});
```

---

## Retry Strategies

### `none` - No Retry

**Use Case**: Client errors that require fixing the request

**Implementation:**

```javascript
// Fix the request and try again manually
if (error.code === 'INVALID_RANGE') {
  console.log('Fix range format and retry');
  return; // Don't auto-retry
}
```

---

### `manual` - Manual Intervention

**Use Case**: Authentication or permission issues

**Implementation:**

```javascript
if (error.retryStrategy === 'manual') {
  console.log('Manual action required:');
  error.resolutionSteps.forEach((step) => console.log(step));

  // Wait for user to resolve
  // No automatic retry
}
```

---

### `exponential_backoff` - Exponential Backoff

**Use Case**: Server errors, network issues, some quota errors

**Implementation:**

```javascript
async function retryWithExponentialBackoff(operation, maxAttempts = 5) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (!error.retryable || attempt === maxAttempts - 1) {
        throw error; // Give up
      }

      // Calculate backoff: 1s, 2s, 4s, 8s, 16s
      const backoffMs = Math.min(
        1000 * Math.pow(2, attempt) * (1 + Math.random() * 0.1), // Add jitter
        60000 // Cap at 60 seconds
      );

      console.log(`Attempt ${attempt + 1} failed. Retry in ${backoffMs}ms...`);
      await sleep(backoffMs);
    }
  }
}

// Usage:
const result = await retryWithExponentialBackoff(() =>
  sheetsData.handle({ action: 'write', ... })
);
```

---

### `wait_for_reset` - Wait for Quota Reset

**Use Case**: Rate limiting, quota exhaustion

**Implementation:**

```javascript
async function retryAfterQuotaReset(operation, error) {
  const retryAfterMs = error.details.retryAfterMs || 60000;
  const resetTime = new Date(Date.now() + retryAfterMs);

  console.log(`Quota exceeded. Waiting until ${resetTime.toISOString()}...`);

  await sleep(retryAfterMs);

  // Retry operation
  return await operation();
}

// Usage:
try {
  return await sheetsData.handle({ action: 'write', ... });
} catch (error) {
  if (error.code === 'RATE_LIMITED') {
    return await retryAfterQuotaReset(
      () => sheetsData.handle({ action: 'write', ... }),
      error
    );
  }
  throw error;
}
```

---

## Common Error Scenarios

### Scenario 1: Authentication Flow

```javascript
// Complete authentication recovery workflow

async function ensureAuthenticated() {
  // 1. Check status
  const statusResult = await sheetsAuth.handle({ action: 'status' });

  if (statusResult.response.authenticated) {
    console.log('Already authenticated');
    return true;
  }

  // 2. Start OAuth flow
  console.log('Starting authentication...');
  const loginResult = await sheetsAuth.handle({ action: 'login' });

  if (!loginResult.response.success) {
    console.log('Authentication failed:', loginResult.response.error.message);
    console.log('Resolution steps:');
    loginResult.response.error.resolutionSteps.forEach((step) => console.log(step));
    return false;
  }

  // 3. Verify authentication worked
  const verifyResult = await sheetsAuth.handle({ action: 'status' });
  return verifyResult.response.authenticated;
}
```

---

### Scenario 2: Permission Escalation

```javascript
// Request edit access when you only have view

async function requestEditAccess(spreadsheetId) {
  // 1. Check current access
  const shareList = await sheetsCollaborate.handle({
    action: 'share_list',
    spreadsheetId: spreadsheetId,
  });

  // 2. Find owner
  const owner = shareList.response.permissions.find((p) => p.role === 'owner');

  if (!owner) {
    console.log('Cannot find owner');
    return false;
  }

  // 3. Display request message
  console.log(`Request edit access from: ${owner.emailAddress}`);
  console.log('Or ask them to run:');
  console.log(
    `sheets_collaborate action="share_add" spreadsheetId="${spreadsheetId}" email="your-email@domain.com" role="writer"`
  );

  return false; // Manual action required
}
```

---

### Scenario 3: Batch Operation with Retry

```javascript
// Robust batch operation with error recovery

async function batchWriteWithRetry(spreadsheetId, batches) {
  const results = [];

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    let attempt = 0;
    let success = false;

    while (!success && attempt < 3) {
      try {
        const result = await sheetsData.handle({
          action: 'batch_write',
          spreadsheetId: spreadsheetId,
          data: batch,
        });

        results.push({ batch: i, success: true, result });
        success = true;
      } catch (error) {
        attempt++;

        if (error.code === 'RATE_LIMITED') {
          // Wait and retry
          const waitMs = error.details.retryAfterMs || 5000;
          console.log(`Batch ${i} rate limited. Waiting ${waitMs}ms...`);
          await sleep(waitMs);
        } else if (error.retryable && attempt < 3) {
          // Exponential backoff for retryable errors
          const backoffMs = 1000 * Math.pow(2, attempt);
          console.log(`Batch ${i} failed. Retry in ${backoffMs}ms...`);
          await sleep(backoffMs);
        } else {
          // Non-retryable error or max attempts reached
          console.log(`Batch ${i} failed permanently:`, error.message);
          results.push({ batch: i, success: false, error });
          break;
        }
      }
    }
  }

  return results;
}
```

---

## Error Prevention

### Best Practices

1. **Validate inputs before calling API**

   ```javascript
   // Check spreadsheet ID format
   if (!/^[a-zA-Z0-9-_]{44}$/.test(spreadsheetId)) {
     throw new Error('Invalid spreadsheet ID format');
   }

   // Validate range notation
   if (!/^'?[^']*'?![A-Z]+\d+:[A-Z]+\d+$/.test(range)) {
     console.warn('Range may be invalid:', range);
   }
   ```

2. **Use batch operations to reduce API calls**

   ```javascript
   // ❌ Multiple API calls
   for (const range of ranges) {
     await sheetsData.handle({ action: 'read', range });
   }

   // ✅ Single batch call
   const result = await sheetsData.handle({
     action: 'batch_read',
     ranges: ranges,
   });
   ```

3. **Implement caching for repeated reads**

   ```javascript
   const cache = new Map();

   async function cachedRead(spreadsheetId, range) {
     const key = `${spreadsheetId}:${range}`;

     if (cache.has(key)) {
       return cache.get(key);
     }

     const result = await sheetsData.handle({
       action: 'read',
       spreadsheetId,
       range,
     });

     cache.set(key, result);
     return result;
   }
   ```

4. **Check permissions before destructive operations**

   ```javascript
   async function safeWrite(spreadsheetId, range, values) {
     // 1. Check permissions first
     const shareList = await sheetsCollaborate.handle({
       action: 'share_list',
       spreadsheetId,
     });

     const myPermission = shareList.response.permissions.find(
       (p) => p.type === 'user' && p.emailAddress === myEmail
     );

     if (myPermission.role === 'reader') {
       throw new Error('Insufficient permissions: Need writer or owner access');
     }

     // 2. Now safe to write
     return await sheetsData.handle({
       action: 'write',
       spreadsheetId,
       range,
       values,
     });
   }
   ```

5. **Use transactions for atomic operations**

   ```javascript
   // Ensure all operations succeed or all fail
   const txResult = await sheetsTransaction.handle({
     action: 'begin',
     spreadsheetId: '...',
     operations: [
       { tool: 'sheets_data', action: 'write', range: 'A1', values: [[1]] },
       { tool: 'sheets_data', action: 'write', range: 'B1', values: [[2]] },
       { tool: 'sheets_data', action: 'write', range: 'C1', values: [['=A1+B1']] },
     ],
   });

   // If any operation fails, all are rolled back
   ```

---

## Additional Resources

- [API Consistency Reference](../reference/API_CONSISTENCY.md) - Error codes and response formats
- [Error Handling Guide](./ERROR_HANDLING.md) - General error handling patterns
- [Troubleshooting Guide](./TROUBLESHOOTING.md) - Common issues and solutions
- [Usage Guide](./USAGE_GUIDE.md) - Getting started with ServalSheets

---

**Last Updated**: 2026-01-30 (v1.6.0)
