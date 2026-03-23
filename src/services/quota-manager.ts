/**
 * Quota Manager Service
 *
 * Provides per-tenant quota tracking and enforcement for multi-tenant deployments.
 * Tracks usage across different operations (read, write, admin) with time-window support.
 *
 * Features:
 * - Per-tenant quota limits (e.g., 10,000 reads/day, 1,000 writes/day)
 * - Per-operation tracking (read vs write vs admin)
 * - Time-window support (hourly, daily, monthly)
 * - Redis-backed storage for distributed deployments
 * - Automatic quota resets at window boundaries
 *
 * Usage:
 * ```typescript
 * const quotaManager = new QuotaManager(redis);
 *
 * // Check quota before operation
 * if (!await quotaManager.checkQuota(tenantId, 'read')) {
 *   throw new QuotaExceededError('Daily read quota exceeded');
 * }
 *
 * // Record usage after successful operation
 * await quotaManager.recordUsage(tenantId, 'read');
 * ```
 */

import { type Redis } from 'ioredis';
import { logger } from '../utils/logger.js';
import { quotaThresholdAlertsTotal, recordQuotaUtilization } from '../observability/metrics.js';

/**
 * Supported time windows for quota tracking
 */
export type QuotaWindow = 'hourly' | 'daily' | 'monthly';

/**
 * Operation types for quota tracking
 */
export type OperationType = 'read' | 'write' | 'admin';

/**
 * Quota limits configuration
 */
export interface QuotaLimits {
  /** Read operations quota (e.g., get_sheet, read_range) */
  read: {
    hourly?: number;
    daily?: number;
    monthly?: number;
  };
  /** Write operations quota (e.g., write_range, update_sheet) */
  write: {
    hourly?: number;
    daily?: number;
    monthly?: number;
  };
  /** Admin operations quota (e.g., create_spreadsheet, delete_sheet) */
  admin: {
    hourly?: number;
    daily?: number;
    monthly?: number;
  };
}

/**
 * Default quota limits (conservative defaults)
 */
const DEFAULT_QUOTA_LIMITS: QuotaLimits = {
  read: {
    hourly: 1000,
    daily: 10000,
    monthly: 300000,
  },
  write: {
    hourly: 100,
    daily: 1000,
    monthly: 30000,
  },
  admin: {
    hourly: 20,
    daily: 100,
    monthly: 3000,
  },
};

/**
 * Usage statistics for a tenant
 */
export interface UsageStats {
  /** Tenant ID */
  tenantId: string;
  /** Current period usage by operation type */
  current: {
    read: {
      hourly: number;
      daily: number;
      monthly: number;
    };
    write: {
      hourly: number;
      daily: number;
      monthly: number;
    };
    admin: {
      hourly: number;
      daily: number;
      monthly: number;
    };
  };
  /** Configured limits by operation type */
  limits: QuotaLimits;
  /** Percentage of quota used by operation type */
  percentUsed: {
    read: {
      hourly: number;
      daily: number;
      monthly: number;
    };
    write: {
      hourly: number;
      daily: number;
      monthly: number;
    };
    admin: {
      hourly: number;
      daily: number;
      monthly: number;
    };
  };
  /** Next reset times (ISO 8601) */
  nextReset: {
    hourly: string;
    daily: string;
    monthly: string;
  };
}

/**
 * Quota Manager - Per-tenant quota tracking and enforcement
 */
export class QuotaManager {
  constructor(private readonly redis: Redis) {}

  /**
   * Check if tenant has quota remaining for operation
   *
   * @param tenantId - Tenant identifier
   * @param operation - Operation type (read, write, admin)
   * @returns true if quota available, false if exceeded
   */
  async checkQuota(tenantId: string, operation: OperationType): Promise<boolean> {
    try {
      // Get current usage and limits
      const limits = await this.getQuotaLimits(tenantId);
      const usage = await this.getCurrentUsage(tenantId, operation);

      // Check each time window
      const hourlyLimit = limits[operation].hourly;
      const dailyLimit = limits[operation].daily;
      const monthlyLimit = limits[operation].monthly;

      // QUOTA-01: Helper to emit threshold alerts at 80%/95% and update gauge
      const checkThresholds = (
        usageCount: number,
        limit: number,
        window: 'hourly' | 'daily' | 'monthly'
      ): void => {
        const ratio = usageCount / limit;
        const pct = ratio * 100;
        recordQuotaUtilization(pct, { tenantId, operation, window });
        if (ratio >= 0.95) {
          logger.warn('Quota threshold reached: 95%', {
            tenantId,
            operation,
            window,
            usage: usageCount,
            limit,
          });
          quotaThresholdAlertsTotal.inc({ tenantId, operation, window, threshold: '95' });
        } else if (ratio >= 0.8) {
          logger.warn('Quota threshold reached: 80%', {
            tenantId,
            operation,
            window,
            usage: usageCount,
            limit,
          });
          quotaThresholdAlertsTotal.inc({ tenantId, operation, window, threshold: '80' });
        }
      };

      // Quota exceeded if any window is over limit
      if (hourlyLimit && usage.hourly >= hourlyLimit) {
        logger.warn('Hourly quota exceeded', {
          tenantId,
          operation,
          usage: usage.hourly,
          limit: hourlyLimit,
        });
        return false;
      }
      if (hourlyLimit && usage.hourly > 0) {
        checkThresholds(usage.hourly, hourlyLimit, 'hourly');
      }

      if (dailyLimit && usage.daily >= dailyLimit) {
        logger.warn('Daily quota exceeded', {
          tenantId,
          operation,
          usage: usage.daily,
          limit: dailyLimit,
        });
        return false;
      }
      if (dailyLimit && usage.daily > 0) {
        checkThresholds(usage.daily, dailyLimit, 'daily');
      }

      if (monthlyLimit && usage.monthly >= monthlyLimit) {
        logger.warn('Monthly quota exceeded', {
          tenantId,
          operation,
          usage: usage.monthly,
          limit: monthlyLimit,
        });
        return false;
      }
      if (monthlyLimit && usage.monthly > 0) {
        checkThresholds(usage.monthly, monthlyLimit, 'monthly');
      }

      return true;
    } catch (error) {
      logger.error('Failed to check quota', { tenantId, operation, error });
      // Fail open - allow operation if quota check fails
      return true;
    }
  }

  /**
   * Record usage for an operation
   *
   * Increments usage counters in all time windows.
   * Uses Redis INCR for atomic increments.
   *
   * @param tenantId - Tenant identifier
   * @param operation - Operation type (read, write, admin)
   */
  async recordUsage(tenantId: string, operation: OperationType): Promise<void> {
    try {
      const now = Date.now();

      // Generate keys for all time windows
      const hourKey = this.getUsageKey(tenantId, operation, 'hourly', now);
      const dayKey = this.getUsageKey(tenantId, operation, 'daily', now);
      const monthKey = this.getUsageKey(tenantId, operation, 'monthly', now);

      // Calculate TTLs (time until next window boundary)
      const hourTTL = this.getWindowTTL('hourly', now);
      const dayTTL = this.getWindowTTL('daily', now);
      const monthTTL = this.getWindowTTL('monthly', now);

      // Atomic increment with TTL (pipeline for efficiency)
      const pipeline = this.redis.pipeline();
      pipeline.incr(hourKey);
      pipeline.expire(hourKey, hourTTL);
      pipeline.incr(dayKey);
      pipeline.expire(dayKey, dayTTL);
      pipeline.incr(monthKey);
      pipeline.expire(monthKey, monthTTL);

      await pipeline.exec();

      logger.debug('Recorded usage', { tenantId, operation });
    } catch (error) {
      logger.error('Failed to record usage', { tenantId, operation, error });
      // Non-blocking - don't fail the operation if usage recording fails
    }
  }

  /**
   * Get current usage for tenant and operation
   *
   * @param tenantId - Tenant identifier
   * @param operation - Operation type (read, write, admin)
   * @returns Usage counts for all time windows
   */
  async getCurrentUsage(
    tenantId: string,
    operation: OperationType
  ): Promise<{ hourly: number; daily: number; monthly: number }> {
    try {
      const now = Date.now();

      const hourKey = this.getUsageKey(tenantId, operation, 'hourly', now);
      const dayKey = this.getUsageKey(tenantId, operation, 'daily', now);
      const monthKey = this.getUsageKey(tenantId, operation, 'monthly', now);

      // Get all counters in parallel
      const [hourlyStr, dailyStr, monthlyStr] = await Promise.all([
        this.redis.get(hourKey),
        this.redis.get(dayKey),
        this.redis.get(monthKey),
      ]);

      return {
        hourly: Number.parseInt(hourlyStr ?? '0', 10),
        daily: Number.parseInt(dailyStr ?? '0', 10),
        monthly: Number.parseInt(monthlyStr ?? '0', 10),
      };
    } catch (error) {
      logger.error('Failed to get current usage', { tenantId, operation, error });
      return { hourly: 0, daily: 0, monthly: 0 };
    }
  }

  /**
   * Get comprehensive usage statistics for tenant
   *
   * @param tenantId - Tenant identifier
   * @returns Complete usage stats with limits and percentages
   */
  async getUsageStats(tenantId: string): Promise<UsageStats> {
    try {
      const limits = await this.getQuotaLimits(tenantId);

      // Get usage for all operation types
      const [readUsage, writeUsage, adminUsage] = await Promise.all([
        this.getCurrentUsage(tenantId, 'read'),
        this.getCurrentUsage(tenantId, 'write'),
        this.getCurrentUsage(tenantId, 'admin'),
      ]);

      // Calculate percentage used
      const percentUsed = {
        read: {
          hourly: limits.read.hourly
            ? Math.round((readUsage.hourly / limits.read.hourly) * 100)
            : 0,
          daily: limits.read.daily ? Math.round((readUsage.daily / limits.read.daily) * 100) : 0,
          monthly: limits.read.monthly
            ? Math.round((readUsage.monthly / limits.read.monthly) * 100)
            : 0,
        },
        write: {
          hourly: limits.write.hourly
            ? Math.round((writeUsage.hourly / limits.write.hourly) * 100)
            : 0,
          daily: limits.write.daily ? Math.round((writeUsage.daily / limits.write.daily) * 100) : 0,
          monthly: limits.write.monthly
            ? Math.round((writeUsage.monthly / limits.write.monthly) * 100)
            : 0,
        },
        admin: {
          hourly: limits.admin.hourly
            ? Math.round((adminUsage.hourly / limits.admin.hourly) * 100)
            : 0,
          daily: limits.admin.daily ? Math.round((adminUsage.daily / limits.admin.daily) * 100) : 0,
          monthly: limits.admin.monthly
            ? Math.round((adminUsage.monthly / limits.admin.monthly) * 100)
            : 0,
        },
      };

      // Calculate next reset times
      const now = Date.now();
      const nextReset = {
        hourly: new Date(this.getNextWindowBoundary('hourly', now)).toISOString(),
        daily: new Date(this.getNextWindowBoundary('daily', now)).toISOString(),
        monthly: new Date(this.getNextWindowBoundary('monthly', now)).toISOString(),
      };

      return {
        tenantId,
        current: {
          read: readUsage,
          write: writeUsage,
          admin: adminUsage,
        },
        limits,
        percentUsed,
        nextReset,
      };
    } catch (error) {
      logger.error('Failed to get usage stats', { tenantId, error });
      throw error;
    }
  }

  /**
   * Reset quotas for tenant and period
   *
   * @param tenantId - Tenant identifier
   * @param period - Time window to reset (hourly, daily, monthly, or 'all')
   */
  async resetQuotas(tenantId: string, period: QuotaWindow | 'all'): Promise<void> {
    try {
      const now = Date.now();
      const operations: OperationType[] = ['read', 'write', 'admin'];
      const windows: QuotaWindow[] = period === 'all' ? ['hourly', 'daily', 'monthly'] : [period];

      const keys: string[] = [];
      for (const operation of operations) {
        for (const window of windows) {
          keys.push(this.getUsageKey(tenantId, operation, window, now));
        }
      }

      // Delete all keys atomically
      if (keys.length > 0) {
        await this.redis.del(...keys);
      }

      logger.info('Reset quotas', { tenantId, period, keysDeleted: keys.length });
    } catch (error) {
      logger.error('Failed to reset quotas', { tenantId, period, error });
      throw error;
    }
  }

  /**
   * Set quota limits for tenant
   *
   * @param tenantId - Tenant identifier
   * @param limits - Quota limits configuration
   */
  async setQuotaLimits(tenantId: string, limits: Partial<QuotaLimits>): Promise<void> {
    try {
      const key = this.getLimitsKey(tenantId);
      await this.redis.set(key, JSON.stringify(limits));
      logger.info('Set quota limits', { tenantId, limits });
    } catch (error) {
      logger.error('Failed to set quota limits', { tenantId, error });
      throw error;
    }
  }

  /**
   * Get quota limits for tenant
   *
   * Returns configured limits or defaults if not set.
   *
   * @param tenantId - Tenant identifier
   * @returns Quota limits configuration
   */
  async getQuotaLimits(tenantId: string): Promise<QuotaLimits> {
    try {
      const key = this.getLimitsKey(tenantId);
      const limitsStr = await this.redis.get(key);

      if (!limitsStr) {
        return DEFAULT_QUOTA_LIMITS;
      }

      const customLimits = JSON.parse(limitsStr) as Partial<QuotaLimits>;

      // Merge with defaults (custom limits take precedence)
      return {
        read: { ...DEFAULT_QUOTA_LIMITS.read, ...customLimits.read },
        write: { ...DEFAULT_QUOTA_LIMITS.write, ...customLimits.write },
        admin: { ...DEFAULT_QUOTA_LIMITS.admin, ...customLimits.admin },
      };
    } catch (error) {
      logger.error('Failed to get quota limits', { tenantId, error });
      return DEFAULT_QUOTA_LIMITS;
    }
  }

  /**
   * Generate Redis key for usage counter
   *
   * Key format: quota:{tenantId}:{operation}:{window}:{timestamp}
   * Example: quota:tenant-123:read:daily:2026-02-17
   *
   * @param tenantId - Tenant identifier
   * @param operation - Operation type
   * @param window - Time window
   * @param timestamp - Current timestamp (ms)
   * @returns Redis key
   */
  private getUsageKey(
    tenantId: string,
    operation: OperationType,
    window: QuotaWindow,
    timestamp: number
  ): string {
    const date = new Date(timestamp);

    let windowSuffix: string;
    if (window === 'hourly') {
      // Format: YYYY-MM-DD-HH
      windowSuffix = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}-${String(date.getUTCHours()).padStart(2, '0')}`;
    } else if (window === 'daily') {
      // Format: YYYY-MM-DD
      windowSuffix = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
    } else {
      // monthly: Format: YYYY-MM
      windowSuffix = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
    }

    return `quota:${tenantId}:${operation}:${window}:${windowSuffix}`;
  }

  /**
   * Generate Redis key for tenant limits configuration
   *
   * Key format: quota:{tenantId}:limits
   *
   * @param tenantId - Tenant identifier
   * @returns Redis key
   */
  private getLimitsKey(tenantId: string): string {
    return `quota:${tenantId}:limits`;
  }

  /**
   * Calculate TTL (seconds) until next window boundary
   *
   * @param window - Time window
   * @param timestamp - Current timestamp (ms)
   * @returns TTL in seconds
   */
  private getWindowTTL(window: QuotaWindow, timestamp: number): number {
    const nextBoundary = this.getNextWindowBoundary(window, timestamp);
    return Math.ceil((nextBoundary - timestamp) / 1000);
  }

  /**
   * Get timestamp of next window boundary
   *
   * @param window - Time window
   * @param timestamp - Current timestamp (ms)
   * @returns Next boundary timestamp (ms)
   */
  private getNextWindowBoundary(window: QuotaWindow, timestamp: number): number {
    const date = new Date(timestamp);

    if (window === 'hourly') {
      // Next hour boundary
      date.setUTCMinutes(0, 0, 0);
      date.setUTCHours(date.getUTCHours() + 1);
    } else if (window === 'daily') {
      // Next day boundary
      date.setUTCHours(0, 0, 0, 0);
      date.setUTCDate(date.getUTCDate() + 1);
    } else {
      // monthly: Next month boundary
      date.setUTCHours(0, 0, 0, 0);
      date.setUTCDate(1);
      date.setUTCMonth(date.getUTCMonth() + 1);
    }

    return date.getTime();
  }
}
