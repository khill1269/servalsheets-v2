/**
 * Token bucket rate limiter for Drive API write operations.
 * Drive enforces ~3 req/sec for permissions.create, files.create, files.copy.
 */
export class DriveRateLimiter {
  private tokens = 3;
  private lastRefill = Date.now();
  private readonly maxTokens = 3;
  private readonly refillMs = 1000; // refill 3 tokens per second

  async acquire(): Promise<void> {
    this.refill();
    if (this.tokens > 0) {
      this.tokens--;
      return;
    }
    // Wait for next refill
    const waitMs = this.refillMs - (Date.now() - this.lastRefill);
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, waitMs)));
    this.refill();
    this.tokens = Math.max(0, this.tokens - 1);
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    this.tokens = Math.min(
      this.maxTokens,
      this.tokens + (elapsed / this.refillMs) * this.maxTokens
    );
    this.lastRefill = now;
  }
}

// Singleton for the collaborate handler
export const driveRateLimiter = new DriveRateLimiter();
