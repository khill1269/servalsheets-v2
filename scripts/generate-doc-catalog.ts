#!/usr/bin/env tsx
/**
 * Generate a documentation catalog from frontmatter metadata
 * Creates DOCS_CATALOG.md with organized documentation index
 */

import fs from 'node:fs';
import path from 'node:path';
import { glob } from 'glob';

interface DocMetadata {
  title?: string;
  description?: string;
  category?: string;
  version?: string;
  last_updated?: string;
  tags?: string[];
  audience?: string;
  difficulty?: string;
  stability?: string;
  estimated_time?: string;
  [key: string]: unknown;
}

interface DocEntry {
  file: string;
  relativePath: string;
  metadata: DocMetadata;
}

function parseFrontmatter(content: string): DocMetadata | null {
  if (!content.trimStart().startsWith('---')) {
    return null;
  }

  const endIndex = content.indexOf('---', 3);
  if (endIndex === -1) {
    return null;
  }

  const frontmatterStr = content.slice(3, endIndex).trim();
  const metadata: DocMetadata = {};

  for (const line of frontmatterStr.split('\n')) {
    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) continue;

    const key = line.slice(0, colonIndex).trim();
    let value: string | string[] = line.slice(colonIndex + 1).trim();

    // Parse arrays
    if (value.startsWith('[') && value.endsWith(']')) {
      value = value
        .slice(1, -1)
        .split(',')
        .map((v) => v.trim());
    }

    // Remove quotes
    if (typeof value === 'string') {
      value = value.replace(/^["']|["']$/g, '');
    }

    metadata[key] = value;
  }

  return metadata;
}

async function collectDocs(): Promise<DocEntry[]> {
  const files = await glob('docs/**/*.md', {
    ignore: [
      '**/node_modules/**',
      '**/docs/.vitepress/**',
      '**/docs/.templates/**',
      '**/docs/archive/**', // Exclude archives from main catalog
    ],
  });

  const docs: DocEntry[] = [];

  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    const metadata = parseFrontmatter(content);

    if (!metadata) {
      console.warn(`⚠️  No frontmatter in ${file}`);
      continue;
    }

    docs.push({
      file,
      relativePath: path.relative('docs', file),
      metadata,
    });
  }

  return docs;
}

function groupByCategory(docs: DocEntry[]): Map<string, DocEntry[]> {
  const groups = new Map<string, DocEntry[]>();

  for (const doc of docs) {
    const category = (doc.metadata.category as string) || 'general';
    if (!groups.has(category)) {
      groups.set(category, []);
    }
    groups.get(category)!.push(doc);
  }

  // Sort docs within each category by title
  for (const [category, docs] of groups.entries()) {
    groups.set(
      category,
      docs.sort((a, b) => {
        const titleA = (a.metadata.title as string) || '';
        const titleB = (b.metadata.title as string) || '';
        return titleA.localeCompare(titleB);
      })
    );
  }

  return groups;
}

function generateCatalog(docs: DocEntry[]): string {
  const lines: string[] = [];

  // Header
  lines.push('---');
  lines.push('title: ServalSheets Documentation Catalog');
  lines.push('description: Comprehensive index of all ServalSheets documentation');
  lines.push('category: index');
  lines.push('version: 1.6.0');
  lines.push(`last_updated: ${new Date().toISOString().split('T')[0]}`);
  lines.push('tags: [index, catalog, navigation]');
  lines.push('---');
  lines.push('');
  lines.push('# ServalSheets Documentation Catalog');
  lines.push('');
  lines.push(
    '> **Auto-generated documentation index** - Last updated: ' +
      new Date().toISOString().split('T')[0]
  );
  lines.push('');

  // Statistics
  const categories = groupByCategory(docs);
  lines.push('## Overview');
  lines.push('');
  lines.push(`- **Total Documents:** ${docs.length}`);
  lines.push(`- **Categories:** ${categories.size}`);
  lines.push('- **Last Catalog Update:** ' + new Date().toISOString());
  lines.push('');

  // Category summary
  lines.push('## Categories');
  lines.push('');
  for (const [category, categoryDocs] of Array.from(categories.entries()).sort()) {
    lines.push(`- [${category}](#${category}) (${categoryDocs.length} docs)`);
  }
  lines.push('');

  // Detailed listings by category
  const categoryOrder = [
    'guide',
    'reference',
    'development',
    'runbook',
    'architecture',
    'example',
    'business',
    'general',
  ];

  const sortedCategories = Array.from(categories.entries()).sort(([a], [b]) => {
    const indexA = categoryOrder.indexOf(a);
    const indexB = categoryOrder.indexOf(b);
    if (indexA === -1 && indexB === -1) return a.localeCompare(b);
    if (indexA === -1) return 1;
    if (indexB === -1) return -1;
    return indexA - indexB;
  });

  for (const [category, categoryDocs] of sortedCategories) {
    lines.push(`## ${category}`);
    lines.push('');

    for (const doc of categoryDocs) {
      const title = doc.metadata.title || 'Untitled';
      const description = doc.metadata.description || '';
      const tags = Array.isArray(doc.metadata.tags) ? doc.metadata.tags : [];
      const difficulty = doc.metadata.difficulty;
      const audience = doc.metadata.audience;

      lines.push(`### [${title}](/${doc.relativePath})`);
      lines.push('');

      if (description) {
        lines.push(description);
        lines.push('');
      }

      // Metadata badges
      const badges: string[] = [];
      if (difficulty) badges.push(`**Difficulty:** ${difficulty}`);
      if (audience) badges.push(`**Audience:** ${audience}`);
      if (doc.metadata.estimated_time) badges.push(`**Time:** ${doc.metadata.estimated_time}`);
      if (doc.metadata.stability) badges.push(`**Stability:** ${doc.metadata.stability}`);

      if (badges.length > 0) {
        lines.push(badges.join(' | '));
        lines.push('');
      }

      if (tags.length > 0) {
        lines.push(`**Tags:** ${tags.join(', ')}`);
        lines.push('');
      }
    }
  }

  // Tag index
  lines.push('## Tag Index');
  lines.push('');
  const tagMap = new Map<string, DocEntry[]>();

  for (const doc of docs) {
    const tags = doc.metadata.tags;
    if (Array.isArray(tags)) {
      for (const tag of tags) {
        if (!tagMap.has(tag)) {
          tagMap.set(tag, []);
        }
        tagMap.get(tag)!.push(doc);
      }
    }
  }

  const sortedTags = Array.from(tagMap.entries()).sort(([a], [b]) => a.localeCompare(b));

  for (const [tag, tagDocs] of sortedTags) {
    lines.push(`### ${tag}`);
    lines.push('');
    for (const doc of tagDocs) {
      const title = doc.metadata.title || 'Untitled';
      lines.push(`- [${title}](/${doc.relativePath})`);
    }
    lines.push('');
  }

  // Footer
  lines.push('---');
  lines.push('');
  lines.push('**Note:** This catalog is auto-generated from frontmatter metadata.');
  lines.push('To update, run: `npm run docs:catalog`');
  lines.push('');

  return lines.join('\n');
}

async function main() {
  console.log('📚 Generating documentation catalog...\n');

  const docs = await collectDocs();
  console.log(`Found ${docs.length} documents with frontmatter\n`);

  const catalog = generateCatalog(docs);

  const outputPath = 'docs/DOCS_CATALOG.md';
  fs.writeFileSync(outputPath, catalog);

  console.log(`✅ Catalog generated: ${outputPath}`);
  console.log(`\nStatistics:`);
  console.log(`  Total documents: ${docs.length}`);
  console.log(`  Categories: ${groupByCategory(docs).size}`);

  const allTags = new Set<string>();
  for (const doc of docs) {
    const tags = doc.metadata.tags;
    if (Array.isArray(tags)) {
      for (const tag of tags) {
        allTags.add(tag);
      }
    }
  }
  console.log(`  Unique tags: ${allTags.size}`);
}

main().catch(console.error);
