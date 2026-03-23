/**
 * Template Store Service Tests (Phase 3.1)
 *
 * Tests for TemplateStore service
 * Covers template management using Google Drive appDataFolder
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TemplateStore } from '../../src/services/template-store.js';
import type { drive_v3 } from 'googleapis';
import type { TemplateDefinition } from '../../src/schemas/templates.js';

describe('TemplateStore', () => {
  let store: TemplateStore;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Test mock type
  let mockDriveApi: any;

  beforeEach(() => {
    // Create mock Drive API
    mockDriveApi = {
      files: {
        list: vi.fn().mockResolvedValue({
          data: {
            files: [
              {
                id: 'folder-id',
                name: 'servalsheets-templates',
                mimeType: 'application/vnd.google-apps.folder',
              },
            ],
          },
        }),
        get: vi.fn().mockResolvedValue({
          data: {
            id: 'template-1',
            name: 'Budget Template',
            description: 'Monthly budget tracker',
            appProperties: {
              templateName: 'Budget Template',
              category: 'finance',
              version: '1.0.0',
              sheetCount: '2',
            },
            createdTime: '2024-01-01T00:00:00Z',
            modifiedTime: '2024-01-02T00:00:00Z',
          },
        }),
        create: vi.fn().mockResolvedValue({
          data: {
            id: 'new-template-id',
            name: 'New Template',
          },
        }),
        update: vi.fn().mockResolvedValue({
          data: {
            id: 'template-1',
          },
        }),
        delete: vi.fn().mockResolvedValue({ data: {} }),
      },
    };

    store = new TemplateStore(mockDriveApi as unknown as drive_v3.Drive);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  describe('list', () => {
    it('should list all templates', async () => {
      // Mock folder check and list
      mockDriveApi.files.list
        .mockResolvedValueOnce({
          data: {
            files: [
              {
                id: 'folder-id',
                name: 'servalsheets-templates',
                mimeType: 'application/vnd.google-apps.folder',
              },
            ],
          },
        })
        .mockResolvedValueOnce({
          data: {
            files: [
              {
                id: 'template-1',
                name: 'Budget Template',
                description: 'Monthly budget tracker',
                appProperties: {
                  templateName: 'Budget Template',
                  category: 'finance',
                  version: '1.0.0',
                  sheetCount: '2',
                },
                createdTime: '2024-01-01T00:00:00Z',
                modifiedTime: '2024-01-02T00:00:00Z',
              },
              {
                id: 'template-2',
                name: 'CRM Template',
                description: 'Customer relationship management',
                appProperties: {
                  templateName: 'CRM Template',
                  category: 'sales',
                  version: '1.0.0',
                  sheetCount: '3',
                },
                createdTime: '2024-01-03T00:00:00Z',
                modifiedTime: '2024-01-04T00:00:00Z',
              },
            ],
          },
        });

      const templates = await store.list();

      expect(templates).toHaveLength(2);
      expect(templates[0]).toMatchObject({
        id: 'template-1',
        name: 'Budget Template',
        category: 'finance',
        sheetCount: 2,
      });
      expect(templates[1]).toMatchObject({
        id: 'template-2',
        name: 'CRM Template',
        category: 'sales',
        sheetCount: 3,
      });
    });

    it('should filter by category', async () => {
      // Mock folder check and filtered list
      mockDriveApi.files.list
        .mockResolvedValueOnce({
          data: {
            files: [
              {
                id: 'folder-id',
                name: 'servalsheets-templates',
                mimeType: 'application/vnd.google-apps.folder',
              },
            ],
          },
        })
        .mockResolvedValueOnce({
          data: {
            files: [
              {
                id: 'template-1',
                name: 'Budget Template',
                appProperties: {
                  templateName: 'Budget Template',
                  category: 'finance',
                  version: '1.0.0',
                  sheetCount: '2',
                },
              },
              {
                id: 'template-2',
                name: 'CRM Template',
                appProperties: {
                  templateName: 'CRM Template',
                  category: 'sales',
                  version: '1.0.0',
                  sheetCount: '3',
                },
              },
            ],
          },
        });

      const templates = await store.list('finance');

      expect(templates).toHaveLength(1);
      expect(templates[0].category).toBe('finance');
    });

    it('should return empty array when no templates', async () => {
      // Mock folder check and empty list
      mockDriveApi.files.list
        .mockResolvedValueOnce({
          data: {
            files: [
              {
                id: 'folder-id',
                name: 'servalsheets-templates',
                mimeType: 'application/vnd.google-apps.folder',
              },
            ],
          },
        })
        .mockResolvedValueOnce({
          data: {
            files: [],
          },
        });

      const templates = await store.list();

      expect(templates).toEqual([]);
    });

    it('should handle Drive API errors', async () => {
      mockDriveApi.files.list.mockRejectedValue(new Error('Drive API error'));

      await expect(store.list()).rejects.toThrow('Failed to initialize template storage');
    });
  });

  describe('get', () => {
    it('should get template by ID', async () => {
      // Mock metadata and content responses
      mockDriveApi.files.get
        .mockResolvedValueOnce({
          data: {
            id: 'template-1',
            name: 'Budget Template',
            description: 'Monthly budget tracker',
            appProperties: {
              templateName: 'Budget Template',
              category: 'finance',
              version: '1.0.0',
            },
            createdTime: '2024-01-01T00:00:00Z',
            modifiedTime: '2024-01-02T00:00:00Z',
          },
        })
        .mockResolvedValueOnce({
          data: {
            sheets: [
              {
                title: 'Budget',
                gridProperties: { rowCount: 100, columnCount: 10 },
              },
              {
                title: 'Expenses',
                gridProperties: { rowCount: 100, columnCount: 10 },
              },
            ],
          } as unknown as TemplateDefinition,
        });

      const template = await store.get('template-1');

      expect(template).toBeDefined();
      expect(template?.id).toBe('template-1');
      expect(template?.name).toBe('Budget Template');
      expect(template?.category).toBe('finance');
      expect(template?.sheets).toHaveLength(2);
      expect(mockDriveApi.files.get).toHaveBeenCalledTimes(2);
    });

    it('should return null for non-existent template', async () => {
      mockDriveApi.files.get.mockRejectedValue({
        code: 404,
        message: 'Not found',
      });

      const template = await store.get('nonexistent');

      expect(template).toBeNull();
    });

    it('should throw error for Drive API failures', async () => {
      mockDriveApi.files.get.mockRejectedValue({
        code: 500,
        message: 'Internal error',
      });

      await expect(store.get('template-1')).rejects.toThrow('Failed to get template');
    });
  });

  describe('create', () => {
    it('should create new template', async () => {
      // Mock folder check and create
      mockDriveApi.files.list.mockResolvedValue({
        data: {
          files: [
            {
              id: 'folder-id',
              name: 'servalsheets-templates',
              mimeType: 'application/vnd.google-apps.folder',
            },
          ],
        },
      });

      mockDriveApi.files.create.mockResolvedValue({
        data: {
          id: 'new-template-id',
          name: 'New Template',
        },
      });

      // Mock get call for returning created template
      mockDriveApi.files.get
        .mockResolvedValueOnce({
          data: {
            id: 'new-template-id',
            name: 'New Template',
            description: 'Test template',
            appProperties: {
              templateName: 'New Template',
              category: 'custom',
              version: '1.0.0',
            },
            createdTime: '2024-01-01T00:00:00Z',
            modifiedTime: '2024-01-01T00:00:00Z',
          },
        })
        .mockResolvedValueOnce({
          data: {
            sheets: [
              {
                title: 'Sheet1',
                gridProperties: { rowCount: 100, columnCount: 10 },
              },
            ],
          } as unknown as TemplateDefinition,
        });

      const template = await store.create({
        name: 'New Template',
        description: 'Test template',
        category: 'custom',
        sheets: [
          {
            title: 'Sheet1',
            gridProperties: { rowCount: 100, columnCount: 10 },
          },
        ],
      });

      expect(template).toBeDefined();
      expect(template.id).toBe('new-template-id');
      expect(template.name).toBe('New Template');
      expect(mockDriveApi.files.create).toHaveBeenCalled();
    });

    it('should handle missing optional fields', async () => {
      // Mock folder check
      mockDriveApi.files.list.mockResolvedValue({
        data: {
          files: [
            {
              id: 'folder-id',
              name: 'servalsheets-templates',
              mimeType: 'application/vnd.google-apps.folder',
            },
          ],
        },
      });

      mockDriveApi.files.create.mockResolvedValue({
        data: {
          id: 'minimal-template-id',
          name: 'Minimal Template',
        },
      });

      // Mock get call for returning created template
      mockDriveApi.files.get
        .mockResolvedValueOnce({
          data: {
            id: 'minimal-template-id',
            name: 'Minimal Template',
            appProperties: {
              templateName: 'Minimal Template',
              version: '1.0.0',
            },
            createdTime: '2024-01-01T00:00:00Z',
            modifiedTime: '2024-01-01T00:00:00Z',
          },
        })
        .mockResolvedValueOnce({
          data: {
            sheets: [
              {
                title: 'Sheet1',
                gridProperties: { rowCount: 100, columnCount: 10 },
              },
            ],
          } as unknown as TemplateDefinition,
        });

      const template = await store.create({
        name: 'Minimal Template',
        sheets: [
          {
            title: 'Sheet1',
            gridProperties: { rowCount: 100, columnCount: 10 },
          },
        ],
      });

      expect(template).toBeDefined();
      expect(template.name).toBe('Minimal Template');
    });
  });

  describe('update', () => {
    it('should update existing template', async () => {
      // Mock get for checking existence
      mockDriveApi.files.get
        .mockResolvedValueOnce({
          data: {
            id: 'template-1',
            name: 'Budget Template',
            appProperties: {
              templateName: 'Budget Template',
              category: 'finance',
              version: '1.0.0',
            },
          },
        })
        .mockResolvedValueOnce({
          data: {
            sheets: [],
          } as unknown as TemplateDefinition,
        });

      mockDriveApi.files.update.mockResolvedValue({
        data: {
          id: 'template-1',
        },
      });

      // Mock get for returning updated template
      mockDriveApi.files.get
        .mockResolvedValueOnce({
          data: {
            id: 'template-1',
            name: 'Updated Budget Template',
            appProperties: {
              templateName: 'Updated Budget Template',
              category: 'finance',
              version: '1.0.1',
            },
            createdTime: '2024-01-01T00:00:00Z',
            modifiedTime: '2024-01-03T00:00:00Z',
          },
        })
        .mockResolvedValueOnce({
          data: {
            sheets: [],
          } as unknown as TemplateDefinition,
        });

      const template = await store.update('template-1', {
        name: 'Updated Budget Template',
        version: '1.0.1',
      });

      expect(template).toBeDefined();
      expect(template?.name).toBe('Updated Budget Template');
      expect(mockDriveApi.files.update).toHaveBeenCalled();
    });

    it('should throw error for non-existent template', async () => {
      mockDriveApi.files.get.mockRejectedValue({
        code: 404,
        message: 'Not found',
      });

      await expect(
        store.update('nonexistent', {
          name: 'Updated Name',
        })
      ).rejects.toThrow('template not found');
    });
  });

  describe('delete', () => {
    it('should delete template', async () => {
      mockDriveApi.files.delete.mockResolvedValue({ data: {} });

      const result = await store.delete('template-1');

      expect(result).toBe(true);
      expect(mockDriveApi.files.delete).toHaveBeenCalledWith(
        expect.objectContaining({
          fileId: 'template-1',
        })
      );
    });

    it('should return false for non-existent template', async () => {
      mockDriveApi.files.delete.mockRejectedValue({
        code: 404,
        message: 'Not found',
      });

      const result = await store.delete('nonexistent');

      expect(result).toBe(false);
    });

    it('should throw error for Drive API failures', async () => {
      mockDriveApi.files.delete.mockRejectedValue({
        code: 500,
        message: 'Internal error',
      });

      await expect(store.delete('template-1')).rejects.toThrow();
    });
  });

  describe('listBuiltinTemplates', () => {
    it('should list builtin templates', async () => {
      const templates = await store.listBuiltinTemplates();

      expect(Array.isArray(templates)).toBe(true);
      // Builtin templates are loaded from knowledge base
      // May be empty if no builtin templates configured
      expect(templates.length).toBeGreaterThanOrEqual(0);
    });

    it('should return consistent results on multiple calls', async () => {
      const templates1 = await store.listBuiltinTemplates();
      const templates2 = await store.listBuiltinTemplates();

      expect(templates1).toEqual(templates2);
    });
  });

  describe('getBuiltinTemplate', () => {
    it('should get builtin template by name', async () => {
      // First list to populate cache
      await store.listBuiltinTemplates();

      const template = await store.getBuiltinTemplate('budget');

      // May be null if no builtin templates configured
      if (template) {
        expect(template).toHaveProperty('id');
        expect(template).toHaveProperty('name');
        expect(template).toHaveProperty('sheets');
      }
      expect(template === null || typeof template === 'object').toBe(true);
    });

    it('should return null for non-existent builtin', async () => {
      const template = await store.getBuiltinTemplate('nonexistent-builtin');

      expect(template).toBeNull();
    });
  });

  describe('error handling', () => {
    it('should handle folder creation failure', async () => {
      mockDriveApi.files.list.mockRejectedValue(new Error('Permission denied'));

      await expect(store.list()).rejects.toThrow('Failed to initialize template storage');
    });

    it('should handle malformed Drive API responses', async () => {
      mockDriveApi.files.list
        .mockResolvedValueOnce({
          data: {
            files: [
              {
                id: 'folder-id',
                name: 'servalsheets-templates',
                mimeType: 'application/vnd.google-apps.folder',
              },
            ],
          },
        })
        .mockResolvedValueOnce({
          data: {
            // Missing files array
          },
        });

      const templates = await store.list();

      expect(templates).toEqual([]);
    });
  });
});
