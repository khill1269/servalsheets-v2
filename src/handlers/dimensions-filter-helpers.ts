import type { sheets_v4 } from 'googleapis';

export interface DimensionsFilterCriterionInput {
  hiddenValues?: string[];
  condition?: { type: string; values?: string[] };
  visibleBackgroundColor?: Record<string, unknown>;
  visibleForegroundColor?: Record<string, unknown>;
}

export interface FilterViewSummary {
  filterViewId: number;
  title: string;
  range: {
    sheetId: number;
    startRowIndex?: number;
    endRowIndex?: number;
    startColumnIndex?: number;
    endColumnIndex?: number;
  };
}

export function mapDimensionsCriteria(
  input: Record<number, DimensionsFilterCriterionInput>
): Record<string, sheets_v4.Schema$FilterCriteria> {
  return Object.entries(input).reduce(
    (acc, [col, crit]) => {
      acc[col] = mapSingleCriteria(crit);
      return acc;
    },
    {} as Record<string, sheets_v4.Schema$FilterCriteria>
  );
}

function mapSingleCriteria(crit: DimensionsFilterCriterionInput): sheets_v4.Schema$FilterCriteria {
  return {
    hiddenValues: crit.hiddenValues,
    visibleBackgroundColor: crit.visibleBackgroundColor,
    visibleForegroundColor: crit.visibleForegroundColor,
    condition: crit.condition
      ? {
          type: crit.condition.type as sheets_v4.Schema$BooleanCondition['type'],
          values: crit.condition.values?.map((v) => ({
            userEnteredValue: v,
          })),
        }
      : undefined,
  };
}

export function toApiSlicerFilterCriteria(criteria: {
  hiddenValues?: string[];
  condition?: { type: string; values?: string[] };
  visibleBackgroundColor?: Record<string, unknown>;
  visibleForegroundColor?: Record<string, unknown>;
}): sheets_v4.Schema$FilterCriteria {
  return {
    ...criteria,
    condition: criteria.condition
      ? {
          type: criteria.condition.type,
          values: criteria.condition.values?.map((v) => ({ userEnteredValue: v })),
        }
      : undefined,
  } as sheets_v4.Schema$FilterCriteria;
}

export function collectFilterViewSummaries(params: {
  sheets: sheets_v4.Schema$Sheet[] | undefined;
  sheetId?: number;
  gridRangeToOutput: (range: sheets_v4.Schema$GridRange) => {
    sheetId: number;
    startRowIndex?: number;
    endRowIndex?: number;
    startColumnIndex?: number;
    endColumnIndex?: number;
  };
}): FilterViewSummary[] {
  const { sheets, sheetId, gridRangeToOutput } = params;
  const filterViews: FilterViewSummary[] = [];

  for (const sheet of sheets ?? []) {
    if (sheetId !== undefined && sheet.properties?.sheetId !== sheetId) {
      continue;
    }

    for (const fv of sheet.filterViews ?? []) {
      filterViews.push({
        filterViewId: fv.filterViewId ?? 0,
        title: fv.title ?? '',
        range: gridRangeToOutput(fv.range ?? { sheetId: sheet.properties?.sheetId ?? 0 }),
      });
    }
  }

  return filterViews;
}

export function paginateFilterViews(
  filterViews: FilterViewSummary[],
  limit = 50,
  cursor?: string
): {
  filterViews: FilterViewSummary[];
  totalCount: number;
  hasMore: boolean;
  nextCursor?: string;
} {
  const parsedOffset = cursor ? parseInt(cursor, 10) : 0;
  const offset = Number.isFinite(parsedOffset) && parsedOffset >= 0 ? parsedOffset : 0;
  const totalCount = filterViews.length;
  const pagedFilterViews = filterViews.slice(offset, offset + limit);
  const hasMore = offset + limit < totalCount;
  const nextCursor = hasMore ? String(offset + limit) : undefined;

  return {
    filterViews: pagedFilterViews,
    totalCount,
    hasMore,
    ...(nextCursor !== undefined ? { nextCursor } : {}),
  };
}

export function findFilterViewSummaryById(params: {
  sheets: sheets_v4.Schema$Sheet[] | undefined;
  filterViewId: number;
  gridRangeToOutput: (range: sheets_v4.Schema$GridRange) => {
    sheetId: number;
    startRowIndex?: number;
    endRowIndex?: number;
    startColumnIndex?: number;
    endColumnIndex?: number;
  };
}): FilterViewSummary | null {
  const { sheets, filterViewId, gridRangeToOutput } = params;

  for (const sheet of sheets ?? []) {
    for (const fv of sheet.filterViews ?? []) {
      if (fv.filterViewId === filterViewId) {
        return {
          filterViewId: fv.filterViewId ?? 0,
          title: fv.title ?? '',
          range: gridRangeToOutput(fv.range ?? { sheetId: sheet.properties?.sheetId ?? 0 }),
        };
      }
    }
  }

  return null;
}
