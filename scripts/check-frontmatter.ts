#!/usr/bin/env tsx
/**
 * Validate frontmatter in markdown files
 * Usage: tsx scripts/check-frontmatter.ts [files...]
 */

import fs from 'node:fs';

const REQUIRED_FIELDS = ['title', 'category', 'last_updated'];
const VALID_CATEGORIES = [
  'guide',
  'reference',
  'runbook',
  'development',
  'architecture',
  'example',
  'business',
  'archived',
  'general',
];

interface ValidationError {
  file: string;
  line: number;
  error: string;
}

function extractFrontmatter(content: string): {
  frontmatter: Record<string, unknown>;
  hasError: boolean;
} {
  const trimmed = content.trimStart();

  if (!trimmed.startsWith('---')) {
    return { frontmatter: {}, hasError: true };
  }

  const endIndex = trimmed.indexOf('---', 3);
  if (endIndex === -1) {
    return { frontmatter: {}, hasError: true };
  }

  const frontmatterText = trimmed.slice(3, endIndex).trim();
  const lines = frontmatterText.split('\n');
  const frontmatter: Record<string, unknown> = {};

  for (const line of lines) {
    const match = line.match(/^([a-z_]+):\s*(.+)$/i);
    if (match) {
      const [, key, value] = match;
      // Parse arrays
      if (value.startsWith('[') && value.endsWith(']')) {
        frontmatter[key] = value
          .slice(1, -1)
          .split(',')
          .map((v) => v.trim());
      } else {
        // Remove quotes
        frontmatter[key] = value.replace(/^["']|["']$/g, '');
      }
    }
  }

  return { frontmatter, hasError: false };
}

function validateFile(filePath: string): ValidationError[] {
  const errors: ValidationError[] = [];

  // Skip archived files
  if (filePath.includes('/archive/')) {
    return errors;
  }

  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const { frontmatter, hasError } = extractFrontmatter(content);

    if (hasError) {
      errors.push({
        file: filePath,
        line: 1,
        error: 'Missing or malformed frontmatter (must start with --- and end with ---)',
      });
      return errors;
    }

    // Check required fields
    for (const field of REQUIRED_FIELDS) {
      if (!frontmatter[field]) {
        errors.push({
          file: filePath,
          line: 1,
          error: `Missing required field: ${field}`,
        });
      }
    }

    // Validate category
    if (frontmatter.category && !VALID_CATEGORIES.includes(frontmatter.category as string)) {
      errors.push({
        file: filePath,
        line: 1,
        error: `Invalid category "${frontmatter.category}". Valid: ${VALID_CATEGORIES.join(', ')}`,
      });
    }

    // Validate last_updated format (YYYY-MM-DD)
    if (
      frontmatter.last_updated &&
      !/^\d{4}-\d{2}-\d{2}$/.test(frontmatter.last_updated as string)
    ) {
      errors.push({
        file: filePath,
        line: 1,
        error: `Invalid last_updated format. Expected YYYY-MM-DD, got: ${frontmatter.last_updated}`,
      });
    }

    // Validate tags is array if present
    if (frontmatter.tags && !Array.isArray(frontmatter.tags)) {
      errors.push({
        file: filePath,
        line: 1,
        error: 'Field "tags" must be an array',
      });
    }
  } catch (err) {
    errors.push({
      file: filePath,
      line: 0,
      error: `Failed to read file: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  return errors;
}

function main() {
  const files = process.argv.slice(2);

  if (files.length === 0) {
    console.error('Usage: tsx scripts/check-frontmatter.ts [files...]');
    process.exit(1);
  }

  let totalErrors = 0;

  for (const file of files) {
    // Only check markdown files in docs/
    if (!file.endsWith('.md') || !file.includes('docs/')) {
      continue;
    }

    const errors = validateFile(file);

    if (errors.length > 0) {
      console.error(`\n❌ ${file}:`);
      for (const error of errors) {
        console.error(`   ${error.error}`);
      }
      totalErrors += errors.length;
    }
  }

  if (totalErrors > 0) {
    console.error(`\n❌ Found ${totalErrors} frontmatter validation error(s)`);
    console.error('\n💡 Tip: Run "npm run docs:frontmatter" to auto-generate frontmatter');
    process.exit(1);
  }

  if (files.length > 0) {
    console.log('✅ Frontmatter validation passed');
  }
}

main();
