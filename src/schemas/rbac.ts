/**
 * ServalSheets - RBAC Schemas
 *
 * Role-Based Access Control (RBAC) schemas for fine-grained authorization.
 * Defines roles, permissions, and access control rules.
 *
 * MCP Protocol: 2025-11-25
 */

import { z } from 'zod';

// ============================================================================
// ROLE DEFINITIONS
// ============================================================================

/**
 * Built-in role identifiers
 */
export const RoleEnum = z.enum([
  'admin', // Full access - all tools, all actions, all resources
  'editor', // Read/write access - most tools except admin operations
  'viewer', // Read-only access - data reading, analysis, no modifications
  'analyst', // Read + analyze - includes AI analysis tools
  'collaborator', // Editor + sharing - can manage collaborators
]);

export type Role = z.infer<typeof RoleEnum>;

/**
 * Permission level for specific operations
 */
export const PermissionLevelEnum = z.enum([
  'allow', // Operation is explicitly allowed
  'deny', // Operation is explicitly denied (overrides allow)
  'inherit', // Inherit from parent role or default policy
]);

export type PermissionLevel = z.infer<typeof PermissionLevelEnum>;

// ============================================================================
// PERMISSION SCHEMAS
// ============================================================================

/**
 * Tool-level permission
 * Controls access to entire tools (e.g., sheets_data, sheets_format)
 */
export const ToolPermissionSchema = z.object({
  toolName: z.string().min(1).describe('Tool name (e.g., sheets_data)'),
  permission: PermissionLevelEnum,
  reason: z.string().optional().describe('Reason for permission (for audit logs)'),
});

export type ToolPermission = z.infer<typeof ToolPermissionSchema>;

/**
 * Action-level permission
 * Controls access to specific actions within a tool
 */
export const ActionPermissionSchema = z.object({
  toolName: z.string().min(1).describe('Tool name (e.g., sheets_data)'),
  actionName: z.string().min(1).describe('Action name (e.g., read_range)'),
  permission: PermissionLevelEnum,
  reason: z.string().optional().describe('Reason for permission (for audit logs)'),
});

export type ActionPermission = z.infer<typeof ActionPermissionSchema>;

/**
 * Resource-level permission
 * Controls access to specific spreadsheets or resources
 */
export const ResourcePermissionSchema = z.object({
  resourceType: z.enum(['spreadsheet', 'sheet', 'range', 'all']),
  resourceId: z.string().optional().describe('Resource ID (spreadsheetId, sheetId, etc.)'),
  permission: PermissionLevelEnum,
  reason: z.string().optional().describe('Reason for permission (for audit logs)'),
});

export type ResourcePermission = z.infer<typeof ResourcePermissionSchema>;

// ============================================================================
// ROLE DEFINITION SCHEMA
// ============================================================================

/**
 * Complete role definition with all permissions
 */
export const RoleDefinitionSchema = z.object({
  roleId: z.string().min(1).describe('Unique role identifier'),
  roleName: z.string().min(1).describe('Human-readable role name'),
  description: z.string().describe('Role description'),
  builtIn: z.boolean().default(false).describe('Built-in role (cannot be deleted)'),

  // Permission sets
  toolPermissions: z.array(ToolPermissionSchema).default([]),
  actionPermissions: z.array(ActionPermissionSchema).default([]),
  resourcePermissions: z.array(ResourcePermissionSchema).default([]),

  // Role hierarchy
  inheritsFrom: z.array(z.string()).default([]).describe('Parent roles to inherit from'),

  // Metadata
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
  createdBy: z.string().optional(),
});

export type RoleDefinition = z.infer<typeof RoleDefinitionSchema>;

// ============================================================================
// USER ROLE ASSIGNMENT
// ============================================================================

/**
 * User role assignment
 */
export const UserRoleAssignmentSchema = z.object({
  userId: z.string().min(1).describe('User ID (email, OAuth sub, or API key ID)'),
  roles: z.array(z.string().min(1)).describe('Assigned role IDs'),
  assignedAt: z.string().datetime(),
  assignedBy: z.string().optional(),
  expiresAt: z.string().datetime().optional().describe('Optional expiration time'),
});

export type UserRoleAssignment = z.infer<typeof UserRoleAssignmentSchema>;

// ============================================================================
// API KEY SCOPE SCHEMA
// ============================================================================

/**
 * API key with scoped permissions
 */
export const ApiKeyScopeSchema = z.object({
  apiKeyId: z.string().min(1).describe('API key identifier'),
  keyHash: z.string().min(1).describe('SHA-256 hash of API key'),
  name: z.string().min(1).describe('Human-readable key name'),

  // Scopes
  allowedTools: z.array(z.string()).default([]).describe('Allowed tool names (empty = all)'),
  allowedActions: z.array(z.string()).default([]).describe('Allowed actions (empty = all)'),
  allowedResources: z
    .array(z.string())
    .default([])
    .describe('Allowed spreadsheet IDs (empty = all)'),

  // Role-based scopes
  roles: z.array(z.string()).default([]).describe('Role IDs assigned to this API key'),

  // Rate limiting
  rateLimit: z
    .object({
      requestsPerMinute: z.number().int().positive().default(60),
      requestsPerHour: z.number().int().positive().default(1000),
    })
    .optional(),

  // Metadata
  createdAt: z.string().datetime(),
  createdBy: z.string(),
  expiresAt: z.string().datetime().optional(),
  lastUsedAt: z.string().datetime().optional(),
  usageCount: z.number().int().nonnegative().default(0),
  enabled: z.boolean().default(true),
});

export type ApiKeyScope = z.infer<typeof ApiKeyScopeSchema>;

// ============================================================================
// PERMISSION CHECK SCHEMAS
// ============================================================================

/**
 * Permission check request
 */
export const PermissionCheckRequestSchema = z.object({
  userId: z.string().min(1).describe('User ID to check permissions for'),
  toolName: z.string().min(1).describe('Tool name'),
  actionName: z.string().optional().describe('Action name (optional)'),
  resourceId: z.string().optional().describe('Resource ID (optional)'),
});

export type PermissionCheckRequest = z.infer<typeof PermissionCheckRequestSchema>;

/**
 * Permission check result
 */
export const PermissionCheckResultSchema = z.object({
  allowed: z.boolean().describe('Whether permission is granted'),
  permission: PermissionLevelEnum,
  reason: z.string().describe('Reason for decision'),
  matchedRules: z
    .array(
      z.object({
        ruleType: z.enum(['tool', 'action', 'resource', 'role']),
        ruleName: z.string(),
        permission: PermissionLevelEnum,
      })
    )
    .describe('Rules that matched (for debugging)'),
  suggestedActions: z.array(z.string()).optional().describe('Actions to resolve if denied'),
});

export type PermissionCheckResult = z.infer<typeof PermissionCheckResultSchema>;

// ============================================================================
// PERMISSION AUDIT SCHEMAS
// ============================================================================

/**
 * Permission audit log entry
 */
export const PermissionAuditLogSchema = z.object({
  id: z.string().min(1),
  timestamp: z.string().datetime(),
  userId: z.string().min(1),
  operation: z.enum(['check', 'grant', 'revoke', 'update']),
  toolName: z.string().optional(),
  actionName: z.string().optional(),
  resourceId: z.string().optional(),
  permission: PermissionLevelEnum,
  allowed: z.boolean(),
  reason: z.string(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type PermissionAuditLog = z.infer<typeof PermissionAuditLogSchema>;

// ============================================================================
// BUILT-IN ROLE DEFAULTS
// ============================================================================

/**
 * Default built-in role definitions
 * These are applied at startup and cannot be deleted
 */
export const BUILT_IN_ROLES: Readonly<Record<Role, RoleDefinition>> = {
  admin: {
    roleId: 'admin',
    roleName: 'Administrator',
    description:
      'Full access to all tools, actions, and resources. Can manage roles and permissions.',
    builtIn: true,
    toolPermissions: [{ toolName: '*', permission: 'allow', reason: 'Admin has full access' }],
    actionPermissions: [],
    resourcePermissions: [
      { resourceType: 'all', permission: 'allow', reason: 'Admin has full access' },
    ],
    inheritsFrom: [],
  },

  editor: {
    roleId: 'editor',
    roleName: 'Editor',
    description:
      'Read/write access to spreadsheets. Can modify data, format, and structure. Cannot share or manage permissions.',
    builtIn: true,
    toolPermissions: [
      { toolName: 'sheets_data', permission: 'allow' },
      { toolName: 'sheets_format', permission: 'allow' },
      { toolName: 'sheets_dimensions', permission: 'allow' },
      { toolName: 'sheets_visualize', permission: 'allow' },
      { toolName: 'sheets_advanced', permission: 'allow' },
      { toolName: 'sheets_transaction', permission: 'allow' },
      { toolName: 'sheets_quality', permission: 'allow' },
      { toolName: 'sheets_history', permission: 'allow' },
      { toolName: 'sheets_confirm', permission: 'allow' },
      { toolName: 'sheets_analyze', permission: 'allow' },
      { toolName: 'sheets_fix', permission: 'allow' },
      { toolName: 'sheets_composite', permission: 'allow' },
      { toolName: 'sheets_session', permission: 'allow' },
      { toolName: 'sheets_templates', permission: 'allow' },
      { toolName: 'sheets_dependencies', permission: 'allow' },
      // Deny admin operations
      { toolName: 'sheets_collaborate', permission: 'deny', reason: 'Editors cannot share' },
      { toolName: 'sheets_webhook', permission: 'deny', reason: 'Editors cannot manage webhooks' },
      { toolName: 'sheets_appsscript', permission: 'deny', reason: 'Editors cannot run scripts' },
      { toolName: 'sheets_bigquery', permission: 'deny', reason: 'Editors cannot access BigQuery' },
    ],
    actionPermissions: [],
    resourcePermissions: [],
    inheritsFrom: [],
  },

  viewer: {
    roleId: 'viewer',
    roleName: 'Viewer',
    description: 'Read-only access. Can view data and analyze but cannot modify spreadsheets.',
    builtIn: true,
    toolPermissions: [
      { toolName: 'sheets_core', permission: 'allow', reason: 'Viewers can read metadata' },
      { toolName: 'sheets_session', permission: 'allow', reason: 'Viewers can use session' },
    ],
    actionPermissions: [
      // Allow only read operations in sheets_data
      { toolName: 'sheets_data', actionName: 'read_range', permission: 'allow' },
      { toolName: 'sheets_data', actionName: 'batch_read', permission: 'allow' },
      { toolName: 'sheets_data', actionName: 'get_cell', permission: 'allow' },
      // Note: No explicit denies - absence of allow implies deny (default deny policy)
      // This allows viewer + editor roles to work together correctly
      // Allow read-only advanced operations
      { toolName: 'sheets_advanced', actionName: 'get_data_validation', permission: 'allow' },
      { toolName: 'sheets_advanced', actionName: 'get_named_ranges', permission: 'allow' },
    ],
    resourcePermissions: [],
    inheritsFrom: [],
  },

  analyst: {
    roleId: 'analyst',
    roleName: 'Analyst',
    description:
      'Read access plus analysis tools. Can analyze data, generate insights, and use AI features. Cannot modify spreadsheets.',
    builtIn: true,
    toolPermissions: [
      { toolName: 'sheets_core', permission: 'allow' },
      { toolName: 'sheets_analyze', permission: 'allow' },
      { toolName: 'sheets_session', permission: 'allow' },
      { toolName: 'sheets_dependencies', permission: 'allow' },
    ],
    actionPermissions: [
      // Allow all read operations
      { toolName: 'sheets_data', actionName: 'read_range', permission: 'allow' },
      { toolName: 'sheets_data', actionName: 'batch_read', permission: 'allow' },
      { toolName: 'sheets_data', actionName: 'get_cell', permission: 'allow' },
      // Deny all write operations
      { toolName: 'sheets_data', actionName: 'write_range', permission: 'deny' },
      { toolName: 'sheets_data', actionName: 'append_rows', permission: 'deny' },
    ],
    resourcePermissions: [],
    inheritsFrom: ['viewer'],
  },

  collaborator: {
    roleId: 'collaborator',
    roleName: 'Collaborator',
    description:
      'Editor access plus sharing capabilities. Can modify spreadsheets and manage collaborators. Cannot manage webhooks or run scripts.',
    builtIn: true,
    toolPermissions: [{ toolName: 'sheets_collaborate', permission: 'allow' }],
    actionPermissions: [],
    resourcePermissions: [],
    inheritsFrom: ['editor'],
  },
};

// ============================================================================
// PERMISSION CATEGORIES
// ============================================================================

/**
 * Permission categories for grouping related tools
 */
export const PERMISSION_CATEGORIES = {
  read: ['sheets_core', 'sheets_data'],
  write: ['sheets_data', 'sheets_format', 'sheets_dimensions'],
  advanced: ['sheets_advanced', 'sheets_transaction', 'sheets_quality'],
  analysis: ['sheets_analyze', 'sheets_dependencies'],
  collaboration: ['sheets_collaborate', 'sheets_webhook'],
  automation: ['sheets_appsscript', 'sheets_bigquery', 'sheets_templates'],
  admin: ['sheets_webhook', 'sheets_appsscript', 'sheets_bigquery'],
} as const;

export type PermissionCategory = keyof typeof PERMISSION_CATEGORIES;
