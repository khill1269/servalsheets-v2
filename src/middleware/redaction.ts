/**
 * Response Redaction Middleware
 *
 * Automatically strips sensitive data (tokens, API keys, credentials)
 * from HTTP response bodies and error messages to prevent accidental leakage.
 *
 * @module middleware/redaction
 */

import type { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger.js';

/**
 * Patterns that match sensitive data in response bodies.
 * Each pattern includes a name (for logging) and a regex with a replacement.
 */
const REDACTION_PATTERNS: Array<{
  name: string;
  pattern: RegExp;
  replacement: string;
}> = [
  // OAuth Bearer tokens (typically base64-encoded, 20+ chars)
  {
    name: 'bearer_token',
    pattern: /Bearer\s+[A-Za-z0-9\-._~+/]+=*/g,
    replacement: 'Bearer [REDACTED]',
  },
  // Google API keys (AIza prefix, 39 chars)
  {
    name: 'google_api_key',
    pattern: /AIza[A-Za-z0-9\-_]{35}/g,
    replacement: '[GOOGLE_API_KEY_REDACTED]',
  },
  // Google OAuth access tokens (ya29. prefix)
  {
    name: 'google_access_token',
    pattern: /ya29\.[A-Za-z0-9\-._]{50,}/g,
    replacement: '[GOOGLE_ACCESS_TOKEN_REDACTED]',
  },
  // Google refresh tokens (1//... pattern)
  {
    name: 'google_refresh_token',
    pattern: /1\/\/[A-Za-z0-9\-._]{30,}/g,
    replacement: '[GOOGLE_REFRESH_TOKEN_REDACTED]',
  },
  // Generic long base64 tokens (40+ chars, likely secrets)
  {
    name: 'long_token',
    pattern:
      /(?<="[^"]*(?:token|secret|key|password|credential)[^"]*"\s*:\s*")[A-Za-z0-9+/=\-._]{40,}(?=")/gi,
    replacement: '[REDACTED]',
  },
  // Email addresses in stack traces (prevent PII leakage)
  {
    name: 'stack_trace_email',
    pattern:
      /(?<=(?:Error|at|stack|trace|caused by)[^\n]{0,200})[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/gi,
    replacement: '[EMAIL_REDACTED]',
  },
  // Email addresses inside error/message/log fields (prevent PII in error responses)
  {
    name: 'error_field_email',
    pattern:
      /(?<="(?:error|message|description|details|reason|cause|info|warning|hint)"\s*:\s*"[^"]{0,500})[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/gi,
    replacement: '[EMAIL_REDACTED]',
  },
  // JWT tokens (header.payload.signature, each part is base64url)
  {
    name: 'jwt_token',
    pattern: /eyJ[A-Za-z0-9\-_]+\.eyJ[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+/g,
    replacement: '[JWT_REDACTED]',
  },
  // Private keys (RSA, EC, generic)
  {
    name: 'private_key',
    pattern:
      /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----[\s\S]+?-----END (?:RSA |EC )?PRIVATE KEY-----/g,
    replacement: '[PRIVATE_KEY_REDACTED]',
  },
  // Redis URLs with credentials (redis://user:password@host)
  {
    name: 'redis_credentials',
    pattern: /redis:\/\/[^:]+:[^@]+@/g,
    replacement: 'redis://[CREDENTIALS_REDACTED]@',
  },
  // US phone numbers (various formats: (555) 555-5555, 555-555-5555, +1 555 555 5555, etc.)
  {
    name: 'phone_us',
    pattern: /(?<!\d)(\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}(?!\d)/g,
    replacement: '[PHONE_REDACTED]',
  },
  // International phone numbers in E.164 format (+14155552671, +447700900000, etc.)
  {
    name: 'phone_e164',
    pattern: /\+\d{7,15}/g,
    replacement: '[PHONE_REDACTED]',
  },
];

/**
 * Redact sensitive data from a string.
 *
 * @param input - The string to redact
 * @returns Object with redacted string and count of redactions made
 */
export function redactSensitiveData(input: string): { output: string; redactionCount: number } {
  let output = input;
  let redactionCount = 0;

  for (const { pattern, replacement } of REDACTION_PATTERNS) {
    // Reset lastIndex for global patterns
    pattern.lastIndex = 0;
    const matches = output.match(pattern);
    if (matches) {
      redactionCount += matches.length;
      output = output.replace(pattern, replacement);
    }
  }

  return { output, redactionCount };
}

/**
 * Express middleware that intercepts response JSON to redact sensitive data.
 * Only applies to JSON responses (Content-Type: application/json).
 * Controlled by ENABLE_RESPONSE_REDACTION env var (default: true in production).
 */
export function responseRedactionMiddleware() {
  const isEnabled = process.env['ENABLE_RESPONSE_REDACTION'] !== 'false';

  if (!isEnabled) {
    // Return no-op middleware when disabled
    return (_req: Request, _res: Response, next: NextFunction): void => {
      next();
    };
  }

  return (_req: Request, res: Response, next: NextFunction): void => {
    // Intercept res.json() to redact before sending
    const originalJson = res.json.bind(res);

    res.json = function redactedJson(body: unknown): Response {
      if (body && typeof body === 'object') {
        try {
          const serialized = JSON.stringify(body);
          const { output, redactionCount } = redactSensitiveData(serialized);

          if (redactionCount > 0) {
            logger.info('Redacted sensitive data from response', {
              redactionCount,
              path: _req.path,
              method: _req.method,
            });

            // Parse back and send the redacted version
            return originalJson(JSON.parse(output));
          }
        } catch (err) {
          // If redaction fails, send original (safety: don't block responses)
          logger.warn('Response redaction failed, sending original', {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      return originalJson(body);
    };

    next();
  };
}
