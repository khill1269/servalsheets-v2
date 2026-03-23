/**
 * ServalSheets - RBAC Middleware
 *
 * Express middleware for enforcing Role-Based Access Control (RBAC).
 * Checks permissions before handler execution.
 *
 * Usage:
 * ```typescript
 * app.use(rbacMiddleware());
 * ```
 *
 * @module middleware/rbac-middleware
 */

import type { Request, Response, NextFunction } from 'express';
import { getRbacManager } from '../services/rbac-manager.js';
import { logger } from '../utils/logger.js';
import { createPermissionError } from '../utils/error-factory.js';

/**
 * RBAC middleware options
 */
export interface RbacMiddlewareOptions {
  /**
   * Enable RBAC enforcement
   * Default: true
   */
  enabled?: boolean;

  /**
   * Skip RBAC for certain paths (regex patterns)
   * Default: [/^\/health/, /^\/metrics/, /^\/.well-known/]
   */
  skipPaths?: RegExp[];

  /**
   * Extract user ID from request
   * Default: req.user?.sub || req.apiKey?.userId
   */
  getUserId?: (req: Request) => string | null;

  /**
   * Custom error handler
   */
  onPermissionDenied?: (req: Request, res: Response, reason: string) => void;
}

/**
 * Default paths to skip RBAC checks
 */
const DEFAULT_SKIP_PATHS = [
  /^\/health/, // Health checks
  /^\/metrics/, // Prometheus metrics
  /^\/.well-known\//, // OAuth discovery
  /^\/oauth\//, // OAuth endpoints
  /^\/auth\//, // Auth endpoints
];

/**
 * Extract user ID from request
 */
function defaultGetUserId(req: Request): string | null {
  // Try OAuth user first (added by auth middleware)
  const reqWithUser = req as Request & { user?: { sub?: string } };
  if (reqWithUser.user && typeof reqWithUser.user === 'object' && 'sub' in reqWithUser.user) {
    return reqWithUser.user.sub as string;
  }

  // Try API key (added by auth middleware)
  const reqWithApiKey = req as Request & { apiKey?: { userId?: string } };
  if (
    reqWithApiKey.apiKey &&
    typeof reqWithApiKey.apiKey === 'object' &&
    'userId' in reqWithApiKey.apiKey
  ) {
    return reqWithApiKey.apiKey.userId as string;
  }

  // Try Authorization header (for API keys)
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7); // Return the key itself as userId
  }

  return null;
}

/**
 * Extract tool name and action from MCP request
 */
function extractToolAndAction(req: Request): {
  toolName: string | null;
  actionName: string | null;
} {
  // Check if this is an MCP tool call
  if (req.body && typeof req.body === 'object') {
    const body = req.body as Record<string, unknown>;

    // MCP tools/call request
    if (body['method'] === 'tools/call' && body['params']) {
      const params = body['params'] as Record<string, unknown>;
      const toolName = params['name'] as string | undefined;

      // Extract action from arguments
      let actionName: string | null = null;
      if (params['arguments'] && typeof params['arguments'] === 'object') {
        const args = params['arguments'] as Record<string, unknown>;

        // Try direct action field
        if (typeof args['action'] === 'string') {
          actionName = args['action'];
        }

        // Try wrapped request.action field
        if (!actionName && args['request'] && typeof args['request'] === 'object') {
          const request = args['request'] as Record<string, unknown>;
          if (typeof request['action'] === 'string') {
            actionName = request['action'];
          }
        }
      }

      return {
        toolName: toolName || null,
        actionName,
      };
    }
  }

  return { toolName: null, actionName: null };
}

/**
 * Extract resource ID (spreadsheetId) from request
 */
function extractResourceId(req: Request): string | null {
  if (req.body && typeof req.body === 'object') {
    const body = req.body as Record<string, unknown>;

    if (body['params'] && typeof body['params'] === 'object') {
      const params = body['params'] as Record<string, unknown>;

      if (params['arguments'] && typeof params['arguments'] === 'object') {
        const args = params['arguments'] as Record<string, unknown>;

        // Try direct spreadsheetId
        if (typeof args['spreadsheetId'] === 'string') {
          return args['spreadsheetId'];
        }

        // Try wrapped request.spreadsheetId
        if (args['request'] && typeof args['request'] === 'object') {
          const request = args['request'] as Record<string, unknown>;
          if (typeof request['spreadsheetId'] === 'string') {
            return request['spreadsheetId'];
          }
        }
      }
    }
  }

  return null;
}

/**
 * Create RBAC middleware
 */
export function rbacMiddleware(
  options: RbacMiddlewareOptions = {}
): (req: Request, res: Response, next: NextFunction) => void {
  const {
    enabled = true,
    skipPaths = DEFAULT_SKIP_PATHS,
    getUserId = defaultGetUserId,
    onPermissionDenied,
  } = options;

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // Skip if RBAC is disabled
    if (!enabled) {
      next();
      return;
    }

    // Skip certain paths
    if (skipPaths.some((pattern) => pattern.test(req.path))) {
      next();
      return;
    }

    // Extract user ID
    const userId = getUserId(req);
    if (!userId) {
      // No user ID - skip RBAC (will be handled by auth middleware)
      logger.debug('RBAC: No user ID found, skipping permission check');
      next();
      return;
    }

    // Extract tool, action, and resource
    const { toolName, actionName } = extractToolAndAction(req);
    const resourceId = extractResourceId(req);

    // Skip if not a tool call
    if (!toolName) {
      next();
      return;
    }

    // Check permission
    try {
      const rbacManager = getRbacManager();
      const result = await rbacManager.checkPermission({
        userId,
        toolName,
        actionName: actionName || undefined,
        resourceId: resourceId || undefined,
      });

      if (!result.allowed) {
        logger.warn('RBAC: Permission denied', {
          userId,
          toolName,
          actionName,
          resourceId,
          reason: result.reason,
        });

        // Custom error handler
        if (onPermissionDenied) {
          onPermissionDenied(req, res, result.reason);
          return;
        }

        // Default error response
        const error = createPermissionError({
          operation: `${toolName}${actionName ? `.${actionName}` : ''}`,
          resourceId: resourceId || undefined,
        });

        res.status(403).json({
          error: {
            code: error.code,
            message: error.message,
            details: error.details,
            resolution: error.resolution,
          },
        });
        return;
      }

      // Permission granted - add to request context
      (req as Request & { rbac?: unknown }).rbac = {
        userId,
        toolName,
        actionName,
        resourceId,
        permission: result.permission,
        matchedRules: result.matchedRules,
      };

      logger.debug('RBAC: Permission granted', {
        userId,
        toolName,
        actionName,
        resourceId,
      });

      next();
    } catch (err) {
      logger.error('RBAC: Permission check failed', {
        error: err instanceof Error ? err.message : String(err),
        userId,
        toolName,
        actionName,
        resourceId,
      });

      // On error, deny by default (fail-secure)
      const error = createPermissionError({
        operation: `${toolName}${actionName ? `.${actionName}` : ''}`,
        resourceId: resourceId || undefined,
      });

      res.status(403).json({
        error: {
          code: error.code,
          message: error.message,
          details: error.details,
        },
      });
    }
  };
}

/**
 * Handler context enhancement with RBAC
 * Adds RBAC information to handler context
 */
export function enhanceHandlerContextWithRbac(
  context: Record<string, unknown>,
  req: Request
): void {
  const rbacInfo = (req as Request & { rbac?: unknown })['rbac'];
  if (rbacInfo && typeof rbacInfo === 'object') {
    context['rbac'] = rbacInfo;
  }
}

/**
 * Utility: Check if user has role
 */
export async function hasRole(userId: string, role: string): Promise<boolean> {
  try {
    const rbacManager = getRbacManager();
    const userRoles = await rbacManager.getUserRoles(userId);
    return userRoles.includes(role);
  } catch (err) {
    logger.error('Failed to check user role', {
      error: err instanceof Error ? err.message : String(err),
      userId,
      role,
    });
    return false;
  }
}

/**
 * Utility: Require admin role (for protected routes)
 */
export function requireAdmin(): (req: Request, res: Response, next: NextFunction) => Promise<void> {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const userId = defaultGetUserId(req);
    if (!userId) {
      res.status(401).json({
        error: {
          code: 'AUTH_ERROR',
          message: 'Authentication required',
        },
      });
      return;
    }

    const isAdmin = await hasRole(userId, 'admin');
    if (!isAdmin) {
      res.status(403).json({
        error: {
          code: 'PERMISSION_ERROR',
          message: 'Admin role required',
          details: {
            userId,
            requiredRole: 'admin',
          },
        },
      });
      return;
    }

    next();
  };
}
