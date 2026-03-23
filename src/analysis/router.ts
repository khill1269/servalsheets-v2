/**
 * ServalSheets - Analysis Router
 *
 * Decision engine for selecting optimal analysis execution path:
 * - Fast path: Traditional statistics for <10K rows (0.5-2s)
 * - AI path: LLM-powered insights via MCP Sampling (3-15s)
 * - Streaming path: Task-enabled chunked processing for >50K rows (async)
 *
 * The router optimizes for latency, cost, and accuracy based on:
 * - Data size (cell count, row count)
 * - User preferences (useAI flag)
 * - Action complexity
 * - Available capabilities (sampling, tasks)
 */

import type { SheetsAnalyzeInput } from '../schemas/analyze.js';

/**
 * Sheet metadata for routing decisions
 */
export interface SheetMetadata {
  spreadsheetId: string;
  title: string;
  sheets: Array<{
    sheetId: number;
    title: string;
    rowCount: number;
    columnCount: number;
  }>;
}

/**
 * Routing decision result
 */
export interface RoutingDecision {
  path: 'fast' | 'ai' | 'streaming';
  reason: string;
  estimatedDuration: number; // seconds
  cacheable: boolean;
  requiresSampling: boolean;
  requiresTasks: boolean;
}

/**
 * Router capabilities (from handler context)
 */
export interface RouterCapabilities {
  hasSampling: boolean;
  hasTasks: boolean;
}

/**
 * Analysis Router
 *
 * Makes intelligent routing decisions based on request characteristics
 * and available infrastructure capabilities.
 */
export class AnalysisRouter {
  constructor(private capabilities: RouterCapabilities) {}

  /**
   * Route an analysis request to the optimal execution path
   */
  route(request: SheetsAnalyzeInput, metadata: SheetMetadata): RoutingDecision {
    // Calculate total cell count
    const sheet = this.findTargetSheet(request, metadata);
    const cellCount = sheet ? sheet.rowCount * sheet.columnCount : 0;

    // Check for explicit AI request
    if ('useAI' in request && request.useAI) {
      if (!this.capabilities.hasSampling) {
        // Fallback to fast path if sampling unavailable
        return {
          path: 'fast',
          reason: 'AI requested but sampling unavailable, using fast path',
          estimatedDuration: this.estimateFastDuration(cellCount),
          cacheable: true,
          requiresSampling: false,
          requiresTasks: false,
        };
      }
      return {
        path: 'ai',
        reason: 'AI explicitly requested by user',
        estimatedDuration: this.estimateAIDuration(cellCount),
        cacheable: false, // AI responses vary
        requiresSampling: true,
        requiresTasks: false,
      };
    }

    // Route based on action type
    switch (request.request.action) {
      case 'analyze_data':
        return this.routeAnalyzeData(request, cellCount);

      case 'suggest_visualization':
        return this.routeSuggestVisualization(request, cellCount);

      case 'generate_formula':
        return this.routeGenerateFormula(request, cellCount);

      case 'detect_patterns':
        return this.routeDetectPatterns(request, cellCount);

      case 'analyze_structure':
        return this.routeAnalyzeStructure(request, cellCount);

      case 'analyze_quality':
        return this.routeAnalyzeQuality(request, cellCount);

      case 'analyze_performance':
        return this.routeAnalyzePerformance(request, cellCount);

      case 'analyze_formulas':
      case 'query_natural_language':
        return {
          path: 'ai',
          reason: 'Natural language and formula analysis require AI',
          estimatedDuration: 8,
          cacheable: true,
          requiresSampling: true,
          requiresTasks: false,
        };

      case 'explain_analysis':
        return this.routeExplainAnalysis(request);

      default:
        // Default to fast path
        return {
          path: 'fast',
          reason: 'Default routing for unknown action',
          estimatedDuration: 2,
          cacheable: true,
          requiresSampling: false,
          requiresTasks: false,
        };
    }
  }

  /**
   * Route analyze_data action
   * - Small datasets (<10K cells): fast path with traditional stats
   * - Medium datasets (10K-50K): AI path for insights
   * - Large datasets (>50K): streaming path
   */
  private routeAnalyzeData(request: SheetsAnalyzeInput, cellCount: number): RoutingDecision {
    // Streaming for very large datasets
    if (cellCount > 50_000) {
      if (!this.capabilities.hasTasks) {
        return {
          path: 'ai',
          reason: 'Large dataset but tasks unavailable, using AI with chunked fetching',
          estimatedDuration: 30,
          cacheable: false,
          requiresSampling: true,
          requiresTasks: false,
        };
      }
      return {
        path: 'streaming',
        reason: 'Large dataset requires chunked processing via tasks',
        estimatedDuration: 60,
        cacheable: false,
        requiresSampling: false,
        requiresTasks: true,
      };
    }

    // AI path for medium datasets or when deep insights requested
    if (cellCount > 10_000 || this.requestsDeepInsights(request)) {
      if (!this.capabilities.hasSampling) {
        return {
          path: 'fast',
          reason: 'Medium dataset but sampling unavailable, using fast statistics',
          estimatedDuration: this.estimateFastDuration(cellCount),
          cacheable: true,
          requiresSampling: false,
          requiresTasks: false,
        };
      }
      return {
        path: 'ai',
        reason: 'Medium dataset with AI-powered insights',
        estimatedDuration: this.estimateAIDuration(cellCount),
        cacheable: false,
        requiresSampling: true,
        requiresTasks: false,
      };
    }

    // Fast path for small datasets
    return {
      path: 'fast',
      reason: 'Small dataset, traditional statistics sufficient',
      estimatedDuration: this.estimateFastDuration(cellCount),
      cacheable: true,
      requiresSampling: false,
      requiresTasks: false,
    };
  }

  /**
   * Route suggest_visualization action
   * Always uses AI for intelligent chart/pivot recommendations
   */
  private routeSuggestVisualization(
    _request: SheetsAnalyzeInput,
    cellCount: number
  ): RoutingDecision {
    if (!this.capabilities.hasSampling) {
      return {
        path: 'fast',
        reason:
          'Visualization suggestions require AI but sampling unavailable, using rule-based fallback',
        estimatedDuration: 3,
        cacheable: true,
        requiresSampling: false,
        requiresTasks: false,
      };
    }
    return {
      path: 'ai',
      reason: 'AI-powered chart and pivot table recommendations',
      estimatedDuration: Math.min(15, 5 + cellCount / 10000),
      cacheable: false,
      requiresSampling: true,
      requiresTasks: false,
    };
  }

  /**
   * Route generate_formula action
   * Always uses AI for natural language → formula conversion
   */
  private routeGenerateFormula(_request: SheetsAnalyzeInput, _cellCount: number): RoutingDecision {
    if (!this.capabilities.hasSampling) {
      return {
        path: 'fast',
        reason: 'Formula generation requires AI but sampling unavailable, cannot generate',
        estimatedDuration: 0,
        cacheable: false,
        requiresSampling: false,
        requiresTasks: false,
      };
    }
    return {
      path: 'ai',
      reason: 'AI formula generation from natural language description',
      estimatedDuration: 8,
      cacheable: false, // Formulas vary based on context
      requiresSampling: true,
      requiresTasks: false,
    };
  }

  /**
   * Route detect_patterns action
   * - Small datasets: fast path with traditional correlation analysis
   * - Large datasets: AI path for enhanced pattern detection
   */
  private routeDetectPatterns(request: SheetsAnalyzeInput, cellCount: number): RoutingDecision {
    // Check if AI-enhanced features requested
    const needsAI =
      ('includeSeasonality' in request && request.includeSeasonality) || cellCount > 20_000;

    if (needsAI && this.capabilities.hasSampling) {
      return {
        path: 'ai',
        reason: 'AI-enhanced pattern detection with seasonality analysis',
        estimatedDuration: this.estimateAIDuration(cellCount),
        cacheable: false,
        requiresSampling: true,
        requiresTasks: false,
      };
    }

    return {
      path: 'fast',
      reason: 'Traditional pattern detection (correlations, trends, anomalies)',
      estimatedDuration: this.estimateFastDuration(cellCount),
      cacheable: true,
      requiresSampling: false,
      requiresTasks: false,
    };
  }

  /**
   * Route analyze_structure action
   * Fast path - structure analysis is metadata-heavy, not compute-heavy
   */
  private routeAnalyzeStructure(_request: SheetsAnalyzeInput, cellCount: number): RoutingDecision {
    return {
      path: 'fast',
      reason: 'Structure analysis uses metadata, fast path sufficient',
      estimatedDuration: Math.min(2, 0.5 + cellCount / 50000),
      cacheable: true,
      requiresSampling: false,
      requiresTasks: false,
    };
  }

  /**
   * Route analyze_quality action
   * - Small datasets: fast path
   * - Large datasets with AI: AI path for issue identification
   */
  private routeAnalyzeQuality(request: SheetsAnalyzeInput, cellCount: number): RoutingDecision {
    const useAI = 'useAI' in request && request.useAI;

    if (useAI && this.capabilities.hasSampling) {
      return {
        path: 'ai',
        reason: 'AI-powered data quality issue identification',
        estimatedDuration: this.estimateAIDuration(cellCount),
        cacheable: false,
        requiresSampling: true,
        requiresTasks: false,
      };
    }

    return {
      path: 'fast',
      reason: 'Traditional data quality checks (types, nulls, outliers)',
      estimatedDuration: this.estimateFastDuration(cellCount),
      cacheable: true,
      requiresSampling: false,
      requiresTasks: false,
    };
  }

  /**
   * Route analyze_performance action
   * Fast path - performance analysis is structural, not data-heavy
   */
  private routeAnalyzePerformance(
    _request: SheetsAnalyzeInput,
    cellCount: number
  ): RoutingDecision {
    return {
      path: 'fast',
      reason: 'Performance analysis based on structure and formula complexity',
      estimatedDuration: Math.min(3, 1 + cellCount / 30000),
      cacheable: true,
      requiresSampling: false,
      requiresTasks: false,
    };
  }

  /**
   * Route explain_analysis action
   * Always uses AI for conversational explanations
   */
  private routeExplainAnalysis(_request: SheetsAnalyzeInput): RoutingDecision {
    if (!this.capabilities.hasSampling) {
      return {
        path: 'fast',
        reason: 'Explanation requires AI but sampling unavailable',
        estimatedDuration: 0,
        cacheable: false,
        requiresSampling: false,
        requiresTasks: false,
      };
    }
    return {
      path: 'ai',
      reason: 'Conversational explanation via AI',
      estimatedDuration: 5,
      cacheable: false,
      requiresSampling: true,
      requiresTasks: false,
    };
  }

  /**
   * Find the target sheet for analysis
   */
  private findTargetSheet(
    request: SheetsAnalyzeInput,
    metadata: SheetMetadata
  ): SheetMetadata['sheets'][0] | undefined {
    if ('sheetId' in request && typeof request.sheetId === 'number') {
      return metadata.sheets.find((s) => s.sheetId === request.sheetId);
    }
    // Default to first sheet
    return metadata.sheets[0];
  }

  /**
   * Check if request asks for deep insights
   */
  private requestsDeepInsights(request: SheetsAnalyzeInput): boolean {
    if (!('analysisTypes' in request) || !Array.isArray(request.analysisTypes)) {
      return false;
    }
    const deepInsightTypes = ['patterns', 'anomalies', 'recommendations'];
    return request.analysisTypes.some((type) => deepInsightTypes.includes(type));
  }

  /**
   * Estimate fast path duration based on cell count
   */
  private estimateFastDuration(cellCount: number): number {
    // 0.5s base + 0.1s per 1000 cells
    return Math.min(2, 0.5 + cellCount / 10000);
  }

  /**
   * Estimate AI path duration based on cell count
   */
  private estimateAIDuration(cellCount: number): number {
    // 3s base + sampling latency + token generation
    // Larger datasets require more context, increasing duration
    return Math.min(15, 3 + cellCount / 5000);
  }
}
