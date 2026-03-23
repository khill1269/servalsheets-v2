/**
 * ServalSheets - Understanding Store
 *
 * Progressive understanding accumulator that tracks and evolves
 * the AI's knowledge of a spreadsheet across multiple interactions.
 *
 * The store maintains a living model of the spreadsheet that grows
 * through the Profile → Hypothesize → Score → Question → Consolidate cycle:
 *
 * 1. PROFILE: Initial scout/analysis captures baseline understanding
 * 2. HYPOTHESIZE: System generates hypotheses about data purpose/patterns
 * 3. SCORE: ConfidenceScorer assesses certainty of understanding
 * 4. QUESTION: ElicitationEngine generates questions for low-confidence areas
 * 5. CONSOLIDATE: User answers are integrated, model is updated
 *
 * The store persists within a session and can be serialized for
 * cross-session persistence via the session context manager.
 *
 * MCP Protocol: 2025-11-25
 */

import { logger } from '../utils/logger.js';
import type { SemanticIndex } from '../analysis/workbook-semantics.js';
import { BoundedCache } from '../utils/bounded-cache.js';
import { NotFoundError } from '../core/errors.js';

/**
 * Local confidence interfaces used by the store.
 * These are structurally compatible with analysis/confidence-scorer outputs,
 * but intentionally defined here to keep service-layer boundaries clean.
 */
export interface ConfidenceEvidence {
  observation: string;
  weight: number;
  direction: 'positive' | 'negative' | 'neutral';
  source: string;
}

export interface DimensionScore {
  dimension: string;
  score: number;
  level: string;
  evidence: ConfidenceEvidence[];
  gaps: string[];
  suggestedQuestions: string[];
}

export interface ConfidenceAssessment {
  spreadsheetId: string;
  overallScore: number;
  overallLevel: string;
  dimensions: DimensionScore[];
  topGaps: Array<{
    dimension: string;
    gap: string;
    impactOnConfidence: number;
    question: string;
  }>;
  dataTier: number;
  assessedAt: number;
}

export interface UserProvidedContext {
  businessDomain?: string;
  intent?: string;
  headerDescriptions?: Record<string, string>;
  sheetRelationships?: string;
  dataQualityExpectations?: string;
  keyColumns?: string[];
  freeformContext?: string;
}

// ============================================================================
// TYPES
// ============================================================================

/**
 * A hypothesis about the spreadsheet
 */
export interface DataHypothesis {
  id: string;
  /** What we believe about the data */
  claim: string;
  /** Confidence in this hypothesis (0-100) */
  confidence: number;
  /** Evidence supporting this hypothesis */
  evidence: string[];
  /** Evidence against */
  counterEvidence: string[];
  /** What data area this applies to */
  scope: 'spreadsheet' | 'sheet' | 'column' | 'range';
  /** Specific target */
  target?: string;
  /** When this was first generated */
  createdAt: number;
  /** When last updated */
  updatedAt: number;
  /** Status */
  status: 'active' | 'confirmed' | 'rejected' | 'superseded';
}

/**
 * Understanding evolution entry - tracks how understanding changed
 */
export interface UnderstandingEvent {
  timestamp: number;
  /** What triggered this update */
  trigger: 'scout' | 'comprehensive' | 'user_answer' | 'drill_down' | 'action_result';
  /** Confidence before */
  confidenceBefore: number;
  /** Confidence after */
  confidenceAfter: number;
  /** What changed */
  changes: string[];
  /** Hypotheses added, confirmed, or rejected */
  hypothesisChanges?: Array<{
    hypothesisId: string;
    action: 'created' | 'confirmed' | 'rejected' | 'updated';
  }>;
}

/**
 * Sheet-specific understanding
 */
export interface SheetUnderstanding {
  sheetId: number;
  title: string;
  /** Detected purpose */
  purpose?: string;
  /** Column descriptions (accumulated) */
  columnDescriptions: Record<number, string>;
  /** Detected data patterns */
  patterns: string[];
  /** Known issues */
  issues: string[];
  /** Key columns (identifiers) */
  keyColumns: number[];
}

/**
 * Complete understanding model for a spreadsheet
 */
export interface SpreadsheetUnderstanding {
  spreadsheetId: string;
  title: string;

  /** Business domain */
  domain?: string;
  /** User's stated purpose */
  userIntent?: string;
  /** Detected/inferred purpose */
  inferredPurpose?: string;

  /** Per-sheet understanding */
  sheets: SheetUnderstanding[];

  /** Active hypotheses */
  hypotheses: DataHypothesis[];

  /** Latest confidence assessment */
  latestConfidence: ConfidenceAssessment | null;

  /** User-provided context (accumulated) */
  userContext: UserProvidedContext;

  /** Understanding evolution timeline */
  evolution: UnderstandingEvent[];

  /** Analysis depth reached */
  maxTierReached: number;

  /** Timestamps */
  createdAt: number;
  lastUpdatedAt: number;

  /** Interaction count */
  interactionCount: number;

  /** Semantic classification of the workbook (type, key entities, relationships) */
  semanticIndex?: SemanticIndex;
}

// ============================================================================
// UNDERSTANDING STORE
// ============================================================================

/**
 * Manages progressive understanding of spreadsheets
 */
export class UnderstandingStore {
  /** In-memory store keyed by spreadsheetId */
  private store = new BoundedCache<string, SpreadsheetUnderstanding>({
    maxSize: 200,
    ttl: 60 * 60 * 1000,
  });
  private hypothesisCounter = 0;

  /**
   * Initialize understanding from a scout result
   */
  initFromScout(
    spreadsheetId: string,
    title: string,
    sheets: Array<{ sheetId: number; title: string }>,
    confidence: ConfidenceAssessment
  ): SpreadsheetUnderstanding {
    const existing = this.store.get(spreadsheetId);
    if (existing) {
      // Update existing
      return this.updateConfidence(spreadsheetId, confidence, 'scout');
    }

    const understanding: SpreadsheetUnderstanding = {
      spreadsheetId,
      title,
      sheets: sheets.map((s) => ({
        sheetId: s.sheetId,
        title: s.title,
        columnDescriptions: {},
        patterns: [],
        issues: [],
        keyColumns: [],
      })),
      hypotheses: [],
      latestConfidence: confidence,
      userContext: {},
      evolution: [
        {
          timestamp: Date.now(),
          trigger: 'scout',
          confidenceBefore: 0,
          confidenceAfter: confidence.overallScore,
          changes: ['Initial understanding from scout analysis'],
        },
      ],
      maxTierReached: 2,
      createdAt: Date.now(),
      lastUpdatedAt: Date.now(),
      interactionCount: 1,
    };

    // Generate initial hypotheses from confidence assessment
    const hypotheses = this.generateInitialHypotheses(confidence);
    understanding.hypotheses = hypotheses;

    this.store.set(spreadsheetId, understanding);

    logger.info('UnderstandingStore: Initialized', {
      spreadsheetId,
      sheetCount: sheets.length,
      confidence: confidence.overallScore,
      hypothesisCount: hypotheses.length,
    });

    return understanding;
  }

  /**
   * Update understanding with comprehensive analysis results
   */
  updateFromComprehensive(
    spreadsheetId: string,
    confidence: ConfidenceAssessment,
    analysisDetails?: {
      detectedDomain?: string;
      patterns?: string[];
      issues?: string[];
      columnTypes?: Array<{ index: number; header: string | null; type: string }>;
    }
  ): SpreadsheetUnderstanding {
    let understanding = this.store.get(spreadsheetId);
    if (!understanding) {
      // Auto-init if not yet created
      understanding = this.initFromScout(spreadsheetId, '', [], confidence);
    }

    const prevConfidence = understanding.latestConfidence?.overallScore ?? 0;
    understanding.latestConfidence = confidence;
    understanding.maxTierReached = Math.max(understanding.maxTierReached, 4);
    understanding.lastUpdatedAt = Date.now();
    understanding.interactionCount++;

    const changes: string[] = ['Comprehensive analysis completed'];

    if (analysisDetails) {
      if (analysisDetails.detectedDomain) {
        understanding.inferredPurpose = analysisDetails.detectedDomain;
        changes.push(`Detected domain: ${analysisDetails.detectedDomain}`);
      }

      if (analysisDetails.patterns) {
        for (const sheet of understanding.sheets) {
          sheet.patterns = [...new Set([...sheet.patterns, ...(analysisDetails.patterns || [])])];
        }
        changes.push(`Found ${analysisDetails.patterns.length} data patterns`);
      }

      if (analysisDetails.issues) {
        for (const sheet of understanding.sheets) {
          sheet.issues = [...new Set([...sheet.issues, ...(analysisDetails.issues || [])])];
        }
        changes.push(`Found ${analysisDetails.issues.length} data issues`);
      }

      if (analysisDetails.columnTypes) {
        for (const col of analysisDetails.columnTypes) {
          for (const sheet of understanding.sheets) {
            if (col.header) {
              sheet.columnDescriptions[col.index] =
                sheet.columnDescriptions[col.index] || `${col.header} (${col.type})`;
            }
          }
        }
      }
    }

    // Update hypotheses
    this.updateHypotheses(understanding, confidence);

    understanding.evolution.push({
      timestamp: Date.now(),
      trigger: 'comprehensive',
      confidenceBefore: prevConfidence,
      confidenceAfter: confidence.overallScore,
      changes,
    });

    this.store.set(spreadsheetId, understanding);
    return understanding;
  }

  /**
   * Integrate user answers from elicitation
   */
  integrateUserAnswers(
    spreadsheetId: string,
    confidence: ConfidenceAssessment,
    context: UserProvidedContext
  ): SpreadsheetUnderstanding {
    const understanding = this.store.get(spreadsheetId);
    if (!understanding) {
      throw new NotFoundError('understanding', spreadsheetId);
    }

    const prevConfidence = understanding.latestConfidence?.overallScore ?? 0;
    understanding.latestConfidence = confidence;
    understanding.lastUpdatedAt = Date.now();
    understanding.interactionCount++;

    const changes: string[] = [];

    // Merge user context
    if (context.businessDomain) {
      understanding.domain = context.businessDomain;
      changes.push(`User confirmed domain: ${context.businessDomain}`);
    }
    if (context.intent) {
      understanding.userIntent = context.intent;
      changes.push(`User stated intent: ${context.intent}`);
    }
    if (context.headerDescriptions) {
      for (const [col, desc] of Object.entries(context.headerDescriptions)) {
        changes.push(`User described column "${col}": ${desc}`);
      }
    }
    if (context.keyColumns) {
      for (const sheet of understanding.sheets) {
        const newKeys = context.keyColumns
          .map((name) => {
            const idx = Object.entries(sheet.columnDescriptions).find(([, desc]) =>
              desc.toLowerCase().includes(name.toLowerCase())
            );
            return idx ? parseInt(idx[0]) : -1;
          })
          .filter((i) => i >= 0);
        sheet.keyColumns = [...new Set([...sheet.keyColumns, ...newKeys])];
      }
      changes.push(`User identified key columns: ${context.keyColumns.join(', ')}`);
    }

    // Merge all context
    understanding.userContext = {
      ...understanding.userContext,
      ...context,
      freeformContext: [understanding.userContext.freeformContext, context.freeformContext]
        .filter(Boolean)
        .join(' '),
    };

    // Update hypotheses based on user input
    this.confirmHypothesesFromUserInput(understanding, context);

    understanding.evolution.push({
      timestamp: Date.now(),
      trigger: 'user_answer',
      confidenceBefore: prevConfidence,
      confidenceAfter: confidence.overallScore,
      changes,
    });

    this.store.set(spreadsheetId, understanding);
    return understanding;
  }

  /**
   * Get current understanding for a spreadsheet
   */
  get(spreadsheetId: string): SpreadsheetUnderstanding | undefined {
    return this.store.get(spreadsheetId);
  }

  /**
   * Get a summary of understanding suitable for inclusion in tool responses
   */
  getSummary(spreadsheetId: string): UnderstandingSummary | undefined {
    const understanding = this.store.get(spreadsheetId);
    if (!understanding) return undefined;

    return {
      spreadsheetId,
      title: understanding.title,
      domain: understanding.domain,
      userIntent: understanding.userIntent,
      inferredPurpose: understanding.inferredPurpose,
      confidenceScore: understanding.latestConfidence?.overallScore ?? 0,
      confidenceLevel: understanding.latestConfidence?.overallLevel ?? 'none',
      topGaps: understanding.latestConfidence?.topGaps.map((g) => g.gap).slice(0, 3) ?? [],
      activeHypotheses: understanding.hypotheses
        .filter((h) => h.status === 'active')
        .map((h) => ({ claim: h.claim, confidence: h.confidence })),
      interactionCount: understanding.interactionCount,
      maxTierReached: understanding.maxTierReached,
    };
  }

  /**
   * Update the semantic index built from comprehensive analysis
   */
  updateSemanticIndex(spreadsheetId: string, index: SemanticIndex): void {
    const understanding = this.store.get(spreadsheetId);
    if (!understanding) return;
    understanding.semanticIndex = index;
    understanding.inferredPurpose = understanding.inferredPurpose ?? index.workbookType;
    understanding.lastUpdatedAt = Date.now();
    this.store.set(spreadsheetId, understanding);
    logger.info('UnderstandingStore: Semantic index updated', {
      spreadsheetId,
      workbookType: index.workbookType,
      confidence: index.workbookTypeConfidence,
    });
  }

  /**
   * Serialize understanding for session persistence
   */
  serialize(spreadsheetId: string): string | undefined {
    const understanding = this.store.get(spreadsheetId);
    if (!understanding) return undefined;
    return JSON.stringify(understanding);
  }

  /**
   * Restore understanding from serialized data
   */
  restore(data: string): void {
    try {
      const understanding = JSON.parse(data) as SpreadsheetUnderstanding;
      if (understanding.spreadsheetId) {
        this.store.set(understanding.spreadsheetId, understanding);
        logger.info('UnderstandingStore: Restored', {
          spreadsheetId: understanding.spreadsheetId,
          interactionCount: understanding.interactionCount,
        });
      }
    } catch {
      logger.warn('UnderstandingStore: Failed to restore understanding data');
    }
  }

  /**
   * Clear understanding for a spreadsheet
   */
  clear(spreadsheetId: string): void {
    this.store.delete(spreadsheetId);
  }

  /**
   * List all tracked spreadsheets
   */
  listTracked(): string[] {
    return Array.from(this.store.keys());
  }

  // ==========================================================================
  // HYPOTHESIS MANAGEMENT
  // ==========================================================================

  private generateInitialHypotheses(confidence: ConfidenceAssessment): DataHypothesis[] {
    const hypotheses: DataHypothesis[] = [];

    // Generate hypotheses from dimension evidence
    for (const dim of confidence.dimensions) {
      for (const ev of dim.evidence) {
        if (ev.direction === 'positive' && ev.weight > 0.2) {
          hypotheses.push({
            id: `hyp_${++this.hypothesisCounter}`,
            claim: ev.observation,
            confidence: Math.round(ev.weight * 100),
            evidence: [ev.observation],
            counterEvidence: [],
            scope: 'spreadsheet',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            status: 'active',
          });
        }
      }
    }

    return hypotheses;
  }

  private updateHypotheses(
    understanding: SpreadsheetUnderstanding,
    confidence: ConfidenceAssessment
  ): void {
    // Increase confidence on hypotheses that align with new evidence
    for (const hyp of understanding.hypotheses) {
      if (hyp.status !== 'active') continue;

      for (const dim of confidence.dimensions) {
        for (const ev of dim.evidence) {
          if (
            ev.direction === 'positive' &&
            ev.observation.toLowerCase().includes(hyp.claim.toLowerCase().split(' ')[0] ?? '')
          ) {
            hyp.confidence = Math.min(100, hyp.confidence + 10);
            hyp.updatedAt = Date.now();
            if (!hyp.evidence.includes(ev.observation)) {
              hyp.evidence.push(ev.observation);
            }
          }
        }
      }

      // Auto-confirm high confidence hypotheses
      if (hyp.confidence >= 85) {
        hyp.status = 'confirmed';
      }
    }
  }

  private confirmHypothesesFromUserInput(
    understanding: SpreadsheetUnderstanding,
    context: UserProvidedContext
  ): void {
    const contextText = [
      context.businessDomain,
      context.intent,
      context.freeformContext,
      context.sheetRelationships,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    for (const hyp of understanding.hypotheses) {
      if (hyp.status !== 'active') continue;

      const claimWords = hyp.claim.toLowerCase().split(/\s+/);
      const matches = claimWords.filter((w) => w.length > 3 && contextText.includes(w));

      if (matches.length >= 2) {
        hyp.confidence = Math.min(100, hyp.confidence + 20);
        hyp.evidence.push('User confirmation aligns with hypothesis');
        hyp.updatedAt = Date.now();
        if (hyp.confidence >= 80) {
          hyp.status = 'confirmed';
        }
      }
    }
  }

  private updateConfidence(
    spreadsheetId: string,
    confidence: ConfidenceAssessment,
    trigger: UnderstandingEvent['trigger']
  ): SpreadsheetUnderstanding {
    const understanding = this.store.get(spreadsheetId)!;
    const prevConfidence = understanding.latestConfidence?.overallScore ?? 0;

    understanding.latestConfidence = confidence;
    understanding.lastUpdatedAt = Date.now();
    understanding.interactionCount++;

    understanding.evolution.push({
      timestamp: Date.now(),
      trigger,
      confidenceBefore: prevConfidence,
      confidenceAfter: confidence.overallScore,
      changes: [`Updated from ${trigger}`],
    });

    this.store.set(spreadsheetId, understanding);
    return understanding;
  }
}

// ============================================================================
// EXPORTED SUMMARY TYPE
// ============================================================================

export interface UnderstandingSummary {
  spreadsheetId: string;
  title: string;
  domain?: string;
  userIntent?: string;
  inferredPurpose?: string;
  confidenceScore: number;
  confidenceLevel: string;
  topGaps: string[];
  activeHypotheses: Array<{ claim: string; confidence: number }>;
  interactionCount: number;
  maxTierReached: number;
}
