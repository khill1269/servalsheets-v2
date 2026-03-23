---
title: Schema Versioning Guide
category: guide
last_updated: 2026-03-10
description: ServalSheets supports multiple schema versions simultaneously to allow gradual client migration without breaking changes.
version: 1.6.0
audience: user
difficulty: intermediate
---

# Schema Versioning Guide

ServalSheets supports multiple schema versions simultaneously to allow gradual client migration without breaking changes.

**Version:** 1.0  
**Last Updated:** 2026-02-17  
**Status:** Active

---

## Table of Contents

1. [Overview](#overview)
2. [Version Negotiation](#version-negotiation)
3. [Migration Strategy](#migration-strategy)
4. [Client Usage](#client-usage)
5. [Adding a New Version](#adding-a-new-version)
6. [Deprecation Process](#deprecation-process)
7. [Testing](#testing)

---

## Overview

### Why Schema Versioning?

- **Backward Compatibility:** Old clients continue working during upgrades
- **Gradual Migration:** Users migrate at their own pace
- **Clear Breaking Changes:** Version bumps signal incompatible changes
- **Long-term Support:** Multiple versions supported simultaneously

### Current Versions

| Version | Status     | Released   | Sunset Date | Notes                      |
| ------- | ---------- | ---------- | ----------- | -------------------------- |
| v1      | ✅ Stable  | 2026-01-01 | TBD         | Current production version |
| v2      | 🚧 Preview | 2026-02-17 | N/A         | Next generation schema     |

### Architecture

```
Client Request
     │
     ├─ Accept: application/vnd.servalsheets.v2+json
     │
     ▼
Schema Version Middleware
     │
     ├─ Extract version (v2)
     ├─ Validate support
     ├─ Add deprecation headers if needed
     │
     ▼
Schema Migration
     │
     ├─ Convert request to internal format
     ├─ Process with handler
     ├─ Convert response to requested version
     │
     ▼
Client Response
     │
     └─ X-Schema-Version: v2
```

---

## Version Negotiation

### Content Negotiation (Recommended)

Use the `Accept` header for version negotiation:

```http
POST /mcp HTTP/1.1
Host: api.servalsheets.com
Accept: application/vnd.servalsheets.v2+json
Content-Type: application/json
```

**Benefits:**

- Standard HTTP content negotiation
- Works with HTTP proxies and caches
- Clear intent in request headers

### Alternative Methods

#### 1. Custom Header

```http
X-Schema-Version: v2
```

#### 2. Query Parameter

```http
POST /mcp?schema_version=v2
```

**Note:** Query parameters are less preferred for POST requests.

### Negotiation Priority

1. `Accept` header (highest priority)
2. `X-Schema-Version` header
3. `schema_version` query parameter
4. Default to `v1` (stable version)

### Response Headers

Server always responds with version info:

```http
HTTP/1.1 200 OK
X-Schema-Version: v2
Content-Type: application/vnd.servalsheets.v2+json
```

If version is deprecated:

```http
HTTP/1.1 200 OK
X-Schema-Version: v1
Deprecation: true
Sunset: Sat, 17 Aug 2026 00:00:00 GMT
Link: </docs/schema-versioning>; rel="deprecation"; type="text/html"
```

---

## Migration Strategy

### 6-Month Deprecation Policy

1. **Month 0:** New version (v2) released as preview
2. **Month 1:** v2 declared stable, v1 marked deprecated
3. **Month 3:** Warning logs for v1 usage
4. **Month 6:** v1 sunset date announced
5. **Month 12:** v1 removed from server

### Backward Compatibility

**Supported:**

- Old clients can use deprecated versions
- Automatic request/response migration
- Deprecation warnings in responses

**Not Supported:**

- Breaking changes within same version
- Downgrade migrations after sunset
- Indefinite support for old versions

---

## Client Usage

### Node.js (TypeScript)

```typescript
import { McpClient } from '@modelcontextprotocol/sdk/client/index.js';

const client = new McpClient({
  transport: 'http',
  url: 'https://api.servalsheets.com/mcp',
  headers: {
    Accept: 'application/vnd.servalsheets.v2+json',
  },
});

// Use v2 schemas
const result = await client.callTool('sheets_data', {
  operation: 'read', // v2 uses 'operation' instead of 'action'
  spreadsheetId: '...',
});
```

### Python

```python
import requests

response = requests.post(
    'https://api.servalsheets.com/mcp',
    headers={
        'Accept': 'application/vnd.servalsheets.v2+json',
        'Content-Type': 'application/json',
    },
    json={
        'operation': 'read',
        'spreadsheetId': '...',
    }
)

# Check version in response
version = response.headers.get('X-Schema-Version')
print(f'Using schema version: {version}')
```

### cURL

```bash
curl -X POST https://api.servalsheets.com/mcp \
  -H "Accept: application/vnd.servalsheets.v2+json" \
  -H "Content-Type: application/json" \
  -d '{"operation":"read","spreadsheetId":"..."}'
```

---

## Adding a New Version

### Step 1: Create Version Directory

```bash
mkdir -p src/schemas/v3
```

### Step 2: Define Version Metadata

```typescript
// src/schemas/v3/index.ts
export const V3_METADATA = {
  version: 'v3',
  released: '2027-01-01',
  deprecated: false,
  stable: false,
  description: 'Schema version 3 with enhanced validation',
  breakingChanges: [
    'Required clientVersion field in all requests',
    'Stricter spreadsheetId format validation',
  ],
};
```

### Step 3: Implement Schemas

```typescript
// src/schemas/v3/data.ts
import { z } from 'zod';

export const SheetsDataInputSchemaV3 = z.object({
  operation: z.string(), // Renamed from 'action'
  spreadsheetId: z.string().regex(/^[a-zA-Z0-9_-]{44}$/), // Stricter
  clientVersion: z.string(), // NEW: Required
  // ... rest of schema
});
```

### Step 4: Add Migration Functions

```typescript
// src/utils/schema-migration.ts

function migrateV2ToV3(data: any): any {
  return {
    ...data,
    clientVersion: '1.0.0', // Add default for v2 clients
  };
}

function migrateV3ToV2(data: any): any {
  const { clientVersion, ...rest } = data;
  return rest; // Remove v3-only field
}

registerMigration('v2', 'v3', migrateV2ToV3);
registerMigration('v3', 'v2', migrateV3ToV2);
```

### Step 5: Update Middleware

```typescript
// src/middleware/schema-version.ts
export const SUPPORTED_VERSIONS = ['v1', 'v2', 'v3'] as const;
```

### Step 6: Test Migration

```typescript
// tests/schemas/versioning.test.ts
it('should migrate v2 to v3', () => {
  const v2Data = { operation: 'read', spreadsheetId: '...' };
  const v3Data = migrateSchema(v2Data, 'v2', 'v3');

  expect(v3Data.clientVersion).toBeDefined();
  expect(v3Data.operation).toBe('read');
});
```

---

## Deprecation Process

### Marking a Version as Deprecated

```typescript
// src/middleware/schema-version.ts
export const DEPRECATED_VERSIONS: Map<SchemaVersion, Date> = new Map([
  ['v1', new Date('2026-08-17')], // 6 months from now
]);
```

### Client Experience

1. **Deprecation Header:**

   ```http
   Deprecation: true
   Sunset: Sat, 17 Aug 2026 00:00:00 GMT
   ```

2. **Warning Logs:**

   ```
   WARN: Using deprecated schema version v1
   Sunset date: 2026-08-17
   Please upgrade to v2: https://docs.servalsheets.com/migration/v1-to-v2
   ```

3. **Migration Guide Link:**

   ```http
   Link: </docs/schema-versioning>; rel="deprecation"
   ```

### Removing a Deprecated Version

After sunset date:

1. Remove from `SUPPORTED_VERSIONS`
2. Remove migration functions
3. Update documentation
4. Announce in changelog

---

## Testing

### Unit Tests

```typescript
import { extractVersion, getVersionInfo } from '../middleware/schema-version.js';
import { migrateSchema } from '../utils/schema-migration.js';

describe('Schema Versioning', () => {
  it('should extract version from Accept header', () => {
    const req = {
      get: (header: string) =>
        header === 'Accept' ? 'application/vnd.servalsheets.v2+json' : null,
    };
    const version = extractVersion(req as any);
    expect(version).toBe('v2');
  });

  it('should detect deprecated versions', () => {
    const info = getVersionInfo('v1');
    expect(info.isDeprecated).toBe(true);
    expect(info.sunsetDate).toBeDefined();
  });

  it('should migrate between versions', () => {
    const v1Data = { action: 'read' };
    const v2Data = migrateSchema(v1Data, 'v1', 'v2');
    expect(v2Data.operation).toBe('read');
  });
});
```

### Integration Tests

```typescript
describe('Version Negotiation', () => {
  it('should serve v2 when requested', async () => {
    const response = await request(app)
      .post('/mcp')
      .set('Accept', 'application/vnd.servalsheets.v2+json')
      .send({ operation: 'read', spreadsheetId: '...' });

    expect(response.headers['x-schema-version']).toBe('v2');
    expect(response.headers['content-type']).toContain('v2');
  });

  it('should add deprecation headers for v1', async () => {
    const response = await request(app)
      .post('/mcp')
      .set('Accept', 'application/vnd.servalsheets.v1+json')
      .send({ action: 'read', spreadsheetId: '...' });

    expect(response.headers['deprecation']).toBe('true');
    expect(response.headers['sunset']).toBeDefined();
  });
});
```

---

## Best Practices

### For API Consumers

- ✅ Always specify desired version in `Accept` header
- ✅ Monitor `Deprecation` and `Sunset` headers
- ✅ Test with new versions before they become default
- ✅ Plan migrations well before sunset dates
- ❌ Don't rely on default version (it may change)
- ❌ Don't ignore deprecation warnings

### For API Developers

- ✅ Maintain at least 2 versions simultaneously
- ✅ Provide 6+ months notice for deprecations
- ✅ Write comprehensive migration guides
- ✅ Test all migration paths
- ✅ Log version usage metrics
- ❌ Don't break within a version
- ❌ Don't remove versions without warning

---

## Migration Examples

### v1 to v2 Migration Guide

**Key Changes:**

- `action` field renamed to `operation`
- Stricter `spreadsheetId` validation
- New optional `clientMetadata` field

**Before (v1):**

```json
{
  "action": "read",
  "spreadsheetId": "abc123"
}
```

**After (v2):**

```json
{
  "operation": "read",
  "spreadsheetId": "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms",
  "clientMetadata": {
    "version": "2.0.0",
    "environment": "production"
  }
}
```

**Automatic Migration:**

```typescript
// Requests using v1 format are automatically converted to v2
// No code changes needed in client - just update Accept header!
```

---

## FAQ

### Q: What happens if I don't specify a version?

**A:** You get the current default version (v1). This may change in the future, so always specify explicitly.

### Q: Can I use multiple versions in the same application?

**A:** Yes! Each request can specify its own version.

### Q: How long are versions supported?

**A:** Minimum 6 months after deprecation is announced. Stable versions may be supported longer.

### Q: What if migration breaks my integration?

**A:** You can continue using the old version until sunset. Report issues so we can fix migrations.

### Q: Are there performance differences between versions?

**A:** Minimal. Automatic migration adds <1ms overhead.

---

## Support

- **Migration Issues:** Open issue on GitHub
- **Questions:** GitHub Discussions
- **Version Status:** Check `/mcp/versions` endpoint

---

**Ready to migrate? Start with our [migration guide](./docs/migration/v1-to-v2.md)!**
