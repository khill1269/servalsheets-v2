import { afterEach, describe, expect, it } from 'vitest';
import express from 'express';
import { addAdminRoutes } from '../../src/admin/routes.js';
import { resetEnvForTest } from '../../src/config/env.js';
import { requestApp } from '../helpers/request-app.js';

function applyEnvOverrides(overrides: Record<string, string>): () => void {
  const previousValues = new Map<string, string | undefined>();

  for (const [key, value] of Object.entries(overrides)) {
    previousValues.set(key, process.env[key]);
    process.env[key] = value;
  }
  resetEnvForTest();

  return () => {
    for (const [key, previous] of previousValues.entries()) {
      if (previous === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previous;
      }
    }
    resetEnvForTest();
  };
}

describe('Admin route authentication', () => {
  let restoreEnv = () => undefined;

  afterEach(() => {
    restoreEnv();
    restoreEnv = () => undefined;
  });

  it('allows viewer access for GET and requires admin key for mutations', async () => {
    restoreEnv = applyEnvOverrides({
      ADMIN_VIEWER_KEY: 'viewer-secret',
      ADMIN_API_KEY: 'admin-secret',
    });

    const app = express();
    addAdminRoutes(app, {
      getAllSessions: () => [],
      getSessionCount: () => 0,
      getTotalRequests: () => 0,
    });

    const viewerRead = await requestApp(app, {
      method: 'GET',
      path: '/admin/api/server-info',
      headers: {
        authorization: 'Bearer viewer-secret',
      },
    });

    expect(viewerRead.status).toBe(200);

    const viewerMutation = await requestApp(app, {
      method: 'POST',
      path: '/admin/api/deduplication/clear',
      headers: {
        authorization: 'Bearer viewer-secret',
      },
    });

    expect(viewerMutation.status).toBe(401);

    const adminMutation = await requestApp(app, {
      method: 'POST',
      path: '/admin/api/deduplication/clear',
      headers: {
        authorization: 'Bearer admin-secret',
      },
    });

    expect(adminMutation.status).toBe(200);
    expect(adminMutation.body).toMatchObject({ success: true });
  });

  it('keeps legacy ADMIN_SECRET working for mutations', async () => {
    restoreEnv = applyEnvOverrides({
      ADMIN_SECRET: 'legacy-secret',
    });

    const app = express();
    addAdminRoutes(app, {
      getAllSessions: () => [],
      getSessionCount: () => 0,
      getTotalRequests: () => 0,
    });

    const response = await requestApp(app, {
      method: 'POST',
      path: '/admin/api/deduplication/clear',
      headers: {
        authorization: 'Bearer legacy-secret',
      },
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ success: true });
  });
});
