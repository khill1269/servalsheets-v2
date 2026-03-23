#!/usr/bin/env node
/**
 * ServalSheets - CLI Entry Point
 * MCP Protocol: 2025-11-25
 *
 * Supports multiple transports:
 * - STDIO (default): For Claude Desktop and MCP clients
 * - HTTP: For web-based integrations
 */

// Load environment variables from .env file (silently to avoid MCP JSON parsing errors)
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Get the directory where the CLI is located (works for both src and dist)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// Go up one level from dist/ or src/ to find .env in project root
const projectRoot = join(__dirname, '..');

// Suppress dotenv's informational banner to prevent Claude Desktop JSON parsing errors
// The banner "[dotenv@17.2.3] injecting env..." breaks STDIO transport JSON parsing
// Load from project root so it works regardless of CWD
dotenv.config({ quiet: true, path: join(projectRoot, '.env') });

import { type ServalSheetsServerOptions } from './server.js';
import { logger } from './utils/logger.js';
import { VERSION } from './version.js';
import {
  startBackgroundTasks,
  registerSignalHandlers,
  logEnvironmentConfig,
  requireEncryptionKeyInProduction,
  ensureEncryptionKey,
} from './startup/lifecycle.js';
import { runPreflightChecks } from './startup/preflight-validation.js';
import { enhanceStartupError } from './utils/enhanced-errors.js';
import {
  checkRestartBackoff,
  recordStartupAttempt,
  recordSuccessfulStartup,
} from './startup/restart-policy.js';

// Global crash handlers — prevent silent exits that leave Claude Desktop with "Server disconnected"
// These write to stderr (safe in STDIO mode — only stdout is the MCP channel)
process.on('unhandledRejection', (reason) => {
  console.error('ServalSheets unhandled rejection:', reason);
  logger.error('Unhandled promise rejection', {
    error: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
  });
});

process.on('uncaughtException', (error) => {
  console.error('ServalSheets uncaught exception:', error);
  logger.error('Uncaught exception — shutting down', {
    error: error.message,
    stack: error.stack,
  });
  process.exit(1);
});

// Record startup start time for metrics
process.env['SERVALSHEETS_STARTUP_TIME'] = Date.now().toString();

const args = process.argv.slice(2);

// Handle `servalsheets init` subcommand — interactive setup wizard
if (args[0] === 'init') {
  const { runAuthSetup } = await import('./cli/auth-setup.js');
  await runAuthSetup();
  process.exit(0);
}

// Parse command line arguments
const cliOptions: {
  serviceAccountKeyPath?: string;
  accessToken?: string;
  transport: 'stdio' | 'http';
  port?: number;
} = {
  transport: 'stdio', // Default transport
};

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  const nextArg = args[i + 1];

  if (arg === '--service-account' && nextArg) {
    cliOptions.serviceAccountKeyPath = nextArg;
    i++;
  } else if (arg === '--access-token' && nextArg) {
    cliOptions.accessToken = nextArg;
    i++;
  } else if (arg === '--stdio') {
    cliOptions.transport = 'stdio';
  } else if (arg === '--http') {
    cliOptions.transport = 'http';
  } else if (arg === '--port' && nextArg) {
    cliOptions.port = parseInt(nextArg, 10);
    i++;
  } else if (arg === '--version' || arg === '-v') {
    // Dynamic import to get version from package.json
    import('../package.json', { assert: { type: 'json' } })
      .then((pkg) => {
        // eslint-disable-next-line no-console
        console.log(`servalsheets v${pkg.default.version}`);
        process.exit(0);
      })
      .catch(() => {
        // eslint-disable-next-line no-console
        console.log(`servalsheets v${VERSION}`);
        process.exit(0);
      });
    // Prevent further execution while waiting for import
    await new Promise(() => {});
  } else if (arg === '--help' || arg === '-h') {
    // eslint-disable-next-line no-console
    console.log(`
ServalSheets - Google Sheets MCP Server

Usage:
  servalsheets [command] [options]

Commands:
  init                      Interactive setup wizard (OAuth + .env configuration)

Transport Options:
  --stdio                   Use STDIO transport (default)
  --http                    Use HTTP transport
  --port <port>             Port for HTTP server (default: 3000)

Authentication Options:
  --service-account <path>  Path to service account key JSON file
  --access-token <token>    OAuth2 access token

Other Options:
  --version, -v             Show version
  --help, -h                Show this help message

Environment Variables:
  GOOGLE_APPLICATION_CREDENTIALS  Path to service account key
  GOOGLE_ACCESS_TOKEN             OAuth2 access token
  GOOGLE_CLIENT_ID                OAuth2 client ID
  GOOGLE_CLIENT_SECRET            OAuth2 client secret
  GOOGLE_TOKEN_STORE_PATH         Encrypted token store file path
  ENCRYPTION_KEY                  Token store encryption key (64-char hex)
  PORT                            HTTP server port (default: 3000)

Examples:
  # STDIO transport (for Claude Desktop)
  servalsheets --stdio

  # HTTP transport
  servalsheets --http --port 8080

  # Using service account
  servalsheets --service-account ./credentials.json

  # Using access token
  servalsheets --access-token ya29.xxx

  # Using environment variables
  export GOOGLE_APPLICATION_CREDENTIALS=./credentials.json
  servalsheets
`);
    process.exit(0);
  }
}

// Check environment variables
// Support both GOOGLE_* and OAUTH_* prefixes for flexibility
const serviceAccountPath =
  cliOptions.serviceAccountKeyPath ?? process.env['GOOGLE_APPLICATION_CREDENTIALS'];
const accessToken = cliOptions.accessToken ?? process.env['GOOGLE_ACCESS_TOKEN'];
const clientId = process.env['GOOGLE_CLIENT_ID'] ?? process.env['OAUTH_CLIENT_ID'];
const clientSecret = process.env['GOOGLE_CLIENT_SECRET'] ?? process.env['OAUTH_CLIENT_SECRET'];
const redirectUri = process.env['GOOGLE_REDIRECT_URI'] ?? process.env['OAUTH_REDIRECT_URI'];
const tokenStorePath = process.env['GOOGLE_TOKEN_STORE_PATH'];
const tokenStoreKey = process.env['ENCRYPTION_KEY'];

// Build server options
const serverOptions: ServalSheetsServerOptions = {};

// Build Google API options only if we have credentials
const sharedGoogleOptions = {
  tokenStorePath,
  tokenStoreKey,
};

if (serviceAccountPath) {
  serverOptions.googleApiOptions = {
    serviceAccountKeyPath: serviceAccountPath,
    ...sharedGoogleOptions,
  };
} else if (accessToken) {
  serverOptions.googleApiOptions = {
    accessToken: accessToken,
    ...sharedGoogleOptions,
  };
} else if (clientId && clientSecret) {
  serverOptions.googleApiOptions = {
    credentials: { clientId, clientSecret, redirectUri },
    ...sharedGoogleOptions,
  };
}

// Initialize and start server
(async () => {
  try {
    // Check if we need to enforce backoff delay (prevents rapid restart loops)
    const backoffDelay = await checkRestartBackoff();
    if (backoffDelay > 0) {
      console.error(
        `⏳ Waiting ${Math.ceil(backoffDelay / 1000)}s before restart (exponential backoff)...`
      );
      await new Promise((resolve) => setTimeout(resolve, backoffDelay));
    }

    // Record this startup attempt (for exponential backoff tracking)
    await recordStartupAttempt();

    // Run pre-flight validation checks
    const preflightResults = await runPreflightChecks();
    if (preflightResults.criticalFailures > 0) {
      console.error('\n❌ Pre-flight checks failed - cannot start server\n');
      preflightResults.failures.forEach((f) => {
        console.error(`  ✗ ${f.name}: ${f.message}`);
        if (f.fix) console.error(`    Fix: ${f.fix}`);
      });
      console.error('');
      process.exit(1);
    }

    // Log warnings but continue
    if (preflightResults.warnings > 0) {
      console.warn('\n⚠️  Pre-flight warnings:\n');
      preflightResults.warningList.forEach((w) => {
        console.warn(`  • ${w.name}: ${w.message}`);
        if (w.fix) console.warn(`    Fix: ${w.fix}`);
      });
      console.warn('');
    }

    // CRITICAL-004 FIX: Validate production security requirements
    // This ensures ENCRYPTION_KEY is set in production mode
    requireEncryptionKeyInProduction();

    // Ensure encryption key is available (generates temporary key in development)
    ensureEncryptionKey();

    // Log environment configuration
    logEnvironmentConfig();

    // Start background tasks and validate configuration
    await startBackgroundTasks();

    // Register signal handlers for graceful shutdown
    registerSignalHandlers();

    if (cliOptions.transport === 'http') {
      // Start HTTP server
      const port = cliOptions.port ?? parseInt(process.env['PORT'] ?? '3000', 10);

      // Dynamic import to avoid loading HTTP dependencies for STDIO mode
      const { startHttpServer } = await import('./http-server.js');
      await startHttpServer({ port, ...serverOptions });

      logger.info(`ServalSheets HTTP server started on port ${port}`);
    } else {
      // Start STDIO server (default)
      // Uses createServalSheetsServer to get automatic Redis support
      const { createServalSheetsServer } = await import('./server.js');
      await createServalSheetsServer(serverOptions);

      logger.info('ServalSheets STDIO server started successfully');
    }

    // Schedule recording successful startup after SUCCESS_THRESHOLD_MS (default: 30s)
    // This resets the exponential backoff counter
    setTimeout(() => {
      recordSuccessfulStartup().catch(() => {
        // Ignore errors in background task
      });
    }, 30000);
  } catch (error) {
    // Use enhanced error system for actionable messages
    const enhancedError = enhanceStartupError(error);

    console.error('\n❌ FATAL: ServalSheets failed to start\n');
    console.error(`Error: ${enhancedError.message}\n`);

    if (enhancedError.resolution) {
      console.error(`💡 Fix: ${enhancedError.resolution}\n`);
    }

    if (enhancedError.resolutionSteps && enhancedError.resolutionSteps.length > 0) {
      console.error('Steps to resolve:');
      enhancedError.resolutionSteps.forEach((step) => console.error(`  ${step}`));
      console.error('');
    }

    // Structured logging for debugging
    logger.error('Failed to start ServalSheets server', {
      error: enhancedError,
      stack: error instanceof Error ? error.stack : undefined,
    });

    process.exit(1);
  }
})();
