/**
 * Cost Tracker Service
 *
 * Per-tenant cost tracking and attribution for SaaS billing
 * Tracks API calls, storage, user seats, and feature usage
 *
 * @category Billing
 * @usage Track costs per tenant for billing integration
 */

import { EventEmitter } from 'events';
import { logger } from '../utils/logger.js';
import { ValidationError } from '../core/errors.js';

// ============================================================================
// Types & Interfaces
// ============================================================================

export interface CostModel {
  /** Cost per Google API request (USD) */
  apiRequestCost: number;
  /** Cost per GB storage per month (USD) */
  storageGbCost: number;
  /** Cost per user seat per month (USD) */
  userSeatCost: number;
  /** Cost per 1000 rows processed */
  rowProcessingCost: number;
  /** Cost per formula execution */
  formulaExecutionCost: number;
  /** Cost per webhook delivery */
  webhookDeliveryCost: number;
}

export interface TenantUsage {
  tenantId: string;
  apiCalls: {
    sheets: number;
    drive: number;
    bigquery: number;
    total: number;
  };
  storage: {
    bytes: number;
    gb: number;
  };
  users: {
    activeSeats: number;
    totalSeats: number;
  };
  features: {
    rowsProcessed: number;
    formulasExecuted: number;
    webhooksDelivered: number;
    transactionsExecuted: number;
  };
  period: {
    startDate: Date;
    endDate: Date;
  };
}

export interface CostBreakdown {
  tenantId: string;
  period: {
    startDate: Date;
    endDate: Date;
  };
  costs: {
    apiCalls: number;
    storage: number;
    userSeats: number;
    features: number;
    subtotal: number;
    discounts: number;
    total: number;
  };
  usage: TenantUsage;
  tier: PricingTier;
}

export interface PricingTier {
  name: 'free' | 'starter' | 'professional' | 'enterprise';
  limits: {
    apiCallsPerMonth: number;
    storageGb: number;
    userSeats: number;
    features: {
      transactions: boolean;
      webhooks: boolean;
      bigquery: boolean;
      appsscript: boolean;
    };
  };
  pricing: CostModel;
  discountPercent: number;
}

export interface CostAlert {
  tenantId: string;
  type: 'budget_exceeded' | 'budget_warning' | 'limit_approaching' | 'tier_upgrade_suggested';
  message: string;
  currentCost: number;
  budgetLimit?: number;
  timestamp: Date;
}

// ============================================================================
// Pricing Tiers
// ============================================================================

const PRICING_TIERS: Record<string, PricingTier> = {
  free: {
    name: 'free',
    limits: {
      apiCallsPerMonth: 1000,
      storageGb: 1,
      userSeats: 1,
      features: {
        transactions: false,
        webhooks: false,
        bigquery: false,
        appsscript: false,
      },
    },
    pricing: {
      apiRequestCost: 0,
      storageGbCost: 0,
      userSeatCost: 0,
      rowProcessingCost: 0,
      formulaExecutionCost: 0,
      webhookDeliveryCost: 0,
    },
    discountPercent: 0,
  },
  starter: {
    name: 'starter',
    limits: {
      apiCallsPerMonth: 10000,
      storageGb: 10,
      userSeats: 5,
      features: {
        transactions: true,
        webhooks: false,
        bigquery: false,
        appsscript: false,
      },
    },
    pricing: {
      apiRequestCost: 0.0001, // $0.10 per 1000 requests
      storageGbCost: 0.5, // $0.50 per GB/month
      userSeatCost: 10, // $10 per user/month
      rowProcessingCost: 0.001, // $1.00 per 1M rows
      formulaExecutionCost: 0.00001, // $0.01 per 1000 formulas
      webhookDeliveryCost: 0.001, // $1.00 per 1000 webhooks
    },
    discountPercent: 0,
  },
  professional: {
    name: 'professional',
    limits: {
      apiCallsPerMonth: 100000,
      storageGb: 100,
      userSeats: 25,
      features: {
        transactions: true,
        webhooks: true,
        bigquery: true,
        appsscript: false,
      },
    },
    pricing: {
      apiRequestCost: 0.00008, // 20% discount
      storageGbCost: 0.4,
      userSeatCost: 8,
      rowProcessingCost: 0.0008,
      formulaExecutionCost: 0.000008,
      webhookDeliveryCost: 0.0008,
    },
    discountPercent: 20,
  },
  enterprise: {
    name: 'enterprise',
    limits: {
      apiCallsPerMonth: -1, // unlimited
      storageGb: -1, // unlimited
      userSeats: -1, // unlimited
      features: {
        transactions: true,
        webhooks: true,
        bigquery: true,
        appsscript: true,
      },
    },
    pricing: {
      apiRequestCost: 0.00005, // 50% discount
      storageGbCost: 0.25,
      userSeatCost: 5,
      rowProcessingCost: 0.0005,
      formulaExecutionCost: 0.000005,
      webhookDeliveryCost: 0.0005,
    },
    discountPercent: 50,
  },
};

// ============================================================================
// Cost Tracker Service
// ============================================================================

export class CostTracker extends EventEmitter {
  private usage: Map<string, TenantUsage> = new Map();
  private tenantTiers: Map<string, string> = new Map();
  private tenantBudgets: Map<string, number> = new Map();
  private alertThresholds = {
    warning: 0.8, // 80% of budget
    critical: 0.95, // 95% of budget
  };

  constructor() {
    super();
    this.startPeriodicReset();
  }

  // ==========================================================================
  // Tracking Methods
  // ==========================================================================

  /**
   * Track an API call
   */
  trackApiCall(tenantId: string, apiType: 'sheets' | 'drive' | 'bigquery'): void {
    const usage = this.getOrCreateUsage(tenantId);
    usage.apiCalls[apiType]++;
    usage.apiCalls.total++;
    this.checkAlerts(tenantId);
  }

  /**
   * Track storage usage
   */
  trackStorage(tenantId: string, bytes: number): void {
    const usage = this.getOrCreateUsage(tenantId);
    usage.storage.bytes = bytes;
    usage.storage.gb = bytes / (1024 * 1024 * 1024);
    this.checkAlerts(tenantId);
  }

  /**
   * Track user seat allocation
   */
  trackUserSeats(tenantId: string, activeSeats: number, totalSeats: number): void {
    const usage = this.getOrCreateUsage(tenantId);
    usage.users.activeSeats = activeSeats;
    usage.users.totalSeats = totalSeats;
  }

  /**
   * Track feature usage
   */
  trackFeatureUsage(
    tenantId: string,
    feature: keyof TenantUsage['features'],
    count: number = 1
  ): void {
    const usage = this.getOrCreateUsage(tenantId);
    usage.features[feature] += count;
    this.checkAlerts(tenantId);
  }

  // ==========================================================================
  // Cost Calculation
  // ==========================================================================

  /**
   * Calculate current cost for a tenant
   */
  calculateCost(tenantId: string): CostBreakdown {
    const usage = this.getOrCreateUsage(tenantId);
    const tier = this.getTier(tenantId);
    const pricing = tier.pricing;

    // Calculate individual costs
    const apiCallsCost = usage.apiCalls.total * pricing.apiRequestCost;
    const storageCost = usage.storage.gb * pricing.storageGbCost;
    const userSeatsCost = usage.users.totalSeats * pricing.userSeatCost;
    const featuresCost =
      usage.features.rowsProcessed * pricing.rowProcessingCost +
      usage.features.formulasExecuted * pricing.formulaExecutionCost +
      usage.features.webhooksDelivered * pricing.webhookDeliveryCost;

    const subtotal = apiCallsCost + storageCost + userSeatsCost + featuresCost;
    const discounts = subtotal * (tier.discountPercent / 100);
    const total = subtotal - discounts;

    return {
      tenantId,
      period: usage.period,
      costs: {
        apiCalls: apiCallsCost,
        storage: storageCost,
        userSeats: userSeatsCost,
        features: featuresCost,
        subtotal,
        discounts,
        total,
      },
      usage,
      tier,
    };
  }

  /**
   * Get cost forecast for rest of month
   */
  forecastCost(tenantId: string): { forecast: number; confidence: number } {
    const usage = this.getOrCreateUsage(tenantId);
    const currentCost = this.calculateCost(tenantId).costs.total;

    // Calculate days elapsed and remaining
    const now = new Date();
    const startDate = usage.period.startDate;
    const endDate = usage.period.endDate;
    const totalDays = (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24);
    const elapsedDays = (now.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24);
    const remainingDays = totalDays - elapsedDays;

    if (elapsedDays <= 0) {
      return { forecast: 0, confidence: 0 };
    }

    // Linear extrapolation
    const dailyRate = currentCost / elapsedDays;
    const forecast = currentCost + dailyRate * remainingDays;

    // Confidence decreases as we have less data
    const confidence = Math.min(elapsedDays / 7, 1); // Full confidence after 7 days

    return { forecast, confidence };
  }

  // ==========================================================================
  // Budget Management
  // ==========================================================================

  /**
   * Set budget limit for tenant
   */
  setBudget(tenantId: string, budgetLimit: number): void {
    this.tenantBudgets.set(tenantId, budgetLimit);
    this.checkAlerts(tenantId);
  }

  /**
   * Get budget status
   */
  getBudgetStatus(tenantId: string): {
    budget: number | null;
    current: number;
    remaining: number;
    percentUsed: number;
  } {
    const budget = this.tenantBudgets.get(tenantId) || null;
    const current = this.calculateCost(tenantId).costs.total;

    return {
      budget,
      current,
      remaining: budget ? Math.max(0, budget - current) : Infinity,
      percentUsed: budget ? (current / budget) * 100 : 0,
    };
  }

  // ==========================================================================
  // Tier Management
  // ==========================================================================

  /**
   * Set pricing tier for tenant
   */
  setTier(tenantId: string, tierName: keyof typeof PRICING_TIERS): void {
    if (!PRICING_TIERS[tierName]) {
      throw new ValidationError(`Invalid tier: ${tierName}`, 'tierName');
    }
    this.tenantTiers.set(tenantId, tierName);
  }

  /**
   * Get tier for tenant
   */
  getTier(tenantId: string): PricingTier {
    const tierName = this.tenantTiers.get(tenantId) || 'free';
    const tier = PRICING_TIERS[tierName];
    if (!tier) {
      throw new ValidationError(`Invalid tier: ${tierName}`, 'tierName');
    }
    return tier;
  }

  /**
   * Suggest tier upgrade if needed
   */
  suggestTierUpgrade(tenantId: string): PricingTier | null {
    const usage = this.getOrCreateUsage(tenantId);
    const currentTier = this.getTier(tenantId);

    // Check if usage exceeds current tier limits
    const exceedsApiCalls =
      currentTier.limits.apiCallsPerMonth > 0 &&
      usage.apiCalls.total > currentTier.limits.apiCallsPerMonth;
    const exceedsStorage =
      currentTier.limits.storageGb > 0 && usage.storage.gb > currentTier.limits.storageGb;
    const exceedsSeats =
      currentTier.limits.userSeats > 0 && usage.users.totalSeats > currentTier.limits.userSeats;

    if (exceedsApiCalls || exceedsStorage || exceedsSeats) {
      // Find next tier
      const tiers: Array<keyof typeof PRICING_TIERS> = [
        'free',
        'starter',
        'professional',
        'enterprise',
      ];
      const currentIndex = tiers.indexOf(currentTier.name);
      if (currentIndex >= 0 && currentIndex < tiers.length - 1) {
        const nextTierName = tiers[currentIndex + 1];
        if (nextTierName) {
          const nextTier = PRICING_TIERS[nextTierName];
          if (nextTier) {
            return nextTier;
          }
        }
      }
    }

    return null;
  }

  // ==========================================================================
  // Alerts
  // ==========================================================================

  /**
   * Check and emit alerts if needed
   */
  private checkAlerts(tenantId: string): void {
    const budgetStatus = this.getBudgetStatus(tenantId);
    const suggestedTier = this.suggestTierUpgrade(tenantId);

    // QUOTA-01: API quota approaching 80% of monthly limit
    const usage = this.getOrCreateUsage(tenantId);
    const tier = this.getTier(tenantId);
    if (tier.limits.apiCallsPerMonth > 0) {
      const pct = (usage.apiCalls.total / tier.limits.apiCallsPerMonth) * 100;
      if (pct >= this.alertThresholds.warning * 100) {
        this.emitAlert({
          tenantId,
          type: 'limit_approaching',
          message: `API calls at ${pct.toFixed(1)}% of monthly limit (${usage.apiCalls.total}/${tier.limits.apiCallsPerMonth})`,
          currentCost: budgetStatus.current,
          timestamp: new Date(),
        });
      }
    }

    // Budget alerts
    if (budgetStatus.budget && budgetStatus.percentUsed >= 100) {
      this.emitAlert({
        tenantId,
        type: 'budget_exceeded',
        message: `Budget exceeded: $${budgetStatus.current.toFixed(2)} / $${budgetStatus.budget.toFixed(2)}`,
        currentCost: budgetStatus.current,
        budgetLimit: budgetStatus.budget,
        timestamp: new Date(),
      });
    } else if (
      budgetStatus.budget &&
      budgetStatus.percentUsed >= this.alertThresholds.critical * 100
    ) {
      this.emitAlert({
        tenantId,
        type: 'budget_warning',
        message: `Budget critical: ${budgetStatus.percentUsed.toFixed(1)}% used`,
        currentCost: budgetStatus.current,
        budgetLimit: budgetStatus.budget,
        timestamp: new Date(),
      });
    }

    // Tier upgrade suggestion
    if (suggestedTier) {
      this.emitAlert({
        tenantId,
        type: 'tier_upgrade_suggested',
        message: `Consider upgrading to ${suggestedTier.name} tier`,
        currentCost: budgetStatus.current,
        timestamp: new Date(),
      });
    }
  }

  /**
   * Emit cost alert
   */
  private emitAlert(alert: CostAlert): void {
    this.emit('alert', alert);
    logger.warn('Cost alert', alert);
  }

  // ==========================================================================
  // Usage Management
  // ==========================================================================

  /**
   * Get or create usage record for tenant
   */
  private getOrCreateUsage(tenantId: string): TenantUsage {
    let usage = this.usage.get(tenantId);
    if (!usage) {
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);

      usage = {
        tenantId,
        apiCalls: { sheets: 0, drive: 0, bigquery: 0, total: 0 },
        storage: { bytes: 0, gb: 0 },
        users: { activeSeats: 0, totalSeats: 0 },
        features: {
          rowsProcessed: 0,
          formulasExecuted: 0,
          webhooksDelivered: 0,
          transactionsExecuted: 0,
        },
        period: {
          startDate: startOfMonth,
          endDate: endOfMonth,
        },
      };
      this.usage.set(tenantId, usage);
    }
    return usage;
  }

  /**
   * Get usage for tenant
   */
  getUsage(tenantId: string): TenantUsage {
    return this.getOrCreateUsage(tenantId);
  }

  /**
   * Reset usage (called at start of billing period)
   */
  resetUsage(tenantId: string): void {
    this.usage.delete(tenantId);
  }

  /**
   * Start periodic reset at beginning of each month
   */
  private startPeriodicReset(): void {
    const checkInterval = 60 * 60 * 1000; // Check every hour

    setInterval(() => {
      const now = new Date();
      if (now.getDate() === 1 && now.getHours() === 0) {
        // Reset all usage at start of month
        logger.info('Resetting monthly usage for all tenants');
        this.usage.clear();
      }
    }, checkInterval);
  }

  /**
   * Get all tenants with usage
   */
  getAllTenants(): string[] {
    return Array.from(this.usage.keys());
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let costTrackerInstance: CostTracker | null = null;

export function getCostTracker(): CostTracker {
  if (!costTrackerInstance) {
    costTrackerInstance = new CostTracker();
  }
  return costTrackerInstance;
}
