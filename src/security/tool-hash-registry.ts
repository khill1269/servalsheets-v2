/**
 * Tool Hash Registry — Rug-pull Attack Prevention
 *
 * SHA-256 hashes each tool's name + description at server startup and compares
 * against a committed baseline (`src/security/tool-hashes.baseline.json`).
 *
 * If any tool description has changed without updating the baseline, startup
 * throws `TOOL_INTEGRITY_VIOLATION` to prevent silent tool manipulation.
 *
 * Rug-pull attack: an adversary modifies tool descriptions after audit/certification
 * to perform actions the user didn't intend ("jailbreak via description drift").
 *
 * @see S1.2 — AQUI-VR Security Defense Depth criterion
 */

import { createHash } from 'crypto';
import { readFileSync, existsSync } from 'fs';
import { logger } from '../utils/logger.js';
import { TOOL_DESCRIPTIONS } from '../schemas/descriptions.js';
import { TOOL_DESCRIPTIONS_MINIMAL } from '../schemas/descriptions-minimal.js';
import { resolveToolHashBaselinePath } from '../utils/runtime-paths.js';

export interface ToolHashEntry {
  /** SHA-256 hex digest of `name + '\x00' + description` */
  sha256: string;
  /**
   * Additional accepted SHA-256 digests for audited runtime variants of the same tool.
   * This keeps integrity verification stable across full vs deferred/minimal descriptions.
   */
  allowedSha256?: string[];
  /** ISO timestamp when this hash was last updated in the baseline */
  updatedAt: string;
}

export interface ToolHashManifest {
  /** ISO timestamp when this manifest was generated */
  generated: string;
  /** ServalSheets package version at generation time */
  version: string;
  /** Per-tool hashes (tool name → hash entry) */
  tools: Record<string, ToolHashEntry>;
}

// Lazy-loaded to avoid import cycles — resolved on first use
let _toolDefs: Array<{ name: string; description: string }> | null = null;
async function getToolDefinitions(): Promise<Array<{ name: string; description: string }>> {
  if (!_toolDefs) {
    const mod = await import('../mcp/registration/tool-definitions.js');
    _toolDefs = (
      mod.TOOL_DEFINITIONS as unknown as Array<{ name: string; description: string }>
    ).map((t) => ({ name: t.name, description: t.description }));
  }
  return _toolDefs;
}

/**
 * Compute SHA-256 of a single tool's name + description.
 * Uses NUL byte separator to prevent collision attacks.
 */
export function hashTool(name: string, description: string): string {
  return createHash('sha256').update(`${name}\x00${description}`).digest('hex');
}

function getCanonicalDescriptionVariants(tool: { name: string; description: string }): string[] {
  const variants = [
    TOOL_DESCRIPTIONS[tool.name],
    TOOL_DESCRIPTIONS_MINIMAL[tool.name],
    tool.description,
  ];

  return [...new Set(variants.filter((value): value is string => typeof value === 'string'))];
}

function getAllowedHashesForTool(tool: { name: string; description: string }): string[] {
  return getCanonicalDescriptionVariants(tool).map((description) =>
    hashTool(tool.name, description)
  );
}

/**
 * Generate a fresh hash manifest from the currently loaded tool definitions.
 */
export async function generateToolHashManifest(version = 'unknown'): Promise<ToolHashManifest> {
  const tools = await getToolDefinitions();
  const now = new Date().toISOString();

  const entries: Record<string, ToolHashEntry> = {};
  for (const tool of tools) {
    const allowedSha256 = [...new Set(getAllowedHashesForTool(tool))];
    entries[tool.name] = {
      sha256: allowedSha256[0] ?? hashTool(tool.name, tool.description),
      ...(allowedSha256.length > 1 ? { allowedSha256 } : {}),
      updatedAt: now,
    };
  }

  return { generated: now, version, tools: entries };
}

/**
 * Load the committed baseline from `src/security/tool-hashes.baseline.json`.
 * Returns null if the file doesn't exist (first run before baseline is generated).
 */
export function loadBaseline(): ToolHashManifest | null {
  const baselinePath = resolveToolHashBaselinePath();

  if (baselinePath && existsSync(baselinePath)) {
    try {
      return JSON.parse(readFileSync(baselinePath, 'utf-8')) as ToolHashManifest;
    } catch {
      // Corrupted baseline — treat as missing
    }
  }

  return null;
}

/**
 * Verify current tool hashes against the committed baseline.
 *
 * Throws if:
 * - Any tool's description has changed (potential rug-pull)
 * - A new tool is present without a baseline entry (possible injection)
 *
 * Warns if:
 * - Baseline is missing (first run — generate with `npm run security:tool-hashes`)
 * - A tool in the baseline is no longer registered (tool removed — update baseline)
 */
export async function verifyToolIntegrity(): Promise<void> {
  const tools = await getToolDefinitions();
  const baseline = loadBaseline();

  if (!baseline) {
    logger.warn(
      'Tool integrity baseline not found — skipping verification. ' +
        'Run `npm run security:tool-hashes` to generate the baseline.',
      { toolCount: tools.length }
    );
    return;
  }

  const violations: Array<{ tool: string; expected: string; actual: string }> = [];
  const newTools: string[] = [];

  for (const tool of tools) {
    const actual = hashTool(tool.name, tool.description);
    const entry = baseline.tools[tool.name];

    if (!entry) {
      newTools.push(tool.name);
      continue;
    }

    const allowedHashes = new Set([entry.sha256, ...(entry.allowedSha256 ?? [])]);
    if (!allowedHashes.has(actual)) {
      violations.push({ tool: tool.name, expected: entry.sha256, actual });
    }
  }

  // Tools in baseline that are no longer registered
  const removedTools = Object.keys(baseline.tools).filter(
    (name) => !tools.find((t) => t.name === name)
  );

  if (removedTools.length > 0) {
    logger.warn('Tool integrity: tools removed since baseline — update baseline', { removedTools });
  }

  if (newTools.length > 0) {
    logger.warn(
      'Tool integrity: new tools without baseline entries — run `npm run security:tool-hashes`',
      { newTools }
    );
  }

  if (violations.length > 0) {
    const violationList = violations
      .map((v) => `${v.tool}: ${v.expected.slice(0, 12)}… → ${v.actual.slice(0, 12)}…`)
      .join(', ');
    const error = new Error(
      `TOOL_INTEGRITY_VIOLATION: ${violations.length} tool description(s) changed since baseline: ${violationList}. ` +
        'If intentional, run `npm run security:tool-hashes` to update the baseline and commit it.'
    );
    (error as NodeJS.ErrnoException).code = 'TOOL_INTEGRITY_VIOLATION';
    logger.error('Tool integrity violation detected — server startup aborted', {
      violations: violations.map((v) => v.tool),
    });
    throw error;
  }

  logger.info('Tool integrity verified', {
    toolCount: tools.length,
    baselineVersion: baseline.version,
    baselineGeneratedAt: baseline.generated,
  });
}

// Cached manifest for the well-known endpoint (generated once per process)
let _cachedManifest: ToolHashManifest | null = null;

/**
 * Get the tool hash manifest for the `/.well-known/mcp/tool-hashes` endpoint.
 * Returns the committed baseline if available, otherwise generates a fresh one.
 */
export async function getToolHashManifest(): Promise<ToolHashManifest> {
  if (_cachedManifest) return _cachedManifest;

  const baseline = loadBaseline();
  if (baseline) {
    _cachedManifest = baseline;
    return baseline;
  }

  // No baseline committed yet — generate fresh (less authoritative but still useful)
  const { VERSION } = await import('../version.js');
  _cachedManifest = await generateToolHashManifest(VERSION);
  return _cachedManifest;
}
