/**
 * Cost Dashboard Resource
 *
 * Real-time cost tracking, forecasting, and optimization suggestions
 * Exposed as MCP resource for cost visibility
 *
 * @category Billing
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getCostTracker, type CostBreakdown } from '../services/cost-tracker.js';
import { getBillingIntegration } from '../services/billing-integration.js';
import { logger } from '../utils/logger.js';
import { ValidationError } from '../core/errors.js';

interface CostDashboard {
  tenantId: string;
  currentPeriod: {
    startDate: string;
    endDate: string;
    daysElapsed: number;
    daysRemaining: number;
  };
  costs: {
    current: number;
    forecast: number;
    forecastConfidence: number;
    breakdown: {
      apiCalls: number;
      storage: number;
      userSeats: number;
      features: number;
      discounts: number;
      total: number;
    };
  };
  usage: {
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
  };
  budget: {
    limit: number | null;
    remaining: number;
    percentUsed: number;
    status: 'ok' | 'warning' | 'critical' | 'exceeded';
  };
  tier: {
    current: string;
    suggestedUpgrade: string | null;
    limits: {
      apiCallsPerMonth: number;
      storageGb: number;
      userSeats: number;
    };
  };
  optimization: {
    suggestions: Array<{
      type: string;
      message: string;
      potentialSavings: number;
    }>;
    totalPotentialSavings: number;
  };
  recentInvoices: Array<{
    invoiceId: string;
    amount: number;
    status: string;
    periodStart: string;
    periodEnd: string;
    paidAt?: string;
    url?: string;
  }>;
}

/**
 * Generate cost dashboard for tenant
 */
function generateCostDashboard(tenantId: string): CostDashboard {
  const costTracker = getCostTracker();

  // Get cost breakdown
  const breakdown = costTracker.calculateCost(tenantId);
  const forecast = costTracker.forecastCost(tenantId);
  const budgetStatus = costTracker.getBudgetStatus(tenantId);
  const tier = costTracker.getTier(tenantId);
  const suggestedTier = costTracker.suggestTierUpgrade(tenantId);

  // Calculate period info
  const now = new Date();
  const periodStart = breakdown.period.startDate;
  const periodEnd = breakdown.period.endDate;
  const totalDays = Math.ceil(
    (periodEnd.getTime() - periodStart.getTime()) / (1000 * 60 * 60 * 24)
  );
  const elapsedDays = Math.ceil((now.getTime() - periodStart.getTime()) / (1000 * 60 * 60 * 24));
  const remainingDays = Math.max(0, totalDays - elapsedDays);

  // Determine budget status
  let budgetStatusType: 'ok' | 'warning' | 'critical' | 'exceeded' = 'ok';
  if (budgetStatus.percentUsed >= 100) {
    budgetStatusType = 'exceeded';
  } else if (budgetStatus.percentUsed >= 95) {
    budgetStatusType = 'critical';
  } else if (budgetStatus.percentUsed >= 80) {
    budgetStatusType = 'warning';
  }

  // Generate optimization suggestions
  const suggestions = generateOptimizationSuggestions(breakdown);
  const totalPotentialSavings = suggestions.reduce((sum, s) => sum + s.potentialSavings, 0);

  const dashboard: CostDashboard = {
    tenantId,
    currentPeriod: {
      startDate: periodStart.toISOString(),
      endDate: periodEnd.toISOString(),
      daysElapsed: elapsedDays,
      daysRemaining: remainingDays,
    },
    costs: {
      current: breakdown.costs.total,
      forecast: forecast.forecast,
      forecastConfidence: forecast.confidence,
      breakdown: {
        apiCalls: breakdown.costs.apiCalls,
        storage: breakdown.costs.storage,
        userSeats: breakdown.costs.userSeats,
        features: breakdown.costs.features,
        discounts: breakdown.costs.discounts,
        total: breakdown.costs.total,
      },
    },
    usage: {
      apiCalls: breakdown.usage.apiCalls,
      storage: breakdown.usage.storage,
      users: breakdown.usage.users,
      features: breakdown.usage.features,
    },
    budget: {
      limit: budgetStatus.budget,
      remaining: budgetStatus.remaining,
      percentUsed: budgetStatus.percentUsed,
      status: budgetStatusType,
    },
    tier: {
      current: tier.name,
      suggestedUpgrade: suggestedTier?.name || null,
      limits: {
        apiCallsPerMonth: tier.limits.apiCallsPerMonth,
        storageGb: tier.limits.storageGb,
        userSeats: tier.limits.userSeats,
      },
    },
    optimization: {
      suggestions,
      totalPotentialSavings,
    },
    recentInvoices: [],
  };

  return dashboard;
}

/**
 * Generate optimization suggestions based on usage patterns
 */
function generateOptimizationSuggestions(
  breakdown: CostBreakdown
): Array<{ type: string; message: string; potentialSavings: number }> {
  const suggestions: Array<{ type: string; message: string; potentialSavings: number }> = [];

  // API call optimization
  if (breakdown.usage.apiCalls.total > 1000) {
    const potentialSavings = breakdown.costs.apiCalls * 0.3; // 30% potential savings
    suggestions.push({
      type: 'api_optimization',
      message:
        'High API usage detected. Consider using batch operations and caching to reduce API calls by up to 30%.',
      potentialSavings,
    });
  }

  // Storage optimization
  if (breakdown.usage.storage.gb > 10) {
    const potentialSavings = breakdown.costs.storage * 0.2; // 20% potential savings
    suggestions.push({
      type: 'storage_optimization',
      message:
        'High storage usage detected. Archive old data or implement data retention policies to reduce costs.',
      potentialSavings,
    });
  }

  // User seat optimization
  const activeRatio =
    breakdown.usage.users.totalSeats > 0
      ? breakdown.usage.users.activeSeats / breakdown.usage.users.totalSeats
      : 0;
  if (activeRatio < 0.7 && breakdown.usage.users.totalSeats > 5) {
    const unusedSeats = breakdown.usage.users.totalSeats - breakdown.usage.users.activeSeats;
    const potentialSavings = unusedSeats * breakdown.tier.pricing.userSeatCost;
    suggestions.push({
      type: 'seat_optimization',
      message: `Only ${Math.round(activeRatio * 100)}% of seats are active. Remove ${unusedSeats} unused seats to save on costs.`,
      potentialSavings,
    });
  }

  // Tier optimization
  const tier = breakdown.tier;
  const suggestedTier = getCostTracker().suggestTierUpgrade(breakdown.tenantId);
  if (suggestedTier && suggestedTier.discountPercent > tier.discountPercent) {
    const currentTotal = breakdown.costs.total;
    const projectedTotal = currentTotal * (1 - suggestedTier.discountPercent / 100);
    const potentialSavings = currentTotal - projectedTotal;
    suggestions.push({
      type: 'tier_upgrade',
      message: `Upgrade to ${suggestedTier.name} tier for ${suggestedTier.discountPercent}% discount on all usage.`,
      potentialSavings,
    });
  }

  // Feature usage optimization
  if (breakdown.usage.features.rowsProcessed > 1000000) {
    const potentialSavings = breakdown.costs.features * 0.15; // 15% potential savings
    suggestions.push({
      type: 'feature_optimization',
      message:
        'Consider using sampling techniques or incremental processing to reduce row processing costs.',
      potentialSavings,
    });
  }

  return suggestions;
}

/**
 * Generate cost allocation report (breakdown by project/department)
 */
interface CostAllocation {
  tenantId: string;
  period: {
    startDate: string;
    endDate: string;
  };
  allocations: Array<{
    category: string;
    description: string;
    cost: number;
    percentage: number;
  }>;
  totalCost: number;
}

function generateCostAllocationReport(tenantId: string): CostAllocation {
  const breakdown = getCostTracker().calculateCost(tenantId);

  const allocations = [
    {
      category: 'API Infrastructure',
      description: 'Google Sheets/Drive/BigQuery API calls',
      cost: breakdown.costs.apiCalls,
      percentage: (breakdown.costs.apiCalls / breakdown.costs.total) * 100,
    },
    {
      category: 'Data Storage',
      description: 'Cloud storage for spreadsheets and metadata',
      cost: breakdown.costs.storage,
      percentage: (breakdown.costs.storage / breakdown.costs.total) * 100,
    },
    {
      category: 'User Licenses',
      description: 'Per-user seat costs',
      cost: breakdown.costs.userSeats,
      percentage: (breakdown.costs.userSeats / breakdown.costs.total) * 100,
    },
    {
      category: 'Feature Usage',
      description: 'Advanced features (transactions, webhooks, etc.)',
      cost: breakdown.costs.features,
      percentage: (breakdown.costs.features / breakdown.costs.total) * 100,
    },
  ];

  return {
    tenantId,
    period: {
      startDate: breakdown.period.startDate.toISOString(),
      endDate: breakdown.period.endDate.toISOString(),
    },
    allocations,
    totalCost: breakdown.costs.total,
  };
}

/**
 * Register cost dashboard resources
 */
export function registerCostDashboardResources(server: McpServer): number {
  let resourceCount = 0;

  // Resource: billing://dashboard/{tenantId}
  server.registerResource(
    'Cost Dashboard',
    'billing://dashboard/{tenantId}',
    {
      description:
        'Real-time cost tracking with breakdown, forecasting, budget status, and optimization suggestions',
      mimeType: 'application/json',
    },
    async (uri) => {
      try {
        const uriStr = typeof uri === 'string' ? uri : uri.toString();
        const tenantId = uriStr.split('/').pop() || '';

        if (!tenantId) {
          throw new ValidationError('Tenant ID is required', 'tenantId', 'non-empty string');
        }

        const dashboard = generateCostDashboard(tenantId);

        return {
          contents: [
            {
              uri: uriStr,
              mimeType: 'application/json',
              text: JSON.stringify(dashboard),
            },
          ],
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error('Failed to generate cost dashboard', { error: errorMessage });
        return {
          contents: [
            {
              uri: typeof uri === 'string' ? uri : uri.toString(),
              mimeType: 'application/json',
              text: JSON.stringify(
                { error: 'Failed to generate cost dashboard', message: errorMessage },
                null,
                2
              ),
            },
          ],
        };
      }
    }
  );
  resourceCount++;

  // Resource: billing://allocation/{tenantId}
  server.registerResource(
    'Cost Allocation Report',
    'billing://allocation/{tenantId}',
    {
      description: 'Cost allocation breakdown by category with percentages',
      mimeType: 'application/json',
    },
    async (uri) => {
      try {
        const uriStr = typeof uri === 'string' ? uri : uri.toString();
        const tenantId = uriStr.split('/').pop() || '';

        if (!tenantId) {
          throw new ValidationError('Tenant ID is required', 'tenantId', 'non-empty string');
        }

        const allocation = generateCostAllocationReport(tenantId);

        return {
          contents: [
            {
              uri: uriStr,
              mimeType: 'application/json',
              text: JSON.stringify(allocation),
            },
          ],
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error('Failed to generate cost allocation report', { error: errorMessage });
        return {
          contents: [
            {
              uri: typeof uri === 'string' ? uri : uri.toString(),
              mimeType: 'application/json',
              text: JSON.stringify(
                {
                  error: 'Failed to generate cost allocation report',
                  message: errorMessage,
                },
                null,
                2
              ),
            },
          ],
        };
      }
    }
  );
  resourceCount++;

  // Resource: billing://invoices/{tenantId}
  server.registerResource(
    'Recent Invoices',
    'billing://invoices/{tenantId}',
    {
      description: 'Recent invoices with payment status and download links',
      mimeType: 'application/json',
    },
    async (uri) => {
      try {
        const uriStr = typeof uri === 'string' ? uri : uri.toString();
        const tenantId = uriStr.split('/').pop() || '';

        if (!tenantId) {
          throw new ValidationError('Tenant ID is required', 'tenantId', 'non-empty string');
        }

        const billing = getBillingIntegration();
        const invoices = billing ? await billing.listInvoices(tenantId, 10) : [];

        return {
          contents: [
            {
              uri: uriStr,
              mimeType: 'application/json',
              text: JSON.stringify({ tenantId, invoices }),
            },
          ],
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error('Failed to fetch invoices', { error: errorMessage });
        return {
          contents: [
            {
              uri: typeof uri === 'string' ? uri : uri.toString(),
              mimeType: 'application/json',
              text: JSON.stringify(
                { error: 'Failed to fetch invoices', message: errorMessage },
                null,
                2
              ),
            },
          ],
        };
      }
    }
  );
  resourceCount++;

  return resourceCount;
}
