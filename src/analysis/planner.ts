/**
 * ServalSheets - Analysis Planner Module
 *
 * Creates multi-step analysis plans based on scout results and user intent.
 * Plans are optimized for the detected data characteristics and goals.
 *
 * The planner phase creates an execution strategy:
 * scout (quick) → plan (strategy) → execute_plan (full) → drill_down (deep)
 *
 * MCP Protocol: 2025-11-25
 */

import { logger } from '../utils/logger.js';
import type { ScoutResult, AnalysisIntent, QuickIndicators } from './scout.js';

/**
 * A single step in an analysis plan
 */
export interface PlanStep {
  id: string;
  sequence: number;
  tool: string;
  action: string;
  params: Record<string, unknown>;
  title: string;
  description: string;
  estimatedLatencyMs: number;
  dependencies: string[];
  optional: boolean;
  skipCondition?: string;
}

/**
 * Complete analysis plan
 */
export interface AnalysisPlan {
  planId: string;
  spreadsheetId: string;
  intent: AnalysisIntent;
  title: string;
  description: string;
  steps: PlanStep[];
  totalEstimatedLatencyMs: number;
  parallelizable: string[][];
  criticalPath: string[];
  metadata: {
    createdAt: number;
    scoutLatencyMs?: number;
    complexityScore: number;
    sizeCategory: string;
  };
}

/**
 * Plan generation configuration
 */
export interface PlannerConfig {
  /** Maximum steps in a plan */
  maxSteps?: number;
  /** Include optional deep-dive steps */
  includeOptional?: boolean;
  /** Target total latency (ms) */
  targetLatencyMs?: number;
  /** User-specified focus areas */
  focusAreas?: string[];
}

/**
 * Default latency estimates per action (ms)
 */
const ACTION_LATENCY_ESTIMATES: Record<string, number> = {
  // Scout actions (fast)
  scout: 500,
  // Comprehensive analysis
  comprehensive: 3000,
  // Individual analysis actions
  analyze_data: 2000,
  analyze_structure: 1500,
  analyze_quality: 2000,
  analyze_performance: 2500,
  analyze_formulas: 2000,
  // Suggestions
  suggest_visualization: 1500,
  generate_formula: 1000,
  // Pattern detection
  detect_patterns: 3000,
  // Deep dives
  drill_down: 2500,
  // Explanations
  explain_analysis: 1500,
  query_natural_language: 2000,
  // Default
  default: 2000,
};

/**
 * Analysis Planner class
 */
export class Planner {
  private config: Required<PlannerConfig>;

  constructor(config: PlannerConfig = {}) {
    this.config = {
      maxSteps: config.maxSteps ?? 10,
      includeOptional: config.includeOptional ?? true,
      targetLatencyMs: config.targetLatencyMs ?? 30000,
      focusAreas: config.focusAreas ?? [],
    };
  }

  /**
   * Generate an analysis plan based on scout results
   */
  createPlan(
    scoutResult: ScoutResult,
    userGoal?: string,
    overrideIntent?: AnalysisIntent
  ): AnalysisPlan {
    const startTime = Date.now();
    const intent = overrideIntent ?? scoutResult.detectedIntent;
    const { spreadsheetId, indicators } = scoutResult;

    logger.info('Planner: Creating analysis plan', {
      spreadsheetId,
      intent,
      userGoal,
      indicators: {
        sizeCategory: indicators.sizeCategory,
        complexityScore: indicators.complexityScore,
      },
    });

    // Generate unique plan ID
    const planId = `plan_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

    // Build steps based on intent
    const steps = this.buildStepsForIntent(spreadsheetId, intent, indicators, userGoal);

    // Calculate total latency
    const totalEstimatedLatencyMs = steps.reduce((sum, step) => sum + step.estimatedLatencyMs, 0);

    // Identify parallelizable groups
    const parallelizable = this.identifyParallelGroups(steps);

    // Identify critical path
    const criticalPath = this.identifyCriticalPath(steps);

    // Build plan
    const plan: AnalysisPlan = {
      planId,
      spreadsheetId,
      intent,
      title: this.getPlanTitle(intent, userGoal),
      description: this.getPlanDescription(intent, indicators),
      steps,
      totalEstimatedLatencyMs,
      parallelizable,
      criticalPath,
      metadata: {
        createdAt: Date.now(),
        scoutLatencyMs: scoutResult.latencyMs,
        complexityScore: indicators.complexityScore,
        sizeCategory: indicators.sizeCategory,
      },
    };

    logger.info('Planner: Plan created', {
      planId,
      stepCount: steps.length,
      totalEstimatedLatencyMs,
      parallelGroupCount: parallelizable.length,
      planningDurationMs: Date.now() - startTime,
    });

    return plan;
  }

  /**
   * Build steps based on analysis intent
   */
  private buildStepsForIntent(
    spreadsheetId: string,
    intent: AnalysisIntent,
    indicators: QuickIndicators,
    userGoal?: string
  ): PlanStep[] {
    const steps: PlanStep[] = [];
    const baseParams = { spreadsheetId };

    // Intent-specific step generation
    switch (intent) {
      case 'quick':
        steps.push(...this.buildQuickPlan(baseParams, indicators));
        break;
      case 'optimize':
        steps.push(...this.buildOptimizePlan(baseParams, indicators));
        break;
      case 'clean':
        steps.push(...this.buildCleanPlan(baseParams, indicators));
        break;
      case 'visualize':
        steps.push(...this.buildVisualizePlan(baseParams, indicators));
        break;
      case 'understand':
        steps.push(...this.buildUnderstandPlan(baseParams, indicators));
        break;
      case 'audit':
        steps.push(...this.buildAuditPlan(baseParams, indicators));
        break;
      case 'auto':
      default:
        steps.push(...this.buildAutoPlan(baseParams, indicators, userGoal));
    }

    // Add optional deep-dive steps if enabled
    if (this.config.includeOptional && indicators.complexityScore > 40) {
      steps.push(...this.buildOptionalSteps(baseParams, indicators, intent));
    }

    // Limit to max steps and target latency
    return this.optimizeSteps(steps);
  }

  /**
   * Build quick analysis plan (minimal, fast)
   */
  private buildQuickPlan(
    baseParams: Record<string, unknown>,
    _indicators: QuickIndicators
  ): PlanStep[] {
    return [
      this.createStep('analyze_structure', {
        sequence: 1,
        params: baseParams,
        title: 'Quick Structure Scan',
        description: 'Analyze sheet structure and layout',
        dependencies: [],
      }),
      this.createStep('analyze_data', {
        sequence: 2,
        params: { ...baseParams, sampleSize: 100 },
        title: 'Sample Data Analysis',
        description: 'Analyze data patterns from sample',
        dependencies: ['analyze_structure'],
      }),
    ];
  }

  /**
   * Build optimization-focused plan
   */
  private buildOptimizePlan(
    baseParams: Record<string, unknown>,
    indicators: QuickIndicators
  ): PlanStep[] {
    const steps: PlanStep[] = [
      this.createStep('analyze_performance', {
        sequence: 1,
        params: baseParams,
        title: 'Performance Analysis',
        description: 'Identify performance bottlenecks',
        dependencies: [],
      }),
      this.createStep('analyze_formulas', {
        sequence: 2,
        params: baseParams,
        title: 'Formula Efficiency Check',
        description: 'Analyze formula complexity and efficiency',
        dependencies: [],
      }),
    ];

    if (indicators.sizeCategory !== 'tiny') {
      steps.push(
        this.createStep('analyze_structure', {
          sequence: 3,
          params: baseParams,
          title: 'Structure Optimization',
          description: 'Identify structural optimization opportunities',
          dependencies: ['analyze_performance'],
        })
      );
    }

    return steps;
  }

  /**
   * Build data cleaning plan
   */
  private buildCleanPlan(
    baseParams: Record<string, unknown>,
    _indicators: QuickIndicators
  ): PlanStep[] {
    return [
      this.createStep('analyze_quality', {
        sequence: 1,
        params: baseParams,
        title: 'Data Quality Assessment',
        description: 'Detect data quality issues',
        dependencies: [],
      }),
      this.createStep('detect_patterns', {
        sequence: 2,
        params: { ...baseParams, patternTypes: ['duplicates', 'outliers', 'inconsistencies'] },
        title: 'Pattern Detection',
        description: 'Find duplicate and anomalous data',
        dependencies: [],
      }),
      this.createStep('generate_actions', {
        sequence: 3,
        params: { ...baseParams, category: 'data_cleaning' },
        title: 'Generate Cleaning Actions',
        description: 'Create executable cleaning actions',
        dependencies: ['analyze_quality', 'detect_patterns'],
        tool: 'sheets_analyze',
      }),
    ];
  }

  /**
   * Build visualization plan
   */
  private buildVisualizePlan(
    baseParams: Record<string, unknown>,
    _indicators: QuickIndicators
  ): PlanStep[] {
    return [
      this.createStep('analyze_data', {
        sequence: 1,
        params: baseParams,
        title: 'Data Type Analysis',
        description: 'Identify numeric and categorical columns',
        dependencies: [],
      }),
      this.createStep('suggest_visualization', {
        sequence: 2,
        params: baseParams,
        title: 'Visualization Suggestions',
        description: 'Get chart and pivot recommendations',
        dependencies: ['analyze_data'],
      }),
      this.createStep('detect_patterns', {
        sequence: 3,
        params: { ...baseParams, patternTypes: ['trends', 'correlations'] },
        title: 'Trend & Correlation Detection',
        description: 'Find patterns suitable for visualization',
        dependencies: ['analyze_data'],
      }),
    ];
  }

  /**
   * Build understanding plan (comprehensive)
   */
  private buildUnderstandPlan(
    baseParams: Record<string, unknown>,
    indicators: QuickIndicators
  ): PlanStep[] {
    const steps: PlanStep[] = [
      this.createStep('analyze_structure', {
        sequence: 1,
        params: baseParams,
        title: 'Structure Analysis',
        description: 'Understand sheet organization',
        dependencies: [],
      }),
      this.createStep('analyze_data', {
        sequence: 2,
        params: baseParams,
        title: 'Data Analysis',
        description: 'Understand data types and distributions',
        dependencies: [],
      }),
    ];

    if (indicators.multiSheet) {
      steps.push(
        this.createStep('comprehensive', {
          sequence: 3,
          params: { ...baseParams, intent: 'understand', includeAllSheets: true },
          title: 'Cross-Sheet Analysis',
          description: 'Analyze relationships between sheets',
          dependencies: ['analyze_structure'],
        })
      );
    }

    steps.push(
      this.createStep('explain_analysis', {
        sequence: steps.length + 1,
        params: baseParams,
        title: 'Generate Explanation',
        description: 'Create human-readable summary',
        dependencies: ['analyze_structure', 'analyze_data'],
      })
    );

    return steps;
  }

  /**
   * Build audit plan (thorough)
   */
  private buildAuditPlan(
    baseParams: Record<string, unknown>,
    _indicators: QuickIndicators
  ): PlanStep[] {
    return [
      this.createStep('analyze_structure', {
        sequence: 1,
        params: baseParams,
        title: 'Structure Audit',
        description: 'Audit sheet structure and organization',
        dependencies: [],
      }),
      this.createStep('analyze_quality', {
        sequence: 2,
        params: baseParams,
        title: 'Data Quality Audit',
        description: 'Comprehensive data quality checks',
        dependencies: [],
      }),
      this.createStep('analyze_formulas', {
        sequence: 3,
        params: baseParams,
        title: 'Formula Audit',
        description: 'Check formula correctness and efficiency',
        dependencies: [],
      }),
      this.createStep('analyze_performance', {
        sequence: 4,
        params: baseParams,
        title: 'Performance Audit',
        description: 'Identify performance issues',
        dependencies: [],
      }),
      this.createStep('comprehensive', {
        sequence: 5,
        params: { ...baseParams, intent: 'audit', depth: 'full' },
        title: 'Comprehensive Summary',
        description: 'Generate full audit report',
        dependencies: [
          'analyze_structure',
          'analyze_quality',
          'analyze_formulas',
          'analyze_performance',
        ],
      }),
    ];
  }

  /**
   * Build auto plan based on indicators
   */
  private buildAutoPlan(
    baseParams: Record<string, unknown>,
    indicators: QuickIndicators,
    _userGoal?: string
  ): PlanStep[] {
    // Determine best approach based on indicators
    if (indicators.sizeCategory === 'tiny' && indicators.complexityScore < 30) {
      return this.buildQuickPlan(baseParams, indicators);
    }

    if (indicators.complexityScore > 60) {
      return this.buildUnderstandPlan(baseParams, indicators);
    }

    // Default balanced approach
    return [
      this.createStep('analyze_structure', {
        sequence: 1,
        params: baseParams,
        title: 'Structure Analysis',
        description: 'Analyze sheet structure',
        dependencies: [],
      }),
      this.createStep('analyze_data', {
        sequence: 2,
        params: baseParams,
        title: 'Data Analysis',
        description: 'Analyze data patterns',
        dependencies: [],
      }),
      this.createStep('comprehensive', {
        sequence: 3,
        params: { ...baseParams, intent: 'auto', depth: indicators.recommendedDepth },
        title: 'Comprehensive Analysis',
        description: 'Full analysis with auto-detected focus',
        dependencies: ['analyze_structure', 'analyze_data'],
      }),
    ];
  }

  /**
   * Build optional deep-dive steps
   */
  private buildOptionalSteps(
    baseParams: Record<string, unknown>,
    indicators: QuickIndicators,
    intent: AnalysisIntent
  ): PlanStep[] {
    const optionalSteps: PlanStep[] = [];

    // Add pattern detection if not already included
    if (!['clean', 'visualize'].includes(intent)) {
      optionalSteps.push(
        this.createStep('detect_patterns', {
          sequence: 100,
          params: baseParams,
          title: 'Pattern Detection (Optional)',
          description: 'Deep pattern analysis',
          dependencies: [],
          optional: true,
        })
      );
    }

    // Add formula analysis for complex sheets
    if (indicators.complexityScore > 50 && !['optimize', 'audit'].includes(intent)) {
      optionalSteps.push(
        this.createStep('analyze_formulas', {
          sequence: 101,
          params: baseParams,
          title: 'Formula Analysis (Optional)',
          description: 'Detailed formula examination',
          dependencies: [],
          optional: true,
        })
      );
    }

    return optionalSteps;
  }

  /**
   * Create a plan step
   */
  private createStep(
    action: string,
    options: {
      sequence: number;
      params: Record<string, unknown>;
      title: string;
      description: string;
      dependencies: string[];
      optional?: boolean;
      tool?: string;
    }
  ): PlanStep {
    const stepId = `step_${options.sequence}_${action}`;
    return {
      id: stepId,
      sequence: options.sequence,
      tool: options.tool ?? 'sheets_analyze',
      action,
      params: options.params,
      title: options.title,
      description: options.description,
      estimatedLatencyMs: ACTION_LATENCY_ESTIMATES[action] ?? ACTION_LATENCY_ESTIMATES['default']!,
      dependencies: options.dependencies.map((d) => `step_${options.sequence - 1}_${d}`),
      optional: options.optional ?? false,
    };
  }

  /**
   * Optimize steps to fit within constraints
   */
  private optimizeSteps(steps: PlanStep[]): PlanStep[] {
    let optimized = [...steps];

    // Sort by sequence
    optimized.sort((a, b) => a.sequence - b.sequence);

    // Limit to max steps (remove optional first if needed)
    if (optimized.length > this.config.maxSteps) {
      const required = optimized.filter((s) => !s.optional);
      const optional = optimized.filter((s) => s.optional);
      optimized = [...required, ...optional.slice(0, this.config.maxSteps - required.length)];
    }

    // Check total latency
    let totalLatency = optimized.reduce((sum, s) => sum + s.estimatedLatencyMs, 0);
    while (totalLatency > this.config.targetLatencyMs && optimized.some((s) => s.optional)) {
      // Remove optional steps until within target
      const optionalIndex = optimized.findIndex((s) => s.optional);
      if (optionalIndex >= 0) {
        optimized.splice(optionalIndex, 1);
        totalLatency = optimized.reduce((sum, s) => sum + s.estimatedLatencyMs, 0);
      } else {
        break;
      }
    }

    // Re-sequence
    return optimized.map((step, idx) => ({
      ...step,
      sequence: idx + 1,
      id: `step_${idx + 1}_${step.action}`,
    }));
  }

  /**
   * Identify groups of steps that can run in parallel
   */
  private identifyParallelGroups(steps: PlanStep[]): string[][] {
    const groups: string[][] = [];
    let currentGroup: string[] = [];
    let currentSequence = 0;

    for (const step of steps) {
      if (step.dependencies.length === 0 && step.sequence === currentSequence) {
        currentGroup.push(step.id);
      } else if (step.dependencies.length === 0) {
        if (currentGroup.length > 0) {
          groups.push(currentGroup);
        }
        currentGroup = [step.id];
        currentSequence = step.sequence;
      }
    }

    if (currentGroup.length > 0) {
      groups.push(currentGroup);
    }

    return groups.filter((g) => g.length > 1);
  }

  /**
   * Identify the critical path (longest sequential chain)
   */
  private identifyCriticalPath(steps: PlanStep[]): string[] {
    // Simple implementation: return steps with dependencies
    const dependent = steps.filter((s) => s.dependencies.length > 0);
    return dependent.length > 0 ? dependent.map((s) => s.id) : steps.slice(0, 1).map((s) => s.id);
  }

  /**
   * Get plan title based on intent
   */
  private getPlanTitle(intent: AnalysisIntent, userGoal?: string): string {
    if (userGoal) {
      return `Analysis Plan: ${userGoal.slice(0, 50)}`;
    }
    const titles: Record<AnalysisIntent, string> = {
      quick: 'Quick Analysis Plan',
      optimize: 'Optimization Analysis Plan',
      clean: 'Data Cleaning Plan',
      visualize: 'Visualization Planning',
      understand: 'Comprehensive Understanding Plan',
      audit: 'Full Audit Plan',
      auto: 'Adaptive Analysis Plan',
    };
    return titles[intent];
  }

  /**
   * Get plan description based on intent and indicators
   */
  private getPlanDescription(intent: AnalysisIntent, indicators: QuickIndicators): string {
    const sizeNote =
      indicators.sizeCategory !== 'tiny'
        ? ` Optimized for ${indicators.sizeCategory} spreadsheet.`
        : '';
    const complexityNote =
      indicators.complexityScore > 50
        ? ` Accounts for high complexity (score: ${indicators.complexityScore}).`
        : '';

    const descriptions: Record<AnalysisIntent, string> = {
      quick: `Fast analysis for quick insights.${sizeNote}`,
      optimize: `Performance-focused analysis to identify optimization opportunities.${sizeNote}${complexityNote}`,
      clean: `Data quality analysis to identify and fix data issues.${sizeNote}`,
      visualize: `Analysis to recommend effective visualizations.${sizeNote}`,
      understand: `Comprehensive analysis to understand spreadsheet structure and content.${sizeNote}${complexityNote}`,
      audit: `Thorough audit covering structure, quality, formulas, and performance.${sizeNote}${complexityNote}`,
      auto: `Adaptive analysis based on detected characteristics.${sizeNote}${complexityNote}`,
    };
    return descriptions[intent];
  }
}
