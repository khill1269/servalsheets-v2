/**
 * Validation Metrics
 *
 * Tracks validation-related metrics: feature flags, payload warnings, confirmation skips.
 *
 * @category Metrics
 */

import { logger } from '../../utils/logger.js';

// ==================== Types ====================

export interface FeatureFlagMetrics {
  /** Total feature flag blocks */
  totalBlocks: number;
  /** Block counts by feature flag */
  byFlag: Record<string, number>;
  /** Block counts by tool/action */
  byAction: Record<string, number>;
}

export interface PayloadWarningMetrics {
  /** Warning-level payloads */
  warning: number;
  /** Critical-level payloads */
  critical: number;
  /** Exceeded-limit payloads */
  exceeded: number;
  /** Total payload warnings */
  total: number;
  /** Payload warnings by tool/action */
  byAction: Record<string, { warning: number; critical: number; exceeded: number; total: number }>;
}

export interface ConfirmationSkipMetrics {
  /** Total confirmation skips */
  totalSkips: number;
  /** Destructive operation skips */
  destructiveSkips: number;
  /** Recent skip rate (last 100 operations) */
  recentSkipRate: number;
  /** Recent destructive skip rate */
  recentDestructiveRate: number;
  /** Alert threshold exceeded (>10% destructive skip rate) */
  alertThresholdExceeded: boolean;
  /** Skips by action */
  byAction: Map<string, { count: number; lastSkipped: number; affectedSpreadsheets: number }>;
}

// ==================== Constants ====================

/**
 * Maximum cardinality for metric labels
 * Prevents unbounded memory growth from high-cardinality labels
 */
const MAX_LABEL_CARDINALITY = 10000;

// ==================== Validation Metrics Service ====================

export class ValidationMetricsService {
  private featureFlagBlockCount = 0;
  private readonly featureFlagBlocks: Map<string, number> = new Map();
  private readonly featureFlagBlocksByAction: Map<string, number> = new Map();

  private payloadWarnings: {
    warning: number;
    critical: number;
    exceeded: number;
  } = {
    warning: 0,
    critical: 0,
    exceeded: 0,
  };
  private readonly payloadWarningsByAction: Map<
    string,
    { warning: number; critical: number; exceeded: number }
  > = new Map();

  private readonly confirmationSkips: Map<
    string,
    {
      count: number;
      lastSkipped: number;
      spreadsheetIds: Set<string>;
      destructive: boolean;
    }
  > = new Map();

  // Recent skip tracking for alert thresholds (sliding window of last 100)
  private readonly recentConfirmationSkips: Array<{
    action: string;
    reason: string;
    destructive: boolean;
    timestamp: number;
  }> = [];

  private enabled: boolean;

  constructor(options: { enabled?: boolean } = {}) {
    this.enabled = options.enabled ?? true;
  }

  /**
   * Record feature flag block
   */
  recordFeatureFlagBlock(params: { flag: string; tool?: string; action?: string }): void {
    if (!this.enabled) return;

    this.featureFlagBlockCount++;

    if (
      !this.featureFlagBlocks.has(params.flag) &&
      this.featureFlagBlocks.size >= MAX_LABEL_CARDINALITY
    ) {
      logger.warn('Feature flag metrics cardinality limit reached', {
        limit: MAX_LABEL_CARDINALITY,
        droppedFlag: params.flag,
      });
    } else {
      this.featureFlagBlocks.set(params.flag, (this.featureFlagBlocks.get(params.flag) || 0) + 1);
    }

    if (params.tool && params.action) {
      const actionKey = `${params.tool}.${params.action}`;
      if (
        !this.featureFlagBlocksByAction.has(actionKey) &&
        this.featureFlagBlocksByAction.size >= MAX_LABEL_CARDINALITY
      ) {
        logger.warn('Feature flag action metrics cardinality limit reached', {
          limit: MAX_LABEL_CARDINALITY,
          droppedAction: actionKey,
        });
      } else {
        this.featureFlagBlocksByAction.set(
          actionKey,
          (this.featureFlagBlocksByAction.get(actionKey) || 0) + 1
        );
      }
    }
  }

  /**
   * Get feature flag block metrics
   */
  getFeatureFlagMetrics(): FeatureFlagMetrics {
    return {
      totalBlocks: this.featureFlagBlockCount,
      byFlag: Object.fromEntries(this.featureFlagBlocks),
      byAction: Object.fromEntries(this.featureFlagBlocksByAction),
    };
  }

  /**
   * Record payload size warning
   */
  recordPayloadWarning(params: {
    level: 'warning' | 'critical' | 'exceeded';
    tool?: string;
    action?: string;
  }): void {
    if (!this.enabled) return;

    if (params.level === 'warning') {
      this.payloadWarnings.warning++;
    } else if (params.level === 'critical') {
      this.payloadWarnings.critical++;
    } else {
      this.payloadWarnings.exceeded++;
    }

    if (params.tool && params.action) {
      const actionKey = `${params.tool}.${params.action}`;
      if (
        !this.payloadWarningsByAction.has(actionKey) &&
        this.payloadWarningsByAction.size >= MAX_LABEL_CARDINALITY
      ) {
        logger.warn('Payload warning metrics cardinality limit reached', {
          limit: MAX_LABEL_CARDINALITY,
          droppedAction: actionKey,
        });
        return;
      }

      const stats = this.payloadWarningsByAction.get(actionKey) ?? {
        warning: 0,
        critical: 0,
        exceeded: 0,
      };

      if (params.level === 'warning') {
        stats.warning++;
      } else if (params.level === 'critical') {
        stats.critical++;
      } else {
        stats.exceeded++;
      }

      this.payloadWarningsByAction.set(actionKey, stats);
    }
  }

  /**
   * Get payload warning metrics
   */
  getPayloadWarningMetrics(): PayloadWarningMetrics {
    const byAction: Record<
      string,
      { warning: number; critical: number; exceeded: number; total: number }
    > = {};

    for (const [actionKey, stats] of this.payloadWarningsByAction.entries()) {
      const total = stats.warning + stats.critical + stats.exceeded;
      byAction[actionKey] = {
        warning: stats.warning,
        critical: stats.critical,
        exceeded: stats.exceeded,
        total,
      };
    }

    const total =
      this.payloadWarnings.warning + this.payloadWarnings.critical + this.payloadWarnings.exceeded;

    return {
      warning: this.payloadWarnings.warning,
      critical: this.payloadWarnings.critical,
      exceeded: this.payloadWarnings.exceeded,
      total,
      byAction,
    };
  }

  /**
   * Record confirmation skip for destructive operation
   * CRITICAL: Tracks when destructive operations bypass confirmation (data corruption risk)
   */
  recordConfirmationSkip(params: {
    action: string;
    reason: string;
    timestamp: number;
    spreadsheetId: string;
    destructive: boolean;
  }): void {
    if (!this.enabled) return;

    const key = `${params.action}:${params.reason}`;
    const existing = this.confirmationSkips.get(key);

    if (existing) {
      existing.count++;
      existing.lastSkipped = params.timestamp;
      existing.spreadsheetIds.add(params.spreadsheetId);
    } else {
      this.confirmationSkips.set(key, {
        count: 1,
        lastSkipped: params.timestamp,
        spreadsheetIds: new Set([params.spreadsheetId]),
        destructive: params.destructive,
      });
    }

    // Track recent skips for alert thresholds (sliding window of last 100)
    this.recentConfirmationSkips.push({
      action: params.action,
      reason: params.reason,
      destructive: params.destructive,
      timestamp: params.timestamp,
    });

    // Maintain sliding window of 100 most recent skips
    if (this.recentConfirmationSkips.length > 100) {
      this.recentConfirmationSkips.shift();
    }

    // Log ERROR for destructive operations (data corruption risk)
    if (params.destructive) {
      logger.error('[CONFIRMATION_SKIP] Destructive operation bypassed confirmation', {
        action: params.action,
        reason: params.reason,
        spreadsheetId: params.spreadsheetId,
        timestamp: new Date(params.timestamp).toISOString(),
        severity: 'CRITICAL', // Indicate data corruption risk
      });
    }

    // Alert if skip rate > 10% in last 100 operations (data corruption risk threshold)
    const destructiveSkipsInWindow = this.recentConfirmationSkips.filter(
      (s) => s.destructive
    ).length;
    const skipRate = destructiveSkipsInWindow / this.recentConfirmationSkips.length;

    if (skipRate > 0.1 && this.recentConfirmationSkips.length >= 50) {
      // Only alert if we have at least 50 samples
      logger.error('[ALERT] High destructive operation skip rate detected', {
        skipRate: (skipRate * 100).toFixed(2) + '%',
        windowSize: this.recentConfirmationSkips.length,
        destructiveSkips: destructiveSkipsInWindow,
        severity: 'CRITICAL',
        recommendation: 'Investigate confirmation system - potential data corruption risk',
      });
    }
  }

  /**
   * Get confirmation skip metrics
   */
  getConfirmationSkipMetrics(): ConfirmationSkipMetrics {
    let totalSkips = 0;
    let destructiveSkips = 0;
    const byAction = new Map<
      string,
      { count: number; lastSkipped: number; affectedSpreadsheets: number }
    >();

    for (const [key, value] of this.confirmationSkips.entries()) {
      totalSkips += value.count;
      if (value.destructive) {
        destructiveSkips += value.count;
      }

      byAction.set(key, {
        count: value.count,
        lastSkipped: value.lastSkipped,
        affectedSpreadsheets: value.spreadsheetIds.size,
      });
    }

    // Calculate recent skip rates from sliding window
    const recentDestructiveSkips = this.recentConfirmationSkips.filter((s) => s.destructive).length;
    const recentSkipRate =
      this.recentConfirmationSkips.length > 0
        ? recentDestructiveSkips / this.recentConfirmationSkips.length
        : 0;
    const alertThresholdExceeded =
      recentSkipRate > 0.1 && this.recentConfirmationSkips.length >= 50;

    return {
      totalSkips,
      destructiveSkips,
      recentSkipRate,
      recentDestructiveRate: recentSkipRate, // Alias for clarity
      alertThresholdExceeded,
      byAction,
    };
  }

  /**
   * Clear all metrics (for testing)
   */
  clear(): void {
    this.featureFlagBlockCount = 0;
    this.featureFlagBlocks.clear();
    this.featureFlagBlocksByAction.clear();
    this.payloadWarnings = {
      warning: 0,
      critical: 0,
      exceeded: 0,
    };
    this.payloadWarningsByAction.clear();
    this.confirmationSkips.clear();
    this.recentConfirmationSkips.length = 0;
  }
}
