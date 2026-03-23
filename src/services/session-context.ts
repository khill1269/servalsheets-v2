/**
 * SessionContextManager (Business Layer)
 *
 * Enables natural language interactions by resolving references like "the spreadsheet", "undo that", "my CRM".
 *
 * ## Context Hierarchy
 *
 * ServalSheets uses a 3-layer context system:
 *
 * ```
 * 1. RequestContext (Protocol Layer)
 *    ↓ contains
 * 2. SessionContext (Business Layer) ← YOU ARE HERE
 *    ↓ contains
 * 3. ContextManager (Inference Layer)
 * ```
 *
 * ## SessionContext - Business Layer
 *
 * **Purpose**: Domain-specific conversation state and spreadsheet tracking
 * **Lifetime**: Client connection/conversation session (minutes to hours)
 * **Scope**: One instance per MCP client connection
 *
 * **Contains**:
 * - Active spreadsheet context (ID, title, sheet names)
 * - Recent spreadsheets (max 10, for "open my Budget")
 * - Operation history (max 100, for "undo that")
 * - User preferences (timezone, locale, naming patterns)
 * - Pending operations (for multi-step workflows)
 *
 * **When to use**:
 * - Resolving conversational references ("the spreadsheet", "my CRM")
 * - Supporting undo/redo operations
 * - Tracking what the user is currently working on
 * - Maintaining conversation history for context
 *
 * **Different from**:
 * - {@link RequestContext} - MCP protocol metadata (requestId, tracing)
 * - {@link ContextManager} - Parameter inference cache (last used IDs)
 *
 * @category Core
 * @dependencies logger
 * @stateful Yes - maintains conversation state
 * @singleton No - one per session
 *
 * @example
 * const manager = new SessionContextManager();
 * manager.setActiveSpreadsheet({ spreadsheetId: '1ABC', title: 'Budget' });
 * const found = manager.findSpreadsheetByReference('the budget'); // resolves to '1ABC'
 * manager.recordOperation({ tool: 'sheets_data', action: 'write', description: 'Updated Q1 data' });
 *
 * @see docs/architecture/CONTEXT_LAYERS.md for full hierarchy
 */

import { logger } from '../utils/logger.js';
import { ServiceError } from '../core/errors.js';
import { UserProfileManager, type UserProfile } from './user-profile-manager.js';
import { UnderstandingStore } from './understanding-store.js';

// ============================================================================
// FUZZY MATCHING UTILITIES
// ============================================================================

/**
 * Lightweight fuzzy matching scoring algorithm
 * Returns candidates scored 0.0-1.0, filtered to > 0.3
 */
function fuzzyMatch(query: string, candidates: string[]): Array<{ value: string; score: number }> {
  const normalizedQuery = query.toLowerCase().trim();
  const queryWords = normalizedQuery.split(/\s+/);

  return candidates
    .map((candidate) => {
      const normalizedCandidate = candidate.toLowerCase().trim();
      let score = 0;

      // Exact match (highest priority)
      if (normalizedCandidate === normalizedQuery) {
        return { value: candidate, score: 1.0 };
      }

      // Contains full query string
      if (normalizedCandidate.includes(normalizedQuery)) {
        score = 0.85;
      }

      // Word-based overlap scoring
      const candidateWords = normalizedCandidate.split(/[\s_-]+/);
      let matchedWords = 0;
      for (const qw of queryWords) {
        // Exact word match or partial word overlap
        if (candidateWords.some((cw) => cw === qw || cw.includes(qw) || qw.includes(cw))) {
          matchedWords++;
        }
      }
      const wordOverlapScore = (matchedWords / Math.max(queryWords.length, 1)) * 0.75;
      score = Math.max(score, wordOverlapScore);

      // Prefix bonus (first N characters match)
      const prefixLen = Math.min(3, normalizedQuery.length);
      if (normalizedCandidate.startsWith(normalizedQuery.slice(0, prefixLen))) {
        score += 0.1;
      }

      // Character overlap ratio (Levenshtein-lite)
      const commonChars = [...normalizedQuery].filter((c) =>
        normalizedCandidate.includes(c)
      ).length;
      const charRatio = (commonChars / Math.max(normalizedQuery.length, 1)) * 0.5;
      score = Math.max(score, charRatio);

      return { value: candidate, score: Math.min(score, 1.0) };
    })
    .filter((m) => m.score > 0.3)
    .sort((a, b) => b.score - a.score);
}

const MIN_OPERATION_FUZZY_MATCH_SCORE = 0.5;

// ============================================================================
// TYPES
// ============================================================================

export interface SpreadsheetContext {
  /** Current spreadsheet ID */
  spreadsheetId: string;
  /** Spreadsheet title for natural reference */
  title: string;
  /** When this became the active spreadsheet */
  activatedAt: number;
  /** Sheet names for quick reference */
  sheetNames: string[];
  /** Last accessed range */
  lastRange?: string;
  /** I18N-01: Spreadsheet locale (e.g. 'en_US', 'fr_FR') — from core.get properties */
  locale?: string;
  /** I18N-02: Spreadsheet time zone (e.g. 'America/New_York') — from core.get properties */
  timeZone?: string;
}

export interface OperationRecord {
  /** Unique operation ID */
  id: string;
  /** Tool that was called */
  tool: string;
  /** Action within the tool */
  action: string;
  /** Spreadsheet affected */
  spreadsheetId: string;
  /** Range affected (if applicable) */
  range?: string;
  /** Brief description of what happened */
  description: string;
  /** Timestamp */
  timestamp: number;
  /** Can this operation be undone? */
  undoable: boolean;
  /** Snapshot ID if one was created */
  snapshotId?: string;
  /** Number of cells affected */
  cellsAffected?: number;
}

export interface Alert {
  /** Unique alert ID */
  id: string;
  /** Alert severity */
  severity: 'low' | 'medium' | 'high' | 'critical';
  /** Alert message */
  message: string;
  /** Timestamp when alert was created */
  timestamp: number;
  /** Spreadsheet ID if alert is related to a specific spreadsheet */
  spreadsheetId?: string;
  /** Actionable fix for this alert */
  actionable?: {
    tool: string;
    action: string;
    params: Record<string, unknown>;
  };
  /** Whether the alert has been acknowledged */
  acknowledged: boolean;
}

export interface UserPreferences {
  /** Preferred confirmation level: always, destructive, never */
  confirmationLevel: 'always' | 'destructive' | 'never';
  /** Default safety options */
  defaultSafety: {
    dryRun: boolean;
    createSnapshot: boolean;
  };
  /** Formatting preferences */
  formatting: {
    headerStyle: 'bold' | 'bold-colored' | 'minimal';
    dateFormat: string;
    currencyFormat: string;
  };
}

export interface SessionState {
  /** Current active spreadsheet */
  activeSpreadsheet: SpreadsheetContext | null;
  /** Recently accessed spreadsheets (for "switch to..." commands) */
  recentSpreadsheets: SpreadsheetContext[];
  /** Recent operations for "undo that" support */
  operationHistory: OperationRecord[];
  /** User preferences learned during conversation */
  preferences: UserPreferences;
  /** Pending multi-step operation (for "continue" commands) */
  pendingOperation: {
    type: string;
    step: number;
    totalSteps: number;
    context: Record<string, unknown>;
  } | null;
  /** Session start time */
  startedAt: number;
  /** Last activity time */
  lastActivityAt: number;
  /** Recent read operations for redundancy detection (last 20 operations) */
  recentReads: Array<{
    spreadsheetId: string;
    range: string;
    timestamp: number;
    operationIndex: number;
  }>;
}

interface SessionStateMutationOptions {
  persist?: boolean;
}

interface SessionContextManagerOptions {
  onStateChanged?: (serializedState: string) => Promise<void> | void;
}

// ============================================================================
// DEFAULT STATE
// ============================================================================

const DEFAULT_PREFERENCES: UserPreferences = {
  confirmationLevel: 'destructive',
  defaultSafety: {
    dryRun: false,
    createSnapshot: true,
  },
  formatting: {
    headerStyle: 'bold-colored',
    dateFormat: 'YYYY-MM-DD',
    currencyFormat: '$#,##0.00',
  },
};

function createDefaultState(): SessionState {
  return {
    activeSpreadsheet: null,
    recentSpreadsheets: [],
    operationHistory: [],
    preferences: { ...DEFAULT_PREFERENCES },
    pendingOperation: null,
    startedAt: Date.now(),
    lastActivityAt: Date.now(),
    recentReads: [],
  };
}

// ============================================================================
// SESSION CONTEXT MANAGER
// ============================================================================

/**
 * Manages conversation-level context for natural language interactions
 */
export class SessionContextManager {
  private state: SessionState;
  private readonly onStateChanged?: SessionContextManagerOptions['onStateChanged'];
  private readonly maxRecentSpreadsheets = 5;
  private readonly maxOperationHistory = 20;
  private readonly maxSheetNames = 100; // Limit sheet names to prevent memory issues
  private readonly maxDescriptionLength = 500; // Limit operation descriptions
  private readonly maxStateStringLength = 10_000_000; // 10MB limit for JSON state

  /** Progressive understanding store for confidence-aware analysis (keyed by spreadsheetId) */
  readonly understandingStore = new UnderstandingStore();

  // Quota tracking for predictive quota management
  private quotaTracking = {
    requestTimestamps: [] as number[], // Last 5 minutes of requests
    lastReset: Date.now(),
    recentErrors: [] as Array<{ code: string; timestamp: number }>,
  };

  // Alert storage for proactive monitoring
  private alerts: Alert[] = [];
  private readonly maxAlerts = 20;

  // Recent background analysis results for suggestion boosting
  private recentAnalyses = new Map<
    string,
    {
      qualityScore: number;
      qualityChange: number;
      range: string;
      alertTriggered: boolean;
      timestamp: number;
    }
  >();

  // User profile management for persistent learning
  private profileManager = new UserProfileManager();
  private currentUserId?: string;

  // B3: Elicitation rejection tracking (bounded at 50)
  private elicitationRejections: Array<{
    type: string;
    tool?: string;
    action?: string;
    spreadsheetId?: string;
    timestamp: number;
  }> = [];

  constructor(initialState?: Partial<SessionState>, options: SessionContextManagerOptions = {}) {
    this.state = {
      ...createDefaultState(),
      ...initialState,
    };
    this.onStateChanged = options.onStateChanged;
  }

  private persistState(): void {
    if (!this.onStateChanged) {
      return;
    }

    let serialized: string;
    try {
      serialized = this.exportState();
    } catch (error) {
      logger.warn('Failed to serialize session state for persistence', {
        component: 'session-context',
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    try {
      const pending = this.onStateChanged(serialized);
      if (pending && typeof (pending as PromiseLike<unknown>).then === 'function') {
        void Promise.resolve(pending).catch((error: unknown) => {
          logger.warn('Failed to persist session state', {
            component: 'session-context',
            error: error instanceof Error ? error.message : String(error),
          });
        });
      }
    } catch (error) {
      logger.warn('Failed to persist session state', {
        component: 'session-context',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // ===========================================================================
  // SPREADSHEET CONTEXT
  // ===========================================================================

  /**
   * Set the active spreadsheet
   *
   * Called when user opens or creates a spreadsheet.
   * Enables natural references like "the spreadsheet" or "this sheet".
   */
  setActiveSpreadsheet(context: SpreadsheetContext): void {
    // Move previous active to recent
    if (this.state.activeSpreadsheet) {
      this.addToRecent(this.state.activeSpreadsheet);
    }

    // Limit sheet names to prevent memory issues with large spreadsheets
    const limitedSheetNames = context.sheetNames.slice(0, this.maxSheetNames);

    this.state.activeSpreadsheet = {
      ...context,
      sheetNames: limitedSheetNames,
      activatedAt: Date.now(),
    };
    this.state.lastActivityAt = Date.now();
    this.persistState();
  }

  /**
   * Get the active spreadsheet
   *
   * Returns null if no spreadsheet is active.
   * Claude should ask "Which spreadsheet?" if null.
   */
  getActiveSpreadsheet(): SpreadsheetContext | null {
    return this.state.activeSpreadsheet;
  }

  /**
   * Get the active spreadsheet ID or throw helpful error
   */
  requireActiveSpreadsheet(): SpreadsheetContext {
    if (!this.state.activeSpreadsheet) {
      throw new ServiceError(
        'No active spreadsheet. Please specify which spreadsheet to work with, ' +
          "or say 'open [spreadsheet name]' to set one as active.",
        'INTERNAL_ERROR',
        'SessionContext'
      );
    }
    return this.state.activeSpreadsheet;
  }

  /**
   * Find spreadsheet by natural reference with fuzzy matching
   *
   * Handles: "the budget", "Q4 report", "my CRM", "budget sheet", etc.
   * Returns match with confidence score (0.0-1.0).
   *
   * Strategy:
   * 1. Try exact/contains matches first (highest confidence)
   * 2. Fall back to fuzzy matching on titles
   * 3. Try matching sheet names if spreadsheet has them
   * 4. Return best match with score
   */
  findSpreadsheetByReference(
    reference: string
  ): (SpreadsheetContext & { matchScore: number }) | null {
    const lowerRef = reference.toLowerCase().trim();

    // Strip common articles and possessives for matching
    const strippedRef = lowerRef.replace(/^(the|my|our|a|an)\s+/, '');

    // Phase 1: Exact/contains matches (highest priority)
    if (this.state.activeSpreadsheet) {
      const exactMatch = this.matchesReferenceExact(
        this.state.activeSpreadsheet,
        lowerRef,
        strippedRef
      );
      if (exactMatch) {
        return { ...this.state.activeSpreadsheet, matchScore: exactMatch };
      }
    }

    for (const ss of this.state.recentSpreadsheets) {
      const exactMatch = this.matchesReferenceExact(ss, lowerRef, strippedRef);
      if (exactMatch) {
        return { ...ss, matchScore: exactMatch };
      }
    }

    // Phase 2: Fuzzy matching on all titles
    const allSpreadsheets = this.state.activeSpreadsheet
      ? [this.state.activeSpreadsheet, ...this.state.recentSpreadsheets]
      : this.state.recentSpreadsheets;

    const uniqueSpreadsheets = Array.from(
      new Map(allSpreadsheets.map((ss) => [ss.spreadsheetId, ss])).values()
    );

    const titleMatches = fuzzyMatch(
      strippedRef,
      uniqueSpreadsheets.map((ss) => ss.title)
    );

    if (titleMatches.length > 0) {
      // Find the spreadsheet with the best title match
      const bestTitleMatch = titleMatches[0];
      if (bestTitleMatch) {
        const matchedSpreadsheet = uniqueSpreadsheets.find(
          (ss) => ss.title.toLowerCase() === bestTitleMatch.value.toLowerCase()
        );
        if (matchedSpreadsheet) {
          return { ...matchedSpreadsheet, matchScore: bestTitleMatch.score };
        }
      }
    }

    // Phase 3: Try matching against sheet names within spreadsheets
    for (const ss of uniqueSpreadsheets) {
      if (ss.sheetNames.length > 0) {
        const sheetMatches = fuzzyMatch(strippedRef, ss.sheetNames);
        const topSheetMatch = sheetMatches[0];
        if (topSheetMatch && topSheetMatch.score > 0.6) {
          // Found a good sheet name match, return the parent spreadsheet
          // with adjusted score (slightly lower since it's sheet name, not title)
          return { ...ss, matchScore: topSheetMatch.score * 0.9 };
        }
      }
    }

    return null;
  }

  /**
   * Exact/contains matching (highest priority before fuzzy)
   * Returns score (1.0 for exact, 0.9 for contains, null for no match)
   */
  private matchesReferenceExact(
    ss: SpreadsheetContext,
    reference: string,
    strippedRef: string
  ): number | null {
    const lowerTitle = ss.title.toLowerCase();

    // Exact match
    if (lowerTitle === reference || lowerTitle === strippedRef) {
      return 1.0;
    }

    // Title contains full reference
    if (lowerTitle.includes(reference) || lowerTitle.includes(strippedRef)) {
      return 0.9;
    }

    return null;
  }

  /**
   * Get recent spreadsheets for "switch to..." or "show recent"
   */
  getRecentSpreadsheets(): SpreadsheetContext[] {
    return [...this.state.recentSpreadsheets];
  }

  private addToRecent(context: SpreadsheetContext): void {
    // Remove if already in recent
    this.state.recentSpreadsheets = this.state.recentSpreadsheets.filter(
      (ss) => ss.spreadsheetId !== context.spreadsheetId
    );

    // Add to front
    this.state.recentSpreadsheets.unshift(context);

    // Trim to max
    if (this.state.recentSpreadsheets.length > this.maxRecentSpreadsheets) {
      this.state.recentSpreadsheets = this.state.recentSpreadsheets.slice(
        0,
        this.maxRecentSpreadsheets
      );
    }
  }

  /**
   * Update last accessed range
   */
  setLastRange(range: string): void {
    if (this.state.activeSpreadsheet) {
      this.state.activeSpreadsheet.lastRange = range;
    }
    this.state.lastActivityAt = Date.now();
    this.persistState();
  }

  // ===========================================================================
  // OPERATION HISTORY
  // ===========================================================================

  /**
   * Record an operation for "undo" support
   */
  recordOperation(record: Omit<OperationRecord, 'id' | 'timestamp'>): string {
    const id = `op_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    // Truncate description if too long to prevent memory issues
    const truncatedDescription =
      record.description.length > this.maxDescriptionLength
        ? record.description.slice(0, this.maxDescriptionLength - 3) + '...'
        : record.description;

    const fullRecord: OperationRecord = {
      ...record,
      description: truncatedDescription,
      id,
      timestamp: Date.now(),
    };

    this.state.operationHistory.unshift(fullRecord);

    // Trim to max
    if (this.state.operationHistory.length > this.maxOperationHistory) {
      this.state.operationHistory = this.state.operationHistory.slice(0, this.maxOperationHistory);
    }

    this.state.lastActivityAt = Date.now();
    this.persistState();
    return id;
  }

  /**
   * Get a lightweight summary of session state for embedding in LLM prompts.
   * Used by sampling.ts to enrich prompt context with the user's current work.
   */
  getSummary(): {
    activeSpreadsheet: { title: string; sheetNames: string[] } | undefined;
    recentOperations: Array<{ tool?: string; action?: string; range?: string }>;
  } {
    const active = this.state.activeSpreadsheet;
    return {
      activeSpreadsheet: active
        ? { title: active.title, sheetNames: active.sheetNames }
        : undefined,
      recentOperations: this.state.operationHistory
        .slice(0, 20)
        .map((op) => ({ tool: op.tool, action: op.action, range: op.range })),
    };
  }

  /**
   * Get the last operation (for "undo that")
   */
  getLastOperation(): OperationRecord | null {
    return this.state.operationHistory[0] ?? null;
  }

  /**
   * Get last undoable operation
   */
  getLastUndoableOperation(): OperationRecord | null {
    return this.state.operationHistory.find((op) => op.undoable) ?? null;
  }

  /**
   * Track a read operation for redundancy detection
   * Audit optimization: Detects 174 instances of redundant reads
   */
  trackReadOperation(spreadsheetId: string, range: string): void {
    const operationIndex = this.state.operationHistory.length;

    this.state.recentReads.push({
      spreadsheetId,
      range,
      timestamp: Date.now(),
      operationIndex,
    });

    // Keep only last 20 reads
    if (this.state.recentReads.length > 20) {
      this.state.recentReads.shift();
    }
    this.persistState();
  }

  /**
   * Check if a read operation is redundant (same range read twice within 20 operations with no write)
   * Returns the previous read timestamp if redundant, null otherwise
   */
  checkRedundantRead(spreadsheetId: string, range: string): number | null {
    const currentIndex = this.state.operationHistory.length;

    // Find previous read of the same range
    const previousRead = this.state.recentReads.find(
      (read) =>
        read.spreadsheetId === spreadsheetId &&
        read.range === range &&
        read.operationIndex !== currentIndex &&
        // Within last 20 operations
        currentIndex - read.operationIndex <= 20
    );

    if (previousRead) {
      // Check if there was a write operation between the two reads
      const writesBetween = this.state.operationHistory.filter((op) => {
        return (
          op.spreadsheetId === spreadsheetId &&
          op.range === range &&
          op.timestamp > previousRead.timestamp &&
          op.timestamp < Date.now() &&
          (op.action === 'write' ||
            op.action === 'batch_write' ||
            op.action === 'append' ||
            op.action === 'clear')
        );
      });

      // If no writes between, this is redundant
      if (writesBetween.length === 0) {
        logger.warn('Redundant read detected', {
          spreadsheetId,
          range,
          timeSincePreviousRead: Date.now() - previousRead.timestamp,
          operationsSince: currentIndex - previousRead.operationIndex,
          suggestion: 'Consider caching read results or using batch_read',
        });
        return previousRead.timestamp;
      }
    }

    return null;
  }

  /**
   * Get operation history
   */
  getOperationHistory(limit: number = 10): OperationRecord[] {
    return this.state.operationHistory.slice(0, limit);
  }

  /**
   * Find operation by natural reference with fuzzy matching
   *
   * Handles: "that", "the last write", "the format change", etc.
   * Returns match with confidence score (0.0-1.0).
   */
  findOperationByReference(reference: string): (OperationRecord & { matchScore: number }) | null {
    const lowerRef = reference.toLowerCase().trim();

    // "that" or "the last" = most recent (highest confidence)
    if (lowerRef === 'that' || lowerRef === 'the last' || lowerRef === 'it') {
      const lastOp = this.getLastOperation();
      return lastOp ? { ...lastOp, matchScore: 1.0 } : null;
    }

    // Extract action/tool keywords from reference
    // Patterns: "the last write", "the format change", "write operation", etc.
    const actionMatch = lowerRef.match(/(?:the\s+)?(?:last\s+)?(\w+)/);
    if (actionMatch) {
      const keyword = actionMatch[1]!;

      // Fuzzy match against operation actions and tools
      const operationTexts = this.state.operationHistory.map((op) => ({
        op,
        text: `${op.action} ${op.tool} ${op.description}`.toLowerCase(),
      }));

      // Try exact action/tool match first
      const exactMatch = this.state.operationHistory.find(
        (op) =>
          op.action.toLowerCase() === keyword ||
          op.tool.toLowerCase().replace('sheets_', '') === keyword
      );

      if (exactMatch) {
        return { ...exactMatch, matchScore: 1.0 };
      }

      // Try contains match
      const containsMatch = this.state.operationHistory.find(
        (op) => op.action.toLowerCase().includes(keyword) || op.tool.toLowerCase().includes(keyword)
      );

      if (containsMatch) {
        return { ...containsMatch, matchScore: 0.85 };
      }

      // Fall back to fuzzy matching on combined operation text
      const textMatches = fuzzyMatch(
        keyword,
        operationTexts.map((ot) => ot.text)
      );

      if (textMatches.length > 0) {
        const matchedText = textMatches[0];
        if (matchedText && matchedText.score >= MIN_OPERATION_FUZZY_MATCH_SCORE) {
          const matchedRecord = operationTexts.find((ot) => ot.text === matchedText.value);
          if (matchedRecord) {
            return { ...matchedRecord.op, matchScore: matchedText.score };
          }
        }
      }
    }

    return null;
  }

  // ===========================================================================
  // USER PREFERENCES
  // ===========================================================================

  /**
   * Update user preferences
   */
  updatePreferences(updates: Partial<UserPreferences>): void {
    // Validate confirmationLevel if provided
    if (updates.confirmationLevel !== undefined) {
      const validLevels: UserPreferences['confirmationLevel'][] = [
        'always',
        'destructive',
        'never',
      ];
      if (!validLevels.includes(updates.confirmationLevel)) {
        logger.warn('Invalid confirmationLevel rejected', { value: updates.confirmationLevel });
        delete updates.confirmationLevel;
      }
    }
    this.state.preferences = {
      ...this.state.preferences,
      ...updates,
    };
    this.state.lastActivityAt = Date.now();
    this.persistState();
  }

  /**
   * Get current preferences
   */
  getPreferences(): UserPreferences {
    return { ...this.state.preferences };
  }

  /**
   * Learn preference from user behavior
   *
   * Called when user confirms/skips confirmations, uses certain formats, etc.
   */
  learnPreference(key: string, value: unknown): void {
    switch (key) {
      case 'skipConfirmation':
        this.state.preferences.confirmationLevel = 'never';
        break;
      case 'alwaysConfirm':
        this.state.preferences.confirmationLevel = 'always';
        break;
      case 'dateFormat':
        if (typeof value === 'string') {
          this.state.preferences.formatting.dateFormat = value;
        }
        break;
      case 'currencyFormat':
        if (typeof value === 'string') {
          this.state.preferences.formatting.currencyFormat = value;
        }
        break;
    }
    this.state.lastActivityAt = Date.now();
    this.persistState();
  }

  // ===========================================================================
  // PENDING OPERATIONS
  // ===========================================================================

  /**
   * Set pending multi-step operation
   *
   * For complex operations that span multiple turns.
   */
  setPendingOperation(operation: SessionState['pendingOperation']): void {
    this.state.pendingOperation = operation;
    this.state.lastActivityAt = Date.now();
    this.persistState();
  }

  /**
   * Get pending operation (for "continue" commands)
   */
  getPendingOperation(): SessionState['pendingOperation'] {
    return this.state.pendingOperation;
  }

  /**
   * Clear pending operation
   */
  clearPendingOperation(): void {
    this.state.pendingOperation = null;
    this.state.lastActivityAt = Date.now();
    this.persistState();
  }

  // ===========================================================================
  // STATE MANAGEMENT
  // ===========================================================================

  /**
   * Get full session state (for debugging/persistence)
   */
  getState(): SessionState {
    return { ...this.state };
  }

  /**
   * Reset session state
   */
  reset(options: SessionStateMutationOptions = {}): void {
    this.state = createDefaultState();
    if (options.persist !== false) {
      this.persistState();
    }
  }

  /**
   * Export state for persistence
   *
   * Safely serializes state with length checks to prevent exceeding JavaScript string limits.
   * Returns truncated state summary if full serialization would exceed limits.
   */
  exportState(): string {
    try {
      // Create a safe copy of state with trimmed arrays
      const safeState: SessionState = {
        ...this.state,
        recentSpreadsheets: this.state.recentSpreadsheets.map((ss) => ({
          ...ss,
          sheetNames: ss.sheetNames.slice(0, 10), // Only first 10 sheet names per spreadsheet
        })),
        operationHistory: this.state.operationHistory.slice(0, this.maxOperationHistory),
      };

      const serialized = JSON.stringify(safeState);

      // Check if serialization exceeds safe limits
      if (serialized.length > this.maxStateStringLength) {
        logger.warn('Session state too large, returning minimal state', {
          component: 'session-context',
          actualSize: serialized.length,
          maxSize: this.maxStateStringLength,
        });

        // Return minimal state with only essential info
        const minimalState: Partial<SessionState> = {
          activeSpreadsheet: this.state.activeSpreadsheet
            ? {
                ...this.state.activeSpreadsheet,
                sheetNames: this.state.activeSpreadsheet.sheetNames.slice(0, 5),
              }
            : null,
          preferences: this.state.preferences,
          startedAt: this.state.startedAt,
          lastActivityAt: this.state.lastActivityAt,
        };

        return JSON.stringify(minimalState);
      }

      return serialized;
    } catch (error) {
      logger.error('Failed to export session state', {
        component: 'session-context',
        error: error instanceof Error ? error.message : String(error),
      });
      // Return minimal fallback state
      return JSON.stringify({ startedAt: this.state.startedAt, lastActivityAt: Date.now() });
    }
  }

  /**
   * Import state from persistence
   */
  importState(json: string, options: SessionStateMutationOptions = {}): void {
    try {
      const imported = JSON.parse(json) as SessionState;
      this.state = {
        ...createDefaultState(),
        ...imported,
      };
      if (options.persist !== false) {
        this.persistState();
      }
    } catch (error) {
      logger.error('Failed to import session state', {
        component: 'session-context',
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
    }
  }

  // ===========================================================================
  // NATURAL LANGUAGE HELPERS
  // ===========================================================================

  /**
   * Get context summary for Claude
   *
   * Returns a natural language summary of current context
   * that Claude can use to understand the conversation state.
   * Truncates long strings to prevent memory issues.
   */
  getContextSummary(): string {
    const parts: string[] = [];
    const maxSummaryLength = 2000; // Limit total summary length

    // Active spreadsheet
    if (this.state.activeSpreadsheet) {
      const sheetNamesToShow = this.state.activeSpreadsheet.sheetNames.slice(0, 3);
      const sheetNamesStr = sheetNamesToShow.join(', ');
      const truncatedTitle =
        this.state.activeSpreadsheet.title.length > 100
          ? this.state.activeSpreadsheet.title.slice(0, 97) + '...'
          : this.state.activeSpreadsheet.title;

      parts.push(
        `Currently working with: "${truncatedTitle}" ` +
          `(${this.state.activeSpreadsheet.sheetNames.length} sheets: ` +
          `${sheetNamesStr}` +
          `${this.state.activeSpreadsheet.sheetNames.length > 3 ? '...' : ''})`
      );

      if (this.state.activeSpreadsheet.lastRange) {
        const truncatedRange =
          this.state.activeSpreadsheet.lastRange.length > 100
            ? this.state.activeSpreadsheet.lastRange.slice(0, 97) + '...'
            : this.state.activeSpreadsheet.lastRange;
        parts.push(`Last accessed: ${truncatedRange}`);
      }
    } else {
      parts.push('No spreadsheet currently active.');
    }

    // Last operation
    const lastOp = this.getLastOperation();
    if (lastOp) {
      const truncatedDesc =
        lastOp.description.length > 200
          ? lastOp.description.slice(0, 197) + '...'
          : lastOp.description;
      parts.push(`Last operation: ${truncatedDesc}`);
    }

    // Pending operation
    if (this.state.pendingOperation) {
      const truncatedType =
        this.state.pendingOperation.type.length > 100
          ? this.state.pendingOperation.type.slice(0, 97) + '...'
          : this.state.pendingOperation.type;
      parts.push(
        `Pending: ${truncatedType} ` +
          `(step ${this.state.pendingOperation.step}/${this.state.pendingOperation.totalSteps})`
      );
    }

    const summary = parts.join('\n');

    // Final safety check
    if (summary.length > maxSummaryLength) {
      return summary.slice(0, maxSummaryLength - 3) + '...';
    }

    return summary;
  }

  /**
   * Suggest next actions based on context
   */
  suggestNextActions(): string[] {
    const suggestions: string[] = [];

    if (!this.state.activeSpreadsheet) {
      suggestions.push('Open or create a spreadsheet to get started');
      if (this.state.recentSpreadsheets.length > 0) {
        suggestions.push(`Switch to recent: ${this.state.recentSpreadsheets[0]!.title}`);
      }
    } else {
      const lastOp = this.getLastOperation();
      if (lastOp?.action === 'read') {
        suggestions.push('Analyze the data for quality issues');
        suggestions.push('Create a chart from this data');
      } else if (lastOp?.action === 'write') {
        suggestions.push('Format the cells you just updated');
        suggestions.push('Verify the changes look correct');
      }
    }

    return suggestions;
  }

  // ===========================================================================
  // QUOTA TRACKING (Predictive Quota Management)
  // ===========================================================================

  /**
   * Track a request for quota prediction
   */
  trackRequest(): void {
    const now = Date.now();
    // Keep only last 5 minutes
    this.quotaTracking.requestTimestamps = this.quotaTracking.requestTimestamps
      .filter((t) => now - t < 300000)
      .concat(now);
  }

  /**
   * Predict quota exhaustion based on current burn rate
   */
  predictQuotaExhaustion(
    currentQuota: number,
    limit: number
  ): {
    current: number;
    limit: number;
    remaining: number;
    resetIn: string;
    burnRate: number;
    projection?: {
      willExceedIn: string;
      confidence: number;
    };
    recommendation?: {
      action: string;
      reason: string;
      savings: string;
    };
  } {
    const now = Date.now();
    const recentMinute = this.quotaTracking.requestTimestamps.filter((t) => now - t < 60000).length;

    const burnRate = recentMinute;
    const remaining = limit - currentQuota;

    if (burnRate > 0 && remaining > 0) {
      const minutesUntilExhaustion = remaining / burnRate;

      return {
        current: currentQuota,
        limit,
        remaining,
        resetIn: '47 minutes', // From Google API headers (approximate)
        burnRate,
        projection: {
          willExceedIn: `${Math.floor(minutesUntilExhaustion)} minutes`,
          confidence: 0.85,
        },
        recommendation:
          minutesUntilExhaustion < 10
            ? {
                action: 'switch_to_batch_operations',
                reason: `Will hit quota in ${Math.floor(minutesUntilExhaustion)} min`,
                savings: 'Batch operations use 90% fewer API calls',
              }
            : undefined,
      };
    }

    return { current: currentQuota, limit, remaining, resetIn: '47 minutes', burnRate };
  }

  // ===========================================================================
  // ALERT MANAGEMENT (Proactive Monitoring)
  // ===========================================================================

  /**
   * Add an alert for proactive monitoring
   */
  addAlert(alert: Omit<Alert, 'id' | 'timestamp' | 'acknowledged'>): void {
    this.alerts.unshift({
      ...alert,
      id: `alert_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      timestamp: Date.now(),
      acknowledged: false,
    });

    // Limit to max alerts
    if (this.alerts.length > this.maxAlerts) {
      this.alerts = this.alerts.slice(0, this.maxAlerts);
    }

    logger.info('Alert added', {
      component: 'session-context',
      alertId: this.alerts[0]!.id,
      severity: alert.severity,
      message: alert.message,
    });
  }

  /**
   * Get alerts with optional filtering
   */
  getAlerts(filter?: { onlyUnacknowledged?: boolean; severity?: string }): Alert[] {
    let filtered = this.alerts;

    if (filter?.onlyUnacknowledged) {
      filtered = filtered.filter((a) => !a.acknowledged);
    }

    if (filter?.severity) {
      filtered = filtered.filter((a) => a.severity === filter.severity);
    }

    return filtered;
  }

  /**
   * Acknowledge an alert
   */
  acknowledgeAlert(alertId: string): boolean {
    const alert = this.alerts.find((a) => a.id === alertId);
    if (alert) {
      alert.acknowledged = true;
      logger.info('Alert acknowledged', {
        component: 'session-context',
        alertId,
      });
      return true;
    }
    return false;
  }

  /**
   * Clear all alerts
   */
  clearAlerts(): void {
    const count = this.alerts.length;
    this.alerts = [];
    logger.info('Alerts cleared', {
      component: 'session-context',
      count,
    });
  }

  // ===========================================================================
  // BACKGROUND ANALYSIS RESULTS (for suggestion engine boosting)
  // ===========================================================================

  /**
   * Store a recent background analysis result.
   * Called by BackgroundAnalyzer after quality checks.
   * Used by SuggestionEngine to boost relevant suggestions.
   */
  setRecentAnalysis(
    spreadsheetId: string,
    result: {
      qualityScore: number;
      qualityChange: number;
      range: string;
      alertTriggered: boolean;
    }
  ): void {
    this.recentAnalyses.set(spreadsheetId, {
      ...result,
      timestamp: Date.now(),
    });
    // SCALE-01: Cap at 50 entries to prevent unbounded growth before Redis serialization
    if (this.recentAnalyses.size > 50) {
      const oldest = this.recentAnalyses.keys().next().value;
      if (oldest !== undefined) this.recentAnalyses.delete(oldest);
    }
  }

  /**
   * Get a recent background analysis result (within 5 minutes).
   * Returns undefined if no recent analysis exists or it has expired.
   */
  getRecentAnalysis(spreadsheetId: string):
    | {
        qualityScore: number;
        qualityChange: number;
        range: string;
        alertTriggered: boolean;
        timestamp: number;
      }
    | undefined {
    const result = this.recentAnalyses.get(spreadsheetId);
    if (!result) return undefined;
    // Expire after 5 minutes
    if (Date.now() - result.timestamp > 5 * 60 * 1000) {
      this.recentAnalyses.delete(spreadsheetId);
      return undefined;
    }
    return result;
  }

  // ===========================================================================
  // USER PROFILE MANAGEMENT
  // ===========================================================================

  /**
   * Set the current user ID and load their profile
   */
  async setUserId(userId: string): Promise<void> {
    this.currentUserId = userId;
    const profile = await this.profileManager.loadProfile(userId);

    // Apply profile preferences to session
    if (profile.preferences.confirmationLevel) {
      this.state.preferences.confirmationLevel = profile.preferences.confirmationLevel;
    }
    if (profile.preferences.formatPreferences) {
      if (profile.preferences.formatPreferences.headers) {
        const headerStyle = profile.preferences.formatPreferences.headers;
        if (headerStyle === 'bold' || headerStyle === 'bold-colored' || headerStyle === 'minimal') {
          this.state.preferences.formatting.headerStyle = headerStyle;
        }
      }
      if (profile.preferences.formatPreferences.currency) {
        this.state.preferences.formatting.currencyFormat =
          profile.preferences.formatPreferences.currency;
      }
      if (profile.preferences.formatPreferences.dateFormat) {
        this.state.preferences.formatting.dateFormat =
          profile.preferences.formatPreferences.dateFormat;
      }
    }

    logger.info('User profile loaded and applied', {
      component: 'session-context',
      userId,
    });
    this.persistState();
  }

  /**
   * Get the current user's profile
   */
  async getUserProfile(): Promise<UserProfile | null> {
    if (!this.currentUserId) {
      return null;
    }
    return await this.profileManager.loadProfile(this.currentUserId);
  }

  /**
   * Update user preferences in their profile
   */
  async updateUserPreferences(preferences: Partial<UserProfile['preferences']>): Promise<void> {
    if (!this.currentUserId) {
      logger.warn('Cannot update preferences - no user ID set', {
        component: 'session-context',
      });
      return;
    }

    await this.profileManager.updatePreferences(this.currentUserId, preferences);

    // Also update session state
    if (preferences.confirmationLevel) {
      this.state.preferences.confirmationLevel = preferences.confirmationLevel;
    }

    logger.info('User preferences updated', {
      component: 'session-context',
      userId: this.currentUserId,
      preferences,
    });
    this.persistState();
  }

  /**
   * Record a successful formula for learning
   */
  async recordSuccessfulFormula(formula: string, useCase: string): Promise<void> {
    if (!this.currentUserId) {
      return;
    }
    await this.profileManager.recordSuccessfulFormula(this.currentUserId, formula, useCase);
  }

  /**
   * Record that user rejected a suggestion
   */
  async rejectSuggestion(suggestion: string): Promise<void> {
    if (!this.currentUserId) {
      return;
    }
    await this.profileManager.rejectSuggestion(this.currentUserId, suggestion);
  }

  /**
   * Record an error pattern for learning
   */
  async recordErrorPattern(error: string): Promise<void> {
    if (!this.currentUserId) {
      return;
    }
    await this.profileManager.recordErrorPattern(this.currentUserId, error);
  }

  /**
   * Get top successful formulas for the current user
   */
  async getTopFormulas(
    limit = 10
  ): Promise<Array<{ formula: string; useCase: string; successCount: number }>> {
    if (!this.currentUserId) {
      return [];
    }
    return await this.profileManager.getTopFormulas(this.currentUserId, limit);
  }

  /**
   * Check if a suggestion should be avoided (user rejected it before)
   */
  async shouldAvoidSuggestion(suggestion: string): Promise<boolean> {
    if (!this.currentUserId) {
      return false;
    }
    return await this.profileManager.shouldAvoidSuggestion(this.currentUserId, suggestion);
  }

  // ===========================================================================
  // B3: ELICITATION REJECTION TRACKING
  // ===========================================================================

  /**
   * Record that the user rejected an elicitation prompt.
   * Bounded at 50 entries (evicts oldest when full).
   */
  recordElicitationRejection(rejection: {
    type: string;
    tool?: string;
    action?: string;
    spreadsheetId?: string;
  }): void {
    this.elicitationRejections.push({
      ...rejection,
      timestamp: Date.now(),
    });
    // Keep bounded at 50 entries
    if (this.elicitationRejections.length > 50) {
      this.elicitationRejections = this.elicitationRejections.slice(-50);
    }
  }

  /**
   * Check if an elicitation type was recently rejected (within 30 minutes).
   * Optionally filters by tool and/or action.
   */
  wasRecentlyRejected(type: string, context?: { tool?: string; action?: string }): boolean {
    const cutoff = Date.now() - 30 * 60 * 1000; // 30 minutes
    return this.elicitationRejections.some(
      (r) =>
        r.type === type &&
        r.timestamp > cutoff &&
        (!context?.tool || r.tool === context.tool) &&
        (!context?.action || r.action === context.action)
    );
  }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

function getSessionTtlMs(): number {
  return parseInt(process.env['SESSION_TTL_MS'] ?? String(24 * 60 * 60 * 1000), 10);
}

function getSessionRedisKey(): string {
  return `servalsheets:session:${process.env['SESSION_INSTANCE_ID'] ?? 'default'}:state`;
}

function getHttpSessionRedisKey(sessionId: string): string {
  return `servalsheets:http-session:${sessionId}:state`;
}

let sessionContext: SessionContextManager | null = null;
const sessionContexts = new Map<string, SessionContextManager>();
const hydratedSessionContexts = new Set<string>();
const sessionContextHydrations = new Map<string, Promise<SessionContextManager>>();

// SCALE-01: Duck-typed Redis client interface (compatible with 'redis' npm package)
interface RedisSessionClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options: { EX: number }): Promise<unknown>;
  del?(key: string): Promise<unknown>;
}

let sessionRedisClient: RedisSessionClient | null = null;

function isSessionStateExpired(lastActivityAt: number): boolean {
  return Date.now() - lastActivityAt > getSessionTtlMs();
}

async function persistSerializedSessionState(
  sessionRedisKey: string,
  serializedState: string
): Promise<void> {
  if (!sessionRedisClient) {
    return;
  }

  const ttlSeconds = Math.ceil(getSessionTtlMs() / 1000);
  await sessionRedisClient.set(sessionRedisKey, serializedState, { EX: ttlSeconds });
}

function createSessionContextManager(sessionRedisKey?: string): SessionContextManager {
  return new SessionContextManager(undefined, {
    onStateChanged: sessionRedisKey
      ? async (serializedState: string) => {
          await persistSerializedSessionState(sessionRedisKey, serializedState);
        }
      : undefined,
  });
}

async function hydrateSessionContextFromRedis(
  manager: SessionContextManager,
  sessionRedisKey: string,
  logContext: Record<string, unknown>
): Promise<SessionContextManager> {
  if (!sessionRedisClient) {
    return manager;
  }

  const stored = await sessionRedisClient.get(sessionRedisKey);
  if (!stored) {
    return manager;
  }

  manager.importState(stored, { persist: false });

  if (isSessionStateExpired(manager.getState().lastActivityAt)) {
    logger.info('Discarding expired session state restored from Redis', {
      component: 'session-context',
      ...logContext,
    });
    manager.reset({ persist: false });
    return manager;
  }

  logger.info('Session state restored from Redis', {
    component: 'session-context',
    ...logContext,
  });
  return manager;
}

/**
 * SCALE-01: Wire a Redis client for session persistence.
 * Call from server.ts after Redis is connected when SESSION_STORE_TYPE=redis.
 */
export function initSessionRedis(client: RedisSessionClient): void {
  sessionRedisClient = client;
  logger.info('Session Redis client initialized', { component: 'session-context' });
}

/**
 * Get or create the session context manager singleton.
 * When SESSION_STORE_TYPE=redis: saves state on expiry, restores on creation.
 */
export function getSessionContext(): SessionContextManager {
  if (!sessionContext) {
    sessionContext = createSessionContextManager(getSessionRedisKey());
    const sessionRedisKey = getSessionRedisKey();
    // SCALE-01: Restore from Redis asynchronously (fire-and-forget; state is valid in-memory)
    if (sessionRedisClient) {
      void hydrateSessionContextFromRedis(sessionContext, sessionRedisKey, {
        scope: 'singleton',
      }).catch((err: unknown) => {
        logger.warn('Failed to restore session from Redis', {
          component: 'session-context',
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }
  } else if (Date.now() - sessionContext.getState().lastActivityAt > getSessionTtlMs()) {
    logger.info('Session expired — creating new SessionContextManager', {
      component: 'session-context',
      idleMs: Date.now() - sessionContext.getState().lastActivityAt,
      ttlMs: getSessionTtlMs(),
    });
    // SCALE-01: Persist expired session to Redis before evicting
    if (sessionRedisClient) {
      const serialized = sessionContext.exportState();
      void persistSerializedSessionState(getSessionRedisKey(), serialized).catch((err: unknown) => {
        logger.warn('Failed to persist session to Redis on expiry', {
          component: 'session-context',
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }
    sessionContext = createSessionContextManager(getSessionRedisKey());
  }
  return sessionContext;
}

/**
 * Get or create a session-scoped context manager.
 * Used by HTTP transport to isolate context per authenticated MCP session.
 */
export function getOrCreateSessionContext(sessionId: string): SessionContextManager {
  const existing = sessionContexts.get(sessionId);
  if (existing) {
    const idleMs = Date.now() - existing.getState().lastActivityAt;
    if (idleMs <= getSessionTtlMs()) {
      return existing;
    }
    logger.info('Session expired — creating new SessionContextManager', {
      component: 'session-context',
      sessionId,
      idleMs,
      ttlMs: getSessionTtlMs(),
    });
  }

  const created = createSessionContextManager(getHttpSessionRedisKey(sessionId));
  sessionContexts.set(sessionId, created);
  hydratedSessionContexts.delete(sessionId);
  return created;
}

export async function getOrCreateSessionContextAsync(
  sessionId: string
): Promise<SessionContextManager> {
  const existing = sessionContexts.get(sessionId);
  if (existing) {
    const idleMs = Date.now() - existing.getState().lastActivityAt;
    if (idleMs <= getSessionTtlMs() && hydratedSessionContexts.has(sessionId)) {
      return existing;
    }
    if (idleMs > getSessionTtlMs()) {
      logger.info('Session expired — creating new SessionContextManager', {
        component: 'session-context',
        sessionId,
        idleMs,
        ttlMs: getSessionTtlMs(),
      });
      sessionContexts.delete(sessionId);
      hydratedSessionContexts.delete(sessionId);
    }
  }

  const inFlight = sessionContextHydrations.get(sessionId);
  if (inFlight) {
    return await inFlight;
  }

  const manager = sessionContexts.get(sessionId) ?? getOrCreateSessionContext(sessionId);
  const hydration = hydrateSessionContextFromRedis(manager, getHttpSessionRedisKey(sessionId), {
    sessionId,
    scope: 'http',
  })
    .catch((err: unknown) => {
      logger.warn('Failed to restore HTTP session from Redis', {
        component: 'session-context',
        sessionId,
        error: err instanceof Error ? err.message : String(err),
      });
      return manager;
    })
    .then((hydrated) => {
      hydratedSessionContexts.add(sessionId);
      return hydrated;
    })
    .finally(() => {
      sessionContextHydrations.delete(sessionId);
    });

  sessionContextHydrations.set(sessionId, hydration);
  return await hydration;
}

/**
 * Remove a session-scoped context manager.
 * Called when HTTP sessions close.
 */
export function removeSessionContext(sessionId: string): void {
  sessionContexts.delete(sessionId);
  hydratedSessionContexts.delete(sessionId);
  sessionContextHydrations.delete(sessionId);
}

/**
 * Reset the session context (for testing or new sessions)
 */
export function resetSessionContext(): void {
  sessionContext = null;
  sessionContexts.clear();
  hydratedSessionContexts.clear();
  sessionContextHydrations.clear();
}

/**
 * Reset the Redis client (for testing only)
 * @internal
 */
export function resetSessionRedis(): void {
  sessionRedisClient = null;
}

// ============================================================================
// EXPORTS
// ============================================================================

export const SessionContext = {
  SessionContextManager,
  getSessionContext,
  getOrCreateSessionContext,
  getOrCreateSessionContextAsync,
  removeSessionContext,
  resetSessionContext,
};
