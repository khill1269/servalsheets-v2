/**
 * Schema Optimization Configuration
 *
 * Controls how verbose tool schemas are when sent to Claude.
 * Reducing verbosity saves context window tokens.
 *
 * @example
 * ```bash
 * # Minimal mode (saves ~15,000 tokens)
 * SCHEMA_MODE=minimal npm start
 *
 * # Full mode (default, best for learning)
 * SCHEMA_MODE=full npm start
 * ```
 */

export type SchemaMode = 'full' | 'minimal' | 'compact';

/**
 * Current schema optimization mode
 *
 * - `full`: All descriptions, examples, and hints (default)
 * - `minimal`: Essential descriptions only (~40% smaller)
 * - `compact`: No inline descriptions (~60% smaller)
 */
export const SCHEMA_MODE: SchemaMode = (process.env['SCHEMA_MODE'] as SchemaMode) || 'full';

/**
 * Tools to lazy-load (not included in initial tools/list)
 * These are loaded on first use via tool discovery
 */
export const LAZY_LOAD_TOOLS: string[] = process.env['LAZY_LOAD_TOOLS']?.split(',') || [];

/**
 * Default lazy-load tools (enterprise features)
 * Set LAZY_LOAD_ENTERPRISE=true to enable
 */
export const ENTERPRISE_TOOLS = [
  'sheets_bigquery',
  'sheets_appsscript',
  'sheets_templates',
  'sheets_webhook',
  'sheets_dependencies',
];

/**
 * Whether to lazy-load enterprise tools
 */
export const LAZY_LOAD_ENTERPRISE = process.env['LAZY_LOAD_ENTERPRISE'] === 'true';

/**
 * Get list of tools to exclude from initial registration
 */
export function getLazyLoadTools(): string[] {
  const tools = [...LAZY_LOAD_TOOLS];
  if (LAZY_LOAD_ENTERPRISE) {
    tools.push(...ENTERPRISE_TOOLS);
  }
  return tools;
}
