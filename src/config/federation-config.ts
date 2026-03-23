/**
 * ServalSheets - Federation Configuration
 *
 * Configuration parsing and validation for MCP server federation.
 * Handles environment variable parsing and Zod schema validation.
 *
 * @category Config
 * @module config/federation-config
 */

import { z } from 'zod';
import { ValidationError } from '../core/errors.js';

/** RFC 1918 / loopback / link-local ranges blocked to prevent SSRF */
const BLOCKED_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2[0-9]|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^::1$/,
  /^fc00:/i,
  /^fe80:/i,
];

function validateFederationUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ValidationError(`Invalid federation URL: ${url}`, 'url', 'https://hostname/path');
  }
  if (parsed.protocol !== 'https:') {
    throw new ValidationError(
      `Federation URL must use HTTPS (got ${parsed.protocol}): ${url}`,
      'url',
      'https://'
    );
  }
  const hostname = parsed.hostname;
  if (BLOCKED_HOST_PATTERNS.some((r) => r.test(hostname))) {
    throw new ValidationError(
      `Federation URL targets a private/loopback address (SSRF prevention): ${hostname}`,
      'url',
      'public HTTPS hostname'
    );
  }
}

/**
 * Zod schema for federation server configuration
 */
const FederationServerSchema = z.object({
  /** Server identifier (unique name) */
  name: z.string().min(1, 'Server name cannot be empty'),
  /** Server URL — must be HTTPS and not target private IP ranges */
  url: z
    .string()
    .url('Server URL must be a valid URL')
    .refine((u) => {
      try {
        return new URL(u).protocol === 'https:';
      } catch {
        return false;
      }
    }, 'Federation URLs must use HTTPS'),
  /** Transport type (default: http) */
  transport: z.enum(['http', 'stdio']).default('http'),
  /** Optional authentication configuration */
  auth: z
    .object({
      /** Authentication type */
      type: z.enum(['bearer', 'api-key']),
      /** Authentication token/key */
      token: z.string().optional(),
    })
    .optional(),
  /** Optional timeout override in milliseconds */
  timeoutMs: z.coerce.number().positive().optional(),
});

/**
 * Federation server configuration type
 */
export type FederationServerConfig = z.infer<typeof FederationServerSchema>;

/**
 * Parse federation servers from JSON string
 *
 * Expects a JSON string containing either:
 * - A single server object: `{ "name": "...", "url": "..." }`
 * - An array of server objects: `[{ "name": "...", "url": "..." }, ...]`
 *
 * Example:
 * ```json
 * [
 *   {
 *     "name": "weather-api",
 *     "url": "http://localhost:3001",
 *     "auth": {"type": "bearer", "token": "sk-..."}
 *   },
 *   {
 *     "name": "ml-server",
 *     "url": "http://localhost:3002"
 *   }
 * ]
 * ```
 *
 * @param jsonString - JSON string to parse
 * @returns Array of validated server configurations (empty if parsing fails)
 */
export function parseFederationServers(jsonString: string | undefined): FederationServerConfig[] {
  if (!jsonString) {
    return [];
  }

  try {
    const parsed = JSON.parse(jsonString);

    // Handle both single object and array
    const serversArray = Array.isArray(parsed) ? parsed : [parsed];

    // Validate each server config and enforce SSRF protection
    const validated = serversArray.map((server) => FederationServerSchema.parse(server));
    for (const server of validated) {
      validateFederationUrl(server.url);
    }
    return validated;
  } catch (error) {
    console.error('Failed to parse MCP_FEDERATION_SERVERS:', error);
    return [];
  }
}

/**
 * Validate a single federation server configuration
 *
 * @param config - Server configuration object
 * @returns Validated configuration or null if invalid
 */
export function validateServerConfig(config: unknown): FederationServerConfig | null {
  try {
    return FederationServerSchema.parse(config);
  } catch (error) {
    console.error('Invalid federation server config:', error);
    return null;
  }
}
