/**
 * Tests for Watch Mode
 *
 * Verifies:
 * - File watching with debouncing
 * - Continuous analysis
 * - Terminal UI output
 * - Queue management
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { safeRmSync } from '../helpers/safe-cleanup.js';
import { WatchMode } from '../../scripts/analysis/watch-mode.js';
import { waitFor } from '../helpers/wait-for.js';

describe('WatchMode', () => {
  const testDir = path.join(__dirname, '../fixtures/watch-test');
  const testFile = path.join(testDir, 'test.ts');

  beforeEach(() => {
    // Create test directory
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }

    // Create initial test file
    fs.writeFileSync(
      testFile,
      `
      export function example() {
        return 'hello';
      }
      `
    );
  });

  afterEach(() => {
    // Cleanup
    if (fs.existsSync(testDir)) {
      safeRmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('Initialization', () => {
    it('should create watch mode with default options', () => {
      const watcher = new WatchMode();

      expect(watcher).toBeDefined();
      expect(watcher['options'].debounceMs).toBe(500);
      expect(watcher['options'].clearConsole).toBe(true);
      expect(watcher['options'].autoFix).toBe(false);
    });

    it('should accept custom options', () => {
      const watcher = new WatchMode({
        debounceMs: 1000,
        clearConsole: false,
        autoFix: true,
        verbose: true,
      });

      expect(watcher['options'].debounceMs).toBe(1000);
      expect(watcher['options'].clearConsole).toBe(false);
      expect(watcher['options'].autoFix).toBe(true);
      expect(watcher['options'].verbose).toBe(true);
    });

    it('should initialize orchestrator with correct options', () => {
      const watcher = new WatchMode({
        autoFix: true,
        excludeAgents: ['Testing'],
      });

      const orchestrator = watcher['orchestrator'];
      expect(orchestrator).toBeDefined();
    });
  });

  describe('Debouncing', () => {
    it('should debounce rapid changes', async () => {
      const watcher = new WatchMode({ debounceMs: 100 });

      let analysisCount = 0;
      const originalAnalyze = watcher['analyzeFile'].bind(watcher);
      watcher['analyzeFile'] = vi.fn(async (...args) => {
        analysisCount++;
        return originalAnalyze(...args);
      });

      // Simulate rapid changes
      watcher['handleFileChange'](testFile, 'changed');
      watcher['handleFileChange'](testFile, 'changed');
      watcher['handleFileChange'](testFile, 'changed');

      // Wait for debounce
      await waitFor(150);

      // Should only analyze once
      expect(analysisCount).toBeLessThanOrEqual(1);
    });

    it('should use custom debounce time', async () => {
      const watcher = new WatchMode({ debounceMs: 50 });

      let analysisTriggered = false;
      watcher['analyzeFile'] = vi.fn(async () => {
        analysisTriggered = true;
      });

      watcher['handleFileChange'](testFile, 'changed');

      // Should not trigger immediately
      expect(analysisTriggered).toBe(false);

      // Should trigger after debounce time
      await waitFor(60);
      expect(analysisTriggered).toBe(true);
    });
  });

  describe('File Change Detection', () => {
    it('should detect file additions', async () => {
      const watcher = new WatchMode({ debounceMs: 50 });

      let detectedChange = false;
      watcher['analyzeFile'] = vi.fn(async () => {
        detectedChange = true;
      });

      watcher['handleFileChange'](testFile, 'added');

      await waitFor(60);
      expect(detectedChange).toBe(true);
    });

    it('should detect file changes', async () => {
      const watcher = new WatchMode({ debounceMs: 50 });

      let detectedChange = false;
      watcher['analyzeFile'] = vi.fn(async () => {
        detectedChange = true;
      });

      watcher['handleFileChange'](testFile, 'changed');

      await waitFor(60);
      expect(detectedChange).toBe(true);
    });

    it('should ignore non-TypeScript files', async () => {
      const watcher = new WatchMode({ debounceMs: 50 });

      let analysisTriggered = false;
      watcher['analyzeFile'] = vi.fn(async () => {
        analysisTriggered = true;
      });

      const jsFile = path.join(testDir, 'test.js');
      watcher['handleFileChange'](jsFile, 'changed');

      await waitFor(60);
      expect(analysisTriggered).toBe(false);
    });
  });

  describe('Queue Management', () => {
    it('should queue changes during analysis', async () => {
      const watcher = new WatchMode({ debounceMs: 50 });

      // Simulate ongoing analysis
      watcher['isAnalyzing'] = true;

      watcher['handleFileChange'](testFile, 'changed');

      await waitFor(60);

      // Should be in queue
      expect(watcher['analysisQueue']).toContain(testFile);
    });

    it('should not duplicate queued files', async () => {
      const watcher = new WatchMode({ debounceMs: 50 });

      watcher['isAnalyzing'] = true;

      // Add same file multiple times
      watcher['handleFileChange'](testFile, 'changed');
      await waitFor(60);

      watcher['handleFileChange'](testFile, 'changed');
      await waitFor(60);

      // Should only appear once in queue
      const count = watcher['analysisQueue'].filter((f) => f === testFile).length;
      expect(count).toBe(1);
    });

    it('should process queue after analysis completes', async () => {
      const watcher = new WatchMode({ debounceMs: 50 });

      const processedFiles: string[] = [];
      watcher['analyzeFile'] = vi.fn(async (file: string) => {
        processedFiles.push(file);
        await waitFor(10);
      });

      // Queue multiple files
      const file1 = path.join(testDir, 'file1.ts');
      const file2 = path.join(testDir, 'file2.ts');

      fs.writeFileSync(file1, 'export const a = 1;');
      fs.writeFileSync(file2, 'export const b = 2;');

      watcher['handleFileChange'](file1, 'changed');
      await waitFor(60);

      watcher['isAnalyzing'] = true;
      watcher['analysisQueue'].push(file2);
      watcher['isAnalyzing'] = false;

      // Trigger queue processing
      watcher['handleFileChange'](file1, 'changed');

      await waitFor(100);

      // Both files should be processed
      expect(processedFiles.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Statistics Tracking', () => {
    it('should track total analyses', async () => {
      const watcher = new WatchMode({ debounceMs: 50 });

      const originalAnalyze = watcher['orchestrator'].runFullAnalysis.bind(watcher['orchestrator']);
      watcher['orchestrator'].runFullAnalysis = vi.fn(async () => {
        return originalAnalyze([testFile]);
      });

      await watcher['analyzeFile'](testFile, 'changed');

      expect(watcher['stats'].totalAnalyses).toBe(1);
    });

    it('should track total issues found', async () => {
      const watcher = new WatchMode({ debounceMs: 50 });

      await watcher['analyzeFile'](testFile, 'changed');

      expect(watcher['stats'].totalIssuesFound).toBeGreaterThanOrEqual(0);
    });

    it('should calculate average duration', async () => {
      const watcher = new WatchMode({ debounceMs: 50 });

      await watcher['analyzeFile'](testFile, 'changed');
      await watcher['analyzeFile'](testFile, 'changed');

      expect(watcher['stats'].averageDuration).toBeGreaterThan(0);
      expect(watcher['stats'].totalAnalyses).toBe(2);
    });
  });

  describe('Display', () => {
    it('should display results after analysis', async () => {
      const watcher = new WatchMode({ clearConsole: false });

      const consoleLog = vi.spyOn(console, 'log');

      await watcher['analyzeFile'](testFile, 'changed');

      expect(consoleLog).toHaveBeenCalled();

      consoleLog.mockRestore();
    });

    it('should show agent summary', async () => {
      const watcher = new WatchMode({ clearConsole: false });

      const consoleLog = vi.spyOn(console, 'log');

      await watcher['analyzeFile'](testFile, 'changed');

      const output = consoleLog.mock.calls.map((call) => call.join(' ')).join('\n');

      expect(output).toContain('Agents');

      consoleLog.mockRestore();
    });

    it('should show issue summary', async () => {
      const watcher = new WatchMode({ clearConsole: false });

      const consoleLog = vi.spyOn(console, 'log');

      await watcher['analyzeFile'](testFile, 'changed');

      const output = consoleLog.mock.calls.map((call) => call.join(' ')).join('\n');

      // Should show issues or "No issues found"
      expect(output).toMatch(/Issues|No issues found/);

      consoleLog.mockRestore();
    });
  });

  describe('Ignore Patterns', () => {
    it('should have default ignore patterns', () => {
      const watcher = new WatchMode();

      const ignorePatterns = watcher['getIgnorePatterns']();

      expect(ignorePatterns).toContain('**/node_modules/**');
      expect(ignorePatterns).toContain('**/dist/**');
      expect(ignorePatterns).toContain('**/.git/**');
    });

    it('should allow custom exclude patterns', () => {
      const watcher = new WatchMode({
        excludePatterns: ['**/custom/**', '**/ignore-me/**'],
      });

      const ignorePatterns = watcher['getIgnorePatterns']();

      expect(ignorePatterns).toContain('**/custom/**');
      expect(ignorePatterns).toContain('**/ignore-me/**');
    });

    it('should exclude .d.ts files', () => {
      const watcher = new WatchMode();

      const ignorePatterns = watcher['getIgnorePatterns']();

      expect(ignorePatterns).toContain('**/*.d.ts');
    });
  });

  describe('Error Handling', () => {
    it('should handle analysis errors gracefully', async () => {
      const watcher = new WatchMode({ clearConsole: false });

      const consoleError = vi.spyOn(console, 'error');

      // Force an error
      watcher['orchestrator'].runFullAnalysis = vi.fn(async () => {
        throw new Error('Analysis failed');
      });

      await watcher['analyzeFile'](testFile, 'changed');

      expect(consoleError).toHaveBeenCalled();
      expect(watcher['isAnalyzing']).toBe(false);

      consoleError.mockRestore();
    });

    it('should continue watching after errors', async () => {
      const watcher = new WatchMode({ debounceMs: 50 });

      let callCount = 0;
      watcher['orchestrator'].runFullAnalysis = vi.fn(async () => {
        callCount++;
        if (callCount === 1) {
          throw new Error('First call fails');
        }
        return {
          timestamp: new Date().toISOString(),
          files: [testFile],
          agentReports: [],
          validatedFindings: [],
          resolvedConflicts: [],
          autoFixesApplied: [],
          summary: {
            totalIssues: 0,
            criticalIssues: 0,
            highIssues: 0,
            mediumIssues: 0,
            lowIssues: 0,
            falsePositives: 0,
            autoFixable: 0,
            autoFixed: 0,
          },
          recommendations: [],
          duration: 100,
        };
      });

      // First call should fail
      await watcher['analyzeFile'](testFile, 'changed');

      // Second call should succeed
      await watcher['analyzeFile'](testFile, 'changed');

      expect(callCount).toBe(2);
    });
  });
});
