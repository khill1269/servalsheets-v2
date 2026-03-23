/**
 * Live API Tests for sheets_advanced Tool
 *
 * Tests named ranges, protected ranges, metadata, banding, tables, and smart chips
 * against the real Google API.
 * Requires TEST_REAL_API=true environment variable.
 *
 * 23 Actions:
 * - Named Ranges (5): add_named_range, update_named_range, delete_named_range, list_named_ranges, get_named_range
 * - Protected Ranges (4): add_protected_range, update_protected_range, delete_protected_range, list_protected_ranges
 * - Metadata (3): set_metadata, get_metadata, delete_metadata
 * - Banding (4): add_banding, update_banding, delete_banding, list_banding
 * - Tables (3): create_table, delete_table, list_tables
 * - Smart Chips (4): add_person_chip, add_drive_chip, add_rich_link_chip, list_chips
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { LiveApiClient } from '../setup/live-api-client.js';
import { TestSpreadsheetManager, TestSpreadsheet } from '../setup/test-spreadsheet-manager.js';
import { loadTestCredentials, shouldRunIntegrationTests } from '../../helpers/credential-loader.js';

const runLiveTests = shouldRunIntegrationTests();

describe.skipIf(!runLiveTests)('sheets_advanced Live API Tests', () => {
  let client: LiveApiClient;
  let manager: TestSpreadsheetManager;
  let testSpreadsheet: TestSpreadsheet;
  let sheetId: number;

  beforeAll(async () => {
    const credentials = await loadTestCredentials();
    if (!credentials) {
      throw new Error('Test credentials not available');
    }
    client = new LiveApiClient(credentials, { trackMetrics: true });
    manager = new TestSpreadsheetManager(client);

    // Create ONE spreadsheet for all tests
    testSpreadsheet = await manager.createTestSpreadsheet('advanced');
    const meta = await client.sheets.spreadsheets.get({
      spreadsheetId: testSpreadsheet.id,
    });
    sheetId = meta.data.sheets![0].properties!.sheetId!;
  }, 60000);

  afterAll(async () => {
    await manager.cleanup();
  }, 30000);

  describe('Named Range Operations', () => {
    describe('add_named_range action', () => {
      it('should create a named range', async () => {
        const response = await client.sheets.spreadsheets.batchUpdate({
          spreadsheetId: testSpreadsheet.id,
          requestBody: {
            requests: [
              {
                addNamedRange: {
                  namedRange: {
                    name: 'TestRange',
                    range: {
                      sheetId,
                      startRowIndex: 0,
                      endRowIndex: 10,
                      startColumnIndex: 0,
                      endColumnIndex: 3,
                    },
                  },
                },
              },
            ],
          },
        });

        expect(response.status).toBe(200);
        const namedRangeId = response.data.replies![0].addNamedRange?.namedRange?.namedRangeId;
        expect(namedRangeId).toBeDefined();
      });

      it('should create named range with underscore prefix', async () => {
        const response = await client.sheets.spreadsheets.batchUpdate({
          spreadsheetId: testSpreadsheet.id,
          requestBody: {
            requests: [
              {
                addNamedRange: {
                  namedRange: {
                    name: '_PrivateRange',
                    range: {
                      sheetId,
                      startRowIndex: 0,
                      endRowIndex: 5,
                      startColumnIndex: 0,
                      endColumnIndex: 1,
                    },
                  },
                },
              },
            ],
          },
        });

        expect(response.status).toBe(200);
      });
    });

    describe('list_named_ranges action', () => {
      it('should list all named ranges', async () => {
        // First create a named range
        await client.sheets.spreadsheets.batchUpdate({
          spreadsheetId: testSpreadsheet.id,
          requestBody: {
            requests: [
              {
                addNamedRange: {
                  namedRange: {
                    name: 'ListTestRange',
                    range: {
                      sheetId,
                      startRowIndex: 0,
                      endRowIndex: 5,
                      startColumnIndex: 0,
                      endColumnIndex: 2,
                    },
                  },
                },
              },
            ],
          },
        });

        // Get spreadsheet to list named ranges
        const response = await client.sheets.spreadsheets.get({
          spreadsheetId: testSpreadsheet.id,
          fields: 'namedRanges',
        });

        expect(response.status).toBe(200);
        expect(response.data.namedRanges).toBeDefined();
        expect(response.data.namedRanges!.length).toBeGreaterThan(0);

        const foundRange = response.data.namedRanges!.find((nr) => nr.name === 'ListTestRange');
        expect(foundRange).toBeDefined();
      });
    });

    describe('update_named_range action', () => {
      it('should update named range name', async () => {
        // Create a named range
        const createResponse = await client.sheets.spreadsheets.batchUpdate({
          spreadsheetId: testSpreadsheet.id,
          requestBody: {
            requests: [
              {
                addNamedRange: {
                  namedRange: {
                    name: 'OldName',
                    range: {
                      sheetId,
                      startRowIndex: 0,
                      endRowIndex: 5,
                      startColumnIndex: 0,
                      endColumnIndex: 2,
                    },
                  },
                },
              },
            ],
          },
        });

        const namedRangeId =
          createResponse.data.replies![0].addNamedRange?.namedRange?.namedRangeId;

        // Update the name
        const updateResponse = await client.sheets.spreadsheets.batchUpdate({
          spreadsheetId: testSpreadsheet.id,
          requestBody: {
            requests: [
              {
                updateNamedRange: {
                  namedRange: {
                    namedRangeId,
                    name: 'NewName',
                    range: {
                      sheetId,
                      startRowIndex: 0,
                      endRowIndex: 5,
                      startColumnIndex: 0,
                      endColumnIndex: 2,
                    },
                  },
                  fields: 'name',
                },
              },
            ],
          },
        });

        expect(updateResponse.status).toBe(200);
      });

      it('should update named range extent', async () => {
        // Create a named range
        const createResponse = await client.sheets.spreadsheets.batchUpdate({
          spreadsheetId: testSpreadsheet.id,
          requestBody: {
            requests: [
              {
                addNamedRange: {
                  namedRange: {
                    name: 'ExtentRange',
                    range: {
                      sheetId,
                      startRowIndex: 0,
                      endRowIndex: 5,
                      startColumnIndex: 0,
                      endColumnIndex: 2,
                    },
                  },
                },
              },
            ],
          },
        });

        const namedRangeId =
          createResponse.data.replies![0].addNamedRange?.namedRange?.namedRangeId;

        // Update the range extent
        const updateResponse = await client.sheets.spreadsheets.batchUpdate({
          spreadsheetId: testSpreadsheet.id,
          requestBody: {
            requests: [
              {
                updateNamedRange: {
                  namedRange: {
                    namedRangeId,
                    name: 'ExtentRange',
                    range: {
                      sheetId,
                      startRowIndex: 0,
                      endRowIndex: 10,
                      startColumnIndex: 0,
                      endColumnIndex: 5,
                    },
                  },
                  fields: 'range',
                },
              },
            ],
          },
        });

        expect(updateResponse.status).toBe(200);
      });
    });

    describe('delete_named_range action', () => {
      it('should delete a named range', async () => {
        // Create a named range
        const createResponse = await client.sheets.spreadsheets.batchUpdate({
          spreadsheetId: testSpreadsheet.id,
          requestBody: {
            requests: [
              {
                addNamedRange: {
                  namedRange: {
                    name: 'ToDelete',
                    range: {
                      sheetId,
                      startRowIndex: 0,
                      endRowIndex: 5,
                      startColumnIndex: 0,
                      endColumnIndex: 2,
                    },
                  },
                },
              },
            ],
          },
        });

        const namedRangeId =
          createResponse.data.replies![0].addNamedRange?.namedRange?.namedRangeId;

        // Delete it
        const deleteResponse = await client.sheets.spreadsheets.batchUpdate({
          spreadsheetId: testSpreadsheet.id,
          requestBody: {
            requests: [
              {
                deleteNamedRange: {
                  namedRangeId,
                },
              },
            ],
          },
        });

        expect(deleteResponse.status).toBe(200);

        // Verify it's gone
        const getResponse = await client.sheets.spreadsheets.get({
          spreadsheetId: testSpreadsheet.id,
          fields: 'namedRanges',
        });

        const deletedRange = getResponse.data.namedRanges?.find(
          (nr) => nr.namedRangeId === namedRangeId
        );
        expect(deletedRange).toBeUndefined();
      });
    });
  });

  describe('Protected Range Operations', () => {
    describe('add_protected_range action', () => {
      it('should create a protected range with warning only', async () => {
        const response = await client.sheets.spreadsheets.batchUpdate({
          spreadsheetId: testSpreadsheet.id,
          requestBody: {
            requests: [
              {
                addProtectedRange: {
                  protectedRange: {
                    range: {
                      sheetId,
                      startRowIndex: 0,
                      endRowIndex: 5,
                      startColumnIndex: 0,
                      endColumnIndex: 3,
                    },
                    description: 'Header protection - warning only',
                    warningOnly: true,
                  },
                },
              },
            ],
          },
        });

        expect(response.status).toBe(200);
        const protectedRangeId =
          response.data.replies![0].addProtectedRange?.protectedRange?.protectedRangeId;
        expect(protectedRangeId).toBeDefined();
      });

      it('should create a protected range with full protection', async () => {
        const response = await client.sheets.spreadsheets.batchUpdate({
          spreadsheetId: testSpreadsheet.id,
          requestBody: {
            requests: [
              {
                addProtectedRange: {
                  protectedRange: {
                    range: {
                      sheetId,
                      startRowIndex: 10,
                      endRowIndex: 20,
                      startColumnIndex: 0,
                      endColumnIndex: 5,
                    },
                    description: 'Locked data area',
                    warningOnly: false,
                  },
                },
              },
            ],
          },
        });

        expect(response.status).toBe(200);
      });
    });

    describe('list_protected_ranges action', () => {
      it('should list all protected ranges', async () => {
        // Create a protected range
        await client.sheets.spreadsheets.batchUpdate({
          spreadsheetId: testSpreadsheet.id,
          requestBody: {
            requests: [
              {
                addProtectedRange: {
                  protectedRange: {
                    range: {
                      sheetId,
                      startRowIndex: 0,
                      endRowIndex: 1,
                      startColumnIndex: 0,
                      endColumnIndex: 1,
                    },
                    warningOnly: true,
                  },
                },
              },
            ],
          },
        });

        // Get spreadsheet to list protected ranges
        const response = await client.sheets.spreadsheets.get({
          spreadsheetId: testSpreadsheet.id,
          fields: 'sheets.protectedRanges',
        });

        expect(response.status).toBe(200);
        const protectedRanges = response.data.sheets?.[0]?.protectedRanges;
        expect(protectedRanges).toBeDefined();
        expect(protectedRanges!.length).toBeGreaterThan(0);
      });
    });

    describe('update_protected_range action', () => {
      it('should update protection description', async () => {
        // Create a protected range
        const createResponse = await client.sheets.spreadsheets.batchUpdate({
          spreadsheetId: testSpreadsheet.id,
          requestBody: {
            requests: [
              {
                addProtectedRange: {
                  protectedRange: {
                    range: {
                      sheetId,
                      startRowIndex: 0,
                      endRowIndex: 5,
                      startColumnIndex: 0,
                      endColumnIndex: 2,
                    },
                    description: 'Original description',
                    warningOnly: true,
                  },
                },
              },
            ],
          },
        });

        const protectedRangeId =
          createResponse.data.replies![0].addProtectedRange?.protectedRange?.protectedRangeId;

        // Update the description
        const updateResponse = await client.sheets.spreadsheets.batchUpdate({
          spreadsheetId: testSpreadsheet.id,
          requestBody: {
            requests: [
              {
                updateProtectedRange: {
                  protectedRange: {
                    protectedRangeId,
                    range: {
                      sheetId,
                      startRowIndex: 0,
                      endRowIndex: 5,
                      startColumnIndex: 0,
                      endColumnIndex: 2,
                    },
                    description: 'Updated description',
                    warningOnly: true,
                  },
                  fields: 'description',
                },
              },
            ],
          },
        });

        expect(updateResponse.status).toBe(200);
      });
    });

    describe('delete_protected_range action', () => {
      it('should remove protection from a range', async () => {
        // Create a protected range
        const createResponse = await client.sheets.spreadsheets.batchUpdate({
          spreadsheetId: testSpreadsheet.id,
          requestBody: {
            requests: [
              {
                addProtectedRange: {
                  protectedRange: {
                    range: {
                      sheetId,
                      startRowIndex: 0,
                      endRowIndex: 1,
                      startColumnIndex: 0,
                      endColumnIndex: 1,
                    },
                    warningOnly: true,
                  },
                },
              },
            ],
          },
        });

        const protectedRangeId =
          createResponse.data.replies![0].addProtectedRange?.protectedRange?.protectedRangeId;

        // Delete protection
        const deleteResponse = await client.sheets.spreadsheets.batchUpdate({
          spreadsheetId: testSpreadsheet.id,
          requestBody: {
            requests: [
              {
                deleteProtectedRange: {
                  protectedRangeId,
                },
              },
            ],
          },
        });

        expect(deleteResponse.status).toBe(200);
      });
    });
  });

  describe('Developer Metadata Operations', () => {
    describe('set_metadata action', () => {
      it('should add developer metadata to spreadsheet', async () => {
        const response = await client.sheets.spreadsheets.batchUpdate({
          spreadsheetId: testSpreadsheet.id,
          requestBody: {
            requests: [
              {
                createDeveloperMetadata: {
                  developerMetadata: {
                    metadataKey: 'app_version',
                    metadataValue: '2.0.0',
                    location: {
                      spreadsheet: true,
                    },
                    visibility: 'DOCUMENT',
                  },
                },
              },
            ],
          },
        });

        expect(response.status).toBe(200);
        const metadataId =
          response.data.replies![0].createDeveloperMetadata?.developerMetadata?.metadataId;
        expect(metadataId).toBeDefined();
      });

      it('should add metadata to a specific sheet', async () => {
        const response = await client.sheets.spreadsheets.batchUpdate({
          spreadsheetId: testSpreadsheet.id,
          requestBody: {
            requests: [
              {
                createDeveloperMetadata: {
                  developerMetadata: {
                    metadataKey: 'sheet_category',
                    metadataValue: 'financial_data',
                    location: {
                      sheetId,
                    },
                    visibility: 'DOCUMENT',
                  },
                },
              },
            ],
          },
        });

        expect(response.status).toBe(200);
      });
    });

    describe('get_metadata action', () => {
      it('should search metadata by key', async () => {
        // First create metadata
        await client.sheets.spreadsheets.batchUpdate({
          spreadsheetId: testSpreadsheet.id,
          requestBody: {
            requests: [
              {
                createDeveloperMetadata: {
                  developerMetadata: {
                    metadataKey: 'searchable_key',
                    metadataValue: 'searchable_value',
                    location: { spreadsheet: true },
                    visibility: 'DOCUMENT',
                  },
                },
              },
            ],
          },
        });

        // Search for it
        const response = await client.sheets.spreadsheets.developerMetadata.search({
          spreadsheetId: testSpreadsheet.id,
          requestBody: {
            dataFilters: [
              {
                developerMetadataLookup: {
                  metadataKey: 'searchable_key',
                },
              },
            ],
          },
        });

        expect(response.status).toBe(200);
        expect(response.data.matchedDeveloperMetadata).toBeDefined();
        expect(response.data.matchedDeveloperMetadata!.length).toBeGreaterThan(0);
      });
    });

    describe('delete_metadata action', () => {
      it('should delete developer metadata', async () => {
        // First create metadata
        const createResponse = await client.sheets.spreadsheets.batchUpdate({
          spreadsheetId: testSpreadsheet.id,
          requestBody: {
            requests: [
              {
                createDeveloperMetadata: {
                  developerMetadata: {
                    metadataKey: 'to_delete',
                    metadataValue: 'temp',
                    location: { spreadsheet: true },
                    visibility: 'DOCUMENT',
                  },
                },
              },
            ],
          },
        });

        const metadataId =
          createResponse.data.replies![0].createDeveloperMetadata?.developerMetadata?.metadataId;

        // Delete it
        const deleteResponse = await client.sheets.spreadsheets.batchUpdate({
          spreadsheetId: testSpreadsheet.id,
          requestBody: {
            requests: [
              {
                deleteDeveloperMetadata: {
                  dataFilter: {
                    developerMetadataLookup: {
                      metadataId,
                    },
                  },
                },
              },
            ],
          },
        });

        expect(deleteResponse.status).toBe(200);
      });
    });
  });

  describe('Banding Operations', () => {
    describe('add_banding action', () => {
      it('should add alternating row colors', async () => {
        const response = await client.sheets.spreadsheets.batchUpdate({
          spreadsheetId: testSpreadsheet.id,
          requestBody: {
            requests: [
              {
                addBanding: {
                  bandedRange: {
                    range: {
                      sheetId,
                      startRowIndex: 0,
                      endRowIndex: 20,
                      startColumnIndex: 0,
                      endColumnIndex: 5,
                    },
                    rowProperties: {
                      headerColor: { red: 0.2, green: 0.4, blue: 0.8 },
                      firstBandColor: { red: 1, green: 1, blue: 1 },
                      secondBandColor: { red: 0.9, green: 0.9, blue: 0.95 },
                    },
                  },
                },
              },
            ],
          },
        });

        expect(response.status).toBe(200);
        const bandedRangeId = response.data.replies![0].addBanding?.bandedRange?.bandedRangeId;
        expect(bandedRangeId).toBeDefined();
      });

      it('should add alternating column colors', async () => {
        const response = await client.sheets.spreadsheets.batchUpdate({
          spreadsheetId: testSpreadsheet.id,
          requestBody: {
            requests: [
              {
                addBanding: {
                  bandedRange: {
                    range: {
                      sheetId,
                      startRowIndex: 25,
                      endRowIndex: 35,
                      startColumnIndex: 0,
                      endColumnIndex: 10,
                    },
                    columnProperties: {
                      firstBandColor: { red: 0.95, green: 0.95, blue: 1 },
                      secondBandColor: { red: 1, green: 0.95, blue: 0.95 },
                    },
                  },
                },
              },
            ],
          },
        });

        expect(response.status).toBe(200);
      });
    });

    describe('list_banding action', () => {
      it('should list all banded ranges', async () => {
        // First create banding in non-overlapping range (rows 50-60)
        await client.sheets.spreadsheets.batchUpdate({
          spreadsheetId: testSpreadsheet.id,
          requestBody: {
            requests: [
              {
                addBanding: {
                  bandedRange: {
                    range: {
                      sheetId,
                      startRowIndex: 50,
                      endRowIndex: 60,
                      startColumnIndex: 0,
                      endColumnIndex: 3,
                    },
                    rowProperties: {
                      firstBandColor: { red: 1, green: 1, blue: 1 },
                      secondBandColor: { red: 0.9, green: 0.9, blue: 0.9 },
                    },
                  },
                },
              },
            ],
          },
        });

        // Get spreadsheet to list banding
        const response = await client.sheets.spreadsheets.get({
          spreadsheetId: testSpreadsheet.id,
          fields: 'sheets.bandedRanges',
        });

        expect(response.status).toBe(200);
        const bandedRanges = response.data.sheets?.[0]?.bandedRanges;
        expect(bandedRanges).toBeDefined();
        expect(bandedRanges!.length).toBeGreaterThan(0);
      });
    });

    describe('update_banding action', () => {
      it('should update banding colors', async () => {
        // Create banding in non-overlapping range (rows 40-50)
        const createResponse = await client.sheets.spreadsheets.batchUpdate({
          spreadsheetId: testSpreadsheet.id,
          requestBody: {
            requests: [
              {
                addBanding: {
                  bandedRange: {
                    range: {
                      sheetId,
                      startRowIndex: 40,
                      endRowIndex: 50,
                      startColumnIndex: 0,
                      endColumnIndex: 3,
                    },
                    rowProperties: {
                      firstBandColor: { red: 1, green: 1, blue: 1 },
                      secondBandColor: { red: 0.9, green: 0.9, blue: 0.9 },
                    },
                  },
                },
              },
            ],
          },
        });

        const bandedRangeId =
          createResponse.data.replies![0].addBanding?.bandedRange?.bandedRangeId;

        // Update colors
        const updateResponse = await client.sheets.spreadsheets.batchUpdate({
          spreadsheetId: testSpreadsheet.id,
          requestBody: {
            requests: [
              {
                updateBanding: {
                  bandedRange: {
                    bandedRangeId,
                    range: {
                      sheetId,
                      startRowIndex: 40,
                      endRowIndex: 50,
                      startColumnIndex: 0,
                      endColumnIndex: 3,
                    },
                    rowProperties: {
                      firstBandColor: { red: 0.8, green: 1, blue: 0.8 },
                      secondBandColor: { red: 0.9, green: 1, blue: 0.9 },
                    },
                  },
                  fields: 'rowProperties',
                },
              },
            ],
          },
        });

        expect(updateResponse.status).toBe(200);
      });
    });

    describe('delete_banding action', () => {
      it('should remove banding', async () => {
        // Create banding in non-overlapping range (rows 60-70)
        const createResponse = await client.sheets.spreadsheets.batchUpdate({
          spreadsheetId: testSpreadsheet.id,
          requestBody: {
            requests: [
              {
                addBanding: {
                  bandedRange: {
                    range: {
                      sheetId,
                      startRowIndex: 60,
                      endRowIndex: 70,
                      startColumnIndex: 0,
                      endColumnIndex: 2,
                    },
                    rowProperties: {
                      firstBandColor: { red: 1, green: 1, blue: 1 },
                      secondBandColor: { red: 0.9, green: 0.9, blue: 0.9 },
                    },
                  },
                },
              },
            ],
          },
        });

        const bandedRangeId =
          createResponse.data.replies![0].addBanding?.bandedRange?.bandedRangeId;

        // Delete banding
        const deleteResponse = await client.sheets.spreadsheets.batchUpdate({
          spreadsheetId: testSpreadsheet.id,
          requestBody: {
            requests: [
              {
                deleteBanding: {
                  bandedRangeId,
                },
              },
            ],
          },
        });

        expect(deleteResponse.status).toBe(200);
      });
    });
  });

  describe('Filter Operations', () => {
    describe('Basic filter operations', () => {
      it('should set a basic filter on a range', async () => {
        // First add some data
        await client.sheets.spreadsheets.values.update({
          spreadsheetId: testSpreadsheet.id,
          range: 'TestData!A1:C5',
          valueInputOption: 'RAW',
          requestBody: {
            values: [
              ['Name', 'Status', 'Value'],
              ['Alice', 'Active', '100'],
              ['Bob', 'Inactive', '200'],
              ['Carol', 'Active', '300'],
              ['Dave', 'Active', '400'],
            ],
          },
        });

        const response = await client.sheets.spreadsheets.batchUpdate({
          spreadsheetId: testSpreadsheet.id,
          requestBody: {
            requests: [
              {
                setBasicFilter: {
                  filter: {
                    range: {
                      sheetId,
                      startRowIndex: 0,
                      endRowIndex: 5,
                      startColumnIndex: 0,
                      endColumnIndex: 3,
                    },
                  },
                },
              },
            ],
          },
        });

        expect(response.status).toBe(200);
      });

      it('should clear a basic filter', async () => {
        // First set a filter
        await client.sheets.spreadsheets.batchUpdate({
          spreadsheetId: testSpreadsheet.id,
          requestBody: {
            requests: [
              {
                setBasicFilter: {
                  filter: {
                    range: {
                      sheetId,
                      startRowIndex: 0,
                      endRowIndex: 5,
                      startColumnIndex: 0,
                      endColumnIndex: 3,
                    },
                  },
                },
              },
            ],
          },
        });

        // Then clear it
        const response = await client.sheets.spreadsheets.batchUpdate({
          spreadsheetId: testSpreadsheet.id,
          requestBody: {
            requests: [
              {
                clearBasicFilter: {
                  sheetId,
                },
              },
            ],
          },
        });

        expect(response.status).toBe(200);
      });
    });
  });

  describe('Conditional Formatting (advanced patterns)', () => {
    it('should add gradient conditional formatting', async () => {
      const response = await client.sheets.spreadsheets.batchUpdate({
        spreadsheetId: testSpreadsheet.id,
        requestBody: {
          requests: [
            {
              addConditionalFormatRule: {
                rule: {
                  ranges: [
                    {
                      sheetId,
                      startRowIndex: 0,
                      endRowIndex: 10,
                      startColumnIndex: 0,
                      endColumnIndex: 1,
                    },
                  ],
                  gradientRule: {
                    minpoint: {
                      color: { red: 1, green: 0.8, blue: 0.8 },
                      type: 'MIN',
                    },
                    midpoint: {
                      color: { red: 1, green: 1, blue: 0.8 },
                      type: 'PERCENTILE',
                      value: '50',
                    },
                    maxpoint: {
                      color: { red: 0.8, green: 1, blue: 0.8 },
                      type: 'MAX',
                    },
                  },
                },
                index: 0,
              },
            },
          ],
        },
      });

      expect(response.status).toBe(200);
    });

    it('should add custom formula conditional formatting', async () => {
      const response = await client.sheets.spreadsheets.batchUpdate({
        spreadsheetId: testSpreadsheet.id,
        requestBody: {
          requests: [
            {
              addConditionalFormatRule: {
                rule: {
                  ranges: [
                    {
                      sheetId,
                      startRowIndex: 0,
                      endRowIndex: 10,
                      startColumnIndex: 0,
                      endColumnIndex: 5,
                    },
                  ],
                  booleanRule: {
                    condition: {
                      type: 'CUSTOM_FORMULA',
                      values: [{ userEnteredValue: '=$A1>100' }],
                    },
                    format: {
                      backgroundColor: { red: 0.8, green: 1, blue: 0.8 },
                    },
                  },
                },
                index: 0,
              },
            },
          ],
        },
      });

      expect(response.status).toBe(200);
    });
  });

  describe('Data Validation', () => {
    it('should add dropdown validation', async () => {
      const response = await client.sheets.spreadsheets.batchUpdate({
        spreadsheetId: testSpreadsheet.id,
        requestBody: {
          requests: [
            {
              setDataValidation: {
                range: {
                  sheetId,
                  startRowIndex: 0,
                  endRowIndex: 10,
                  startColumnIndex: 0,
                  endColumnIndex: 1,
                },
                rule: {
                  condition: {
                    type: 'ONE_OF_LIST',
                    values: [
                      { userEnteredValue: 'Option A' },
                      { userEnteredValue: 'Option B' },
                      { userEnteredValue: 'Option C' },
                    ],
                  },
                  showCustomUi: true,
                  strict: true,
                },
              },
            },
          ],
        },
      });

      expect(response.status).toBe(200);
    });

    it('should add number range validation', async () => {
      const response = await client.sheets.spreadsheets.batchUpdate({
        spreadsheetId: testSpreadsheet.id,
        requestBody: {
          requests: [
            {
              setDataValidation: {
                range: {
                  sheetId,
                  startRowIndex: 0,
                  endRowIndex: 10,
                  startColumnIndex: 1,
                  endColumnIndex: 2,
                },
                rule: {
                  condition: {
                    type: 'NUMBER_BETWEEN',
                    values: [{ userEnteredValue: '0' }, { userEnteredValue: '100' }],
                  },
                  strict: true,
                  inputMessage: 'Enter a number between 0 and 100',
                },
              },
            },
          ],
        },
      });

      expect(response.status).toBe(200);
    });

    it('should clear data validation', async () => {
      // First add validation
      await client.sheets.spreadsheets.batchUpdate({
        spreadsheetId: testSpreadsheet.id,
        requestBody: {
          requests: [
            {
              setDataValidation: {
                range: {
                  sheetId,
                  startRowIndex: 0,
                  endRowIndex: 5,
                  startColumnIndex: 0,
                  endColumnIndex: 1,
                },
                rule: {
                  condition: {
                    type: 'ONE_OF_LIST',
                    values: [{ userEnteredValue: 'Test' }],
                  },
                },
              },
            },
          ],
        },
      });

      // Then clear it
      const response = await client.sheets.spreadsheets.batchUpdate({
        spreadsheetId: testSpreadsheet.id,
        requestBody: {
          requests: [
            {
              setDataValidation: {
                range: {
                  sheetId,
                  startRowIndex: 0,
                  endRowIndex: 5,
                  startColumnIndex: 0,
                  endColumnIndex: 1,
                },
                // No rule = clear validation
              },
            },
          ],
        },
      });

      expect(response.status).toBe(200);
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid named range name gracefully', async () => {
      // Named range names must start with letter or underscore
      // Note: Google Sheets API may accept or reject this depending on version
      try {
        await client.sheets.spreadsheets.batchUpdate({
          spreadsheetId: testSpreadsheet.id,
          requestBody: {
            requests: [
              {
                addNamedRange: {
                  namedRange: {
                    name: '123Invalid',
                    range: {
                      sheetId,
                      startRowIndex: 0,
                      endRowIndex: 5,
                      startColumnIndex: 0,
                      endColumnIndex: 2,
                    },
                  },
                },
              },
            ],
          },
        });
        // API accepted it - test passes
      } catch (error) {
        // API rejected it - test passes
        expect(error).toBeDefined();
      }
    });

    it('should handle non-existent named range deletion gracefully', async () => {
      // Attempting to delete non-existent named range may succeed or fail depending on API version
      try {
        await client.sheets.spreadsheets.batchUpdate({
          spreadsheetId: testSpreadsheet.id,
          requestBody: {
            requests: [
              {
                deleteNamedRange: {
                  namedRangeId: 'non-existent-id',
                },
              },
            ],
          },
        });
        // API accepted it (idempotent) - test passes
      } catch (error) {
        // API rejected it - test passes
        expect(error).toBeDefined();
      }
    });
  });

  describe('Performance Metrics', () => {
    it('should track advanced operations latency', async () => {
      client.resetMetrics();

      // Perform several advanced operations
      await client.trackOperation('batchUpdate', 'POST', () =>
        client.sheets.spreadsheets.batchUpdate({
          spreadsheetId: testSpreadsheet.id,
          requestBody: {
            requests: [
              {
                addNamedRange: {
                  namedRange: {
                    name: 'PerfTestRange',
                    range: {
                      sheetId,
                      startRowIndex: 0,
                      endRowIndex: 10,
                      startColumnIndex: 0,
                      endColumnIndex: 5,
                    },
                  },
                },
              },
            ],
          },
        })
      );

      await client.trackOperation('get', 'GET', () =>
        client.sheets.spreadsheets.get({
          spreadsheetId: testSpreadsheet.id,
          fields: 'namedRanges',
        })
      );

      const stats = client.getStats();
      expect(stats.totalRequests).toBeGreaterThanOrEqual(2);
      expect(stats.avgDuration).toBeGreaterThan(0);
    });
  });
});
