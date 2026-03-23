#!/usr/bin/env node
/**
 * CLI Schema Manager
 *
 * Command-line tool for managing Google API schemas via Discovery API.
 * Provides schema fetching, comparison, version listing, and cache management.
 */

import { DiscoveryApiClient, getDiscoveryApiClient } from '../services/discovery-client.js';
import { SchemaCache, getSchemaCache } from '../services/schema-cache.js';
import { SchemaValidator, getSchemaValidator } from '../services/schema-validator.js';
import { logger } from '../utils/logger.js';

/**
 * CLI command type
 */
type Command = 'fetch' | 'compare' | 'versions' | 'clear-cache' | 'migration-report' | 'help';

/**
 * CLI options
 */
interface CliOptions {
  api?: 'sheets' | 'drive' | 'all';
  version?: string;
  verbose?: boolean;
}

/**
 * Schema Manager CLI
 */
class SchemaManagerCli {
  private discoveryClient: DiscoveryApiClient;
  private schemaCache: SchemaCache;
  private schemaValidator: SchemaValidator;

  constructor() {
    this.discoveryClient = getDiscoveryApiClient();
    this.schemaCache = getSchemaCache();
    this.schemaValidator = getSchemaValidator();
  }

  /**
   * Run CLI command
   */
  async run(command: Command, options: CliOptions = {}): Promise<void> {
    try {
      switch (command) {
        case 'fetch':
          await this.fetch(options);
          break;
        case 'compare':
          await this.compare(options);
          break;
        case 'versions':
          await this.versions(options);
          break;
        case 'clear-cache':
          await this.clearCache(options);
          break;
        case 'migration-report':
          await this.migrationReport(options);
          break;
        case 'help':
        default:
          this.printHelp();
          break;
      }
    } catch (error: unknown) {
      const err = error as { message?: string };
      console.error('\n❌ Error:', err.message);
      process.exit(1);
    }
  }

  /**
   * Fetch and cache latest schemas
   */
  private async fetch(options: CliOptions): Promise<void> {
    console.log('\n🔍 Fetching Google API schemas...\n');

    const apis: Array<'sheets' | 'drive'> =
      options.api === 'all' || !options.api ? ['sheets', 'drive'] : [options.api];

    for (const api of apis) {
      const version = options.version ?? (api === 'sheets' ? 'v4' : 'v3');

      try {
        console.log(`📦 Fetching ${api} API ${version}...`);
        const schema = await this.discoveryClient.getApiSchema(api, version);

        await this.schemaCache.set(api, version, schema);

        console.log(`✅ ${api} API ${version} cached successfully`);
        console.log(`   Title: ${schema.title}`);
        console.log(`   Schemas: ${Object.keys(schema.schemas).length} types`);
        console.log(`   Methods: ${this.countMethods(schema.resources)} operations\n`);
      } catch (error: unknown) {
        const err = error as { message?: string };
        console.error(`❌ Failed to fetch ${api} API ${version}: ${err.message}\n`);
      }
    }

    // Show cache stats
    const stats = await this.schemaCache.getCacheStats();
    console.log('📊 Cache Statistics:');
    console.log(`   Total entries: ${stats.entries}`);
    console.log(`   Total size: ${this.formatBytes(stats.totalSize)}`);
    console.log(`   Expired entries: ${stats.expiredEntries}\n`);
  }

  /**
   * Compare with current implementation
   */
  private async compare(options: CliOptions): Promise<void> {
    console.log('\n🔍 Comparing schemas with current implementation...\n');

    const apis: Array<'sheets' | 'drive'> =
      options.api === 'all' || !options.api ? ['sheets', 'drive'] : [options.api];

    let hasChanges = false;

    for (const api of apis) {
      try {
        console.log(`📋 Analyzing ${api.toUpperCase()} API...`);
        const result = await this.schemaValidator.validateAgainstCurrent(api);

        if (result.valid && !result.comparison?.hasChanges) {
          console.log(`✅ ${api.toUpperCase()} API: No changes detected\n`);
          continue;
        }

        hasChanges = true;

        if (result.comparison) {
          this.printComparisonSummary(result.comparison);
        }

        if (result.issues.length > 0) {
          console.log('\n⚠️  Issues detected:');
          for (const issue of result.issues) {
            const icon = this.getIssueIcon(issue.severity);
            console.log(`   ${icon} [${issue.severity.toUpperCase()}] ${issue.message}`);
            if (issue.suggestedAction) {
              console.log(`      → ${issue.suggestedAction}`);
            }
          }
        }

        console.log(`\n💡 ${result.recommendation}\n`);
      } catch (error: unknown) {
        const err = error as { message?: string };
        console.error(`❌ Failed to compare ${api} API: ${err.message}\n`);
      }
    }

    if (hasChanges) {
      console.log('\n📝 Run `npm run schema:migration-report` for detailed migration guidance.\n');
      process.exit(1); // Exit with error code to signal changes
    }
  }

  /**
   * Show available API versions
   */
  private async versions(options: CliOptions): Promise<void> {
    console.log('\n🔍 Fetching available API versions...\n');

    const apis: Array<'sheets' | 'drive'> =
      options.api === 'all' || !options.api ? ['sheets', 'drive'] : [options.api];

    for (const api of apis) {
      try {
        console.log(`📦 ${api.toUpperCase()} API versions:`);
        const versions = await this.discoveryClient.listAvailableVersions(api);

        for (const version of versions) {
          console.log(`   • ${version}`);
        }
        console.log('');
      } catch (error: unknown) {
        const err = error as { message?: string };
        console.error(`❌ Failed to fetch ${api} API versions: ${err.message}\n`);
      }
    }
  }

  /**
   * Clear schema cache
   */
  private async clearCache(options: CliOptions): Promise<void> {
    console.log('\n🗑️  Clearing schema cache...\n');

    if (options.api && options.api !== 'all') {
      const version = options.version ?? (options.api === 'sheets' ? 'v4' : 'v3');
      await this.schemaCache.invalidate(options.api, version);
      console.log(`✅ Cleared ${options.api} API ${version} cache\n`);
    } else {
      await this.schemaCache.invalidateAll();
      console.log('✅ Cleared all cached schemas\n');
    }
  }

  /**
   * Generate migration report
   */
  private async migrationReport(options: CliOptions): Promise<void> {
    console.log('\n📝 Generating migration report...\n');

    const apis: Array<'sheets' | 'drive'> =
      options.api === 'all' || !options.api ? ['sheets', 'drive'] : [options.api];

    for (const api of apis) {
      try {
        console.log(`📋 Analyzing ${api.toUpperCase()} API...\n`);
        const result = await this.schemaValidator.validateAgainstCurrent(api);

        if (!result.comparison?.hasChanges) {
          console.log(`✅ ${api.toUpperCase()} API: No changes detected\n`);
          continue;
        }

        const plan = this.schemaValidator.generateMigrationPlan(result.comparison);
        const report = this.schemaValidator.formatMigrationReport(plan);

        console.log(report);
        console.log('\n' + '='.repeat(80) + '\n');
      } catch (error: unknown) {
        const err = error as { message?: string };
        console.error(`❌ Failed to generate migration report for ${api} API: ${err.message}\n`);
      }
    }
  }

  /**
   * Print help
   */
  private printHelp(): void {
    console.log(`
📚 Schema Manager CLI

Manage Google API schemas via Discovery API.

USAGE:
  npm run schema:<command> [options]

COMMANDS:
  fetch              Fetch and cache latest schemas
  compare            Compare with current implementation
  versions           Show available API versions
  clear-cache        Clear schema cache
  migration-report   Generate detailed migration report
  help               Show this help message

OPTIONS:
  --api=<api>        Target API: sheets, drive, or all (default: all)
  --version=<ver>    API version (default: v4 for sheets, v3 for drive)
  --verbose          Enable verbose logging

EXAMPLES:
  npm run schema:fetch
  npm run schema:fetch -- --api=sheets
  npm run schema:compare
  npm run schema:versions -- --api=drive
  npm run schema:clear-cache
  npm run schema:migration-report -- --api=sheets

ENVIRONMENT VARIABLES:
  DISCOVERY_API_ENABLED    Enable Discovery API (default: false)
  DISCOVERY_CACHE_TTL      Cache TTL in seconds (default: 86400)

NOTES:
  - Schemas are cached in .discovery-cache/
  - Cache expires after 24 hours by default
  - Compare command exits with code 1 if changes detected
`);
  }

  /**
   * Print comparison summary
   */
  private printComparisonSummary(comparison: {
    api: string;
    version: string;
    newFields: Array<{ path: string; type: string; description: string }>;
    deprecatedFields: Array<{ path: string; deprecationMessage: string }>;
    changedFields: Array<{ path: string; oldType: string; newType: string }>;
    newMethods: Array<{ name: string; description: string }>;
    removedMethods: string[];
  }): void {
    console.log(`   New fields: ${comparison.newFields.length}`);
    if (comparison.newFields.length > 0 && comparison.newFields.length <= 5) {
      for (const field of comparison.newFields) {
        console.log(`      • ${field.path} (${field.type})`);
      }
    }

    console.log(`   Deprecated fields: ${comparison.deprecatedFields.length}`);
    if (comparison.deprecatedFields.length > 0 && comparison.deprecatedFields.length <= 5) {
      for (const field of comparison.deprecatedFields) {
        console.log(`      • ${field.path}`);
      }
    }

    console.log(`   Changed fields: ${comparison.changedFields.length}`);
    if (comparison.changedFields.length > 0 && comparison.changedFields.length <= 5) {
      for (const field of comparison.changedFields) {
        console.log(`      • ${field.path}: ${field.oldType} → ${field.newType}`);
      }
    }

    console.log(`   New methods: ${comparison.newMethods.length}`);
    if (comparison.newMethods.length > 0 && comparison.newMethods.length <= 5) {
      for (const method of comparison.newMethods) {
        console.log(`      • ${method.name}`);
      }
    }

    console.log(`   Removed methods: ${comparison.removedMethods.length}`);
    if (comparison.removedMethods.length > 0 && comparison.removedMethods.length <= 5) {
      for (const method of comparison.removedMethods) {
        console.log(`      • ${method}`);
      }
    }
  }

  /**
   * Get issue icon by severity
   */
  private getIssueIcon(severity: string): string {
    switch (severity) {
      case 'critical':
        return '🔴';
      case 'high':
        return '🟠';
      case 'medium':
        return '🟡';
      case 'low':
        return '🔵';
      case 'info':
        return 'ℹ️';
      default:
        return '•';
    }
  }

  /**
   * Count methods in resources
   */
  private countMethods(resources: Record<string, unknown>): number {
    let count = 0;

    const countRecursive = (obj: unknown): void => {
      if (typeof obj !== 'object' || obj === null) {
        return;
      }

      const record = obj as Record<string, unknown>;

      if ('methods' in record && typeof record['methods'] === 'object') {
        const methods = record['methods'] as Record<string, unknown>;
        count += Object.keys(methods).length;
      }

      if ('resources' in record && typeof record['resources'] === 'object') {
        countRecursive(record['resources']);
      }

      for (const value of Object.values(record)) {
        if (typeof value === 'object' && value !== null) {
          countRecursive(value);
        }
      }
    };

    countRecursive(resources);
    return count;
  }

  /**
   * Format bytes to human-readable size
   */
  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 Bytes';

    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
  }
}

/**
 * Parse CLI arguments
 */
function parseArgs(): { command: Command; options: CliOptions } {
  const args = process.argv.slice(2);

  const command = (args[0] as Command) || 'help';

  const options: CliOptions = {
    verbose: args.includes('--verbose'),
  };

  // Parse --api=<value>
  const apiArg = args.find((arg) => arg.startsWith('--api='));
  if (apiArg) {
    const apiValue = apiArg.split('=')[1];
    if (apiValue === 'sheets' || apiValue === 'drive' || apiValue === 'all') {
      options.api = apiValue;
    }
  }

  // Parse --version=<value>
  const versionArg = args.find((arg) => arg.startsWith('--version='));
  if (versionArg) {
    options.version = versionArg.split('=')[1];
  }

  return { command, options };
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  const { command, options } = parseArgs();

  if (options.verbose) {
    process.env['LOG_LEVEL'] = 'debug';
  }

  const cli = new SchemaManagerCli();
  await cli.run(command, options);
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    const err = error as { message?: string };
    logger.error('CLI error', { error: err.message });
    process.exit(1);
  });
}

export { SchemaManagerCli, type Command, type CliOptions };
