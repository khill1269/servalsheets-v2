import { ErrorCodes } from '../error-codes.js';
import type { drive_v3, sheets_v4 } from 'googleapis';
import type {
  ColumnMapping,
  CompositeAuditSheetInput,
  CompositeDataPipelineInput,
  CompositeInstantiateTemplateInput,
  CompositeMigrateSpreadsheetInput,
  CompositeOutput,
  CompositePublishReportInput,
  PipelineStep,
} from '../../schemas/composite.js';
import type { SamplingServer } from '../../mcp/sampling.js';
import { generateAIInsight } from '../../mcp/sampling.js';
import { getRequestLogger, sendProgress } from '../../utils/request-context.js';
import { createSnapshotIfNeeded } from '../../utils/safety-helpers.js';
import type { SnapshotService } from '../../services/snapshot.js';
import type { SessionContextManager } from '../../services/session-context.js';
import type { ResponseMeta } from '../../schemas/shared.js';
import { recordCompositeWorkflow } from '../../observability/metrics.js';
import { extractRangeA1 } from '../../utils/range-helpers.js';

type GenerateMetaFn = (
  action: string,
  input: Record<string, unknown>,
  output: Record<string, unknown>,
  options: Record<string, unknown>
) => ResponseMeta;

export interface WorkflowDeps {
  sheetsApi: sheets_v4.Sheets;
  driveApi?: drive_v3.Drive;
  samplingServer?: SamplingServer;
  snapshotService?: SnapshotService;
  sessionContext?: SessionContextManager;
  generateMeta: GenerateMetaFn;
}

/**
 * Decomposed action handler for `audit_sheet`.
 * Preserves original behavior while moving logic out of the main CompositeHandler class.
 */
export async function handleAuditSheetAction(
  input: CompositeAuditSheetInput,
  deps: WorkflowDeps
): Promise<CompositeOutput['response']> {
  const logger = getRequestLogger();
  logger.info('Starting sheet audit', { spreadsheetId: input.spreadsheetId });

  await sendProgress(0, 3, 'Loading spreadsheet structure...');

  const spreadsheetInfo = await deps.sheetsApi.spreadsheets.get({
    spreadsheetId: input.spreadsheetId,
    fields: 'sheets.properties(sheetId,title)',
  });

  const allSheets = spreadsheetInfo.data.sheets ?? [];
  const sheetsToAudit = input.sheetName
    ? allSheets.filter((s) => s.properties?.title === input.sheetName)
    : allSheets;

  let totalCells = 0;
  let formulaCells = 0;
  let blankCells = 0;
  let dataCells = 0;
  const issues: Array<{ type: string; location: string; message: string }> = [];

  const ranges = sheetsToAudit
    .map((sheet) => sheet.properties?.title)
    .filter((title): title is string => Boolean(title));

  let valueRanges: Array<{ range?: string | null; values?: unknown[][] | null }> = [];
  if (ranges.length > 0) {
    const valuesApi = deps.sheetsApi.spreadsheets
      .values as typeof deps.sheetsApi.spreadsheets.values & {
      batchGet?: (params: {
        spreadsheetId: string;
        ranges: string[];
        valueRenderOption: 'FORMULA';
        fields: string;
      }) => Promise<{
        data: { valueRanges?: Array<{ range?: string | null; values?: unknown[][] | null }> };
      }>;
    };

    const loadIndividually = async (): Promise<
      Array<{ range?: string | null; values?: unknown[][] | null }>
    > =>
      await Promise.all(
        ranges.map(async (range) => {
          const response = await deps.sheetsApi.spreadsheets.values.get({
            spreadsheetId: input.spreadsheetId,
            range,
            valueRenderOption: 'FORMULA',
          });
          return { range, values: response.data.values };
        })
      );

    if (typeof valuesApi.batchGet === 'function') {
      try {
        const batchResponse = await valuesApi.batchGet({
          spreadsheetId: input.spreadsheetId,
          ranges,
          valueRenderOption: 'FORMULA',
          fields: 'valueRanges(range,values)',
        });

        if (batchResponse?.data?.valueRanges) {
          valueRanges = batchResponse.data.valueRanges;
        } else {
          valueRanges = await loadIndividually();
        }
      } catch {
        valueRanges = await loadIndividually();
      }
    } else {
      valueRanges = await loadIndividually();
    }
  }

  await sendProgress(1, 3, `Auditing ${sheetsToAudit.length} sheet(s)...`);

  for (let sheetIndex = 0; sheetIndex < sheetsToAudit.length; sheetIndex++) {
    const sheet = sheetsToAudit[sheetIndex];
    if (!sheet) continue;

    const sheetTitle = sheet.properties?.title ?? 'Sheet';
    const rows = valueRanges[sheetIndex]?.values ?? [];
    if (rows.length === 0) continue;

    const headers = (rows[0] as unknown[]).map((h) => String(h ?? ''));
    headers.forEach((header, colIdx) => {
      if (header.trim() === '') {
        const colLetter = String.fromCharCode(65 + colIdx);
        issues.push({
          type: 'empty_header',
          location: `${sheetTitle}!${colLetter}1`,
          message: `Column ${colLetter} has an empty header`,
        });
      }
    });

    const colTypes: Map<number, Set<string>> = new Map();

    for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
      const row = rows[rowIdx] as unknown[];
      for (let colIdx = 0; colIdx < row.length; colIdx++) {
        const cellValue = row[colIdx];
        const colLetter = String.fromCharCode(65 + colIdx);
        const cellAddr = `${sheetTitle}!${colLetter}${rowIdx + 1}`;

        totalCells++;

        if (cellValue === null || cellValue === undefined || cellValue === '') {
          blankCells++;
        } else {
          const strVal = String(cellValue);
          if (input.includeFormulas !== false && strVal.startsWith('=')) {
            formulaCells++;
          } else {
            dataCells++;
          }

          if (rowIdx > 0) {
            if (!colTypes.has(colIdx)) colTypes.set(colIdx, new Set());
            const type = typeof cellValue === 'number' ? 'number' : 'string';
            colTypes.get(colIdx)!.add(type);
            if (colTypes.get(colIdx)!.size > 1 && colTypes.get(colIdx)!.size === 2) {
              issues.push({
                type: 'mixed_types',
                location: `${sheetTitle}!${colLetter}:${colLetter}`,
                message: `Column "${headers[colIdx] ?? colLetter}" contains mixed data types (numbers and text)`,
              });
            }
          }
        }

        if (input.includeFormulas !== false && String(cellValue).startsWith('=') && rowIdx > 0) {
          const formula = String(cellValue);
          const selfRefPattern = new RegExp(`${colLetter}${rowIdx + 1}(?![0-9])`, 'i');
          if (selfRefPattern.test(formula)) {
            issues.push({
              type: 'potential_circular_ref',
              location: cellAddr,
              message: `Formula at ${cellAddr} may reference itself: ${formula}`,
            });
          }
        }
      }
    }
  }

  let aiSummary: string | undefined;
  if (deps.samplingServer && issues.length > 0) {
    const issueTypes = new Map<string, number>();
    for (const issue of issues) {
      issueTypes.set(issue.type, (issueTypes.get(issue.type) ?? 0) + 1);
    }

    const issueDesc = Array.from(issueTypes.entries())
      .map(([type, count]) => `${count} ${type}`)
      .join(', ');

    aiSummary = await generateAIInsight(
      deps.samplingServer,
      'dataAnalysis',
      `Summarize the audit findings and prioritize the most critical issues: ${issueDesc}`,
      `Total cells: ${totalCells}, Formulas: ${formulaCells}, Blank: ${blankCells}, Issues found: ${issues.length}`,
      { maxTokens: 400 }
    );
  }

  await sendProgress(
    3,
    3,
    `Audit complete: ${totalCells} cells checked, ${issues.length} issue(s) found`
  );

  recordCompositeWorkflow('audit_sheet', 'success');
  return {
    success: true as const,
    action: 'audit_sheet' as const,
    audit: {
      totalCells,
      formulaCells,
      blankCells,
      dataCells,
      sheetsAudited: sheetsToAudit.length,
      issues,
      ...(aiSummary !== undefined ? { aiSummary } : {}),
    },
    _meta: deps.generateMeta(
      'audit_sheet',
      input as unknown as Record<string, unknown>,
      { totalCells, formulaCells, sheetsAudited: sheetsToAudit.length } as Record<string, unknown>,
      {}
    ),
  };
}

/**
 * Decomposed action handler for `publish_report`.
 * Preserves original behavior while moving logic out of the main CompositeHandler class.
 */
export async function handlePublishReportAction(
  input: CompositePublishReportInput,
  deps: WorkflowDeps
): Promise<CompositeOutput['response']> {
  const logger = getRequestLogger();
  logger.info('Publishing report', { spreadsheetId: input.spreadsheetId, format: input.format });

  const generatedAt = new Date().toISOString();
  const title = input.title ?? `Report ${generatedAt.slice(0, 10)}`;
  const format = input.format ?? 'pdf';

  if (format === 'csv') {
    const valuesResponse = await deps.sheetsApi.spreadsheets.values.get({
      spreadsheetId: input.spreadsheetId,
      range: input.range ?? 'Sheet1',
      valueRenderOption: 'UNFORMATTED_VALUE',
    });

    const rows = valuesResponse.data.values ?? [];
    const csvContent = rows
      .map((row) =>
        (row as unknown[])
          .map((cell) => {
            const s = String(cell ?? '');
            if (s.includes(',') || s.includes('"') || s.includes('\n')) {
              return `"${s.replace(/"/g, '""')}"`;
            }
            return s;
          })
          .join(',')
      )
      .join('\n');

    let aiNarrative: string | undefined;
    if (deps.samplingServer && rows.length > 0) {
      const sampleData = rows.slice(0, Math.min(3, rows.length));
      const dataPreview = sampleData
        .map((row) =>
          (row as unknown[])
            .slice(0, 5)
            .map((v) => String(v ?? ''))
            .join(' | ')
        )
        .join('; ');

      aiNarrative = await generateAIInsight(
        deps.samplingServer,
        'dataAnalysis',
        'Generate a narrative summary for this report',
        `Title: ${title}, Rows: ${rows.length}, Columns: ${(rows[0] as unknown[]).length}. Sample: ${dataPreview}`,
        { maxTokens: 400 }
      );
    }

    return {
      success: true as const,
      action: 'publish_report' as const,
      report: {
        format: 'csv' as const,
        title,
        generatedAt,
        content: csvContent,
        sizeBytes: Buffer.byteLength(csvContent, 'utf8'),
        ...(aiNarrative !== undefined ? { aiNarrative } : {}),
      },
      _meta: deps.generateMeta(
        'publish_report',
        input as unknown as Record<string, unknown>,
        { format } as Record<string, unknown>,
        {}
      ),
    };
  }

  if (!deps.driveApi) {
    return {
      success: false,
      error: {
        code: ErrorCodes.FEATURE_UNAVAILABLE,
        message:
          'Drive API not available for XLSX/PDF export. Ensure OAuth authentication is configured.',
        retryable: false,
      },
    };
  }

  if (format === 'xlsx') {
    const metaResponse = await deps.driveApi.files.get({
      fileId: input.spreadsheetId,
      fields: 'name',
      supportsAllDrives: true,
    });
    const exportResponse = await deps.driveApi.files.export(
      {
        fileId: input.spreadsheetId,
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      },
      { responseType: 'arraybuffer' }
    );

    const buffer = Buffer.from(exportResponse.data as ArrayBuffer);
    const base64Content = buffer.toString('base64');

    return {
      success: true as const,
      action: 'publish_report' as const,
      report: {
        format: 'xlsx' as const,
        title: title ?? (metaResponse.data.name as string | undefined),
        generatedAt,
        content: base64Content,
        sizeBytes: buffer.length,
      },
      _meta: deps.generateMeta(
        'publish_report',
        input as unknown as Record<string, unknown>,
        { format } as Record<string, unknown>,
        {}
      ),
    };
  }

  const exportResponse = await deps.driveApi.files.export(
    {
      fileId: input.spreadsheetId,
      mimeType: 'application/pdf',
    },
    { responseType: 'arraybuffer' }
  );
  const buffer = Buffer.from(exportResponse.data as ArrayBuffer);
  const base64Content = buffer.toString('base64');

  recordCompositeWorkflow('publish_report', 'success');
  return {
    success: true as const,
    action: 'publish_report' as const,
    report: {
      format: 'pdf' as const,
      title,
      generatedAt,
      content: base64Content,
      sizeBytes: buffer.length,
    },
    _meta: deps.generateMeta(
      'publish_report',
      input as unknown as Record<string, unknown>,
      { format } as Record<string, unknown>,
      {}
    ),
  };
}

/**
 * Decomposed action handler for `data_pipeline`.
 * Preserves original behavior while moving logic out of the main CompositeHandler class.
 */
export async function handleDataPipelineAction(
  input: CompositeDataPipelineInput,
  deps: WorkflowDeps
): Promise<CompositeOutput['response']> {
  const logger = getRequestLogger();
  logger.info('Running data pipeline', {
    spreadsheetId: input.spreadsheetId,
    steps: input.steps.length,
  });

  await sendProgress(0, 3, `Loading source data for pipeline (${input.steps.length} step(s))...`);

  const valuesResponse = await deps.sheetsApi.spreadsheets.values.get({
    spreadsheetId: input.spreadsheetId,
    range: input.sourceRange,
    valueRenderOption: 'UNFORMATTED_VALUE',
  });

  const rawRows = valuesResponse.data.values ?? [];
  if (rawRows.length === 0) {
    return {
      success: true as const,
      action: 'data_pipeline' as const,
      pipeline: { stepsExecuted: 0, rowsIn: 0, rowsOut: 0, preview: [] },
    };
  }

  const headers = (rawRows[0] as unknown[]).map((h) => String(h ?? ''));
  let dataRows: unknown[][] = (rawRows.slice(1) as unknown[][]).map((r) =>
    headers.map((_, i) => r[i] ?? null)
  );
  const rowsIn = dataRows.length;

  await sendProgress(
    1,
    3,
    `Executing ${input.steps.length} pipeline step(s) on ${rowsIn} row(s)...`
  );

  let stepsExecuted = 0;
  for (const step of input.steps) {
    dataRows = applyPipelineStep(dataRows, headers, step);
    stepsExecuted++;
  }

  const outputRows: unknown[][] = [headers, ...dataRows];
  const preview = outputRows.slice(0, 5);

  if (input.outputRange && !input.dryRun) {
    const snapshot = await createSnapshotIfNeeded(
      deps.snapshotService,
      { operationType: 'data_pipeline', isDestructive: true, spreadsheetId: input.spreadsheetId },
      undefined
    );

    const outputRangeA1 = extractRangeA1(input.outputRange, 'outputRange');

    await deps.sheetsApi.spreadsheets.values.update({
      spreadsheetId: input.spreadsheetId,
      range: outputRangeA1,
      valueInputOption: 'RAW',
      requestBody: { values: outputRows as unknown[][] },
    });

    deps.sessionContext?.recordOperation({
      tool: 'sheets_composite',
      action: 'data_pipeline',
      spreadsheetId: input.spreadsheetId,
      description: `Data pipeline: ${input.steps?.length ?? 0} steps`,
      undoable: Boolean(snapshot?.snapshotId),
      snapshotId: snapshot?.snapshotId,
    });
  }

  let aiEvaluation: string | undefined;
  if (deps.samplingServer) {
    const stepTypes = input.steps.map((s) => s.type).join(', ');
    const reductionPercent =
      rowsIn > 0 ? Math.round(((rowsIn - dataRows.length) / rowsIn) * 100) : 0;

    aiEvaluation = await generateAIInsight(
      deps.samplingServer,
      'pipelineDesign',
      'Evaluate this data pipeline and suggest optimizations',
      `Steps: ${stepTypes}. Input rows: ${rowsIn}, output rows: ${dataRows.length} (${reductionPercent}% reduction).`,
      { maxTokens: 300 }
    );
  }

  await sendProgress(
    3,
    3,
    `Pipeline complete: ${stepsExecuted} step(s), ${rowsIn} → ${dataRows.length} row(s)`
  );

  recordCompositeWorkflow('data_pipeline', 'success');
  return {
    success: true as const,
    action: 'data_pipeline' as const,
    pipeline: {
      stepsExecuted,
      rowsIn,
      rowsOut: dataRows.length,
      preview,
      ...(aiEvaluation !== undefined ? { aiEvaluation } : {}),
    },
    _meta: deps.generateMeta(
      'data_pipeline',
      input as unknown as Record<string, unknown>,
      { rowsIn, rowsOut: dataRows.length, stepsExecuted } as Record<string, unknown>,
      {}
    ),
  };
}

/**
 * Decomposed action handler for `instantiate_template`.
 * Preserves original behavior while moving logic out of the main CompositeHandler class.
 */
export async function handleInstantiateTemplateAction(
  input: CompositeInstantiateTemplateInput,
  deps: WorkflowDeps
): Promise<CompositeOutput['response']> {
  const logger = getRequestLogger();
  logger.info('Instantiating template', { templateId: input.templateId });

  const templateSheetInfo = await deps.sheetsApi.spreadsheets.get({
    spreadsheetId: input.templateId,
    fields: 'sheets.properties(sheetId,title)',
  });

  const templateSheets = templateSheetInfo.data.sheets ?? [];
  const firstSheet = templateSheets[0];
  const templateSheetName = firstSheet?.properties?.title ?? 'Sheet1';

  const valuesResponse = await deps.sheetsApi.spreadsheets.values.get({
    spreadsheetId: input.templateId,
    range: input.targetSheetName ?? templateSheetName,
    valueRenderOption: 'UNFORMATTED_VALUE',
  });

  const templateRows = valuesResponse.data.values ?? [];

  let substitutionsApplied = 0;
  const substitutedRows = templateRows.map((row) =>
    (row as unknown[]).map((cell) => {
      if (typeof cell !== 'string') return cell;
      let result = cell;
      for (const [varName, varValue] of Object.entries(input.variables)) {
        const pattern = new RegExp(`\\{\\{${varName}\\}\\}`, 'g');
        const prev = result;
        result = result.replace(pattern, varValue);
        if (result !== prev) substitutionsApplied++;
      }
      return result;
    })
  );

  let targetSpreadsheetId = input.targetSpreadsheetId;
  const targetSheetName = input.targetSheetName ?? templateSheetName;

  if (!targetSpreadsheetId) {
    const createResponse = await deps.sheetsApi.spreadsheets.create({
      requestBody: {
        properties: { title: `${templateSheetName} (Instance)` },
        sheets: [{ properties: { title: targetSheetName } }],
      },
    });
    targetSpreadsheetId = createResponse.data.spreadsheetId!;
  }

  const snapshot = await createSnapshotIfNeeded(
    deps.snapshotService,
    {
      operationType: 'instantiate_template',
      isDestructive: true,
      spreadsheetId: targetSpreadsheetId,
    },
    undefined
  );

  const cellsUpdated = substitutedRows.reduce((sum, row) => sum + row.length, 0);
  await deps.sheetsApi.spreadsheets.values.update({
    spreadsheetId: targetSpreadsheetId,
    range: `'${targetSheetName}'!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: substitutedRows as unknown[][] },
  });

  deps.sessionContext?.recordOperation({
    tool: 'sheets_composite',
    action: 'instantiate_template',
    spreadsheetId: targetSpreadsheetId,
    description: `Instantiated template ${input.templateId}`,
    undoable: Boolean(snapshot?.snapshotId),
    snapshotId: snapshot?.snapshotId,
  });

  recordCompositeWorkflow('instantiate_template', 'success');
  return {
    success: true as const,
    action: 'instantiate_template' as const,
    instantiation: {
      spreadsheetId: targetSpreadsheetId,
      sheetName: targetSheetName,
      substitutionsApplied,
      cellsUpdated,
    },
    _meta: deps.generateMeta(
      'instantiate_template',
      input as unknown as Record<string, unknown>,
      { substitutionsApplied, cellsUpdated } as Record<string, unknown>,
      {}
    ),
  };
}

/**
 * Decomposed action handler for `migrate_spreadsheet`.
 * Preserves original behavior while moving logic out of the main CompositeHandler class.
 */
export async function handleMigrateSpreadsheetAction(
  input: CompositeMigrateSpreadsheetInput,
  deps: WorkflowDeps
): Promise<CompositeOutput['response']> {
  const logger = getRequestLogger();
  logger.info('Migrating spreadsheet', {
    source: input.sourceSpreadsheetId,
    destination: input.destinationSpreadsheetId,
  });

  await sendProgress(0, 3, `Loading source data from spreadsheet ${input.sourceSpreadsheetId}...`);

  const valuesResponse = await deps.sheetsApi.spreadsheets.values.get({
    spreadsheetId: input.sourceSpreadsheetId,
    range: input.sourceRange,
    valueRenderOption: 'UNFORMATTED_VALUE',
  });

  const rawRows = valuesResponse.data.values ?? [];
  if (rawRows.length === 0) {
    return {
      success: true as const,
      action: 'migrate_spreadsheet' as const,
      migration: {
        rowsMigrated: 0,
        columnsMapped: input.columnMapping.length,
        destinationRange: input.destinationRange,
        preview: [],
      },
    };
  }

  const sourceHeaders = (rawRows[0] as unknown[]).map((h) => String(h ?? ''));
  const sourceDataRows = rawRows.slice(1) as unknown[][];

  const getSourceColIdx = (colName: string): number => {
    const byName = sourceHeaders.indexOf(colName);
    if (byName >= 0) return byName;
    const byIndex = parseInt(colName, 10);
    return isNaN(byIndex) ? -1 : byIndex;
  };

  await sendProgress(
    1,
    3,
    `Mapping ${input.columnMapping.length} column(s) for ${sourceDataRows.length} row(s)...`
  );

  const destHeaders = input.columnMapping.map((m) => m.destinationColumn);
  const migratedRows = sourceDataRows.map((row) =>
    input.columnMapping.map((mapping) => {
      const srcIdx = getSourceColIdx(mapping.sourceColumn);
      const rawValue = srcIdx >= 0 ? row[srcIdx] : null;
      return applyTransform(rawValue, mapping.transform ?? 'none');
    })
  );

  const outputRows: unknown[][] = [destHeaders, ...migratedRows];
  const preview = migratedRows.slice(0, 3);

  if (!input.dryRun) {
    const snapshot = await createSnapshotIfNeeded(
      deps.snapshotService,
      {
        operationType: 'migrate_spreadsheet',
        isDestructive: true,
        spreadsheetId: input.destinationSpreadsheetId,
      },
      undefined
    );

    if (input.appendMode ?? true) {
      await deps.sheetsApi.spreadsheets.values.append({
        spreadsheetId: input.destinationSpreadsheetId,
        range: input.destinationRange,
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: migratedRows as unknown[][] },
      });
    } else {
      await deps.sheetsApi.spreadsheets.values.update({
        spreadsheetId: input.destinationSpreadsheetId,
        range: input.destinationRange,
        valueInputOption: 'RAW',
        requestBody: { values: outputRows as unknown[][] },
      });
    }

    deps.sessionContext?.recordOperation({
      tool: 'sheets_composite',
      action: 'migrate_spreadsheet',
      spreadsheetId: input.sourceSpreadsheetId,
      description: `Migrated to ${input.destinationSpreadsheetId}`,
      undoable: false,
      snapshotId: snapshot?.snapshotId,
    });
  }

  await sendProgress(
    3,
    3,
    `Migration complete: ${migratedRows.length} row(s), ${input.columnMapping.length} column(s) mapped`
  );

  recordCompositeWorkflow('migrate_spreadsheet', 'success');
  return {
    success: true as const,
    action: 'migrate_spreadsheet' as const,
    migration: {
      rowsMigrated: migratedRows.length,
      columnsMapped: input.columnMapping.length,
      destinationRange: input.destinationRange,
      preview,
    },
    _meta: deps.generateMeta(
      'migrate_spreadsheet',
      input as unknown as Record<string, unknown>,
      { rowsMigrated: migratedRows.length, columnsMapped: input.columnMapping.length } as Record<
        string,
        unknown
      >,
      { cellsAffected: migratedRows.length * input.columnMapping.length }
    ),
  };
}

function applyPipelineStep(rows: unknown[][], headers: string[], step: PipelineStep): unknown[][] {
  const config = step.config as Record<string, unknown>;
  const colIdx = (colName: string): number => {
    const idx = headers.indexOf(String(colName));
    return idx >= 0 ? idx : parseInt(String(colName), 10);
  };

  switch (step.type) {
    case 'filter': {
      const col = colIdx(String(config['column'] ?? ''));
      const value = config['value'];
      const operator = String(config['operator'] ?? 'equals');
      return rows.filter((row) => {
        const cell = row[col];
        if (operator === 'contains') return String(cell ?? '').includes(String(value ?? ''));
        return String(cell ?? '') === String(value ?? '');
      });
    }
    case 'sort': {
      const col = colIdx(String(config['column'] ?? ''));
      const order = String(config['order'] ?? 'asc');
      return [...rows].sort((a, b) => {
        const av = a[col];
        const bv = b[col];
        const aNum = Number(av);
        const bNum = Number(bv);
        const aVal = isNaN(aNum) ? String(av ?? '') : aNum;
        const bVal = isNaN(bNum) ? String(bv ?? '') : bNum;
        if (aVal < bVal) return order === 'asc' ? -1 : 1;
        if (aVal > bVal) return order === 'asc' ? 1 : -1;
        return 0;
      });
    }
    case 'deduplicate': {
      const rawCols = config['columns'];
      const cols = Array.isArray(rawCols)
        ? (rawCols as unknown[]).map((c) => colIdx(String(c)))
        : [colIdx(String(config['column'] ?? ''))];
      const seen = new Set<string>();
      return rows.filter((row) => {
        const key = cols.map((c) => String(row[c] ?? '')).join('\x00');
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }
    case 'transform': {
      const col = colIdx(String(config['column'] ?? ''));
      const formulaTemplate = String(config['formula'] ?? '');
      return rows.map((row) => {
        const newRow = [...row];
        const currentValue: unknown = row[col];
        let result = formulaTemplate;
        headers.forEach((header, i) => {
          result = result.replace(new RegExp(`\\{${header}\\}`, 'g'), String(row[i] ?? ''));
        });
        newRow[col] = result !== formulaTemplate ? result : currentValue;
        return newRow;
      });
    }
    case 'aggregate': {
      const groupByCol = colIdx(String(config['groupBy'] ?? ''));
      const aggCol = colIdx(String(config['column'] ?? ''));
      const aggregation = String(config['aggregation'] ?? 'sum');
      const groups = new Map<string, number[]>();
      for (const row of rows) {
        const key = String(row[groupByCol] ?? '');
        if (!groups.has(key)) groups.set(key, []);
        const num = Number(row[aggCol] ?? 0);
        if (!isNaN(num)) groups.get(key)!.push(num);
      }
      return Array.from(groups.entries()).map(([groupKey, values]) => {
        const newRow: unknown[] = headers.map(() => null);
        newRow[groupByCol] = groupKey;
        if (aggregation === 'sum') newRow[aggCol] = values.reduce((a, b) => a + b, 0);
        else if (aggregation === 'count') newRow[aggCol] = values.length;
        else if (aggregation === 'avg') {
          newRow[aggCol] =
            values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0;
        } else if (aggregation === 'min') {
          newRow[aggCol] = Math.min(...values);
        } else if (aggregation === 'max') {
          newRow[aggCol] = Math.max(...values);
        }
        return newRow;
      });
    }
    default:
      return rows;
  }
}

function applyTransform(value: unknown, transform: ColumnMapping['transform']): unknown {
  if (value === null || value === undefined || value === '') return value;

  const s = String(value);
  switch (transform) {
    case 'uppercase':
      return s.toUpperCase();
    case 'lowercase':
      return s.toLowerCase();
    case 'number': {
      const n = parseFloat(s);
      return isNaN(n) ? value : n;
    }
    case 'date': {
      const d = new Date(s);
      return isNaN(d.getTime()) ? value : d.toISOString();
    }
    default:
      return value;
  }
}
