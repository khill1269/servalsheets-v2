/**
 * ServalSheets - Scheduler Service
 *
 * Provides cron-based scheduled workflow execution with disk persistence.
 * Jobs survive server restarts and are re-registered on restore.
 *
 * @module services/scheduler
 */

import cron from 'node-cron';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { dirname } from 'path';
import { randomUUID } from 'crypto';
import { logger } from '../utils/logger.js';
import { ValidationError, NotFoundError } from '../core/errors.js';

export interface ScheduledJob {
  id: string;
  spreadsheetId: string;
  cronExpression: string;
  description: string;
  action: { tool: string; actionName: string; params: Record<string, unknown> };
  enabled: boolean;
  lastRun?: string;
  lastRunResult?: 'success' | 'error';
  createdAt: string;
}

type DispatchFn = (job: ScheduledJob) => Promise<void>;

export class SchedulerService {
  private jobs = new Map<string, { task: ReturnType<typeof cron.schedule>; job: ScheduledJob }>();
  private persistPath: string;
  private dispatchFn: DispatchFn;

  constructor(dataDir: string, dispatchFn: DispatchFn) {
    this.persistPath = `${dataDir}/schedules.json`;
    this.dispatchFn = dispatchFn;
    this.restore();
  }

  private restore(): void {
    try {
      if (!existsSync(this.persistPath)) return;
      const raw = readFileSync(this.persistPath, 'utf-8');
      const savedJobs = JSON.parse(raw) as ScheduledJob[];
      for (const job of savedJobs) {
        if (job.enabled) {
          this.registerCronJob(job);
        } else {
          this.jobs.set(job.id, { task: null as unknown as ReturnType<typeof cron.schedule>, job });
        }
      }
      logger.info('Scheduler restored jobs from disk', { count: savedJobs.length });
    } catch (err) {
      logger.warn('Failed to restore scheduler state', { error: String(err) });
    }
  }

  private persist(): void {
    try {
      const dir = dirname(this.persistPath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      const allJobs = Array.from(this.jobs.values()).map((e) => e.job);
      writeFileSync(this.persistPath, JSON.stringify(allJobs, null, 2), 'utf-8');
    } catch (err) {
      logger.warn('Failed to persist scheduler state', { error: String(err) });
    }
  }

  private registerCronJob(job: ScheduledJob): void {
    if (!cron.validate(job.cronExpression)) {
      logger.warn('Invalid cron expression, skipping', { id: job.id, expr: job.cronExpression });
      return;
    }
    const task = cron.schedule(job.cronExpression, async () => {
      logger.info('Running scheduled job', { id: job.id, description: job.description });
      const entry = this.jobs.get(job.id);
      if (!entry) return;
      try {
        await this.dispatchFn(job);
        entry.job.lastRun = new Date().toISOString();
        entry.job.lastRunResult = 'success';
      } catch (err) {
        logger.error('Scheduled job failed', { id: job.id, error: String(err) });
        entry.job.lastRun = new Date().toISOString();
        entry.job.lastRunResult = 'error';
      }
      this.persist();
    });
    this.jobs.set(job.id, { task, job });
  }

  async create(jobData: Omit<ScheduledJob, 'id' | 'createdAt'>): Promise<ScheduledJob> {
    if (!cron.validate(jobData.cronExpression)) {
      throw new ValidationError(
        `Invalid cron expression: ${jobData.cronExpression}`,
        'cronExpression'
      );
    }
    const job: ScheduledJob = {
      ...jobData,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
    };
    this.registerCronJob(job);
    this.persist();
    return job;
  }

  async cancel(jobId: string): Promise<void> {
    const entry = this.jobs.get(jobId);
    if (!entry) throw new NotFoundError('scheduled job', jobId);
    if (entry.task) entry.task.stop();
    this.jobs.delete(jobId);
    this.persist();
  }

  list(spreadsheetId?: string): ScheduledJob[] {
    const all = Array.from(this.jobs.values()).map((e) => e.job);
    return spreadsheetId ? all.filter((j) => j.spreadsheetId === spreadsheetId) : all;
  }

  async runNow(jobId: string): Promise<void> {
    const entry = this.jobs.get(jobId);
    if (!entry) throw new NotFoundError('scheduled job', jobId);
    await this.dispatchFn(entry.job);
    entry.job.lastRun = new Date().toISOString();
    entry.job.lastRunResult = 'success';
    this.persist();
  }

  /**
   * Stop all scheduled tasks and persist current state.
   */
  dispose(): void {
    for (const entry of this.jobs.values()) {
      if (entry.task) {
        entry.task.stop();
      }
    }
    this.persist();
  }
}
