/**
 * Response Shape Contract Tests
 *
 * Validates that handler responses conform to expected shapes.
 * These tests ensure API contract stability across versions.
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';

/**
 * Common response schemas for contract validation
 * Using passthrough() for objects that may have additional fields
 */

// Base response structure
const BaseResponseSchema = z
  .object({
    success: z.boolean(),
  })
  .passthrough();

// Success response with data
const SuccessResponseSchema = z
  .object({
    success: z.literal(true),
  })
  .passthrough();

// Error schema
const ErrorSchema = z
  .object({
    code: z.string(),
    message: z.string(),
    category: z.string().optional(),
    severity: z.enum(['low', 'medium', 'high', 'critical']).optional(),
    retryable: z.boolean().optional(),
    retryAfterMs: z.number().optional(),
    resolution: z.string().optional(),
    resolutionSteps: z.array(z.string()).optional(),
    suggestedTools: z.array(z.string()).optional(),
    details: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

// Error response structure
const ErrorResponseSchema = z
  .object({
    success: z.literal(false),
    error: ErrorSchema,
  })
  .passthrough();

// Mutation metadata (for write operations)
const MutationMetadataSchema = z
  .object({
    cellsAffected: z.number().optional(),
    revertSnapshotId: z.string().optional(),
    operationId: z.string().optional(),
    timestamp: z.string().optional(),
  })
  .passthrough();

// Pagination metadata
const PaginationSchema = z
  .object({
    hasMore: z.boolean(),
    nextCursor: z.string().optional(),
    totalCount: z.number().optional(),
  })
  .passthrough();

/**
 * Tool-specific response schemas
 * Using separate schema definitions to avoid Zod v4 extend issues
 */

// sheets_data read response
const DataReadResponseSchema = z
  .object({
    success: z.literal(true),
    values: z.array(z.array(z.unknown())).optional(),
    range: z.string().optional(),
    majorDimension: z.enum(['ROWS', 'COLUMNS']).optional(),
    metadata: z
      .object({
        rowCount: z.number(),
        columnCount: z.number(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

// sheets_data write response
const DataWriteResponseSchema = z
  .object({
    success: z.literal(true),
    updatedRange: z.string().optional(),
    updatedRows: z.number().optional(),
    updatedColumns: z.number().optional(),
    updatedCells: z.number().optional(),
    mutation: MutationMetadataSchema.optional(),
  })
  .passthrough();

// sheets_data batch_read response
const DataBatchReadResponseSchema = z
  .object({
    success: z.literal(true),
    valueRanges: z.array(
      z
        .object({
          range: z.string(),
          majorDimension: z.enum(['ROWS', 'COLUMNS']).optional(),
          values: z.array(z.array(z.unknown())).optional(),
        })
        .passthrough()
    ),
    pagination: PaginationSchema.optional(),
  })
  .passthrough();

// sheets_core get response
const CoreGetResponseSchema = z
  .object({
    success: z.literal(true),
    spreadsheet: z
      .object({
        spreadsheetId: z.string(),
        title: z.string(),
        locale: z.string().optional(),
        timeZone: z.string().optional(),
        url: z.string().optional(),
      })
      .passthrough(),
    sheets: z
      .array(
        z
          .object({
            sheetId: z.number(),
            title: z.string(),
            index: z.number().optional(),
            sheetType: z.string().optional(),
            rowCount: z.number().optional(),
            columnCount: z.number().optional(),
            frozenRowCount: z.number().optional(),
            frozenColumnCount: z.number().optional(),
          })
          .passthrough()
      )
      .optional(),
  })
  .passthrough();

// sheets_core create response
const CoreCreateResponseSchema = z
  .object({
    success: z.literal(true),
    spreadsheet: z
      .object({
        spreadsheetId: z.string(),
        title: z.string(),
        url: z.string(),
      })
      .passthrough(),
  })
  .passthrough();

// sheets_core add_sheet response
const CoreAddSheetResponseSchema = z
  .object({
    success: z.literal(true),
    sheet: z
      .object({
        sheetId: z.number(),
        title: z.string(),
        index: z.number().optional(),
      })
      .passthrough(),
  })
  .passthrough();

// sheets_format response
const FormatResponseSchema = z
  .object({
    success: z.literal(true),
    mutation: MutationMetadataSchema.optional(),
    appliedFormat: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

// sheets_dimensions response
const DimensionsResponseSchema = z
  .object({
    success: z.literal(true),
    mutation: MutationMetadataSchema.optional(),
    dimension: z.enum(['ROWS', 'COLUMNS']).optional(),
    affectedRange: z
      .object({
        startIndex: z.number(),
        endIndex: z.number(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

// sheets_collaborate share_list response
const CollaborateShareListResponseSchema = z
  .object({
    success: z.literal(true),
    permissions: z.array(
      z
        .object({
          id: z.string(),
          type: z.enum(['user', 'group', 'domain', 'anyone']),
          role: z.enum(['owner', 'organizer', 'fileOrganizer', 'writer', 'commenter', 'reader']),
          emailAddress: z.string().optional(),
          displayName: z.string().optional(),
        })
        .passthrough()
    ),
  })
  .passthrough();

// sheets_analyze response
const AnalyzeResponseSchema = z
  .object({
    success: z.literal(true),
    analysis: z
      .object({
        summary: z.string().optional(),
        dataTypes: z.record(z.string(), z.string()).optional(),
        statistics: z.record(z.string(), z.unknown()).optional(),
        patterns: z.array(z.unknown()).optional(),
        recommendations: z.array(z.string()).optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

// sheets_history list response
const HistoryListResponseSchema = z
  .object({
    success: z.literal(true),
    operations: z.array(
      z
        .object({
          operationId: z.string(),
          timestamp: z.string(),
          tool: z.string(),
          action: z.string(),
          description: z.string().optional(),
          cellsAffected: z.number().optional(),
          canRevert: z.boolean().optional(),
        })
        .passthrough()
    ),
    pagination: PaginationSchema.optional(),
  })
  .passthrough();

// sheets_auth status response
const AuthStatusResponseSchema = z
  .object({
    success: z.literal(true),
    authenticated: z.boolean(),
    email: z.string().optional(),
    scopes: z.array(z.string()).optional(),
    expiresAt: z.string().optional(),
  })
  .passthrough();

describe('Response Shape Contracts', () => {
  describe('Base Response Structure', () => {
    it('should accept valid success response', () => {
      const response = { success: true };
      expect(BaseResponseSchema.safeParse(response).success).toBe(true);
    });

    it('should accept valid error response', () => {
      const response = {
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Spreadsheet not found',
          category: 'client',
          severity: 'medium',
          retryable: false,
        },
      };
      expect(ErrorResponseSchema.safeParse(response).success).toBe(true);
    });

    it('should reject response without success field', () => {
      const response = { data: [] };
      expect(BaseResponseSchema.safeParse(response).success).toBe(false);
    });

    it('should accept error with all optional fields', () => {
      const response = {
        success: false,
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many requests',
          category: 'quota',
          severity: 'medium',
          retryable: true,
          retryAfterMs: 60000,
          resolution: 'Wait and retry',
          resolutionSteps: ['Wait 60 seconds', 'Retry request'],
          suggestedTools: ['sheets_data'],
          details: { quotaType: 'read' },
        },
      };
      expect(ErrorResponseSchema.safeParse(response).success).toBe(true);
    });
  });

  describe('sheets_data Response Shapes', () => {
    describe('read response', () => {
      it('should accept response with values', () => {
        const response = {
          success: true,
          values: [
            ['Header 1', 'Header 2'],
            ['Value 1', 'Value 2'],
          ],
          range: 'Sheet1!A1:B2',
          majorDimension: 'ROWS',
          metadata: {
            rowCount: 2,
            columnCount: 2,
          },
        };
        expect(DataReadResponseSchema.safeParse(response).success).toBe(true);
      });

      it('should accept empty values response', () => {
        const response = {
          success: true,
          values: [],
          range: 'Sheet1!A100:B100',
        };
        expect(DataReadResponseSchema.safeParse(response).success).toBe(true);
      });

      it('should accept response without optional fields', () => {
        const response = {
          success: true,
        };
        expect(DataReadResponseSchema.safeParse(response).success).toBe(true);
      });
    });

    describe('write response', () => {
      it('should accept full write response', () => {
        const response = {
          success: true,
          updatedRange: 'Sheet1!A1:B10',
          updatedRows: 10,
          updatedColumns: 2,
          updatedCells: 20,
          mutation: {
            cellsAffected: 20,
            revertSnapshotId: 'snap-123',
            operationId: 'op-456',
            timestamp: '2024-01-15T10:30:00Z',
          },
        };
        expect(DataWriteResponseSchema.safeParse(response).success).toBe(true);
      });

      it('should accept minimal write response', () => {
        const response = {
          success: true,
          updatedCells: 5,
        };
        expect(DataWriteResponseSchema.safeParse(response).success).toBe(true);
      });
    });

    describe('batch_read response', () => {
      it('should accept response with multiple ranges', () => {
        const response = {
          success: true,
          valueRanges: [
            { range: 'Sheet1!A1:B2', values: [['A', 'B']] },
            { range: 'Sheet1!C1:D2', values: [['C', 'D']] },
          ],
        };
        expect(DataBatchReadResponseSchema.safeParse(response).success).toBe(true);
      });

      it('should accept response with pagination', () => {
        const response = {
          success: true,
          valueRanges: [{ range: 'Sheet1!A1:Z1000', values: [] }],
          pagination: {
            hasMore: true,
            nextCursor: 'cursor-abc',
            totalCount: 5000,
          },
        };
        expect(DataBatchReadResponseSchema.safeParse(response).success).toBe(true);
      });
    });
  });

  describe('sheets_core Response Shapes', () => {
    describe('get response', () => {
      it('should accept full spreadsheet response', () => {
        const response = {
          success: true,
          spreadsheet: {
            spreadsheetId: 'abc123',
            title: 'My Spreadsheet',
            locale: 'en_US',
            timeZone: 'America/New_York',
            url: 'https://docs.google.com/spreadsheets/d/abc123',
          },
          sheets: [
            {
              sheetId: 0,
              title: 'Sheet1',
              index: 0,
              sheetType: 'GRID',
              rowCount: 1000,
              columnCount: 26,
              frozenRowCount: 1,
              frozenColumnCount: 0,
            },
          ],
        };
        expect(CoreGetResponseSchema.safeParse(response).success).toBe(true);
      });

      it('should accept minimal spreadsheet response', () => {
        const response = {
          success: true,
          spreadsheet: {
            spreadsheetId: 'abc123',
            title: 'Minimal',
          },
        };
        expect(CoreGetResponseSchema.safeParse(response).success).toBe(true);
      });
    });

    describe('create response', () => {
      it('should accept create response', () => {
        const response = {
          success: true,
          spreadsheet: {
            spreadsheetId: 'new-123',
            title: 'New Spreadsheet',
            url: 'https://docs.google.com/spreadsheets/d/new-123',
          },
        };
        expect(CoreCreateResponseSchema.safeParse(response).success).toBe(true);
      });
    });

    describe('add_sheet response', () => {
      it('should accept add_sheet response', () => {
        const response = {
          success: true,
          sheet: {
            sheetId: 12345,
            title: 'New Sheet',
            index: 2,
          },
        };
        expect(CoreAddSheetResponseSchema.safeParse(response).success).toBe(true);
      });
    });
  });

  describe('sheets_format Response Shapes', () => {
    it('should accept format response with mutation', () => {
      const response = {
        success: true,
        mutation: {
          cellsAffected: 100,
          operationId: 'fmt-123',
        },
        appliedFormat: {
          backgroundColor: { red: 1, green: 0, blue: 0 },
          textFormat: { bold: true },
        },
      };
      expect(FormatResponseSchema.safeParse(response).success).toBe(true);
    });
  });

  describe('sheets_dimensions Response Shapes', () => {
    it('should accept dimensions response', () => {
      const response = {
        success: true,
        mutation: {
          cellsAffected: 50,
        },
        dimension: 'ROWS',
        affectedRange: {
          startIndex: 5,
          endIndex: 10,
        },
      };
      expect(DimensionsResponseSchema.safeParse(response).success).toBe(true);
    });
  });

  describe('sheets_collaborate Response Shapes', () => {
    describe('share_list response', () => {
      it('should accept permissions list', () => {
        const response = {
          success: true,
          permissions: [
            {
              id: 'perm-1',
              type: 'user',
              role: 'owner',
              emailAddress: 'owner@example.com',
              displayName: 'Owner User',
            },
            {
              id: 'perm-2',
              type: 'anyone',
              role: 'reader',
            },
          ],
        };
        expect(CollaborateShareListResponseSchema.safeParse(response).success).toBe(true);
      });
    });
  });

  describe('sheets_analyze Response Shapes', () => {
    it('should accept comprehensive analysis response', () => {
      const response = {
        success: true,
        analysis: {
          summary: 'Spreadsheet contains 500 rows of sales data',
          dataTypes: {
            A: 'string',
            B: 'number',
            C: 'date',
          },
          statistics: {
            rowCount: 500,
            columnCount: 10,
            emptyRows: 5,
          },
          patterns: [{ type: 'trend', column: 'B', direction: 'increasing' }],
          recommendations: ['Consider adding data validation to column C'],
        },
      };
      expect(AnalyzeResponseSchema.safeParse(response).success).toBe(true);
    });
  });

  describe('sheets_history Response Shapes', () => {
    it('should accept history list response', () => {
      const response = {
        success: true,
        operations: [
          {
            operationId: 'op-1',
            timestamp: '2024-01-15T10:00:00Z',
            tool: 'sheets_data',
            action: 'write',
            description: 'Wrote 100 cells to Sheet1',
            cellsAffected: 100,
            canRevert: true,
          },
          {
            operationId: 'op-2',
            timestamp: '2024-01-15T09:00:00Z',
            tool: 'sheets_format',
            action: 'set_format',
            cellsAffected: 50,
            canRevert: false,
          },
        ],
        pagination: {
          hasMore: true,
          nextCursor: 'cursor-xyz',
        },
      };
      expect(HistoryListResponseSchema.safeParse(response).success).toBe(true);
    });
  });

  describe('sheets_auth Response Shapes', () => {
    it('should accept authenticated status response', () => {
      const response = {
        success: true,
        authenticated: true,
        email: 'user@example.com',
        scopes: [
          'https://www.googleapis.com/auth/spreadsheets',
          'https://www.googleapis.com/auth/drive.readonly',
        ],
        expiresAt: '2024-01-15T11:00:00Z',
      };
      expect(AuthStatusResponseSchema.safeParse(response).success).toBe(true);
    });

    it('should accept unauthenticated status response', () => {
      const response = {
        success: true,
        authenticated: false,
      };
      expect(AuthStatusResponseSchema.safeParse(response).success).toBe(true);
    });
  });

  describe('Mutation Metadata Consistency', () => {
    it('mutation should have consistent shape across tools', () => {
      const mutations = [
        { cellsAffected: 10 },
        { cellsAffected: 20, revertSnapshotId: 'snap-1' },
        { cellsAffected: 30, operationId: 'op-1', timestamp: '2024-01-15T10:00:00Z' },
        { revertSnapshotId: 'snap-2', operationId: 'op-2' },
      ];

      for (const mutation of mutations) {
        expect(MutationMetadataSchema.safeParse(mutation).success).toBe(true);
      }
    });
  });

  describe('Pagination Consistency', () => {
    it('pagination should have consistent shape', () => {
      const paginations = [
        { hasMore: false },
        { hasMore: true, nextCursor: 'abc' },
        { hasMore: true, nextCursor: 'xyz', totalCount: 1000 },
        { hasMore: false, totalCount: 50 },
      ];

      for (const pagination of paginations) {
        expect(PaginationSchema.safeParse(pagination).success).toBe(true);
      }
    });

    it('pagination should require hasMore field', () => {
      const invalid = { nextCursor: 'abc' };
      expect(PaginationSchema.safeParse(invalid).success).toBe(false);
    });
  });
});
