/**
 * Tests for RBAC (Role-Based Access Control)
 *
 * Comprehensive tests for role management, permission checking,
 * and access control enforcement.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RbacManager, type RbacManagerOptions } from '../../src/services/rbac-manager.js';
import type { RoleDefinition, UserRoleAssignment, ApiKeyScope } from '../../src/schemas/rbac.js';

// Mock logger
vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('RBAC Manager', () => {
  let rbacManager: RbacManager;

  beforeEach(async () => {
    rbacManager = new RbacManager({ enableAuditing: true });
    await rbacManager.initialize();
  });

  // ============================================================================
  // INITIALIZATION TESTS
  // ============================================================================

  describe('Initialization', () => {
    it('should load built-in roles', async () => {
      const roles = await rbacManager.listRoles();

      // Should have 5 built-in roles
      expect(roles.length).toBeGreaterThanOrEqual(5);

      const roleIds = roles.map((r) => r.roleId);
      expect(roleIds).toContain('admin');
      expect(roleIds).toContain('editor');
      expect(roleIds).toContain('viewer');
      expect(roleIds).toContain('analyst');
      expect(roleIds).toContain('collaborator');
    });

    it('should mark built-in roles correctly', async () => {
      const adminRole = await rbacManager.getRole('admin');
      expect(adminRole?.builtIn).toBe(true);

      const editorRole = await rbacManager.getRole('editor');
      expect(editorRole?.builtIn).toBe(true);
    });

    it('should initialize only once', async () => {
      await rbacManager.initialize();
      await rbacManager.initialize();

      const roles = await rbacManager.listRoles();
      // Should not duplicate roles
      expect(roles.length).toBe(5);
    });
  });

  // ============================================================================
  // ROLE MANAGEMENT TESTS
  // ============================================================================

  describe('Role Management', () => {
    it('should create custom role', async () => {
      const customRole: Omit<RoleDefinition, 'createdAt' | 'updatedAt'> = {
        roleId: 'custom_role',
        roleName: 'Custom Role',
        description: 'A custom test role',
        builtIn: false,
        toolPermissions: [{ toolName: 'sheets_data', permission: 'allow' }],
        actionPermissions: [],
        resourcePermissions: [],
        inheritsFrom: [],
      };

      const created = await rbacManager.createRole(customRole);

      expect(created.roleId).toBe('custom_role');
      expect(created.createdAt).toBeDefined();
      expect(created.updatedAt).toBeDefined();
    });

    it('should prevent duplicate role creation', async () => {
      const customRole: Omit<RoleDefinition, 'createdAt' | 'updatedAt'> = {
        roleId: 'duplicate_test',
        roleName: 'Duplicate Test',
        description: 'Test duplicate',
        builtIn: false,
        toolPermissions: [],
        actionPermissions: [],
        resourcePermissions: [],
        inheritsFrom: [],
      };

      await rbacManager.createRole(customRole);

      await expect(rbacManager.createRole(customRole)).rejects.toThrow(
        'Role duplicate_test already exists'
      );
    });

    it('should update custom role', async () => {
      const customRole: Omit<RoleDefinition, 'createdAt' | 'updatedAt'> = {
        roleId: 'update_test',
        roleName: 'Update Test',
        description: 'Original description',
        builtIn: false,
        toolPermissions: [],
        actionPermissions: [],
        resourcePermissions: [],
        inheritsFrom: [],
      };

      await rbacManager.createRole(customRole);

      const updated = await rbacManager.updateRole('update_test', {
        description: 'Updated description',
        toolPermissions: [{ toolName: 'sheets_data', permission: 'allow' }],
      });

      expect(updated.description).toBe('Updated description');
      expect(updated.toolPermissions.length).toBe(1);
    });

    it('should prevent updating built-in roles', async () => {
      await expect(
        rbacManager.updateRole('admin', {
          description: 'Modified admin',
        })
      ).rejects.toThrow('Cannot update built-in role');
    });

    it('should delete custom role', async () => {
      const customRole: Omit<RoleDefinition, 'createdAt' | 'updatedAt'> = {
        roleId: 'delete_test',
        roleName: 'Delete Test',
        description: 'Will be deleted',
        builtIn: false,
        toolPermissions: [],
        actionPermissions: [],
        resourcePermissions: [],
        inheritsFrom: [],
      };

      await rbacManager.createRole(customRole);
      await rbacManager.deleteRole('delete_test');

      const deleted = await rbacManager.getRole('delete_test');
      expect(deleted).toBeNull();
    });

    it('should prevent deleting built-in roles', async () => {
      await expect(rbacManager.deleteRole('admin')).rejects.toThrow('Cannot delete built-in role');
    });
  });

  // ============================================================================
  // USER ROLE ASSIGNMENT TESTS
  // ============================================================================

  describe('User Role Assignment', () => {
    it('should assign roles to user', async () => {
      const assignment = await rbacManager.assignRoles(
        'user@example.com',
        ['editor', 'analyst'],
        'admin@example.com'
      );

      expect(assignment.userId).toBe('user@example.com');
      expect(assignment.roles).toEqual(['editor', 'analyst']);
      expect(assignment.assignedBy).toBe('admin@example.com');
    });

    it('should get user roles', async () => {
      await rbacManager.assignRoles('user@example.com', ['viewer']);

      const roles = await rbacManager.getUserRoles('user@example.com');
      expect(roles).toEqual(['viewer']);
    });

    it('should return empty array for user with no roles', async () => {
      const roles = await rbacManager.getUserRoles('nonexistent@example.com');
      expect(roles).toEqual([]);
    });

    it('should handle role expiration', async () => {
      const expiresAt = new Date(Date.now() - 1000); // Expired 1 second ago

      await rbacManager.assignRoles(
        'expired@example.com',
        ['editor'],
        'admin@example.com',
        expiresAt
      );

      const roles = await rbacManager.getUserRoles('expired@example.com');
      expect(roles).toEqual([]); // Should return empty due to expiration
    });

    it('should revoke user roles', async () => {
      await rbacManager.assignRoles('user@example.com', ['editor']);
      await rbacManager.revokeUserRoles('user@example.com');

      const roles = await rbacManager.getUserRoles('user@example.com');
      expect(roles).toEqual([]);
    });

    it('should prevent assigning non-existent roles', async () => {
      await expect(
        rbacManager.assignRoles('user@example.com', ['nonexistent_role'])
      ).rejects.toThrow('role not found: nonexistent_role');
    });
  });

  // ============================================================================
  // API KEY MANAGEMENT TESTS
  // ============================================================================

  describe('API Key Management', () => {
    it('should create API key with scopes', async () => {
      const { apiKey, apiKeyScope } = await rbacManager.createApiKey({
        name: 'Test API Key',
        roles: ['viewer'],
        allowedTools: ['sheets_data', 'sheets_core'],
        createdBy: 'admin@example.com',
      });

      expect(apiKey).toBeDefined();
      expect(apiKey.length).toBeGreaterThan(0);
      expect(apiKeyScope.name).toBe('Test API Key');
      expect(apiKeyScope.roles).toEqual(['viewer']);
      expect(apiKeyScope.allowedTools).toEqual(['sheets_data', 'sheets_core']);
    });

    it('should validate API key', async () => {
      const { apiKey, apiKeyScope } = await rbacManager.createApiKey({
        name: 'Validate Test',
        roles: ['editor'],
        createdBy: 'admin@example.com',
      });

      const validated = await rbacManager.validateApiKey(apiKey);
      expect(validated).toBeDefined();
      expect(validated?.apiKeyId).toBe(apiKeyScope.apiKeyId);
    });

    it('should reject invalid API key', async () => {
      const validated = await rbacManager.validateApiKey('invalid_key');
      expect(validated).toBeNull();
    });

    it('should reject disabled API key', async () => {
      const { apiKey, apiKeyScope } = await rbacManager.createApiKey({
        name: 'Disabled Test',
        roles: ['viewer'],
        createdBy: 'admin@example.com',
      });

      // Manually disable the key
      apiKeyScope.enabled = false;
      await rbacManager['storage'].saveApiKeyScope(apiKeyScope);

      const validated = await rbacManager.validateApiKey(apiKey);
      expect(validated).toBeNull();
    });

    it('should reject expired API key', async () => {
      const expiresAt = new Date(Date.now() - 1000); // Expired
      const { apiKey } = await rbacManager.createApiKey({
        name: 'Expired Test',
        roles: ['viewer'],
        createdBy: 'admin@example.com',
        expiresAt,
      });

      const validated = await rbacManager.validateApiKey(apiKey);
      expect(validated).toBeNull();
    });

    it('should revoke API key', async () => {
      const { apiKey, apiKeyScope } = await rbacManager.createApiKey({
        name: 'Revoke Test',
        roles: ['viewer'],
        createdBy: 'admin@example.com',
      });

      await rbacManager.revokeApiKey(apiKeyScope.apiKeyId);

      const validated = await rbacManager.validateApiKey(apiKey);
      expect(validated).toBeNull();
    });

    it('should list API keys without exposing hashes', async () => {
      await rbacManager.createApiKey({
        name: 'List Test 1',
        roles: ['viewer'],
        createdBy: 'admin@example.com',
      });

      await rbacManager.createApiKey({
        name: 'List Test 2',
        roles: ['editor'],
        createdBy: 'admin@example.com',
      });

      const keys = await rbacManager.listApiKeys();
      expect(keys.length).toBeGreaterThanOrEqual(2);
      keys.forEach((key) => {
        expect(key).not.toHaveProperty('keyHash');
      });
    });
  });

  // ============================================================================
  // PERMISSION CHECKING TESTS
  // ============================================================================

  describe('Permission Checking', () => {
    it('should allow admin full access', async () => {
      await rbacManager.assignRoles('admin@example.com', ['admin']);

      const result = await rbacManager.checkPermission({
        userId: 'admin@example.com',
        toolName: 'sheets_data',
        actionName: 'write_range',
      });

      expect(result.allowed).toBe(true);
      expect(result.permission).toBe('allow');
    });

    it('should allow editor to write data', async () => {
      await rbacManager.assignRoles('editor@example.com', ['editor']);

      const result = await rbacManager.checkPermission({
        userId: 'editor@example.com',
        toolName: 'sheets_data',
        actionName: 'write_range',
      });

      expect(result.allowed).toBe(true);
    });

    it('should deny editor from sharing', async () => {
      await rbacManager.assignRoles('editor@example.com', ['editor']);

      const result = await rbacManager.checkPermission({
        userId: 'editor@example.com',
        toolName: 'sheets_collaborate',
        actionName: 'share_add',
      });

      expect(result.allowed).toBe(false);
      expect(result.permission).toBe('deny');
    });

    it('should allow viewer to read data', async () => {
      await rbacManager.assignRoles('viewer@example.com', ['viewer']);

      const result = await rbacManager.checkPermission({
        userId: 'viewer@example.com',
        toolName: 'sheets_data',
        actionName: 'read_range',
      });

      expect(result.allowed).toBe(true);
    });

    it('should deny viewer from writing data', async () => {
      await rbacManager.assignRoles('viewer@example.com', ['viewer']);

      const result = await rbacManager.checkPermission({
        userId: 'viewer@example.com',
        toolName: 'sheets_data',
        actionName: 'write_range',
      });

      expect(result.allowed).toBe(false);
    });

    it('should handle role inheritance', async () => {
      await rbacManager.assignRoles('analyst@example.com', ['analyst']);

      // Analyst inherits from viewer, should be able to read
      const result = await rbacManager.checkPermission({
        userId: 'analyst@example.com',
        toolName: 'sheets_data',
        actionName: 'read_range',
      });

      expect(result.allowed).toBe(true);
    });

    it('should handle multiple roles', async () => {
      await rbacManager.assignRoles('multi@example.com', ['viewer', 'editor']);

      // Should have editor permissions (more permissive)
      const writeResult = await rbacManager.checkPermission({
        userId: 'multi@example.com',
        toolName: 'sheets_data',
        actionName: 'write_range',
      });

      expect(writeResult.allowed).toBe(true);
    });

    it('should default to deny for unknown users', async () => {
      const result = await rbacManager.checkPermission({
        userId: 'unknown@example.com',
        toolName: 'sheets_data',
        actionName: 'write_range',
      });

      expect(result.allowed).toBe(false);
    });

    it('should return matched rules in result', async () => {
      await rbacManager.assignRoles('user@example.com', ['admin']);

      const result = await rbacManager.checkPermission({
        userId: 'user@example.com',
        toolName: 'sheets_data',
      });

      expect(result.matchedRules).toBeDefined();
      expect(result.matchedRules.length).toBeGreaterThan(0);
    });
  });

  // ============================================================================
  // AUDIT LOGGING TESTS
  // ============================================================================

  describe('Audit Logging', () => {
    it('should create audit logs for permission checks', async () => {
      await rbacManager.assignRoles('audit@example.com', ['viewer']);

      await rbacManager.checkPermission({
        userId: 'audit@example.com',
        toolName: 'sheets_data',
        actionName: 'read_range',
      });

      const logs = await rbacManager.getAuditLogs({
        userId: 'audit@example.com',
      });

      expect(logs.length).toBeGreaterThan(0);
      expect(logs[0]?.operation).toBe('check');
      expect(logs[0]?.toolName).toBe('sheets_data');
    });

    it('should filter audit logs by user', async () => {
      await rbacManager.assignRoles('user1@example.com', ['viewer']);
      await rbacManager.assignRoles('user2@example.com', ['editor']);

      await rbacManager.checkPermission({
        userId: 'user1@example.com',
        toolName: 'sheets_data',
      });

      await rbacManager.checkPermission({
        userId: 'user2@example.com',
        toolName: 'sheets_data',
      });

      const user1Logs = await rbacManager.getAuditLogs({
        userId: 'user1@example.com',
      });

      expect(user1Logs.every((log) => log.userId === 'user1@example.com')).toBe(true);
    });

    it('should filter audit logs by time range', async () => {
      await rbacManager.assignRoles('time@example.com', ['viewer']);

      const startTime = new Date();

      await rbacManager.checkPermission({
        userId: 'time@example.com',
        toolName: 'sheets_data',
      });

      const endTime = new Date();

      const logs = await rbacManager.getAuditLogs({
        userId: 'time@example.com',
        startTime,
        endTime,
      });

      expect(logs.length).toBeGreaterThan(0);
    });

    it('should limit audit log results', async () => {
      await rbacManager.assignRoles('limit@example.com', ['viewer']);

      // Create multiple permission checks
      for (let i = 0; i < 10; i++) {
        await rbacManager.checkPermission({
          userId: 'limit@example.com',
          toolName: 'sheets_data',
        });
      }

      const logs = await rbacManager.getAuditLogs({
        userId: 'limit@example.com',
        limit: 5,
      });

      expect(logs.length).toBeLessThanOrEqual(5);
    });
  });

  // ============================================================================
  // EDGE CASES AND ERROR HANDLING
  // ============================================================================

  describe('Edge Cases', () => {
    it('should handle circular role inheritance gracefully', async () => {
      // This shouldn't happen with proper validation, but test defense
      const role1: Omit<RoleDefinition, 'createdAt' | 'updatedAt'> = {
        roleId: 'circular1',
        roleName: 'Circular 1',
        description: 'Test circular',
        builtIn: false,
        toolPermissions: [],
        actionPermissions: [],
        resourcePermissions: [],
        inheritsFrom: ['circular2'],
      };

      const role2: Omit<RoleDefinition, 'createdAt' | 'updatedAt'> = {
        roleId: 'circular2',
        roleName: 'Circular 2',
        description: 'Test circular',
        builtIn: false,
        toolPermissions: [],
        actionPermissions: [],
        resourcePermissions: [],
        inheritsFrom: ['circular1'],
      };

      await rbacManager.createRole(role1);
      await rbacManager.createRole(role2);

      await rbacManager.assignRoles('circular@example.com', ['circular1']);

      // Should not hang or crash
      const result = await rbacManager.checkPermission({
        userId: 'circular@example.com',
        toolName: 'sheets_data',
      });

      expect(result).toBeDefined();
    });

    it('should handle empty permission arrays', async () => {
      const emptyRole: Omit<RoleDefinition, 'createdAt' | 'updatedAt'> = {
        roleId: 'empty_perms',
        roleName: 'Empty Permissions',
        description: 'Role with no permissions',
        builtIn: false,
        toolPermissions: [],
        actionPermissions: [],
        resourcePermissions: [],
        inheritsFrom: [],
      };

      await rbacManager.createRole(emptyRole);
      await rbacManager.assignRoles('empty@example.com', ['empty_perms']);

      const result = await rbacManager.checkPermission({
        userId: 'empty@example.com',
        toolName: 'sheets_data',
      });

      expect(result.allowed).toBe(false); // Default deny
    });

    it('should handle wildcard tool permissions', async () => {
      await rbacManager.assignRoles('admin@example.com', ['admin']);

      const result = await rbacManager.checkPermission({
        userId: 'admin@example.com',
        toolName: 'any_tool',
      });

      expect(result.allowed).toBe(true); // Admin has * permission
    });
  });
});
