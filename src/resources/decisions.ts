/**
 * ServalSheets - Decision Tree Resources
 *
 * Provides AI-friendly decision trees for common ServalSheets choices:
 * - When to use transactions
 * - When to request confirmation
 * - Tool selection guidance
 * - Read vs batch_read decisions
 *
 * These resources help LLMs make optimal decisions about
 * which tools and patterns to use for specific scenarios.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { NotFoundError } from '../core/errors.js';

/**
 * Register decision tree resources
 */
export function registerDecisionResources(server: McpServer): void {
  // When to use transaction
  server.registerResource(
    'When to Use Transaction Decision Tree',
    'servalsheets://decisions/when-to-use-transaction',
    {
      description:
        'Decision tree for determining when to use transactions vs individual operations. Covers atomicity, quota optimization, and rollback scenarios.',
      mimeType: 'application/json',
    },
    async (uri) => readDecisionResource(typeof uri === 'string' ? uri : uri.toString())
  );

  // When to request confirmation
  server.registerResource(
    'When to Request Confirmation Decision Tree',
    'servalsheets://decisions/when-to-confirm',
    {
      description:
        'Decision tree for determining when to request user confirmation. Covers destructive operations, data volume thresholds, and critical spreadsheets.',
      mimeType: 'application/json',
    },
    async (uri) => readDecisionResource(typeof uri === 'string' ? uri : uri.toString())
  );

  // Tool selection guidance
  server.registerResource(
    'Tool Selection Decision Tree',
    'servalsheets://decisions/tool-selection',
    {
      description:
        'Decision tree for selecting the right ServalSheets tool for your task. Covers all 25 tools with use case guidance and examples.',
      mimeType: 'application/json',
    },
    async (uri) => readDecisionResource(typeof uri === 'string' ? uri : uri.toString())
  );

  // Read vs batch_read
  server.registerResource(
    'Read vs Batch Read Decision Tree',
    'servalsheets://decisions/read-vs-batch-read',
    {
      description:
        'Decision tree for choosing between read and batch_read actions. Covers contiguous ranges, quota optimization, and performance trade-offs.',
      mimeType: 'application/json',
    },
    async (uri) => readDecisionResource(typeof uri === 'string' ? uri : uri.toString())
  );
}

/**
 * Read decision tree resource content
 */
export async function readDecisionResource(uri: string): Promise<{
  contents: Array<{ uri: string; mimeType?: string; text: string }>;
}> {
  const resourceId = uri.replace('servalsheets://decisions/', '');

  const decisionTrees: Record<string, unknown> = {
    'when-to-use-transaction': {
      question: 'Should I use a transaction?',
      description:
        'Transactions provide atomicity (all-or-nothing) and quota optimization (80-90% savings) for multiple related operations.',
      flowchart: {
        root: {
          question: 'Are you making multiple operations?',
          yes: {
            question: 'Do you need atomicity (all-or-nothing)?',
            yes: {
              decision: 'USE TRANSACTION',
              reason: 'Atomicity ensures all operations succeed or none do. Rollback on failure.',
              example: {
                scenario: 'Update 5 related cells across sheets (inventory, pricing, totals)',
                approach: 'begin_transaction → queue 5 operations → commit',
                benefit: 'If any update fails, all are rolled back automatically',
              },
            },
            no: {
              question: 'Are operations on related data that should be consistent?',
              yes: {
                decision: 'USE TRANSACTION',
                reason:
                  'Even without strict atomicity requirement, transactions prevent partial updates.',
                example: {
                  scenario: 'Import CSV with 100 rows',
                  approach: 'transaction batches all writes',
                  benefit: 'Avoids partial import if error occurs at row 50',
                },
              },
              no: {
                question: 'Would batching provide quota savings? (4+ operations)',
                yes: {
                  decision: 'USE TRANSACTION',
                  reason: 'Quota optimization: N operations → 1 API call (80-90% savings)',
                  example: {
                    scenario: 'Update 10 cells in different ranges',
                    quotaSavings: '10 API calls → 1 API call (90% reduction)',
                  },
                },
                no: {
                  decision: 'NO TRANSACTION NEEDED',
                  reason: 'Independent operations with no atomicity or quota benefits',
                  approach: 'Use individual write actions',
                },
              },
            },
          },
          no: {
            decision: 'NO TRANSACTION NEEDED',
            reason: 'Single operation - no benefit from transaction overhead',
            approach: 'Use direct action (write, format, etc.)',
          },
        },
      },
      examples: [
        {
          scenario: 'Update 5 cells across different sheets',
          shouldUseTransaction: true,
          reason: 'Atomicity + quota savings (5 calls → 1 call)',
          code: 'begin_transaction, queue 5 operations, commit',
        },
        {
          scenario: 'Single cell write',
          shouldUseTransaction: false,
          reason: 'No benefit - adds unnecessary overhead',
          code: 'write({ action: "write", range: "A1", values: [[1]] })',
        },
        {
          scenario: 'Import 100-row CSV',
          shouldUseTransaction: true,
          reason: 'Atomicity (avoid partial import) + quota optimization',
          code: 'Use import_csv composite action (uses transaction internally)',
        },
        {
          scenario: '2 independent writes to different spreadsheets',
          shouldUseTransaction: false,
          reason: 'Independent operations, no shared transaction context',
          code: 'Two separate write actions',
        },
      ],
      guidelines: [
        'Use transactions for 4+ related operations',
        'Use transactions when partial updates would cause inconsistency',
        "Don't use transactions for single operations",
        "Don't use transactions across different spreadsheets",
        'Transaction overhead: 2 API calls (begin + commit) + queued operations',
      ],
    },

    'when-to-confirm': {
      question: 'Should I request user confirmation?',
      description:
        'Confirmation helps prevent accidental destructive operations and gives users visibility into high-impact actions.',
      flowchart: {
        root: {
          question: 'Is the operation destructive? (delete, clear, overwrite)',
          yes: {
            question: 'Will it affect >100 cells or entire sheets?',
            yes: {
              decision: 'REQUEST CONFIRMATION',
              reason: 'Large-scale destructive operation - high risk of data loss',
              approach: 'Use sheets_confirm tool to get explicit user approval',
              example: {
                scenario: 'Clear 1000 cells',
                confirmation:
                  'About to clear 1000 cells in range A1:J100. This will permanently delete all data. Continue?',
              },
            },
            no: {
              question: 'Is this a critical spreadsheet (financial, production)?',
              yes: {
                decision: 'REQUEST CONFIRMATION',
                reason: 'Even small destructive changes to critical data need approval',
                example: {
                  scenario: 'Delete single row in financial ledger',
                  confirmation:
                    'About to delete row 5 from Financial_Ledger. This is a critical spreadsheet. Continue?',
                },
              },
              no: {
                decision: 'NO CONFIRMATION NEEDED',
                reason: 'Small-scale destructive operation on non-critical data',
                approach: 'Proceed with operation, but log action for audit trail',
              },
            },
          },
          no: {
            question: 'Is the operation non-reversible?',
            yes: {
              question: 'Will it affect >1000 cells?',
              yes: {
                decision: 'REQUEST CONFIRMATION',
                reason: 'Large-scale irreversible operation - user should approve scope',
                example: {
                  scenario: 'Apply formula to 5000 cells',
                  confirmation:
                    'About to apply formula to 5000 cells. This will overwrite existing values. Continue?',
                },
              },
              no: {
                decision: 'NO CONFIRMATION NEEDED',
                reason: 'Moderate-scale operation, reversible via undo',
                approach: 'Proceed with operation',
              },
            },
            no: {
              decision: 'NO CONFIRMATION NEEDED',
              reason: 'Non-destructive, reversible operation',
              approach: 'Proceed with operation',
            },
          },
        },
      },
      examples: [
        {
          scenario: 'Delete entire sheet',
          shouldConfirm: true,
          reason: 'Destructive, affects entire sheet, hard to undo',
          confirmationMessage:
            'About to delete sheet "Sheet1" with 500 rows of data. This cannot be undone. Continue?',
        },
        {
          scenario: 'Clear 2000 cells',
          shouldConfirm: true,
          reason: 'Large-scale destructive operation',
          confirmationMessage: 'About to clear 2000 cells in range A1:T100. Continue?',
        },
        {
          scenario: 'Write to 5 cells',
          shouldConfirm: false,
          reason: 'Small-scale, reversible via undo',
          approach: 'Proceed without confirmation',
        },
        {
          scenario: 'Read data (any size)',
          shouldConfirm: false,
          reason: 'Non-destructive operation',
          approach: 'Never confirm read operations',
        },
      ],
      guidelines: [
        'Always confirm: delete sheet, clear >100 cells, destructive operations on critical spreadsheets',
        'Never confirm: read operations, metadata queries, non-destructive analysis',
        'Consider confirming: bulk updates >1000 cells, irreversible transformations',
        'Use confirmation messages that specify: action, scope (cell count/range), reversibility',
        'Confirmation adds 1 user interaction - use judiciously to avoid confirmation fatigue',
      ],
    },

    'tool-selection': {
      question: 'Which ServalSheets tool should I use?',
      description:
        'ServalSheets provides 18 specialized tools. Choose based on operation type and complexity.',
      categories: {
        authentication: {
          tool: 'sheets_auth',
          useCases: [
            'Check authentication status',
            'Guide user through login',
            'Handle token refresh',
            'Logout',
          ],
          examples: ['status', 'login', 'logout'],
        },
        basicOperations: {
          tool: 'sheets_core',
          useCases: [
            'Create/get/delete spreadsheets',
            'Add/delete/rename sheets',
            'Copy spreadsheets',
            'List spreadsheets',
          ],
          examples: ['create', 'get', 'add_sheet', 'delete_sheet', 'copy', 'list'],
        },
        dataOperations: {
          tool: 'sheets_data',
          useCases: [
            'Read/write cell values',
            'Batch read/write',
            'Append data',
            'Clear cells',
            'Add notes/comments',
          ],
          examples: ['read', 'write', 'batch_read', 'batch_write', 'append', 'clear'],
        },
        formatting: {
          tool: 'sheets_format',
          useCases: [
            'Apply cell formatting (bold, colors, borders)',
            'Number formats (currency, percentage)',
            'Conditional formatting',
            'Data validation',
          ],
          examples: [
            'set_format',
            'set_number_format',
            'rule_add_conditional_format',
            'set_data_validation',
          ],
        },
        dimensions: {
          tool: 'sheets_dimensions',
          useCases: [
            'Insert/delete rows/columns',
            'Resize rows/columns',
            'Hide/show rows/columns',
            'Group rows/columns',
            'Freeze rows/columns',
            'Sorting and filtering',
          ],
          examples: ['insert_rows', 'delete_columns', 'resize_rows', 'freeze_rows', 'sort_range'],
        },
        advanced: {
          tool: 'sheets_advanced',
          useCases: ['Named ranges', 'Protected ranges', 'Tables', 'Developer metadata'],
          examples: [
            'named_range_add',
            'protected_range_add',
            'create_table',
            'developer_metadata_add',
          ],
        },
        visualization: {
          tool: 'sheets_visualize',
          useCases: [
            'Create/update/delete charts',
            'Create/update pivot tables',
            'Chart suggestions',
          ],
          examples: ['chart_create', 'chart_update', 'pivot_create', 'chart_suggest'],
        },
        collaboration: {
          tool: 'sheets_collaborate',
          useCases: [
            'Share spreadsheets',
            'Manage permissions',
            'Add/update comments',
            'List revisions',
            'Restore previous versions',
          ],
          examples: [
            'share_add',
            'comment_add',
            'version_list_revisions',
            'version_restore_revision',
          ],
        },
        analysis: {
          tool: 'sheets_analyze',
          useCases: [
            'Comprehensive data analysis',
            'Detect data quality issues',
            'Suggest visualizations',
            'Generate formulas',
          ],
          examples: [
            'comprehensive',
            'analyze_quality',
            'suggest_visualization',
            'generate_formula',
          ],
        },
        dataQuality: {
          tool: 'sheets_quality',
          useCases: [
            'Validate values against rules',
            'Detect concurrent edit conflicts',
            'Resolve conflicts with strategies',
            'Analyze change impact before applying',
          ],
          examples: ['validate', 'detect_conflicts', 'resolve_conflict', 'analyze_impact'],
        },
        transactions: {
          tool: 'sheets_transaction',
          useCases: [
            'Atomic multi-operation updates',
            'Rollback on failure',
            'Quota optimization for bulk operations',
          ],
          examples: ['begin', 'queue', 'commit', 'rollback', 'get_status'],
        },
        history: {
          tool: 'sheets_history',
          useCases: ['Undo/redo operations', 'View operation history', 'Revert to previous state'],
          examples: ['undo', 'redo', 'list', 'revert_to'],
        },
        compositeOperations: {
          tool: 'sheets_composite',
          useCases: [
            'Import CSV (optimized)',
            'Smart append (auto-find last row)',
            'Bulk update (conditional)',
            'Deduplicate data',
          ],
          examples: ['import_csv', 'smart_append', 'bulk_update', 'deduplicate'],
        },
        sessionManagement: {
          tool: 'sheets_session',
          useCases: [
            'Track recently accessed spreadsheets',
            'Natural language references ("the spreadsheet")',
            'Clear session cache',
            'Get session context',
          ],
          examples: [
            'session_remember_spreadsheet',
            'session_get_current',
            'session_clear_cache',
            'session_get_context',
          ],
        },
        confirmation: {
          tool: 'sheets_confirm',
          useCases: [
            'Request user confirmation for destructive operations',
            'Present operation summary',
          ],
          examples: ['request'],
        },
      },
      decisionTree: {
        root: {
          question: 'What type of operation?',
          options: {
            'Read data': {
              question: '1 range or multiple ranges?',
              '1 range': 'sheets_data.read',
              'Multiple ranges': 'sheets_data.batch_read',
            },
            'Write data': {
              question: 'Single write or multiple writes?',
              'Single write': 'sheets_data.write',
              'Multiple writes (4+)': 'sheets_transaction (begin/queue/commit)',
              'Append to end': 'sheets_composite.smart_append',
              'Import CSV': 'sheets_composite.import_csv',
            },
            'Format cells': 'sheets_format (set_format, set_number_format, etc.)',
            'Create/modify structure': {
              question: 'What to modify?',
              'Spreadsheet/sheets': 'sheets_core (create, add_sheet, delete_sheet)',
              'Rows/columns': 'sheets_dimensions (insert_rows, delete_columns, resize)',
              'Advanced structures': 'sheets_advanced (named_range_add, protected_range_add)',
            },
            'Analyze data': {
              question: 'What type of analysis?',
              'Comprehensive analysis': 'sheets_analyze.comprehensive',
              'Data quality issues': 'sheets_analyze.analyze_quality',
              'Summary statistics': 'sheets_analyze.analyze_data',
              'Formula suggestions': 'sheets_analyze.generate_formula',
            },
            'Visualize data': 'sheets_visualize (chart_create, pivot_create)',
            Collaborate: 'sheets_collaborate (share_add, comment_add, version_restore_revision)',
            'Undo/rollback': 'sheets_history (undo, redo, revert_to)',
          },
        },
      },
    },

    'read-vs-batch-read': {
      question: 'Should I use read or batch_read?',
      description:
        'Choose between read (single range) and batch_read (multiple ranges) for optimal performance.',
      flowchart: {
        root: {
          question: 'How many ranges do you need?',
          options: {
            '1 range': {
              decision: 'USE read',
              reason: 'Single range - no benefit from batching',
              apiCalls: 1,
              example: 'read({ action: "read", spreadsheetId: "xxx", range: "A1:B10" })',
            },
            '2-5 ranges': {
              question: 'Are ranges contiguous?',
              yes: {
                decision: 'USE read WITH WIDER RANGE',
                reason: 'Contiguous ranges can be read as single wide range',
                apiCalls: 1,
                example: {
                  ranges: ['A1:B10', 'C1:D10'],
                  instead: 'read({ range: "A1:D10" }) - combines both',
                  savings: '2 calls → 1 call (50% reduction)',
                },
              },
              no: {
                decision: 'USE batch_read',
                reason: 'Non-contiguous ranges benefit from batching',
                apiCalls: 1,
                example: {
                  ranges: ['Sheet1!A1:B10', 'Sheet2!Z50:AA60'],
                  code: 'batch_read({ ranges: [...] })',
                  savings: '2 calls → 1 call (50% reduction)',
                },
              },
            },
            '6+ ranges': {
              decision: 'USE batch_read',
              reason: 'Multiple ranges - batching provides significant quota savings',
              apiCalls: '1 API call per 100 ranges (due to Google API batch limit)',
              example: {
                ranges: 10,
                savings: '10 calls → 1 call (90% reduction)',
              },
            },
          },
        },
      },
      examples: [
        {
          scenario: 'Read A1:B10',
          solution: 'read',
          reason: 'Single range',
          apiCalls: 1,
        },
        {
          scenario: 'Read A1:B10 and C1:D10 (contiguous)',
          solution: 'read with range A1:D10',
          reason: 'Combine into single wide range',
          apiCalls: 1,
        },
        {
          scenario: 'Read A1:B10 and Z50:AA60 (non-contiguous)',
          solution: 'batch_read',
          reason: 'Non-contiguous ranges',
          apiCalls: 1,
          savings: '2 individual reads → 1 batch',
        },
        {
          scenario: 'Read from 10 different sheets',
          solution: 'batch_read',
          reason: 'Multiple sheets = non-contiguous',
          apiCalls: 1,
          savings: '10 individual reads → 1 batch (90% quota savings)',
        },
      ],
      guidelines: [
        'Always use read for single range',
        'Check if ranges are contiguous before using batch_read',
        'batch_read optimal for 2+ non-contiguous ranges',
        'batch_read automatically handles Google API 100-range batch limit',
        'Both actions have same latency for small numbers of ranges',
      ],
    },
  };

  const decisionTree = decisionTrees[resourceId];
  if (!decisionTree) {
    throw new NotFoundError('decision_tree', resourceId);
  }

  return {
    contents: [
      {
        uri,
        mimeType: 'application/json',
        text: JSON.stringify(decisionTree),
      },
    ],
  };
}
