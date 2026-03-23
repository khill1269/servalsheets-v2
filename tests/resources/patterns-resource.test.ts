import { describe, expect, it } from 'vitest';
import { readPatternResource } from '../../src/resources/patterns.js';

describe('servalsheets://patterns resources', () => {
  it('uses scout-first guidance in workflow overview', async () => {
    const result = await readPatternResource('servalsheets://patterns/workflows');
    const payload = JSON.parse(result.contents[0]!.text);

    expect(payload.protocol.A).toContain('scout');
    expect(payload.guidelines.complex_workflows).toContain('starting with scout');
    expect(payload.guidelines.tiered_retrieval).toContain('Start with sheets_analyze scout');
    expect(payload.guidelines.tiered_retrieval).not.toContain(
      'Use sheets_analyze comprehensive'
    );
  });

  it('teaches large-dataset workflows to scout before comprehensive', async () => {
    const result = await readPatternResource('servalsheets://patterns/complex-workflows');
    const payload = JSON.parse(result.contents[0]!.text);
    const largeDataset = payload.patterns.large_dataset;
    const assessTools = largeDataset.uasev_phases.find(
      (phase: { phase: string }) => phase.phase === 'A'
    ).tools;

    expect(assessTools[0].tool).toBe('sheets_analyze');
    expect(assessTools[0].action).toBe('scout');
    expect(assessTools[1].action).toBe('comprehensive');
    expect(largeDataset.optimization_tips[0]).toContain('Start with sheets_analyze scout');
  });

  it('uses scout for import assessment before escalating to full audits', async () => {
    const result = await readPatternResource('servalsheets://patterns/complex-workflows');
    const payload = JSON.parse(result.contents[0]!.text);
    const importCsv = payload.patterns.import_csv;
    const assessTools = importCsv.uasev_phases.find(
      (phase: { phase: string }) => phase.phase === 'A'
    ).tools;

    expect(assessTools.some((tool: { action: string }) => tool.action === 'scout')).toBe(true);
    expect(importCsv.uasev_phases.find((phase: { phase: string }) => phase.phase === 'A').notes).toContain(
      'Escalate to comprehensive only'
    );
  });
});
