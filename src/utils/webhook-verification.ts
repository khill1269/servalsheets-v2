/**
 * ServalSheets - Webhook Verification Utilities
 *
 * Express middleware and utilities for verifying ServalSheets webhook signatures.
 * Provides easy integration for webhook consumers to validate incoming webhooks.
 *
 * Features:
 * - Express middleware for automatic signature verification
 * - Raw body capture for accurate signature verification
 * - Comprehensive error handling and logging
 * - TypeScript support with proper typing
 *
 * Usage:
 * ```typescript
 * import {
 *   webhookVerificationMiddleware,
 *   verifyWebhookRequest,
 * } from './webhook-verification';
 *
 * // Middleware approach
 * app.post('/webhooks/servalsheets', webhookVerificationMiddleware({
 *   getSecret: async (webhookId) => {
 *     return await fetchSecretFromDB(webhookId);
 *   },
 * }), async (req, res) => {
 *   // Webhook verified - process it
 *   const payload = req.body;
 *   // ... handle webhook
 * });
 *
 * // Manual verification
 * const isValid = await verifyWebhookRequest(rawBody, secret, signature);
 * ```
 *
 * @category Utils
 */

import type { Request, Response, NextFunction } from 'express';
import { verifyWebhookSignature } from '../security/webhook-signature.js';
import { logger } from './logger.js';

const DUMMY_WEBHOOK_SECRET = 'servalsheets-webhook-dummy-secret';

/**
 * Webhook verification configuration
 */
export interface WebhookVerificationConfig {
  /** Function to retrieve the secret for a webhook ID */
  getSecret: (webhookId: string) => Promise<string | null>;
  /** Header name for webhook ID (default: 'x-webhook-id') */
  webhookIdHeader?: string;
  /** Header name for signature (default: 'x-webhook-signature') */
  signatureHeader?: string;
  /** Header name for delivery ID (default: 'x-webhook-delivery') */
  deliveryIdHeader?: string;
  /** Whether to require signature (default: true) */
  requireSignature?: boolean;
  /** Custom error response handler */
  onError?: (error: WebhookVerificationError, req: Request, res: Response) => void;
  /** Custom success handler (optional - if not provided, next() is called) */
  onSuccess?: (req: Request, res: Response, next: NextFunction) => void;
}

/**
 * Webhook verification error
 */
export class WebhookVerificationError extends Error {
  constructor(
    public code: string,
    message: string,
    public statusCode: number = 401,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'WebhookVerificationError';
  }
}

/**
 * Express Request with rawBody property
 */
export interface RequestWithRawBody extends Request {
  rawBody?: Buffer | string;
  body: Buffer | string | Record<string, unknown> | null;
}

/**
 * Webhook request with verified signature
 */
export interface VerifiedWebhookRequest extends RequestWithRawBody {
  webhook?: {
    webhookId: string;
    deliveryId: string;
    signature: string;
    isValid: boolean;
    payload: unknown;
  };
}

/**
 * Verify a webhook request manually
 *
 * @param rawBody - Raw request body (must be Buffer or string)
 * @param secret - Webhook secret
 * @param signature - Signature from webhook header
 * @returns true if signature is valid, false otherwise
 *
 * @example
 * ```typescript
 * const isValid = verifyWebhookRequest(
 *   rawBody,
 *   secret,
 *   'sha256=abc123...'
 * );
 * ```
 */
export function verifyWebhookRequest(
  rawBody: Buffer | string,
  secret: string,
  signature: string
): boolean {
  try {
    // Convert Buffer to string if needed
    const bodyStr = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');

    // Verify signature
    return verifyWebhookSignature(bodyStr, secret, signature);
  } catch (error) {
    logger.debug('Webhook verification failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * Express middleware for webhook signature verification
 *
 * This middleware should be used on routes that receive ServalSheets webhooks.
 * It verifies the HMAC-SHA256 signature of the webhook payload.
 *
 * IMPORTANT: You must configure Express to preserve raw request body for
 * this middleware to work correctly. Add this before the route:
 *
 * ```typescript
 * app.use(express.raw({ type: 'application/json' }));
 * ```
 *
 * Or use a custom body parser that preserves the raw body.
 *
 * @param config - Verification configuration
 * @returns Express middleware function
 *
 * @example
 * ```typescript
 * // Setup Express to preserve raw body
 * app.use(express.raw({ type: 'application/json' }));
 *
 * // Create middleware
 * const verifyWebhook = webhookVerificationMiddleware({
 *   getSecret: async (webhookId) => {
 *     const webhook = await db.webhooks.findById(webhookId);
 *     return webhook?.secret || null;
 *   },
 * });
 *
 * // Use middleware
 * app.post('/webhooks/servalsheets', verifyWebhook, async (req, res) => {
 *   const payload = JSON.parse(req.rawBody.toString());
 *   // Process webhook...
 * });
 * ```
 */
export function webhookVerificationMiddleware(
  config: WebhookVerificationConfig
): (req: Request, res: Response, next: NextFunction) => Promise<void> {
  const {
    getSecret,
    webhookIdHeader = 'x-webhook-id',
    signatureHeader = 'x-webhook-signature',
    deliveryIdHeader = 'x-webhook-delivery',
    requireSignature = true,
    onError,
    onSuccess,
  } = config;

  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Extract headers
      const webhookId = req.get(webhookIdHeader);
      const signature = req.get(signatureHeader);
      const deliveryId = req.get(deliveryIdHeader);

      // Validate required headers
      if (!webhookId) {
        throw new WebhookVerificationError(
          'MISSING_WEBHOOK_ID',
          `Missing required header: ${webhookIdHeader}`,
          400
        );
      }

      if (!signature) {
        if (requireSignature) {
          throw new WebhookVerificationError(
            'MISSING_SIGNATURE',
            `Missing required header: ${signatureHeader}`,
            400
          );
        }
        logger.warn('Webhook received without signature', { webhookId, deliveryId });
        return next();
      }

      // Handle raw body - try different sources
      let rawBody: Buffer;
      const reqWithRaw = req as RequestWithRawBody;
      if (typeof reqWithRaw.rawBody === 'string') {
        rawBody = Buffer.from(reqWithRaw.rawBody, 'utf8');
      } else if (Buffer.isBuffer(reqWithRaw.rawBody)) {
        rawBody = reqWithRaw.rawBody;
      } else if (Buffer.isBuffer(req.body)) {
        rawBody = req.body;
      } else if (typeof req.body === 'string') {
        rawBody = Buffer.from(req.body, 'utf8');
      } else if (typeof req.body === 'object' && req.body !== null) {
        // Fallback: reconstruct JSON from parsed body
        rawBody = Buffer.from(JSON.stringify(req.body), 'utf8');
        logger.warn('Reconstructed raw body from parsed JSON - signature verification may fail', {
          webhookId,
          deliveryId,
        });
      } else {
        throw new WebhookVerificationError(
          'INVALID_BODY',
          'Unable to extract raw request body',
          400,
          { bodyType: typeof req.body }
        );
      }

      const secret = await getSecret(webhookId);
      const effectiveSecret = secret ?? DUMMY_WEBHOOK_SECRET;
      const isValid = verifyWebhookRequest(rawBody, effectiveSecret, signature);
      if (!secret || !isValid) {
        throw new WebhookVerificationError(
          'INVALID_SIGNATURE',
          'Webhook signature verification failed',
          401,
          { webhookId, deliveryId }
        );
      }

      // Attach verified webhook info to request
      const verifiedReq = req as VerifiedWebhookRequest;
      verifiedReq.rawBody = rawBody;
      verifiedReq.webhook = {
        webhookId,
        deliveryId: deliveryId || 'unknown',
        signature,
        isValid: true,
        payload: typeof req.body === 'object' ? req.body : JSON.parse(rawBody.toString()),
      };

      logger.debug('Webhook signature verified', {
        webhookId,
        deliveryId,
      });

      // Call success handler or next()
      if (onSuccess) {
        onSuccess(req, res, next);
      } else {
        next();
      }
    } catch (error) {
      const verificationError =
        error instanceof WebhookVerificationError
          ? error
          : new WebhookVerificationError(
              'VERIFICATION_ERROR',
              error instanceof Error ? error.message : 'Unknown verification error',
              500,
              { error: String(error) }
            );

      logger.warn('Webhook verification failed', {
        code: verificationError.code,
        statusCode: verificationError.statusCode,
        message: verificationError.message,
      });

      if (onError) {
        onError(verificationError, req, res);
      } else {
        res.status(verificationError.statusCode).json({
          error: verificationError.code,
          message: verificationError.message,
          details: verificationError.details,
        });
      }
    }
  };
}

/**
 * Helper to create a webhook handler that automatically verifies signatures
 *
 * @param handler - Async request handler
 * @returns Handler that checks webhook.isValid before processing
 */
export function createVerifiedWebhookHandler(
  handler: (req: VerifiedWebhookRequest, res: Response) => Promise<void>
): (req: Request, res: Response) => Promise<void> {
  return async (req: Request, res: Response) => {
    const verifiedReq = req as VerifiedWebhookRequest;

    if (!verifiedReq.webhook?.isValid) {
      res.status(401).json({
        error: 'INVALID_WEBHOOK',
        message: 'Webhook signature verification required',
      });
      return;
    }

    try {
      await handler(verifiedReq, res);
    } catch (error) {
      logger.error('Webhook handler error', {
        error: error instanceof Error ? error.message : String(error),
        webhookId: verifiedReq.webhook?.webhookId,
        deliveryId: verifiedReq.webhook?.deliveryId,
      });

      res.status(500).json({
        error: 'HANDLER_ERROR',
        message: 'Failed to process webhook',
      });
    }
  };
}

/**
 * Express middleware to capture raw body
 *
 * Use this middleware before json() parser if you need to preserve raw body
 * for webhook signature verification.
 *
 * @example
 * ```typescript
 * app.use(captureRawBody);
 * app.use(express.json());
 * ```
 */
export function captureRawBody(req: Request, res: Response, next: NextFunction): void {
  if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
    let data = '';
    req.setEncoding('utf8');

    req.on('data', (chunk) => {
      data += chunk;
    });

    req.on('end', () => {
      const reqWithRaw = req as RequestWithRawBody;
      reqWithRaw.rawBody = Buffer.from(data, 'utf8');
      // Parse JSON for body property
      try {
        reqWithRaw.body = JSON.parse(data);
      } catch {
        reqWithRaw.body = data;
      }
      next();
    });
  } else {
    next();
  }
}
