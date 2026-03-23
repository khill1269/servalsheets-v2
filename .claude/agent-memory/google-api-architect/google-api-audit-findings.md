# Google API Usage Audit — Full Findings

**Date**: 2026-02-25
**Scope**: All 22 handlers, google-api.ts, retry.ts, cross-spreadsheet.ts, batching-system.ts, quota-manager.ts
**Branch**: remediation/phase-1

## FINDING [CRITICAL]: Most Handlers Lack executeWithRetry Wrapping

**Location**: 19 of 22 handler files (all except auth.ts, appsscript.ts, dependencies.ts)

**Evidence**: `grep -c 'import.*executeWithRetry' src/handlers/*.ts` returns matches only for:
- src/handlers/auth.ts
- src/handlers/appsscript.ts
- src/handlers/dependencies.ts

All other handlers (data.ts, format.ts, core.ts, collaborate.ts, visualize.ts, advanced.ts, dimensions.ts, etc.) make raw `this.sheetsApi.spreadsheets.*` calls without retry wrapping.

**Current Pattern** (data.ts:927, format.ts, core.ts, etc.):
```typescript
const response = await this.sheetsApi.spreadsheets.values.get({ ... });
```

**Recommended Pattern**:
```typescript
const response = await executeWithRetry(() =>
  this.sheetsApi.spreadsheets.values.get({ ... })
);
```

**Impact**: Transient 429 (rate limit) and 5xx errors propagate immediately as hard failures. Google recommends exponential backoff on these. The retry layer exists in retry.ts but is not used by the main handlers. This is the single highest-impact finding.

**Mitigating factor**: The CachedSheetsApi and RequestMerger services may provide some retry wrapping when used, but direct sheetsApi calls bypass this entirely.

## FINDING [CRITICAL]: crossWrite in cross-spreadsheet.ts Has No Retry on Write

**Location**: src/services/cross-spreadsheet.ts:282-287

**Current Pattern**:
```typescript
const res = await sheetsApi.spreadsheets.values.update({
  spreadsheetId: destination.spreadsheetId,
  range: destination.range,
  valueInputOption,
  requestBody: { values: data },
});
```

fetchRangeGrid (read) correctly uses executeWithRetry, but the write path does not.

**Impact**: A transient failure during cross-spreadsheet write loses the entire operation with no retry.

## FINDING [WARNING]: Cross-Spreadsheet Uses N Individual values.get() Instead of batchGet

**Location**: src/services/cross-spreadsheet.ts:69-87, 113-119

**Current Pattern**: Each source fetched individually via fetchRangeGrid() wrapped in Promise.all:
```typescript
const results = await Promise.all(sources.map(s => fetchSource(sheetsApi, s)));
```

When multiple sources target the same spreadsheetId (e.g., 3 ranges in the same spreadsheet), this makes 3 API calls instead of 1 batchGet.

**Recommended**: Group sources by spreadsheetId, use batchGet for same-spreadsheet ranges, then fan out with Promise.all for cross-spreadsheet.

**Impact**: Potential 2-5x API call reduction for same-spreadsheet multi-range reads. Each call counts against the 60/min/user quota.

## FINDING [WARNING]: Collaborate Handler Makes Unretried Drive API Calls

**Location**: src/handlers/collaborate.ts (all 35 actions)

**Evidence**: `grep -c 'executeWithRetry' src/handlers/collaborate.ts` = 0 matches. All Drive API calls (permissions.create, permissions.update, permissions.delete, revisions.list, etc.) are raw.

**Impact**: Drive API has its own rate limits (1000 queries/100s per user). Transient failures during sharing operations fail without retry.

## FINDING [WARNING]: data.ts Default Action Case Doesn't Use `never` Exhaustiveness

**Location**: src/handlers/data.ts:258-289

**Current Pattern**: Falls through to string comparison aliases, then returns error string.

**Contrast**: bigquery.ts:226-234 correctly uses `const _exhaustiveCheck: never = req` pattern.

**Impact**: New schema actions added to data.ts discriminated union won't be caught at compile time.

## FINDING [INFO]: Retry Config Aligns Well With Google's Recommendations

**Location**: src/utils/retry.ts:26-48, @serval/core retry

**Google recommends**: min((2^n + random_ms), max_backoff), retry on 429 and 5xx.

**ServalSheets implements**:
- maxRetries=3, baseDelay=100ms, maxDelay=32s, jitter=0.1 (from @serval/core defaults)
- 403 retried ONLY for userRateLimitExceeded (correct — not for permission errors)
- 401 retried for token expiry patterns (correct)
- HTTP/2 stream errors detected by message pattern (GOAWAY, ECONNRESET, etc.)
- Deadline-aware: skips retry if backoff exceeds request deadline

**Verdict**: Excellent implementation. Aligns with Google's backoff formula and correctly differentiates retryable vs non-retryable errors. The problem is that most handlers don't use it.

## FINDING [INFO]: Field Masks Consistently Applied

**Evidence**: 221 total `fields:` occurrences across 14 handler files.

- advanced.ts: 11 spreadsheets.get() calls, all with fields (namedRanges, protectedRanges, bandedRanges, tables, namedFunctions)
- core.ts: 15 spreadsheets.get() calls, all with fields (properties.title, sheets.properties, etc.)
- dimensions.ts: 4 spreadsheets.get() calls, all with fields
- visualize.ts: 12 spreadsheets.get() calls, all with fields (charts, pivotTable, properties)
- collaborate.ts: 31 fields usages on Drive API (permissions, revisions)
- data.ts: values.get() calls use `fields: 'range,values,majorDimension'`

**Verdict**: Excellent. No bare spreadsheets.get() calls found without field masks. This aligns with Google's best practice of requesting minimal fields.

## FINDING [INFO]: includeGridData Properly Scoped Post-P9

**Evidence**: All includeGridData:true calls now paired with ranges or narrow fields:
- advanced.ts:1597 — has ranges: rangeParam
- format.ts:726,945 — has fields limiting to rowData.values
- format.ts:2293 — has fields for dataValidation only
- visualize.ts:1572 — has fields for pivotTable only
- data.ts:3073 — explicit guard comment: "never pass includeGridData:true with ranges:[]"
- analyze.ts:817,1010 — has ranges + narrow fields

**Verdict**: Safe. Previous P9 fix addressed unbounded includeGridData issues.

## FINDING [INFO]: Batching System Well-Configured

**Location**: src/services/batching-system.ts:84-99

- Adaptive window: 20-200ms (scales with traffic)
- Max batch: 100 operations (within Google's limits)
- ConcurrencyCoordinator integration for global API limit enforcement
- Payload size estimation with calculateOptimalBatchSize()
- Metrics tracking: operations/apiCalls ratio

**Verdict**: Aligns with Google's recommendation. Batch request counting (1 API call per batch) correctly leveraged.

## FINDING [INFO]: Circuit Breaker Config Reasonable

**Location**: src/config/env.ts:118-120

- failureThreshold: 5 (default), 3 for BigQuery/AppsScript (lower quotas)
- successThreshold: 2
- timeout: 30s reset
- Per-API isolation (Sheets, Drive, BigQuery, Docs, Slides separate breakers)
- readOnlyMode fallback strategy for Sheets-specific breaker

**Verdict**: Reasonable. The 30s timeout aligns with Google's typical rate limit window recovery.

## FINDING [INFO]: Quota Manager is Tenant-Level, Not Google API-Level

**Location**: src/services/quota-manager.ts

This is a per-tenant application quota manager (read: 1000/hr, write: 100/hr), NOT a wrapper around Google's actual API quotas. It's Redis-backed for distributed deployments.

**Verdict**: Useful for multi-tenant SaaS, but not connected to actual Google API 429 responses. The two systems are independent.

## FINDING [INFO]: OAuth Scope Architecture is Excellent

**Location**: src/config/oauth-scopes.ts

- 3-tier: MINIMAL (spreadsheets + drive.file), STANDARD (+ drive.appdata + drive.readonly), FULL (+ bigquery + apps-script)
- STANDARD avoids restricted scopes, reducing Google verification burden
- Incremental consent via IncrementalScopeRequiredError with authorizationUrl
- Collaborate handler validates scopes before every operation (collaborate.ts:98-127)

**Verdict**: Best practice. Minimal OAuth scope request with incremental elevation.
