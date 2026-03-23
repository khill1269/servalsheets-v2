# GoogleApiClient API Reference

**File:** `src/services/google-api.ts`
**Function:** `createGoogleApiClient(options)`

## Quick Reference

```typescript
import { createGoogleApiClient } from '../services/google-api.js';

// Create client with OAuth token
const client = await createGoogleApiClient({
  accessToken: 'ya29.a0...',
  refreshToken: '1//0...', // Optional
});

// All API calls automatically get retry + circuit breaker
const response = await client.sheets.spreadsheets.get({
  spreadsheetId: 'abc123',
});

// Check auth status
console.log(client.hasElevatedAccess); // boolean
console.log(client.scopes); // string[]
```

## Properties

### `sheets: sheets_v4.Sheets`

**Type:** Google Sheets API v4 client
**Description:** Auto-instrumented with retry and circuit breaker

**Common Operations:**

```typescript
// Get spreadsheet metadata
await client.sheets.spreadsheets.get({ spreadsheetId });

// Read values
await client.sheets.spreadsheets.values.get({
  spreadsheetId,
  range: 'Sheet1!A1:B10'
});

// Write values
await client.sheets.spreadsheets.values.update({
  spreadsheetId,
  range: 'Sheet1!A1:B10',
  valueInputOption: 'USER_ENTERED',
  requestBody: { values: [[...]] }
});

// Batch update
await client.sheets.spreadsheets.batchUpdate({
  spreadsheetId,
  requestBody: { requests: [...] }
});
```

### `drive: drive_v3.Drive`

**Type:** Google Drive API v3 client
**Description:** Auto-instrumented with retry and circuit breaker

**Common Operations:**

```typescript
// Get file metadata
await client.drive.files.get({
  fileId: spreadsheetId,
  fields: 'id,name,permissions',
});

// Share file
await client.drive.permissions.create({
  fileId: spreadsheetId,
  requestBody: {
    type: 'user',
    role: 'writer',
    emailAddress: 'user@example.com',
  },
});

// Create folder
await client.drive.files.create({
  requestBody: {
    name: 'My Folder',
    mimeType: 'application/vnd.google-apps.folder',
  },
});
```

### `bigquery?: bigquery_v2.Bigquery`

**Type:** BigQuery API v2 client (optional)
**Description:** Only available if BigQuery scopes granted

**Common Operations:**

```typescript
if (!client.bigquery) {
  throw new Error('BigQuery access not granted');
}

// Query data
await client.bigquery.jobs.query({
  projectId: 'my-project',
  requestBody: {
    query: 'SELECT * FROM dataset.table LIMIT 10',
  },
});

// Export to Sheets
await client.bigquery.jobs.insert({
  projectId,
  requestBody: {
    configuration: {
      extract: {
        sourceTable: { projectId, datasetId, tableId },
        destinationUris: ['gs://bucket/file.csv'],
      },
    },
  },
});
```

### `hasElevatedAccess: boolean`

**Description:** Whether user granted full Google Workspace access

**Scopes:**

- `false` - Limited to specific spreadsheets only
- `true` - Full Workspace access (all spreadsheets, Drive, etc.)

**Usage:**

```typescript
if (!client.hasElevatedAccess) {
  throw new Error(
    'This operation requires elevated access. Re-authenticate with full permissions.'
  );
}
```

### `scopes: string[]`

**Description:** Array of granted OAuth scopes

**Common Scopes:**

- `https://www.googleapis.com/auth/spreadsheets` - Read/write spreadsheets
- `https://www.googleapis.com/auth/drive` - Full Drive access
- `https://www.googleapis.com/auth/bigquery` - BigQuery access
- `https://www.googleapis.com/auth/spreadsheets.readonly` - Read-only

**Usage:**

```typescript
const hasDriveAccess = client.scopes.includes('https://www.googleapis.com/auth/drive');

if (!hasDriveAccess) {
  logger.warn('Drive access not granted - some features unavailable');
}
```

## Auto-Instrumentation Features

### Automatic Retry

All API calls automatically retry on:

- `429` - Rate limit exceeded
- `500` - Internal server error
- `502` - Bad gateway
- `503` - Service unavailable
- `504` - Gateway timeout

**Configuration:**

- Max retries: 3
- Strategy: Exponential backoff with jitter
- Base delay: 1000ms
- Max delay: 10000ms

**Example:**

```typescript
// This will automatically retry up to 3 times on transient errors
const response = await client.sheets.spreadsheets.get({ spreadsheetId });
// No need to wrap in manual retry logic!
```

### Circuit Breaker

Each API client has a per-endpoint circuit breaker:

**States:**

- CLOSED - Normal operation
- OPEN - Failures exceeded threshold, requests blocked
- HALF_OPEN - Testing if service recovered

**Configuration:**

- Failure threshold: 5 consecutive failures
- Timeout: 30 seconds
- Success threshold: 2 successes to close

**Example:**

```typescript
try {
  await client.sheets.spreadsheets.get({ spreadsheetId });
} catch (error) {
  if (error.name === 'CircuitBreakerError') {
    console.log('Google Sheets API temporarily unavailable');
    console.log('Retry after:', error.nextAttemptTime);
  }
}
```

### HTTP/2 Connection Pooling

- Reuses connections for better performance
- Reduces TLS handshake overhead
- Automatic keep-alive

### Request Metrics

All API calls automatically emit metrics:

```typescript
// Metrics are automatically recorded:
// - google_api_request_duration_seconds
// - google_api_request_total
// - google_api_circuit_breaker_state
```

## Creating GoogleApiClient

### Option 1: With Access Token Only

```typescript
const client = await createGoogleApiClient({
  accessToken: 'ya29.a0...',
});

// Token will expire after 1 hour
// No automatic refresh
```

### Option 2: With Refresh Token

```typescript
const client = await createGoogleApiClient({
  accessToken: 'ya29.a0...',
  refreshToken: '1//0...',
});

// Automatically refreshes access token when it expires
```

### Option 3: Service Account (Server-to-Server)

```typescript
const client = await createGoogleApiClient({
  serviceAccountKey: JSON.parse(process.env.SERVICE_ACCOUNT_KEY),
});

// Uses service account credentials
// No user interaction required
```

## Error Handling

### Common Errors

**401 Unauthorized:**

```typescript
try {
  await client.sheets.spreadsheets.get({ spreadsheetId });
} catch (error) {
  if (error.code === 401) {
    throw new AuthenticationError('Token expired or invalid');
  }
}
```

**403 Forbidden:**

```typescript
try {
  await client.sheets.spreadsheets.get({ spreadsheetId });
} catch (error) {
  if (error.code === 403) {
    if (error.message.includes('PERMISSION_DENIED')) {
      throw new PermissionError('User does not have access to this spreadsheet');
    }
  }
}
```

**404 Not Found:**

```typescript
try {
  await client.sheets.spreadsheets.get({ spreadsheetId });
} catch (error) {
  if (error.code === 404) {
    throw new SpreadsheetNotFoundError(`Spreadsheet ${spreadsheetId} not found`);
  }
}
```

**429 Rate Limit:**

```typescript
// Automatically retried with exponential backoff
// Circuit breaker opens after 5 consecutive rate limits
try {
  await client.sheets.spreadsheets.get({ spreadsheetId });
} catch (error) {
  if (error.code === 429) {
    // Only thrown if all retries exhausted
    throw new RateLimitError('Rate limit exceeded, try again later');
  }
}
```

## Performance Tips

### Batch Operations

```typescript
// ✅ Good - Single batch request
await client.sheets.spreadsheets.batchUpdate({
  spreadsheetId,
  requestBody: {
    requests: [
      { updateCells: { ... } },
      { updateCells: { ... } },
      { updateCells: { ... } },
    ]
  }
});

// ❌ Bad - 3 separate requests
await client.sheets.spreadsheets.batchUpdate({ requests: [req1] });
await client.sheets.spreadsheets.batchUpdate({ requests: [req2] });
await client.sheets.spreadsheets.batchUpdate({ requests: [req3] });
```

### Field Masks

```typescript
// ✅ Good - Only fetch needed fields
await client.sheets.spreadsheets.get({
  spreadsheetId,
  fields: 'sheets(properties(sheetId,title))',
});

// ❌ Bad - Fetches everything (slower)
await client.sheets.spreadsheets.get({ spreadsheetId });
```

### Concurrent Requests

```typescript
// ✅ Good - Parallel execution
const [meta, values, drive] = await Promise.all([
  client.sheets.spreadsheets.get({ spreadsheetId }),
  client.sheets.spreadsheets.values.get({ spreadsheetId, range }),
  client.drive.files.get({ fileId: spreadsheetId }),
]);

// ❌ Bad - Sequential execution (3x slower)
const meta = await client.sheets.spreadsheets.get({ spreadsheetId });
const values = await client.sheets.spreadsheets.values.get({ spreadsheetId, range });
const drive = await client.drive.files.get({ fileId: spreadsheetId });
```

## Token Refresh

### Automatic Refresh (Recommended)

```typescript
const client = await createGoogleApiClient({
  accessToken,
  refreshToken, // Include refresh token
});

// Token automatically refreshes when needed
// No manual intervention required
```

### Manual Refresh

```typescript
import { refreshGoogleToken } from '../services/google-api.js';

const newTokens = await refreshGoogleToken(refreshToken);
console.log(newTokens.accessToken); // New access token
console.log(newTokens.expiresIn); // Expiry in seconds
```

## Related

- `src/utils/retry.ts` - Retry logic implementation
- `src/utils/circuit-breaker.ts` - Circuit breaker implementation
- `src/services/circuit-breaker-registry.ts` - Global circuit breaker tracking
- `src/observability/metrics.ts` - Metrics recording
- `src/config/oauth-scopes.ts` - OAuth scope definitions
