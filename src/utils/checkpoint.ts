/**
 * ServalSheets - Checkpoint System
 *
 * Enables saving and restoring session state across context window resets.
 * When Claude's context fills up after ~100 tool calls, users can resume
 * from the last checkpoint instead of starting over.
 *
 * @module utils/checkpoint
 */

import fs from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { DEFAULT_CHECKPOINT_DIR, getEnv } from '../config/env.js';
import { logger } from './logger.js';
import { ConfigError } from '../core/errors.js';

// ============================================================================
// TYPES
// ============================================================================

export interface Checkpoint {
  sessionId: string;
  timestamp: number;
  createdAt: string;
  description?: string;
  completedSteps: number;
  completedOperations: string[];
  spreadsheetId?: string;
  spreadsheetTitle?: string;
  sheetNames?: string[];
  lastRange?: string;
  context: Record<string, unknown>;
  preferences?: Record<string, unknown>;
}

export interface CheckpointSummary {
  sessionId: string;
  timestamp: number;
  createdAt: string;
  description?: string;
  completedSteps: number;
  spreadsheetTitle?: string;
}

// ============================================================================
// CONFIGURATION
// ============================================================================

const MAX_CHECKPOINTS_PER_SESSION = 10;
const CHECKPOINT_FILE_EXTENSION = '.checkpoint.json';

function getCheckpointDir(): string {
  return getEnv().CHECKPOINT_DIR || DEFAULT_CHECKPOINT_DIR;
}

async function ensureCheckpointDir(): Promise<void> {
  const dir = getCheckpointDir();
  if (!existsSync(dir)) {
    await fs.mkdir(dir, { recursive: true });
    logger.info('Created checkpoint directory', { dir });
  }
}

export function isCheckpointsEnabled(): boolean {
  return getEnv().ENABLE_CHECKPOINTS;
}

// ============================================================================
// CHECKPOINT OPERATIONS
// ============================================================================

export async function saveCheckpoint(checkpoint: Checkpoint): Promise<string> {
  if (!isCheckpointsEnabled()) {
    throw new ConfigError(
      'Checkpoints disabled. Set ENABLE_CHECKPOINTS=true',
      'ENABLE_CHECKPOINTS'
    );
  }

  await ensureCheckpointDir();

  const filename = `${checkpoint.sessionId}-${checkpoint.timestamp}${CHECKPOINT_FILE_EXTENSION}`;
  const filepath = join(getCheckpointDir(), filename);

  const checkpointWithMeta: Checkpoint = {
    ...checkpoint,
    createdAt: new Date(checkpoint.timestamp).toISOString(),
  };

  await fs.writeFile(filepath, JSON.stringify(checkpointWithMeta, null, 2));

  logger.info('Checkpoint saved', {
    sessionId: checkpoint.sessionId,
    completedSteps: checkpoint.completedSteps,
  });

  await cleanupOldCheckpoints(checkpoint.sessionId);
  return filepath;
}

export async function loadCheckpoint(sessionId: string): Promise<Checkpoint | null> {
  if (!isCheckpointsEnabled()) return null;

  const checkpoints = await listCheckpointsForSession(sessionId);
  if (checkpoints.length === 0) return null;

  const sorted = checkpoints.sort((a, b) => b.timestamp - a.timestamp);
  const mostRecent = sorted[0]!; // Safe: we checked length > 0
  const filepath = join(
    getCheckpointDir(),
    `${sessionId}-${mostRecent.timestamp}${CHECKPOINT_FILE_EXTENSION}`
  );

  try {
    const data = await fs.readFile(filepath, 'utf-8');
    return JSON.parse(data) as Checkpoint;
  } catch (error) {
    logger.error('Failed to load checkpoint', { sessionId, error });
    return null;
  }
}

export async function loadCheckpointByTimestamp(
  sessionId: string,
  timestamp: number
): Promise<Checkpoint | null> {
  if (!isCheckpointsEnabled()) return null;

  const filepath = join(
    getCheckpointDir(),
    `${sessionId}-${timestamp}${CHECKPOINT_FILE_EXTENSION}`
  );

  if (!existsSync(filepath)) return null;

  try {
    const data = await fs.readFile(filepath, 'utf-8');
    return JSON.parse(data) as Checkpoint;
  } catch (error) {
    logger.error('Failed to load checkpoint', { sessionId, timestamp, error });
    return null;
  }
}

export async function listCheckpointsForSession(sessionId: string): Promise<CheckpointSummary[]> {
  if (!isCheckpointsEnabled()) return [];

  await ensureCheckpointDir();
  const dir = getCheckpointDir();

  try {
    const allFiles = await fs.readdir(dir);
    const files = allFiles.filter(
      (f) => f.startsWith(sessionId) && f.endsWith(CHECKPOINT_FILE_EXTENSION)
    );

    const summaries: CheckpointSummary[] = [];
    for (const filename of files) {
      const filepath = join(dir, filename);
      const content = await fs.readFile(filepath, 'utf-8');
      const data = JSON.parse(content) as Checkpoint;
      summaries.push({
        sessionId: data.sessionId,
        timestamp: data.timestamp,
        createdAt: data.createdAt,
        description: data.description,
        completedSteps: data.completedSteps,
        spreadsheetTitle: data.spreadsheetTitle,
      });
    }

    return summaries.sort((a, b) => b.timestamp - a.timestamp);
  } catch (error) {
    logger.error('Failed to list checkpoints for session', { sessionId, error });
    return [];
  }
}

export async function listAllCheckpoints(): Promise<CheckpointSummary[]> {
  if (!isCheckpointsEnabled()) return [];

  await ensureCheckpointDir();
  const dir = getCheckpointDir();

  try {
    const allFiles = await fs.readdir(dir);
    const files = allFiles.filter((f) => f.endsWith(CHECKPOINT_FILE_EXTENSION));

    const summaries: CheckpointSummary[] = [];
    for (const filename of files) {
      const filepath = join(dir, filename);
      const content = await fs.readFile(filepath, 'utf-8');
      const data = JSON.parse(content) as Checkpoint;
      summaries.push({
        sessionId: data.sessionId,
        timestamp: data.timestamp,
        createdAt: data.createdAt,
        description: data.description,
        completedSteps: data.completedSteps,
        spreadsheetTitle: data.spreadsheetTitle,
      });
    }

    return summaries.sort((a, b) => b.timestamp - a.timestamp);
  } catch (error) {
    logger.error('Failed to list all checkpoints', { error });
    return [];
  }
}

export async function deleteCheckpoint(sessionId: string, timestamp?: number): Promise<boolean> {
  if (!isCheckpointsEnabled()) return false;

  const dir = getCheckpointDir();

  if (timestamp) {
    const filepath = join(dir, `${sessionId}-${timestamp}${CHECKPOINT_FILE_EXTENSION}`);
    if (existsSync(filepath)) {
      await fs.unlink(filepath);
      return true;
    }
    return false;
  }

  // Delete all for session
  const allFiles = await fs.readdir(dir);
  const files = allFiles.filter(
    (f) => f.startsWith(sessionId) && f.endsWith(CHECKPOINT_FILE_EXTENSION)
  );

  for (const f of files) {
    await fs.unlink(join(dir, f));
  }
  return files.length > 0;
}

async function cleanupOldCheckpoints(sessionId: string): Promise<void> {
  const checkpoints = await listCheckpointsForSession(sessionId);

  if (checkpoints.length > MAX_CHECKPOINTS_PER_SESSION) {
    const toDelete = checkpoints.slice(MAX_CHECKPOINTS_PER_SESSION);
    for (const cp of toDelete) {
      await deleteCheckpoint(sessionId, cp.timestamp);
    }
    logger.debug('Cleaned up old checkpoints', {
      sessionId,
      deleted: toDelete.length,
    });
  }
}

// ============================================================================
// HELPER FOR AUTO-CHECKPOINT
// ============================================================================

let operationCounter = 0;
const AUTO_CHECKPOINT_INTERVAL = parseInt(process.env['AUTO_CHECKPOINT_INTERVAL'] || '25', 10);

export function shouldAutoCheckpoint(): boolean {
  if (!isCheckpointsEnabled()) return false;
  operationCounter++;
  return operationCounter % AUTO_CHECKPOINT_INTERVAL === 0;
}

export function getOperationCount(): number {
  return operationCounter;
}

export function resetOperationCounter(): void {
  operationCounter = 0;
}
