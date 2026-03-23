import { describe, expect, it, vi, beforeEach } from 'vitest';

const { verifyWebhookSignature } = vi.hoisted(() => ({
  verifyWebhookSignature: vi.fn(),
}));

vi.mock('../../src/security/webhook-signature.js', () => ({
  verifyWebhookSignature,
}));

import { webhookVerificationMiddleware } from '../../src/utils/webhook-verification.js';

function createMockRequest() {
  return {
    body: { ok: true },
    get: vi.fn((header: string) => {
      const normalized = header.toLowerCase();
      if (normalized === 'x-webhook-id') return 'webhook-123';
      if (normalized === 'x-webhook-signature') return 'sha256=test-signature';
      if (normalized === 'x-webhook-delivery') return 'delivery-123';
      return undefined;
    }),
  } as any;
}

function createMockResponse() {
  const response = {
    status: vi.fn(),
    json: vi.fn(),
  } as any;
  response.status.mockReturnValue(response);
  response.json.mockReturnValue(response);
  return response;
}

describe('webhookVerificationMiddleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    verifyWebhookSignature.mockReturnValue(false);
  });

  it('returns the same 401 response for missing webhooks and invalid signatures', async () => {
    const next = vi.fn();
    const missingSecretResponse = createMockResponse();
    const invalidSignatureResponse = createMockResponse();

    const missingSecretMiddleware = webhookVerificationMiddleware({
      getSecret: vi.fn().mockResolvedValue(null),
    });
    const invalidSignatureMiddleware = webhookVerificationMiddleware({
      getSecret: vi.fn().mockResolvedValue('real-secret'),
    });

    await missingSecretMiddleware(createMockRequest(), missingSecretResponse, next);
    await invalidSignatureMiddleware(createMockRequest(), invalidSignatureResponse, next);

    expect(missingSecretResponse.status).toHaveBeenCalledWith(401);
    expect(invalidSignatureResponse.status).toHaveBeenCalledWith(401);

    const missingPayload = missingSecretResponse.json.mock.calls[0]?.[0];
    const invalidPayload = invalidSignatureResponse.json.mock.calls[0]?.[0];

    expect(missingPayload).toEqual(invalidPayload);
    expect(missingPayload).toMatchObject({
      error: 'INVALID_SIGNATURE',
      message: 'Webhook signature verification failed',
    });
    expect(verifyWebhookSignature).toHaveBeenNthCalledWith(
      1,
      JSON.stringify({ ok: true }),
      'servalsheets-webhook-dummy-secret',
      'sha256=test-signature'
    );
    expect(verifyWebhookSignature).toHaveBeenNthCalledWith(
      2,
      JSON.stringify({ ok: true }),
      'real-secret',
      'sha256=test-signature'
    );
    expect(next).not.toHaveBeenCalled();
  });
});
