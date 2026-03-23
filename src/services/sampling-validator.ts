/**
 * ServalSheets - Sampling Output Validator
 *
 * Provides Zod-based validation for structured JSON outputs from MCP Sampling calls.
 * When validation fails, returns null so handlers can gracefully degrade.
 *
 * @module services/sampling-validator
 */

import { z } from 'zod';
import { logger } from '../utils/logger.js';

// ============================================================================
// Output schemas for each high-value sampling call site
// ============================================================================

export const SamplingOutputSchemas = {
  suggest_format: z.object({
    suggestions: z
      .array(
        z.object({
          description: z.string(),
          range: z.string(),
          formatType: z.string(),
          rationale: z.string().optional(),
        })
      )
      .min(1),
  }),

  model_scenario: z.object({
    narrative: z.string().min(10),
    impacts: z
      .array(
        z.object({
          cell: z.string(),
          delta: z.number(),
        })
      )
      .optional()
      .default([]),
    riskLevel: z.enum(['low', 'medium', 'high']),
    affectedCount: z.number().optional(),
  }),

  diff_revisions: z.object({
    summary: z.string().min(5),
    changes: z
      .array(
        z.object({
          cell: z.string(),
          before: z.unknown(),
          after: z.unknown(),
        })
      )
      .optional()
      .default([]),
    likelyCause: z.string().optional(),
  }),

  comment_add_reply: z.object({
    reply: z.string().min(1),
    tone: z.enum(['professional', 'friendly', 'technical']).optional(),
  }),

  find_replace_estimate: z.object({
    estimatedReplacements: z.number().int().min(0),
    confidence: z.number().min(0).max(1).optional(),
    patterns: z.array(z.string()).optional(),
  }),
};

export type SamplingOutputKey = keyof typeof SamplingOutputSchemas;

/**
 * Validate a sampling output string against a known schema.
 *
 * Returns the parsed/validated object on success, or null on parse/validation failure.
 * Failures are logged at warn level and never throw — callers should gracefully degrade.
 */
export function validateSamplingOutput<K extends SamplingOutputKey>(
  key: K,
  raw: string
): z.infer<(typeof SamplingOutputSchemas)[K]> | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    return SamplingOutputSchemas[key].parse(parsed) as z.infer<(typeof SamplingOutputSchemas)[K]>;
  } catch (err) {
    logger.warn('Sampling output failed schema validation', {
      key,
      error: err instanceof Error ? err.message : String(err),
      rawPreview: raw.slice(0, 200),
    });
    return null;
  }
}
