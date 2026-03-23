---
title: ServalSheets RBAC Guide
category: general
last_updated: 2026-03-10
description: Role-Based Access Control (RBAC) for ServalSheets
version: 1.6.0
tags: [security]
---

# ServalSheets RBAC Guide

**Role-Based Access Control (RBAC) for ServalSheets**

Version: 1.0.0
Last Updated: 2026-02-17
Status: Production Ready

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Built-in Roles](#built-in-roles)
4. [Custom Roles](#custom-roles)
5. [Permission Model](#permission-model)
6. [API Key Scopes](#api-key-scopes)
7. [Integration Guide](#integration-guide)
8. [Best Practices](#best-practices)
9. [API Reference](#api-reference)
10. [Troubleshooting](#troubleshooting)

## Overview

ServalSheets RBAC provides fine-grained access control at multiple levels:

- **Tool-level permissions**: Control access to entire tools (e.g., `sheets_data`)
- **Action-level permissions**: Control specific actions within tools (e.g., `read_range` vs `write_range`)
- **Resource-level permissions**: Control access to specific spreadsheets
- **Role inheritance**: Roles can inherit permissions from other roles
- **API key scopes**: Scoped permissions for API keys
- **Permission auditing**: Full audit trail of all permission checks

### Key Features

✅ **5 Built-in Roles**: Admin, Editor, Viewer, Analyst, Collaborator
✅ **Custom Roles**: Create unlimited custom roles with specific permissions
✅ **Role Inheritance**: Roles inherit from parent roles
✅ **API Key Scopes**: Fine-grained permissions for API keys
✅ **Permission Auditing**: Complete audit trail for compliance
✅ **Least Privilege**: Default deny policy enforces security
✅ **Zero Downtime**: Hot-reload role definitions without restart

## Architecture

### Components

```
┌─────────────────────────────────────────────────────────────┐
│                    HTTP Request                             │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│               RBAC Middleware                               │
│  - Extract user ID (OAuth/API key)                          │
│  - Extract tool/action/resource                             │
│  - Check permissions via RBAC Manager                       │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                RBAC Manager                                 │
│  - Load user roles                                          │
│  - Collect permissions (with inheritance)                   │
│  - Evaluate permission rules                                │
│  - Audit permission check                                   │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│              Permission Decision                            │
│  ✅ Allow → Continue to handler                             │
│  ❌ Deny → Return 403 with details                          │
└─────────────────────────────────────────────────────────────┘
```

### Permission Evaluation Order

1. **Resource-level** (highest priority)
2. **Action-level**
3. **Tool-level**
4. **Default policy** (deny by default)

**Rule:** Explicit `deny` always overrides `allow`

## Built-in Roles

### Admin

**Full system access** - Can perform all operations and manage roles.

```typescript
{
  roleId: 'admin',
  toolPermissions: [
    { toolName: '*', permission: 'allow' }
  ],
  resourcePermissions: [
    { resourceType: 'all', permission: 'allow' }
  ]
}
```

**Use cases:**

- System administrators
- DevOps teams
- Service accounts for automation

### Editor

**Read/write access** - Can modify spreadsheets but not share or manage webhooks.

```typescript
{
  roleId: 'editor',
  toolPermissions: [
    { toolName: 'sheets_data', permission: 'allow' },
    { toolName: 'sheets_format', permission: 'allow' },
    { toolName: 'sheets_dimensions', permission: 'allow' },
    // ... (15 tools allowed)
    { toolName: 'sheets_collaborate', permission: 'deny' },
    { toolName: 'sheets_webhook', permission: 'deny' }
  ]
}
```

**Use cases:**

- Regular users who need to edit spreadsheets
- Data entry teams
- Analysts who need write access

### Viewer

**Read-only access** - Can view and analyze but not modify.

```typescript
{
  roleId: 'viewer',
  toolPermissions: [
    { toolName: 'sheets_core', permission: 'allow' }
  ],
  actionPermissions: [
    { toolName: 'sheets_data', actionName: 'read_range', permission: 'allow' },
    { toolName: 'sheets_data', actionName: 'write_range', permission: 'deny' }
  ]
}
```

**Use cases:**

- Stakeholders who need visibility
- Report viewers
- Auditors

### Analyst

**Read + analyze** - Viewer plus AI analysis tools.

```typescript
{
  roleId: 'analyst',
  toolPermissions: [
    { toolName: 'sheets_analyze', permission: 'allow' },
    { toolName: 'sheets_dependencies', permission: 'allow' }
  ],
  inheritsFrom: ['viewer']
}
```

**Use cases:**

- Data scientists
- Business analysts
- Report generators

### Collaborator

**Editor + sharing** - Can edit and manage collaborators.

```typescript
{
  roleId: 'collaborator',
  toolPermissions: [
    { toolName: 'sheets_collaborate', permission: 'allow' }
  ],
  inheritsFrom: ['editor']
}
```

**Use cases:**

- Team leads
- Project managers
- Document coordinators

## Custom Roles

### Creating Custom Roles

```typescript
import { getRbacManager } from './services/rbac-manager.js';

const rbacManager = getRbacManager();

const customRole = await rbacManager.createRole({
  roleId: 'data_engineer',
  roleName: 'Data Engineer',
  description: 'Read access + BigQuery integration',
  builtIn: false,
  toolPermissions: [
    { toolName: 'sheets_data', permission: 'allow' },
    { toolName: 'sheets_bigquery', permission: 'allow' },
  ],
  actionPermissions: [
    // Deny write operations
    { toolName: 'sheets_data', actionName: 'write_range', permission: 'deny' },
    { toolName: 'sheets_data', actionName: 'append_rows', permission: 'deny' },
  ],
  resourcePermissions: [],
  inheritsFrom: ['viewer'],
});
```

### Updating Custom Roles

```typescript
await rbacManager.updateRole('data_engineer', {
  description: 'Updated description',
  toolPermissions: [
    { toolName: 'sheets_data', permission: 'allow' },
    { toolName: 'sheets_bigquery', permission: 'allow' },
    { toolName: 'sheets_templates', permission: 'allow' },
  ],
});
```

### Deleting Custom Roles

```typescript
await rbacManager.deleteRole('data_engineer');
```

**Note:** Built-in roles cannot be deleted.

## Permission Model

### Permission Levels

- **`allow`** - Operation is explicitly allowed
- **`deny`** - Operation is explicitly denied (overrides allow)
- **`inherit`** - Inherit from parent role or default policy

### Permission Types

#### 1. Tool-level Permissions

Control access to entire tools:

```typescript
{
  toolName: 'sheets_data',
  permission: 'allow'
}
```

#### 2. Action-level Permissions

Control specific actions within tools:

```typescript
{
  toolName: 'sheets_data',
  actionName: 'read_range',
  permission: 'allow'
}
```

#### 3. Resource-level Permissions

Control access to specific spreadsheets:

```typescript
{
  resourceType: 'spreadsheet',
  resourceId: '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms',
  permission: 'allow'
}
```

### Role Inheritance

Roles can inherit permissions from other roles:

```typescript
{
  roleId: 'senior_analyst',
  roleName: 'Senior Analyst',
  inheritsFrom: ['analyst', 'collaborator'],
  // Additional permissions...
}
```

**Inheritance rules:**

- Child role inherits all permissions from parent roles
- Child can override parent permissions
- `deny` in child overrides `allow` in parent
- Circular inheritance is detected and prevented

## API Key Scopes

### Creating Scoped API Keys

```typescript
const { apiKey, apiKeyScope } = await rbacManager.createApiKey({
  name: 'Production API Key',
  roles: ['viewer'],
  allowedTools: ['sheets_data', 'sheets_core'],
  allowedResources: ['1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms'],
  rateLimit: {
    requestsPerMinute: 60,
    requestsPerHour: 1000,
  },
  createdBy: 'admin@example.com',
  expiresAt: new Date('2027-01-01'),
});

// Save apiKey securely - it's only shown once
console.log('API Key:', apiKey);
```

### Validating API Keys

```typescript
const scope = await rbacManager.validateApiKey(apiKey);
if (scope) {
  console.log('Valid key:', scope.name);
  console.log('Roles:', scope.roles);
  console.log('Allowed tools:', scope.allowedTools);
}
```

### Revoking API Keys

```typescript
await rbacManager.revokeApiKey(apiKeyScope.apiKeyId);
```

## Integration Guide

### Enable RBAC Middleware

Add to your HTTP server:

```typescript
import { rbacMiddleware } from './middleware/rbac-middleware.js';
import { initializeRbacManager } from './services/rbac-manager.js';

// Initialize RBAC manager at startup
await initializeRbacManager({
  enableAuditing: true,
  defaultDeny: true,
});

// Add middleware
app.use(
  rbacMiddleware({
    enabled: true,
    skipPaths: [/^\/health/, /^\/metrics/],
  })
);
```

### Assign Roles to Users

```typescript
// Via OAuth user ID
await rbacManager.assignRoles('user@example.com', ['editor'], 'admin@example.com');

// With expiration
await rbacManager.assignRoles(
  'temp@example.com',
  ['viewer'],
  'admin@example.com',
  new Date('2026-12-31')
);
```

### Check Permissions Programmatically

```typescript
const result = await rbacManager.checkPermission({
  userId: 'user@example.com',
  toolName: 'sheets_data',
  actionName: 'write_range',
  resourceId: '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms',
});

if (result.allowed) {
  // Proceed with operation
} else {
  console.error('Permission denied:', result.reason);
  console.log('Suggestions:', result.suggestedActions);
}
```

## Best Practices

### 1. Principle of Least Privilege

Always assign the minimum necessary permissions:

```typescript
// ❌ Don't give admin to everyone
await rbacManager.assignRoles('user@example.com', ['admin']);

// ✅ Give specific role for task
await rbacManager.assignRoles('user@example.com', ['viewer']);
```

### 2. Use Custom Roles for Specific Use Cases

Create custom roles instead of modifying built-in roles:

```typescript
// ✅ Create custom role for specific needs
await rbacManager.createRole({
  roleId: 'report_viewer',
  roleName: 'Report Viewer',
  description: 'Can view reports but not raw data',
  toolPermissions: [{ toolName: 'sheets_analyze', permission: 'allow' }],
  actionPermissions: [{ toolName: 'sheets_data', actionName: 'read_range', permission: 'deny' }],
  inheritsFrom: ['viewer'],
});
```

### 3. Use API Keys for Service Accounts

Create scoped API keys for automation:

```typescript
const { apiKey } = await rbacManager.createApiKey({
  name: 'Backup Service',
  roles: ['viewer'],
  allowedTools: ['sheets_data', 'sheets_core'],
  rateLimit: {
    requestsPerMinute: 10,
    requestsPerHour: 100,
  },
  createdBy: 'admin@example.com',
});
```

### 4. Include Essential Orchestration Tools in Allowed Lists

When scoping `allowedTools` for API keys, always include the three essential orchestration tools alongside data tools — omitting them silently degrades functionality:

| Tool                 | Why it matters                                                                                            |
| -------------------- | --------------------------------------------------------------------------------------------------------- |
| `sheets_session`     | Enables context tracking: omit spreadsheetId in subsequent calls, use column names instead of A1 notation |
| `sheets_transaction` | Required for atomic batch writes (5+ operations); omitting forces slow sequential calls with no rollback  |
| `sheets_composite`   | High-level operations: import_csv, smart_append, setup_sheet, generate_sheet                              |

```typescript
// ❌ Missing orchestration tools — batch ops broken, no context
allowedTools: ['sheets_data', 'sheets_core'];

// ✅ Recommended minimum for interactive editor workflows
allowedTools: [
  'sheets_data',
  'sheets_core',
  'sheets_format',
  'sheets_session', // context tracking (omit spreadsheetId)
  'sheets_transaction', // atomic batch writes
  'sheets_composite', // import_csv, smart_append, setup_sheet
];

// ✅ Read-only minimum (no mutation tools)
allowedTools: ['sheets_data', 'sheets_core', 'sheets_analyze', 'sheets_session'];
```

### 6. Regular Audit Reviews

Review audit logs periodically:

```typescript
const logs = await rbacManager.getAuditLogs({
  startTime: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // Last 7 days
  limit: 1000,
});

// Analyze for suspicious patterns
const deniedAccess = logs.filter((log) => !log.allowed);
console.log('Denied access attempts:', deniedAccess.length);
```

### 7. Use Role Expiration for Temporary Access

```typescript
const oneWeek = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

await rbacManager.assignRoles(
  'contractor@example.com',
  ['editor'],
  'admin@example.com',
  oneWeek // Expires in 1 week
);
```

## API Reference

### RbacManager

#### `createRole(role)`

Create a custom role.

#### `updateRole(roleId, updates)`

Update a custom role.

#### `deleteRole(roleId)`

Delete a custom role.

#### `getRole(roleId)`

Get role definition.

#### `listRoles()`

List all roles.

#### `assignRoles(userId, roles, assignedBy?, expiresAt?)`

Assign roles to a user.

#### `getUserRoles(userId)`

Get user's assigned roles.

#### `revokeUserRoles(userId)`

Revoke all user roles.

#### `createApiKey(options)`

Create API key with scoped permissions.

#### `validateApiKey(apiKey)`

Validate and get API key scope.

#### `revokeApiKey(apiKeyId)`

Revoke API key.

#### `listApiKeys()`

List all API keys (without keys).

#### `checkPermission(request)`

Check if user has permission.

#### `getAuditLogs(filters?)`

Get permission audit logs.

### RBAC Middleware

#### `rbacMiddleware(options?)`

Create RBAC enforcement middleware.

**Options:**

- `enabled` - Enable/disable RBAC (default: true)
- `skipPaths` - Paths to skip (default: [/^\/health/, /^\/metrics/])
- `getUserId` - Custom user ID extraction function
- `onPermissionDenied` - Custom error handler

## Troubleshooting

### Common Issues

#### 1. Permission Denied for Valid Operation

**Symptom:** User has role but still gets permission denied.

**Solution:**

```typescript
// Check user roles
const roles = await rbacManager.getUserRoles('user@example.com');
console.log('User roles:', roles);

// Check permission details
const result = await rbacManager.checkPermission({
  userId: 'user@example.com',
  toolName: 'sheets_data',
  actionName: 'write_range',
});
console.log('Permission result:', result);
console.log('Matched rules:', result.matchedRules);
```

#### 2. Role Assignment Not Working

**Symptom:** Assigned role but permissions not applied.

**Solution:**

```typescript
// Verify role exists
const role = await rbacManager.getRole('custom_role');
if (!role) {
  console.error('Role does not exist');
}

// Check expiration
const assignment = await rbacManager['storage'].getUserRoleAssignment('user@example.com');
if (assignment?.expiresAt && new Date(assignment.expiresAt) < new Date()) {
  console.error('Role assignment expired');
}
```

#### 3. API Key Not Working

**Symptom:** Valid API key returns 403.

**Solution:**

```typescript
// Validate API key
const scope = await rbacManager.validateApiKey(apiKey);
if (!scope) {
  console.error('API key invalid, disabled, or expired');
}

// Check key scopes
console.log('Allowed tools:', scope?.allowedTools);
console.log('Roles:', scope?.roles);
```

### Debug Mode

Enable detailed logging:

```typescript
import { logger } from './utils/logger.js';

// Set log level to debug
logger.level = 'debug';

// Check permission with detailed logs
const result = await rbacManager.checkPermission({...});
```

### Audit Log Analysis

Find failed permission checks:

```typescript
const deniedLogs = await rbacManager.getAuditLogs({
  startTime: new Date(Date.now() - 24 * 60 * 60 * 1000), // Last 24 hours
});

const denied = deniedLogs.filter((log) => !log.allowed);
console.log('Failed permission checks:', denied.length);

// Group by user
const byUser = denied.reduce(
  (acc, log) => {
    acc[log.userId] = (acc[log.userId] || 0) + 1;
    return acc;
  },
  {} as Record<string, number>
);
console.log('Failed checks by user:', byUser);
```

## Security Considerations

### 1. Default Deny Policy

ServalSheets RBAC uses a **default deny** policy. Users must be explicitly granted permissions.

### 2. API Key Security

- API keys are SHA-256 hashed before storage
- Plaintext keys are never stored
- Keys are only shown once at creation
- Use environment variables to store keys

### 3. Role Inheritance Validation

- Circular inheritance is detected and prevented
- Inheritance depth is limited to prevent performance issues

### 4. Audit Logging

- All permission checks are logged (when enabled)
- Logs include timestamp, user, operation, and result
- Use audit logs for compliance and security monitoring

## Performance

### Benchmarks

- **Permission check**: < 5ms (with role inheritance)
- **API key validation**: < 2ms (SHA-256 hash lookup)
- **Role creation**: < 1ms (in-memory storage)
- **Audit log query**: < 10ms (for 10,000 logs)

### Optimization Tips

1. **Use role inheritance** to reduce permission duplication
2. **Cache permission results** for repeated checks (TTL: 60s)
3. **Batch permission checks** when possible
4. **Use wildcard permissions** for admin roles
5. **Limit audit log retention** to recent logs only

## Examples

See `tests/security/rbac.test.ts` for comprehensive examples of:

- Creating custom roles
- Assigning roles to users
- Creating scoped API keys
- Checking permissions
- Role inheritance
- Audit logging

## Support

For issues or questions:

1. Check the [Troubleshooting](#troubleshooting) section
2. Review test files in `tests/security/rbac.test.ts`
3. Enable debug logging for detailed information
4. Check audit logs for permission denial reasons

## Changelog

### Version 1.0.0 (2026-02-17)

- Initial RBAC implementation
- 5 built-in roles
- Custom role creation
- Role inheritance
- API key scopes
- Permission auditing
- Middleware integration
- Comprehensive test coverage (30+ tests)
