import { beforeEach, describe, expect, it, vi } from 'vitest';

const { lookup } = vi.hoisted(() => ({
  lookup: vi.fn(),
}));

const { getEnvMock } = vi.hoisted(() => ({
  getEnvMock: vi.fn().mockReturnValue({ WEBHOOK_DNS_STRICT: true }),
}));

vi.mock('node:dns', () => ({
  default: {
    promises: {
      lookup,
    },
  },
}));

vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../src/config/env.js', () => ({
  getEnv: getEnvMock,
}));

import { validateWebhookUrl } from '../../src/services/webhook-url-validation.js';

describe('validateWebhookUrl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: public IP, IPv4
    lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    getEnvMock.mockReturnValue({ WEBHOOK_DNS_STRICT: true });
  });

  it('rejects non-HTTPS URLs', async () => {
    await expect(validateWebhookUrl('http://example.com/webhook')).rejects.toThrow(
      'Webhook URL must use HTTPS'
    );
  });

  it('rejects localhost targets before DNS lookup', async () => {
    await expect(validateWebhookUrl('https://localhost/webhook')).rejects.toThrow(
      'Webhook URL cannot target localhost'
    );
    expect(lookup).not.toHaveBeenCalled();
  });

  it('rejects decimal IP encoding (WHATWG URL normalizes to dotted-decimal, caught as private IP)', async () => {
    // 3232235777 = 192.168.1.1 in decimal — WHATWG URL normalizes to '192.168.1.1'
    // which is then blocked by the isPrivateIPv4 check before DNS lookup.
    await expect(validateWebhookUrl('https://3232235777/webhook')).rejects.toThrow(
      'Webhook URL cannot target private/internal IP addresses'
    );
    expect(lookup).not.toHaveBeenCalled();
  });

  it('rejects hex IP encoding (WHATWG URL normalizes to dotted-decimal, caught as private IP)', async () => {
    // 0xc0a80101 = 192.168.1.1 in hex — WHATWG URL normalizes to '192.168.1.1'
    // which is then blocked by the isPrivateIPv4 check before DNS lookup.
    await expect(validateWebhookUrl('https://0xc0a80101/webhook')).rejects.toThrow(
      'Webhook URL cannot target private/internal IP addresses'
    );
    expect(lookup).not.toHaveBeenCalled();
  });

  it('rejects private IPv4 literal before DNS lookup', async () => {
    await expect(validateWebhookUrl('https://192.168.1.1/webhook')).rejects.toThrow(
      'Webhook URL cannot target private/internal IP addresses'
    );
    expect(lookup).not.toHaveBeenCalled();
  });

  describe('DNS resolution (lookup { all: true })', () => {
    it('accepts public HTTPS webhook URLs', async () => {
      await expect(validateWebhookUrl('https://example.com/webhook')).resolves.toBeUndefined();
      expect(lookup).toHaveBeenCalledWith('example.com', { all: true });
    });

    it('rejects DNS rebinding to private IPv4', async () => {
      lookup.mockResolvedValue([{ address: '10.0.0.5', family: 4 }]);

      await expect(validateWebhookUrl('https://example.com/webhook')).rejects.toThrow(
        'DNS rebinding protection'
      );
      expect(lookup).toHaveBeenCalledWith('example.com', { all: true });
    });

    it('rejects DNS rebinding to private IPv6', async () => {
      lookup.mockResolvedValue([{ address: 'fc00::1', family: 6 }]);

      await expect(validateWebhookUrl('https://example.com/webhook')).rejects.toThrow(
        'DNS rebinding protection'
      );
    });

    it('rejects when any resolved address is private (multi-address response)', async () => {
      lookup.mockResolvedValue([
        { address: '93.184.216.34', family: 4 },
        { address: '10.0.0.1', family: 4 },
      ]);

      await expect(validateWebhookUrl('https://example.com/webhook')).rejects.toThrow(
        'DNS rebinding protection'
      );
    });

    it('always blocks DNS rebinding regardless of WEBHOOK_DNS_STRICT', async () => {
      getEnvMock.mockReturnValue({ WEBHOOK_DNS_STRICT: false });
      lookup.mockResolvedValue([{ address: '192.168.1.100', family: 4 }]);

      await expect(validateWebhookUrl('https://evil.com/webhook')).rejects.toThrow(
        'DNS rebinding'
      );
    });
  });

  describe('DNS failure policy', () => {
    it('blocks registration when DNS fails and WEBHOOK_DNS_STRICT=true (default)', async () => {
      getEnvMock.mockReturnValue({ WEBHOOK_DNS_STRICT: true });
      lookup.mockRejectedValue(new Error('ENOTFOUND example.com'));

      await expect(validateWebhookUrl('https://example.com/webhook')).rejects.toThrow(
        'DNS resolution failed for example.com'
      );
    });

    it('allows registration when DNS fails and WEBHOOK_DNS_STRICT=false', async () => {
      getEnvMock.mockReturnValue({ WEBHOOK_DNS_STRICT: false });
      lookup.mockRejectedValue(new Error('ENOTFOUND example.com'));

      await expect(validateWebhookUrl('https://example.com/webhook')).resolves.toBeUndefined();
    });
  });
});
