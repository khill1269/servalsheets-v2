/**
 * Shared mutation safety checks.
 *
 * Centralizes formula-injection guardrails for all mutation entry points by
 * scanning normalized request payloads for dangerous exfiltration formulas.
 */

import { isLikelyMutationAction } from './write-lock-middleware.js';
import { logger } from '../utils/logger.js';

const DANGEROUS_FORMULA_PATTERN =
  /^[=+\-@].*(?:IMPORTDATA|IMPORTRANGE|IMPORTFEED|IMPORTHTML|IMPORTXML|GOOGLEFINANCE|QUERY)\s*\(/i;

const FORMULA_CANDIDATE_KEYS = new Set(['values', 'replacement', 'formula', 'formulaValue', 'content']);

export interface MutationSafetyViolation {
  path: string;
  preview: string;
}

function previewFormula(value: string): string {
  return value.length <= 60 ? value : `${value.slice(0, 57)}...`;
}

function hasFormulaPassthroughSafety(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;

  const safety = (value as Record<string, unknown>)['safety'];
  if (typeof safety !== 'object' || safety === null) return false;

  return (safety as Record<string, unknown>)['sanitizeFormulas'] === false;
}

function scanFormulaCandidate(
  value: unknown,
  path: string,
  visited: WeakSet<object>,
  depth: number
): MutationSafetyViolation | null {
  if (depth > 12 || value == null) return null;

  if (typeof value === 'string') {
    if (DANGEROUS_FORMULA_PATTERN.test(value)) {
      return { path, preview: previewFormula(value) };
    }
    return null;
  }

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const violation = scanFormulaCandidate(value[i], `${path}[${i}]`, visited, depth + 1);
      if (violation) return violation;
    }
    return null;
  }

  if (typeof value === 'object') {
    if (visited.has(value)) return null;
    visited.add(value);

    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      const violation = scanFormulaCandidate(entry, `${path}.${key}`, visited, depth + 1);
      if (violation) return violation;
    }
  }

  return null;
}

function scanMutationRequest(
  value: unknown,
  path: string,
  parentKey: string | undefined,
  visited: WeakSet<object>,
  depth: number
): MutationSafetyViolation | null {
  if (depth > 12 || value == null) return null;

  if (hasFormulaPassthroughSafety(value)) {
    return null;
  }

  if (parentKey && FORMULA_CANDIDATE_KEYS.has(parentKey)) {
    return scanFormulaCandidate(value, path, visited, depth + 1);
  }

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const violation = scanMutationRequest(
        value[i],
        `${path}[${i}]`,
        parentKey,
        visited,
        depth + 1
      );
      if (violation) return violation;
    }
    return null;
  }

  if (typeof value === 'object') {
    if (visited.has(value)) return null;
    visited.add(value);

    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      const violation = scanMutationRequest(entry, `${path}.${key}`, key, visited, depth + 1);
      if (violation) return violation;
    }
  }

  return null;
}

/**
 * Detect dangerous formulas in mutation payloads.
 *
 * Returns first violation found, or null when payload passes safety checks.
 */
export function detectMutationSafetyViolation(
  normalizedArgs: Record<string, unknown>
): MutationSafetyViolation | null {
  const request = normalizedArgs['request'];
  if (!request || typeof request !== 'object') return null;

  const req = request as Record<string, unknown>;
  const action = req['action'];
  if (typeof action !== 'string' || !isLikelyMutationAction(action)) return null;
  if (hasFormulaPassthroughSafety(req)) return null;

  if (process.env['SERVAL_ALLOW_FORMULA_PASSTHROUGH'] === 'true') {
    if (process.env['NODE_ENV'] === 'production') {
      throw new Error(
        'SERVAL_ALLOW_FORMULA_PASSTHROUGH cannot be enabled in production. ' +
          'This flag disables formula injection protection and is not permitted in production environments.'
      );
    }
    const action =
      typeof (normalizedArgs['request'] as Record<string, unknown>)?.['action'] === 'string'
        ? (normalizedArgs['request'] as Record<string, unknown>)['action']
        : 'unknown';
    logger.warn('Formula injection scanning BYPASSED via SERVAL_ALLOW_FORMULA_PASSTHROUGH', {
      action,
      spreadsheetId: (normalizedArgs['request'] as Record<string, unknown>)?.['spreadsheetId'],
    });
    return null;
  }

  return scanMutationRequest(req, 'request', undefined, new WeakSet<object>(), 0);
}
