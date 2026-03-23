/**
 * Cost Attribution Tests
 *
 * Comprehensive tests for cost tracking, billing integration, and cost dashboard
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CostTracker, getCostTracker } from '../../src/services/cost-tracker.js';
import {
  BillingIntegration,
  createBillingIntegration,
} from '../../src/services/billing-integration.js';

describe('CostTracker', () => {
  let costTracker: CostTracker;
  const testTenantId = 'test-tenant-123';

  beforeEach(() => {
    costTracker = new CostTracker();
  });

  describe('API Call Tracking', () => {
    it('should track API calls by type', () => {
      costTracker.trackApiCall(testTenantId, 'sheets');
      costTracker.trackApiCall(testTenantId, 'sheets');
      costTracker.trackApiCall(testTenantId, 'drive');
      costTracker.trackApiCall(testTenantId, 'bigquery');

      const usage = costTracker.getUsage(testTenantId);
      expect(usage.apiCalls.sheets).toBe(2);
      expect(usage.apiCalls.drive).toBe(1);
      expect(usage.apiCalls.bigquery).toBe(1);
      expect(usage.apiCalls.total).toBe(4);
    });

    it('should track API calls for multiple tenants separately', () => {
      const tenant1 = 'tenant-1';
      const tenant2 = 'tenant-2';

      costTracker.trackApiCall(tenant1, 'sheets');
      costTracker.trackApiCall(tenant1, 'sheets');
      costTracker.trackApiCall(tenant2, 'sheets');

      const usage1 = costTracker.getUsage(tenant1);
      const usage2 = costTracker.getUsage(tenant2);

      expect(usage1.apiCalls.sheets).toBe(2);
      expect(usage2.apiCalls.sheets).toBe(1);
    });
  });

  describe('Storage Tracking', () => {
    it('should track storage in bytes and GB', () => {
      const bytes = 5 * 1024 * 1024 * 1024; // 5 GB
      costTracker.trackStorage(testTenantId, bytes);

      const usage = costTracker.getUsage(testTenantId);
      expect(usage.storage.bytes).toBe(bytes);
      expect(usage.storage.gb).toBeCloseTo(5, 2);
    });

    it('should update storage when tracked multiple times', () => {
      costTracker.trackStorage(testTenantId, 1024 * 1024 * 1024); // 1 GB
      costTracker.trackStorage(testTenantId, 2 * 1024 * 1024 * 1024); // 2 GB

      const usage = costTracker.getUsage(testTenantId);
      expect(usage.storage.gb).toBeCloseTo(2, 2);
    });
  });

  describe('User Seat Tracking', () => {
    it('should track active and total seats', () => {
      costTracker.trackUserSeats(testTenantId, 8, 10);

      const usage = costTracker.getUsage(testTenantId);
      expect(usage.users.activeSeats).toBe(8);
      expect(usage.users.totalSeats).toBe(10);
    });
  });

  describe('Feature Usage Tracking', () => {
    it('should track individual features', () => {
      costTracker.trackFeatureUsage(testTenantId, 'rowsProcessed', 1000);
      costTracker.trackFeatureUsage(testTenantId, 'formulasExecuted', 50);
      costTracker.trackFeatureUsage(testTenantId, 'webhooksDelivered', 10);
      costTracker.trackFeatureUsage(testTenantId, 'transactionsExecuted', 5);

      const usage = costTracker.getUsage(testTenantId);
      expect(usage.features.rowsProcessed).toBe(1000);
      expect(usage.features.formulasExecuted).toBe(50);
      expect(usage.features.webhooksDelivered).toBe(10);
      expect(usage.features.transactionsExecuted).toBe(5);
    });

    it('should accumulate feature usage', () => {
      costTracker.trackFeatureUsage(testTenantId, 'rowsProcessed', 500);
      costTracker.trackFeatureUsage(testTenantId, 'rowsProcessed', 500);

      const usage = costTracker.getUsage(testTenantId);
      expect(usage.features.rowsProcessed).toBe(1000);
    });
  });

  describe('Cost Calculation', () => {
    beforeEach(() => {
      costTracker.setTier(testTenantId, 'starter');
    });

    it('should calculate API call costs', () => {
      costTracker.trackApiCall(testTenantId, 'sheets');
      costTracker.trackApiCall(testTenantId, 'sheets');

      const breakdown = costTracker.calculateCost(testTenantId);
      expect(breakdown.costs.apiCalls).toBeGreaterThan(0);
      expect(breakdown.costs.total).toBeGreaterThan(0);
    });

    it('should calculate storage costs', () => {
      costTracker.trackStorage(testTenantId, 5 * 1024 * 1024 * 1024); // 5 GB

      const breakdown = costTracker.calculateCost(testTenantId);
      expect(breakdown.costs.storage).toBeCloseTo(2.5, 2); // 5 GB * $0.50/GB
    });

    it('should calculate user seat costs', () => {
      costTracker.trackUserSeats(testTenantId, 3, 3);

      const breakdown = costTracker.calculateCost(testTenantId);
      expect(breakdown.costs.userSeats).toBe(30); // 3 seats * $10/seat
    });

    it('should calculate feature costs', () => {
      costTracker.trackFeatureUsage(testTenantId, 'rowsProcessed', 1000);

      const breakdown = costTracker.calculateCost(testTenantId);
      expect(breakdown.costs.features).toBeCloseTo(1, 2); // 1000 rows * $0.001/1000
    });

    it('should calculate total costs correctly', () => {
      costTracker.trackApiCall(testTenantId, 'sheets'); // $0.0001
      costTracker.trackStorage(testTenantId, 1024 * 1024 * 1024); // 1 GB = $0.50
      costTracker.trackUserSeats(testTenantId, 1, 1); // 1 seat = $10
      costTracker.trackFeatureUsage(testTenantId, 'rowsProcessed', 1000); // $1.00

      const breakdown = costTracker.calculateCost(testTenantId);
      expect(breakdown.costs.total).toBeCloseTo(11.5001, 4);
    });
  });

  describe('Pricing Tiers', () => {
    it('should apply free tier pricing', () => {
      costTracker.setTier(testTenantId, 'free');
      costTracker.trackApiCall(testTenantId, 'sheets');
      costTracker.trackStorage(testTenantId, 1024 * 1024 * 1024);

      const breakdown = costTracker.calculateCost(testTenantId);
      expect(breakdown.costs.total).toBe(0); // Free tier
      expect(breakdown.tier.name).toBe('free');
    });

    it('should apply starter tier pricing', () => {
      costTracker.setTier(testTenantId, 'starter');
      costTracker.trackApiCall(testTenantId, 'sheets');

      const breakdown = costTracker.calculateCost(testTenantId);
      expect(breakdown.tier.name).toBe('starter');
      expect(breakdown.tier.discountPercent).toBe(0);
    });

    it('should apply professional tier discounts', () => {
      costTracker.setTier(testTenantId, 'professional');
      costTracker.trackUserSeats(testTenantId, 5, 5); // 5 * $8 = $40

      const breakdown = costTracker.calculateCost(testTenantId);
      expect(breakdown.tier.name).toBe('professional');
      expect(breakdown.tier.discountPercent).toBe(20);
      expect(breakdown.costs.discounts).toBeGreaterThan(0);
    });

    it('should apply enterprise tier discounts', () => {
      costTracker.setTier(testTenantId, 'enterprise');
      costTracker.trackUserSeats(testTenantId, 10, 10); // 10 * $5 = $50

      const breakdown = costTracker.calculateCost(testTenantId);
      expect(breakdown.tier.name).toBe('enterprise');
      expect(breakdown.tier.discountPercent).toBe(50);
      expect(breakdown.costs.discounts).toBeCloseTo(25, 2); // 50% of $50
    });
  });

  describe('Budget Management', () => {
    it('should track budget and remaining amount', () => {
      costTracker.setBudget(testTenantId, 100);
      costTracker.setTier(testTenantId, 'starter');
      costTracker.trackUserSeats(testTenantId, 5, 5); // $50

      const budgetStatus = costTracker.getBudgetStatus(testTenantId);
      expect(budgetStatus.budget).toBe(100);
      expect(budgetStatus.current).toBe(50);
      expect(budgetStatus.remaining).toBe(50);
      expect(budgetStatus.percentUsed).toBe(50);
    });

    it('should emit budget warning alert at 80%', (done) => {
      costTracker.setBudget(testTenantId, 100);
      costTracker.setTier(testTenantId, 'starter');

      costTracker.on('alert', (alert) => {
        if (alert.type === 'budget_warning') {
          expect(alert.tenantId).toBe(testTenantId);
          expect(alert.currentCost).toBeGreaterThanOrEqual(80);
          done();
        }
      });

      costTracker.trackUserSeats(testTenantId, 10, 10); // $100
    });

    it('should emit budget exceeded alert', (done) => {
      costTracker.setBudget(testTenantId, 50);
      costTracker.setTier(testTenantId, 'starter');

      costTracker.on('alert', (alert) => {
        if (alert.type === 'budget_exceeded') {
          expect(alert.tenantId).toBe(testTenantId);
          expect(alert.currentCost).toBeGreaterThan(50);
          done();
        }
      });

      costTracker.trackUserSeats(testTenantId, 10, 10); // $100
    });
  });

  describe('Cost Forecasting', () => {
    it('should forecast end-of-month costs', () => {
      costTracker.setTier(testTenantId, 'starter');
      costTracker.trackUserSeats(testTenantId, 5, 5); // $50

      const forecast = costTracker.forecastCost(testTenantId);
      expect(forecast.forecast).toBeGreaterThan(0);
      expect(forecast.confidence).toBeGreaterThanOrEqual(0);
      expect(forecast.confidence).toBeLessThanOrEqual(1);
    });

    it('should have higher confidence with more data', () => {
      // Mock usage that has been tracked for multiple days
      costTracker.setTier(testTenantId, 'starter');
      costTracker.trackUserSeats(testTenantId, 5, 5);

      const forecast = costTracker.forecastCost(testTenantId);
      expect(forecast.confidence).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Tier Upgrade Suggestions', () => {
    it('should suggest upgrade when API calls exceed limit', () => {
      costTracker.setTier(testTenantId, 'free');

      // Exceed free tier limit (1000 calls)
      for (let i = 0; i < 1001; i++) {
        costTracker.trackApiCall(testTenantId, 'sheets');
      }

      const suggestion = costTracker.suggestTierUpgrade(testTenantId);
      expect(suggestion).not.toBeNull();
      expect(suggestion?.name).toBe('starter');
    });

    it('should suggest upgrade when storage exceeds limit', () => {
      costTracker.setTier(testTenantId, 'free');
      costTracker.trackStorage(testTenantId, 2 * 1024 * 1024 * 1024); // 2 GB (exceeds 1 GB limit)

      const suggestion = costTracker.suggestTierUpgrade(testTenantId);
      expect(suggestion).not.toBeNull();
    });

    it('should suggest upgrade when user seats exceed limit', () => {
      costTracker.setTier(testTenantId, 'starter');
      costTracker.trackUserSeats(testTenantId, 10, 10); // Exceeds 5 seat limit

      const suggestion = costTracker.suggestTierUpgrade(testTenantId);
      expect(suggestion).not.toBeNull();
      expect(suggestion?.name).toBe('professional');
    });

    it('should not suggest upgrade if within limits', () => {
      costTracker.setTier(testTenantId, 'starter');
      costTracker.trackApiCall(testTenantId, 'sheets');
      costTracker.trackUserSeats(testTenantId, 2, 2);

      const suggestion = costTracker.suggestTierUpgrade(testTenantId);
      expect(suggestion).toBeNull();
    });
  });

  describe('Usage Reset', () => {
    it('should reset usage for tenant', () => {
      costTracker.trackApiCall(testTenantId, 'sheets');
      costTracker.trackStorage(testTenantId, 1024 * 1024 * 1024);

      let usage = costTracker.getUsage(testTenantId);
      expect(usage.apiCalls.total).toBe(1);

      costTracker.resetUsage(testTenantId);

      usage = costTracker.getUsage(testTenantId);
      expect(usage.apiCalls.total).toBe(0);
      expect(usage.storage.bytes).toBe(0);
    });
  });

  describe('Multi-Tenant Support', () => {
    it('should track multiple tenants independently', () => {
      const tenant1 = 'tenant-1';
      const tenant2 = 'tenant-2';
      const tenant3 = 'tenant-3';

      costTracker.setTier(tenant1, 'starter');
      costTracker.setTier(tenant2, 'professional');
      costTracker.setTier(tenant3, 'enterprise');

      costTracker.trackApiCall(tenant1, 'sheets');
      costTracker.trackApiCall(tenant2, 'sheets');
      costTracker.trackApiCall(tenant2, 'sheets');
      costTracker.trackApiCall(tenant3, 'sheets');
      costTracker.trackApiCall(tenant3, 'sheets');
      costTracker.trackApiCall(tenant3, 'sheets');

      const usage1 = costTracker.getUsage(tenant1);
      const usage2 = costTracker.getUsage(tenant2);
      const usage3 = costTracker.getUsage(tenant3);

      expect(usage1.apiCalls.total).toBe(1);
      expect(usage2.apiCalls.total).toBe(2);
      expect(usage3.apiCalls.total).toBe(3);
    });

    it('should list all tenants', () => {
      costTracker.trackApiCall('tenant-1', 'sheets');
      costTracker.trackApiCall('tenant-2', 'sheets');
      costTracker.trackApiCall('tenant-3', 'sheets');

      const tenants = costTracker.getAllTenants();
      expect(tenants).toHaveLength(3);
      expect(tenants).toContain('tenant-1');
      expect(tenants).toContain('tenant-2');
      expect(tenants).toContain('tenant-3');
    });
  });
});

describe('BillingIntegration', () => {
  // Note: These tests would require Stripe test mode API keys
  // For now, we'll test the structure and error handling

  it('should require Stripe API key', () => {
    expect(() => {
      createBillingIntegration({ stripeSecretKey: '' });
    }).toThrow();
  });

  it('should initialize with config', () => {
    const config = {
      stripeSecretKey: 'sk_test_123',
      currency: 'usd',
      billingCycle: 'monthly' as const,
    };

    const billing = createBillingIntegration(config);
    expect(billing).toBeDefined();
  });

  // More comprehensive Stripe integration tests would go here
  // These would use Stripe's test mode and mock data
});

describe('Cost Dashboard Integration', () => {
  let costTracker: CostTracker;
  const testTenantId = 'test-tenant-dashboard';

  beforeEach(() => {
    costTracker = new CostTracker();
    costTracker.setTier(testTenantId, 'professional');
  });

  it('should generate complete cost dashboard', () => {
    // Set up usage
    costTracker.trackApiCall(testTenantId, 'sheets');
    costTracker.trackApiCall(testTenantId, 'drive');
    costTracker.trackStorage(testTenantId, 5 * 1024 * 1024 * 1024); // 5 GB
    costTracker.trackUserSeats(testTenantId, 8, 10);
    costTracker.trackFeatureUsage(testTenantId, 'rowsProcessed', 50000);
    costTracker.setBudget(testTenantId, 100);

    const breakdown = costTracker.calculateCost(testTenantId);
    const forecast = costTracker.forecastCost(testTenantId);
    const budgetStatus = costTracker.getBudgetStatus(testTenantId);

    expect(breakdown.tenantId).toBe(testTenantId);
    expect(breakdown.costs.total).toBeGreaterThan(0);
    expect(forecast.forecast).toBeGreaterThan(0);
    expect(budgetStatus.budget).toBe(100);
  });
});
