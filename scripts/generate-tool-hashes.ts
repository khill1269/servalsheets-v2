#!/usr/bin/env tsx
/**
 * Generate or update the tool hash baseline.
 *
 * Run this script whenever tool descriptions are intentionally changed:
 *   npm run security:tool-hashes
 *
 * Then commit the updated `src/security/tool-hashes.baseline.json`.
 *
 * In CI, this script runs in --check mode to detect drift:
 *   npm run security:tool-hashes -- --check
 */

import { writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { generateToolHashManifest, hashTool } from '../src/security/tool-hash-registry.js';

const BASELINE_PATH = join(process.cwd(), 'src', 'security', 'tool-hashes.baseline.json');
const isCheckMode = process.argv.includes('--check');

async function main(): Promise<void> {
  // Dynamically import TOOL_DEFINITIONS to get the current state
  const { TOOL_DEFINITIONS } = await import('../src/mcp/registration/tool-definitions.js');

  let version = 'unknown';
  try {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf-8')) as {
      version: string;
    };
    version = pkg.version;
  } catch {
    // ignore
  }

  const tools = (TOOL_DEFINITIONS as Array<{ name: string; description: string }>).map((t) => ({
    name: t.name,
    description: t.description,
  }));

  if (isCheckMode) {
    // CI mode: compare against existing baseline, fail if drift detected
    if (!existsSync(BASELINE_PATH)) {
      console.error('❌ No baseline found at', BASELINE_PATH);
      console.error('Run `npm run security:tool-hashes` to generate it and commit it.');
      process.exit(1);
    }

    const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf-8')) as {
      tools: Record<string, { sha256: string }>;
    };

    const violations: string[] = [];
    const newTools: string[] = [];

    for (const tool of tools) {
      const actual = hashTool(tool.name, tool.description);
      const entry = baseline.tools[tool.name];
      if (!entry) {
        newTools.push(tool.name);
      } else {
        const allowed = new Set([entry.sha256, ...(entry.allowedSha256 ?? [])]);
        if (allowed.has(actual)) {
          continue;
        }
        violations.push(
          `  ${tool.name}: baseline=${entry.sha256.slice(0, 12)}… actual=${actual.slice(0, 12)}…`
        );
      }
    }

    if (newTools.length > 0) {
      console.warn('⚠️  New tools without baseline entries (update baseline if intentional):');
      newTools.forEach((n) => console.warn('  +', n));
    }

    if (violations.length > 0) {
      console.error('❌ Tool description drift detected (potential rug-pull):');
      violations.forEach((v) => console.error(v));
      console.error('');
      console.error(
        'If intentional, run `npm run security:tool-hashes` and commit the updated baseline.'
      );
      process.exit(1);
    }

    console.log(`✅ Tool hashes verified — ${tools.length} tools match baseline`);
    process.exit(0);
  }

  // Generate mode: write new baseline
  const manifest = await generateToolHashManifest(version);
  writeFileSync(BASELINE_PATH, JSON.stringify(manifest, null, 2) + '\n');

  console.log(`✅ Tool hash baseline updated: ${BASELINE_PATH}`);
  console.log(`   Tools: ${tools.length}`);
  console.log(`   Version: ${version}`);
  console.log(`   Generated: ${manifest.generated}`);
  console.log('');
  console.log('Commit this file to lock in the current tool descriptions:');
  console.log('  git add src/security/tool-hashes.baseline.json');
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
