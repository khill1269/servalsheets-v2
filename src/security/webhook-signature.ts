/**
 * ServalSheets - Webhook Signature Verification
 *
 * Implements HMAC-SHA256 signature verification for webhook callbacks.
 * Provides utilities for:
 * - Generating secure webhook secrets
 * - Signing outgoing webhook payloads
 * - Verifying incoming webhook signatures
 * - Timing-safe constant comparison
 *
 * Security Features:
 * - Uses Node.js built-in crypto module
 * - HMAC-SHA256 for cryptographic strength
 * - Constant-time comparison to prevent timing attacks
 * - Base64url encoding for safe transmission
 * - Configurable secret minimum length (default: 32 bytes)
 *
 * @category Security
 */

import { randomBytes, createHmac, timingSafeEqual } from 'crypto';
import { logger } from '../utils/logger.js';
import { ConfigError, ValidationError } from '../core/errors.js';

/**
 * Webhook signature configuration
 */
export interface WebhookSignatureConfig {
  /** Algorithm for HMAC signature (default: 'sha256') */
  algorithm: 'sha256' | 'sha512';
  /** Minimum secret length in bytes (default: 32) */
  minSecretLength: number;
  /** Maximum secret length in bytes (default: 256) */
  maxSecretLength: number;
  /** Signature encoding (default: 'hex') */
  encoding: 'hex' | 'base64' | 'base64url';
  /** Header prefix for signature (default: 'sha256=') */
  signaturePrefix: string;
}

/**
 * Default webhook signature configuration
 */
const DEFAULT_CONFIG: WebhookSignatureConfig = {
  algorithm: 'sha256',
  minSecretLength: 32,
  maxSecretLength: 256,
  encoding: 'hex',
  signaturePrefix: 'sha256=',
};

/**
 * Webhook signature utilities
 */
export class WebhookSignatureManager {
  private config: WebhookSignatureConfig;

  constructor(config?: Partial<WebhookSignatureConfig>) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
    };

    // Validate configuration
    if (this.config.minSecretLength < 16) {
      throw new ConfigError('minSecretLength must be at least 16 bytes', 'minSecretLength');
    }
    if (this.config.maxSecretLength < this.config.minSecretLength) {
      throw new ConfigError('maxSecretLength must be >= minSecretLength', 'maxSecretLength');
    }
  }

  /**
   * Generate a secure webhook secret
   *
   * Generates a cryptographically secure random secret suitable for HMAC signing.
   * Default length is 32 bytes (256 bits), providing strong security.
   *
   * @param lengthBytes - Length of the secret in bytes (default: 32)
   * @returns Base64url-encoded secret string
   * @throws {Error} If length is outside configured bounds
   *
   * @example
   * // Generate a 32-byte secret:
   * // const manager = new WebhookSignatureManager();
   * // const secret = manager.generateSecret();
   */
  generateSecret(lengthBytes: number = 32): string {
    if (lengthBytes < this.config.minSecretLength || lengthBytes > this.config.maxSecretLength) {
      throw new ValidationError(
        `Secret length must be between ${this.config.minSecretLength} and ${this.config.maxSecretLength} bytes`,
        'lengthBytes',
        `${this.config.minSecretLength}-${this.config.maxSecretLength}`
      );
    }

    const randomBytes_ = randomBytes(lengthBytes);
    return this.encodeSecret(randomBytes_);
  }

  /**
   * Encode secret bytes to string format
   *
   * @internal
   */
  private encodeSecret(bytes: Buffer): string {
    switch (this.config.encoding) {
      case 'hex':
        return bytes.toString('hex');
      case 'base64':
        return bytes.toString('base64');
      case 'base64url':
        return bytes.toString('base64url');
      default:
        throw new ValidationError(
          `Unsupported encoding: ${this.config.encoding}`,
          'encoding',
          'hex | base64 | base64url'
        );
    }
  }

  /**
   * Decode secret string to bytes
   *
   * @internal
   */
  private decodeSecret(secret: string): Buffer {
    try {
      switch (this.config.encoding) {
        case 'hex':
          return Buffer.from(secret, 'hex');
        case 'base64':
          return Buffer.from(secret, 'base64');
        case 'base64url':
          return Buffer.from(secret, 'base64url');
        default:
          throw new ValidationError(
            `Unsupported encoding: ${this.config.encoding}`,
            'encoding',
            'hex | base64 | base64url'
          );
      }
    } catch (error) {
      throw new ValidationError(
        `Failed to decode secret: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'secret',
        'base64url-encoded string'
      );
    }
  }

  /**
   * Sign a webhook payload with HMAC-SHA256
   *
   * Creates a cryptographic signature of the webhook payload using the
   * provided secret. The signature can be sent to webhook consumers to
   * verify payload authenticity.
   *
   * @param payload - The webhook payload (will be JSON stringified if object)
   * @param secret - The webhook secret (base64url-encoded)
   * @returns Signature string with algorithm prefix (e.g., 'sha256=...')
   * @throws {Error} If signature generation fails
   *
   * @example
   * // Sign a payload:
   * // const manager = new WebhookSignatureManager();
   * // const secret = manager.generateSecret();
   * // const payload = { deliveryId: 'delivery_123', timestamp: new Date().toISOString() };
   * // const signature = manager.signPayload(payload, secret);
   * // Result: 'sha256=abc123def456...'
   */
  signPayload(payload: string | object, secret: string): string {
    try {
      // Normalize payload to string
      const payloadStr = typeof payload === 'string' ? payload : JSON.stringify(payload);

      // Decode secret from configured encoding
      const secretBytes = this.decodeSecret(secret);

      // Create HMAC signature
      const signature = createHmac(this.config.algorithm, secretBytes)
        .update(payloadStr, 'utf8')
        .digest(this.config.encoding);

      // Return with algorithm prefix
      return `${this.config.signaturePrefix}${signature}`;
    } catch (error) {
      logger.error('Failed to sign webhook payload', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Verify a webhook signature
   *
   * Verifies that a received webhook signature matches the payload signature.
   * Uses constant-time comparison to prevent timing attacks.
   *
   * IMPORTANT: Always use this method to verify incoming webhooks. Never
   * perform manual string comparison as it's vulnerable to timing attacks.
   *
   * @param payload - The webhook payload (must be identical to signed version)
   * @param secret - The webhook secret (base64url-encoded)
   * @param signature - The signature from webhook headers
   * @param expectedAlgorithm - Optional expected algorithm (default: 'sha256')
   * @returns true if signature is valid, false otherwise
   *
   * @example
   * // In your webhook endpoint:
   * // const manager = new WebhookSignatureManager();
   * // const rawBody = req.rawBody;
   * // const signature = req.headers['x-webhook-signature'];
   * // const secret = await getWebhookSecret(webhookId);
   * // const isValid = manager.verifySignature(rawBody, secret, signature);
   * // if (!isValid) return res.status(401).json({ error: 'Invalid signature' });
   */
  verifySignature(
    payload: string | object,
    secret: string,
    signature: string,
    expectedAlgorithm: string = 'sha256'
  ): boolean {
    try {
      // Verify algorithm prefix matches
      const prefix = `${expectedAlgorithm}=`;
      if (!signature.startsWith(prefix)) {
        logger.debug('Invalid signature algorithm prefix', {
          expected: prefix,
          received: signature.substring(0, prefix.length + 4),
        });
        return false;
      }

      // Extract the actual signature (without algorithm prefix)
      const providedSignature = signature.substring(prefix.length);

      // Generate expected signature
      const expectedSignature = this.signPayload(payload, secret);
      const expectedSignaturePart = expectedSignature.substring(prefix.length);

      // Constant-time comparison to prevent timing attacks
      try {
        const providedBuffer = Buffer.from(providedSignature, this.config.encoding);
        const expectedBuffer = Buffer.from(expectedSignaturePart, this.config.encoding);

        // Use timing-safe comparison
        const isValid = timingSafeEqual(providedBuffer, expectedBuffer);

        if (!isValid) {
          logger.debug('Webhook signature verification failed', {
            algorithm: expectedAlgorithm,
          });
        }

        return isValid;
      } catch (error) {
        // Buffer lengths don't match or encoding error
        logger.debug('Signature buffer comparison failed', {
          error: error instanceof Error ? error.message : String(error),
        });
        return false;
      }
    } catch (error) {
      logger.error('Signature verification error', {
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * Extract algorithm from signature header
   *
   * Parses a signature header to extract the algorithm used.
   *
   * @param signature - Signature string (e.g., 'sha256=...')
   * @returns The algorithm name or null if invalid format
   *
   * @example
   * // Extract algorithm:
   * // const manager = new WebhookSignatureManager();
   * // const algo = manager.getAlgorithm('sha256=abc123');
   * // Returns: 'sha256'
   */
  getAlgorithm(signature: string): string | null {
    const match = signature.match(/^([a-z0-9]+)=/);
    return match?.[1] ?? null;
  }

  /**
   * Get current configuration
   */
  getConfig(): Readonly<WebhookSignatureConfig> {
    return Object.freeze({ ...this.config });
  }
}

/**
 * Singleton instance of WebhookSignatureManager
 */
let signatureManager: WebhookSignatureManager | null = null;

/**
 * Initialize the webhook signature manager
 *
 * @param config - Optional configuration overrides
 */
export function initWebhookSignatureManager(config?: Partial<WebhookSignatureConfig>): void {
  if (signatureManager) {
    logger.warn('WebhookSignatureManager already initialized');
    return;
  }

  signatureManager = new WebhookSignatureManager(config);
  logger.info('WebhookSignatureManager initialized');
}

/**
 * Get the webhook signature manager instance
 *
 * @throws {Error} If manager is not initialized
 */
export function getWebhookSignatureManager(): WebhookSignatureManager {
  if (!signatureManager) {
    // Initialize with defaults if not already done
    signatureManager = new WebhookSignatureManager();
  }
  return signatureManager;
}

/**
 * Reset the webhook signature manager (for testing)
 */
export function resetWebhookSignatureManager(): void {
  signatureManager = null;
  logger.debug('WebhookSignatureManager reset');
}

/**
 * Convenience function to generate a webhook secret
 *
 * @param lengthBytes - Optional length in bytes (default: 32)
 * @returns Secure webhook secret
 */
export function generateWebhookSecret(lengthBytes?: number): string {
  const manager = getWebhookSignatureManager();
  return manager.generateSecret(lengthBytes);
}

/**
 * Convenience function to sign a webhook payload
 *
 * @param payload - The webhook payload
 * @param secret - The webhook secret
 * @returns Signed payload signature
 */
export function signWebhookPayload(payload: string | object, secret: string): string {
  const manager = getWebhookSignatureManager();
  return manager.signPayload(payload, secret);
}

/**
 * Convenience function to verify a webhook signature
 *
 * @param payload - The webhook payload
 * @param secret - The webhook secret
 * @param signature - The signature to verify
 * @returns true if valid, false otherwise
 */
export function verifyWebhookSignature(
  payload: string | object,
  secret: string,
  signature: string
): boolean {
  const manager = getWebhookSignatureManager();
  return manager.verifySignature(payload, secret, signature);
}
