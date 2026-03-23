/**
 * Tenant Isolation Tests
 *
 * Comprehensive security tests for multi-tenancy implementation.
 * Verifies zero data leakage between tenants.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  TenantContextService,
  TenantStorage,
  TenantMetadata,
  TenantQuotaExceededError,
} from '../../src/services/tenant-context.js';

describe('Tenant Isolation', () => {
  let service: TenantContextService;
  const originalIsolation = process.env['ENABLE_TENANT_ISOLATION'];
  const originalUnmappedOverride = process.env['TENANT_ALLOW_UNMAPPED_SPREADSHEET_ACCESS'];

  beforeEach(() => {
    service = new TenantContextService();
  });

  afterEach(() => {
    if (originalIsolation === undefined) {
      delete process.env['ENABLE_TENANT_ISOLATION'];
    } else {
      process.env['ENABLE_TENANT_ISOLATION'] = originalIsolation;
    }

    if (originalUnmappedOverride === undefined) {
      delete process.env['TENANT_ALLOW_UNMAPPED_SPREADSHEET_ACCESS'];
    } else {
      process.env['TENANT_ALLOW_UNMAPPED_SPREADSHEET_ACCESS'] = originalUnmappedOverride;
    }
  });

  describe('Tenant Creation', () => {
    it('should create tenant with unique ID and API key', async () => {
      const result = await service.createTenant('Test Tenant');

      expect(result.metadata.tenantId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-/);
      expect(result.apiKey).toMatch(/^sk_[A-Za-z0-9_-]{43}$/);
      expect(result.metadata.name).toBe('Test Tenant');
      expect(result.metadata.status).toBe('active');
    });

    it('should create multiple tenants with unique IDs', async () => {
      const tenant1 = await service.createTenant('Tenant 1');
      const tenant2 = await service.createTenant('Tenant 2');

      expect(tenant1.metadata.tenantId).not.toBe(tenant2.metadata.tenantId);
      expect(tenant1.apiKey).not.toBe(tenant2.apiKey);
    });

    it('should apply custom settings to tenant', async () => {
      const result = await service.createTenant('Test Tenant', {
        maxSpreadsheets: 100,
        maxApiCallsPerHour: 1000,
        enabledFeatures: ['advanced', 'bigquery'],
      });

      expect(result.metadata.settings.maxSpreadsheets).toBe(100);
      expect(result.metadata.settings.maxApiCallsPerHour).toBe(1000);
      expect(result.metadata.settings.enabledFeatures).toEqual(['advanced', 'bigquery']);
    });
  });

  describe('Tenant Context Extraction', () => {
    it('should extract valid tenant context from API key', async () => {
      const { apiKey, metadata } = await service.createTenant('Test Tenant');

      const context = await service.extractTenantContext(apiKey);

      expect(context).not.toBeNull();
      expect(context!.tenantId).toBe(metadata.tenantId);
      expect(context!.apiKey).toBe(apiKey);
      expect(context!.metadata.name).toBe('Test Tenant');
    });

    it('should return null for invalid API key', async () => {
      const context = await service.extractTenantContext('invalid_key');
      expect(context).toBeNull();
    });

    it('should return null for suspended tenant', async () => {
      const { apiKey, metadata } = await service.createTenant('Test Tenant');

      // Suspend tenant
      await service.updateTenant(metadata.tenantId, { status: 'suspended' });

      const context = await service.extractTenantContext(apiKey);
      expect(context).toBeNull();
    });

    it('should return null for deleted tenant', async () => {
      const { apiKey, metadata } = await service.createTenant('Test Tenant');

      // Delete tenant
      await service.deleteTenant(metadata.tenantId);

      const context = await service.extractTenantContext(apiKey);
      expect(context).toBeNull();
    });
  });

  describe('Data Isolation - API Key Mapping', () => {
    it('should isolate API keys between tenants', async () => {
      const tenant1 = await service.createTenant('Tenant 1');
      const tenant2 = await service.createTenant('Tenant 2');

      const context1 = await service.extractTenantContext(tenant1.apiKey);
      const context2 = await service.extractTenantContext(tenant2.apiKey);

      expect(context1!.tenantId).toBe(tenant1.metadata.tenantId);
      expect(context2!.tenantId).toBe(tenant2.metadata.tenantId);
      expect(context1!.tenantId).not.toBe(context2!.tenantId);
    });

    it('should not allow cross-tenant API key access', async () => {
      const tenant1 = await service.createTenant('Tenant 1');
      const tenant2 = await service.createTenant('Tenant 2');

      // Attempt to use tenant1's API key to access tenant2
      const context = await service.extractTenantContext(tenant1.apiKey);
      expect(context!.tenantId).toBe(tenant1.metadata.tenantId);
      expect(context!.tenantId).not.toBe(tenant2.metadata.tenantId);
    });
  });

  describe('Tenant Management', () => {
    it('should update tenant metadata', async () => {
      const { metadata } = await service.createTenant('Test Tenant');

      // Wait 1ms to ensure updatedAt is different
      await new Promise((resolve) => setTimeout(resolve, 1));

      const updated = await service.updateTenant(metadata.tenantId, {
        name: 'Updated Name',
        settings: { maxSpreadsheets: 200 },
      });

      expect(updated.name).toBe('Updated Name');
      expect(updated.settings.maxSpreadsheets).toBe(200);
      expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(metadata.updatedAt.getTime());
    });

    it('should list tenants with pagination', async () => {
      await service.createTenant('Tenant 1');
      await service.createTenant('Tenant 2');
      await service.createTenant('Tenant 3');

      const page1 = await service.listTenants({ offset: 0, limit: 2 });
      const page2 = await service.listTenants({ offset: 2, limit: 2 });

      expect(page1).toHaveLength(2);
      expect(page2).toHaveLength(1);
    });

    it('should get tenant by ID', async () => {
      const { metadata } = await service.createTenant('Test Tenant');

      const retrieved = await service.getTenant(metadata.tenantId);

      expect(retrieved).not.toBeNull();
      expect(retrieved!.tenantId).toBe(metadata.tenantId);
      expect(retrieved!.name).toBe('Test Tenant');
    });

    it('should return null for non-existent tenant', async () => {
      const retrieved = await service.getTenant('00000000-0000-0000-0000-000000000000');
      expect(retrieved).toBeNull();
    });
  });

  describe('API Key Rotation', () => {
    it('should rotate API key and revoke old key', async () => {
      const { apiKey: oldApiKey, metadata } = await service.createTenant('Test Tenant');

      // Rotate API key
      const newApiKey = await service.rotateApiKey(metadata.tenantId);

      // Old key should not work
      const oldContext = await service.extractTenantContext(oldApiKey);
      expect(oldContext).toBeNull();

      // New key should work
      const newContext = await service.extractTenantContext(newApiKey);
      expect(newContext).not.toBeNull();
      expect(newContext!.tenantId).toBe(metadata.tenantId);
    });

    it('should generate new unique API key on rotation', async () => {
      const { apiKey: key1, metadata } = await service.createTenant('Test Tenant');
      const key2 = await service.rotateApiKey(metadata.tenantId);
      const key3 = await service.rotateApiKey(metadata.tenantId);

      expect(key1).not.toBe(key2);
      expect(key2).not.toBe(key3);
    });
  });

  describe('Tenant Deletion', () => {
    it('should soft delete tenant', async () => {
      const { metadata } = await service.createTenant('Test Tenant');

      await service.deleteTenant(metadata.tenantId);

      const retrieved = await service.getTenant(metadata.tenantId);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.status).toBe('deleted');
    });

    it('should revoke API keys on tenant deletion', async () => {
      const { apiKey, metadata } = await service.createTenant('Test Tenant');

      await service.deleteTenant(metadata.tenantId);

      const context = await service.extractTenantContext(apiKey);
      expect(context).toBeNull();
    });
  });

  describe('Security - Data Leakage Prevention', () => {
    it('should never expose tenant data to wrong API key', async () => {
      const tenant1 = await service.createTenant('Tenant 1', {
        maxSpreadsheets: 100,
      });
      const tenant2 = await service.createTenant('Tenant 2', {
        maxSpreadsheets: 200,
      });

      // Use tenant1's API key
      const context1 = await service.extractTenantContext(tenant1.apiKey);

      // Should get tenant1's settings, not tenant2's
      expect(context1!.metadata.settings.maxSpreadsheets).toBe(100);
      expect(context1!.metadata.settings.maxSpreadsheets).not.toBe(200);
    });

    it('should isolate tenant metadata between tenants', async () => {
      const tenant1 = await service.createTenant('Tenant 1');
      const tenant2 = await service.createTenant('Tenant 2');

      // Update tenant1
      await service.updateTenant(tenant1.metadata.tenantId, {
        settings: { maxSpreadsheets: 500 },
      });

      // Verify tenant2 is unaffected
      const tenant2Retrieved = await service.getTenant(tenant2.metadata.tenantId);
      expect(tenant2Retrieved!.settings.maxSpreadsheets).toBeUndefined();
    });

    it('should not allow API key guessing', async () => {
      // Create legitimate tenant
      await service.createTenant('Legitimate Tenant');

      // Attempt to guess API keys
      const guesses = [
        'sk_' + 'A'.repeat(43),
        'sk_' + '0'.repeat(43),
        'sk_invalid',
        'invalid_format',
      ];

      for (const guess of guesses) {
        const context = await service.extractTenantContext(guess);
        expect(context).toBeNull();
      }
    });
  });

  describe('Quota Management', () => {
    it('should initialize quota from tenant settings', async () => {
      const { apiKey } = await service.createTenant('Test Tenant', {
        maxApiCallsPerHour: 1000,
        maxConcurrentRequests: 10,
      });

      const context = await service.extractTenantContext(apiKey);

      expect(context!.quotaRemaining.hourly).toBe(1000);
      expect(context!.quotaRemaining.concurrent).toBe(10);
    });

    it('should use Infinity for unlimited quota', async () => {
      const { apiKey } = await service.createTenant('Test Tenant');

      const context = await service.extractTenantContext(apiKey);

      expect(context!.quotaRemaining.hourly).toBe(Infinity);
      expect(context!.quotaRemaining.concurrent).toBe(Infinity);
    });

    it('should decrement remaining hourly quota after recorded API calls', async () => {
      const { apiKey, metadata } = await service.createTenant('Test Tenant', {
        maxApiCallsPerHour: 2,
      });

      const before = await service.extractTenantContext(apiKey);
      expect(before!.quotaRemaining.hourly).toBe(2);

      await service.recordApiCall(metadata.tenantId);

      const after = await service.extractTenantContext(apiKey);
      expect(after!.quotaRemaining.hourly).toBe(1);
    });

    it('should throw when hourly quota is exceeded', async () => {
      const { metadata } = await service.createTenant('Test Tenant', {
        maxApiCallsPerHour: 1,
      });

      await service.recordApiCall(metadata.tenantId);

      await expect(service.recordApiCall(metadata.tenantId)).rejects.toBeInstanceOf(
        TenantQuotaExceededError
      );
    });
  });

  describe('Spreadsheet Access Isolation', () => {
    it('denies unknown spreadsheet mappings when tenant isolation is enabled', async () => {
      process.env['ENABLE_TENANT_ISOLATION'] = 'true';
      delete process.env['TENANT_ALLOW_UNMAPPED_SPREADSHEET_ACCESS'];

      const { metadata } = await service.createTenant('Tenant A');
      const allowed = await service.validateSpreadsheetAccess(metadata.tenantId, 'sheet-unmapped');

      expect(allowed).toBe(false);
    });

    it('allows mapped spreadsheets and denies cross-tenant spreadsheet access', async () => {
      process.env['ENABLE_TENANT_ISOLATION'] = 'true';
      delete process.env['TENANT_ALLOW_UNMAPPED_SPREADSHEET_ACCESS'];

      const tenantA = await service.createTenant('Tenant A');
      const tenantB = await service.createTenant('Tenant B');
      service.grantSpreadsheetAccess(tenantA.metadata.tenantId, 'sheet-a');
      service.grantSpreadsheetAccess(tenantB.metadata.tenantId, 'sheet-b');

      await expect(
        service.validateSpreadsheetAccess(tenantA.metadata.tenantId, 'sheet-a')
      ).resolves.toBe(true);
      await expect(
        service.validateSpreadsheetAccess(tenantA.metadata.tenantId, 'sheet-b')
      ).resolves.toBe(false);
    });

    it('supports explicit permissive override for unmapped spreadsheets', async () => {
      process.env['ENABLE_TENANT_ISOLATION'] = 'true';
      process.env['TENANT_ALLOW_UNMAPPED_SPREADSHEET_ACCESS'] = 'true';

      const { metadata } = await service.createTenant('Tenant A');
      const allowed = await service.validateSpreadsheetAccess(metadata.tenantId, 'sheet-unmapped');

      expect(allowed).toBe(true);
    });
  });

  describe('Custom Tenant Storage', () => {
    it('should support custom storage implementation', async () => {
      const customStorage: TenantStorage = {
        async get(tenantId: string) {
          return {
            tenantId,
            name: 'Custom Storage Tenant',
            createdAt: new Date(),
            updatedAt: new Date(),
            status: 'active',
            settings: {},
          };
        },
        async create(metadata) {
          return {
            ...metadata,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
        },
        async update(tenantId, updates) {
          return {
            tenantId,
            name: 'Updated',
            createdAt: new Date(),
            updatedAt: new Date(),
            status: 'active',
            settings: {},
            ...updates,
          } as TenantMetadata;
        },
        async delete() {},
        async list() {
          return [];
        },
      };

      const customService = new TenantContextService(customStorage);
      const tenant = await customService.getTenant('test-id');

      expect(tenant).not.toBeNull();
      expect(tenant!.name).toBe('Custom Storage Tenant');
    });
  });
});
