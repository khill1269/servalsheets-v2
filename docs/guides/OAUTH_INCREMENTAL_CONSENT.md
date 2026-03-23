---
title: OAuth Incremental Consent Guide
category: guide
last_updated: 2026-01-31
description: ServalSheets implements OAuth 2.0 Incremental Authorization, allowing users to grant minimal permissions initially and additional scopes only when spe
version: 1.6.0
tags: [oauth, authentication]
audience: user
difficulty: intermediate
---

# OAuth Incremental Consent Guide

## Overview

ServalSheets implements **OAuth 2.0 Incremental Authorization**, allowing users to grant minimal permissions initially and additional scopes only when specific features require them.

This improves security and user experience by:

- Reducing the initial permission request to only core spreadsheet access
- Granting sensitive permissions (Drive, BigQuery, Apps Script) only when needed
- Providing clear context about why additional permissions are required

## How It Works

### 1. Default Scopes (Minimal Access)

When you first authorize ServalSheets, only these minimal scopes are requested:

```
https://www.googleapis.com/auth/spreadsheets
https://www.googleapis.com/auth/drive.file
```

**What you can do with minimal scopes:**

- Read and write spreadsheet data
- Create formulas, formatting, charts
- Manage sheets, rows, columns
- Create named ranges, protected ranges
- Add metadata, banding
- Access files created by ServalSheets

### 2. Additional Scopes (On-Demand)

When you use advanced features, ServalSheets will request additional permissions:

| Feature             | Required Scope    | Reason                                |
| ------------------- | ----------------- | ------------------------------------- |
| **Templates**       | `drive.appdata`   | Store templates in app data folder    |
| **Comments**        | `drive`           | Access comment threads via Drive API  |
| **Version History** | `drive`           | List and restore previous versions    |
| **Sharing**         | `drive`           | Manage permissions and share settings |
| **BigQuery Export** | `bigquery`        | Export data to BigQuery datasets      |
| **Apps Script**     | `script.projects` | Create and deploy automation scripts  |

### 3. Incremental Authorization Flow

When you attempt an operation requiring additional scopes:

**Step 1: Operation Fails with Clear Message**

```json
{
  "success": false,
  "error": {
    "code": "INCREMENTAL_SCOPE_REQUIRED",
    "message": "Operation 'sheets_templates.create' requires additional permissions",
    "category": "auth",
    "retryable": true,
    "retryStrategy": "reauthorize",
    "resolution": "Grant additional permissions by visiting: https://accounts.google.com/o/oauth2/v2/auth?...",
    "resolutionSteps": [
      "1. Visit the authorization URL provided in error.details.authorizationUrl",
      "2. Review the additional scopes being requested",
      "3. Click 'Allow' to grant the permissions",
      "4. Return to ServalSheets and retry the operation"
    ],
    "details": {
      "operation": "sheets_templates.create",
      "category": "DRIVE_FULL",
      "missingScopes": ["https://www.googleapis.com/auth/drive.appdata"],
      "currentScopes": [
        "https://www.googleapis.com/auth/spreadsheets",
        "https://www.googleapis.com/auth/drive.file"
      ],
      "authorizationUrl": "https://accounts.google.com/o/oauth2/v2/auth?scope=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fdrive.appdata&include_granted_scopes=true&..."
    }
  }
}
```

**Step 2: Follow Authorization URL**

Click the URL in `error.details.authorizationUrl`. This includes:

- `include_granted_scopes=true` - Preserves your existing permissions
- `scope=...` - Only the additional scopes needed
- Your existing tokens remain valid

**Step 3: Grant Additional Permissions**

Google's consent screen shows:

- **Previous permissions** (already granted, shown in gray)
- **New permissions** (requesting now, shown in blue)
- Description of what each permission allows

Click **Allow** to grant the additional scopes.

**Step 4: Retry Operation**

Return to ServalSheets and retry the same operation. It will now succeed with the expanded permissions.

## Scope Categories

ServalSheets organizes scopes into four categories:

### DEFAULT (Minimal Access)

- `spreadsheets` - Read/write spreadsheet data
- `drive.file` - Access files created by ServalSheets

**Required for:** All core spreadsheet operations

### DRIVE_READ_ONLY

- `drive.readonly` - View Drive files and metadata

**Required for:** Reading file metadata, listing folders

### DRIVE_FULL

- `drive` - Full Drive access (read/write/share)
- `drive.appdata` - App data folder (for templates)

**Required for:** Comments, sharing, version history, templates

### EXTENDED

- `bigquery` - BigQuery access
- `script.projects` - Apps Script automation

**Required for:** BigQuery export, Apps Script deployment

## Common Operations and Their Scopes

### Core Spreadsheet Operations (DEFAULT)

✅ No additional scopes needed:

- `sheets_core.*` - All spreadsheet data operations
- `sheets_data.*` - Read/write/append/update
- `sheets_format.*` - Formatting and styling
- `sheets_advanced.*` (most actions) - Named ranges, protections, metadata

### Templates (DRIVE_FULL)

🔒 Requires `drive.appdata`:

- `sheets_templates.create` - Save new template
- `sheets_templates.save` - Update existing template
- `sheets_templates.delete` - Remove template

**Why?** Templates are stored in your Drive app data folder, isolated from other files.

### Collaboration (DRIVE_FULL)

🔒 Requires `drive`:

- `sheets_collaborate.comment_add` - Add comments
- `sheets_collaborate.comment_list` - List comment threads
- `sheets_collaborate.share` - Manage permissions
- `sheets_collaborate.version_list` - List version history
- `sheets_collaborate.version_restore` - Restore previous versions

**Why?** Comments and sharing use the Drive API, not the Sheets API.

### BigQuery Export (EXTENDED)

🔒 Requires `bigquery`:

- `sheets_bigquery.export` - Export to BigQuery table

**Why?** Writing to BigQuery requires explicit BigQuery authorization.

### Apps Script (EXTENDED)

🔒 Requires `script.projects`:

- `sheets_appsscript.create_project` - Create Apps Script project
- `sheets_appsscript.deploy` - Deploy script as add-on

**Why?** Creating and deploying scripts requires Apps Script project permissions.

## Implementation Details

### For Developers

ServalSheets uses `ScopeValidator` to enforce incremental consent:

**1. Default Scope Configuration** ([src/services/google-api.ts:177](src/services/google-api.ts#L177)):

```typescript
this._scopes = options.scopes ?? DEFAULT_SCOPES;
```

**2. Operation Scope Mapping** ([src/security/incremental-scope.ts](src/security/incremental-scope.ts)):

```typescript
export const OPERATION_SCOPES: Record<string, OperationScope> = {
  'sheets_templates.create': {
    required: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive.appdata',
    ],
    category: ScopeCategory.DRIVE_FULL,
    description: 'Save template to app data folder',
  },
  // ... 50+ operations mapped
};
```

**3. Handler Validation** ([src/handlers/templates.ts:124-147](src/handlers/templates.ts#L124-L147)):

```typescript
private validateScopes(operation: string): TemplatesResponse | null {
  const validator = new ScopeValidator({
    scopes: this.context.auth?.scopes ?? [],
  });
  try {
    validator.validateOperation(operation);
    return null; // Scopes are valid
  } catch (error) {
    if (error instanceof IncrementalScopeRequiredError) {
      return this.error({
        code: 'INCREMENTAL_SCOPE_REQUIRED',
        message: error.message,
        // ... error details with authorizationUrl
      });
    }
    throw error;
  }
}
```

**4. Authorization URL Generation** ([src/handlers/auth.ts:218](src/handlers/auth.ts#L218)):

```typescript
const authUrl = oauthClient.generateAuthUrl({
  access_type: 'offline',
  scope: requestedScopes,
  prompt: 'consent',
  include_granted_scopes: true, // Preserve existing grants
});
```

### Testing Incremental Consent

Run integration tests:

```bash
npm run test:integration -- tests/live-api/auth/incremental-consent.live.test.ts
```

Tests verify:

- ✅ Default scopes are minimal
- ✅ Templates require drive.appdata
- ✅ Comments require drive
- ✅ Error includes authorization URL with include_granted_scopes=true
- ✅ Operations succeed after granting additional scopes

## Security Best Practices

1. **Request minimum scopes by default** - Only ask for what you need immediately
2. **Request additional scopes contextually** - When the user tries to use a feature
3. **Preserve existing grants** - Always use `include_granted_scopes=true`
4. **Provide clear explanations** - Tell users why each scope is needed
5. **Never downgrade permissions** - Don't remove previously granted scopes

## Troubleshooting

### Error: "INCREMENTAL_SCOPE_REQUIRED"

**Cause:** You're trying to use a feature that requires additional permissions.

**Solution:**

1. Check `error.details.missingScopes` to see what's needed
2. Visit `error.details.authorizationUrl` to grant permissions
3. Retry the operation

### Error: "Token has been expired or revoked"

**Cause:** Your access token expired or was revoked after granting new scopes.

**Solution:**

1. Re-authenticate completely
2. Use the refresh token to get a new access token

### Scopes Not Persisting

**Cause:** Authorization URL missing `include_granted_scopes=true`.

**Solution:**

- Verify [src/handlers/auth.ts:218](src/handlers/auth.ts#L218) includes the parameter
- Check that Google OAuth client is configured correctly

## References

- [Google OAuth 2.0 Incremental Authorization](https://developers.google.com/identity/protocols/oauth2/web-server#incrementalAuth)
- [Google OAuth Best Practices](https://developers.google.com/identity/protocols/oauth2/resources/best-practices)
- [ServalSheets Scope Mapping](../../src/security/incremental-scope.ts)
