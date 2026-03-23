/**
 * ServalSheets - Action Generator Module
 *
 * Generates executable actions from analysis findings. Actions are fully
 * parameterized and ready to execute via the MCP tool system.
 *
 * This module converts analysis insights into concrete, actionable steps
 * that an LLM can execute to improve the spreadsheet.
 *
 * MCP Protocol: 2025-11-25
 */

import { logger } from '../utils/logger.js';

/**
 * Risk levels for generated actions
 */
export type ActionRiskLevel = 'none' | 'low' | 'medium' | 'high' | 'critical';

/**
 * Action categories
 */
export type ActionCategory =
  | 'read'
  | 'format'
  | 'data_entry'
  | 'structure'
  | 'formula'
  | 'visualization'
  | 'collaboration'
  | 'optimization'
  | 'data_cleaning';

/**
 * An executable action with full parameters
 */
export interface ExecutableAction {
  id: string;
  priority: number;
  tool: string;
  action: string;
  params: Record<string, unknown>;
  title: string;
  description: string;
  impact?: {
    cellsAffected?: number;
    sheetsAffected?: number;
    estimatedTimeMs?: number;
  };
  risk: ActionRiskLevel;
  reversible: boolean;
  requiresConfirmation: boolean;
  category: ActionCategory;
  relatedFindings?: string[];
  reasoning?: {
    why: string;
    impact?: {
      quotaSavings?: string;
      latencySavings?: string;
      qualityImprovement?: string;
    };
    tradeoffs?: {
      pros: string[];
      cons: string[];
    };
    alternatives?: Array<{
      action: string;
      when: string;
      benefit: string;
    }>;
    confidence: number;
    basedOn?: string[];
  };
}

/**
 * Finding from analysis that can be converted to action
 */
export interface AnalysisFinding {
  id: string;
  type: 'issue' | 'opportunity' | 'insight';
  severity: 'info' | 'warning' | 'error' | 'critical';
  title: string;
  description: string;
  location?: {
    sheetId?: number;
    sheetName?: string;
    range?: string;
    cells?: Array<{ row: number; col: number }>;
  };
  data?: Record<string, unknown>;
}

/**
 * Action generation request
 */
export interface GenerateActionsRequest {
  spreadsheetId: string;
  findings: AnalysisFinding[];
  category?: ActionCategory;
  maxActions?: number;
  includeReadOnly?: boolean;
  riskTolerance?: ActionRiskLevel;
}

/**
 * Action generation result
 */
export interface GenerateActionsResult {
  actions: ExecutableAction[];
  summary: {
    totalFindings: number;
    actionableFindings: number;
    generatedActions: number;
    byCategory: Record<ActionCategory, number>;
    byRisk: Record<ActionRiskLevel, number>;
  };
  nextSteps?: {
    recommended: ExecutableAction | null;
    alternatives: ExecutableAction[];
  };
}

/**
 * Action templates for common operations
 */
const ACTION_TEMPLATES: Record<string, Partial<ExecutableAction>> = {
  // Data cleaning actions
  remove_duplicates: {
    tool: 'sheets_composite',
    action: 'deduplicate',
    risk: 'medium',
    reversible: false,
    requiresConfirmation: true,
    category: 'data_cleaning',
  },
  trim_whitespace: {
    tool: 'sheets_dimensions',
    action: 'trim_whitespace',
    risk: 'low',
    reversible: false,
    requiresConfirmation: false,
    category: 'data_cleaning',
  },
  set_validation: {
    tool: 'sheets_format',
    action: 'set_data_validation',
    risk: 'low',
    reversible: true,
    requiresConfirmation: false,
    category: 'data_cleaning',
  },

  // Formatting actions
  set_number_format: {
    tool: 'sheets_format',
    action: 'set_number_format',
    risk: 'none',
    reversible: true,
    requiresConfirmation: false,
    category: 'format',
  },
  apply_preset: {
    tool: 'sheets_format',
    action: 'apply_preset',
    risk: 'low',
    reversible: true,
    requiresConfirmation: false,
    category: 'format',
  },
  add_conditional_format: {
    tool: 'sheets_format',
    action: 'add_conditional_format_rule',
    risk: 'none',
    reversible: true,
    requiresConfirmation: false,
    category: 'format',
  },

  // Structure actions
  freeze_rows: {
    tool: 'sheets_dimensions',
    action: 'freeze',
    risk: 'none',
    reversible: true,
    requiresConfirmation: false,
    category: 'structure',
  },
  auto_resize: {
    tool: 'sheets_dimensions',
    action: 'auto_resize',
    risk: 'none',
    reversible: false,
    requiresConfirmation: false,
    category: 'structure',
  },
  set_basic_filter: {
    tool: 'sheets_dimensions',
    action: 'set_basic_filter',
    risk: 'none',
    reversible: true,
    requiresConfirmation: false,
    category: 'structure',
  },

  // Visualization actions
  create_chart: {
    tool: 'sheets_visualize',
    action: 'chart_create',
    risk: 'none',
    reversible: true,
    requiresConfirmation: false,
    category: 'visualization',
  },
  create_pivot: {
    tool: 'sheets_visualize',
    action: 'pivot_create',
    risk: 'none',
    reversible: true,
    requiresConfirmation: false,
    category: 'visualization',
  },

  // Optimization actions
  add_named_range: {
    tool: 'sheets_advanced',
    action: 'add_named_range',
    risk: 'none',
    reversible: true,
    requiresConfirmation: false,
    category: 'optimization',
  },
};

/**
 * Action Generator class
 */
export class ActionGenerator {
  private idCounter: number = 0;

  /**
   * Generate executable actions from analysis findings
   */
  generateActions(request: GenerateActionsRequest): GenerateActionsResult {
    const {
      spreadsheetId,
      findings,
      category,
      maxActions = 10,
      riskTolerance = 'medium',
    } = request;

    logger.info('ActionGenerator: Generating actions', {
      spreadsheetId,
      findingCount: findings.length,
      category,
      maxActions,
      riskTolerance,
    });

    const actions: ExecutableAction[] = [];
    const riskOrder: ActionRiskLevel[] = ['none', 'low', 'medium', 'high', 'critical'];
    const maxRiskIndex = riskOrder.indexOf(riskTolerance);

    // Process each finding
    for (const finding of findings) {
      const generatedActions = this.findingToActions(spreadsheetId, finding);

      // Filter by category and risk
      const filtered = generatedActions.filter((action) => {
        if (category && action.category !== category) return false;
        if (riskOrder.indexOf(action.risk) > maxRiskIndex) return false;
        return true;
      });

      actions.push(...filtered);
    }

    // Sort by priority and limit
    actions.sort((a, b) => a.priority - b.priority);
    const limitedActions = actions.slice(0, maxActions);

    // Calculate summary
    const summary = this.calculateSummary(findings, limitedActions);

    // Determine next steps
    const nextSteps = this.determineNextSteps(limitedActions);

    logger.info('ActionGenerator: Actions generated', {
      spreadsheetId,
      generatedCount: limitedActions.length,
      categories: Object.keys(summary.byCategory).filter(
        (k) => summary.byCategory[k as ActionCategory] > 0
      ),
    });

    return {
      actions: limitedActions,
      summary,
      nextSteps,
    };
  }

  /**
   * Convert a single finding to executable actions
   */
  private findingToActions(spreadsheetId: string, finding: AnalysisFinding): ExecutableAction[] {
    const actions: ExecutableAction[] = [];
    const baseParams: Record<string, unknown> = { spreadsheetId };

    if (finding.location?.sheetName) {
      baseParams['sheetName'] = finding.location.sheetName;
    }
    if (finding.location?.range) {
      baseParams['range'] = finding.location.range;
    }

    // Map finding types to actions
    const findingType = finding.data?.['findingType'] as string | undefined;

    switch (findingType) {
      case 'duplicate_rows':
        actions.push(
          this.createAction('remove_duplicates', {
            spreadsheetId,
            finding,
            params: {
              ...baseParams,
              range: finding.location?.range,
              compareColumns: finding.data?.['columns'],
            },
            title: 'Remove Duplicate Rows',
            description: `Remove ${finding.data?.['count'] ?? 'duplicate'} duplicate rows`,
            priority: 2,
            impact: { cellsAffected: (finding.data?.['count'] as number) ?? 0 },
          })
        );
        break;

      case 'inconsistent_format':
        actions.push(
          this.createAction('set_number_format', {
            spreadsheetId,
            finding,
            params: {
              ...baseParams,
              range: finding.location?.range,
              format: finding.data?.['suggestedFormat'] ?? 'NUMBER',
            },
            title: 'Standardize Number Format',
            description: `Apply consistent formatting to ${finding.location?.range}`,
            priority: 3,
          })
        );
        break;

      case 'missing_validation':
        actions.push(
          this.createAction('set_validation', {
            spreadsheetId,
            finding,
            params: {
              ...baseParams,
              range: finding.location?.range,
              type: finding.data?.['validationType'] ?? 'ONE_OF_LIST',
              values: finding.data?.['allowedValues'],
            },
            title: 'Add Data Validation',
            description: `Add validation rules to ${finding.location?.range}`,
            priority: 4,
          })
        );
        break;

      case 'no_header_freeze':
        actions.push(
          this.createAction('freeze_rows', {
            spreadsheetId,
            finding,
            params: {
              ...baseParams,
              rowCount: 1,
            },
            title: 'Freeze Header Row',
            description: 'Freeze the first row to keep headers visible',
            priority: 5,
          })
        );
        break;

      case 'missing_filter':
        actions.push(
          this.createAction('set_basic_filter', {
            spreadsheetId,
            finding,
            params: {
              ...baseParams,
              range: finding.location?.range,
            },
            title: 'Add Filter',
            description: 'Add filter for easier data navigation',
            priority: 5,
          })
        );
        break;

      case 'visualization_opportunity':
        actions.push(
          this.createAction('create_chart', {
            spreadsheetId,
            finding,
            params: {
              ...baseParams,
              dataRange: finding.location?.range,
              chartType: finding.data?.['suggestedChartType'] ?? 'COLUMN',
              title: finding.data?.['suggestedTitle'] ?? 'Chart',
            },
            title: 'Create Chart',
            description: `Create ${finding.data?.['suggestedChartType'] ?? 'column'} chart`,
            priority: 6,
          })
        );
        break;

      case 'whitespace_issues':
        actions.push(
          this.createAction('trim_whitespace', {
            spreadsheetId,
            finding,
            params: {
              ...baseParams,
              range: finding.location?.range,
            },
            title: 'Trim Whitespace',
            description: `Clean whitespace in ${finding.location?.range}`,
            priority: 3,
            impact: { cellsAffected: (finding.data?.['affectedCells'] as number) ?? 0 },
          })
        );
        break;

      case 'column_resize_needed':
        actions.push(
          this.createAction('auto_resize', {
            spreadsheetId,
            finding,
            params: {
              ...baseParams,
              dimension: 'COLUMNS',
            },
            title: 'Auto-Resize Columns',
            description: 'Resize columns to fit content',
            priority: 7,
          })
        );
        break;

      case 'named_range_opportunity':
        actions.push(
          this.createAction('add_named_range', {
            spreadsheetId,
            finding,
            params: {
              ...baseParams,
              name: finding.data?.['suggestedName'],
              range: finding.location?.range,
            },
            title: 'Create Named Range',
            description: `Create named range "${finding.data?.['suggestedName']}"`,
            priority: 8,
          })
        );
        break;

      default:
        // Generic action based on finding severity
        if (finding.type === 'issue' && finding.severity !== 'info') {
          actions.push({
            id: this.generateId(),
            priority: finding.severity === 'critical' ? 1 : finding.severity === 'error' ? 2 : 3,
            tool: 'sheets_analyze',
            action: 'drill_down',
            params: {
              spreadsheetId,
              area: 'issues',
              findingId: finding.id,
            },
            title: `Investigate: ${finding.title}`,
            description: finding.description,
            risk: 'none',
            reversible: true,
            requiresConfirmation: false,
            category: 'read',
            relatedFindings: [finding.id],
          });
        }
    }

    return actions;
  }

  /**
   * Create an action from a template
   */
  private createAction(
    templateName: string,
    options: {
      spreadsheetId: string;
      finding: AnalysisFinding;
      params: Record<string, unknown>;
      title: string;
      description: string;
      priority: number;
      impact?: ExecutableAction['impact'];
    }
  ): ExecutableAction {
    const template = ACTION_TEMPLATES[templateName] ?? {
      tool: 'sheets_data',
      action: 'read',
      risk: 'none' as ActionRiskLevel,
      reversible: true,
      requiresConfirmation: false,
      category: 'read' as ActionCategory,
    };

    const action: ExecutableAction = {
      id: this.generateId(),
      priority: options.priority,
      tool: template.tool!,
      action: template.action!,
      params: options.params,
      title: options.title,
      description: options.description,
      impact: options.impact,
      risk: template.risk!,
      reversible: template.reversible!,
      requiresConfirmation: template.requiresConfirmation!,
      category: template.category!,
      relatedFindings: [options.finding.id],
    };

    // Add reasoning transparency
    action.reasoning = this.generateReasoning(options.finding, action);

    return action;
  }

  /**
   * Generate unique action ID
   */
  private generateId(): string {
    this.idCounter++;
    return `action_${Date.now()}_${this.idCounter}`;
  }

  /**
   * Generate reasoning for an action
   */
  private generateReasoning(
    finding: AnalysisFinding,
    action: Partial<ExecutableAction>
  ): ExecutableAction['reasoning'] {
    const severity = finding.severity;
    const isAutoFixable = action.reversible && action.risk === 'none';

    const pros = [
      action.category === 'data_cleaning'
        ? 'Improves data quality immediately'
        : action.category === 'visualization'
          ? 'Makes data insights more accessible'
          : action.category === 'format'
            ? 'Enhances readability and professionalism'
            : 'Addresses identified issue',
    ];

    const cons: string[] = [];

    if (!action.reversible) {
      cons.push('Cannot be undone - proceed with caution');
    }

    if (action.risk === 'medium' || action.risk === 'high') {
      cons.push('May affect existing data or formulas');
    }

    if (severity === 'info') {
      cons.push('Low impact if ignored - optional improvement');
    }

    const alternatives: Array<{ action: string; when: string; benefit: string }> = [];

    if (isAutoFixable) {
      alternatives.push({
        action: 'Manual fix via sheets_data',
        when: 'If you need fine-grained control',
        benefit: 'More control but requires more API calls',
      });
    }

    const basedOn = [`Detected ${finding.type}: ${finding.title}`];
    if (finding.data?.['count']) {
      basedOn.push(`Found ${finding.data['count']} instances`);
    }
    basedOn.push(`Severity: ${severity}`);

    const confidence =
      severity === 'critical'
        ? 0.95
        : severity === 'error'
          ? 0.85
          : severity === 'warning'
            ? 0.75
            : 0.6;

    const qualityImpact = action.category === 'data_cleaning' ? '+15% data quality' : undefined;

    return {
      why: `Fix detected ${finding.type} to improve ${action.category} quality`,
      impact: {
        qualityImprovement: qualityImpact,
        quotaSavings: isAutoFixable ? '1 API call vs 5-10 manual fixes' : undefined,
      },
      tradeoffs: {
        pros,
        cons,
      },
      alternatives: alternatives.length > 0 ? alternatives : undefined,
      confidence,
      basedOn,
    };
  }

  /**
   * Calculate summary statistics
   */
  private calculateSummary(
    findings: AnalysisFinding[],
    actions: ExecutableAction[]
  ): GenerateActionsResult['summary'] {
    const byCategory: Record<ActionCategory, number> = {
      read: 0,
      format: 0,
      data_entry: 0,
      structure: 0,
      formula: 0,
      visualization: 0,
      collaboration: 0,
      optimization: 0,
      data_cleaning: 0,
    };

    const byRisk: Record<ActionRiskLevel, number> = {
      none: 0,
      low: 0,
      medium: 0,
      high: 0,
      critical: 0,
    };

    for (const action of actions) {
      byCategory[action.category]++;
      byRisk[action.risk]++;
    }

    const actionableFindings = findings.filter(
      (f) => f.type === 'issue' || f.type === 'opportunity'
    ).length;

    return {
      totalFindings: findings.length,
      actionableFindings,
      generatedActions: actions.length,
      byCategory,
      byRisk,
    };
  }

  /**
   * Determine recommended next steps
   */
  private determineNextSteps(actions: ExecutableAction[]): GenerateActionsResult['nextSteps'] {
    if (actions.length === 0) {
      return { recommended: null, alternatives: [] };
    }

    // Recommend highest priority, lowest risk action
    const safeActions = actions.filter((a) => a.risk === 'none' || a.risk === 'low');
    const recommended = safeActions.length > 0 ? safeActions[0]! : actions[0]!;

    // Alternatives are next actions in different categories
    const categories = new Set<ActionCategory>();
    categories.add(recommended.category);

    const alternatives: ExecutableAction[] = [];
    for (const action of actions) {
      if (action.id !== recommended.id && !categories.has(action.category)) {
        alternatives.push(action);
        categories.add(action.category);
        if (alternatives.length >= 3) break;
      }
    }

    return { recommended, alternatives };
  }
}
