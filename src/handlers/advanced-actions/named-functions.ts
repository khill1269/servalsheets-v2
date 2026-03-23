import { ErrorCodes } from '../error-codes.js';
import type { sheets_v4 } from 'googleapis';
import type { HandlerContext } from '../base.js';
import type { SheetsAdvancedInput, AdvancedResponse } from '../../schemas/index.js';
import type { ErrorDetail, MutationSummary } from '../../schemas/shared.js';

type CreateNamedFunctionRequest = Extract<
  SheetsAdvancedInput['request'],
  { action: 'create_named_function' }
>;
type ListNamedFunctionsRequest = Extract<
  SheetsAdvancedInput['request'],
  { action: 'list_named_functions' }
>;
type GetNamedFunctionRequest = Extract<
  SheetsAdvancedInput['request'],
  { action: 'get_named_function' }
>;
type UpdateNamedFunctionRequest = Extract<
  SheetsAdvancedInput['request'],
  { action: 'update_named_function' }
>;
type DeleteNamedFunctionRequest = Extract<
  SheetsAdvancedInput['request'],
  { action: 'delete_named_function' }
>;

interface NamedFunctionsDeps {
  sheetsApi: sheets_v4.Sheets;
  context: HandlerContext;
  paginateItems: <T>(
    items: T[],
    cursor: string | undefined,
    pageSize: number
  ) => { page: T[]; nextCursor: string | undefined; hasMore: boolean; totalCount: number };
  success: (
    action: string,
    data: Record<string, unknown>,
    mutation?: MutationSummary,
    dryRun?: boolean
  ) => AdvancedResponse;
  error: (error: ErrorDetail) => AdvancedResponse;
}

function namedFunctionsUnavailable(
  action:
    | CreateNamedFunctionRequest['action']
    | ListNamedFunctionsRequest['action']
    | GetNamedFunctionRequest['action']
    | UpdateNamedFunctionRequest['action']
    | DeleteNamedFunctionRequest['action'],
  deps: NamedFunctionsDeps
): AdvancedResponse {
  return deps.error({
    code: ErrorCodes.FEATURE_UNAVAILABLE,
    message: `The ${action} action is kept for compatibility, but Google Sheets named functions are not exposed consistently through the current Sheets API surface.`,
    category: 'client',
    severity: 'medium',
    retryable: false,
    suggestedFix:
      'Create or manage named functions directly in the Google Sheets UI, or use Apps Script / named ranges for API-driven reusable logic.',
    resolution:
      'ServalSheets will not call unsupported named-function API endpoints. Use a supported workaround instead of retrying this action.',
  });
}

export async function handleCreateNamedFunctionAction(
  _req: CreateNamedFunctionRequest,
  deps: NamedFunctionsDeps
): Promise<AdvancedResponse> {
  return namedFunctionsUnavailable('create_named_function', deps);
}

export async function handleListNamedFunctionsAction(
  _req: ListNamedFunctionsRequest,
  deps: NamedFunctionsDeps
): Promise<AdvancedResponse> {
  return namedFunctionsUnavailable('list_named_functions', deps);
}

export async function handleGetNamedFunctionAction(
  _req: GetNamedFunctionRequest,
  deps: NamedFunctionsDeps
): Promise<AdvancedResponse> {
  return namedFunctionsUnavailable('get_named_function', deps);
}

export async function handleUpdateNamedFunctionAction(
  _req: UpdateNamedFunctionRequest,
  deps: NamedFunctionsDeps
): Promise<AdvancedResponse> {
  return namedFunctionsUnavailable('update_named_function', deps);
}

export async function handleDeleteNamedFunctionAction(
  _req: DeleteNamedFunctionRequest,
  deps: NamedFunctionsDeps
): Promise<AdvancedResponse> {
  return namedFunctionsUnavailable('delete_named_function', deps);
}
