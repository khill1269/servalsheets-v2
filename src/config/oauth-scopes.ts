/**
 * ServalSheets - Centralized OAuth Scope Configuration
 *
 * Single source of truth for all Google API scopes required by ServalSheets.
 * This ensures consistent OAuth flows and prevents incremental consent issues.
 *
 * @see https://developers.google.com/identity/protocols/oauth2/scopes
 */

/**
 * STANDARD_SCOPES - Recommended scope set for most users
 *
 * This is the DEFAULT scope set for the published ServalSheets app.
 * Uses `drive.file` (sensitive) instead of `drive` (restricted) to:
 * - Avoid Google's restricted scope security assessment ($15K-75K, 4-8 weeks)
 * - Speed up Google app verification (3-5 business days vs 4-6 weeks)
 * - Follow principle of least privilege
 *
 * Features that need broader scopes (sharing, BigQuery, Apps Script)
 * use incremental consent via src/security/incremental-scope.ts.
 */
export const STANDARD_SCOPES = [
  // Core Sheets (read/write)
  'https://www.googleapis.com/auth/spreadsheets',
  // Drive: only files created or opened by this app (sensitive, not restricted)
  'https://www.googleapis.com/auth/drive.file',
  // Drive AppData: template storage in hidden app folder
  'https://www.googleapis.com/auth/drive.appdata',
  // Drive read-only: required for sheets_core.list (drive.files.list) to enumerate all user spreadsheets.
  // RESTRICTED scope — requires Google verification but allows listing all Drive files.
  // Without this, core.list only sees files the app created/opened (drive.file limitation).
  'https://www.googleapis.com/auth/drive.readonly',
  // Drive Labels read-only: required for sheets_collaborate.label_list
  'https://www.googleapis.com/auth/drive.labels.readonly',
] as const;

/**
 * FULL_ACCESS_SCOPES - Complete scope set for power users
 *
 * Includes ALL scopes for every ServalSheets feature. This set includes
 * RESTRICTED scopes (drive, cloud-platform) which require Google's
 * most rigorous verification process including third-party security assessment.
 *
 * Use this ONLY if you:
 * - Need sharing/collaboration features (requires full drive scope)
 * - Need BigQuery Connected Sheets (requires bigquery + cloud-platform)
 * - Need Apps Script automation (requires script.* scopes)
 * - Are using your own GCP project with completed verification
 *
 * Enable via: OAUTH_SCOPE_MODE=full
 */
export const FULL_ACCESS_SCOPES = [
  // Core Sheets & Drive
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive', // RESTRICTED — requires security assessment
  'https://www.googleapis.com/auth/drive.readonly', // RESTRICTED — full read access to all Drive files
  'https://www.googleapis.com/auth/drive.appdata',

  // BigQuery (for sheets_bigquery tool)
  'https://www.googleapis.com/auth/bigquery',
  'https://www.googleapis.com/auth/cloud-platform',

  // Apps Script (for sheets_appsscript tool)
  'https://www.googleapis.com/auth/script.projects',
  'https://www.googleapis.com/auth/script.deployments',
  'https://www.googleapis.com/auth/script.processes',
  'https://www.googleapis.com/auth/script.external_request',

  // Drive Labels (for sheets_collaborate.label_list, label_apply, label_remove)
  'https://www.googleapis.com/auth/drive.labels.readonly',
  'https://www.googleapis.com/auth/drive.labels',

  // Drive Activity (for WHO/WHEN attribution in sheets_history.timeline)
  'https://www.googleapis.com/auth/drive.activity.readonly',
] as const;

/**
 * MINIMAL_SCOPES - Bare minimum for basic spreadsheet operations
 *
 * Use this ONLY if you need to minimize permissions.
 * Many features (sharing, templates, BigQuery, Apps Script) will NOT work.
 */
export const MINIMAL_SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive.file',
] as const;

/**
 * READONLY_SCOPES - Read-only access for analysis/reporting
 *
 * Use this for read-only analysis tools or reporting systems.
 */
export const READONLY_SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets.readonly',
  'https://www.googleapis.com/auth/drive.readonly',
] as const;

/**
 * Get the recommended scope set for ServalSheets
 *
 * Returns STANDARD_SCOPES by default (uses drive.file, avoids restricted scopes).
 * This ensures faster Google verification and follows least-privilege.
 *
 * To get full scopes, set OAUTH_SCOPE_MODE=full in environment.
 */
export function getRecommendedScopes(): readonly string[] {
  return getConfiguredScopes();
}

/**
 * Get scopes based on environment or configuration
 *
 * Deployment-aware defaults:
 * - self-hosted (default): Uses 'full' scopes - all actions work
 * - saas: Uses 'standard' scopes - ~85% of actions, faster verification
 *
 * Explicit OAUTH_SCOPE_MODE takes precedence over DEPLOYMENT_MODE.
 *
 * Set OAUTH_SCOPE_MODE=full for all features including sharing & BigQuery.
 * Set DEPLOYMENT_MODE=saas for fast Google verification (3-5 days).
 */
export function getConfiguredScopes(): readonly string[] {
  // Explicit scope mode takes precedence (only if non-empty)
  const explicitMode = process.env['OAUTH_SCOPE_MODE'];
  if (explicitMode && explicitMode.trim() !== '') {
    return getScopesByMode(explicitMode);
  }

  // Deployment mode determines default
  // self-hosted: Full features (backwards compatible, all actions)
  // saas: Fast verification (standard scopes, ~85% of actions + incremental consent)
  const deploymentMode = process.env['DEPLOYMENT_MODE'] ?? 'self-hosted';
  const defaultMode = deploymentMode === 'saas' ? 'standard' : 'full';

  return getScopesByMode(defaultMode);
}

/**
 * Get scope set by mode name
 *
 * @internal Used by getConfiguredScopes
 */
function getScopesByMode(mode: string): readonly string[] {
  switch (mode) {
    case 'minimal':
      return MINIMAL_SCOPES;
    case 'readonly':
      return READONLY_SCOPES;
    case 'full':
      return FULL_ACCESS_SCOPES;
    case 'standard':
    default:
      return STANDARD_SCOPES;
  }
}

/**
 * Scope descriptions for user consent screen
 */
export const SCOPE_DESCRIPTIONS: Record<string, string> = {
  'https://www.googleapis.com/auth/spreadsheets':
    'Create, view, and edit Google Sheets spreadsheets',
  'https://www.googleapis.com/auth/drive':
    'View, edit, create, and delete all your Google Drive files (required for sharing and collaboration)',
  'https://www.googleapis.com/auth/drive.file':
    'View and manage Google Drive files created or opened with this app',
  'https://www.googleapis.com/auth/drive.appdata':
    'View and manage its own configuration data in your Google Drive (for templates)',
  'https://www.googleapis.com/auth/bigquery':
    'View and manage data in Google BigQuery (for Connected Sheets)',
  'https://www.googleapis.com/auth/cloud-platform':
    'View and manage data across Google Cloud services (required for BigQuery export)',
  'https://www.googleapis.com/auth/script.projects':
    'Create and update Google Apps Script projects',
  'https://www.googleapis.com/auth/script.deployments': 'Manage Apps Script deployments',
  'https://www.googleapis.com/auth/script.processes': 'View Apps Script processes and executions',
  'https://www.googleapis.com/auth/script.external_request':
    'Allow Apps Script to make external HTTP requests',
  'https://www.googleapis.com/auth/spreadsheets.readonly': 'View your Google Sheets spreadsheets',
  'https://www.googleapis.com/auth/drive.readonly': 'View your Google Drive files',
  'https://www.googleapis.com/auth/drive.labels.readonly':
    'View Drive Labels applied to files (for label_list)',
  'https://www.googleapis.com/auth/drive.labels':
    'View and manage Drive Labels on files (for label_list, label_apply, label_remove)',
};

/**
 * Validate that current scopes include all required scopes
 */
export function validateScopes(
  currentScopes: string[],
  requiredScopes: readonly string[]
): {
  valid: boolean;
  missing: string[];
} {
  const missing = requiredScopes.filter((scope) => !currentScopes.includes(scope));
  return {
    valid: missing.length === 0,
    missing,
  };
}

/**
 * Format scopes for OAuth authorization URL
 */
export function formatScopesForAuth(scopes: readonly string[]): string {
  return scopes.join(' ');
}
