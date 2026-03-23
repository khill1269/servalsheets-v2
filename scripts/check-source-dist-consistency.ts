/**
 * Source/Dist Consistency Gate
 *
 * Fails when generated runtime artifacts in dist/ drift from source metadata.
 * This is a release-hygiene guard to prevent shipping stale runtime bundles.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ACTION_COUNTS as SOURCE_ACTION_COUNTS } from '../src/schemas/action-counts.js';
import { TOOL_ACTIONS as SOURCE_TOOL_ACTIONS } from '../src/mcp/completions.js';

type CountMap = Record<string, number>;
type ActionMap = Record<string, string[]>;

function hasArg(flag: string): boolean {
  return process.argv.includes(flag);
}

function sumCounts(map: CountMap): number {
  return Object.values(map).reduce((sum, count) => sum + count, 0);
}

function buildActionCounts(actions: ActionMap): CountMap {
  return Object.fromEntries(Object.entries(actions).map(([tool, values]) => [tool, values.length]));
}

function diffKeys(label: string, left: string[], right: string[], errors: string[]): void {
  const leftOnly = left.filter((key) => !right.includes(key));
  const rightOnly = right.filter((key) => !left.includes(key));
  if (leftOnly.length > 0) {
    errors.push(`${label}: keys only in source: ${leftOnly.join(', ')}`);
  }
  if (rightOnly.length > 0) {
    errors.push(`${label}: keys only in dist: ${rightOnly.join(', ')}`);
  }
}

function compareCountMaps(label: string, source: CountMap, dist: CountMap, errors: string[]): void {
  const keys = [...new Set([...Object.keys(source), ...Object.keys(dist)])].sort();
  for (const key of keys) {
    const sourceValue = source[key];
    const distValue = dist[key];
    if (sourceValue !== distValue) {
      errors.push(
        `${label}: ${key} source=${sourceValue ?? 'missing'} dist=${distValue ?? 'missing'}`
      );
    }
  }
}

function getDeclaredCompletionsTotal(filePath: string): number | null {
  const text = readFileSync(filePath, 'utf8');
  const match = text.match(/Total:\s+(\d+)\s+actions/i);
  if (!match) {
    return null;
  }
  return Number.parseInt(match[1]!, 10);
}

function checkRuntimeAsset(
  sourceRelativePath: string,
  distRelativePath: string,
  errors: string[]
): void {
  const sourcePath = resolve(sourceRelativePath);
  const distPath = resolve(distRelativePath);
  if (existsSync(sourcePath) && !existsSync(distPath)) {
    errors.push(
      `runtime asset missing from dist: ${distRelativePath} (source: ${sourceRelativePath})`
    );
  }
}

async function main(): Promise<void> {
  const allowMissingDist = hasArg('--allow-missing-dist');
  const distActionCountsPath = resolve('dist/schemas/action-counts.js');
  const distCompletionsPath = resolve('dist/mcp/completions.js');
  const srcCompletionsPath = resolve('src/generated/completions.ts');

  const errors: string[] = [];

  if (!existsSync(distActionCountsPath) || !existsSync(distCompletionsPath)) {
    if (allowMissingDist) {
      console.warn('⚠️  Source/dist consistency skipped: dist artifacts are missing.');
      console.warn('   Run: npm run build (or use strict mode without --allow-missing-dist)');
      return;
    }
    console.error('❌ Source/dist consistency failed: dist artifacts are missing.');
    console.error('   Run: npm run build');
    process.exit(1);
  }

  const distActionCountsModule = (await import(pathToFileURL(distActionCountsPath).href)) as {
    ACTION_COUNTS: CountMap;
  };
  const distCompletionsModule = (await import(pathToFileURL(distCompletionsPath).href)) as {
    TOOL_ACTIONS: ActionMap;
  };

  const sourceActionCounts = SOURCE_ACTION_COUNTS;
  const sourceCompletionsCounts = buildActionCounts(SOURCE_TOOL_ACTIONS);
  const distActionCounts = distActionCountsModule.ACTION_COUNTS;
  const distCompletionsCounts = buildActionCounts(distCompletionsModule.TOOL_ACTIONS);

  diffKeys(
    'action-count keys',
    Object.keys(sourceActionCounts).sort(),
    Object.keys(distActionCounts).sort(),
    errors
  );
  compareCountMaps(
    'src/schemas/action-counts.ts vs dist/schemas/action-counts.js',
    sourceActionCounts,
    distActionCounts,
    errors
  );
  compareCountMaps(
    'src/mcp/completions.ts vs dist/mcp/completions.js',
    sourceCompletionsCounts,
    distCompletionsCounts,
    errors
  );
  compareCountMaps(
    'source action-counts vs source completions',
    sourceActionCounts,
    sourceCompletionsCounts,
    errors
  );

  const sourceTotal = sumCounts(sourceActionCounts);
  const distTotal = sumCounts(distActionCounts);
  if (sourceTotal !== distTotal) {
    errors.push(`total action counts mismatch: source=${sourceTotal}, dist=${distTotal}`);
  }

  if (!existsSync(resolve('dist/knowledge'))) {
    errors.push('runtime asset missing from dist: dist/knowledge');
  }

  const runtimeAssets: Array<[string, string]> = [
    ['src/cli/auth-error.html', 'dist/cli/auth-error.html'],
    ['src/cli/auth-success.html', 'dist/cli/auth-success.html'],
    ['src/admin/dashboard.html', 'dist/admin/dashboard.html'],
    ['src/admin/dashboard.js', 'dist/admin/dashboard.js'],
    ['src/admin/styles.css', 'dist/admin/styles.css'],
    ['src/security/tool-hashes.baseline.json', 'dist/security/tool-hashes.baseline.json'],
  ];

  for (const [sourceRelativePath, distRelativePath] of runtimeAssets) {
    checkRuntimeAsset(sourceRelativePath, distRelativePath, errors);
  }

  if (
    existsSync(resolve('src/ui/tracing-dashboard/dist')) &&
    !existsSync(resolve('dist/ui/tracing/index.html'))
  ) {
    errors.push(
      'runtime asset missing from dist: dist/ui/tracing/index.html (source: src/ui/tracing-dashboard/dist)'
    );
  }

  const declaredSourceTotal = getDeclaredCompletionsTotal(srcCompletionsPath);
  if (declaredSourceTotal === null) {
    errors.push('src/mcp/completions.ts missing "Total: N actions" header comment');
  } else if (declaredSourceTotal !== sourceTotal) {
    errors.push(
      `src/mcp/completions.ts header drift: declared=${declaredSourceTotal}, actual=${sourceTotal}`
    );
  }

  if (errors.length > 0) {
    console.error('❌ Source/dist consistency check failed:');
    for (const error of errors) {
      console.error(`   - ${error}`);
    }
    process.exit(1);
  }

  console.log('✅ Source/dist consistency passed.');
  console.log(
    `   ${Object.keys(sourceActionCounts).length} tools, ${sourceTotal} actions (source and dist synchronized)`
  );
}

void main();
