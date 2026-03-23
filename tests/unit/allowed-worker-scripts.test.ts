import { describe, expect, it } from 'vitest';
import { assertAllowedWorkerScriptPath } from '../../src/workers/allowed-worker-scripts.js';

describe('assertAllowedWorkerScriptPath', () => {
  it('accepts registered worker basenames', () => {
    expect(() =>
      assertAllowedWorkerScriptPath('/tmp/dist/workers/analysis-worker.js')
    ).not.toThrow();
    expect(() =>
      assertAllowedWorkerScriptPath('C:\\dist\\workers\\formula-parser-worker.js')
    ).not.toThrow();
  });

  it('rejects path traversal attempts', () => {
    expect(() => assertAllowedWorkerScriptPath('../../workers/analysis-worker.js')).toThrow(
      /allowlist/i
    );
  });

  it('rejects unknown worker scripts', () => {
    expect(() => assertAllowedWorkerScriptPath('/tmp/dist/workers/evil-worker.js')).toThrow(
      /allowlist/i
    );
  });
});
