import { ErrorCodes } from '../error-codes.js';
import type { sheets_v4 } from 'googleapis';
import { TieredRetrieval } from '../../analysis/tiered-retrieval.js';
import type { AnalyzeResponse } from '../../schemas/analyze.js';
import { getCacheAdapter } from '../../utils/cache-adapter.js';
import { logger } from '../../utils/logger.js';

type AnalyzeFormulasRequest = {
  spreadsheetId: string;
  sheetId?: number;
  includeOptimizations?: boolean;
  includeComplexity?: boolean;
};

interface AnalyzeFormulasDeps {
  sheetsApi: sheets_v4.Sheets;
  sendProgress?: (completed: number, total: number, message?: string) => Promise<void>;
}

/**
 * Decomposed action handler for `analyze_formulas`.
 * Preserves original behavior while moving logic out of the main AnalyzeHandler class.
 */
export async function handleAnalyzeFormulasAction(
  input: AnalyzeFormulasRequest,
  deps: AnalyzeFormulasDeps
): Promise<AnalyzeResponse> {
  const startTime = Date.now();

  try {
    const tieredRetrieval = new TieredRetrieval({
      cache: getCacheAdapter('analysis'),
      sheetsApi: deps.sheetsApi,
    });

    const metadata = await tieredRetrieval.getMetadata(input.spreadsheetId);

    const formulas: Array<{
      cell: string;
      formula: string;
      value?: string | number | boolean | null;
      formattedValue?: string;
    }> = [];

    const allRanges = metadata.sheets.map((s) => `'${s.title}'`);
    const batchResponse = await deps.sheetsApi.spreadsheets.get({
      spreadsheetId: input.spreadsheetId,
      ranges: allRanges,
      includeGridData: true,
      fields:
        'sheets(data(rowData(values(userEnteredValue,effectiveValue,formattedValue))),properties(title))',
    });

    const sheetBlocks = batchResponse.data.sheets ?? [];
    const totalSheets = sheetBlocks.length;
    const shouldReportProgress = totalSheets >= 2 && typeof deps.sendProgress === 'function';
    let processedSheets = 0;

    if (shouldReportProgress) {
      try {
        await deps.sendProgress!(
          0,
          totalSheets,
          `Scanning formulas across ${totalSheets} sheet(s)...`
        );
      } catch {
        // Best-effort progress reporting.
      }
    }

    for (const sheetData of sheetBlocks) {
      const sheetTitle = sheetData.properties?.title ?? 'Untitled';
      for (const gridData of sheetData.data ?? []) {
        if (!gridData.rowData) continue;
        for (let rowIdx = 0; rowIdx < gridData.rowData.length; rowIdx++) {
          const row = gridData.rowData[rowIdx];
          if (!row?.values) continue;
          for (let colIdx = 0; colIdx < row.values.length; colIdx++) {
            const cell = row.values[colIdx];
            if (cell?.userEnteredValue?.formulaValue) {
              const cellA1 = `${String.fromCharCode(65 + colIdx)}${rowIdx + 1}`;
              const effectiveValue = cell.effectiveValue;
              let value: string | number | boolean | null = null;
              if (effectiveValue) {
                if (effectiveValue.errorValue) {
                  value = effectiveValue.errorValue.type || '#ERROR!';
                } else if (effectiveValue.stringValue !== undefined) {
                  value = effectiveValue.stringValue;
                } else if (effectiveValue.numberValue !== undefined) {
                  value = effectiveValue.numberValue;
                } else if (effectiveValue.boolValue !== undefined) {
                  value = effectiveValue.boolValue;
                }
              }
              formulas.push({
                cell: `${sheetTitle}!${cellA1}`,
                formula: cell.userEnteredValue.formulaValue,
                value,
                formattedValue: cell.formattedValue || undefined,
              });
            }
          }
        }
      }

      processedSheets += 1;
      if (shouldReportProgress && (processedSheets % 2 === 0 || processedSheets === totalSheets)) {
        try {
          await deps.sendProgress!(
            processedSheets,
            totalSheets,
            processedSheets === totalSheets
              ? `Formula scan complete: ${processedSheets}/${totalSheets} sheet(s)`
              : `Scanned formulas in ${processedSheets}/${totalSheets} sheet(s)...`
          );
        } catch {
          // Best-effort progress reporting.
        }
      }
    }

    const {
      findVolatileFormulas,
      analyzeFormulaComplexity,
      detectCircularRefs,
      generateOptimizations,
      detectFormulaUpgrades,
      detectFormulaErrors,
      calculateFormulaHealth,
    } = await import('../../analysis/formula-helpers.js');

    const formulaErrors = detectFormulaErrors(formulas);
    const healthSummary = calculateFormulaHealth(formulas.length, formulaErrors);

    const volatileFormulas = findVolatileFormulas(formulas);
    const circularRefs = detectCircularRefs(formulas);

    const complexityScores = formulas.map((f) => analyzeFormulaComplexity(f.cell, f.formula));

    const complexityDistribution = {
      simple: complexityScores.filter((c) => c.category === 'simple').length,
      moderate: complexityScores.filter((c) => c.category === 'moderate').length,
      complex: complexityScores.filter((c) => c.category === 'complex').length,
      very_complex: complexityScores.filter((c) => c.category === 'very_complex').length,
    };

    const optimizationOpportunities =
      input.includeOptimizations !== false ? generateOptimizations(formulas) : [];

    const upgradeOpportunities =
      input.includeOptimizations !== false
        ? detectFormulaUpgrades(formulas, input.spreadsheetId)
        : [];

    const duration = Date.now() - startTime;

    return {
      success: true,
      action: 'analyze_formulas',
      // upgradeOpportunities is a runtime-only extension (not in output schema)
      // buildToolResponse() serializes all fields regardless of type constraints
      ...((upgradeOpportunities.length > 0
        ? {
            upgradeOpportunities: upgradeOpportunities.slice(0, 20).map((u) => ({
              cell: u.cell,
              pattern: u.pattern,
              currentFormula: u.currentFormula,
              suggestedFormula: u.suggestedFormula,
              reason: u.reason,
              confidence: u.confidence,
              executable: u.executable,
            })),
          }
        : {}) as Record<string, never>),
      formulaAnalysis: {
        totalFormulas: formulas.length,
        healthScore: healthSummary.healthScore,
        healthyFormulas: healthSummary.healthyFormulas,
        errorCount: healthSummary.errorCount,
        errorsByType: healthSummary.errorsByType,
        formulaErrors:
          formulaErrors.length > 0
            ? formulaErrors.slice(0, 50).map((e) => ({
                cell: e.cell,
                formula: e.formula,
                errorType: e.errorType,
                errorValue: e.errorValue,
                severity: e.severity,
                suggestion: e.suggestion,
                possibleCauses: e.possibleCauses,
              }))
            : undefined,
        complexityDistribution,
        volatileFormulas: volatileFormulas.slice(0, 20).map((v) => ({
          cell: v.cell,
          formula: v.formula,
          volatileFunctions: v.volatileFunctions,
          impact: v.impact,
          suggestion: v.suggestion,
        })),
        optimizationOpportunities: optimizationOpportunities.slice(0, 20).map((o) => ({
          type: o.type,
          priority: o.priority,
          affectedCells: o.affectedCells,
          currentFormula: o.currentFormula,
          suggestedFormula: o.suggestedFormula,
          reasoning: o.reasoning,
        })),
        circularReferences:
          circularRefs.length > 0
            ? circularRefs.map((c) => ({
                cells: c.cells,
                chain: c.chain,
              }))
            : undefined,
      },
      duration,
      message:
        formulaErrors.length > 0
          ? `⚠️ Found ${formulaErrors.length} formula error(s) (${healthSummary.criticalErrors.length} critical). Health: ${healthSummary.healthScore}%. Analyzed ${formulas.length} formulas.`
          : `✅ No formula errors. Health: ${healthSummary.healthScore}%. Analyzed ${formulas.length} formulas: ${volatileFormulas.length} volatile, ${optimizationOpportunities.length} optimizations, ${upgradeOpportunities.length} upgrades.`,
    };
  } catch (error) {
    logger.error('Failed to analyze formulas', {
      component: 'analyze-handler',
      action: 'analyze_formulas',
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      success: false,
      error: {
        code: ErrorCodes.INTERNAL_ERROR,
        message: 'Failed to analyze formulas',
        retryable: true,
      },
    };
  }
}
