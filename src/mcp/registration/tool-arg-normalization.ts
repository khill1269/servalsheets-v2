import { z, type ZodSchema, type ZodTypeAny } from 'zod';
import { TOOL_ACTIONS } from '../completions.js';
import { logger } from '../../utils/logger.js';
import { parseWithCache } from '../../utils/schema-cache.js';

type PlainRecord = Record<string, unknown>;

export type NormalizedRequestHeaders = Record<string, string | string[] | undefined>;

function isPlainRecord(value: unknown): value is PlainRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function getHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function normalizeRequestHeaders(headers: unknown): NormalizedRequestHeaders | undefined {
  if (!isPlainRecord(headers)) {
    return undefined;
  }

  const entries = headers['entries'];
  if (typeof entries === 'function') {
    return Object.fromEntries(
      Array.from(
        (entries as (this: NormalizedRequestHeaders) => IterableIterator<[string, string]>).call(
          headers as NormalizedRequestHeaders
        )
      )
    );
  }

  return headers as NormalizedRequestHeaders;
}

function extractAttemptedAction(args: unknown): string | null {
  if (!isPlainRecord(args)) {
    return null;
  }

  const rootAction = args['action'];
  if (typeof rootAction === 'string') {
    return rootAction;
  }

  const request = args['request'];
  if (!isPlainRecord(request)) {
    return null;
  }

  const requestAction = request['action'];
  return typeof requestAction === 'string' ? requestAction : null;
}

export function getIssueCode(issue: z.ZodIssue): string {
  return String(issue.code ?? '');
}

export function normalizeIssuePath(path: readonly PropertyKey[]): Array<string | number> {
  return path.map((segment) =>
    typeof segment === 'string' || typeof segment === 'number' ? segment : String(segment)
  );
}

function isActionValidationIssue(issue: z.ZodIssue): boolean {
  const issueRecord = issue as unknown as PlainRecord;
  const issueCode = getIssueCode(issue);
  const hasActionInPath = normalizeIssuePath(issue.path).some((segment) => segment === 'action');
  const isActionDiscriminator = issueRecord['discriminator'] === 'action';

  return (
    (hasActionInPath &&
      (issueCode === 'invalid_union' ||
        issueCode === 'invalid_union_discriminator' ||
        issueCode === 'invalid_literal' ||
        issueCode === 'invalid_value')) ||
    isActionDiscriminator
  );
}

function formatActionValidationMessage(
  path: readonly PropertyKey[],
  availableActions: string[]
): string {
  const normalizedPath = normalizeIssuePath(path);
  const pathStr = normalizedPath.length > 0 ? normalizedPath.join('.') : 'action';
  const preview = availableActions.slice(0, 20).join(', ');
  const more = availableActions.length > 20 ? ` (and ${availableActions.length - 20} more)` : '';
  return `Invalid action at '${pathStr}'. Valid actions: ${preview}${more}`;
}

function shouldEnhanceActionIssue(issue: z.ZodIssue, attemptedAction: string | null): boolean {
  if (isActionValidationIssue(issue)) {
    return true;
  }

  if (!attemptedAction) {
    return false;
  }

  const issueCode = getIssueCode(issue);
  return issueCode === 'invalid_union' || issueCode === 'invalid_union_discriminator';
}

function normalizeRangeFields(record: PlainRecord): PlainRecord {
  const result = { ...record };

  const range = result['range'];
  if (isPlainRecord(range) && typeof range['a1'] === 'string') {
    result['range'] = range['a1'];
  }

  const ranges = result['ranges'];
  if (Array.isArray(ranges)) {
    result['ranges'] = ranges.map((entry) => {
      if (isPlainRecord(entry) && typeof entry['a1'] === 'string') {
        return entry['a1'];
      }
      return entry;
    });
  }

  const data = result['data'];
  if (Array.isArray(data)) {
    result['data'] = data.map((entry) => {
      if (!isPlainRecord(entry)) {
        return entry;
      }

      const normalizedEntry = { ...entry };
      const entryRange = normalizedEntry['range'];
      if (isPlainRecord(entryRange) && typeof entryRange['a1'] === 'string') {
        normalizedEntry['range'] = entryRange['a1'];
      }
      return normalizedEntry;
    });
  }

  return result;
}

export function detectLegacyInvocation(args: unknown): string | null {
  if (!isPlainRecord(args)) {
    return null;
  }

  if (isPlainRecord(args['params'])) {
    return 'Flat { action, params } invocation detected. Upgrade to { request: { action, ... } } format (MCP 2025-11-25).';
  }

  if (!args['request'] && typeof args['action'] === 'string') {
    return 'Flat { action, ... } invocation without request envelope. Upgrade to { request: { action, ... } } format (MCP 2025-11-25).';
  }

  const request = args['request'];
  if (isPlainRecord(request) && isPlainRecord(request['params'])) {
    return 'Nested { request: { action, params: {...} } } format. Upgrade to { request: { action, ... } } (flatten params into request).';
  }

  return null;
}

export function normalizeToolArgs(args: unknown): PlainRecord {
  if (!isPlainRecord(args)) {
    logger.warn(
      'normalizeToolArgs: received non-object args, falling back to empty record for Zod validation',
      { args }
    );
    return {};
  }

  const rootParams = args['params'];
  if (isPlainRecord(rootParams)) {
    const action = typeof args['action'] === 'string' ? { action: args['action'] } : {};
    return {
      request: normalizeRangeFields({ ...rootParams, ...action }),
    };
  }

  const request = args['request'];
  if (!isPlainRecord(request)) {
    return { request: normalizeRangeFields(args) };
  }

  const nestedParams = request['params'];
  if (isPlainRecord(nestedParams)) {
    const action = typeof request['action'] === 'string' ? { action: request['action'] } : {};
    return {
      request: normalizeRangeFields({ ...nestedParams, ...action }),
    };
  }

  return { request: normalizeRangeFields(request) };
}

export const parseForHandler = <T>(
  schema: ZodTypeAny,
  args: unknown,
  schemaName: string,
  toolName?: string
): T => {
  try {
    return parseWithCache(schema as ZodSchema<T>, args, schemaName);
  } catch (error) {
    if (!(error instanceof z.ZodError) || !toolName) {
      throw error;
    }

    const availableActions = TOOL_ACTIONS[toolName] ?? [];
    if (availableActions.length === 0) {
      throw error;
    }

    const attemptedAction = extractAttemptedAction(args);
    const hasActionIssue = error.issues.some((issue) =>
      shouldEnhanceActionIssue(issue, attemptedAction)
    );

    if (!hasActionIssue) {
      throw error;
    }

    const enhancedIssues = error.issues.map((issue) => {
      if (!shouldEnhanceActionIssue(issue, attemptedAction)) {
        return issue;
      }

      const messagePath = issue.path.length > 0 ? issue.path : ['action'];

      return {
        ...issue,
        message: formatActionValidationMessage(messagePath, availableActions),
        options: availableActions,
      } as unknown as z.ZodIssue;
    });

    if (attemptedAction && attemptedAction.toLowerCase().includes('rename')) {
      enhancedIssues.push({
        code: 'custom',
        path: ['_hint'],
        message: 'Hint: To rename a sheet, use action="update_sheet" with the "title" parameter.',
      } as z.ZodIssue);
    }

    throw new z.ZodError(enhancedIssues);
  }
};
