#!/usr/bin/env tsx
/**
 * Contract Diff Tool
 *
 * Compares API contracts between versions to detect breaking changes.
 *
 * Usage:
 *   npm run contracts:diff v1.5.0 v1.6.0
 *   npm run contracts:diff -- --from v1.5.0 --to v1.6.0 --format json
 *   npm run contracts:diff -- --from v1.5.0 --to v1.6.0 --breaking-only
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface ContractVersion {
  version: string;
  protocolVersion: string;
  toolCount: number;
  actionCount: number;
  tools: Record<
    string,
    {
      actions: string[];
      requiredFields: Record<string, string[]>;
    }
  >;
  responseStructure: unknown;
  enums: Record<string, string[]>;
  newFeatures?: Record<string, unknown>;
  breaking_changes?: string[];
  deprecations?: string[];
}

interface DiffResult {
  version: {
    from: string;
    to: string;
  };
  breaking: BreakingChange[];
  additions: Addition[];
  deprecations: string[];
  nonBreaking: Change[];
  summary: {
    breakingChanges: number;
    additions: number;
    deprecations: number;
    totalChanges: number;
  };
}

interface BreakingChange {
  type:
    | 'removed_tool'
    | 'removed_action'
    | 'added_required_field'
    | 'removed_enum_value'
    | 'changed_field_type';
  tool?: string;
  action?: string;
  field?: string;
  enumName?: string;
  enumValue?: string;
  description: string;
  impact: 'critical' | 'high' | 'medium';
}

interface Addition {
  type: 'new_tool' | 'new_action' | 'new_optional_field' | 'new_enum_value';
  tool?: string;
  action?: string;
  field?: string;
  enumName?: string;
  enumValue?: string;
  description: string;
}

interface Change {
  type: 'tool_count' | 'action_count' | 'protocol_version';
  from: string | number;
  to: string | number;
  description: string;
}

function loadContract(version: string): ContractVersion {
  const contractPath = path.join(
    __dirname,
    '..',
    'tests',
    'contracts',
    'versions',
    `${version}.json`
  );

  if (!fs.existsSync(contractPath)) {
    console.error(`❌ Contract file not found: ${contractPath}`);
    console.error(`Available versions:`);
    const versionsDir = path.join(__dirname, '..', 'tests', 'contracts', 'versions');
    if (fs.existsSync(versionsDir)) {
      const files = fs.readdirSync(versionsDir);
      files.forEach((file) => console.error(`  - ${file.replace('.json', '')}`));
    }
    process.exit(1);
  }

  try {
    const content = fs.readFileSync(contractPath, 'utf-8');
    return JSON.parse(content) as ContractVersion;
  } catch (error) {
    console.error(`❌ Failed to parse contract file: ${contractPath}`);
    console.error(error);
    process.exit(1);
  }
}

function compareContracts(from: ContractVersion, to: ContractVersion): DiffResult {
  const breaking: BreakingChange[] = [];
  const additions: Addition[] = [];
  const nonBreaking: Change[] = [];

  // Check for removed tools (breaking)
  for (const toolName of Object.keys(from.tools)) {
    if (!to.tools[toolName]) {
      breaking.push({
        type: 'removed_tool',
        tool: toolName,
        description: `Tool '${toolName}' was removed`,
        impact: 'critical',
      });
    }
  }

  // Check for new tools (addition)
  for (const toolName of Object.keys(to.tools)) {
    if (!from.tools[toolName]) {
      additions.push({
        type: 'new_tool',
        tool: toolName,
        description: `New tool '${toolName}' added with ${to.tools[toolName].actions.length} actions`,
      });
    }
  }

  // Check for removed/added actions
  for (const toolName of Object.keys(from.tools)) {
    if (!to.tools[toolName]) continue;

    const fromActions = new Set(from.tools[toolName].actions);
    const toActions = new Set(to.tools[toolName].actions);

    // Removed actions (breaking)
    for (const action of fromActions) {
      if (!toActions.has(action)) {
        breaking.push({
          type: 'removed_action',
          tool: toolName,
          action,
          description: `Action '${action}' removed from tool '${toolName}'`,
          impact: 'high',
        });
      }
    }

    // New actions (addition)
    for (const action of toActions) {
      if (!fromActions.has(action)) {
        additions.push({
          type: 'new_action',
          tool: toolName,
          action,
          description: `New action '${action}' added to tool '${toolName}'`,
        });
      }
    }

    // Check for added required fields (breaking)
    const fromRequired = from.tools[toolName].requiredFields;
    const toRequired = to.tools[toolName].requiredFields;

    for (const action of Object.keys(toRequired)) {
      const fromFields = new Set(fromRequired[action] || []);
      const toFields = new Set(toRequired[action] || []);

      for (const field of toFields) {
        if (!fromFields.has(field)) {
          breaking.push({
            type: 'added_required_field',
            tool: toolName,
            action,
            field,
            description: `Required field '${field}' added to action '${toolName}.${action}'`,
            impact: 'high',
          });
        }
      }
    }
  }

  // Check enum changes
  for (const enumName of Object.keys(from.enums)) {
    if (!to.enums[enumName]) continue;

    const fromValues = new Set(from.enums[enumName]);
    const toValues = new Set(to.enums[enumName]);

    // Removed enum values (breaking)
    for (const value of fromValues) {
      if (!toValues.has(value)) {
        breaking.push({
          type: 'removed_enum_value',
          enumName,
          enumValue: value,
          description: `Enum value '${value}' removed from enum '${enumName}'`,
          impact: 'medium',
        });
      }
    }

    // New enum values (addition)
    for (const value of toValues) {
      if (!fromValues.has(value)) {
        additions.push({
          type: 'new_enum_value',
          enumName,
          enumValue: value,
          description: `New enum value '${value}' added to enum '${enumName}'`,
        });
      }
    }
  }

  // Non-breaking changes
  if (from.toolCount !== to.toolCount) {
    nonBreaking.push({
      type: 'tool_count',
      from: from.toolCount,
      to: to.toolCount,
      description: `Tool count changed from ${from.toolCount} to ${to.toolCount}`,
    });
  }

  if (from.actionCount !== to.actionCount) {
    nonBreaking.push({
      type: 'action_count',
      from: from.actionCount,
      to: to.actionCount,
      description: `Action count changed from ${from.actionCount} to ${to.actionCount}`,
    });
  }

  if (from.protocolVersion !== to.protocolVersion) {
    nonBreaking.push({
      type: 'protocol_version',
      from: from.protocolVersion,
      to: to.protocolVersion,
      description: `Protocol version changed from ${from.protocolVersion} to ${to.protocolVersion}`,
    });
  }

  const deprecations = to.deprecations || [];

  return {
    version: {
      from: from.version,
      to: to.version,
    },
    breaking,
    additions,
    deprecations,
    nonBreaking,
    summary: {
      breakingChanges: breaking.length,
      additions: additions.length,
      deprecations: deprecations.length,
      totalChanges: breaking.length + additions.length + nonBreaking.length,
    },
  };
}

function formatDiffHuman(diff: DiffResult): string {
  const lines: string[] = [];

  lines.push(`\n📊 API Contract Diff: ${diff.version.from} → ${diff.version.to}\n`);
  lines.push(`${'='.repeat(60)}\n`);

  // Summary
  lines.push(`📈 Summary:`);
  lines.push(`   Breaking Changes: ${diff.summary.breakingChanges}`);
  lines.push(`   Additions: ${diff.summary.additions}`);
  lines.push(`   Deprecations: ${diff.summary.deprecations}`);
  lines.push(`   Non-Breaking Changes: ${diff.nonBreaking.length}`);
  lines.push(`   Total Changes: ${diff.summary.totalChanges}\n`);

  // Breaking changes
  if (diff.breaking.length > 0) {
    lines.push(`\n❌ BREAKING CHANGES (${diff.breaking.length}):\n`);
    for (const change of diff.breaking) {
      const icon = change.impact === 'critical' ? '🔴' : change.impact === 'high' ? '🟠' : '🟡';
      lines.push(`${icon} ${change.description}`);
      if (change.tool) lines.push(`   Tool: ${change.tool}`);
      if (change.action) lines.push(`   Action: ${change.action}`);
      if (change.field) lines.push(`   Field: ${change.field}`);
      lines.push('');
    }
  } else {
    lines.push(`\n✅ No breaking changes detected!\n`);
  }

  // Additions
  if (diff.additions.length > 0) {
    lines.push(`\n✨ ADDITIONS (${diff.additions.length}):\n`);
    for (const addition of diff.additions) {
      lines.push(`   ${addition.description}`);
    }
    lines.push('');
  }

  // Deprecations
  if (diff.deprecations.length > 0) {
    lines.push(`\n⚠️  DEPRECATIONS (${diff.deprecations.length}):\n`);
    for (const deprecation of diff.deprecations) {
      lines.push(`   ${deprecation}`);
    }
    lines.push('');
  }

  // Non-breaking changes
  if (diff.nonBreaking.length > 0) {
    lines.push(`\n📝 NON-BREAKING CHANGES (${diff.nonBreaking.length}):\n`);
    for (const change of diff.nonBreaking) {
      lines.push(`   ${change.description}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function formatDiffJson(diff: DiffResult): string {
  return JSON.stringify(diff, null, 2);
}

function formatDiffMarkdown(diff: DiffResult): string {
  const lines: string[] = [];

  lines.push(`# API Contract Diff: ${diff.version.from} → ${diff.version.to}\n`);

  // Summary
  lines.push(`## Summary\n`);
  lines.push(`| Metric | Count |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Breaking Changes | ${diff.summary.breakingChanges} |`);
  lines.push(`| Additions | ${diff.summary.additions} |`);
  lines.push(`| Deprecations | ${diff.summary.deprecations} |`);
  lines.push(`| Non-Breaking Changes | ${diff.nonBreaking.length} |`);
  lines.push(`| **Total Changes** | **${diff.summary.totalChanges}** |\n`);

  // Breaking changes
  if (diff.breaking.length > 0) {
    lines.push(`## ❌ Breaking Changes\n`);
    for (const change of diff.breaking) {
      const icon = change.impact === 'critical' ? '🔴' : change.impact === 'high' ? '🟠' : '🟡';
      lines.push(`### ${icon} ${change.description}\n`);
      if (change.tool) lines.push(`- **Tool**: \`${change.tool}\``);
      if (change.action) lines.push(`- **Action**: \`${change.action}\``);
      if (change.field) lines.push(`- **Field**: \`${change.field}\``);
      lines.push('');
    }
  }

  // Additions
  if (diff.additions.length > 0) {
    lines.push(`## ✨ Additions\n`);
    for (const addition of diff.additions) {
      lines.push(`- ${addition.description}`);
    }
    lines.push('');
  }

  // Deprecations
  if (diff.deprecations.length > 0) {
    lines.push(`## ⚠️ Deprecations\n`);
    for (const deprecation of diff.deprecations) {
      lines.push(`- ${deprecation}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function main(): void {
  const args = process.argv.slice(2);

  let fromVersion = 'v1.5.0';
  let toVersion = 'v1.6.0';
  let format: 'human' | 'json' | 'markdown' = 'human';
  let breakingOnly = false;

  // Parse arguments
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--from' && args[i + 1]) {
      fromVersion = args[i + 1];
      i++;
    } else if (args[i] === '--to' && args[i + 1]) {
      toVersion = args[i + 1];
      i++;
    } else if (args[i] === '--format' && args[i + 1]) {
      format = args[i + 1] as 'human' | 'json' | 'markdown';
      i++;
    } else if (args[i] === '--breaking-only') {
      breakingOnly = true;
    } else if (!args[i].startsWith('--')) {
      // Positional arguments: from to
      if (i === 0) fromVersion = args[i];
      if (i === 1) toVersion = args[i];
    }
  }

  console.error(`Loading contracts...`);
  console.error(`  From: ${fromVersion}`);
  console.error(`  To: ${toVersion}\n`);

  const fromContract = loadContract(fromVersion);
  const toContract = loadContract(toVersion);

  console.error(`Comparing contracts...\n`);
  const diff = compareContracts(fromContract, toContract);

  if (breakingOnly && diff.breaking.length === 0) {
    console.log('✅ No breaking changes detected!');
    process.exit(0);
  }

  // Output diff
  if (format === 'json') {
    console.log(formatDiffJson(diff));
  } else if (format === 'markdown') {
    console.log(formatDiffMarkdown(diff));
  } else {
    console.log(formatDiffHuman(diff));
  }

  // Exit with error if breaking changes found
  if (diff.breaking.length > 0) {
    console.error(`\n⚠️  WARNING: ${diff.breaking.length} breaking change(s) detected!`);
    process.exit(1);
  }

  process.exit(0);
}

main();
