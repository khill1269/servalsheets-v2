#!/usr/bin/env tsx
/**
 * Suggest tags for docs that don't have them
 * Analyzes content and file path to infer relevant tags
 */

import fs from 'node:fs';
import { glob } from 'glob';

function inferTags(file: string, content: string): string[] {
  const tags: Set<string> = new Set();
  const normalized = file.toLowerCase();
  const lowerContent = content.toLowerCase();

  // Location-based tags
  if (normalized.includes('/guides/')) tags.add('guide');
  if (normalized.includes('/reference/')) tags.add('reference');
  if (normalized.includes('/operations/')) tags.add('operations');
  if (normalized.includes('/development/')) tags.add('development');
  if (normalized.includes('/testing/')) tags.add('testing');
  if (normalized.includes('/business/')) tags.add('business');

  // Content-based tags
  if (lowerContent.includes('oauth') || lowerContent.includes('authentication')) {
    tags.add('oauth');
    tags.add('authentication');
  }
  if (lowerContent.includes('google sheets') || lowerContent.includes('spreadsheet')) {
    tags.add('sheets');
  }
  if (lowerContent.includes('mcp') || lowerContent.includes('model context protocol')) {
    tags.add('mcp');
  }
  if (lowerContent.includes('api')) tags.add('api');
  if (lowerContent.includes('troubleshoot')) tags.add('troubleshooting');
  if (lowerContent.includes('deploy') || lowerContent.includes('production')) {
    tags.add('deployment');
  }
  if (lowerContent.includes('monitor') || lowerContent.includes('observability')) {
    tags.add('monitoring');
  }
  if (lowerContent.includes('performance') || lowerContent.includes('optimization')) {
    tags.add('performance');
  }
  if (lowerContent.includes('security')) tags.add('security');
  if (lowerContent.includes('docker') || lowerContent.includes('kubernetes')) {
    tags.add('docker');
  }
  if (lowerContent.includes('test')) tags.add('testing');
  if (lowerContent.includes('setup') || lowerContent.includes('installation')) {
    tags.add('setup');
  }
  if (lowerContent.includes('configuration') || lowerContent.includes('config')) {
    tags.add('configuration');
  }

  return Array.from(tags).sort();
}

function analyzeFrontmatter(content: string): { hasTags: boolean; existingTags: string[] } {
  if (!content.trimStart().startsWith('---')) {
    return { hasTags: false, existingTags: [] };
  }

  const endIndex = content.indexOf('---', 3);
  if (endIndex === -1) {
    return { hasTags: false, existingTags: [] };
  }

  const frontmatter = content.slice(3, endIndex);
  const tagsMatch = frontmatter.match(/^tags:\s*\[([^\]]+)\]/m);

  if (tagsMatch) {
    const tags = tagsMatch[1].split(',').map((t) => t.trim().replace(/['"]/g, ''));
    return { hasTags: true, existingTags: tags };
  }

  return { hasTags: false, existingTags: [] };
}

async function main() {
  console.log('🏷️  Analyzing documents for tag suggestions...\n');

  const files = await glob('docs/**/*.md', {
    ignore: [
      '**/node_modules/**',
      '**/docs/.vitepress/**',
      '**/docs/.templates/**',
      '**/docs/archive/**',
      '**/docs/DOCS_CATALOG.md',
      '**/docs/METRICS_DASHBOARD.md',
    ],
  });

  const suggestions: Array<{ file: string; suggested: string[]; existing: string[] }> = [];

  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    const { hasTags, existingTags } = analyzeFrontmatter(content);

    if (!hasTags || existingTags.length < 2) {
      const suggested = inferTags(file, content);
      if (suggested.length > 0) {
        suggestions.push({ file, suggested, existing: existingTags });
      }
    }
  }

  console.log(`Found ${suggestions.length} documents that could use more tags:\n`);

  // Show top 20
  for (const { file, suggested, existing } of suggestions.slice(0, 20)) {
    const relPath = file.replace('docs/', '');
    console.log(`📄 ${relPath}`);
    if (existing.length > 0) {
      console.log(`   Current: [${existing.join(', ')}]`);
      const newTags = suggested.filter((t) => !existing.includes(t));
      console.log(`   Suggested additions: [${newTags.join(', ')}]`);
    } else {
      console.log(`   Suggested: [${suggested.join(', ')}]`);
    }
    console.log();
  }

  if (suggestions.length > 20) {
    console.log(`... and ${suggestions.length - 20} more documents\n`);
  }

  console.log('💡 To add tags:');
  console.log('   1. Edit the file frontmatter');
  console.log('   2. Add: tags: [tag1, tag2, tag3]');
  console.log('   3. Run: npm run docs:catalog');
  console.log();
}

main().catch(console.error);
