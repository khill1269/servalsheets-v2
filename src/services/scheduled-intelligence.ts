import { randomUUID } from 'crypto';
import { logger } from '../utils/logger.js';

/**
 * Analysis type enumeration for scheduled intelligence.
 */
export type AnalysisType = 'quality_check' | 'anomaly_detection' | 'trend_analysis' | 'custom_query';

/**
 * Condition threshold for triggering webhooks.
 */
export interface ThresholdCondition {
  metric: string; // e.g., 'duplicate_rows', 'null_percentage', 'outlier_count'
  operator: 'gt' | 'gte' | 'lt' | 'lte' | 'eq' | 'ne';
  value: number;
}

/**
 * Schedule configuration for recurring analysis.
 */
export interface ScheduleConfig {
  id: string;
  spreadsheetId: string;
  analysisType: AnalysisType;
  intervalMs: number;
  query?: string; // For custom_query analysis type
  conditions?: ThresholdCondition[]; // Optional webhook trigger conditions
  webhookUrl?: string; // Optional webhook URL for condition notifications
  enabled: boolean;
  lastRunAt?: number; // Timestamp of last execution
  nextRunAt: number; // Timestamp of next scheduled execution
  createdAt: number; // Timestamp of schedule creation
}

/**
 * Intelligence report generated from schedule execution.
 */
export interface IntelligenceReport {
  scheduleId: string;
  timestamp: number;
  analysisType: AnalysisType;
  findings: Array<{
    type: string;
    severity: 'low' | 'medium' | 'high';
    message: string;
    data?: Record<string, unknown>;
  }>;
  conditionsMet: boolean; // True if any threshold condition was triggered
  delivered: boolean; // True if webhook was successfully sent
  webhookError?: string; // Error message if webhook delivery failed
}

/**
 * Callback function for executing analysis.
 */
export type AnalysisCallback = (
  spreadsheetId: string,
  analysisType: AnalysisType,
  query?: string
) => Promise<Array<{ type: string; severity: 'low' | 'medium' | 'high'; message: string; data?: Record<string, unknown> }>>;

/**
 * Scheduled Intelligence Manager
 * Manages recurring analysis schedules with optional webhook notifications.
 */
export class ScheduledIntelligenceManager {
  private static _instance: ScheduledIntelligenceManager | null = null;

  private schedules: Map<string, ScheduleConfig> = new Map();
  private reports: Map<string, IntelligenceReport> = new Map();
  private timerHandle: ReturnType<typeof setInterval> | null = null;
  private analysisCallback: AnalysisCallback;
  private redisClient: unknown; // Redis client if available
  private persistencePath = '.serval/schedules.json';
  private checkIntervalMs = 60000; // Check every minute for due schedules

  constructor(analysisCallback: AnalysisCallback, redisClient?: unknown) {
    this.analysisCallback = analysisCallback;
    this.redisClient = redisClient;
    logger.debug('[ScheduledIntelligence] Initialized', {
      redisAvailable: !!redisClient,
    });
  }

  /** Singleton accessor. Lazy-creates with a no-op callback. */
  static getInstance(): ScheduledIntelligenceManager {
    if (!ScheduledIntelligenceManager._instance) {
      ScheduledIntelligenceManager._instance = new ScheduledIntelligenceManager(
        async () => []
      );
    }
    return ScheduledIntelligenceManager._instance;
  }

  /**
   * Create a new schedule.
   */
  createSchedule(params: {
    spreadsheetId: string;
    analysisType: AnalysisType;
    intervalMs: number;
    query?: string;
    conditions?: ThresholdCondition[];
    webhookUrl?: string;
  }): ScheduleConfig {
    const id = randomUUID();
    const now = Date.now();

    const schedule: ScheduleConfig = {
      id,
      spreadsheetId: params.spreadsheetId,
      analysisType: params.analysisType,
      intervalMs: params.intervalMs,
      query: params.query,
      conditions: params.conditions,
      webhookUrl: params.webhookUrl,
      enabled: true,
      nextRunAt: now + params.intervalMs,
      createdAt: now,
    };

    this.schedules.set(id, schedule);
    this.persistSchedules();
    logger.info('[ScheduledIntelligence] Schedule created', { scheduleId: id, spreadsheetId: params.spreadsheetId });

    return schedule;
  }

  /**
   * Get a schedule by ID.
   */
  getSchedule(id: string): ScheduleConfig | null {
    return this.schedules.get(id) || null;
  }

  /**
   * List all schedules, optionally filtered by spreadsheet ID.
   */
  listSchedules(spreadsheetId?: string): ScheduleConfig[] {
    const schedules = Array.from(this.schedules.values());

    if (spreadsheetId) {
      return schedules.filter((s) => s.spreadsheetId === spreadsheetId);
    }

    return schedules;
  }

  /**
   * Update a schedule.
   */
  updateSchedule(id: string, params: Partial<ScheduleConfig>): ScheduleConfig {
    const schedule = this.schedules.get(id);

    if (!schedule) {
      throw new Error(`Schedule not found: ${id}`);
    }

    const updated: ScheduleConfig = {
      ...schedule,
      ...params,
      id: schedule.id, // Prevent ID modification
      createdAt: schedule.createdAt, // Prevent creation time modification
    };

    this.schedules.set(id, updated);
    this.persistSchedules();
    logger.info('[ScheduledIntelligence] Schedule updated', { scheduleId: id });

    return updated;
  }

  /**
   * Delete a schedule.
   */
  deleteSchedule(id: string): boolean {
    const deleted = this.schedules.delete(id);

    if (deleted) {
      this.reports.delete(id); // Clean up associated reports
      this.persistSchedules();
      logger.info('[ScheduledIntelligence] Schedule deleted', { scheduleId: id });
    }

    return deleted;
  }

  /**
   * Run a schedule immediately (execute analysis now).
   */
  async runSchedule(id: string): Promise<IntelligenceReport> {
    const schedule = this.schedules.get(id);

    if (!schedule) {
      throw new Error(`Schedule not found: ${id}`);
    }

    if (!schedule.enabled) {
      throw new Error(`Schedule is disabled: ${id}`);
    }

    logger.debug('[ScheduledIntelligence] Running schedule', { scheduleId: id });

    const now = Date.now();

    try {
      // Execute analysis via callback
      const findings = await this.analysisCallback(schedule.spreadsheetId, schedule.analysisType, schedule.query);

      // Check if any conditions were met
      const conditionsMet = schedule.conditions ? this.evaluateConditions(findings, schedule.conditions) : false;

      // Attempt webhook delivery if conditions met
      let delivered = false;
      let webhookError: string | undefined;

      if (conditionsMet && schedule.webhookUrl) {
        try {
          delivered = await this.sendWebhook(schedule.webhookUrl, {
            scheduleId: id,
            spreadsheetId: schedule.spreadsheetId,
            timestamp: now,
            findings,
          });
        } catch (err) {
          webhookError = err instanceof Error ? err.message : String(err);
          logger.warn('[ScheduledIntelligence] Webhook delivery failed', {
            scheduleId: id,
            error: webhookError,
          });
        }
      }

      // Create report
      const report: IntelligenceReport = {
        scheduleId: id,
        timestamp: now,
        analysisType: schedule.analysisType,
        findings,
        conditionsMet,
        delivered,
        webhookError,
      };

      // Store report (keep last 10 per schedule)
      this.reports.set(id, report);

      // Update schedule timing
      this.updateSchedule(id, {
        lastRunAt: now,
        nextRunAt: now + schedule.intervalMs,
      });

      logger.info('[ScheduledIntelligence] Schedule executed', {
        scheduleId: id,
        findingsCount: findings.length,
        conditionsMet,
        delivered,
      });

      return report;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error('[ScheduledIntelligence] Schedule execution failed', { scheduleId: id, error: errorMsg });

      // Still update nextRunAt even on failure
      this.updateSchedule(id, {
        nextRunAt: now + schedule.intervalMs,
      });

      throw err;
    }
  }

  /**
   * Get the last report for a schedule.
   */
  getReport(scheduleId: string): IntelligenceReport | null {
    return this.reports.get(scheduleId) || null;
  }

  /**
   * Start the scheduler (begins checking for due schedules).
   */
  start(): void {
    if (this.timerHandle) {
      logger.warn('[ScheduledIntelligence] Scheduler already running');
      return;
    }

    logger.info('[ScheduledIntelligence] Scheduler started');

    this.timerHandle = setInterval(() => {
      this.checkDueSchedules();
    }, this.checkIntervalMs);

    // Run check immediately
    this.checkDueSchedules();
  }

  /**
   * Stop the scheduler.
   */
  stop(): void {
    if (this.timerHandle) {
      clearInterval(this.timerHandle);
      this.timerHandle = null;
      logger.info('[ScheduledIntelligence] Scheduler stopped');
    }
  }

  /**
   * Check for due schedules and execute them.
   */
  private async checkDueSchedules(): Promise<void> {
    const now = Date.now();
    const dueSchedules = Array.from(this.schedules.values()).filter(
      (s) => s.enabled && s.nextRunAt <= now
    );

    if (dueSchedules.length > 0) {
      logger.debug('[ScheduledIntelligence] Found due schedules', { count: dueSchedules.length });

      for (const schedule of dueSchedules) {
        try {
          await this.runSchedule(schedule.id);
        } catch (err) {
          logger.error('[ScheduledIntelligence] Failed to run due schedule', {
            scheduleId: schedule.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }
  }

  /**
   * Evaluate threshold conditions against findings.
   */
  private evaluateConditions(
    findings: Array<{ type: string; severity: string; message: string; data?: Record<string, unknown> }>,
    conditions: ThresholdCondition[]
  ): boolean {
    // Extract metric values from findings
    const metrics: Record<string, number> = {};

    for (const finding of findings) {
      if (finding.data && typeof finding.data === 'object') {
        for (const [key, value] of Object.entries(finding.data)) {
          if (typeof value === 'number') {
            metrics[key] = (metrics[key] || 0) + value;
          }
        }
      }
    }

    // Evaluate each condition
    for (const condition of conditions) {
      const value = metrics[condition.metric] ?? 0;

      const met = this.compareValues(value, condition.operator, condition.value);

      if (met) {
        return true; // Trigger on first met condition (OR logic)
      }
    }

    return false;
  }

  /**
   * Compare values using an operator.
   */
  private compareValues(left: number, operator: string, right: number): boolean {
    switch (operator) {
      case 'gt':
        return left > right;
      case 'gte':
        return left >= right;
      case 'lt':
        return left < right;
      case 'lte':
        return left <= right;
      case 'eq':
        return left === right;
      case 'ne':
        return left !== right;
      default:
        return false;
    }
  }

  /**
   * Send webhook notification.
   */
  private async sendWebhook(webhookUrl: string, payload: Record<string, unknown>): Promise<boolean> {
    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10000),
      });

      return response.ok;
    } catch (err) {
      logger.warn('[ScheduledIntelligence] Webhook request failed', {
        webhookUrl,
        error: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  }

  /**
   * Persist schedules to storage (Redis or file).
   */
  private async persistSchedules(): Promise<void> {
    const data = Array.from(this.schedules.values());

    const client = this.redisClient as Record<string, unknown> | null | undefined;
    if (client && typeof client === 'object' && 'set' in client) {
      try {
        await (client['set'] as (key: string, value: string) => Promise<void>)('serval:schedules', JSON.stringify(data));
      } catch (err) {
        logger.warn('[ScheduledIntelligence] Redis persistence failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    } else {
      try {
        const fs = await import('fs/promises');
        const path = await import('path');
        const dir = path.dirname(this.persistencePath);
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(this.persistencePath, JSON.stringify(data, null, 2));
      } catch (err) {
        logger.warn('[ScheduledIntelligence] File persistence failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  /**
   * Load schedules from storage (Redis or file).
   */
  async loadSchedules(): Promise<void> {
    try {
      let data: ScheduleConfig[] = [];

      const client = this.redisClient as Record<string, unknown> | null | undefined;
      if (client && typeof client === 'object' && 'get' in client) {
        const stored = await (client['get'] as (key: string) => Promise<string | null>)('serval:schedules');
        if (stored) {
          data = JSON.parse(stored);
        }
      } else {
        try {
          const fs = await import('fs/promises');
          const content = await fs.readFile(this.persistencePath, 'utf-8');
          data = JSON.parse(content);
        } catch {
          // File doesn't exist yet, that's fine
        }
      }

      for (const schedule of data) {
        this.schedules.set(schedule.id, schedule);
      }

      logger.info('[ScheduledIntelligence] Loaded schedules', { count: data.length });
    } catch (err) {
      logger.error('[ScheduledIntelligence] Failed to load schedules', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
