/**
 * HTTP health endpoint redaction regression tests.
 *
 * Uses the Express app directly to avoid localhost integration gating.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createHttpServer } from '../../src/http-server.js';
import type { Express } from 'express';
import net from 'node:net';

const canListenLocalhost = await new Promise<boolean>((resolve) => {
  const probe = net.createServer();
  probe.once('error', () => resolve(false));
  probe.listen(0, '127.0.0.1', () => {
    probe.close(() => resolve(true));
  });
});

describe.skipIf(!canListenLocalhost)('HTTP Health Redaction', () => {
  const server = createHttpServer({
    host: '127.0.0.1',
    port: 0,
    enableOAuth: true,
    oauthConfig: {
      issuer: 'https://issuer.example.com',
      clientId: 'oauth-client-id',
      clientSecret: 'oauth-client-secret',
      jwtSecret: 'x'.repeat(32),
      stateSecret: 'y'.repeat(32),
      allowedRedirectUris: ['http://localhost:3000/callback'],
      googleClientId: 'google-client-id',
      googleClientSecret: 'google-client-secret',
      accessTokenTtl: 3600,
      refreshTokenTtl: 86400,
    },
  });
  let httpServer: ReturnType<Express['listen']> | undefined;
  let agent: ReturnType<typeof request>;

  beforeAll(async () => {
    const app = server.app as Express;
    httpServer = await new Promise<ReturnType<Express['listen']>>((resolve, reject) => {
      const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
      listener.on('error', reject);
    });
    const address = httpServer.address();
    if (!address || typeof address === 'string') {
      throw new Error('HTTP health redaction test server failed to start');
    }
    agent = request(`http://127.0.0.1:${address.port}`);
  });

  afterAll(async () => {
    if (httpServer) {
      await new Promise<void>((resolve) => httpServer!.close(() => resolve()));
    }
    await server.stop?.();
  });

  it('should not expose oauth issuer/client or active session counts', async () => {
    const response = await agent.get('/health/ready').expect('Content-Type', /json/);

    expect([200, 503]).toContain(response.status);
    expect(response.body.oauth).toMatchObject({
      enabled: true,
      configured: true,
    });
    expect(response.body.oauth).not.toHaveProperty('issuer');
    expect(response.body.oauth).not.toHaveProperty('clientId');

    expect(response.body.sessions).toHaveProperty('hasAuthentication');
    expect(typeof response.body.sessions.hasAuthentication).toBe('boolean');
    expect(response.body.sessions).not.toHaveProperty('active');
  });
});
