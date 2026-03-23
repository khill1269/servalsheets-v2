#!/usr/bin/env tsx

/**
 * Validates that all package versions in package.json files exist on npm
 * before npm install runs. Catches version mismatches early.
 */

import { execSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

interface ValidationResult {
  package: string;
  specified: string;
  exists: boolean;
  latest?: string;
  error?: string;
  skipped?: boolean;
}

const packageFiles = [
  'package.json',
  'tools/google-docs-server/package.json',
  'tools/test-intelligence-server/package.json',
  'tools/gcloud-console-server/package.json',
];

async function validateVersion(pkg: string, version: string): Promise<ValidationResult> {
  if (
    version.startsWith('workspace:') ||
    version.startsWith('file:') ||
    version.startsWith('link:') ||
    version.startsWith('git+') ||
    version.startsWith('http:')
  ) {
    return {
      package: pkg,
      specified: version,
      exists: true,
      skipped: true,
    };
  }

  try {
    // Remove semver range characters to get exact version
    const cleanVersion = version.replace(/[\^~>=<]/, '').trim();

    // Check if this exact version exists on npm
    try {
      execSync(`npm view ${pkg}@${cleanVersion} version`, {
        stdio: 'pipe',
        encoding: 'utf-8',
      });
      return {
        package: pkg,
        specified: version,
        exists: true,
      };
    } catch {
      // Version doesn't exist, get latest
      const latest = execSync(`npm view ${pkg} version`, {
        encoding: 'utf-8',
      }).trim();
      return {
        package: pkg,
        specified: version,
        exists: false,
        latest,
        error: `Version ${version} not found. Latest: ${latest}`,
      };
    }
  } catch (error) {
    return {
      package: pkg,
      specified: version,
      exists: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
}

async function main() {
  console.log('🔍 Validating package versions across all package.json files...\n');

  let hasErrors = false;
  const results: ValidationResult[] = [];

  for (const file of packageFiles) {
    const fullPath = join(process.cwd(), file);
    if (!existsSync(fullPath)) {
      console.log(`⏭️  Skipping ${file} (not found)`);
      continue;
    }

    console.log(`📦 Checking ${file}...`);
    const packageJson = JSON.parse(readFileSync(fullPath, 'utf-8'));

    const allDeps = {
      ...packageJson.dependencies,
      ...packageJson.devDependencies,
    };

    for (const [pkg, version] of Object.entries(allDeps)) {
      const result = await validateVersion(pkg, version as string);
      results.push(result);

      if (result.exists) {
        if (result.skipped) {
          console.log(`  ⏭️  ${pkg}@${result.specified} (local/workspace dependency)`);
        } else {
          console.log(`  ✅ ${pkg}@${result.specified}`);
        }
      } else {
        console.error(`  ❌ ${pkg}@${result.specified}`);
        console.error(`     ${result.error}`);
        hasErrors = true;
      }
    }
    console.log('');
  }

  // Summary
  console.log('━'.repeat(60));
  console.log(
    `📊 Summary: ${results.filter((r) => r.exists).length}/${results.length} packages valid`
  );

  if (hasErrors) {
    console.error('\n❌ Validation failed. Fix version mismatches before installing.');
    process.exit(1);
  } else {
    console.log('\n✅ All package versions are valid!');
    process.exit(0);
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
