/**
 * ServalSheets - Dependencies Handler
 *
 * Handles sheets_dependencies MCP tool for formula dependency analysis.
 *
 * Actions:
 * - build: Build dependency graph from spreadsheet
 * - analyze_impact: Analyze impact of changing a cell
 * - detect_cycles: Detect circular dependencies
 * - get_dependencies: Get cells a cell depends on
 * - get_dependents: Get cells that depend on a cell
 * - get_stats: Get dependency statistics
 * - export_dot: Export graph as DOT format
 *
 * @category Handlers
 */

import { ErrorCodes } from './error-codes.js';
import type { sheets_v4 } from 'googleapis';
import { ImpactAnalyzer } from '../analysis/impact-analyzer.js';
import type {
  SheetsDependenciesInput,
  SheetsDependenciesOutput,
  ModelScenarioInput,
  CompareScenariosInput,
  CreateScenarioSheetInput,
} from '../schemas/dependencies.js';
import type { SamplingServer } from '../mcp/sampling.js';
import { withSamplingTimeout, assertSamplingConsent, generateAIInsight } from '../mcp/sampling.js';
import { logger } from '../utils/logger.js';
import { executeWithRetry } from '../utils/retry.js';
import { sendProgress } from '../utils/request-context.js';
import { mapStandaloneError } from './helpers/error-mapping.js';
import { formulaEvaluator, type SheetData } from '../services/formula-evaluator.js';
import { recordScenarioModel } from '../observability/metrics.js';

const ANALYZER_CACHE_MAX = 25;
const ANALYZER_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

interface AnalyzerCacheEntry {
  analyzer: ImpactAnalyzer;
  lastUsed: number;
}

class AnalyzerLRUCache {
  private map = new Map<string, AnalyzerCacheEntry>();

  get(spreadsheetId: string): ImpactAnalyzer | undefined {
    const entry = this.map.get(spreadsheetId);
    if (!entry) return undefined;
    if (Date.now() - entry.lastUsed > ANALYZER_CACHE_TTL_MS) {
      this.map.delete(spreadsheetId);
      return undefined;
    }
    // Refresh: delete + re-insert moves to end (insertion-order)
    entry.lastUsed = Date.now();
    this.map.delete(spreadsheetId);
    this.map.set(spreadsheetId, entry);
    return entry.analyzer;
  }

  set(spreadsheetId: string, analyzer: ImpactAnalyzer): void {
    if (this.map.size >= ANALYZER_CACHE_MAX && !this.map.has(spreadsheetId)) {
      // Evict least-recently-used (first entry)
      const oldestKey = this.map.keys().next().value;
      if (oldestKey !== undefined) this.map.delete(oldestKey);
    }
    this.map.set(spreadsheetId, { analyzer, lastUsed: Date.now() });
  }

  clear(): void {
    this.map.clear();
  }
}

/**
 * Dependency analyzer cache (LRU, max 25 entries, 30-minute TTL)
 * Maps spreadsheetId -> ImpactAnalyzer
 */
const analyzerCache = new AnalyzerLRUCache();

function isLikelyPseudoFormulaText(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false;
  }

  const trimmed = value.trim();
  if (!trimmed.startsWith('=')) {
    return false;
  }

  const body = trimmed.slice(1).trim();
  if (!body) {
    return false;
  }

  const hasCellRefs = /\b\$?[A-Za-z]{1,3}\$?\d+\b/.test(body);
  const hasFunctionCall = /\b[A-Za-z_][A-Za-z0-9_.]*\s*\(/.test(body);
  const hasQuotedText = /"/.test(body);
  const hasWordPair = /\b[A-Za-z][A-Za-z0-9/_-]*\s+[A-Za-z][A-Za-z0-9/_-]*/.test(body);
  const usesLetterXOperator = /\s[xX]\s/.test(body);

  return !hasCellRefs && !hasFunctionCall && !hasQuotedText && hasWordPair && usesLetterXOperator;
}

export interface DependenciesHandlerOptions {
  samplingServer?: SamplingServer;
  sessionContext?: import('../services/session-context.js').SessionContextManager;
}

/**
 * Dependencies handler
 */
export class DependenciesHandler {
  private sheetsApi: sheets_v4.Sheets;
  private samplingServer?: SamplingServer;
  private sessionContext?: import('../services/session-context.js').SessionContextManager;

  constructor(sheetsApi: sheets_v4.Sheets, options?: DependenciesHandlerOptions) {
    this.sheetsApi = sheetsApi;
    this.samplingServer = options?.samplingServer;
    this.sessionContext = options?.sessionContext;
  }

  /**
   * Handle sheets_dependencies tool calls
   */
  async handle(input: SheetsDependenciesInput): Promise<SheetsDependenciesOutput> {
    const req = input.request;
    try {
      switch (req.action) {
        case 'build':
          return { response: await this.handleBuild(req) };

        case 'analyze_impact':
          return { response: await this.handleAnalyzeImpact(req) };

        case 'detect_cycles':
          return { response: await this.handleDetectCycles(req) };

        case 'get_dependencies':
          return { response: await this.handleGetDependencies(req) };

        case 'get_dependents':
          return { response: await this.handleGetDependents(req) };

        case 'get_stats':
          return { response: await this.handleGetStats(req) };

        case 'export_dot':
          return { response: await this.handleExportDot(req) };

        case 'model_scenario':
          return { response: await this.handleModelScenario(req as ModelScenarioInput) };

        case 'compare_scenarios':
          return { response: await this.handleCompareScenarios(req as CompareScenariosInput) };

        case 'create_scenario_sheet':
          return {
            response: await this.handleCreateScenarioSheet(req as CreateScenarioSheetInput),
          };

        default: {
          const _exhaustiveCheck: never = req;
          return {
            response: {
              success: false,
              error: {
                code: ErrorCodes.INVALID_PARAMS,
                message: `Unknown action: ${(_exhaustiveCheck as { action: string }).action}`,
                retryable: false,
                suggestedFix:
                  "Check parameter format - ranges use A1 notation like 'Sheet1!A1:D10'",
              },
            },
          };
        }
      }
    } catch (error) {
      logger.error('Dependencies handler error', {
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
   * Build dependency graph
   */
  private async handleBuild(
    input: Extract<SheetsDependenciesInput['request'], { action: 'build' }>
  ): Promise<SheetsDependenciesOutput['response']> {
    try {
      const { spreadsheetId, sheetNames } = input;

      // Create or reuse analyzer
      let analyzer = analyzerCache.get(spreadsheetId);
      if (!analyzer) {
        analyzer = new ImpactAnalyzer();
        analyzerCache.set(spreadsheetId, analyzer);
      } else {
        // Clear existing graph
        analyzer.clear();
      }

      // Build from spreadsheet
      await analyzer.buildFromSpreadsheet(this.sheetsApi, spreadsheetId, sheetNames);

      const stats = analyzer.getStats();

      return {
        success: true,
        data: {
          spreadsheetId,
          cellCount: stats.totalCells,
          formulaCount: stats.formulaCells,
          message: `Built dependency graph with ${stats.totalCells} cells and ${stats.totalDependencies} dependencies`,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: mapStandaloneError(error),
      };
    }
  }

  /**
   * Analyze impact of changing a cell
   */
  private async handleAnalyzeImpact(
    input: Extract<SheetsDependenciesInput['request'], { action: 'analyze_impact' }>
  ): Promise<SheetsDependenciesOutput['response']> {
    try {
      const { spreadsheetId, cell } = input;

      // Get analyzer (build if not exists)
      let analyzer = analyzerCache.get(spreadsheetId);
      if (!analyzer) {
        analyzer = new ImpactAnalyzer();
        await analyzer.buildFromSpreadsheet(this.sheetsApi, spreadsheetId);
        analyzerCache.set(spreadsheetId, analyzer);
      }

      const impact = analyzer.analyzeImpact(cell);

      return {
        success: true,
        data: impact,
      };
    } catch (error) {
      return {
        success: false,
        error: mapStandaloneError(error),
      };
    }
  }

  /**
   * Detect circular dependencies
   */
  private async handleDetectCycles(
    input: Extract<SheetsDependenciesInput['request'], { action: 'detect_cycles' }>
  ): Promise<SheetsDependenciesOutput['response']> {
    try {
      const { spreadsheetId } = input;

      // Get analyzer (build if not exists)
      let analyzer = analyzerCache.get(spreadsheetId);
      if (!analyzer) {
        analyzer = new ImpactAnalyzer();
        await analyzer.buildFromSpreadsheet(this.sheetsApi, spreadsheetId);
        analyzerCache.set(spreadsheetId, analyzer);
      }

      const circularDependencies = analyzer.detectCircularDependencies();

      // Generate AI insight explaining impact of circular references
      let aiInsight: string | undefined;
      if (this.samplingServer && circularDependencies.length > 0) {
        const cycleDesc = circularDependencies
          .slice(0, 5)
          .map((c) => `Cycle: ${c.chain}`)
          .join('; ');
        aiInsight = await generateAIInsight(
          this.samplingServer,
          'dataAnalysis',
          'Explain the impact of these circular references and how to break them',
          cycleDesc,
          { maxTokens: 400 }
        );
      }

      return {
        success: true,
        data: { circularDependencies, ...(aiInsight !== undefined ? { aiInsight } : {}) },
      };
    } catch (error) {
      return {
        success: false,
        error: mapStandaloneError(error),
      };
    }
  }

  /**
   * Get dependencies for a cell
   */
  private async handleGetDependencies(
    input: Extract<SheetsDependenciesInput['request'], { action: 'get_dependencies' }>
  ): Promise<SheetsDependenciesOutput['response']> {
    try {
      const { spreadsheetId, cell } = input;

      // Get analyzer (build if not exists)
      let analyzer = analyzerCache.get(spreadsheetId);
      if (!analyzer) {
        analyzer = new ImpactAnalyzer();
        await analyzer.buildFromSpreadsheet(this.sheetsApi, spreadsheetId);
        analyzerCache.set(spreadsheetId, analyzer);
      }

      const impact = analyzer.analyzeImpact(cell);

      return {
        success: true,
        data: { dependencies: impact.dependencies },
      };
    } catch (error) {
      return {
        success: false,
        error: mapStandaloneError(error),
      };
    }
  }

  /**
   * Get dependents for a cell
   */
  private async handleGetDependents(
    input: Extract<SheetsDependenciesInput['request'], { action: 'get_dependents' }>
  ): Promise<SheetsDependenciesOutput['response']> {
    try {
      const { spreadsheetId, cell } = input;

      // Get analyzer (build if not exists)
      let analyzer = analyzerCache.get(spreadsheetId);
      if (!analyzer) {
        analyzer = new ImpactAnalyzer();
        await analyzer.buildFromSpreadsheet(this.sheetsApi, spreadsheetId);
        analyzerCache.set(spreadsheetId, analyzer);
      }

      const impact = analyzer.analyzeImpact(cell);

      return {
        success: true,
        data: { dependents: impact.allAffectedCells },
      };
    } catch (error) {
      return {
        success: false,
        error: mapStandaloneError(error),
      };
    }
  }

  /**
   * Get dependency statistics
   */
  private async handleGetStats(
    input: Extract<SheetsDependenciesInput['request'], { action: 'get_stats' }>
  ): Promise<SheetsDependenciesOutput['response']> {
    try {
      const { spreadsheetId } = input;

      // Get analyzer (build if not exists)
      let analyzer = analyzerCache.get(spreadsheetId);
      if (!analyzer) {
        analyzer = new ImpactAnalyzer();
        await analyzer.buildFromSpreadsheet(this.sheetsApi, spreadsheetId);
        analyzerCache.set(spreadsheetId, analyzer);
      }

      const stats = analyzer.getStats();

      // Generate AI insight summarizing dependency health
      let aiInsight: string | undefined;
      if (this.samplingServer) {
        const statsStr = `Total cells: ${stats.totalCells}, Formula cells: ${stats.formulaCells}, Dependencies: ${stats.totalDependencies}, Max depth: ${stats.maxDepth}`;
        aiInsight = await generateAIInsight(
          this.samplingServer,
          'dataAnalysis',
          'Summarize the health of this dependency graph — are there concerning patterns?',
          statsStr,
          { maxTokens: 300 }
        );
      }

      return {
        success: true,
        data: { ...stats, ...(aiInsight !== undefined ? { aiInsight } : {}) },
      };
    } catch (error) {
      return {
        success: false,
        error: mapStandaloneError(error),
      };
    }
  }

  /**
   * Export graph as DOT format
   */
  private async handleExportDot(
    input: Extract<SheetsDependenciesInput['request'], { action: 'export_dot' }>
  ): Promise<SheetsDependenciesOutput['response']> {
    try {
      const { spreadsheetId } = input;

      // Get analyzer (build if not exists)
      let analyzer = analyzerCache.get(spreadsheetId);
      if (!analyzer) {
        analyzer = new ImpactAnalyzer();
        await analyzer.buildFromSpreadsheet(this.sheetsApi, spreadsheetId);
        analyzerCache.set(spreadsheetId, analyzer);
      }

      const dot = analyzer.exportDOT();

      return {
        success: true,
        data: { dot },
      };
    } catch (error) {
      return {
        success: false,
        error: mapStandaloneError(error),
      };
    }
  }

  // ============================================================================
  // F6: Scenario Modeling (3 actions)
  // ============================================================================

  /**
   * Load spreadsheet data into HyperFormula evaluator so model_scenario and
   * compare_scenarios can return predicted values (not just affected addresses).
   *
   * Fetches values + formulas in a single batchGet to minimize API calls.
   */
  private async loadSheetForEvaluation(spreadsheetId: string, firstSheet: string): Promise<void> {
    if (formulaEvaluator.isLoaded(spreadsheetId)) return; // already loaded

    try {
      const [valueResp, formulaResp, metaResp] = await Promise.all([
        executeWithRetry(() =>
          this.sheetsApi.spreadsheets.values.get({
            spreadsheetId,
            range: firstSheet,
            valueRenderOption: 'UNFORMATTED_VALUE',
          })
        ),
        executeWithRetry(() =>
          this.sheetsApi.spreadsheets.values.get({
            spreadsheetId,
            range: firstSheet,
            valueRenderOption: 'FORMULA',
          })
        ),
        executeWithRetry(() =>
          this.sheetsApi.spreadsheets.get({
            spreadsheetId,
            fields: 'properties(locale)',
          })
        ),
      ]);

      const rawValues = (valueResp.data.values ?? []) as (string | number | boolean | null)[][];
      const rawFormulas = (formulaResp.data.values ?? []) as (string | null)[][];
      const spreadsheetLocale = (metaResp.data.properties as { locale?: string } | undefined)
        ?.locale;

      const maxRows = Math.max(rawValues.length, rawFormulas.length);
      const maxCols = Math.max(
        ...rawValues.map((r) => r.length),
        ...rawFormulas.map((r) => r.length),
        0
      );

      const values: (string | number | boolean | null)[][] = [];
      const formulas: (string | null)[][] = [];

      for (let r = 0; r < maxRows; r++) {
        values.push([]);
        formulas.push([]);
        for (let c = 0; c < maxCols; c++) {
          values[r]!.push(rawValues[r]?.[c] ?? null);
          const f = rawFormulas[r]?.[c];
          formulas[r]!.push(typeof f === 'string' && f.startsWith('=') ? f : null);
        }
      }

      const sheetData: SheetData = {
        values,
        formulas,
        sheetName: firstSheet,
        locale: spreadsheetLocale,
      };

      await formulaEvaluator.loadSheet(spreadsheetId, sheetData);
    } catch (error) {
      // Non-blocking: if load fails, evaluateScenario returns null and we fall back
      logger.warn('formula_evaluator_load_failed', { spreadsheetId, error });
    }
  }

  private async handleModelScenario(
    req: ModelScenarioInput
  ): Promise<SheetsDependenciesOutput['response']> {
    // Build or retrieve dependency graph
    let analyzer = analyzerCache.get(req.spreadsheetId);
    if (!analyzer) {
      analyzer = new ImpactAnalyzer();
      await analyzer.buildFromSpreadsheet(this.sheetsApi, req.spreadsheetId);
      analyzerCache.set(req.spreadsheetId, analyzer);
    }

    // For each input change, trace all dependent cells
    const allAffected = new Set<string>();
    const affectedByMap = new Map<string, string[]>(); // cell → which input changes affect it
    const totalProgressSteps = req.changes.length + 3;
    const shouldReportProgress = req.changes.length >= 2;
    let completedProgressSteps = 0;

    if (shouldReportProgress) {
      await sendProgress(
        0,
        totalProgressSteps,
        `Modeling scenario impact (0/${totalProgressSteps} steps)...`
      );
    }

    for (const change of req.changes) {
      const impact = analyzer.analyzeImpact(change.cell);
      for (const dep of impact.allAffectedCells) {
        if (!allAffected.has(dep)) {
          allAffected.add(dep);
          affectedByMap.set(dep, [change.cell]);
        } else {
          affectedByMap.get(dep)?.push(change.cell);
        }
      }

      if (shouldReportProgress) {
        completedProgressSteps += 1;
        if (completedProgressSteps % 2 === 0 || completedProgressSteps === req.changes.length) {
          await sendProgress(
            completedProgressSteps,
            totalProgressSteps,
            `Analyzed dependency impact for ${completedProgressSteps}/${req.changes.length} change(s)...`
          );
        }
      }
    }

    const cellRefs = [...allAffected];

    // -----------------------------------------------------------------------
    // Layer 2: Try HyperFormula evaluation for predicted values
    // -----------------------------------------------------------------------

    // Load sheet data into evaluator if not already loaded (uses "Sheet1" as default)
    const firstSheetRange = 'Sheet1';
    await this.loadSheetForEvaluation(req.spreadsheetId, firstSheetRange);

    const evalResult = await formulaEvaluator.evaluateScenario(req.spreadsheetId, req.changes);
    if (shouldReportProgress) {
      completedProgressSteps += 1;
      await sendProgress(
        completedProgressSteps,
        totalProgressSteps,
        `Evaluated formulas for scenario changes (${completedProgressSteps}/${totalProgressSteps})...`
      );
    }

    // Build cascade effects (with predicted values when available)
    const cascadeEffects: {
      cell: string;
      formula?: string;
      currentValue?: string | number | null;
      predictedValue?: string | number | null;
      percentageChange?: number;
      affectedBy?: string[];
      evaluationSource?: 'hyperformula' | 'google_api' | 'not_evaluated';
    }[] = [];

    if (evalResult) {
      // Use HyperFormula results as primary source
      const hfByCell = new Map(evalResult.localResults.map((r) => [r.cell, r]));

      for (const cell of cellRefs) {
        const hf = hfByCell.get(cell);
        const effect: (typeof cascadeEffects)[number] = {
          cell,
          affectedBy: affectedByMap.get(cell),
        };

        if (hf) {
          if (hf.formula) effect.formula = hf.formula;
          const oldV = hf.oldValue;
          effect.currentValue = typeof oldV === 'boolean' ? String(oldV) : oldV;
          const newV = hf.newValue;
          effect.predictedValue = typeof newV === 'boolean' ? String(newV) : newV;
          if (hf.percentageChange !== undefined) effect.percentageChange = hf.percentageChange;
          effect.evaluationSource = 'hyperformula';
        } else if (evalResult.needsGoogleEval.includes(cell)) {
          effect.evaluationSource = 'google_api';
        } else {
          effect.evaluationSource = 'not_evaluated';
        }

        cascadeEffects.push(effect);
      }
    } else {
      // Fallback: API-based value fetch (original behavior)
      const cascadeRanges =
        cellRefs.length > 0 && cellRefs.length <= 500
          ? cellRefs.map((c) => (c.includes('!') ? c : `Sheet1!${c}`))
          : [];

      if (cascadeRanges.length > 0) {
        try {
          const [valueResult, formulaResult] = await Promise.all([
            executeWithRetry(() =>
              this.sheetsApi.spreadsheets.values.batchGet({
                spreadsheetId: req.spreadsheetId,
                ranges: cascadeRanges,
                valueRenderOption: 'UNFORMATTED_VALUE',
              })
            ),
            executeWithRetry(() =>
              this.sheetsApi.spreadsheets.values.batchGet({
                spreadsheetId: req.spreadsheetId,
                ranges: cascadeRanges,
                valueRenderOption: 'FORMULA',
              })
            ),
          ]);

          for (let i = 0; i < cellRefs.length; i++) {
            const cell = cellRefs[i]!;
            const rawVal = valueResult.data.valueRanges?.[i]?.values?.[0]?.[0] ?? null;
            const currentValue = typeof rawVal === 'boolean' ? String(rawVal) : rawVal;
            const formula = formulaResult.data.valueRanges?.[i]?.values?.[0]?.[0];
            cascadeEffects.push({
              cell,
              ...(typeof formula === 'string' && formula.startsWith('=') ? { formula } : {}),
              currentValue,
              affectedBy: affectedByMap.get(cell),
              evaluationSource: 'not_evaluated',
            });
          }
        } catch {
          // OK: Explicit empty — value fetch failed, return addresses only
          for (const cell of cellRefs) {
            cascadeEffects.push({ cell, affectedBy: affectedByMap.get(cell) });
          }
        }
      } else {
        for (const cell of cellRefs) {
          cascadeEffects.push({ cell, affectedBy: affectedByMap.get(cell) });
        }
      }
    }

    // Build input changes with from/to values
    const inputChanges: {
      cell: string;
      from?: string | number | null;
      to: string | number | boolean | null;
    }[] = [];

    if (evalResult) {
      // Use pre-change values from HyperFormula
      for (const change of req.changes) {
        const hf = evalResult.localResults.find((r) => r.cell === change.cell);
        const from = hf
          ? typeof hf.oldValue === 'boolean'
            ? String(hf.oldValue)
            : hf.oldValue
          : undefined;
        inputChanges.push({
          cell: change.cell,
          ...(from !== undefined ? { from } : {}),
          to: change.newValue,
        });
      }
    } else {
      // Fetch from API
      const inputRanges = req.changes.map((c) =>
        c.cell.includes('!') ? c.cell : `Sheet1!${c.cell}`
      );
      try {
        const inputResult = await executeWithRetry(() =>
          this.sheetsApi.spreadsheets.values.batchGet({
            spreadsheetId: req.spreadsheetId,
            ranges: inputRanges,
            valueRenderOption: 'UNFORMATTED_VALUE',
          })
        );
        for (let i = 0; i < req.changes.length; i++) {
          const change = req.changes[i]!;
          const rawFrom = inputResult.data.valueRanges?.[i]?.values?.[0]?.[0] ?? null;
          const from = typeof rawFrom === 'boolean' ? String(rawFrom) : rawFrom;
          inputChanges.push({ cell: change.cell, from, to: change.newValue });
        }
      } catch {
        for (const c of req.changes) {
          inputChanges.push({ cell: c.cell, to: c.newValue });
        }
      }
    }

    if (shouldReportProgress) {
      completedProgressSteps += 1;
      await sendProgress(
        completedProgressSteps,
        totalProgressSteps,
        `Prepared scenario output summary (${completedProgressSteps}/${totalProgressSteps})...`
      );
    }

    // -----------------------------------------------------------------------
    // Summary
    // -----------------------------------------------------------------------
    const predictedCount = evalResult?.localResults.length ?? 0;
    const googleFallbackCount = evalResult?.needsGoogleEval.length ?? 0;
    const evaluationNote = evalResult
      ? ` ${predictedCount} cell(s) with predicted values (HyperFormula)${googleFallbackCount > 0 ? `, ${googleFallbackCount} require Google API evaluation` : ''}.`
      : cellRefs.length > 500
        ? '. Values not fetched (>500 affected cells — use a narrower scope).'
        : '';

    // If sampling is available, generate a narrative explanation of the cascade
    let aiNarrative: string | undefined;
    if (this.samplingServer) {
      try {
        const changeDesc = req.changes.map((c) => `${c.cell} → ${String(c.newValue)}`).join(', ');

        // Include top predicted values in the narrative prompt for better context
        const topPredicted = evalResult?.localResults
          .slice(0, 5)
          .map((r) => `${r.cell}: ${String(r.oldValue)} → ${String(r.newValue)}`)
          .join(', ');

        await assertSamplingConsent(); // ISSUE-226: GDPR consent gate
        const narrativeResult = await withSamplingTimeout(() =>
          this.samplingServer!.createMessage({
            messages: [
              {
                role: 'user' as const,
                content: {
                  type: 'text' as const,
                  text: `In 1-2 sentences, describe the business impact of changing ${changeDesc} in spreadsheet '${req.spreadsheetId}', which would affect ${allAffected.size} dependent cell(s)${topPredicted ? `. Key predicted changes: ${topPredicted}` : ''}.`,
                },
              },
            ],
            maxTokens: 256,
          })
        );
        const text = Array.isArray(narrativeResult.content)
          ? ((
              narrativeResult.content.find((c) => c.type === 'text') as { text: string } | undefined
            )?.text ?? '')
          : ((narrativeResult.content as { text?: string }).text ?? '');
        aiNarrative = text.trim();
      } catch {
        // Non-blocking: sampling failure should not block the scenario result
      }
    }

    if (shouldReportProgress) {
      await sendProgress(
        totalProgressSteps,
        totalProgressSteps,
        `Scenario modeling complete (${totalProgressSteps}/${totalProgressSteps})`
      );
    }

    // Record operation in session context for LLM follow-up references
    try {
      if (this.sessionContext) {
        this.sessionContext.recordOperation({
          tool: 'sheets_dependencies',
          action: 'model_scenario',
          spreadsheetId: req.spreadsheetId,
          description: `Modeled scenario: ${req.changes.length} input change(s) affected ${allAffected.size} cells`,
          undoable: false,
          cellsAffected: allAffected.size,
        });
      }
    } catch {
      // Non-blocking: session context recording is best-effort
    }
    recordScenarioModel('model_scenario', 'success');

    return {
      success: true,
      data: {
        action: 'model_scenario',
        inputChanges,
        cascadeEffects,
        summary: {
          cellsAffected: allAffected.size,
          message: `${req.changes.length} input change(s) would affect ${allAffected.size} dependent cell(s).${evaluationNote}`,
          ...(evalResult
            ? {
                evaluationEngine: 'hyperformula',
                cellsWithPredictedValues: predictedCount,
                cellsNeedingGoogleEval: googleFallbackCount,
                evaluationDurationMs: evalResult.durationMs,
              }
            : {}),
        },
        ...(aiNarrative !== undefined ? { aiNarrative } : {}),
      },
    };
  }

  private async handleCompareScenarios(
    req: CompareScenariosInput
  ): Promise<SheetsDependenciesOutput['response']> {
    // Build or retrieve dependency graph
    let analyzer = analyzerCache.get(req.spreadsheetId);
    if (!analyzer) {
      analyzer = new ImpactAnalyzer();
      await analyzer.buildFromSpreadsheet(this.sheetsApi, req.spreadsheetId);
      analyzerCache.set(req.spreadsheetId, analyzer);
    }

    // Load sheet into evaluator for predicted-value support
    await this.loadSheetForEvaluation(req.spreadsheetId, 'Sheet1');
    const scenarioCount = req.scenarios.length;
    const totalProgressSteps = scenarioCount * 2 + 2;
    const shouldReportProgress = scenarioCount >= 2;
    let completedProgressSteps = 0;

    if (shouldReportProgress) {
      await sendProgress(
        0,
        totalProgressSteps,
        `Comparing scenarios (0/${totalProgressSteps} steps)...`
      );
    }

    // Phase 1: Compute affected cells for each scenario
    const perScenario: { name: string; affectedList: string[]; ranges: string[] }[] = [];
    for (const scenario of req.scenarios) {
      const affected = new Set<string>();
      for (const change of scenario.changes) {
        const impact = analyzer!.analyzeImpact(change.cell);
        for (const dep of impact.allAffectedCells) {
          affected.add(dep);
        }
      }
      const affectedList = [...affected];
      const ranges =
        affectedList.length > 0 && affectedList.length <= 500
          ? affectedList.map((c) => (c.includes('!') ? c : `Sheet1!${c}`))
          : [];
      perScenario.push({ name: scenario.name, affectedList, ranges });

      if (shouldReportProgress) {
        completedProgressSteps += 1;
        if (completedProgressSteps % 2 === 0 || completedProgressSteps === scenarioCount) {
          await sendProgress(
            completedProgressSteps,
            totalProgressSteps,
            `Computed affected cells for ${completedProgressSteps}/${scenarioCount} scenario(s)...`
          );
        }
      }
    }

    // Phase 2: Evaluate each scenario in parallel (HyperFormula resets state after each)
    const evalResults = await Promise.allSettled(
      req.scenarios.map((scenario) =>
        formulaEvaluator.evaluateScenario(req.spreadsheetId, scenario.changes)
      )
    );
    if (shouldReportProgress) {
      completedProgressSteps += 1;
      await sendProgress(
        completedProgressSteps,
        totalProgressSteps,
        `Evaluated scenario formulas (${completedProgressSteps}/${totalProgressSteps})...`
      );
    }

    // Phase 3: Assemble results
    const scenarioResults: {
      name: string;
      cellsAffected: number;
      affectedCells?: {
        cell: string;
        formula?: string;
        currentValue?: string | number | null;
        predictedValue?: string | number | null;
        percentageChange?: number;
      }[];
      evaluationEngine?: string;
    }[] = [];

    for (let si = 0; si < req.scenarios.length; si++) {
      const { name, affectedList } = perScenario[si]!;
      const evalSettled = evalResults[si];
      const evalResult = evalSettled?.status === 'fulfilled' ? evalSettled.value : null;

      const result: (typeof scenarioResults)[number] = {
        name,
        cellsAffected: affectedList.length,
      };

      if (evalResult) {
        // Use HyperFormula predicted values
        const hfByCell = new Map(evalResult.localResults.map((r) => [r.cell, r]));
        result.affectedCells = affectedList.map((cell) => {
          const hf = hfByCell.get(cell);
          if (!hf) return { cell } as NonNullable<typeof result.affectedCells>[number];
          const entry: NonNullable<typeof result.affectedCells>[number] = {
            cell,
            ...(hf.formula ? { formula: hf.formula } : {}),
            currentValue: typeof hf.oldValue === 'boolean' ? String(hf.oldValue) : hf.oldValue,
            predictedValue: typeof hf.newValue === 'boolean' ? String(hf.newValue) : hf.newValue,
          };
          if (hf.percentageChange !== undefined) entry.percentageChange = hf.percentageChange;
          return entry;
        });
        result.evaluationEngine = 'hyperformula';
      } else {
        // Fallback: fetch current values via API for this scenario's affected cells
        const { ranges } = perScenario[si]!;
        if (ranges.length > 0) {
          try {
            const [valueResp, formulaResp] = await Promise.all([
              executeWithRetry(() =>
                this.sheetsApi.spreadsheets.values.batchGet({
                  spreadsheetId: req.spreadsheetId,
                  ranges,
                  valueRenderOption: 'UNFORMATTED_VALUE',
                })
              ),
              executeWithRetry(() =>
                this.sheetsApi.spreadsheets.values.batchGet({
                  spreadsheetId: req.spreadsheetId,
                  ranges,
                  valueRenderOption: 'FORMULA',
                })
              ),
            ]);
            result.affectedCells = affectedList.map((cell, i) => {
              const rawVal = valueResp.data.valueRanges?.[i]?.values?.[0]?.[0] ?? null;
              const currentValue = typeof rawVal === 'boolean' ? String(rawVal) : rawVal;
              const formula = formulaResp.data.valueRanges?.[i]?.values?.[0]?.[0];
              return {
                cell,
                ...(typeof formula === 'string' && formula.startsWith('=') ? { formula } : {}),
                currentValue,
              };
            });
          } catch {
            // Values unavailable — return addresses only
          }
        }
      }

      scenarioResults.push(result);

      if (shouldReportProgress) {
        completedProgressSteps += 1;
        if (completedProgressSteps % 2 === 0 || completedProgressSteps === totalProgressSteps - 1) {
          await sendProgress(
            completedProgressSteps,
            totalProgressSteps,
            `Assembled results for ${si + 1}/${scenarioCount} scenario(s)...`
          );
        }
      }
    }

    // Generate AI ranking and trade-off analysis
    let aiRanking: string | undefined;
    if (this.samplingServer && scenarioResults.length > 1) {
      const scenarioSummary = scenarioResults
        .map((s) => `"${s.name}": ${s.cellsAffected} cells affected`)
        .join(', ');
      aiRanking = await generateAIInsight(
        this.samplingServer,
        'scenarioNarrative',
        `Rank these scenarios by impact and explain the trade-offs`,
        scenarioSummary,
        { maxTokens: 400 }
      );
    }

    if (shouldReportProgress) {
      await sendProgress(
        totalProgressSteps,
        totalProgressSteps,
        `Scenario comparison complete (${totalProgressSteps}/${totalProgressSteps})`
      );
    }
    recordScenarioModel('compare_scenarios', 'success');

    return {
      success: true,
      data: {
        action: 'compare_scenarios',
        scenarios: scenarioResults,
        message:
          `Compared ${req.scenarios.length} scenarios. ` +
          scenarioResults.map((s) => `"${s.name}": ${s.cellsAffected} cells affected`).join('; '),
        ...(aiRanking !== undefined ? { aiRanking } : {}),
      },
    };
  }

  private async handleCreateScenarioSheet(
    req: CreateScenarioSheetInput
  ): Promise<SheetsDependenciesOutput['response']> {
    // ISSUE-135: Cap scenario cell count to prevent oversized batchUpdate payloads
    const MAX_SCENARIO_CELLS = 10_000;
    if (req.scenario.changes.length > MAX_SCENARIO_CELLS) {
      return {
        success: false,
        error: {
          code: ErrorCodes.OPERATION_LIMIT_EXCEEDED,
          message: `Scenario contains ${req.scenario.changes.length} cell changes, which exceeds the ${MAX_SCENARIO_CELLS}-cell limit. Narrow the output range or split the scenario into smaller batches.`,
          retryable: false,
        },
      };
    }

    const sheetName = req.targetSheet ?? `Scenario - ${req.scenario.name}`;

    // Determine which sheet to duplicate as the scenario base
    const meta = await this.sheetsApi.spreadsheets.get({
      spreadsheetId: req.spreadsheetId,
      fields: 'sheets.properties',
    });
    let resolvedSourceName = req.sourceSheetName;
    if (!resolvedSourceName) {
      // Infer from first cell reference that includes a sheet prefix
      const firstWithSheet = req.scenario.changes.find((c) => c.cell.includes('!'));
      if (firstWithSheet) {
        resolvedSourceName = firstWithSheet.cell.split('!')[0]?.replace(/'/g, '');
      }
    }
    const sourceSheet = resolvedSourceName
      ? (meta.data.sheets?.find((s) => s.properties?.title === resolvedSourceName) ??
        meta.data.sheets?.[0])
      : meta.data.sheets?.[0];
    const sourceSheetId = sourceSheet?.properties?.sheetId ?? 0;

    const dupResponse = await this.sheetsApi.spreadsheets.batchUpdate({
      spreadsheetId: req.spreadsheetId,
      requestBody: {
        requests: [
          {
            duplicateSheet: {
              sourceSheetId,
              newSheetName: sheetName,
            },
          },
        ],
      },
    });

    const newSheetId = dupResponse.data.replies?.[0]?.duplicateSheet?.properties?.sheetId ?? 0;

    // Apply scenario changes to the new sheet
    const userEnteredWrites: Array<{ range: string; values: unknown[][] }> = [];
    const rawWrites: Array<{ range: string; values: unknown[][] }> = [];

    for (const change of req.scenario.changes) {
      // Rewrite cell refs to target the new sheet
      const cellRef = change.cell.includes('!')
        ? `'${sheetName}'!${change.cell.split('!')[1]}`
        : `'${sheetName}'!${change.cell}`;
      const write = {
        range: cellRef,
        values: [[change.newValue]],
      };
      if (isLikelyPseudoFormulaText(change.newValue)) {
        rawWrites.push(write);
      } else {
        userEnteredWrites.push(write);
      }
    }

    if (userEnteredWrites.length > 0) {
      await this.sheetsApi.spreadsheets.values.batchUpdate({
        spreadsheetId: req.spreadsheetId,
        requestBody: {
          valueInputOption: 'USER_ENTERED',
          data: userEnteredWrites.map((d) => ({ range: d.range, values: d.values })),
        },
      });
    }

    if (rawWrites.length > 0) {
      await this.sheetsApi.spreadsheets.values.batchUpdate({
        spreadsheetId: req.spreadsheetId,
        requestBody: {
          valueInputOption: 'RAW',
          data: rawWrites.map((d) => ({ range: d.range, values: d.values })),
        },
      });
    }
    recordScenarioModel('create_scenario_sheet', 'success');

    return {
      success: true,
      data: {
        action: 'create_scenario_sheet',
        newSheetId,
        newSheetName: sheetName,
        cellsModified: req.scenario.changes.length,
        message: `Created scenario sheet "${sheetName}" with ${req.scenario.changes.length} change(s) applied`,
      },
    };
  }
}

/**
 * Create dependencies handler
 */
export function createDependenciesHandler(
  sheetsApi: sheets_v4.Sheets,
  options?: DependenciesHandlerOptions
): DependenciesHandler {
  return new DependenciesHandler(sheetsApi, options);
}

/**
 * Clear analyzer cache (useful for testing)
 */
export function clearAnalyzerCache(): void {
  analyzerCache.clear();
  logger.debug('Analyzer cache cleared');
}
