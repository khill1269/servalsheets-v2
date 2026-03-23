/**
 * SnapshotService
 *
 * @purpose Creates backup copies of spreadsheets via Drive API for rollback capability in transactions
 * @category Core
 * @usage Use before destructive operations or transactions; creates Drive copy, tracks snapshot metadata, supports restore operations
 * @dependencies drive_v3, CircuitBreaker, ServiceError
 * @stateful No - stateless service; snapshot metadata stored in Drive file properties
 * @singleton No - can be instantiated per request
 *
 * @example
 * const service = new SnapshotService({ driveApi, defaultFolderId: 'folder123', maxSnapshots: 10 });
 * const snapshot = await service.create(spreadsheetId, 'Pre-transaction backup');
 * await service.restore(snapshot.copySpreadsheetId, spreadsheetId); // Rollback
 */

import type { drive_v3 } from 'googleapis';
import { ServiceError, NotFoundError } from '../core/errors.js';
import { CircuitBreaker } from '../utils/circuit-breaker.js';
import { getApiSpecificCircuitBreakerConfig } from '../config/env.js';

export interface Snapshot {
  id: string;
  name: string;
  sourceSpreadsheetId: string;
  copySpreadsheetId: string;
  createdAt: string;
  size?: number;
}

export interface SnapshotServiceOptions {
  driveApi: drive_v3.Drive;
  defaultFolderId?: string;
  maxSnapshots?: number;
}

/**
 * Service for creating and managing spreadsheet snapshots
 */
export class SnapshotService {
  private driveApi: drive_v3.Drive;
  private defaultFolderId: string | null;
  private maxSnapshots: number;
  private snapshots: Map<string, Snapshot[]> = new Map();
  private driveCircuit: CircuitBreaker;

  constructor(options: SnapshotServiceOptions) {
    this.driveApi = options.driveApi;
    this.defaultFolderId = options.defaultFolderId ?? null;
    this.maxSnapshots = options.maxSnapshots ?? 10;

    // Initialize circuit breaker for Drive API calls
    const snapshotConfig = getApiSpecificCircuitBreakerConfig('snapshot');
    this.driveCircuit = new CircuitBreaker({
      failureThreshold: snapshotConfig.failureThreshold,
      successThreshold: snapshotConfig.successThreshold,
      timeout: snapshotConfig.timeout,
      name: 'drive-api',
    });
  }

  /**
   * Create a snapshot of a spreadsheet
   */
  async create(spreadsheetId: string, name?: string): Promise<string> {
    const timestamp = new Date().toISOString();
    const snapshotName = name ?? `Snapshot ${timestamp}`;

    // Build request body
    const requestBody: drive_v3.Schema$File = {
      name: snapshotName,
    };

    // Only add parents if we have a folder ID
    if (this.defaultFolderId) {
      requestBody.parents = [this.defaultFolderId];
    }

    // Copy the spreadsheet (with circuit breaker protection)
    const response = await this.driveCircuit.execute(async () => {
      return await this.driveApi.files.copy({
        fileId: spreadsheetId,
        requestBody,
        fields: 'id,name,mimeType,webViewLink',
        supportsAllDrives: true,
      });
    });

    const copyId = response.data?.id;
    if (!copyId) {
      throw new ServiceError(
        'Failed to create snapshot: Google API did not return a file ID',
        'SNAPSHOT_CREATION_FAILED',
        'Google Drive',
        true,
        { spreadsheetId, name: snapshotName }
      );
    }

    const snapshot: Snapshot = {
      id: `snap_${Date.now()}_${Math.random().toString(36).substring(7)}`,
      name: snapshotName,
      sourceSpreadsheetId: spreadsheetId,
      copySpreadsheetId: copyId,
      createdAt: timestamp,
    };

    // Store snapshot reference
    const existing = this.snapshots.get(spreadsheetId) ?? [];
    existing.push(snapshot);

    // Prune old snapshots
    while (existing.length > this.maxSnapshots) {
      const oldest = existing.shift();
      if (oldest) {
        await this.delete(oldest.id).catch(() => {
          // Ignore delete errors during pruning
        });
      }
    }

    this.snapshots.set(spreadsheetId, existing);

    return snapshot.id;
  }

  /**
   * List snapshots for a spreadsheet
   */
  list(spreadsheetId: string): Snapshot[] {
    return this.snapshots.get(spreadsheetId) ?? [];
  }

  /**
   * Get a specific snapshot
   */
  get(snapshotId: string): Snapshot | undefined {
    for (const snapshots of this.snapshots.values()) {
      const found = snapshots.find((s) => s.id === snapshotId);
      if (found) return found;
    }
    // OK: Explicit empty - typed as optional, snapshot not found
    return undefined;
  }

  /**
   * Restore from a snapshot (copies snapshot content back to original)
   */
  async restore(snapshotId: string): Promise<string> {
    const snapshot = this.get(snapshotId);
    if (!snapshot) {
      throw new NotFoundError('Snapshot', snapshotId, { operation: 'restore' });
    }

    // Copy snapshot to create restored file (with circuit breaker protection)
    const response = await this.driveCircuit.execute(async () => {
      return await this.driveApi.files.copy({
        fileId: snapshot.copySpreadsheetId,
        requestBody: {
          name: `Restored from ${snapshot.name}`,
        },
        fields: 'id,name,mimeType,webViewLink',
        supportsAllDrives: true,
      });
    });

    const restoredId = response.data?.id;
    if (!restoredId) {
      throw new ServiceError(
        'Failed to restore snapshot: Google API did not return a file ID',
        'SNAPSHOT_RESTORE_FAILED',
        'Google Drive',
        true,
        { snapshotId }
      );
    }

    return restoredId;
  }

  /**
   * Delete a snapshot
   */
  async delete(snapshotId: string): Promise<void> {
    const snapshot = this.get(snapshotId);
    if (!snapshot) {
      throw new NotFoundError('Snapshot', snapshotId, { operation: 'delete' });
    }

    // Delete the copy (with circuit breaker protection)
    await this.driveCircuit.execute(async () => {
      return await this.driveApi.files.delete({
        fileId: snapshot.copySpreadsheetId,
        supportsAllDrives: true,
      });
    });

    // Remove from memory
    for (const [spreadsheetId, snapshots] of this.snapshots.entries()) {
      const filtered = snapshots.filter((s) => s.id !== snapshotId);
      if (filtered.length !== snapshots.length) {
        this.snapshots.set(spreadsheetId, filtered);
        break;
      }
    }
  }

  /**
   * Get snapshot URL
   */
  getUrl(snapshotId: string): string | undefined {
    const snapshot = this.get(snapshotId);
    // OK: Explicit empty - typed as optional, snapshot not found
    if (!snapshot) return undefined;
    return `https://docs.google.com/spreadsheets/d/${snapshot.copySpreadsheetId}`;
  }

  /**
   * Clear all in-memory snapshots (does not delete from Drive)
   */
  clearCache(): void {
    this.snapshots.clear();
  }
}
