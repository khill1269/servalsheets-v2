/**
 * ServalSheets - Request Builder
 *
 * Phase 2.1: Direct Google API Request Builders
 * Replaces the Intent abstraction with direct, type-safe request construction
 *
 * Benefits:
 * - Direct 1:1 mapping to Google Sheets API documentation
 * - Type safety via googleapis TypeScript definitions
 * - No abstraction layer between ServalSheets and Google API
 * - Easier to adopt new Google API features
 *
 * Architecture:
 * OLD: Handler → Intent → BatchCompiler → intentToRequest() → Google API
 * NEW: Handler → RequestBuilder → BatchCompiler → Google API
 */

import type { sheets_v4 } from 'googleapis';

/**
 * Request metadata for safety rails and quota tracking
 */
export interface RequestMetadata {
  /** Source tool that created this request */
  sourceTool: string;
  /** Source action that created this request */
  sourceAction: string;
  /** Transaction ID for grouping related requests */
  transactionId?: string;
  /** Priority (higher = executed first in batch) */
  priority?: number;
  /** Whether this request is destructive (deletes data/structure) */
  destructive: boolean;
  /** Whether this request is high-risk (requires auto-snapshot) */
  highRisk: boolean;
  /** Estimated number of cells affected */
  estimatedCells?: number;
  /** Spreadsheet ID this request targets */
  spreadsheetId: string;
  /** Sheet ID this request targets (if applicable) */
  sheetId?: number;
  /** Range this request targets (if applicable) */
  range?: string;
}

/**
 * Wrapped request with metadata
 */
export interface WrappedRequest {
  request: sheets_v4.Schema$Request;
  metadata: RequestMetadata;
}

/**
 * Base options for all requests
 */
interface BaseRequestOptions {
  spreadsheetId: string;
  sourceTool: string;
  sourceAction: string;
  transactionId?: string;
  priority?: number;
}

/**
 * Request builder for Google Sheets API v4
 *
 * Provides type-safe, validated request construction for all Google API request types.
 * Each method returns a WrappedRequest with metadata for safety rails and quota tracking.
 */
export class RequestBuilder {
  /**
   * Create an updateCells request (for setting cell values, formatting, etc.)
   */
  static updateCells(
    options: BaseRequestOptions & {
      rows: sheets_v4.Schema$RowData[];
      range?: sheets_v4.Schema$GridRange;
      fields?: string;
    }
  ): WrappedRequest {
    const estimatedCells =
      (options.range
        ? ((options.range.endRowIndex ?? 1) - (options.range.startRowIndex ?? 0)) *
          ((options.range.endColumnIndex ?? 1) - (options.range.startColumnIndex ?? 0))
        : options.rows.reduce((sum, row) => sum + (row.values?.length ?? 0), 0)) ?? 0;

    return {
      request: {
        updateCells: {
          rows: options.rows,
          range: options.range,
          fields: options.fields ?? '*',
        },
      },
      metadata: {
        sourceTool: options.sourceTool,
        sourceAction: options.sourceAction,
        transactionId: options.transactionId,
        priority: options.priority,
        destructive: false,
        highRisk: false,
        estimatedCells,
        spreadsheetId: options.spreadsheetId,
        sheetId: options.range?.sheetId ?? undefined,
      },
    };
  }

  /**
   * Create a repeatCell request (for formatting ranges efficiently)
   */
  static repeatCell(
    options: BaseRequestOptions & {
      range: sheets_v4.Schema$GridRange;
      cell: sheets_v4.Schema$CellData;
      fields: string;
    }
  ): WrappedRequest {
    const estimatedCells =
      ((options.range.endRowIndex ?? 1) - (options.range.startRowIndex ?? 0)) *
      ((options.range.endColumnIndex ?? 1) - (options.range.startColumnIndex ?? 0));

    return {
      request: {
        repeatCell: {
          range: options.range,
          cell: options.cell,
          fields: options.fields,
        },
      },
      metadata: {
        sourceTool: options.sourceTool,
        sourceAction: options.sourceAction,
        transactionId: options.transactionId,
        priority: options.priority,
        destructive: false,
        highRisk: false,
        estimatedCells,
        spreadsheetId: options.spreadsheetId,
        sheetId: options.range.sheetId ?? undefined,
      },
    };
  }

  /**
   * Create an addSheet request
   */
  static addSheet(
    options: BaseRequestOptions & {
      properties: sheets_v4.Schema$SheetProperties;
    }
  ): WrappedRequest {
    return {
      request: {
        addSheet: {
          properties: options.properties,
        },
      },
      metadata: {
        sourceTool: options.sourceTool,
        sourceAction: options.sourceAction,
        transactionId: options.transactionId,
        priority: options.priority,
        destructive: false,
        highRisk: false,
        spreadsheetId: options.spreadsheetId,
      },
    };
  }

  /**
   * Create a deleteSheet request
   */
  static deleteSheet(
    options: BaseRequestOptions & {
      sheetId: number;
    }
  ): WrappedRequest {
    return {
      request: {
        deleteSheet: {
          sheetId: options.sheetId,
        },
      },
      metadata: {
        sourceTool: options.sourceTool,
        sourceAction: options.sourceAction,
        transactionId: options.transactionId,
        priority: options.priority,
        destructive: true,
        highRisk: true,
        spreadsheetId: options.spreadsheetId,
        sheetId: options.sheetId,
      },
    };
  }

  /**
   * Create an updateSheetProperties request
   */
  static updateSheetProperties(
    options: BaseRequestOptions & {
      properties: sheets_v4.Schema$SheetProperties;
      fields: string;
    }
  ): WrappedRequest {
    return {
      request: {
        updateSheetProperties: {
          properties: options.properties,
          fields: options.fields,
        },
      },
      metadata: {
        sourceTool: options.sourceTool,
        sourceAction: options.sourceAction,
        transactionId: options.transactionId,
        priority: options.priority,
        destructive: false,
        highRisk: false,
        spreadsheetId: options.spreadsheetId,
        sheetId: options.properties.sheetId ?? undefined,
      },
    };
  }

  /**
   * Create a duplicateSheet request
   */
  static duplicateSheet(
    options: BaseRequestOptions & {
      sourceSheetId: number;
      insertSheetIndex?: number;
      newSheetId?: number;
      newSheetName?: string;
    }
  ): WrappedRequest {
    return {
      request: {
        duplicateSheet: {
          sourceSheetId: options.sourceSheetId,
          insertSheetIndex: options.insertSheetIndex,
          newSheetId: options.newSheetId,
          newSheetName: options.newSheetName,
        },
      },
      metadata: {
        sourceTool: options.sourceTool,
        sourceAction: options.sourceAction,
        transactionId: options.transactionId,
        priority: options.priority,
        destructive: false,
        highRisk: false,
        spreadsheetId: options.spreadsheetId,
        sheetId: options.sourceSheetId,
      },
    };
  }

  /**
   * Create an insertDimension request
   */
  static insertDimension(
    options: BaseRequestOptions & {
      range: sheets_v4.Schema$DimensionRange;
      inheritFromBefore?: boolean;
    }
  ): WrappedRequest {
    const estimatedCells = ((options.range.endIndex ?? 1) - (options.range.startIndex ?? 0)) * 1000; // Estimate 1000 cells per row/column

    return {
      request: {
        insertDimension: {
          range: options.range,
          inheritFromBefore: options.inheritFromBefore,
        },
      },
      metadata: {
        sourceTool: options.sourceTool,
        sourceAction: options.sourceAction,
        transactionId: options.transactionId,
        priority: options.priority,
        destructive: false,
        highRisk: false,
        estimatedCells,
        spreadsheetId: options.spreadsheetId,
        sheetId: options.range.sheetId ?? undefined,
      },
    };
  }

  /**
   * Create a deleteDimension request
   */
  static deleteDimension(
    options: BaseRequestOptions & {
      range: sheets_v4.Schema$DimensionRange;
    }
  ): WrappedRequest {
    const estimatedCells = ((options.range.endIndex ?? 1) - (options.range.startIndex ?? 0)) * 1000; // Estimate 1000 cells per row/column

    return {
      request: {
        deleteDimension: {
          range: options.range,
        },
      },
      metadata: {
        sourceTool: options.sourceTool,
        sourceAction: options.sourceAction,
        transactionId: options.transactionId,
        priority: options.priority,
        destructive: true,
        highRisk: true,
        estimatedCells,
        spreadsheetId: options.spreadsheetId,
        sheetId: options.range.sheetId ?? undefined,
      },
    };
  }

  /**
   * Create a moveDimension request
   */
  static moveDimension(
    options: BaseRequestOptions & {
      source: sheets_v4.Schema$DimensionRange;
      destinationIndex: number;
    }
  ): WrappedRequest {
    return {
      request: {
        moveDimension: {
          source: options.source,
          destinationIndex: options.destinationIndex,
        },
      },
      metadata: {
        sourceTool: options.sourceTool,
        sourceAction: options.sourceAction,
        transactionId: options.transactionId,
        priority: options.priority,
        destructive: false,
        highRisk: false,
        spreadsheetId: options.spreadsheetId,
        sheetId: options.source.sheetId ?? undefined,
      },
    };
  }

  /**
   * Create an updateDimensionProperties request
   */
  static updateDimensionProperties(
    options: BaseRequestOptions & {
      range: sheets_v4.Schema$DimensionRange;
      properties: sheets_v4.Schema$DimensionProperties;
      fields: string;
    }
  ): WrappedRequest {
    return {
      request: {
        updateDimensionProperties: {
          range: options.range,
          properties: options.properties,
          fields: options.fields,
        },
      },
      metadata: {
        sourceTool: options.sourceTool,
        sourceAction: options.sourceAction,
        transactionId: options.transactionId,
        priority: options.priority,
        destructive: false,
        highRisk: false,
        spreadsheetId: options.spreadsheetId,
        sheetId: options.range.sheetId ?? undefined,
      },
    };
  }

  /**
   * Create an appendDimension request
   */
  static appendDimension(
    options: BaseRequestOptions & {
      sheetId: number;
      dimension: 'ROWS' | 'COLUMNS';
      length: number;
    }
  ): WrappedRequest {
    return {
      request: {
        appendDimension: {
          sheetId: options.sheetId,
          dimension: options.dimension,
          length: options.length,
        },
      },
      metadata: {
        sourceTool: options.sourceTool,
        sourceAction: options.sourceAction,
        transactionId: options.transactionId,
        priority: options.priority,
        destructive: false,
        highRisk: false,
        estimatedCells: options.length * 1000, // Estimate 1000 cells per row/column
        spreadsheetId: options.spreadsheetId,
        sheetId: options.sheetId,
      },
    };
  }

  /**
   * Create an autoResizeDimensions request
   */
  static autoResizeDimensions(
    options: BaseRequestOptions & {
      dimensions: sheets_v4.Schema$DimensionRange;
    }
  ): WrappedRequest {
    return {
      request: {
        autoResizeDimensions: {
          dimensions: options.dimensions,
        },
      },
      metadata: {
        sourceTool: options.sourceTool,
        sourceAction: options.sourceAction,
        transactionId: options.transactionId,
        priority: options.priority,
        destructive: false,
        highRisk: false,
        spreadsheetId: options.spreadsheetId,
        sheetId: options.dimensions.sheetId ?? undefined,
      },
    };
  }

  /**
   * Create an updateBorders request
   */
  static updateBorders(
    options: BaseRequestOptions & {
      range: sheets_v4.Schema$GridRange;
      top?: sheets_v4.Schema$Border;
      bottom?: sheets_v4.Schema$Border;
      left?: sheets_v4.Schema$Border;
      right?: sheets_v4.Schema$Border;
      innerHorizontal?: sheets_v4.Schema$Border;
      innerVertical?: sheets_v4.Schema$Border;
    }
  ): WrappedRequest {
    const estimatedCells =
      ((options.range.endRowIndex ?? 1) - (options.range.startRowIndex ?? 0)) *
      ((options.range.endColumnIndex ?? 1) - (options.range.startColumnIndex ?? 0));

    return {
      request: {
        updateBorders: {
          range: options.range,
          top: options.top,
          bottom: options.bottom,
          left: options.left,
          right: options.right,
          innerHorizontal: options.innerHorizontal,
          innerVertical: options.innerVertical,
        },
      },
      metadata: {
        sourceTool: options.sourceTool,
        sourceAction: options.sourceAction,
        transactionId: options.transactionId,
        priority: options.priority,
        destructive: false,
        highRisk: false,
        estimatedCells,
        spreadsheetId: options.spreadsheetId,
        sheetId: options.range.sheetId ?? undefined,
      },
    };
  }

  /**
   * Create a mergeCells request
   */
  static mergeCells(
    options: BaseRequestOptions & {
      range: sheets_v4.Schema$GridRange;
      mergeType: 'MERGE_ALL' | 'MERGE_COLUMNS' | 'MERGE_ROWS';
    }
  ): WrappedRequest {
    const estimatedCells =
      ((options.range.endRowIndex ?? 1) - (options.range.startRowIndex ?? 0)) *
      ((options.range.endColumnIndex ?? 1) - (options.range.startColumnIndex ?? 0));

    return {
      request: {
        mergeCells: {
          range: options.range,
          mergeType: options.mergeType,
        },
      },
      metadata: {
        sourceTool: options.sourceTool,
        sourceAction: options.sourceAction,
        transactionId: options.transactionId,
        priority: options.priority,
        destructive: false,
        highRisk: false,
        estimatedCells,
        spreadsheetId: options.spreadsheetId,
        sheetId: options.range.sheetId ?? undefined,
      },
    };
  }

  /**
   * Create an unmergeCells request
   */
  static unmergeCells(
    options: BaseRequestOptions & {
      range: sheets_v4.Schema$GridRange;
    }
  ): WrappedRequest {
    const estimatedCells =
      ((options.range.endRowIndex ?? 1) - (options.range.startRowIndex ?? 0)) *
      ((options.range.endColumnIndex ?? 1) - (options.range.startColumnIndex ?? 0));

    return {
      request: {
        unmergeCells: {
          range: options.range,
        },
      },
      metadata: {
        sourceTool: options.sourceTool,
        sourceAction: options.sourceAction,
        transactionId: options.transactionId,
        priority: options.priority,
        destructive: false,
        highRisk: false,
        estimatedCells,
        spreadsheetId: options.spreadsheetId,
        sheetId: options.range.sheetId ?? undefined,
      },
    };
  }

  /**
   * Create a copyPaste request
   */
  static copyPaste(
    options: BaseRequestOptions & {
      source: sheets_v4.Schema$GridRange;
      destination: sheets_v4.Schema$GridRange;
      pasteType?:
        | 'PASTE_NORMAL'
        | 'PASTE_VALUES'
        | 'PASTE_FORMAT'
        | 'PASTE_NO_BORDERS'
        | 'PASTE_FORMULA'
        | 'PASTE_DATA_VALIDATION'
        | 'PASTE_CONDITIONAL_FORMATTING';
      pasteOrientation?: 'NORMAL' | 'TRANSPOSE';
    }
  ): WrappedRequest {
    const estimatedCells =
      ((options.destination.endRowIndex ?? 1) - (options.destination.startRowIndex ?? 0)) *
      ((options.destination.endColumnIndex ?? 1) - (options.destination.startColumnIndex ?? 0));

    return {
      request: {
        copyPaste: {
          source: options.source,
          destination: options.destination,
          pasteType: options.pasteType ?? 'PASTE_NORMAL',
          pasteOrientation: options.pasteOrientation ?? 'NORMAL',
        },
      },
      metadata: {
        sourceTool: options.sourceTool,
        sourceAction: options.sourceAction,
        transactionId: options.transactionId,
        priority: options.priority,
        destructive: false,
        highRisk: false,
        estimatedCells,
        spreadsheetId: options.spreadsheetId,
        sheetId: options.destination.sheetId ?? undefined,
      },
    };
  }

  /**
   * Create a cutPaste request
   */
  static cutPaste(
    options: BaseRequestOptions & {
      source: sheets_v4.Schema$GridRange;
      destination: sheets_v4.Schema$GridCoordinate;
      pasteType?:
        | 'PASTE_NORMAL'
        | 'PASTE_VALUES'
        | 'PASTE_FORMAT'
        | 'PASTE_NO_BORDERS'
        | 'PASTE_FORMULA'
        | 'PASTE_DATA_VALIDATION'
        | 'PASTE_CONDITIONAL_FORMATTING';
    }
  ): WrappedRequest {
    const estimatedCells =
      ((options.source.endRowIndex ?? 1) - (options.source.startRowIndex ?? 0)) *
      ((options.source.endColumnIndex ?? 1) - (options.source.startColumnIndex ?? 0));

    return {
      request: {
        cutPaste: {
          source: options.source,
          destination: options.destination,
          pasteType: options.pasteType ?? 'PASTE_NORMAL',
        },
      },
      metadata: {
        sourceTool: options.sourceTool,
        sourceAction: options.sourceAction,
        transactionId: options.transactionId,
        priority: options.priority,
        destructive: true,
        highRisk: false,
        estimatedCells,
        spreadsheetId: options.spreadsheetId,
        sheetId: options.source.sheetId ?? undefined,
      },
    };
  }

  /**
   * Create a findReplace request
   */
  static findReplace(
    options: BaseRequestOptions & {
      find: string;
      replacement: string;
      range?: sheets_v4.Schema$GridRange;
      sheetId?: number;
      allSheets?: boolean;
      matchCase?: boolean;
      matchEntireCell?: boolean;
      searchByRegex?: boolean;
      includeFormulas?: boolean;
    }
  ): WrappedRequest {
    const estimatedCells = options.range
      ? ((options.range.endRowIndex ?? 1) - (options.range.startRowIndex ?? 0)) *
        ((options.range.endColumnIndex ?? 1) - (options.range.startColumnIndex ?? 0))
      : 10000; // Default estimate for allSheets

    return {
      request: {
        findReplace: {
          find: options.find,
          replacement: options.replacement,
          range: options.range,
          sheetId: options.sheetId,
          allSheets: options.allSheets,
          matchCase: options.matchCase,
          matchEntireCell: options.matchEntireCell,
          searchByRegex: options.searchByRegex,
          includeFormulas: options.includeFormulas,
        },
      },
      metadata: {
        sourceTool: options.sourceTool,
        sourceAction: options.sourceAction,
        transactionId: options.transactionId,
        priority: options.priority,
        destructive: true,
        highRisk: false,
        estimatedCells,
        spreadsheetId: options.spreadsheetId,
        sheetId: options.sheetId ?? options.range?.sheetId ?? undefined,
      },
    };
  }

  /**
   * Create a setDataValidation request
   */
  static setDataValidation(
    options: BaseRequestOptions & {
      range: sheets_v4.Schema$GridRange;
      rule?: sheets_v4.Schema$DataValidationRule;
    }
  ): WrappedRequest {
    const estimatedCells =
      ((options.range.endRowIndex ?? 1) - (options.range.startRowIndex ?? 0)) *
      ((options.range.endColumnIndex ?? 1) - (options.range.startColumnIndex ?? 0));

    return {
      request: {
        setDataValidation: {
          range: options.range,
          rule: options.rule,
        },
      },
      metadata: {
        sourceTool: options.sourceTool,
        sourceAction: options.sourceAction,
        transactionId: options.transactionId,
        priority: options.priority,
        destructive: !options.rule, // No rule = clear validation
        highRisk: false,
        estimatedCells,
        spreadsheetId: options.spreadsheetId,
        sheetId: options.range.sheetId ?? undefined,
      },
    };
  }

  /**
   * Create an addConditionalFormatRule request
   */
  static addConditionalFormatRule(
    options: BaseRequestOptions & {
      rule: sheets_v4.Schema$ConditionalFormatRule;
      index?: number;
    }
  ): WrappedRequest {
    const estimatedCells = options.rule.ranges
      ? options.rule.ranges.reduce((sum, range) => {
          return (
            sum +
            ((range.endRowIndex ?? 1) - (range.startRowIndex ?? 0)) *
              ((range.endColumnIndex ?? 1) - (range.startColumnIndex ?? 0))
          );
        }, 0)
      : 0;

    return {
      request: {
        addConditionalFormatRule: {
          rule: options.rule,
          index: options.index,
        },
      },
      metadata: {
        sourceTool: options.sourceTool,
        sourceAction: options.sourceAction,
        transactionId: options.transactionId,
        priority: options.priority,
        destructive: false,
        highRisk: false,
        estimatedCells,
        spreadsheetId: options.spreadsheetId,
        sheetId: options.rule.ranges?.[0]?.sheetId ?? undefined,
      },
    };
  }

  /**
   * Create an updateConditionalFormatRule request
   */
  static updateConditionalFormatRule(
    options: BaseRequestOptions & {
      index: number;
      sheetId: number;
      rule: sheets_v4.Schema$ConditionalFormatRule;
    }
  ): WrappedRequest {
    return {
      request: {
        updateConditionalFormatRule: {
          index: options.index,
          sheetId: options.sheetId,
          rule: options.rule,
        },
      },
      metadata: {
        sourceTool: options.sourceTool,
        sourceAction: options.sourceAction,
        transactionId: options.transactionId,
        priority: options.priority,
        destructive: false,
        highRisk: false,
        spreadsheetId: options.spreadsheetId,
        sheetId: options.sheetId,
      },
    };
  }

  /**
   * Create a deleteConditionalFormatRule request
   */
  static deleteConditionalFormatRule(
    options: BaseRequestOptions & {
      index: number;
      sheetId: number;
    }
  ): WrappedRequest {
    return {
      request: {
        deleteConditionalFormatRule: {
          index: options.index,
          sheetId: options.sheetId,
        },
      },
      metadata: {
        sourceTool: options.sourceTool,
        sourceAction: options.sourceAction,
        transactionId: options.transactionId,
        priority: options.priority,
        destructive: true,
        highRisk: false,
        spreadsheetId: options.spreadsheetId,
        sheetId: options.sheetId,
      },
    };
  }

  /**
   * Create a sortRange request
   */
  static sortRange(
    options: BaseRequestOptions & {
      range: sheets_v4.Schema$GridRange;
      sortSpecs: sheets_v4.Schema$SortSpec[];
    }
  ): WrappedRequest {
    const estimatedCells =
      ((options.range.endRowIndex ?? 1) - (options.range.startRowIndex ?? 0)) *
      ((options.range.endColumnIndex ?? 1) - (options.range.startColumnIndex ?? 0));

    return {
      request: {
        sortRange: {
          range: options.range,
          sortSpecs: options.sortSpecs,
        },
      },
      metadata: {
        sourceTool: options.sourceTool,
        sourceAction: options.sourceAction,
        transactionId: options.transactionId,
        priority: options.priority,
        destructive: false,
        highRisk: false,
        estimatedCells,
        spreadsheetId: options.spreadsheetId,
        sheetId: options.range.sheetId ?? undefined,
      },
    };
  }

  /**
   * Create a setBasicFilter request
   */
  static setBasicFilter(
    options: BaseRequestOptions & {
      filter: sheets_v4.Schema$BasicFilter;
    }
  ): WrappedRequest {
    return {
      request: {
        setBasicFilter: {
          filter: options.filter,
        },
      },
      metadata: {
        sourceTool: options.sourceTool,
        sourceAction: options.sourceAction,
        transactionId: options.transactionId,
        priority: options.priority,
        destructive: false,
        highRisk: false,
        spreadsheetId: options.spreadsheetId,
        sheetId: options.filter.range?.sheetId ?? undefined,
      },
    };
  }

  /**
   * Create a clearBasicFilter request
   */
  static clearBasicFilter(
    options: BaseRequestOptions & {
      sheetId: number;
    }
  ): WrappedRequest {
    return {
      request: {
        clearBasicFilter: {
          sheetId: options.sheetId,
        },
      },
      metadata: {
        sourceTool: options.sourceTool,
        sourceAction: options.sourceAction,
        transactionId: options.transactionId,
        priority: options.priority,
        destructive: false,
        highRisk: false,
        spreadsheetId: options.spreadsheetId,
        sheetId: options.sheetId,
      },
    };
  }

  /**
   * Create an addFilterView request
   */
  static addFilterView(
    options: BaseRequestOptions & {
      filter: sheets_v4.Schema$FilterView;
    }
  ): WrappedRequest {
    return {
      request: {
        addFilterView: {
          filter: options.filter,
        },
      },
      metadata: {
        sourceTool: options.sourceTool,
        sourceAction: options.sourceAction,
        transactionId: options.transactionId,
        priority: options.priority,
        destructive: false,
        highRisk: false,
        spreadsheetId: options.spreadsheetId,
        sheetId: options.filter.range?.sheetId ?? undefined,
      },
    };
  }

  /**
   * Create an updateFilterView request
   */
  static updateFilterView(
    options: BaseRequestOptions & {
      filter: sheets_v4.Schema$FilterView;
      fields: string;
    }
  ): WrappedRequest {
    return {
      request: {
        updateFilterView: {
          filter: options.filter,
          fields: options.fields,
        },
      },
      metadata: {
        sourceTool: options.sourceTool,
        sourceAction: options.sourceAction,
        transactionId: options.transactionId,
        priority: options.priority,
        destructive: false,
        highRisk: false,
        spreadsheetId: options.spreadsheetId,
        sheetId: options.filter.range?.sheetId ?? undefined,
      },
    };
  }

  /**
   * Create a deleteFilterView request
   */
  static deleteFilterView(
    options: BaseRequestOptions & {
      filterId: number;
    }
  ): WrappedRequest {
    return {
      request: {
        deleteFilterView: {
          filterId: options.filterId,
        },
      },
      metadata: {
        sourceTool: options.sourceTool,
        sourceAction: options.sourceAction,
        transactionId: options.transactionId,
        priority: options.priority,
        destructive: true,
        highRisk: false,
        spreadsheetId: options.spreadsheetId,
      },
    };
  }

  /**
   * Create an addChart request
   */
  static addChart(
    options: BaseRequestOptions & {
      chart: sheets_v4.Schema$EmbeddedChart;
    }
  ): WrappedRequest {
    return {
      request: {
        addChart: {
          chart: options.chart,
        },
      },
      metadata: {
        sourceTool: options.sourceTool,
        sourceAction: options.sourceAction,
        transactionId: options.transactionId,
        priority: options.priority,
        destructive: false,
        highRisk: false,
        spreadsheetId: options.spreadsheetId,
        sheetId: options.chart.position?.overlayPosition?.anchorCell?.sheetId ?? undefined,
      },
    };
  }

  /**
   * Create an updateChartSpec request
   */
  static updateChartSpec(
    options: BaseRequestOptions & {
      chartId: number;
      spec: sheets_v4.Schema$ChartSpec;
    }
  ): WrappedRequest {
    return {
      request: {
        updateChartSpec: {
          chartId: options.chartId,
          spec: options.spec,
        },
      },
      metadata: {
        sourceTool: options.sourceTool,
        sourceAction: options.sourceAction,
        transactionId: options.transactionId,
        priority: options.priority,
        destructive: false,
        highRisk: false,
        spreadsheetId: options.spreadsheetId,
      },
    };
  }

  /**
   * Create a deleteEmbeddedObject request (for charts, slicers)
   */
  static deleteEmbeddedObject(
    options: BaseRequestOptions & {
      objectId: number;
    }
  ): WrappedRequest {
    return {
      request: {
        deleteEmbeddedObject: {
          objectId: options.objectId,
        },
      },
      metadata: {
        sourceTool: options.sourceTool,
        sourceAction: options.sourceAction,
        transactionId: options.transactionId,
        priority: options.priority,
        destructive: true,
        highRisk: false,
        spreadsheetId: options.spreadsheetId,
      },
    };
  }

  /**
   * Create an addSlicer request
   */
  static addSlicer(
    options: BaseRequestOptions & {
      slicer: sheets_v4.Schema$Slicer;
    }
  ): WrappedRequest {
    return {
      request: {
        addSlicer: {
          slicer: options.slicer,
        },
      },
      metadata: {
        sourceTool: options.sourceTool,
        sourceAction: options.sourceAction,
        transactionId: options.transactionId,
        priority: options.priority,
        destructive: false,
        highRisk: false,
        spreadsheetId: options.spreadsheetId,
        sheetId: options.slicer.position?.overlayPosition?.anchorCell?.sheetId ?? undefined,
      },
    };
  }

  /**
   * Create an updateSlicerSpec request
   */
  static updateSlicerSpec(
    options: BaseRequestOptions & {
      slicerId: number;
      spec: sheets_v4.Schema$SlicerSpec;
      fields: string;
    }
  ): WrappedRequest {
    return {
      request: {
        updateSlicerSpec: {
          slicerId: options.slicerId,
          spec: options.spec,
          fields: options.fields,
        },
      },
      metadata: {
        sourceTool: options.sourceTool,
        sourceAction: options.sourceAction,
        transactionId: options.transactionId,
        priority: options.priority,
        destructive: false,
        highRisk: false,
        spreadsheetId: options.spreadsheetId,
      },
    };
  }

  /**
   * Create an addNamedRange request
   */
  static addNamedRange(
    options: BaseRequestOptions & {
      namedRange: sheets_v4.Schema$NamedRange;
    }
  ): WrappedRequest {
    return {
      request: {
        addNamedRange: {
          namedRange: options.namedRange,
        },
      },
      metadata: {
        sourceTool: options.sourceTool,
        sourceAction: options.sourceAction,
        transactionId: options.transactionId,
        priority: options.priority,
        destructive: false,
        highRisk: false,
        spreadsheetId: options.spreadsheetId,
        sheetId: options.namedRange.range?.sheetId ?? undefined,
      },
    };
  }

  /**
   * Create an updateNamedRange request
   */
  static updateNamedRange(
    options: BaseRequestOptions & {
      namedRange: sheets_v4.Schema$NamedRange;
      fields: string;
    }
  ): WrappedRequest {
    return {
      request: {
        updateNamedRange: {
          namedRange: options.namedRange,
          fields: options.fields,
        },
      },
      metadata: {
        sourceTool: options.sourceTool,
        sourceAction: options.sourceAction,
        transactionId: options.transactionId,
        priority: options.priority,
        destructive: false,
        highRisk: false,
        spreadsheetId: options.spreadsheetId,
        sheetId: options.namedRange.range?.sheetId ?? undefined,
      },
    };
  }

  /**
   * Create a deleteNamedRange request
   */
  static deleteNamedRange(
    options: BaseRequestOptions & {
      namedRangeId: string;
    }
  ): WrappedRequest {
    return {
      request: {
        deleteNamedRange: {
          namedRangeId: options.namedRangeId,
        },
      },
      metadata: {
        sourceTool: options.sourceTool,
        sourceAction: options.sourceAction,
        transactionId: options.transactionId,
        priority: options.priority,
        destructive: true,
        highRisk: false,
        spreadsheetId: options.spreadsheetId,
      },
    };
  }

  /**
   * Create an addProtectedRange request
   */
  static addProtectedRange(
    options: BaseRequestOptions & {
      protectedRange: sheets_v4.Schema$ProtectedRange;
    }
  ): WrappedRequest {
    return {
      request: {
        addProtectedRange: {
          protectedRange: options.protectedRange,
        },
      },
      metadata: {
        sourceTool: options.sourceTool,
        sourceAction: options.sourceAction,
        transactionId: options.transactionId,
        priority: options.priority,
        destructive: false,
        highRisk: false,
        spreadsheetId: options.spreadsheetId,
        sheetId: options.protectedRange.range?.sheetId ?? undefined,
      },
    };
  }

  /**
   * Create an updateProtectedRange request
   */
  static updateProtectedRange(
    options: BaseRequestOptions & {
      protectedRange: sheets_v4.Schema$ProtectedRange;
      fields: string;
    }
  ): WrappedRequest {
    return {
      request: {
        updateProtectedRange: {
          protectedRange: options.protectedRange,
          fields: options.fields,
        },
      },
      metadata: {
        sourceTool: options.sourceTool,
        sourceAction: options.sourceAction,
        transactionId: options.transactionId,
        priority: options.priority,
        destructive: false,
        highRisk: false,
        spreadsheetId: options.spreadsheetId,
        sheetId: options.protectedRange.range?.sheetId ?? undefined,
      },
    };
  }

  /**
   * Create a deleteProtectedRange request
   */
  static deleteProtectedRange(
    options: BaseRequestOptions & {
      protectedRangeId: number;
    }
  ): WrappedRequest {
    return {
      request: {
        deleteProtectedRange: {
          protectedRangeId: options.protectedRangeId,
        },
      },
      metadata: {
        sourceTool: options.sourceTool,
        sourceAction: options.sourceAction,
        transactionId: options.transactionId,
        priority: options.priority,
        destructive: true,
        highRisk: false,
        spreadsheetId: options.spreadsheetId,
      },
    };
  }

  /**
   * Create a createDeveloperMetadata request
   */
  static createDeveloperMetadata(
    options: BaseRequestOptions & {
      developerMetadata: sheets_v4.Schema$DeveloperMetadata;
    }
  ): WrappedRequest {
    return {
      request: {
        createDeveloperMetadata: {
          developerMetadata: options.developerMetadata,
        },
      },
      metadata: {
        sourceTool: options.sourceTool,
        sourceAction: options.sourceAction,
        transactionId: options.transactionId,
        priority: options.priority,
        destructive: false,
        highRisk: false,
        spreadsheetId: options.spreadsheetId,
      },
    };
  }

  /**
   * Create an updateDeveloperMetadata request
   */
  static updateDeveloperMetadata(
    options: BaseRequestOptions & {
      dataFilters: sheets_v4.Schema$DataFilter[];
      developerMetadata: sheets_v4.Schema$DeveloperMetadata;
      fields: string;
    }
  ): WrappedRequest {
    return {
      request: {
        updateDeveloperMetadata: {
          dataFilters: options.dataFilters,
          developerMetadata: options.developerMetadata,
          fields: options.fields,
        },
      },
      metadata: {
        sourceTool: options.sourceTool,
        sourceAction: options.sourceAction,
        transactionId: options.transactionId,
        priority: options.priority,
        destructive: false,
        highRisk: false,
        spreadsheetId: options.spreadsheetId,
      },
    };
  }

  /**
   * Create a deleteDeveloperMetadata request
   */
  static deleteDeveloperMetadata(
    options: BaseRequestOptions & {
      dataFilter: sheets_v4.Schema$DataFilter;
    }
  ): WrappedRequest {
    return {
      request: {
        deleteDeveloperMetadata: {
          dataFilter: options.dataFilter,
        },
      },
      metadata: {
        sourceTool: options.sourceTool,
        sourceAction: options.sourceAction,
        transactionId: options.transactionId,
        priority: options.priority,
        destructive: true,
        highRisk: false,
        spreadsheetId: options.spreadsheetId,
      },
    };
  }

  /**
   * Create an addBanding request
   */
  static addBanding(
    options: BaseRequestOptions & {
      bandedRange: sheets_v4.Schema$BandedRange;
    }
  ): WrappedRequest {
    return {
      request: {
        addBanding: {
          bandedRange: options.bandedRange,
        },
      },
      metadata: {
        sourceTool: options.sourceTool,
        sourceAction: options.sourceAction,
        transactionId: options.transactionId,
        priority: options.priority,
        destructive: false,
        highRisk: false,
        spreadsheetId: options.spreadsheetId,
        sheetId: options.bandedRange.range?.sheetId ?? undefined,
      },
    };
  }

  /**
   * Create an updateBanding request
   */
  static updateBanding(
    options: BaseRequestOptions & {
      bandedRange: sheets_v4.Schema$BandedRange;
      fields: string;
    }
  ): WrappedRequest {
    return {
      request: {
        updateBanding: {
          bandedRange: options.bandedRange,
          fields: options.fields,
        },
      },
      metadata: {
        sourceTool: options.sourceTool,
        sourceAction: options.sourceAction,
        transactionId: options.transactionId,
        priority: options.priority,
        destructive: false,
        highRisk: false,
        spreadsheetId: options.spreadsheetId,
        sheetId: options.bandedRange.range?.sheetId ?? undefined,
      },
    };
  }

  /**
   * Create a deleteBanding request
   */
  static deleteBanding(
    options: BaseRequestOptions & {
      bandedRangeId: number;
    }
  ): WrappedRequest {
    return {
      request: {
        deleteBanding: {
          bandedRangeId: options.bandedRangeId,
        },
      },
      metadata: {
        sourceTool: options.sourceTool,
        sourceAction: options.sourceAction,
        transactionId: options.transactionId,
        priority: options.priority,
        destructive: true,
        highRisk: false,
        spreadsheetId: options.spreadsheetId,
      },
    };
  }

  /**
   * Create an addDimensionGroup request
   */
  static addDimensionGroup(
    options: BaseRequestOptions & {
      range: sheets_v4.Schema$DimensionRange;
    }
  ): WrappedRequest {
    return {
      request: {
        addDimensionGroup: {
          range: options.range,
        },
      },
      metadata: {
        sourceTool: options.sourceTool,
        sourceAction: options.sourceAction,
        transactionId: options.transactionId,
        priority: options.priority,
        destructive: false,
        highRisk: false,
        spreadsheetId: options.spreadsheetId,
        sheetId: options.range.sheetId ?? undefined,
      },
    };
  }

  /**
   * Create a deleteDimensionGroup request
   */
  static deleteDimensionGroup(
    options: BaseRequestOptions & {
      range: sheets_v4.Schema$DimensionRange;
    }
  ): WrappedRequest {
    return {
      request: {
        deleteDimensionGroup: {
          range: options.range,
        },
      },
      metadata: {
        sourceTool: options.sourceTool,
        sourceAction: options.sourceAction,
        transactionId: options.transactionId,
        priority: options.priority,
        destructive: true,
        highRisk: false,
        spreadsheetId: options.spreadsheetId,
        sheetId: options.range.sheetId ?? undefined,
      },
    };
  }

  /**
   * Create an updateDimensionGroup request
   */
  static updateDimensionGroup(
    options: BaseRequestOptions & {
      dimensionGroup: sheets_v4.Schema$DimensionGroup;
      fields: string;
    }
  ): WrappedRequest {
    return {
      request: {
        updateDimensionGroup: {
          dimensionGroup: options.dimensionGroup,
          fields: options.fields,
        },
      },
      metadata: {
        sourceTool: options.sourceTool,
        sourceAction: options.sourceAction,
        transactionId: options.transactionId,
        priority: options.priority,
        destructive: false,
        highRisk: false,
        spreadsheetId: options.spreadsheetId,
        sheetId: options.dimensionGroup.range?.sheetId ?? undefined,
      },
    };
  }

  // ============================================================
  // Range Utility Operations (4 new - Google API coverage completion)
  // ============================================================

  /**
   * Create a trimWhitespace request
   */
  static trimWhitespace(
    options: BaseRequestOptions & {
      range: sheets_v4.Schema$GridRange;
    }
  ): WrappedRequest {
    const estimatedCells =
      ((options.range.endRowIndex ?? 1000) - (options.range.startRowIndex ?? 0)) *
      ((options.range.endColumnIndex ?? 26) - (options.range.startColumnIndex ?? 0));

    return {
      request: {
        trimWhitespace: {
          range: options.range,
        },
      },
      metadata: {
        sourceTool: options.sourceTool,
        sourceAction: options.sourceAction,
        transactionId: options.transactionId,
        priority: options.priority,
        destructive: false,
        highRisk: false,
        estimatedCells,
        spreadsheetId: options.spreadsheetId,
        sheetId: options.range.sheetId ?? undefined,
      },
    };
  }

  /**
   * Create a randomizeRange request
   */
  static randomizeRange(
    options: BaseRequestOptions & {
      range: sheets_v4.Schema$GridRange;
    }
  ): WrappedRequest {
    return {
      request: {
        randomizeRange: {
          range: options.range,
        },
      },
      metadata: {
        sourceTool: options.sourceTool,
        sourceAction: options.sourceAction,
        transactionId: options.transactionId,
        priority: options.priority,
        destructive: false, // Reorders but doesn't delete
        highRisk: true, // Can't easily undo
        spreadsheetId: options.spreadsheetId,
        sheetId: options.range.sheetId ?? undefined,
      },
    };
  }

  /**
   * Create a textToColumns request
   */
  static textToColumns(
    options: BaseRequestOptions & {
      source: sheets_v4.Schema$GridRange;
      delimiterType?: string;
      delimiter?: string;
    }
  ): WrappedRequest {
    return {
      request: {
        textToColumns: {
          source: options.source,
          delimiterType: options.delimiterType ?? 'DETECT',
          delimiter: options.delimiter,
        },
      },
      metadata: {
        sourceTool: options.sourceTool,
        sourceAction: options.sourceAction,
        transactionId: options.transactionId,
        priority: options.priority,
        destructive: true, // Modifies adjacent columns
        highRisk: true, // Can overwrite data in adjacent columns
        spreadsheetId: options.spreadsheetId,
        sheetId: options.source.sheetId ?? undefined,
      },
    };
  }

  /**
   * Create an autoFill request
   */
  static autoFill(
    options: BaseRequestOptions & {
      range?: sheets_v4.Schema$GridRange;
      sourceAndDestination?: sheets_v4.Schema$SourceAndDestination;
      useAlternateSeries?: boolean;
    }
  ): WrappedRequest {
    return {
      request: {
        autoFill: {
          range: options.range,
          sourceAndDestination: options.sourceAndDestination,
          useAlternateSeries: options.useAlternateSeries,
        },
      },
      metadata: {
        sourceTool: options.sourceTool,
        sourceAction: options.sourceAction,
        transactionId: options.transactionId,
        priority: options.priority,
        destructive: true, // Overwrites cells
        highRisk: false,
        spreadsheetId: options.spreadsheetId,
        sheetId:
          options.range?.sheetId ?? options.sourceAndDestination?.source?.sheetId ?? undefined,
      },
    };
  }
}
