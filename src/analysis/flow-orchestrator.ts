/**
 * ServalSheets - Multi-Tool Flow Orchestrator
 *
 * Orchestrates intelligent multi-tool workflows that go beyond simple
 * sequential tool calls. The orchestrator manages:
 *
 * 1. ANALYSIS FLOWS - Scout → Confidence → Elicit → Comprehensive → Actions
 * 2. CLEANUP FLOWS - Quality check → Confirm → Transaction batch → Verify
 * 3. SETUP FLOWS - Analyze → Recommend → Build structure → Apply formatting
 * 4. MIGRATION FLOWS - Import → Map → Transform → Validate → Write
 *
 * Each flow is confidence-aware: low confidence pauses for elicitation,
 * high confidence enables autonomous execution.
 *
 * The orchestrator also provides "multi-tool suggestions" - recommending
 * which tools should be chained together for the user's goal.
 *
 * MCP Protocol: 2025-11-25
 */

import type { ConfidenceAssessment } from './confidence-scorer.js';
import type { UnderstandingSummary } from './understanding-store.js';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Flow types - pre-built multi-tool workflows
 */
export type FlowType =
  | 'deep_understanding' // Scout → Confidence → Elicit → Comprehensive → Store
  | 'smart_cleanup' // Analyze quality → Generate actions → Confirm → Execute batch
  | 'sheet_setup' // Analyze template → Create structure → Format → Validate
  | 'data_import' // Import → Analyze → Clean → Validate → Report
  | 'visualization_builder' // Analyze data → Suggest viz → Create charts → Format
  | 'audit_and_fix' // Comprehensive → Quality → Performance → Generate fixes → Apply
  | 'relationship_mapping'; // Scout → Analyze formulas → Dependencies → Visualize

/**
 * A step in a multi-tool flow
 */
export interface FlowStep {
  id: string;
  /** Display name */
  name: string;
  /** What this step does */
  description: string;
  /** Tool to call */
  tool: string;
  /** Action within the tool */
  action: string;
  /** Parameters (some may be computed from previous steps) */
  params: Record<string, unknown>;
  /** IDs of steps that must complete first */
  dependsOn: string[];
  /** Minimum confidence score to proceed without user input */
  minConfidence?: number;
  /** If confidence is below threshold, what to do */
  onLowConfidence?: 'elicit' | 'skip' | 'use_defaults';
  /** Estimated duration in ms */
  estimatedMs: number;
  /** Whether this step can be skipped */
  optional: boolean;
  /** Whether this step modifies data */
  mutating: boolean;
}

/**
 * A complete multi-tool flow definition
 */
export interface FlowDefinition {
  type: FlowType;
  name: string;
  description: string;
  steps: FlowStep[];
  /** Total estimated duration */
  estimatedTotalMs: number;
  /** Whether any step modifies data */
  hasMutatingSteps: boolean;
  /** Steps that can run in parallel */
  parallelGroups: string[][];
}

/**
 * Recommendation for which flow to use
 */
export interface FlowRecommendation {
  /** Recommended flow */
  flow: FlowType;
  /** Why this flow */
  reason: string;
  /** Confidence in this recommendation */
  confidence: number;
  /** Alternative flows */
  alternatives: Array<{
    flow: FlowType;
    reason: string;
  }>;
}

/**
 * Multi-tool suggestion for ad-hoc tool chaining
 */
export interface MultiToolSuggestion {
  /** What the user should do */
  title: string;
  /** Why this is recommended */
  reason: string;
  /** Tools to chain, in order */
  toolChain: Array<{
    tool: string;
    action: string;
    description: string;
    params?: Record<string, unknown>;
  }>;
  /** Estimated time savings vs individual calls */
  estimatedSavings: string;
  /** Confidence this is the right approach */
  confidence: number;
}

// ============================================================================
// ORCHESTRATOR
// ============================================================================

/**
 * Multi-tool flow orchestrator with confidence awareness
 */
export class FlowOrchestrator {
  /**
   * Recommend the best flow based on understanding and user intent
   */
  recommendFlow(
    understanding: UnderstandingSummary | undefined,
    userIntent?: string
  ): FlowRecommendation {
    // If we have no understanding, always start with deep_understanding
    if (!understanding || understanding.confidenceScore < 30) {
      return {
        flow: 'deep_understanding',
        reason: 'Need to understand the spreadsheet before taking action.',
        confidence: 90,
        alternatives: [],
      };
    }

    // Intent-based routing
    const intent = (userIntent || understanding.userIntent || '').toLowerCase();

    if (this.matchesIntent(intent, ['clean', 'fix', 'quality', 'duplicate', 'error', 'tidy'])) {
      return {
        flow: 'smart_cleanup',
        reason: 'User wants to clean or fix data issues.',
        confidence: 85,
        alternatives: [
          {
            flow: 'audit_and_fix',
            reason: 'More comprehensive: also checks performance and formulas',
          },
        ],
      };
    }

    if (this.matchesIntent(intent, ['chart', 'graph', 'visualiz', 'dashboard', 'plot'])) {
      return {
        flow: 'visualization_builder',
        reason: 'User wants to create visualizations.',
        confidence: 85,
        alternatives: [
          {
            flow: 'deep_understanding',
            reason: 'Understand data first for better chart recommendations',
          },
        ],
      };
    }

    if (this.matchesIntent(intent, ['import', 'csv', 'migrate', 'load', 'upload'])) {
      return {
        flow: 'data_import',
        reason: 'User wants to import or migrate data.',
        confidence: 80,
        alternatives: [
          { flow: 'sheet_setup', reason: 'Set up the destination sheet structure first' },
        ],
      };
    }

    if (this.matchesIntent(intent, ['setup', 'create', 'template', 'new', 'structure'])) {
      return {
        flow: 'sheet_setup',
        reason: 'User wants to set up or create a new sheet structure.',
        confidence: 80,
        alternatives: [],
      };
    }

    if (this.matchesIntent(intent, ['audit', 'review', 'check', 'optimize', 'performance'])) {
      return {
        flow: 'audit_and_fix',
        reason: 'User wants a comprehensive audit.',
        confidence: 85,
        alternatives: [{ flow: 'smart_cleanup', reason: 'Focus only on data quality issues' }],
      };
    }

    if (this.matchesIntent(intent, ['relationship', 'formula', 'depend', 'reference', 'link'])) {
      return {
        flow: 'relationship_mapping',
        reason: 'User wants to understand data relationships.',
        confidence: 80,
        alternatives: [
          { flow: 'deep_understanding', reason: 'Broader understanding including relationships' },
        ],
      };
    }

    // Default: deep understanding if confidence is moderate
    if (understanding.confidenceScore < 65) {
      return {
        flow: 'deep_understanding',
        reason: `Confidence is ${understanding.confidenceScore}/100 — need deeper understanding first.`,
        confidence: 75,
        alternatives: [
          { flow: 'audit_and_fix', reason: 'Skip understanding and go straight to audit' },
        ],
      };
    }

    // High confidence, no clear intent - suggest audit
    return {
      flow: 'audit_and_fix',
      reason: 'Good understanding of the sheet. Running a comprehensive audit.',
      confidence: 70,
      alternatives: [
        { flow: 'smart_cleanup', reason: 'Focus on data quality only' },
        { flow: 'visualization_builder', reason: 'Create charts from the data' },
      ],
    };
  }

  /**
   * Build a flow definition with concrete steps
   */
  buildFlow(
    flowType: FlowType,
    spreadsheetId: string,
    confidence?: ConfidenceAssessment
  ): FlowDefinition {
    const baseParams = { spreadsheetId };

    switch (flowType) {
      case 'deep_understanding':
        return this.buildDeepUnderstandingFlow(baseParams, confidence);
      case 'smart_cleanup':
        return this.buildSmartCleanupFlow(baseParams, confidence);
      case 'sheet_setup':
        return this.buildSheetSetupFlow(baseParams);
      case 'data_import':
        return this.buildDataImportFlow(baseParams);
      case 'visualization_builder':
        return this.buildVisualizationFlow(baseParams, confidence);
      case 'audit_and_fix':
        return this.buildAuditFlow(baseParams);
      case 'relationship_mapping':
        return this.buildRelationshipFlow(baseParams);
      default:
        return this.buildDeepUnderstandingFlow(baseParams, confidence);
    }
  }

  /**
   * Generate multi-tool suggestions based on current context
   */
  suggestMultiToolChains(
    understanding: UnderstandingSummary | undefined,
    recentAction?: { tool: string; action: string }
  ): MultiToolSuggestion[] {
    const suggestions: MultiToolSuggestion[] = [];

    // Context-aware suggestions based on what just happened
    if (recentAction) {
      const afterAction = this.getSuggestionsAfterAction(
        recentAction.tool,
        recentAction.action,
        understanding
      );
      suggestions.push(...afterAction);
    }

    // General suggestions based on understanding state
    if (understanding) {
      if (understanding.confidenceScore < 50) {
        suggestions.push({
          title: 'Build Understanding First',
          reason: `Current understanding is at ${understanding.confidenceScore}%. A scout + comprehensive analysis will dramatically improve context.`,
          toolChain: [
            { tool: 'sheets_analyze', action: 'scout', description: 'Quick metadata scan' },
            { tool: 'sheets_analyze', action: 'comprehensive', description: 'Full analysis' },
          ],
          estimatedSavings: '5-10 minutes of manual exploration',
          confidence: 90,
        });
      }

      if (understanding.topGaps.length > 0) {
        suggestions.push({
          title: 'Fill Knowledge Gaps',
          reason: `${understanding.topGaps.length} understanding gaps: ${understanding.topGaps.slice(0, 2).join(', ')}`,
          toolChain: [
            {
              tool: 'sheets_analyze',
              action: 'drill_down',
              description: 'Deep dive on weak areas',
            },
            {
              tool: 'sheets_analyze',
              action: 'analyze_quality',
              description: 'Verify data quality',
            },
          ],
          estimatedSavings: '3-5 minutes',
          confidence: 75,
        });
      }
    }

    return suggestions;
  }

  // ==========================================================================
  // FLOW BUILDERS
  // ==========================================================================

  private buildDeepUnderstandingFlow(
    baseParams: Record<string, unknown>,
    _confidence?: ConfidenceAssessment
  ): FlowDefinition {
    const steps: FlowStep[] = [
      {
        id: 'scout',
        name: 'Scout Analysis',
        description: 'Quick metadata scan to gather essential information',
        tool: 'sheets_analyze',
        action: 'scout',
        params: baseParams,
        dependsOn: [],
        estimatedMs: 500,
        optional: false,
        mutating: false,
      },
      {
        id: 'comprehensive',
        name: 'Comprehensive Analysis',
        description: 'Full analysis of data, quality, patterns, and structure',
        tool: 'sheets_analyze',
        action: 'comprehensive',
        params: baseParams,
        dependsOn: ['scout'],
        minConfidence: 30,
        onLowConfidence: 'elicit',
        estimatedMs: 3000,
        optional: false,
        mutating: false,
      },
      {
        id: 'quality',
        name: 'Quality Deep-Dive',
        description: 'Detailed quality analysis if issues were detected',
        tool: 'sheets_analyze',
        action: 'analyze_quality',
        params: baseParams,
        dependsOn: ['comprehensive'],
        estimatedMs: 2000,
        optional: true,
        mutating: false,
      },
      {
        id: 'suggest_viz',
        name: 'Visualization Suggestions',
        description: 'Recommend charts and visualizations for the data',
        tool: 'sheets_analyze',
        action: 'suggest_visualization',
        params: baseParams,
        dependsOn: ['comprehensive'],
        estimatedMs: 1500,
        optional: true,
        mutating: false,
      },
      {
        id: 'generate_actions',
        name: 'Action Generation',
        description: 'Generate recommended actions based on findings',
        tool: 'sheets_analyze',
        action: 'generate_actions',
        params: baseParams,
        dependsOn: ['comprehensive'],
        estimatedMs: 500,
        optional: false,
        mutating: false,
      },
    ];

    return {
      type: 'deep_understanding',
      name: 'Deep Understanding Flow',
      description:
        'Build comprehensive understanding of the spreadsheet with confidence-aware elicitation.',
      steps,
      estimatedTotalMs: steps.reduce((sum, s) => sum + s.estimatedMs, 0),
      hasMutatingSteps: false,
      parallelGroups: [['quality', 'suggest_viz', 'generate_actions']],
    };
  }

  private buildSmartCleanupFlow(
    baseParams: Record<string, unknown>,
    _confidence?: ConfidenceAssessment
  ): FlowDefinition {
    const steps: FlowStep[] = [
      {
        id: 'quality_check',
        name: 'Quality Assessment',
        description: 'Identify all data quality issues',
        tool: 'sheets_analyze',
        action: 'analyze_quality',
        params: baseParams,
        dependsOn: [],
        estimatedMs: 2000,
        optional: false,
        mutating: false,
      },
      {
        id: 'generate_fixes',
        name: 'Generate Fix Actions',
        description: 'Create specific actions for each issue',
        tool: 'sheets_analyze',
        action: 'generate_actions',
        params: { ...baseParams, category: 'data_cleaning' },
        dependsOn: ['quality_check'],
        minConfidence: 50,
        onLowConfidence: 'elicit',
        estimatedMs: 500,
        optional: false,
        mutating: false,
      },
      {
        id: 'validate_before',
        name: 'Pre-Cleanup Validation',
        description: 'Validate the proposed changes before applying',
        tool: 'sheets_quality',
        action: 'validate',
        params: baseParams,
        dependsOn: ['generate_fixes'],
        estimatedMs: 1000,
        optional: false,
        mutating: false,
      },
      {
        id: 'begin_transaction',
        name: 'Start Atomic Transaction',
        description: 'Begin transaction for safe batch operations',
        tool: 'sheets_transaction',
        action: 'begin',
        params: { ...baseParams, autoSnapshot: true },
        dependsOn: ['validate_before'],
        estimatedMs: 200,
        optional: false,
        mutating: false,
      },
      {
        id: 'apply_fixes',
        name: 'Apply Cleanup Actions',
        description: 'Execute all cleanup actions in a single batch',
        tool: 'sheets_transaction',
        action: 'commit',
        params: baseParams,
        dependsOn: ['begin_transaction'],
        minConfidence: 65,
        onLowConfidence: 'elicit',
        estimatedMs: 2000,
        optional: false,
        mutating: true,
      },
      {
        id: 'verify_cleanup',
        name: 'Post-Cleanup Verification',
        description: 'Verify data quality improved after cleanup',
        tool: 'sheets_analyze',
        action: 'analyze_quality',
        params: baseParams,
        dependsOn: ['apply_fixes'],
        estimatedMs: 2000,
        optional: false,
        mutating: false,
      },
    ];

    return {
      type: 'smart_cleanup',
      name: 'Smart Cleanup Flow',
      description: 'Identify, validate, and fix data quality issues in a safe transaction.',
      steps,
      estimatedTotalMs: steps.reduce((sum, s) => sum + s.estimatedMs, 0),
      hasMutatingSteps: true,
      parallelGroups: [],
    };
  }

  private buildSheetSetupFlow(baseParams: Record<string, unknown>): FlowDefinition {
    const steps: FlowStep[] = [
      {
        id: 'analyze_template',
        name: 'Analyze Requirements',
        description: 'Understand the desired sheet structure',
        tool: 'sheets_analyze',
        action: 'scout',
        params: baseParams,
        dependsOn: [],
        minConfidence: 40,
        onLowConfidence: 'elicit',
        estimatedMs: 500,
        optional: false,
        mutating: false,
      },
      {
        id: 'setup_structure',
        name: 'Create Sheet Structure',
        description: 'Create the sheet with headers, columns, and validation',
        tool: 'sheets_composite',
        action: 'setup_sheet',
        params: baseParams,
        dependsOn: ['analyze_template'],
        estimatedMs: 1500,
        optional: false,
        mutating: true,
      },
      {
        id: 'apply_formatting',
        name: 'Apply Formatting',
        description: 'Apply header formatting, borders, and number formats',
        tool: 'sheets_format',
        action: 'apply_preset',
        params: baseParams,
        dependsOn: ['setup_structure'],
        estimatedMs: 1000,
        optional: false,
        mutating: true,
      },
      {
        id: 'add_validation',
        name: 'Add Data Validation',
        description: 'Set up data validation rules for key columns',
        tool: 'sheets_format',
        action: 'set_data_validation',
        params: baseParams,
        dependsOn: ['setup_structure'],
        estimatedMs: 800,
        optional: true,
        mutating: true,
      },
    ];

    return {
      type: 'sheet_setup',
      name: 'Sheet Setup Flow',
      description: 'Create a well-structured sheet with formatting and validation.',
      steps,
      estimatedTotalMs: steps.reduce((sum, s) => sum + s.estimatedMs, 0),
      hasMutatingSteps: true,
      parallelGroups: [['apply_formatting', 'add_validation']],
    };
  }

  private buildDataImportFlow(baseParams: Record<string, unknown>): FlowDefinition {
    const steps: FlowStep[] = [
      {
        id: 'import_data',
        name: 'Import Data',
        description: 'Import CSV/Excel data with automatic format detection',
        tool: 'sheets_composite',
        action: 'import_csv',
        params: baseParams,
        dependsOn: [],
        estimatedMs: 2000,
        optional: false,
        mutating: true,
      },
      {
        id: 'analyze_imported',
        name: 'Analyze Imported Data',
        description: 'Analyze the imported data for quality and structure',
        tool: 'sheets_analyze',
        action: 'comprehensive',
        params: baseParams,
        dependsOn: ['import_data'],
        estimatedMs: 3000,
        optional: false,
        mutating: false,
      },
      {
        id: 'clean_data',
        name: 'Clean Imported Data',
        description: 'Fix quality issues detected in import',
        tool: 'sheets_dimensions',
        action: 'trim_whitespace',
        params: baseParams,
        dependsOn: ['analyze_imported'],
        estimatedMs: 1500,
        optional: true,
        mutating: true,
      },
      {
        id: 'format_data',
        name: 'Format Imported Data',
        description: 'Apply appropriate formatting to the imported data',
        tool: 'sheets_format',
        action: 'apply_preset',
        params: baseParams,
        dependsOn: ['import_data'],
        estimatedMs: 1000,
        optional: true,
        mutating: true,
      },
    ];

    return {
      type: 'data_import',
      name: 'Data Import Flow',
      description: 'Import data with automatic analysis, cleanup, and formatting.',
      steps,
      estimatedTotalMs: steps.reduce((sum, s) => sum + s.estimatedMs, 0),
      hasMutatingSteps: true,
      parallelGroups: [['clean_data', 'format_data']],
    };
  }

  private buildVisualizationFlow(
    baseParams: Record<string, unknown>,
    _confidence?: ConfidenceAssessment
  ): FlowDefinition {
    const steps: FlowStep[] = [
      {
        id: 'analyze_data',
        name: 'Analyze Data for Visualization',
        description: 'Understand data patterns suitable for charting',
        tool: 'sheets_analyze',
        action: 'analyze_data',
        params: baseParams,
        dependsOn: [],
        estimatedMs: 2000,
        optional: false,
        mutating: false,
      },
      {
        id: 'detect_patterns',
        name: 'Detect Patterns',
        description: 'Find trends, correlations, and distributions',
        tool: 'sheets_analyze',
        action: 'detect_patterns',
        params: baseParams,
        dependsOn: ['analyze_data'],
        estimatedMs: 3000,
        optional: false,
        mutating: false,
      },
      {
        id: 'suggest_viz',
        name: 'Get Visualization Recommendations',
        description: 'Get AI-powered chart and visualization suggestions',
        tool: 'sheets_analyze',
        action: 'suggest_visualization',
        params: baseParams,
        dependsOn: ['detect_patterns'],
        minConfidence: 50,
        onLowConfidence: 'elicit',
        estimatedMs: 1500,
        optional: false,
        mutating: false,
      },
      {
        id: 'create_charts',
        name: 'Create Charts',
        description: 'Create the recommended visualizations',
        tool: 'sheets_visualize',
        action: 'chart_create',
        params: baseParams,
        dependsOn: ['suggest_viz'],
        estimatedMs: 2000,
        optional: false,
        mutating: true,
      },
    ];

    return {
      type: 'visualization_builder',
      name: 'Visualization Builder Flow',
      description: 'Analyze data patterns and create appropriate charts.',
      steps,
      estimatedTotalMs: steps.reduce((sum, s) => sum + s.estimatedMs, 0),
      hasMutatingSteps: true,
      parallelGroups: [],
    };
  }

  private buildAuditFlow(baseParams: Record<string, unknown>): FlowDefinition {
    const steps: FlowStep[] = [
      {
        id: 'comprehensive',
        name: 'Comprehensive Analysis',
        description: 'Full spreadsheet analysis covering all dimensions',
        tool: 'sheets_analyze',
        action: 'comprehensive',
        params: baseParams,
        dependsOn: [],
        estimatedMs: 3000,
        optional: false,
        mutating: false,
      },
      {
        id: 'quality',
        name: 'Quality Audit',
        description: 'Detailed data quality assessment',
        tool: 'sheets_analyze',
        action: 'analyze_quality',
        params: baseParams,
        dependsOn: ['comprehensive'],
        estimatedMs: 2000,
        optional: false,
        mutating: false,
      },
      {
        id: 'performance',
        name: 'Performance Audit',
        description: 'Check for performance bottlenecks',
        tool: 'sheets_analyze',
        action: 'analyze_performance',
        params: baseParams,
        dependsOn: ['comprehensive'],
        estimatedMs: 2500,
        optional: false,
        mutating: false,
      },
      {
        id: 'formulas',
        name: 'Formula Audit',
        description: 'Analyze formula efficiency and correctness',
        tool: 'sheets_analyze',
        action: 'analyze_formulas',
        params: baseParams,
        dependsOn: ['comprehensive'],
        estimatedMs: 2000,
        optional: true,
        mutating: false,
      },
      {
        id: 'generate_fixes',
        name: 'Generate Fix Recommendations',
        description: 'Create actionable fix recommendations from all findings',
        tool: 'sheets_analyze',
        action: 'generate_actions',
        params: baseParams,
        dependsOn: ['quality', 'performance', 'formulas'],
        estimatedMs: 500,
        optional: false,
        mutating: false,
      },
    ];

    return {
      type: 'audit_and_fix',
      name: 'Audit & Fix Flow',
      description:
        'Comprehensive audit covering quality, performance, and formulas with fix recommendations.',
      steps,
      estimatedTotalMs: steps.reduce((sum, s) => sum + s.estimatedMs, 0),
      hasMutatingSteps: false,
      parallelGroups: [['quality', 'performance', 'formulas']],
    };
  }

  private buildRelationshipFlow(baseParams: Record<string, unknown>): FlowDefinition {
    const steps: FlowStep[] = [
      {
        id: 'scout',
        name: 'Structure Scan',
        description: 'Quick scan for sheets, formulas, and named ranges',
        tool: 'sheets_analyze',
        action: 'scout',
        params: baseParams,
        dependsOn: [],
        estimatedMs: 500,
        optional: false,
        mutating: false,
      },
      {
        id: 'formulas',
        name: 'Formula Analysis',
        description: 'Map all formula dependencies',
        tool: 'sheets_analyze',
        action: 'analyze_formulas',
        params: baseParams,
        dependsOn: ['scout'],
        estimatedMs: 2000,
        optional: false,
        mutating: false,
      },
      {
        id: 'dependencies',
        name: 'Dependency Graph',
        description: 'Build the complete formula dependency graph',
        tool: 'sheets_dependencies',
        action: 'build',
        params: baseParams,
        dependsOn: ['formulas'],
        estimatedMs: 1500,
        optional: false,
        mutating: false,
      },
      {
        id: 'detect_cycles',
        name: 'Cycle Detection',
        description: 'Check for circular references',
        tool: 'sheets_dependencies',
        action: 'detect_cycles',
        params: baseParams,
        dependsOn: ['dependencies'],
        estimatedMs: 500,
        optional: true,
        mutating: false,
      },
    ];

    return {
      type: 'relationship_mapping',
      name: 'Relationship Mapping Flow',
      description: 'Map all data relationships, formula dependencies, and cross-references.',
      steps,
      estimatedTotalMs: steps.reduce((sum, s) => sum + s.estimatedMs, 0),
      hasMutatingSteps: false,
      parallelGroups: [],
    };
  }

  // ==========================================================================
  // HELPERS
  // ==========================================================================

  private matchesIntent(text: string, keywords: string[]): boolean {
    return keywords.some((kw) => text.includes(kw));
  }

  private getSuggestionsAfterAction(
    tool: string,
    action: string,
    _understanding?: UnderstandingSummary
  ): MultiToolSuggestion[] {
    const suggestions: MultiToolSuggestion[] = [];

    // After reading data, suggest analysis
    if (tool === 'sheets_data' && action === 'read') {
      suggestions.push({
        title: 'Analyze the data you just read',
        reason: 'Get automatic insights, patterns, and quality assessment.',
        toolChain: [
          { tool: 'sheets_analyze', action: 'comprehensive', description: 'Full analysis' },
          {
            tool: 'sheets_analyze',
            action: 'suggest_visualization',
            description: 'Chart recommendations',
          },
        ],
        estimatedSavings: '5-10 minutes of manual review',
        confidence: 85,
      });
    }

    // After writing data, suggest validation
    if (tool === 'sheets_data' && (action === 'write' || action === 'append')) {
      suggestions.push({
        title: 'Validate written data',
        reason: 'Ensure data integrity after write operation.',
        toolChain: [
          { tool: 'sheets_analyze', action: 'analyze_quality', description: 'Quality check' },
          {
            tool: 'sheets_format',
            action: 'suggest_format',
            description: 'Formatting suggestions',
          },
        ],
        estimatedSavings: '2-3 minutes',
        confidence: 75,
      });
    }

    // After analysis, suggest actions
    if (tool === 'sheets_analyze' && action === 'comprehensive') {
      suggestions.push({
        title: 'Act on analysis findings',
        reason: 'Generate and apply recommended actions from the analysis.',
        toolChain: [
          {
            tool: 'sheets_analyze',
            action: 'generate_actions',
            description: 'Generate fix actions',
          },
          { tool: 'sheets_fix', action: 'fix', description: 'Auto-fix safe issues' },
        ],
        estimatedSavings: '5-15 minutes of manual fixes',
        confidence: 80,
      });
    }

    // After creating a chart, suggest formatting
    if (tool === 'sheets_visualize' && action === 'chart_create') {
      suggestions.push({
        title: 'Enhance your chart',
        reason: 'Add trendlines or move the chart to a dashboard sheet.',
        toolChain: [
          {
            tool: 'sheets_visualize',
            action: 'chart_add_trendline',
            description: 'Add trendline',
          },
          {
            tool: 'sheets_visualize',
            action: 'chart_move',
            description: 'Move to dashboard sheet',
          },
        ],
        estimatedSavings: '1-2 minutes',
        confidence: 60,
      });
    }

    // After import, suggest full pipeline
    if (tool === 'sheets_composite' && (action === 'import_csv' || action === 'import_xlsx')) {
      suggestions.push({
        title: 'Post-import cleanup pipeline',
        reason: 'Clean, format, and validate imported data.',
        toolChain: [
          {
            tool: 'sheets_dimensions',
            action: 'trim_whitespace',
            description: 'Clean whitespace',
          },
          { tool: 'sheets_analyze', action: 'analyze_quality', description: 'Quality check' },
          { tool: 'sheets_format', action: 'apply_preset', description: 'Apply formatting' },
          { tool: 'sheets_dimensions', action: 'freeze', description: 'Freeze headers' },
        ],
        estimatedSavings: '5-10 minutes',
        confidence: 85,
      });
    }

    return suggestions;
  }
}
