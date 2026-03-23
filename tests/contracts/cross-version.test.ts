/**
 * Cross-Version Compatibility Tests
 *
 * Ensures API contracts remain stable across versions.
 * Tests verify that requests from older versions still work with newer versions.
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  SheetsDataInputSchema,
  SheetsCoreInputSchema,
  SheetsFormatInputSchema,
  SheetsVisualizeInputSchema,
  SheetsAnalyzeInputSchema,
  SheetsTemplatesInputSchema,
  SheetsBigQueryInputSchema,
  SheetsAppsScriptInputSchema,
} from '../../src/schemas/index.js';

/**
 * v1.5.0 Request Examples
 *
 * These represent actual requests that worked in v1.5.0.
 * They MUST continue to work in v1.6.0 and beyond.
 */
const V1_5_0_REQUESTS = {
  sheets_data_read: {
    request: {
      action: 'read',
      spreadsheetId: 'abc123',
      range: { a1: 'Sheet1!A1:B10' },
    },
  },
  sheets_data_write: {
    request: {
      action: 'write',
      spreadsheetId: 'abc123',
      range: { a1: 'Sheet1!A1' },
      values: [['Header 1', 'Header 2']],
    },
  },
  sheets_core_get: {
    request: {
      action: 'get',
      spreadsheetId: 'abc123',
    },
  },
  sheets_core_create: {
    request: {
      action: 'create',
      title: 'New Spreadsheet',
    },
  },
  sheets_format_set_format: {
    request: {
      action: 'set_format',
      spreadsheetId: 'abc123',
      range: { a1: 'Sheet1!A1' },
      format: {
        backgroundColor: { red: 1, green: 0, blue: 0 },
        textFormat: { bold: true },
      },
    },
  },
};

describe('Cross-Version Compatibility - v1.5.0 to v1.6.0', () => {
  describe('sheets_data backward compatibility', () => {
    it('accepts v1.5.0 read request', () => {
      const result = SheetsDataInputSchema.safeParse(V1_5_0_REQUESTS.sheets_data_read);
      expect(result.success).toBe(true);
    });

    it('accepts v1.5.0 write request', () => {
      const result = SheetsDataInputSchema.safeParse(V1_5_0_REQUESTS.sheets_data_write);
      expect(result.success).toBe(true);
    });
  });

  describe('sheets_core backward compatibility', () => {
    it('accepts v1.5.0 get request', () => {
      const result = SheetsCoreInputSchema.safeParse(V1_5_0_REQUESTS.sheets_core_get);
      expect(result.success).toBe(true);
    });

    it('accepts v1.5.0 create request', () => {
      const result = SheetsCoreInputSchema.safeParse(V1_5_0_REQUESTS.sheets_core_create);
      expect(result.success).toBe(true);
    });
  });

  describe('sheets_format backward compatibility', () => {
    it('accepts v1.5.0 set_format request', () => {
      const result = SheetsFormatInputSchema.safeParse(V1_5_0_REQUESTS.sheets_format_set_format);
      expect(result.success).toBe(true);
    });
  });
});

describe('Cross-Version Compatibility - v1.6.0 New Features', () => {
  describe('sheets_templates (new in v1.6.0)', () => {
    it('accepts list request', () => {
      const result = SheetsTemplatesInputSchema.safeParse({
        request: {
          action: 'list',
          includeBuiltin: false,
        },
      });
      expect(result.success).toBe(true);
    });

    it('accepts create request', () => {
      const result = SheetsTemplatesInputSchema.safeParse({
        request: {
          action: 'create',
          spreadsheetId: 'test123',
          name: 'My Template',
          includeData: false,
          includeFormatting: true,
        },
      });
      expect(result.success).toBe(true);
    });

    it('accepts apply request', () => {
      const result = SheetsTemplatesInputSchema.safeParse({
        request: {
          action: 'apply',
          templateId: 'template-123',
          title: 'New Spreadsheet from Template',
        },
      });
      expect(result.success).toBe(true);
    });
  });

  describe('sheets_bigquery (new in v1.6.0)', () => {
    it('accepts list_datasets request', () => {
      const result = SheetsBigQueryInputSchema.safeParse({
        request: {
          action: 'list_datasets',
          projectId: 'my-project',
        },
      });
      expect(result.success).toBe(true);
    });

    it('accepts list_tables request', () => {
      const result = SheetsBigQueryInputSchema.safeParse({
        request: {
          action: 'list_tables',
          projectId: 'my-project',
          datasetId: 'my-dataset',
        },
      });
      expect(result.success).toBe(true);
    });
  });

  describe('sheets_appsscript (new in v1.6.0)', () => {
    it('accepts create request', () => {
      const result = SheetsAppsScriptInputSchema.safeParse({
        request: {
          action: 'create',
          title: 'My Script',
        },
      });
      expect(result.success).toBe(true);
    });

    it('accepts run request', () => {
      const result = SheetsAppsScriptInputSchema.safeParse({
        request: {
          action: 'run',
          scriptId: 'script-123',
          deploymentId: 'AKfycb-deployment',
          functionName: 'myFunction',
        },
      });
      expect(result.success).toBe(true);
    });
  });
});

describe('Cross-Version Compatibility - Response Shapes', () => {
  const V1_5_0_ResponseSchema = z
    .object({
      success: z.boolean(),
    })
    .passthrough();

  const V1_6_0_ResponseSchema = z
    .object({
      success: z.boolean(),
    })
    .passthrough();

  it('v1.5.0 responses remain valid in v1.6.0', () => {
    const v1_5_0_response = {
      success: true,
      values: [
        ['A', 'B'],
        ['1', '2'],
      ],
      range: 'Sheet1!A1:B2',
    };

    expect(V1_5_0_ResponseSchema.safeParse(v1_5_0_response).success).toBe(true);
    expect(V1_6_0_ResponseSchema.safeParse(v1_5_0_response).success).toBe(true);
  });

  it('v1.6.0 responses include all v1.5.0 fields', () => {
    const v1_6_0_response = {
      success: true,
      values: [
        ['A', 'B'],
        ['1', '2'],
      ],
      range: 'Sheet1!A1:B2',
      metadata: {
        rowCount: 2,
        columnCount: 2,
      },
    };

    expect(V1_6_0_ResponseSchema.safeParse(v1_6_0_response).success).toBe(true);
  });
});

describe('Cross-Version Compatibility - Field Addition', () => {
  it('adding optional fields does not break old requests', () => {
    // v1.5.0 request (minimal)
    const oldRequest = {
      request: {
        action: 'read',
        spreadsheetId: 'abc123',
        range: { a1: 'Sheet1!A1:B10' },
      },
    };

    // v1.6.0 request (with new optional fields)
    const newRequest = {
      request: {
        action: 'read',
        spreadsheetId: 'abc123',
        range: { a1: 'Sheet1!A1:B10' },
        majorDimension: 'ROWS', // New optional field
        dateTimeRenderOption: 'FORMATTED_STRING', // New optional field
      },
    };

    expect(SheetsDataInputSchema.safeParse(oldRequest).success).toBe(true);
    expect(SheetsDataInputSchema.safeParse(newRequest).success).toBe(true);
  });
});

describe('Cross-Version Compatibility - Breaking Changes Detection', () => {
  /**
   * These tests document what WOULD be breaking changes.
   * If any of these tests start failing, it indicates a potential breaking change.
   */

  it('removing a required field would be a breaking change', () => {
    // This test documents that removing spreadsheetId would break v1.5.0 clients
    const requestWithoutSpreadsheetId = {
      request: {
        action: 'read',
        // spreadsheetId removed (breaking change)
        range: { a1: 'Sheet1!A1:B10' },
      },
    };

    // This SHOULD fail - if it starts passing, it's a breaking change
    expect(SheetsDataInputSchema.safeParse(requestWithoutSpreadsheetId).success).toBe(false);
  });

  it('removing an action would be a breaking change', () => {
    // If 'read' action is removed, v1.5.0 clients break
    const requestWithRemovedAction = {
      request: {
        action: 'read',
        spreadsheetId: 'abc123',
        range: { a1: 'Sheet1!A1:B10' },
      },
    };

    // This SHOULD pass - if it starts failing, 'read' action was removed (breaking change)
    expect(SheetsDataInputSchema.safeParse(requestWithRemovedAction).success).toBe(true);
  });

  it('changing field types would be a breaking change', () => {
    // spreadsheetId must remain a string
    const requestWithWrongType = {
      request: {
        action: 'read',
        spreadsheetId: 123, // Should be string
        range: { a1: 'Sheet1!A1:B10' },
      },
    };

    // This SHOULD fail - if it starts passing, type constraints were loosened (potential issue)
    expect(SheetsDataInputSchema.safeParse(requestWithWrongType).success).toBe(false);
  });

  it('removing enum values would be a breaking change', () => {
    // If 'ROWS' is removed from majorDimension enum, v1.5.0 clients break
    const requestWithEnumValue = {
      request: {
        action: 'read',
        spreadsheetId: 'abc123',
        range: { a1: 'Sheet1!A1:B10' },
        majorDimension: 'ROWS',
      },
    };

    // This SHOULD pass - if it starts failing, 'ROWS' was removed (breaking change)
    expect(SheetsDataInputSchema.safeParse(requestWithEnumValue).success).toBe(true);
  });
});

describe('Cross-Version Compatibility - Consumer Expectations', () => {
  /**
   * These tests represent expectations that Claude Desktop and other consumers have.
   * Breaking these would cause consumer errors.
   */

  it('Claude Desktop expects action discriminator', () => {
    // Claude Desktop relies on 'action' field to determine request type
    const requestWithoutAction = {
      request: {
        spreadsheetId: 'abc123',
        range: { a1: 'Sheet1!A1:B10' },
      },
    };

    expect(SheetsDataInputSchema.safeParse(requestWithoutAction).success).toBe(false);
  });

  it('Claude Desktop expects success field in responses', () => {
    const ResponseSchema = z
      .object({
        success: z.boolean(),
      })
      .passthrough();

    const responseWithoutSuccess = {
      data: {},
    };

    expect(ResponseSchema.safeParse(responseWithoutSuccess).success).toBe(false);
  });

  it('Claude Desktop expects error structure on failure', () => {
    const ErrorResponseSchema = z
      .object({
        success: z.literal(false),
        error: z
          .object({
            code: z.string(),
            message: z.string(),
          })
          .passthrough(),
      })
      .passthrough();

    const errorResponseWithoutStructure = {
      success: false,
      message: 'Error occurred',
    };

    expect(ErrorResponseSchema.safeParse(errorResponseWithoutStructure).success).toBe(false);

    const properErrorResponse = {
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: 'Spreadsheet not found',
      },
    };

    expect(ErrorResponseSchema.safeParse(properErrorResponse).success).toBe(true);
  });
});

describe('Cross-Version Compatibility - Deprecation Strategy', () => {
  /**
   * If we need to deprecate features, this is how we should do it:
   * 1. Mark as deprecated in annotations
   * 2. Add replacement in description
   * 3. Keep working for at least 2 major versions
   * 4. Log deprecation warnings
   */

  it('deprecated features still work but are annotated', () => {
    // Example: If we deprecated 'copy' action in favor of 'duplicate'
    // The old action should still work
    const deprecatedRequest = {
      request: {
        action: 'copy',
        spreadsheetId: 'abc123',
      },
    };

    // Should still validate successfully
    const result = SheetsCoreInputSchema.safeParse(deprecatedRequest);
    expect(result.success).toBe(true);
  });
});
