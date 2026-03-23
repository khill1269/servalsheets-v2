/**
 * ServalSheets - Knowledge Resources
 *
 * Registers embedded knowledge files as MCP resources.
 * These resources provide Claude with deep context about:
 * - Google Sheets API patterns
 * - Formula recipes and best practices
 * - Template structures
 * - Data schemas
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { readdir, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join, relative } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { VERSION } from '../version.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface KnowledgeResource {
  uri: string;
  name: string;
  description: string;
  path: string;
  mimeType: string;
  category: string;
}

/**
 * Recursively discovers all knowledge files in the knowledge directory.
 * Uses async fs operations to avoid blocking server startup.
 */
async function discoverKnowledgeFiles(baseDir: string): Promise<KnowledgeResource[]> {
  const resources: KnowledgeResource[] = [];

  async function walkDir(dir: string, category: string = 'general'): Promise<void> {
    if (!existsSync(dir)) return;

    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        // Use directory name as category
        await walkDir(fullPath, entry.name);
      } else if (entry.name.endsWith('.md') || entry.name.endsWith('.json')) {
        const relativePath = relative(baseDir, fullPath);
        const uri = `knowledge:///${relativePath.replace(/\\/g, '/')}`;
        const baseName = entry.name.replace(/\.(md|json)$/, '');
        const title = baseName
          .replace(/-/g, ' ')
          .replace(/_/g, ' ')
          .split(' ')
          .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
          .join(' ');

        const mimeType = entry.name.endsWith('.json') ? 'application/json' : 'text/markdown';

        const description = getResourceDescription(category, baseName);

        resources.push({
          uri,
          name: title,
          description,
          path: fullPath,
          mimeType,
          category,
        });
      }
    }
  }

  await walkDir(baseDir);
  return resources;
}

/**
 * Action-oriented descriptions for knowledge files.
 *
 * These descriptions tell Claude WHEN to use each file, not just what it contains.
 * Format: "Use when [situation]. Shows [content] with [benefit]."
 */
const KNOWLEDGE_DESCRIPTIONS: Record<string, string> = {
  // API Knowledge
  'api/batch-operations':
    'Use when performing 3+ operations on same spreadsheet. Shows batch_read/batch_write patterns for 80% API quota reduction with before/after code examples.',
  'api/charts':
    'Use when creating visualizations. Covers 17 chart types (line, bar, pie, scatter, etc.) with configuration options, styling, and chart_create examples.',
  'api/conditional-formatting':
    'Use when highlighting data patterns. Shows rule_add_conditional_format with color scales, icons, custom formulas, and priority ordering.',
  'api/data-validation':
    'Use when constraining user input. Covers dropdowns, date ranges, number constraints, custom formulas, and error messages with set_data_validation.',
  'api/named-ranges':
    'Use for readable formulas and dynamic references. Shows add_named_range, update_named_range with cross-sheet references and best practices.',
  'api/pivot-tables':
    'Use for data summarization and reporting. Covers pivot_create, grouping, calculated fields, filtering, and pivot_refresh patterns.',
  'api/limits/quotas':
    'CRITICAL: Read before making many API calls. Shows 100 requests/100 seconds limit, per-project quotas, and quota optimization strategies.',

  // Formula Knowledge
  'formulas/functions-reference':
    'Comprehensive reference of 100+ Sheets functions with syntax, examples, and common mistakes. Use when generating or explaining formulas.',
  'formulas/financial':
    'Use for budgets, loans, investments. Covers NPV, IRR, PMT, FV, XIRR with realistic examples and edge case handling.',
  'formulas/datetime':
    'Use for scheduling and time calculations. Shows DATE, DATEDIF, NETWORKDAYS, WORKDAY, EOMONTH with timezone considerations.',
  'formulas/lookup':
    'Use for data retrieval across sheets. Compares VLOOKUP vs INDEX/MATCH vs XLOOKUP with performance benchmarks.',
  'formulas/advanced':
    'Power user formulas. ARRAYFORMULA for bulk operations, QUERY for SQL-like filtering, FILTER/SORT for dynamic arrays.',
  'formulas/key-formulas':
    'Top 20 essential formulas every spreadsheet needs. Quick reference for common calculations.',

  // Schema Knowledge
  'schemas/project':
    'Project management data structure. Tasks, milestones, dependencies, status tracking. Use with setup_sheet action.',
  'schemas/crm':
    'Customer relationship management schema. Contacts, deals, activities, pipeline stages. Integration-ready structure.',
  'schemas/inventory':
    'Inventory tracking schema. SKUs, quantities, reorder points, valuation methods (FIFO, LIFO, average).',

  // Template Knowledge
  'templates/common-templates':
    'Index of all available templates with use cases. Read first to find the right template for user needs.',
  'templates/finance':
    'Budget tracking template. Income, expenses, categories, monthly/yearly views, charts. Use with setup_budget prompt.',
  'templates/project':
    'Project management template. Task lists, Gantt chart, milestones, team assignments, progress tracking.',
  'templates/sales':
    'Sales pipeline template. Lead stages, deal values, forecasting, team performance metrics.',
  'templates/inventory':
    'Inventory management template. Stock levels, reorder alerts, supplier info, cost tracking.',
  'templates/crm':
    'Customer management template. Contact database, interaction history, follow-up reminders.',
  'templates/marketing':
    'Marketing campaign template. Campaign tracking, channel performance, budget allocation, ROI analysis.',

  // Pattern Knowledge
  'workflow-patterns':
    'Multi-tool workflow examples showing optimal tool sequences. Read to understand UASEV+R protocol implementation.',
  'ui-ux-patterns':
    'UI/UX guidelines for spreadsheet design. Headers, colors, navigation, accessibility, mobile-friendly layouts.',
  'natural-language-guide':
    'How to interpret user requests and map to tool sequences. Essential for understanding ambiguous requests.',
  'user-intent-examples':
    '50+ examples of user intents mapped to correct tool calls. Use when unsure which tool to use.',
  'confirmation-guide':
    'When to use sheets_confirm. Thresholds for destructive operations, data volume limits, confirmation patterns.',
  'formula-antipatterns':
    'Common formula mistakes to avoid. Volatile functions, circular references, performance killers.',

  // New knowledge files (2026-02-19)
  'formulas/lambda-advanced':
    'Use when generating or debugging LAMBDA, LET, MAP, REDUCE, SCAN, BYROW, BYCOL, MAKEARRAY formulas. Shows function patterns, named function examples, and 50K row performance limit.',
  'api/query-function':
    'CRITICAL: Read before using QUERY or GQL. Complete syntax (SELECT/WHERE/GROUP BY/PIVOT/LABEL). Gotchas: month() is 0-based, no HAVING clause, date literal syntax, case-sensitive strings.',
  'api/importrange':
    'Use before or when using IMPORTRANGE. Covers interactive permission grant (cannot be automated), 30-min cache, 20K row limit, 50 cross-ref limit, and cross-sheet query patterns.',
  'api/slicers-tables':
    'Use when creating slicers or Tables API objects. Shows exact JSON shapes, columnProperties (NOT tableColumns), DROPDOWN validation requirement, and slicer-chart linkage via range overlap.',
  'formulas/array-formulas-legacy':
    'Use when working with ARRAYFORMULA, REGEXMATCH, REGEXEXTRACT, FILTER, SORT, UNIQUE, XLOOKUP. Shows legacy array patterns and when to use modern alternatives (MAP/SCAN).',
  'api/bigquery-connected-sheets':
    'Use for BigQuery integration. Covers export_to_bigquery, query patterns, schema auto-detection, cost optimization, and BigQuery↔Sheets data type mappings.',

  // Masterclass Knowledge
  'masterclass/formula-optimization-master':
    'Advanced formula optimization. Reduce calculation time, leverage array formulas, minimize volatile function usage.',
  'masterclass/performance-tuning-master':
    'Performance tuning guide. Caching strategies, lazy loading, parallel execution, memory management.',
  'masterclass/data-quality-master':
    'Data quality standards. Validation rules, anomaly detection, consistency checks, data profiling.',
  'masterclass/schema-governance-master':
    'Schema design best practices. Naming conventions, type safety, documentation, versioning.',
  'masterclass/security-compliance-master':
    'Security and compliance guide. Permission management, audit trails, PII handling, access control patterns.',
  'masterclass/apps-script-integration-master':
    'Apps Script integration. Custom functions, triggers, web apps, API extensions, deployment.',
  'masterclass/concurrency-patterns-master':
    'Concurrent editing patterns. Conflict detection, resolution strategies, optimistic locking.',
};

/**
 * Generates a description based on category and file name.
 * Uses action-oriented descriptions from KNOWLEDGE_DESCRIPTIONS when available.
 */
function getResourceDescription(category: string, baseName: string): string {
  // Check for specific file description first
  const fullKey = `${category}/${baseName}`;
  if (KNOWLEDGE_DESCRIPTIONS[fullKey]) {
    return KNOWLEDGE_DESCRIPTIONS[fullKey]!;
  }

  // Check for root-level file description
  if (KNOWLEDGE_DESCRIPTIONS[baseName]) {
    return KNOWLEDGE_DESCRIPTIONS[baseName]!;
  }

  // Fallback to category-based description
  const categoryDescriptions: Record<string, string> = {
    api: 'Google Sheets API reference. Use when working with API operations.',
    formulas: 'Formula knowledge. Use when creating or debugging formulas.',
    schemas: 'Data structure definitions. Use when setting up new spreadsheets.',
    templates: 'Pre-built templates. Use when creating common spreadsheet types.',
    masterclass: 'Advanced optimization guides. Use for performance tuning.',
    general: 'ServalSheets knowledge base reference.',
  };

  const baseDescription = categoryDescriptions[category] || categoryDescriptions['general'];
  return `${baseDescription}: ${baseName.replace(/-/g, ' ')}`;
}

/**
 * Registers all knowledge resources with the MCP server.
 * Uses async discovery to avoid blocking server startup.
 */
export async function registerKnowledgeResources(server: McpServer): Promise<number> {
  const knowledgeDir = join(__dirname, '../knowledge');

  if (!existsSync(knowledgeDir)) {
    // Use console.error to write to stderr (not stdout in STDIO mode)
    console.error('[ServalSheets] Knowledge directory not found at:', knowledgeDir);
    console.error('[ServalSheets] Skipping knowledge resource registration');
    return 0;
  }

  const resources = await discoverKnowledgeFiles(knowledgeDir);

  if (resources.length === 0) {
    console.error('[ServalSheets] No knowledge files found');
    return 0;
  }

  // Group resources by category for logging
  const byCategory = resources.reduce(
    (acc, r) => {
      acc[r.category] = (acc[r.category] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  console.error('[ServalSheets] Discovered knowledge resources:');
  for (const [cat, count] of Object.entries(byCategory)) {
    console.error(`  - ${cat}: ${count} files`);
  }

  // Register each resource
  for (const resource of resources) {
    server.registerResource(
      resource.name,
      resource.uri,
      {
        description: resource.description,
        mimeType: resource.mimeType,
      },
      async () => {
        try {
          const content = await readFile(resource.path, 'utf-8');
          return {
            contents: [
              {
                uri: resource.uri,
                mimeType: resource.mimeType,
                text: content,
              },
            ],
          };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          return {
            contents: [
              {
                uri: resource.uri,
                mimeType: 'text/plain',
                text: `Error reading knowledge resource: ${errorMessage}`,
              },
            ],
          };
        }
      }
    );
  }

  console.error(`[ServalSheets] Registered ${resources.length} knowledge resources`);
  return resources.length;
}

/**
 * Returns a list of all available knowledge resources (for introspection).
 */
export async function listKnowledgeResources(): Promise<KnowledgeResource[]> {
  const knowledgeDir = join(__dirname, '../knowledge');
  if (!existsSync(knowledgeDir)) {
    return [];
  }
  return await discoverKnowledgeFiles(knowledgeDir);
}

/**
 * Knowledge category metadata for the index
 */
const CATEGORY_METADATA: Record<
  string,
  { description: string; whenToUse: string; relatedTools: string[] }
> = {
  api: {
    description: 'Google Sheets API patterns, limits, and best practices',
    whenToUse: 'When making API calls, optimizing quota usage, or understanding rate limits',
    relatedTools: ['sheets_data', 'sheets_core', 'sheets_transaction'],
  },
  formulas: {
    description: 'Formula functions, recipes, and optimization techniques',
    whenToUse: 'When creating formulas, debugging calculation errors, or optimizing performance',
    relatedTools: ['sheets_analyze', 'sheets_data', 'sheets_dependencies'],
  },
  schemas: {
    description: 'Data structure definitions for common use cases',
    whenToUse: 'When setting up new spreadsheets with structured data',
    relatedTools: ['sheets_composite', 'sheets_data', 'sheets_format'],
  },
  templates: {
    description: 'Pre-built spreadsheet templates for common applications',
    whenToUse: 'When creating budgets, CRMs, inventories, or project trackers',
    relatedTools: ['sheets_templates', 'sheets_composite', 'sheets_core'],
  },
  masterclass: {
    description: 'Advanced guides for optimization, security, and enterprise patterns',
    whenToUse: 'When tuning performance, implementing security, or handling complex scenarios',
    relatedTools: ['sheets_analyze', 'sheets_quality', 'sheets_appsscript', 'sheets_bigquery'],
  },
  limits: {
    description: 'API quotas and rate limits',
    whenToUse: 'Before making many API calls to plan within quota limits',
    relatedTools: ['sheets_transaction', 'sheets_data', 'sheets_composite'],
  },
};

/**
 * Register the knowledge index resource
 * URI: knowledge:///index
 */
export function registerKnowledgeIndexResource(server: McpServer): void {
  server.registerResource(
    'Knowledge Index',
    'knowledge:///index',
    {
      description:
        'Index of all knowledge resources with categories, descriptions, and usage guidance. Start here to find the right knowledge for your task.',
      mimeType: 'application/json',
    },
    async (uri) => {
      const resources = await listKnowledgeResources();

      // Group by category
      const byCategory = resources.reduce(
        (acc, r) => {
          if (!acc[r.category]) {
            acc[r.category] = [];
          }
          acc[r.category]!.push(r);
          return acc;
        },
        {} as Record<string, KnowledgeResource[]>
      );

      // Build index content
      const indexContent = {
        $schema: 'knowledge:///index',
        version: VERSION,
        generated: new Date().toISOString(),
        totalFiles: resources.length,

        // Category overview with metadata
        categories: Object.entries(byCategory).map(([category, files]) => ({
          name: category,
          fileCount: files.length,
          ...CATEGORY_METADATA[category],
          files: files.map((f) => ({
            uri: f.uri,
            name: f.name,
            description: f.description,
            mimeType: f.mimeType,
          })),
        })),

        // Quick access by topic
        quickAccess: {
          quotaManagement: [
            'knowledge:///api/limits/quotas.json',
            'knowledge:///api/batch-operations.md',
          ],
          formulaHelp: [
            'knowledge:///formulas/functions-reference.md',
            'knowledge:///formulas/key-formulas.json',
          ],
          templates: [
            'knowledge:///templates/common-templates.json',
            'knowledge:///templates/finance.json',
          ],
          performance: [
            'knowledge:///masterclass/performance-tuning-master.json',
            'knowledge:///masterclass/formula-optimization-master.json',
          ],
          workflows: [
            'knowledge:///workflow-patterns.json',
            'knowledge:///user-intent-examples.json',
          ],
        },

        // Semantic relationships between files
        relationships: {
          'api/batch-operations': [
            'formulas/advanced',
            'masterclass/performance-tuning-master',
            'api/limits/quotas',
          ],
          'templates/finance': ['formulas/financial', 'schemas/project'],
          'templates/crm': ['schemas/crm', 'formulas/lookup'],
          'templates/inventory': ['schemas/inventory', 'formulas/lookup'],
          'templates/project': ['schemas/project', 'formulas/datetime'],
          'formulas/lookup': ['formulas/advanced', 'masterclass/formula-optimization-master'],
          'formulas/financial': ['templates/finance', 'formulas/datetime'],
          'masterclass/performance-tuning-master': [
            'api/batch-operations',
            'api/limits/quotas',
            'masterclass/formula-optimization-master',
          ],
          'masterclass/security-compliance-master': [
            'masterclass/schema-governance-master',
            'api/limits/quotas',
          ],
          'workflow-patterns': [
            'user-intent-examples',
            'natural-language-guide',
            'confirmation-guide',
          ],
        },

        // Search keywords for fuzzy matching
        searchKeywords: {
          budget: ['templates/finance', 'formulas/financial'],
          sales: ['templates/sales', 'schemas/crm', 'templates/crm'],
          inventory: ['templates/inventory', 'schemas/inventory'],
          project: ['templates/project', 'schemas/project', 'formulas/datetime'],
          vlookup: ['formulas/lookup', 'formulas/advanced'],
          query: ['formulas/advanced'],
          arrayformula: ['formulas/advanced', 'masterclass/formula-optimization-master'],
          api: ['api/limits/quotas', 'api/batch-operations'],
          quota: ['api/limits/quotas', 'masterclass/performance-tuning-master'],
          performance: [
            'masterclass/performance-tuning-master',
            'masterclass/formula-optimization-master',
          ],
          security: ['masterclass/security-compliance-master'],
          chart: ['api/charts'],
          pivot: ['api/pivot-tables'],
          validation: ['api/data-validation', 'masterclass/data-quality-master'],
        },

        // Usage guidance
        usage: {
          howToSearch:
            "Browse categories by topic. Use 'searchKeywords' for quick lookup. Each file has a 'whenToUse' hint in its description.",
          recommended:
            "Start with 'knowledge:///api/limits/quotas.json' to understand API constraints.",
          integration:
            "Check 'relatedTools' to see which ServalSheets tools work best with each category.",
          relationships: "Use 'relationships' to find related files when you need deeper context.",
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
}
