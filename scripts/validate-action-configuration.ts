#!/usr/bin/env tsx
/**
 * Action configuration validator
 *
 * Validates action-level wiring across:
 * - schema actions
 * - handler switch cases
 * - completion actions
 * - action annotations
 * - action metadata
 * - action-discovery tool categories
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { TOOL_ACTIONS } from '../src/mcp/completions.js';
import { TOOL_DEFINITIONS } from '../src/mcp/registration/tool-definitions.js';
import { isCaseDeviationDocumented } from '../src/schemas/handler-deviations.js';
import { ACTION_ANNOTATIONS } from '../src/schemas/annotations.js';
import { ACTION_METADATA } from '../src/schemas/action-metadata.js';
import { TOOL_CATEGORIES } from '../src/services/action-discovery.js';
import { extractHandlerCases, extractSchemaActions } from '../src/utils/ast-schema-parser.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const HANDLER_NAME_MAP: Record<string, string> = {
  webhook: 'webhooks',
};

interface Issue {
  type:
    | 'schema-completions-mismatch'
    | 'schema-handler-mismatch'
    | 'missing-action-annotation'
    | 'missing-action-metadata'
    | 'extra-action-metadata'
    | 'missing-tool-category';
  tool?: string;
  action?: string;
  detail: string;
}

function toolToShortName(toolName: string): string {
  return toolName.replace(/^sheets_/, '');
}

function compareStringSets(a: readonly string[], b: readonly string[]) {
  const inANotB = a.filter((v) => !b.includes(v));
  const inBNotA = b.filter((v) => !a.includes(v));
  return { inANotB, inBNotA };
}

function run(): number {
  const issues: Issue[] = [];

  for (const toolDef of TOOL_DEFINITIONS) {
    const toolName = toolDef.name;
    const shortName = toolToShortName(toolName);

    const schemaPath = path.join(projectRoot, 'src/schemas', `${shortName}.ts`);
    const handlerFileName = HANDLER_NAME_MAP[shortName] ?? shortName;
    const handlerPath = path.join(projectRoot, 'src/handlers', `${handlerFileName}.ts`);

    if (!fs.existsSync(schemaPath)) {
      issues.push({
        type: 'schema-handler-mismatch',
        tool: toolName,
        detail: `schema file missing: ${schemaPath}`,
      });
      continue;
    }

    if (!fs.existsSync(handlerPath)) {
      issues.push({
        type: 'schema-handler-mismatch',
        tool: toolName,
        detail: `handler file missing: ${handlerPath}`,
      });
      continue;
    }

    const schemaActions = extractSchemaActions(schemaPath);
    const handlerCases = extractHandlerCases(handlerPath);
    const completionActions = TOOL_ACTIONS[toolName] ?? [];

    const schemaVsCompletions = compareStringSets(schemaActions, completionActions);
    for (const missing of schemaVsCompletions.inANotB) {
      issues.push({
        type: 'schema-completions-mismatch',
        tool: toolName,
        action: missing,
        detail: 'present in schema, missing in completions',
      });
    }
    for (const extra of schemaVsCompletions.inBNotA) {
      issues.push({
        type: 'schema-completions-mismatch',
        tool: toolName,
        action: extra,
        detail: 'present in completions, missing in schema',
      });
    }

    const schemaVsHandler = compareStringSets(schemaActions, handlerCases);
    for (const missingHandlerCase of schemaVsHandler.inANotB) {
      if (!isCaseDeviationDocumented(shortName, missingHandlerCase)) {
        issues.push({
          type: 'schema-handler-mismatch',
          tool: toolName,
          action: missingHandlerCase,
          detail: 'present in schema, missing in handler switch',
        });
      }
    }
    for (const extraHandlerCase of schemaVsHandler.inBNotA) {
      if (!isCaseDeviationDocumented(shortName, extraHandlerCase)) {
        issues.push({
          type: 'schema-handler-mismatch',
          tool: toolName,
          action: extraHandlerCase,
          detail: 'present in handler switch, missing in schema',
        });
      }
    }
  }

  // Annotation and metadata parity checks
  for (const [toolName, actions] of Object.entries(TOOL_ACTIONS)) {
    const toolMetadata = ACTION_METADATA[toolName] ?? {};

    for (const action of actions) {
      const annotationKey = `${toolName}.${action}`;
      if (!(annotationKey in ACTION_ANNOTATIONS)) {
        issues.push({
          type: 'missing-action-annotation',
          tool: toolName,
          action,
          detail: 'missing ACTION_ANNOTATIONS entry',
        });
      }
      if (!(action in toolMetadata)) {
        issues.push({
          type: 'missing-action-metadata',
          tool: toolName,
          action,
          detail: 'missing ACTION_METADATA entry',
        });
      }
    }

    for (const extraMetadataAction of Object.keys(toolMetadata)) {
      if (!actions.includes(extraMetadataAction)) {
        issues.push({
          type: 'extra-action-metadata',
          tool: toolName,
          action: extraMetadataAction,
          detail: 'stale ACTION_METADATA entry not present in TOOL_ACTIONS',
        });
      }
    }
  }

  // Action discovery category coverage
  for (const toolName of Object.keys(TOOL_ACTIONS)) {
    if (!(toolName in TOOL_CATEGORIES)) {
      issues.push({
        type: 'missing-tool-category',
        tool: toolName,
        detail: 'missing action-discovery tool category mapping',
      });
    }
  }

  const byType = issues.reduce<Record<string, number>>((acc, issue) => {
    acc[issue.type] = (acc[issue.type] ?? 0) + 1;
    return acc;
  }, {});

  console.log('='.repeat(72));
  console.log('ACTION CONFIGURATION VALIDATION');
  console.log('='.repeat(72));
  console.log(`Tools checked: ${TOOL_DEFINITIONS.length}`);
  console.log(
    `Actions checked: ${Object.values(TOOL_ACTIONS).reduce((sum, actions) => sum + actions.length, 0)}`
  );
  console.log();

  if (issues.length === 0) {
    console.log('PASS: all action configuration checks are aligned.');
    return 0;
  }

  console.log(`FAIL: ${issues.length} issue(s) found.`);
  console.log();
  for (const [type, count] of Object.entries(byType)) {
    console.log(`- ${type}: ${count}`);
  }
  console.log();

  const previewLimit = 60;
  for (const issue of issues.slice(0, previewLimit)) {
    const prefix = [issue.type, issue.tool, issue.action].filter(Boolean).join(' | ');
    console.log(`* ${prefix}: ${issue.detail}`);
  }
  if (issues.length > previewLimit) {
    console.log(`... and ${issues.length - previewLimit} more issue(s).`);
  }

  return 1;
}

process.exit(run());
