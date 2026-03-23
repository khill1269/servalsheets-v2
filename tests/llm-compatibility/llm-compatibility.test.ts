import { describe, it, expect } from 'vitest';
import { z, type ZodTypeAny } from 'zod';
import {
  SheetsAuthInputSchema,
  SheetsCoreInputSchema,
  // SheetsDataInputSchema, -- skipped: uses z.preprocess
  // SheetsFormatInputSchema, -- skipped: uses z.preprocess
  // SheetsDimensionsInputSchema, -- skipped: uses z.preprocess
  SheetsVisualizeInputSchema,
  SheetsCollaborateInputSchema,
  SheetsAdvancedInputSchema,
  SheetsTransactionInputSchema,
  // SheetsQualityInputSchema, -- skipped: uses z.preprocess
  SheetsHistoryInputSchema,
  SheetsConfirmInputSchema,
  SheetsAnalyzeInputSchema,
  SheetsFixInputSchema,
  CompositeInputSchema,
  SheetsSessionInputSchema,
  SheetsTemplatesInputSchema,
  SheetsBigQueryInputSchema,
  SheetsAppsScriptInputSchema,
} from '../../src/schemas/index.js';
import {
  getDiscriminatedUnionOptions,
  getObjectShape,
  unwrapSchema,
} from '../../src/utils/schema-inspection.js';

const SAMPLE_SPREADSHEET_ID = '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms';
const SAMPLE_RANGE = 'Sheet1!A1:B2';
const SAMPLE_CELL = 'A1';
const SAMPLE_URL = 'https://example.com';
const SAMPLE_EMAIL = 'test@example.com';
const SAMPLE_LOCALE = 'en_US';
const SAMPLE_TIMEZONE = 'America/New_York';
const SAMPLE_NAMED_RANGE = 'MyRange';
const SAMPLE_TITLE = 'Test Title';
const SAMPLE_QUERY = 'Show totals by month';

const TOOL_SCHEMAS: Array<{ name: string; schema: ZodTypeAny }> = [
  { name: 'sheets_auth', schema: SheetsAuthInputSchema },
  { name: 'sheets_core', schema: SheetsCoreInputSchema },
  // SKIP: sheets_data uses z.preprocess which requires special test handling
  // { name: 'sheets_data', schema: SheetsDataInputSchema },
  // SKIP: sheets_format uses z.preprocess which requires special test handling
  // { name: 'sheets_format', schema: SheetsFormatInputSchema },
  // SKIP: sheets_dimensions uses z.preprocess which requires special test handling
  // { name: 'sheets_dimensions', schema: SheetsDimensionsInputSchema },
  { name: 'sheets_visualize', schema: SheetsVisualizeInputSchema },
  { name: 'sheets_collaborate', schema: SheetsCollaborateInputSchema },
  { name: 'sheets_advanced', schema: SheetsAdvancedInputSchema },
  { name: 'sheets_transaction', schema: SheetsTransactionInputSchema },
  // SKIP: sheets_quality uses z.preprocess which requires special test handling
  // { name: 'sheets_quality', schema: SheetsQualityInputSchema },
  { name: 'sheets_history', schema: SheetsHistoryInputSchema },
  { name: 'sheets_confirm', schema: SheetsConfirmInputSchema },
  { name: 'sheets_analyze', schema: SheetsAnalyzeInputSchema },
  { name: 'sheets_fix', schema: SheetsFixInputSchema },
  { name: 'sheets_composite', schema: CompositeInputSchema },
  { name: 'sheets_session', schema: SheetsSessionInputSchema },
  { name: 'sheets_templates', schema: SheetsTemplatesInputSchema },
  { name: 'sheets_bigquery', schema: SheetsBigQueryInputSchema },
  { name: 'sheets_appsscript', schema: SheetsAppsScriptInputSchema },
];

type BuildMode = 'base' | 'coerce';

function getChecks(schema: ZodTypeAny): Array<Record<string, unknown>> {
  const unwrapped = unwrapSchema(schema);
  const def = (unwrapped as unknown as { _def?: { checks?: unknown[] } })._def;
  const checks = Array.isArray(def?.checks) ? def.checks : [];
  return checks
    .map((check) => (check as { _zod?: { def?: Record<string, unknown> } })._zod?.def)
    .filter((check): check is Record<string, unknown> => !!check);
}

function getMinLength(schema: ZodTypeAny): number | null {
  const minCheck = getChecks(schema).find((check) => check['check'] === 'min_length');
  return typeof minCheck?.['minimum'] === 'number' ? (minCheck['minimum'] as number) : null;
}

function getMinNumber(schema: ZodTypeAny): number | null {
  let minValue: number | null = null;
  for (const check of getChecks(schema)) {
    if (check['check'] !== 'greater_than') continue;
    const value = typeof check['value'] === 'number' ? (check['value'] as number) : null;
    if (value === null) continue;
    const inclusive = check['inclusive'] === true;
    const candidate = inclusive ? value : value + 1;
    minValue = minValue === null ? candidate : Math.max(minValue, candidate);
  }
  return minValue;
}

function getStringFormat(schema: ZodTypeAny): { format?: string; pattern?: RegExp } | null {
  const formatCheck = getChecks(schema).find((check) => check['check'] === 'string_format');
  if (!formatCheck) return null;
  return {
    format:
      typeof formatCheck['format'] === 'string' ? (formatCheck['format'] as string) : undefined,
    pattern: formatCheck['pattern'] instanceof RegExp ? formatCheck['pattern'] : undefined,
  };
}

function getEnumValues(schema: ZodTypeAny): string[] {
  const unwrapped = unwrapSchema(schema);
  if (!(unwrapped instanceof z.ZodEnum)) return [];
  return Object.values(unwrapped._def.entries);
}

function getLiteralValue(schema: ZodTypeAny): string | number | boolean | null {
  const unwrapped = unwrapSchema(schema);
  if (!(unwrapped instanceof z.ZodLiteral)) return null;
  const values = (unwrapped._def as { values?: unknown[] }).values;
  return values?.[0] as string | number | boolean | null;
}

function isCoerceNumber(schema: ZodTypeAny): boolean {
  const unwrapped = unwrapSchema(schema);
  if (!(unwrapped instanceof z.ZodNumber)) return false;
  return (unwrapped._def as { coerce?: boolean }).coerce === true;
}

function padToLength(value: string, minLength: number | null): string {
  if (!minLength || value.length >= minLength) return value;
  return value.padEnd(minLength, 'a');
}

function stringForRegex(fieldName: string | undefined, pattern?: RegExp): string | null {
  const source = pattern?.source ?? '';
  if (fieldName?.toLowerCase().includes('spreadsheetid')) return SAMPLE_SPREADSHEET_ID;
  if (source.includes('^[a-z]{2}_[A-Z]{2}$')) return SAMPLE_LOCALE;
  if (source.includes('^[A-Za-z_]+/[A-Za-z_]+$')) return SAMPLE_TIMEZONE;
  if (source.includes('^[A-Za-z_]')) return SAMPLE_NAMED_RANGE;
  if (source.includes('[A-Z]{1,3}') && source.includes('\\d+')) return SAMPLE_CELL;
  if (source.includes('https?')) return SAMPLE_URL;
  if (source.includes('A1') || source.includes('!')) return SAMPLE_RANGE;
  return null;
}

function buildString(schema: ZodTypeAny, fieldName?: string): string {
  const format = getStringFormat(schema);
  const candidates = [
    fieldName?.toLowerCase().includes('spreadsheetid') ? SAMPLE_SPREADSHEET_ID : undefined,
    fieldName?.toLowerCase().includes('range') ? SAMPLE_RANGE : undefined,
    fieldName?.toLowerCase().includes('cell') ? SAMPLE_CELL : undefined,
    fieldName?.toLowerCase().includes('sheet') ? 'Sheet1' : undefined,
    fieldName?.toLowerCase().includes('locale') ? SAMPLE_LOCALE : undefined,
    fieldName?.toLowerCase().includes('timezone') ? SAMPLE_TIMEZONE : undefined,
    fieldName?.toLowerCase().includes('url') ? SAMPLE_URL : undefined,
    fieldName?.toLowerCase().includes('email') ? SAMPLE_EMAIL : undefined,
    fieldName?.toLowerCase().includes('name') ? SAMPLE_NAMED_RANGE : undefined,
    fieldName?.toLowerCase().includes('title') ? SAMPLE_TITLE : undefined,
    fieldName?.toLowerCase().includes('query') ? SAMPLE_QUERY : undefined,
    format?.format === 'email' ? SAMPLE_EMAIL : undefined,
    format?.format === 'url' ? SAMPLE_URL : undefined,
    format?.format === 'regex' ? stringForRegex(fieldName, format.pattern) : undefined,
    SAMPLE_TITLE,
  ].filter((candidate): candidate is string => !!candidate);

  const minLength = getMinLength(schema);
  for (const candidate of candidates) {
    const value = padToLength(candidate, minLength);
    if (schema.safeParse(value).success) return value;
  }

  return padToLength('test', minLength);
}

function buildNumber(schema: ZodTypeAny, mode: BuildMode): number | string {
  const minValue = getMinNumber(schema);
  const value = minValue ?? 1;
  if (mode === 'coerce' && isCoerceNumber(schema)) return String(value);
  return value;
}

function buildArray(
  schema: z.ZodArray<ZodTypeAny>,
  fieldName: string | undefined,
  mode: BuildMode
) {
  const minLength = getMinLength(schema) ?? 1;
  const length = Math.max(1, minLength);
  const element = schema._def.element as ZodTypeAny;
  return Array.from({ length }, () => buildValue(element, fieldName, mode));
}

function buildObject(schema: ZodTypeAny, mode: BuildMode): Record<string, unknown> {
  const shape = getObjectShape(schema);
  if (!shape) return {};
  const result: Record<string, unknown> = {};

  for (const [key, fieldSchema] of Object.entries(shape)) {
    if (fieldSchema.isOptional()) continue;
    result[key] = buildValue(fieldSchema, key, mode);
  }

  return result;
}

function buildUnion(
  schema: z.ZodUnion<ZodTypeAny[]>,
  fieldName: string | undefined,
  mode: BuildMode
) {
  for (const option of schema._def.options) {
    const candidate = buildValue(option, fieldName, mode);
    if (schema.safeParse(candidate).success) return candidate;
  }
  return buildValue(schema._def.options[0], fieldName, mode);
}

function buildRecord(
  schema: z.ZodRecord<ZodTypeAny, ZodTypeAny>,
  fieldName: string | undefined,
  mode: BuildMode
) {
  const keySchema = schema._def.keyType as ZodTypeAny;
  const valueSchema = schema._def.valueType as ZodTypeAny;
  const rawKey = buildValue(keySchema, fieldName, mode);
  const key = typeof rawKey === 'string' ? rawKey : String(rawKey ?? 0);

  return {
    [key]: buildValue(valueSchema, fieldName, mode),
  };
}

function buildTuple(schema: z.ZodTuple, fieldName: string | undefined, mode: BuildMode) {
  return schema._def.items.map((item: ZodTypeAny) => buildValue(item, fieldName, mode));
}

function getFieldOverrides(fieldName: string | undefined, mode: BuildMode): unknown[] {
  if (!fieldName) return [];
  const lower = fieldName.toLowerCase();
  const candidates: unknown[] = [];

  if (lower.includes('range') || lower === 'source' || lower === 'datarange') {
    candidates.push(SAMPLE_RANGE, { a1: SAMPLE_RANGE });
  }

  if (lower.includes('cell')) {
    candidates.push(SAMPLE_CELL);
  }

  if (lower.includes('spreadsheetid')) {
    candidates.push(SAMPLE_SPREADSHEET_ID);
  }

  if (lower.includes('sheetname') || lower === 'sheet') {
    candidates.push('Sheet1');
  }

  if (lower.includes('email')) {
    candidates.push(SAMPLE_EMAIL);
  }

  if (lower.includes('url')) {
    candidates.push(SAMPLE_URL);
  }

  if (lower.includes('title')) {
    candidates.push(SAMPLE_TITLE);
  }

  if (lower.includes('query')) {
    candidates.push(SAMPLE_QUERY);
  }

  if (mode === 'coerce' && lower.includes('sheetid')) {
    candidates.push('0');
  }

  return candidates;
}

function buildValue(schema: ZodTypeAny, fieldName: string | undefined, mode: BuildMode): unknown {
  const literal = getLiteralValue(schema);
  if (literal !== null) return literal;

  for (const candidate of getFieldOverrides(fieldName, mode)) {
    if (schema.safeParse(candidate).success) return candidate;
  }

  const unwrapped = unwrapSchema(schema);

  if (unwrapped instanceof z.ZodString) return buildString(schema, fieldName);
  if (unwrapped instanceof z.ZodNumber) return buildNumber(schema, mode);
  if (unwrapped instanceof z.ZodBoolean) return false;
  if (unwrapped instanceof z.ZodEnum) return getEnumValues(schema)[0] ?? 'unknown';
  if (unwrapped instanceof z.ZodArray) return buildArray(unwrapped, fieldName, mode);
  if (unwrapped instanceof z.ZodObject) return buildObject(unwrapped, mode);
  if (unwrapped instanceof z.ZodUnion) return buildUnion(unwrapped, fieldName, mode);
  if (unwrapped instanceof z.ZodDiscriminatedUnion) {
    const options = getDiscriminatedUnionOptions(unwrapped) ?? [];
    if (options.length > 0) return buildObject(options[0] as ZodTypeAny, mode);
  }
  if (unwrapped instanceof z.ZodRecord) return buildRecord(unwrapped, fieldName, mode);
  if (unwrapped instanceof z.ZodTuple) return buildTuple(unwrapped, fieldName, mode);
  if (unwrapped instanceof z.ZodDate) return new Date();

  return null;
}

function buildCollaborateFields(action: string, mode: BuildMode): Record<string, unknown> {
  const base = { spreadsheetId: SAMPLE_SPREADSHEET_ID };
  const asString = (value: string) => value;
  const asBool = (value: boolean) => (mode === 'coerce' ? value : value);

  switch (action) {
    case 'share_add':
      return { ...base, type: 'anyone', role: 'reader' };
    case 'share_update':
      return { ...base, permissionId: asString('perm'), role: 'reader' };
    case 'share_remove':
    case 'share_get':
      return { ...base, permissionId: asString('perm') };
    case 'share_list':
    case 'share_get_link':
    case 'version_list_revisions':
    case 'version_create_snapshot':
    case 'version_list_snapshots':
    case 'version_compare':
    case 'version_export':
      return base;
    case 'version_snapshot_status':
      return { ...base, taskId: asString('snapshot_task_1') };
    case 'share_transfer_ownership':
      return { ...base, newOwnerEmail: SAMPLE_EMAIL };
    case 'share_set_link':
      return { ...base, enabled: asBool(true) };
    case 'comment_add':
      return { ...base, content: SAMPLE_TITLE };
    case 'comment_update':
      return { ...base, commentId: asString('comment'), content: SAMPLE_TITLE };
    case 'comment_delete':
    case 'comment_get':
    case 'comment_resolve':
    case 'comment_reopen':
      return { ...base, commentId: asString('comment') };
    case 'comment_list':
      return base;
    case 'comment_add_reply':
      return { ...base, commentId: asString('comment'), content: SAMPLE_TITLE };
    case 'comment_update_reply':
      return {
        ...base,
        commentId: asString('comment'),
        replyId: asString('reply'),
        content: SAMPLE_TITLE,
      };
    case 'comment_delete_reply':
      return { ...base, commentId: asString('comment'), replyId: asString('reply') };
    case 'version_get_revision':
    case 'version_restore_revision':
      return { ...base, revisionId: asString('rev') };
    case 'version_keep_revision':
      return { ...base, revisionId: asString('rev'), keepForever: asBool(true) };
    case 'version_restore_snapshot':
    case 'version_delete_snapshot':
      return { ...base, snapshotId: asString('snapshot') };
    case 'approval_create':
      return { ...base, range: SAMPLE_RANGE, approvers: [SAMPLE_EMAIL] };
    case 'approval_approve':
    case 'approval_reject':
    case 'approval_get_status':
    case 'approval_cancel':
      return { ...base, approvalId: asString('approval_123') };
    case 'approval_list_pending':
      return base;
    case 'approval_delegate':
      return { ...base, approvalId: asString('approval_123'), delegateTo: SAMPLE_EMAIL };
    case 'resolve_access_proposal':
      return { ...base, proposalId: asString('proposal_123'), decision: 'APPROVE' as const };
    case 'label_apply':
    case 'label_remove':
      return { ...base, labelId: asString('label_123') };
    default:
      return base;
  }
}

function applyActionOverrides(
  toolName: string,
  action: string,
  request: Record<string, unknown>,
  mode: BuildMode
): Record<string, unknown> {
  if (toolName === 'sheets_collaborate') {
    return {
      ...request,
      ...buildCollaborateFields(action, mode),
    };
  }

  if (toolName === 'sheets_analyze' && action === 'explain_analysis') {
    return {
      ...request,
      question: SAMPLE_QUERY,
    };
  }

  if (toolName === 'sheets_appsscript') {
    // All appsscript actions use superRefine requiring scriptId OR spreadsheetId
    return {
      ...request,
      spreadsheetId: SAMPLE_SPREADSHEET_ID,
      ...(action === 'run' ? { devMode: true } : {}),
    };
  }

  if (toolName === 'sheets_analyze' && (action === 'get_intelligence_report' || action === 'cancel_intelligence')) {
    // These actions require a valid UUID for scheduleId
    return {
      ...request,
      scheduleId: '550e8400-e29b-41d4-a716-446655440000',
    };
  }

  if (toolName === 'sheets_session' && action === 'schedule_create') {
    // schedule_create requires either flat tool/actionName or nested operation/target
    return {
      ...request,
      tool: 'sheets_data',
      actionName: 'read',
    };
  }

  return request;
}

function buildRequests(toolName: string, schema: ZodTypeAny, mode: BuildMode) {
  const toolShape = getObjectShape(schema);
  if (!toolShape?.['request']) {
    throw new Error(`Schema for ${toolName} does not have request field`);
  }

  const requestSchema = unwrapSchema(toolShape['request']);
  const unionOptions = getDiscriminatedUnionOptions(requestSchema);

  if (unionOptions) {
    return unionOptions.map((option) => {
      const request = buildObject(option as ZodTypeAny, mode);
      const action = String(request['action'] ?? 'unknown');
      return {
        action,
        input: { request: applyActionOverrides(toolName, action, request, mode) },
      };
    });
  }

  if (requestSchema instanceof z.ZodObject) {
    const requestShape = getObjectShape(requestSchema) ?? {};
    const actionField = requestShape['action'];
    const actions = getEnumValues(actionField);
    return actions.map((action) => {
      const request = buildObject(requestSchema, mode);
      request['action'] = action;
      return {
        action,
        input: { request: applyActionOverrides(toolName, action, request, mode) },
      };
    });
  }

  throw new Error(`Unsupported request schema for ${toolName}`);
}

describe('LLM compatibility - minimal inputs', () => {
  for (const tool of TOOL_SCHEMAS) {
    describe(tool.name, () => {
      const requests = buildRequests(tool.name, tool.schema, 'base');

      for (const { action, input } of requests) {
        it(`accepts minimal input for ${action}`, () => {
          const result = tool.schema.safeParse(input);
          if (!result.success) {
            console.error(`${tool.name}.${action} validation errors:`, result.error.errors);
          }
          expect(result.success).toBe(true);
        });
      }
    });
  }
});

describe('LLM compatibility - string-coerced numbers', () => {
  for (const tool of TOOL_SCHEMAS) {
    describe(tool.name, () => {
      const requests = buildRequests(tool.name, tool.schema, 'coerce');

      for (const { action, input } of requests) {
        it(`accepts string-coerced numbers for ${action}`, () => {
          const result = tool.schema.safeParse(input);
          if (!result.success) {
            console.error(`${tool.name}.${action} validation errors:`, result.error.errors);
          }
          expect(result.success).toBe(true);
        });
      }
    });
  }
});
