/**
 * ServalSheets - URL Utilities
 */

export function validateHyperlinkUrl(
  url: string
): { ok: true; normalized: string } | { ok: false; reason: string } {
  try {
    const parsed = new URL(url);
    const protocol = parsed.protocol.toLowerCase();
    if (protocol !== 'http:' && protocol !== 'https:') {
      return { ok: false, reason: 'Only http/https URLs are allowed' };
    }
    return { ok: true, normalized: parsed.toString() };
  } catch {
    return { ok: false, reason: 'Invalid URL format' };
  }
}
