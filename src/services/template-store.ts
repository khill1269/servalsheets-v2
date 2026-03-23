/**
 * TemplateStore
 *
 * @purpose Manages spreadsheet templates using Google Drive appDataFolder
 * @category Storage
 * @usage Store, retrieve, and manage user-specific spreadsheet templates
 * @dependencies Google Drive API v3
 * @stateful No - uses Drive API for persistence
 * @singleton No - instantiated per handler
 *
 * Storage location: Google Drive appDataFolder (hidden, user-specific)
 * Required scope: https://www.googleapis.com/auth/drive.appdata
 *
 * @example
 * const store = new TemplateStore(driveApi);
 * const templates = await store.list();
 * const template = await store.get('template-id');
 */

import type { drive_v3 } from 'googleapis';
import { logger } from '../utils/logger.js';
import { NotFoundError, ServiceError } from '../core/errors.js';
import type { TemplateDefinition, TemplateSummary, TemplateSheet } from '../schemas/templates.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { resolveBuiltinTemplatesPath } from '../utils/runtime-paths.js';
import { executeWithRetry } from '../utils/retry.js';

/**
 * Template storage configuration
 */
const TEMPLATES_FOLDER = 'servalsheets-templates';
const TEMPLATE_MIME_TYPE = 'application/json';
const APP_DATA_SPACE = 'appDataFolder';

function deriveBuiltinTemplateId(
  template: Record<string, unknown>,
  file: string,
  index: number
): string {
  if (typeof template['id'] === 'string' && template['id'].trim().length > 0) {
    return template['id'];
  }

  const fileStem = path.basename(file, '.json');
  if (fileStem !== 'common-templates') {
    return fileStem;
  }

  const nameSource =
    typeof template['name'] === 'string' && template['name'].trim().length > 0
      ? template['name']
      : `${fileStem}-${index + 1}`;

  const slug = nameSource
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return slug || `${fileStem}-${index + 1}`;
}

/**
 * Builtin template from knowledge base
 */
export interface BuiltinTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  sheets: TemplateSheet[];
}

/**
 * Template store using Google Drive appDataFolder
 */
export class TemplateStore {
  private driveApi: drive_v3.Drive;
  private folderId: string | null = null;
  private builtinTemplatesCache: Map<string, BuiltinTemplate> | null = null;

  constructor(driveApi: drive_v3.Drive) {
    this.driveApi = driveApi;
  }

  /**
   * List all user templates (with pagination support - P1-4)
   */
  async list(category?: string): Promise<TemplateSummary[]> {
    await this.ensureFolder();

    try {
      const templates: TemplateSummary[] = [];
      let pageToken: string | undefined;

      // Paginate through all template files
      do {
        const response = await executeWithRetry(() =>
          this.driveApi.files.list({
            spaces: APP_DATA_SPACE,
            q: `'${this.folderId}' in parents and mimeType='${TEMPLATE_MIME_TYPE}' and trashed=false`,
            fields:
              'nextPageToken, files(id, name, description, createdTime, modifiedTime, appProperties)',
            pageSize: 100,
            pageToken,
            supportsAllDrives: true,
          })
        );

        const files = response.data.files || [];

        for (const file of files) {
          const appProps = file.appProperties || {};
          const templateCategory = appProps['category'] || '';

          // Apply category filter if provided
          if (category && templateCategory !== category) {
            continue;
          }

          templates.push({
            id: file.id!,
            name: appProps['templateName'] || file.name || 'Unnamed',
            description: file.description || undefined,
            category: templateCategory || undefined,
            version: appProps['version'] || '1.0.0',
            created: file.createdTime || undefined,
            updated: file.modifiedTime || undefined,
            sheetCount: parseInt(appProps['sheetCount'] || '1', 10),
          });
        }

        pageToken = response.data.nextPageToken ?? undefined;
      } while (pageToken);

      logger.debug('Listed templates', { count: templates.length });
      return templates;
    } catch (error) {
      logger.error('Failed to list templates', { error });
      throw new ServiceError(
        `Failed to list templates: ${error instanceof Error ? error.message : String(error)}`,
        'INTERNAL_ERROR',
        'TemplateStore',
        true
      );
    }
  }

  /**
   * Get template by ID
   */
  async get(templateId: string): Promise<TemplateDefinition | null> {
    try {
      // Get file metadata
      const metaResponse = await executeWithRetry(() =>
        this.driveApi.files.get({
          fileId: templateId,
          supportsAllDrives: true,
          fields: 'id, name, description, appProperties, createdTime, modifiedTime',
        })
      );

      // Get file content
      const contentResponse = await executeWithRetry(() =>
        this.driveApi.files.get({
          fileId: templateId,
          supportsAllDrives: true,
          alt: 'media',
        })
      );

      const content = contentResponse.data as unknown as TemplateDefinition;
      const meta = metaResponse.data;
      const appProps = meta.appProperties || {};

      return {
        id: meta.id!,
        name: appProps['templateName'] || meta.name || 'Unnamed',
        description: meta.description || undefined,
        category: appProps['category'] || undefined,
        version: appProps['version'] || '1.0.0',
        created: meta.createdTime || undefined,
        updated: meta.modifiedTime || undefined,
        sheets: content.sheets || [],
        namedRanges: content.namedRanges,
        metadata: content.metadata,
      };
    } catch (error: unknown) {
      const err = error as { code?: number; message?: string };
      if (err.code === 404) {
        return null;
      }
      logger.error('Failed to get template', { templateId, error });
      throw new ServiceError(
        `Failed to get template: ${err.message ?? String(error)}`,
        'INTERNAL_ERROR',
        'TemplateStore',
        true,
        { templateId }
      );
    }
  }

  /**
   * Create new template
   */
  async create(
    template: Omit<TemplateDefinition, 'id' | 'created' | 'updated'>
  ): Promise<TemplateDefinition> {
    await this.ensureFolder();

    const now = new Date().toISOString();
    const fileContent: Omit<TemplateDefinition, 'id' | 'created' | 'updated'> = {
      name: template.name,
      description: template.description,
      category: template.category,
      version: template.version || '1.0.0',
      sheets: template.sheets,
      namedRanges: template.namedRanges,
      metadata: template.metadata,
    };

    try {
      const response = await executeWithRetry(() =>
        this.driveApi.files.create({
          supportsAllDrives: true,
          requestBody: {
            name: `${template.name.replace(/[^a-zA-Z0-9-_]/g, '_')}.json`,
            description: template.description,
            mimeType: TEMPLATE_MIME_TYPE,
            parents: [this.folderId!],
            appProperties: {
              templateName: template.name,
              category: template.category || '',
              version: template.version || '1.0.0',
              sheetCount: String(template.sheets.length),
            },
          },
          media: {
            mimeType: TEMPLATE_MIME_TYPE,
            body: JSON.stringify(fileContent, null, 2),
          },
          fields: 'id, name, createdTime',
        })
      );

      logger.info('Created template', {
        templateId: response.data.id,
        name: template.name,
      });

      return {
        ...fileContent,
        id: response.data.id!,
        created: now,
        updated: now,
      };
    } catch (error) {
      logger.error('Failed to create template', { error });
      throw new ServiceError(
        `Failed to create template: ${error instanceof Error ? error.message : String(error)}`,
        'INTERNAL_ERROR',
        'TemplateStore',
        true
      );
    }
  }

  /**
   * Update existing template
   */
  async update(
    templateId: string,
    updates: Partial<Omit<TemplateDefinition, 'id' | 'created' | 'updated'>>
  ): Promise<TemplateDefinition> {
    // Get existing template
    const existing = await this.get(templateId);
    if (!existing) {
      throw new NotFoundError('template', templateId);
    }

    // Merge updates
    const updated: TemplateDefinition = {
      ...existing,
      name: updates.name ?? existing.name,
      description: updates.description ?? existing.description,
      category: updates.category ?? existing.category,
      version: updates.version ?? existing.version,
      sheets: updates.sheets ?? existing.sheets,
      namedRanges: updates.namedRanges ?? existing.namedRanges,
      metadata: updates.metadata ?? existing.metadata,
      updated: new Date().toISOString(),
    };

    const fileContent = {
      name: updated.name,
      description: updated.description,
      category: updated.category,
      version: updated.version,
      sheets: updated.sheets,
      namedRanges: updated.namedRanges,
      metadata: updated.metadata,
    };

    try {
      await executeWithRetry(() =>
        this.driveApi.files.update({
          fileId: templateId,
          supportsAllDrives: true,
          requestBody: {
            description: updated.description,
            appProperties: {
              templateName: updated.name,
              category: updated.category || '',
              version: updated.version || '1.0.0',
              sheetCount: String(updated.sheets.length),
            },
          },
          media: {
            mimeType: TEMPLATE_MIME_TYPE,
            body: JSON.stringify(fileContent, null, 2),
          },
        })
      );

      logger.info('Updated template', { templateId, name: updated.name });
      return updated;
    } catch (error) {
      logger.error('Failed to update template', { templateId, error });
      throw new ServiceError(
        `Failed to update template: ${error instanceof Error ? error.message : String(error)}`,
        'INTERNAL_ERROR',
        'TemplateStore',
        true,
        { templateId }
      );
    }
  }

  /**
   * Delete template
   */
  async delete(templateId: string): Promise<boolean> {
    try {
      // Note: appDataFolder files cannot be trashed, only permanently deleted
      await executeWithRetry(() =>
        this.driveApi.files.delete({
          fileId: templateId,
          supportsAllDrives: true,
        })
      );

      logger.info('Deleted template', { templateId });
      return true;
    } catch (error: unknown) {
      const err = error as { code?: number; message?: string };
      if (err.code === 404) {
        return false; // Already deleted
      }
      logger.error('Failed to delete template', { templateId, error });
      throw new ServiceError(
        `Failed to delete template: ${err.message ?? String(error)}`,
        'INTERNAL_ERROR',
        'TemplateStore',
        true,
        { templateId }
      );
    }
  }

  /**
   * List builtin templates from knowledge base
   */
  async listBuiltinTemplates(): Promise<BuiltinTemplate[]> {
    if (this.builtinTemplatesCache) {
      return Array.from(this.builtinTemplatesCache.values());
    }

    const templates: BuiltinTemplate[] = [];
    const knowledgePath = resolveBuiltinTemplatesPath();

    if (!knowledgePath) {
      logger.warn('Builtin template directory not found');
      return [];
    }

    try {
      const files = await fs.readdir(knowledgePath);

      for (const file of files) {
        if (!file.endsWith('.json')) continue;

        try {
          const content = await fs.readFile(path.join(knowledgePath, file), 'utf-8');
          const data = JSON.parse(content);

          // Handle both single template and array of templates
          const templateArray = Array.isArray(data) ? data : [data];

          for (const [index, template] of templateArray.entries()) {
            if (template.name && template.sheets) {
              templates.push({
                id: deriveBuiltinTemplateId(template as Record<string, unknown>, file, index),
                name: template.name,
                description: template.description || '',
                category: template.category || file.replace('.json', ''),
                sheets: template.sheets,
              });
            }
          }
        } catch (parseError) {
          logger.warn('Failed to parse builtin template file', { file, error: parseError });
        }
      }

      // Cache the results
      this.builtinTemplatesCache = new Map(templates.map((t) => [t.id, t]));

      logger.debug('Loaded builtin templates', { count: templates.length });
      return templates;
    } catch (error) {
      logger.warn('Failed to load builtin templates', { error });
      return [];
    }
  }

  /**
   * Get builtin template by name
   */
  async getBuiltinTemplate(name: string): Promise<BuiltinTemplate | null> {
    const templates = await this.listBuiltinTemplates();
    return (
      templates.find((t) => t.id === name || t.name.toLowerCase() === name.toLowerCase()) || null
    );
  }

  /**
   * Ensure templates folder exists in appDataFolder
   */
  private async ensureFolder(): Promise<void> {
    if (this.folderId) return;

    try {
      // Search for existing folder (with pagination support - P1-4)
      const response = await executeWithRetry(() =>
        this.driveApi.files.list({
          spaces: APP_DATA_SPACE,
          q: `name='${TEMPLATES_FOLDER}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
          fields: 'files(id)',
          pageSize: 1,
          supportsAllDrives: true,
          // Note: pageSize=1 means pagination unlikely, but included for completeness
        })
      );

      const existingFile = response.data.files?.[0];
      if (existingFile?.id) {
        this.folderId = existingFile.id;
        return;
      }

      // Create folder
      const createResponse = await executeWithRetry(() =>
        this.driveApi.files.create({
          supportsAllDrives: true,
          requestBody: {
            name: TEMPLATES_FOLDER,
            mimeType: 'application/vnd.google-apps.folder',
            parents: [APP_DATA_SPACE],
          },
          fields: 'id',
        })
      );

      this.folderId = createResponse.data.id!;
      logger.info('Created templates folder in appDataFolder', { folderId: this.folderId });
    } catch (error) {
      logger.error('Failed to ensure templates folder', { error });
      throw new ServiceError(
        `Failed to initialize template storage: ${error instanceof Error ? error.message : String(error)}`,
        'INTERNAL_ERROR',
        'TemplateStore',
        false
      );
    }
  }
}
