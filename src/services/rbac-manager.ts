/**
 * ServalSheets - RBAC Manager Service
 *
 * Fine-grained Role-Based Access Control (RBAC) manager.
 * Handles role definitions, permission checks, and access control enforcement.
 *
 * Features:
 * - Built-in roles (Admin, Editor, Viewer, Analyst, Collaborator)
 * - Custom role creation
 * - Role inheritance
 * - Resource-level permissions
 * - API key scopes
 * - Permission auditing
 * - Least privilege enforcement
 *
 * @module services/rbac-manager
 */

import { createHash } from 'crypto';
import { logger } from '../utils/logger.js';
import { NotFoundError, ValidationError } from '../core/errors.js';
import {
  type RoleDefinition,
  type UserRoleAssignment,
  type ApiKeyScope,
  type PermissionCheckRequest,
  type PermissionCheckResult,
  type PermissionAuditLog,
  type PermissionLevel,
  type ToolPermission,
  type ActionPermission,
  type ResourcePermission,
  BUILT_IN_ROLES,
  RoleDefinitionSchema,
  UserRoleAssignmentSchema,
  ApiKeyScopeSchema,
  PermissionCheckResultSchema,
} from '../schemas/rbac.js';

// ============================================================================
// RBAC MANAGER
// ============================================================================

export interface RbacManagerOptions {
  /**
   * Enable permission auditing (logs all permission checks)
   * Default: true in production
   */
  enableAuditing?: boolean;

  /**
   * Default deny policy (deny by default, require explicit allow)
   * Default: true (recommended)
   */
  defaultDeny?: boolean;

  /**
   * Maximum audit log entries to keep in memory
   * Default: 10000
   */
  maxAuditLogSize?: number;

  /**
   * Storage backend for persistence (optional)
   */
  storage?: RbacStorage;
}

/**
 * Storage interface for RBAC persistence
 */
export interface RbacStorage {
  // Roles
  getRoleDefinition(roleId: string): Promise<RoleDefinition | null>;
  saveRoleDefinition(role: RoleDefinition): Promise<void>;
  deleteRoleDefinition(roleId: string): Promise<void>;
  listRoleDefinitions(): Promise<RoleDefinition[]>;

  // User assignments
  getUserRoleAssignment(userId: string): Promise<UserRoleAssignment | null>;
  saveUserRoleAssignment(assignment: UserRoleAssignment): Promise<void>;
  deleteUserRoleAssignment(userId: string): Promise<void>;

  // API keys
  getApiKeyScope(apiKeyId: string): Promise<ApiKeyScope | null>;
  saveApiKeyScope(scope: ApiKeyScope): Promise<void>;
  deleteApiKeyScope(apiKeyId: string): Promise<void>;
  listApiKeyScopes(): Promise<ApiKeyScope[]>;

  // Audit logs
  saveAuditLog(log: PermissionAuditLog): Promise<void>;
  getAuditLogs(filters?: {
    userId?: string;
    startTime?: Date;
    endTime?: Date;
    limit?: number;
  }): Promise<PermissionAuditLog[]>;
}

/**
 * In-memory RBAC storage (default)
 */
class InMemoryRbacStorage implements RbacStorage {
  private roles = new Map<string, RoleDefinition>();
  private userAssignments = new Map<string, UserRoleAssignment>();
  private apiKeyScopes = new Map<string, ApiKeyScope>();
  private auditLogs: PermissionAuditLog[] = [];

  async getRoleDefinition(roleId: string): Promise<RoleDefinition | null> {
    return this.roles.get(roleId) || null;
  }

  async saveRoleDefinition(role: RoleDefinition): Promise<void> {
    this.roles.set(role.roleId, role);
  }

  async deleteRoleDefinition(roleId: string): Promise<void> {
    this.roles.delete(roleId);
  }

  async listRoleDefinitions(): Promise<RoleDefinition[]> {
    return Array.from(this.roles.values());
  }

  async getUserRoleAssignment(userId: string): Promise<UserRoleAssignment | null> {
    return this.userAssignments.get(userId) || null;
  }

  async saveUserRoleAssignment(assignment: UserRoleAssignment): Promise<void> {
    this.userAssignments.set(assignment.userId, assignment);
  }

  async deleteUserRoleAssignment(userId: string): Promise<void> {
    this.userAssignments.delete(userId);
  }

  async getApiKeyScope(apiKeyId: string): Promise<ApiKeyScope | null> {
    return this.apiKeyScopes.get(apiKeyId) || null;
  }

  async saveApiKeyScope(scope: ApiKeyScope): Promise<void> {
    this.apiKeyScopes.set(scope.apiKeyId, scope);
  }

  async deleteApiKeyScope(apiKeyId: string): Promise<void> {
    this.apiKeyScopes.delete(apiKeyId);
  }

  async listApiKeyScopes(): Promise<ApiKeyScope[]> {
    return Array.from(this.apiKeyScopes.values());
  }

  async saveAuditLog(log: PermissionAuditLog): Promise<void> {
    this.auditLogs.push(log);
    // Keep only recent logs in memory
    if (this.auditLogs.length > 10000) {
      this.auditLogs = this.auditLogs.slice(-10000);
    }
  }

  async getAuditLogs(filters?: {
    userId?: string;
    startTime?: Date;
    endTime?: Date;
    limit?: number;
  }): Promise<PermissionAuditLog[]> {
    let logs = this.auditLogs;

    if (filters?.userId) {
      logs = logs.filter((log) => log.userId === filters.userId);
    }
    if (filters?.startTime) {
      logs = logs.filter((log) => new Date(log.timestamp) >= filters.startTime!);
    }
    if (filters?.endTime) {
      logs = logs.filter((log) => new Date(log.timestamp) <= filters.endTime!);
    }
    if (filters?.limit) {
      logs = logs.slice(-filters.limit);
    }

    return logs;
  }
}

/**
 * RBAC Manager - Main service class
 */
export class RbacManager {
  private storage: RbacStorage;
  private options: Required<RbacManagerOptions>;
  private initialized = false;

  constructor(options: RbacManagerOptions = {}) {
    this.options = {
      enableAuditing: options.enableAuditing ?? process.env['NODE_ENV'] === 'production',
      defaultDeny: options.defaultDeny ?? true,
      maxAuditLogSize: options.maxAuditLogSize ?? 10000,
      storage: options.storage ?? new InMemoryRbacStorage(),
    };
    this.storage = this.options.storage;
  }

  /**
   * Initialize RBAC manager
   * Loads built-in roles and existing configuration
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    logger.info('Initializing RBAC manager');

    // Load built-in roles
    for (const [roleId, roleDefinition] of Object.entries(BUILT_IN_ROLES)) {
      const existing = await this.storage.getRoleDefinition(roleId);
      if (!existing) {
        await this.storage.saveRoleDefinition(roleDefinition);
        logger.info(`Loaded built-in role: ${roleId}`);
      }
    }

    this.initialized = true;
    logger.info('RBAC manager initialized', {
      builtInRoles: Object.keys(BUILT_IN_ROLES).length,
    });
  }

  // ============================================================================
  // ROLE MANAGEMENT
  // ============================================================================

  /**
   * Create a custom role
   */
  async createRole(role: Omit<RoleDefinition, 'createdAt' | 'updatedAt'>): Promise<RoleDefinition> {
    // Validate role doesn't already exist
    const existing = await this.storage.getRoleDefinition(role.roleId);
    if (existing) {
      throw new ValidationError(`Role ${role.roleId} already exists`, 'roleId', undefined, {
        roleId: role.roleId,
      });
    }

    // Cannot create built-in roles
    if (role.builtIn) {
      throw new ValidationError('Cannot create built-in roles', 'builtIn');
    }

    const now = new Date().toISOString();
    const fullRole: RoleDefinition = {
      ...role,
      createdAt: now,
      updatedAt: now,
    };

    // Validate with schema
    RoleDefinitionSchema.parse(fullRole);

    await this.storage.saveRoleDefinition(fullRole);
    logger.info(`Created custom role: ${role.roleId}`);

    return fullRole;
  }

  /**
   * Update a custom role
   */
  async updateRole(
    roleId: string,
    updates: Partial<Omit<RoleDefinition, 'roleId' | 'builtIn' | 'createdAt'>>
  ): Promise<RoleDefinition> {
    const existing = await this.storage.getRoleDefinition(roleId);
    if (!existing) {
      throw new NotFoundError('role', roleId);
    }

    // Cannot update built-in roles
    if (existing.builtIn) {
      throw new ValidationError(`Cannot update built-in role: ${roleId}`, 'roleId', undefined, {
        roleId,
      });
    }

    const updated: RoleDefinition = {
      ...existing,
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    // Validate with schema
    RoleDefinitionSchema.parse(updated);

    await this.storage.saveRoleDefinition(updated);
    logger.info(`Updated role: ${roleId}`);

    return updated;
  }

  /**
   * Delete a custom role
   */
  async deleteRole(roleId: string): Promise<void> {
    const existing = await this.storage.getRoleDefinition(roleId);
    if (!existing) {
      throw new NotFoundError('role', roleId);
    }

    // Cannot delete built-in roles
    if (existing.builtIn) {
      throw new ValidationError(`Cannot delete built-in role: ${roleId}`, 'roleId', undefined, {
        roleId,
      });
    }

    await this.storage.deleteRoleDefinition(roleId);
    logger.info(`Deleted role: ${roleId}`);
  }

  /**
   * Get role definition
   */
  async getRole(roleId: string): Promise<RoleDefinition | null> {
    return this.storage.getRoleDefinition(roleId);
  }

  /**
   * List all roles
   */
  async listRoles(): Promise<RoleDefinition[]> {
    return this.storage.listRoleDefinitions();
  }

  // ============================================================================
  // USER ROLE ASSIGNMENT
  // ============================================================================

  /**
   * Assign roles to a user
   */
  async assignRoles(
    userId: string,
    roles: string[],
    assignedBy?: string,
    expiresAt?: Date
  ): Promise<UserRoleAssignment> {
    // Validate all roles exist
    for (const roleId of roles) {
      const role = await this.storage.getRoleDefinition(roleId);
      if (!role) {
        throw new NotFoundError('role', roleId);
      }
    }

    const assignment: UserRoleAssignment = {
      userId,
      roles,
      assignedAt: new Date().toISOString(),
      assignedBy,
      expiresAt: expiresAt?.toISOString(),
    };

    // Validate with schema
    UserRoleAssignmentSchema.parse(assignment);

    await this.storage.saveUserRoleAssignment(assignment);
    logger.info(`Assigned roles to user: ${userId}`, { roles });

    return assignment;
  }

  /**
   * Get user roles
   */
  async getUserRoles(userId: string): Promise<string[]> {
    const assignment = await this.storage.getUserRoleAssignment(userId);
    if (!assignment) {
      return [];
    }

    // Check expiration
    if (assignment.expiresAt && new Date(assignment.expiresAt) < new Date()) {
      logger.warn(`User ${userId} role assignment expired`);
      return [];
    }

    return assignment.roles;
  }

  /**
   * Revoke user roles
   */
  async revokeUserRoles(userId: string): Promise<void> {
    await this.storage.deleteUserRoleAssignment(userId);
    logger.info(`Revoked roles for user: ${userId}`);
  }

  // ============================================================================
  // API KEY MANAGEMENT
  // ============================================================================

  /**
   * Create API key with scoped permissions
   */
  async createApiKey(options: {
    name: string;
    roles?: string[];
    allowedTools?: string[];
    allowedActions?: string[];
    allowedResources?: string[];
    rateLimit?: { requestsPerMinute: number; requestsPerHour: number };
    createdBy: string;
    expiresAt?: Date;
  }): Promise<{ apiKey: string; apiKeyScope: ApiKeyScope }> {
    // Generate random API key (32 bytes = 64 hex chars)
    const apiKey = createHash('sha256')
      .update(Math.random().toString() + Date.now().toString())
      .digest('hex');

    // Hash API key for storage (security best practice)
    const keyHash = createHash('sha256').update(apiKey).digest('hex');

    const apiKeyId = `key_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

    const scope: ApiKeyScope = {
      apiKeyId,
      keyHash,
      name: options.name,
      roles: options.roles ?? [],
      allowedTools: options.allowedTools ?? [],
      allowedActions: options.allowedActions ?? [],
      allowedResources: options.allowedResources ?? [],
      rateLimit: options.rateLimit,
      createdAt: new Date().toISOString(),
      createdBy: options.createdBy,
      expiresAt: options.expiresAt?.toISOString(),
      enabled: true,
      usageCount: 0,
    };

    // Validate with schema
    ApiKeyScopeSchema.parse(scope);

    await this.storage.saveApiKeyScope(scope);
    logger.info(`Created API key: ${apiKeyId}`, { name: options.name });

    // Return plaintext API key (only time it's visible)
    return { apiKey, apiKeyScope: scope };
  }

  /**
   * Validate API key and get scope
   */
  async validateApiKey(apiKey: string): Promise<ApiKeyScope | null> {
    const keyHash = createHash('sha256').update(apiKey).digest('hex');

    // Find matching API key by hash
    const allKeys = await this.storage.listApiKeyScopes();
    const scope = allKeys.find((k) => k.keyHash === keyHash);

    if (!scope) {
      return null;
    }

    // Check enabled
    if (!scope.enabled) {
      logger.warn(`API key disabled: ${scope.apiKeyId}`);
      return null;
    }

    // Check expiration
    if (scope.expiresAt && new Date(scope.expiresAt) < new Date()) {
      logger.warn(`API key expired: ${scope.apiKeyId}`);
      return null;
    }

    // Update last used
    scope.lastUsedAt = new Date().toISOString();
    scope.usageCount += 1;
    await this.storage.saveApiKeyScope(scope);

    return scope;
  }

  /**
   * Revoke API key
   */
  async revokeApiKey(apiKeyId: string): Promise<void> {
    await this.storage.deleteApiKeyScope(apiKeyId);
    logger.info(`Revoked API key: ${apiKeyId}`);
  }

  /**
   * List API keys (without revealing keys)
   */
  async listApiKeys(): Promise<Omit<ApiKeyScope, 'keyHash'>[]> {
    const keys = await this.storage.listApiKeyScopes();
    return keys.map(({ keyHash: _keyHash, ...rest }) => rest);
  }

  // ============================================================================
  // PERMISSION CHECKING
  // ============================================================================

  /**
   * Check if user has permission for an operation
   */
  async checkPermission(request: PermissionCheckRequest): Promise<PermissionCheckResult> {
    const { userId, toolName, actionName, resourceId } = request;

    // Get user roles
    const userRoles = await this.getUserRoles(userId);

    // Collect all permissions from roles (with inheritance)
    const allPermissions = await this.collectPermissions(userRoles);

    // Check permissions in order: tool > action > resource (reverse of specificity)
    // More specific permissions override less specific ones
    // Explicit deny always overrides allow at any level
    const matchedRules: Array<{
      ruleType: 'tool' | 'action' | 'resource' | 'role';
      ruleName: string;
      permission: PermissionLevel;
    }> = [];

    let finalPermission: PermissionLevel = this.options.defaultDeny ? 'deny' : 'allow';
    let reason = this.options.defaultDeny ? 'Default deny policy' : 'Default allow policy';
    let hasDeny = false;

    // 1. Check tool-level permissions first (least specific)
    if (allPermissions.toolPermissions.length > 0) {
      const toolPerm = allPermissions.toolPermissions.find(
        (p) => (p.toolName === toolName || p.toolName === '*') && p.permission !== 'inherit'
      );
      if (toolPerm) {
        finalPermission = toolPerm.permission;
        reason = toolPerm.reason || `Tool permission: ${toolPerm.permission}`;
        hasDeny = toolPerm.permission === 'deny';
        matchedRules.push({
          ruleType: 'tool',
          ruleName: toolPerm.toolName,
          permission: toolPerm.permission,
        });
      }
    }

    // 2. Check action-level permissions (more specific, overrides tool)
    if (actionName && allPermissions.actionPermissions.length > 0) {
      const actionPerm = allPermissions.actionPermissions.find(
        (p) => p.toolName === toolName && p.actionName === actionName && p.permission !== 'inherit'
      );
      if (actionPerm) {
        // Only override if not already denied, or if this is also a deny
        if (!hasDeny || actionPerm.permission === 'deny') {
          finalPermission = actionPerm.permission;
          reason = actionPerm.reason || `Action permission: ${actionPerm.permission}`;
          hasDeny = actionPerm.permission === 'deny';
          matchedRules.push({
            ruleType: 'action',
            ruleName: `${toolName}.${actionName}`,
            permission: actionPerm.permission,
          });
        }
      }
    }

    // 3. Check resource-level permissions (most specific, highest priority)
    if (resourceId && allPermissions.resourcePermissions.length > 0) {
      const resourcePerm = allPermissions.resourcePermissions.find(
        (p) =>
          (p.resourceId === resourceId || p.resourceType === 'all') && p.permission !== 'inherit'
      );
      if (resourcePerm) {
        // Resource-level always wins
        finalPermission = resourcePerm.permission;
        reason = resourcePerm.reason || `Resource permission: ${resourcePerm.permission}`;
        hasDeny = resourcePerm.permission === 'deny';
        matchedRules.push({
          ruleType: 'resource',
          ruleName: resourcePerm.resourceId || resourcePerm.resourceType,
          permission: resourcePerm.permission,
        });
      }
    }

    const allowed = finalPermission === 'allow';

    const result: PermissionCheckResult = {
      allowed,
      permission: finalPermission,
      reason,
      matchedRules,
      suggestedActions: allowed
        ? undefined
        : [
            'Contact administrator to request access',
            `Required role: editor or higher for ${toolName}`,
            'Check your current roles with sheets_auth action="status"',
          ],
    };

    // Validate result
    PermissionCheckResultSchema.parse(result);

    // Audit log
    if (this.options.enableAuditing) {
      await this.auditPermissionCheck(userId, request, result);
    }

    logger.debug(
      `Permission check: ${userId} -> ${toolName}${actionName ? `.${actionName}` : ''}`,
      {
        allowed,
        reason,
      }
    );

    return result;
  }

  /**
   * Collect all permissions from roles (with inheritance)
   */
  private async collectPermissions(roleIds: string[]): Promise<{
    toolPermissions: ToolPermission[];
    actionPermissions: ActionPermission[];
    resourcePermissions: ResourcePermission[];
  }> {
    const visited = new Set<string>();
    const toolPermissions: ToolPermission[] = [];
    const actionPermissions: ActionPermission[] = [];
    const resourcePermissions: ResourcePermission[] = [];

    const processRole = async (roleId: string): Promise<void> => {
      if (visited.has(roleId)) {
        return; // Avoid cycles
      }
      visited.add(roleId);

      const role = await this.storage.getRoleDefinition(roleId);
      if (!role) {
        logger.warn(`Role not found: ${roleId}`);
        return;
      }

      // Add role's permissions
      toolPermissions.push(...role.toolPermissions);
      actionPermissions.push(...role.actionPermissions);
      resourcePermissions.push(...role.resourcePermissions);

      // Process inherited roles recursively
      for (const inheritedRoleId of role.inheritsFrom) {
        await processRole(inheritedRoleId);
      }
    };

    // Process all assigned roles
    for (const roleId of roleIds) {
      await processRole(roleId);
    }

    return { toolPermissions, actionPermissions, resourcePermissions };
  }

  // ============================================================================
  // AUDIT LOGGING
  // ============================================================================

  /**
   * Audit a permission check
   */
  private async auditPermissionCheck(
    userId: string,
    request: PermissionCheckRequest,
    result: PermissionCheckResult
  ): Promise<void> {
    const log: PermissionAuditLog = {
      id: `audit_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      timestamp: new Date().toISOString(),
      userId,
      operation: 'check',
      toolName: request.toolName,
      actionName: request.actionName,
      resourceId: request.resourceId,
      permission: result.permission,
      allowed: result.allowed,
      reason: result.reason,
      metadata: {
        matchedRules: result.matchedRules,
      },
    };

    await this.storage.saveAuditLog(log);
  }

  /**
   * Get audit logs
   */
  async getAuditLogs(filters?: {
    userId?: string;
    startTime?: Date;
    endTime?: Date;
    limit?: number;
  }): Promise<PermissionAuditLog[]> {
    return this.storage.getAuditLogs(filters);
  }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

let rbacManagerInstance: RbacManager | null = null;

/**
 * Get RBAC manager singleton instance
 */
export function getRbacManager(): RbacManager {
  if (!rbacManagerInstance) {
    rbacManagerInstance = new RbacManager();
  }
  return rbacManagerInstance;
}

/**
 * Initialize RBAC manager (call at startup)
 */
export async function initializeRbacManager(options?: RbacManagerOptions): Promise<RbacManager> {
  rbacManagerInstance = new RbacManager(options);
  await rbacManagerInstance.initialize();
  return rbacManagerInstance;
}
