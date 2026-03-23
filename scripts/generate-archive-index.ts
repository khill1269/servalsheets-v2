#!/usr/bin/env tsx
/**
 * Generate index for archived documentation
 */

import fs from 'node:fs';
import path from 'node:path';
import { glob } from 'glob';

async function main() {
  const ARCHIVE_DIR = 'docs/archive';
  const OUTPUT_FILE = path.join(ARCHIVE_DIR, 'INDEX.md');

  console.log('📚 Generating archive index...');

  const files = await glob(`${ARCHIVE_DIR}/**/*.md`, {
    ignore: [`${ARCHIVE_DIR}/INDEX.md`],
  });

  // Group by subdirectory
  const groups = new Map<string, string[]>();

  for (const file of files) {
    const dir = path.dirname(file);
    const relDir = path.relative(ARCHIVE_DIR, dir);
    const key = relDir || '(root)';

    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(file);
  }

  const sortedKeys = Array.from(groups.keys()).sort();

  const lines: string[] = [];
  const timestamp = new Date().toISOString().split('T')[0];

  lines.push('---');
  lines.push('title: Documentation Archive Index');
  lines.push('description: Historical and deprecated documentation files');
  lines.push('category: archived');
  lines.push(`last_updated: ${timestamp}`);
  lines.push('---');
  lines.push('');
  lines.push('# Documentation Archive Index');
  lines.push('');
  lines.push(
    '> **Note:** These documents are archived and may be outdated. For current documentation, see [docs/](../).'
  );
  lines.push('');
  lines.push('## Overview');
  lines.push('');
  lines.push(`**Total archived files:** ${files.length}`);
  lines.push(`**Last updated:** ${timestamp}`);
  lines.push('');
  lines.push(
    'This archive contains historical documentation, deprecated guides, and old analysis reports that are no longer actively maintained but kept for reference.'
  );
  lines.push('');
  lines.push('## Archive Structure');
  lines.push('');

  for (const dir of sortedKeys) {
    const dirFiles = groups.get(dir)!.sort();
    lines.push(`### ${dir} (${dirFiles.length} files)`);
    lines.push('');

    for (const file of dirFiles) {
      const relPath = path.relative('docs', file);
      const filename = path.basename(file);

      // Try to extract title from file
      let title = filename;
      try {
        const content = fs.readFileSync(file, 'utf8');
        const titleMatch = content.match(/^#\s+(.+)$/m);
        if (titleMatch) {
          title = titleMatch[1];
        }
      } catch {
        // Use filename if can't read file
      }

      lines.push(`- [${title}](/${relPath})`);
    }

    lines.push('');
  }

  lines.push('---');
  lines.push('');
  lines.push('## Maintenance');
  lines.push('');
  lines.push(
    'Archived files are not included in the main documentation catalog and are excluded from link checking and linting.'
  );
  lines.push('');
  lines.push('**If you need to reference archived content:**');
  lines.push('');
  lines.push("1. Check if there's a newer version in active docs");
  lines.push('2. Consider updating the current docs rather than using archived versions');
  lines.push('3. Contact the team if critical information seems missing');
  lines.push('');

  fs.writeFileSync(OUTPUT_FILE, lines.join('\n'));

  console.log(`✅ Archive index generated: ${OUTPUT_FILE}`);
  console.log(`   Total archived files: ${files.length}`);
}

main().catch(console.error);
