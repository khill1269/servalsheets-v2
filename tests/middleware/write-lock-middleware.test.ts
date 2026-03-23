import { describe, it, expect } from 'vitest';
import {
  extractWriteLockParams,
  withWriteLock,
  isLikelyMutationAction,
  cleanupIdleLocks,
} from '../../src/middleware/write-lock-middleware.js';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('write-lock-middleware', () => {
  it('extracts spreadsheet IDs from nested mutation payloads', () => {
    const params = extractWriteLockParams({
      request: {
        action: 'cross_write',
        source: { spreadsheetId: 'sheet-src', range: 'A1:B2' },
        destination: { spreadsheetId: 'sheet-dst', range: 'A1:B2' },
        metadata: { spreadsheetIds: ['sheet-extra'] },
      },
    });

    expect(params.action).toBe('cross_write');
    expect(new Set(params.spreadsheetIds)).toEqual(
      new Set(['sheet-src', 'sheet-dst', 'sheet-extra'])
    );
  });

  it('classifies known mutation actions even when not in audit mutation set', () => {
    expect(isLikelyMutationAction('chart_create')).toBe(true);
    expect(isLikelyMutationAction('cross_write')).toBe(true);
    expect(isLikelyMutationAction('read')).toBe(false);
  });

  it('serializes concurrent writes to the same spreadsheet', async () => {
    let inFlight = 0;
    let maxInFlight = 0;

    const runWrite = () =>
      withWriteLock(
        {
          request: {
            action: 'write',
            spreadsheetId: 'same-sheet',
            values: [[1]],
          },
        },
        async () => {
          inFlight++;
          maxInFlight = Math.max(maxInFlight, inFlight);
          await sleep(20);
          inFlight--;
          return true;
        }
      );

    await Promise.all([runWrite(), runWrite(), runWrite()]);
    expect(maxInFlight).toBe(1);
    cleanupIdleLocks();
  });

  it('serializes multi-spreadsheet mutations in deterministic lock order', async () => {
    let inFlight = 0;
    let maxInFlight = 0;

    const payloadA = {
      request: {
        action: 'cross_write',
        source: { spreadsheetId: 'sheet-a', range: 'A1:B2' },
        destination: { spreadsheetId: 'sheet-b', range: 'A1:B2' },
      },
    };

    const payloadB = {
      request: {
        action: 'cross_write',
        source: { spreadsheetId: 'sheet-b', range: 'A1:B2' },
        destination: { spreadsheetId: 'sheet-a', range: 'A1:B2' },
      },
    };

    const run = (payload: Record<string, unknown>) =>
      withWriteLock(payload, async () => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await sleep(20);
        inFlight--;
        return true;
      });

    await Promise.all([run(payloadA), run(payloadB)]);
    expect(maxInFlight).toBe(1);
    cleanupIdleLocks();
  });

  it('does not serialize non-mutation reads', async () => {
    let inFlight = 0;
    let maxInFlight = 0;

    const runRead = () =>
      withWriteLock(
        {
          request: {
            action: 'read',
            spreadsheetId: 'read-sheet',
            range: 'A1:B2',
          },
        },
        async () => {
          inFlight++;
          maxInFlight = Math.max(maxInFlight, inFlight);
          await sleep(20);
          inFlight--;
          return true;
        }
      );

    await Promise.all([runRead(), runRead()]);
    expect(maxInFlight).toBeGreaterThan(1);
  });
});
