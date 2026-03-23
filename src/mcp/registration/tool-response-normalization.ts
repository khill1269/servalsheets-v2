export type PlainRecord = Record<string, unknown>;

type StandardPaginationMeta = {
  hasMore: boolean;
  nextCursor?: string;
  totalCount?: number;
  count?: number;
  offset?: number;
  limit?: number;
};

type StandardCollectionMeta = {
  itemsField: string;
  count: number;
  totalCount?: number;
  hasMore?: boolean;
  nextCursor?: string;
  offset?: number;
  limit?: number;
};

const KNOWN_COLLECTION_FIELDS: string[] = [
  'items',
  'permissions',
  'comments',
  'replies',
  'revisions',
  'operations',
  'sheets',
  'templates',
  'charts',
  'valueRanges',
  'results',
  'tools',
  'servers',
];

export function isPlainRecord(value: unknown): value is PlainRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function getOptionalBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function getOptionalNonNegativeInt(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }

  const normalized = Math.trunc(value);
  return normalized >= 0 ? normalized : undefined;
}

export function getMetaRecord(container: PlainRecord): PlainRecord {
  const meta = container['_meta'];
  return isPlainRecord(meta) ? meta : {};
}

export function getResponseRecord(container: PlainRecord): PlainRecord | null {
  const response = container['response'];
  return isPlainRecord(response) ? response : null;
}

export function getErrorRecord(response: PlainRecord | null): PlainRecord | null {
  if (!response) {
    return null;
  }

  const error = response['error'];
  return isPlainRecord(error) ? error : null;
}

export function normalizeStructuredContent(result: unknown): PlainRecord {
  if (!isPlainRecord(result)) {
    return {
      response: {
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Tool handler returned non-object result',
          retryable: false,
        },
      },
    };
  }

  if ('response' in result) {
    return result;
  }

  if ('success' in result) {
    return { response: result };
  }

  return {
    response: {
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Tool handler returned invalid response shape',
        retryable: false,
      },
    },
  };
}

export function sanitizeErrorPayload(structuredContent: PlainRecord): void {
  const response = getResponseRecord(structuredContent);
  const error = getErrorRecord(response);
  if (!error) {
    return;
  }

  const details = error['details'];
  if (isPlainRecord(details)) {
    delete details['stack'];
    const pathPattern = /\/home\/|\/Users\/|node_modules\//;
    for (const key of Object.keys(details)) {
      const value = details[key];
      if (typeof value === 'string' && pathPattern.test(value)) {
        details[key] = '[REDACTED_PATH]';
      }
    }
  }

  delete error['stackTrace'];
}

function deriveStandardPaginationMeta(response: PlainRecord): StandardPaginationMeta | null {
  const responsePagination = isPlainRecord(response['pagination']) ? response['pagination'] : null;
  const source = responsePagination ?? response;

  const nextCursor =
    getOptionalString(source['nextCursor']) ??
    getOptionalString(source['next_cursor']) ??
    getOptionalString(source['nextPageToken']) ??
    getOptionalString(source['next_page_token']);

  const hasMore =
    getOptionalBoolean(source['hasMore']) ??
    getOptionalBoolean(source['has_more']) ??
    (nextCursor !== undefined ? true : undefined);

  if (hasMore === undefined) {
    return null;
  }

  const totalCount =
    getOptionalNonNegativeInt(source['totalCount']) ??
    getOptionalNonNegativeInt(source['total_count']) ??
    getOptionalNonNegativeInt(source['totalRows']) ??
    getOptionalNonNegativeInt(source['totalRanges']) ??
    getOptionalNonNegativeInt(source['totalSheets']) ??
    getOptionalNonNegativeInt(source['totalTemplates']) ??
    getOptionalNonNegativeInt(response['totalCount']) ??
    getOptionalNonNegativeInt(response['total_count']) ??
    getOptionalNonNegativeInt(response['totalRows']) ??
    getOptionalNonNegativeInt(response['totalRanges']) ??
    getOptionalNonNegativeInt(response['totalSheets']) ??
    getOptionalNonNegativeInt(response['totalTemplates']);

  const count =
    getOptionalNonNegativeInt(source['count']) ??
    getOptionalNonNegativeInt(response['count']) ??
    (Array.isArray(response['items']) ? response['items'].length : undefined) ??
    (Array.isArray(response['valueRanges']) ? response['valueRanges'].length : undefined);

  const offset =
    getOptionalNonNegativeInt(source['offset']) ?? getOptionalNonNegativeInt(response['offset']);
  const limit =
    getOptionalNonNegativeInt(source['limit']) ??
    getOptionalNonNegativeInt(source['pageSize']) ??
    getOptionalNonNegativeInt(source['maxResults']) ??
    getOptionalNonNegativeInt(response['limit']) ??
    getOptionalNonNegativeInt(response['pageSize']) ??
    getOptionalNonNegativeInt(response['maxResults']);

  return {
    hasMore,
    ...(nextCursor ? { nextCursor } : {}),
    ...(totalCount !== undefined ? { totalCount } : {}),
    ...(count !== undefined ? { count } : {}),
    ...(offset !== undefined ? { offset } : {}),
    ...(limit !== undefined ? { limit } : {}),
  };
}

export function injectStandardPaginationMeta(response: PlainRecord): void {
  const pagination = deriveStandardPaginationMeta(response);
  if (!pagination) {
    return;
  }

  const existingMeta = getMetaRecord(response);
  const existingPagination = isPlainRecord(existingMeta['pagination'])
    ? existingMeta['pagination']
    : {};

  response['_meta'] = {
    ...existingMeta,
    pagination: {
      ...pagination,
      ...existingPagination,
    },
  };

  const existingTopLevelPagination = isPlainRecord(response['pagination'])
    ? response['pagination']
    : {};
  response['pagination'] = {
    ...pagination,
    ...existingTopLevelPagination,
  };
}

function deriveStandardCollectionMeta(response: PlainRecord): StandardCollectionMeta | null {
  let itemsField: string | undefined;
  let count: number | undefined;

  for (const field of KNOWN_COLLECTION_FIELDS) {
    const value = response[field];
    if (Array.isArray(value)) {
      itemsField = field;
      count = value.length;
      break;
    }
  }

  if (!itemsField) {
    for (const [key, value] of Object.entries(response)) {
      if (key === 'pagination' || key === '_meta' || key.startsWith('_')) {
        continue;
      }
      if (Array.isArray(value)) {
        itemsField = key;
        count = value.length;
        break;
      }
    }
  }

  if (!itemsField || count === undefined) {
    return null;
  }

  const meta = getMetaRecord(response);
  const pagination = isPlainRecord(meta['pagination']) ? meta['pagination'] : null;

  const totalCount =
    (pagination ? getOptionalNonNegativeInt(pagination['totalCount']) : undefined) ??
    getOptionalNonNegativeInt(response['totalCount']) ??
    getOptionalNonNegativeInt(response['total_count']) ??
    getOptionalNonNegativeInt(response['totalRows']) ??
    getOptionalNonNegativeInt(response['totalRanges']) ??
    getOptionalNonNegativeInt(response['totalSheets']);

  const hasMore = pagination ? getOptionalBoolean(pagination['hasMore']) : undefined;
  const nextCursor = pagination ? getOptionalString(pagination['nextCursor']) : undefined;
  const offset = pagination ? getOptionalNonNegativeInt(pagination['offset']) : undefined;
  const limit = pagination ? getOptionalNonNegativeInt(pagination['limit']) : undefined;

  return {
    itemsField,
    count,
    ...(totalCount !== undefined ? { totalCount } : {}),
    ...(hasMore !== undefined ? { hasMore } : {}),
    ...(nextCursor ? { nextCursor } : {}),
    ...(offset !== undefined ? { offset } : {}),
    ...(limit !== undefined ? { limit } : {}),
  };
}

export function injectStandardCollectionMeta(response: PlainRecord): void {
  const collection = deriveStandardCollectionMeta(response);
  if (!collection) {
    return;
  }

  const existingMeta = getMetaRecord(response);
  const existingCollection = isPlainRecord(existingMeta['collection'])
    ? existingMeta['collection']
    : {};

  response['_meta'] = {
    ...existingMeta,
    collection: {
      ...collection,
      ...existingCollection,
    },
  };
}
