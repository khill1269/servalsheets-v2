---
title: ServalSheets Handler Implementation Guide
category: development
last_updated: 2026-01-31
description: '> Version: 1.0.0'
version: 1.6.0
tags: [sheets]
---

# ServalSheets Handler Implementation Guide

> **Version:** 1.0.0
> **Architecture:** Action-based discriminated unions
> **Tools:** 25 tools with 407 actions

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Handler Structure](#handler-structure)
3. [Complete Handler Examples](#complete-handler-examples)
4. [Service Layer](#service-layer)
5. [Response Building](#response-building)
6. [Error Handling](#error-handling)
7. [Safety Rails](#safety-rails)

---

## Architecture Overview

### Layer Diagram

```
┌─────────────────────────────────────────────────────────┐
│                    MCP Protocol Layer                    │
│  (JSON-RPC, tools/call, tools/list)                     │
└─────────────────────────┬───────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────┐
│                    Tool Registration                     │
│  (McpServer.registerTool with schemas + annotations)    │
└─────────────────────────┬───────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────┐
│                    Handler Layer                         │
│  (Action dispatch, validation, response building)       │
└─────────────────────────┬───────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────┐
│                    Service Layer                         │
│  (Business logic, Google API calls, caching)            │
└─────────────────────────┬───────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────┐
│                    Google APIs                           │
│  (Sheets v4, Drive v3)                                  │
└─────────────────────────────────────────────────────────┘
```

### Tool → Handler → Service Flow

```typescript
// 1. Tool Registration (index.ts)
mcp.registerTool(
  'sheets_data',
  {
    description: 'Read, write, append, clear cell values',
    inputSchema: zodToJsonSchema(SheetsValuesInputSchema),
    outputSchema: zodToJsonSchema(SheetsValuesOutputSchema),
    annotations: {
      title: 'Sheets Values',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  async (args, extra) => {
    return valuesHandler.handle(args, extra);
  }
);
```

---

## Handler Structure

### Base Handler Class

```typescript
// src/handlers/base.ts
import { CallToolResult, TextContent } from '@modelcontextprotocol/sdk/types';

export abstract class BaseHandler<TInput, TOutput> {
  constructor(
    protected readonly sheetsService: SheetsService,
    protected readonly snapshotService?: SnapshotService
  ) {}

  abstract handle(input: TInput, extra: RequestHandlerExtra): Promise<CallToolResult>;

  protected success<A extends string>(
    action: A,
    data: any,
    mutation?: MutationInfo,
    dryRun: boolean = false
  ): CallToolResult {
    return {
      content: [this.formatContent(action, data, dryRun)],
      structuredContent: {
        success: true,
        action,
        data,
        ...(mutation && { mutation }),
        ...(dryRun && { dryRun }),
        timestamp: new Date().toISOString(),
      },
      isError: false,
    };
  }

  protected error(code: string, message: string, details?: Record<string, any>): CallToolResult {
    return {
      content: [{ type: 'text', text: `Error [${code}]: ${message}` }],
      structuredContent: {
        success: false,
        error: { code, message, ...details },
        timestamp: new Date().toISOString(),
      },
      isError: true,
    };
  }

  protected abstract formatContent(action: string, data: any, dryRun: boolean): TextContent;

  protected resolveRange(range: RangeInput): string {
    if ('a1' in range) return range.a1;
    if ('namedRange' in range) return range.namedRange;
    if ('semantic' in range) return this.semanticToA1(range.semantic);
    if ('grid' in range) return this.gridToA1(range.grid);
    throw new Error('Invalid range format');
  }
}
```

### Values Handler Example

```typescript
// src/handlers/values.ts
export class SheetsValuesHandler extends BaseHandler<SheetsValuesInput, any> {
  async handle(input: SheetsValuesInput, extra: Extra): Promise<CallToolResult> {
    const handlers: Record<string, () => Promise<CallToolResult>> = {
      read: () => this.handleRead(input, extra),
      write: () => this.handleWrite(input, extra),
      append: () => this.handleAppend(input, extra),
      clear: () => this.handleClear(input, extra),
      batch_read: () => this.handleBatchRead(input, extra),
      batch_write: () => this.handleBatchWrite(input, extra),
      find: () => this.handleFind(input, extra),
      replace: () => this.handleReplace(input, extra),
    };

    try {
      return await handlers[input.action]();
    } catch (err) {
      return this.handleError(err);
    }
  }

  private async handleRead(input: ReadInput, extra: Extra): Promise<CallToolResult> {
    const range = this.resolveRange(input.range);

    const result = await this.sheetsService.readValues(input.spreadsheetId, range, {
      valueRenderOption: input.valueRenderOption,
      dateTimeRenderOption: input.dateTimeRenderOption,
    });

    return this.success('read', {
      values: result.values || [],
      range: result.range,
      rowCount: result.values?.length || 0,
      columnCount: result.values?.[0]?.length || 0,
    });
  }

  private async handleWrite(input: WriteInput, extra: Extra): Promise<CallToolResult> {
    const range = this.resolveRange(input.range);

    // Safety: Dry run
    if (input.safety?.dryRun) {
      return this.success(
        'write',
        {
          wouldUpdate: {
            range,
            cellCount: input.values.length * (input.values[0]?.length || 0),
          },
        },
        undefined,
        true
      );
    }

    // Safety: Effect scope
    if (input.safety?.effectScope) {
      const cellCount = input.values.length * (input.values[0]?.length || 0);
      if (cellCount > (input.safety.effectScope.maxCellsAffected || 50000)) {
        return this.error(
          'EFFECT_SCOPE_EXCEEDED',
          `Would affect ${cellCount} cells, exceeds limit`
        );
      }
    }

    // Safety: Auto snapshot
    let snapshotId: string | undefined;
    if (input.safety?.autoSnapshot !== false && this.snapshotService) {
      snapshotId = await this.snapshotService.createSnapshot(input.spreadsheetId, range);
    }

    const result = await this.sheetsService.writeValues(
      input.spreadsheetId,
      range,
      input.values,
      input.valueInputOption || 'USER_ENTERED'
    );

    return this.success(
      'write',
      {
        updatedRange: result.updatedRange,
        updatedCells: result.updatedCells,
      },
      { type: 'write', range: result.updatedRange, snapshotId }
    );
  }

  private handleError(err: any): CallToolResult {
    const code = err.code || err.response?.status;

    const errorMap: Record<number, [string, string]> = {
      400: ['INVALID_REQUEST', 'Check parameters'],
      401: ['UNAUTHORIZED', 'Re-authenticate'],
      403: ['FORBIDDEN', 'Check permissions'],
      404: ['NOT_FOUND', 'Verify spreadsheet exists'],
      429: ['RATE_LIMITED', 'Wait and retry'],
    };

    const [errorCode, suggestion] = errorMap[code] || ['INTERNAL_ERROR', 'Unknown error'];
    return this.error(errorCode, err.message, { suggestion });
  }
}
```

---

## Service Layer

### Sheets Service

```typescript
// src/services/sheets.ts
import { google, sheets_v4 } from 'googleapis';

export class SheetsService {
  private sheets: sheets_v4.Sheets;

  constructor(auth: OAuth2Client) {
    this.sheets = google.sheets({ version: 'v4', auth });
  }

  async getSpreadsheet(
    spreadsheetId: string,
    options?: {
      includeGridData?: boolean;
      fields?: string;
    }
  ): Promise<sheets_v4.Schema$Spreadsheet> {
    const response = await this.sheets.spreadsheets.get({
      spreadsheetId,
      includeGridData: options?.includeGridData,
      fields: options?.fields,
    });
    return response.data;
  }

  async readValues(
    spreadsheetId: string,
    range: string,
    options?: {
      valueRenderOption?: string;
      dateTimeRenderOption?: string;
    }
  ): Promise<sheets_v4.Schema$ValueRange> {
    const response = await this.sheets.spreadsheets.values.get({
      spreadsheetId,
      range,
      valueRenderOption: options?.valueRenderOption as any,
      dateTimeRenderOption: options?.dateTimeRenderOption as any,
    });
    return response.data;
  }

  async writeValues(
    spreadsheetId: string,
    range: string,
    values: any[][],
    valueInputOption: 'RAW' | 'USER_ENTERED'
  ): Promise<sheets_v4.Schema$UpdateValuesResponse> {
    const response = await this.sheets.spreadsheets.values.update({
      spreadsheetId,
      range,
      valueInputOption,
      requestBody: { values },
    });
    return response.data;
  }

  async batchUpdate(
    spreadsheetId: string,
    requests: sheets_v4.Schema$Request[]
  ): Promise<sheets_v4.Schema$BatchUpdateSpreadsheetResponse> {
    const response = await this.sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests },
    });
    return response.data;
  }
}
```

### Snapshot Service

```typescript
// src/services/snapshot.ts
export class SnapshotService {
  private snapshots = new Map<string, Snapshot>();

  async createSnapshot(spreadsheetId: string, range?: string): Promise<string> {
    const snapshotId = `snap_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const values = range
      ? await this.sheetsService.readValues(spreadsheetId, range, { valueRenderOption: 'FORMULA' })
      : null;

    this.snapshots.set(snapshotId, {
      id: snapshotId,
      spreadsheetId,
      range,
      values: values?.values,
      createdAt: new Date().toISOString(),
    });

    return snapshotId;
  }

  async restoreSnapshot(snapshotId: string): Promise<void> {
    const snapshot = this.snapshots.get(snapshotId);
    if (!snapshot) throw new Error(`Snapshot not found: ${snapshotId}`);

    if (snapshot.values && snapshot.range) {
      await this.sheetsService.writeValues(
        snapshot.spreadsheetId,
        snapshot.range,
        snapshot.values,
        'RAW'
      );
    }
  }
}
```

---

## Response Building

### Standard Response Formats

```typescript
// Success response
{
  content: [{ type: 'text', text: 'Read 10 rows × 5 columns from Sheet1!A1:E10' }],
  structuredContent: {
    success: true,
    action: 'read',
    data: { values: [...], range: 'Sheet1!A1:E10', rowCount: 10, columnCount: 5 },
    timestamp: '2024-01-15T10:30:00Z',
  },
  isError: false,
}

// Error response
{
  content: [{ type: 'text', text: 'Error [NOT_FOUND]: Spreadsheet not found' }],
  structuredContent: {
    success: false,
    error: { code: 'NOT_FOUND', message: 'Spreadsheet not found', suggestion: 'Verify ID' },
    timestamp: '2024-01-15T10:30:00Z',
  },
  isError: true,
}

// Dry run response
{
  content: [{ type: 'text', text: '[DRY RUN] Would update 100 cells' }],
  structuredContent: {
    success: true,
    action: 'write',
    data: { wouldUpdate: { range: 'A1:J10', cellCount: 100 } },
    dryRun: true,
    timestamp: '2024-01-15T10:30:00Z',
  },
  isError: false,
}
```

---

## Safety Rails

### Implementation

```typescript
// src/utils/safety.ts
export async function applySafetyRails(
  input: { safety?: SafetyOptions },
  context: { spreadsheetId: string; range?: string; estimatedCells?: number }
): Promise<SafetyResult> {
  const safety = input.safety || {};

  // Effect scope check
  if (safety.effectScope && context.estimatedCells) {
    const max = safety.effectScope.maxCellsAffected || 50000;
    if (context.estimatedCells > max) {
      return { allowed: false, reason: `Exceeds ${max} cell limit`, code: 'EFFECT_SCOPE_EXCEEDED' };
    }
  }

  // Expected state validation
  if (safety.expectedState) {
    const valid = await validateExpectedState(context.spreadsheetId, safety.expectedState);
    if (!valid.matches) {
      return { allowed: false, reason: valid.reason, code: 'STATE_MISMATCH' };
    }
  }

  return { allowed: true, dryRun: safety.dryRun || false };
}
```

---

## Format Handler Example

```typescript
// src/handlers/format.ts
export class SheetsFormatHandler extends BaseHandler<SheetsFormatInput, any> {
  async handle(input: SheetsFormatInput, extra: Extra): Promise<CallToolResult> {
    switch (input.action) {
      case 'apply':
        return this.handleApply(input, extra);
      case 'borders':
        return this.handleBorders(input, extra);
      case 'number_format':
        return this.handleNumberFormat(input, extra);
      case 'apply_preset':
        return this.handleApplyPreset(input, extra);
      default:
        return this.error('INVALID_ACTION', `Unknown: ${input.action}`);
    }
  }

  private async handleApply(input: ApplyFormatInput, extra: Extra): Promise<CallToolResult> {
    const range = this.resolveRange(input.range);
    const gridRange = await this.toGridRange(input.spreadsheetId, range);

    const cellFormat: CellFormat = {};
    const fields: string[] = [];

    if (input.format.backgroundColor) {
      cellFormat.backgroundColor = this.normalizeColor(input.format.backgroundColor);
      fields.push('backgroundColor');
    }

    if (input.format.textFormat) {
      cellFormat.textFormat = input.format.textFormat;
      fields.push('textFormat');
    }

    await this.sheetsService.batchUpdate(input.spreadsheetId, [
      {
        repeatCell: {
          range: gridRange,
          cell: { userEnteredFormat: cellFormat },
          fields: `userEnteredFormat(${fields.join(',')})`,
        },
      },
    ]);

    return this.success('apply', { formattedRange: range, appliedFormats: fields });
  }

  // IMPORTANT: Colors must be 0-1 scale
  private normalizeColor(color: ColorInput): Color {
    return {
      red: Math.max(0, Math.min(1, color.red)),
      green: Math.max(0, Math.min(1, color.green)),
      blue: Math.max(0, Math.min(1, color.blue)),
      alpha: color.alpha ?? 1,
    };
  }
}
```

---

## Charts Handler Example

```typescript
// src/handlers/charts.ts
export class SheetsChartsHandler extends BaseHandler<SheetsChartsInput, any> {
  private async handleCreate(input: CreateChartInput): Promise<CallToolResult> {
    const chartSpec = this.buildChartSpec(input);
    const position = this.buildPosition(input.position, input.sheetId);

    const response = await this.sheetsService.batchUpdate(input.spreadsheetId, [
      {
        addChart: { chart: { spec: chartSpec, position } },
      },
    ]);

    const chartId = response.replies?.[0]?.addChart?.chart?.chartId;
    return this.success('create', { chartId, chartType: input.chartType, title: input.title });
  }

  private buildChartSpec(input: CreateChartInput): ChartSpec {
    return {
      title: input.title,
      subtitle: input.subtitle,
      basicChart: {
        chartType: input.chartType,
        legendPosition: input.legend || 'BOTTOM_LEGEND',
        headerCount: input.headerCount || 1,
        domains: [
          {
            domain: {
              sourceRange: {
                sources: [
                  /*...*/
                ],
              },
            },
          },
        ],
        series:
          input.series?.map((s) => ({
            series: {
              sourceRange: {
                sources: [
                  /*...*/
                ],
              },
            },
            targetAxis: s.targetAxis || 'LEFT_AXIS',
          })) || [],
      },
    };
  }
}
```

---

## Analysis Handler Example

```typescript
// src/handlers/analysis.ts
export class SheetsAnalysisHandler extends BaseHandler<SheetsAnalysisInput, any> {
  private async handleScout(input: ScoutInput): Promise<CallToolResult> {
    const metadata = await this.sheetsService.getSpreadsheet(input.spreadsheetId, {
      fields: 'properties,sheets(properties,charts,conditionalFormats)',
    });

    const sheets =
      metadata.sheets?.map((sheet) => ({
        sheetId: sheet.properties?.sheetId,
        title: sheet.properties?.title,
        rowCount: sheet.properties?.gridProperties?.rowCount,
        columnCount: sheet.properties?.gridProperties?.columnCount,
        chartCount: sheet.charts?.length || 0,
      })) || [];

    return this.success('scout', {
      spreadsheetId: input.spreadsheetId,
      title: metadata.properties?.title,
      sheets,
      totalSheets: sheets.length,
    });
  }

  private async handleAnalyzeData(input: StatisticsInput): Promise<CallToolResult> {
    const data = await this.sheetsService.readValues(
      input.spreadsheetId,
      this.resolveRange(input.range),
      { valueRenderOption: 'UNFORMATTED_VALUE' }
    );

    const numbers = data.values?.flat().filter((v) => typeof v === 'number') as number[];
    const sorted = [...numbers].sort((a, b) => a - b);
    const sum = numbers.reduce((a, b) => a + b, 0);
    const mean = sum / numbers.length;

    return this.success('analyze_data', {
      count: numbers.length,
      sum,
      mean,
      median: sorted[Math.floor(sorted.length / 2)],
      min: sorted[0],
      max: sorted[sorted.length - 1],
      stdDev: Math.sqrt(numbers.reduce((acc, n) => acc + (n - mean) ** 2, 0) / numbers.length),
    });
  }
}
```

---

## End-to-End Flow Example

```typescript
async function importAndVisualize(client: McpClient, csvData: string[][]): Promise<void> {
  // 1. Create spreadsheet
  const create = await client.callTool('sheets_core', {
    action: 'create',
    title: `Import-${Date.now()}`,
  });
  const spreadsheetId = create.structuredContent.data.spreadsheetId;

  // 2. Write data
  await client.callTool('sheets_data', {
    action: 'write',
    spreadsheetId,
    range: { a1: 'Sheet1!A1' },
    values: csvData,
  });

  // 3. Format
  await client.callTool('sheets_format', {
    action: 'apply_preset',
    spreadsheetId,
    range: { a1: `Sheet1!A1:${indexToColumn(csvData[0].length - 1)}${csvData.length}` },
    preset: 'corporate',
  });

  // 4. Create chart
  await client.callTool('sheets_visualize', {
    action: 'create',
    spreadsheetId,
    chartType: 'COLUMN',
    dataRange: { a1: 'Sheet1!A1:D10' },
    title: 'Summary',
  });
}
```

---

_This guide provides patterns for implementing MCP tool handlers with Google Sheets._
