/**
 * ServalSheets - UASEV+R Workflow Patterns
 *
 * Real-world workflow patterns demonstrating the UASEV+R protocol:
 * - U (Understand): Parse user intent, identify hidden requirements
 * - A (Assess): Analyze context with sheets_analyze scout or a targeted assess step
 * - S (Strategize): Plan optimal approach, choose tools/actions
 * - E (Execute): Run operations with proper error handling
 * - V (Verify): Confirm goal achieved, validate results
 * - R (Reflect): Report results, suggest improvements
 *
 * Each pattern shows:
 * - Which UASEV+R phases are used (some workflows skip phases)
 * - Exact tools and actions per phase
 * - API call counts (actual vs naive approach)
 * - Duration estimates
 * - Common pitfalls and optimizations
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createResourceNotFoundError } from '../utils/mcp-errors.js';

/**
 * Workflow pattern structure
 */
interface WorkflowPattern {
  name: string;
  description: string;
  complexity: 'simple' | 'moderate' | 'complex';
  uasev_phases: Array<{
    phase: 'U' | 'A' | 'S' | 'E' | 'V' | 'R';
    description: string;
    tools?: Array<{
      tool: string;
      action: string;
      purpose: string;
      example?: Record<string, unknown>;
    }>;
    notes?: string;
  }>;
  metrics: {
    api_calls: number;
    naive_api_calls: number;
    quota_savings: string;
    duration: string;
  };
  common_pitfalls?: string[];
  optimization_tips?: string[];
}

/**
 * Workflow patterns library
 */
const WORKFLOW_PATTERNS: Record<string, WorkflowPattern> = {
  simple_read: {
    name: 'Read Cell Value (Fast Path)',
    description: 'Read a single cell or small range. Uses minimal UASEV+R phases for speed.',
    complexity: 'simple',
    uasev_phases: [
      {
        phase: 'U',
        description: 'User wants to read data from a specific range',
        notes: 'No ambiguity - skip deep analysis',
      },
      {
        phase: 'A',
        description: 'Quick auth check only (skip comprehensive analysis for simple reads)',
        tools: [
          {
            tool: 'sheets_auth',
            action: 'status',
            purpose: 'Verify authentication before attempting read',
            example: { action: 'status' },
          },
        ],
        notes: 'Skip sheets_analyze for simple reads - it adds latency for no benefit',
      },
      {
        phase: 'S',
        description: 'Strategy: Direct read, no batching needed',
        notes: 'Single range = use read, not batch_read',
      },
      {
        phase: 'E',
        description: 'Execute read operation',
        tools: [
          {
            tool: 'sheets_data',
            action: 'read',
            purpose: 'Read cell values from range',
            example: {
              action: 'read',
              spreadsheetId: '1abc...',
              range: 'Sheet1!A1:B10',
            },
          },
        ],
      },
      {
        phase: 'V',
        description: 'Verify data was retrieved successfully',
        notes: 'Check result.values is non-empty',
      },
      {
        phase: 'R',
        description: 'Return data to user',
        notes: 'Present values in readable format',
      },
    ],
    metrics: {
      api_calls: 2,
      naive_api_calls: 2,
      quota_savings: '0% (already optimal)',
      duration: '~500ms',
    },
    common_pitfalls: [
      'Using batch_read for single range (adds complexity, no benefit)',
      'Running comprehensive analysis before simple reads (adds 200-400ms)',
      'Not checking auth first (wasted read attempt if not authenticated)',
    ],
    optimization_tips: [
      'Skip sheets_analyze for simple reads under 1000 cells',
      'Cache auth status to avoid repeated checks',
      'Use value_render_option: "UNFORMATTED_VALUE" for raw data',
    ],
  },

  batch_read: {
    name: 'Read Multiple Ranges (Batch Pattern)',
    description: 'Read from 3+ non-contiguous ranges efficiently using batch operations.',
    complexity: 'moderate',
    uasev_phases: [
      {
        phase: 'U',
        description: 'User needs data from multiple ranges (e.g., headers + data + totals)',
        notes: 'Identify: Are ranges contiguous? If yes, use single wide range instead',
      },
      {
        phase: 'A',
        description: 'Auth check only (skip full analysis for read operations)',
        tools: [
          {
            tool: 'sheets_auth',
            action: 'status',
            purpose: 'Verify access',
          },
        ],
      },
      {
        phase: 'S',
        description: 'Strategy: Use batch_read to combine all ranges into 1 API call',
        notes: 'Decision: 3+ ranges → batch_read, 1-2 ranges → individual reads',
      },
      {
        phase: 'E',
        description: 'Execute batch read',
        tools: [
          {
            tool: 'sheets_data',
            action: 'batch_read',
            purpose: 'Read all ranges in single API call',
            example: {
              action: 'batch_read',
              spreadsheetId: '1abc...',
              ranges: ['Sheet1!A1:B1', 'Sheet1!A10:B100', 'Sheet2!Z50:AA60'],
            },
          },
        ],
      },
      {
        phase: 'V',
        description: 'Verify all ranges returned data',
        notes: 'Check result.valueRanges.length matches requested ranges',
      },
      {
        phase: 'R',
        description: 'Report combined data and quota savings',
        notes: 'Mention: "Used batch_read - saved N-1 API calls"',
      },
    ],
    metrics: {
      api_calls: 2,
      naive_api_calls: 10,
      quota_savings: '80% (10 calls → 2 calls)',
      duration: '~600ms',
    },
    common_pitfalls: [
      'Using batch_read for contiguous ranges (use single wide range instead)',
      'Not checking if ranges exist before reading (causes partial failures)',
      'Forgetting to handle empty ranges in results',
    ],
    optimization_tips: [
      'Combine contiguous ranges: A1:B10, B1:C10 → A1:C10',
      'Batch up to 100 ranges per call for maximum efficiency',
      'Process results locally to avoid follow-up reads',
    ],
  },

  import_csv: {
    name: 'Import CSV Data (Full UASEV+R)',
    description:
      'Import large CSV file with validation, deduplication, and safety. Demonstrates all 6 phases.',
    complexity: 'complex',
    uasev_phases: [
      {
        phase: 'U',
        description: 'Parse CSV import request, identify requirements',
        notes: 'Questions: Append or replace? Has headers? Need deduplication? Validation rules?',
      },
      {
        phase: 'A',
        description: 'Assess target sheet structure before import',
        tools: [
          {
            tool: 'sheets_auth',
            action: 'status',
            purpose: 'Verify access',
          },
          {
            tool: 'sheets_core',
            action: 'get',
            purpose: 'Get spreadsheet metadata and existing sheets',
            example: {
              action: 'get',
              spreadsheetId: '1abc...',
              includeGridData: false,
            },
          },
          {
            tool: 'sheets_analyze',
            action: 'scout',
            purpose: 'Inspect existing sheet structure and schema before import',
            example: {
              action: 'scout',
              spreadsheetId: '1abc...',
              sheetName: 'Data',
            },
          },
        ],
        notes:
          'Start with scout for structure. Escalate to comprehensive only if the target sheet already contains complex formulas, quality issues, or mixed data that must be preserved.',
      },
      {
        phase: 'S',
        description: 'Plan import strategy based on analysis',
        notes:
          'Strategy decisions: (1) Use import_csv composite action, (2) Enable createSnapshot safety, (3) Validate CSV schema matches sheet schema, (4) Choose append vs replace mode',
      },
      {
        phase: 'E',
        description: 'Execute import with safety rails',
        tools: [
          {
            tool: 'sheets_composite',
            action: 'import_csv',
            purpose: 'Import CSV with automatic optimization',
            example: {
              action: 'import_csv',
              spreadsheetId: '1abc...',
              sheetName: 'Data',
              csvData: 'Name,Email,Status\nJohn,john@example.com,Active\n...',
              mode: 'append',
              hasHeaders: true,
              safety: {
                createSnapshot: true,
                dryRun: false,
              },
            },
          },
        ],
        notes:
          'import_csv internally: parses CSV (0 calls) + finds position (0-1 calls) + batch writes (1 call)',
      },
      {
        phase: 'V',
        description: 'Verify import succeeded and data integrity',
        tools: [
          {
            tool: 'sheets_data',
            action: 'read',
            purpose: 'Spot-check imported data (first/last rows)',
            example: {
              action: 'read',
              spreadsheetId: '1abc...',
              range: 'Data!A1:Z5',
            },
          },
          {
            tool: 'sheets_quality',
            action: 'detect_missing',
            purpose: 'Check for missing values introduced during import',
            example: {
              action: 'detect_missing',
              spreadsheetId: '1abc...',
              sheetName: 'Data',
            },
          },
        ],
      },
      {
        phase: 'R',
        description: 'Report results with actionable insights',
        notes:
          'Report: rows imported, API calls saved, data quality score, any issues detected, rollback available if needed',
      },
    ],
    metrics: {
      api_calls: 7,
      naive_api_calls: 505,
      quota_savings: '98.6% (505 calls → 7 calls)',
      duration: '~3-5 seconds',
    },
    common_pitfalls: [
      'Not validating CSV schema before import (causes partial failures)',
      'Forgetting to create snapshot (no rollback if import fails)',
      'Importing row-by-row instead of using import_csv composite (500+ API calls)',
      'Not checking for duplicates before import',
    ],
    optimization_tips: [
      'Parse and validate CSV locally before any API calls',
      'Use import_csv composite action instead of manual row-by-row writes',
      'Enable createSnapshot for imports over 100 rows',
      'Run detect_duplicates before import if uniqueness matters',
    ],
  },

  transaction_update: {
    name: 'Multi-Sheet Update (Transaction Pattern)',
    description: 'Update related data across multiple sheets atomically with rollback safety.',
    complexity: 'moderate',
    uasev_phases: [
      {
        phase: 'U',
        description: 'User wants to update related data that must stay synchronized',
        notes: 'Example: Update inventory, pricing, and totals together',
      },
      {
        phase: 'A',
        description: 'Assess current values and dependencies',
        tools: [
          {
            tool: 'sheets_data',
            action: 'batch_read',
            purpose: 'Read current values from all affected ranges',
            example: {
              action: 'batch_read',
              spreadsheetId: '1abc...',
              ranges: ['Inventory!B2', 'Pricing!C3', 'Summary!D4'],
            },
          },
        ],
        notes: 'Read before write to understand current state',
      },
      {
        phase: 'S',
        description: 'Strategy: Use transaction for atomicity',
        notes:
          'Decision: 2+ related writes → transaction (ensures all-or-nothing, 80% quota savings)',
      },
      {
        phase: 'E',
        description: 'Execute transaction with multiple operations',
        tools: [
          {
            tool: 'sheets_transaction',
            action: 'begin',
            purpose: 'Start transaction',
            example: {
              action: 'begin',
              spreadsheetId: '1abc...',
            },
          },
          {
            tool: 'sheets_transaction',
            action: 'queue',
            purpose: 'Queue inventory update',
            example: {
              action: 'queue',
              operation: { type: 'write', range: 'Inventory!B2', values: [[50]] },
            },
          },
          {
            tool: 'sheets_transaction',
            action: 'queue',
            purpose: 'Queue pricing update',
            example: {
              action: 'queue',
              operation: { type: 'write', range: 'Pricing!C3', values: [[29.99]] },
            },
          },
          {
            tool: 'sheets_transaction',
            action: 'queue',
            purpose: 'Queue formula update',
            example: {
              action: 'queue',
              operation: {
                type: 'write',
                range: 'Summary!D4',
                values: [['=Inventory!B2 * Pricing!C3']],
              },
            },
          },
          {
            tool: 'sheets_transaction',
            action: 'commit',
            purpose: 'Execute all operations atomically',
            example: {
              action: 'commit',
            },
          },
        ],
        notes: 'Transaction guarantees: all updates succeed OR all are rolled back',
      },
      {
        phase: 'V',
        description: 'Verify all updates applied correctly',
        tools: [
          {
            tool: 'sheets_data',
            action: 'batch_read',
            purpose: 'Re-read updated values to confirm',
            example: {
              action: 'batch_read',
              spreadsheetId: '1abc...',
              ranges: ['Inventory!B2', 'Pricing!C3', 'Summary!D4'],
            },
          },
        ],
      },
      {
        phase: 'R',
        description: 'Report transaction success and quota savings',
        notes: 'Mention: "Used transaction - 3 writes in 1 API call (66% savings)"',
      },
    ],
    metrics: {
      api_calls: 4,
      naive_api_calls: 9,
      quota_savings: '55% (9 calls → 4 calls)',
      duration: '~1-2 seconds',
    },
    common_pitfalls: [
      'Not using transactions for related writes (inconsistent data if one fails)',
      'Forgetting to commit transaction (operations not executed)',
      'Not handling transaction errors (no rollback notification)',
    ],
    optimization_tips: [
      'Use transactions for 2+ writes (always worth it for quota + atomicity)',
      'Queue up to 100 operations per transaction',
      'Read current values before transaction to detect conflicts',
    ],
  },

  complex_analysis: {
    name: 'Complex Data Analysis (Full Protocol)',
    description:
      'Analyze large dataset, identify issues, generate insights, and create visualizations.',
    complexity: 'complex',
    uasev_phases: [
      {
        phase: 'U',
        description: 'User wants comprehensive analysis with insights and recommendations',
        notes: 'Understand: What metrics matter? What decisions depend on this data?',
      },
      {
        phase: 'A',
        description: 'Deep analysis using tiered retrieval for efficiency',
        tools: [
          {
            tool: 'sheets_analyze',
            action: 'comprehensive',
            purpose: 'Get schema, statistics, quality metrics, and insights',
            example: {
              action: 'comprehensive',
              spreadsheetId: '1abc...',
              sheetName: 'Sales Data',
            },
          },
          {
            tool: 'sheets_quality',
            action: 'detect_missing',
            purpose: 'Find data quality issues',
            example: {
              action: 'detect_missing',
              spreadsheetId: '1abc...',
              sheetName: 'Sales Data',
            },
          },
          {
            tool: 'sheets_quality',
            action: 'detect_duplicates',
            purpose: 'Identify duplicate records',
            example: {
              action: 'detect_duplicates',
              spreadsheetId: '1abc...',
              sheetName: 'Sales Data',
              keyColumns: ['Order ID'],
            },
          },
        ],
        notes:
          'comprehensive uses tiered retrieval: metadata (free) → sample (10 rows) → full scan (if needed)',
      },
      {
        phase: 'S',
        description: 'Plan analysis workflow based on findings',
        notes:
          'Strategy: (1) Fix data quality issues first, (2) Create pivot table for aggregations, (3) Generate charts for trends, (4) Export insights',
      },
      {
        phase: 'E',
        description: 'Execute fixes and generate visualizations',
        tools: [
          {
            tool: 'sheets_composite',
            action: 'deduplicate',
            purpose: 'Remove duplicate records if found',
            example: {
              action: 'deduplicate',
              spreadsheetId: '1abc...',
              sheetName: 'Sales Data',
              keyColumns: ['Order ID'],
            },
          },
          {
            tool: 'sheets_visualize',
            action: 'pivot_create',
            purpose: 'Create pivot table for aggregations',
            example: {
              action: 'pivot_create',
              spreadsheetId: '1abc...',
              sourceSheetId: 0,
              sourceRange: 'A1:D1000',
              rows: [{ sourceColumnIndex: 0, showTotals: true }],
              values: [{ sourceColumnIndex: 3, summarizeFunction: 'SUM' }],
              targetSheetId: 1,
            },
          },
          {
            tool: 'sheets_visualize',
            action: 'chart_create',
            purpose: 'Create trend chart',
            example: {
              action: 'chart_create',
              spreadsheetId: '1abc...',
              sheetId: 0,
              chartType: 'LINE',
              title: 'Revenue Trend',
              sourceRanges: ['A1:B1000'],
            },
          },
        ],
      },
      {
        phase: 'V',
        description: 'Verify analysis outputs are accurate',
        notes: 'Check: pivot table sums match raw data, chart displays correctly, no errors',
      },
      {
        phase: 'R',
        description: 'Generate executive summary with actionable insights',
        notes:
          'Report: key metrics, trends identified, data quality score, recommendations, visualizations created',
      },
    ],
    metrics: {
      api_calls: 8,
      naive_api_calls: 50,
      quota_savings: '84% (50 calls → 8 calls)',
      duration: '~5-8 seconds',
    },
    common_pitfalls: [
      'Reading full dataset multiple times (use comprehensive analysis once)',
      'Not using tiered retrieval (wastes quota on unnecessary full scans)',
      'Creating visualizations before fixing data quality issues',
    ],
    optimization_tips: [
      'Start with sheets_analyze scout to inspect structure, then run comprehensive only if you need a full quality/formula audit',
      'Leverage tiered retrieval: starts with metadata, samples 10 rows, only does full scan if needed',
      'Fix data quality issues before creating visualizations',
      'Cache analysis results for 5 minutes to avoid re-analysis',
    ],
  },

  fast_write: {
    name: 'Quick Write (Fast Path)',
    description: 'Write to a single range quickly. Minimal protocol for simple updates.',
    complexity: 'simple',
    uasev_phases: [
      {
        phase: 'U',
        description: 'User wants to write value(s) to specific range',
        notes: 'No ambiguity, no complex requirements',
      },
      {
        phase: 'A',
        description: 'Quick validation only (skip comprehensive analysis)',
        tools: [
          {
            tool: 'sheets_auth',
            action: 'status',
            purpose: 'Verify write access',
          },
        ],
        notes: 'Skip full analysis for simple writes under 100 cells',
      },
      {
        phase: 'S',
        description: 'Strategy: Direct write, no transaction needed for single range',
      },
      {
        phase: 'E',
        description: 'Execute write',
        tools: [
          {
            tool: 'sheets_data',
            action: 'write',
            purpose: 'Write values to range',
            example: {
              action: 'write',
              spreadsheetId: '1abc...',
              range: 'Sheet1!A1:B2',
              values: [
                ['Header 1', 'Header 2'],
                ['Value 1', 'Value 2'],
              ],
            },
          },
        ],
      },
      {
        phase: 'V',
        description: 'Verify write succeeded',
        notes: 'Check result.updatedCells matches expected count',
      },
      {
        phase: 'R',
        description: 'Confirm update to user',
        notes: 'Report: updated N cells in range X',
      },
    ],
    metrics: {
      api_calls: 2,
      naive_api_calls: 2,
      quota_savings: '0% (already optimal)',
      duration: '~400ms',
    },
    common_pitfalls: [
      'Using transaction for single write (adds 2 extra API calls for no benefit)',
      'Not checking auth before write (wasted write attempt)',
      'Writing row-by-row instead of single batch write',
    ],
    optimization_tips: [
      'Skip transactions for single writes under 100 cells',
      'Use write instead of append if you know the exact range',
      'Batch multiple small writes into one write call with larger values array',
    ],
  },

  smart_append: {
    name: 'Smart Append (Composite Pattern)',
    description: 'Append rows to a sheet with automatic last-row detection.',
    complexity: 'simple',
    uasev_phases: [
      {
        phase: 'U',
        description: 'User wants to add new rows without knowing current row count',
      },
      {
        phase: 'A',
        description: 'Quick auth check (smart_append handles last-row detection)',
        tools: [
          {
            tool: 'sheets_auth',
            action: 'status',
            purpose: 'Verify access',
          },
        ],
      },
      {
        phase: 'S',
        description: 'Strategy: Use smart_append composite action (auto-optimized)',
        notes: 'smart_append internally finds last row (cached) and appends efficiently',
      },
      {
        phase: 'E',
        description: 'Execute smart append',
        tools: [
          {
            tool: 'sheets_composite',
            action: 'smart_append',
            purpose: 'Append rows with auto-detection',
            example: {
              action: 'smart_append',
              spreadsheetId: '1abc...',
              sheetName: 'Logs',
              values: [
                ['2026-01-15T10:30:00Z', 'User login', 'john@example.com'],
                ['2026-01-15T10:31:00Z', 'Page view', '/dashboard'],
              ],
            },
          },
        ],
        notes:
          'Internally: finds last row (1 call, cached 60s) + appends (1 call) = 1-2 calls total',
      },
      {
        phase: 'V',
        description: 'Verify rows were appended to correct location',
        notes: 'Check result.appendedRange shows expected row numbers',
      },
      {
        phase: 'R',
        description: 'Report append success and location',
        notes: 'Report: "Appended 2 rows at A147:C148"',
      },
    ],
    metrics: {
      api_calls: 2,
      naive_api_calls: 3,
      quota_savings: '33% (3 calls → 2 calls, cache reduces to 1 call)',
      duration: '~500ms',
    },
    common_pitfalls: [
      'Manually finding last row before append (smart_append does this automatically)',
      'Not using smart_append cache (repeated appends should use cache)',
      'Using write when you need append (requires manual last-row calculation)',
    ],
    optimization_tips: [
      'Use smart_append instead of manual read + write + offset calculation',
      'Cache works for 60 seconds - multiple appends within 60s only need 1 last-row lookup',
      'For bulk appends, batch rows into single smart_append call',
    ],
  },

  conditional_format: {
    name: 'Conditional Update (Quality Pattern)',
    description: 'Read data, find matches, update cells conditionally.',
    complexity: 'moderate',
    uasev_phases: [
      {
        phase: 'U',
        description: 'User wants to update cells matching a condition',
        notes: 'Example: Change status from "Pending" to "Processing" for specific orders',
      },
      {
        phase: 'A',
        description: 'Read current data to understand scope',
        tools: [
          {
            tool: 'sheets_data',
            action: 'read',
            purpose: 'Read column(s) to search',
            example: {
              action: 'read',
              spreadsheetId: '1abc...',
              range: 'Orders!D:D',
            },
          },
        ],
        notes: 'Read entire column to find all matches',
      },
      {
        phase: 'S',
        description: 'Strategy: Find matches locally, batch write updates',
        notes: 'Process matches in memory (0 API calls), then batch_write all updates (1 call)',
      },
      {
        phase: 'E',
        description: 'Execute batch update for all matches',
        tools: [
          {
            tool: 'sheets_data',
            action: 'batch_write',
            purpose: 'Update all matching cells at once',
            example: {
              action: 'batch_write',
              spreadsheetId: '1abc...',
              data: [
                { range: 'Orders!D5', values: [['Processing']] },
                { range: 'Orders!D12', values: [['Processing']] },
                { range: 'Orders!D27', values: [['Processing']] },
              ],
            },
          },
        ],
        notes: 'All updates in 1 API call regardless of match count',
      },
      {
        phase: 'V',
        description: 'Verify correct number of cells updated',
        notes: 'Check result.totalUpdatedCells matches expected match count',
      },
      {
        phase: 'R',
        description: 'Report matches found and updated',
        notes: "Report: \"Updated N cells from 'Pending' to 'Processing'\"",
      },
    ],
    metrics: {
      api_calls: 2,
      naive_api_calls: 21,
      quota_savings: '90% (21 calls → 2 calls)',
      duration: '~800ms',
    },
    common_pitfalls: [
      'Updating matches one-by-one (20+ API calls instead of 1 batch_write)',
      'Using bulk_update without reading first (inefficient for small match counts)',
      'Not validating matches before updating (may update wrong cells)',
    ],
    optimization_tips: [
      'For <50 matches: read + local search + batch_write (2 calls)',
      'For >50 matches: use sheets_composite bulk_update action (optimized)',
      'Process matches in memory - never iterate with write per match',
    ],
  },

  large_dataset: {
    name: 'Large Dataset Operations (10K+ Rows)',
    description: 'Efficiently handle large datasets with chunking and caching.',
    complexity: 'complex',
    uasev_phases: [
      {
        phase: 'U',
        description: 'User needs to process large dataset (>10K rows)',
        notes: 'Understand: Full scan needed or can we use sampling/aggregation?',
      },
      {
        phase: 'A',
        description: 'Assess with scout first, then escalate only if a deeper scan is needed',
        tools: [
          {
            tool: 'sheets_analyze',
            action: 'scout',
            purpose: 'Inspect structure and row/column shape before deeper analysis',
            example: {
              action: 'scout',
              spreadsheetId: '1abc...',
              sheetName: 'BigData',
            },
          },
          {
            tool: 'sheets_analyze',
            action: 'comprehensive',
            purpose: 'Run tiered retrieval only when scout shows deeper analysis is warranted',
            example: {
              action: 'comprehensive',
              spreadsheetId: '1abc...',
              sheetName: 'BigData',
            },
          },
        ],
        notes:
          'Recommended sequence: (1) scout for structure, (2) comprehensive for sample/full-scan analysis only if needed, (3) chunk raw reads only when the analysis says a full pass is required.',
      },
      {
        phase: 'S',
        description: 'Strategy based on analysis results',
        notes:
          'If sample is representative: use sample insights. If full scan needed: chunk reads into 5K row batches',
      },
      {
        phase: 'E',
        description: 'Execute with chunking if full scan required',
        tools: [
          {
            tool: 'sheets_data',
            action: 'read',
            purpose: 'Read first chunk (rows 1-5000)',
            example: {
              action: 'read',
              spreadsheetId: '1abc...',
              range: 'BigData!A1:Z5000',
            },
          },
          {
            tool: 'sheets_data',
            action: 'read',
            purpose: 'Read second chunk (rows 5001-10000)',
            example: {
              action: 'read',
              spreadsheetId: '1abc...',
              range: 'BigData!A5001:Z10000',
            },
          },
        ],
        notes: 'Process each chunk locally before reading next (memory efficient)',
      },
      {
        phase: 'V',
        description: 'Verify data integrity across chunks',
        notes: 'Check: no gaps between chunks, totals match expected row count',
      },
      {
        phase: 'R',
        description: 'Report aggregated results from all chunks',
        notes:
          'Report: processed N rows in M chunks, total duration, key findings, used tiered retrieval to optimize',
      },
    ],
    metrics: {
      api_calls: 3,
      naive_api_calls: 10000,
      quota_savings: '99.97% (10000 calls → 3 calls)',
      duration: '~10-15 seconds',
    },
    common_pitfalls: [
      'Reading full dataset when sample would suffice (wastes quota)',
      'Not chunking reads for datasets >10K rows (API limits)',
      'Processing row-by-row instead of batch processing (extremely slow)',
      'Not using tiered retrieval in sheets_analyze (always does full scan)',
    ],
    optimization_tips: [
      'Start with sheets_analyze scout and add comprehensive only when you need sample/full-scan analysis',
      'For aggregations: use pivot tables (1-2 API calls) instead of reading all data',
      'Chunk reads into 5K row batches for datasets >10K rows',
      'Process chunks in memory before requesting next chunk (memory efficient)',
      'Use value_render_option: "UNFORMATTED_VALUE" for raw data (faster)',
    ],
  },

  multi_sheet_consolidation: {
    name: 'Multi-Sheet Consolidation',
    description: 'Combine data from multiple sheets with deduplication and validation.',
    complexity: 'complex',
    uasev_phases: [
      {
        phase: 'U',
        description: 'User wants to consolidate data from 3+ sheets into one',
        notes: 'Understand: Schema matching? Deduplication needed? Preserve source references?',
      },
      {
        phase: 'A',
        description: 'Analyze all source sheets for compatibility',
        tools: [
          {
            tool: 'sheets_core',
            action: 'get',
            purpose: 'Get spreadsheet structure',
            example: {
              action: 'get',
              spreadsheetId: '1abc...',
              includeGridData: false,
            },
          },
          {
            tool: 'sheets_data',
            action: 'batch_read',
            purpose: 'Read headers from all sheets',
            example: {
              action: 'batch_read',
              spreadsheetId: '1abc...',
              ranges: ['Sheet1!A1:Z1', 'Sheet2!A1:Z1', 'Sheet3!A1:Z1'],
            },
          },
        ],
        notes: 'Verify schema compatibility before consolidation',
      },
      {
        phase: 'S',
        description: 'Plan consolidation strategy',
        notes:
          'Strategy: (1) Validate schemas match, (2) Batch read all sheets, (3) Deduplicate in memory, (4) Write consolidated data with transaction',
      },
      {
        phase: 'E',
        description: 'Execute consolidation workflow',
        tools: [
          {
            tool: 'sheets_data',
            action: 'batch_read',
            purpose: 'Read all source data at once',
            example: {
              action: 'batch_read',
              spreadsheetId: '1abc...',
              ranges: ['Sheet1!A:Z', 'Sheet2!A:Z', 'Sheet3!A:Z'],
            },
          },
          {
            tool: 'sheets_composite',
            action: 'deduplicate',
            purpose: 'Remove duplicates from consolidated data',
            example: {
              action: 'deduplicate',
              spreadsheetId: '1abc...',
              sheetName: 'Consolidated',
              keyColumns: ['ID', 'Email'],
            },
          },
        ],
        notes: 'Merge data in memory (0 calls), then write consolidated result',
      },
      {
        phase: 'V',
        description: 'Verify consolidation integrity',
        tools: [
          {
            tool: 'sheets_quality',
            action: 'detect_missing',
            purpose: 'Check for data quality issues after consolidation',
            example: {
              action: 'detect_missing',
              spreadsheetId: '1abc...',
              sheetName: 'Consolidated',
            },
          },
        ],
      },
      {
        phase: 'R',
        description: 'Report consolidation results',
        notes:
          'Report: rows from each source, duplicates removed, final row count, data quality score',
      },
    ],
    metrics: {
      api_calls: 5,
      naive_api_calls: 3000,
      quota_savings: '99.8% (3000 calls → 5 calls)',
      duration: '~5-8 seconds',
    },
    common_pitfalls: [
      'Reading sheets one-by-one (3+ calls instead of 1 batch_read)',
      'Not validating schema compatibility before consolidation',
      'Writing consolidated data row-by-row (1000+ calls)',
      'Not deduplicating before final write',
    ],
    optimization_tips: [
      'Use batch_read to get all sheets in 1 API call',
      'Validate schemas locally before reading data',
      'Consolidate and deduplicate in memory (0 API calls)',
      'Write final result with single write or transaction',
    ],
  },
};

/**
 * Register workflow patterns resources
 */
export function registerPatternResources(server: McpServer): void {
  // All patterns overview
  server.registerResource(
    'UASEV+R Workflow Patterns',
    'servalsheets://patterns/workflows',
    {
      description:
        'Real-world workflow patterns demonstrating UASEV+R protocol with API efficiency metrics. Shows which phases to use, tools per phase, and quota optimization strategies.',
      mimeType: 'application/json',
    },
    async (uri) => readPatternResource(typeof uri === 'string' ? uri : uri.toString())
  );

  // Fast path patterns (simple operations)
  server.registerResource(
    'Fast Path Patterns (Simple Operations)',
    'servalsheets://patterns/fast-path',
    {
      description:
        'Minimal UASEV+R patterns for simple read/write operations. Shows when to skip comprehensive analysis for speed.',
      mimeType: 'application/json',
    },
    async (uri) => readPatternResource(typeof uri === 'string' ? uri : uri.toString())
  );

  // Batch operations patterns
  server.registerResource(
    'Batch Operations Patterns',
    'servalsheets://patterns/batch-operations',
    {
      description:
        'Quota-optimized patterns using batch_read, batch_write, and transactions. Shows 80-99% API call reduction strategies.',
      mimeType: 'application/json',
    },
    async (uri) => readPatternResource(typeof uri === 'string' ? uri : uri.toString())
  );

  // Complex workflow patterns
  server.registerResource(
    'Complex Workflow Patterns',
    'servalsheets://patterns/complex-workflows',
    {
      description:
        'Full UASEV+R protocol for complex operations: imports, analysis, multi-sheet consolidation, large datasets.',
      mimeType: 'application/json',
    },
    async (uri) => readPatternResource(typeof uri === 'string' ? uri : uri.toString())
  );
}

/**
 * Read workflow pattern resource
 */
export async function readPatternResource(uri: string): Promise<{
  contents: Array<{ uri: string; mimeType?: string; text: string }>;
}> {
  const resourceId = uri.replace('servalsheets://patterns/', '');

  let patterns: Record<string, WorkflowPattern>;

  switch (resourceId) {
    case 'workflows':
      // All patterns
      patterns = WORKFLOW_PATTERNS;
      break;

    case 'fast-path':
      // Simple operations only
      patterns = {
        simple_read: WORKFLOW_PATTERNS['simple_read']!,
        fast_write: WORKFLOW_PATTERNS['fast_write']!,
        smart_append: WORKFLOW_PATTERNS['smart_append']!,
      };
      break;

    case 'batch-operations':
      // Batch and transaction patterns
      patterns = {
        batch_read: WORKFLOW_PATTERNS['batch_read']!,
        transaction_update: WORKFLOW_PATTERNS['transaction_update']!,
        conditional_format: WORKFLOW_PATTERNS['conditional_format']!,
      };
      break;

    case 'complex-workflows':
      // Complex operations
      patterns = {
        import_csv: WORKFLOW_PATTERNS['import_csv']!,
        complex_analysis: WORKFLOW_PATTERNS['complex_analysis']!,
        large_dataset: WORKFLOW_PATTERNS['large_dataset']!,
        multi_sheet_consolidation: WORKFLOW_PATTERNS['multi_sheet_consolidation']!,
      };
      break;

    default:
      throw createResourceNotFoundError(
        'pattern',
        resourceId,
        'Available patterns: workflows, fast-path, batch-operations, complex-workflows'
      );
  }

  return {
    contents: [
      {
        uri,
        mimeType: 'application/json',
        text: JSON.stringify(
          {
            title: 'ServalSheets UASEV+R Workflow Patterns',
            description:
              'Real-world patterns showing how to apply UASEV+R protocol for optimal efficiency',
            protocol: {
              U: 'UNDERSTAND - Parse user intent, identify hidden requirements',
              A: 'ASSESS - Use scout, targeted reads, or quick auth checks before escalating to deeper analysis',
              S: 'STRATEGIZE - Plan optimal approach (batch, transaction, composite)',
              E: 'EXECUTE - Run operations with proper error handling',
              V: 'VERIFY - Confirm goal achieved, validate results',
              R: 'REFLECT - Report results, mention quota savings, suggest improvements',
            },
            guidelines: {
              fast_path:
                'Simple reads/writes (<100 cells): Skip comprehensive analysis, use quick auth check only',
              batch_operations:
                '3+ operations: Use batch_read, batch_write, or transactions (80%+ quota savings)',
              transactions:
                '2+ related writes: Use transactions for atomicity + quota optimization',
              complex_workflows:
                'Imports, analysis, consolidation: Use full UASEV+R, starting with scout or targeted assessment and escalating to comprehensive only when needed',
              tiered_retrieval:
                'Large datasets: Start with sheets_analyze scout, then use comprehensive for metadata → sample → full scan only when needed',
            },
            patterns,
          },
          null,
          2
        ),
      },
    ],
  };
}
