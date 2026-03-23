/**
 * Service Level Indicators (SLI) and Service Level Objectives (SLO)
 *
 * Defines formal SLI/SLO targets for ServalSheets MCP server.
 * These are exposed as Prometheus metrics and monitored via alerting rules.
 *
 * @category Observability
 */

import { Gauge, Counter, register } from 'prom-client';

// ==================== SLI/SLO Definitions ====================

/**
 * Service Level Indicator configuration
 */
export interface SLIConfig {
  /** SLI name */
  name: string;
  /** Human-readable description */
  description: string;
  /** Target value (e.g., 0.999 for 99.9%) */
  target: number;
  /** Unit of measurement */
  unit: string;
  /** Measurement type (percentage, milliseconds, etc.) */
  measurementType: 'availability' | 'latency' | 'error_rate' | 'throughput';
  /** PromQL query to calculate current value */
  query: string;
  /** Alerting threshold (when to alert before SLO breach) */
  alertThreshold: number;
}

/**
 * Service Level Objective configuration
 */
export interface SLOConfig extends SLIConfig {
  /** Time window for SLO (e.g., '30d' for 30 days) */
  window: string;
  /** Error budget (1 - target, e.g., 0.001 for 99.9% target) */
  errorBudget: number;
}

/**
 * Core SLI definitions for ServalSheets
 */
export const SERVICE_LEVEL_INDICATORS: Record<string, SLIConfig> = {
  /**
   * Availability SLI - Service uptime
   * Target: 99.9% (3 nines) - allows 43.2 minutes downtime per month
   */
  availability: {
    name: 'availability',
    description: 'Service availability (uptime ratio)',
    target: 0.999, // 99.9%
    unit: 'percentage',
    measurementType: 'availability',
    query: 'up{job="servalsheets"}',
    alertThreshold: 0.998, // Alert at 99.8% (before SLO breach)
  },

  /**
   * Latency SLI - P95 read operation latency
   * Target: 500ms - 95% of read operations complete within 500ms
   */
  latency_p95_read: {
    name: 'latency_p95_read',
    description: 'P95 latency for read operations',
    target: 500, // 500ms
    unit: 'milliseconds',
    measurementType: 'latency',
    query:
      'histogram_quantile(0.95, servalsheets_tool_call_duration_seconds_bucket{action=~"read|get|list|batch_read"})',
    alertThreshold: 400, // Alert at 400ms (80% of target)
  },

  /**
   * Latency SLI - P95 write operation latency
   * Target: 2000ms - 95% of write operations complete within 2s
   */
  latency_p95_write: {
    name: 'latency_p95_write',
    description: 'P95 latency for write operations',
    target: 2000, // 2000ms
    unit: 'milliseconds',
    measurementType: 'latency',
    query:
      'histogram_quantile(0.95, servalsheets_tool_call_duration_seconds_bucket{action=~"write|update|append|batch_write|delete"})',
    alertThreshold: 1600, // Alert at 1.6s (80% of target)
  },

  /**
   * Latency SLI - P99 operation latency (all operations)
   * Target: 5000ms - 99% of all operations complete within 5s
   */
  latency_p99: {
    name: 'latency_p99',
    description: 'P99 latency for all operations',
    target: 5000, // 5000ms
    unit: 'milliseconds',
    measurementType: 'latency',
    query: 'histogram_quantile(0.99, servalsheets_tool_call_duration_seconds_bucket)',
    alertThreshold: 4000, // Alert at 4s (80% of target)
  },

  /**
   * Error Rate SLI - Client errors (4xx)
   * Target: 0.1% - Less than 0.1% of requests result in client errors
   */
  error_rate_4xx: {
    name: 'error_rate_4xx',
    description: 'Client error rate (4xx responses)',
    target: 0.001, // 0.1%
    unit: 'percentage',
    measurementType: 'error_rate',
    query:
      'rate(servalsheets_tool_calls_total{status="error"}[5m]) / rate(servalsheets_tool_calls_total[5m])',
    alertThreshold: 0.002, // Alert at 0.2% (2x target)
  },

  /**
   * Error Rate SLI - Server errors (5xx)
   * Target: 0.01% - Less than 0.01% of requests result in server errors
   */
  error_rate_5xx: {
    name: 'error_rate_5xx',
    description: 'Server error rate (5xx responses)',
    target: 0.0001, // 0.01%
    unit: 'percentage',
    measurementType: 'error_rate',
    query:
      'rate(servalsheets_errors_by_type_total{error_type=~"INTERNAL_ERROR|SERVICE_ERROR"}[5m]) / rate(servalsheets_tool_calls_total[5m])',
    alertThreshold: 0.0002, // Alert at 0.02% (2x target)
  },

  /**
   * Google API Success Rate SLI
   * Target: 99.5% - At least 99.5% of Google API calls succeed
   */
  google_api_success_rate: {
    name: 'google_api_success_rate',
    description: 'Google API call success rate',
    target: 0.995, // 99.5%
    unit: 'percentage',
    measurementType: 'availability',
    query:
      'rate(servalsheets_google_api_calls_total{status="success"}[5m]) / rate(servalsheets_google_api_calls_total[5m])',
    alertThreshold: 0.99, // Alert at 99.0%
  },

  /**
   * Cache Hit Rate SLI
   * Target: 80% - At least 80% cache hit rate for optimal performance
   */
  cache_hit_rate: {
    name: 'cache_hit_rate',
    description: 'Cache hit rate',
    target: 0.8, // 80%
    unit: 'percentage',
    measurementType: 'throughput',
    query:
      'rate(servalsheets_cache_hits_total[5m]) / (rate(servalsheets_cache_hits_total[5m]) + rate(servalsheets_cache_misses_total[5m]))',
    alertThreshold: 0.5, // Alert at 50% (significantly degraded)
  },
};

/**
 * Service Level Objectives (SLO) with time windows
 */
export const SERVICE_LEVEL_OBJECTIVES: Record<string, SLOConfig> = {
  // Add time windows to SLI definitions
  ...Object.fromEntries(
    Object.entries(SERVICE_LEVEL_INDICATORS).map(([key, sli]) => [
      key,
      {
        ...sli,
        window: '30d', // 30-day rolling window
        errorBudget: sli.measurementType === 'latency' ? 0 : 1 - sli.target,
      },
    ])
  ),
};

// ==================== Prometheus Metrics ====================

/**
 * SLI target gauge - Exports SLI targets as Prometheus metrics
 */
export const sliTargets = new Gauge({
  name: 'servalsheets_sli_target',
  help: 'Service Level Indicator target values',
  labelNames: ['sli', 'unit', 'measurement_type'],
  registers: [register],
});

/**
 * SLO error budget gauge - Tracks remaining error budget
 */
export const sloErrorBudget = new Gauge({
  name: 'servalsheets_slo_error_budget',
  help: 'Service Level Objective error budget remaining',
  labelNames: ['slo', 'window'],
  registers: [register],
});

/**
 * SLO burn rate gauge - Tracks error budget burn rate
 */
export const sloBurnRate = new Gauge({
  name: 'servalsheets_slo_burn_rate',
  help: 'Service Level Objective error budget burn rate',
  labelNames: ['slo', 'window'],
  registers: [register],
});

/**
 * SLI compliance counter - Tracks SLI compliance events
 */
export const sliComplianceTotal = new Counter({
  name: 'servalsheets_sli_compliance_total',
  help: 'Total SLI compliance checks',
  labelNames: ['sli', 'compliant'],
  registers: [register],
});

// ==================== Initialization ====================

/**
 * Initialize SLI/SLO metrics - Export targets to Prometheus
 */
export function initializeSLIMetrics(): void {
  // Export SLI targets as Prometheus metrics
  for (const [_name, sli] of Object.entries(SERVICE_LEVEL_INDICATORS)) {
    sliTargets.set(
      {
        sli: sli.name,
        unit: sli.unit,
        measurement_type: sli.measurementType,
      },
      sli.target
    );
  }

  // Initialize error budgets to 1.0 (100% remaining)
  for (const [_name, slo] of Object.entries(SERVICE_LEVEL_OBJECTIVES)) {
    if (slo.errorBudget > 0) {
      sloErrorBudget.set(
        {
          slo: slo.name,
          window: slo.window,
        },
        1.0 // Start with full error budget
      );
      sloBurnRate.set(
        {
          slo: slo.name,
          window: slo.window,
        },
        0.0 // No burn rate initially
      );
    }
  }
}

// ==================== Helper Functions ====================

/**
 * Record SLI compliance check
 */
export function recordSLICompliance(sliName: string, compliant: boolean): void {
  sliComplianceTotal.inc({
    sli: sliName,
    compliant: compliant ? 'true' : 'false',
  });
}

/**
 * Update error budget (should be called periodically)
 */
export function updateErrorBudget(sloName: string, remaining: number, burnRate: number): void {
  const slo = SERVICE_LEVEL_OBJECTIVES[sloName];
  if (!slo) return;

  sloErrorBudget.set(
    {
      slo: sloName,
      window: slo.window,
    },
    remaining
  );

  sloBurnRate.set(
    {
      slo: sloName,
      window: slo.window,
    },
    burnRate
  );
}

/**
 * Get SLI configuration
 */
export function getSLI(name: string): SLIConfig | undefined {
  return SERVICE_LEVEL_INDICATORS[name];
}

/**
 * Get SLO configuration
 */
export function getSLO(name: string): SLOConfig | undefined {
  return SERVICE_LEVEL_OBJECTIVES[name];
}

/**
 * Get all SLI names
 */
export function getAllSLINames(): string[] {
  return Object.keys(SERVICE_LEVEL_INDICATORS);
}

/**
 * Get all SLO names
 */
export function getAllSLONames(): string[] {
  return Object.keys(SERVICE_LEVEL_OBJECTIVES);
}

/**
 * Check if current value meets SLI target
 */
export function checkSLICompliance(sliName: string, currentValue: number): boolean {
  const sli = SERVICE_LEVEL_INDICATORS[sliName];
  if (!sli) return false;

  // For latency, lower is better (current < target)
  // For availability/success rate, higher is better (current >= target)
  const compliant =
    sli.measurementType === 'latency' ? currentValue <= sli.target : currentValue >= sli.target;

  recordSLICompliance(sliName, compliant);
  return compliant;
}

/**
 * Get SLI summary for monitoring dashboard
 */
export interface SLISummary {
  name: string;
  description: string;
  target: number;
  unit: string;
  measurementType: string;
  alertThreshold: number;
}

export function getSLISummary(): SLISummary[] {
  return Object.values(SERVICE_LEVEL_INDICATORS).map((sli) => ({
    name: sli.name,
    description: sli.description,
    target: sli.target,
    unit: sli.unit,
    measurementType: sli.measurementType,
    alertThreshold: sli.alertThreshold,
  }));
}

// Auto-initialize on module load
initializeSLIMetrics();
