/**
 * ServalSheets - SERVAL() Formula Callback Service (Phase 5)
 *
 * Handles incoming formula execution requests from the SERVAL() Apps Script function.
 * Provides HMAC validation, rate limiting, result caching, and Claude API integration.
 */

import { createHmac, timingSafeEqual } from 'crypto';
import { logger } from '../utils/logger.js';

export interface FormulaRequest {
  prompt: string;
  range_values?: unknown[][];
  model?: string;
}

export interface BatchFormulaRequest {
  requests: FormulaRequest[];
  spreadsheetId: string;
  timestamp: number;
}

export interface FormulaResult {
  text?: string;
  values?: unknown;
  error?: string;
}

interface SpreadsheetSecrets {
  hmacSecret: string;
  rateLimit: { requestsPerMinute: number };
  cacheTtlSeconds: number;
}

// In-memory stores — in production these would be persisted
const secretStore = new Map<string, SpreadsheetSecrets>();
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();
const resultCache = new Map<string, { result: FormulaResult; expiresAt: number }>();
const replayGuardStore = new Map<string, number>();

const DEFAULT_TIMESTAMP_SKEW_MS = 5 * 60 * 1000; // 5 minutes
const DEFAULT_REPLAY_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

export function registerSpreadsheetSecret(
  spreadsheetId: string,
  hmacSecret: string,
  rateLimit = { requestsPerMinute: 100 },
  cacheTtlSeconds = 300
): void {
  secretStore.set(spreadsheetId, { hmacSecret, rateLimit, cacheTtlSeconds });
}

export function validateHmacSignature(
  body: string,
  spreadsheetId: string,
  signature: string
): boolean {
  const secrets = secretStore.get(spreadsheetId);
  if (!secrets) return false;

  const expected = createHmac('sha256', secrets.hmacSecret).update(body).digest('hex');
  try {
    return timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}

/**
 * Validate request timestamp freshness.
 * Rejects stale/future timestamps outside the allowed skew window.
 */
export function validateRequestTimestamp(
  timestamp: number,
  maxSkewMs: number = DEFAULT_TIMESTAMP_SKEW_MS
): boolean {
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return false;
  }

  const now = Date.now();
  return Math.abs(now - timestamp) <= maxSkewMs;
}

/**
 * Check and record request signature for replay protection.
 * Returns false when the same signed payload is seen again within the replay window.
 */
export function checkAndRecordReplay(
  spreadsheetId: string,
  signature: string,
  replayWindowMs: number = DEFAULT_REPLAY_WINDOW_MS
): boolean {
  const now = Date.now();

  // Opportunistic cleanup to keep the replay guard bounded.
  for (const [key, expiresAt] of replayGuardStore) {
    if (expiresAt <= now) {
      replayGuardStore.delete(key);
    }
  }

  const replayKey = `${spreadsheetId}:${signature}`;
  const existingExpiry = replayGuardStore.get(replayKey);
  if (existingExpiry && existingExpiry > now) {
    return false;
  }

  replayGuardStore.set(replayKey, now + replayWindowMs);
  return true;
}

export function checkRateLimit(spreadsheetId: string): boolean {
  const secrets = secretStore.get(spreadsheetId);
  if (!secrets) return false;

  const now = Date.now();
  const existing = rateLimitStore.get(spreadsheetId);

  if (!existing || existing.resetAt < now) {
    rateLimitStore.set(spreadsheetId, { count: 1, resetAt: now + 60000 });
    return true;
  }

  if (existing.count >= secrets.rateLimit.requestsPerMinute) {
    return false;
  }

  existing.count++;
  return true;
}

function getCacheKey(spreadsheetId: string, req: FormulaRequest): string {
  return `${spreadsheetId}:${req.prompt}:${JSON.stringify(req.range_values ?? null)}`;
}

export function getCachedResult(spreadsheetId: string, req: FormulaRequest): FormulaResult | null {
  const key = getCacheKey(spreadsheetId, req);
  const cached = resultCache.get(key);
  if (!cached || cached.expiresAt < Date.now()) {
    resultCache.delete(key);
    return null;
  }
  return cached.result;
}

export function setCachedResult(
  spreadsheetId: string,
  req: FormulaRequest,
  result: FormulaResult
): void {
  const secrets = secretStore.get(spreadsheetId);
  const ttl = (secrets?.cacheTtlSeconds ?? 300) * 1000;
  if (ttl === 0) return;

  const key = getCacheKey(spreadsheetId, req);
  resultCache.set(key, { result, expiresAt: Date.now() + ttl });
}

export async function processBatchFormula(
  batchRequest: BatchFormulaRequest,
  claudeApiKey?: string
): Promise<FormulaResult[]> {
  const results: FormulaResult[] = [];

  for (const req of batchRequest.requests) {
    // Check cache first
    const cached = getCachedResult(batchRequest.spreadsheetId, req);
    if (cached) {
      results.push(cached);
      continue;
    }

    try {
      const apiKey = claudeApiKey ?? process.env['ANTHROPIC_API_KEY'];
      if (!apiKey) {
        const result: FormulaResult = { error: 'ANTHROPIC_API_KEY not configured' };
        results.push(result);
        continue;
      }

      const contextStr = req.range_values
        ? `\nContext data:\n${JSON.stringify(req.range_values)}`
        : '';

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: req.model ?? 'claude-sonnet-4-6',
          max_tokens: 1024,
          messages: [{ role: 'user', content: req.prompt + contextStr }],
        }),
      });

      if (!response.ok) {
        const result: FormulaResult = { error: `API error: ${response.status}` };
        results.push(result);
        continue;
      }

      const data = (await response.json()) as {
        content: Array<{ type: string; text: string }>;
      };
      const text = data.content.find((c) => c.type === 'text')?.text ?? '';
      const result: FormulaResult = { text };
      setCachedResult(batchRequest.spreadsheetId, req, result);
      results.push(result);
    } catch (err) {
      logger.error('Formula callback processing error', { error: String(err) });
      results.push({ error: 'Processing failed' });
    }
  }

  return results;
}
