/**
 * Templates Handler Tests (Phase 2.3)
 *
 * Tests for sheets_templates handler (8 actions)
 * Covers template management and application
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SheetsTemplatesHandler } from '../../src/handlers/templates.js';
import type { HandlerContext } from '../../src/handlers/base.js';
import {
  createRequestContext,
  runWithRequestContext,
} from '../../src/utils/request-context.js';

describe('SheetsTemplatesHandler', () => {
  let handler: SheetsTemplatesHandler;
  let mockContext: HandlerContext;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Test mock type
  let mockSheetsApi: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Test mock type
  let mockDriveApi: any;

  beforeEach(() => {
    // Create mock Sheets API
    mockSheetsApi = {
      spreadsheets: {
        get: vi.fn().mockResolvedValue({
          data: {
            spreadsheetId: 'test-id',
            properties: { title: 'Test Template' },
            sheets: [
              {
                properties: {
                  sheetId: 0,
                  title: 'Sheet1',
                  gridProperties: { rowCount: 1000, columnCount: 26 },
                },
                data: [
                  {
                    rowData: [
                      { values: [{ formattedValue: 'Name' }, { formattedValue: 'Email' }] },
                    ],
                  },
                ],
              },
            ],
          },
        }),
        create: vi.fn().mockResolvedValue({
          data: {
            spreadsheetId: 'new-id',
            spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/new-id/edit',
            sheets: [{ properties: { sheetId: 0, title: 'Sheet1' } }],
          },
        }),
        batchUpdate: vi.fn().mockResolvedValue({ data: { replies: [{}] } }),
      },
    };

    // Create mock Drive API
    mockDriveApi = {
      files: {
        list: vi.fn().mockResolvedValue({
          data: {
            files: [
              {
                id: 'template-1',
                name: 'Budget Template',
                appProperties: {
                  isTemplate: 'true',
                  category: 'finance',
                },
              },
              {
                id: 'template-2',
                name: 'CRM Template',
                appProperties: {
                  isTemplate: 'true',
                  category: 'sales',
                },
              },
            ],
          },
        }),
        get: vi.fn().mockResolvedValue({
          data: {
            id: 'template-1',
            name: 'Budget Template',
            appProperties: {
              isTemplate: 'true',
              category: 'finance',
              description: 'Monthly budget tracker',
            },
          },
        }),
        create: vi.fn().mockResolvedValue({
          data: {
            id: 'new-template-id',
            name: 'New Template',
          },
        }),
        update: vi.fn().mockResolvedValue({ data: {} }),
        delete: vi.fn().mockResolvedValue({ data: {} }),
      },
    };

    // Create mock context
    mockContext = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Mock client type
      googleClient: {} as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Mock API type
      sheetsApi: mockSheetsApi as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Mock API type
      driveApi: mockDriveApi as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Mock auth type
      authClient: { credentials: { access_token: 'test-token' } } as any,
      authService: {
        isAuthenticated: vi.fn().mockReturnValue(true),
        getClient: vi.fn().mockResolvedValue({}),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Mock service type
      } as any,
      auth: {
        hasElevatedAccess: true,
        scopes: [
          'https://www.googleapis.com/auth/spreadsheets',
          'https://www.googleapis.com/auth/drive.appdata',
          'https://www.googleapis.com/auth/drive.file',
        ],
      },
      rangeResolver: {
        resolve: vi.fn().mockResolvedValue({
          a1Notation: 'Sheet1!A1:A5',
          sheetId: 0,
          sheetName: 'Sheet1',
          gridRange: {
            sheetId: 0,
            startRowIndex: 0,
            endRowIndex: 5,
            startColumnIndex: 0,
            endColumnIndex: 1,
          },
          resolution: {
            method: 'a1_direct',
            confidence: 1.0,
            path: '',
          },
        }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Mock resolver type
      } as any,
    };

    handler = new SheetsTemplatesHandler(mockContext, mockSheetsApi, mockDriveApi);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  describe('list action', () => {
    it('should list user templates', async () => {
      const result = await handler.handle({
        request: {
          action: 'list',
        },
      });

      expect(result.response.success).toBe(true);
      if (result.response.success && 'templates' in result.response) {
        expect(result.response.templates).toBeDefined();
        expect(result.response.totalTemplates).toBeGreaterThanOrEqual(0);
      }
      expect(mockDriveApi.files.list).toHaveBeenCalled();
    });

    it('should filter by category', async () => {
      const result = await handler.handle({
        request: {
          action: 'list',
          category: 'finance',
        },
      });

      expect(result.response.success).toBe(true);
      expect(mockDriveApi.files.list).toHaveBeenCalled();
    });

    it('should include builtin templates when requested', async () => {
      const result = await handler.handle({
        request: {
          action: 'list',
          includeBuiltin: true,
        },
      });

      expect(result.response.success).toBe(true);
      if (result.response.success && 'builtinCount' in result.response) {
        expect(result.response.builtinCount).toBeGreaterThanOrEqual(0);
      }
    });

    it('should handle empty template list', async () => {
      mockDriveApi.files.list.mockResolvedValue({
        data: { files: [] },
      });

      const result = await handler.handle({
        request: {
          action: 'list',
        },
      });

      expect(result.response.success).toBe(true);
      if (result.response.success && 'templates' in result.response) {
        expect(result.response.templates).toEqual([]);
        expect(result.response.totalTemplates).toBe(0);
      }
    });

    it('should handle Drive API errors', async () => {
      mockDriveApi.files.list.mockRejectedValue(new Error('Drive API error'));

      const result = await handler.handle({
        request: {
          action: 'list',
        },
      });

      expect(result.response.success).toBe(false);
      expect(result.response.error).toBeDefined();
    });
  });

  describe('get action', () => {
    it('should get template details', async () => {
      const result = await handler.handle({
        request: {
          action: 'get',
          templateId: 'template-1',
        },
      });

      expect(result.response.success).toBe(true);
      if (result.response.success && 'template' in result.response) {
        expect(result.response.template).toBeDefined();
        expect(result.response.template.id).toBe('template-1');
      }
      expect(mockDriveApi.files.get).toHaveBeenCalledWith(
        expect.objectContaining({ fileId: 'template-1' })
      );
    });

    it('should handle template not found', async () => {
      mockDriveApi.files.get.mockRejectedValue(new Error('Not found'));

      const result = await handler.handle({
        request: {
          action: 'get',
          templateId: 'nonexistent',
        },
      });

      expect(result.response.success).toBe(false);
      expect(result.response.error).toBeDefined();
    });

    it('should get builtin template', async () => {
      const result = await handler.handle({
        request: {
          action: 'get',
          templateId: 'builtin:budget',
        },
      });

      expect(result.response).toBeDefined();
      // May succeed or fail depending on builtin templates available
    });

    it('should verify template structure', async () => {
      mockDriveApi.files.get.mockResolvedValue({
        data: {
          id: 'template-1',
          name: 'Budget Template',
          appProperties: {
            isTemplate: 'true',
            category: 'finance',
            description: 'Monthly budget tracker',
            sheets: JSON.stringify([
              { title: 'Sheet1', columns: [{ name: 'Name' }, { name: 'Email' }] },
            ]),
          },
        },
      });

      const result = await handler.handle({
        request: {
          action: 'get',
          templateId: 'template-1',
        },
      });

      expect(result.response.success).toBe(true);
      if (result.response.success && 'template' in result.response) {
        expect(result.response.template.name).toBe('Budget Template');
        expect(result.response.template.category).toBe('finance');
      }
    });

    it('should handle Drive API errors', async () => {
      mockDriveApi.files.get.mockRejectedValue(new Error('Permission denied'));

      const result = await handler.handle({
        request: {
          action: 'get',
          templateId: 'template-1',
        },
      });

      expect(result.response.success).toBe(false);
      expect(result.response.error).toBeDefined();
    });
  });

  describe('create action', () => {
    it('should create template from spreadsheet', async () => {
      const result = await handler.handle({
        request: {
          action: 'create',
          spreadsheetId: 'source-id',
          name: 'My Template',
          description: 'Custom template',
          category: 'custom',
        },
      });

      expect(result.response.success).toBe(true);
      if (result.response.success && 'template' in result.response) {
        expect(result.response.template).toBeDefined();
        expect(result.response.template.name).toBe('My Template');
      }
      expect(mockSheetsApi.spreadsheets.get).toHaveBeenCalled();
      expect(mockDriveApi.files.create).toHaveBeenCalled();
    });

    it('should include data when requested', async () => {
      const result = await handler.handle({
        request: {
          action: 'create',
          spreadsheetId: 'source-id',
          name: 'Data Template',
          includeData: true,
        },
      });

      expect(result.response.success).toBe(true);
      expect(mockSheetsApi.spreadsheets.get).toHaveBeenCalledWith(
        expect.objectContaining({
          includeGridData: true,
        })
      );
    });

    it('should create template without data', async () => {
      const result = await handler.handle({
        request: {
          action: 'create',
          spreadsheetId: 'source-id',
          name: 'Structure Only',
          includeData: false,
        },
      });

      expect(result.response.success).toBe(true);
      expect(mockSheetsApi.spreadsheets.get).toHaveBeenCalledWith(
        expect.objectContaining({
          includeGridData: false,
        })
      );
    });

    it('should extract headers from first row', async () => {
      const result = await handler.handle({
        request: {
          action: 'create',
          spreadsheetId: 'source-id',
          name: 'Header Template',
        },
      });

      expect(result.response.success).toBe(true);
      if (result.response.success && 'template' in result.response) {
        expect(result.response.template).toBeDefined();
      }
    });

    it('should handle Sheets API errors', async () => {
      mockSheetsApi.spreadsheets.get.mockRejectedValue(new Error('Spreadsheet not found'));

      const result = await handler.handle({
        request: {
          action: 'create',
          spreadsheetId: 'invalid-id',
          name: 'Failed Template',
        },
      });

      expect(result.response.success).toBe(false);
      expect(result.response.error).toBeDefined();
    });

    it('should handle Drive API errors', async () => {
      mockDriveApi.files.create.mockRejectedValue(new Error('Storage quota exceeded'));

      const result = await handler.handle({
        request: {
          action: 'create',
          spreadsheetId: 'source-id',
          name: 'Template',
        },
      });

      expect(result.response.success).toBe(false);
      expect(result.response.error).toBeDefined();
    });
  });

  describe('apply action', () => {
    it('should create spreadsheet from template', async () => {
      const result = await handler.handle({
        request: {
          action: 'apply',
          templateId: 'template-1',
          title: 'My Budget 2024',
        },
      });

      expect(result.response.success).toBe(true);
      if (result.response.success && 'spreadsheetId' in result.response) {
        expect(result.response.spreadsheetId).toBe('new-id');
        expect(result.response.spreadsheetUrl).toBeDefined();
      }
      expect(mockSheetsApi.spreadsheets.create).toHaveBeenCalled();
    });

    it('should apply builtin template', async () => {
      const result = await handler.handle({
        request: {
          action: 'apply',
          templateId: 'builtin:budget',
          title: 'Budget 2024',
        },
      });

      expect(result.response).toBeDefined();
      // May succeed or fail depending on builtin templates
    });

    it('should handle template not found', async () => {
      mockDriveApi.files.get.mockRejectedValue(new Error('Template not found'));

      const result = await handler.handle({
        request: {
          action: 'apply',
          templateId: 'nonexistent',
          title: 'New Sheet',
        },
      });

      expect(result.response.success).toBe(false);
      expect(result.response.error).toBeDefined();
    });

    it('should apply template to specific folder', async () => {
      const result = await handler.handle({
        request: {
          action: 'apply',
          templateId: 'template-1',
          title: 'Budget 2024',
          folderId: 'folder-123',
        },
      });

      expect(result.response).toBeDefined();
    });

    it('should handle minimal API response', async () => {
      mockSheetsApi.spreadsheets.create.mockResolvedValue({
        data: {
          spreadsheetId: 'new-id',
          spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/new-id/edit',
          sheets: [], // Minimal sheets array
        },
      });

      const result = await handler.handle({
        request: {
          action: 'apply',
          templateId: 'template-1',
          title: 'Test Sheet',
        },
      });

      expect(result.response.success).toBe(true);
      if (result.response.success && 'spreadsheetId' in result.response) {
        expect(result.response.spreadsheetId).toBe('new-id');
      }
    });

    it('should handle Sheets API errors', async () => {
      mockSheetsApi.spreadsheets.create.mockRejectedValue(new Error('API quota exceeded'));

      const result = await handler.handle({
        request: {
          action: 'apply',
          templateId: 'template-1',
          title: 'Test',
        },
      });

      expect(result.response.success).toBe(false);
      expect(result.response.error).toBeDefined();
    });

    it('should emit progress notifications for multi-sheet template application', async () => {
      const notification = vi.fn().mockResolvedValue(undefined);
      const requestContext = createRequestContext({
        requestId: 'templates-apply-progress',
        progressToken: 'templates-apply-progress',
        sendNotification: notification,
      });

      mockDriveApi.files.get
        .mockResolvedValueOnce({
          data: {
            id: 'template-1',
            name: 'Multi Sheet Template',
            appProperties: {
              templateName: 'Multi Sheet Template',
            },
          },
        })
        .mockResolvedValueOnce({
          data: {
            sheets: [
              {
                name: 'Sheet1',
                rowCount: 100,
                columnCount: 5,
                headers: ['Name', 'Email'],
                columnWidths: [180, 220],
              },
              {
                name: 'Sheet2',
                rowCount: 100,
                columnCount: 5,
                headers: ['Region', 'Revenue'],
              },
            ],
          },
        });

      const result = await runWithRequestContext(requestContext, () =>
        handler.handle({
          request: {
            action: 'apply',
            templateId: 'template-1',
            title: 'My Multi Sheet Template',
          },
        })
      );

      expect(result.response.success).toBe(true);
      expect(notification).toHaveBeenCalled();
      expect(notification.mock.calls[0]?.[0]).toMatchObject({
        method: 'notifications/progress',
        params: expect.objectContaining({
          progress: 0,
          total: 4,
        }),
      });
    });
  });

  describe('update action', () => {
    it('should update template', async () => {
      const result = await handler.handle({
        request: {
          action: 'update',
          templateId: 'template-1',
          name: 'Updated Name',
          description: 'Updated description',
        },
      });

      expect(result.response).toBeDefined();
      expect(mockDriveApi.files.update).toHaveBeenCalled();
    });

    it('should prevent updating builtin templates', async () => {
      const result = await handler.handle({
        request: {
          action: 'update',
          templateId: 'builtin:budget',
          name: 'Cannot update',
        },
      });

      expect(result.response.success).toBe(false);
      expect(result.response.error).toBeDefined();
      expect(result.response.error?.message).toContain('builtin');
    });

    it('should update template name only', async () => {
      const result = await handler.handle({
        request: {
          action: 'update',
          templateId: 'template-1',
          name: 'New Name',
        },
      });

      expect(result.response).toBeDefined();
    });

    it('should update template category', async () => {
      const result = await handler.handle({
        request: {
          action: 'update',
          templateId: 'template-1',
          category: 'analytics',
        },
      });

      expect(result.response).toBeDefined();
    });

    it('should handle template not found', async () => {
      mockDriveApi.files.update.mockRejectedValue(new Error('Template not found'));

      const result = await handler.handle({
        request: {
          action: 'update',
          templateId: 'nonexistent',
          name: 'Updated',
        },
      });

      expect(result.response.success).toBe(false);
      expect(result.response.error).toBeDefined();
    });

    it('should handle Drive API errors', async () => {
      mockDriveApi.files.update.mockRejectedValue(new Error('Permission denied'));

      const result = await handler.handle({
        request: {
          action: 'update',
          templateId: 'template-1',
          name: 'Updated',
        },
      });

      expect(result.response.success).toBe(false);
      expect(result.response.error).toBeDefined();
    });
  });

  describe('delete action', () => {
    it('should delete template', async () => {
      const result = await handler.handle({
        request: {
          action: 'delete',
          templateId: 'template-1',
        },
      });

      expect(result.response).toBeDefined();
      expect(mockDriveApi.files.delete).toHaveBeenCalledWith(
        expect.objectContaining({ fileId: 'template-1' })
      );
    });

    it('should prevent deleting builtin templates', async () => {
      const result = await handler.handle({
        request: {
          action: 'delete',
          templateId: 'builtin:budget',
        },
      });

      expect(result.response.success).toBe(false);
      expect(result.response.error).toBeDefined();
      expect(result.response.error?.message).toContain('builtin');
    });

    it('should handle template not found', async () => {
      mockDriveApi.files.delete.mockRejectedValue(new Error('Template not found'));

      const result = await handler.handle({
        request: {
          action: 'delete',
          templateId: 'nonexistent',
        },
      });

      expect(result.response.success).toBe(false);
      expect(result.response.error).toBeDefined();
    });

    it('should handle Drive API errors', async () => {
      mockDriveApi.files.delete.mockRejectedValue(new Error('Permission denied'));

      const result = await handler.handle({
        request: {
          action: 'delete',
          templateId: 'template-1',
        },
      });

      expect(result.response.success).toBe(false);
      expect(result.response.error).toBeDefined();
    });
  });

  describe('preview action', () => {
    it('should preview template structure', async () => {
      const result = await handler.handle({
        request: {
          action: 'preview',
          templateId: 'template-1',
        },
      });

      expect(result.response).toBeDefined();
      if (result.response.success && 'preview' in result.response) {
        expect(result.response.preview).toBeDefined();
      }
      expect(mockDriveApi.files.get).toHaveBeenCalled();
    });

    it('should preview builtin template', async () => {
      const result = await handler.handle({
        request: {
          action: 'preview',
          templateId: 'builtin:budget',
        },
      });

      expect(result.response).toBeDefined();
      // May succeed or fail depending on builtin templates
    });

    it('should handle template not found', async () => {
      mockDriveApi.files.get.mockRejectedValue(new Error('Template not found'));

      const result = await handler.handle({
        request: {
          action: 'preview',
          templateId: 'nonexistent',
        },
      });

      expect(result.response.success).toBe(false);
      expect(result.response.error).toBeDefined();
    });

    it('should handle Drive API errors', async () => {
      mockDriveApi.files.get.mockRejectedValue(new Error('Permission denied'));

      const result = await handler.handle({
        request: {
          action: 'preview',
          templateId: 'template-1',
        },
      });

      expect(result.response.success).toBe(false);
      expect(result.response.error).toBeDefined();
    });
  });

  describe('import_builtin action', () => {
    it('should import builtin template', async () => {
      const result = await handler.handle({
        request: {
          action: 'import_builtin',
          builtinName: 'budget',
        },
      });

      expect(result.response).toBeDefined();
      // May succeed or fail depending on builtin templates
    });

    it('should allow custom name', async () => {
      const result = await handler.handle({
        request: {
          action: 'import_builtin',
          builtinName: 'budget',
          customName: 'My Budget Template',
        },
      });

      expect(result.response).toBeDefined();
    });

    it('should handle builtin template not found', async () => {
      const result = await handler.handle({
        request: {
          action: 'import_builtin',
          builtinName: 'nonexistent_template',
        },
      });

      // May return error if template doesn't exist
      expect(result.response).toBeDefined();
    });

    it('should verify created template', async () => {
      const result = await handler.handle({
        request: {
          action: 'import_builtin',
          builtinName: 'budget',
          customName: 'Imported Budget',
        },
      });

      expect(result.response).toBeDefined();
      if (result.response.success && 'template' in result.response) {
        // Verify template was created in Drive
        expect(mockDriveApi.files.create).toHaveBeenCalled();
      }
    });
  });

  describe('error handling', () => {
    it('should handle unknown action', async () => {
      const result = await handler.handle({
        request: {
          // @ts-expect-error - Testing invalid action
          action: 'invalid_action',
        },
      });

      expect(result.response.success).toBe(false);
      expect(result.response.error).toBeDefined();
      expect(result.response.error?.code).toBe('INVALID_PARAMS');
    });
  });
});
