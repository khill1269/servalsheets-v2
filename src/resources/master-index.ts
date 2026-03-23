/**
 * ServalSheets - Master Index Resource
 *
 * Provides a comprehensive index of all ServalSheets resources.
 * This is the entry point for Claude to discover available resources.
 *
 * URI: servalsheets://index
 *
 * @module resources/master-index
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { TOOL_COUNT, ACTION_COUNT } from '../schemas/index.js';
import { TOOL_ACTIONS } from '../mcp/completions.js';
import { filterAvailableActions } from '../mcp/tool-availability.js';
import { VERSION } from '../version.js';
import { getFlowCatalogCount, listFlowCatalogEntries } from './flows.js';
import { getPromptsCatalogCount, listPromptCatalogBuckets } from './prompts-catalog.js';

/**
 * Resource category definition
 */
interface ResourceCategory {
  description: string;
  count: number;
  uriPattern: string;
  examples: string[];
  whenToUse: string;
  breakdown?: Record<string, number>;
}

/**
 * Get resource categories with counts
 */
function getResourceCategories(): Record<string, ResourceCategory> {
  return {
    data: {
      description: 'Live spreadsheet data access with pagination',
      count: 5,
      uriPattern: 'sheets:///{spreadsheetId}/...',
      examples: [
        'sheets:///1abc.../Sheet1!A1:D10',
        'sheets:///1abc.../charts',
        'sheets:///1abc.../pivots',
      ],
      whenToUse: 'When you need to read spreadsheet data, metadata, charts, or pivot tables',
    },
    schema: {
      description: 'Tool schemas and per-action guidance for understanding available actions',
      count: TOOL_COUNT * 2 + 2,
      uriPattern: 'schema://tools/{toolName} | schema://actions/{toolName}',
      examples: [
        'schema://tools',
        'schema://tools/sheets_data',
        'schema://actions',
        'schema://actions/sheets_data',
      ],
      whenToUse:
        'When you need tool parameters or action-level guidance (idempotency, pitfalls, alternatives) before calling',
    },
    knowledge: {
      description: 'AI knowledge base: formulas, templates, patterns, best practices',
      count: 38,
      uriPattern: 'knowledge:///{category}/{file}',
      examples: [
        'knowledge:///api/batch-operations.md',
        'knowledge:///formulas/financial.json',
        'knowledge:///templates/finance.json',
      ],
      whenToUse: 'When you need domain expertise for formulas, templates, or optimization',
    },
    guide: {
      description: 'Performance and optimization guides',
      count: 4,
      uriPattern: 'servalsheets://guides/{guideName}',
      examples: [
        'servalsheets://guides/quota-optimization',
        'servalsheets://guides/batching-strategies',
        'servalsheets://guides/caching-patterns',
        'servalsheets://guides/error-recovery',
      ],
      whenToUse: 'When optimizing API usage, handling errors, or improving performance',
    },
    example: {
      description: 'Code examples for common operations',
      count: 6,
      uriPattern: 'servalsheets://examples/{category}',
      examples: [
        'servalsheets://examples/basic-operations',
        'servalsheets://examples/batch-operations',
        'servalsheets://examples/transactions',
      ],
      whenToUse: 'When you need concrete code examples for specific operations',
    },
    pattern: {
      description: 'UASEV+R workflow patterns with metrics',
      count: 5,
      uriPattern: 'servalsheets://patterns/{patternName}',
      examples: [
        'servalsheets://patterns/simple_read',
        'servalsheets://patterns/batch_read',
        'servalsheets://patterns/transactional_write',
      ],
      whenToUse: 'When planning multi-step workflows with optimal API usage',
    },
    decision: {
      description: 'Decision trees for tool and strategy selection',
      count: 4,
      uriPattern: 'servalsheets://decisions/{treeName}',
      examples: [
        'servalsheets://decisions/tool-selection',
        'servalsheets://decisions/when-to-use-transaction',
        'servalsheets://decisions/when-to-confirm',
      ],
      whenToUse: 'When deciding which tool or approach to use',
    },
    reference: {
      description: 'Quick reference for colors, formats, limits, and patterns',
      count: 6,
      uriPattern: 'servalsheets://reference/{topic}',
      examples: [
        'servalsheets://reference/colors',
        'servalsheets://reference/number-formats',
        'servalsheets://reference/api-limits',
        'servalsheets://reference/chart-types',
      ],
      whenToUse: 'When you need quick lookup of colors, formats, or limits',
    },
    monitor: {
      description: 'Observability: history, cache, metrics, health, analysis results',
      count: 28,
      uriPattern: '{type}://...',
      examples: [
        'history://operations',
        'history://stats',
        'cache://stats',
        'metrics://summary',
        'discovery://health',
        'analyze://results',
        'transaction://stats',
      ],
      whenToUse: 'When debugging, monitoring performance, or auditing operations',
      breakdown: {
        history: 4, // operations, stats, recent, failures
        cache: 2, // stats, deduplication
        metrics: 7, // summary, dashboard, operations, cache, api, system, service
        discovery: 2, // health, versions
        analyze: 3, // stats, help, results
        confirm: 2, // stats, help
        transaction: 2, // stats, help
        conflict: 2, // stats, help
        impact: 2, // stats, help
        validation: 2, // stats, help
      },
    },
  };
}

/**
 * Get quick start resources based on user type
 */
function getQuickStartResources(): Record<string, string[]> {
  return {
    firstTimeUser: [
      'schema://tools/sheets_auth',
      'servalsheets://patterns/simple_read',
      'servalsheets://guides/batching-strategies',
    ],
    developer: [
      'schema://tools',
      'servalsheets://decisions/tool-selection',
      'servalsheets://examples/transactions',
    ],
    analyst: [
      'schema://tools/sheets_analyze',
      'knowledge:///formulas/functions-reference.md',
      'servalsheets://patterns/comprehensive_audit',
    ],
    enterprise: [
      'schema://tools/sheets_bigquery',
      'schema://tools/sheets_appsscript',
      'knowledge:///masterclass/security-compliance-master.json',
    ],
  };
}

/**
 * Get tool summary with action counts
 */
function getToolSummary(): Array<{ name: string; actions: number; description: string }> {
  const toolDescriptions: Record<string, string> = {
    sheets_auth: 'OAuth 2.0 authentication flow',
    sheets_core: 'Spreadsheet and sheet CRUD operations',
    sheets_data: 'Cell data read/write/batch operations',
    sheets_format: 'Cell formatting, validation, sparklines',
    sheets_dimensions: 'Rows, columns, filters, slicers',
    sheets_visualize: 'Charts and pivot tables',
    sheets_collaborate: 'Sharing, comments, versions, approvals',
    sheets_advanced: 'Named ranges, protection, smart chips, tables',
    sheets_transaction: 'Atomic operations with rollback',
    sheets_quality: 'Data validation and conflict detection',
    sheets_history: 'Operation history and undo/redo',
    sheets_confirm: 'User confirmation via MCP Elicitation',
    sheets_analyze: 'AI analysis via MCP Sampling',
    sheets_fix: 'Auto-fix detected issues',
    sheets_composite: 'High-level operations (CSV, dedupe)',
    sheets_session: 'Conversation context and NL references',
    sheets_templates: 'Template library management',
    sheets_bigquery: 'BigQuery Connected Sheets',
    sheets_appsscript: 'Apps Script automation',
    sheets_webhook: 'Change notifications',
    sheets_dependencies: 'Formula dependency analysis',
    sheets_federation: 'Remote MCP federation and cross-server workflows',
    sheets_compute: 'Server-side computation, statistics, and forecasting',
    sheets_agent: 'Autonomous planning, execution, and rollback',
    sheets_connectors: 'Live external data connectors and subscriptions',
  };

  return Object.entries(TOOL_ACTIONS)
    .map(([name, actions]) => ({
      name,
      actions: filterAvailableActions(name, actions).length,
      description: toolDescriptions[name] || name,
    }))
    .sort((a, b) => b.actions - a.actions);
}

/**
 * Register the master index resource
 */
export function registerMasterIndexResource(server: McpServer): void {
  server.registerResource(
    'ServalSheets Master Index',
    'servalsheets://index',
    {
      description:
        'Complete index of all ServalSheets resources. Start here to discover available tools, knowledge, patterns, and guides.',
      mimeType: 'application/json',
    },
    async (uri) => {
      const categories = getResourceCategories();
      const quickStart = getQuickStartResources();
      const tools = getToolSummary();
      const availableActionCount = tools.reduce((sum, tool) => sum + tool.actions, 0);
      const promptBuckets = listPromptCatalogBuckets();
      const flowCatalog = listFlowCatalogEntries();

      const totalResources = Object.values(categories).reduce((sum, cat) => sum + cat.count, 0);

      const indexContent = {
        $schema: 'servalsheets://index',
        version: VERSION,
        protocol: 'MCP 2025-11-25',
        generated: new Date().toISOString(),

        // Summary statistics
        stats: {
          tools: TOOL_COUNT,
          actions: availableActionCount,
          catalogActions: ACTION_COUNT,
          resources: totalResources,
          prompts: getPromptsCatalogCount(),
          promptBuckets: promptBuckets.length,
          workflowFlows: getFlowCatalogCount(),
          knowledgeFiles: 38,
        },

        // Resource categories
        categories,

        // Tools overview
        tools: {
          total: TOOL_COUNT,
          totalActions: availableActionCount,
          catalogTotalActions: ACTION_COUNT,
          byActionCount: tools,
        },

        // Scenario-oriented discovery for the prompt surface
        promptCatalog: {
          total: getPromptsCatalogCount(),
          bucketCount: promptBuckets.length,
          usage:
            'Use prompts/list or prompts/get for execution. Use these buckets to find the right prompt family by scenario.',
          buckets: promptBuckets,
        },

        // Canonical flow discovery for sheets_analyze plan/execute_plan
        workflowCatalog: {
          total: flowCatalog.length,
          usage:
            'Use sheets_analyze action:"plan" to build an analysis plan, then action:"execute_plan" to execute or inspect the resulting steps.',
          flows: flowCatalog,
        },

        // Quick start guides
        quickStart,

        // Common workflows
        commonWorkflows: [
          {
            name: 'Read Data',
            description: 'Read data from a spreadsheet range',
            steps: ['sheets_auth status', 'sheets_data read'],
            resourceToRead: 'servalsheets://patterns/simple_read',
          },
          {
            name: 'Batch Operations',
            description: 'Multiple reads/writes in single API call',
            steps: ['sheets_data batch_read OR batch_write'],
            resourceToRead: 'servalsheets://guides/batching-strategies',
          },
          {
            name: 'Full Analysis',
            description: 'Explore sheet structure, then run a full audit only if needed',
            steps: ['sheets_auth status', 'sheets_analyze scout', 'sheets_analyze comprehensive'],
            resourceToRead: 'servalsheets://patterns/comprehensive_audit',
          },
          {
            name: 'Safe Modifications',
            description: 'Modify data with transaction safety',
            steps: [
              'sheets_transaction begin',
              'sheets_transaction queue',
              'sheets_confirm request',
              'sheets_transaction commit',
            ],
            resourceToRead: 'servalsheets://decisions/when-to-use-transaction',
          },
        ],

        // How to use this index
        usage: {
          discovery:
            "Browse 'categories' to find resources by type. Use 'whenToUse' to decide which category fits your need.",
          toolSelection:
            "Check 'tools.byActionCount' for available tools, route directly when intent is explicit, and read schema://tools/{toolName} for details before complex calls.",
          promptSelection:
            "Use 'promptCatalog.buckets' to browse prompts by scenario, then call prompts/get with the selected prompt name and arguments.",
          workflowPlanning:
            'Use \'workflowCatalog.flows\' to choose a built-in analysis workflow, then call sheets_analyze action:"plan" or action:"execute_plan".',
          gettingStarted:
            "Follow 'quickStart.firstTimeUser' resources in order for a guided introduction.",
          optimization:
            "Read 'servalsheets://guides/quota-optimization' before making many API calls.",
        },
      };

      return {
        contents: [
          {
            uri: typeof uri === 'string' ? uri : uri.toString(),
            mimeType: 'application/json',
            text: JSON.stringify(indexContent),
          },
        ],
      };
    }
  );

  // Also register a simple capabilities resource
  server.registerResource(
    'ServalSheets Capabilities',
    'servalsheets://capabilities',
    {
      description: 'Quick summary of ServalSheets capabilities for tool selection',
      mimeType: 'application/json',
    },
    async (uri) => {
      const capabilities = {
        version: VERSION,
        summary: `ServalSheets: ${TOOL_COUNT} tools, ${ACTION_COUNT} actions for Google Sheets automation`,

        canDo: [
          'Read/write cell data with batching',
          'Format cells (colors, fonts, borders, validation)',
          'Create charts and pivot tables',
          'Share and manage permissions',
          'Track version history',
          'Run AI-powered analysis',
          'Execute atomic transactions',
          'Automate with Apps Script',
          'Connect to BigQuery',
          'Set up webhooks for changes',
          'Trace formula dependencies and model scenarios',
          'Run server-side compute, regression, and forecasting',
          'Pull live data from external connectors',
          'Call remote MCP servers via federation',
          'Execute multi-step agent workflows with rollback',
        ],

        startWith: 'sheets_auth action:"status"',

        topTools: [
          { tool: 'sheets_data', use: 'Read/write data' },
          { tool: 'sheets_analyze', use: 'AI analysis' },
          { tool: 'sheets_format', use: 'Cell formatting' },
          { tool: 'sheets_visualize', use: 'Charts/pivots' },
          { tool: 'sheets_transaction', use: 'Atomic operations' },
        ],

        moreInfo: 'servalsheets://index',
      };

      return {
        contents: [
          {
            uri: typeof uri === 'string' ? uri : uri.toString(),
            mimeType: 'application/json',
            text: JSON.stringify(capabilities),
          },
        ],
      };
    }
  );
}
