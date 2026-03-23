/**
 * PerSpreadsheetThrottle
 *
 * @purpose Token-bucket rate limiter per spreadsheetId.
 * @category Service
 * @usage Call throttle(spreadsheetId) before every Sheets API call to enforce
 *        Google's guidance of limiting requests per spreadsheet to avoid 503s.
 * @dependencies getEnv (for PER_SPREADSHEET_RPS)
 * @stateful Yes — maintains one TokenBucket per seen spreadsheetId (LRU-capped)
 * @singleton No — instantiate once as a module-level singleton in google-api.ts
 */

import { getEnv } from '../config/env.js';

// ============================================================================
// TOKEN BUCKET (internal, not exported)
// ============================================================================

class TokenBucket {
  private tokens: number;
  private lastRefill: number;
  private readonly rps: number;

  constructor(rps: number) {
    this.rps = rps;
    this.tokens = rps; // start full
    this.lastRefill = Date.now();
  }

  async consume(): Promise<void> {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.rps, this.tokens + elapsed * this.rps);
    this.lastRefill = now;

    if (this.tokens >= 1) {
      this.tokens -= 1;
      return;
    }

    // Wait until a token is available
    const waitMs = ((1 - this.tokens) / this.rps) * 1000;
    await new Promise<void>((resolve) => setTimeout(resolve, waitMs));
    this.tokens = 0;
    this.lastRefill = Date.now();
  }
}

// ============================================================================
// PER-SPREADSHEET THROTTLE
// ============================================================================

/**
 * Token-bucket rate limiter per spreadsheetId.
 * Implements Google's guidance: limit requests per spreadsheet to avoid 503s.
 * Uses LRU eviction (capped at maxEntries) to prevent unbounded memory growth.
 */
export class PerSpreadsheetThrottle {
  private buckets = new Map<string, TokenBucket>();
  private readonly maxEntries: number;

  constructor(maxEntries = 500) {
    this.maxEntries = maxEntries;
  }

  private get rps(): number {
    return getEnv().PER_SPREADSHEET_RPS;
  }

  async throttle(spreadsheetId: string): Promise<void> {
    let bucket = this.buckets.get(spreadsheetId);

    if (!bucket) {
      if (this.buckets.size >= this.maxEntries) {
        // Evict the oldest entry (first key in Map insertion order)
        const oldestKey = this.buckets.keys().next().value;
        if (oldestKey !== undefined) {
          this.buckets.delete(oldestKey);
        }
      }
      bucket = new TokenBucket(this.rps);
      this.buckets.set(spreadsheetId, bucket);
    } else {
      // Refresh recency: delete and re-insert to move to end of insertion order
      this.buckets.delete(spreadsheetId);
      this.buckets.set(spreadsheetId, bucket);
    }

    await bucket.consume();
  }
}
