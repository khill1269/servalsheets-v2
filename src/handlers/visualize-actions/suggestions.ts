import { ErrorCodes } from '../error-codes.js';
import type { sheets_v4 } from 'googleapis';
import type { HandlerContext } from '../base.js';
import type {
  SuggestChartInput,
  SuggestPivotInput,
  VisualizeResponse,
} from '../../schemas/visualize.js';
import type { ErrorDetail, MutationSummary } from '../../schemas/shared.js';
import { checkSamplingSupport } from '../../mcp/sampling.js';
import { isLLMFallbackAvailable, createMessageWithFallback } from '../../services/llm-fallback.js';
import { logger } from '../../utils/logger.js';
import { sendProgress } from '../../utils/request-context.js';

interface SuggestionsDeps {
  sheetsApi: sheets_v4.Sheets;
  context: HandlerContext;
  success: (
    action: string,
    data: Record<string, unknown>,
    mutation?: MutationSummary,
    dryRun?: boolean
  ) => VisualizeResponse;
  error: (error: ErrorDetail) => VisualizeResponse;
}

type ColumnKind = 'numeric' | 'date' | 'text' | 'mixed';

function toRangeString(range: SuggestChartInput['range'] | SuggestPivotInput['range']): string {
  return typeof range === 'string' ? range : 'a1' in range ? range.a1 : 'Sheet1';
}

function isNumericLike(value: unknown): boolean {
  if (typeof value === 'number') {
    return Number.isFinite(value);
  }

  if (typeof value !== 'string') {
    return false;
  }

  const normalized = value.replace(/,/g, '').trim();
  if (!normalized) {
    return false;
  }

  return !Number.isNaN(Number(normalized));
}

function isDateLike(value: unknown): boolean {
  if (value instanceof Date) {
    return !Number.isNaN(value.getTime());
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0;
  }

  if (typeof value !== 'string') {
    return false;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }

  if (/^(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)/i.test(trimmed)) {
    return true;
  }

  return !Number.isNaN(Date.parse(trimmed));
}

function detectHeaderRow(values: unknown[][]): boolean {
  return values.length > 1 && (values[0] ?? []).every((value) => typeof value === 'string');
}

function inferColumnKinds(
  values: unknown[][],
  hasHeaders: boolean
): Array<{ index: number; header: string; kind: ColumnKind }> {
  const headers = hasHeaders
    ? (values[0] ?? []).map((cell, index) => String(cell ?? `Column ${index + 1}`))
    : (values[0] ?? []).map((_, index) => `Column ${index + 1}`);
  const dataRows = hasHeaders ? values.slice(1) : values;

  return headers.map((header, index) => {
    const sample = dataRows
      .map((row) => row?.[index])
      .filter((value) => value !== null && value !== undefined && value !== '')
      .slice(0, 20);

    const numericCount = sample.filter(isNumericLike).length;
    const dateCount = sample.filter(isDateLike).length;

    let kind: ColumnKind = 'mixed';
    if (sample.length > 0 && numericCount === sample.length) {
      kind = 'numeric';
    } else if (sample.length > 0 && dateCount === sample.length) {
      kind = 'date';
    } else if (sample.every((value) => typeof value === 'string')) {
      kind = 'text';
    } else if (numericCount >= Math.max(2, sample.length * 0.7)) {
      kind = 'numeric';
    } else if (dateCount >= Math.max(2, sample.length * 0.7)) {
      kind = 'date';
    }

    return { index, header, kind };
  });
}

function buildHeuristicChartSuggestions(
  values: unknown[][],
  maxSuggestions: number
): Array<Record<string, unknown>> {
  const hasHeaders = detectHeaderRow(values);
  const columns = inferColumnKinds(values, hasHeaders);
  const numericColumns = columns.filter((column) => column.kind === 'numeric');
  const dateColumns = columns.filter((column) => column.kind === 'date');
  const textColumns = columns.filter((column) => column.kind === 'text');
  const categoryColumn = dateColumns[0] ?? textColumns[0] ?? columns[0];
  const categoryValues = (hasHeaders ? values.slice(1) : values)
    .map((row) => row?.[categoryColumn?.index ?? 0])
    .filter((value) => value !== null && value !== undefined && value !== '');
  const distinctCategoryCount = new Set(categoryValues.map((value) => String(value))).size;
  const suggestions: Array<Record<string, unknown>> = [];

  if (categoryColumn && numericColumns.length > 0 && dateColumns.length > 0) {
    suggestions.push({
      type: 'chart',
      chartType: 'LINE',
      title: `${numericColumns[0]?.header ?? 'Value'} over ${categoryColumn.header}`,
      explanation: 'Highlights how numeric values change across a temporal sequence.',
      confidence: 92,
      reasoning: 'Detected a time-like category column with one or more numeric measures.',
      dataMapping: {
        categoryColumn: categoryColumn.index,
        seriesColumns: numericColumns.slice(0, 3).map((column) => column.index),
      },
    });
  }

  if (categoryColumn && numericColumns.length > 0) {
    suggestions.push({
      type: 'chart',
      chartType: distinctCategoryCount > 8 ? 'BAR' : 'COLUMN',
      title: `${numericColumns[0]?.header ?? 'Value'} by ${categoryColumn.header}`,
      explanation: 'Compares numeric values across categories in a straightforward layout.',
      confidence: 86,
      reasoning: 'Detected a category column paired with numeric measures suitable for comparison.',
      dataMapping: {
        categoryColumn: categoryColumn.index,
        seriesColumns: numericColumns.slice(0, 3).map((column) => column.index),
      },
    });
  }

  if (
    categoryColumn &&
    numericColumns.length === 1 &&
    distinctCategoryCount > 1 &&
    distinctCategoryCount <= 8
  ) {
    suggestions.push({
      type: 'chart',
      chartType: 'PIE',
      title: `${numericColumns[0]?.header ?? 'Value'} share by ${categoryColumn.header}`,
      explanation: 'Shows relative contribution of each category to the total.',
      confidence: 74,
      reasoning:
        'Single-measure categorical data with a small number of distinct categories fits a pie chart.',
      dataMapping: {
        categoryColumn: categoryColumn.index,
        seriesColumns: [numericColumns[0]!.index],
      },
    });
  }

  if (numericColumns.length >= 2) {
    suggestions.push({
      type: 'chart',
      chartType: 'SCATTER',
      title: `${numericColumns[0]!.header} vs ${numericColumns[1]!.header}`,
      explanation: 'Reveals correlation and outliers between two numeric measures.',
      confidence: 80,
      reasoning: 'Detected at least two numeric columns with no required categorical axis.',
      dataMapping: {
        categoryColumn: numericColumns[0]!.index,
        seriesColumns: [numericColumns[1]!.index],
      },
    });
  }

  if (suggestions.length === 0) {
    suggestions.push({
      type: 'chart',
      chartType: 'COLUMN',
      title: 'Tabular comparison',
      explanation: 'Provides a general-purpose comparison view when the data shape is mixed.',
      confidence: 60,
      reasoning:
        'Falling back to a safe categorical comparison because the data shape is ambiguous.',
      dataMapping: {
        categoryColumn: categoryColumn?.index ?? 0,
        seriesColumns: numericColumns.slice(0, 3).map((column) => column.index),
      },
    });
  }

  const deduped = new Map<string, Record<string, unknown>>();
  for (const suggestion of suggestions) {
    const key = String(suggestion['chartType']);
    if (!deduped.has(key)) {
      deduped.set(key, suggestion);
    }
  }

  return Array.from(deduped.values()).slice(0, maxSuggestions);
}

function getDistinctValueCount(
  values: unknown[][],
  columnIndex: number,
  hasHeaders: boolean
): number {
  const rows = hasHeaders ? values.slice(1) : values;
  return new Set(
    rows
      .map((row) => row?.[columnIndex])
      .filter((value) => value !== null && value !== undefined && value !== '')
      .map((value) => String(value))
  ).size;
}

function buildHeuristicPivotSuggestions(
  values: unknown[][],
  maxSuggestions: number
): Array<Record<string, unknown>> {
  const hasHeaders = detectHeaderRow(values);
  const columns = inferColumnKinds(values, hasHeaders);
  const numericColumns = columns.filter((column) => column.kind === 'numeric');
  const dimensionColumns = columns.filter(
    (column) => column.kind === 'text' || column.kind === 'date'
  );
  const mixedColumns = columns.filter((column) => column.kind === 'mixed');
  const candidateDimensions = [...dimensionColumns, ...mixedColumns];
  const primaryRowColumn =
    candidateDimensions.find((column) => {
      const distinctCount = getDistinctValueCount(values, column.index, hasHeaders);
      return distinctCount >= 2 && distinctCount <= 100;
    }) ??
    candidateDimensions[0] ??
    columns[0];
  const secondaryRowColumn =
    candidateDimensions.find((column) => {
      if (!primaryRowColumn || column.index === primaryRowColumn.index) {
        return false;
      }

      const distinctCount = getDistinctValueCount(values, column.index, hasHeaders);
      return distinctCount >= 2 && distinctCount <= 24;
    }) ?? undefined;
  const suggestions: Array<Record<string, unknown>> = [];

  if (primaryRowColumn && numericColumns.length > 0) {
    const valueColumns = numericColumns.slice(0, 2).map((column) => ({
      columnIndex: column.index,
      function: 'SUM',
    }));
    suggestions.push({
      type: 'pivot',
      title: `${numericColumns[0]?.header ?? 'Value'} by ${primaryRowColumn.header}`,
      explanation:
        'Summarizes numeric measures by the strongest categorical dimension in the range.',
      confidence: 90,
      reasoning:
        'Detected one or more numeric measures plus a dimension column suitable for row grouping.',
      configuration: {
        rowGroupColumns: [primaryRowColumn.index],
        valueColumns,
      },
    });
  }

  if (primaryRowColumn && secondaryRowColumn && numericColumns.length > 0) {
    suggestions.push({
      type: 'pivot',
      title: `${numericColumns[0]?.header ?? 'Value'} by ${primaryRowColumn.header} and ${secondaryRowColumn.header}`,
      explanation: 'Breaks down the primary metric across two dimensions for deeper comparison.',
      confidence: 82,
      reasoning:
        'Detected two dimension columns with manageable cardinality and at least one numeric measure.',
      configuration: {
        rowGroupColumns: [primaryRowColumn.index],
        columnGroupColumns: [secondaryRowColumn.index],
        valueColumns: [{ columnIndex: numericColumns[0]!.index, function: 'SUM' }],
      },
    });
  }

  if (primaryRowColumn && numericColumns.length > 0) {
    suggestions.push({
      type: 'pivot',
      title: `Average ${numericColumns[0]?.header ?? 'Value'} by ${primaryRowColumn.header}`,
      explanation: 'Shows average performance by group instead of total magnitude.',
      confidence: 72,
      reasoning:
        'Average aggregation is useful when group sizes vary and a raw sum would be misleading.',
      configuration: {
        rowGroupColumns: [primaryRowColumn.index],
        valueColumns: [{ columnIndex: numericColumns[0]!.index, function: 'AVERAGE' }],
      },
    });
  }

  if (primaryRowColumn) {
    suggestions.push({
      type: 'pivot',
      title: `Record count by ${primaryRowColumn.header}`,
      explanation: 'Counts records per category when a simple distribution view is useful.',
      confidence: numericColumns.length === 0 ? 78 : 64,
      reasoning: 'A count-based pivot remains useful even when measures are sparse or mixed.',
      configuration: {
        rowGroupColumns: [primaryRowColumn.index],
        valueColumns: [
          {
            columnIndex: (numericColumns[0] ?? primaryRowColumn).index,
            function: 'COUNT',
          },
        ],
      },
    });
  }

  const deduped = new Map<string, Record<string, unknown>>();
  for (const suggestion of suggestions) {
    const config = suggestion['configuration'] as Record<string, unknown> | undefined;
    const key = JSON.stringify({
      rows: config?.['rowGroupColumns'],
      columns: config?.['columnGroupColumns'],
      values: config?.['valueColumns'],
    });
    if (!deduped.has(key)) {
      deduped.set(key, suggestion);
    }
  }

  return Array.from(deduped.values()).slice(0, maxSuggestions);
}

function parseAiChartSuggestions(responseText: string): Array<Record<string, unknown>> | null {
  const jsonMatch = responseText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return null;
  }

  const parsed = JSON.parse(jsonMatch[0]) as { suggestions?: Array<Record<string, unknown>> };
  if (!Array.isArray(parsed.suggestions) || parsed.suggestions.length === 0) {
    return null;
  }

  return parsed.suggestions.map((suggestion) => ({
    type: 'chart',
    ...suggestion,
  }));
}

function parseAiPivotSuggestions(responseText: string): Array<Record<string, unknown>> | null {
  const jsonMatch = responseText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return null;
  }

  const parsed = JSON.parse(jsonMatch[0]) as { suggestions?: Array<Record<string, unknown>> };
  if (!Array.isArray(parsed.suggestions) || parsed.suggestions.length === 0) {
    return null;
  }

  return parsed.suggestions.map((suggestion) => ({
    type: 'pivot',
    ...suggestion,
  }));
}

export async function handleSuggestChartAction(
  input: SuggestChartInput,
  deps: SuggestionsDeps
): Promise<VisualizeResponse> {
  // Check if LLM fallback is available or server supports sampling
  const samplingSupport = deps.context.server
    ? checkSamplingSupport(deps.context.server.getClientCapabilities?.())
    : { supported: false };
  const hasLLMFallback = isLLMFallbackAvailable();
  const hasAiSuggestionSupport =
    hasLLMFallback || (!!deps.context.server && samplingSupport.supported);

  if (!input.range) {
    return deps.error({
      code: ErrorCodes.INVALID_PARAMS,
      message: 'Range is required for chart suggestions',
      retryable: false,
      suggestedFix: 'Check the parameter format and ensure all required parameters are provided',
    });
  }

  const startTime = Date.now();

  try {
    await sendProgress(0, 3, 'Analyzing data for chart suggestions...');

    const rangeStr = toRangeString(input.range);

    // Fetch data from the specified range
    const response = await deps.sheetsApi.spreadsheets.values.get({
      spreadsheetId: input.spreadsheetId!,
      range: rangeStr,
      valueRenderOption: 'UNFORMATTED_VALUE',
    });

    const values = response.data.values || [];
    if (values.length === 0) {
      return deps.error({
        code: ErrorCodes.INVALID_PARAMS,
        message: 'Range contains no data',
        retryable: false,
        suggestedFix: 'Check the parameter format and ensure all required parameters are provided',
      });
    }

    const maxSuggestions = input.maxSuggestions || 3;
    const fallbackSuggestions = buildHeuristicChartSuggestions(
      values as unknown[][],
      maxSuggestions
    );
    const hasHeaders = detectHeaderRow(values as unknown[][]);
    const dataRows = hasHeaders ? values.slice(1) : values;
    const headers = hasHeaders ? (values[0] as string[]) : undefined;

    if (!hasAiSuggestionSupport) {
      return deps.success('suggest_chart', {
        suggestions: fallbackSuggestions,
        _meta: {
          duration: Date.now() - startTime,
          timestamp: new Date().toISOString(),
        },
      });
    }

    // Build AI sampling request
    const headerInfo = headers ? `\n**Column headers:** ${headers.join(', ')}` : '';
    const sampleData = dataRows.slice(0, 10);

    const prompt = `Analyze this spreadsheet data and suggest the ${maxSuggestions} best chart types to visualize it.

**Data range:** ${rangeStr}
**Row count:** ${values.length}
**Column count:** ${values[0]?.length || 0}${headerInfo}

**Sample data (first 10 rows):**
\`\`\`json
${JSON.stringify(sampleData, null, 2)}
\`\`\`

For each chart suggestion, provide:
1. Chart type (LINE, BAR, COLUMN, PIE, SCATTER, AREA, COMBO, etc.)
2. A descriptive title
3. Clear explanation of what insights this chart reveals
4. Confidence score (0-100)
5. Reasoning for why this chart type fits the data
6. Data mapping (which columns to use for series and categories)

Format your response as JSON:
{
  "suggestions": [
    {
      "chartType": "COLUMN",
      "title": "Monthly Sales by Product",
      "explanation": "Shows sales trends across months for each product category",
      "confidence": 95,
      "reasoning": "Time-series data with multiple categories is ideal for column charts",
      "dataMapping": {
        "categoryColumn": 0,
        "seriesColumns": [1, 2, 3]
      }
    }
  ]
}`;

    const systemPrompt = `You are an expert data visualization consultant.
Analyze spreadsheet data and recommend the most effective chart types.
Consider data types, relationships, and visualization best practices.
Always return valid JSON in the exact format requested.`;

    // Use LLM fallback or MCP sampling
    const llmResult = await createMessageWithFallback(
      deps.context.server as Parameters<typeof createMessageWithFallback>[0],
      {
        messages: [{ role: 'user', content: prompt }],
        systemPrompt,
        maxTokens: 2048,
      }
    );
    const duration = Date.now() - startTime;

    // Extract text from response
    const responseText = llmResult.content;

    const aiSuggestions = parseAiChartSuggestions(responseText);

    return deps.success('suggest_chart', {
      suggestions: aiSuggestions ?? fallbackSuggestions,
      _meta: {
        duration,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    logger.error('Chart suggestion failed', {
      error: error instanceof Error ? error.message : String(error),
    });

    const rangeStr = toRangeString(input.range);
    const response = await deps.sheetsApi.spreadsheets.values.get({
      spreadsheetId: input.spreadsheetId!,
      range: rangeStr,
      valueRenderOption: 'UNFORMATTED_VALUE',
    });
    const values = response.data.values || [];

    if (values.length === 0) {
      return deps.error({
        code: ErrorCodes.INVALID_PARAMS,
        message: 'Range contains no data',
        retryable: false,
        suggestedFix: 'Check the parameter format and ensure all required parameters are provided',
      });
    }

    return deps.success('suggest_chart', {
      suggestions: buildHeuristicChartSuggestions(values as unknown[][], input.maxSuggestions || 3),
      _meta: {
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      },
    });
  }
}

export async function handleSuggestPivotAction(
  input: SuggestPivotInput,
  deps: SuggestionsDeps
): Promise<VisualizeResponse> {
  // Check if LLM fallback is available or server supports sampling
  const samplingSupport = deps.context.server
    ? checkSamplingSupport(deps.context.server.getClientCapabilities?.())
    : { supported: false };
  const hasLLMFallback = isLLMFallbackAvailable();
  const hasAiSuggestionSupport =
    hasLLMFallback || (!!deps.context.server && samplingSupport.supported);

  if (!input.range) {
    return deps.error({
      code: ErrorCodes.INVALID_PARAMS,
      message: 'Range is required for pivot table suggestions',
      retryable: false,
      suggestedFix: 'Check the parameter format and ensure all required parameters are provided',
    });
  }

  const startTime = Date.now();

  try {
    await sendProgress(0, 3, 'Analyzing data for pivot suggestions...');

    // Convert range to A1 notation string
    const rangeStr =
      typeof input.range === 'string'
        ? input.range
        : 'a1' in input.range
          ? input.range.a1
          : 'Sheet1';

    // Fetch data from the specified range
    const response = await deps.sheetsApi.spreadsheets.values.get({
      spreadsheetId: input.spreadsheetId!,
      range: rangeStr,
      valueRenderOption: 'UNFORMATTED_VALUE',
    });

    const values = response.data.values || [];
    if (values.length === 0) {
      return deps.error({
        code: ErrorCodes.INVALID_PARAMS,
        message: 'Range contains no data',
        retryable: false,
        suggestedFix: 'Check the parameter format and ensure all required parameters are provided',
      });
    }

    const maxSuggestions = input.maxSuggestions || 3;
    const fallbackSuggestions = buildHeuristicPivotSuggestions(
      values as unknown[][],
      maxSuggestions
    );

    if (!hasAiSuggestionSupport) {
      return deps.success('suggest_pivot', {
        suggestions: fallbackSuggestions,
        _meta: {
          duration: Date.now() - startTime,
          timestamp: new Date().toISOString(),
        },
      });
    }

    // Analyze data structure
    const hasHeaders = values.length > 1 && values[0]?.every((v: unknown) => typeof v === 'string');
    const dataRows = hasHeaders ? values.slice(1) : values;
    const headers = hasHeaders ? (values[0] as string[]) : undefined;

    // Build AI sampling request
    const headerInfo = headers ? `\n**Column headers:** ${headers.join(', ')}` : '';
    const sampleData = dataRows.slice(0, 10);

    const prompt = `Analyze this spreadsheet data and suggest the ${input.maxSuggestions || 3} most useful pivot table configurations.

**Data range:** ${rangeStr}
**Row count:** ${values.length}
**Column count:** ${values[0]?.length || 0}${headerInfo}

**Sample data (first 10 rows):**
\`\`\`json
${JSON.stringify(sampleData, null, 2)}
\`\`\`

For each pivot table suggestion, provide:
1. A descriptive title
2. Clear explanation of what insights this pivot reveals
3. Confidence score (0-100)
4. Reasoning for this configuration
5. Configuration details:
   - Row group columns (column indices to group by rows)
   - Column group columns (column indices to group by columns, optional)
   - Value columns with aggregation functions (SUM, AVERAGE, COUNT, etc.)

Format your response as JSON:
{
  "suggestions": [
    {
      "title": "Sales by Region and Product",
      "explanation": "Shows total sales broken down by region and product category",
      "confidence": 95,
      "reasoning": "Contains categorical dimensions (region, product) and numeric metrics (sales)",
      "configuration": {
        "rowGroupColumns": [0, 1],
        "valueColumns": [
          {"columnIndex": 2, "function": "SUM"}
        ]
      }
    }
  ]
}`;

    const systemPrompt = `You are an expert data analyst specializing in pivot table design.
Analyze spreadsheet data and recommend pivot table configurations that reveal meaningful insights.
Consider data types, cardinality, and business intelligence best practices.
Always return valid JSON in the exact format requested.`;

    // Use LLM fallback or MCP sampling
    const llmResult = await createMessageWithFallback(
      deps.context.server as Parameters<typeof createMessageWithFallback>[0],
      {
        messages: [{ role: 'user', content: prompt }],
        systemPrompt,
        maxTokens: 2048,
      }
    );
    const duration = Date.now() - startTime;

    // Extract text from response
    const responseText = llmResult.content;
    const aiSuggestions = parseAiPivotSuggestions(responseText);

    return deps.success('suggest_pivot', {
      suggestions: aiSuggestions ?? fallbackSuggestions,
      _meta: {
        duration,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    logger.error('Pivot suggestion failed', {
      error: error instanceof Error ? error.message : String(error),
    });

    const rangeStr = toRangeString(input.range);
    const response = await deps.sheetsApi.spreadsheets.values.get({
      spreadsheetId: input.spreadsheetId!,
      range: rangeStr,
      valueRenderOption: 'UNFORMATTED_VALUE',
    });
    const values = response.data.values || [];

    if (values.length === 0) {
      return deps.error({
        code: ErrorCodes.INVALID_PARAMS,
        message: 'Range contains no data',
        retryable: false,
        suggestedFix: 'Check the parameter format and ensure all required parameters are provided',
      });
    }

    return deps.success('suggest_pivot', {
      suggestions: buildHeuristicPivotSuggestions(values as unknown[][], input.maxSuggestions || 3),
      _meta: {
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      },
    });
  }
}
