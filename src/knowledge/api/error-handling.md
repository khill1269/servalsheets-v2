# Error Handling Guide for ServalSheets MCP

> **API Version:** Google Sheets API v4
> **Last Updated:** February 13, 2026
> **Purpose:** Complete reference for understanding, diagnosing, and recovering from ServalSheets errors

---

## Table of Contents

1. [Google Sheets API HTTP Errors](#google-sheets-api-http-errors)
2. [ServalSheets Error Codes](#servalsheets-error-codes)
3. [Exponential Backoff Strategy](#exponential-backoff-strategy)
4. [Common Error Patterns](#common-error-patterns)
5. [Retry Safety Matrix](#retry-safety-matrix)
6. [Error Disambiguation](#error-disambiguation)
7. [Rate Limiting & Quota Management](#rate-limiting--quota-management)
8. [Error Detection & Prevention](#error-detection--prevention)

---

## Google Sheets API HTTP Errors

When the Google Sheets API returns an error, it uses standard HTTP status codes. Each error type has distinct recovery procedures.

### 400: Bad Request

**Meaning:** The API rejected the request because it was malformed or contained invalid parameters.

**Common Causes:**

- Invalid A1 notation (missing sheet name, wrong format)
- Spreadsheet ID with incorrect format (not 44 alphanumeric characters)
- Field values that don't match schema constraints
- Range references outside sheet boundaries
- Circular formula references

**Recovery Steps:**

1. Check the error message for the specific field that failed
2. Validate A1 notation format: `"SheetName!A1:D10"` (include sheet name with `!`)
3. Verify spreadsheet ID: 44-character alphanumeric string
4. Use `sheets_core` action="get" to inspect actual sheet structure
5. For range errors, use `sheets_core` action="list_sheets" to verify sheet names
6. Correct the parameter and retry

**Example Recovery:**

```
Error: "Invalid range: A1:B10"
Fix: Use "Sheet1!A1:B10" (include sheet name)
Tool: sheets_data action="read" spreadsheetId="..." range="Sheet1!A1:B10"
```

---

### 401: Unauthorized

**Meaning:** Authentication failed. The access token is missing, invalid, or expired.

**Common Causes:**

- No access token provided
- Token has expired
- Token was revoked by the user
- Token is malformed or corrupted
- Client credentials incorrect

**Recovery Steps:**

1. Check authentication status: `sheets_auth` action="status"
2. If not authenticated or token expired:
   - Run `sheets_auth` action="login" to start OAuth flow
   - Complete authorization in browser
   - Grant all requested permissions
3. If re-authentication fails:
   - Clear token cache manually
   - Retry login flow
4. Verify token is being sent correctly in Authorization header

**Automatic Handling:**
ServalSheets automatically refreshes expired tokens using refresh tokens. If automatic refresh fails, manual re-authentication is required.

---

### 403: Forbidden (Permission Denied)

**Meaning:** Authentication succeeded, but the user lacks permission to perform the requested operation.

**Common Causes:**

- User has read-only access but attempted write
- Sheet is protected and user not in exception list
- Spreadsheet is shared with view-only permissions
- OAuth scope insufficient (e.g., spreadsheets.readonly when edit required)
- API quota exceeded for the project/user

**Permission Levels:**
| Level | Can Read | Can Write | Can Share | Can Delete |
|-------|----------|-----------|-----------|-----------|
| View | ✓ | ✗ | ✗ | ✗ |
| Comment | ✓ | ✓ comments | ✗ | ✗ |
| Edit | ✓ | ✓ | ✗ | ✗ |
| Owner | ✓ | ✓ | ✓ | ✓ |

**Recovery Steps (in order):**

1. **Check permission level:**

   ```
   sheets_collaborate action="share_list" spreadsheetId="..."
   ```

   Look for your email and note permission level

2. **If insufficient permission:**
   - Contact spreadsheet owner to request edit access
   - Alternative: Use read-only operations if applicable

3. **If you're the owner:**
   - Use `sheets_collaborate` action="share_add" to grant yourself edit access
   - Verify with share_list action

4. **If protected range issue:**
   - Contact range protection owner
   - Or modify an unprotected range instead

5. **If scope insufficient:**
   - Run `sheets_auth` action="login" again
   - Grant broader OAuth scopes when prompted
   - Retry operation

---

### 404: Not Found

**Meaning:** The requested resource does not exist or has been deleted.

**Resource Types:**

- Spreadsheet ID is invalid or spreadsheet was deleted
- Sheet name/ID doesn't exist in spreadsheet
- Range refers to cells that don't exist
- Named range or filter view was deleted

**Recovery Steps:**

**For Spreadsheet:**

1. Verify spreadsheet ID format: 44 alphanumeric characters
2. URL format: `https://docs.google.com/spreadsheets/d/{ID}/`
3. Try accessing directly: `sheets_core` action="get" spreadsheetId="..."
4. If fails, spreadsheet doesn't exist or you lack access
5. List accessible spreadsheets: `sheets_core` action="list"
6. Check if spreadsheet was deleted or moved to trash

**For Sheet:**

1. List all sheets: `sheets_core` action="list_sheets" spreadsheetId="..."
2. Check sheet name (case-sensitive)
3. Verify sheet wasn't deleted or renamed
4. Try alternative spelling or exact match

**For Range:**

1. Verify sheet name exists: `sheets_core` action="list_sheets"`
2. Check A1 notation: "SheetName!A1:B10"
3. Verify range coordinates exist in sheet
4. Check sheet dimensions: `sheets_core` action="get_sheet"`

---

### 429: Rate Limited (Quota Exceeded)

**Meaning:** Too many requests have been made in a short time. The API is temporarily rejecting requests to prevent overload.

**Quota Limits:**

- **Per User Per Minute:** 60 requests/minute
- **Per Project Per Minute:** 300 requests/minute
- **Daily:** No daily limit (only per-minute limits apply)

**What Counts as a Request:**

- Each `values.get` or `values.update` = 1 request
- Each `batchGet` or `batchUpdate` = 1 request regardless of batch size
- Metadata operations (spreadsheets.get, list_sheets) = 1 request each

**Recovery Steps:**

1. **Immediate action:**
   - STOP making new requests immediately
   - Wait minimum 60 seconds before retrying

2. **Use Exponential Backoff:**

   ```
   Wait = min(2^attempt + random(0, 1000)ms, 64000ms)

   Attempt 0: ~1-2 seconds
   Attempt 1: ~2-3 seconds
   Attempt 2: ~4-5 seconds
   Attempt 3: ~8-9 seconds
   Attempt 4: ~16-17 seconds
   Max: 64 seconds
   ```

3. **Reduce Future Request Rate:**
   - **Batch operations:** Combine multiple reads/writes into one request
     - 3 separate `values.get` = 3 quota
     - 1 `batchGet` with 3 ranges = 1 quota
     - Savings: 60-90%

   - **Use transactions:** `sheets_transaction` batches 50+ operations into 1-2 API calls

   - **Cache aggressively:** Store metadata, sheet IDs, column structures
     - Cache invalidation: Update on write operations
     - Savings: 30-70%

   - **Deduplication:** Combine identical requests within 5-second window
     - Savings: 10-30%

4. **Monitor quota usage:**
   - Check `sheets_auth` action="status" for quota details
   - Track API calls in logs

---

### 500: Internal Server Error

**Meaning:** Google's servers encountered an unexpected error while processing the request.

**Characteristics:**

- Transient (usually resolves on retry)
- Not caused by user input
- Affects multiple users if Google system-wide issue

**Recovery Steps:**

1. Wait 1-5 seconds (short delay)
2. Retry operation using exponential backoff
3. If persists (retry 5+ times), wait longer (30-60 seconds)
4. Check Google Workspace Status Dashboard: https://www.google.com/appsstatus/
5. If Google reports outage, wait for resolution

---

### 503: Service Unavailable

**Meaning:** Google Sheets API is temporarily unavailable due to maintenance or overload.

**Characteristics:**

- Usually brief (minutes to hours)
- Often scheduled maintenance (check status page)
- All requests fail until service recovers

**Recovery Steps:**

1. Check Google Workspace Status Dashboard
2. If maintenance scheduled, wait for completion time
3. If unscheduled outage:
   - Implement exponential backoff
   - Retry up to 5-10 times
   - Maximum wait: 5-10 minutes
4. Implement circuit breaker pattern to avoid hammering service

---

## ServalSheets Error Codes

ServalSheets wraps Google API errors in higher-level error codes that are more actionable for Claude.

### SHEET_NOT_FOUND

**Meaning:** The specified sheet (by name or ID) doesn't exist in the spreadsheet.

**Recovery Tool Chain:**

```
1. sheets_core action="list_sheets" spreadsheetId="..."
   → See all available sheets

2. If sheet was deleted, recovery is not possible
   → Create new sheet with: sheets_core action="add_sheet"
```

**Prevention:**

- Always verify sheet name is case-sensitive
- Use sheet IDs (numeric gid) for more reliable references
- Avoid relying on sheet names that may be renamed

---

### RANGE_NOT_FOUND

**Meaning:** The specified range doesn't exist or refers to cells outside sheet boundaries.

**Common Causes:**

- Sheet name missing in range: `"A1:B10"` instead of `"Sheet1!A1:B10"`
- Sheet name has special characters and isn't quoted: `"Q4 Report!A1"` instead of `"'Q4 Report'!A1"`
- Range exceeds sheet dimensions
- Typo in sheet name (case-sensitive)

**Recovery Tool Chain:**

```
1. sheets_core action="get_sheet" spreadsheetId="..." sheetName="..."
   → Check actual sheet dimensions

2. sheets_core action="list_sheets" spreadsheetId="..."
   → Verify sheet name spelling

3. Correct range format and retry
   Format: "SheetName!A1:D10" or "'Sheet Name With Spaces'!A1:D10"
```

**Valid Range Formats:**
| Format | Example | Usage |
|--------|---------|-------|
| Single cell | `"Sheet1!A1"` | Read/write one cell |
| Range | `"Sheet1!A1:D10"` | Read/write rectangular area |
| Column | `"Sheet1!A:A"` | All cells in column A |
| Row | `"Sheet1!1:1"` | All cells in row 1 |
| With spaces | `"'Q4 Report'!A1:B10"` | Sheet name with spaces (needs quotes) |

---

### PERMISSION_DENIED

**Meaning:** User lacks required permissions for this operation. Could be auth or access issue.

**Diagnosis Steps:**

```
1. Check auth status:
   sheets_auth action="status"
   → Token valid? Scopes sufficient?

2. Check access level:
   sheets_collaborate action="share_list"
   → Find user in share list, note permission level

3. Identify permission type:
```

| Error                          | Likely Cause                                 | Fix                                  |
| ------------------------------ | -------------------------------------------- | ------------------------------------ |
| Can't write to read-only sheet | View-only access                             | Request edit access                  |
| Can't modify protected range   | Range protection                             | Contact owner or use different range |
| Can't share spreadsheet        | Not owner                                    | Request owner to share               |
| Can't access spreadsheet       | Not shared                                   | Request access from owner            |
| OAuth scope insufficient       | scopes.readonly granted instead of full edit | Re-authenticate with full scopes     |

---

### QUOTA_EXCEEDED

**Meaning:** API quota has been exhausted. Different from RATE_LIMITED—quota is harder limit.

**Recovery Steps:**

1. Wait 60+ seconds
2. Reduce request volume:
   - Use batch operations (60-90% savings)
   - Use transactions (80-95% savings)
   - Cache aggressively
3. Check quota budgeting strategy in `src/knowledge/api/limits/quotas.json`

---

### INVALID_RANGE

**Meaning:** Range notation is malformed or uses unsupported syntax.

**Common Mistakes:**
| Wrong | Correct | Issue |
|-------|---------|-------|
| `"A1:B10"` | `"Sheet1!A1:B10"` | Missing sheet name |
| `"Sheet1 A1:B10"` | `"Sheet1!A1:B10"` | Wrong separator (space instead of !) |
| `"A1-B10"` | `"Sheet1!A1:B10"` | Wrong range separator (- instead of :) |
| `"Sheet 1!A1"` | `"'Sheet 1'!A1"` | Sheet name with space needs quotes |
| `"Sheet1!A"` | `"Sheet1!A:A"` | Column reference needs colon |

**Recovery:**

1. Check range format in error message
2. Use `sheets_data` action="read" with corrected range
3. Alternative: Use semantic ranges if available

---

### TRANSACTION_TIMEOUT

**Meaning:** A transaction took too long to complete and was cancelled.

**Causes:**

- Too many operations in transaction (>50 recommended)
- Operations are too complex (heavy formulas)
- Network latency

**Recovery:**

```
1. Split transaction into smaller batches
   sheets_transaction action="begin"
   → Queue 20-30 operations (max)
   → sheets_transaction action="commit"

2. Reduce operation complexity
   → Avoid complex formulas in batch operations
   → Use simpler operations

3. Check network latency
   → If consistently slow, consider async operations
```

**Best Practice:**

- Limit batch size: 20-50 operations per transaction
- Avoid complex formulas in batch mode
- Use individual operations for formula-heavy work

---

### VALIDATION_ERROR

**Meaning:** Input parameters failed schema validation.

**Common Causes:**

- Missing required parameter
- Wrong parameter type (string instead of number)
- Invalid enum value for parameter
- Parameter value out of range

**Recovery:**

1. Check error message for field that failed
2. Verify parameter type matches schema:
   - `spreadsheetId`: string (44 chars)
   - `range`: string (A1 notation)
   - `sheetId`: number (integer)
3. Check allowed values for enum parameters
4. Consult tool schema documentation

---

### CIRCULAR_REFERENCE

**Meaning:** A formula creates a circular dependency (formula references itself, directly or indirectly).

**Example:**

```
Cell A1 = B1 + 1
Cell B1 = A1 + 2  ← Circular! A1 depends on B1, B1 depends on A1
```

**Recovery:**

1. Identify cells involved in cycle
2. Restructure formulas to break dependency
3. Use helper columns if needed
4. Consider data validation or input constraints

---

### DUPLICATE_SHEET_NAME

**Meaning:** A sheet with the specified name already exists.

**Recovery:**

```
1. List existing sheets:
   sheets_core action="list_sheets"

2. Choose different name or:
   - Use sheets_core action="delete_sheet" to remove old sheet
   - Rename existing sheet: sheets_core action="update_sheet"
```

---

### PROTECTED_RANGE

**Meaning:** User attempted to modify a protected range.

**Recovery:**

1. Identify protection: Check sheet protection settings
2. Options:
   - Request edit permission from protection owner
   - Modify a different, unprotected range
   - Remove protection if you're the owner/editor

---

### INSUFFICIENT_SCOPES

**Meaning:** OAuth token lacks required permissions for this operation.

**Required Scopes by Operation:**
| Operation | Required Scope | Current Issue |
|-----------|---|---|
| Read data | spreadsheets.readonly | Low risk |
| Write data | spreadsheets | Medium risk |
| Share/permissions | drive | High risk |
| Apps Script | script.projects | High risk |
| BigQuery | bigquery | High risk |

**Recovery:**

```
1. Check current scopes:
   sheets_auth action="status"
   → See "grantedScopes" list

2. Re-authenticate with broader scopes:
   sheets_auth action="login"
   → Select all permissions when prompted
   → Ensure Google Sheets and Drive scopes granted

3. Retry operation
```

---

## Exponential Backoff Strategy

When a request fails with a retryable error, implement exponential backoff with jitter to avoid thundering herd.

### Algorithm

```typescript
function exponentialBackoff(attempt: number): number {
  const baseDelay = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s, 8s, ...
  const jitter = Math.random() * 1000; // Random 0-1000ms
  const totalDelay = Math.min(baseDelay + jitter, 64000); // Cap at 64 seconds
  return totalDelay;
}
```

### Backoff Sequence

| Attempt | Formula              | Range            | Typical |
| ------- | -------------------- | ---------------- | ------- |
| 0       | 2^0 \* 1000 + random | 1,000-2,000 ms   | 1.5s    |
| 1       | 2^1 \* 1000 + random | 2,000-3,000 ms   | 2.5s    |
| 2       | 2^2 \* 1000 + random | 4,000-5,000 ms   | 4.5s    |
| 3       | 2^3 \* 1000 + random | 8,000-9,000 ms   | 8.5s    |
| 4       | 2^4 \* 1000 + random | 16,000-17,000 ms | 16.5s   |
| 5       | 2^5 \* 1000 + random | 32,000-33,000 ms | 32.5s   |
| 6+      | capped at 64,000 ms  | 64,000 ms        | 64s     |

### Retry Count Recommendations

| Error Code                | Max Retries                  | Max Wait     |
| ------------------------- | ---------------------------- | ------------ |
| 429 (Rate Limit)          | 10                           | 10 minutes   |
| 500 (Server Error)        | 5                            | 1-2 minutes  |
| 503 (Service Unavailable) | 5-10                         | 5-10 minutes |
| 502/504 (Gateway)         | 5                            | 5 minutes    |
| 401 (Auth)                | 0 (needs re-auth)            | N/A          |
| 403 (Permission)          | 0 (needs different approach) | N/A          |
| 400 (Bad Request)         | 0 (needs fix)                | N/A          |
| 404 (Not Found)           | 0 (needs fix)                | N/A          |

---

## Common Error Patterns

### Pattern 1: "Unable to parse range"

**Symptoms:**

- Error mentions "range" or "A1 notation"
- Range in error looks incomplete

**Root Causes:**

1. Missing sheet name prefix: `"A1:B10"` instead of `"Sheet1!A1:B10"`
2. Sheet name with spaces not quoted: `"Sheet 1!A1"` instead of `"'Sheet 1'!A1"`
3. Wrong separator: `"Sheet1 A1:B10"` (space) instead of `"Sheet1!A1:B10"` (exclamation)

**Fix:**

```
1. Ensure format: "SheetName!A1:D10"
2. For spaces: "'Sheet Name'!A1:D10"
3. List sheets to verify name: sheets_core action="list_sheets"
4. Retry with corrected range
```

### Pattern 2: "The caller does not have permission"

**Symptoms:**

- 403 Forbidden error
- Can read but can't write
- Operations that worked before now fail

**Root Causes:**

1. Sheet permissions changed (downgraded from edit to view)
2. OAuth token scopes insufficient
3. Spreadsheet owner changed permissions
4. Protected range prevents modification

**Diagnosis:**

```
1. Check permission level:
   sheets_collaborate action="share_list"
   → Find your email, note permission

2. Check token:
   sheets_auth action="status"
   → Verify scopes include "spreadsheets" (not just "spreadsheets.readonly")

3. Identify cause:
   - Permission level is "view" → Request edit access
   - Scopes don't include "spreadsheets" → Re-authenticate
   - Range is protected → Request access or modify different range
```

### Pattern 3: "Requested entity was not found"

**Symptoms:**

- 404 error with generic message
- Operation worked before, now fails
- Spreadsheet ID looks correct

**Root Causes:**

1. Spreadsheet was deleted
2. Spreadsheet moved to trash
3. Sharing was revoked
4. Spreadsheet ID is wrong (typo)
5. User accidentally used sheet ID instead of spreadsheet ID

**Fix:**

```
1. Verify ID format: 44 alphanumeric characters
2. List accessible spreadsheets: sheets_core action="list"
3. Check if in trash: https://drive.google.com/drive/trash
4. Double-check URL: docs.google.com/spreadsheets/d/{ID}
5. If definitely missing, recreate spreadsheet
```

### Pattern 4: "Quota exceeded" / "Rate limited"

**Symptoms:**

- 429 error or 403 with quotaExceeded reason
- First few requests work, then fails
- Fails consistently if retried immediately

**Root Causes:**

1. Making sequential requests in loop (missing batch)
2. Polling without delay
3. Too many concurrent requests
4. Cache misses causing redundant reads

**Fix:**

```
1. Immediate: Wait 60+ seconds, then retry with backoff
2. Long-term: Use batch operations
   - sheets_data action="batch_read" (instead of 3x action="read")
   - sheets_transaction for multiple writes
   - Reduce request count by 60-90%
```

### Pattern 5: "Invalid value at 'range'"

**Symptoms:**

- 400 error
- Range parameter fails validation
- Error mentions specific position/format

**Root Causes:**

1. Range string is null/undefined
2. Range has invalid characters
3. Range doesn't follow A1 notation
4. Sheet name has special characters without quotes

**Fix:**

```
1. Verify range is not null/empty
2. Check for invalid characters (!, @, #, etc. unescaped)
3. Use valid A1 notation: "Sheet1!A1:B10"
4. Quote sheet names with special chars: "'Q4 Results'!A1:B10"
```

---

## Retry Safety Matrix

Not all operations are safe to retry automatically. Understand the idempotency of operations.

### Safe to Retry (Idempotent Operations)

These operations always produce the same result regardless of how many times they're executed:

| Operation       | Tool           | Action       | Why Safe                     |
| --------------- | -------------- | ------------ | ---------------------------- |
| Read            | sheets_data    | read         | Reading doesn't change state |
| Batch Read      | sheets_data    | batch_read   | No side effects              |
| Get Sheet Info  | sheets_core    | get          | Metadata query, no changes   |
| List Sheets     | sheets_core    | list_sheets  | No changes                   |
| Get Spreadsheet | sheets_core    | get          | Metadata query               |
| Analyze Data    | sheets_analyze | analyze_data | Non-mutating analysis        |

**Retry Approach:** Automatic exponential backoff is safe. Retry indefinitely if needed.

---

### Unsafe to Retry (Non-Idempotent Operations)

These operations change state. Retrying without validation may cause duplicates or unintended changes:

| Operation   | Tool               | Action      | Risk                               |
| ----------- | ------------------ | ----------- | ---------------------------------- |
| Append      | sheets_data        | append      | Row duplicates if retried          |
| Insert      | sheets_dimensions  | insert      | Inserts twice if retried           |
| Delete      | sheets_dimensions  | delete      | Deletes unintended rows if retried |
| Add Comment | sheets_collaborate | comment_add | Duplicate comments                 |
| Add Sheet   | sheets_core        | add_sheet   | Duplicate sheets if retried        |
| Paste Data  | sheets_data        | copy_paste  | Duplicate content                  |

**Retry Approach:**

1. Check for idempotency key (not supported by Google API)
2. Verify operation succeeded before retrying
3. Only retry if network error (not business logic error)
4. Better: Use transactions for atomic multi-operation updates

---

### Conditional Idempotency (May Retry if Data Unchanged)

These operations can be safely retried IF the data hasn't changed:

| Operation          | Tool        | Action       | Condition                  |
| ------------------ | ----------- | ------------ | -------------------------- |
| Write              | sheets_data | write        | Same data value            |
| Batch Write        | sheets_data | batch_write  | Same data values           |
| Update Sheet Props | sheets_core | update_sheet | Same property values       |
| Find Replace       | sheets_data | find_replace | Same search/replace values |

**Retry Approach:**

1. Compare request data before retry
2. If identical, safe to retry
3. If data changed (user provided different values), don't retry
4. Recommended: Use transaction for safety

---

## Error Disambiguation

When PERMISSION_DENIED occurs, the root cause could be authentication, scope, or access. Follow this decision tree to identify the exact issue.

### Disambiguation Decision Tree

```
Got PERMISSION_DENIED error?
│
├─→ Step 1: Check authentication
│   Command: sheets_auth action="status"
│   ├─ Token missing/invalid?
│   │  └─→ Fix: sheets_auth action="login" (re-authenticate)
│   │
│   └─ Token valid? Continue to Step 2
│
├─→ Step 2: Check OAuth scopes
│   From status output, check "grantedScopes"
│   ├─ Missing "spreadsheets" scope (only has "readonly")?
│   │  └─→ Fix: sheets_auth action="login" (re-authenticate with full scopes)
│   │
│   └─ Has "spreadsheets" scope? Continue to Step 3
│
└─→ Step 3: Check spreadsheet access
    Command: sheets_collaborate action="share_list"
    ├─ Not in share list?
    │  └─→ Fix: Request access from spreadsheet owner
    │
    ├─ In share list with "view" permission?
    │  └─→ Fix: Request "edit" access from owner
    │
    ├─ In share list with "edit" permission?
    │  └─→ Likely: Sheet/range is protected
    │      Command: Check sheet protection settings
    │      Fix: Request access from protection owner or use different range
    │
    └─ In share list with "owner"?
       └─→ Possible: OAuth scope issue (recheck Step 2)
           Or: Specific range protection (unlikely if you're owner)
```

### Quick Disambiguation Table

| "permission denied" → | Check              | Tool       | Action               | Fix            |
| --------------------- | ------------------ | ---------- | -------------------- | -------------- |
| No token              | sheets_auth        | status     | Token missing        | login          |
| Expired token         | sheets_auth        | status     | Token expired        | login          |
| Wrong scope           | sheets_auth        | status     | Scopes insufficient  | login          |
| Not shared            | sheets_collaborate | share_list | Email not in list    | Request access |
| View only             | sheets_collaborate | share_list | Permission is "view" | Request edit   |
| Protected range       | (manual)           | (manual)   | Range locked         | Contact owner  |

---

## Rate Limiting & Quota Management

### Understanding Google's Quota System

Google Sheets API has **per-minute limits**, not daily:

**Standard Limits:**

- User: 60 requests/minute
- Project: 300 requests/minute

**What Counts?**

- Each API method = 1 request
- Batch methods = 1 request (regardless of batch size)
- Metadata queries = 1 request each

### Key Insight: Batch Operations

Batch methods cost the SAME as single operations but process multiple items:

| Approach                 | Requests      | Cost          | Speed         |
| ------------------------ | ------------- | ------------- | ------------- |
| 3x `values.get`          | 3             | 3 units       | ~3 seconds    |
| 1x `batchGet` (3 ranges) | 1             | 1 unit        | ~1 second     |
| **Savings**              | **67% fewer** | **67% quota** | **3x faster** |

### Quota Optimization Strategies

#### Strategy 1: Batch Operations (60-90% savings)

```
❌ Bad: Make 3 separate reads
for range in ["A1:B10", "C1:D10", "E1:F10"]:
  data = sheets_data.read(range)

✅ Good: Batch into one request
data = sheets_data.batch_read(ranges=["A1:B10", "C1:D10", "E1:F10"])
```

**When to Use:**

- Multiple reads of different ranges
- Multiple writes to different ranges
- Bulk data operations

**Savings:** 50-90% quota reduction

#### Strategy 2: Transactions (80-95% savings)

```
❌ Bad: 50 sequential operations
for row in data:
  sheets_data.write(range, value)  # 50 API calls

✅ Good: Batch all operations in transaction
sheets_transaction.begin()
for row in data:
  sheets_transaction.queue(write_operation)
sheets_transaction.commit()
# Result: 1-2 API calls instead of 50
```

**When to Use:**

- Atomic multi-step updates
- Bulk data loading
- Complex workflows

**Savings:** 80-95% quota reduction

#### Strategy 3: Caching (30-70% savings)

```
❌ Bad: Read sheet metadata every time
for i in range(100):
  sheets = sheets_core.list_sheets()  # 100 requests

✅ Good: Cache sheet info
sheets = sheets_core.list_sheets()  # 1 request
for i in range(100):
  use_cached(sheets)
```

**Cache Candidates:**

- Sheet names and IDs
- Column headers
- Named ranges
- Formula definitions
- Protected ranges

**Cache Invalidation:**

- Clear on write operations
- Refresh before critical operations
- Set reasonable TTL (5-15 minutes)

**Savings:** 30-70% quota reduction

#### Strategy 4: Deduplication (10-30% savings)

**Within 5-Second Window:**

- Detect duplicate requests
- Return cached result
- Single API call for identical requests

**Savings:** 10-30% quota reduction

### Quota Budgeting Example

```
Budget: 60 requests/minute per user

Option A (No Optimization):
- 10 row writes = 10 requests
- Metadata lookups = 5 requests
- Reads = 15 requests
- Total: 30 requests (50% of quota)

Option B (With Batching):
- 10 row writes = 1 request (batch_write)
- Metadata cached = 0 requests (reuse)
- 15 reads = 1 request (batch_read)
- Total: 2 requests (3% of quota!)

Savings: 94% quota reduction!
Remaining budget: 58 requests for contingency/other ops
```

---

## Error Detection & Prevention

### Proactive Error Prevention

#### Before Operations:

1. **Validate Spreadsheet Access**

   ```
   sheets_core action="get" spreadsheetId="..."
   → Fails if spreadsheet not found or not accessible
   → Run once at session start
   ```

2. **Verify Sheet Exists**

   ```
   sheets_core action="list_sheets" spreadsheetId="..."
   → Before using sheet name
   → Cache result for session
   ```

3. **Check Rate Limit Status**
   ```
   sheets_auth action="status"
   → See current quota usage if available
   → Adjust batch size accordingly
   ```

#### For Batch Operations:

1. **Validate Batch Size**
   - Max 500 requests per batch
   - Recommended: < 100 requests
   - Monitor response time

2. **Use Dry-Run for Destructive Ops**

   ```
   operation with safety={"dryRun": true}
   → Preview changes without applying
   → Verify operation is correct
   ```

3. **Check Responses Completely**
   ```
   Look for partial failures in batch response
   Some items may succeed while others fail
   ```

### Error Recovery Flowchart

```
Operation failed?
│
├─ Retryable error? (429, 500, 503)
│  └─ Exponential backoff + retry
│
├─ Auth error? (401, insufficient scopes)
│  └─ sheets_auth action="login" (re-authenticate)
│
├─ Permission error? (403 permission denied)
│  └─ Disambiguation flow (see above)
│
├─ Not found? (404)
│  └─ Verify resource exists
│     └─ If gone: Recreate or use different resource
│
└─ Validation error? (400)
   └─ Fix parameter and retry
      Verify: Format, type, enum value, constraints
```

---

## Quick Reference: Troubleshooting by Error Message

| Error Message          | HTTP Code | Likely Cause       | First Fix                                                  |
| ---------------------- | --------- | ------------------ | ---------------------------------------------------------- |
| "Invalid range"        | 400       | A1 notation format | Add sheet name: `"Sheet1!A1:B10"`                          |
| "Unauthorized"         | 401       | No/expired token   | `sheets_auth action="login"`                               |
| "Forbidden"            | 403       | No permission      | `sheets_collaborate action="share_list"`                   |
| "Not found"            | 404       | Resource deleted   | Verify resource exists, recreate if needed                 |
| "Quota exceeded"       | 429       | Too many requests  | Wait 60s, then use batch operations                        |
| "Server error"         | 500       | Google error       | Retry with backoff                                         |
| "Service unavailable"  | 503       | Google maintenance | Check status dashboard, wait                               |
| "Circular reference"   | 400       | Formula loop       | Remove formula dependency cycle                            |
| "Protected range"      | 403       | Range locked       | Request owner access or use different range                |
| "Duplicate sheet name" | 400       | Name conflict      | Use `sheets_core action="list_sheets"`, choose unique name |

---

## Resources

- **Google Sheets API Status:** https://www.google.com/appsstatus/
- **Google Sheets API Documentation:** https://developers.google.com/sheets/api
- **Quota Documentation:** `src/knowledge/api/limits/quotas.json`
- **Batch Operations Guide:** `src/knowledge/api/batch-operations.md`
