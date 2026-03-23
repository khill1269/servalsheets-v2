/**
 * Idempotency Key Generation
 *
 * Utilities for generating and validating idempotency keys.
 * Keys are UUIDs or SHA-256 hashes depending on use case.
 *
 * @category Utils
 */

import { createHash, randomUUID } from 'crypto';
import { logger } from './logger.js';

/**
 * Generate a random idempotency key (UUID v4)
 *
 * Used when client doesn't provide a key.
 *
 * @returns Random UUID v4 string
 *
 * @example
 * ```typescript
 * const key = generateIdempotencyKey();
 * // => "550e8400-e29b-41d4-a716-446655440000"
 * ```
 */
export function generateIdempotencyKey(): string {
  return randomUUID();
}

/**
 * Generate request fingerprint for collision detection
 *
 * Creates a deterministic hash of request parameters to verify
 * that the same idempotency key is being used for the same request.
 *
 * @param tool - Tool name
 * @param action - Action name
 * @param params - Request parameters (will be stringified)
 * @returns SHA-256 hash of normalized request
 *
 * @example
 * ```typescript
 * const fingerprint = generateRequestFingerprint(
 *   'sheets_data',
 *   'write',
 *   { spreadsheetId: '123', range: 'A1', values: [[1, 2]] }
 * );
 * ```
 */
export function generateRequestFingerprint(
  tool: string,
  action: string,
  params: Record<string, unknown>
): string {
  // Normalize params by sorting keys
  const normalized = {
    tool,
    action,
    params: sortObjectKeys(params),
  };

  const hash = createHash('sha256');
  hash.update(JSON.stringify(normalized));
  return hash.digest('hex');
}

/**
 * Validate idempotency key format
 *
 * Keys must be:
 * - 16-128 characters
 * - Alphanumeric + hyphens only
 * - Not all same character (防止 "aaaaaaa" type keys)
 *
 * @param key - Key to validate
 * @returns True if valid, false otherwise
 *
 * @example
 * ```typescript
 * validateIdempotencyKey('550e8400-e29b-41d4-a716-446655440000'); // true
 * validateIdempotencyKey('abc'); // false (too short)
 * validateIdempotencyKey('aaaaaaaaaaaa'); // false (all same char)
 * ```
 */
export function validateIdempotencyKey(key: string): boolean {
  // Length check
  if (key.length < 16 || key.length > 128) {
    return false;
  }

  // Character set check (alphanumeric + hyphen)
  if (!/^[a-zA-Z0-9-]+$/.test(key)) {
    return false;
  }

  // Reject keys with all same character (防止 low-entropy keys)
  const uniqueChars = new Set(key.replace(/-/g, ''));
  if (uniqueChars.size < 2) {
    return false;
  }

  return true;
}

/**
 * Normalize idempotency key (lowercase, trim)
 *
 * @param key - Raw key from client
 * @returns Normalized key
 */
export function normalizeIdempotencyKey(key: string): string {
  return key.trim().toLowerCase();
}

/**
 * Sort object keys recursively for deterministic fingerprinting
 *
 * @param obj - Object to sort
 * @returns New object with sorted keys
 */
function sortObjectKeys(obj: unknown): unknown {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(sortObjectKeys);
  }

  const sorted: Record<string, unknown> = {};
  const keys = Object.keys(obj).sort();

  for (const key of keys) {
    sorted[key] = sortObjectKeys((obj as Record<string, unknown>)[key]);
  }

  return sorted;
}

/**
 * Extract idempotency key from HTTP headers
 *
 * Supports multiple header names for compatibility:
 * - X-Idempotency-Key (primary)
 * - Idempotency-Key (alternative)
 *
 * @param headers - HTTP headers object
 * @returns Normalized key or undefined if not present
 */
export function extractIdempotencyKeyFromHeaders(
  headers: Record<string, string | string[] | undefined>
): string | undefined {
  const key =
    headers['x-idempotency-key'] ||
    headers['idempotency-key'] ||
    headers['X-Idempotency-Key'] ||
    headers['Idempotency-Key'];

  if (!key) {
    // OK: No idempotency key header present — request proceeds without idempotency
    return undefined; // no key header present
  }

  const keyStr = Array.isArray(key) ? key[0] : key;
  if (!keyStr) {
    // OK: Idempotency key header present but empty — treated as absent
    return undefined; // empty key header
  }

  const normalized = normalizeIdempotencyKey(keyStr);

  if (!validateIdempotencyKey(normalized)) {
    logger.debug('Invalid idempotency key rejected', { key: normalized.substring(0, 20) });
    return undefined;
  }

  return normalized;
}
