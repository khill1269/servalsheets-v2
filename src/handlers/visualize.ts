/**
 * ServalSheets - Visualize Handler
 *
 * Consolidated handler for sheets_visualize tool (chart and pivot table operations)
 * Charts (11 actions) + Pivot tables (7 actions) = 18 actions total
 * MCP Protocol: 2025-11-25
 */

import { ErrorCodes } from './error-codes.js';
import type { sheets_v4 } from 'googleapis';
import { BaseHandler, type HandlerContext, unwrapRequest } from './base.js';
import type { Intent } from '../core/intent.js';
import type {
  SheetsVisualizeInput,
  SheetsVisualizeOutput,
  VisualizeResponse,
  VisualizeRequest,
  ChartCreateInput,
  SuggestChartInput,
  ChartUpdateInput,
  ChartDeleteInput,
  ChartListInput,
  ChartGetInput,
  ChartMoveInput,
  ChartResizeInput,
  ChartUpdateDataRangeInput,
  ChartAddTrendlineInput,
  ChartRemoveTrendlineInput,
  PivotCreateInput,
  SuggestPivotInput,
  PivotUpdateInput,
  PivotDeleteInput,
  PivotListInput,
  PivotGetInput,
  PivotRefreshInput,
} from '../schemas/visualize.js';
import type { RangeInput } from '../schemas/shared.js';
import {
  buildGridRangeInput,
  parseA1Notation,
  type GridRangeInput,
} from '../utils/google-sheets-helpers.js';
import { logger } from '../utils/logger.js';
import {
  handleChartCreateAction,
  handleChartUpdateAction,
  handleChartDeleteAction,
  handleChartListAction,
  handleChartGetAction,
  handleChartMoveAction,
  handleChartResizeAction,
  handleChartUpdateDataRangeAction,
  handleChartAddTrendlineAction,
  handleChartRemoveTrendlineAction,
} from './visualize-actions/charts.js';
import {
  handlePivotCreateAction,
  handlePivotUpdateAction,
  handlePivotDeleteAction,
  handlePivotListAction,
  handlePivotGetAction,
  handlePivotRefreshAction,
} from './visualize-actions/pivots.js';
import {
  handleSuggestChartAction,
  handleSuggestPivotAction,
} from './visualize-actions/suggestions.js';

export class VisualizeHandler extends BaseHandler<SheetsVisualizeInput, SheetsVisualizeOutput> {
  private sheetsApi: sheets_v4.Sheets;

  constructor(context: HandlerContext, sheetsApi: sheets_v4.Sheets) {
    super('sheets_visualize', context);
    this.sheetsApi = sheetsApi;
  }

  /**
   * Apply verbosity filtering to optimize token usage (LLM optimization)
   */
  async handle(input: SheetsVisualizeInput): Promise<SheetsVisualizeOutput> {
    // Phase 1, Task 1.4: Infer missing parameters from context
    const rawReq = unwrapRequest<SheetsVisualizeInput['request']>(input);
    const req = this.inferRequestParameters(rawReq) as VisualizeRequest;

    try {
      const chartDeps = {
        sheetsApi: this.sheetsApi,
        context: this.context,
        toGridRange: (spreadsheetId: string, rangeInput: RangeInput) =>
          this.toGridRange(spreadsheetId, rangeInput),
        resolveSheetId: (spreadsheetId: string, sheetName?: string) =>
          this.getSheetId(spreadsheetId, sheetName, this.sheetsApi),
        success: (...args: Parameters<typeof this.success>) => this.success(...args),
        error: (...args: Parameters<typeof this.error>) => this.error(...args),
        notFoundError: (resourceType: string, resourceId: string | number) =>
          this.notFoundError(resourceType, resourceId),
      } satisfies Parameters<typeof handleChartCreateAction>[1];

      const pivotDeps = {
        sheetsApi: this.sheetsApi,
        context: this.context,
        toGridRange: (spreadsheetId: string, rangeInput: RangeInput) =>
          this.toGridRange(spreadsheetId, rangeInput),
        resolveSheetId: (spreadsheetId: string, sheetName?: string) =>
          this.getSheetId(spreadsheetId, sheetName, this.sheetsApi),
        validateGridDataSize: (spreadsheetId: string, sheetId?: number) =>
          this.validateGridDataSize(spreadsheetId, this.sheetsApi, sheetId),
        success: (...args: Parameters<typeof this.success>) => this.success(...args),
        error: (...args: Parameters<typeof this.error>) => this.error(...args),
        notFoundError: (resourceType: string, resourceId: string | number) =>
          this.notFoundError(resourceType, resourceId),
      } satisfies Parameters<typeof handlePivotCreateAction>[1];

      const suggestionDeps = {
        sheetsApi: this.sheetsApi,
        context: this.context,
        success: (...args: Parameters<typeof this.success>) => this.success(...args),
        error: (...args: Parameters<typeof this.error>) => this.error(...args),
      } satisfies Parameters<typeof handleSuggestChartAction>[1];

      let response: VisualizeResponse;

      // Route to appropriate handler based on action (18 total)
      switch (req.action) {
        // ====================================================================
        // CHART ACTIONS (11)
        // ====================================================================
        case 'chart_create':
          response = await handleChartCreateAction(req as ChartCreateInput, chartDeps);
          break;
        case 'suggest_chart':
          response = await handleSuggestChartAction(req as SuggestChartInput, suggestionDeps);
          break;
        case 'chart_update':
          response = await handleChartUpdateAction(req as ChartUpdateInput, chartDeps);
          break;
        case 'chart_delete':
          response = await handleChartDeleteAction(req as ChartDeleteInput, chartDeps);
          break;
        case 'chart_list':
          response = await handleChartListAction(req as ChartListInput, chartDeps);
          break;
        case 'chart_get':
          response = await handleChartGetAction(req as ChartGetInput, chartDeps);
          break;
        case 'chart_move':
          response = await handleChartMoveAction(req as ChartMoveInput, chartDeps);
          break;
        case 'chart_resize':
          response = await handleChartResizeAction(req as ChartResizeInput, chartDeps);
          break;
        case 'chart_update_data_range':
          response = await handleChartUpdateDataRangeAction(
            req as ChartUpdateDataRangeInput,
            chartDeps
          );
          break;
        case 'chart_add_trendline':
          response = await handleChartAddTrendlineAction(req as ChartAddTrendlineInput, chartDeps);
          break;
        case 'chart_remove_trendline':
          response = await handleChartRemoveTrendlineAction(
            req as ChartRemoveTrendlineInput,
            chartDeps
          );
          break;

        // ====================================================================
        // PIVOT ACTIONS (7)
        // ====================================================================
        case 'pivot_create':
          response = await handlePivotCreateAction(req as PivotCreateInput, pivotDeps);
          break;
        case 'suggest_pivot':
          response = await handleSuggestPivotAction(req as SuggestPivotInput, suggestionDeps);
          break;
        case 'pivot_update':
          response = await handlePivotUpdateAction(req as PivotUpdateInput, pivotDeps);
          break;
        case 'pivot_delete':
          response = await handlePivotDeleteAction(req as PivotDeleteInput, pivotDeps);
          break;
        case 'pivot_list':
          response = await handlePivotListAction(req as PivotListInput, pivotDeps);
          break;
        case 'pivot_get':
          response = await handlePivotGetAction(req as PivotGetInput, pivotDeps);
          break;
        case 'pivot_refresh':
          response = await handlePivotRefreshAction(req as PivotRefreshInput, pivotDeps);
          break;

        default: {
          const _exhaustiveCheck: never = req;
          response = this.error({
            code: ErrorCodes.INVALID_PARAMS,
            message: `Unknown action: ${(_exhaustiveCheck as { action: string }).action}`,
            retryable: false,
            suggestedFix: "Check parameter format - ranges use A1 notation like 'Sheet1!A1:D10'",
          });
        }
      }

      // Track context on success
      if (response.success) {
        this.trackContextFromRequest({
          spreadsheetId: 'spreadsheetId' in req ? req.spreadsheetId : undefined,
          sheetId:
            'sheetId' in req
              ? typeof req.sheetId === 'number'
                ? req.sheetId
                : undefined
              : undefined,
        });
      }

      // Apply verbosity filtering (LLM optimization)
      const verbosity = req.verbosity ?? 'standard';
      const filteredResponse = super.applyVerbosityFilter(response, verbosity);

      return { response: filteredResponse };
    } catch (err) {
      return { response: this.mapError(err) };
    }
  }

  protected createIntents(input: SheetsVisualizeInput): Intent[] {
    const req = unwrapRequest<SheetsVisualizeInput['request']>(input);
    if ('spreadsheetId' in req && req.spreadsheetId) {
      // Determine intent type and destructiveness
      const destructiveActions = ['chart_delete', 'pivot_delete'] as const;
      const isDestructive = destructiveActions.includes(
        req.action as (typeof destructiveActions)[number]
      );

      let type: Intent['type'];
      if (req.action.startsWith('chart_')) {
        type =
          req.action === 'chart_create'
            ? 'ADD_CHART'
            : req.action === 'chart_delete'
              ? 'DELETE_CHART'
              : 'UPDATE_CHART';
      } else {
        type =
          req.action === 'pivot_create'
            ? 'ADD_PIVOT_TABLE'
            : req.action === 'pivot_delete'
              ? 'DELETE_PIVOT_TABLE'
              : 'UPDATE_PIVOT_TABLE';
      }

      return [
        {
          type,
          target: { spreadsheetId: req.spreadsheetId },
          payload: {},
          metadata: {
            sourceTool: this.toolName,
            sourceAction: req.action,
            priority: 1,
            destructive: isDestructive,
          },
        },
      ];
    }
    return [];
  }

  private async toGridRange(
    spreadsheetId: string,
    rangeInput: RangeInput
  ): Promise<GridRangeInput> {
    const a1 = await this.resolveRange(spreadsheetId, rangeInput);

    // Handle comma-separated ranges by parsing each one.
    // Charts that need multiple ranges should use the series.column pattern instead.
    const ranges = this.splitRangeNotation(a1);
    if (ranges.length > 1) {
      logger.warn(
        `Multiple comma-separated ranges detected: "${a1}". Using first range only. ` +
          'For multi-series charts, use the series[].column pattern instead.'
      );
    }

    const firstRange = ranges[0] || a1;
    const parsed = parseA1Notation(firstRange);
    const sheetId = await this.getSheetId(spreadsheetId, parsed.sheetName, this.sheetsApi);

    return buildGridRangeInput(
      sheetId,
      parsed.startRow,
      parsed.endRow,
      parsed.startCol,
      parsed.endCol
    );
  }

  /**
   * Split comma-separated A1 notation, respecting quoted sheet names.
   * Example: "'Sheet One'!A1:B2,C1:D2" -> ["'Sheet One'!A1:B2", "C1:D2"]
   */
  private splitRangeNotation(notation: string): string[] {
    if (!notation.includes(',')) {
      return [notation];
    }

    const ranges: string[] = [];
    let current = '';
    let inQuotes = false;

    for (const char of notation) {
      if (char === "'" && !inQuotes) {
        inQuotes = true;
        current += char;
      } else if (char === "'" && inQuotes) {
        inQuotes = false;
        current += char;
      } else if (char === ',' && !inQuotes) {
        if (current.trim()) {
          ranges.push(current.trim());
        }
        current = '';
      } else {
        current += char;
      }
    }
    if (current.trim()) {
      ranges.push(current.trim());
    }

    return ranges;
  }
}
