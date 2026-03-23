/**
 * ServalSheets - Quality Handler
 *
 * Enterprise quality assurance combining validation, conflict detection, and impact analysis.
 *
 * Actions (4):
 * - validate: Data validation with built-in validators
 * - detect_conflicts: Detect concurrent modification conflicts
 * - resolve_conflict: Resolve detected conflicts with strategies
 * - analyze_impact: Pre-execution impact analysis with dependency tracking
 */

import { ErrorCodes } from './error-codes.js';
import { ValidationEngine, getValidationEngine } from '../services/validation-engine.js';
import { getConflictDetector } from '../services/conflict-detector.js';
import { getImpactAnalyzer } from '../services/impact-analyzer.js';
import type {
  BuiltinValidationRuleInput,
  CustomValidationRuleInput,
  SheetsQualityInput,
  SheetsQualityOutput,
  QualityResponse,
  QualityValidateInput,
  QualityDetectConflictsInput,
  QualityResolveConflictInput,
  QualityAnalyzeImpactInput,
  ValidationRuleInput,
} from '../schemas/quality.js';
import { unwrapRequest } from './base.js';
import { ValidationError } from '../core/errors.js';
import { applyVerbosityFilter } from './helpers/verbosity-filter.js';
import { mapStandaloneError } from './helpers/error-mapping.js';
import { sendProgress } from '../utils/request-context.js';
import { logger } from '../utils/logger.js';
import { generateAIInsight } from '../mcp/sampling.js';
import type { SamplingServer } from '../mcp/sampling.js';
import type { ValidationContext, ValidationRule } from '../types/validation.js';
import type { Conflict as ConflictRecord } from '../types/conflict.js';

export interface QualityHandlerOptions {
  samplingServer?: SamplingServer;
}

function isBuiltinRuleInput(rule: ValidationRuleInput): rule is BuiltinValidationRuleInput {
  return typeof rule === 'string';
}

function isCustomRuleInput(rule: ValidationRuleInput): rule is CustomValidationRuleInput {
  return typeof rule === 'object' && rule !== null;
}

function normalizeComparableValue(value: unknown): string | number | boolean | null | undefined {
  if (value === null || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return '';
    }
    const numericValue = Number(trimmed);
    return Number.isFinite(numericValue) ? numericValue : trimmed;
  }

  return undefined; // OK: Explicit empty - unsupported comparison values are ignored
}

function buildCustomRuleId(rule: CustomValidationRuleInput, index: number): string {
  return rule.id ?? `custom_${rule.type}_${index + 1}`;
}

function resolveContextLookupValue(
  context: ValidationContext | undefined,
  contextKey: string
): unknown {
  const metadata =
    context?.metadata && typeof context.metadata === 'object'
      ? (context.metadata as Record<string, unknown>)
      : undefined;
  const root = context as Record<string, unknown> | undefined;
  return metadata?.[contextKey] ?? root?.[contextKey];
}

function buildValidationContext(
  inputContext: QualityValidateInput['context'],
  requestedRuleIds?: string[]
): ValidationContext {
  const metadataSource =
    inputContext && typeof inputContext === 'object' && inputContext['metadata']
      ? inputContext['metadata']
      : undefined;
  const metadata =
    metadataSource && typeof metadataSource === 'object'
      ? { ...(metadataSource as Record<string, unknown>), ...(inputContext ?? {}) }
      : inputContext
        ? { ...inputContext }
        : undefined;

  return {
    ...(inputContext ?? {}),
    ...(metadata ? { metadata } : {}),
    ...(requestedRuleIds && requestedRuleIds.length > 0 ? { rules: requestedRuleIds } : {}),
  };
}

function compileCustomValidationRule(
  rule: CustomValidationRuleInput,
  index: number
): ValidationRule {
  const id = buildCustomRuleId(rule, index);
  const severity = rule.severity ?? 'error';

  switch (rule.type) {
    case 'comparison':
      return {
        id,
        name: rule.name ?? `Comparison ${rule.operator.toUpperCase()}`,
        type: 'business_rule',
        description: `Validate value ${rule.operator} comparison target`,
        validator: (value, context) => {
          const actual = normalizeComparableValue(value);
          const rawTarget =
            'value' in rule.compareTo
              ? rule.compareTo.value
              : resolveContextLookupValue(context, rule.compareTo.contextKey);

          if (!('value' in rule.compareTo) && rawTarget === undefined) {
            return {
              valid: false,
              message:
                rule.message ??
                `Missing comparison target in context: ${rule.compareTo.contextKey}`,
            };
          }

          const target = normalizeComparableValue(rawTarget);
          if (actual === undefined || target === undefined) {
            return {
              valid: false,
              message:
                rule.message ?? 'Comparison rules require string, number, boolean, or null values',
            };
          }

          let valid = false;
          switch (rule.operator) {
            case 'gt':
              valid = typeof actual === 'number' && typeof target === 'number' && actual > target;
              break;
            case 'gte':
              valid = typeof actual === 'number' && typeof target === 'number' && actual >= target;
              break;
            case 'lt':
              valid = typeof actual === 'number' && typeof target === 'number' && actual < target;
              break;
            case 'lte':
              valid = typeof actual === 'number' && typeof target === 'number' && actual <= target;
              break;
            case 'eq':
              valid = actual === target;
              break;
            case 'neq':
              valid = actual !== target;
              break;
          }

          return {
            valid,
            message: valid
              ? undefined
              : (rule.message ?? `Value must satisfy comparison operator ${rule.operator}`),
          };
        },
        severity,
        errorMessage: rule.message ?? `Value must satisfy comparison operator ${rule.operator}`,
        enabled: true,
      };
    case 'pattern': {
      let regex: RegExp;
      try {
        regex = new RegExp(rule.pattern, rule.flags);
      } catch (error) {
        throw new ValidationError(
          `Invalid custom pattern rule: ${error instanceof Error ? error.message : String(error)}`,
          'rules'
        );
      }

      return {
        id,
        name: rule.name ?? 'Pattern Match',
        type: 'pattern',
        description: `Validate value against regex ${rule.pattern}`,
        validator: (value) => ({
          valid: typeof value === 'string' && regex.test(value),
          message: rule.message ?? `Value must match pattern ${rule.pattern}`,
        }),
        severity,
        errorMessage: rule.message ?? `Value must match pattern ${rule.pattern}`,
        enabled: true,
      };
    }
    case 'length':
      return {
        id,
        name: rule.name ?? 'Length Check',
        type: 'custom',
        description: 'Validate string or array length',
        validator: (value) => {
          const length =
            typeof value === 'string' || Array.isArray(value) ? value.length : undefined;
          if (length === undefined) {
            return {
              valid: false,
              message: rule.message ?? 'Length rules require a string or array value',
            };
          }
          const minValid = rule.min === undefined || length >= rule.min;
          const maxValid = rule.max === undefined || length <= rule.max;
          return {
            valid: minValid && maxValid,
            message:
              rule.message ??
              `Value length must be${rule.min !== undefined ? ` >= ${rule.min}` : ''}${
                rule.min !== undefined && rule.max !== undefined ? ' and' : ''
              }${rule.max !== undefined ? ` <= ${rule.max}` : ''}`.trim(),
          };
        },
        severity,
        errorMessage: rule.message ?? 'Value length is outside the allowed range',
        enabled: true,
      };
    case 'one_of':
      return {
        id,
        name: rule.name ?? 'Allowed Values',
        type: 'custom',
        description: 'Validate value against an allowed set',
        validator: (value) => {
          const candidate = normalizeComparableValue(value);
          const normalizedAllowed = rule.values.map((allowed) => normalizeComparableValue(allowed));
          const valid = normalizedAllowed.some((allowed) => {
            if (
              !rule.caseSensitive &&
              typeof candidate === 'string' &&
              typeof allowed === 'string'
            ) {
              return candidate.toLowerCase() === allowed.toLowerCase();
            }
            return candidate === allowed;
          });
          return {
            valid,
            message:
              rule.message ??
              `Value must be one of: ${rule.values.map((value) => String(value)).join(', ')}`,
          };
        },
        severity,
        errorMessage: rule.message ?? 'Value is not in the allowed set',
        enabled: true,
      };
  }
}

export class QualityHandler {
  private samplingServer?: SamplingServer;

  constructor(options: QualityHandlerOptions = {}) {
    this.samplingServer = options.samplingServer;
  }

  async handle(input: SheetsQualityInput): Promise<SheetsQualityOutput> {
    const req = unwrapRequest<SheetsQualityInput['request']>(input);
    try {
      let response: QualityResponse;

      switch (req.action) {
        case 'validate':
          response = await this.handleValidate(req as QualityValidateInput);
          break;
        case 'detect_conflicts':
          response = await this.handleDetectConflicts(req as QualityDetectConflictsInput);
          break;
        case 'resolve_conflict':
          response = await this.handleResolveConflict(req as QualityResolveConflictInput);
          break;
        case 'analyze_impact':
          response = await this.handleAnalyzeImpact(req as QualityAnalyzeImpactInput);
          break;
        default: {
          const _exhaustiveCheck: never = req;
          throw new ValidationError(
            `Unknown action: ${(_exhaustiveCheck as { action: string }).action}`,
            'action',
            'validate | detect_conflicts | resolve_conflict | analyze_impact'
          );
        }
      }

      // Apply verbosity filtering (LLM optimization)
      const verbosity = req.verbosity ?? 'standard';
      const filteredResponse = applyVerbosityFilter(response, verbosity);

      return { response: filteredResponse };
    } catch (error) {
      // Catch-all for unexpected errors
      logger.error('Quality handler error', {
        action: req.action,
        error,
      });
      return {
        response: {
          success: false,
          error: mapStandaloneError(error),
        },
      };
    }
  }

  /**
   * VALIDATE: Data validation with built-in validators
   */
  private async handleValidate(input: QualityValidateInput): Promise<QualityResponse> {
    // value is now optional in schema for LLM discoverability — guard at runtime
    if (input.value === undefined) {
      return {
        success: false,
        error: {
          code: ErrorCodes.INVALID_PARAMS,
          message:
            'The "value" field is required for single-value validation. ' +
            'For range-based data validation, use sheets_fix.detect_anomalies, ' +
            'sheets_fix.clean, or sheets_analyze.scout instead.',
          retryable: false,
        },
      };
    }

    const requestedRules = input.rules ?? [];
    const builtinRuleIds = requestedRules.filter(isBuiltinRuleInput);
    const customRules = requestedRules.filter(isCustomRuleInput);
    const requestedRuleIds: string[] = [...builtinRuleIds];
    const validationEngine =
      customRules.length > 0
        ? new ValidationEngine({
            enabled: true,
            stopOnFirstError: input.stopOnFirstError ?? false,
            enableCaching: false,
            maxErrors: 100,
          })
        : getValidationEngine();

    customRules.forEach((rule, index) => {
      const compiledRule = compileCustomValidationRule(rule, index);
      validationEngine.registerRule(compiledRule);
      requestedRuleIds.push(compiledRule.id);
    });

    const totalRules = requestedRules.length;
    await sendProgress(0, 100, `Validating...${totalRules > 0 ? ` (${totalRules} rules)` : ''}`);
    const contextWithRules = buildValidationContext(
      input.context,
      requestedRuleIds.length > 0 ? requestedRuleIds : undefined
    );
    const report = await validationEngine.validate(input.value, contextWithRules);
    await sendProgress(100, 100, 'Validation complete');

    // Check if dry run mode is enabled
    const isDryRun = input.safety?.dryRun ?? false;

    const hasErrors = report.errors.length > 0;

    // When validation finds errors, return success: false so the caller knows data is invalid.
    // This eliminates the ambiguous success:true + valid:false dual-success pattern (ISSUE-136).
    if (hasErrors) {
      const response: QualityResponse = {
        success: false,
        error: {
          code: ErrorCodes.VALIDATION_ERROR,
          message: `Validation failed. ${report.errors.length} error(s), ${report.warnings.length} warning(s).`,
          retryable: false,
          details: {
            valid: false,
            errorCount: report.errors.length,
            warningCount: report.warnings.length,
            totalChecks: report.totalChecks,
            passedChecks: report.passedChecks,
            errors: report.errors?.map((e) => ({
              ruleId: e.rule.id,
              ruleName: e.rule.name,
              severity: e.severity,
              message: e.message,
            })),
          },
        },
      };
      return response;
    }

    // Generate AI insight for validation failures
    let aiInsight: string | undefined;
    if (report.errors.length > 0 && this.samplingServer) {
      const errorSummary = report.errors
        .slice(0, 5)
        .map((e) => `${e.rule.name}: ${e.message}`)
        .join('\n');
      aiInsight = await generateAIInsight(
        this.samplingServer,
        'dataCleaning',
        `Explain these validation failures and recommend specific fixes for each`,
        errorSummary,
        { maxTokens: 400 }
      );
    }

    const response: QualityResponse = {
      success: true,
      action: 'validate',
      valid: report.valid,
      errorCount: report.errors.length,
      warningCount: report.warnings.length,
      infoCount: report.infoMessages.length,
      totalChecks: report.totalChecks,
      passedChecks: report.passedChecks,
      errors: report.errors?.map((e) => ({
        ruleId: e.rule.id,
        ruleName: e.rule.name,
        severity: e.severity,
        message: e.message,
        // e.value is `unknown`; schema accepts the specific value union. Cast via unknown.
        actualValue: e.value as
          | string
          | number
          | boolean
          | null
          | unknown[]
          | Record<string, unknown>,
        path: e.cell,
      })),
      warnings: report.warnings?.map((w) => ({
        ruleId: w.rule.id,
        ruleName: w.rule.name,
        message: w.message,
      })),
      duration: report.duration,
      message: `Validation passed. ${report.passedChecks}/${report.totalChecks} checks passed.`,
      ...(aiInsight !== undefined ? { aiInsight } : {}),
    };

    // Add dry run preview if requested
    if (isDryRun) {
      // `dryRun` and `validationPreview` are optional fields on the success branch of
      // QualityResponse. We narrow to the success variant before assignment.
      const successResponse = response as Extract<QualityResponse, { success: true }>;
      successResponse.dryRun = true;
      successResponse.validationPreview = {
        wouldApply: report.valid,
        affectedCells: report.errors.length + report.warnings.length,
        rulesPreview: report.errors.map((e) => ({
          ruleId: e.rule.id,
          condition: e.rule.name,
          cellsAffected: 1,
        })),
      };
    }

    return response;
  }

  /**
   * DETECT_CONFLICTS: Detect concurrent modification conflicts
   */
  private async handleDetectConflicts(
    input: QualityDetectConflictsInput
  ): Promise<QualityResponse> {
    // Map ResolutionStrategy → schema suggestedStrategy enum
    const mapStrategy = (s: string): 'keep_local' | 'keep_remote' | 'merge' | 'manual' => {
      if (s === 'overwrite' || s === 'first_write_wins') return 'keep_local';
      if (s === 'cancel' || s === 'last_write_wins') return 'keep_remote';
      if (s === 'merge') return 'merge';
      return 'manual';
    };

    // Map ConflictSeverity → schema severity enum
    const mapSeverity = (s: string): 'low' | 'medium' | 'high' | 'critical' => {
      if (s === 'info') return 'low';
      if (s === 'warning') return 'medium';
      if (s === 'error') return 'high';
      if (s === 'critical') return 'critical';
      return 'low';
    };

    // Map ConflictType → schema conflictType enum
    const mapConflictType = (t: string): 'concurrent_write' | 'version_mismatch' | 'data_race' => {
      if (t === 'concurrent_modification' || t === 'overlapping_range') return 'concurrent_write';
      if (t === 'stale_data') return 'version_mismatch';
      return 'data_race';
    };

    let activeConflicts: ConflictRecord[] = [];
    try {
      const detector = getConflictDetector();
      activeConflicts = detector.getActiveConflicts();
    } catch {
      // Detector not initialized — return empty list gracefully
    }

    // Filter by spreadsheetId if provided
    if (input.spreadsheetId) {
      activeConflicts = activeConflicts.filter((c) => c.spreadsheetId === input.spreadsheetId);
    }

    const mappedConflicts = activeConflicts.map((c) => ({
      id: c.id,
      spreadsheetId: c.spreadsheetId,
      range: c.range,
      localVersion: c.yourVersion.version,
      remoteVersion: c.currentVersion.version,
      localValue: c.yourVersion.checksum as string,
      remoteValue: c.currentVersion.checksum as string,
      conflictType: mapConflictType(c.type),
      severity: mapSeverity(c.severity),
      detectedAt: c.timestamp,
      suggestedStrategy: mapStrategy(c.suggestedResolution),
    }));

    // Generate AI insight when conflicts are present
    let aiInsight: string | undefined;
    if (this.samplingServer && mappedConflicts.length > 0) {
      aiInsight = await generateAIInsight(
        this.samplingServer,
        'dataAnalysis',
        'Analyze these conflicts and recommend the best resolution strategy for each',
        JSON.stringify(mappedConflicts),
        { maxTokens: 300 }
      );
    }

    const message =
      mappedConflicts.length === 0
        ? 'No active conflicts detected.'
        : `${mappedConflicts.length} active conflict(s) detected.`;

    return {
      success: true,
      action: 'detect_conflicts',
      conflicts: mappedConflicts,
      message,
      ...(aiInsight !== undefined ? { aiInsight } : {}),
    };
  }

  /**
   * RESOLVE_CONFLICT: Resolve detected conflicts with strategies
   */
  private async handleResolveConflict(
    input: QualityResolveConflictInput
  ): Promise<QualityResponse> {
    const conflictDetector = getConflictDetector();

    // Map schema strategy to actual ResolutionStrategy type
    const strategyMap: Record<
      string,
      'overwrite' | 'merge' | 'cancel' | 'manual' | 'last_write_wins' | 'first_write_wins'
    > = {
      keep_local: 'overwrite',
      keep_remote: 'cancel',
      merge: 'merge',
      manual: 'manual',
    };

    const result = await conflictDetector.resolveConflict({
      conflictId: input.conflictId,
      strategy: strategyMap[input.strategy] || 'manual',
      mergeData: input.mergedValue,
    });

    if (result.success) {
      return {
        success: true,
        action: 'resolve_conflict',
        conflictId: input.conflictId,
        resolved: true,
        resolution: {
          strategy: input.strategy,
          // ChangeSet is a typed object; schema accepts Record<string, unknown> here.
          finalValue: result.changesApplied as unknown as Record<string, unknown>,
          version: result.finalVersion?.version || 0,
        },
        message: `Conflict resolved using strategy: ${input.strategy}`,
      };
    } else {
      return {
        success: false,
        error: {
          code: ErrorCodes.INTERNAL_ERROR,
          message: result.error?.message || 'Failed to resolve conflict',
          retryable: false,
        },
      };
    }
  }

  /**
   * ANALYZE_IMPACT: Pre-execution impact analysis with dependency tracking
   */
  private async handleAnalyzeImpact(input: QualityAnalyzeImpactInput): Promise<QualityResponse> {
    const impactAnalyzer = getImpactAnalyzer();
    // Provide defaults for optional operation fields (schema allows all optional)
    const operation = {
      type: input.operation.type ?? 'unknown',
      tool: input.operation.tool ?? 'unknown',
      action: input.operation.action ?? 'unknown',
      params: input.operation.params ?? {},
    };
    const analysis = await impactAnalyzer.analyzeOperation(operation);

    return {
      success: true,
      action: 'analyze_impact',
      impact: {
        severity: analysis.severity,
        scope: {
          rows: analysis.rowsAffected,
          columns: analysis.columnsAffected,
          cells: analysis.cellsAffected,
          sheets: [],
        },
        affectedResources: {
          formulas: (analysis.formulasAffected ?? []).map((f) => f?.cell).filter(Boolean),
          charts: (analysis.chartsAffected ?? []).map((c) => c?.title).filter(Boolean),
          pivotTables: (analysis.pivotTablesAffected ?? [])
            .map((p) => (p ? `PivotTable ${p.pivotTableId}` : ''))
            .filter(Boolean),
          validationRules: (analysis.validationRulesAffected ?? [])
            .map((v) => v?.range)
            .filter(Boolean),
          namedRanges: (analysis.namedRangesAffected ?? []).map((n) => n?.name).filter(Boolean),
          protectedRanges: (analysis.protectedRangesAffected ?? [])
            .map((p) => p?.range)
            .filter(Boolean),
        },
        estimatedExecutionTime: analysis.estimatedExecutionTime,
        warnings: analysis.warnings.map((w) => ({
          severity: w.severity,
          message: w.message,
          affectedResources: w.suggestedAction ? [w.suggestedAction] : undefined,
        })),
        recommendations: analysis.recommendations.map((r) => ({
          action: r,
          reason: 'Suggested based on impact analysis',
          priority:
            analysis.severity === 'high' || analysis.severity === 'critical'
              ? ('high' as const)
              : ('medium' as const),
        })),
        canProceed: analysis.severity !== 'critical',
        requiresConfirmation: analysis.severity === 'high' || analysis.severity === 'critical',
      },
      message: `Impact analysis complete. Severity: ${analysis.severity}, ${analysis.cellsAffected} cell(s) affected, ${analysis.warnings.length} warning(s).`,
    };
  }
}
