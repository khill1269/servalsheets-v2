/**
 * ServalSheets - Logger Context
 *
 * Service-level metadata for structured logging.
 */

import * as os from 'os';
import { randomUUID } from 'crypto';
import { VERSION } from '../version.js';

/**
 * Service metadata for logging context
 */
export interface ServiceContext {
  /** Service name */
  service: string;
  /** Service version */
  version: string;
  /** Deployment environment */
  environment: string;
  /** Hostname */
  hostname: string;
  /** Node.js version */
  nodeVersion: string;
  /** Process ID */
  pid: number;
  /** Instance ID (for multi-instance deployments) */
  instanceId: string;
  /** Service start time */
  startTime: string;
}

let serviceContext: ServiceContext | null = null;

/**
 * Get or create service context
 */
export function getServiceContext(): ServiceContext {
  if (!serviceContext) {
    serviceContext = {
      service: 'servalsheets',
      version: VERSION,
      environment: process.env['NODE_ENV'] || 'development',
      hostname: os.hostname(),
      nodeVersion: process.version,
      pid: process.pid,
      instanceId: process.env['INSTANCE_ID'] || randomUUID(),
      startTime: new Date().toISOString(),
    };
  }

  return serviceContext;
}

/**
 * Get service context as flat object for logging
 */
export function getServiceContextFlat(): Record<string, string | number> {
  const ctx = getServiceContext();
  return {
    service: ctx.service,
    version: ctx.version,
    environment: ctx.environment,
    hostname: ctx.hostname,
    nodeVersion: ctx.nodeVersion,
    pid: ctx.pid,
    instanceId: ctx.instanceId,
  };
}

/**
 * Reset service context (for testing)
 */
export function resetServiceContext(): void {
  serviceContext = null;
}
