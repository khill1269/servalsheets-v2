#!/usr/bin/env tsx
/**
 * Check documentation freshness and identify stale docs
 * Reports docs that haven't been updated in 6+ months
 */

import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { glob } from 'glob';

interface DocFreshness {
  file: string;
  lastUpdated: Date;
  daysSinceUpdate: number;
  gitLastModified?: Date;
  frontmatterDate?: Date;
  fsLastModified?: Date;
  status: 'fresh' | 'aging' | 'stale' | 'critical';
}

function parseFrontmatterDate(content: string): Date | null {
  if (!content.trimStart().startsWith('---')) {
    return null;
  }

  const endIndex = content.indexOf('---', 3);
  if (endIndex === -1) {
    return null;
  }

  const frontmatter = content.slice(3, endIndex);
  const match = frontmatter.match(/last_updated:\s*["']?(\d{4}-\d{2}-\d{2})["']?/);

  if (match) {
    return new Date(match[1]);
  }

  return null;
}

function getGitLastModified(file: string): Date | null {
  try {
    const timestamp = execSync(`git log -1 --format=%cI -- "${file}"`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
    }).trim();

    return timestamp ? new Date(timestamp) : null;
  } catch {
    return null;
  }
}

function getFreshnessStatus(days: number): DocFreshness['status'] {
  if (days <= 90) return 'fresh'; // < 3 months
  if (days <= 180) return 'aging'; // 3-6 months
  if (days <= 365) return 'stale'; // 6-12 months
  return 'critical'; // > 12 months
}

async function checkFreshness(): Promise<DocFreshness[]> {
  const files = await glob('docs/**/*.md', {
    ignore: [
      '**/node_modules/**',
      '**/docs/.vitepress/**',
      '**/docs/.templates/**',
      '**/docs/archive/**',
      '**/docs/DOCS_CATALOG.md',
    ],
  });

  const results: DocFreshness[] = [];

  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    const frontmatterDate = parseFrontmatterDate(content);
    const gitDate = getGitLastModified(file);
    const fsDate = fs.statSync(file).mtime;

    // Prefer explicit frontmatter, then git history, then filesystem mtime.
    const lastUpdated = frontmatterDate || gitDate || fsDate;
    const daysSinceUpdate = Math.floor(
      (Date.now() - lastUpdated.getTime()) / (1000 * 60 * 60 * 24)
    );

    results.push({
      file,
      lastUpdated,
      daysSinceUpdate,
      gitLastModified: gitDate || undefined,
      frontmatterDate: frontmatterDate || undefined,
      fsLastModified: fsDate,
      status: getFreshnessStatus(daysSinceUpdate),
    });
  }

  return results.sort((a, b) => b.daysSinceUpdate - a.daysSinceUpdate);
}

function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

function generateReport(results: DocFreshness[]): void {
  const fresh = results.filter((r) => r.status === 'fresh');
  const aging = results.filter((r) => r.status === 'aging');
  const stale = results.filter((r) => r.status === 'stale');
  const critical = results.filter((r) => r.status === 'critical');

  console.log('\n📊 Documentation Freshness Report\n');
  console.log('═'.repeat(60));
  console.log('\n📈 Summary:\n');
  console.log(`  Total documents: ${results.length}`);
  console.log(
    `  ✅ Fresh (< 3 months):     ${fresh.length} (${((fresh.length / results.length) * 100).toFixed(1)}%)`
  );
  console.log(
    `  ⏰ Aging (3-6 months):     ${aging.length} (${((aging.length / results.length) * 100).toFixed(1)}%)`
  );
  console.log(
    `  ⚠️  Stale (6-12 months):    ${stale.length} (${((stale.length / results.length) * 100).toFixed(1)}%)`
  );
  console.log(
    `  🚨 Critical (> 12 months): ${critical.length} (${((critical.length / results.length) * 100).toFixed(1)}%)`
  );

  if (critical.length > 0) {
    console.log('\n\n🚨 CRITICAL - Not updated in over 1 year:\n');
    for (const doc of critical.slice(0, 10)) {
      const age = Math.floor(doc.daysSinceUpdate / 365);
      console.log(`  ${doc.file}`);
      console.log(`    Last updated: ${formatDate(doc.lastUpdated)} (${age}+ years ago)`);
    }
    if (critical.length > 10) {
      console.log(`  ... and ${critical.length - 10} more`);
    }
  }

  if (stale.length > 0) {
    console.log('\n\n⚠️  STALE - Not updated in 6-12 months:\n');
    for (const doc of stale.slice(0, 10)) {
      const months = Math.floor(doc.daysSinceUpdate / 30);
      console.log(`  ${doc.file}`);
      console.log(`    Last updated: ${formatDate(doc.lastUpdated)} (${months} months ago)`);
    }
    if (stale.length > 10) {
      console.log(`  ... and ${stale.length - 10} more`);
    }
  }

  if (aging.length > 0) {
    console.log('\n\n⏰ AGING - Due for review soon (3-6 months old):\n');
    for (const doc of aging.slice(0, 5)) {
      const months = Math.floor(doc.daysSinceUpdate / 30);
      console.log(`  ${doc.file} (${months} months)`);
    }
    if (aging.length > 5) {
      console.log(`  ... and ${aging.length - 5} more`);
    }
  }

  console.log('\n═'.repeat(60));
  console.log('\n💡 Recommendations:\n');

  if (critical.length > 0) {
    console.log(`  • Review and update ${critical.length} critical docs immediately`);
  }
  if (stale.length > 0) {
    console.log(`  • Schedule ${stale.length} stale docs for review this sprint`);
  }
  if (aging.length > 0) {
    console.log(`  • Monitor ${aging.length} aging docs - consider proactive updates`);
  }

  const totalNeedsAttention = critical.length + stale.length;
  const healthScore = ((results.length - totalNeedsAttention) / results.length) * 100;

  console.log(`\n📊 Documentation Health Score: ${healthScore.toFixed(1)}%`);

  if (healthScore >= 80) {
    console.log('   Status: ✅ Excellent - Most docs are current');
  } else if (healthScore >= 60) {
    console.log('   Status: ⚠️  Good - Some docs need updates');
  } else if (healthScore >= 40) {
    console.log('   Status: 🔶 Fair - Significant documentation debt');
  } else {
    console.log('   Status: 🚨 Poor - Urgent attention needed');
  }

  console.log('\n');
}

function generateJsonReport(results: DocFreshness[], outputPath: string): void {
  const report = {
    generatedAt: new Date().toISOString(),
    summary: {
      total: results.length,
      fresh: results.filter((r) => r.status === 'fresh').length,
      aging: results.filter((r) => r.status === 'aging').length,
      stale: results.filter((r) => r.status === 'stale').length,
      critical: results.filter((r) => r.status === 'critical').length,
    },
    documents: results.map((r) => ({
      file: r.file,
      lastUpdated: formatDate(r.lastUpdated),
      daysSinceUpdate: r.daysSinceUpdate,
      status: r.status,
      hasGitHistory: !!r.gitLastModified,
      hasFrontmatter: !!r.frontmatterDate,
    })),
  };

  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
  console.log(`\n📄 JSON report saved: ${outputPath}`);
}

async function main() {
  const outputJson = process.argv.includes('--json');
  const jsonPath =
    process.argv.find((arg) => arg.startsWith('--output='))?.split('=')[1] || 'docs-freshness.json';

  console.log('🔍 Analyzing documentation freshness...');

  const results = await checkFreshness();

  generateReport(results);

  if (outputJson) {
    generateJsonReport(results, jsonPath);
  }

  // Exit with error if too many stale docs
  const critical = results.filter((r) => r.status === 'critical').length;
  const stale = results.filter((r) => r.status === 'stale').length;

  if (process.argv.includes('--ci')) {
    const threshold = 10; // Max 10 critical docs
    if (critical > threshold) {
      console.error(
        `\n❌ CI Check Failed: ${critical} critical docs exceed threshold of ${threshold}`
      );
      process.exit(1);
    }
  }
}

main().catch(console.error);
