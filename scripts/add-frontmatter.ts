#!/usr/bin/env tsx
/**
 * Add frontmatter to markdown files that don't have it
 * Usage: tsx scripts/add-frontmatter.ts [--dry-run] [--force]
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { glob } from 'glob';

const DRY_RUN = process.argv.includes('--dry-run');
const FORCE = process.argv.includes('--force');

interface Frontmatter {
  title: string;
  description?: string;
  category: string;
  version?: string;
  last_updated: string;
  tags?: string[];
  [key: string]: unknown;
}

function extractTitle(content: string): string {
  // Look for first # heading
  const match = content.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : 'Untitled';
}

function extractDescription(content: string): string | undefined {
  // Look for first paragraph after title
  const lines = content.split('\n');
  let foundTitle = false;
  for (const line of lines) {
    if (line.startsWith('#') && !foundTitle) {
      foundTitle = true;
      continue;
    }
    if (foundTitle && line.trim() && !line.startsWith('#') && !line.startsWith('```')) {
      // Remove markdown formatting for description
      return line
        .trim()
        .replace(/[*_`[\]]/g, '')
        .slice(0, 150);
    }
  }
  return undefined;
}

function hasFrontmatter(content: string): boolean {
  return content.trimStart().startsWith('---');
}

function inferCategory(filePath: string): string {
  const normalized = filePath.toLowerCase();
  if (normalized.includes('/guides/')) return 'guide';
  if (normalized.includes('/reference/')) return 'reference';
  if (normalized.includes('/operations/')) return 'runbook';
  if (normalized.includes('/development/')) return 'development';
  if (normalized.includes('/architecture/')) return 'architecture';
  if (normalized.includes('/examples/')) return 'example';
  if (normalized.includes('/business/')) return 'business';
  if (normalized.startsWith('docs/archive/')) return 'archived';
  return 'general';
}

function inferTags(filePath: string, content: string): string[] {
  const tags: string[] = [];
  const normalized = filePath.toLowerCase();
  const lowerContent = content.toLowerCase();

  // File location tags
  if (normalized.includes('oauth')) tags.push('oauth', 'authentication');
  if (normalized.includes('test')) tags.push('testing');
  if (normalized.includes('deploy')) tags.push('deployment');
  if (normalized.includes('troubleshoot')) tags.push('troubleshooting');
  if (normalized.includes('api')) tags.push('api');
  if (normalized.includes('mcp')) tags.push('mcp');
  if (normalized.includes('setup')) tags.push('setup', 'configuration');
  if (normalized.includes('monitor')) tags.push('monitoring', 'observability');
  if (normalized.includes('performance')) tags.push('performance', 'optimization');
  if (normalized.includes('security')) tags.push('security');

  // Content-based tags
  if (lowerContent.includes('google sheets')) tags.push('sheets');
  if (lowerContent.includes('prometheus')) tags.push('prometheus');
  if (lowerContent.includes('grafana')) tags.push('grafana');
  if (lowerContent.includes('docker')) tags.push('docker');
  if (lowerContent.includes('kubernetes')) tags.push('kubernetes');

  return [...new Set(tags)]; // Deduplicate
}

function generateFrontmatter(filePath: string, content: string): Frontmatter {
  const title = extractTitle(content);
  const description = extractDescription(content);
  const category = inferCategory(filePath);
  const tags = inferTags(filePath, content);

  const frontmatter: Frontmatter = {
    title,
    category,
    last_updated: new Date().toISOString().split('T')[0],
  };

  if (description) {
    frontmatter.description = description;
  }

  // Only add version for non-archived docs
  if (category !== 'archived') {
    frontmatter.version = '1.6.0';
  }

  if (tags.length > 0) {
    frontmatter.tags = tags;
  }

  // Category-specific fields
  if (category === 'guide') {
    frontmatter.audience = 'user';
    frontmatter.difficulty = 'intermediate';
  }

  if (category === 'reference') {
    frontmatter.stability = 'stable';
  }

  if (category === 'runbook') {
    frontmatter.estimated_time = '15-30 minutes';
  }

  return frontmatter;
}

function formatFrontmatter(frontmatter: Frontmatter): string {
  const lines = ['---'];

  for (const [key, value] of Object.entries(frontmatter)) {
    if (value === undefined) continue;

    if (Array.isArray(value)) {
      lines.push(`${key}: [${value.join(', ')}]`);
    } else if (typeof value === 'string') {
      // Escape strings with special characters
      const needsQuotes = value.includes(':') || value.includes('#') || value.includes('[');
      lines.push(`${key}: ${needsQuotes ? `"${value}"` : value}`);
    } else {
      lines.push(`${key}: ${value}`);
    }
  }

  lines.push('---');
  lines.push('');

  return lines.join('\n');
}

async function processFile(filePath: string): Promise<void> {
  const content = readFileSync(filePath, 'utf8');

  if (hasFrontmatter(content)) {
    if (!FORCE) {
      console.log(`⏭️  Skipping ${filePath} (already has frontmatter)`);
      return;
    }
    console.log(`🔄 Updating ${filePath} (--force)`);
  }

  const frontmatter = generateFrontmatter(filePath, content);
  const frontmatterStr = formatFrontmatter(frontmatter);

  // Remove existing frontmatter if present
  let cleanContent = content;
  if (hasFrontmatter(content)) {
    const endIndex = content.indexOf('---', 3);
    if (endIndex !== -1) {
      cleanContent = content.slice(endIndex + 3).trim();
    }
  }

  const newContent = frontmatterStr + '\n' + cleanContent;

  if (DRY_RUN) {
    console.log(`\n📄 ${filePath}`);
    console.log(frontmatterStr);
  } else {
    writeFileSync(filePath, newContent);
    console.log(`✅ Added frontmatter to ${filePath}`);
  }
}

async function main() {
  console.log('🔍 Finding markdown files...\n');

  // Allow path pattern as argument (default to all docs)
  const pattern =
    process.argv.find(
      (arg) => !arg.startsWith('--') && arg !== process.argv[0] && arg !== process.argv[1]
    ) || 'docs/**/*.md';

  const files = await glob(pattern, {
    ignore: ['**/node_modules/**', '**/docs/.vitepress/**', '**/docs/.templates/**'],
  });

  console.log(`Found ${files.length} markdown files in ${pattern}\n`);

  if (DRY_RUN) {
    console.log('🧪 DRY RUN MODE - No files will be modified\n');
  }

  let processed = 0;
  let skipped = 0;

  for (const file of files) {
    try {
      await processFile(file);
      processed++;
    } catch (error) {
      console.error(`❌ Error processing ${file}:`, error);
      skipped++;
    }
  }

  console.log(`\n✨ Summary:`);
  console.log(`   Processed: ${processed}`);
  console.log(`   Skipped: ${skipped}`);

  if (DRY_RUN) {
    console.log(`\n💡 Run without --dry-run to apply changes`);
  }
}

main().catch(console.error);
