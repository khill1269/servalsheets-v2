/**
 * Tests for Security - Resource Indicators (RFC 8707)
 *
 * Tests OAuth token validation with resource indicators to prevent
 * token mis-redemption attacks.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies
vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock jsonwebtoken
vi.mock('jsonwebtoken', () => ({
  default: {
    decode: vi.fn().mockImplementation((token) => {
      if (token === 'valid-token-with-audience') {
        return {
          aud: 'https://servalsheets.example.com',
          iss: 'https://accounts.google.com',
          exp: Math.floor(Date.now() / 1000) + 3600,
          sub: 'user@example.com',
        };
      }
      if (token === 'expired-token') {
        return {
          aud: 'https://servalsheets.example.com',
          iss: 'https://accounts.google.com',
          exp: Math.floor(Date.now() / 1000) - 3600,
          sub: 'user@example.com',
        };
      }
      if (token === 'wrong-audience-token') {
        return {
          aud: 'https://other-service.example.com',
          iss: 'https://accounts.google.com',
          exp: Math.floor(Date.now() / 1000) + 3600,
          sub: 'user@example.com',
        };
      }
      if (token === 'array-audience-token') {
        return {
          aud: ['https://servalsheets.example.com', 'https://other.example.com'],
          iss: 'https://accounts.google.com',
          exp: Math.floor(Date.now() / 1000) + 3600,
          sub: 'user@example.com',
        };
      }
      return null;
    }),
    verify: vi.fn(),
  },
}));

// Mock fetch for token introspection
const mockFetch = vi.fn();
global.fetch = mockFetch;

import { ResourceIndicatorValidator } from '../../src/security/resource-indicators.js';

describe('ResourceIndicatorValidator', () => {
  let validator: ResourceIndicatorValidator;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    validator = new ResourceIndicatorValidator({
      resourceIdentifier: 'https://servalsheets.example.com',
      allowedIssuers: ['https://accounts.google.com'],
    });
  });

  describe('constructor', () => {
    it('should create validator with config', () => {
      expect(validator).toBeDefined();
    });

    it('should accept custom token info endpoint', () => {
      const customValidator = new ResourceIndicatorValidator({
        resourceIdentifier: 'https://servalsheets.example.com',
        allowedIssuers: ['https://accounts.google.com'],
        tokenInfoEndpoint: 'https://custom.example.com/tokeninfo',
      });

      expect(customValidator).toBeDefined();
    });
  });

  describe('validateToken', () => {
    it('should accept valid token with correct audience', async () => {
      const result = await validator.validateToken('valid-token-with-audience');

      expect(result.valid).toBe(true);
    });

    it('should accept token with audience as array containing our resource', async () => {
      const result = await validator.validateToken('array-audience-token');

      expect(result.valid).toBe(true);
    });

    it('should reject token with wrong audience', async () => {
      const result = await validator.validateToken('wrong-audience-token');

      expect(result.valid).toBe(false);
    });

    it('should reject expired token', async () => {
      const result = await validator.validateToken('expired-token');

      expect(result.valid).toBe(false);
    });

    it('should reject null/invalid token', async () => {
      const result = await validator.validateToken('invalid-token-format');

      expect(result.valid).toBe(false);
    });

    it('should reject empty token', async () => {
      const result = await validator.validateToken('');

      expect(result.valid).toBe(false);
    });
  });

  describe('introspectToken', () => {
    it('should call token info endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            active: true,
            aud: 'https://servalsheets.example.com',
            exp: Math.floor(Date.now() / 1000) + 3600,
            scope: 'https://www.googleapis.com/auth/spreadsheets',
          }),
      });

      const validatorWithEndpoint = new ResourceIndicatorValidator({
        resourceIdentifier: 'https://servalsheets.example.com',
        allowedIssuers: ['https://accounts.google.com'],
        tokenInfoEndpoint: 'https://oauth2.googleapis.com/tokeninfo',
      });

      const result = await validatorWithEndpoint.introspectToken('some-token');

      expect(mockFetch).toHaveBeenCalled();
      expect(result.active).toBe(true);
    });

    it('should handle introspection network error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const validatorWithEndpoint = new ResourceIndicatorValidator({
        resourceIdentifier: 'https://servalsheets.example.com',
        allowedIssuers: ['https://accounts.google.com'],
        tokenInfoEndpoint: 'https://oauth2.googleapis.com/tokeninfo',
      });

      const result = await validatorWithEndpoint.introspectToken('some-token');

      expect(result.active).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should handle 401 response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
      });

      const validatorWithEndpoint = new ResourceIndicatorValidator({
        resourceIdentifier: 'https://servalsheets.example.com',
        allowedIssuers: ['https://accounts.google.com'],
        tokenInfoEndpoint: 'https://oauth2.googleapis.com/tokeninfo',
      });

      const result = await validatorWithEndpoint.introspectToken('invalid-token');

      expect(result.active).toBe(false);
    });

    it('should return inactive for expired token in introspection', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            active: false,
            error: 'Token expired',
          }),
      });

      const validatorWithEndpoint = new ResourceIndicatorValidator({
        resourceIdentifier: 'https://servalsheets.example.com',
        allowedIssuers: ['https://accounts.google.com'],
        tokenInfoEndpoint: 'https://oauth2.googleapis.com/tokeninfo',
      });

      const result = await validatorWithEndpoint.introspectToken('expired-token');

      expect(result.active).toBe(false);
    });
  });

  describe('generateResourceIdentifier', () => {
    it('should generate HTTPS identifier for standard port', () => {
      const identifier = ResourceIndicatorValidator.generateResourceIdentifier(
        'servalsheets.example.com',
        443
      );

      expect(identifier).toBe('https://servalsheets.example.com');
    });

    it('should include port for non-standard HTTPS port', () => {
      const identifier = ResourceIndicatorValidator.generateResourceIdentifier(
        'servalsheets.example.com',
        8443
      );

      expect(identifier).toBe('https://servalsheets.example.com:8443');
    });

    it('should handle localhost', () => {
      const identifier = ResourceIndicatorValidator.generateResourceIdentifier('localhost', 3000);

      expect(identifier).toBe('https://localhost:3000');
    });
  });

  describe('issuer validation', () => {
    it('should create validator with multiple allowed issuers', () => {
      const multiIssuerValidator = new ResourceIndicatorValidator({
        resourceIdentifier: 'https://servalsheets.example.com',
        allowedIssuers: [
          'https://accounts.google.com',
          'https://login.microsoftonline.com',
          'https://cognito-idp.us-east-1.amazonaws.com',
        ],
      });

      expect(multiIssuerValidator).toBeDefined();
    });
  });
});
