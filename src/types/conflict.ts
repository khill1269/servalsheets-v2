/**
 * ServalSheets - Conflict Detection Types
 *
 * Type definitions for conflict detection and resolution:
 * - Version tracking for ranges
 * - Conflict detection
 * - Resolution strategies
 * - Multi-user coordination
 *
 * Phase 4, Task 4.2
 */

import type { GoogleApiClient } from '../services/google-api.js';

/**
 * Conflict severity
 */
export type ConflictSeverity = 'info' | 'warning' | 'error' | 'critical';

/**
 * Conflict type
 */
export type ConflictType =
  | 'concurrent_modification'
  | 'stale_data'
  | 'overlapping_range'
  | 'deletion_conflict'
  | 'format_conflict'
  | 'formula_conflict';

/**
 * Resolution strategy
 */
export type ResolutionStrategy =
  | 'overwrite' // User's changes win
  | 'merge' // Attempt 3-way merge
  | 'cancel' // Discard user's changes
  | 'manual' // Require manual resolution
  | 'last_write_wins' // Most recent wins
  | 'first_write_wins'; // First wins

/**
 * Range version for tracking modifications
 */
export interface RangeVersion {
  /** Spreadsheet ID */
  spreadsheetId: string;

  /** Sheet name */
  sheetName?: string;

  /** Range (A1 notation) */
  range: string;

  /** Last modified timestamp */
  lastModified: number;

  /** Modified by (user email or ID) */
  modifiedBy: string;

  /** Content checksum */
  checksum: string;

  /** Version number */
  version: number;

  /** Metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Detected conflict
 */
export interface Conflict {
  /** Conflict ID */
  id: string;

  /** Conflict type */
  type: ConflictType;

  /** Severity */
  severity: ConflictSeverity;

  /** Spreadsheet ID */
  spreadsheetId: string;

  /** Sheet name */
  sheetName?: string;

  /** Affected range */
  range: string;

  /** Your version */
  yourVersion: RangeVersion;

  /** Current version (in spreadsheet) */
  currentVersion: RangeVersion;

  /** Time since modification */
  timeSinceModification: number;

  /** Modified by */
  modifiedBy: string;

  /** Conflict description */
  description: string;

  /** Suggested resolution */
  suggestedResolution: ResolutionStrategy;

  /** Alternative resolutions */
  alternativeResolutions: ResolutionStrategy[];

  /** Timestamp */
  timestamp: number;

  /** Auto-resolvable */
  autoResolvable: boolean;
}

/**
 * Conflict resolution request
 */
export interface ConflictResolution {
  /** Conflict ID */
  conflictId: string;

  /** Chosen strategy */
  strategy: ResolutionStrategy;

  /** Custom merge data (if strategy is 'merge') */
  mergeData?: unknown;

  /** Reason for resolution choice */
  reason?: string;

  /** User who resolved */
  resolvedBy?: string;
}

/**
 * Conflict resolution result
 */
export interface ConflictResolutionResult {
  /** Conflict ID */
  conflictId: string;

  /** Success */
  success: boolean;

  /** Strategy used */
  strategyUsed: ResolutionStrategy;

  /** Final version */
  finalVersion?: RangeVersion;

  /** Changes applied */
  changesApplied?: ChangeSet;

  /** Duration */
  duration: number;

  /** Error */
  error?: Error;
}

/**
 * Change set for merge operations
 */
export interface ChangeSet {
  /** Range affected */
  range: string;

  /** Cells added */
  added?: CellChange[];

  /** Cells modified */
  modified?: CellChange[];

  /** Cells deleted */
  deleted?: CellChange[];

  /** Total changes */
  totalChanges: number;
}

/**
 * Single cell change
 */
export interface CellChange {
  /** Cell reference (e.g., "A1") */
  cell: string;

  /** Old value */
  oldValue?: unknown;

  /** New value */
  newValue?: unknown;

  /** Change type */
  changeType: 'added' | 'modified' | 'deleted';
}

/**
 * Merge strategy configuration
 */
export interface MergeStrategy {
  /** Strategy name */
  name: string;

  /** Can handle conflict type */
  canHandle: (conflict: Conflict) => boolean;

  /** Perform merge */
  merge: (yourData: unknown, theirData: unknown, baseData?: unknown) => Promise<MergeResult>;
}

/**
 * Merge result
 */
export interface MergeResult {
  /** Success */
  success: boolean;

  /** Merged data */
  mergedData?: unknown;

  /** Conflicts remaining */
  conflictsRemaining?: Conflict[];

  /** Changes made */
  changes?: ChangeSet;

  /** Error */
  error?: Error;
}

/**
 * Version cache entry
 */
export interface VersionCacheEntry {
  /** Range version */
  version: RangeVersion;

  /** Cache timestamp */
  cachedAt: number;

  /** TTL (ms) */
  ttl: number;

  /** Access count */
  accessCount: number;
}

/**
 * Conflict detector configuration
 */
export interface ConflictDetectorConfig {
  /** Enable conflict detection */
  enabled?: boolean;

  /** Check conflicts before write operations */
  checkBeforeWrite?: boolean;

  /** Automatic conflict resolution */
  autoResolve?: boolean;

  /** Default resolution strategy */
  defaultResolution?: ResolutionStrategy;

  /** Version cache TTL (ms) */
  versionCacheTtl?: number;

  /** Maximum versions to cache */
  maxVersionsToCache?: number;

  /** Enable optimistic locking */
  optimisticLocking?: boolean;

  /** Conflict check timeout (ms) */
  conflictCheckTimeoutMs?: number;

  /** Verbose logging */
  verboseLogging?: boolean;

  /** Google API client for fetching current versions */
  googleClient?: GoogleApiClient;
}

/**
 * Conflict detector statistics
 */
export interface ConflictDetectorStats {
  /** Total conflict checks */
  totalChecks: number;

  /** Conflicts detected */
  conflictsDetected: number;

  /** Conflicts resolved */
  conflictsResolved: number;

  /** Conflicts auto-resolved */
  conflictsAutoResolved: number;

  /** Conflicts manually resolved */
  conflictsManuallyResolved: number;

  /** Conflict detection rate */
  detectionRate: number;

  /** Resolution success rate */
  resolutionSuccessRate: number;

  /** Average conflict resolution time */
  avgResolutionTime: number;

  /** Resolutions by strategy */
  resolutionsByStrategy: Record<ResolutionStrategy, number>;

  /** Cache hit rate */
  cacheHitRate: number;

  /** Versions tracked */
  versionsTracked: number;
}

/**
 * Lock for optimistic locking
 */
export interface OptimisticLock {
  /** Lock ID */
  id: string;

  /** Spreadsheet ID */
  spreadsheetId: string;

  /** Range */
  range: string;

  /** Expected version */
  expectedVersion: number;

  /** Lock holder */
  holder: string;

  /** Lock timestamp */
  timestamp: number;

  /** Expiry timestamp */
  expiresAt: number;
}

/**
 * Conflict notification
 */
export interface ConflictNotification {
  /** Notification ID */
  id: string;

  /** Conflict */
  conflict: Conflict;

  /** Recipient (user) */
  recipient: string;

  /** Sent timestamp */
  sentAt: number;

  /** Read */
  read: boolean;

  /** Resolved */
  resolved: boolean;
}

/**
 * User edit session
 */
export interface EditSession {
  /** Session ID */
  id: string;

  /** User */
  user: string;

  /** Spreadsheet ID */
  spreadsheetId: string;

  /** Ranges being edited */
  ranges: string[];

  /** Start time */
  startTime: number;

  /** Last activity */
  lastActivity: number;

  /** Active */
  active: boolean;
}

/**
 * Concurrent edit warning
 */
export interface ConcurrentEditWarning {
  /** Warning ID */
  id: string;

  /** Range */
  range: string;

  /** Other users editing */
  otherUsers: string[];

  /** Your session ID */
  yourSessionId: string;

  /** Severity */
  severity: 'info' | 'warning';

  /** Message */
  message: string;

  /** Timestamp */
  timestamp: number;
}
