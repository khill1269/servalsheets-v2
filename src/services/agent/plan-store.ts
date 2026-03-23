/**
 * Agent Engine — Plan Store
 *
 * In-memory plan store with encrypted disk persistence.
 * Max capacity: 100 plans (evicts oldest when full).
 */

import { writeFile, readFile, mkdir, unlink } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { logger } from '../../utils/logger.js';
import { encryptPlan, decryptPlan } from '../../utils/plan-crypto.js';
import type { PlanState } from './types.js';

// ============================================================================
// Plan storage directory
// ============================================================================

export const PLAN_STORAGE_DIR =
  process.env['AGENT_PLAN_DIR'] || path.join(process.cwd(), '.serval', 'plans');

export async function ensurePlanDir(): Promise<void> {
  if (!existsSync(PLAN_STORAGE_DIR)) {
    await mkdir(PLAN_STORAGE_DIR, { recursive: true });
  }
}

// ============================================================================
// In-memory store
// ============================================================================

export const planStore = new Map<string, PlanState>();
export const MAX_PLANS = 100;

export function evictOldestPlan(): void {
  if (planStore.size >= MAX_PLANS) {
    let oldest: { key: string; time: string } | null = null;
    for (const [key, plan] of planStore) {
      if (!oldest || plan.createdAt < oldest.time) {
        oldest = { key, time: plan.createdAt };
      }
    }
    if (oldest) {
      planStore.delete(oldest.key);
    }
  }
}

// ============================================================================
// Persistence
// ============================================================================

export async function persistPlan(plan: PlanState): Promise<void> {
  try {
    await ensurePlanDir();
    const filePath = path.join(PLAN_STORAGE_DIR, `${plan.planId}.json`);
    await writeFile(filePath, encryptPlan(JSON.stringify(plan, null, 2)), 'utf-8');
  } catch (err) {
    logger.debug('Failed to persist plan', {
      planId: plan.planId,
      error: err instanceof Error ? err.message : 'unknown',
    });
  }
}

export async function loadPersistedPlans(): Promise<void> {
  try {
    await ensurePlanDir();
    const { readdir } = await import('fs/promises');
    const files = await readdir(PLAN_STORAGE_DIR);
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      try {
        const raw = await readFile(path.join(PLAN_STORAGE_DIR, file), 'utf-8');
        const content = decryptPlan(raw);
        const plan = JSON.parse(content) as PlanState;
        if (plan.planId && !planStore.has(plan.planId)) {
          planStore.set(plan.planId, plan);
        }
      } catch {
        // Skip corrupt files
      }
    }
  } catch (err) {
    logger.debug('Failed to load persisted plans', {
      error: err instanceof Error ? err.message : 'unknown',
    });
  }
}

export async function deletePersistedPlan(planId: string): Promise<void> {
  try {
    const filePath = path.join(PLAN_STORAGE_DIR, `${planId}.json`);
    await unlink(filePath);
  } catch {
    // File may not exist
  }
}

/**
 * Initialize the plan store by loading previously persisted plans.
 * Call this during server startup.
 */
export async function initializePlanStore(): Promise<void> {
  await loadPersistedPlans();
}

/**
 * Persist plan state and update the in-memory store.
 */
export function persistPlanState(plan: PlanState): void {
  plan.updatedAt = new Date().toISOString();
  planStore.set(plan.planId, plan);
  persistPlan(plan).catch((persistErr: unknown) => {
    logger.warn('Failed to persist plan state', { planId: plan.planId, error: persistErr });
  });
}
