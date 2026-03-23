/**
 * ServalSheets - Confidence Scoring Engine
 *
 * Multi-layer confidence scoring for spreadsheet understanding.
 * Provides granular confidence metrics across 4 dimensions:
 *
 * 1. STRUCTURE - Headers, layout, sheet organization
 * 2. CONTENT - Data types, patterns, distributions, quality
 * 3. RELATIONSHIPS - Cross-column correlations, formulas, references
 * 4. PURPOSE - Business context, use case, domain detection
 *
 * Confidence scores drive two key behaviors:
 * - LOW confidence triggers elicitation questions (via ElicitationEngine)
 * - HIGH confidence enables autonomous action generation
 *
 * Scoring uses a Bayesian-inspired approach: prior beliefs from structure
 * are updated by evidence from data analysis, creating posterior confidence.
 *
 * MCP Protocol: 2025-11-25
 */

import { logger } from '../utils/logger.js';
import type { ScoutResult, ColumnTypeInfo } from './scout.js';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Confidence dimension - the four layers of understanding
 */
export type ConfidenceDimension = 'structure' | 'content' | 'relationships' | 'purpose';

/**
 * Confidence level thresholds
 */
export type ConfidenceLevel = 'none' | 'low' | 'moderate' | 'high' | 'very_high';

/**
 * Individual evidence contributing to confidence
 */
export interface ConfidenceEvidence {
  /** What was observed */
  observation: string;
  /** Weight of this evidence (0-1) */
  weight: number;
  /** Whether this is positive (increases confidence) or negative (decreases) */
  direction: 'positive' | 'negative' | 'neutral';
  /** Source of the evidence */
  source: 'metadata' | 'structure' | 'data_sample' | 'full_data' | 'user_input' | 'inference';
}

/**
 * Per-dimension confidence score with evidence trail
 */
export interface DimensionScore {
  dimension: ConfidenceDimension;
  score: number; // 0-100
  level: ConfidenceLevel;
  evidence: ConfidenceEvidence[];
  /** What's missing that would increase confidence */
  gaps: string[];
  /** What questions could fill the gaps */
  suggestedQuestions: string[];
}

/**
 * Per-column confidence breakdown
 */
export interface ColumnConfidence {
  columnIndex: number;
  header: string | null;
  typeConfidence: number; // How sure we are about the data type
  purposeConfidence: number; // How sure we are about what this column represents
  qualityConfidence: number; // How sure we are about the data quality assessment
  overallConfidence: number;
  gaps: string[];
}

/**
 * Complete confidence assessment for a spreadsheet
 */
export interface ConfidenceAssessment {
  /** Spreadsheet being assessed */
  spreadsheetId: string;
  /** Overall confidence (weighted average of dimensions) */
  overallScore: number;
  overallLevel: ConfidenceLevel;
  /** Per-dimension breakdown */
  dimensions: DimensionScore[];
  /** Per-column breakdown (for active sheet) */
  columns?: ColumnConfidence[];
  /** Whether we should ask the user questions */
  shouldElicit: boolean;
  /** Priority-ordered gaps across all dimensions */
  topGaps: Array<{
    dimension: ConfidenceDimension;
    gap: string;
    impactOnConfidence: number; // How much filling this gap would increase score
    question: string;
  }>;
  /** What analysis tier was used to generate this */
  dataTier: number;
  /** Timestamp */
  assessedAt: number;
}

// ============================================================================
// THRESHOLDS
// ============================================================================

const CONFIDENCE_THRESHOLDS: Record<ConfidenceLevel, [number, number]> = {
  none: [0, 10],
  low: [10, 35],
  moderate: [35, 65],
  high: [65, 85],
  very_high: [85, 100],
};

/** Dimension weights for overall score */
const DIMENSION_WEIGHTS: Record<ConfidenceDimension, number> = {
  structure: 0.3,
  content: 0.3,
  relationships: 0.2,
  purpose: 0.2,
};

/** Threshold below which we should ask questions */
const ELICITATION_THRESHOLD = 55;

// ============================================================================
// SCORER
// ============================================================================

/**
 * Multi-layer confidence scorer for spreadsheet understanding
 */
export class ConfidenceScorer {
  /**
   * Score confidence from a scout result (Tier 1-2 data)
   */
  scoreFromScout(scoutResult: ScoutResult): ConfidenceAssessment {
    const startTime = Date.now();

    logger.info('ConfidenceScorer: Scoring from scout result', {
      spreadsheetId: scoutResult.spreadsheetId,
      sheetCount: scoutResult.sheets.length,
    });

    const dimensions: DimensionScore[] = [
      this.scoreStructure(scoutResult),
      this.scoreContentFromScout(scoutResult),
      this.scoreRelationshipsFromScout(scoutResult),
      this.scorePurposeFromScout(scoutResult),
    ];

    const columns = scoutResult.columnTypes
      ? this.scoreColumnsFromScout(scoutResult.columnTypes)
      : undefined;

    return this.buildAssessment(scoutResult.spreadsheetId, dimensions, columns, 2, startTime);
  }

  /**
   * Score confidence from comprehensive analysis result
   */
  scoreFromComprehensive(
    spreadsheetId: string,
    analysisResult: ComprehensiveAnalysisData
  ): ConfidenceAssessment {
    const startTime = Date.now();

    logger.info('ConfidenceScorer: Scoring from comprehensive analysis', { spreadsheetId });

    const dimensions: DimensionScore[] = [
      this.scoreStructureFromComprehensive(analysisResult),
      this.scoreContentFromComprehensive(analysisResult),
      this.scoreRelationshipsFromComprehensive(analysisResult),
      this.scorePurposeFromComprehensive(analysisResult),
    ];

    const columns = analysisResult.columns
      ? this.scoreColumnsFromComprehensive(analysisResult.columns)
      : undefined;

    return this.buildAssessment(spreadsheetId, dimensions, columns, 4, startTime);
  }

  /**
   * Update assessment with user-provided context
   */
  updateWithUserInput(
    existing: ConfidenceAssessment,
    userContext: UserProvidedContext
  ): ConfidenceAssessment {
    const startTime = Date.now();

    logger.info('ConfidenceScorer: Updating with user context', {
      spreadsheetId: existing.spreadsheetId,
      contextKeys: Object.keys(userContext),
    });

    const updatedDimensions = existing.dimensions.map((dim) => {
      const updates = this.getUpdatesForDimension(dim.dimension, userContext);
      if (updates.length === 0) return dim;

      const newEvidence = [...dim.evidence, ...updates];
      const newScore = this.calculateDimensionScore(newEvidence);
      const filledGaps = dim.gaps.filter((gap) =>
        updates.some((u) =>
          u.observation.toLowerCase().includes(gap.toLowerCase().split(' ')[0] ?? '')
        )
      );
      const remainingGaps = dim.gaps.filter((g) => !filledGaps.includes(g));

      return {
        ...dim,
        score: newScore,
        level: this.scoreToLevel(newScore),
        evidence: newEvidence,
        gaps: remainingGaps,
        suggestedQuestions: dim.suggestedQuestions.slice(filledGaps.length),
      };
    });

    return this.buildAssessment(
      existing.spreadsheetId,
      updatedDimensions,
      existing.columns,
      existing.dataTier,
      startTime
    );
  }

  // ==========================================================================
  // STRUCTURE SCORING
  // ==========================================================================

  private scoreStructure(scout: ScoutResult): DimensionScore {
    const evidence: ConfidenceEvidence[] = [];
    const gaps: string[] = [];
    const questions: string[] = [];

    // Sheet count evidence
    if (scout.sheets.length > 0) {
      evidence.push({
        observation: `Found ${scout.sheets.length} sheet(s) with metadata`,
        weight: 0.3,
        direction: 'positive',
        source: 'metadata',
      });
    }

    // Size estimation
    const totalCells = scout.indicators.estimatedCells;
    if (totalCells > 0) {
      evidence.push({
        observation: `Estimated ${totalCells} cells across sheets`,
        weight: 0.2,
        direction: 'positive',
        source: 'metadata',
      });
    } else {
      evidence.push({
        observation: 'Empty spreadsheet - no data detected',
        weight: 0.5,
        direction: 'negative',
        source: 'metadata',
      });
    }

    // Column types detected
    if (scout.columnTypes && scout.columnTypes.length > 0) {
      const headered = scout.columnTypes.filter((c) => c.header !== null);
      const headerRatio = headered.length / scout.columnTypes.length;

      evidence.push({
        observation: `${headered.length}/${scout.columnTypes.length} columns have headers`,
        weight: 0.3,
        direction: headerRatio > 0.8 ? 'positive' : headerRatio > 0.3 ? 'neutral' : 'negative',
        source: 'structure',
      });

      if (headerRatio < 0.5) {
        gaps.push('Many columns lack headers');
        questions.push('Can you describe what each column in the spreadsheet represents?');
      }
    } else {
      gaps.push('Column types not yet detected');
      questions.push('What kind of data does this spreadsheet contain?');
    }

    // Multi-sheet organization
    if (scout.sheets.length > 3) {
      gaps.push('Multi-sheet organization unclear');
      questions.push('How are the different sheets in this spreadsheet related?');
    }

    // Complexity hints
    if (scout.indicators.complexityScore > 60) {
      evidence.push({
        observation: `High complexity score (${scout.indicators.complexityScore}/100)`,
        weight: 0.15,
        direction: 'neutral',
        source: 'structure',
      });
      gaps.push('Complex structure needs deeper analysis');
    }

    return this.buildDimensionScore('structure', evidence, gaps, questions);
  }

  private scoreStructureFromComprehensive(data: ComprehensiveAnalysisData): DimensionScore {
    const evidence: ConfidenceEvidence[] = [];
    const gaps: string[] = [];
    const questions: string[] = [];

    // We have full structure data
    evidence.push({
      observation: 'Full structure analysis completed',
      weight: 0.4,
      direction: 'positive',
      source: 'full_data',
    });

    // Header quality
    if (data.headerQuality !== undefined) {
      evidence.push({
        observation: `Header quality: ${data.headerQuality > 0.8 ? 'good' : data.headerQuality > 0.5 ? 'moderate' : 'poor'}`,
        weight: 0.3,
        direction: data.headerQuality > 0.7 ? 'positive' : 'negative',
        source: 'full_data',
      });
    }

    // Data validation presence
    if (data.hasDataValidation) {
      evidence.push({
        observation: 'Data validation rules found - structured input expected',
        weight: 0.2,
        direction: 'positive',
        source: 'full_data',
      });
    }

    // Formatting consistency
    if (data.formatConsistency !== undefined) {
      evidence.push({
        observation: `Format consistency: ${Math.round(data.formatConsistency * 100)}%`,
        weight: 0.2,
        direction: data.formatConsistency > 0.7 ? 'positive' : 'negative',
        source: 'full_data',
      });
    }

    if (!data.hasDataValidation && data.columns && data.columns.length > 5) {
      gaps.push('No data validation despite many columns');
      questions.push(
        'Are there specific valid values or ranges for any columns in this spreadsheet?'
      );
    }

    return this.buildDimensionScore('structure', evidence, gaps, questions);
  }

  // ==========================================================================
  // CONTENT SCORING
  // ==========================================================================

  private scoreContentFromScout(scout: ScoutResult): DimensionScore {
    const evidence: ConfidenceEvidence[] = [];
    const gaps: string[] = [];
    const questions: string[] = [];

    // Column type detection quality
    if (scout.columnTypes && scout.columnTypes.length > 0) {
      const typedCols = scout.columnTypes.filter(
        (c) => c.detectedType !== 'mixed' && c.detectedType !== 'empty'
      );
      const typeRatio = typedCols.length / scout.columnTypes.length;

      evidence.push({
        observation: `${typedCols.length}/${scout.columnTypes.length} columns have clear data types`,
        weight: 0.4,
        direction: typeRatio > 0.7 ? 'positive' : typeRatio > 0.3 ? 'neutral' : 'negative',
        source: 'data_sample',
      });

      const mixedCols = scout.columnTypes.filter((c) => c.detectedType === 'mixed');
      if (mixedCols.length > 0) {
        gaps.push(`${mixedCols.length} columns have mixed data types`);
        questions.push(
          `Column${mixedCols.length > 1 ? 's' : ''} ${mixedCols.map((c) => `"${c.header || `#${c.index}`}"`).join(', ')} ${mixedCols.length > 1 ? 'have' : 'has'} mixed data types. What should ${mixedCols.length > 1 ? 'they' : 'it'} contain?`
        );
      }
    } else {
      gaps.push('No data sample analyzed yet');
      questions.push('What kind of data does this spreadsheet contain?');
    }

    // Size category affects content confidence
    if (scout.indicators.sizeCategory === 'huge' || scout.indicators.sizeCategory === 'large') {
      evidence.push({
        observation: `Large dataset (${scout.indicators.sizeCategory}) - sampling may miss patterns`,
        weight: 0.2,
        direction: 'negative',
        source: 'metadata',
      });
      gaps.push('Full data not yet analyzed due to size');
    }

    return this.buildDimensionScore('content', evidence, gaps, questions);
  }

  private scoreContentFromComprehensive(data: ComprehensiveAnalysisData): DimensionScore {
    const evidence: ConfidenceEvidence[] = [];
    const gaps: string[] = [];
    const questions: string[] = [];

    // Full data analysis complete
    evidence.push({
      observation: 'Comprehensive data analysis completed',
      weight: 0.5,
      direction: 'positive',
      source: 'full_data',
    });

    // Quality score
    if (data.qualityScore !== undefined) {
      evidence.push({
        observation: `Data quality score: ${data.qualityScore}/100`,
        weight: 0.3,
        direction:
          data.qualityScore > 70 ? 'positive' : data.qualityScore > 40 ? 'neutral' : 'negative',
        source: 'full_data',
      });
    }

    // Issue count
    if (data.issueCount !== undefined && data.issueCount > 10) {
      gaps.push('Many quality issues detected');
      questions.push(
        'Are the quality issues in this spreadsheet expected, or would you like help fixing them?'
      );
    }

    // Truncation
    if (data.wasTruncated) {
      evidence.push({
        observation: 'Analysis was truncated - not all data was examined',
        weight: 0.2,
        direction: 'negative',
        source: 'full_data',
      });
      gaps.push('Data was truncated during analysis');
    }

    return this.buildDimensionScore('content', evidence, gaps, questions);
  }

  // ==========================================================================
  // RELATIONSHIP SCORING
  // ==========================================================================

  private scoreRelationshipsFromScout(scout: ScoutResult): DimensionScore {
    const evidence: ConfidenceEvidence[] = [];
    const gaps: string[] = [];
    const questions: string[] = [];

    // Formula presence
    if (scout.indicators.hasFormulas) {
      evidence.push({
        observation: 'Formulas detected - inter-cell relationships exist',
        weight: 0.3,
        direction: 'positive',
        source: 'structure',
      });
    } else {
      evidence.push({
        observation: 'No formulas detected',
        weight: 0.1,
        direction: 'neutral',
        source: 'structure',
      });
      gaps.push('No formula relationships to analyze');
    }

    // Multi-sheet = potential cross-sheet references
    if (scout.indicators.multiSheet) {
      gaps.push('Cross-sheet relationships not yet mapped');
      questions.push('Do any sheets reference or depend on data from other sheets?');
    }

    // Column uniqueness hints at keys/relationships
    if (scout.columnTypes) {
      const uniqueCols = scout.columnTypes.filter(
        (c) => c.uniqueRatio !== undefined && c.uniqueRatio > 0.95
      );
      if (uniqueCols.length > 0) {
        evidence.push({
          observation: `${uniqueCols.length} column(s) appear to be unique identifiers`,
          weight: 0.2,
          direction: 'positive',
          source: 'data_sample',
        });
      }
    }

    // Scout can't deeply analyze relationships
    gaps.push('Deep relationship analysis requires comprehensive scan');

    return this.buildDimensionScore('relationships', evidence, gaps, questions);
  }

  private scoreRelationshipsFromComprehensive(data: ComprehensiveAnalysisData): DimensionScore {
    const evidence: ConfidenceEvidence[] = [];
    const gaps: string[] = [];
    const questions: string[] = [];

    if (data.correlationCount !== undefined && data.correlationCount > 0) {
      evidence.push({
        observation: `${data.correlationCount} significant correlations found`,
        weight: 0.4,
        direction: 'positive',
        source: 'full_data',
      });
    }

    if (data.formulaCount !== undefined && data.formulaCount > 0) {
      evidence.push({
        observation: `${data.formulaCount} formulas analyzed`,
        weight: 0.3,
        direction: 'positive',
        source: 'full_data',
      });
    }

    if (data.trendCount !== undefined && data.trendCount > 0) {
      evidence.push({
        observation: `${data.trendCount} data trends detected`,
        weight: 0.2,
        direction: 'positive',
        source: 'full_data',
      });
    }

    if (!data.correlationCount && !data.formulaCount) {
      gaps.push(
        'No relationships detected - data may be independent or relationships are implicit'
      );
      questions.push('Are there any relationships between columns that I should know about?');
    }

    return this.buildDimensionScore('relationships', evidence, gaps, questions);
  }

  // ==========================================================================
  // PURPOSE SCORING
  // ==========================================================================

  private scorePurposeFromScout(scout: ScoutResult): DimensionScore {
    const evidence: ConfidenceEvidence[] = [];
    const gaps: string[] = [];
    const questions: string[] = [];

    // Title analysis
    const title = scout.title?.toLowerCase() || '';
    const domainKeywords: Record<string, string[]> = {
      financial: [
        'budget',
        'revenue',
        'expense',
        'invoice',
        'ledger',
        'p&l',
        'balance',
        'financial',
      ],
      crm: ['customer', 'contact', 'lead', 'pipeline', 'sales', 'client', 'account'],
      project: ['task', 'project', 'milestone', 'sprint', 'backlog', 'gantt', 'timeline'],
      inventory: ['inventory', 'stock', 'sku', 'product', 'warehouse', 'quantity'],
      hr: ['employee', 'payroll', 'attendance', 'hiring', 'performance', 'onboarding'],
      analytics: ['metrics', 'analytics', 'dashboard', 'kpi', 'report', 'tracking'],
    };

    let detectedDomain: string | null = null;
    for (const [domain, keywords] of Object.entries(domainKeywords)) {
      if (keywords.some((kw) => title.includes(kw))) {
        detectedDomain = domain;
        evidence.push({
          observation: `Title suggests ${domain} domain`,
          weight: 0.3,
          direction: 'positive',
          source: 'metadata',
        });
        break;
      }
    }

    // Column header analysis for domain detection
    if (scout.columnTypes && scout.columnTypes.length > 0) {
      const headers = scout.columnTypes
        .map((c) => c.header?.toLowerCase())
        .filter(Boolean) as string[];

      // Check headers against domain keywords too
      if (!detectedDomain) {
        for (const [domain, keywords] of Object.entries(domainKeywords)) {
          const matches = headers.filter((h) => keywords.some((kw) => h.includes(kw)));
          if (matches.length >= 2) {
            detectedDomain = domain;
            evidence.push({
              observation: `Headers suggest ${domain} domain (${matches.join(', ')})`,
              weight: 0.25,
              direction: 'positive',
              source: 'structure',
            });
            break;
          }
        }
      }

      // Date columns suggest time-series purpose
      const dateCols = scout.columnTypes.filter((c) => c.detectedType === 'date');
      if (dateCols.length > 0) {
        evidence.push({
          observation: 'Date columns present - may be time-series or log data',
          weight: 0.15,
          direction: 'positive',
          source: 'data_sample',
        });
      }
    }

    if (!detectedDomain) {
      gaps.push('Business domain unclear from metadata');
      questions.push(
        'What is this spreadsheet used for? (e.g., tracking sales, managing inventory, financial reporting)'
      );
    }

    // Intent from scout
    if (scout.detectedIntent !== 'auto' && scout.intentConfidence > 0.6) {
      evidence.push({
        observation: `Analysis intent "${scout.detectedIntent}" detected with ${Math.round(scout.intentConfidence * 100)}% confidence`,
        weight: 0.2,
        direction: 'positive',
        source: 'inference',
      });
    }

    // Always ask purpose if we don't have strong signals
    const currentScore = this.calculateDimensionScore(evidence);
    if (currentScore < 50) {
      gaps.push('User intent not confirmed');
      questions.push('What would you like to do with this spreadsheet?');
    }

    return this.buildDimensionScore('purpose', evidence, gaps, questions);
  }

  private scorePurposeFromComprehensive(data: ComprehensiveAnalysisData): DimensionScore {
    const evidence: ConfidenceEvidence[] = [];
    const gaps: string[] = [];
    const questions: string[] = [];

    evidence.push({
      observation: 'Comprehensive analysis provides deeper purpose signals',
      weight: 0.3,
      direction: 'positive',
      source: 'full_data',
    });

    if (data.detectedDomain) {
      evidence.push({
        observation: `Detected domain: ${data.detectedDomain}`,
        weight: 0.4,
        direction: 'positive',
        source: 'inference',
      });
    } else {
      gaps.push('Business domain not detected from data');
      questions.push('What business process does this spreadsheet support?');
    }

    if (data.hasVisualizationSuggestions) {
      evidence.push({
        observation: 'Data patterns suggest visualization opportunities',
        weight: 0.1,
        direction: 'positive',
        source: 'inference',
      });
    }

    return this.buildDimensionScore('purpose', evidence, gaps, questions);
  }

  // ==========================================================================
  // COLUMN-LEVEL SCORING
  // ==========================================================================

  private scoreColumnsFromScout(columnTypes: ColumnTypeInfo[]): ColumnConfidence[] {
    return columnTypes.map((col) => {
      const typeConf = col.detectedType === 'mixed' ? 20 : col.detectedType === 'empty' ? 10 : 75;
      const purposeConf = col.header ? 50 : 10;
      const qualityConf = col.nullable ? 40 : 60;

      const gaps: string[] = [];
      if (!col.header) gaps.push('No header');
      if (col.detectedType === 'mixed') gaps.push('Mixed data types');
      if (col.nullable) gaps.push('Contains null/empty values');

      return {
        columnIndex: col.index,
        header: col.header,
        typeConfidence: typeConf,
        purposeConfidence: purposeConf,
        qualityConfidence: qualityConf,
        overallConfidence: Math.round((typeConf + purposeConf + qualityConf) / 3),
        gaps,
      };
    });
  }

  private scoreColumnsFromComprehensive(columns: ComprehensiveColumnData[]): ColumnConfidence[] {
    return columns.map((col) => {
      const typeConf = col.typeConsistency > 0.9 ? 90 : col.typeConsistency > 0.7 ? 70 : 40;
      const purposeConf = col.header ? (col.meaningfulHeader ? 80 : 50) : 10;
      const qualityConf = Math.round((1 - (col.nullRate || 0)) * 80 + 20);

      const gaps: string[] = [];
      if (!col.header) gaps.push('No header');
      if (col.typeConsistency < 0.7) gaps.push('Inconsistent data types');
      if ((col.nullRate || 0) > 0.3) gaps.push('High null rate');

      return {
        columnIndex: col.index,
        header: col.header,
        typeConfidence: typeConf,
        purposeConfidence: purposeConf,
        qualityConfidence: qualityConf,
        overallConfidence: Math.round((typeConf + purposeConf + qualityConf) / 3),
        gaps,
      };
    });
  }

  // ==========================================================================
  // HELPERS
  // ==========================================================================

  private buildDimensionScore(
    dimension: ConfidenceDimension,
    evidence: ConfidenceEvidence[],
    gaps: string[],
    questions: string[]
  ): DimensionScore {
    const score = this.calculateDimensionScore(evidence);
    return {
      dimension,
      score,
      level: this.scoreToLevel(score),
      evidence,
      gaps,
      suggestedQuestions: questions,
    };
  }

  private calculateDimensionScore(evidence: ConfidenceEvidence[]): number {
    if (evidence.length === 0) return 0;

    let weightedSum = 0;
    let totalWeight = 0;

    for (const e of evidence) {
      const value = e.direction === 'positive' ? 100 : e.direction === 'negative' ? 0 : 50;
      weightedSum += value * e.weight;
      totalWeight += e.weight;
    }

    if (totalWeight === 0) return 0;

    // Apply a source diversity bonus - more sources = higher confidence
    const uniqueSources = new Set(evidence.map((e) => e.source)).size;
    const diversityBonus = Math.min(uniqueSources * 3, 15);

    return Math.min(100, Math.round(weightedSum / totalWeight + diversityBonus));
  }

  private scoreToLevel(score: number): ConfidenceLevel {
    for (const [level, [min, max]] of Object.entries(CONFIDENCE_THRESHOLDS)) {
      if (score >= min && score < max) return level as ConfidenceLevel;
    }
    return score >= 85 ? 'very_high' : 'none';
  }

  private buildAssessment(
    spreadsheetId: string,
    dimensions: DimensionScore[],
    columns: ColumnConfidence[] | undefined,
    dataTier: number,
    startTime: number
  ): ConfidenceAssessment {
    // Calculate overall score
    const overallScore = Math.round(
      dimensions.reduce((sum, dim) => sum + dim.score * DIMENSION_WEIGHTS[dim.dimension], 0)
    );

    // Collect top gaps across all dimensions, sorted by impact
    const topGaps = dimensions
      .flatMap((dim) =>
        dim.gaps.map((gap, idx) => ({
          dimension: dim.dimension,
          gap,
          impactOnConfidence: Math.max(5, Math.round((100 - dim.score) * 0.3)),
          question: dim.suggestedQuestions[idx] || `Can you tell me more about: ${gap}?`,
        }))
      )
      .sort((a, b) => b.impactOnConfidence - a.impactOnConfidence)
      .slice(0, 5);

    const assessment: ConfidenceAssessment = {
      spreadsheetId,
      overallScore,
      overallLevel: this.scoreToLevel(overallScore),
      dimensions,
      columns,
      shouldElicit: overallScore < ELICITATION_THRESHOLD,
      topGaps,
      dataTier,
      assessedAt: Date.now(),
    };

    logger.info('ConfidenceScorer: Assessment complete', {
      spreadsheetId,
      overallScore,
      overallLevel: assessment.overallLevel,
      shouldElicit: assessment.shouldElicit,
      gapCount: topGaps.length,
      durationMs: Date.now() - startTime,
    });

    return assessment;
  }

  private getUpdatesForDimension(
    dimension: ConfidenceDimension,
    context: UserProvidedContext
  ): ConfidenceEvidence[] {
    const evidence: ConfidenceEvidence[] = [];

    switch (dimension) {
      case 'purpose':
        if (context.businessDomain) {
          evidence.push({
            observation: `User confirmed domain: ${context.businessDomain}`,
            weight: 0.5,
            direction: 'positive',
            source: 'user_input',
          });
        }
        if (context.intent) {
          evidence.push({
            observation: `User specified intent: ${context.intent}`,
            weight: 0.4,
            direction: 'positive',
            source: 'user_input',
          });
        }
        break;

      case 'structure':
        if (context.headerDescriptions && Object.keys(context.headerDescriptions).length > 0) {
          evidence.push({
            observation: `User described ${Object.keys(context.headerDescriptions).length} column(s)`,
            weight: 0.4,
            direction: 'positive',
            source: 'user_input',
          });
        }
        if (context.sheetRelationships) {
          evidence.push({
            observation: `User described sheet relationships`,
            weight: 0.3,
            direction: 'positive',
            source: 'user_input',
          });
        }
        break;

      case 'content':
        if (context.dataQualityExpectations) {
          evidence.push({
            observation: 'User provided data quality expectations',
            weight: 0.3,
            direction: 'positive',
            source: 'user_input',
          });
        }
        break;

      case 'relationships':
        if (context.keyColumns && context.keyColumns.length > 0) {
          evidence.push({
            observation: `User identified ${context.keyColumns.length} key column(s)`,
            weight: 0.4,
            direction: 'positive',
            source: 'user_input',
          });
        }
        break;
    }

    return evidence;
  }
}

// ============================================================================
// SUPPORTING TYPES
// ============================================================================

/**
 * Context provided by the user to increase confidence
 */
export interface UserProvidedContext {
  /** Business domain (e.g., "financial", "crm", "inventory") */
  businessDomain?: string;
  /** What the user wants to do */
  intent?: string;
  /** Column header descriptions */
  headerDescriptions?: Record<string, string>;
  /** How sheets relate to each other */
  sheetRelationships?: string;
  /** Expected data quality */
  dataQualityExpectations?: string;
  /** Key/ID columns */
  keyColumns?: string[];
  /** Custom context text */
  freeformContext?: string;
}

/**
 * Data shape from comprehensive analysis needed for scoring
 */
export interface ComprehensiveAnalysisData {
  headerQuality?: number;
  hasDataValidation?: boolean;
  formatConsistency?: number;
  qualityScore?: number;
  issueCount?: number;
  wasTruncated?: boolean;
  correlationCount?: number;
  formulaCount?: number;
  trendCount?: number;
  detectedDomain?: string;
  hasVisualizationSuggestions?: boolean;
  columns?: ComprehensiveColumnData[];
}

export interface ComprehensiveColumnData {
  index: number;
  header: string | null;
  meaningfulHeader?: boolean;
  typeConsistency: number;
  nullRate?: number;
}
