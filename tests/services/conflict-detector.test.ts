/**
 * ConflictDetector Service Tests
 *
 * Comprehensive tests for conflict detection and resolution:
 * - Conflict detection algorithms
 * - Version tracking and comparison
 * - Range overlap detection
 * - Resolution strategies (overwrite, merge, cancel, last/first write wins)
 * - Version management
 * - Error handling
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ConflictDetector } from '../../src/services/conflict-detector.js';
import type {
  Conflict,
  ConflictResolution,
  ConflictDetectorConfig,
} from '../../src/types/conflict.js';
import { waitFor } from '../helpers/wait-for.js';

// Mock Google API client
const createMockGoogleClient = (): {
  sheets: {
    spreadsheets: {
      values: {
        get: ReturnType<typeof vi.fn>;
        update: ReturnType<typeof vi.fn>;
      };
    };
  };
} => ({
  sheets: {
    spreadsheets: {
      values: {
        get: vi.fn(),
        update: vi.fn(),
      },
    },
  },
});

describe('ConflictDetector', () => {
  let conflictDetector: ConflictDetector;
  let mockGoogleClient: ReturnType<typeof createMockGoogleClient>;

  beforeEach(() => {
    mockGoogleClient = createMockGoogleClient();
    conflictDetector = new ConflictDetector({
      enabled: true,
      checkBeforeWrite: true,
      autoResolve: false,
      defaultResolution: 'manual',
      versionCacheTtl: 60000, // 60 seconds for testing (prevent premature expiration)
      maxVersionsToCache: 1000,
      verboseLogging: false,
      googleClient: mockGoogleClient as unknown as ConflictDetectorConfig['googleClient'],
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    conflictDetector.clearCaches();
    conflictDetector.resetStats();
  });

  describe('Conflict Detection', () => {
    it('should detect concurrent modification conflict', async () => {
      // Arrange
      const spreadsheetId = 'test-sheet-123';
      const range = 'Sheet1!A1:B10';
      const oldData = [['old1', 'old2']];
      const newData = [['new1', 'new2']];

      // Track initial version
      const expectedVersion = await conflictDetector.trackVersion(
        spreadsheetId,
        range,
        'user1@example.com',
        oldData
      );

      // Wait briefly to allow time progression
      await waitFor(10);

      // Mock API to return different data (represents a concurrent edit by another user)
      mockGoogleClient.sheets.spreadsheets.values.get.mockResolvedValue({
        data: {
          values: newData,
        },
      });

      // Act
      const conflict = await conflictDetector.detectConflict(spreadsheetId, range, expectedVersion);

      // Assert
      expect(conflict).toBeDefined();
      expect(conflict?.type).toBe('concurrent_modification');
      expect(conflict?.spreadsheetId).toBe(spreadsheetId);
      expect(conflict?.range).toBe(range);
      expect(conflict?.yourVersion).toEqual(expectedVersion);
      expect(conflict?.currentVersion.checksum).not.toBe(expectedVersion.checksum);
      expect(conflict?.suggestedResolution).toBeDefined();
      expect(conflict?.alternativeResolutions).toContain('overwrite');
      expect(conflict?.alternativeResolutions).toContain('merge');
      expect(conflict?.alternativeResolutions).toContain('cancel');
    });

    it('should not detect conflict when data unchanged', async () => {
      // Arrange
      const spreadsheetId = 'test-sheet-123';
      const range = 'Sheet1!A1:B10';
      const data = [['value1', 'value2']];

      // Track version
      const expectedVersion = await conflictDetector.trackVersion(
        spreadsheetId,
        range,
        'user1@example.com',
        data
      );

      // Mock API to return same data
      mockGoogleClient.sheets.spreadsheets.values.get.mockResolvedValue({
        data: {
          values: data,
        },
      });

      // Act
      const conflict = await conflictDetector.detectConflict(spreadsheetId, range, expectedVersion);

      // Assert
      expect(conflict).toBeNull();
    });

    it('should not detect conflict when no expected version provided', async () => {
      // Arrange
      const spreadsheetId = 'test-sheet-123';
      const range = 'Sheet1!A1:B10';

      // Act
      const conflict = await conflictDetector.detectConflict(spreadsheetId, range);

      // Assert
      expect(conflict).toBeNull();
    });

    it('should assign correct severity based on time since modification', async () => {
      // Arrange
      const spreadsheetId = 'test-sheet-123';
      const range = 'Sheet1!A1:B10';
      const oldData = [['old']];
      const newData = [['new']];

      // Track version
      const expectedVersion = await conflictDetector.trackVersion(
        spreadsheetId,
        range,
        'user1@example.com',
        oldData
      );

      // Simulate time passing
      await waitFor(10);

      // Mock API to return different data with recent timestamp
      mockGoogleClient.sheets.spreadsheets.values.get.mockResolvedValue({
        data: {
          values: newData,
        },
      });

      // Act
      const conflict = await conflictDetector.detectConflict(spreadsheetId, range, expectedVersion);

      // Assert
      expect(conflict).toBeDefined();
      expect(['info', 'warning', 'error', 'critical']).toContain(conflict?.severity);
    });
  });

  describe('Resolution Strategies', () => {
    let testConflict: Conflict;

    beforeEach(async () => {
      // Setup a conflict for resolution tests
      const spreadsheetId = 'test-sheet-123';
      const range = 'Sheet1!A1:B10';
      const oldData = [['old1', 'old2']];
      const newData = [['new1', 'new2']];

      const expectedVersion = await conflictDetector.trackVersion(
        spreadsheetId,
        range,
        'user1@example.com',
        oldData
      );

      // Simulate time passing
      await waitFor(10);

      mockGoogleClient.sheets.spreadsheets.values.get.mockResolvedValue({
        data: {
          values: newData,
        },
      });

      testConflict = (await conflictDetector.detectConflict(
        spreadsheetId,
        range,
        expectedVersion
      ))!;

      expect(testConflict).toBeDefined();
    });

    it('should resolve conflict with overwrite strategy', async () => {
      // Arrange
      const resolution: ConflictResolution = {
        conflictId: testConflict.id,
        strategy: 'overwrite',
      };

      // Act
      const result = await conflictDetector.resolveConflict(resolution);

      // Assert
      expect(result.success).toBe(true);
      expect(result.strategyUsed).toBe('overwrite');
      expect(result.finalVersion).toBeDefined();
      expect(result.finalVersion?.version).toBeGreaterThan(testConflict.currentVersion.version);
      expect(result.finalVersion?.checksum).toBe(testConflict.yourVersion.checksum);
      expect(result.duration).toBeGreaterThanOrEqual(0);

      // Verify conflict removed from active list
      const activeConflicts = conflictDetector.getActiveConflicts();
      expect(activeConflicts.find((c) => c.id === testConflict.id)).toBeUndefined();
    });

    it('should resolve conflict with cancel strategy', async () => {
      // Arrange
      const resolution: ConflictResolution = {
        conflictId: testConflict.id,
        strategy: 'cancel',
      };

      // Act
      const result = await conflictDetector.resolveConflict(resolution);

      // Assert
      expect(result.success).toBe(true);
      expect(result.strategyUsed).toBe('cancel');
      expect(result.finalVersion).toEqual(testConflict.currentVersion);
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    it('should resolve conflict with merge strategy (with merge data)', async () => {
      // Arrange
      const mergeData = [['merged1', 'merged2']];
      const resolution: ConflictResolution = {
        conflictId: testConflict.id,
        strategy: 'merge',
        mergeData,
      };

      mockGoogleClient.sheets.spreadsheets.values.update.mockResolvedValue({
        data: {},
      });

      // Act
      const result = await conflictDetector.resolveConflict(resolution);

      // Assert
      expect(result.success).toBe(true);
      expect(result.strategyUsed).toBe('merge');
      expect(result.finalVersion).toBeDefined();
      expect(result.changesApplied).toBeDefined();
      expect(result.changesApplied?.totalChanges).toBe(2);
      expect(mockGoogleClient.sheets.spreadsheets.values.update).toHaveBeenCalledWith({
        spreadsheetId: testConflict.spreadsheetId,
        range: testConflict.range,
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: mergeData,
        },
      });
    });

    it('should resolve conflict with merge strategy (without merge data)', async () => {
      // Arrange
      const resolution: ConflictResolution = {
        conflictId: testConflict.id,
        strategy: 'merge',
      };

      // Act
      const result = await conflictDetector.resolveConflict(resolution);

      // Assert
      expect(result.success).toBe(true);
      expect(result.strategyUsed).toBe('merge');
      expect(result.finalVersion).toBeDefined();
      expect(mockGoogleClient.sheets.spreadsheets.values.update).not.toHaveBeenCalled();
    });

    it('should resolve conflict with last_write_wins strategy', async () => {
      // Arrange
      const resolution: ConflictResolution = {
        conflictId: testConflict.id,
        strategy: 'last_write_wins',
      };

      // Act
      const result = await conflictDetector.resolveConflict(resolution);

      // Assert
      expect(result.success).toBe(true);
      expect(result.strategyUsed).toBe('last_write_wins');
      expect(result.finalVersion).toBeDefined();

      // Should choose the version with the most recent lastModified timestamp
      const expectedWinner =
        testConflict.yourVersion.lastModified > testConflict.currentVersion.lastModified
          ? testConflict.yourVersion
          : testConflict.currentVersion;
      expect(result.finalVersion).toEqual(expectedWinner);
    });

    it('should resolve conflict with first_write_wins strategy', async () => {
      // Arrange
      const resolution: ConflictResolution = {
        conflictId: testConflict.id,
        strategy: 'first_write_wins',
      };

      // Act
      const result = await conflictDetector.resolveConflict(resolution);

      // Assert
      expect(result.success).toBe(true);
      expect(result.strategyUsed).toBe('first_write_wins');
      expect(result.finalVersion).toBeDefined();

      // Should choose the version with the earliest lastModified timestamp
      const expectedWinner =
        testConflict.yourVersion.lastModified < testConflict.currentVersion.lastModified
          ? testConflict.yourVersion
          : testConflict.currentVersion;
      expect(result.finalVersion).toEqual(expectedWinner);
    });

    it('should handle merge strategy failure when API call fails', async () => {
      // Arrange
      const mergeData = [['merged1', 'merged2']];
      const resolution: ConflictResolution = {
        conflictId: testConflict.id,
        strategy: 'merge',
        mergeData,
      };

      const apiError = new Error('API update failed');
      mockGoogleClient.sheets.spreadsheets.values.update.mockRejectedValue(apiError);

      // Act
      const result = await conflictDetector.resolveConflict(resolution);

      // Assert
      expect(result.success).toBe(false);
      expect(result.strategyUsed).toBe('merge');
      expect(result.error).toBeDefined();
      expect(result.error?.message).toBe('API update failed');
    });
  });

  describe('Version Management', () => {
    it('should track version correctly', async () => {
      // Arrange
      const spreadsheetId = 'test-sheet-123';
      const range = 'Sheet1!A1:B10';
      const modifiedBy = 'user1@example.com';
      const data = [['value1', 'value2']];

      // Act
      const version = await conflictDetector.trackVersion(spreadsheetId, range, modifiedBy, data);

      // Assert
      expect(version).toBeDefined();
      expect(version.spreadsheetId).toBe(spreadsheetId);
      expect(version.range).toBe(range);
      expect(version.modifiedBy).toBe(modifiedBy);
      expect(version.checksum).toBeDefined();
      expect(version.version).toBe(1);
      expect(version.lastModified).toBeGreaterThan(0);

      // Verify stats
      const stats = conflictDetector.getStats();
      expect(stats.versionsTracked).toBe(1);
    });

    it('should increment version number on subsequent tracking', async () => {
      // Arrange
      const spreadsheetId = 'test-sheet-123';
      const range = 'Sheet1!A1:B10';
      const modifiedBy = 'user1@example.com';

      // Act
      const version1 = await conflictDetector.trackVersion(spreadsheetId, range, modifiedBy, [
        ['data1'],
      ]);

      const version2 = await conflictDetector.trackVersion(spreadsheetId, range, modifiedBy, [
        ['data2'],
      ]);

      // Assert
      expect(version1.version).toBe(1);
      expect(version2.version).toBe(2);
      expect(version2.checksum).not.toBe(version1.checksum);
    });

    it('should calculate different checksums for different data', async () => {
      // Arrange
      const spreadsheetId = 'test-sheet-123';
      const range1 = 'Sheet1!A1:B10';
      const range2 = 'Sheet1!C1:D10';
      const modifiedBy = 'user1@example.com';

      // Act
      const version1 = await conflictDetector.trackVersion(spreadsheetId, range1, modifiedBy, [
        ['data1'],
      ]);

      const version2 = await conflictDetector.trackVersion(spreadsheetId, range2, modifiedBy, [
        ['data2'],
      ]);

      // Assert
      expect(version1.checksum).not.toBe(version2.checksum);
    });
  });

  describe('Statistics and Tracking', () => {
    it('should track conflict detection statistics', async () => {
      // Arrange
      const spreadsheetId = 'test-sheet-123';
      const range = 'Sheet1!A1:B10';

      const expectedVersion = await conflictDetector.trackVersion(
        spreadsheetId,
        range,
        'user1@example.com',
        [['old']]
      );

      // Simulate time passing
      await waitFor(10);

      mockGoogleClient.sheets.spreadsheets.values.get.mockResolvedValue({
        data: {
          values: [['new']],
        },
      });

      // Act
      await conflictDetector.detectConflict(spreadsheetId, range, expectedVersion);

      // Assert
      const stats = conflictDetector.getStats();
      expect(stats.totalChecks).toBe(1);
      expect(stats.conflictsDetected).toBe(1);
      expect(stats.detectionRate).toBe(1);
    });

    it('should track resolution statistics', async () => {
      // Arrange
      const spreadsheetId = 'test-sheet-123';
      const range = 'Sheet1!A1:B10';

      const expectedVersion = await conflictDetector.trackVersion(
        spreadsheetId,
        range,
        'user1@example.com',
        [['old']]
      );

      // Simulate time passing
      await waitFor(10);

      mockGoogleClient.sheets.spreadsheets.values.get.mockResolvedValue({
        data: {
          values: [['new']],
        },
      });

      const conflict = await conflictDetector.detectConflict(spreadsheetId, range, expectedVersion);

      // Act
      await conflictDetector.resolveConflict({
        conflictId: conflict!.id,
        strategy: 'overwrite',
      });

      // Assert
      const stats = conflictDetector.getStats();
      expect(stats.conflictsResolved).toBe(1);
      expect(stats.resolutionsByStrategy.overwrite).toBe(1);
      expect(stats.conflictsManuallyResolved).toBe(1);
      expect(stats.avgResolutionTime).toBeGreaterThanOrEqual(0);
    });

    it('should track auto-resolution separately from manual', async () => {
      // Arrange
      const autoResolveDetector = new ConflictDetector({
        enabled: true,
        autoResolve: true,
        defaultResolution: 'cancel',
        versionCacheTtl: 60000, // Use 60s TTL to prevent premature cache expiration
        googleClient: mockGoogleClient as unknown as ConflictDetectorConfig['googleClient'],
      });

      const spreadsheetId = 'test-sheet-123';
      const range = 'Sheet1!A1:B10';

      const expectedVersion = await autoResolveDetector.trackVersion(
        spreadsheetId,
        range,
        'user1@example.com',
        [['old']]
      );

      // Simulate time passing
      await waitFor(10);

      mockGoogleClient.sheets.spreadsheets.values.get.mockResolvedValue({
        data: {
          values: [['new']],
        },
      });

      // Act
      await autoResolveDetector.detectConflict(spreadsheetId, range, expectedVersion);

      // Assert
      const stats = autoResolveDetector.getStats();
      expect(stats.conflictsAutoResolved).toBe(1);
      expect(stats.conflictsManuallyResolved).toBe(0);

      autoResolveDetector.clearCaches();
    });

    it('should reset statistics correctly', async () => {
      // Arrange
      const spreadsheetId = 'test-sheet-123';
      const range = 'Sheet1!A1:B10';

      await conflictDetector.trackVersion(spreadsheetId, range, 'user1@example.com', [['data']]);

      mockGoogleClient.sheets.spreadsheets.values.get.mockResolvedValue({
        data: { values: [['new']] },
      });

      const expectedVersion = await conflictDetector.trackVersion(
        spreadsheetId,
        range,
        'user1@example.com',
        [['old']]
      );

      await conflictDetector.detectConflict(spreadsheetId, range, expectedVersion);

      // Act
      conflictDetector.resetStats();

      // Assert
      const stats = conflictDetector.getStats();
      expect(stats.totalChecks).toBe(0);
      expect(stats.conflictsDetected).toBe(0);
      expect(stats.conflictsResolved).toBe(0);
      expect(stats.versionsTracked).toBe(0);
    });

    it('should maintain active conflicts list', async () => {
      // Arrange
      const spreadsheetId = 'test-sheet-123';
      const range = 'Sheet1!A1:B10';

      const expectedVersion = await conflictDetector.trackVersion(
        spreadsheetId,
        range,
        'user1@example.com',
        [['old']]
      );

      // Simulate time passing
      await waitFor(10);

      mockGoogleClient.sheets.spreadsheets.values.get.mockResolvedValue({
        data: {
          values: [['new']],
        },
      });

      // Act
      const conflict = await conflictDetector.detectConflict(spreadsheetId, range, expectedVersion);

      // Assert
      const activeConflicts = conflictDetector.getActiveConflicts();
      expect(activeConflicts).toHaveLength(1);
      expect(activeConflicts[0].id).toBe(conflict!.id);

      // Resolve and check again
      await conflictDetector.resolveConflict({
        conflictId: conflict!.id,
        strategy: 'cancel',
      });

      const activeAfterResolve = conflictDetector.getActiveConflicts();
      expect(activeAfterResolve).toHaveLength(0);
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid resolution strategy', async () => {
      // Arrange
      const spreadsheetId = 'test-sheet-123';
      const range = 'Sheet1!A1:B10';

      const expectedVersion = await conflictDetector.trackVersion(
        spreadsheetId,
        range,
        'user1@example.com',
        [['old']]
      );

      // Simulate time passing
      await waitFor(10);

      mockGoogleClient.sheets.spreadsheets.values.get.mockResolvedValue({
        data: {
          values: [['new']],
        },
      });

      const conflict = await conflictDetector.detectConflict(spreadsheetId, range, expectedVersion);

      // Act
      const result = await conflictDetector.resolveConflict({
        conflictId: conflict!.id,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        strategy: 'invalid_strategy' as any,
      });

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error?.message).toContain('Unknown resolution strategy');
    });

    it('should handle non-existent conflict ID', async () => {
      // Arrange
      const fakeConflictId = 'non-existent-conflict-id';

      // Act
      const result = await conflictDetector.resolveConflict({
        conflictId: fakeConflictId,
        strategy: 'overwrite',
      });

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error?.message).toBe('Conflict not found');
    });

    it('should require Google API client for version fetching', async () => {
      // Arrange
      const noClientDetector = new ConflictDetector({
        enabled: true,
        checkBeforeWrite: true,
      });

      const spreadsheetId = 'test-sheet-123';
      const range = 'Sheet1!A1:B10';

      await noClientDetector.trackVersion(spreadsheetId, range, 'user1@example.com', [['data']]);

      // Clear cache to force fetching
      noClientDetector.clearCaches();

      // Track again to set up cache properly
      await noClientDetector.trackVersion(spreadsheetId, range, 'user1@example.com', [['data']]);

      // Create detector without Google client to test error handling
      const shortTTLDetector = new ConflictDetector({
        enabled: true,
        checkBeforeWrite: true,
        versionCacheTtl: 60000, // Use 60s TTL to ensure cache is valid during test
      });

      const expectedVersion2 = await shortTTLDetector.trackVersion(
        spreadsheetId,
        range,
        'user1@example.com',
        [['data']]
      );

      await waitFor(10);

      // Act & Assert
      await expect(
        shortTTLDetector.detectConflict(spreadsheetId, range, expectedVersion2)
      ).rejects.toThrow('Conflict detector requires Google API client');

      shortTTLDetector.clearCaches();
      noClientDetector.clearCaches();
    });

    it('should handle API fetch errors gracefully', async () => {
      // Arrange
      const spreadsheetId = 'test-sheet-123';
      const range = 'Sheet1!A1:B10';

      const expectedVersion = await conflictDetector.trackVersion(
        spreadsheetId,
        range,
        'user1@example.com',
        [['old']]
      );

      // Simulate time passing to ensure cache is different
      await waitFor(10);

      const apiError = new Error('API connection failed');
      mockGoogleClient.sheets.spreadsheets.values.get.mockRejectedValue(apiError);

      // Act & Assert
      await expect(
        conflictDetector.detectConflict(spreadsheetId, range, expectedVersion)
      ).rejects.toThrow('API connection failed');
    });
  });

  describe('Cache Management', () => {
    it('should use cached version within TTL', async () => {
      // Arrange
      const spreadsheetId = 'test-sheet-123';
      const range = 'Sheet1!A1:B10';
      const data = [['value']];

      // Track version (caches it)
      const expectedVersion = await conflictDetector.trackVersion(
        spreadsheetId,
        range,
        'user1@example.com',
        data
      );

      // Simulate time passing
      await waitFor(10);

      // Mock API - when called, return different data to trigger conflict detection
      mockGoogleClient.sheets.spreadsheets.values.get.mockResolvedValue({
        data: { values: [['different']] },
      });

      // Act
      await conflictDetector.detectConflict(spreadsheetId, range, expectedVersion);

      // Assert - API should be called to fetch current version
      expect(mockGoogleClient.sheets.spreadsheets.values.get).toHaveBeenCalled();
    });

    it('should clear all caches', async () => {
      // Arrange
      const spreadsheetId = 'test-sheet-123';
      const range = 'Sheet1!A1:B10';

      const expectedVersion = await conflictDetector.trackVersion(
        spreadsheetId,
        range,
        'user1@example.com',
        [['old']]
      );

      // Simulate time passing
      await waitFor(10);

      mockGoogleClient.sheets.spreadsheets.values.get.mockResolvedValue({
        data: { values: [['new']] },
      });

      await conflictDetector.detectConflict(spreadsheetId, range, expectedVersion);

      // Act
      conflictDetector.clearCaches();

      // Assert
      const activeConflicts = conflictDetector.getActiveConflicts();
      expect(activeConflicts).toHaveLength(0);
    });
  });

  describe('Configuration', () => {
    it('should respect enabled flag', async () => {
      // Arrange
      const disabledDetector = new ConflictDetector({
        enabled: false,
        googleClient: mockGoogleClient as unknown as ConflictDetectorConfig['googleClient'],
      });

      const spreadsheetId = 'test-sheet-123';
      const range = 'Sheet1!A1:B10';

      const expectedVersion = await disabledDetector.trackVersion(
        spreadsheetId,
        range,
        'user1@example.com',
        [['data']]
      );

      // Act
      const conflict = await disabledDetector.detectConflict(spreadsheetId, range, expectedVersion);

      // Assert
      expect(conflict).toBeNull();
      expect(mockGoogleClient.sheets.spreadsheets.values.get).not.toHaveBeenCalled();

      disabledDetector.clearCaches();
    });

    it('should respect checkBeforeWrite flag', async () => {
      // Arrange
      const noCheckDetector = new ConflictDetector({
        enabled: true,
        checkBeforeWrite: false,
        googleClient: mockGoogleClient as unknown as ConflictDetectorConfig['googleClient'],
      });

      const spreadsheetId = 'test-sheet-123';
      const range = 'Sheet1!A1:B10';

      const expectedVersion = await noCheckDetector.trackVersion(
        spreadsheetId,
        range,
        'user1@example.com',
        [['data']]
      );

      // Act
      const conflict = await noCheckDetector.detectConflict(spreadsheetId, range, expectedVersion);

      // Assert
      expect(conflict).toBeNull();
      expect(mockGoogleClient.sheets.spreadsheets.values.get).not.toHaveBeenCalled();

      noCheckDetector.clearCaches();
    });
  });
});
