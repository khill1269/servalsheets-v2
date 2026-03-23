/**
 * Agent Engine — Checkpoints and Plan Queries
 *
 * Checkpoint creation, rollback, and plan query functions.
 * These are the observation/control plane operations for running plans.
 */

import { randomUUID } from 'crypto';
import { unlink } from 'fs/promises';
import path from 'path';
import { logger } from '../../utils/logger.js';
import { NotFoundError } from '../../core/errors.js';
import type { Checkpoint, PlanState, PlanStatus } from './types.js';
import {
  planStore,
  persistPlan,
  deletePersistedPlan,
  ensurePlanDir,
  PLAN_STORAGE_DIR,
} from './plan-store.js';

// ============================================================================
// Checkpoints
// ============================================================================

/**
 * Create an observation checkpoint at current plan state.
 */
export function createCheckpoint(
  planId: string,
  context?: string,
  snapshotId?: string
): Checkpoint {
  const plan = planStore.get(planId);
  if (!plan) {
    throw new NotFoundError('plan', planId);
  }

  const checkpoint: Checkpoint = {
    checkpointId: randomUUID(),
    planId,
    stepIndex: plan.currentStepIndex,
    context,
    timestamp: new Date().toISOString(),
    snapshotId,
  };

  plan.checkpoints.push(checkpoint);
  plan.updatedAt = new Date().toISOString();
  planStore.set(planId, plan);
  persistPlan(plan).catch((persistErr: unknown) => {
    logger.warn('Failed to persist plan state', { planId, error: persistErr });
  });

  return checkpoint;
}

/**
 * Revert plan state to a specific checkpoint.
 * Removes results after checkpoint and sets status to 'paused'.
 */
export function rollbackToPlan(planId: string, checkpointId: string): PlanState {
  const plan = planStore.get(planId);
  if (!plan) {
    throw new NotFoundError('plan', planId);
  }

  const checkpoint = plan.checkpoints.find((c) => c.checkpointId === checkpointId);
  if (!checkpoint) {
    throw new NotFoundError('checkpoint', `${checkpointId} in plan ${planId}`);
  }

  // Remove results after checkpoint
  const resultsToKeep = plan.results.filter((r) => {
    const stepIdx = plan.steps.findIndex((s) => s.stepId === r.stepId);
    return stepIdx < checkpoint.stepIndex;
  });

  plan.results = resultsToKeep;
  plan.currentStepIndex = checkpoint.stepIndex;
  plan.status = 'paused';
  plan.error = undefined;
  plan.updatedAt = new Date().toISOString();
  planStore.set(planId, plan);
  persistPlan(plan).catch((persistErr: unknown) => {
    logger.warn('Failed to persist plan state', { planId, error: persistErr });
  });

  return plan;
}

// ============================================================================
// Plan queries
// ============================================================================

/**
 * Get status of a specific plan.
 */
export function getPlanStatus(planId: string): PlanState | undefined {
  return planStore.get(planId);
}

/**
 * List all plans with optional filtering.
 */
export function listPlans(limit: number = 50, statusFilter?: PlanStatus): PlanState[] {
  const plans = Array.from(planStore.values());

  if (statusFilter) {
    return plans
      .filter((p) => p.status === statusFilter)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, limit);
  }

  return plans
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, limit);
}

// ============================================================================
// Plan deletion
// ============================================================================

/**
 * Delete a plan from the store.
 */
export function deletePlan(planId: string): boolean {
  const deleted = planStore.delete(planId);
  if (deleted) {
    deletePersistedPlan(planId).catch((err: unknown) => {
      logger.warn('Failed to delete persisted plan', { planId, error: err });
    });
  }
  return deleted;
}

/**
 * Clear all plans from the store.
 */
export async function clearAllPlans(): Promise<void> {
  planStore.clear();
  try {
    await ensurePlanDir();
    const { readdir } = await import('fs/promises');
    const files = await readdir(PLAN_STORAGE_DIR);
    for (const file of files) {
      if (file.endsWith('.json')) {
        await unlink(path.join(PLAN_STORAGE_DIR, file)).catch((err: unknown) => {
          logger.warn('Failed to delete plan file', { file, error: err });
        });
      }
    }
  } catch (err) {
    logger.debug('Failed to clear persisted plans', {
      error: err instanceof Error ? err.message : 'unknown',
    });
  }
}
