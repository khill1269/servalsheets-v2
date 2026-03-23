/**
 * Serval Core - Sensitive Data Redaction
 *
 * Centralized utility for redacting sensitive information from logs, errors,
 * and API responses. Prevents tokens, credentials, and API keys from leaking.
 *
 * Platform-agnostic: Works with any API backend (Google, Microsoft, etc.)
 */

/**
 * Field names that contain sensitive data (all lowercase for case-insensitive matching)
 */
export const SENSITIVE_FIELD_NAMES = new Set([
  // OAuth & Authentication
  'access_token', 'accesstoken', 'refresh_token', 'refreshtoken',
  'id_token', 'idtoken', 'bearer', 'authorization', 'auth', 'token', 'jwt',
  // API Keys & Secrets
  'api_key', 'apikey', 'client_secret', 'clientsecret',
  'client_id', 'clientid', 'secret', 'private_key', 'privatekey',
  // Credentials
  'password', 'passwd', 'pwd', 'credentials', 'creds',
  // Session & Cookies
  'session', 'sessionid', 'session_id', 'cookie', 'csrf', 'xsrf',
  // Other sensitive
  'ssn', 'social_security', 'socialsecurity',
  'credit_card', 'creditcard', 'cvv', 'pin',
]);

/**
 * Patterns for detecting and redacting sensitive strings
 * Order matters - specific patterns before generic ones.
 */
export const SENSITIVE_STRING_PATTERNS = [
  // Google API Keys (AIza...)
  { pattern: /AIza[A-Za-z0-9_-]{6,}/g, replacement: 'AIza[REDACTED]', description: 'Google API Key' },
  // Google OAuth access tokens (ya29.xxx)
  { pattern: /ya29\.[A-Za-z0-9_-]+/g, replacement: '[REDACTED]', description: 'Google OAuth access token' },
  // Bearer tokens
  { pattern: /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, replacement: 'Bearer [REDACTED]', description: 'OAuth Bearer token' },
  // JWT tokens
  { pattern: /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, replacement: 'eyJ[REDACTED]', description: 'JWT token' },
  // AWS-style keys
  { pattern: /AKIA[A-Z0-9]{16}/g, replacement: 'AKIA[REDACTED]', description: 'AWS Access Key' },
  // URLs with tokens/keys in query params
  { pattern: /([?&])(access_token|token|key|apikey|api_key|secret|password|pwd)=([^&\s]+)/gi, replacement: '$1$2=[REDACTED]', description: 'URL query parameter with sensitive data' },
  // Basic Auth
  { pattern: /Basic\s+[A-Za-z0-9+/=]+/gi, replacement: 'Basic [REDACTED]', description: 'HTTP Basic Auth' },
  // Generic long alphanumeric strings in sensitive contexts (LAST - most generic)
  { pattern: /(token|secret|password|bearer|auth)["'\s:=]+(?!AIza)([A-Za-z0-9\-._~+/]{32,})/gi, replacement: '$1: [REDACTED]', description: 'Long alphanumeric string after sensitive keyword' },
];

/**
 * Redact sensitive information from a string
 */
export function redactString(text: string): string {
  if (typeof text !== 'string') return text;

  let result = text;
  for (const { pattern, replacement } of SENSITIVE_STRING_PATTERNS) {
    pattern.lastIndex = 0;
    result = result.replace(pattern, replacement as string);
  }
  return result;
}

/**
 * Redact sensitive fields from an object (deep)
 */
export function redactObject<T>(obj: T, seen = new WeakSet<object>(), depth = 0): T {
  if (depth > 10) return obj;
  if (obj === null || obj === undefined) return obj;

  if (typeof obj !== 'object') {
    if (typeof obj === 'string') return redactString(obj) as unknown as T;
    return obj;
  }

  if (seen.has(obj as object)) return '[Circular]' as unknown as T;
  seen.add(obj as object);

  if (Array.isArray(obj)) {
    return obj.map((item) => redactObject(item, seen, depth + 1)) as unknown as T;
  }

  if (obj instanceof Error) {
    const redacted = new (obj.constructor as ErrorConstructor)(redactString(obj.message));
    redacted.stack = obj.stack;
    for (const [key, value] of Object.entries(obj)) {
      if (key !== 'message' && key !== 'stack' && key !== 'name') {
        (redacted as unknown as Record<string, unknown>)[key] = redactObject(value, seen, depth + 1);
      }
    }
    return redacted as unknown as T;
  }

  const result = {} as Record<string, unknown>;
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    const lowerKey = key.toLowerCase();
    if (SENSITIVE_FIELD_NAMES.has(lowerKey)) {
      if (typeof value === 'string') {
        const redacted = redactString(value);
        result[key] = redacted === value ? '[REDACTED]' : redacted;
      } else if (typeof value === 'object' && value !== null) {
        result[key] = redactObject(value, seen, depth + 1);
      } else {
        result[key] = '[REDACTED]';
      }
    } else if (typeof value === 'string') {
      result[key] = redactString(value);
    } else if (typeof value === 'object' && value !== null) {
      result[key] = redactObject(value, seen, depth + 1);
    } else {
      result[key] = value;
    }
  }
  return result as T;
}

export function isSensitiveField(fieldName: string): boolean {
  return SENSITIVE_FIELD_NAMES.has(fieldName.toLowerCase());
}

export function redact<T>(value: T): T {
  if (typeof value === 'string') return redactString(value) as unknown as T;
  if (typeof value === 'object' && value !== null) return redactObject(value);
  return value;
}
