#!/usr/bin/env tsx
/**
 * Auto-fix missing last_updated dates in frontmatter
 * Uses git last-modified date or current date
 */

import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { glob } from 'glob';

const DRY_RUN = process.argv.includes('--dry-run');

function getGitLastModified(file: string): string | null {
  try {
    const timestamp = execSync(`git log -1 --format=%cI -- "${file}"`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
    }).trim();

    return timestamp ? new Date(timestamp).toISOString().split('T')[0] : null;
  } catch {
    return null;
  }
}

function updateFrontmatter(file: string): boolean {
  const content = fs.readFileSync(file, 'utf8');

  if (!content.trimStart().startsWith('---')) {
    console.log(`⏭️  Skipping ${file} (no frontmatter)`);
    return false;
  }

  const endIndex = content.indexOf('---', 3);
  if (endIndex === -1) {
    console.log(`⏭️  Skipping ${file} (malformed frontmatter)`);
    return false;
  }

  const frontmatter = content.slice(3, endIndex);
  const body = content.slice(endIndex + 3);

  // Check if last_updated exists
  if (frontmatter.match(/^last_updated:/m)) {
    return false; // Already has last_updated
  }

  // Get date from git or use today
  const date = getGitLastModified(file) || new Date().toISOString().split('T')[0];

  // Add last_updated after version or at end
  let newFrontmatter = frontmatter;
  if (frontmatter.includes('version:')) {
    newFrontmatter = frontmatter.replace(/(version:.*\n)/, `$1last_updated: ${date}\n`);
  } else {
    newFrontmatter = frontmatter.trim() + `\nlast_updated: ${date}\n`;
  }

  const newContent = '---\n' + newFrontmatter + '---' + body;

  if (DRY_RUN) {
    console.log(`Would update ${file} with last_updated: ${date}`);
  } else {
    fs.writeFileSync(file, newContent);
    console.log(`✅ Updated ${file} with last_updated: ${date}`);
  }

  return true;
}

async function main() {
  console.log('🔧 Fixing missing last_updated dates in frontmatter...\n');

  if (DRY_RUN) {
    console.log('🧪 DRY RUN MODE - No files will be modified\n');
  }

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

  let updated = 0;
  let skipped = 0;

  for (const file of files) {
    if (updateFrontmatter(file)) {
      updated++;
    } else {
      skipped++;
    }
  }

  console.log(`\n✨ Summary:`);
  console.log(`   Updated: ${updated}`);
  console.log(`   Skipped: ${skipped}`);

  if (DRY_RUN) {
    console.log(`\n💡 Run without --dry-run to apply changes`);
  }
}

main().catch(console.error);
