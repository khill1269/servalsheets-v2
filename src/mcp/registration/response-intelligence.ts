import { getDataAwareSuggestions } from '../../services/action-recommender.js';
import { suggestFix } from '../../services/error-fix-suggester.js';
import { getErrorPatternLearner } from '../../services/error-pattern-learner.js';
import { scanResponseQualitySync } from '../../services/lightweight-quality-scanner.js';
import {
  suggestRecovery,
  applyRecoveryToError,
  type RecoveryContext,
} from '../../services/recovery-engine.js';
import {
  generateResponseHints,
  generateWriteHints,
  generateScenarioHints,
  type ResponseHints,
} from '../../services/response-hints-engine.js';
import { compressSheetForLLM } from '../../utils/response-compactor.js';
import { selfCorrectionsTotal } from '../../observability/metrics.js';

type ResponseCellValue = string | number | boolean | null;

type ConfidenceGapHint = {
  question: string;
  options?: string[];
};

type ResponseIntelligenceOptions = {
  toolName?: string;
  actionName?: string;
  hasFailure: boolean;
  spreadsheetId?: string;
  params?: Record<string, unknown>;
  aiMode?: 'sampling' | 'heuristic' | 'cached';
};

type ResponseIntelligenceResult = {
  batchingHint?: string;
  aiMode?: 'sampling' | 'heuristic' | 'cached';
};

// Actions that have a batch equivalent and benefit from consolidation
const BATCHING_HINTS: Partial<Record<string, string>> = {
  'sheets_data.read': 'For 3+ ranges, use batch_read — same API cost, processed in parallel.',
  'sheets_data.write': 'For 3+ ranges, use batch_write — 70% faster than individual writes.',
  'sheets_data.append': 'To append many rows, batch them in a single append call (values[][]).',
  'sheets_format.set_format': 'For 3+ format changes, use batch_format — 1 API call for all.',
  'sheets_format.set_background': 'For 3+ cells, use batch_format — single API call.',
  'sheets_format.set_text_format': 'For 3+ cells, use batch_format — single API call.',
  'sheets_core.get': 'For 2+ spreadsheets, use sheets_core.batch_get — single API call.',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isCellValue(value: unknown): value is ResponseCellValue {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  );
}

function isCellRow(value: unknown): value is ResponseCellValue[] {
  return Array.isArray(value) && value.every((cell) => isCellValue(cell));
}

function isCellGrid(value: unknown): value is ResponseCellValue[][] {
  return Array.isArray(value) && value.every((row) => isCellRow(row));
}

function getOptionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' ? value : undefined;
}

function getStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((option): option is string => typeof option === 'string');
}

function extractResponseValues(
  responseRecord: Record<string, unknown>
): ResponseCellValue[][] | null {
  const directValues = responseRecord['values'];
  if (isCellGrid(directValues)) {
    return directValues;
  }

  const nestedData = responseRecord['data'];
  if (!isRecord(nestedData)) {
    return null;
  }

  const nestedValues = nestedData['values'];
  return isCellGrid(nestedValues) ? nestedValues : null;
}

function normalizeConfidenceGapHint(value: unknown): ConfidenceGapHint | null {
  if (typeof value === 'string') {
    const question = value.trim();
    return question ? { question } : null;
  }

  if (!isRecord(value)) {
    return null;
  }

  const question =
    getOptionalString(value, 'question') ??
    getOptionalString(value, 'gap') ??
    getOptionalString(value, 'detail');

  if (!question) {
    return null;
  }

  const options = getStringArray(value['options']);
  return options.length > 0 ? { question, options } : { question };
}

function extractConfidenceGapHints(responseRecord: Record<string, unknown>): ConfidenceGapHint[] {
  const hints: ConfidenceGapHint[] = [];
  const confidenceGaps = responseRecord['confidenceGaps'];
  if (Array.isArray(confidenceGaps)) {
    for (const entry of confidenceGaps) {
      const normalized = normalizeConfidenceGapHint(entry);
      if (normalized) {
        hints.push(normalized);
      }
    }
  }

  const confidence = responseRecord['confidence'];
  if (!isRecord(confidence)) {
    return hints;
  }

  for (const key of ['gaps', 'topGaps']) {
    const entries = confidence[key];
    if (!Array.isArray(entries)) {
      continue;
    }
    for (const entry of entries) {
      const normalized = normalizeConfidenceGapHint(entry);
      if (normalized) {
        hints.push(normalized);
      }
    }
  }

  return hints;
}

export function applyResponseIntelligence(
  responseRecord: Record<string, unknown>,
  options: ResponseIntelligenceOptions
): ResponseIntelligenceResult {
  if (options.hasFailure) {
    const error = responseRecord['error'];
    if (!isRecord(error)) {
      return {}; // OK: no error record to enrich
    }

    const errorCode = getOptionalString(error, 'code') ?? '';
    const errorMessage = getOptionalString(error, 'message') ?? '';
    const fix = suggestFix(
      errorCode,
      errorMessage,
      options.toolName,
      options.actionName,
      options.params
    );
    if (fix) {
      // Inject the full SuggestedFix object
      error['suggestedFix'] = {
        tool: fix.tool,
        action: fix.action,
        params: fix.params,
        explanation: fix.explanation,
      };
      // Wire structured fixableVia so LLMs can execute the fix directly
      if (!error['fixableVia']) {
        error['fixableVia'] = {
          tool: fix.tool,
          action: fix.action,
          params: fix.params,
        };
      }
    }

    // Surface learned error patterns if the learner has sufficient data
    const learner = getErrorPatternLearner();
    const pattern = learner.getPatterns(errorCode, { tool: options.toolName });
    if (
      pattern?.topResolution &&
      pattern.topResolution.successRate > 0.5 &&
      pattern.topResolution.occurrenceCount >= 3
    ) {
      error['_learnedFix'] = {
        fix: pattern.topResolution.fix,
        confidence: pattern.topResolution.successRate,
        seenCount: pattern.topResolution.occurrenceCount,
      };

      // Increment self-correction metric when a learned fix is available
      selfCorrectionsTotal.inc({
        tool: options.toolName || 'unknown',
        from_action: options.actionName || 'unknown',
        to_action: pattern.topResolution.fix || 'unknown',
      });
    }

    // ── Recovery Engine: enrich error with alternatives + resolution steps ──
    const recoveryCtx: RecoveryContext = {
      toolName: options.toolName,
      actionName: options.actionName,
      spreadsheetId: options.spreadsheetId,
      params: options.params,
    };
    const recovery = suggestRecovery(errorCode, errorMessage, recoveryCtx);
    applyRecoveryToError(error, recovery);

    return {}; // OK: no batching hint for failure responses
  }

  if (!options.toolName) {
    return {}; // OK: no tool context, cannot generate hints
  }

  const actionName = getOptionalString(responseRecord, 'action');
  if (!actionName) {
    return {}; // OK: no action in response, cannot generate hints
  }

  const responseValues = extractResponseValues(responseRecord);
  const confidenceGaps = extractConfidenceGapHints(responseRecord);
  const recommendations = getDataAwareSuggestions(options.toolName, actionName, responseRecord, {
    ...(responseValues ? { responseValues } : {}),
    ...(confidenceGaps.length > 0 ? { confidenceGaps } : {}),
    spreadsheetId: options.spreadsheetId,
    range: getOptionalString(responseRecord, 'range') ?? undefined,
  });

  if (recommendations.length > 0) {
    responseRecord['suggestedNextActions'] = recommendations.slice(0, 5);
  }

  // Trigger quality scan on any response that returns cell data (not just sheets_data)
  if (
    responseValues &&
    responseValues.length >= 2 &&
    responseValues.some((row) => row.length >= 2)
  ) {
    const warnings = scanResponseQualitySync(responseValues, {
      tool: options.toolName,
      action: actionName,
      range: getOptionalString(responseRecord, 'range') ?? '',
    });

    if (warnings.length > 0) {
      responseRecord['dataQualityWarnings'] = warnings;
    }
  }

  // Inject CoT _hints on successful responses (sync, zero API calls)
  if (
    options.toolName === 'sheets_data' &&
    (actionName === 'read' || actionName === 'batch_read' || actionName === 'cross_read') &&
    responseValues
  ) {
    const hints = generateResponseHints(responseValues);
    if (hints) {
      responseRecord['_hints'] = hints;
    }

    // Compress large sheets for LLM context (SpreadsheetLLM compression)
    // Only compress if > 100 rows AND verbosity is not "detailed" (preserve raw data if requested)
    // Skip if data is already in a compressed/preview format (_truncated present)
    if (
      responseValues.length > 100 &&
      !responseRecord['_truncated'] &&
      !(options.params?.['verbosity'] === 'detailed')
    ) {
      const compressed = compressSheetForLLM(responseValues, {
        maxAnchors: 20,
        maxExamples: 5,
      });
      // Inject compressed representation alongside raw (LLMs can choose which to use)
      responseRecord['_compressed'] = compressed;
    }
  } else if (
    options.toolName === 'sheets_data' &&
    (actionName === 'write' || actionName === 'batch_write')
  ) {
    const writtenValues = responseValues ?? ([] as ResponseCellValue[][]);
    const hints = generateWriteHints(writtenValues);
    const writeRange =
      getOptionalString(responseRecord, 'updatedRange') ??
      getOptionalString(responseRecord, 'range') ??
      '';
    const verifyWrite =
      writeRange && options.spreadsheetId
        ? {
            tool: 'sheets_data',
            action: 'read',
            params: { spreadsheetId: options.spreadsheetId, range: writeRange },
            reason: 'Read back written range to verify data quality',
          }
        : undefined;

    // Only inject _hints if there's actual content (hints or verifyWrite)
    if (hints || verifyWrite) {
      const verifyHints: Record<string, unknown> = {
        ...(hints ?? {}),
        ...(verifyWrite ? { verifyWrite } : {}),
      };
      responseRecord['_hints'] = verifyHints;
    }
  } else if (options.toolName === 'sheets_data' && actionName === 'append') {
    const appendedValues = responseValues ?? ([] as ResponseCellValue[][]);
    const rowCount = appendedValues.length;
    if (rowCount > 0) {
      responseRecord['_hints'] = {
        nextPhase: `Appended ${rowCount} row${rowCount !== 1 ? 's' : ''}. If retrying, check for duplicates first (sheets_data.read).`,
        riskLevel: 'low' as const,
      };
    }
  } else if (options.toolName === 'sheets_dependencies' && actionName === 'model_scenario') {
    const cascadeEffects = responseRecord['cascadeEffects'];
    const hints = generateScenarioHints(Array.isArray(cascadeEffects) ? cascadeEffects : undefined);
    if (hints) {
      responseRecord['_hints'] = hints;
    }
  } else if (options.toolName === 'sheets_analyze' && actionName === 'comprehensive') {
    const severity = getOptionalString(responseRecord, 'overallHealth') ?? '';
    const findingCount = isRecord(responseRecord['findings'])
      ? Object.keys(responseRecord['findings']).length
      : 0;
    responseRecord['_hints'] = {
      dataShape: findingCount > 0 ? `${findingCount} finding categories detected` : undefined,
      nextPhase:
        severity === 'critical' || severity === 'poor'
          ? 'Analysis complete → clean data (sheets_fix.clean) → validate → re-analyze'
          : 'Analysis complete → apply suggestions (sheets_analyze.auto_enhance) → format → share',
      riskLevel: (severity === 'critical' || severity === 'poor'
        ? 'high'
        : severity === 'fair'
          ? 'medium'
          : 'low') as ResponseHints['riskLevel'],
    };
  } else if (options.toolName === 'sheets_fix' && actionName === 'clean') {
    const changesCount =
      typeof responseRecord['changesApplied'] === 'number' ? responseRecord['changesApplied'] : 0;
    const columnsCount =
      typeof responseRecord['columnsAffected'] === 'number' ? responseRecord['columnsAffected'] : 0;
    if (changesCount > 0 || columnsCount > 0) {
      responseRecord['_hints'] = {
        dataShape:
          changesCount > 0 || columnsCount > 0
            ? `Cleaned ${changesCount} cell${changesCount !== 1 ? 's' : ''} across ${columnsCount} column${columnsCount !== 1 ? 's' : ''}`
            : undefined,
        nextPhase: 'Clean complete → validate (sheets_quality.validate) → re-read to confirm',
        riskLevel: 'none' as const,
      };
    }
  } else if (options.toolName === 'sheets_composite' && actionName === 'generate_sheet') {
    const colCount =
      typeof responseRecord['columnCount'] === 'number' ? responseRecord['columnCount'] : 0;
    const formulaRowCount =
      typeof responseRecord['formulaRows'] === 'number' ? responseRecord['formulaRows'] : 0;
    if (colCount > 0) {
      responseRecord['_hints'] = {
        dataShape: `Generated ${colCount} column${colCount !== 1 ? 's' : ''}${formulaRowCount > 0 ? `, ${formulaRowCount} formula row${formulaRowCount !== 1 ? 's' : ''}` : ''}`,
        nextPhase:
          'Sheet generated → review structure → save as template (sheets_templates.create)',
        riskLevel: 'none' as const,
      };
    }
  } else if (options.toolName === 'sheets_agent' && actionName === 'execute') {
    const totalSteps =
      typeof responseRecord['totalSteps'] === 'number' ? responseRecord['totalSteps'] : 0;
    const completedSteps =
      typeof responseRecord['completedSteps'] === 'number' ? responseRecord['completedSteps'] : 0;
    const lastAction = getOptionalString(responseRecord, 'lastAction') ?? '';
    if (totalSteps > 0) {
      responseRecord['_hints'] = {
        dataShape: `Plan executed ${completedSteps}/${totalSteps} step${totalSteps !== 1 ? 's' : ''}${lastAction ? `, final action: ${lastAction}` : ''}`,
        nextPhase:
          completedSteps < totalSteps
            ? 'Plan partially completed → check error details → retry or adjust plan'
            : 'Plan complete → verify results → share or export',
        riskLevel: (completedSteps < totalSteps ? 'medium' : 'none') as ResponseHints['riskLevel'],
      };
    }
  } else if (options.toolName === 'sheets_format' && actionName === 'suggest_format') {
    const suggestionCount = Array.isArray(responseRecord['suggestions'])
      ? responseRecord['suggestions'].length
      : 0;
    if (suggestionCount > 0) {
      responseRecord['_hints'] = {
        dataShape: `${suggestionCount} format suggestion${suggestionCount !== 1 ? 's' : ''} generated`,
        nextPhase:
          'Review suggestions → apply selected (sheets_format.set_format or batch_format) → verify visually',
        riskLevel: 'none' as const,
      };
    }
  } else if (options.toolName === 'sheets_history' && actionName === 'diff_revisions') {
    const changedCells = Array.isArray(responseRecord['changed'])
      ? responseRecord['changed'].length
      : 0;
    const addedCells = Array.isArray(responseRecord['added']) ? responseRecord['added'].length : 0;
    const removedCells = Array.isArray(responseRecord['removed'])
      ? responseRecord['removed'].length
      : 0;
    const total = changedCells + addedCells + removedCells;
    if (total > 0) {
      responseRecord['_hints'] = {
        dataShape: `Diff: ${changedCells} changed, ${addedCells} added, ${removedCells} removed`,
        nextPhase:
          total > 10
            ? 'Large diff detected → consider restoring specific cells (sheets_history.restore_cells)'
            : 'Review diff → restore cells if needed (sheets_history.restore_cells)',
        riskLevel: (total > 50
          ? 'high'
          : total > 10
            ? 'medium'
            : 'low') as ResponseHints['riskLevel'],
      };
    }
  } else if (options.toolName === 'sheets_history' && actionName === 'timeline') {
    const entryCount = Array.isArray(responseRecord['entries'])
      ? responseRecord['entries'].length
      : 0;
    if (entryCount > 0) {
      responseRecord['_hints'] = {
        dataShape: `${entryCount} revision event${entryCount !== 1 ? 's' : ''} in timeline`,
        nextPhase:
          'Timeline loaded → compare two revisions (sheets_history.diff_revisions) or restore a snapshot',
        riskLevel: 'none' as const,
      };
    }
  } else if (options.toolName === 'sheets_visualize' && actionName === 'chart_create') {
    const chartType = getOptionalString(responseRecord, 'chartType') ?? 'chart';
    const chartId = getOptionalString(responseRecord, 'chartId') ?? '';
    responseRecord['_hints'] = {
      dataShape: `${chartType} created${chartId ? ` (ID: ${chartId})` : ''}`,
      nextPhase: 'Chart created → update data range or style (sheets_visualize.chart_update)',
      riskLevel: 'none' as const,
    };
  } else if (options.toolName === 'sheets_quality' && actionName === 'validate') {
    const violationCount = Array.isArray(responseRecord['violations'])
      ? responseRecord['violations'].length
      : 0;
    const warningCount = Array.isArray(responseRecord['warnings'])
      ? responseRecord['warnings'].length
      : 0;
    responseRecord['_hints'] = {
      dataShape:
        violationCount > 0
          ? `${violationCount} violation${violationCount !== 1 ? 's' : ''}${warningCount > 0 ? `, ${warningCount} warning${warningCount !== 1 ? 's' : ''}` : ''}`
          : 'No violations found',
      nextPhase:
        violationCount > 0
          ? 'Violations found → auto-fix (sheets_fix.fix) or manual review → re-validate'
          : 'Validation passed → proceed with data operations',
      riskLevel: (violationCount > 10
        ? 'high'
        : violationCount > 0
          ? 'medium'
          : 'none') as ResponseHints['riskLevel'],
    };
  } else if (options.toolName === 'sheets_collaborate' && actionName === 'share_add') {
    const email = getOptionalString(responseRecord, 'email') ?? '';
    const role = getOptionalString(responseRecord, 'role') ?? 'viewer';
    responseRecord['_hints'] = {
      dataShape: `Shared with ${email || 'user'} as ${role}`,
      nextPhase:
        'Share complete → notify collaborator → set data validations or protected ranges if needed',
      riskLevel: 'none' as const,
    };
  } else if (options.toolName === 'sheets_fix' && actionName === 'suggest_cleaning') {
    const suggestionCount = Array.isArray(responseRecord['suggestions'])
      ? responseRecord['suggestions'].length
      : 0;
    if (suggestionCount > 0) {
      responseRecord['_hints'] = {
        dataShape: `${suggestionCount} cleaning suggestion${suggestionCount !== 1 ? 's' : ''} identified`,
        nextPhase:
          'Review suggestions → apply cleaning (sheets_fix.clean with recommended rules) → validate',
        riskLevel: 'low' as const,
      };
    }
  }

  // Inject aiMode into _meta if provided
  if (options.aiMode) {
    const existing = responseRecord['_meta'];
    const meta: Record<string, unknown> = isRecord(existing) ? existing : {};
    meta['aiMode'] = options.aiMode;
    responseRecord['_meta'] = meta;
  }

  // Return batching hint for the caller to inject into _meta
  const batchingHint = BATCHING_HINTS[`${options.toolName}.${actionName}`];
  return {
    ...(batchingHint ? { batchingHint } : {}),
    ...(options.aiMode ? { aiMode: options.aiMode } : {}),
  };
}
