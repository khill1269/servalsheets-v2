/**
 * Handler-Schema Alignment Deviations
 *
 * Documents acceptable deviations between handler switch cases and schema actions.
 * All deviations must be explicitly documented with clear justification.
 *
 * Purpose:
 * - Allow legitimate aliases/shortcuts in handlers
 * - Prevent undocumented deviations from accumulating
 * - Provide audit trail for alignment decisions
 *
 * Validation:
 * - scripts/validate-schema-handler-alignment.ts checks against this list
 * - Only DOCUMENTED deviations are accepted
 * - Undocumented deviations cause CI failure
 * - Run `npm run validate:alignment` to check alignment
 * - Included in `npm run verify` pipeline
 *
 * How to Add a New Deviation:
 * 1. Identify the misalignment (run `npm run validate:alignment`)
 * 2. Determine if deviation is legitimate (aliases, backward compat, etc.)
 * 3. Add entry to ACCEPTABLE_DEVIATIONS array with:
 *    - tool: Tool name (without sheets_ prefix)
 *    - reason: Brief explanation
 *    - extraCases/missingCases: Specific case names (no wildcards)
 *    - justification: Detailed technical explanation (>50 chars)
 *    - addedDate: Current date (YYYY-MM-DD)
 *    - reviewedBy: Your name (optional)
 *    - reference: Issue/PR reference (optional)
 * 4. Run `npm run validate:alignment` to verify it passes
 * 5. Run tests: `npm test tests/schemas/handler-deviations.test.ts`
 * 6. Commit with the schema changes
 *
 * Example:
 * {
 *   tool: 'data',
 *   reason: 'Backward compatibility aliases',
 *   extraCases: ['read'], // Maps to read_range
 *   justification: 'Legacy "read" action maintained for backward compatibility with v1.x clients',
 *   addedDate: '2026-02-17',
 * }
 */

export interface HandlerDeviation {
  /** Tool name (without sheets_ prefix, e.g., 'core', 'data') */
  tool: string;

  /** Brief explanation of why deviations exist */
  reason: string;

  /** Handler cases that are NOT in schema enum (aliases, legacy, etc.) */
  extraCases?: string[];

  /** Schema actions that are NOT in handler switch (handled via default, etc.) */
  missingCases?: string[];

  /** Detailed technical justification for deviations */
  justification: string;

  /** Date deviation was documented (YYYY-MM-DD) */
  addedDate: string;

  /** Person who reviewed and approved (optional) */
  reviewedBy?: string;

  /** Issue/PR reference (optional) */
  reference?: string;
}

/**
 * Documented protocol-level deviations that are intentionally retained.
 * These are not schema/handler switch mismatches, but they are tracked in the
 * same file so audits have a single source for sanctioned exceptions.
 */
export interface ProtocolDeviation {
  /** Stable identifier (issue id or short code) */
  id: string;

  /** Protocol area this deviation affects */
  area: 'mcp';

  /** Short behavior label */
  behavior: string;

  /** Expected behavior per specification */
  specExpectation: string;

  /** Current implementation behavior */
  actualBehavior: string;

  /** Why this deviation exists today */
  rationale: string;

  /** How to disable or enforce strict behavior */
  control: string;

  /** Date documented (YYYY-MM-DD) */
  addedDate: string;

  /** Optional issue/PR reference */
  reference?: string;
}

/**
 * Acceptable Handler-Schema Deviations
 *
 * RULES:
 * 1. All deviations must be explicitly listed (no wildcards)
 * 2. Each deviation must have clear justification
 * 3. Date added is required for audit trail
 * 4. Deviations should be reviewed periodically
 */
export const ACCEPTABLE_DEVIATIONS: HandlerDeviation[] = [
  {
    tool: 'core',
    reason: 'User-friendly aliases for common operations',
    extraCases: [
      'copy_to', // Alias for copy_sheet_to
      'hide_sheet', // Alias for update_sheet with hidden=true
      'rename_sheet', // Alias for update_sheet with title=newTitle
      'show_sheet', // Alias for update_sheet with hidden=false
      'unhide_sheet', // Alias for update_sheet with hidden=false
      'update_sheet_properties', // Alias for update_sheet
    ],
    justification: `
These are convenience aliases that map to canonical schema actions:
- copy_to → copy_sheet_to (backward compatibility + shorter name)
- hide_sheet/show_sheet/unhide_sheet → update_sheet (common UX pattern)
- rename_sheet → update_sheet (intuitive naming for LLMs)
- update_sheet_properties → update_sheet (legacy compatibility)

Aliases improve developer experience by providing intuitive operation names
without polluting the schema with redundant action definitions. Handler
internally forwards these to the canonical action implementations.

Pattern: Alias cases call the canonical handler method directly.
Example: case 'hide_sheet': return this.handleUpdateSheet({ ...params, hidden: true });
    `.trim(),
    addedDate: '2026-02-17',
    reviewedBy: 'thomas',
    reference: 'Phase 0 - Handler alignment audit',
  },

  // Add more documented deviations here as discovered
  // Example template:
  // {
  //   tool: 'data',
  //   reason: 'Backward compatibility aliases',
  //   extraCases: ['read' /* maps to read_range */],
  //   justification: 'Legacy read action maps to read_range for backward compatibility',
  //   addedDate: 'YYYY-MM-DD',
  // },

  // NOTE: sheets_collaborate has a schema-design workaround (not a handler deviation).
  // The MCP SDK v1.26.0 bug with z.discriminatedUnion() on large unions means collaborate
  // uses a flat z.object() + refine() instead. There are NO missing or extra handler cases —
  // the handler switch still matches the schema 1-for-1.
  // See: src/schemas/collaborate.ts (workaround comment)
  // See: tests/contracts/collaborate-discriminated-union.test.ts (regression tests)
];

/**
 * Protocol deviations (non-alignment) with explicit operator controls.
 */
export const KNOWN_PROTOCOL_DEVIATIONS: ProtocolDeviation[] = [
  {
    id: 'ISSUE-255',
    area: 'mcp',
    behavior: 'Non-fatal tool failures may keep isError unset',
    specExpectation:
      'Tool failures should set CallToolResult.isError=true so clients can treat the result as an error.',
    actualBehavior:
      'If MCP_NON_FATAL_TOOL_ERRORS is not false and the error code is allowlisted, the response keeps success=false but sets response._meta.nonFatalError=true while leaving isError undefined.',
    rationale:
      'This keeps conversation flow recoverable for expected auth/quota re-auth states where the model can guide the user to remediate and continue.',
    control:
      'Set MCP_NON_FATAL_TOOL_ERRORS=false to enforce strict behavior (isError=true on all failures).',
    addedDate: '2026-02-27',
    reference: 'ISSUE-255',
  },
];

/**
 * Get documented deviation for a tool (if exists)
 */
export function getToolDeviation(tool: string): HandlerDeviation | undefined {
  return ACCEPTABLE_DEVIATIONS.find((d) => d.tool === tool);
}

/**
 * Check if a specific case deviation is documented
 */
export function isCaseDeviationDocumented(tool: string, caseName: string): boolean {
  const deviation = getToolDeviation(tool);
  if (!deviation) return false;

  return (
    deviation.extraCases?.includes(caseName) || deviation.missingCases?.includes(caseName) || false
  );
}

/**
 * Get all tools with documented deviations
 */
export function getToolsWithDeviations(): string[] {
  return ACCEPTABLE_DEVIATIONS.map((d) => d.tool);
}

/**
 * Get a protocol deviation by id.
 */
export function getProtocolDeviation(id: string): ProtocolDeviation | undefined {
  return KNOWN_PROTOCOL_DEVIATIONS.find((d) => d.id === id);
}

/**
 * Validate deviation structure (used in tests)
 */
export function validateDeviation(deviation: HandlerDeviation): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!deviation.tool) {
    errors.push('tool is required');
  }

  if (!deviation.reason) {
    errors.push('reason is required');
  }

  if (!deviation.justification) {
    errors.push('justification is required');
  }

  if (!deviation.addedDate) {
    errors.push('addedDate is required');
  } else if (!/^\d{4}-\d{2}-\d{2}$/.test(deviation.addedDate)) {
    errors.push('addedDate must be in YYYY-MM-DD format');
  }

  if (!deviation.extraCases && !deviation.missingCases) {
    errors.push('at least one of extraCases or missingCases is required');
  }

  if (deviation.extraCases?.length === 0 && deviation.missingCases?.length === 0) {
    errors.push('deviation lists cannot be empty arrays');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
