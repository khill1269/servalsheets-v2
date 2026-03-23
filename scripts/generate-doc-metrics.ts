#!/usr/bin/env tsx
/**
 * Generate comprehensive documentation metrics dashboard
 * Creates docs/METRICS_DASHBOARD.md with key metrics
 */

import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { glob } from 'glob';

interface Metrics {
  total: {
    files: number;
    words: number;
    lines: number;
    categories: number;
    tags: number;
  };
  byCategory: Map<string, { files: number; words: number }>;
  byTag: Map<string, number>;
  freshness: {
    fresh: number;
    aging: number;
    stale: number;
    critical: number;
  };
  quality: {
    withFrontmatter: number;
    withDescription: number;
    withTags: number;
    avgWordsPerDoc: number;
  };
  topContributors: Array<{ name: string; commits: number }>;
  recentActivity: Array<{ date: string; file: string; action: string }>;
}

function parseFrontmatter(content: string): Record<string, unknown> | null {
  if (!content.trimStart().startsWith('---')) {
    return null;
  }

  const endIndex = content.indexOf('---', 3);
  if (endIndex === -1) {
    return null;
  }

  const frontmatterStr = content.slice(3, endIndex).trim();
  const metadata: Record<string, unknown> = {};

  for (const line of frontmatterStr.split('\n')) {
    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) continue;

    const key = line.slice(0, colonIndex).trim();
    let value: string | string[] = line.slice(colonIndex + 1).trim();

    if (value.startsWith('[') && value.endsWith(']')) {
      value = value
        .slice(1, -1)
        .split(',')
        .map((v) => v.trim());
    }

    if (typeof value === 'string') {
      value = value.replace(/^["']|["']$/g, '');
    }

    metadata[key] = value;
  }

  return metadata;
}

function countWords(content: string): number {
  // Remove frontmatter
  let text = content;
  if (content.trimStart().startsWith('---')) {
    const endIndex = content.indexOf('---', 3);
    if (endIndex !== -1) {
      text = content.slice(endIndex + 3);
    }
  }

  // Remove code blocks
  text = text.replace(/```[\s\S]*?```/g, '');

  // Remove inline code
  text = text.replace(/`[^`]+`/g, '');

  // Remove links
  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

  // Count words
  return text.split(/\s+/).filter((word) => word.length > 0).length;
}

function getFreshnessStatus(file: string): 'fresh' | 'aging' | 'stale' | 'critical' {
  try {
    const timestamp = execSync(`git log -1 --format=%cI -- "${file}"`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
    }).trim();

    if (!timestamp) return 'fresh';

    const lastModified = new Date(timestamp);
    const daysSince = Math.floor((Date.now() - lastModified.getTime()) / (1000 * 60 * 60 * 24));

    if (daysSince <= 90) return 'fresh';
    if (daysSince <= 180) return 'aging';
    if (daysSince <= 365) return 'stale';
    return 'critical';
  } catch {
    return 'fresh';
  }
}

function getTopContributors(): Array<{ name: string; commits: number }> {
  try {
    const output = execSync(
      'git log --format="%an" -- docs/ | sort | uniq -c | sort -rn | head -10',
      {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'ignore'],
      }
    );

    return output
      .trim()
      .split('\n')
      .map((line) => {
        const match = line.trim().match(/^(\d+)\s+(.+)$/);
        if (!match) return null;
        return { commits: parseInt(match[1]), name: match[2] };
      })
      .filter((item): item is { name: string; commits: number } => item !== null);
  } catch {
    return [];
  }
}

function getRecentActivity(): Array<{ date: string; file: string; action: string }> {
  try {
    const output = execSync('git log --format="%cI|%s" --name-only -20 -- docs/', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
    });

    const activity: Array<{ date: string; file: string; action: string }> = [];
    const lines = output.trim().split('\n');

    let currentCommit: { date: string; message: string } | null = null;

    for (const line of lines) {
      if (line.includes('|')) {
        const [date, message] = line.split('|');
        currentCommit = { date: date.split('T')[0], message };
      } else if (line.trim() && currentCommit && line.startsWith('docs/')) {
        activity.push({
          date: currentCommit.date,
          file: line.trim(),
          action: currentCommit.message,
        });
      }
    }

    return activity.slice(0, 10);
  } catch {
    return [];
  }
}

async function collectMetrics(): Promise<Metrics> {
  const files = await glob('docs/**/*.md', {
    ignore: [
      '**/node_modules/**',
      '**/docs/.vitepress/**',
      '**/docs/.templates/**',
      '**/docs/archive/**',
    ],
  });

  const metrics: Metrics = {
    total: {
      files: 0,
      words: 0,
      lines: 0,
      categories: 0,
      tags: 0,
    },
    byCategory: new Map(),
    byTag: new Map(),
    freshness: {
      fresh: 0,
      aging: 0,
      stale: 0,
      critical: 0,
    },
    quality: {
      withFrontmatter: 0,
      withDescription: 0,
      withTags: 0,
      avgWordsPerDoc: 0,
    },
    topContributors: [],
    recentActivity: [],
  };

  let totalWords = 0;

  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    const frontmatter = parseFrontmatter(content);
    const words = countWords(content);
    const lines = content.split('\n').length;

    metrics.total.files++;
    totalWords += words;
    metrics.total.lines += lines;

    if (frontmatter) {
      metrics.quality.withFrontmatter++;

      const category = (frontmatter.category as string) || 'general';
      const existing = metrics.byCategory.get(category) || { files: 0, words: 0 };
      metrics.byCategory.set(category, {
        files: existing.files + 1,
        words: existing.words + words,
      });

      if (frontmatter.description) {
        metrics.quality.withDescription++;
      }

      const tags = frontmatter.tags;
      if (Array.isArray(tags)) {
        metrics.quality.withTags++;
        for (const tag of tags) {
          metrics.byTag.set(tag, (metrics.byTag.get(tag) || 0) + 1);
        }
      }
    }

    const freshness = getFreshnessStatus(file);
    metrics.freshness[freshness]++;
  }

  metrics.total.words = totalWords;
  metrics.total.categories = metrics.byCategory.size;
  metrics.total.tags = metrics.byTag.size;
  metrics.quality.avgWordsPerDoc = Math.round(totalWords / metrics.total.files);

  metrics.topContributors = getTopContributors();
  metrics.recentActivity = getRecentActivity();

  return metrics;
}

function generateDashboard(metrics: Metrics): string {
  const lines: string[] = [];
  const timestamp = new Date().toISOString().split('T')[0];

  lines.push('---');
  lines.push('title: Documentation Metrics Dashboard');
  lines.push('description: Real-time metrics and health indicators for ServalSheets documentation');
  lines.push('category: metrics');
  lines.push(`last_updated: ${timestamp}`);
  lines.push('---');
  lines.push('');
  lines.push('# Documentation Metrics Dashboard');
  lines.push('');
  lines.push(
    `> **Last Updated:** ${timestamp} | **Auto-generated** - Run \`npm run docs:metrics\` to refresh`
  );
  lines.push('');

  // Overview
  lines.push('## 📊 Overview');
  lines.push('');
  lines.push('| Metric | Count |');
  lines.push('|--------|-------|');
  lines.push(`| Total Documents | ${metrics.total.files} |`);
  lines.push(`| Total Words | ${metrics.total.words.toLocaleString()} |`);
  lines.push(`| Total Lines | ${metrics.total.lines.toLocaleString()} |`);
  lines.push(`| Avg Words/Doc | ${metrics.quality.avgWordsPerDoc} |`);
  lines.push(`| Categories | ${metrics.total.categories} |`);
  lines.push(`| Unique Tags | ${metrics.total.tags} |`);
  lines.push('');

  // Quality Metrics
  const frontmatterPct = ((metrics.quality.withFrontmatter / metrics.total.files) * 100).toFixed(1);
  const descriptionPct = ((metrics.quality.withDescription / metrics.total.files) * 100).toFixed(1);
  const tagsPct = ((metrics.quality.withTags / metrics.total.files) * 100).toFixed(1);

  lines.push('## 📈 Quality Metrics');
  lines.push('');
  lines.push('| Metric | Count | Percentage |');
  lines.push('|--------|-------|------------|');
  lines.push(`| With Frontmatter | ${metrics.quality.withFrontmatter} | ${frontmatterPct}% |`);
  lines.push(`| With Description | ${metrics.quality.withDescription} | ${descriptionPct}% |`);
  lines.push(`| With Tags | ${metrics.quality.withTags} | ${tagsPct}% |`);
  lines.push('');

  // Freshness
  const healthScore = (
    ((metrics.total.files - metrics.freshness.stale - metrics.freshness.critical) /
      metrics.total.files) *
    100
  ).toFixed(1);

  lines.push('## 🕒 Freshness');
  lines.push('');
  lines.push('| Status | Count | Percentage |');
  lines.push('|--------|-------|------------|');
  lines.push(
    `| ✅ Fresh (< 3 mo) | ${metrics.freshness.fresh} | ${((metrics.freshness.fresh / metrics.total.files) * 100).toFixed(1)}% |`
  );
  lines.push(
    `| ⏰ Aging (3-6 mo) | ${metrics.freshness.aging} | ${((metrics.freshness.aging / metrics.total.files) * 100).toFixed(1)}% |`
  );
  lines.push(
    `| ⚠️ Stale (6-12 mo) | ${metrics.freshness.stale} | ${((metrics.freshness.stale / metrics.total.files) * 100).toFixed(1)}% |`
  );
  lines.push(
    `| 🚨 Critical (> 12 mo) | ${metrics.freshness.critical} | ${((metrics.freshness.critical / metrics.total.files) * 100).toFixed(1)}% |`
  );
  lines.push('');
  lines.push(
    `**Documentation Health Score:** ${healthScore}% ${parseFloat(healthScore) >= 80 ? '✅' : parseFloat(healthScore) >= 60 ? '⚠️' : '🚨'}`
  );
  lines.push('');

  // By Category
  lines.push('## 📂 By Category');
  lines.push('');
  lines.push('| Category | Files | Total Words | Avg Words/Doc |');
  lines.push('|----------|-------|-------------|---------------|');

  const sortedCategories = Array.from(metrics.byCategory.entries()).sort(
    ([, a], [, b]) => b.files - a.files
  );

  for (const [category, data] of sortedCategories) {
    const avg = Math.round(data.words / data.files);
    lines.push(`| ${category} | ${data.files} | ${data.words.toLocaleString()} | ${avg} |`);
  }
  lines.push('');

  // Top Tags
  lines.push('## 🏷️ Top Tags');
  lines.push('');
  lines.push('| Tag | Count |');
  lines.push('|-----|-------|');

  const sortedTags = Array.from(metrics.byTag.entries())
    .sort(([, a], [, b]) => b - a)
    .slice(0, 15);

  for (const [tag, count] of sortedTags) {
    lines.push(`| ${tag} | ${count} |`);
  }
  lines.push('');

  // Top Contributors
  if (metrics.topContributors.length > 0) {
    lines.push('## 👥 Top Contributors');
    lines.push('');
    lines.push('| Contributor | Doc Commits |');
    lines.push('|-------------|-------------|');

    for (const { name, commits } of metrics.topContributors.slice(0, 10)) {
      lines.push(`| ${name} | ${commits} |`);
    }
    lines.push('');
  }

  // Recent Activity
  if (metrics.recentActivity.length > 0) {
    lines.push('## 📅 Recent Activity');
    lines.push('');
    lines.push('| Date | File | Action |');
    lines.push('|------|------|--------|');

    for (const { date, file, action } of metrics.recentActivity) {
      const shortFile = file.replace('docs/', '');
      const shortAction = action.length > 50 ? action.slice(0, 47) + '...' : action;
      lines.push(`| ${date} | ${shortFile} | ${shortAction} |`);
    }
    lines.push('');
  }

  // Footer
  lines.push('---');
  lines.push('');
  lines.push('## How to Update');
  lines.push('');
  lines.push('```bash');
  lines.push('npm run docs:metrics  # Regenerate this dashboard');
  lines.push('npm run docs:freshness # Check doc freshness');
  lines.push('npm run docs:audit    # Full documentation audit');
  lines.push('```');
  lines.push('');

  return lines.join('\n');
}

async function main() {
  console.log('📊 Generating documentation metrics...');

  const metrics = await collectMetrics();
  const dashboard = generateDashboard(metrics);

  const outputPath = 'docs/METRICS_DASHBOARD.md';
  fs.writeFileSync(outputPath, dashboard);

  console.log(`✅ Metrics dashboard generated: ${outputPath}`);
  console.log(`\nKey Stats:`);
  console.log(`  • ${metrics.total.files} documents`);
  console.log(`  • ${metrics.total.words.toLocaleString()} total words`);
  console.log(
    `  • ${((metrics.quality.withFrontmatter / metrics.total.files) * 100).toFixed(1)}% with frontmatter`
  );
  console.log(`  • ${metrics.freshness.fresh} fresh, ${metrics.freshness.critical} critical`);
}

main().catch(console.error);
