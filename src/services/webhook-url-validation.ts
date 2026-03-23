import dns from 'node:dns';
import { logger } from '../utils/logger.js';
import { getEnv } from '../config/env.js';
import { ValidationError, ServiceError } from '../core/errors.js';

/**
 * Check if an IPv4 address string is in a private/internal range.
 * Only called on canonical dotted-decimal notation (post DNS resolution or post WHATWG URL parse).
 */
function isPrivateIPv4(ip: string): boolean {
  const match = ip.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return false;
  const a = Number(match[1]);
  const b = Number(match[2]);
  return (
    a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) ||
    a === 127 ||
    a === 0
  );
}

/**
 * Check if an IPv6 address string is private/internal.
 */
function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase().replace(/[[\]]/g, '');
  if (
    lower.startsWith('fc') ||
    lower.startsWith('fd') ||
    lower.startsWith('fe80') ||
    lower === '::1'
  ) {
    return true;
  }

  // IPv4-mapped IPv6 (::ffff:192.168.1.1)
  const v4MappedMatch = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (v4MappedMatch) {
    return isPrivateIPv4(v4MappedMatch[1]!);
  }

  return false;
}

/**
 * SSRF protection: Block external callback/connection URLs pointing to
 * private or internal networks.
 * Validates HTTPS-only URLs and blocks internal/private IP targets.
 *
 * Defense layers (per MCP Security Best Practices):
 * 1. Protocol check — HTTPS only
 * 2. Pre-DNS checks — fast rejection of known attack patterns (localhost, decimal/hex IP literals)
 * 3. DNS resolution via dns.promises.lookup({ all: true }) — the authoritative gate:
 *    - Returns canonical dotted-decimal/colon notation; no octal/hex encoding tricks possible
 *    - Returns ALL address families (A + AAAA) in a single call
 *    - Works with bare IP literals without throwing (unlike dns.resolve)
 *    - Catches DNS rebinding attacks at the resolved-IP level
 *
 * NOTE: Manual IP parsing is only used on values that are already in canonical form
 * (either post-WHATWG-URL-parse or post-dns.lookup). Encoding tricks (octal, hex,
 * IPv4-mapped IPv6, integer IPs) are handled by the WHATWG URL parser + dns.lookup.
 */
async function validatePublicHttpsUrl(
  urlString: string,
  options: {
    dnsStrict: boolean;
    resourceLabel: string;
    dnsStrictEnvVar: string;
    component: string;
  }
): Promise<void> {
  let parsed: URL;
  try {
    // WHATWG URL normalizes octal/hex/integer IPv4 literals to dotted-decimal
    parsed = new URL(urlString);
  } catch {
    const invalidLabel =
      options.resourceLabel.charAt(0).toLowerCase() + options.resourceLabel.slice(1);
    throw new ValidationError(`Invalid ${invalidLabel}: ${urlString}`, 'url');
  }

  if (parsed.protocol !== 'https:') {
    throw new ValidationError(`${options.resourceLabel} must use HTTPS`, 'url');
  }

  const hostname = parsed.hostname;

  // Pre-DNS defense-in-depth — fast rejection before DNS round-trip
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
    throw new ValidationError(`${options.resourceLabel} cannot target localhost`, 'hostname');
  }

  if (/^\d+$/.test(hostname)) {
    throw new ValidationError(
      `${options.resourceLabel} cannot use decimal IP encoding`,
      'hostname'
    );
  }

  if (/^0x[0-9a-fA-F]+$/.test(hostname)) {
    throw new ValidationError(`${options.resourceLabel} cannot use hex IP encoding`, 'hostname');
  }

  if (isPrivateIPv4(hostname)) {
    throw new ValidationError(
      `${options.resourceLabel} cannot target private/internal IP addresses`,
      'hostname'
    );
  }

  if (hostname.startsWith('[') || hostname.includes(':')) {
    if (isPrivateIPv6(hostname)) {
      throw new ValidationError(
        `${options.resourceLabel} cannot target private/internal IPv6 addresses`,
        'hostname'
      );
    }
  }

  // DNS resolution — authoritative security gate.
  // Uses dns.promises.lookup({ all: true }) instead of dns.resolve() because:
  //   - lookup returns BOTH A (IPv4) and AAAA (IPv6) records via { all: true }
  //   - lookup handles IP literals directly (returns them as-is without NXDOMAIN)
  //   - Resolved addresses are always in canonical notation; no encoding bypass possible
  // This is the final check that catches DNS rebinding regardless of hostname encoding.
  try {
    const addresses = await dns.promises.lookup(hostname, { all: true });
    for (const { address, family } of addresses) {
      if (family === 4 && isPrivateIPv4(address)) {
        throw new ValidationError(
          `${options.resourceLabel} hostname resolves to a private/internal IPv4 address (DNS rebinding protection)`,
          'hostname'
        );
      }
      if (family === 6 && isPrivateIPv6(address)) {
        throw new ValidationError(
          `${options.resourceLabel} hostname resolves to a private/internal IPv6 address (DNS rebinding protection)`,
          'hostname'
        );
      }
    }
  } catch (error) {
    // Re-throw our own ValidationErrors (DNS rebinding detected, private IP resolved)
    if (error instanceof ValidationError) {
      throw error;
    }

    if (options.dnsStrict) {
      throw new ServiceError(
        `DNS resolution failed for ${hostname} — ${options.resourceLabel.toLowerCase()} cannot be verified ` +
          `(set ${options.dnsStrictEnvVar}=false to allow in flaky DNS environments)`,
        'INTERNAL_ERROR',
        options.component
      );
    }

    logger.warn(
      `DNS resolution failed during SSRF validation (${options.dnsStrictEnvVar}=false, allowing)`,
      {
        hostname,
        error: error instanceof Error ? error.message : String(error),
      }
    );
  }
}

export async function validateWebhookUrl(urlString: string): Promise<void> {
  await validatePublicHttpsUrl(urlString, {
    dnsStrict: getEnv().WEBHOOK_DNS_STRICT,
    resourceLabel: 'Webhook URL',
    dnsStrictEnvVar: 'WEBHOOK_DNS_STRICT',
    component: 'webhook-url-validation',
  });
}

export async function validateFederationServerUrl(urlString: string): Promise<void> {
  await validatePublicHttpsUrl(urlString, {
    dnsStrict: getEnv().MCP_FEDERATION_DNS_STRICT,
    resourceLabel: 'Federation URL',
    dnsStrictEnvVar: 'MCP_FEDERATION_DNS_STRICT',
    component: 'federated-mcp-client',
  });
}
