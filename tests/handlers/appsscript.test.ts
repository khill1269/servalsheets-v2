/**
 * ServalSheets - Apps Script Handler Tests
 *
 * Comprehensive tests for Apps Script project management, deployment, and execution.
 * Covers all 14 actions: project CRUD, versions, deployments, execution, and metrics.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SheetsAppsScriptHandler } from '../../src/handlers/appsscript.js';
import { SheetsAppsScriptOutputSchema } from '../../src/schemas/appsscript.js';
import type { HandlerContext } from '../../src/handlers/base.js';
import {
  createRequestContext,
  runWithRequestContext,
} from '../../src/utils/request-context.js';

// Mock Google Client with OAuth2
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
const createMockGoogleClient = () => ({
  oauth2: {
    credentials: {
      access_token: 'test-access-token',
      refresh_token: 'test-refresh-token',
      expiry_date: 1704067200000 + 3600000,
    },
    getAccessToken: vi.fn().mockResolvedValue({ token: 'test-access-token' }),
  },
  drive: {
    files: {
      list: vi.fn().mockResolvedValue({
        data: {
          files: [],
        },
      }),
    },
  },
  getTokenStatus: vi.fn().mockReturnValue({
    hasAccessToken: true,
    hasRefreshToken: true,
    expiryDate: 1704067200000 + 3600000, // 1 hour from now (won't trigger pre-refresh)
    scope: 'https://www.googleapis.com/auth/script.projects',
  }),
});

describe('SheetsAppsScriptHandler', () => {
  let handler: SheetsAppsScriptHandler;
  let mockGoogleClient: ReturnType<typeof createMockGoogleClient>;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockGoogleClient = createMockGoogleClient();

    const context: HandlerContext = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Mock Google client type
      googleClient: mockGoogleClient as any,
    };

    handler = new SheetsAppsScriptHandler(context);

    // Mock global fetch
    mockFetch = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Mock fetch type
    global.fetch = mockFetch as any;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ===========================================================================
  // Project Management Actions
  // ===========================================================================

  describe('create action', () => {
    it('should create Apps Script project', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        text: vi.fn().mockResolvedValue(
          JSON.stringify({
            scriptId: 'script-123',
            title: 'My Script',
            createTime: '2024-01-01T00:00:00Z',
            updateTime: '2024-01-01T00:00:00Z',
          })
        ),
      });

      const result = await handler.handle({
        request: {
          action: 'create',
          title: 'My Script',
        },
      });

      expect(result.response.success).toBe(true);
      expect(result.response.action).toBe('create');
      expect(result.response.scriptId).toBe('script-123');
      expect(result.response.project).toBeDefined();
      expect(result.response.project.scriptId).toBe('script-123');
      expect(result.response.project.title).toBe('My Script');

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://script.googleapis.com/v1/projects',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-access-token',
          }),
          body: JSON.stringify({ title: 'My Script' }),
        })
      );
    });

    it('should create project with parentId', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        text: vi.fn().mockResolvedValue(
          JSON.stringify({
            scriptId: 'script-123',
            title: 'My Script',
            parentId: 'folder-456',
          })
        ),
      });

      const result = await handler.handle({
        request: {
          action: 'create',
          title: 'My Script',
          parentId: 'folder-456',
        },
      });

      expect(result.response.success).toBe(true);
      expect(result.response.project.parentId).toBe('folder-456');
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({ title: 'My Script', parentId: 'folder-456' }),
        })
      );
    });

    it('should handle creation error', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        text: vi
          .fn()
          .mockResolvedValue(
            JSON.stringify({ error: { message: 'script.googleapis.com has not been used' } })
          ),
      });

      const result = await handler.handle({
        request: {
          action: 'create',
          title: 'My Script',
        },
      });

      expect(result.response.success).toBe(false);
      expect(result.response.error).toBeDefined();
      expect(result.response.error.code).toBe('SERVICE_NOT_ENABLED');
      expect(result.response.error.message).toContain('Apps Script API is not enabled');
    });
  });

  describe('get action', () => {
    it('should get project metadata', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        text: vi.fn().mockResolvedValue(
          JSON.stringify({
            scriptId: 'script-123',
            title: 'My Script',
            createTime: '2024-01-01T00:00:00Z',
            updateTime: '2024-01-02T00:00:00Z',
            creator: { email: 'user@example.com', name: 'User' },
          })
        ),
      });

      const result = await handler.handle({
        request: {
          action: 'get',
          scriptId: 'script-123',
        },
      });

      expect(result.response.success).toBe(true);
      expect(result.response.action).toBe('get');
      expect(result.response.project).toBeDefined();
      expect(result.response.project.scriptId).toBe('script-123');
      expect(result.response.project.creator).toBeDefined();
      expect(result.response.project.creator.email).toBe('user@example.com');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://script.googleapis.com/v1/projects/script-123',
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('should handle project not found', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: vi
          .fn()
          .mockResolvedValue(JSON.stringify({ error: { message: 'Project not found' } })),
      });

      const result = await handler.handle({
        request: {
          action: 'get',
          scriptId: 'nonexistent',
        },
      });

      expect(result.response.success).toBe(false);
      expect(result.response.error).toBeDefined();
      expect(result.response.error.code).toBe('NOT_FOUND');
    });
  });

  describe('get_content action', () => {
    it('should get script files', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        text: vi.fn().mockResolvedValue(
          JSON.stringify({
            scriptId: 'script-123',
            files: [
              {
                name: 'Code.gs',
                type: 'SERVER_JS',
                source: 'function test() { return "Hello"; }',
                createTime: '2024-01-01T00:00:00Z',
              },
              {
                name: 'Page.html',
                type: 'HTML',
                source: '<html><body>Hello</body></html>',
              },
            ],
          })
        ),
      });

      const result = await handler.handle({
        request: {
          action: 'get_content',
          scriptId: 'script-123',
        },
      });

      expect(result.response.success).toBe(true);
      expect(result.response.action).toBe('get_content');
      expect(result.response.files).toBeDefined();
      expect(result.response.files).toHaveLength(2);
      expect(result.response.files[0].name).toBe('Code.gs');
      expect(result.response.files[0].type).toBe('SERVER_JS');
      expect(result.response.files[0].source).toContain('Hello');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://script.googleapis.com/v1/projects/script-123/content',
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('should get specific version content', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        text: vi.fn().mockResolvedValue(
          JSON.stringify({
            scriptId: 'script-123',
            files: [{ name: 'Code.gs', type: 'SERVER_JS', source: 'function test() {}' }],
          })
        ),
      });

      const result = await handler.handle({
        request: {
          action: 'get_content',
          scriptId: 'script-123',
          versionNumber: 5,
        },
      });

      expect(result.response.success).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://script.googleapis.com/v1/projects/script-123/content?versionNumber=5',
        expect.any(Object)
      );
    });

    it('should handle empty file list', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        text: vi.fn().mockResolvedValue(
          JSON.stringify({
            scriptId: 'script-123',
            files: [],
          })
        ),
      });

      const result = await handler.handle({
        request: {
          action: 'get_content',
          scriptId: 'script-123',
        },
      });

      expect(result.response.success).toBe(true);
      expect(result.response.files).toHaveLength(0);
    });

    it('should require scriptId or spreadsheetId', async () => {
      const result = await handler.handle({
        request: {
          action: 'get_content',
        },
      });

      expect(result.response.success).toBe(false);
      expect(result.response.error.code).toBe('INVALID_PARAMS');
      expect(result.response.error.message).toContain('scriptId or spreadsheetId');
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('update_content action', () => {
    it('should update script files', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        text: vi.fn().mockResolvedValue(
          JSON.stringify({
            scriptId: 'script-123',
            files: [
              {
                name: 'Code.gs',
                type: 'SERVER_JS',
                source: 'function updated() { return "Updated"; }',
                updateTime: '2024-01-02T00:00:00Z',
              },
            ],
          })
        ),
      });

      const result = await handler.handle({
        request: {
          action: 'update_content',
          scriptId: 'script-123',
          files: [
            {
              name: 'Code.gs',
              type: 'SERVER_JS',
              source: 'function updated() { return "Updated"; }',
            },
          ],
        },
      });

      expect(result.response.success).toBe(true);
      expect(result.response.action).toBe('update_content');
      expect(result.response.files).toHaveLength(1);
      expect(result.response.files[0].source).toContain('Updated');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://script.googleapis.com/v1/projects/script-123/content',
        expect.objectContaining({
          method: 'PUT',
          body: expect.stringContaining('Code.gs'),
        })
      );
    });

    it('should add new file', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        text: vi.fn().mockResolvedValue(
          JSON.stringify({
            scriptId: 'script-123',
            files: [
              { name: 'Code.gs', type: 'SERVER_JS', source: 'function test() {}' },
              { name: 'New.html', type: 'HTML', source: '<html></html>' },
            ],
          })
        ),
      });

      const result = await handler.handle({
        request: {
          action: 'update_content',
          scriptId: 'script-123',
          files: [
            { name: 'Code.gs', type: 'SERVER_JS', source: 'function test() {}' },
            { name: 'New.html', type: 'HTML', source: '<html></html>' },
          ],
        },
      });

      expect(result.response.success).toBe(true);
      expect(result.response.files).toHaveLength(2);
    });

    it('should handle update error', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        text: vi.fn().mockResolvedValue(JSON.stringify({ error: { message: 'Invalid syntax' } })),
      });

      const result = await handler.handle({
        request: {
          action: 'update_content',
          scriptId: 'script-123',
          files: [{ name: 'Code.gs', type: 'SERVER_JS', source: 'invalid{' }],
        },
      });

      expect(result.response.success).toBe(false);
      expect(result.response.error.code).toBe('INVALID_PARAMS');
    });

    it('should require scriptId or spreadsheetId', async () => {
      const result = await handler.handle({
        request: {
          action: 'update_content',
          files: [{ name: 'Code.gs', type: 'SERVER_JS', source: 'function test() {}' }],
        },
      });

      expect(result.response.success).toBe(false);
      expect(result.response.error.code).toBe('INVALID_PARAMS');
      expect(result.response.error.message).toContain('scriptId or spreadsheetId');
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // Version Management Actions
  // ===========================================================================

  describe('create_version action', () => {
    it('should create version snapshot', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        text: vi.fn().mockResolvedValue(
          JSON.stringify({
            versionNumber: 1,
            description: 'First version',
            createTime: '2024-01-01T00:00:00Z',
          })
        ),
      });

      const result = await handler.handle({
        request: {
          action: 'create_version',
          scriptId: 'script-123',
          description: 'First version',
        },
      });

      expect(result.response.success).toBe(true);
      expect(result.response.action).toBe('create_version');
      expect(result.response.version).toBeDefined();
      expect(result.response.version.versionNumber).toBe(1);
      expect(result.response.version.description).toBe('First version');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://script.googleapis.com/v1/projects/script-123/versions',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ description: 'First version' }),
        })
      );
    });

    it('should create version without description', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        text: vi.fn().mockResolvedValue(
          JSON.stringify({
            versionNumber: 2,
            createTime: '2024-01-01T00:00:00Z',
          })
        ),
      });

      const result = await handler.handle({
        request: {
          action: 'create_version',
          scriptId: 'script-123',
        },
      });

      expect(result.response.success).toBe(true);
      expect(result.response.version.versionNumber).toBe(2);
      expect(result.response.version.description).toBeUndefined();
    });
  });

  describe('list_versions action', () => {
    it('should list all versions', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        text: vi.fn().mockResolvedValue(
          JSON.stringify({
            versions: [
              { versionNumber: 1, description: 'First', createTime: '2024-01-01T00:00:00Z' },
              { versionNumber: 2, description: 'Second', createTime: '2024-01-02T00:00:00Z' },
            ],
          })
        ),
      });

      const result = await handler.handle({
        request: {
          action: 'list_versions',
          scriptId: 'script-123',
        },
      });

      expect(result.response.success).toBe(true);
      expect(result.response.action).toBe('list_versions');
      expect(result.response.versions).toHaveLength(2);
      expect(result.response.versions[0].versionNumber).toBe(1);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://script.googleapis.com/v1/projects/script-123/versions',
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('should support pagination', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        text: vi.fn().mockResolvedValue(
          JSON.stringify({
            versions: [{ versionNumber: 1 }],
            nextPageToken: 'token-abc',
          })
        ),
      });

      const result = await handler.handle({
        request: {
          action: 'list_versions',
          scriptId: 'script-123',
          pageSize: 1,
          pageToken: 'token-xyz',
        },
      });

      expect(result.response.success).toBe(true);
      expect(result.response.nextPageToken).toBe('token-abc');
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('pageSize=1'),
        expect.any(Object)
      );
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('pageToken=token-xyz'),
        expect.any(Object)
      );
    });
  });

  describe('get_version action', () => {
    it('should get specific version', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        text: vi.fn().mockResolvedValue(
          JSON.stringify({
            versionNumber: 3,
            description: 'Third version',
            createTime: '2024-01-03T00:00:00Z',
          })
        ),
      });

      const result = await handler.handle({
        request: {
          action: 'get_version',
          scriptId: 'script-123',
          versionNumber: 3,
        },
      });

      expect(result.response.success).toBe(true);
      expect(result.response.action).toBe('get_version');
      expect(result.response.version.versionNumber).toBe(3);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://script.googleapis.com/v1/projects/script-123/versions/3',
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('should handle version not found', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: vi
          .fn()
          .mockResolvedValue(JSON.stringify({ error: { message: 'Version not found' } })),
      });

      const result = await handler.handle({
        request: {
          action: 'get_version',
          scriptId: 'script-123',
          versionNumber: 999,
        },
      });

      expect(result.response.success).toBe(false);
      expect(result.response.error.code).toBe('NOT_FOUND');
    });
  });

  // ===========================================================================
  // Deployment Management Actions
  // ===========================================================================

  describe('deploy action', () => {
    it('should create deployment', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        text: vi.fn().mockResolvedValue(
          JSON.stringify({
            deploymentId: 'deployment-123',
            deploymentConfig: {
              versionNumber: 1,
              description: 'Production',
              scriptId: 'script-123',
            },
            entryPoints: [
              {
                entryPointType: 'WEB_APP',
                webApp: {
                  url: 'https://script.google.com/macros/s/abc123/exec',
                  entryPointConfig: {
                    access: 'ANYONE_ANONYMOUS',
                    executeAs: 'USER_DEPLOYING',
                  },
                },
              },
            ],
            updateTime: '2024-01-01T00:00:00Z',
          })
        ),
      });

      const result = await handler.handle({
        request: {
          action: 'deploy',
          scriptId: 'script-123',
          versionNumber: 1,
          description: 'Production',
        },
      });

      expect(result.response.success).toBe(true);
      expect(result.response.action).toBe('deploy');
      expect(result.response.deployment).toBeDefined();
      expect(result.response.deployment.deploymentId).toBe('deployment-123');
      expect(result.response.webAppUrl).toBe('https://script.google.com/macros/s/abc123/exec');

      const deployRequest = mockFetch.mock.calls[0]?.[1] as { body?: string } | undefined;
      expect(deployRequest?.body).toBeDefined();
      expect(JSON.parse(deployRequest!.body!)).toEqual({
        versionNumber: 1,
        description: 'Production',
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://script.googleapis.com/v1/projects/script-123/deployments',
        expect.objectContaining({
          method: 'POST',
          body: expect.any(String),
        })
      );
    });

    it('should deploy without version (HEAD)', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        text: vi.fn().mockResolvedValue(
          JSON.stringify({
            deploymentId: 'deployment-456',
            deploymentConfig: { scriptId: 'script-123' },
          })
        ),
      });

      const result = await handler.handle({
        request: {
          action: 'deploy',
          scriptId: 'script-123',
        },
      });

      expect(result.response.success).toBe(true);
      expect(result.response.deployment.deploymentId).toBe('deployment-456');
    });

    it('should handle deployment error', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        text: vi
          .fn()
          .mockResolvedValue(JSON.stringify({ error: { message: 'Insufficient Permission' } })),
      });

      const result = await handler.handle({
        request: {
          action: 'deploy',
          scriptId: 'script-123',
        },
      });

      expect(result.response.success).toBe(false);
      expect(result.response.error.code).toBe('PERMISSION_DENIED');
    });
  });

  describe('list_deployments action', () => {
    it('should list deployments', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        text: vi.fn().mockResolvedValue(
          JSON.stringify({
            deployments: [
              {
                deploymentId: 'deployment-1',
                deploymentConfig: { versionNumber: 1 },
                updateTime: '2024-01-01T00:00:00Z',
              },
              {
                deploymentId: 'deployment-2',
                deploymentConfig: { versionNumber: 2 },
                updateTime: '2024-01-02T00:00:00Z',
              },
            ],
          })
        ),
      });

      const result = await handler.handle({
        request: {
          action: 'list_deployments',
          scriptId: 'script-123',
        },
      });

      expect(result.response.success).toBe(true);
      expect(result.response.action).toBe('list_deployments');
      expect(result.response.deployments).toHaveLength(2);
      expect(result.response.deployments[0].deploymentId).toBe('deployment-1');
    });

    it('should support pagination', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        text: vi.fn().mockResolvedValue(
          JSON.stringify({
            deployments: [{ deploymentId: 'deployment-1' }],
            nextPageToken: 'token-next',
          })
        ),
      });

      const result = await handler.handle({
        request: {
          action: 'list_deployments',
          scriptId: 'script-123',
          pageSize: 10,
        },
      });

      expect(result.response.success).toBe(true);
      expect(result.response.nextPageToken).toBe('token-next');
    });
  });

  describe('get_deployment action', () => {
    it('should get deployment details', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        text: vi.fn().mockResolvedValue(
          JSON.stringify({
            deploymentId: 'deployment-123',
            deploymentConfig: {
              versionNumber: 1,
              description: 'Production',
            },
            entryPoints: [
              {
                entryPointType: 'EXECUTION_API',
                executionApi: {
                  entryPointConfig: {
                    access: 'DOMAIN',
                  },
                },
              },
            ],
            updateTime: '2024-01-01T00:00:00Z',
          })
        ),
      });

      const result = await handler.handle({
        request: {
          action: 'get_deployment',
          scriptId: 'script-123',
          deploymentId: 'deployment-123',
        },
      });

      expect(result.response.success).toBe(true);
      expect(result.response.action).toBe('get_deployment');
      expect(result.response.deployment.deploymentId).toBe('deployment-123');
      expect(result.response.deployment.entryPoints).toHaveLength(1);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://script.googleapis.com/v1/projects/script-123/deployments/deployment-123',
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('should handle deployment not found', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: vi
          .fn()
          .mockResolvedValue(JSON.stringify({ error: { message: 'Deployment not found' } })),
      });

      const result = await handler.handle({
        request: {
          action: 'get_deployment',
          scriptId: 'script-123',
          deploymentId: 'nonexistent',
        },
      });

      expect(result.response.success).toBe(false);
      expect(result.response.error.code).toBe('NOT_FOUND');
    });
  });

  describe('undeploy action', () => {
    it('should delete deployment', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        text: vi.fn().mockResolvedValue(''), // DELETE returns empty body
      });

      const result = await handler.handle({
        request: {
          action: 'undeploy',
          scriptId: 'script-123',
          deploymentId: 'deployment-123',
        },
      });

      expect(result.response.success).toBe(true);
      expect(result.response.action).toBe('undeploy');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://script.googleapis.com/v1/projects/script-123/deployments/deployment-123',
        expect.objectContaining({ method: 'DELETE' })
      );
    });

    it('should handle deletion error', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: vi
          .fn()
          .mockResolvedValue(JSON.stringify({ error: { message: 'Deployment not found' } })),
      });

      const result = await handler.handle({
        request: {
          action: 'undeploy',
          scriptId: 'script-123',
          deploymentId: 'nonexistent',
        },
      });

      expect(result.response.success).toBe(false);
      expect(result.response.error.code).toBe('NOT_FOUND');
    });
  });

  describe('install_serval_function action', () => {
    it('rejects callback URLs with invalid protocols before making API calls', async () => {
      const result = await handler.handle({
        request: {
          action: 'install_serval_function',
          spreadsheetId: 'sheet-123',
          callbackUrl: 'javascript:alert(1)',
        },
      });

      expect(result.response.success).toBe(false);
      expect(result.response.error.code).toBe('VALIDATION_ERROR');
      expect(result.response.error.message).toContain('callbackUrl must use');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('rejects callback URLs with characters that could break script source', async () => {
      const result = await handler.handle({
        request: {
          action: 'install_serval_function',
          spreadsheetId: 'sheet-123',
          callbackUrl: "https://example.com/o'hai",
        },
      });

      expect(result.response.success).toBe(false);
      expect(result.response.error.code).toBe('VALIDATION_ERROR');
      expect(result.response.error.message).toContain('invalid characters');
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // Execution Actions
  // ===========================================================================

  describe('run action', () => {
    it('should respect request-scoped cancellation before execution starts', async () => {
      const abortController = new AbortController();
      abortController.abort('cancelled in test');

      const result = await runWithRequestContext(
        createRequestContext({
          requestId: 'appsscript-cancel-test',
          abortSignal: abortController.signal,
        }),
        () =>
          handler.handle({
            request: {
              action: 'run',
              scriptId: 'script-123',
              functionName: 'myFunction',
            },
          })
      );

      expect(result.response.success).toBe(false);
      expect(result.response.error.code).toBe('CANCELLED');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should execute function successfully', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        text: vi.fn().mockResolvedValue(
          JSON.stringify({
            done: true,
            response: {
              '@type': 'type.googleapis.com/google.apps.script.v1.ExecutionResponse',
              result: 'Hello World',
            },
          })
        ),
      });

      const result = await handler.handle({
        request: {
          action: 'run',
          scriptId: 'script-123',
          deploymentId: 'deployment-123',
          functionName: 'myFunction',
        },
      });

      expect(result.response.success).toBe(true);
      expect(result.response.action).toBe('run');
      expect(result.response.result).toBe('Hello World');
      expect(result.response.executionError).toBeUndefined();

      expect(mockFetch).toHaveBeenCalledWith(
        'https://script.googleapis.com/v1/scripts/deployment-123:run',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ function: 'myFunction' }),
        })
      );
    });

    it('should execute function with parameters', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        text: vi.fn().mockResolvedValue(
          JSON.stringify({
            done: true,
            response: {
              result: { sum: 15 },
            },
          })
        ),
      });

      const result = await handler.handle({
        request: {
          action: 'run',
          scriptId: 'script-123',
          deploymentId: 'deployment-123',
          functionName: 'add',
          parameters: [10, 5],
        },
      });

      expect(result.response.success).toBe(true);
      expect(result.response.result).toEqual({ sum: 15 });
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('"parameters":[10,5]'),
        })
      );
    });

    it('should run in dev mode', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        text: vi.fn().mockResolvedValue(
          JSON.stringify({
            done: true,
            response: { result: 'dev result' },
          })
        ),
      });

      const result = await handler.handle({
        request: {
          action: 'run',
          scriptId: 'script-123',
          functionName: 'testFunction',
          devMode: true,
        },
      });

      expect(result.response.success).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('"devMode":true'),
        })
      );
    });

    it('fails fast when deploymentId is missing outside dev mode', async () => {
      const result = await handler.handle({
        request: {
          action: 'run',
          scriptId: 'script-123',
          functionName: 'myFunction',
        },
      });

      expect(result.response.success).toBe(false);
      expect(result.response.error.code).toBe('FAILED_PRECONDITION');
      expect(result.response.error.message).toContain('deploymentId');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should handle script execution error', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        text: vi.fn().mockResolvedValue(
          JSON.stringify({
            done: true,
            error: {
              code: 3,
              message: 'Script error occurred',
              details: [
                {
                  '@type': 'type.googleapis.com/google.apps.script.v1.ScriptError',
                  errorMessage: 'ReferenceError: x is not defined',
                  errorType: 'ScriptError',
                  scriptStackTraceElements: [
                    {
                      function: 'myFunction',
                      lineNumber: 5,
                    },
                  ],
                },
              ],
            },
          })
        ),
      });

      const result = await handler.handle({
        request: {
          action: 'run',
          scriptId: 'script-123',
          deploymentId: 'deployment-123',
          functionName: 'myFunction',
        },
      });

      expect(result.response.success).toBe(true); // Script runs successfully, but has execution error
      expect(result.response.result).toBeUndefined();
      expect(result.response.executionError).toBeDefined();
      expect(result.response.executionError.errorMessage).toBe('ReferenceError: x is not defined');
      expect(result.response.executionError.errorType).toBe('ScriptError');
      expect(result.response.executionError.scriptStackTraceElements).toHaveLength(1);
    });

    it('should handle API error (not script error)', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: vi
          .fn()
          .mockResolvedValue(JSON.stringify({ error: { message: 'Internal server error' } })),
      });

      const result = await handler.handle({
        request: {
          action: 'run',
          scriptId: 'script-123',
          deploymentId: 'deployment-123',
          functionName: 'myFunction',
        },
      });

      expect(result.response.success).toBe(false);
      expect(result.response.error).toBeDefined();
      expect(result.response.error.code).toBe('UNAVAILABLE');
      expect(result.response.error.retryable).toBe(true);
    });
  });

  describe('list_processes action', () => {
    it('should list all processes', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        text: vi.fn().mockResolvedValue(
          JSON.stringify({
            processes: [
              {
                processId: 'process-1',
                projectName: 'My Script',
                functionName: 'myFunction',
                processType: 'WEBAPP',
                processStatus: 'COMPLETED',
                startTime: '2024-01-01T00:00:00Z',
                duration: '1.5s',
                userAccessLevel: 'OWNER',
              },
              {
                processId: 'process-2',
                projectName: 'My Script',
                functionName: 'anotherFunction',
                processType: 'API_EXECUTABLE',
                processStatus: 'FAILED',
                startTime: '2024-01-01T01:00:00Z',
                duration: '0.8s',
              },
            ],
          })
        ),
      });

      const result = await handler.handle({
        request: {
          action: 'list_processes',
        },
      });

      expect(result.response.success).toBe(true);
      expect(result.response.action).toBe('list_processes');
      expect(result.response.processes).toHaveLength(2);
      expect(result.response.processes[0].processId).toBe('process-1');
      expect(result.response.processes[0].processStatus).toBe('COMPLETED');
    });

    it('should filter by scriptId', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        text: vi.fn().mockResolvedValue(
          JSON.stringify({
            processes: [{ processId: 'process-1', projectName: 'My Script' }],
          })
        ),
      });

      const result = await handler.handle({
        request: {
          action: 'list_processes',
          scriptId: 'script-123',
        },
      });

      expect(result.response.success).toBe(true);
      // BUG-5 fix: list_processes now uses project-scoped endpoint instead of query param
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/projects/script-123/processes'),
        expect.objectContaining({
          method: 'GET',
        })
      );
    });

    it('should filter by function name and process type', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        text: vi.fn().mockResolvedValue(JSON.stringify({ processes: [] })),
      });

      const result = await handler.handle({
        request: {
          action: 'list_processes',
          functionName: 'myFunction',
          processType: 'WEBAPP',
        },
      });

      expect(result.response.success).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('scriptProcessFilter.functionName=myFunction'),
        expect.objectContaining({
          method: 'GET',
        })
      );
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('scriptProcessFilter.types=WEBAPP'),
        expect.objectContaining({
          method: 'GET',
        })
      );
    });

    it('should support pagination', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        text: vi.fn().mockResolvedValue(
          JSON.stringify({
            processes: [{ processId: 'process-1' }],
            nextPageToken: 'token-next',
          })
        ),
      });

      const result = await handler.handle({
        request: {
          action: 'list_processes',
          pageSize: 50,
          pageToken: 'token-prev',
        },
      });

      expect(result.response.success).toBe(true);
      expect(result.response.nextPageToken).toBe('token-next');
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('pageSize=50'),
        expect.objectContaining({
          method: 'GET',
        })
      );
    });
  });

  describe('get_metrics action', () => {
    it('should get usage metrics', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        text: vi.fn().mockResolvedValue(
          JSON.stringify({
            activeUsers: [{ value: '150' }],
            totalExecutions: [{ value: '1234' }],
            failedExecutions: [{ value: '45' }],
          })
        ),
      });

      const result = await handler.handle({
        request: {
          action: 'get_metrics',
          scriptId: 'script-123',
        },
      });

      expect(result.response.success).toBe(true);
      expect(result.response.action).toBe('get_metrics');
      expect(result.response.metrics).toBeDefined();
      expect(result.response.metrics.activeUsers).toHaveLength(1);
      expect(result.response.metrics.totalExecutions).toHaveLength(1);
      expect(result.response.metrics.failedExecutions).toHaveLength(1);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://script.googleapis.com/v1/projects/script-123/metrics',
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('should filter metrics by deployment and granularity', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        text: vi.fn().mockResolvedValue(
          JSON.stringify({
            activeUsers: [{ value: '50' }],
            totalExecutions: [{ value: '500' }],
          })
        ),
      });

      const result = await handler.handle({
        request: {
          action: 'get_metrics',
          scriptId: 'script-123',
          deploymentId: 'deployment-456',
          granularity: 'DAILY',
        },
      });

      expect(result.response.success).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('metricsGranularity=DAILY'),
        expect.any(Object)
      );
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('metricsFilter.deploymentId=deployment-456'),
        expect.any(Object)
      );
    });

    it('should handle empty metrics', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        text: vi.fn().mockResolvedValue(JSON.stringify({})),
      });

      const result = await handler.handle({
        request: {
          action: 'get_metrics',
          scriptId: 'script-123',
        },
      });

      expect(result.response.success).toBe(true);
      expect(result.response.metrics.activeUsers).toBeUndefined();
    });
  });

  describe('trigger actions', () => {
    it('auto-resolves scriptId from spreadsheetId before listing triggers', async () => {
      mockGoogleClient.drive.files.list.mockResolvedValueOnce({
        data: {
          files: [{ id: 'script-from-drive', name: 'Bound Script' }],
        },
      });

      const result = await handler.handle({
        request: {
          action: 'list_triggers',
          spreadsheetId: 'sheet-for-trigger-resolution',
        },
      });

      expect(mockGoogleClient.drive.files.list).toHaveBeenCalledWith(
        expect.objectContaining({
          q: expect.stringContaining("'sheet-for-trigger-resolution' in parents"),
        })
      );
      expect(result.response.success).toBe(false);
      expect(result.response.error.code).toBe('NOT_IMPLEMENTED');
      expect(result.response.error.message).toContain('Trigger management');
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // Authentication & Error Handling
  // ===========================================================================

  describe('authentication', () => {
    it('should require authentication', async () => {
      const contextWithoutAuth: HandlerContext = {
        googleClient: undefined,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Incomplete context for auth test
      } as any;
      const handlerWithoutAuth = new SheetsAppsScriptHandler(contextWithoutAuth);

      // requireAuth() throws before the try-catch, so we expect it to throw
      await expect(
        handlerWithoutAuth.handle({
          request: {
            action: 'get',
            scriptId: 'script-123',
          },
        })
      ).rejects.toThrow();
    });

    it('should handle missing access token', async () => {
      const contextWithoutToken: HandlerContext = {
        googleClient: {
          oauth2: { credentials: {} },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Mock client for auth test
        } as any,
      };
      const handlerWithoutToken = new SheetsAppsScriptHandler(contextWithoutToken);

      mockFetch.mockResolvedValue({
        ok: true,
        text: vi.fn().mockResolvedValue(JSON.stringify({ scriptId: 'script-123' })),
      });

      const result = await handlerWithoutToken.handle({
        request: {
          action: 'get',
          scriptId: 'script-123',
        },
      });

      expect(result.response.success).toBe(false);
      expect(result.response.error.code).toBe('AUTH_ERROR');
      expect(result.response.error.retryable).toBe(true);
    });

    it('should handle 401 unauthorized', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        text: vi.fn().mockResolvedValue(JSON.stringify({ error: { message: 'Invalid token' } })),
      });

      const result = await handler.handle({
        request: {
          action: 'get',
          scriptId: 'script-123',
        },
      });

      expect(result.response.success).toBe(false);
      expect(result.response.error.code).toBe('AUTH_ERROR');
      expect(result.response.error.retryable).toBe(true);
      expect(result.response.error.message).toContain('Authentication failed');
    });
  });

  describe('API error handling', () => {
    it('should handle API not enabled (403)', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        text: vi
          .fn()
          .mockResolvedValue(
            JSON.stringify({ error: { message: 'script.googleapis.com has not been used' } })
          ),
      });

      const result = await handler.handle({
        request: {
          action: 'create',
          title: 'Test',
        },
      });

      expect(result.response.success).toBe(false);
      expect(result.response.error.code).toBe('SERVICE_NOT_ENABLED');
      expect(result.response.error.message).toContain('Apps Script API is not enabled');
      expect(result.response.error.message).toContain('has not been used');
      expect(result.response.error.retryable).toBe(false);
    });

    it('should handle insufficient permissions (403)', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        text: vi
          .fn()
          .mockResolvedValue(JSON.stringify({ error: { message: 'Insufficient Permission' } })),
      });

      const result = await handler.handle({
        request: {
          action: 'run',
          scriptId: 'script-123',
          deploymentId: 'deployment-123',
          functionName: 'test',
        },
      });

      expect(result.response.success).toBe(false);
      expect(result.response.error.code).toBe('PERMISSION_DENIED');
      expect(result.response.error.message).toContain('Insufficient OAuth permissions');
      expect(result.response.error.message).toContain('Insufficient Permission');
      expect(result.response.error.retryable).toBe(true);
    });

    it('should handle 429 rate limit with Retry-After header', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        headers: {
          get: vi.fn().mockImplementation((name: string) => (name === 'retry-after' ? '30' : null)),
        },
        text: vi
          .fn()
          .mockResolvedValue(JSON.stringify({ error: { message: 'Rate Limit Exceeded' } })),
      });

      const result = await handler.handle({
        request: {
          action: 'get',
          scriptId: 'script-123',
        },
      });

      expect(result.response.success).toBe(false);
      expect(result.response.error.code).toBe('UNAVAILABLE');
      expect(result.response.error.retryable).toBe(true);
      expect(result.response.error.message).toContain('rate limit');
    });

    it('should handle server errors (500+)', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        text: vi.fn().mockResolvedValue(JSON.stringify({ error: { message: 'Service down' } })),
      });

      const result = await handler.handle({
        request: {
          action: 'get',
          scriptId: 'script-123',
        },
      });

      expect(result.response.success).toBe(false);
      expect(result.response.error.code).toBe('UNAVAILABLE');
      expect(result.response.error.retryable).toBe(true);
    });
  });

  describe('schema validation', () => {
    it('should validate successful response', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        text: vi.fn().mockResolvedValue(
          JSON.stringify({
            scriptId: 'script-123',
            title: 'Test',
          })
        ),
      });

      const result = await handler.handle({
        request: {
          action: 'get',
          scriptId: 'script-123',
        },
      });

      const parseResult = SheetsAppsScriptOutputSchema.safeParse(result);
      expect(parseResult.success).toBe(true);
    });
  });
});
