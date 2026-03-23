/**
 * Error-Fix Suggester Service
 *
 * Provides intelligent suggestions for fixing common tool call errors.
 * When a tool call fails, this service suggests how to fix the call by providing
 * a corrected tool/action/params combination.
 *
 * Supports 10+ common error patterns with actionable fixes.
 */

export interface SuggestedFix {
  tool: string;
  action: string;
  params: Record<string, unknown>;
  explanation: string;
}

/**
 * Suggest a fix for a given error code and context.
 *
 * @param errorCode - The error code from the error response
 * @param errorMessage - The error message text
 * @param toolName - The tool that produced the error (optional context)
 * @param action - The action that failed (optional context)
 * @param params - The parameters passed to the failed action (optional context)
 * @returns A SuggestedFix object with tool/action/params/explanation, or null if no fix applies
 */
export function suggestFix(
  errorCode: string,
  errorMessage: string,
  toolName?: string,
  action?: string,
  params?: Record<string, unknown>
): SuggestedFix | null {
  // 1. INVALID_RANGE (unbounded) - rewrite range with bounds
  if (
    errorCode === 'INVALID_RANGE' ||
    (errorCode === 'VALIDATION_ERROR' && errorMessage.includes('unbounded'))
  ) {
    const range = params?.['range'] as string | undefined;
    if (range) {
      const parts = range.split('!');
      const lastPart = parts[parts.length - 1] || '';
      // Match patterns like "A:Z" (full column unbounded)
      if (/^[A-Z]+:[A-Z]+$/.test(lastPart)) {
        const sheetPrefix = parts.length > 1 ? `${parts[0]}!` : '';
        const [startCol, endCol] = lastPart.split(':');
        return {
          tool: toolName || 'sheets_data',
          action: action || 'read',
          params: { ...params, range: `${sheetPrefix}${startCol}1:${endCol}1000` },
          explanation: `Range '${range}' is unbounded. Added row bounds 1:1000.`,
        };
      }
    }
  }

  // 2. SHEET_NOT_FOUND - suggest listing sheets with fuzzy-match hint
  if (errorCode === 'SHEET_NOT_FOUND' || errorCode === 'NOT_FOUND') {
    if (errorMessage.toLowerCase().includes('sheet')) {
      // Extract attempted sheet name from error message (e.g. "Sheet 'Sales Data' not found")
      const nameMatch = errorMessage.match(/['"]([^'"]+)['"]/);
      const attemptedName = nameMatch?.[1];

      // Build a targeted explanation covering the most common SHEET_NOT_FOUND causes
      let explanation = 'Sheet not found. List available sheets to find the correct name.';
      if (attemptedName) {
        const hasEmoji = /\p{Emoji_Presentation}/u.test(attemptedName);
        const hasTrailingSpace = attemptedName !== attemptedName.trim();
        const hints: string[] = [];
        if (hasEmoji) {
          hints.push(
            'emoji sheet names must be copied exactly — visually identical emoji can have different Unicode codepoints'
          );
        }
        if (hasTrailingSpace) {
          hints.push('sheet name has leading/trailing whitespace — trim it');
        }
        if (!hasEmoji && !hasTrailingSpace) {
          hints.push('check for wrong case (Sheet names are case-sensitive in the API)');
          hints.push('copy the exact name from sheets_core.list_sheets response');
        }
        explanation = `Sheet '${attemptedName}' not found. ${hints.join('; ')}.`;
      }

      return {
        tool: 'sheets_core',
        action: 'list_sheets',
        params: { spreadsheetId: params?.['spreadsheetId'] as string },
        explanation,
      };
    }
  }

  // 3. SPREADSHEET_NOT_FOUND - suggest listing spreadsheets
  if (errorCode === 'SPREADSHEET_NOT_FOUND') {
    return {
      tool: 'sheets_core',
      action: 'list',
      params: {},
      explanation: 'Spreadsheet not found. List available spreadsheets to find the correct ID.',
    };
  }

  // 4. INVALID_ACTION - suggest scout to understand operations
  if (errorCode === 'INVALID_ACTION' && errorMessage.includes("'")) {
    // Extract attempted action from error message
    const match = errorMessage.match(/'([^']+)'/);
    if (match && params?.['spreadsheetId']) {
      return {
        tool: toolName || 'sheets_analyze',
        action: 'scout',
        params: { spreadsheetId: params['spreadsheetId'] },
        explanation: `Unknown action '${match[1]}'. Use sheets_analyze.scout to understand available operations.`,
      };
    }
  }

  // 5. PERMISSION_DENIED - suggest re-login
  if (
    errorCode === 'PERMISSION_DENIED' ||
    errorCode === 'AUTH_ERROR' ||
    errorCode === 'AUTHENTICATION_ERROR'
  ) {
    return {
      tool: 'sheets_auth',
      action: 'login',
      params: {},
      explanation: 'Permission denied. Re-authenticate to refresh access.',
    };
  }

  // 6. QUOTA_EXCEEDED - suggest batch with smaller size
  if (
    errorCode === 'QUOTA_EXCEEDED' ||
    errorCode === 'RESOURCE_EXHAUSTED' ||
    errorCode === 'RATE_LIMITED'
  ) {
    return {
      tool: toolName || 'sheets_data',
      action: action || 'read',
      params: { ...params, verbosity: 'minimal' },
      explanation:
        'Rate limited. Retry with minimal verbosity or use batch operations to reduce API calls.',
    };
  }

  // 7. VALIDATION_ERROR with missing required param
  if (errorCode === 'VALIDATION_ERROR' && errorMessage.includes('required')) {
    return {
      tool: toolName || 'sheets_data',
      action: action || 'read',
      params: { ...params },
      explanation: `Missing required parameter. Check the schema for ${toolName}.${action} required fields.`,
    };
  }

  // 8. DUPLICATE_SHEET_NAME / already exists
  if (
    (errorMessage.toLowerCase().includes('already exists') &&
      errorMessage.toLowerCase().includes('sheet')) ||
    errorCode === 'DUPLICATE_SHEET_NAME'
  ) {
    const title = params?.['title'] as string;
    if (title) {
      return {
        tool: toolName || 'sheets_core',
        action: action || 'add_sheet',
        params: { ...params, title: `${title} (2)` },
        explanation: `Sheet '${title}' already exists. Suggested alternate name.`,
      };
    }
  }

  // 9. INVALID_CHART_TYPE
  if (errorMessage.toLowerCase().includes('chart type') || errorCode === 'INVALID_CHART_TYPE') {
    if (params?.['spreadsheetId']) {
      return {
        tool: 'sheets_visualize',
        action: 'suggest_chart',
        params: { spreadsheetId: params['spreadsheetId'] },
        explanation:
          'Invalid chart type. Use suggest_chart to get recommended chart types for your data.',
      };
    }
  }

  // 10. RANGE_OVERLAP / merge conflicts
  if (
    errorMessage.toLowerCase().includes('merge') ||
    errorMessage.toLowerCase().includes('overlap') ||
    errorCode === 'RANGE_OVERLAP'
  ) {
    if (params?.['spreadsheetId']) {
      return {
        tool: 'sheets_data',
        action: 'get_merges',
        params: { spreadsheetId: params['spreadsheetId'] },
        explanation: 'Range conflicts with existing merged cells. Inspect current merges first.',
      };
    }
  }

  // 11. ZOD_VALIDATION_ERROR — common schema rejections with actionable hints
  if (
    errorCode === 'VALIDATION_ERROR' ||
    errorCode === 'INVALID_PARAMS' ||
    errorCode === 'ZOD_VALIDATION_ERROR'
  ) {
    // Range format hint: callers often send plain string instead of { a1: string }
    if (errorMessage.includes('range') && errorMessage.includes('Expected object')) {
      return {
        tool: toolName || 'sheets_data',
        action: action || 'read',
        params: { ...params },
        explanation:
          'Range must be an object like { a1: "Sheet1!A1:B10" } or a plain string (auto-converted). ' +
          'Supported formats: { a1: "A1:B10" }, { namedRange: "MyRange" }, { grid: { sheetId, startRow, ... } }. ' +
          'A plain string like "Sheet1!A1:B10" is also accepted and auto-converted.',
      };
    }

    // Missing spreadsheetId
    if (errorMessage.includes('spreadsheetId') && errorMessage.includes('Required')) {
      return {
        tool: 'sheets_core',
        action: 'list',
        params: {},
        explanation:
          'Missing required spreadsheetId. Use sheets_core.list to find available spreadsheets, ' +
          'or use sheets_session.get_active to retrieve the current active spreadsheet.',
      };
    }

    // Missing action field
    if (errorMessage.includes('action') && errorMessage.includes('Invalid discriminator')) {
      return {
        tool: toolName || 'sheets_analyze',
        action: 'scout',
        params: { spreadsheetId: params?.['spreadsheetId'] as string },
        explanation:
          `Invalid or missing "action" field for ${toolName || 'unknown tool'}. ` +
          'Check the tool schema for valid action names. Common pattern: { action: "read", spreadsheetId: "...", range: "..." }.',
      };
    }
  }

  // 12. TIMEOUT / deadline exceeded — suggest retry with smaller scope
  if (
    errorCode === 'TIMEOUT' ||
    errorCode === 'DEADLINE_EXCEEDED' ||
    errorMessage.toLowerCase().includes('timeout') ||
    errorMessage.toLowerCase().includes('deadline')
  ) {
    return {
      tool: toolName || 'sheets_data',
      action: action || 'read',
      params: { ...params, verbosity: 'minimal' },
      explanation:
        'Operation timed out. Reduce scope: use a smaller range, add verbosity:"minimal", ' +
        'or split into multiple smaller requests. For long operations, use tasks/call for background execution.',
    };
  }

  // 13. CIRCULAR_REFERENCE — suggest dependency cycle detection
  if (
    errorCode === 'CIRCULAR_REFERENCE' ||
    errorCode === 'CIRCULAR_DEPENDENCY' ||
    errorMessage.toLowerCase().includes('circular') ||
    errorMessage.toLowerCase().includes('cycle')
  ) {
    return {
      tool: 'sheets_dependencies',
      action: 'detect_cycles',
      params: { spreadsheetId: params?.['spreadsheetId'] as string },
      explanation:
        'Circular reference detected. Use sheets_dependencies.detect_cycles to find the dependency loop, ' +
        'then break the cycle by modifying one of the formulas in the chain.',
    };
  }

  // 14. FORMULA_PARSE_ERROR — suggest formula analysis
  if (
    errorCode === 'FORMULA_ERROR' ||
    errorCode === 'FORMULA_PARSE_ERROR' ||
    errorCode === 'COMPUTE_ERROR' ||
    errorMessage.toLowerCase().includes('invalid formula') ||
    errorMessage.toLowerCase().includes('formula parse')
  ) {
    return {
      tool: 'sheets_analyze',
      action: 'analyze_formulas',
      params: { spreadsheetId: params?.['spreadsheetId'] as string },
      explanation:
        'Formula error detected. Use sheets_analyze.analyze_formulas to diagnose issues. ' +
        'Common causes: missing closing parenthesis, wrong function name, invalid cell reference, or locale-dependent separator (comma vs semicolon).',
    };
  }

  // 15. EDIT_CONFLICT — suggest conflict resolution
  if (
    errorCode === 'EDIT_CONFLICT' ||
    errorCode === 'CONFLICT' ||
    errorCode === 'CONCURRENT_MODIFICATION' ||
    errorMessage.toLowerCase().includes('conflict') ||
    errorMessage.toLowerCase().includes('concurrent')
  ) {
    return {
      tool: 'sheets_quality',
      action: 'resolve_conflict',
      params: { spreadsheetId: params?.['spreadsheetId'] as string },
      explanation:
        'Concurrent edit conflict detected. Use sheets_quality.resolve_conflict to inspect and resolve. ' +
        'Alternatively, use sheets_history.timeline to see recent changes and identify the conflicting edit.',
    };
  }

  // 16. UNSUPPORTED_OPERATION — suggest scout to check sheet type and capabilities
  if (
    errorCode === 'UNSUPPORTED_OPERATION' ||
    errorCode === 'FEATURE_UNAVAILABLE' ||
    errorMessage.toLowerCase().includes('not supported') ||
    errorMessage.toLowerCase().includes('unsupported')
  ) {
    return {
      tool: 'sheets_analyze',
      action: 'scout',
      params: { spreadsheetId: params?.['spreadsheetId'] as string },
      explanation:
        'This operation is not supported on the target sheet. Use sheets_analyze.scout to check the sheet type ' +
        'and available capabilities. Some operations are unavailable on external/linked sheets or shared drive files.',
    };
  }

  // 17. HTTP 5xx / service unavailable — suggest retry or status check
  if (
    errorCode === 'INTERNAL_ERROR' ||
    errorCode === 'SERVICE_UNAVAILABLE' ||
    errorMessage.includes('500') ||
    errorMessage.includes('503') ||
    errorMessage.toLowerCase().includes('service unavailable') ||
    errorMessage.toLowerCase().includes('internal error')
  ) {
    return {
      tool: toolName || 'sheets_data',
      action: action || 'read',
      params: { ...params },
      explanation:
        'Google API returned a server error (5xx). This is usually transient. ' +
        'Retry the same request after a few seconds. If it persists, the Google Sheets API may be experiencing an outage.',
    };
  }

  // 18. PROTECTED_RANGE — suggest listing protected ranges to understand the constraint
  if (
    errorCode === 'PROTECTED_RANGE' ||
    errorMessage.toLowerCase().includes('protected') ||
    errorMessage.toLowerCase().includes('edit access')
  ) {
    return {
      tool: 'sheets_advanced',
      action: 'list_protected_ranges',
      params: { spreadsheetId: params?.['spreadsheetId'] as string },
      explanation:
        'Cell or range is protected. Use sheets_advanced.list_protected_ranges to see what is protected and by whom.',
    };
  }

  // 19. BATCH_UPDATE_ERROR — suggest atomic operations via transactions
  if (
    errorCode === 'BATCH_UPDATE_ERROR' ||
    (errorMessage.toLowerCase().includes('batch') && errorMessage.toLowerCase().includes('error'))
  ) {
    return {
      tool: 'sheets_transaction',
      action: 'begin',
      params: { spreadsheetId: params?.['spreadsheetId'] as string },
      explanation:
        'Batch update failed. Use sheets_transaction.begin to wrap multiple operations atomically for better error handling.',
    };
  }

  // 20. FORMULA_INJECTION_BLOCKED — explain security policy and suggest single quote workaround
  if (
    errorCode === 'FORMULA_INJECTION_BLOCKED' ||
    errorMessage.toLowerCase().includes('formula injection') ||
    (errorMessage.toLowerCase().includes('formula') &&
      errorMessage.toLowerCase().includes('security'))
  ) {
    return {
      tool: toolName || 'sheets_data',
      action: action || 'write',
      params: { ...params },
      explanation:
        "Formula injection blocked for security. If the value should be literal text, prefix it with a single quote: '=text becomes the string =text.",
    };
  }

  // 21. AMBIGUOUS_RANGE — suggest listing sheets to clarify sheet names
  if (
    errorCode === 'AMBIGUOUS_RANGE' ||
    (errorMessage.toLowerCase().includes('ambiguous') &&
      errorMessage.toLowerCase().includes('range'))
  ) {
    return {
      tool: 'sheets_core',
      action: 'list_sheets',
      params: { spreadsheetId: params?.['spreadsheetId'] as string },
      explanation:
        'Ambiguous range reference. Use sheets_core.list_sheets to get exact sheet names, then include the sheet name explicitly in A1 notation (e.g., "Sheet1!A1:B10").',
    };
  }

  // 22. EXPLICIT_RANGE_REQUIRED — suggest full A1 notation with sheet name
  if (
    errorCode === 'EXPLICIT_RANGE_REQUIRED' ||
    (errorMessage.toLowerCase().includes('explicit') &&
      errorMessage.toLowerCase().includes('range'))
  ) {
    return {
      tool: toolName || 'sheets_data',
      action: action || 'read',
      params: { ...params },
      explanation:
        'Explicit range notation required. Use full A1 notation with sheet name: "SheetName!A1:Z100" instead of just "A1:Z100".',
    };
  }

  // 23. PAYLOAD_TOO_LARGE — suggest batch operations to chunk the work
  if (
    errorCode === 'PAYLOAD_TOO_LARGE' ||
    errorMessage.toLowerCase().includes('payload') ||
    errorMessage.toLowerCase().includes('too large') ||
    errorMessage.includes('413')
  ) {
    return {
      tool: 'sheets_composite',
      action: 'batch_operations',
      params: { spreadsheetId: params?.['spreadsheetId'] as string },
      explanation:
        'Payload too large for a single request. Use sheets_composite.batch_operations to split the work into smaller chunks.',
    };
  }

  // 24. TRANSACTION_CONFLICT / TRANSACTION_EXPIRED — suggest starting fresh transaction
  if (
    errorCode === 'TRANSACTION_CONFLICT' ||
    errorCode === 'TRANSACTION_EXPIRED' ||
    (errorMessage.toLowerCase().includes('transaction') &&
      errorMessage.toLowerCase().includes('conflict')) ||
    (errorMessage.toLowerCase().includes('transaction') &&
      errorMessage.toLowerCase().includes('expired'))
  ) {
    return {
      tool: 'sheets_transaction',
      action: 'begin',
      params: { spreadsheetId: params?.['spreadsheetId'] as string },
      explanation:
        'Transaction conflict or expired. Use sheets_transaction.begin to start a fresh atomic transaction.',
    };
  }

  // 25. ELICITATION_UNAVAILABLE — suggest using wizard as alternative
  if (
    errorCode === 'ELICITATION_UNAVAILABLE' ||
    (errorMessage.toLowerCase().includes('elicitation') &&
      errorMessage.toLowerCase().includes('unavailable'))
  ) {
    return {
      tool: 'sheets_confirm',
      action: 'wizard_start',
      params: { title: 'Interactive Setup', description: 'Step-by-step configuration' },
      explanation:
        'Interactive prompt unavailable. Use sheets_confirm.wizard_start for a step-by-step configuration workflow.',
    };
  }

  // 26. CONNECTOR_ERROR — suggest listing connectors to check configuration
  if (
    errorCode === 'CONNECTOR_ERROR' ||
    (errorMessage.toLowerCase().includes('connector') &&
      errorMessage.toLowerCase().includes('error'))
  ) {
    return {
      tool: 'sheets_connectors',
      action: 'list_connectors',
      params: {},
      explanation:
        'Connector error. Use sheets_connectors.list_connectors to check configured connectors and their status.',
    };
  }

  // 27. SNAPSHOT_CREATION_FAILED / SNAPSHOT_RESTORE_FAILED — suggest listing history
  if (
    errorCode === 'SNAPSHOT_CREATION_FAILED' ||
    errorCode === 'SNAPSHOT_RESTORE_FAILED' ||
    (errorMessage.toLowerCase().includes('snapshot') &&
      errorMessage.toLowerCase().includes('failed'))
  ) {
    return {
      tool: 'sheets_history',
      action: 'list',
      params: { spreadsheetId: params?.['spreadsheetId'] as string },
      explanation:
        'Snapshot operation failed. Use sheets_history.list to check the operation history and available recovery points.',
    };
  }

  return null;
}
