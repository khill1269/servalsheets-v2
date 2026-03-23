/**
 * Tenant Isolation Middleware
 *
 * Enforces tenant isolation for multi-tenant deployments.
 * Extracts tenant context from requests and validates access.
 */

import { Request, Response, NextFunction } from 'express';
import { ServiceError } from '../core/errors.js';
import {
  tenantContextService,
  TenantContext,
  TenantQuotaExceededError,
} from '../services/tenant-context.js';
import { logger } from '../utils/logger.js';

/**
 * Extended request with tenant context
 */
export interface TenantRequest extends Request {
  tenantContext?: TenantContext;
}

/**
 * Extract tenant context from Authorization header
 *
 * Expected format: Bearer {apiKey}
 */
function extractApiKey(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return null;
  }

  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return null;
  }

  return match[1] ?? null;
}

/**
 * Tenant isolation middleware
 *
 * Extracts tenant context from API key and attaches to request.
 * Returns 401 if invalid or missing API key.
 */
export function tenantIsolationMiddleware() {
  return async (req: TenantRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      // Extract API key
      const apiKey = extractApiKey(req);
      if (!apiKey) {
        logger.warn('Missing API key', { path: req.path });
        res.status(401).json({
          error: 'Unauthorized',
          message: 'API key required in Authorization header',
        });
        return;
      }

      // Extract tenant context
      const tenantContext = await tenantContextService.extractTenantContext(apiKey);
      if (!tenantContext) {
        logger.warn('Invalid API key', { apiKey: apiKey.substring(0, 8) + '...' });
        res.status(401).json({
          error: 'Unauthorized',
          message: 'Invalid API key',
        });
        return;
      }

      // Attach tenant context to request
      req.tenantContext = tenantContext;

      // Record API call for quota tracking
      await tenantContextService.recordApiCall(tenantContext.tenantId);

      next();
    } catch (error) {
      if (error instanceof TenantQuotaExceededError) {
        logger.warn('Tenant quota exceeded', {
          tenantId: error.tenantId,
          limit: error.limit,
          path: req.path,
        });
        res.status(429).json({
          error: 'Too Many Requests',
          message: `Hourly API quota exceeded for tenant ${error.tenantId}`,
        });
        return;
      }

      logger.error('Tenant isolation middleware error', { error });
      res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to process tenant context',
      });
    }
  };
}

/**
 * Validate tenant has access to spreadsheet
 *
 * Must be used after tenantIsolationMiddleware.
 * Extracts spreadsheetId from request body and validates access.
 */
export function validateSpreadsheetAccess() {
  return async (req: TenantRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      // Check tenant context exists
      if (!req.tenantContext) {
        logger.error('Missing tenant context in validateSpreadsheetAccess');
        res.status(500).json({
          error: 'Internal Server Error',
          message: 'Tenant context not initialized',
        });
        return;
      }

      // Extract spreadsheetIds from request payload/query/params
      const spreadsheetIds = extractSpreadsheetIds(req);
      if (spreadsheetIds.length === 0) {
        // No spreadsheet ID in request, skip validation
        next();
        return;
      }

      const tenantId = req.tenantContext.tenantId;

      // Validate access for all spreadsheet IDs found in request
      const accessChecks = await Promise.all(
        spreadsheetIds.map((spreadsheetId) =>
          tenantContextService.validateSpreadsheetAccess(tenantId, spreadsheetId)
        )
      );
      const deniedSpreadsheetId = spreadsheetIds.find(
        (_id, index) => accessChecks[index] === false
      );

      if (deniedSpreadsheetId) {
        logger.warn('Unauthorized spreadsheet access attempt', {
          tenantId,
          spreadsheetId: deniedSpreadsheetId,
          spreadsheetIds,
        });
        res.status(403).json({
          error: 'Forbidden',
          message: 'You do not have access to one or more requested spreadsheets',
        });
        return;
      }

      next();
    } catch (error) {
      logger.error('Spreadsheet access validation error', { error });
      res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to validate spreadsheet access',
      });
    }
  };
}

/**
 * Extract spreadsheet IDs from request
 *
 * Checks multiple locations:
 * - req.body.spreadsheetId
 * - req.body.request.spreadsheetId
 * - req.body.params.arguments.request.spreadsheetId (MCP JSON-RPC)
 * - req.body.params.arguments.spreadsheetId (MCP JSON-RPC)
 * - req.params.spreadsheetId
 * - req.query.spreadsheetId
 */
function extractSpreadsheetIds(req: Request): string[] {
  const spreadsheetIds = new Set<string>();

  collectSpreadsheetIds(req.body, spreadsheetIds);

  // Check params
  if (typeof req.params?.['spreadsheetId'] === 'string') {
    const value = req.params['spreadsheetId'].trim();
    if (value) spreadsheetIds.add(value);
  }

  // Check query
  const querySpreadsheetId = req.query?.['spreadsheetId'];
  if (typeof querySpreadsheetId === 'string') {
    const value = querySpreadsheetId.trim();
    if (value) spreadsheetIds.add(value);
  }

  const querySpreadsheetIds = req.query?.['spreadsheetIds'];
  if (Array.isArray(querySpreadsheetIds)) {
    for (const value of querySpreadsheetIds) {
      if (typeof value !== 'string') continue;
      const trimmed = value.trim();
      if (trimmed) spreadsheetIds.add(trimmed);
    }
  }

  return Array.from(spreadsheetIds);
}

function collectSpreadsheetIds(value: unknown, output: Set<string>, depth = 0): void {
  const MAX_DEPTH = 8;
  if (depth > MAX_DEPTH || value === null || value === undefined) {
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectSpreadsheetIds(item, output, depth + 1);
    }
    return;
  }

  if (typeof value !== 'object') {
    return;
  }

  for (const [key, entry] of Object.entries(value)) {
    if ((key === 'spreadsheetId' || key === 'spreadsheet_id') && typeof entry === 'string') {
      const spreadsheetId = entry.trim();
      if (spreadsheetId) {
        output.add(spreadsheetId);
      }
      continue;
    }

    if ((key === 'spreadsheetIds' || key === 'spreadsheet_ids') && Array.isArray(entry)) {
      for (const item of entry) {
        if (typeof item !== 'string') continue;
        const spreadsheetId = item.trim();
        if (spreadsheetId) {
          output.add(spreadsheetId);
        }
      }
      continue;
    }

    collectSpreadsheetIds(entry, output, depth + 1);
  }
}

/**
 * Require tenant context
 *
 * Ensures tenant context exists on request.
 * Use after tenantIsolationMiddleware to ensure tenant is authenticated.
 */
export function requireTenantContext(req: TenantRequest): asserts req is Required<TenantRequest> {
  if (!req.tenantContext) {
    throw new ServiceError(
      'Tenant context required but not found',
      'INTERNAL_ERROR',
      'tenant-isolation',
      false
    );
  }
}
