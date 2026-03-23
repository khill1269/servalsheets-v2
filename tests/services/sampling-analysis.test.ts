/**
 * Tests for SamplingAnalysisService
 *
 * Tests MCP Sampling (SEP-1577) request builders and statistics tracking.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  buildAnalysisSamplingRequest,
  buildFormulaSamplingRequest,
  buildChartSamplingRequest,
  parseAnalysisResponse,
  getSamplingAnalysisService,
  resetSamplingAnalysisService,
  type AnalysisRequest,
  type AnalysisType,
} from '../../src/services/sampling-analysis.js';

describe('SamplingAnalysisService', () => {
  afterEach(() => {
    // Reset singleton for isolation
    resetSamplingAnalysisService();
  });

  describe('buildAnalysisSamplingRequest', () => {
    it('should build request with single analysis type', () => {
      const data = [
        ['Name', 'Sales', 'Region'],
        ['Alice', 1000, 'North'],
        ['Bob', 1500, 'South'],
      ];
      const request: AnalysisRequest = {
        spreadsheetId: 'test-id',
        sheetName: 'Sales Data',
        range: 'A1:C3',
        analysisTypes: ['summary'],
      };

      const samplingRequest = buildAnalysisSamplingRequest(data, request);

      expect(samplingRequest.messages).toHaveLength(1);
      expect(samplingRequest.messages[0]?.role).toBe('user');
      expect(samplingRequest.messages[0]?.content.type).toBe('text');
      expect(samplingRequest.messages[0]?.content.text).toContain(
        'Analyze the following spreadsheet data'
      );
      expect(samplingRequest.messages[0]?.content.text).toContain('**summary**');
      expect(samplingRequest.messages[0]?.content.text).toContain('Sheet: Sales Data');
      expect(samplingRequest.messages[0]?.content.text).toContain('Range: A1:C3');
      expect(samplingRequest.systemPrompt).toContain('expert data analyst');
      expect(samplingRequest.maxTokens).toBe(4096);
      expect(samplingRequest.includeContext).toBe('thisServer');
    });

    it('should build request with multiple analysis types', () => {
      const data = [['Value'], [100], [200], [150]];
      const request: AnalysisRequest = {
        spreadsheetId: 'test-id',
        analysisTypes: ['patterns', 'anomalies', 'trends'],
      };

      const samplingRequest = buildAnalysisSamplingRequest(data, request);
      const promptText = samplingRequest.messages[0]?.content.text || '';

      expect(promptText).toContain('**patterns**');
      expect(promptText).toContain('**anomalies**');
      expect(promptText).toContain('**trends**');
      expect(promptText).toContain('recurring patterns');
      expect(promptText).toContain('outliers');
      expect(promptText).toContain('trends over time');
    });

    it('should include additional context when provided', () => {
      const data = [['Value'], [1], [2]];
      const request: AnalysisRequest = {
        spreadsheetId: 'test-id',
        analysisTypes: ['summary'],
        context: 'This is Q4 2023 sales data',
      };

      const samplingRequest = buildAnalysisSamplingRequest(data, request);
      const promptText = samplingRequest.messages[0]?.content.text || '';

      expect(promptText).toContain('Additional context: This is Q4 2023 sales data');
    });

    it('should truncate large datasets (>100 rows)', () => {
      const data = Array.from({ length: 150 }, (_, i) => [`Row ${i}`, i * 10]);
      const request: AnalysisRequest = {
        spreadsheetId: 'test-id',
        analysisTypes: ['summary'],
      };

      const samplingRequest = buildAnalysisSamplingRequest(data, request);
      const promptText = samplingRequest.messages[0]?.content.text || '';

      expect(promptText).toContain('*Note: Data truncated from 150 rows');
      expect(promptText).toContain('to 100 rows');
    });

    it('should truncate wide datasets (>20 columns)', () => {
      const wideRow = Array.from({ length: 30 }, (_, i) => `Col${i}`);
      const data = [wideRow, wideRow.map((_, i) => i)];
      const request: AnalysisRequest = {
        spreadsheetId: 'test-id',
        analysisTypes: ['summary'],
      };

      const samplingRequest = buildAnalysisSamplingRequest(data, request);
      const promptText = samplingRequest.messages[0]?.content.text || '';

      expect(promptText).toContain('*Note: Data truncated');
      expect(promptText).toContain('30 cols to');
      expect(promptText).toContain('20 cols');
    });

    it('should use custom maxTokens when provided', () => {
      const data = [['Value']];
      const request: AnalysisRequest = {
        spreadsheetId: 'test-id',
        analysisTypes: ['summary'],
        maxTokens: 2048,
      };

      const samplingRequest = buildAnalysisSamplingRequest(data, request);

      expect(samplingRequest.maxTokens).toBe(2048);
    });

    it('should set model preferences for analysis', () => {
      const data = [['Value']];
      const request: AnalysisRequest = {
        spreadsheetId: 'test-id',
        analysisTypes: ['summary'],
      };

      const samplingRequest = buildAnalysisSamplingRequest(data, request);

      expect(samplingRequest.modelPreferences).toBeDefined();
      expect(samplingRequest.modelPreferences?.hints).toEqual([{ name: 'claude-3-sonnet' }]);
      expect(samplingRequest.modelPreferences?.intelligencePriority).toBe(0.8);
      expect(samplingRequest.modelPreferences?.speedPriority).toBe(0.5);
    });

    it('should handle all analysis types', () => {
      const data = [['Value']];
      const analysisTypes: AnalysisType[] = [
        'summary',
        'patterns',
        'anomalies',
        'trends',
        'quality',
        'correlations',
        'recommendations',
      ];
      const request: AnalysisRequest = {
        spreadsheetId: 'test-id',
        analysisTypes,
      };

      const samplingRequest = buildAnalysisSamplingRequest(data, request);
      const promptText = samplingRequest.messages[0]?.content.text || '';

      // Verify each analysis type is mentioned
      expect(promptText).toContain('**summary**');
      expect(promptText).toContain('**patterns**');
      expect(promptText).toContain('**anomalies**');
      expect(promptText).toContain('**trends**');
      expect(promptText).toContain('**quality**');
      expect(promptText).toContain('**correlations**');
      expect(promptText).toContain('**recommendations**');
    });
  });

  describe('buildFormulaSamplingRequest', () => {
    it('should build request with description only', () => {
      const samplingRequest = buildFormulaSamplingRequest('Calculate sum of column A', {});

      expect(samplingRequest.messages).toHaveLength(1);
      expect(samplingRequest.messages[0]?.content.text).toContain(
        '**Requirement:** Calculate sum of column A'
      );
      expect(samplingRequest.systemPrompt).toContain('expert in Google Sheets formulas');
      expect(samplingRequest.maxTokens).toBe(2048);
    });

    it('should include headers when provided', () => {
      const context = {
        headers: ['Name', 'Sales', 'Commission'],
      };

      const samplingRequest = buildFormulaSamplingRequest('Calculate commission', context);
      const promptText = samplingRequest.messages[0]?.content.text || '';

      expect(promptText).toContain('**Headers:** Name, Sales, Commission');
    });

    it('should include sample data when provided', () => {
      const context = {
        sampleData: [
          ['Alice', 1000, 100],
          ['Bob', 1500, 150],
        ],
      };

      const samplingRequest = buildFormulaSamplingRequest('Calculate average sales', context);
      const promptText = samplingRequest.messages[0]?.content.text || '';

      expect(promptText).toContain('**Sample data:**');
      expect(promptText).toContain('"Alice"');
      expect(promptText).toContain('1000');
    });

    it('should include target cell when provided', () => {
      const context = {
        targetCell: 'D2',
      };

      const samplingRequest = buildFormulaSamplingRequest('Sum values', context);
      const promptText = samplingRequest.messages[0]?.content.text || '';

      expect(promptText).toContain('**Target cell:** D2');
    });

    it('should include sheet name when provided', () => {
      const context = {
        sheetName: 'Sales Data',
      };

      const samplingRequest = buildFormulaSamplingRequest('Calculate total', context);
      const promptText = samplingRequest.messages[0]?.content.text || '';

      expect(promptText).toContain('**Sheet:** Sales Data');
    });

    it('should limit sample data to first 5 rows', () => {
      const context = {
        sampleData: Array.from({ length: 10 }, (_, i) => [`Row ${i}`]),
      };

      const samplingRequest = buildFormulaSamplingRequest('Process data', context);
      const promptText = samplingRequest.messages[0]?.content.text || '';

      // Should only include first 5 rows in JSON
      expect(promptText).toContain('Row 0');
      expect(promptText).toContain('Row 4');
      expect(promptText).not.toContain('Row 5');
    });

    it('should set model preferences for formulas', () => {
      const samplingRequest = buildFormulaSamplingRequest('Calculate sum', {});

      expect(samplingRequest.modelPreferences).toBeDefined();
      expect(samplingRequest.modelPreferences?.hints).toEqual([{ name: 'claude-3-sonnet' }]);
      expect(samplingRequest.modelPreferences?.intelligencePriority).toBe(0.9);
      expect(samplingRequest.modelPreferences?.speedPriority).toBe(0.5);
    });
  });

  describe('buildChartSamplingRequest', () => {
    it('should build request with data only', () => {
      const data = [
        ['Month', 'Sales'],
        ['Jan', 1000],
        ['Feb', 1500],
      ];

      const samplingRequest = buildChartSamplingRequest(data, {});
      const promptText = samplingRequest.messages[0]?.content.text || '';

      expect(promptText).toContain('Recommend the best chart type(s)');
      expect(promptText).toContain('"Month"');
      expect(promptText).toContain('1000');
      expect(samplingRequest.systemPrompt).toContain('data visualization expert');
    });

    it('should include goal when provided', () => {
      const data = [['Value'], [100]];
      const context = {
        goal: 'Show trend over time',
      };

      const samplingRequest = buildChartSamplingRequest(data, context);
      const promptText = samplingRequest.messages[0]?.content.text || '';

      expect(promptText).toContain('**Goal:** Show trend over time');
    });

    it('should include data description when provided', () => {
      const data = [['Value'], [100]];
      const context = {
        dataDescription: 'Monthly revenue data',
      };

      const samplingRequest = buildChartSamplingRequest(data, context);
      const promptText = samplingRequest.messages[0]?.content.text || '';

      expect(promptText).toContain('**Data description:** Monthly revenue data');
    });

    it('should include preferred chart types when provided', () => {
      const data = [['Value'], [100]];
      const context = {
        preferredTypes: ['LINE', 'BAR'],
      };

      const samplingRequest = buildChartSamplingRequest(data, context);
      const promptText = samplingRequest.messages[0]?.content.text || '';

      expect(promptText).toContain('**Preferred chart types:** LINE, BAR');
    });

    it('should limit data sample to 20 rows and 10 columns', () => {
      const wideRow = Array.from({ length: 15 }, (_, i) => `Col${i}`);
      const data = Array.from({ length: 30 }, (_, i) => wideRow.map(() => i));

      const samplingRequest = buildChartSamplingRequest(data, {});
      const promptText = samplingRequest.messages[0]?.content.text || '';

      // Parse JSON from prompt to verify truncation
      const jsonMatch = promptText.match(/```json\n([\s\S]*?)\n```/);
      expect(jsonMatch).toBeDefined();
      const parsedData = JSON.parse(jsonMatch![1]);

      expect(parsedData).toHaveLength(20); // Max 20 rows
      expect(parsedData[0]).toHaveLength(10); // Max 10 columns
    });

    it('should set model preferences for charts', () => {
      const data = [['Value'], [100]];

      const samplingRequest = buildChartSamplingRequest(data, {});

      expect(samplingRequest.modelPreferences).toBeDefined();
      expect(samplingRequest.modelPreferences?.hints).toEqual([{ name: 'claude-3-sonnet' }]);
      expect(samplingRequest.modelPreferences?.intelligencePriority).toBe(0.7);
      expect(samplingRequest.modelPreferences?.speedPriority).toBe(0.6);
    });
  });

  describe('parseAnalysisResponse', () => {
    it('should parse valid JSON response', () => {
      const responseText = `{
        "summary": "Analysis complete",
        "analyses": [
          {
            "type": "summary",
            "confidence": "high",
            "findings": ["Finding 1", "Finding 2"],
            "details": "Detailed explanation",
            "affectedCells": ["A1", "B2"],
            "recommendations": ["Recommendation 1"]
          }
        ],
        "overallQualityScore": 85,
        "topInsights": ["Insight 1", "Insight 2", "Insight 3"]
      }`;

      const result = parseAnalysisResponse(responseText);

      expect(result.success).toBe(true);
      expect(result.result).toBeDefined();
      expect(result.result?.summary).toBe('Analysis complete');
      expect(result.result?.analyses).toHaveLength(1);
      expect(result.result?.analyses[0]?.type).toBe('summary');
      expect(result.result?.overallQualityScore).toBe(85);
      expect(result.result?.topInsights).toHaveLength(3);
    });

    it('should parse JSON embedded in text', () => {
      const responseText = `Here's the analysis:

      {
        "summary": "Test summary",
        "analyses": [],
        "overallQualityScore": 90,
        "topInsights": []
      }

      Hope this helps!`;

      const result = parseAnalysisResponse(responseText);

      expect(result.success).toBe(true);
      expect(result.result?.summary).toBe('Test summary');
      expect(result.result?.overallQualityScore).toBe(90);
    });

    it('should handle response with no JSON', () => {
      const responseText = 'This is just plain text without JSON';

      const result = parseAnalysisResponse(responseText);

      expect(result.success).toBe(false);
      expect(result.error).toBe('No JSON found in response');
    });

    it('should handle invalid JSON', () => {
      const responseText = '{ invalid json syntax }';

      const result = parseAnalysisResponse(responseText);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to parse response');
    });

    it('should handle empty response', () => {
      const result = parseAnalysisResponse('');

      expect(result.success).toBe(false);
      expect(result.error).toBe('No JSON found in response');
    });
  });

  describe('SamplingAnalysisService singleton', () => {
    it('should return same instance on multiple calls', () => {
      const service1 = getSamplingAnalysisService();
      const service2 = getSamplingAnalysisService();

      expect(service1).toBe(service2);
    });

    it('should create new instance after reset', () => {
      const service1 = getSamplingAnalysisService();
      resetSamplingAnalysisService();
      const service2 = getSamplingAnalysisService();

      expect(service1).not.toBe(service2);
    });

    it('should only allow reset in test environment', () => {
      const originalEnv = process.env['NODE_ENV'];
      const originalVitest = process.env['VITEST'];

      try {
        process.env['NODE_ENV'] = 'production';
        process.env['VITEST'] = undefined;

        expect(() => resetSamplingAnalysisService()).toThrow(
          'resetSamplingAnalysisService() can only be called in test environment'
        );
      } finally {
        process.env['NODE_ENV'] = originalEnv;
        process.env['VITEST'] = originalVitest;
      }
    });
  });

  describe('SamplingAnalysisService statistics', () => {
    let service: ReturnType<typeof getSamplingAnalysisService>;

    beforeEach(() => {
      resetSamplingAnalysisService();
      service = getSamplingAnalysisService();
    });

    it('should initialize with zero stats', () => {
      const stats = service.getStats();

      expect(stats.totalRequests).toBe(0);
      expect(stats.successfulRequests).toBe(0);
      expect(stats.failedRequests).toBe(0);
      expect(stats.successRate).toBe(0);
      expect(stats.avgResponseTime).toBe(0);
      expect(stats.requestsByType).toEqual({
        summary: 0,
        patterns: 0,
        anomalies: 0,
        trends: 0,
        quality: 0,
        correlations: 0,
        recommendations: 0,
      });
    });

    it('should record successful request', () => {
      service.recordSuccess(['summary', 'patterns'], 150);

      const stats = service.getStats();
      expect(stats.totalRequests).toBe(1);
      expect(stats.successfulRequests).toBe(1);
      expect(stats.failedRequests).toBe(0);
      expect(stats.successRate).toBe(100);
      expect(stats.avgResponseTime).toBe(150);
      expect(stats.requestsByType.summary).toBe(1);
      expect(stats.requestsByType.patterns).toBe(1);
    });

    it('should record failed request', () => {
      service.recordFailure(['trends']);

      const stats = service.getStats();
      expect(stats.totalRequests).toBe(1);
      expect(stats.successfulRequests).toBe(0);
      expect(stats.failedRequests).toBe(1);
      expect(stats.successRate).toBe(0);
      expect(stats.requestsByType.trends).toBe(1);
    });

    it('should calculate success rate correctly', () => {
      service.recordSuccess(['summary'], 100);
      service.recordSuccess(['patterns'], 120);
      service.recordFailure(['anomalies']);
      service.recordSuccess(['trends'], 110);

      const stats = service.getStats();
      expect(stats.totalRequests).toBe(4);
      expect(stats.successfulRequests).toBe(3);
      expect(stats.failedRequests).toBe(1);
      expect(stats.successRate).toBe(75); // 3/4 = 75%
    });

    it('should calculate average response time', () => {
      service.recordSuccess(['summary'], 100);
      service.recordSuccess(['patterns'], 200);
      service.recordSuccess(['trends'], 150);

      const stats = service.getStats();
      expect(stats.avgResponseTime).toBe(150); // (100 + 200 + 150) / 3
    });

    it('should limit response time history to 100 entries', () => {
      // Record 150 requests
      for (let i = 0; i < 150; i++) {
        service.recordSuccess(['summary'], 100 + i);
      }

      const stats = service.getStats();
      // Average should be based on last 100 only: (150 + 151 + ... + 249) / 100 = 199.5
      expect(stats.avgResponseTime).toBeCloseTo(199.5, 1);
    });

    it('should track requests by type correctly', () => {
      service.recordSuccess(['summary', 'patterns'], 100);
      service.recordSuccess(['patterns', 'trends'], 120);
      service.recordFailure(['summary']);

      const stats = service.getStats();
      expect(stats.requestsByType.summary).toBe(2); // 1 success + 1 failure
      expect(stats.requestsByType.patterns).toBe(2); // 2 successes
      expect(stats.requestsByType.trends).toBe(1); // 1 success
      expect(stats.requestsByType.anomalies).toBe(0); // Not used
    });

    it('should reset stats correctly', () => {
      service.recordSuccess(['summary'], 150);
      service.recordFailure(['patterns']);

      service.resetStats();

      const stats = service.getStats();
      expect(stats.totalRequests).toBe(0);
      expect(stats.successfulRequests).toBe(0);
      expect(stats.failedRequests).toBe(0);
      expect(stats.successRate).toBe(0);
      expect(stats.avgResponseTime).toBe(0);
      expect(stats.requestsByType.summary).toBe(0);
      expect(stats.requestsByType.patterns).toBe(0);
    });

    it('should return copy of stats (not reference)', () => {
      const stats1 = service.getStats();
      stats1.totalRequests = 999; // Mutate copy

      const stats2 = service.getStats();
      expect(stats2.totalRequests).toBe(0); // Original unchanged
    });
  });
});
