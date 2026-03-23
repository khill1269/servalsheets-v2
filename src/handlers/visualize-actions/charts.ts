import { ErrorCodes } from '../error-codes.js';
import type { sheets_v4 } from 'googleapis';
import type { HandlerContext } from '../base.js';
import type {
  ChartAddTrendlineInput,
  ChartCreateInput,
  ChartDeleteInput,
  ChartGetInput,
  ChartListInput,
  ChartMoveInput,
  ChartRemoveTrendlineInput,
  ChartResizeInput,
  ChartUpdateDataRangeInput,
  ChartUpdateInput,
  VisualizeResponse,
} from '../../schemas/visualize.js';
import type { ErrorDetail, MutationSummary, RangeInput } from '../../schemas/shared.js';
import {
  parseCellReference,
  toGridRange as toApiGridRange,
  type GridRangeInput,
} from '../../utils/google-sheets-helpers.js';
import { confirmDestructiveAction } from '../../mcp/elicitation.js';
import { createSnapshotIfNeeded } from '../../utils/safety-helpers.js';
import { logger } from '../../utils/logger.js';
import { recordChartId } from '../../mcp/completions.js';

const BASIC_CHART_TYPES = [
  'BAR',
  'LINE',
  'AREA',
  'COMBO',
  'STEPPED_AREA',
  'COLUMN',
  'SCATTER',
] as const;

const ELICITABLE_CHART_TYPES = [
  ...BASIC_CHART_TYPES,
  'PIE',
  'DOUGHNUT',
  'BUBBLE',
  'CANDLESTICK',
  'HISTOGRAM',
  'ORG',
  'TREEMAP',
  'WATERFALL',
  'SCORECARD',
] as const;
type ElicitableChartType = (typeof ELICITABLE_CHART_TYPES)[number];

function isElicitableChartType(value: unknown): value is ElicitableChartType {
  return typeof value === 'string' && (ELICITABLE_CHART_TYPES as readonly string[]).includes(value);
}

function isBasicChartType(value: unknown): value is (typeof BASIC_CHART_TYPES)[number] {
  return typeof value === 'string' && (BASIC_CHART_TYPES as readonly string[]).includes(value);
}

/**
 * Extended BasicChartSeries type that includes trendline and dataLabel properties.
 * These properties exist in the Google Sheets API but are missing from googleapis type definitions.
 */
interface ExtendedBasicChartSeries extends sheets_v4.Schema$BasicChartSeries {
  trendline?: {
    type?: string;
    label?: string;
    showR2?: boolean;
    labeledDataKey?: string;
    polynomialDegree?: number;
    color?: sheets_v4.Schema$Color;
  };
  dataLabel?: {
    type?: string;
    placement?: string;
    textFormat?: sheets_v4.Schema$TextFormat;
  };
}

interface ChartsDeps {
  sheetsApi: sheets_v4.Sheets;
  context: HandlerContext;
  toGridRange: (spreadsheetId: string, rangeInput: RangeInput) => Promise<GridRangeInput>;
  resolveSheetId: (spreadsheetId: string, sheetName?: string) => Promise<number>;
  success: (
    action: string,
    data: Record<string, unknown>,
    mutation?: MutationSummary,
    dryRun?: boolean
  ) => VisualizeResponse;
  error: (error: ErrorDetail) => VisualizeResponse;
  notFoundError: (resourceType: string, resourceId: string | number) => VisualizeResponse;
}

function buildSingleColumnChartData(
  dataRange: GridRangeInput,
  columnIndex: number
): sheets_v4.Schema$ChartData {
  return {
    sourceRange: {
      sources: [
        {
          ...toApiGridRange(dataRange),
          startColumnIndex: (dataRange.startColumnIndex ?? 0) + columnIndex,
          endColumnIndex: (dataRange.startColumnIndex ?? 0) + columnIndex + 1,
        },
      ],
    },
  };
}

function inferChartType(spec?: sheets_v4.Schema$ChartSpec): ElicitableChartType {
  if (spec?.basicChart?.chartType && isElicitableChartType(spec.basicChart.chartType)) {
    return spec.basicChart.chartType;
  }

  if (spec?.bubbleChart) {
    return 'BUBBLE';
  }
  if (spec?.candlestickChart) {
    return 'CANDLESTICK';
  }
  if (spec?.histogramChart) {
    return 'HISTOGRAM';
  }
  if (spec?.orgChart) {
    return 'ORG';
  }
  if (spec?.pieChart) {
    return spec.pieChart.pieHole && spec.pieChart.pieHole > 0 ? 'DOUGHNUT' : 'PIE';
  }
  if (spec?.scorecardChart) {
    return 'SCORECARD';
  }
  if (spec?.treemapChart) {
    return 'TREEMAP';
  }
  if (spec?.waterfallChart) {
    return 'WATERFALL';
  }

  return 'BAR';
}

function buildChartBackground(
  options?: ChartCreateInput['options']
): Pick<sheets_v4.Schema$ChartSpec, 'backgroundColor' | 'backgroundColorStyle'> {
  const backgroundColorStyle =
    options?.backgroundColorStyle ??
    (options?.backgroundColor ? { rgbColor: options.backgroundColor } : undefined);
  const backgroundColor =
    options?.backgroundColor ??
    (backgroundColorStyle && 'rgbColor' in backgroundColorStyle
      ? backgroundColorStyle.rgbColor
      : undefined);

  if (!backgroundColorStyle && !backgroundColor) {
    return {}; // OK: no background color defined
  }

  return {
    backgroundColor,
    backgroundColorStyle,
  };
}

export async function handleChartCreateAction(
  input: ChartCreateInput,
  deps: ChartsDeps
): Promise<VisualizeResponse> {
  // Elicitation wizard: ask for chart type and title when absent
  let resolvedInput = input;
  if (!input.chartType && deps.context.server) {
    try {
      const elicitResult = await deps.context.server.elicitInput({
        mode: 'form',
        message: 'Step 1/2: Configure your chart',
        requestedSchema: {
          type: 'object',
          properties: {
            chartType: {
              type: 'string',
              title: 'Chart type',
              description:
                'Choose the type of chart to create. Basic: BAR (horizontal bars), LINE (trend over time), PIE (proportions), COLUMN (vertical bars), SCATTER (correlation), AREA (cumulative trend). Advanced: COMBO (mixed bar+line), STEPPED_AREA (staircase area), DOUGHNUT (pie with hole), BUBBLE (3-variable scatter), CANDLESTICK (stock price OHLC), HISTOGRAM (frequency distribution), ORG (hierarchy/org chart), TREEMAP (hierarchical rectangles), WATERFALL (running total with positive/negative), SCORECARD (single KPI metric display)',
              enum: [
                'BAR',
                'LINE',
                'PIE',
                'COLUMN',
                'SCATTER',
                'AREA',
                'COMBO',
                'STEPPED_AREA',
                'DOUGHNUT',
                'BUBBLE',
                'CANDLESTICK',
                'HISTOGRAM',
                'ORG',
                'TREEMAP',
                'WATERFALL',
                'SCORECARD',
              ],
              default: 'BAR',
            },
          },
          required: ['chartType'],
        },
      });
      if (elicitResult.action === 'accept' && elicitResult.content?.['chartType']) {
        const chartType = elicitResult.content['chartType'];
        if (isElicitableChartType(chartType)) {
          resolvedInput = { ...input, chartType };
        }

        // Step 2: Ask for chart title
        try {
          const titleResult = await deps.context.server.elicitInput({
            mode: 'form',
            message: 'Step 2/2: Chart title (optional)',
            requestedSchema: {
              type: 'object',
              properties: {
                chartTitle: {
                  type: 'string',
                  title: 'Chart title',
                  description: 'Optional title for the chart',
                },
              },
            },
          });
          if (titleResult.action === 'accept' && titleResult.content?.['chartTitle']) {
            const chartTitle = titleResult.content['chartTitle'] as string;
            resolvedInput = {
              ...resolvedInput,
              options: { ...resolvedInput.options, title: chartTitle },
            };
          }
        } catch {
          // non-blocking - title is optional
        }
      }
    } catch {
      // non-blocking - proceed with BAR default
    }
    if (!resolvedInput.chartType) {
      resolvedInput = { ...resolvedInput, chartType: 'BAR' };
    }
  }

  if (!resolvedInput.data?.sourceRange) {
    return deps.error({
      code: 'INVALID_PARAMS',
      message:
        'chart_create requires data.sourceRange. Example: { "data": { "sourceRange": "Sheet1!A1:B10" } }. Top-level "sourceRange" or "dataRange" fields are not supported — wrap in a "data" object.',
      retryable: false,
    });
  }

  // Idempotency guard: check if a chart with the same title already exists on the target sheet
  try {
    const existing = await deps.sheetsApi.spreadsheets.get({
      spreadsheetId: resolvedInput.spreadsheetId,
      fields: 'sheets.charts,sheets.properties.sheetId',
    });

    const targetSheetId = resolvedInput.position.sheetId;
    const chartTitle = resolvedInput.options?.title;

    if (chartTitle) {
      for (const sheet of existing.data.sheets ?? []) {
        if (sheet.properties?.sheetId === targetSheetId) {
          const duplicate = sheet.charts?.find((c) => c.spec?.title === chartTitle);
          if (duplicate && duplicate.chartId !== undefined) {
            return deps.success('chart_create', {
              chartId: duplicate.chartId,
              _idempotent: true,
              _hint: `Chart "${chartTitle}" already exists on this sheet. Returning existing chart instead of creating a duplicate.`,
            });
          }
          break;
        }
      }
    }
  } catch {
    // Non-blocking: proceed with creation if lookup fails
  }

  const dataRange = await deps.toGridRange(
    resolvedInput.spreadsheetId,
    resolvedInput.data.sourceRange
  );
  const position = await toOverlayPosition(
    deps,
    resolvedInput.spreadsheetId,
    resolvedInput.position.anchorCell,
    resolvedInput.position
  );

  // Route to appropriate chart spec builder based on chart type
  const chartSpec = buildChartSpec(
    dataRange,
    resolvedInput.chartType,
    resolvedInput.data,
    resolvedInput.options
  );

  const response = await deps.sheetsApi.spreadsheets.batchUpdate({
    spreadsheetId: resolvedInput.spreadsheetId,
    requestBody: {
      requests: [
        {
          addChart: {
            chart: {
              spec: chartSpec,
              position,
            },
          },
        },
      ],
    },
  });

  const chartId = response.data?.replies?.[0]?.addChart?.chart?.chartId ?? undefined;

  // Wire session context: record chart creation with chartId for follow-up operations
  try {
    if (deps.context.sessionContext && chartId !== undefined) {
      deps.context.sessionContext.recordOperation({
        tool: 'sheets_visualize',
        action: 'chart_create',
        spreadsheetId: resolvedInput.spreadsheetId,
        description: `Created ${resolvedInput.chartType} chart (chartId: ${chartId}) from ${resolvedInput.data.sourceRange}`,
        undoable: true,
        cellsAffected: 0,
      });
    }
  } catch {
    /* non-blocking */
  }

  return deps.success('chart_create', { chartId });
}

export async function handleChartUpdateAction(
  input: ChartUpdateInput,
  deps: ChartsDeps
): Promise<VisualizeResponse> {
  const requests: sheets_v4.Schema$Request[] = [];

  // If updating chart spec properties (title, chartType), we need to fetch and merge with existing spec
  if (input.chartType || input.options?.title) {
    // Fetch existing chart to get current spec
    const getResponse = await deps.sheetsApi.spreadsheets.get({
      spreadsheetId: input.spreadsheetId,
      fields: 'sheets.charts',
    });

    let existingSpec: sheets_v4.Schema$ChartSpec | undefined;
    for (const sheet of getResponse.data.sheets || []) {
      const chart = sheet.charts?.find((c) => c.chartId === input.chartId);
      if (chart?.spec) {
        existingSpec = chart.spec;
        break;
      }
    }

    if (!existingSpec) {
      return deps.error({
        code: ErrorCodes.RANGE_NOT_FOUND,
        message: `Chart with ID ${input.chartId} not found`,
        retryable: false,
        suggestedFix: 'Verify the range reference is correct and the sheet exists',
      });
    }

    // Merge updates into existing spec
    const updatedSpec = { ...existingSpec };
    if (input.options?.title) {
      updatedSpec.title = input.options.title;
    }
    if (input.chartType && !isBasicChartType(input.chartType)) {
      return deps.error({
        code: ErrorCodes.INVALID_PARAMS,
        message: `chart_update only supports switching among basic chart types. Recreate the chart to change to ${input.chartType}.`,
        retryable: false,
        suggestedFix:
          'Use chart_create with the target chart type, then delete the old chart if needed',
      });
    }
    if (input.chartType && !updatedSpec.basicChart) {
      return deps.error({
        code: ErrorCodes.INVALID_PARAMS,
        message: 'chart_update can only change chartType for existing basic charts',
        retryable: false,
        suggestedFix: 'Recreate the chart when switching between chart families',
      });
    }
    if (input.chartType && updatedSpec.basicChart) {
      updatedSpec.basicChart = { ...updatedSpec.basicChart, chartType: input.chartType };
    }

    requests.push({
      updateChartSpec: {
        chartId: input.chartId,
        spec: updatedSpec,
      },
    });
  }

  if (input.position) {
    const position = await toOverlayPosition(
      deps,
      input.spreadsheetId,
      input.position.anchorCell,
      input.position
    );
    requests.push({
      updateEmbeddedObjectPosition: {
        objectId: input.chartId,
        newPosition: position,
        fields: 'overlayPosition',
      },
    });
  }

  if (requests.length === 0) {
    return deps.success('chart_update', {});
  }

  await deps.sheetsApi.spreadsheets.batchUpdate({
    spreadsheetId: input.spreadsheetId,
    requestBody: { requests },
  });

  // Record operation in session context for LLM follow-up references
  try {
    if (deps.context.sessionContext) {
      deps.context.sessionContext.recordOperation({
        tool: 'sheets_visualize',
        action: 'chart_update',
        spreadsheetId: input.spreadsheetId,
        description: `Updated chart (chartId: ${input.chartId})`,
        undoable: false,
      });
    }
  } catch {
    // Non-blocking: session context recording is best-effort
  }

  return deps.success('chart_update', {});
}

export async function handleChartDeleteAction(
  input: ChartDeleteInput,
  deps: ChartsDeps
): Promise<VisualizeResponse> {
  if (input.safety?.dryRun) {
    return deps.success('chart_delete', {}, undefined, true);
  }

  // Request confirmation if elicitation available
  if (deps.context.elicitationServer) {
    const confirmation = await confirmDestructiveAction(
      deps.context.elicitationServer,
      'chart_delete',
      `Delete chart (ID: ${input.chartId}) from spreadsheet ${input.spreadsheetId}. This action cannot be undone.`
    );

    if (!confirmation.confirmed) {
      return deps.error({
        code: ErrorCodes.PRECONDITION_FAILED,
        message: confirmation.reason || 'User cancelled the operation',
        retryable: false,
        suggestedFix: 'Review the operation requirements and try again',
      });
    }
  }

  // Create snapshot if requested
  const snapshot = await createSnapshotIfNeeded(
    deps.context.snapshotService,
    {
      operationType: 'chart_delete',
      isDestructive: true,
      spreadsheetId: input.spreadsheetId,
    },
    input.safety
  );

  await deps.sheetsApi.spreadsheets.batchUpdate({
    spreadsheetId: input.spreadsheetId,
    requestBody: {
      requests: [
        {
          deleteEmbeddedObject: {
            objectId: input.chartId,
          },
        },
      ],
    },
  });

  return deps.success('chart_delete', {
    snapshotId: snapshot?.snapshotId,
  });
}

export async function handleChartListAction(
  input: ChartListInput,
  deps: ChartsDeps
): Promise<VisualizeResponse> {
  const response = await deps.sheetsApi.spreadsheets.get({
    spreadsheetId: input.spreadsheetId,
    fields: 'sheets.charts,sheets.properties.sheetId',
  });

  const charts: Array<{
    chartId: number;
    chartType: ElicitableChartType;
    sheetId: number;
    title?: string;
    position: {
      anchorCell: string;
      offsetX: number;
      offsetY: number;
      width: number;
      height: number;
    };
  }> = [];

  for (const sheet of response.data.sheets ?? []) {
    const sheetId = sheet.properties?.sheetId ?? 0;
    if (input.sheetId !== undefined && sheetId !== input.sheetId) continue;

    for (const chart of sheet.charts ?? []) {
      const overlay = chart.position?.overlayPosition;
      charts.push({
        chartId: chart.chartId ?? 0,
        chartType: inferChartType(chart.spec),
        sheetId,
        title: chart.spec?.title ?? undefined,
        position: {
          anchorCell: overlay?.anchorCell
            ? formatAnchorCell(overlay.anchorCell)
            : `${columnToLetter(0)}1`,
          offsetX: overlay?.offsetXPixels ?? 0,
          offsetY: overlay?.offsetYPixels ?? 0,
          width: overlay?.widthPixels ?? 600,
          height: overlay?.heightPixels ?? 400,
        },
      });
    }
  }

  // Wire completions: cache chart IDs for argument autocompletion (ISSUE-062)
  for (const chart of charts) {
    if (chart.chartId) recordChartId(chart.chartId);
  }

  return deps.success('chart_list', { charts });
}

export async function handleChartGetAction(
  input: ChartGetInput,
  deps: ChartsDeps
): Promise<VisualizeResponse> {
  const response = await deps.sheetsApi.spreadsheets.get({
    spreadsheetId: input.spreadsheetId,
    fields: 'sheets.charts',
  });

  for (const sheet of response.data.sheets ?? []) {
    for (const chart of sheet.charts ?? []) {
      if (chart.chartId === input.chartId) {
        const overlay = chart.position?.overlayPosition;
        return deps.success('chart_get', {
          charts: [
            {
              chartId: chart.chartId ?? 0,
              chartType: inferChartType(chart.spec),
              sheetId: overlay?.anchorCell?.sheetId ?? 0,
              title: chart.spec?.title ?? undefined,
              position: {
                anchorCell: overlay?.anchorCell
                  ? formatAnchorCell(overlay.anchorCell)
                  : `${columnToLetter(0)}1`,
                offsetX: overlay?.offsetXPixels ?? 0,
                offsetY: overlay?.offsetYPixels ?? 0,
                width: overlay?.widthPixels ?? 600,
                height: overlay?.heightPixels ?? 400,
              },
            },
          ],
        });
      }
    }
  }

  return deps.notFoundError('Chart', input.chartId);
}

export async function handleChartMoveAction(
  input: ChartMoveInput,
  deps: ChartsDeps
): Promise<VisualizeResponse> {
  const position = await toOverlayPosition(
    deps,
    input.spreadsheetId,
    input.position.anchorCell,
    input.position
  );

  await deps.sheetsApi.spreadsheets.batchUpdate({
    spreadsheetId: input.spreadsheetId,
    requestBody: {
      requests: [
        {
          updateEmbeddedObjectPosition: {
            objectId: input.chartId,
            newPosition: position,
            fields: 'overlayPosition',
          },
        },
      ],
    },
  });

  return deps.success('chart_move', {});
}

export async function handleChartResizeAction(
  input: ChartResizeInput,
  deps: ChartsDeps
): Promise<VisualizeResponse> {
  // BUG-4 fix: Only update width/height fields to avoid resetting position.
  // Use specific field mask to tell Google API which sub-fields to update.
  const currentPosition = await fetchChartPosition(deps, input.spreadsheetId, input.chartId);

  await deps.sheetsApi.spreadsheets.batchUpdate({
    spreadsheetId: input.spreadsheetId,
    requestBody: {
      requests: [
        {
          updateEmbeddedObjectPosition: {
            objectId: input.chartId,
            newPosition: {
              overlayPosition: {
                anchorCell: currentPosition.anchorCell,
                offsetXPixels: currentPosition.offsetX,
                offsetYPixels: currentPosition.offsetY,
                widthPixels: input.width,
                heightPixels: input.height,
              },
            },
            fields:
              'overlayPosition(anchorCell,offsetXPixels,offsetYPixels,widthPixels,heightPixels)',
          },
        },
      ],
    },
  });

  return deps.success('chart_resize', {});
}

export async function handleChartUpdateDataRangeAction(
  input: ChartUpdateDataRangeInput,
  deps: ChartsDeps
): Promise<VisualizeResponse> {
  // Fetch existing chart spec to preserve axis configuration
  const getResponse = await deps.sheetsApi.spreadsheets.get({
    spreadsheetId: input.spreadsheetId,
    fields: 'sheets.charts',
  });

  let existingChart: sheets_v4.Schema$EmbeddedChart | undefined;
  for (const sheet of getResponse.data.sheets ?? []) {
    const chart = sheet.charts?.find((c) => c.chartId === input.chartId);
    if (chart) {
      existingChart = chart;
      break;
    }
  }

  if (!existingChart?.spec?.basicChart) {
    return deps.error({
      code: ErrorCodes.INVALID_PARAMS,
      message: `Chart with ID ${input.chartId} not found or is not a basic chart type`,
      retryable: false,
      suggestedFix: 'Check the parameter format and ensure all required parameters are provided',
    });
  }

  const dataRange = await deps.toGridRange(input.spreadsheetId, input.data.sourceRange);
  const toGridRangeHelper = toApiGridRange(dataRange);

  // Update data ranges while preserving existing chart configuration
  const domainColumn = input.data.categories ?? 0;
  const newDomainRange: sheets_v4.Schema$GridRange = {
    ...toGridRangeHelper,
    startColumnIndex: (dataRange.startColumnIndex ?? 0) + domainColumn,
    endColumnIndex: (dataRange.startColumnIndex ?? 0) + domainColumn + 1,
  };

  const newSeriesRanges =
    input.data.series && input.data.series.length > 0
      ? input.data.series.map((s) => ({
          ...toGridRangeHelper,
          startColumnIndex: (dataRange.startColumnIndex ?? 0) + s.column,
          endColumnIndex: (dataRange.startColumnIndex ?? 0) + s.column + 1,
        }))
      : [
          {
            ...toGridRangeHelper,
            startColumnIndex: (dataRange.startColumnIndex ?? 0) + 1,
            endColumnIndex: (dataRange.startColumnIndex ?? 0) + 2,
          },
        ];

  // Preserve existing axis titles, labels, and domain/series assignment
  const existingSeries = existingChart.spec.basicChart.series ?? [];
  const updatedSeries = newSeriesRanges.map((range, idx) => {
    const existingSeriesData = existingSeries[idx];
    return {
      ...existingSeriesData,
      series: { sourceRange: { sources: [range] } },
    };
  });

  if (input.safety?.dryRun) {
    return deps.success('chart_update_data_range', {}, undefined, true);
  }

  const updatedSpec: sheets_v4.Schema$ChartSpec = {
    ...existingChart.spec,
    basicChart: {
      ...existingChart.spec.basicChart,
      domains: [
        {
          domain: {
            sourceRange: { sources: [newDomainRange] },
          },
        },
      ],
      series: updatedSeries,
    },
  };

  await deps.sheetsApi.spreadsheets.batchUpdate({
    spreadsheetId: input.spreadsheetId,
    requestBody: {
      requests: [
        {
          updateChartSpec: {
            chartId: input.chartId,
            spec: updatedSpec,
          },
        },
      ],
    },
  });

  return deps.success('chart_update_data_range', {});
}

export async function handleChartAddTrendlineAction(
  input: ChartAddTrendlineInput,
  deps: ChartsDeps
): Promise<VisualizeResponse> {
  // Trendlines are only supported on certain chart types
  const compatibleTypes = ['LINE', 'AREA', 'SCATTER', 'STEPPED_AREA', 'COLUMN'];

  // Fetch existing chart spec
  const getResponse = await deps.sheetsApi.spreadsheets.get({
    spreadsheetId: input.spreadsheetId,
    fields: 'sheets.charts',
  });

  let existingChart: sheets_v4.Schema$EmbeddedChart | undefined;
  for (const sheet of getResponse.data.sheets ?? []) {
    const chart = sheet.charts?.find((c) => c.chartId === input.chartId);
    if (chart) {
      existingChart = chart;
      break;
    }
  }

  if (!existingChart?.spec?.basicChart) {
    return deps.error({
      code: ErrorCodes.INVALID_PARAMS,
      message: `Chart with ID ${input.chartId} not found or is not a basic chart type`,
      retryable: false,
      suggestedFix: 'Check the parameter format and ensure all required parameters are provided',
    });
  }

  const chartType = existingChart.spec.basicChart.chartType ?? '';
  if (!compatibleTypes.includes(chartType)) {
    return deps.error({
      code: ErrorCodes.INVALID_PARAMS,
      message: `Trendlines are not supported on ${chartType} charts. Use LINE, AREA, SCATTER, STEPPED_AREA, or COLUMN charts.`,
      retryable: false,
      suggestedFix: 'Check the parameter format and ensure all required parameters are provided',
    });
  }

  const series = [...(existingChart.spec.basicChart.series ?? [])] as ExtendedBasicChartSeries[];
  if (input.seriesIndex >= series.length) {
    return deps.error({
      code: ErrorCodes.INVALID_PARAMS,
      message: `Series index ${input.seriesIndex} out of range. Chart has ${series.length} series.`,
      retryable: false,
      suggestedFix: 'Check the parameter format and ensure all required parameters are provided',
    });
  }

  // ISSUE-182: Warn that chart_add_trendline may not work via REST API
  logger.warn(
    'chart_add_trendline called - REST API trendline support is limited; may fail with FEATURE_UNAVAILABLE',
    {
      chartId: input.chartId,
      spreadsheetId: input.spreadsheetId,
    }
  );

  if (input.safety?.dryRun) {
    return deps.success(
      'chart_add_trendline',
      {
        chartId: input.chartId,
        _deprecationWarning:
          'chart_add_trendline may be unsupported via REST API. If it fails, add trendlines manually in the Sheets UI or use chart_update with a trendline spec.',
      },
      undefined,
      true
    );
  }

  // Build trendline spec (googleapis types don't include trendline, but the API supports it)
  const trendlineSpec: ExtendedBasicChartSeries['trendline'] = {
    type: input.trendline.type,
    label: input.trendline.label,
    showR2: input.trendline.showRSquared,
    labeledDataKey: input.trendline.showEquation ? 'FORMULA' : undefined,
  };

  // Add polynomial degree if applicable
  if (input.trendline.type === 'POLYNOMIAL' && input.trendline.polynomialDegree) {
    trendlineSpec.polynomialDegree = input.trendline.polynomialDegree;
  }

  // Add color if specified
  if (input.trendline.color) {
    trendlineSpec.color = {
      red: input.trendline.color.red,
      green: input.trendline.color.green,
      blue: input.trendline.color.blue,
      alpha: input.trendline.color.alpha,
    };
  }

  // Update series with trendline
  series[input.seriesIndex] = {
    ...series[input.seriesIndex],
    trendline: trendlineSpec,
  };

  // Update the chart spec
  // NOTE: The Google Sheets REST API v4 has limited support for the trendline field.
  // The field exists in the internal API but may not be accepted via batchUpdate.
  // If the API rejects the trendline field, we return a helpful error.
  try {
    await deps.sheetsApi.spreadsheets.batchUpdate({
      spreadsheetId: input.spreadsheetId,
      requestBody: {
        requests: [
          {
            updateChartSpec: {
              chartId: input.chartId,
              spec: {
                ...existingChart.spec,
                basicChart: {
                  ...existingChart.spec.basicChart,
                  series,
                },
              },
            },
          },
        ],
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('trendline') || message.includes('Unknown name')) {
      return deps.error({
        code: ErrorCodes.FEATURE_UNAVAILABLE,
        message:
          'Trendlines cannot be added programmatically via the Google Sheets REST API. ' +
          'This is a Google API limitation. Add trendlines manually via the Google Sheets UI: ' +
          'Chart menu -> Customize -> Series -> Trendline.',
        retryable: false,
        suggestedFix: 'Add the trendline manually in the Google Sheets chart editor',
      });
    }
    throw error;
  }

  return deps.success('chart_add_trendline', {
    chartId: input.chartId,
    _deprecationWarning:
      'chart_add_trendline may be unsupported via REST API. If it fails, add trendlines manually in the Sheets UI or use chart_update with a trendline spec.',
  });
}

export async function handleChartRemoveTrendlineAction(
  input: ChartRemoveTrendlineInput,
  deps: ChartsDeps
): Promise<VisualizeResponse> {
  // Fetch existing chart spec
  const getResponse = await deps.sheetsApi.spreadsheets.get({
    spreadsheetId: input.spreadsheetId,
    fields: 'sheets.charts',
  });

  let existingChart: sheets_v4.Schema$EmbeddedChart | undefined;
  for (const sheet of getResponse.data.sheets ?? []) {
    const chart = sheet.charts?.find((c) => c.chartId === input.chartId);
    if (chart) {
      existingChart = chart;
      break;
    }
  }

  if (!existingChart?.spec?.basicChart) {
    return deps.error({
      code: ErrorCodes.INVALID_PARAMS,
      message: `Chart with ID ${input.chartId} not found or is not a basic chart type`,
      retryable: false,
      suggestedFix: 'Check the parameter format and ensure all required parameters are provided',
    });
  }

  // Cast to extended type (googleapis types don't include trendline, but the API supports it)
  const series = [...(existingChart.spec.basicChart.series ?? [])] as ExtendedBasicChartSeries[];
  if (input.seriesIndex >= series.length) {
    return deps.error({
      code: ErrorCodes.INVALID_PARAMS,
      message: `Series index ${input.seriesIndex} out of range. Chart has ${series.length} series.`,
      retryable: false,
      suggestedFix: 'Check the parameter format and ensure all required parameters are provided',
    });
  }

  if (!series[input.seriesIndex]?.trendline) {
    return deps.error({
      code: ErrorCodes.NOT_FOUND,
      message: `No trendline found on series ${input.seriesIndex}`,
      retryable: false,
      suggestedFix: 'Verify the spreadsheet ID is correct and you have access to it',
    });
  }

  if (input.safety?.dryRun) {
    return deps.success('chart_remove_trendline', { chartId: input.chartId }, undefined, true);
  }

  // Remove trendline from series
  series[input.seriesIndex] = {
    ...series[input.seriesIndex],
    trendline: undefined,
  };

  // Update the chart spec
  await deps.sheetsApi.spreadsheets.batchUpdate({
    spreadsheetId: input.spreadsheetId,
    requestBody: {
      requests: [
        {
          updateChartSpec: {
            chartId: input.chartId,
            spec: {
              ...existingChart.spec,
              basicChart: {
                ...existingChart.spec.basicChart,
                series,
              },
            },
          },
        },
      ],
    },
  });

  return deps.success('chart_remove_trendline', { chartId: input.chartId });
}

function buildBasicChartSpec(
  dataRange: GridRangeInput,
  chartType: sheets_v4.Schema$BasicChartSpec['chartType'] | undefined,
  data: ChartCreateInput['data'],
  options?: ChartCreateInput['options']
): sheets_v4.Schema$ChartSpec {
  const domainColumn = data.categories ?? 0;
  const domainRange: sheets_v4.Schema$GridRange = {
    ...toApiGridRange(dataRange),
    startColumnIndex: (dataRange.startColumnIndex ?? 0) + domainColumn,
    endColumnIndex: (dataRange.startColumnIndex ?? 0) + domainColumn + 1,
  };

  const seriesRanges =
    data.series && data.series.length > 0
      ? data.series.map((s) => ({
          ...toApiGridRange(dataRange),
          startColumnIndex: (dataRange.startColumnIndex ?? 0) + s.column,
          endColumnIndex: (dataRange.startColumnIndex ?? 0) + s.column + 1,
        }))
      : [
          {
            ...toApiGridRange(dataRange),
            startColumnIndex: (dataRange.startColumnIndex ?? 0) + 1,
            endColumnIndex: (dataRange.startColumnIndex ?? 0) + 2,
          },
        ];

  return {
    title: options?.title,
    ...buildChartBackground(options),
    basicChart: {
      chartType: chartType ?? 'BAR',
      headerCount: 1,
      domains: [
        {
          domain: {
            sourceRange: { sources: [domainRange] },
          },
        },
      ],
      // Use extended type to support trendline/dataLabel (googleapis types are incomplete)
      series: seriesRanges.map((range, idx) => {
        const seriesData = data.series?.[idx];
        const result: ExtendedBasicChartSeries = {
          series: { sourceRange: { sources: [range] } },
          // BAR charts require BOTTOM_AXIS, all others use LEFT_AXIS
          targetAxis: chartType === 'BAR' ? 'BOTTOM_AXIS' : 'LEFT_AXIS',
          color:
            seriesData?.color ??
            (seriesData?.colorStyle && 'rgbColor' in seriesData.colorStyle
              ? seriesData.colorStyle.rgbColor
              : undefined),
          colorStyle:
            seriesData?.colorStyle ??
            (seriesData?.color ? { rgbColor: seriesData.color } : undefined),
        };

        // Add trendline if configured (only for compatible chart types)
        if (
          seriesData?.trendline &&
          chartType &&
          ['LINE', 'AREA', 'SCATTER', 'STEPPED_AREA', 'COLUMN'].includes(chartType)
        ) {
          result.trendline = {
            type: seriesData.trendline.type,
            label: seriesData.trendline.label,
            showR2: seriesData.trendline.showRSquared,
            labeledDataKey: seriesData.trendline.showEquation ? 'FORMULA' : undefined,
            polynomialDegree:
              seriesData.trendline.type === 'POLYNOMIAL'
                ? seriesData.trendline.polynomialDegree
                : undefined,
            color: seriesData.trendline.color,
          };
        }

        // Add data label if configured
        if (seriesData?.dataLabel && seriesData.dataLabel.type !== 'NONE') {
          result.dataLabel = {
            type: seriesData.dataLabel.type,
            placement: seriesData.dataLabel.placement,
            textFormat: seriesData.dataLabel.textFormat,
          };
        }

        return result;
      }),
      legendPosition: options?.legendPosition,
      threeDimensional: options?.is3D,
      // stackedType only supported for BAR, COLUMN, AREA, STEPPED_AREA charts
      ...(chartType && ['BAR', 'COLUMN', 'AREA', 'STEPPED_AREA'].includes(chartType)
        ? { stackedType: options?.stacked ? 'STACKED' : 'NOT_STACKED' }
        : {}),
      // ISSUE-198: Axis configuration — title and view window (min/max bounds)
      // Merge legacy axisTitle with new axes config; axes takes precedence for titles
      ...(() => {
        const axisList: sheets_v4.Schema$BasicChartAxis[] = [];

        const hTitle = options?.axes?.horizontal?.title ?? options?.axisTitle?.horizontal;
        const vTitle = options?.axes?.vertical?.title ?? options?.axisTitle?.vertical;
        const hMin = options?.axes?.horizontal?.min;
        const hMax = options?.axes?.horizontal?.max;
        const vMin = options?.axes?.vertical?.min;
        const vMax = options?.axes?.vertical?.max;

        // For BAR charts, horizontal axis maps to BOTTOM_AXIS; for others, LEFT_AXIS is vertical
        const hPosition = chartType === 'BAR' ? 'LEFT_AXIS' : 'BOTTOM_AXIS';
        const vPosition = chartType === 'BAR' ? 'BOTTOM_AXIS' : 'LEFT_AXIS';

        // The googleapis Schema$BasicChartAxis type is incomplete — viewWindowMode and
        // viewWindow exist in the API but are missing from the TS types. Cast to any for
        // these properties while keeping position and title type-safe.
        type FullAxis = sheets_v4.Schema$BasicChartAxis & {
          viewWindowMode?: string;
          viewWindow?: { minValue?: number; maxValue?: number };
        };

        if (hTitle !== undefined || hMin !== undefined || hMax !== undefined) {
          const hAxis: FullAxis = { position: hPosition };
          if (hTitle) hAxis.title = hTitle;
          if (hMin !== undefined || hMax !== undefined) {
            hAxis.viewWindowMode = 'EXPLICIT';
            hAxis.viewWindow = { minValue: hMin, maxValue: hMax };
          }
          axisList.push(hAxis as sheets_v4.Schema$BasicChartAxis);
        }

        if (vTitle !== undefined || vMin !== undefined || vMax !== undefined) {
          const vAxis: FullAxis = { position: vPosition };
          if (vTitle) vAxis.title = vTitle;
          if (vMin !== undefined || vMax !== undefined) {
            vAxis.viewWindowMode = 'EXPLICIT';
            vAxis.viewWindow = { minValue: vMin, maxValue: vMax };
          }
          axisList.push(vAxis as sheets_v4.Schema$BasicChartAxis);
        }

        return axisList.length > 0 ? { axis: axisList } : {};
      })(),
    },
  };
}

/**
 * Route chart creation to appropriate spec builder based on chart type.
 * PIE/DOUGHNUT/TREEMAP/HISTOGRAM/SCORECARD/WATERFALL/CANDLESTICK need specific specs.
 * BAR/LINE/AREA/COLUMN/SCATTER/COMBO/STEPPED_AREA use BasicChartSpec.
 */
function buildChartSpec(
  dataRange: GridRangeInput,
  chartType: string | undefined,
  data: ChartCreateInput['data'],
  options?: ChartCreateInput['options']
): sheets_v4.Schema$ChartSpec {
  const title = options?.title;
  const gridRange = toApiGridRange(dataRange);

  switch (chartType) {
    case 'PIE':
    case 'DOUGHNUT':
      return {
        title,
        ...buildChartBackground(options),
        pieChart: {
          domain: {
            sourceRange: {
              sources: [
                {
                  ...gridRange,
                  startColumnIndex: (dataRange.startColumnIndex ?? 0) + (data.categories ?? 0),
                  endColumnIndex: (dataRange.startColumnIndex ?? 0) + (data.categories ?? 0) + 1,
                },
              ],
            },
          },
          series: {
            sourceRange: {
              sources: [
                {
                  ...gridRange,
                  startColumnIndex:
                    (dataRange.startColumnIndex ?? 0) + (data.series?.[0]?.column ?? 1),
                  endColumnIndex:
                    (dataRange.startColumnIndex ?? 0) + (data.series?.[0]?.column ?? 1) + 1,
                },
              ],
            },
          },
          threeDimensional: options?.is3D,
          pieHole: chartType === 'DOUGHNUT' ? (options?.pieHole ?? 0.5) : 0,
          legendPosition: options?.legendPosition,
        },
      };

    case 'HISTOGRAM':
      return {
        title,
        ...buildChartBackground(options),
        histogramChart: {
          series: [
            {
              data: { sourceRange: { sources: [gridRange] } },
            },
          ],
          legendPosition: options?.legendPosition,
        },
      };

    case 'SCORECARD':
      return {
        title,
        ...buildChartBackground(options),
        scorecardChart: {
          keyValueData: {
            sourceRange: { sources: [gridRange] },
          },
          aggregateType: 'SUM',
        },
      };

    case 'WATERFALL':
      return {
        title,
        ...buildChartBackground(options),
        waterfallChart: {
          domain: { data: { sourceRange: { sources: [gridRange] } } },
          series: [{ data: { sourceRange: { sources: [gridRange] } } }],
          connectorLineStyle: { type: 'SOLID' },
        },
      };

    case 'CANDLESTICK':
      return {
        title,
        ...buildChartBackground(options),
        candlestickChart: {
          domain: { data: { sourceRange: { sources: [gridRange] } } },
          data: [
            {
              lowSeries: { data: { sourceRange: { sources: [gridRange] } } },
              openSeries: { data: { sourceRange: { sources: [gridRange] } } },
              closeSeries: { data: { sourceRange: { sources: [gridRange] } } },
              highSeries: { data: { sourceRange: { sources: [gridRange] } } },
            },
          ],
        },
      };

    case 'TREEMAP':
      return {
        title,
        ...buildChartBackground(options),
        treemapChart: {
          labels: { sourceRange: { sources: [gridRange] } },
          parentLabels: { sourceRange: { sources: [gridRange] } },
          sizeData: { sourceRange: { sources: [gridRange] } },
          levels: 2,
        },
      };

    case 'BUBBLE': {
      const xColumn = data.categories ?? data.series?.[0]?.column ?? 0;
      const yColumn =
        data.categories !== undefined
          ? (data.series?.[0]?.column ?? data.categories + 1)
          : (data.series?.[1]?.column ?? (data.series?.[0]?.column ?? 0) + 1);
      const bubbleSizeColumn =
        data.categories !== undefined ? data.series?.[1]?.column : data.series?.[2]?.column;
      const bubbleLabelColumn =
        data.categories !== undefined ? data.series?.[2]?.column : data.series?.[3]?.column;
      const groupIdColumn =
        data.categories !== undefined ? data.series?.[3]?.column : data.series?.[4]?.column;

      return {
        title,
        ...buildChartBackground(options),
        bubbleChart: {
          legendPosition: options?.legendPosition,
          domain: buildSingleColumnChartData(dataRange, xColumn),
          series: buildSingleColumnChartData(dataRange, yColumn),
          bubbleSizes:
            bubbleSizeColumn !== undefined
              ? buildSingleColumnChartData(dataRange, bubbleSizeColumn)
              : undefined,
          bubbleLabels:
            bubbleLabelColumn !== undefined
              ? buildSingleColumnChartData(dataRange, bubbleLabelColumn)
              : undefined,
          groupIds:
            groupIdColumn !== undefined
              ? buildSingleColumnChartData(dataRange, groupIdColumn)
              : undefined,
        },
      };
    }

    case 'ORG': {
      const labelColumn = data.categories ?? 0;
      const parentLabelColumn = data.series?.[0]?.column;
      const tooltipColumn = data.series?.[1]?.column;

      return {
        title,
        orgChart: {
          labels: buildSingleColumnChartData(dataRange, labelColumn),
          parentLabels:
            parentLabelColumn !== undefined
              ? buildSingleColumnChartData(dataRange, parentLabelColumn)
              : undefined,
          tooltips:
            tooltipColumn !== undefined
              ? buildSingleColumnChartData(dataRange, tooltipColumn)
              : undefined,
        },
      };
    }

    // BAR, LINE, AREA, COLUMN, SCATTER, COMBO, STEPPED_AREA use BasicChartSpec
    default:
      return buildBasicChartSpec(
        dataRange,
        chartType as sheets_v4.Schema$BasicChartSpec['chartType'],
        data,
        options
      );
  }
}

async function toOverlayPosition(
  deps: ChartsDeps,
  spreadsheetId: string,
  anchorCell: string,
  position: {
    sheetId?: number;
    offsetX?: number;
    offsetY?: number;
    width?: number;
    height?: number;
  }
): Promise<sheets_v4.Schema$EmbeddedObjectPosition> {
  const parsed = parseCellReference(anchorCell);
  // P2-3 fix: Honor explicit sheetId from position object when anchor cell
  // doesn't include a sheet prefix (e.g. "A1" vs "KPI Dashboard!A1").
  // Without this, charts always land on sheetId 0 when anchorCell has no prefix.
  const sheetId = position.sheetId ?? (await deps.resolveSheetId(spreadsheetId, parsed.sheetName));

  return {
    overlayPosition: {
      anchorCell: {
        sheetId,
        rowIndex: parsed.row,
        columnIndex: parsed.col,
      },
      offsetXPixels: position.offsetX ?? 0,
      offsetYPixels: position.offsetY ?? 0,
      widthPixels: position.width ?? 600,
      heightPixels: position.height ?? 400,
    },
  };
}

async function fetchChartPosition(
  deps: ChartsDeps,
  spreadsheetId: string,
  chartId: number
): Promise<{
  anchorCell: sheets_v4.Schema$GridCoordinate;
  offsetX: number;
  offsetY: number;
}> {
  const response = await deps.sheetsApi.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets.charts',
  });

  for (const sheet of response.data.sheets ?? []) {
    for (const chart of sheet.charts ?? []) {
      if (chart.chartId === chartId) {
        const overlay = chart.position?.overlayPosition;
        if (overlay?.anchorCell) {
          return {
            anchorCell: overlay.anchorCell,
            offsetX: overlay.offsetXPixels ?? 0,
            offsetY: overlay.offsetYPixels ?? 0,
          };
        }
      }
    }
  }

  // Fallback anchor
  return {
    anchorCell: {
      sheetId: sheetIdFallback(response.data.sheets),
      rowIndex: 0,
      columnIndex: 0,
    },
    offsetX: 0,
    offsetY: 0,
  };
}

function formatAnchorCell(anchor: sheets_v4.Schema$GridCoordinate): string {
  const colLetter = columnToLetter(anchor.columnIndex ?? 0);
  const rowNumber = (anchor.rowIndex ?? 0) + 1;
  return `${colLetter}${rowNumber}`;
}

function columnToLetter(column: number): string {
  let result = '';
  let col = column;
  while (col >= 0) {
    result = String.fromCharCode((col % 26) + 65) + result;
    col = Math.floor(col / 26) - 1;
  }
  return result;
}

function sheetIdFallback(sheets?: sheets_v4.Schema$Sheet[]): number {
  return sheets?.[0]?.properties?.sheetId ?? 0;
}
