/**
 * Pre-Flight Validation System
 *
 * Validates startup requirements before server initialization to provide
 * clear, actionable error messages instead of cryptic runtime failures.
 *
 * Checks performed:
 * 1. Build artifacts exist (dist/cli.js, dist/server.js)
 * 2. Node.js version meets minimum requirement
 * 3. Critical dependencies loadable
 * 4. Configuration validity
 * 5. File system permissions
 * 6. Port availability (HTTP mode only)
 */

import { existsSync, accessSync, constants as fsConstants, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { get as httpsGet } from 'https';
import { logger } from '../utils/logger.js';
import { createServer } from 'net';
import { TOOL_DEFINITIONS, ACTIVE_TOOL_DEFINITIONS } from '../mcp/registration/tool-definitions.js';
import { getServerInstructions } from '../mcp/features-2025-11-25.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..', '..');

export interface PreflightCheck {
  name: string;
  critical: boolean; // If true, failure blocks startup
  check: () => Promise<PreflightResult>;
}

export interface PreflightResult {
  passed: boolean;
  message: string;
  fix?: string; // Actionable fix command/instruction
  details?: Record<string, unknown>;
}

export interface PreflightResults {
  checks: Array<PreflightCheck & { result: PreflightResult }>;
  criticalFailures: number;
  warnings: number;
  failures: Array<{ name: string; message: string; fix?: string }>;
  warningList: Array<{ name: string; message: string; fix?: string }>;
}

/**
 * Check 1: Build Artifacts Exist
 * Verifies that TypeScript has been compiled and dist/ directory populated
 */
async function checkBuildArtifacts(): Promise<PreflightResult> {
  const distPath = join(projectRoot, 'dist');
  const cliPath = join(distPath, 'cli.js');
  const serverPath = join(distPath, 'server.js');

  if (!existsSync(distPath)) {
    return {
      passed: false,
      message: 'dist/ directory not found - project not built',
      fix: 'Run: npm run build',
      details: { distPath },
    };
  }

  if (!existsSync(cliPath)) {
    return {
      passed: false,
      message: 'dist/cli.js not found - incomplete build',
      fix: 'Run: npm run build',
      details: { cliPath },
    };
  }

  if (!existsSync(serverPath)) {
    return {
      passed: false,
      message: 'dist/server.js not found - incomplete build',
      fix: 'Run: npm run build',
      details: { serverPath },
    };
  }

  return {
    passed: true,
    message: 'Build artifacts present',
    details: { distPath, cliPath, serverPath },
  };
}

/**
 * Check 2: Node.js Version
 * Verifies Node.js version meets the package.json engine requirement
 */
function getRequiredNodeVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf-8')) as {
      engines?: { node?: string };
    };
    if (pkg.engines?.node) {
      return pkg.engines.node;
    }
  } catch {
    // Fall back to the published engine floor if package metadata is unavailable.
  }

  return '>=20.0.0';
}

async function checkNodeVersion(): Promise<PreflightResult> {
  const current = process.version; // e.g., "v20.11.0"
  const versionParts = current.slice(1).split('.');
  const currentMajor = parseInt(versionParts[0] || '0', 10);
  const required = getRequiredNodeVersion();
  const requiredMajor = parseInt(required.match(/>=\s*(\d+)/)?.[1] || '20', 10);

  if (currentMajor < requiredMajor) {
    return {
      passed: false,
      message: `Node.js ${current} is too old (requires ${required})`,
      fix: `Upgrade Node.js to version ${requiredMajor} or higher`,
      details: { current, required },
    };
  }

  return {
    passed: true,
    message: `Node.js ${current} meets requirements`,
    details: { current, required },
  };
}

/**
 * Check 3: Module Resolution
 * Verifies critical dependencies are installed and loadable
 */
async function checkModuleResolution(): Promise<PreflightResult> {
  const criticalModules = [
    '@modelcontextprotocol/sdk/server/index.js',
    'google-auth-library',
    'googleapis',
    'zod',
    // node-saml is unconditionally imported in http-server.ts; catch missing installs early
    'node-saml',
  ];

  const missingModules: string[] = [];

  for (const moduleName of criticalModules) {
    try {
      // Attempt to resolve the module
      await import(moduleName);
    } catch (_error) {
      missingModules.push(moduleName);
    }
  }

  if (missingModules.length > 0) {
    return {
      passed: false,
      message: `Missing ${missingModules.length} critical dependencies`,
      fix: 'Run: npm install',
      details: { missingModules },
    };
  }

  return {
    passed: true,
    message: `All ${criticalModules.length} critical dependencies loadable`,
    details: { criticalModules },
  };
}

/**
 * Check 4: Configuration Validation
 * Validates environment variable configuration
 */
async function checkConfiguration(): Promise<PreflightResult> {
  const issues: string[] = [];

  // ENCRYPTION_KEY validation
  const encryptionKey = process.env['ENCRYPTION_KEY'];
  if (encryptionKey) {
    if (encryptionKey.length !== 64) {
      issues.push(
        `ENCRYPTION_KEY must be 64 hex characters (32 bytes), got ${encryptionKey.length}`
      );
    } else if (!/^[0-9a-f]{64}$/i.test(encryptionKey)) {
      issues.push('ENCRYPTION_KEY must contain only hex characters (0-9, a-f)');
    }
  }

  // Local Google OAuth client validation
  const googleClientId = process.env['GOOGLE_CLIENT_ID'] ?? process.env['OAUTH_CLIENT_ID'];
  const googleClientSecret =
    process.env['GOOGLE_CLIENT_SECRET'] ?? process.env['OAUTH_CLIENT_SECRET'];
  const localOAuthVarsSet = [googleClientId, googleClientSecret].filter(Boolean).length;
  if (localOAuthVarsSet > 0 && localOAuthVarsSet < 2) {
    issues.push(
      'Incomplete OAuth client configuration - need GOOGLE_CLIENT_ID/OAUTH_CLIENT_ID and GOOGLE_CLIENT_SECRET/OAUTH_CLIENT_SECRET'
    );
  }

  // Remote OAuth server validation
  const jwtSecret = process.env['JWT_SECRET'];
  const stateSecret = process.env['STATE_SECRET'];
  const oauthClientSecret = process.env['OAUTH_CLIENT_SECRET'];
  const remoteGoogleClientId = process.env['GOOGLE_CLIENT_ID'];
  const remoteGoogleClientSecret = process.env['GOOGLE_CLIENT_SECRET'];
  const remoteOAuthVarsSet = [jwtSecret, stateSecret, oauthClientSecret].filter(Boolean).length;
  if (
    remoteOAuthVarsSet > 0 &&
    [
      jwtSecret,
      stateSecret,
      oauthClientSecret,
      remoteGoogleClientId,
      remoteGoogleClientSecret,
    ].filter(Boolean).length < 5
  ) {
    issues.push(
      'Incomplete remote OAuth configuration - need JWT_SECRET, STATE_SECRET, OAUTH_CLIENT_SECRET, GOOGLE_CLIENT_ID, and GOOGLE_CLIENT_SECRET'
    );
  }

  // Redis URL format validation (if present)
  const redisUrl = process.env['REDIS_URL'];
  if (redisUrl) {
    if (!redisUrl.startsWith('redis://') && !redisUrl.startsWith('rediss://')) {
      const preview = redisUrl.length > 20 ? `${redisUrl.slice(0, 20)}...` : redisUrl;
      issues.push(`REDIS_URL should start with redis:// or rediss://, got: ${preview}`);
    }
  }

  if (issues.length > 0) {
    return {
      passed: false,
      message: `Configuration validation failed: ${issues.length} issues`,
      fix: 'Fix configuration issues listed above',
      details: { issues },
    };
  }

  return {
    passed: true,
    message: 'Configuration validated',
    details: {
      hasEncryptionKey: Boolean(encryptionKey),
      hasOAuthClientConfig: localOAuthVarsSet === 2,
      hasRemoteOAuthConfig:
        [
          jwtSecret,
          stateSecret,
          oauthClientSecret,
          remoteGoogleClientId,
          remoteGoogleClientSecret,
        ].filter(Boolean).length === 5,
      hasRedisUrl: Boolean(redisUrl),
    },
  };
}

/**
 * Check 5: File System Permissions
 * Verifies write access to required directories
 */
async function checkFileSystemPermissions(): Promise<PreflightResult> {
  const homeDir = process.env['HOME'] || process.env['USERPROFILE'] || '/tmp';
  const servalSheetsDir = join(homeDir, '.servalsheets');
  const issues: string[] = [];

  // Check if directory exists and is writable
  try {
    if (!existsSync(servalSheetsDir)) {
      // Directory doesn't exist — verify parent is writable so creation will succeed
      try {
        accessSync(homeDir, fsConstants.W_OK);
      } catch {
        return {
          passed: false,
          message: `Cannot create ${servalSheetsDir} — parent directory ${homeDir} is not writable`,
          fix: `Ensure ${homeDir} is writable or set HOME to a writable directory`,
          details: { servalSheetsDir, homeDir, status: 'parent-not-writable' },
        };
      }
      return {
        passed: true,
        message: 'File system permissions OK (directory will be created)',
        details: { servalSheetsDir, status: 'will-create' },
      };
    }

    // Directory exists, check if writable
    accessSync(servalSheetsDir, fsConstants.W_OK);

    return {
      passed: true,
      message: 'File system permissions OK',
      details: { servalSheetsDir, status: 'writable' },
    };
  } catch (error) {
    issues.push(`Cannot write to ${servalSheetsDir}`);

    return {
      passed: false,
      message: 'File system permission check failed',
      fix: `Grant write permissions: chmod -R 755 ${servalSheetsDir}`,
      details: { servalSheetsDir, error: error instanceof Error ? error.message : String(error) },
    };
  }
}

/**
 * Check 6: Port Availability
 * Verifies HTTP port is available (HTTP mode only)
 */
async function checkPortAvailability(): Promise<PreflightResult> {
  // Only check port in HTTP mode
  const isHttpMode = process.argv.includes('--http');
  if (!isHttpMode) {
    return {
      passed: true,
      message: 'Port availability check skipped (STDIO mode)',
      details: { mode: 'stdio' },
    };
  }

  const port = parseInt(process.env['HTTP_PORT'] || process.env['PORT'] || '3000', 10);

  return new Promise((resolve) => {
    const server = createServer();

    server.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        resolve({
          passed: false,
          message: `Port ${port} is already in use`,
          fix: `Use different port: servalsheets --http --port 8080\nOr kill process: kill $(lsof -ti:${port})`,
          details: { port, error: 'EADDRINUSE' },
        });
      } else {
        resolve({
          passed: false,
          message: `Port check failed: ${err.message}`,
          fix: 'Check network configuration',
          details: { port, error: err.code },
        });
      }
    });

    server.once('listening', () => {
      server.close();
      resolve({
        passed: true,
        message: `Port ${port} is available`,
        details: { port },
      });
    });

    server.listen(port);
  });
}

/**
 * AQUI-VR G18 (H-2): Verify ACTIVE_TOOL_DEFINITIONS matches TOOL_DEFINITIONS when
 * staged registration is disabled. Catches cases where a tool is accidentally excluded.
 */
async function checkToolRegistrationParity(): Promise<PreflightResult> {
  const lazy = process.env['LAZY_LOAD_ENTERPRISE'] === 'true' || !!process.env['LAZY_LOAD_TOOLS'];
  if (lazy) {
    return {
      passed: true,
      message: `Staged registration active — ${ACTIVE_TOOL_DEFINITIONS.length}/${TOOL_DEFINITIONS.length} tools active`,
      details: { active: ACTIVE_TOOL_DEFINITIONS.length, total: TOOL_DEFINITIONS.length },
    };
  }
  if (ACTIVE_TOOL_DEFINITIONS.length !== TOOL_DEFINITIONS.length) {
    const activeNames = new Set(ACTIVE_TOOL_DEFINITIONS.map((t) => t.name));
    const missing = TOOL_DEFINITIONS.filter((t) => !activeNames.has(t.name)).map((t) => t.name);
    return {
      passed: false,
      message: `ACTIVE_TOOL_DEFINITIONS (${ACTIVE_TOOL_DEFINITIONS.length}) !== TOOL_DEFINITIONS (${TOOL_DEFINITIONS.length})`,
      fix: `Tools missing from ACTIVE set: ${missing.join(', ')}. Check LAZY_LOAD_TOOLS env var.`,
      details: { active: ACTIVE_TOOL_DEFINITIONS.length, total: TOOL_DEFINITIONS.length, missing },
    };
  }
  return {
    passed: true,
    message: `All ${TOOL_DEFINITIONS.length} tools active`,
    details: { active: ACTIVE_TOOL_DEFINITIONS.length, total: TOOL_DEFINITIONS.length },
  };
}

/**
 * AQUI-VR G23 (M-3): Warn if SERVER_INSTRUCTIONS exceeds the growth threshold.
 * The routing matrix has been extracted to guide://routing-matrix (Session 99).
 * Threshold is set to 50,000 chars — well above the current ~39K — to catch
 * unintentional growth while allowing the intentionally large instruction set.
 * Note: some MCP clients may truncate; critical routing info lives in the
 * guide://routing-matrix resource rather than inline in instructions.
 */
async function checkServerInstructionsLength(): Promise<PreflightResult> {
  const instructions = getServerInstructions();
  const len = instructions.length;
  const WARN_THRESHOLD = 50000;
  if (len > WARN_THRESHOLD) {
    return {
      passed: false,
      message: `SERVER_INSTRUCTIONS is ${len} chars — exceeded growth threshold of ${WARN_THRESHOLD}`,
      fix: 'Extract large static sections (decision tables, examples) to guide:// resources to keep instructions concise.',
      details: { length: len, threshold: WARN_THRESHOLD },
    };
  }
  return {
    passed: true,
    message: `SERVER_INSTRUCTIONS length ${len} chars (within ${WARN_THRESHOLD} limit)`,
    details: { length: len, threshold: WARN_THRESHOLD },
  };
}

/**
 * Check 9 (non-critical): Google API reachability
 *
 * Sends a lightweight HEAD-equivalent request to sheets.googleapis.com.
 * Accepts any HTTP response (including 401/403/404) as proof that the API
 * endpoint is reachable — only a network/DNS failure counts as a warning.
 * Skipped when no credentials are configured.
 */
async function checkGoogleApiReachability(): Promise<PreflightResult> {
  const credentialsPath = process.env['GOOGLE_TOKEN_STORE_PATH'] ?? process.env['CREDENTIALS_PATH'];

  // Skip the check when credentials are not configured — there's nothing to connect to.
  if (!credentialsPath || !existsSync(credentialsPath)) {
    return {
      passed: true,
      message: 'Google API reachability skipped — no credentials configured',
      details: { skipped: true },
    };
  }

  return new Promise((resolve) => {
    const timeoutMs = 5000;
    const req = httpsGet(
      'https://sheets.googleapis.com/v4/spreadsheets/probe_connectivity_check',
      { timeout: timeoutMs },
      (res) => {
        // Any HTTP response means the endpoint is reachable (401/403/404 are all fine)
        resolve({
          passed: true,
          message: `Google Sheets API reachable (HTTP ${res.statusCode})`,
          details: { statusCode: res.statusCode },
        });
        res.resume(); // Drain response body
      }
    );

    req.on('timeout', () => {
      req.destroy();
      resolve({
        passed: false,
        message: `Google Sheets API unreachable — connection timed out after ${timeoutMs}ms`,
        fix: 'Check network connectivity, firewall rules, or proxy settings.',
        details: { timeoutMs },
      });
    });

    req.on('error', (err) => {
      resolve({
        passed: false,
        message: `Google Sheets API unreachable — ${err.message}`,
        fix: 'Check network connectivity. If behind a proxy, set HTTPS_PROXY environment variable.',
        details: { error: err.message, code: (err as NodeJS.ErrnoException).code },
      });
    });
  });
}

/**
 * Run all pre-flight checks
 */
export async function runPreflightChecks(): Promise<PreflightResults> {
  // Skip pre-flight checks if explicitly disabled
  if (process.env['SKIP_PREFLIGHT'] === 'true') {
    logger.warn('Pre-flight checks skipped (SKIP_PREFLIGHT=true)');
    return {
      checks: [],
      criticalFailures: 0,
      warnings: 0,
      failures: [],
      warningList: [],
    };
  }

  const checks: PreflightCheck[] = [
    { name: 'Build Artifacts', critical: true, check: checkBuildArtifacts },
    { name: 'Node.js Version', critical: true, check: checkNodeVersion },
    { name: 'Module Resolution', critical: true, check: checkModuleResolution },
    { name: 'Configuration Validation', critical: true, check: checkConfiguration },
    { name: 'File System Permissions', critical: false, check: checkFileSystemPermissions },
    { name: 'Port Availability', critical: false, check: checkPortAvailability },
    // AQUI-VR G18: ACTIVE_TOOL_DEFINITIONS parity (H-2)
    { name: 'Tool Registration Parity', critical: false, check: checkToolRegistrationParity },
    // AQUI-VR G23: SERVER_INSTRUCTIONS length (M-3)
    { name: 'Server Instructions Length', critical: false, check: checkServerInstructionsLength },
    // Connectivity: Google Sheets API reachable (skipped when no credentials)
    { name: 'Google API Reachability', critical: false, check: checkGoogleApiReachability },
  ];

  const startTime = Date.now();
  const results: Array<PreflightCheck & { result: PreflightResult }> = [];

  for (const check of checks) {
    try {
      const result = await check.check();
      results.push({ ...check, result });

      if (!result.passed) {
        if (check.critical) {
          logger.error(`Pre-flight check failed: ${check.name}`, {
            message: result.message,
            fix: result.fix,
            details: result.details,
          });
        } else {
          logger.warn(`Pre-flight warning: ${check.name}`, {
            message: result.message,
            fix: result.fix,
            details: result.details,
          });
        }
      } else {
        logger.debug(`Pre-flight check passed: ${check.name}`, { details: result.details });
      }
    } catch (error) {
      // Check threw an exception
      const errorResult: PreflightResult = {
        passed: false,
        message: `Check threw exception: ${error instanceof Error ? error.message : String(error)}`,
        fix: 'Review error details and fix underlying issue',
        details: { error: error instanceof Error ? error.stack : String(error) },
      };

      results.push({ ...check, result: errorResult });

      logger.error(`Pre-flight check exception: ${check.name}`, {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
    }
  }

  const duration = Date.now() - startTime;

  const failures = results
    .filter((r) => !r.result.passed && r.critical)
    .map((r) => ({ name: r.name, message: r.result.message, fix: r.result.fix }));

  const warningList = results
    .filter((r) => !r.result.passed && !r.critical)
    .map((r) => ({ name: r.name, message: r.result.message, fix: r.result.fix }));

  const summary: PreflightResults = {
    checks: results,
    criticalFailures: failures.length,
    warnings: warningList.length,
    failures,
    warningList,
  };

  logger.info('Pre-flight checks completed', {
    duration,
    total: results.length,
    passed: results.filter((r) => r.result.passed).length,
    failed: failures.length,
    warnings: warningList.length,
  });

  return summary;
}
