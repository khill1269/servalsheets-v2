/**
 * V1 Schema Compatibility Layer
 */

import { logger } from '../utils/logger.js';
import type { SchemaVersion } from './schema-manager.js';

const ACTION_MAPPINGS_V1_TO_V2: Record<string, string> = {
  copy_to: 'copy_sheet_to',
  hide_sheet: 'update_sheet',
  show_sheet: 'update_sheet',
  rename_sheet: 'update_sheet',
};

const ACTION_MAPPINGS_V2_TO_V1: Record<string, string> = Object.fromEntries(
  Object.entries(ACTION_MAPPINGS_V1_TO_V2).map(([k, v]) => [v, k])
);

export function transformRequestV1ToV2(request: Record<string, unknown>): Record<string, unknown> {
  const action = request['action'] as string | undefined;
  if (!action) {
    return request;
  }

  const v2Action = ACTION_MAPPINGS_V1_TO_V2[action] || action;
  const transformed = { ...request, action: v2Action };

  switch (action) {
    case 'hide_sheet':
      return { ...transformed, hidden: true };
    case 'show_sheet':
      return { ...transformed, hidden: false };
    case 'rename_sheet':
      if ('newName' in request) {
        const { newName, ...rest } = request as Record<string, unknown>;
        return { ...rest, action: 'update_sheet', title: newName };
      }
      return transformed;
    default:
      return transformed;
  }
}

export function transformResponseV2ToV1(
  response: Record<string, unknown>
): Record<string, unknown> {
  const transformed = { ...response };
  if ('errorCode' in transformed) {
    const { errorCode: _, ...rest } = transformed;
    return rest;
  }
  return transformed;
}

export class V1CompatibilityLayer {
  static wrapHandler<TInput, TOutput>(
    v2Handler: (input: TInput) => Promise<TOutput>,
    version: SchemaVersion
  ): (input: TInput) => Promise<TOutput> {
    if (version === 'v2') {
      return v2Handler;
    }

    return async (input: TInput): Promise<TOutput> => {
      logger.debug('V1 compatibility layer activated', { version });
      const v2Input = transformRequestV1ToV2(input as Record<string, unknown>) as TInput;
      const v2Output = await v2Handler(v2Input);
      const v1Output = transformResponseV2ToV1(v2Output as Record<string, unknown>) as TOutput;
      return v1Output;
    };
  }

  static getDeprecationWarnings(action: string): string[] {
    const warnings: string[] = [];
    if (action in ACTION_MAPPINGS_V1_TO_V2) {
      const v2Action = ACTION_MAPPINGS_V1_TO_V2[action];
      warnings.push(`Action '${action}' is deprecated in v1. Use '${v2Action}' in v2.`);
    }
    return warnings;
  }
}

export function isActionDeprecated(action: string): boolean {
  return action in ACTION_MAPPINGS_V1_TO_V2;
}

export function getV2ActionName(v1Action: string): string {
  return ACTION_MAPPINGS_V1_TO_V2[v1Action] || v1Action;
}

export function getV1ActionName(v2Action: string): string {
  return ACTION_MAPPINGS_V2_TO_V1[v2Action] || v2Action;
}
