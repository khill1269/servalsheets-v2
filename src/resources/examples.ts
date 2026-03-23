/**
 * ServalSheets - Action Examples Library
 *
 * Provides concrete code examples for common ServalSheets patterns:
 * - Basic CRUD operations
 * - Batch operations
 * - Transaction patterns
 * - Composite workflows
 * - Error handling
 *
 * These examples help AI agents understand practical usage
 * patterns and best practices for ServalSheets actions.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { NotFoundError } from '../core/errors.js';

/**
 * Register examples library resources
 */
export function registerExamplesResources(server: McpServer): void {
  // Basic operations examples
  server.registerResource(
    'Basic Operations Examples',
    'servalsheets://examples/basic-operations',
    {
      description:
        'Examples for basic CRUD operations: create spreadsheet, read/write data, format cells, manage sheets.',
      mimeType: 'application/json',
    },
    async (uri) => readExamplesResource(typeof uri === 'string' ? uri : uri.toString())
  );

  // Batch operations examples
  server.registerResource(
    'Batch Operations Examples',
    'servalsheets://examples/batch-operations',
    {
      description:
        'Examples for batch operations: batch_read, batch_write, bulk updates, and quota optimization patterns.',
      mimeType: 'application/json',
    },
    async (uri) => readExamplesResource(typeof uri === 'string' ? uri : uri.toString())
  );

  // Transaction examples
  server.registerResource(
    'Transaction Examples',
    'servalsheets://examples/transactions',
    {
      description:
        'Examples for using transactions: atomicity, rollback, quota optimization, and multi-step operations.',
      mimeType: 'application/json',
    },
    async (uri) => readExamplesResource(typeof uri === 'string' ? uri : uri.toString())
  );

  // Composite workflow examples
  server.registerResource(
    'Composite Workflow Examples',
    'servalsheets://examples/composite-workflows',
    {
      description:
        'Examples for composite operations: import_csv, smart_append, bulk_update, deduplicate, and optimized workflows.',
      mimeType: 'application/json',
    },
    async (uri) => readExamplesResource(typeof uri === 'string' ? uri : uri.toString())
  );

  // Analysis and visualization examples
  server.registerResource(
    'Analysis and Visualization Examples',
    'servalsheets://examples/analysis-visualization',
    {
      description:
        'Examples for data analysis and visualization: comprehensive analysis, chart creation, pivot tables, data quality checks.',
      mimeType: 'application/json',
    },
    async (uri) => readExamplesResource(typeof uri === 'string' ? uri : uri.toString())
  );

  // Comparative examples - trade-off analysis
  server.registerResource(
    'Comparative Examples (Trade-off Analysis)',
    'servalsheets://examples/comparative-tradeoffs',
    {
      description:
        'Comparative examples showing multiple approaches with trade-offs for key operations: bulk updates, large reads, calculations, quality checks.',
      mimeType: 'application/json',
    },
    async (uri) => readExamplesResource(typeof uri === 'string' ? uri : uri.toString())
  );
}

/**
 * Read examples resource content
 */
export async function readExamplesResource(uri: string): Promise<{
  contents: Array<{ uri: string; mimeType?: string; text: string }>;
}> {
  const resourceId = uri.replace('servalsheets://examples/', '');

  const examples: Record<string, unknown> = {
    'basic-operations': {
      title: 'Basic Operations Examples',
      description: 'Common patterns for everyday spreadsheet operations',
      examples: [
        {
          name: 'Create a new spreadsheet',
          tool: 'sheets_core',
          action: 'create',
          code: {
            action: 'create',
            title: 'Sales Data 2026',
            sheets: [{ title: 'Q1 Sales' }, { title: 'Q2 Sales' }],
          },
          result: {
            spreadsheetId: '1abc...',
            spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/1abc...',
            sheets: [
              { sheetId: 0, title: 'Q1 Sales' },
              { sheetId: 1, title: 'Q2 Sales' },
            ],
          },
          notes:
            'Creates a new spreadsheet with two sheets. Returns spreadsheet ID for subsequent operations.',
        },
        {
          name: 'Read data from a range',
          tool: 'sheets_data',
          action: 'read',
          code: {
            action: 'read',
            spreadsheetId: '1abc...',
            range: 'Q1 Sales!A1:D10',
          },
          result: {
            values: [
              ['Date', 'Product', 'Quantity', 'Revenue'],
              ['2026-01-01', 'Widget A', 10, 100],
              ['2026-01-02', 'Widget B', 15, 225],
            ],
            range: 'Q1 Sales!A1:D10',
          },
          notes: 'Reads cell values from specified range. Returns 2D array of values.',
        },
        {
          name: 'Write data to cells',
          tool: 'sheets_data',
          action: 'write',
          code: {
            action: 'write',
            spreadsheetId: '1abc...',
            range: 'Q1 Sales!A1:C2',
            values: [
              ['Name', 'Email', 'Status'],
              ['John Doe', 'john@example.com', 'Active'],
            ],
          },
          result: {
            updatedRange: 'Q1 Sales!A1:C2',
            updatedRows: 2,
            updatedColumns: 3,
            updatedCells: 6,
          },
          notes: 'Writes values to specified range. Overwrites existing data.',
        },
        {
          name: 'Format cells with bold and color',
          tool: 'sheets_format',
          action: 'format_cells',
          code: {
            action: 'format_cells',
            spreadsheetId: '1abc...',
            range: 'Q1 Sales!A1:D1',
            format: {
              textFormat: { bold: true, fontSize: 12 },
              backgroundColor: { red: 0.85, green: 0.85, blue: 0.85 },
            },
          },
          result: {
            success: true,
            updatedCells: 4,
          },
          notes: 'Applies formatting to header row. Use RGB values 0-1 (not 0-255).',
        },
        {
          name: 'Add a new sheet',
          tool: 'sheets_core',
          action: 'add_sheet',
          code: {
            action: 'add_sheet',
            spreadsheetId: '1abc...',
            title: 'Q3 Sales',
            index: 2,
          },
          result: {
            sheetId: 123456,
            title: 'Q3 Sales',
            index: 2,
          },
          notes: 'Adds new sheet at specified index. Returns sheet ID for subsequent operations.',
        },
      ],
    },

    'batch-operations': {
      title: 'Batch Operations Examples',
      description: 'Quota-optimized patterns for multiple operations',
      examples: [
        {
          name: 'Batch read from multiple ranges',
          tool: 'sheets_data',
          action: 'batch_read',
          code: {
            action: 'batch_read',
            spreadsheetId: '1abc...',
            ranges: ['Sheet1!A1:B10', 'Sheet2!C5:D15', 'Sheet3!E1:F100'],
          },
          result: {
            valueRanges: [
              {
                range: 'Sheet1!A1:B10',
                values: [
                  [1, 2],
                  [3, 4],
                ],
              },
              {
                range: 'Sheet2!C5:D15',
                values: [
                  [5, 6],
                  [7, 8],
                ],
              },
              { range: 'Sheet3!E1:F100', values: [[9, 10]] },
            ],
          },
          quotaSavings: '3 API calls → 1 API call (66% reduction)',
          notes: 'Reads multiple non-contiguous ranges in a single API call.',
        },
        {
          name: 'Batch write to multiple ranges',
          tool: 'sheets_data',
          action: 'batch_write',
          code: {
            action: 'batch_write',
            spreadsheetId: '1abc...',
            data: [
              { range: 'Sheet1!A1', values: [['Header 1']] },
              { range: 'Sheet1!B1', values: [['Header 2']] },
              { range: 'Sheet1!C1', values: [['Header 3']] },
            ],
          },
          result: {
            totalUpdatedCells: 3,
            totalUpdatedRows: 1,
            responses: [
              { range: 'Sheet1!A1', updatedCells: 1 },
              { range: 'Sheet1!B1', updatedCells: 1 },
              { range: 'Sheet1!C1', updatedCells: 1 },
            ],
          },
          quotaSavings: '3 write calls → 1 batch write (66% reduction)',
          notes: 'Writes to multiple ranges in a single API call.',
        },
        {
          name: 'Read and process with batch',
          tool: 'sheets_data',
          action: 'batch_read + local processing',
          workflow: [
            {
              step: 1,
              description: 'Batch read data from multiple sheets',
              code: {
                action: 'batch_read',
                spreadsheetId: '1abc...',
                ranges: ['Sales!A:A', 'Costs!A:A', 'Profit!A:A'],
              },
            },
            {
              step: 2,
              description: 'Process data locally (0 API calls)',
              pseudocode: 'const totals = ranges.map(r => sum(r.values))',
            },
            {
              step: 3,
              description: 'Write summary with single write',
              code: {
                action: 'write',
                spreadsheetId: '1abc...',
                range: 'Summary!A1:C1',
                values: '[[salesTotal, costsTotal, profitTotal]]',
              },
            },
          ],
          totalAPICalls: 2,
          naiveAPICalls: '300+ (read all rows individually)',
          quotaSavings: '99% reduction',
          notes: 'Process data locally between batch read and write for maximum efficiency.',
        },
      ],
    },

    transactions: {
      title: 'Transaction Examples',
      description: 'Atomic multi-operation patterns with automatic rollback',
      examples: [
        {
          name: 'Simple transaction with rollback',
          tool: 'sheets_transaction',
          workflow: [
            {
              step: 1,
              action: 'begin',
              code: {
                action: 'begin',
                spreadsheetId: '1abc...',
              },
              result: { transactionId: 'txn_123', status: 'active' },
            },
            {
              step: 2,
              action: 'queue',
              code: {
                action: 'queue',
                operation: {
                  type: 'write',
                  range: 'Sheet1!A1',
                  values: [[100]],
                },
              },
            },
            {
              step: 3,
              action: 'queue',
              code: {
                action: 'queue',
                operation: {
                  type: 'write',
                  range: 'Sheet1!B1',
                  values: [[200]],
                },
              },
            },
            {
              step: 4,
              action: 'commit',
              code: {
                action: 'commit',
              },
              result: { success: true, operationsExecuted: 2 },
            },
          ],
          quotaCost: '2 API calls (begin + commit)',
          atomicity: 'If any operation fails, all are rolled back automatically',
          notes: 'Use transactions for related operations that must succeed or fail together.',
        },
        {
          name: 'Transaction with error and rollback',
          tool: 'sheets_transaction',
          workflow: [
            {
              step: 1,
              description: 'Begin transaction',
              code: { action: 'begin', spreadsheetId: '1abc...' },
            },
            {
              step: 2,
              description: 'Queue valid operation',
              code: {
                action: 'queue',
                operation: { type: 'write', range: 'A1', values: [[1]] },
              },
            },
            {
              step: 3,
              description: 'Queue invalid operation (triggers error)',
              code: {
                action: 'queue',
                operation: { type: 'write', range: 'InvalidSheet!A1', values: [[2]] },
              },
            },
            {
              step: 4,
              description: 'Commit fails, automatic rollback',
              code: { action: 'commit' },
              result: {
                success: false,
                error: 'Sheet "InvalidSheet" not found',
                rollbackExecuted: true,
              },
            },
          ],
          outcome: 'No changes applied - transaction rolled back',
          notes: 'Transactions automatically rollback on any error, maintaining data consistency.',
        },
        {
          name: 'Multi-sheet update with transaction',
          tool: 'sheets_transaction',
          scenario: 'Update inventory, pricing, and totals atomically',
          workflow: [
            {
              step: 1,
              code: { action: 'begin', spreadsheetId: '1abc...' },
            },
            {
              step: 2,
              description: 'Update inventory',
              code: {
                action: 'queue',
                operation: {
                  type: 'write',
                  range: 'Inventory!B2',
                  values: [[50]],
                },
              },
            },
            {
              step: 3,
              description: 'Update pricing',
              code: {
                action: 'queue',
                operation: {
                  type: 'write',
                  range: 'Pricing!C3',
                  values: [[29.99]],
                },
              },
            },
            {
              step: 4,
              description: 'Update totals with formula',
              code: {
                action: 'queue',
                operation: {
                  type: 'write',
                  range: 'Summary!D4',
                  values: [['=Inventory!B2 * Pricing!C3']],
                },
              },
            },
            {
              step: 5,
              code: { action: 'commit' },
              result: { success: true, operationsExecuted: 3 },
            },
          ],
          benefits: [
            'Atomicity: All updates succeed or none do',
            'Quota optimization: 3 writes → 1 API call (66% savings)',
            'Data consistency: Related values stay synchronized',
          ],
        },
      ],
    },

    'composite-workflows': {
      title: 'Composite Workflow Examples',
      description: 'Pre-optimized patterns for common workflows',
      examples: [
        {
          name: 'Import CSV file',
          tool: 'sheets_composite',
          action: 'import_csv',
          code: {
            action: 'import_csv',
            spreadsheetId: '1abc...',
            sheetName: 'Data',
            csvData:
              'Name,Email,Status\nJohn Doe,john@example.com,Active\nJane Smith,jane@example.com,Inactive',
            mode: 'append',
            hasHeaders: true,
          },
          result: {
            success: true,
            rowsImported: 2,
            startRow: 5,
            endRow: 6,
          },
          internalOptimizations: [
            'Parses CSV locally (0 API calls)',
            'Finds last row with cached metadata (0-1 API call)',
            'Batch writes all rows (1 API call)',
          ],
          totalAPICalls: '1-2 API calls',
          naiveAPICalls: '100+ API calls (row-by-row append)',
          quotaSavings: '98% reduction',
          notes: 'Automatically handles CSV parsing, header detection, and optimized insertion.',
        },
        {
          name: 'Smart append with auto-detection',
          tool: 'sheets_composite',
          action: 'smart_append',
          code: {
            action: 'smart_append',
            spreadsheetId: '1abc...',
            sheetName: 'Logs',
            values: [
              ['2026-01-15T10:30:00Z', 'User login', 'john@example.com'],
              ['2026-01-15T10:31:00Z', 'Page view', '/dashboard'],
            ],
          },
          result: {
            success: true,
            appendedRange: 'Logs!A147:C148',
            rowsAdded: 2,
          },
          internalOptimizations: [
            'Finds last row (1 API call, cached for 60s)',
            'Appends data (1 API call)',
          ],
          totalAPICalls: '1-2 API calls',
          notes:
            'Automatically finds last row and appends data. Cache reduces API calls on repeated appends.',
        },
        {
          name: 'Bulk conditional update',
          tool: 'sheets_composite',
          action: 'bulk_update',
          code: {
            action: 'bulk_update',
            spreadsheetId: '1abc...',
            sheetName: 'Orders',
            updates: [
              { column: 'Status', oldValue: 'Pending', newValue: 'Processing' },
              { column: 'Priority', oldValue: 'Low', newValue: 'Medium' },
            ],
          },
          result: {
            success: true,
            matchesFound: 45,
            cellsUpdated: 45,
            affectedRows: [2, 5, 7, 10, 15],
          },
          internalOptimizations: [
            'Reads data once (1 API call)',
            'Finds matches locally (0 API calls)',
            'Batch writes all updates (1 API call)',
          ],
          totalAPICalls: 2,
          naiveAPICalls: '45+ API calls (individual updates)',
          quotaSavings: '95% reduction',
          notes: 'Efficiently finds and updates multiple cells matching conditions.',
        },
        {
          name: 'Deduplicate data',
          tool: 'sheets_composite',
          action: 'deduplicate',
          code: {
            action: 'deduplicate',
            spreadsheetId: '1abc...',
            sheetName: 'Contacts',
            keyColumns: ['Email'],
            keepFirst: true,
          },
          result: {
            success: true,
            totalRows: 500,
            duplicatesFound: 47,
            duplicatesRemoved: 47,
            uniqueRowsRemaining: 453,
          },
          internalOptimizations: [
            'Reads all data (1 API call)',
            'Identifies duplicates locally (0 API calls)',
            'Deletes duplicate rows in batch (1 API call)',
          ],
          totalAPICalls: 2,
          notes: 'Removes duplicate rows based on key columns. Preserves first or last occurrence.',
        },
      ],
    },

    'analysis-visualization': {
      title: 'Analysis and Visualization Examples',
      description: 'Data analysis and chart creation patterns',
      examples: [
        {
          name: 'Comprehensive data analysis',
          tool: 'sheets_analyze',
          action: 'comprehensive',
          code: {
            action: 'comprehensive',
            spreadsheetId: '1abc...',
            sheetName: 'Sales Data',
          },
          result: {
            schema: {
              columns: [
                { name: 'Date', type: 'date', nullCount: 0 },
                { name: 'Revenue', type: 'number', nullCount: 2 },
                { name: 'Product', type: 'string', nullCount: 0 },
              ],
            },
            statistics: {
              Revenue: { min: 10, max: 1000, mean: 450, median: 400 },
            },
            dataQuality: {
              completeness: 0.98,
              issues: [{ type: 'missing_values', column: 'Revenue', count: 2 }],
            },
            insights: ['Revenue shows strong upward trend', '2 missing values in Revenue column'],
          },
          notes:
            'Provides comprehensive analysis including schema, statistics, quality checks, and insights.',
        },
        {
          name: 'Create a chart',
          tool: 'sheets_visualize',
          action: 'chart_create',
          code: {
            action: 'chart_create',
            spreadsheetId: '1abc...',
            sheetId: 0,
            chartType: 'LINE',
            title: 'Revenue Trend',
            sourceRanges: ['A1:B100'],
            position: { row: 2, column: 5 },
          },
          result: {
            chartId: 987654,
            success: true,
          },
          notes:
            'Creates a line chart at specified position. Supports multiple chart types (LINE, BAR, PIE, SCATTER, etc.).',
        },
        {
          name: 'Create a pivot table',
          tool: 'sheets_visualize',
          action: 'pivot_create',
          code: {
            action: 'pivot_create',
            spreadsheetId: '1abc...',
            sourceSheetId: 0,
            sourceRange: 'A1:D100',
            rows: [{ sourceColumnIndex: 0, showTotals: true }],
            values: [
              {
                sourceColumnIndex: 3,
                summarizeFunction: 'SUM',
                name: 'Total Revenue',
              },
            ],
            targetSheetId: 1,
          },
          result: {
            success: true,
            pivotTableId: 456789,
          },
          notes: 'Creates pivot table with aggregations. Useful for summarizing large datasets.',
        },
        {
          name: 'Detect data quality issues',
          tool: 'sheets_quality',
          action: 'detect_missing',
          code: {
            action: 'detect_missing',
            spreadsheetId: '1abc...',
            sheetName: 'Customer Data',
          },
          result: {
            missingValues: {
              Email: { count: 5, rows: [10, 25, 37, 42, 91] },
              Phone: { count: 12, rows: [3, 7, 15] },
            },
            totalCells: 1000,
            completeness: 0.983,
          },
          notes: 'Identifies missing values by column with row numbers for easy fixing.',
        },
      ],
    },
    'comparative-tradeoffs': {
      title: 'Comparative Examples with Trade-off Analysis',
      description:
        'Shows multiple approaches for common operations with detailed trade-off analysis',
      examples: [
        {
          name: 'Update 500 Cells - Three Approaches',
          scenario: 'You need to update 500 cells with new data',
          approaches: [
            {
              method: 'Individual writes',
              tool: 'sheets_data',
              action: 'write',
              code: 'for (let i = 0; i < 500; i++) { await sheets_data.write(...) }',
              pros: [
                'Simple to understand',
                'Easy to debug each operation',
                'Can handle errors per-cell',
              ],
              cons: [
                'Extremely slow (500 sequential API calls)',
                'Very high quota usage (500 units)',
                'Rate limited (~30 req/min = 17 minutes)',
              ],
              apiCalls: 500,
              duration: '~250 seconds',
              quotaUsage: '500 units',
              when: 'NEVER use this for >10 writes',
            },
            {
              method: 'Batch write',
              tool: 'sheets_data',
              action: 'batch_write',
              code: 'await sheets_data.batch_write({ ranges: [...500 ranges], values: [...] })',
              pros: [
                'Fast (single API call)',
                'Moderate quota usage',
                'Good for independent writes',
              ],
              cons: [
                'Not atomic - partial failures possible',
                'All-or-nothing per batch',
                'Requires upfront data preparation',
              ],
              apiCalls: 1,
              duration: '~2 seconds',
              quotaUsage: '100 units',
              when: "Independent writes that don't need atomicity",
            },
            {
              method: 'Transaction',
              tool: 'sheets_transaction',
              actions: ['begin', 'queue (500x)', 'commit'],
              code: 'sheets_transaction.begin() → queue 500 ops → commit()',
              pros: [
                'Atomic - all succeed or all fail',
                '80% quota savings vs individual',
                'Automatic rollback on error',
                'Maintains consistency',
              ],
              cons: [
                'Requires 3 API calls (begin, commit, end)',
                'Not beneficial for <5 operations',
                'Slightly more complex',
              ],
              apiCalls: 3,
              duration: '~3 seconds',
              quotaUsage: '100 units',
              when: 'Related writes that must succeed/fail together',
            },
          ],
          recommendation: 'Use transactions for >50 sequential writes needing consistency',
          tradeoffMatrix: {
            speed: { individual: 1, batch: 10, transaction: 9 },
            safety: { individual: 5, batch: 3, transaction: 10 },
            quotaEfficiency: { individual: 1, batch: 8, transaction: 9 },
          },
        },
        {
          name: 'Read Large Dataset - Three Approaches',
          scenario: 'You need to read 5 sheets with 1000 rows each',
          approaches: [
            {
              method: 'Sequential reads',
              tool: 'sheets_data',
              action: 'read',
              code: 'for sheet in sheets: await sheets_data.read(range: "A1:Z1000")',
              pros: ['Simple code', 'Can process each sheet as it loads'],
              cons: [
                'Very slow (5 sequential API calls)',
                'Blocks on each request (~10 seconds total)',
              ],
              apiCalls: 5,
              duration: '~10 seconds',
              quotaUsage: '5 units',
              when: 'Only when you need to process each sheet before fetching next',
            },
            {
              method: 'Batch read (formatted)',
              tool: 'sheets_data',
              action: 'batch_read',
              code: 'await sheets_data.batch_read({ ranges: ["Sheet1!A1:Z1000", ..., "Sheet5!A1:Z1000"] })',
              pros: ['Single API call', 'Parallel fetching', 'Gets all data at once'],
              cons: [
                'Includes formatting overhead',
                'Slower for large datasets with complex formatting',
              ],
              apiCalls: 1,
              duration: '~3 seconds',
              quotaUsage: '1 unit',
              when: 'Need formatted values (dates, currency, etc.)',
            },
            {
              method: 'Batch read (unformatted)',
              tool: 'sheets_data',
              action: 'batch_read',
              code: 'await sheets_data.batch_read({ ranges: [...], valueRenderOption: "UNFORMATTED_VALUE" })',
              pros: [
                'Single API call',
                '3x faster than formatted (no rendering)',
                'Raw values good for calculations',
              ],
              cons: ['Loses date/currency formatting', 'May need manual parsing'],
              apiCalls: 1,
              duration: '~1 second',
              quotaUsage: '1 unit',
              when: 'Raw data for analysis/calculations (most common case)',
            },
          ],
          recommendation:
            'Use batch_read with UNFORMATTED_VALUE for analysis; formatted only when display matters',
          tradeoffMatrix: {
            speed: { sequential: 2, batchFormatted: 7, batchUnformatted: 10 },
            dataFidelity: { sequential: 10, batchFormatted: 10, batchUnformatted: 7 },
            simplicity: { sequential: 10, batchFormatted: 9, batchUnformatted: 8 },
          },
        },
        {
          name: 'Complex Calculation - Three Approaches',
          scenario: 'Calculate quarterly sales summaries with multiple aggregations',
          approaches: [
            {
              method: 'Array formulas in sheet',
              tool: 'sheets_data',
              action: 'write',
              code: 'sheets_data.write({ range: "Summary!A1", values: [["=ARRAYFORMULA(...)"]] })',
              pros: [
                'Updates automatically when source data changes',
                'Visible to all users',
                'No quota usage after creation',
              ],
              cons: [
                'Slow for >10K rows',
                "Can't use external data sources",
                'Recalculates on every sheet edit',
              ],
              apiCalls: 1,
              duration: '~1 second (plus recalc time)',
              quotaUsage: '1 unit (creation only)',
              when: 'Data changes frequently and you need live updates',
            },
            {
              method: 'Apps Script custom function',
              tool: 'sheets_appsscript',
              action: 'execute',
              code: 'sheets_appsscript.execute({ scriptId, function: "calculateQuarterlySummary" })',
              pros: [
                'Can access external APIs',
                'Complex logic possible',
                'Can schedule periodic execution',
              ],
              cons: [
                '6-minute execution time limit',
                'Requires Apps Script setup',
                'Harder to debug',
              ],
              apiCalls: 1,
              duration: '~5-30 seconds',
              quotaUsage: '1 unit',
              when: 'Need external integrations or scheduled calculations',
            },
            {
              method: 'Client-side calculation with results write',
              tool: 'sheets_data',
              actions: ['read', 'write'],
              code: 'data = sheets_data.read(); results = calculate(data); sheets_data.write(results)',
              pros: [
                'Fastest for complex logic',
                'Full programming language available',
                'Easy to test and debug',
              ],
              cons: [
                "Results don't auto-update",
                'Requires running the calculation',
                '2 API calls (read + write)',
              ],
              apiCalls: 2,
              duration: '~2 seconds',
              quotaUsage: '2 units',
              when: 'One-time or manually-triggered complex analysis',
            },
          ],
          recommendation: 'Formulas for live data; client-side for complex one-time analysis',
          tradeoffMatrix: {
            performance: { formulas: 5, appsScript: 7, clientSide: 10 },
            realTimeUpdates: { formulas: 10, appsScript: 8, clientSide: 1 },
            flexibility: { formulas: 3, appsScript: 10, clientSide: 9 },
          },
        },
        {
          name: 'Data Quality Validation - Three Approaches',
          scenario: 'Validate data quality before processing',
          approaches: [
            {
              method: 'Comprehensive analysis',
              tool: 'sheets_analyze',
              action: 'comprehensive',
              code: 'await sheets_analyze.comprehensive({ spreadsheetId })',
              pros: [
                'Detects 15+ issue types',
                'Detailed report with recommendations',
                'Identifies patterns and anomalies',
              ],
              cons: ['Slower (~5-10 seconds)', 'More API calls', 'May be overkill for known data'],
              apiCalls: '5-10',
              duration: '~5-10 seconds',
              quotaUsage: '5-10 units',
              when: 'First time analyzing or unknown data quality',
            },
            {
              method: 'Scout mode',
              tool: 'sheets_analyze',
              action: 'scout',
              code: 'await sheets_analyze.scout({ spreadsheetId, range })',
              pros: ['Very fast (~200ms)', 'Single API call', 'Good for monitoring'],
              cons: [
                'Less detailed than comprehensive',
                'Misses edge cases',
                'Limited to specific range',
              ],
              apiCalls: 1,
              duration: '~200 milliseconds',
              quotaUsage: '1 unit',
              when: 'Quick quality check or ongoing monitoring',
            },
            {
              method: 'Pre-write validation',
              tool: 'sheets_quality',
              action: 'validate',
              code: 'await sheets_quality.validate({ data, rules })',
              pros: ['Client-side (no API call)', 'Instant validation', 'Custom rules'],
              cons: [
                'Only validates what you check',
                'Misses sheet-level issues',
                'Requires defining rules',
              ],
              apiCalls: 0,
              duration: 'Instant',
              quotaUsage: '0 units',
              when: 'Validating data before write operations',
            },
          ],
          recommendation:
            'Scout mode for monitoring; comprehensive for diagnosis; validate before writes',
          tradeoffMatrix: {
            speed: { comprehensive: 3, scout: 9, validate: 10 },
            coverage: { comprehensive: 10, scout: 7, validate: 5 },
            quotaEfficiency: { comprehensive: 3, scout: 8, validate: 10 },
          },
        },
        {
          name: 'Create Dashboard - Three Approaches',
          scenario: 'Create an interactive dashboard with charts and filters',
          approaches: [
            {
              method: 'Manual step-by-step',
              tools: ['sheets_data', 'sheets_visualize', 'sheets_dimensions'],
              code: 'sheets_data.write() → sheets_visualize.chart_create() → sheets_dimensions.create_slicer()',
              pros: ['Full control over each step', 'Can adjust based on intermediate results'],
              cons: ['Many API calls (10+)', 'Slow overall', 'Easy to forget steps'],
              apiCalls: '10-15',
              duration: '~15 seconds',
              quotaUsage: '10-15 units',
              when: 'Building dashboard interactively with user feedback',
            },
            {
              method: 'Transaction-based',
              tool: 'sheets_transaction',
              code: 'sheets_transaction.begin() → queue all operations → commit()',
              pros: ['Atomic (all succeed or all fail)', '70% quota savings', 'Consistent state'],
              cons: [
                "All-or-nothing (can't partially succeed)",
                'Harder to debug failures',
                'Requires planning upfront',
              ],
              apiCalls: 3,
              duration: '~5 seconds',
              quotaUsage: '5 units',
              when: 'Dashboard must be complete or not exist (production)',
            },
            {
              method: 'Template-based',
              tool: 'sheets_templates',
              action: 'detect_and_apply',
              code: 'sheets_templates.detect_and_apply({ templateType: "dashboard" })',
              pros: ['Instant creation', 'Best practices built-in', 'Consistent styling'],
              cons: ['Less customizable', 'May not match exact needs', 'Requires template setup'],
              apiCalls: 2,
              duration: '~3 seconds',
              quotaUsage: '2 units',
              when: 'Standard dashboard patterns (sales, finance, project tracking)',
            },
          ],
          recommendation:
            'Templates for standard dashboards; transactions for custom production builds',
          tradeoffMatrix: {
            speed: { manual: 3, transaction: 8, template: 10 },
            flexibility: { manual: 10, transaction: 9, template: 5 },
            reliability: { manual: 5, transaction: 10, template: 9 },
          },
        },
      ],
    },
  };

  const exampleSet = examples[resourceId];
  if (!exampleSet) {
    throw new NotFoundError('examples_resource', resourceId);
  }

  return {
    contents: [
      {
        uri,
        mimeType: 'application/json',
        text: JSON.stringify(exampleSet),
      },
    ],
  };
}
