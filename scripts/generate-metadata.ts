#!/usr/bin/env tsx
/**
 * Generate metadata from schema files using AST parsing
 *
 * Single source of truth: src/schemas/*.ts discriminated unions
 * Derived outputs:
 * - Tool/action counts
 * - package.json description
 * - manifest.json registry metadata
 * - src/schemas/index.ts exports
 * - src/generated/action-counts.ts ACTION_COUNTS
 * - src/generated/completions.ts TOOL_ACTIONS
 * - server.json metadata
 *
 * Uses TypeScript Compiler API for robust AST parsing instead of regex.
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import * as ts from 'typescript';
import {
  SERVER_ICON_DATA_URI,
  SERVER_ICON_MIME_TYPE,
  SERVER_ICON_SIZES,
} from '../src/constants/server-icon.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');
const DOCS_BASE_URL = 'https://servalsheets.dev';
const PRIVACY_POLICY_URL = `${DOCS_BASE_URL}/privacy`;
const SUPPORT_URL = 'https://github.com/khill1269/servalsheets/issues';
const REPOSITORY_URL = 'https://github.com/khill1269/servalsheets.git';

// ============================================================================
// CLI FLAGS
// ============================================================================

const VALIDATE_MODE = process.argv.includes('--validate');
if (VALIDATE_MODE) {
  console.log('🔍 Running in validation mode (no files will be written)...\n');
}

const METADATA_TOOL_CATEGORIES = [
  {
    label: 'Core Operations',
    tools: ['auth', 'core', 'data', 'format', 'dimensions'],
  },
  {
    label: 'Visual Analytics',
    tools: ['visualize'],
  },
  {
    label: 'Collaboration & Governance',
    tools: ['collaborate'],
  },
  {
    label: 'Advanced Sheet Structures',
    tools: ['advanced'],
  },
  {
    label: 'Reliability & Recovery',
    tools: ['transaction', 'quality', 'history'],
  },
  {
    label: 'AI-Native Workflows',
    tools: ['confirm', 'analyze', 'fix'],
  },
  {
    label: 'Productivity & Composition',
    tools: ['composite', 'session'],
  },
  {
    label: 'Templates & Integrations',
    tools: ['templates', 'bigquery', 'appsscript'],
  },
  {
    label: 'Automation & Events',
    tools: ['webhook'],
  },
  {
    label: 'Formula Intelligence',
    tools: ['dependencies'],
  },
  {
    label: 'Federation & Compute',
    tools: ['federation', 'compute'],
  },
  {
    label: 'Agentic Execution & Connectors',
    tools: ['agent', 'connectors'],
  },
] as const;

/**
 * Track files that would be written vs their current content.
 * In validate mode, we compare without writing.
 */
const pendingWrites: Array<{ path: string; content: string }> = [];

function writeOrTrack(filePath: string, content: string): void {
  if (VALIDATE_MODE) {
    pendingWrites.push({ path: filePath, content });
  } else {
    writeFileSync(filePath, content);
  }
}

// ============================================================================
// SPECIAL CASE TOOLS (don't follow standard discriminated union pattern)
// ============================================================================

const SPECIAL_CASE_TOOLS: Record<string, { count: number; actions: string[] }> = {
  // fix: removed — now uses standard discriminated union (6 actions, F3)
  // NOTE: analyze and confirm kept as special cases because AST parser over-counts
  // (finds z.literal in output schemas too, not just input discriminated unions)
  analyze: {
    count: 26,
    actions: [
      'comprehensive',
      'analyze_data',
      'suggest_visualization',
      'generate_formula',
      'detect_patterns',
      'analyze_structure',
      'analyze_quality',
      'analyze_performance',
      'analyze_formulas',
      'query_natural_language',
      'explain_analysis',
      'scout',
      'plan',
      'execute_plan',
      'drill_down',
      'generate_actions',
      // F4: Smart Suggestions
      'suggest_next_actions',
      'auto_enhance',
      // Meta-tools
      'discover_action',
      // Diagnostic actions
      'diagnose_errors',
      'formula_health_check',
      // S3-A: Fast structural snapshot
      'quick_insights',
      // ISSUE-174/175: Semantic search
      'semantic_search',
      // Scheduled Intelligence Engine
      'schedule_intelligence',
      'get_intelligence_report',
      'cancel_intelligence',
    ],
  },
  confirm: {
    count: 5,
    actions: ['request', 'get_stats', 'wizard_start', 'wizard_step', 'wizard_complete'],
  },
  validation: { count: 1, actions: ['validate'] }, // No schema file (mapped to quality.ts handler)
  impact: { count: 1, actions: ['analyze'] }, // No schema file (mapped to quality.ts handler)
  federation: {
    count: 4,
    actions: ['call_remote', 'list_servers', 'get_server_tools', 'validate_connection'],
  },
};

// ============================================================================
// AST-BASED ACTION EXTRACTION
// ============================================================================

interface SchemaAnalysis {
  toolName: string;
  fileName: string;
  actionCount: number;
  actions: string[];
  hasDiscriminatedUnion: boolean;
}

/**
 * Extract action values from z.enum(['action1', 'action2', ...]) AST node
 * Handles flattened schema pattern with z.object({ action: z.enum([...]) })
 */
function extractActionEnum(node: ts.Node): string[] | null {
  if (ts.isPropertyAssignment(node)) {
    const name = node.name;
    if (ts.isIdentifier(name) && name.text === 'action') {
      // Look for z.enum([...]) pattern
      return findEnumInChain(node.initializer);
    }
  }
  return null;
}

/**
 * Find z.enum(['action1', 'action2']) in a chain of method calls
 */
function findEnumInChain(node: ts.Node): string[] | null {
  if (ts.isCallExpression(node)) {
    const expression = node.expression;

    // Check if this is z.enum(...)
    if (ts.isPropertyAccessExpression(expression)) {
      const property = expression.name;
      if (ts.isIdentifier(property) && property.text === 'enum') {
        const args = node.arguments;
        const firstArg = args[0];
        if (firstArg && ts.isArrayLiteralExpression(firstArg)) {
          // Extract all string literals from the array
          const actions: string[] = [];
          for (const element of firstArg.elements) {
            if (ts.isStringLiteral(element)) {
              actions.push(element.text);
            }
          }
          return actions.length > 0 ? actions : null;
        }
      }

      // Not z.enum, but might be a chained call like .describe()
      const objectPart = expression.expression;
      if (ts.isCallExpression(objectPart)) {
        return findEnumInChain(objectPart);
      }
    }
  }
  return null;
}

/**
 * Extract action literal from z.literal('action_name') AST node
 * Handles chained calls like z.literal('action').describe('...')
 */
function extractActionLiteral(node: ts.Node): string | null {
  // Looking for: action: z.literal('some_action') or action: z.literal('some_action').describe('...')
  if (ts.isPropertyAssignment(node)) {
    const name = node.name;
    if (ts.isIdentifier(name) && name.text === 'action') {
      // Recursively find z.literal() in the initializer chain
      return findLiteralInChain(node.initializer);
    }
  }
  return null;
}

/**
 * Recursively find z.literal('value') in a chain of method calls
 * Handles: z.literal('x'), z.literal('x').describe('y'), z.literal('x').default('y').describe('z'), etc.
 */
function findLiteralInChain(node: ts.Node): string | null {
  if (ts.isCallExpression(node)) {
    const expression = node.expression;

    // Check if this is directly z.literal(...)
    if (ts.isPropertyAccessExpression(expression)) {
      const property = expression.name;
      if (ts.isIdentifier(property) && property.text === 'literal') {
        const args = node.arguments;
        const firstArg = args[0];
        if (firstArg && ts.isStringLiteral(firstArg)) {
          return firstArg.text;
        }
      }

      // Not z.literal, but might be a chained call like .describe()
      // Check the object part of the property access (e.g., z.literal('x') in z.literal('x').describe())
      const objectPart = expression.expression;
      if (ts.isCallExpression(objectPart)) {
        return findLiteralInChain(objectPart);
      }
    }
  }
  return null;
}

/**
 * Recursively visit AST nodes to find action literals or enums
 */
function visitNode(node: ts.Node, actions: string[]): void {
  // Try to extract z.enum() pattern first (flattened schemas)
  const actionEnum = extractActionEnum(node);
  if (actionEnum) {
    actions.push(...actionEnum);
    return; // Found enum, don't look for literals in this subtree
  }

  // Fall back to z.literal() pattern (discriminated unions)
  const actionLiteral = extractActionLiteral(node);
  if (actionLiteral) {
    actions.push(actionLiteral);
  }

  ts.forEachChild(node, (child) => visitNode(child, actions));
}

/**
 * Analyze a schema file using TypeScript AST parsing
 */
function analyzeSchemaFile(filePath: string): SchemaAnalysis {
  const fileName = filePath.split('/').pop() || '';
  const toolName = fileName.replace('.ts', '').replace(/-/g, '_');

  // Check for special cases first
  if (SPECIAL_CASE_TOOLS[toolName]) {
    const special = SPECIAL_CASE_TOOLS[toolName];
    return {
      toolName,
      fileName,
      actionCount: special.count,
      actions: special.actions,
      hasDiscriminatedUnion: false,
    };
  }

  try {
    const content = readFileSync(filePath, 'utf-8');

    // Create a source file (no type checking needed, just parsing)
    const sourceFile = ts.createSourceFile(fileName, content, ts.ScriptTarget.Latest, true);

    const actions: string[] = [];

    // Walk the AST to find all action literals
    visitNode(sourceFile, actions);

    // Remove duplicates (shouldn't happen, but be safe)
    const uniqueActions = Array.from(new Set(actions));

    return {
      toolName,
      fileName,
      actionCount: uniqueActions.length,
      actions: uniqueActions,
      hasDiscriminatedUnion: uniqueActions.length > 0,
    };
  } catch (error) {
    console.error(`⚠️  Error parsing ${fileName}:`, error);
    return {
      toolName,
      fileName,
      actionCount: 0,
      actions: [],
      hasDiscriminatedUnion: false,
    };
  }
}

// ============================================================================
// SCAN SCHEMA FILES
// ============================================================================

const schemaFiles = readdirSync(join(ROOT, 'src/schemas')).filter(
  (f) =>
    f.endsWith('.ts') &&
    f !== 'index.ts' &&
    f !== 'shared.ts' &&
    f !== 'action-counts.ts' && // Action counts source of truth, not a tool schema
    f !== 'annotations.ts' &&
    f !== 'descriptions.ts' &&
    f !== 'descriptions-minimal.ts' && // Minimal descriptions, not a tool
    f !== 'prompts.ts' &&
    f !== 'logging.ts' &&
    f !== 'fast-validators.ts' &&
    f !== 'action-metadata.ts' && // Not a tool, just metadata definitions
    f !== 'formulas.ts' && // Merged into sheets_advanced (Wave 5)
    f !== 'analysis.ts' // DEPRECATED: sheets_analyze replaced by sheets_analyze (Phase 1)
);

console.log(`\n📊 Analyzing ${schemaFiles.length} schema files...\n`);

const analyses: SchemaAnalysis[] = [];
let totalActions = 0;

for (const file of schemaFiles) {
  const path = join(ROOT, 'src/schemas', file);
  const analysis = analyzeSchemaFile(path);
  analyses.push(analysis);
  totalActions += analysis.actionCount;

  if (analysis.actionCount > 0) {
    const actionList =
      analysis.actions.length <= 5
        ? `[${analysis.actions.join(', ')}]`
        : `[${analysis.actions.slice(0, 3).join(', ')}, ... +${analysis.actions.length - 3} more]`;
    console.log(
      `  📝 ${file.padEnd(20)} → ${String(analysis.actionCount).padStart(2)} actions ${actionList}`
    );
  }
}

// Only count schemas that have actions (excludes non-tool schema files like handler-deviations.ts)
const toolAnalyses = analyses.filter((a) => a.actionCount > 0);
const TOOL_COUNT = toolAnalyses.length;
const ACTION_COUNT = totalActions;

console.log(`\n✅ Total: ${TOOL_COUNT} tools, ${ACTION_COUNT} actions\n`);

function updateToolAndActionCounts(text: string, separator: ',' | 'and' | 'with'): string {
  if (separator === ',') {
    return text.replace(
      /\d+\s+tools\s*,\s+\d+\s+actions/gi,
      `${TOOL_COUNT} tools, ${ACTION_COUNT} actions`
    );
  }
  if (separator === 'and') {
    return text.replace(
      /\d+\s+tools\s+and\s+\d+\s+actions/gi,
      `${TOOL_COUNT} tools and ${ACTION_COUNT} actions`
    );
  }
  return text.replace(
    /\d+\s+tools\s+with\s+\d+\s+actions/gi,
    `${TOOL_COUNT} tools with ${ACTION_COUNT} actions`
  );
}

function syncCountedDescription(text: string): string {
  let updated = updateToolAndActionCounts(text, ',');
  updated = updateToolAndActionCounts(updated, 'and');
  updated = updateToolAndActionCounts(updated, 'with');
  return updated;
}

function syncToolDescription(
  existingDescription: unknown,
  toolName: string,
  actionCount: number
): string {
  if (typeof existingDescription === 'string' && existingDescription.trim().length > 0) {
    if (/\(\d+\s+actions\)/i.test(existingDescription)) {
      return existingDescription.replace(/\(\d+\s+actions\)/i, `(${actionCount} actions)`);
    }
    if (/\d+\s+actions/i.test(existingDescription)) {
      return existingDescription.replace(/\d+\s+actions/i, `${actionCount} actions`);
    }
    return `${existingDescription.trim()} (${actionCount} actions)`;
  }

  return `${toolName} operations (${actionCount} actions)`;
}

const sortedToolAnalyses = [...toolAnalyses].sort((left, right) =>
  left.toolName.localeCompare(right.toolName)
);

// ============================================================================
// UPDATE PACKAGE.JSON
// ============================================================================

const pkgPath = join(ROOT, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));

const oldDescription = pkg.description;
pkg.description = syncCountedDescription(oldDescription);

if (oldDescription !== pkg.description) {
  writeOrTrack(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  console.log('✅ Updated package.json description');
} else {
  console.log('✓  package.json already up to date');
}

// ============================================================================
// UPDATE SRC/SCHEMAS/INDEX.TS
// ============================================================================

const schemasIndexPath = join(ROOT, 'src/schemas/index.ts');
let schemasIndex = readFileSync(schemasIndexPath, 'utf-8');

// Update TOOL_COUNT and ACTION_COUNT constants
schemasIndex = schemasIndex.replace(
  /\/\/ Tool count\nexport const TOOL_COUNT = [^;]+;/,
  `// Tool count\nexport const TOOL_COUNT = ${TOOL_COUNT};`
);

schemasIndex = schemasIndex.replace(
  /\/\/ Action count\nexport const ACTION_COUNT = [^;]+;/,
  `// Action count\nexport const ACTION_COUNT = ${ACTION_COUNT};`
);

writeOrTrack(schemasIndexPath, schemasIndex);
console.log('✅ Updated src/schemas/index.ts constants');

// ============================================================================
// UPDATE SRC/GENERATED/ACTION-COUNTS.TS - ACTION_COUNTS
// ============================================================================

const actionCountsPath = join(ROOT, 'src/generated/action-counts.ts');

// Build ACTION_COUNTS map
const actionCountsMap = analyses
  .filter((a) => a.actionCount > 0)
  .map((a) => `  sheets_${a.toolName}: ${a.actionCount},`)
  .join('\n');

// Generate complete action-counts.ts file
const actionCountsContent = `// @generated — Do not edit manually. Run npm run schema:commit to regenerate.
/**
 * ServalSheets - Action Counts
 *
 * Source of truth for the number of actions per tool.
 * This file has NO dependencies to avoid circular imports.
 *
 * Auto-generated by scripts/generate-metadata.ts
 */

export const ACTION_COUNTS: Record<string, number> = {
${actionCountsMap}
};

/**
 * Total number of tools (calculated)
 */
export const TOOL_COUNT = Object.keys(ACTION_COUNTS).length;

/**
 * Total number of actions across all tools (calculated)
 */
export const ACTION_COUNT = Object.values(ACTION_COUNTS).reduce((sum, count) => sum + count, 0);
`;

writeOrTrack(actionCountsPath, actionCountsContent);
console.log('✅ Updated src/schemas/action-counts.ts ACTION_COUNTS');

// ============================================================================
// UPDATE SRC/GENERATED/COMPLETIONS.TS - TOOL_ACTIONS
// ============================================================================

const completionsPath = join(ROOT, 'src/generated/completions.ts');
let completionsContent = readFileSync(completionsPath, 'utf-8');

// Build TOOL_ACTIONS map - always use multi-line for consistency
const toolActionsMap = analyses
  .filter((a) => a.actionCount > 0)
  .map((a) => {
    const actionLines = a.actions.map((act) => `    '${act}',`).join('\n');
    return `  sheets_${a.toolName}: [\n${actionLines}\n  ],`;
  })
  .join('\n');

const toolActionsBlock = `const TOOL_ACTIONS: Record<string, string[]> = {\n${toolActionsMap}\n};`;

// Replace existing TOOL_ACTIONS
if (completionsContent.includes('const TOOL_ACTIONS')) {
  completionsContent = completionsContent.replace(
    /const TOOL_ACTIONS: Record<string, string\[\]> = \{[\s\S]*?\};/,
    toolActionsBlock
  );
} else {
  // Add after imports
  const importEndIndex = completionsContent.lastIndexOf('import ');
  const nextLineIndex = completionsContent.indexOf('\n', importEndIndex) + 1;
  completionsContent =
    completionsContent.slice(0, nextLineIndex) +
    `\n// ============================================================================\n// TOOL ACTIONS (Auto-generated)\n// ============================================================================\n\n${toolActionsBlock}\n\n` +
    completionsContent.slice(nextLineIndex);
}

writeOrTrack(completionsPath, completionsContent);
// Note: Prettier formatting removed from this script to prevent generate/validate drift.
// Run `npm run format` separately if formatting is needed.
console.log('✅ Updated src/mcp/completions.ts TOOL_ACTIONS');

// ============================================================================
// GENERATE SERVER.JSON
// ============================================================================

const serverJson = {
  $schema:
    'https://cdn.jsdelivr.net/npm/@anthropic-ai/mcp-registry@latest/dist/registry-schema.json',
  name: pkg.mcpName || pkg.name,
  version: pkg.version,
  description: `Production-grade Google Sheets MCP server with ${TOOL_COUNT} tools and ${ACTION_COUNT} actions`,
  icons: [
    {
      src: SERVER_ICON_DATA_URI,
      mimeType: SERVER_ICON_MIME_TYPE,
      sizes: [...SERVER_ICON_SIZES],
    },
  ],
  mcpProtocol: '2025-11-25',
  instructions:
    'ServalSheets uses an envelope parameter format:\n' +
    '{"request":{"action":"...", "spreadsheetId":"...", "range":"..."}}\n\n' +
    'LEGACY compatibility format (also accepted, normalized at runtime):\n' +
    '{"action":"...", "spreadsheetId":"...", "range":"..."}\n\n' +
    '---\n\n' +
    'ServalSheets provides ' +
    TOOL_COUNT +
    ' tools for Google Sheets operations. Start with sheets_auth action "status". If the user request is explicit, route directly to the matching tool. Use sheets_analyze action "scout" for quick exploration and "comprehensive" only for full audits. For token efficiency, read schema://tools/{toolName} before calling tools with complex parameters.',
  packages: [
    {
      registryType: 'npm',
      identifier: 'servalsheets',
      version: pkg.version,
      transport: {
        type: 'stdio',
      },
      description: pkg.description,
    },
  ],
  tools: sortedToolAnalyses.map((a) => ({
    name: `sheets_${a.toolName}`,
    description: `${a.toolName} operations (${a.actionCount} actions)`,
    actions: a.actions,
  })),
  capabilities: ['tools', 'resources', 'prompts', 'logging', 'completions', 'tasks'],
  metadata: {
    toolCount: TOOL_COUNT,
    actionCount: ACTION_COUNT,
    categories: (() => {
      const toolNames = analyses
        .filter((a) => a.actionCount > 0)
        .map((a) => a.toolName)
        .sort();
      const categorizedToolNames = METADATA_TOOL_CATEGORIES.flatMap(
        (category) => category.tools
      ).sort();
      const missingTools = toolNames.filter((tool) => !categorizedToolNames.includes(tool));
      const extraTools = categorizedToolNames.filter((tool) => !toolNames.includes(tool));
      const duplicateTools = categorizedToolNames.filter(
        (tool, index, array) => array.indexOf(tool) !== index
      );

      if (missingTools.length > 0 || extraTools.length > 0 || duplicateTools.length > 0) {
        throw new Error(
          `Metadata category drift detected. Missing: ${missingTools.join(', ') || 'none'}; ` +
            `extra: ${extraTools.join(', ') || 'none'}; ` +
            `duplicates: ${Array.from(new Set(duplicateTools)).join(', ') || 'none'}`
        );
      }

      return METADATA_TOOL_CATEGORIES.map(
        (category) =>
          `${category.label} (${category.tools.length} ${category.tools.length === 1 ? 'tool' : 'tools'}): ${category.tools.join(', ')}`
      );
    })(),
  },
  author: {
    name: 'Thomas Lee Cahill',
    url: 'https://github.com/khill1269',
  },
  repository: {
    type: 'git',
    url: REPOSITORY_URL,
    source: 'https://github.com/khill1269/servalsheets',
  },
  homepage: DOCS_BASE_URL,
  privacy_policies: [
    {
      url: PRIVACY_POLICY_URL,
      description: 'ServalSheets Privacy Policy',
    },
  ],
};

const serverJsonPath = join(ROOT, 'server.json');
writeOrTrack(serverJsonPath, JSON.stringify(serverJson, null, 2) + '\n');

// Note: Prettier formatting removed from this script to prevent generate/validate drift.
// Run `npm run format` separately if formatting is needed.

console.log('✅ Generated server.json');

// ============================================================================
// GENERATE ROOT MANIFEST.JSON
// ============================================================================

const registryManifestPath = join(ROOT, 'manifest.json');
const existingRegistryManifest = existsSync(registryManifestPath)
  ? JSON.parse(readFileSync(registryManifestPath, 'utf-8'))
  : {};
const existingManifestTools = new Map(
  Array.isArray(existingRegistryManifest.tools)
    ? existingRegistryManifest.tools
        .filter((tool): tool is { name: string; description?: string } => Boolean(tool?.name))
        .map((tool) => [tool.name, tool.description])
    : []
);

const registryManifest = {
  manifest_version: '0.3',
  name: pkg.name,
  display_name: 'ServalSheets',
  version: pkg.version,
  description: `Production-grade Google Sheets MCP server with ${TOOL_COUNT} tools and ${ACTION_COUNT} actions`,
  long_description: `ServalSheets is a production-grade MCP server for Google Sheets with ${TOOL_COUNT} tools and ${ACTION_COUNT} actions. Features OAuth 2.1, MCP sampling, elicitation, tasks, and advanced data operations.`,
  keywords: ['google-sheets', 'spreadsheet', 'mcp', 'ai', 'automation', 'data'],
  support: SUPPORT_URL,
  documentation: DOCS_BASE_URL,
  homepage: DOCS_BASE_URL,
  author: {
    name: 'Thomas Lee Cahill',
    url: 'https://github.com/khill1269',
  },
  repository: {
    type: 'git',
    url: REPOSITORY_URL,
  },
  license: 'MIT',
  icon: existingRegistryManifest.icon || 'assets/servalsheets-logo-512.png',
  server: {
    type: 'node',
    entry_point: 'dist/cli.js',
    mcp_config: {
      command: 'node',
      args: ['${__dirname}/dist/cli.js'],
      env: {
        LOG_LEVEL: '${user_config.LOG_LEVEL}',
        OAUTH_CLIENT_ID: '${user_config.OAUTH_CLIENT_ID}',
        OAUTH_CLIENT_SECRET: '${user_config.OAUTH_CLIENT_SECRET}',
        OAUTH_REDIRECT_URI: '${user_config.OAUTH_REDIRECT_URI}',
        GOOGLE_TOKEN_STORE_PATH: '${user_config.GOOGLE_TOKEN_STORE_PATH}',
        ENCRYPTION_KEY: '${user_config.ENCRYPTION_KEY}',
        OAUTH_SCOPE_MODE: '${user_config.OAUTH_SCOPE_MODE}',
      },
    },
  },
  compatibility: {
    claude_desktop: '>=0.10.0',
    platforms: ['darwin', 'win32', 'linux'],
    runtimes: {
      node: pkg.engines?.node,
    },
  },
  privacy_policies: [PRIVACY_POLICY_URL],
  user_config: {
    LOG_LEVEL: {
      type: 'string',
      title: 'Log Level',
      description: 'Log verbosity (error, warn, info, debug).',
      default: 'info',
      required: false,
    },
    OAUTH_CLIENT_ID: {
      type: 'string',
      title: 'OAuth Client ID',
      description:
        'Google desktop-app OAuth client ID. Required for this self-hosted release unless your packaging step injects bundled credentials.',
      required: true,
    },
    OAUTH_CLIENT_SECRET: {
      type: 'string',
      title: 'OAuth Client Secret',
      description:
        'Google desktop-app OAuth client secret. Required for this self-hosted release unless your packaging step injects bundled credentials.',
      sensitive: true,
      required: true,
    },
    OAUTH_REDIRECT_URI: {
      type: 'string',
      title: 'OAuth Redirect URI',
      description: 'Redirect URI for the local OAuth flow.',
      default: 'http://localhost:3000/callback',
      required: false,
    },
    GOOGLE_TOKEN_STORE_PATH: {
      type: 'string',
      title: 'Token Store Path',
      description: 'Path to the encrypted OAuth token store file.',
      default: '${HOME}${/}.config${/}servalsheets${/}tokens.enc',
      required: false,
    },
    ENCRYPTION_KEY: {
      type: 'string',
      title: 'Token Store Encryption Key',
      description: '64-character hex key used to encrypt stored OAuth tokens.',
      sensitive: true,
      required: false,
    },
    OAUTH_SCOPE_MODE: {
      type: 'string',
      title: 'OAuth Scope Mode',
      description: 'Requested Google OAuth scope set (`full` or `minimal`).',
      default: 'full',
      required: false,
    },
  },
  tools: sortedToolAnalyses.map((analysis) => ({
    name: `sheets_${analysis.toolName}`,
    description: syncToolDescription(
      existingManifestTools.get(`sheets_${analysis.toolName}`),
      analysis.toolName,
      analysis.actionCount
    ),
  })),
};

writeOrTrack(registryManifestPath, JSON.stringify(registryManifest, null, 2) + '\n');
console.log('✅ Generated manifest.json');

// ============================================================================
// GENERATE MANIFEST (src/generated/manifest.json)
// ============================================================================

const generatedDir = join(ROOT, 'src/generated');
if (!existsSync(generatedDir) && !VALIDATE_MODE) {
  mkdirSync(generatedDir, { recursive: true });
}

const manifest = {
  _comment: 'Auto-generated by scripts/generate-metadata.ts — DO NOT EDIT',
  toolCount: TOOL_COUNT,
  actionCount: ACTION_COUNT,
  tools: sortedToolAnalyses.map((a) => ({
    name: `sheets_${a.toolName}`,
    actionCount: a.actionCount,
    actions: a.actions,
  })),
};

const manifestPath = join(generatedDir, 'manifest.json');
writeOrTrack(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
console.log('✅ Generated src/generated/manifest.json');

// ============================================================================
// SPECIAL_CASE_TOOLS VALIDATION (cross-reference handler switch cases)
// ============================================================================

function validateSpecialCaseCounts(): boolean {
  console.log('\n🔍 Validating SPECIAL_CASE_TOOLS against handler switch cases...\n');
  let allValid = true;

  const handlerMapping: Record<string, string> = {
    analyze: join(ROOT, 'src/handlers/analyze.ts'),
    confirm: join(ROOT, 'src/handlers/confirm.ts'),
    federation: join(ROOT, 'src/handlers/federation.ts'),
  };

  for (const [toolName, config] of Object.entries(SPECIAL_CASE_TOOLS)) {
    const handlerPath = handlerMapping[toolName];
    if (!handlerPath || !existsSync(handlerPath)) {
      // Virtual tools (validation, impact) don't have dedicated handler files
      if (toolName === 'validation' || toolName === 'impact') {
        console.log(
          `  ⏭️  ${toolName}: virtual tool (mapped to quality.ts), skipping handler check`
        );
        continue;
      }
      console.warn(`  ⚠️  ${toolName}: handler file not found at ${handlerPath}`);
      continue;
    }

    const handlerContent = readFileSync(handlerPath, 'utf-8');

    // Count case 'action_name': patterns in switch statements
    const casePattern = /^        case\s+['"]([a-z_]+)['"]\s*:/gm;
    const handlerActions = new Set<string>();
    let match: RegExpExecArray | null;
    while ((match = casePattern.exec(handlerContent)) !== null) {
      handlerActions.add(match[1]);
    }

    // Check that every declared action has a handler case
    const missingInHandler: string[] = [];
    for (const action of config.actions) {
      if (!handlerActions.has(action)) {
        missingInHandler.push(action);
      }
    }

    // Check for handler cases not in SPECIAL_CASE_TOOLS
    const extraInHandler: string[] = [];
    for (const action of handlerActions) {
      if (!config.actions.includes(action)) {
        extraInHandler.push(action);
      }
    }

    if (missingInHandler.length > 0 || extraInHandler.length > 0) {
      allValid = false;
      console.error(
        `  ❌ ${toolName} (declared: ${config.count}, handler cases: ${handlerActions.size}):`
      );
      if (missingInHandler.length > 0) {
        console.error(`     Missing in handler: ${missingInHandler.join(', ')}`);
      }
      if (extraInHandler.length > 0) {
        console.error(`     Extra in handler (not declared): ${extraInHandler.join(', ')}`);
      }
    } else {
      console.log(
        `  ✅ ${toolName}: ${config.count} actions match handler (${handlerActions.size} cases)`
      );
    }
  }

  if (allValid) {
    console.log('\n✅ All SPECIAL_CASE_TOOLS counts match handler implementations\n');
  } else {
    console.error('\n❌ SPECIAL_CASE_TOOLS mismatch — update counts or handler switch cases\n');
  }
  return allValid;
}

// Always run special case validation
const specialCasesValid = validateSpecialCaseCounts();

// ============================================================================
// VALIDATION MODE: Compare pending writes with existing files
// ============================================================================

if (VALIDATE_MODE) {
  let driftFound = false;

  for (const { path: filePath, content: expectedContent } of pendingWrites) {
    if (!existsSync(filePath)) {
      console.error(`❌ DRIFT: File missing: ${filePath.replace(ROOT + '/', '')}`);
      driftFound = true;
      continue;
    }

    const actualContent = readFileSync(filePath, 'utf-8');
    // For JSON files, compare parsed content to ignore Prettier formatting differences
    // (Prettier may compact short arrays onto single lines, etc.)
    const isJsonFile = filePath.endsWith('.json');
    let contentMatches: boolean;

    if (isJsonFile) {
      try {
        const actualParsed = JSON.parse(actualContent);
        const expectedParsed = JSON.parse(expectedContent);
        contentMatches = JSON.stringify(actualParsed) === JSON.stringify(expectedParsed);
      } catch {
        contentMatches = false;
      }
    } else {
      // Normalize line endings and trailing whitespace for text comparison
      const normalize = (s: string) =>
        s
          .replace(/\r\n/g, '\n')
          .replace(/[ \t]+$/gm, '')
          .trimEnd();
      contentMatches = normalize(actualContent) === normalize(expectedContent);
    }

    if (!contentMatches) {
      console.error(`❌ DRIFT: ${filePath.replace(ROOT + '/', '')} is out of sync`);
      driftFound = true;
    }
  }

  if (driftFound || !specialCasesValid) {
    if (driftFound) {
      console.error('\n❌ METADATA DRIFT DETECTED — run `npm run gen:metadata` to fix');
    }
    if (!specialCasesValid) {
      console.error('❌ SPECIAL_CASE_TOOLS MISMATCH — update counts in generate-metadata.ts');
    }
    console.error('');
    process.exit(1);
  } else {
    console.log('\n✅ No metadata drift detected — all files are synchronized\n');
    process.exit(0);
  }
}

// ============================================================================
// SUMMARY
// ============================================================================

console.log(`
╔════════════════════════════════════════╗
║  Metadata Generation Complete          ║
╠════════════════════════════════════════╣
║  Tools:   ${String(TOOL_COUNT).padStart(3)}                         ║
║  Actions: ${String(ACTION_COUNT).padStart(3)}                         ║
║                                        ║
║  Updated:                              ║
║  ✓ package.json                        ║
║  ✓ src/schemas/index.ts                ║
║  ✓ src/generated/action-counts.ts       ║
║  ✓ src/generated/completions.ts        ║
║  ✓ manifest.json                       ║
║  ✓ server.json                         ║
║  ✓ src/generated/manifest.json         ║
╚════════════════════════════════════════╝
`);

process.exit(0);
