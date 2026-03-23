function getSingleHeaderValue(
  headers: Record<string, string | string[] | undefined>,
  headerName: string
): string | undefined {
  const raw = headers[headerName];
  if (Array.isArray(raw)) {
    return raw[0];
  }
  return raw;
}

/**
 * Extract action from args, checking up to 3 levels deep for nested request objects.
 */
export function extractActionFromArgs(args: unknown): string {
  if (typeof args !== 'object' || args === null) {
    return 'unknown';
  }

  const record = args as Record<string, unknown>;

  if (typeof record['action'] === 'string' && record['action']) {
    return record['action'];
  }

  let current: unknown = record['request'];
  for (let depth = 0; depth < 3 && current; depth++) {
    if (typeof current === 'object' && current !== null) {
      const nested = current as Record<string, unknown>;
      if (typeof nested['action'] === 'string' && nested['action']) {
        return nested['action'];
      }
      current = nested['request'];
    }
  }

  return 'unknown';
}

export function extractPrincipalIdFromHeaders(
  headers: Record<string, string | string[] | undefined> | undefined
): string | undefined {
  if (!headers) {
    return undefined;
  }

  const candidateHeaders = ['x-user-id', 'x-session-id', 'x-client-id'] as const;
  for (const header of candidateHeaders) {
    const value = getSingleHeaderValue(headers, header)?.trim();
    if (value) {
      return value;
    }
  }

  return undefined; // OK: Explicit empty — no matching header found
}
