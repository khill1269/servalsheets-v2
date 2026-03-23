#!/usr/bin/env tsx
/**
 * ServalSheets - API & MCP Compliance Validator
 *
 * Validates all registered tools/actions against:
 * 1. Google Sheets API v4 requirements
 * 2. MCP Protocol 2025-11-25 compliance
 * 3. Common implementation pitfalls
 *
 * Run: npm run validate:compliance
 */

import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Import all schemas
import { TOOL_DEFINITIONS } from '../src/mcp/registration/tool-definitions.js';
import { TOOL_ACTIONS } from '../src/mcp/completions.js';

// Color utilities
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(message: string, color: keyof typeof colors = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

interface ValidationIssue {
  severity: 'error' | 'warning' | 'info';
  tool: string;
  action?: string;
  category: string;
  message: string;
  file?: string;
  line?: number;
}

const issues: ValidationIssue[] = [];

function addIssue(issue: Omit<ValidationIssue, 'tool'> & { tool?: string }) {
  issues.push({
    tool: issue.tool || 'global',
    action: issue.action,
    category: issue.category,
    severity: issue.severity,
    message: issue.message,
    file: issue.file,
    line: issue.line,
  });
}

function unwrapZodPipe(schema: z.ZodTypeAny): z.ZodTypeAny {
  const def = (schema as { _def?: { type?: string; out?: z.ZodTypeAny } })._def;
  if (def?.type === 'pipe' && def.out) {
    return def.out;
  }
  return schema;
}

// ============================================================================
// 1. MCP PROTOCOL VALIDATION
// ============================================================================

function validateMcpSchemaStructure() {
  log('\n📋 Validating MCP Schema Structure...', 'cyan');

  for (const tool of TOOL_DEFINITIONS) {
    // Check input schema structure
    const inputSchema = tool.inputSchema;

    // Must be wrapped in z.object({ request: ... })
    if (!(inputSchema instanceof z.ZodObject)) {
      addIssue({
        severity: 'error',
        tool: tool.name,
        category: 'MCP_SCHEMA',
        message: 'Input schema must be z.object() wrapper',
        file: `src/schemas/${tool.name.replace('sheets_', '')}.ts`,
      });
      continue;
    }

    const shape = inputSchema.shape as Record<string, z.ZodTypeAny>;

    if (!shape.request) {
      addIssue({
        severity: 'error',
        tool: tool.name,
        category: 'MCP_SCHEMA',
        message: 'Input schema missing "request" wrapper field',
        file: `src/schemas/${tool.name.replace('sheets_', '')}.ts`,
      });
      continue;
    }

    // Check if request uses discriminated union
    const requestSchema = unwrapZodPipe(shape.request as z.ZodTypeAny);

    if (requestSchema instanceof z.ZodDiscriminatedUnion) {
      log(`  ✅ ${tool.name}: Correct discriminated union structure`, 'green');
    } else if (requestSchema instanceof z.ZodObject) {
      // Single action tool (like sheets_fix) or flattened action enum (SDK workaround)
      const requestShape = requestSchema.shape as Record<string, z.ZodTypeAny>;
      const actionSchema = requestShape.action;

      if (actionSchema instanceof z.ZodLiteral) {
        log(`  ✅ ${tool.name}: Single-action tool (literal action)`, 'green');
      } else if (actionSchema instanceof z.ZodEnum) {
        log(`  ✅ ${tool.name}: Flattened action enum (SDK workaround)`, 'green');
      } else {
        addIssue({
          severity: 'warning',
          tool: tool.name,
          category: 'MCP_SCHEMA',
          message: 'Request schema should use discriminated union or literal action',
          file: `src/schemas/${tool.name.replace('sheets_', '')}.ts`,
        });
      }
    } else {
      addIssue({
        severity: 'error',
        tool: tool.name,
        category: 'MCP_SCHEMA',
        message: 'Request field must be discriminated union or object with literal action',
        file: `src/schemas/${tool.name.replace('sheets_', '')}.ts`,
      });
    }

    // Check output schema structure
    const outputSchema = tool.outputSchema;

    if (!(outputSchema instanceof z.ZodObject)) {
      addIssue({
        severity: 'error',
        tool: tool.name,
        category: 'MCP_SCHEMA',
        message: 'Output schema must be z.object() wrapper',
        file: `src/schemas/${tool.name.replace('sheets_', '')}.ts`,
      });
      continue;
    }

    const outputShape = outputSchema.shape as Record<string, z.ZodTypeAny>;

    if (!outputShape.response) {
      addIssue({
        severity: 'error',
        tool: tool.name,
        category: 'MCP_SCHEMA',
        message: 'Output schema missing "response" wrapper field',
        file: `src/schemas/${tool.name.replace('sheets_', '')}.ts`,
      });
    }

    // Check if response discriminates on success field
    const responseSchema = outputShape.response;

    if (responseSchema instanceof z.ZodDiscriminatedUnion) {
      const discriminator = (responseSchema as unknown as { _def: { discriminator: string } })._def
        .discriminator;
      if (discriminator === 'success') {
        log(`  ✅ ${tool.name}: Output discriminates on "success" field`, 'green');
      } else {
        addIssue({
          severity: 'warning',
          tool: tool.name,
          category: 'MCP_SCHEMA',
          message: `Output discriminates on "${discriminator}" instead of "success"`,
          file: `src/schemas/${tool.name.replace('sheets_', '')}.ts`,
        });
      }
    } else {
      addIssue({
        severity: 'warning',
        tool: tool.name,
        category: 'MCP_SCHEMA',
        message: 'Output response should discriminate on "success" field',
        file: `src/schemas/${tool.name.replace('sheets_', '')}.ts`,
      });
    }
  }
}

function validateMcpActionCoverage() {
  log('\n🔍 Validating Action Coverage...', 'cyan');

  const expectedActions = TOOL_ACTIONS;
  const schemaActionCounts: Record<string, number> = {};

  for (const tool of TOOL_DEFINITIONS) {
    const toolName = tool.name;
    const inputSchema = tool.inputSchema;

    if (!(inputSchema instanceof z.ZodObject)) continue;

    const shape = inputSchema.shape as Record<string, z.ZodTypeAny>;
    const requestSchema = unwrapZodPipe(shape.request as z.ZodTypeAny);

    let actionCount = 0;

    if (requestSchema instanceof z.ZodDiscriminatedUnion) {
      const options = (requestSchema as unknown as { _def: { options: z.ZodTypeAny[] } })._def
        .options;
      actionCount = options.length;
    } else if (requestSchema instanceof z.ZodObject) {
      const requestShape = requestSchema.shape as Record<string, z.ZodTypeAny>;
      const actionSchema = requestShape.action;
      if (actionSchema instanceof z.ZodEnum) {
        actionCount = actionSchema.options.length;
      } else {
        actionCount = 1; // Single action
      }
    }

    schemaActionCounts[toolName] = actionCount;

    const expectedCount = expectedActions[toolName]?.length ?? 0;

    if (actionCount === expectedCount) {
      log(`  ✅ ${toolName}: ${actionCount} actions (matches expected)`, 'green');
    } else {
      addIssue({
        severity: 'error',
        tool: toolName,
        category: 'ACTION_COUNT',
        message: `Schema has ${actionCount} actions but TOOL_ACTIONS expects ${expectedCount}`,
        file: `src/schemas/${toolName.replace('sheets_', '')}.ts`,
      });
    }
  }
}

// ============================================================================
// 2. GOOGLE SHEETS API V4 VALIDATION
// ============================================================================

function validateGoogleApiPatterns() {
  log('\n🔌 Validating Google Sheets API Patterns...', 'cyan');

  // Check for JSON.stringify in request building (should not exist)
  const requestBuilderPath = path.join(__dirname, '../src/core/request-builder.ts');
  const batchCompilerPath = path.join(__dirname, '../src/core/batch-compiler.ts');

  try {
    const requestBuilderContent = fs.readFileSync(requestBuilderPath, 'utf-8');
    const lines = requestBuilderContent.split('\n');

    lines.forEach((line, index) => {
      if (line.includes('JSON.stringify') && !line.includes('//')) {
        addIssue({
          severity: 'error',
          category: 'GOOGLE_API',
          message: 'JSON.stringify found in request builder - requests should be direct objects',
          file: 'src/core/request-builder.ts',
          line: index + 1,
        });
      }
    });

    if (
      issues.filter((i) => i.category === 'GOOGLE_API' && i.file?.includes('request-builder'))
        .length === 0
    ) {
      log('  ✅ No JSON.stringify in request-builder.ts', 'green');
    }

    // Check batch compiler for proper payload validation
    const batchCompilerContent = fs.readFileSync(batchCompilerPath, 'utf-8');

    const hasPayloadValidation =
      batchCompilerContent.includes('validateBatchUpdatePayload') ||
      batchCompilerContent.includes('PAYLOAD_TOO_LARGE');
    if (hasPayloadValidation) {
      log('  ✅ Payload size validation present in batch-compiler', 'green');
    } else {
      addIssue({
        severity: 'error',
        category: 'GOOGLE_API',
        message: 'Missing payload size validation (validateBatchUpdatePayload check)',
        file: 'src/core/batch-compiler.ts',
      });
    }

    const has9mbLimit =
      batchCompilerContent.includes('limitMB: 9') ||
      batchCompilerContent.includes('limitMB:9') ||
      batchCompilerContent.includes('9_000_000') ||
      batchCompilerContent.includes('9000000');
    if (has9mbLimit) {
      log('  ✅ 9MB payload limit enforced', 'green');
    } else {
      addIssue({
        severity: 'warning',
        category: 'GOOGLE_API',
        message: 'Payload limit might not be set to 9MB',
        file: 'src/core/batch-compiler.ts',
      });
    }

    // Check for response parser integration
    if (batchCompilerContent.includes('ResponseParser.parseBatchUpdateResponse')) {
      log('  ✅ ResponseParser integrated (Phase 3)', 'green');
    } else {
      addIssue({
        severity: 'error',
        category: 'GOOGLE_API',
        message: 'Missing ResponseParser integration - using old compensatory diff pattern',
        file: 'src/core/batch-compiler.ts',
      });
    }
  } catch (error) {
    addIssue({
      severity: 'error',
      category: 'GOOGLE_API',
      message: `Failed to read API pattern files: ${error}`,
    });
  }
}

function validateResponseHandling() {
  log('\n📥 Validating Response Handling...', 'cyan');

  const responseParserPath = path.join(__dirname, '../src/core/response-parser.ts');

  try {
    const content = fs.readFileSync(responseParserPath, 'utf-8');

    // Check for proper response type handling
    const expectedResponseTypes = [
      'addSheet',
      'duplicateSheet',
      'findReplace',
      'addNamedRange',
      'addConditionalFormatRule',
      'addFilterView',
      'addChart',
      'trimWhitespace',
    ];

    for (const responseType of expectedResponseTypes) {
      if (
        content.includes(
          `parse${responseType.charAt(0).toUpperCase() + responseType.slice(1)}Reply`
        )
      ) {
        log(`  ✅ Handler for ${responseType} response`, 'green');
      } else {
        addIssue({
          severity: 'warning',
          category: 'RESPONSE_PARSING',
          message: `Missing parser for ${responseType} response type`,
          file: 'src/core/response-parser.ts',
        });
      }
    }

    // Check for generic fallback
    if (content.includes('// Generic response for operations without specific response data')) {
      log('  ✅ Generic fallback handler present', 'green');
    } else {
      addIssue({
        severity: 'warning',
        category: 'RESPONSE_PARSING',
        message: 'Missing generic fallback for operations without response data',
        file: 'src/core/response-parser.ts',
      });
    }
  } catch (error) {
    addIssue({
      severity: 'error',
      category: 'RESPONSE_PARSING',
      message: `Failed to read response parser: ${error}`,
    });
  }
}

// ============================================================================
// 3. HANDLER IMPLEMENTATION VALIDATION
// ============================================================================

function validateHandlerImplementations() {
  log('\n🛠️  Validating Handler Implementations...', 'cyan');

  const handlerFiles = [
    'auth',
    'core',
    'data',
    'format',
    'dimensions',
    'visualize',
    'collaborate',
    'advanced',
    'transaction',
    'quality',
    'history',
    'confirm',
    'analyze',
    'fix',
    'composite',
    'session',
  ];

  for (const handlerName of handlerFiles) {
    const handlerPath = path.join(__dirname, `../src/handlers/${handlerName}.ts`);

    if (!fs.existsSync(handlerPath)) {
      addIssue({
        severity: 'error',
        tool: `sheets_${handlerName}`,
        category: 'HANDLER',
        message: `Handler file not found: ${handlerName}.ts`,
      });
      continue;
    }

    try {
      const content = fs.readFileSync(handlerPath, 'utf-8');

      // Check for proper switch-case action routing
      if (content.includes('switch') && content.includes('case')) {
        log(`  ✅ sheets_${handlerName}: Switch-case routing present`, 'green');
      } else if (content.includes('async handle(')) {
        addIssue({
          severity: 'warning',
          tool: `sheets_${handlerName}`,
          category: 'HANDLER',
          message: 'Handler exists but no switch-case routing found',
          file: `src/handlers/${handlerName}.ts`,
        });
      }

      // Check for proper error handling (no silent returns)
      const returnEmptyMatches = content.match(/return\s+\{\s*\}/g);
      if (returnEmptyMatches && returnEmptyMatches.length > 0) {
        // Check if they have comments explaining the empty return
        const linesWithEmptyReturn: number[] = [];
        content.split('\n').forEach((line, index) => {
          if (line.match(/return\s+\{\s*\}/)) {
            linesWithEmptyReturn.push(index + 1);
          }
        });

        for (const lineNum of linesWithEmptyReturn) {
          const _lineContent = content.split('\n')[lineNum - 1];
          const prevLine = content.split('\n')[lineNum - 2] || '';

          if (!prevLine.includes('OK:') && !prevLine.includes('Explicit empty')) {
            addIssue({
              severity: 'warning',
              tool: `sheets_${handlerName}`,
              category: 'SILENT_FALLBACK',
              message: 'Potential silent fallback (return {})',
              file: `src/handlers/${handlerName}.ts`,
              line: lineNum,
            });
          }
        }
      }

      // Check for structured error returns
      const skipErrorHelperCheck = new Set([
        'auth',
        'transaction',
        'quality',
        'history',
        'confirm',
        'analyze',
        'session',
      ]);
      if (skipErrorHelperCheck.has(handlerName)) {
        log(`  ✅ sheets_${handlerName}: Error handling uses dedicated patterns`, 'green');
      } else {
        const errorHelperPatterns = [
          'this.error({',
          'buildError(',
          'mapError(',
          'createNotFoundError(',
          'createPermissionError(',
          'createRateLimitError(',
          'createAuthenticationError(',
        ];
        const hasErrorHelper = errorHelperPatterns.some((pattern) => content.includes(pattern));
        if (hasErrorHelper) {
          log(`  ✅ sheets_${handlerName}: Structured error handling`, 'green');
        } else {
          addIssue({
            severity: 'info',
            tool: `sheets_${handlerName}`,
            category: 'HANDLER',
            message: 'No structured error helper usage found (might use inline errors)',
            file: `src/handlers/${handlerName}.ts`,
          });
        }
      }

      // Check for direct API calls or handler-level API wiring into decomposed action modules
      const apiUsagePatterns = [
        /sheetsApi\.spreadsheets\./,
        /driveApi\./,
        /compositeService\./,
        /this\.sheetsApi\b/,
        /this\.driveApi\b/,
        /api:\s*this\.sheetsApi\b/,
        /sheetsApi:\s*this\.sheetsApi!?/,
        /driveApi:\s*this\.driveApi!?/,
      ];
      const apiCallPattern = apiUsagePatterns.some((pattern) => pattern.test(content));
      if (apiCallPattern) {
        log(`  ✅ sheets_${handlerName}: Google/Drive API usage present`, 'green');
      } else if (
        !['confirm', 'session', 'transaction', 'quality', 'history', 'auth'].includes(handlerName)
      ) {
        addIssue({
          severity: 'warning',
          tool: `sheets_${handlerName}`,
          category: 'HANDLER',
          message: 'No Google/Drive API usage found (might be abstracted)',
          file: `src/handlers/${handlerName}.ts`,
        });
      }
    } catch (error) {
      addIssue({
        severity: 'error',
        tool: `sheets_${handlerName}`,
        category: 'HANDLER',
        message: `Failed to read handler file: ${error}`,
      });
    }
  }
}

// ============================================================================
// 4. COMMON PITFALLS DETECTION
// ============================================================================

function detectCommonPitfalls() {
  log('\n⚠️  Detecting Common Pitfalls...', 'cyan');

  // Check for manual GridRange construction (should use helpers)
  const srcFiles = getAllTsFiles(path.join(__dirname, '../src'));

  let manualGridRangeCount = 0;
  let properHelperUsage = 0;

  for (const file of srcFiles) {
    try {
      const content = fs.readFileSync(file, 'utf-8');

      // Check for manual GridRange object literals
      if (content.match(/\{\s*sheetId\s*:\s*.*,\s*startRowIndex\s*:/)) {
        manualGridRangeCount++;
      }

      // Check for helper usage
      if (content.includes('toGridRange(') || content.includes('parseRange(')) {
        properHelperUsage++;
      }
    } catch (_error) {
      // Skip files that can't be read
    }
  }

  if (manualGridRangeCount > 5) {
    addIssue({
      severity: 'warning',
      category: 'CODE_QUALITY',
      message: `Found ${manualGridRangeCount} manual GridRange constructions - use helpers instead`,
    });
  } else {
    log(
      `  ✅ GridRange construction: ${properHelperUsage} helper calls, ${manualGridRangeCount} manual`,
      'green'
    );
  }

  // Check for Color validation (RGB 0-1 vs 0-255)
  let colorValidationFound = false;

  for (const file of srcFiles) {
    try {
      const content = fs.readFileSync(file, 'utf-8');

      if (
        content.includes('// RGB values must be 0-1') ||
        content.includes('normalizeRgb') ||
        (file.endsWith('schemas/shared.ts') &&
          content.includes('ColorSchema') &&
          content.includes('.max(1)'))
      ) {
        colorValidationFound = true;
        break;
      }
    } catch (_error) {
      // Skip
    }
  }

  if (colorValidationFound) {
    log('  ✅ RGB color validation (0-1 range) present', 'green');
  } else {
    addIssue({
      severity: 'warning',
      category: 'CODE_QUALITY',
      message: 'No RGB color validation found - Google API expects 0-1 range, not 0-255',
    });
  }
}

function getAllTsFiles(dir: string): string[] {
  const files: string[] = [];

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (
        entry.isDirectory() &&
        !entry.name.includes('node_modules') &&
        !entry.name.startsWith('.')
      ) {
        files.push(...getAllTsFiles(fullPath));
      } else if (entry.isFile() && entry.name.endsWith('.ts')) {
        files.push(fullPath);
      }
    }
  } catch (_error) {
    // Skip directories we can't read
  }

  return files;
}

// ============================================================================
// 5. REPORT GENERATION
// ============================================================================

function generateReport() {
  log('\n' + '='.repeat(80), 'bright');
  log('📊 VALIDATION REPORT', 'bright');
  log('='.repeat(80), 'bright');

  const errorCount = issues.filter((i) => i.severity === 'error').length;
  const warningCount = issues.filter((i) => i.severity === 'warning').length;
  const infoCount = issues.filter((i) => i.severity === 'info').length;

  log(`\nTotal Issues: ${issues.length}`, 'bright');
  log(`  🔴 Errors: ${errorCount}`, errorCount > 0 ? 'red' : 'green');
  log(`  🟡 Warnings: ${warningCount}`, warningCount > 0 ? 'yellow' : 'green');
  log(`  🔵 Info: ${infoCount}`, 'blue');

  if (issues.length === 0) {
    log('\n✨ Perfect! No issues found. All tools are compliant!', 'green');
    return 0;
  }

  // Group issues by category
  const byCategory: Record<string, ValidationIssue[]> = {};

  for (const issue of issues) {
    if (!byCategory[issue.category]) {
      byCategory[issue.category] = [];
    }
    byCategory[issue.category].push(issue);
  }

  log('\n📂 Issues by Category:\n', 'cyan');

  for (const [category, categoryIssues] of Object.entries(byCategory)) {
    const errors = categoryIssues.filter((i) => i.severity === 'error').length;
    const warnings = categoryIssues.filter((i) => i.severity === 'warning').length;

    log(
      `  ${category}: ${categoryIssues.length} issues (${errors} errors, ${warnings} warnings)`,
      'bright'
    );

    for (const issue of categoryIssues) {
      const icon = issue.severity === 'error' ? '🔴' : issue.severity === 'warning' ? '🟡' : '🔵';
      const location = issue.file ? ` [${issue.file}${issue.line ? `:${issue.line}` : ''}]` : '';
      const actionInfo = issue.action ? ` (${issue.action})` : '';

      log(
        `    ${icon} ${issue.tool}${actionInfo}: ${issue.message}${location}`,
        issue.severity === 'error' ? 'red' : issue.severity === 'warning' ? 'yellow' : 'blue'
      );
    }
    log('');
  }

  // Group by tool
  log('\n🔧 Issues by Tool:\n', 'cyan');

  const byTool: Record<string, ValidationIssue[]> = {};

  for (const issue of issues) {
    if (!byTool[issue.tool]) {
      byTool[issue.tool] = [];
    }
    byTool[issue.tool].push(issue);
  }

  const sortedTools = Object.entries(byTool).sort((a, b) => b[1].length - a[1].length);

  for (const [tool, toolIssues] of sortedTools) {
    const errors = toolIssues.filter((i) => i.severity === 'error').length;
    const warnings = toolIssues.filter((i) => i.severity === 'warning').length;

    log(
      `  ${tool}: ${toolIssues.length} issues (${errors} errors, ${warnings} warnings)`,
      'bright'
    );
  }

  log('\n' + '='.repeat(80), 'bright');

  return errorCount > 0 ? 1 : 0;
}

// ============================================================================
// MAIN EXECUTION
// ============================================================================

async function main() {
  log('🚀 ServalSheets API & MCP Compliance Validator', 'bright');
  const actionTotal = Object.values(TOOL_ACTIONS).reduce((sum, actions) => sum + actions.length, 0);
  log(`Validating ${TOOL_DEFINITIONS.length} tools with ${actionTotal} actions...\n`, 'cyan');

  // Run all validations
  validateMcpSchemaStructure();
  validateMcpActionCoverage();
  validateGoogleApiPatterns();
  validateResponseHandling();
  validateHandlerImplementations();
  detectCommonPitfalls();

  // Generate report
  const exitCode = generateReport();

  process.exit(exitCode);
}

main().catch((error) => {
  log(`\n❌ Fatal error: ${error.message}`, 'red');
  console.error(error);
  process.exit(1);
});
