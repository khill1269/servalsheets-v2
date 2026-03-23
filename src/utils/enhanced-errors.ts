/**
 * ServalSheets - Enhanced Error Context
 *
 * Provides enhanced error messages with suggested fixes and context.
 */

import type { ErrorDetail } from '../schemas/shared.js';

export interface ErrorSuggestion {
  title: string;
  steps: string[];
  suggestedTools?: string[];
}

/**
 * Enhanced error with suggested fixes and resource links (Quick Win #2)
 */
export function enhanceError(
  code: string,
  message: string,
  context?: Record<string, unknown>
): ErrorDetail {
  const suggestions = getErrorSuggestions(code, context);

  return {
    code: code as ErrorDetail['code'],
    message,
    retryable: isRetryable(code),
    details: context,
    resolution: suggestions.title,
    resolutionSteps: suggestions.steps,
    suggestedTools: suggestions.suggestedTools,
    fixableVia: getFixableVia(code, context),
    resources: getErrorResources(code),
  };
}

/**
 * Get suggested fixes for error code
 */
function getErrorSuggestions(code: string, context?: Record<string, unknown>): ErrorSuggestion {
  const range = context?.['range'] as string | undefined;
  const spreadsheetId = context?.['spreadsheetId'] as string | undefined;
  const sheetName = context?.['sheetName'] as string | undefined;
  const sheetId = context?.['sheetId'] as number | string | undefined;
  const operation = context?.['operation'] as string | undefined;
  const matches = context?.['matches'] as string[] | undefined;
  const suggestedFix = context?.['suggestedFix'] as string | undefined;

  switch (code) {
    case 'RANGE_NOT_FOUND':
      return {
        title: 'Range not found - Check sheet name and cell references',
        steps: [
          '1. Verify sheet name spelling (case-sensitive)',
          `2. List all sheets: sheets_core action="get" spreadsheetId="${spreadsheetId || '<ID>'}"`,
          '3. Check range format: "SheetName!A1:D10" (include sheet name and !)',
          '4. Try semantic range: {"semantic":{"sheet":"Sales","column":"Revenue"}}',
          range ? `5. Current range: "${range}" - is this correct?` : '',
        ].filter(Boolean),
        suggestedTools: ['sheets_core', 'sheets_data'],
      };

    case 'SHEET_NOT_FOUND':
      return {
        title: 'Sheet not found - Verify sheet name or ID',
        steps: [
          `1. List sheets: sheets_core action="list_sheets" spreadsheetId="${spreadsheetId || '<ID>'}"`,
          sheetName
            ? `2. Sheet name requested: "${sheetName}" (case-sensitive)`
            : '2. Verify sheet name is exact (case-sensitive)',
          sheetId !== undefined
            ? `3. Sheet ID requested: ${sheetId}`
            : '3. Verify sheetId is correct (numeric gid)',
          '4. Confirm the sheet was not deleted or renamed',
        ].filter(Boolean),
        suggestedTools: ['sheets_core'],
      };

    case 'SPREADSHEET_NOT_FOUND':
      return {
        title: 'Spreadsheet not found - Verify ID and access',
        steps: [
          `1. Check spreadsheet ID format (alphanumeric, 44 chars typical)`,
          `2. Open URL: https://docs.google.com/spreadsheets/d/${spreadsheetId || '<ID>'}`,
          '3. Confirm you have access or request sharing from the owner',
          '4. Check if the spreadsheet was deleted or moved to trash',
        ],
        suggestedTools: ['sheets_core', 'sheets_collaborate'],
      };

    case 'AUTH_REQUIRED':
      return {
        title: 'Authentication required - Complete OAuth first',
        steps: [
          '1. Check auth status: sheets_auth action="status"',
          '2. Start login flow: sheets_auth action="login"',
          '3. Complete OAuth consent in the browser',
          '4. Retry the original operation',
        ],
        suggestedTools: ['sheets_auth'],
      };

    case 'PERMISSION_DENIED':
      return {
        title: 'Insufficient permissions - Grant additional access',
        steps: [
          '1. Check current auth: sheets_auth action="status"',
          '2. Re-authenticate: sheets_auth action="login"',
          '3. Grant required permissions in browser',
          '4. If sharing: Check spreadsheet permissions (sheets_collaborate action="share_list")',
          '5. If still failing: Request owner to share with your account',
        ],
        suggestedTools: ['sheets_auth', 'sheets_collaborate'],
      };

    case 'QUOTA_EXCEEDED':
      return {
        title: 'API quota exceeded - Reduce request rate',
        steps: [
          '1. Wait 60 seconds before retrying',
          '2. Use batch operations: sheets_data action="read_multiple" (saves 80% quota)',
          '3. Use transactions: sheets_transaction (batches multiple ops into 1 API call)',
          '4. Check quota: sheets_auth action="status"',
          '5. Avoid polling - use event-driven updates instead',
        ],
        suggestedTools: ['sheets_data', 'sheets_transaction', 'sheets_auth'],
      };

    case 'AMBIGUOUS_RANGE':
      return {
        title: 'Ambiguous range - Choose a single match',
        steps: [
          '1. Specify a single column or exact A1 range',
          matches ? `2. Matching columns: ${matches.join(', ')}` : '',
          suggestedFix ? `3. ${suggestedFix}` : '',
        ].filter(Boolean),
        suggestedTools: ['sheets_analyze', 'sheets_data'],
      };

    case 'INVALID_RANGE':
      return {
        title: 'Invalid range format - Use correct A1 notation',
        steps: [
          '1. Valid formats: "A1:D10", "Sheet1!A1:D10", "Sheet1!A:A" (column), "Sheet1!1:1" (row)',
          '2. Invalid formats: "A1-D10", "A1..D10", "SheetName A1:D10"',
          '3. Include sheet name before !: "Sales!A1:D10"',
          '4. Alternative: Use semantic ranges: {"semantic":{"column":"Revenue"}}',
          range ? `5. Your range: "${range}" - check for typos` : '',
        ].filter(Boolean),
        suggestedTools: ['sheets_data', 'sheets_core'],
      };

    case 'NOT_FOUND':
      return {
        title: 'Spreadsheet not found - Verify ID and access',
        steps: [
          '1. Check spreadsheet ID format (44 chars, alphanumeric)',
          `2. Get ID from URL: docs.google.com/spreadsheets/d/{ID}/...`,
          '3. Verify access: sheets_core action="get" (will fail if no access)',
          '4. List accessible spreadsheets: sheets_core action="list"',
          '5. If deleted: Check trash or restore from version history',
        ],
        suggestedTools: ['sheets_core', 'sheets_collaborate'],
      };

    case 'ELICITATION_UNAVAILABLE':
      return {
        title: 'Client does not support MCP Elicitation',
        steps: [
          '1. Update Claude Desktop to latest version (elicitation requires v0.7.0+)',
          '2. Alternative: Use dry-run to preview: {"safety":{"dryRun":true}}',
          '3. Manual confirmation: Ask user to review plan in chat before executing',
          '4. Check capabilities: sheets_auth action="status"',
        ],
        suggestedTools: ['sheets_auth', 'sheets_quality'],
      };

    case 'SAMPLING_UNAVAILABLE':
      return {
        title: 'Client does not support MCP Sampling',
        steps: [
          '1. Update Claude Desktop to latest version (sampling requires v0.7.0+)',
          '2. Alternative: Use sheets_quality for deterministic checks',
          '3. For formula work: Use sheets_analyze with useAI=false or write formulas manually',
          '4. Check capabilities: sheets_auth action="status"',
        ],
        suggestedTools: ['sheets_auth', 'sheets_quality', 'sheets_analyze'],
      };

    case 'NO_DATA':
      return {
        title: 'No data found in range',
        steps: [
          '1. Verify range has data: sheets_data action="read"',
          '2. Check sheet name is correct',
          '3. Expand range if needed',
          range ? `4. Current range: "${range}"` : '',
          '5. Use sheets_core action="get" to see all sheet dimensions',
        ].filter(Boolean),
        suggestedTools: ['sheets_data', 'sheets_core', 'sheets_analyze'],
      };

    case 'TRANSACTION_TIMEOUT':
      return {
        title: 'Transaction took too long',
        steps: [
          '1. Reduce operations per transaction (max 50 recommended)',
          '2. Split into multiple smaller transactions',
          '3. Check if operations are complex (avoid heavy formulas)',
          '4. Transaction best practices: sheets_transaction description',
        ],
        suggestedTools: ['sheets_transaction'],
      };

    case 'PARSE_ERROR':
      return {
        title: 'Failed to parse response',
        steps: [
          '1. Retry operation (may be transient LLM formatting issue)',
          '2. Simplify request (reduce data size, clearer instructions)',
          '3. Check MCP version compatibility',
          operation ? `4. Operation: ${operation}` : '',
        ].filter(Boolean),
        suggestedTools: ['sheets_auth'],
      };

    case 'INTERNAL_ERROR':
      return {
        title: 'Internal server error',
        steps: [
          '1. Check server logs for details',
          '2. Verify operation parameters are valid',
          '3. Try simpler operation to isolate issue',
          '4. Check recent changes to codebase',
          '5. Report to developers if persistent',
        ],
        suggestedTools: ['sheets_auth'],
      };

    case 'RATE_LIMIT_EXCEEDED':
      return {
        title: 'Too many requests - Circuit breaker active',
        steps: [
          '1. Wait 10 seconds for circuit breaker to reset',
          '2. Reduce request frequency',
          '3. Use batch operations to reduce request count',
          '4. Circuit breaker auto-retries with exponential backoff',
        ],
        suggestedTools: ['sheets_data', 'sheets_transaction'],
      };

    case 'INVALID_ARGUMENT':
      return {
        title: 'Invalid argument to Google API',
        steps: [
          '1. Check error message for specific field that failed',
          '2. Common issues:',
          '   - BAR charts: series must target BOTTOM_AXIS (use COLUMN for vertical bars)',
          '   - Range without sheet name: Use "Sheet1!A1:D10" not "A1:D10"',
          '   - Invalid sheetId: Get from sheets_core action="list_sheets"',
          '3. Verify IDs match existing objects (sheets, charts, named ranges)',
          '4. Check schema description for field constraints',
        ],
        suggestedTools: ['sheets_core', 'sheets_visualize'],
      };

    case 'VALIDATION_FAILED':
      return {
        title: 'Input validation failed',
        steps: [
          '1. Check the "action" parameter is valid for this tool',
          '2. Ensure all required parameters are provided',
          '3. Verify "spreadsheetId" is a valid 44-character string',
          '4. Range format: "SheetName!A1:D10" (include sheet name with !)',
          '5. Use sheets_auth action="status" to verify connection',
        ],
        suggestedTools: ['sheets_auth'],
      };

    case 'ACTION_REQUIRED':
      return {
        title: 'Missing required "action" parameter',
        steps: [
          '1. Every tool call MUST include an "action" parameter',
          '2. Example: {"action":"read", "spreadsheetId":"...", "range":"..."}',
          '3. Check tool description for valid action names',
          '4. Common actions: read, write, get, create, list_sheets',
        ],
        suggestedTools: ['sheets_auth'],
      };

    // Startup error codes
    case 'BUILD_REQUIRED':
      return {
        title: (context?.['resolution'] as string) || 'Run build command to compile TypeScript',
        steps: (context?.['resolutionSteps'] as string[]) || [
          '1. Run: npm run build',
          '2. Verify dist/cli.js exists',
          '3. Check for build errors',
          '4. Retry starting the server',
        ],
      };

    case 'DEPENDENCY_MISSING':
      return {
        title: (context?.['resolution'] as string) || 'Install dependencies',
        steps: (context?.['resolutionSteps'] as string[]) || [
          '1. Run: npm install',
          '2. Verify package.json exists',
          '3. Retry starting the server',
        ],
      };

    case 'FILE_NOT_FOUND':
      return {
        title: (context?.['resolution'] as string) || 'Check file paths and run build',
        steps: (context?.['resolutionSteps'] as string[]) || [
          '1. Run: npm run build',
          '2. Verify .env file exists',
          '3. Check file permissions',
          '4. Retry starting the server',
        ],
      };

    case 'PORT_IN_USE':
      return {
        title:
          (context?.['resolution'] as string) || 'Use a different port or stop conflicting process',
        steps: (context?.['resolutionSteps'] as string[]) || [
          '1. Find process using port: lsof -ti:3000',
          '2. Kill process or use different port',
          '3. Retry starting the server',
        ],
      };

    case 'CONFIG_INVALID':
    case 'INVALID_CONFIG':
      return {
        title: (context?.['resolution'] as string) || 'Fix configuration errors',
        steps: (context?.['resolutionSteps'] as string[]) || [
          '1. Check environment variables',
          '2. Verify configuration format',
          '3. Retry starting the server',
        ],
      };

    case 'REDIS_CONNECTION_FAILED':
      return {
        title: (context?.['resolution'] as string) || 'Start Redis or use development mode',
        steps: (context?.['resolutionSteps'] as string[]) || [
          '1. Check if Redis is running: redis-cli ping',
          '2. Start Redis: redis-server',
          '3. Or set NODE_ENV=development to skip Redis',
          '4. Retry starting the server',
        ],
      };

    default:
      return {
        title: 'Error occurred - See details',
        steps: [
          '1. Check error message for specific details',
          '2. Verify input parameters are correct',
          '3. Try operation in dry-run mode: {"safety":{"dryRun":true}}',
          '4. Check tool description for correct usage',
          `5. Error code: ${code}`,
        ],
        suggestedTools: ['sheets_auth', 'sheets_analyze'],
      };
  }
}

/**
 * Determine if error is retryable
 */
function isRetryable(code: string): boolean {
  const retryableCodes = [
    'QUOTA_EXCEEDED',
    'RATE_LIMIT_EXCEEDED',
    'PARSE_ERROR',
    'INTERNAL_ERROR',
    'TRANSACTION_TIMEOUT',
  ];
  return retryableCodes.includes(code);
}

/**
 * Get automated recovery tool/action for error
 */
function getFixableVia(code: string, context?: Record<string, unknown>): ErrorDetail['fixableVia'] {
  const spreadsheetId = context?.['spreadsheetId'] as string | undefined;
  const range = context?.['range'] as string | undefined;

  switch (code) {
    case 'AUTH_REQUIRED':
      // Auth required → login
      return {
        tool: 'sheets_auth',
        action: 'login',
      };

    case 'PERMISSION_DENIED':
      // Permission denied → re-authenticate to grant additional permissions
      return {
        tool: 'sheets_auth',
        action: 'login',
      };

    case 'SHEET_NOT_FOUND':
      // Sheet not found → list sheets to see available sheets
      if (spreadsheetId) {
        return {
          tool: 'sheets_core',
          action: 'list_sheets',
          params: { spreadsheetId },
        };
      }
      return {
        tool: 'sheets_core',
        action: 'list_sheets',
      };

    case 'SPREADSHEET_NOT_FOUND':
      // Spreadsheet not found → list accessible spreadsheets
      return {
        tool: 'sheets_core',
        action: 'list',
      };

    case 'RANGE_NOT_FOUND':
    case 'INVALID_RANGE':
      // Range issues → get spreadsheet to see sheet names and structure
      if (spreadsheetId) {
        return {
          tool: 'sheets_core',
          action: 'get',
          params: { spreadsheetId },
        };
      }
      return undefined; // no suggestion for this error

    case 'NO_DATA':
      // No data → read range to verify it exists
      if (spreadsheetId && range) {
        return {
          tool: 'sheets_data',
          action: 'read',
          params: { spreadsheetId, range },
        };
      }
      return undefined; // no suggestion for this error

    case 'NOT_FOUND':
      // Generic not found → list accessible spreadsheets
      return {
        tool: 'sheets_core',
        action: 'list',
      };

    case 'VALIDATION_FAILED':
    case 'INVALID_ARGUMENT':
      // Validation errors → re-read spreadsheet structure to understand schema
      if (spreadsheetId) {
        return {
          tool: 'sheets_core',
          action: 'get',
          params: { spreadsheetId },
        };
      }
      return undefined; // OK: no context to suggest a fix

    case 'ACTION_REQUIRED':
      // Action required → use wizard to complete missing params
      return {
        tool: 'sheets_confirm',
        action: 'wizard_start',
        params: { title: 'Complete required action' },
      };

    case 'INTERNAL_ERROR':
      // Internal errors → context-aware: read spreadsheet if available, otherwise no suggestion
      if (spreadsheetId) {
        return {
          tool: 'sheets_core',
          action: 'get',
          params: { spreadsheetId },
        };
      }
      return undefined; // OK: no automated fix for generic internal errors

    case 'AMBIGUOUS_RANGE':
      // Ambiguous range → analyze sheet to see column structure
      if (spreadsheetId) {
        return {
          tool: 'sheets_analyze',
          action: 'analyze_sheet',
          params: { spreadsheetId },
        };
      }
      return undefined; // no suggestion for this error

    case 'PARSE_ERROR':
      // Parse error → analyze data to understand structure
      if (spreadsheetId && range) {
        return {
          tool: 'sheets_analyze',
          action: 'analyze_data',
          params: { spreadsheetId, range },
        };
      }
      return undefined;

    case 'TRANSACTION_TIMEOUT':
      // Transaction timeout → retry the operation
      // Note: Client should implement retry logic
      return undefined;

    case 'QUOTA_EXCEEDED':
    case 'RATE_LIMIT_EXCEEDED':
      // Quota/rate limit → wait and retry (not automatically fixable)
      // Note: Client should implement backoff strategy
      return undefined;

    case 'ELICITATION_UNAVAILABLE':
      // Elicitation unavailable → use wizard alternative via sheets_confirm
      return {
        tool: 'sheets_confirm',
        action: 'wizard_start',
        params: {
          title: 'Confirm operation',
        },
      };

    case 'SAMPLING_UNAVAILABLE':
      // Missing MCP Sampling → cannot be fixed automatically
      return undefined;

    case 'OPERATION_FAILED':
      // Operation failed → retry with minimal verbosity to reduce payload
      if (spreadsheetId) {
        return {
          tool: 'sheets_core',
          action: 'get',
          params: { spreadsheetId },
        };
      }
      return undefined; // OK: Explicit empty — no fix action available without spreadsheetId

    case 'SERVICE_NOT_INITIALIZED':
      // Service not initialized → check auth status and re-login
      return {
        tool: 'sheets_auth',
        action: 'login',
      };

    case 'COMPUTE_ERROR':
      // Compute error → re-read source data to verify inputs
      if (spreadsheetId && range) {
        return {
          tool: 'sheets_data',
          action: 'read',
          params: { spreadsheetId, range },
        };
      }
      return undefined;

    default:
      // No automated fix available
      return undefined;
  }
}

/**
 * Get resource links for error code (Quick Win #2)
 */
function getErrorResources(code: string): Array<{ uri: string; description: string }> | undefined {
  const resourceMap: Record<string, Array<{ uri: string; description: string }>> = {
    SHEET_NOT_FOUND: [
      {
        uri: 'servalsheets://decisions/find-sheet',
        description: 'Decision tree for finding sheets',
      },
      {
        uri: 'servalsheets://reference/sheet-naming',
        description: 'Sheet naming conventions',
      },
    ],
    RANGE_NOT_FOUND: [
      {
        uri: 'servalsheets://reference/a1-notation',
        description: 'A1 notation syntax guide',
      },
      {
        uri: 'servalsheets://decisions/find-range',
        description: 'How to locate ranges in sheets',
      },
    ],
    SPREADSHEET_NOT_FOUND: [
      {
        uri: 'servalsheets://decisions/find-spreadsheet',
        description: 'How to verify spreadsheet access',
      },
    ],
    AUTH_REQUIRED: [
      {
        uri: 'servalsheets://reference/authentication',
        description: 'OAuth authentication guide',
      },
      {
        uri: 'servalsheets://decisions/auth-flow',
        description: 'Authentication troubleshooting',
      },
    ],
    PERMISSION_DENIED: [
      {
        uri: 'servalsheets://decisions/request-access',
        description: 'How to request spreadsheet access',
      },
      {
        uri: 'servalsheets://reference/permissions',
        description: 'Google Sheets permission levels',
      },
    ],
    QUOTA_EXCEEDED: [
      {
        uri: 'servalsheets://reference/api-limits',
        description: 'Google Sheets API quota limits',
      },
      {
        uri: 'servalsheets://decisions/optimize-requests',
        description: 'How to reduce API calls',
      },
    ],
    RATE_LIMIT: [
      {
        uri: 'servalsheets://reference/rate-limiting',
        description: 'Rate limit policies and quota limits',
      },
    ],
    RATE_LIMIT_EXCEEDED: [
      {
        uri: 'servalsheets://reference/rate-limiting',
        description: 'Rate limit policies and quota limits',
      },
    ],
    INVALID_PARAMS: [
      {
        uri: 'servalsheets://decisions/parameter-validation',
        description: 'Parameter validation guide',
      },
    ],
    VALIDATION_ERROR: [
      {
        uri: 'servalsheets://reference/validation-rules',
        description: 'Data validation rules',
      },
    ],
    DATA_VALIDATION_ERROR: [
      {
        uri: 'servalsheets://reference/data-types',
        description: 'Cell data type requirements',
      },
    ],
    OUT_OF_BOUNDS: [
      {
        uri: 'servalsheets://reference/sheet-dimensions',
        description: 'Sheet size limits',
      },
    ],
  };

  return resourceMap[code];
}

/**
 * Create enhanced error response
 */
export function createEnhancedError(
  code: string,
  message: string,
  context?: Record<string, unknown>
): { success: false; error: ErrorDetail } {
  return {
    success: false,
    error: enhanceError(code, message, context),
  };
}

/**
 * Enhance startup errors with actionable fixes
 *
 * Converts raw Node.js/system errors into user-friendly messages with
 * clear resolution steps. Covers common startup failure scenarios:
 * - MODULE_NOT_FOUND (missing build or dependencies)
 * - ENOENT (missing files/directories)
 * - EACCES (permission denied)
 * - EADDRINUSE (port already in use)
 * - Invalid configuration (ENCRYPTION_KEY, Redis, etc.)
 */
export function enhanceStartupError(error: unknown): ErrorDetail {
  const err = error instanceof Error ? error : new Error(String(error));

  // MODULE_NOT_FOUND - most common startup error
  if (err.message.includes('Cannot find module') || err.message.includes('MODULE_NOT_FOUND')) {
    // Check if it's missing dist/cli.js or dist/server.js
    if (
      err.message.includes('dist/cli.js') ||
      err.message.includes('dist/server.js') ||
      err.message.includes('dist/')
    ) {
      return enhanceError('BUILD_REQUIRED', 'Missing compiled files - project not built', {
        module: 'dist/',
        resolution: 'Run build command to compile TypeScript',
        resolutionSteps: [
          '1. Run: npm run build',
          '2. Verify dist/cli.js exists: ls -la dist/cli.js',
          '3. Check for build errors in output',
          '4. Retry starting the server',
        ],
        details: { originalError: err.message },
      });
    }

    // Missing dependency in node_modules
    const moduleMatch = err.message.match(/Cannot find module '(.+?)'/);
    const moduleName = moduleMatch ? moduleMatch[1] : 'unknown';

    return enhanceError('DEPENDENCY_MISSING', `Missing required dependency: ${moduleName}`, {
      module: moduleName,
      resolution: 'Install dependencies',
      resolutionSteps: [
        '1. Run: npm install',
        '2. Verify package.json exists',
        '3. Check node_modules directory was created',
        '4. If errors persist, try: rm -rf node_modules package-lock.json && npm install',
        '5. Retry starting the server',
      ],
      details: { originalError: err.message },
    });
  }

  // ENOENT - File/directory not found
  if (err.message.includes('ENOENT') || err.message.includes('no such file')) {
    return enhanceError('FILE_NOT_FOUND', 'Required file or directory not found', {
      resolution: 'Check file paths and run build',
      resolutionSteps: [
        '1. Run: npm run build',
        '2. Verify .env file exists (copy from .env.example if needed)',
        '3. Check file permissions: ls -la',
        '4. Ensure working directory is project root',
        '5. Retry starting the server',
      ],
      details: { originalError: err.message },
    });
  }

  // EACCES - Permission denied
  if (err.message.includes('EACCES') || err.message.includes('permission denied')) {
    return enhanceError('PERMISSION_DENIED', 'Permission denied - cannot access required files', {
      resolution: 'Grant file permissions',
      resolutionSteps: [
        '1. Check ownership: ls -la ~/.servalsheets/',
        '2. Grant permissions: chmod -R 755 ~/.servalsheets/',
        '3. If running as different user, check file ownership',
        '4. Retry starting the server',
      ],
      details: { originalError: err.message },
    });
  }

  // EADDRINUSE - Port already in use (HTTP mode)
  if (err.message.includes('EADDRINUSE') || err.message.includes('address already in use')) {
    const portMatch = err.message.match(/port (\d+)|:(\d+)/);
    const port = portMatch ? portMatch[1] || portMatch[2] : '3000';

    return enhanceError('PORT_IN_USE', `Port ${port} is already in use`, {
      port,
      resolution: 'Use a different port or stop conflicting process',
      resolutionSteps: [
        `1. Find process using port: lsof -ti:${port}`,
        `2. Kill process: kill $(lsof -ti:${port})`,
        `3. Or use different port: servalsheets --http --port 8080`,
        '4. Verify port is free: lsof -ti:8080 (should return nothing)',
      ],
      details: { originalError: err.message },
    });
  }

  // ENCRYPTION_KEY validation errors (from lifecycle.ts)
  if (err.message.includes('ENCRYPTION_KEY')) {
    return enhanceError('CONFIG_INVALID', 'Invalid encryption key configuration', {
      resolution: 'Set valid encryption key',
      resolutionSteps: [
        '1. Generate key: openssl rand -hex 32',
        '2. Add to .env file: ENCRYPTION_KEY=<generated-key>',
        '3. Verify length is 64 hex characters (32 bytes)',
        '4. In production, use secure key management (AWS Secrets Manager, etc.)',
        '5. Retry starting the server',
      ],
      details: { originalError: err.message },
    });
  }

  // Redis connection errors
  if (
    err.message.includes('Redis') ||
    err.message.includes('ECONNREFUSED') ||
    err.message.includes('redis')
  ) {
    return enhanceError('REDIS_CONNECTION_FAILED', 'Cannot connect to Redis server', {
      resolution: 'Start Redis or disable Redis requirement',
      resolutionSteps: [
        '1. Check Redis is running: redis-cli ping',
        '2. Start Redis: redis-server',
        '3. Or set NODE_ENV=development to use in-memory storage',
        '4. Verify REDIS_URL in .env: redis://localhost:6379',
        '5. Check Redis is accessible from your network',
      ],
      details: { originalError: err.message },
    });
  }

  // OAuth configuration errors
  if (
    err.message.includes('OAUTH') ||
    err.message.includes('OAuth') ||
    err.message.includes('CLIENT_ID') ||
    err.message.includes('CLIENT_SECRET')
  ) {
    return enhanceError('OAUTH_CONFIG_INVALID', 'Invalid OAuth configuration', {
      resolution: 'Set valid OAuth credentials',
      resolutionSteps: [
        '1. Get credentials from Google Cloud Console',
        '2. Create OAuth 2.0 Client ID (Web application type)',
        '3. Add to .env: OAUTH_CLIENT_ID=<your-client-id>',
        '4. Add to .env: OAUTH_CLIENT_SECRET=<your-client-secret>',
        '5. Add to .env: SESSION_SECRET=<random-string>',
        '6. Configure redirect URIs in Google Cloud Console',
      ],
      details: { originalError: err.message },
    });
  }

  // Session store errors
  if (err.message.includes('session') && err.message.includes('production')) {
    return enhanceError('SESSION_STORE_REQUIRED', 'Production requires persistent session store', {
      resolution: 'Configure Redis session store',
      resolutionSteps: [
        '1. Set SESSION_STORE_TYPE=redis in .env',
        '2. Set REDIS_URL=redis://your-redis-host:6379 in .env',
        '3. Ensure Redis is running and accessible',
        '4. Or for local testing only: ALLOW_MEMORY_SESSIONS=true',
      ],
      details: { originalError: err.message },
    });
  }

  // DNS / Network errors during startup (ENOTFOUND, ETIMEDOUT, EAI_AGAIN)
  if (
    err.message.includes('ENOTFOUND') ||
    err.message.includes('getaddrinfo') ||
    err.message.includes('ETIMEDOUT') ||
    err.message.includes('EAI_AGAIN')
  ) {
    return enhanceError(
      'NETWORK_ERROR',
      'Cannot reach Google APIs — check your internet connection',
      {
        resolution: 'Verify network connectivity',
        resolutionSteps: [
          '1. Check your internet connection (try opening a webpage)',
          '2. If on VPN, verify it allows access to googleapis.com',
          '3. Try flushing DNS cache: sudo dscacheutil -flushcache (macOS)',
          '4. Wait a few seconds and retry starting the server',
          '5. If persistent, check firewall/proxy settings for sheets.googleapis.com',
        ],
        details: { originalError: err.message },
      }
    );
  }

  // Google API errors during startup
  if (
    err.message.includes('google') ||
    err.message.includes('Google') ||
    err.message.includes('GOOGLE_APPLICATION_CREDENTIALS')
  ) {
    return enhanceError('GOOGLE_AUTH_FAILED', 'Google API authentication failed', {
      resolution: 'Configure Google service account or OAuth',
      resolutionSteps: [
        '1. Set GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json',
        '2. Or configure OAuth with OAUTH_CLIENT_ID/OAUTH_CLIENT_SECRET',
        '3. Verify service account has required permissions',
        '4. Check service account JSON file is valid',
        '5. Ensure APIs are enabled in Google Cloud Console',
      ],
      details: { originalError: err.message },
    });
  }

  // Generic startup error with helpful fallback
  return enhanceError('STARTUP_FAILED', err.message || 'Unknown startup error', {
    resolution: 'Check error details and verify configuration',
    resolutionSteps: [
      '1. Check all environment variables in .env file',
      '2. Run: npm run build (ensure project is built)',
      '3. Run: npm install (ensure dependencies installed)',
      '4. Run: npm run verify (runs full test suite)',
      '5. Check logs for detailed error information',
      '6. If error persists, report issue with full stack trace',
    ],
    details:
      process.env['NODE_ENV'] === 'production'
        ? undefined
        : {
            // C2: Omit stack, nodeVersion, platform from API responses — log internally only
            originalError: err.message,
          },
  });
}
