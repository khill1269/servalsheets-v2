/**
 * Tenant Context Service
 *
 * Provides tenant isolation and context management for multi-tenant deployments.
 * Ensures complete data isolation between tenants with row-level security.
 */

import { z } from 'zod';
import { logger } from '../utils/logger.js';
import { NotFoundError } from '../core/errors.js';

const ONE_HOUR_MS = 60 * 60 * 1000;

/**
 * Tenant metadata schema
 */
export const TenantMetadataSchema = z.object({
  tenantId: z.string().uuid(),
  name: z.string().min(1).max(255),
  createdAt: z.date(),
  updatedAt: z.date(),
  status: z.enum(['active', 'suspended', 'deleted']),
  settings: z.object({
    maxSpreadsheets: z.number().int().positive().optional(),
    maxApiCallsPerHour: z.number().int().positive().optional(),
    maxConcurrentRequests: z.number().int().positive().optional(),
    enabledFeatures: z.array(z.string()).optional(),
    customDomain: z.string().optional(),
  }),
  billingInfo: z
    .object({
      plan: z.enum(['free', 'starter', 'professional', 'enterprise']),
      billingEmail: z.string().email().optional(),
      subscriptionEndsAt: z.date().optional(),
    })
    .optional(),
});

export type TenantMetadata = z.infer<typeof TenantMetadataSchema>;

/**
 * Tenant context for request processing
 */
export interface TenantContext {
  tenantId: string;
  metadata: TenantMetadata;
  apiKey: string;
  quotaRemaining: {
    hourly: number;
    concurrent: number;
  };
}

export class TenantQuotaExceededError extends Error {
  constructor(
    public readonly tenantId: string,
    public readonly limit: number
  ) {
    super(`Hourly API quota exceeded for tenant ${tenantId}`);
    this.name = 'TenantQuotaExceededError';
  }
}

/**
 * Tenant storage interface (implement with your database)
 */
export interface TenantStorage {
  get(tenantId: string): Promise<TenantMetadata | null>;
  create(metadata: Omit<TenantMetadata, 'createdAt' | 'updatedAt'>): Promise<TenantMetadata>;
  update(tenantId: string, updates: Partial<TenantMetadata>): Promise<TenantMetadata>;
  delete(tenantId: string): Promise<void>;
  list(options?: { offset?: number; limit?: number }): Promise<TenantMetadata[]>;
}

/**
 * In-memory tenant storage (for development/testing)
 */
class InMemoryTenantStorage implements TenantStorage {
  private tenants: Map<string, TenantMetadata> = new Map();

  async get(tenantId: string): Promise<TenantMetadata | null> {
    return this.tenants.get(tenantId) || null;
  }

  async create(metadata: Omit<TenantMetadata, 'createdAt' | 'updatedAt'>): Promise<TenantMetadata> {
    const now = new Date();
    const tenant: TenantMetadata = {
      ...metadata,
      createdAt: now,
      updatedAt: now,
    };
    this.tenants.set(tenant.tenantId, tenant);
    return tenant;
  }

  async update(tenantId: string, updates: Partial<TenantMetadata>): Promise<TenantMetadata> {
    const existing = this.tenants.get(tenantId);
    if (!existing) {
      throw new NotFoundError('tenant', tenantId);
    }
    const updated: TenantMetadata = {
      ...existing,
      ...updates,
      updatedAt: new Date(),
    };
    this.tenants.set(tenantId, updated);
    return updated;
  }

  async delete(tenantId: string): Promise<void> {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) {
      throw new NotFoundError('tenant', tenantId);
    }
    // Soft delete - mark as deleted
    await this.update(tenantId, { status: 'deleted' });
  }

  async list(options?: { offset?: number; limit?: number }): Promise<TenantMetadata[]> {
    const allTenants = Array.from(this.tenants.values());
    const offset = options?.offset || 0;
    const limit = options?.limit || 100;
    return allTenants.slice(offset, offset + limit);
  }
}

/**
 * Tenant Context Service
 *
 * Manages tenant context, isolation, and metadata.
 */
export class TenantContextService {
  private storage: TenantStorage;
  private apiKeyMap: Map<string, string> = new Map(); // apiKey -> tenantId
  private hourlyUsage: Map<string, { windowStartMs: number; count: number }> = new Map();
  private spreadsheetAccessMap: Map<string, Set<string>> = new Map(); // tenantId -> spreadsheetIds

  constructor(storage?: TenantStorage) {
    this.storage = storage || new InMemoryTenantStorage();
  }

  /**
   * Extract tenant context from request
   *
   * @param apiKey API key from Authorization header
   * @returns Tenant context or null if invalid
   */
  async extractTenantContext(apiKey: string): Promise<TenantContext | null> {
    // Lookup tenant by API key
    const tenantId = this.apiKeyMap.get(apiKey);
    if (!tenantId) {
      logger.warn('Invalid API key', { apiKey: apiKey.substring(0, 8) + '...' });
      return null;
    }

    // Get tenant metadata
    const metadata = await this.storage.get(tenantId);
    if (!metadata) {
      logger.error('Tenant metadata not found', { tenantId });
      return null;
    }

    // Check tenant status
    if (metadata.status !== 'active') {
      logger.warn('Tenant not active', { tenantId, status: metadata.status });
      return null;
    }

    // Return tenant context
    const currentHourlyUsage = this.getCurrentHourlyUsage(tenantId);
    const configuredHourlyLimit = metadata.settings.maxApiCallsPerHour ?? Infinity;

    return {
      tenantId,
      metadata,
      apiKey,
      quotaRemaining: {
        hourly: Math.max(0, configuredHourlyLimit - currentHourlyUsage),
        concurrent: metadata.settings.maxConcurrentRequests || Infinity,
      },
    };
  }

  /**
   * Create new tenant
   *
   * @param name Tenant name
   * @param settings Tenant settings
   * @returns Tenant metadata and API key
   */
  async createTenant(
    name: string,
    settings?: TenantMetadata['settings']
  ): Promise<{ metadata: TenantMetadata; apiKey: string }> {
    const tenantId = crypto.randomUUID();
    const apiKey = this.generateApiKey();

    const metadata = await this.storage.create({
      tenantId,
      name,
      status: 'active',
      settings: settings || {},
    });

    // Register API key
    this.apiKeyMap.set(apiKey, tenantId);

    logger.info('Tenant created', { tenantId, name });

    return { metadata, apiKey };
  }

  /**
   * Update tenant
   *
   * @param tenantId Tenant ID
   * @param updates Updates to apply
   * @returns Updated tenant metadata
   */
  async updateTenant(
    tenantId: string,
    updates: Partial<Omit<TenantMetadata, 'tenantId' | 'createdAt' | 'updatedAt'>>
  ): Promise<TenantMetadata> {
    const metadata = await this.storage.update(tenantId, updates);
    logger.info('Tenant updated', { tenantId, updates });
    return metadata;
  }

  /**
   * Delete tenant (soft delete)
   *
   * @param tenantId Tenant ID
   */
  async deleteTenant(tenantId: string): Promise<void> {
    await this.storage.delete(tenantId);

    // Revoke API keys
    for (const [apiKey, tid] of this.apiKeyMap.entries()) {
      if (tid === tenantId) {
        this.apiKeyMap.delete(apiKey);
      }
    }
    this.spreadsheetAccessMap.delete(tenantId);

    logger.info('Tenant deleted', { tenantId });
  }

  /**
   * List tenants
   *
   * @param options Pagination options
   * @returns List of tenant metadata
   */
  async listTenants(options?: { offset?: number; limit?: number }): Promise<TenantMetadata[]> {
    return this.storage.list(options);
  }

  /**
   * Get tenant by ID
   *
   * @param tenantId Tenant ID
   * @returns Tenant metadata or null
   */
  async getTenant(tenantId: string): Promise<TenantMetadata | null> {
    return this.storage.get(tenantId);
  }

  /**
   * Generate API key for tenant
   */
  private generateApiKey(): string {
    // Generate secure random API key
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return 'sk_' + Buffer.from(bytes).toString('base64url');
  }

  /**
   * Rotate API key for tenant
   *
   * @param tenantId Tenant ID
   * @returns New API key
   */
  async rotateApiKey(tenantId: string): Promise<string> {
    // Revoke old API keys
    for (const [apiKey, tid] of this.apiKeyMap.entries()) {
      if (tid === tenantId) {
        this.apiKeyMap.delete(apiKey);
      }
    }

    // Generate new API key
    const newApiKey = this.generateApiKey();
    this.apiKeyMap.set(newApiKey, tenantId);

    logger.info('API key rotated', { tenantId });
    return newApiKey;
  }

  /**
   * Validate tenant has access to spreadsheet
   *
   * Validates row-level security for tenant spreadsheet access.
   * Override with database-level checks for production use.
   *
   * @param tenantId Tenant ID
   * @param spreadsheetId Spreadsheet ID
   * @returns True if tenant has access
   */
  async validateSpreadsheetAccess(tenantId: string, spreadsheetId: string): Promise<boolean> {
    const isolationEnabled = process.env['ENABLE_TENANT_ISOLATION'] === 'true';
    const allowUnmapped =
      process.env['TENANT_ALLOW_UNMAPPED_SPREADSHEET_ACCESS'] === undefined
        ? !isolationEnabled
        : process.env['TENANT_ALLOW_UNMAPPED_SPREADSHEET_ACCESS'] === 'true';

    if (!isolationEnabled) {
      logger.debug('Tenant isolation disabled, allowing spreadsheet access', {
        tenantId,
        spreadsheetId,
      });
      return true;
    }

    const allowedSheets = this.spreadsheetAccessMap.get(tenantId);
    if (!allowedSheets || allowedSheets.size === 0) {
      logger.debug('Tenant has no explicit spreadsheet mapping', {
        tenantId,
        spreadsheetId,
        allowUnmapped,
      });
      return allowUnmapped;
    }

    const hasAccess = allowedSheets.has(spreadsheetId);
    logger.debug('Validated spreadsheet access against tenant mapping', {
      tenantId,
      spreadsheetId,
      hasAccess,
      mappedCount: allowedSheets.size,
    });
    return hasAccess;
  }

  /**
   * Grant tenant access to a spreadsheet.
   *
   * Intended for admin provisioning flows and tests.
   */
  grantSpreadsheetAccess(tenantId: string, spreadsheetId: string): void {
    let set = this.spreadsheetAccessMap.get(tenantId);
    if (!set) {
      set = new Set<string>();
      this.spreadsheetAccessMap.set(tenantId, set);
    }
    set.add(spreadsheetId);
  }

  /**
   * Revoke tenant access to a spreadsheet.
   */
  revokeSpreadsheetAccess(tenantId: string, spreadsheetId: string): void {
    const set = this.spreadsheetAccessMap.get(tenantId);
    if (!set) return;
    set.delete(spreadsheetId);
    if (set.size === 0) {
      this.spreadsheetAccessMap.delete(tenantId);
    }
  }

  /**
   * Replace the full spreadsheet allowlist for a tenant.
   */
  setSpreadsheetAccess(tenantId: string, spreadsheetIds: string[]): void {
    this.spreadsheetAccessMap.set(tenantId, new Set(spreadsheetIds));
  }

  /**
   * Record API call for quota tracking
   *
   * @param tenantId Tenant ID
   */
  async recordApiCall(tenantId: string): Promise<void> {
    const tenant = await this.storage.get(tenantId);
    if (!tenant || tenant.status !== 'active') {
      logger.warn('Cannot record API call for inactive tenant', { tenantId });
      return;
    }

    const hourlyLimit = tenant.settings.maxApiCallsPerHour;
    const usage = this.getOrCreateHourlyUsageCounter(tenantId);

    if (hourlyLimit !== undefined && usage.count >= hourlyLimit) {
      logger.warn('Tenant hourly API quota exceeded', {
        tenantId,
        limit: hourlyLimit,
        usage: usage.count,
      });
      throw new TenantQuotaExceededError(tenantId, hourlyLimit);
    }

    usage.count += 1;
    logger.debug('API call recorded', {
      tenantId,
      usage: usage.count,
      hourlyLimit: hourlyLimit ?? 'unlimited',
    });
  }

  private getCurrentHourlyUsage(tenantId: string): number {
    const usage = this.getOrCreateHourlyUsageCounter(tenantId);
    return usage.count;
  }

  private getOrCreateHourlyUsageCounter(tenantId: string): {
    windowStartMs: number;
    count: number;
  } {
    const now = Date.now();
    const existing = this.hourlyUsage.get(tenantId);
    if (!existing || now - existing.windowStartMs >= ONE_HOUR_MS) {
      const resetCounter = { windowStartMs: now, count: 0 };
      this.hourlyUsage.set(tenantId, resetCounter);
      return resetCounter;
    }
    return existing;
  }
}

/**
 * Global tenant context service instance
 */
export const tenantContextService = new TenantContextService();
