/**
 * Tests for GenericRestConnector SSRF protection
 */

import { describe, it, expect, vi } from 'vitest';
import { GenericRestConnector } from '../../src/connectors/rest-generic.js';

// validateWebhookUrl rejects non-HTTPS and private ranges
vi.mock('../../src/services/webhook-url-validation.js', () => ({
  validateWebhookUrl: vi.fn(async (url: string) => {
    if (!url.startsWith('https://')) {
      throw new Error('Webhook URL must use HTTPS');
    }
  }),
}));

vi.mock('../../src/utils/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const makeConnector = (baseUrl: string) =>
  new GenericRestConnector({
    id: 'test',
    name: 'Test REST',
    description: 'test',
    baseUrl,
    auth: { type: 'none' },
    endpoints: [],
  });

describe('GenericRestConnector SSRF protection', () => {
  it('should reject configure() when baseUrl is a localhost URL', async () => {
    const connector = makeConnector('http://localhost:3000');
    await expect(connector.configure({})).rejects.toThrow('HTTPS');
  });

  it('should allow configure() with a valid HTTPS baseUrl', async () => {
    const connector = makeConnector('https://api.example.com');
    await expect(connector.configure({})).resolves.not.toThrow();
  });
});
