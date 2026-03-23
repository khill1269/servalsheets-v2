import type { sheets_v4 } from 'googleapis';
import { getRequestLogger, sendProgress } from '../../utils/request-context.js';
import { ServiceError } from '../../core/errors.js';
import { generateDefinition, executeDefinition } from '../../services/sheet-generator.js';
import type {
  CompositeGenerateSheetInput,
  CompositeGenerateTemplateInput,
  CompositePreviewGenerationInput,
  CompositeOutput,
} from '../../schemas/composite.js';
import type { SamplingServer } from '../../mcp/sampling.js';
import { recordGenerationRequest } from '../../observability/metrics.js';

export interface GenerationDeps {
  sheetsApi?: sheets_v4.Sheets;
  samplingServer?: SamplingServer;
  abortSignal?: AbortSignal;
}

/**
 * Decomposed action handler for `generate_sheet`.
 * Preserves original behavior while moving logic out of the main CompositeHandler class.
 */
export async function handleGenerateSheetAction(
  input: CompositeGenerateSheetInput,
  deps: GenerationDeps
): Promise<CompositeOutput['response']> {
  const logger = getRequestLogger();
  logger.info('Generating sheet from description', {
    description: input.description.slice(0, 80),
  });

  await sendProgress(0, 3, 'Designing spreadsheet structure...');
  if (deps.abortSignal?.aborted) {
    throw new ServiceError(
      'Operation cancelled by client',
      'OPERATION_CANCELLED',
      'composite',
      false
    );
  }

  const definition = await generateDefinition(
    input.description,
    {
      context: input.context,
      style: input.style,
      spreadsheetId: input.spreadsheetId,
      sheetName: input.sheetName,
    },
    deps.samplingServer
  );

  if (input.safety?.dryRun) {
    recordGenerationRequest('generate_sheet', 'success');
    return {
      success: true,
      action: 'generate_sheet',
      spreadsheetId: '',
      spreadsheetUrl: '',
      title: definition.title,
      sheetsCreated: definition.sheets.length,
      columnsCreated: definition.sheets.reduce((sum, s) => sum + s.columns.length, 0),
      rowsCreated: 0,
      formulasApplied: 0,
      formattingApplied: false,
      definition,
    };
  }

  await sendProgress(1, 3, 'Creating spreadsheet...');
  if (deps.abortSignal?.aborted) {
    throw new ServiceError(
      'Operation cancelled by client',
      'OPERATION_CANCELLED',
      'composite',
      false
    );
  }

  if (!deps.sheetsApi) {
    throw new ServiceError(
      'Google Sheets API client is required to create spreadsheets',
      'AUTHENTICATION_REQUIRED',
      'composite',
      false
    );
  }

  const result = await executeDefinition(deps.sheetsApi, definition, input.spreadsheetId);

  await sendProgress(3, 3, 'Complete');

  recordGenerationRequest('generate_sheet', 'success');
  return {
    success: true,
    action: 'generate_sheet',
    ...result,
  };
}

/**
 * Decomposed action handler for `generate_template`.
 * Preserves original behavior while moving logic out of the main CompositeHandler class.
 */
export async function handleGenerateTemplateAction(
  input: CompositeGenerateTemplateInput,
  deps: GenerationDeps
): Promise<CompositeOutput['response']> {
  const logger = getRequestLogger();
  logger.info('Generating template from description', {
    description: input.description.slice(0, 80),
  });

  const definition = await generateDefinition(
    input.description,
    { style: input.style },
    deps.samplingServer
  );

  const templateId = `tpl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const name = definition.title;

  if (input.parameterize) {
    for (const sheet of definition.sheets) {
      for (const col of sheet.columns) {
        if (col.type === 'text') {
          col.header = `{{${col.header.toLowerCase().replace(/\s+/g, '_')}}}`;
        }
      }
    }
  }

  const parameters = input.parameterize
    ? definition.sheets.flatMap((s) =>
        s.columns.filter((c) => c.header.startsWith('{{')).map((c) => c.header.replace(/[{}]/g, ''))
      )
    : undefined;

  recordGenerationRequest('generate_template', 'success');
  return {
    success: true,
    action: 'generate_template',
    templateId,
    name,
    sheetsCount: definition.sheets.length,
    columnsCount: definition.sheets.reduce((sum, s) => sum + s.columns.length, 0),
    parameters,
    definition,
  };
}

/**
 * Decomposed action handler for `preview_generation`.
 * Preserves original behavior while moving logic out of the main CompositeHandler class.
 */
export async function handlePreviewGenerationAction(
  input: CompositePreviewGenerationInput,
  deps: GenerationDeps
): Promise<CompositeOutput['response']> {
  const logger = getRequestLogger();
  logger.info('Previewing generation', { description: input.description.slice(0, 80) });

  const definition = await generateDefinition(
    input.description,
    {
      context: input.context,
      style: input.style,
    },
    deps.samplingServer
  );

  const estimatedCells = definition.sheets.reduce(
    (sum, s) => sum + s.columns.length * Math.max(s.rows?.length ?? 0, 10),
    0
  );
  const estimatedFormulas = definition.sheets.reduce(
    (sum, s) => sum + s.columns.filter((c) => c.formula).length * Math.max(s.rows?.length ?? 0, 10),
    0
  );

  const formattingPreview: string[] = [];
  for (const sheet of definition.sheets) {
    if (sheet.formatting?.headerStyle) {
      formattingPreview.push(`${sheet.name}: Header style "${sheet.formatting.headerStyle}"`);
    }
    if (sheet.formatting?.freezeRows) {
      formattingPreview.push(`${sheet.name}: Freeze top ${sheet.formatting.freezeRows} row(s)`);
    }
    if (sheet.formatting?.alternatingRows) {
      formattingPreview.push(`${sheet.name}: Alternating row colors`);
    }
    if (sheet.formatting?.conditionalRules?.length) {
      formattingPreview.push(
        `${sheet.name}: ${sheet.formatting.conditionalRules.length} conditional formatting rule(s)`
      );
    }
    for (const col of sheet.columns) {
      if (col.type === 'currency' || col.type === 'percentage') {
        formattingPreview.push(`${sheet.name}: Column "${col.header}" formatted as ${col.type}`);
      }
    }
  }

  recordGenerationRequest('preview_generation', 'success');
  return {
    success: true,
    action: 'preview_generation',
    definition,
    estimatedCells,
    estimatedFormulas,
    formattingPreview,
  };
}
