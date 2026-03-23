/**
 * ServalSheets - Scout Analysis Module
 *
 * Quick metadata scan to gather essential information and detect optimal
 * analysis intent. Uses Level 1-2 of tiered retrieval for minimal latency.
 *
 * The scout phase is the entry point for progressive analysis:
 * scout (quick) → plan (strategy) → execute_plan (full) → drill_down (deep)
 *
 * MCP Protocol: 2025-11-25
 */

import type { sheets_v4 } from 'googleapis';
import type { ICache } from '../utils/cache-adapter.js';
import { logger } from '../utils/logger.js';
import { TieredRetrieval, type SheetMetadata, type SheetStructure } from './tiered-retrieval.js';

/**
 * Analysis intent types that the scout can detect
 */
export type AnalysisIntent =
  | 'quick'
  | 'optimize'
  | 'clean'
  | 'visualize'
  | 'understand'
  | 'audit'
  | 'auto';

/**
 * Quick indicators from metadata scan
 */
export interface QuickIndicators {
  /** Spreadsheet size category */
  sizeCategory: 'tiny' | 'small' | 'medium' | 'large' | 'huge';
  /** Estimated total cells */
  estimatedCells: number;
  /** Complexity score 0-100 */
  complexityScore: number;
  /** Has formulas (detected from structure) */
  hasFormulas: boolean;
  /** Has charts or pivots */
  hasVisualizations: boolean;
  /** Has data validation or protected ranges */
  hasDataQuality: boolean;
  /** Has multiple sheets */
  multiSheet: boolean;
  /** Recommended depth for full analysis */
  recommendedDepth: 'metadata' | 'structure' | 'sample' | 'full';
}

/**
 * Column type detection from sampling
 */
export interface ColumnTypeInfo {
  index: number;
  header: string | null;
  detectedType: 'text' | 'number' | 'date' | 'boolean' | 'formula' | 'mixed' | 'empty';
  nullable: boolean;
  uniqueRatio?: number;
}

/**
 * Scout result with metadata, indicators, and next actions
 */
export interface ScoutResult {
  spreadsheetId: string;
  title: string;
  sheets: Array<{
    sheetId: number;
    title: string;
    rowCount: number;
    columnCount: number;
    estimatedCells: number;
  }>;
  indicators: QuickIndicators;
  columnTypes?: ColumnTypeInfo[];
  detectedIntent: AnalysisIntent;
  intentConfidence: number;
  intentReason: string;
  recommendations: string[];
  nextActions: {
    recommended: {
      tool: string;
      action: string;
      params: Record<string, unknown>;
      description: string;
    } | null;
    alternatives: Array<{
      tool: string;
      action: string;
      params: Record<string, unknown>;
      description: string;
    }>;
  };
  retrievedAt: number;
  latencyMs: number;
}

/**
 * Scout configuration
 */
export interface ScoutConfig {
  cache: ICache;
  sheetsApi: sheets_v4.Sheets;
  /** Include column type detection (requires sample data) */
  includeColumnTypes?: boolean;
  /** Include quick indicators */
  includeQuickIndicators?: boolean;
  /** Auto-detect analysis intent */
  detectIntent?: boolean;
}

/**
 * Size thresholds for categorization
 */
const SIZE_THRESHOLDS = {
  tiny: 1000, // < 1K cells
  small: 10000, // 1K - 10K cells
  medium: 100000, // 10K - 100K cells
  large: 1000000, // 100K - 1M cells
  huge: Infinity, // > 1M cells
} as const;

/**
 * Scout class for quick spreadsheet reconnaissance
 */
export class Scout {
  private tieredRetrieval: TieredRetrieval;
  private config: Required<ScoutConfig>;

  constructor(config: ScoutConfig) {
    this.tieredRetrieval = new TieredRetrieval({
      cache: config.cache,
      sheetsApi: config.sheetsApi,
    });
    this.config = {
      ...config,
      includeColumnTypes: config.includeColumnTypes ?? true,
      includeQuickIndicators: config.includeQuickIndicators ?? true,
      detectIntent: config.detectIntent ?? true,
    };
  }

  /**
   * Perform quick scout analysis
   * Uses Level 1 (metadata) + Level 2 (structure) for minimal latency
   */
  async scout(spreadsheetId: string, sheetId?: number): Promise<ScoutResult> {
    const startTime = Date.now();
    logger.info('Scout: Starting quick analysis', { spreadsheetId, sheetId });

    // Level 1: Get metadata (fastest)
    const metadata = await this.tieredRetrieval.getMetadata(spreadsheetId);

    // Level 2: Get structure for more insights
    let structure: SheetStructure | null = null;
    try {
      structure = await this.tieredRetrieval.getStructure(spreadsheetId);
    } catch (error) {
      logger.warn('Scout: Failed to get structure, using metadata only', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Calculate indicators
    const indicators = this.config.includeQuickIndicators
      ? this.calculateIndicators(metadata, structure)
      : this.getDefaultIndicators();

    // Detect intent
    const { intent, confidence, reason } = this.config.detectIntent
      ? this.detectAnalysisIntent(metadata, structure, indicators)
      : { intent: 'auto' as AnalysisIntent, confidence: 0.5, reason: 'Intent detection disabled' };

    // Generate recommendations and next actions
    const recommendations = this.generateRecommendations(indicators, intent);
    const nextActions = this.generateNextActions(spreadsheetId, sheetId, indicators, intent);

    // Build result
    const result: ScoutResult = {
      spreadsheetId,
      title: metadata.title,
      sheets: metadata.sheets.map((sheet) => ({
        sheetId: sheet.sheetId,
        title: sheet.title,
        rowCount: sheet.rowCount,
        columnCount: sheet.columnCount,
        estimatedCells: sheet.rowCount * sheet.columnCount,
      })),
      indicators,
      detectedIntent: intent,
      intentConfidence: confidence,
      intentReason: reason,
      recommendations,
      nextActions,
      retrievedAt: Date.now(),
      latencyMs: Date.now() - startTime,
    };

    logger.info('Scout: Analysis complete', {
      spreadsheetId,
      sheetCount: metadata.sheets.length,
      sizeCategory: indicators.sizeCategory,
      detectedIntent: intent,
      latencyMs: result.latencyMs,
    });

    return result;
  }

  /**
   * Calculate quick indicators from metadata and structure
   */
  private calculateIndicators(
    metadata: SheetMetadata,
    structure: SheetStructure | null
  ): QuickIndicators {
    // Calculate total estimated cells
    const estimatedCells = metadata.sheets.reduce(
      (sum, sheet) => sum + sheet.rowCount * sheet.columnCount,
      0
    );

    // Determine size category
    let sizeCategory: QuickIndicators['sizeCategory'] = 'tiny';
    for (const [category, threshold] of Object.entries(SIZE_THRESHOLDS)) {
      if (estimatedCells < threshold) {
        sizeCategory = category as QuickIndicators['sizeCategory'];
        break;
      }
    }

    // Calculate complexity score
    let complexityScore = 0;
    if (structure) {
      // Add points for structural complexity
      complexityScore += Math.min(structure.structure.merges * 2, 20);
      complexityScore += Math.min(structure.structure.conditionalFormats * 3, 25);
      complexityScore += Math.min(structure.structure.charts * 5, 20);
      complexityScore += Math.min(structure.structure.pivots * 8, 20);
      complexityScore += Math.min(structure.structure.protectedRanges * 2, 10);
      complexityScore += Math.min(structure.structure.namedRanges.length * 2, 15);
      complexityScore += structure.structure.filters > 0 ? 5 : 0;
      // Add points for size
      complexityScore += Math.min(Math.log10(estimatedCells) * 5, 20);
      // Add points for multiple sheets
      complexityScore += Math.min((metadata.sheets.length - 1) * 3, 15);
    } else {
      // Estimate from metadata only
      complexityScore = Math.min(Math.log10(estimatedCells) * 10, 50);
      complexityScore += Math.min((metadata.sheets.length - 1) * 5, 20);
    }

    // Determine recommended depth
    let recommendedDepth: QuickIndicators['recommendedDepth'] = 'sample';
    if (sizeCategory === 'tiny') {
      recommendedDepth = 'full';
    } else if (sizeCategory === 'small') {
      recommendedDepth = complexityScore > 40 ? 'sample' : 'full';
    } else if (sizeCategory === 'huge') {
      recommendedDepth = 'metadata';
    } else if (sizeCategory === 'large') {
      recommendedDepth = 'structure';
    }

    return {
      sizeCategory,
      estimatedCells,
      complexityScore: Math.min(Math.round(complexityScore), 100),
      hasFormulas: false, // Would need sample data to detect
      hasVisualizations: structure
        ? structure.structure.charts > 0 || structure.structure.pivots > 0
        : false,
      hasDataQuality: structure
        ? structure.structure.conditionalFormats > 0 || structure.structure.protectedRanges > 0
        : false,
      multiSheet: metadata.sheets.length > 1,
      recommendedDepth,
    };
  }

  /**
   * Get default indicators when calculation is disabled
   */
  private getDefaultIndicators(): QuickIndicators {
    return {
      sizeCategory: 'medium',
      estimatedCells: 0,
      complexityScore: 50,
      hasFormulas: false,
      hasVisualizations: false,
      hasDataQuality: false,
      multiSheet: false,
      recommendedDepth: 'sample',
    };
  }

  /**
   * Detect the most appropriate analysis intent based on spreadsheet characteristics
   */
  private detectAnalysisIntent(
    metadata: SheetMetadata,
    structure: SheetStructure | null,
    indicators: QuickIndicators
  ): { intent: AnalysisIntent; confidence: number; reason: string } {
    const signals: Array<{ intent: AnalysisIntent; weight: number; reason: string }> = [];

    // Check for visualization needs
    if (indicators.hasVisualizations) {
      signals.push({
        intent: 'visualize',
        weight: 0.7,
        reason: 'Existing charts/pivots suggest visualization focus',
      });
    }

    // Check for data quality needs
    if (indicators.hasDataQuality) {
      signals.push({
        intent: 'audit',
        weight: 0.6,
        reason: 'Protected ranges and conditional formats suggest audit focus',
      });
    }

    // Check for large data optimization needs
    if (indicators.sizeCategory === 'large' || indicators.sizeCategory === 'huge') {
      signals.push({
        intent: 'optimize',
        weight: 0.8,
        reason: 'Large spreadsheet would benefit from optimization analysis',
      });
    }

    // Check for complex structure
    if (indicators.complexityScore > 60) {
      signals.push({
        intent: 'understand',
        weight: 0.7,
        reason: 'High complexity score suggests need for structural understanding',
      });
    }

    // Check for multi-sheet coordination
    if (metadata.sheets.length > 3) {
      signals.push({
        intent: 'understand',
        weight: 0.5,
        reason: 'Multiple sheets suggest need for cross-sheet analysis',
      });
    }

    // Check for potential data cleaning needs
    if (structure && structure.structure.merges > 10) {
      signals.push({
        intent: 'clean',
        weight: 0.5,
        reason: 'Many merged cells may indicate formatting issues',
      });
    }

    // Small/simple spreadsheets default to quick
    if (indicators.sizeCategory === 'tiny' || indicators.complexityScore < 30) {
      signals.push({
        intent: 'quick',
        weight: 0.4,
        reason: 'Small/simple spreadsheet suitable for quick analysis',
      });
    }

    // Find highest weighted signal
    if (signals.length === 0) {
      return {
        intent: 'auto',
        confidence: 0.5,
        reason: 'No strong signals detected, using auto mode',
      };
    }

    signals.sort((a, b) => b.weight - a.weight);
    const topSignal = signals[0]!;

    return {
      intent: topSignal.intent,
      confidence: topSignal.weight,
      reason: topSignal.reason,
    };
  }

  /**
   * Generate human-readable recommendations based on analysis
   */
  private generateRecommendations(indicators: QuickIndicators, intent: AnalysisIntent): string[] {
    const recommendations: string[] = [];

    // Size-based recommendations
    if (indicators.sizeCategory === 'huge') {
      recommendations.push(
        'Consider using sample-based analysis (sheets_analyze:comprehensive with depth="sample") to avoid timeouts'
      );
    }

    // Complexity recommendations
    if (indicators.complexityScore > 70) {
      recommendations.push(
        'High complexity detected. Use sheets_analyze:plan to create an analysis strategy first'
      );
    }

    // Intent-specific recommendations
    switch (intent) {
      case 'optimize':
        recommendations.push(
          'Run sheets_analyze:analyze_performance to identify optimization opportunities'
        );
        break;
      case 'clean':
        recommendations.push('Run sheets_analyze:analyze_quality to identify data cleaning needs');
        break;
      case 'visualize':
        recommendations.push('Use sheets_analyze:suggest_visualization for chart recommendations');
        break;
      case 'audit':
        recommendations.push('Run sheets_analyze:comprehensive with intent="audit" for full audit');
        break;
      case 'understand':
        recommendations.push(
          'Use sheets_analyze:analyze_structure for detailed structural analysis'
        );
        break;
    }

    // Multi-sheet recommendations
    if (indicators.multiSheet) {
      recommendations.push(
        'Multiple sheets detected. Consider analyzing each sheet separately for detailed insights'
      );
    }

    return recommendations;
  }

  /**
   * Generate executable next actions with full parameters
   */
  private generateNextActions(
    spreadsheetId: string,
    sheetId: number | undefined,
    indicators: QuickIndicators,
    intent: AnalysisIntent
  ): ScoutResult['nextActions'] {
    const baseParams: Record<string, unknown> = { spreadsheetId };
    if (sheetId !== undefined) {
      baseParams['sheetId'] = sheetId;
    }

    // Build recommended action based on intent and indicators
    let recommended: ScoutResult['nextActions']['recommended'] = null;
    const alternatives: ScoutResult['nextActions']['alternatives'] = [];

    // Primary recommendation based on intent
    switch (intent) {
      case 'quick':
        recommended = {
          tool: 'sheets_analyze',
          action: 'comprehensive',
          params: {
            ...baseParams,
            intent: 'quick',
            depth: indicators.recommendedDepth,
          },
          description: 'Quick comprehensive analysis optimized for speed',
        };
        break;
      case 'optimize':
        recommended = {
          tool: 'sheets_analyze',
          action: 'analyze_performance',
          params: baseParams,
          description: 'Identify performance bottlenecks and optimization opportunities',
        };
        alternatives.push({
          tool: 'sheets_analyze',
          action: 'comprehensive',
          params: { ...baseParams, intent: 'optimize' },
          description: 'Full optimization-focused analysis',
        });
        break;
      case 'clean':
        recommended = {
          tool: 'sheets_analyze',
          action: 'analyze_quality',
          params: baseParams,
          description: 'Detect data quality issues and cleaning needs',
        };
        alternatives.push({
          tool: 'sheets_quality',
          action: 'validate',
          params: baseParams,
          description: 'Run data validation checks',
        });
        break;
      case 'visualize':
        recommended = {
          tool: 'sheets_analyze',
          action: 'suggest_visualization',
          params: baseParams,
          description: 'Get chart and pivot table recommendations',
        };
        alternatives.push({
          tool: 'sheets_visualize',
          action: 'chart_create',
          params: { ...baseParams, type: 'AUTO' },
          description: 'Create an auto-detected chart',
        });
        break;
      case 'audit':
        recommended = {
          tool: 'sheets_analyze',
          action: 'comprehensive',
          params: { ...baseParams, intent: 'audit', depth: 'full' },
          description: 'Full audit analysis with all checks',
        };
        break;
      case 'understand':
        recommended = {
          tool: 'sheets_analyze',
          action: 'analyze_structure',
          params: baseParams,
          description: 'Deep structural analysis for understanding',
        };
        alternatives.push({
          tool: 'sheets_analyze',
          action: 'explain_analysis',
          params: baseParams,
          description: 'Get plain-language explanation of the spreadsheet',
        });
        break;
      default:
        // Auto/fallback: use plan to determine best approach
        recommended = {
          tool: 'sheets_analyze',
          action: 'plan',
          params: {
            ...baseParams,
            scoutResult: { indicators, intent },
          },
          description: 'Create an analysis plan based on scout results',
        };
    }

    // Add drill-down alternative for complex spreadsheets
    if (indicators.complexityScore > 50) {
      alternatives.push({
        tool: 'sheets_analyze',
        action: 'drill_down',
        params: {
          ...baseParams,
          area: 'structure',
        },
        description: 'Deep dive into structural complexity',
      });
    }

    return { recommended, alternatives };
  }
}
