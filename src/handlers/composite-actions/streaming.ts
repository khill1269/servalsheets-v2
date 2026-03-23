import type { sheets_v4 } from 'googleapis';
import type { HandlerContext } from '../base.js';
import type { CompositeExportLargeDatasetInput, CompositeOutput } from '../../schemas/composite.js';
import type { ResponseMeta } from '../../schemas/shared.js';
import { getRequestLogger } from '../../utils/request-context.js';
import { readDataInChunks, formatBytes } from '../../utils/streaming-export.js';

type GenerateMetaFn = (
  action: string,
  input: Record<string, unknown>,
  output: Record<string, unknown>,
  options: Record<string, unknown>
) => ResponseMeta;

export interface StreamingDeps {
  sheetsApi: sheets_v4.Sheets;
  taskStore?: HandlerContext['taskStore'];
  generateMeta: GenerateMetaFn;
  mapError: (error: unknown) => CompositeOutput['response'];
}

/**
 * Decomposed action handler for `export_large_dataset`.
 * Preserves original behavior while moving logic out of the main CompositeHandler class.
 */
export async function handleExportLargeDatasetAction(
  input: CompositeExportLargeDatasetInput,
  deps: StreamingDeps
): Promise<CompositeOutput['response']> {
  const logger = getRequestLogger();

  logger.info('Starting large dataset export', {
    spreadsheetId: input.spreadsheetId,
    range: input.range,
    chunkSize: input.chunkSize,
    format: input.format,
  });

  try {
    const result = await readDataInChunks(deps.sheetsApi, input.spreadsheetId, input.range, {
      chunkSize: input.chunkSize,
      enableProgress: true,
      streamingThreshold: input.chunkSize ? 1 : undefined,
    });

    let formattedData: string;
    if (input.format === 'csv') {
      formattedData = result.data
        .map((row) =>
          row
            .map((cell) => {
              const cellStr = String(cell ?? '');
              const escaped = cellStr.replace(/"/g, '""');
              if (cellStr.includes(',') || cellStr.includes('\n')) {
                return `"${escaped}"`;
              }
              return escaped;
            })
            .join(',')
        )
        .join('\n');
    } else {
      formattedData = JSON.stringify(result.data);
    }

    logger.info('Large dataset export complete', {
      totalRows: result.stats.totalRows,
      totalColumns: result.stats.totalColumns,
      chunksProcessed: result.stats.chunksProcessed,
      bytesProcessed: formatBytes(result.stats.bytesProcessed),
      durationMs: result.stats.durationMs,
      streamed: result.streamed,
    });

    return {
      success: true as const,
      action: 'export_large_dataset' as const,
      format: input.format ?? 'json',
      chunkSize: input.chunkSize,
      totalRows: result.stats.totalRows,
      totalColumns: result.stats.totalColumns,
      chunksProcessed: result.stats.chunksProcessed,
      bytesProcessed: result.stats.bytesProcessed,
      durationMs: result.stats.durationMs,
      streamed: result.streamed,
      data: formattedData,
      _meta: deps.generateMeta(
        'export_large_dataset',
        input as unknown as Record<string, unknown>,
        {
          totalRows: result.stats.totalRows,
          bytesProcessed: result.stats.bytesProcessed,
        } as Record<string, unknown>,
        {}
      ),
    };
  } catch (error) {
    logger.error('Large dataset export failed', { error, spreadsheetId: input.spreadsheetId });
    return deps.mapError(error);
  }
}
