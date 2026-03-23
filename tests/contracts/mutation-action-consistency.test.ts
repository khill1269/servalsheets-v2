import { describe, expect, it } from 'vitest';
import { MUTATION_ACTIONS as AUDIT_MUTATION_ACTIONS } from '../../src/middleware/audit-middleware.js';
import {
  FORCE_WRITE_ACTIONS,
  MUTATION_ACTIONS as WRITE_LOCK_MUTATION_ACTIONS,
  isLikelyMutationAction,
} from '../../src/middleware/write-lock-middleware.js';

describe('Mutation action consistency', () => {
  it('write-lock mutation set exactly matches the audit mutation set', () => {
    expect([...WRITE_LOCK_MUTATION_ACTIONS].sort()).toEqual([...AUDIT_MUTATION_ACTIONS].sort());
  });

  it('all audit mutation actions are recognized by write-lock mutation detection', () => {
    for (const action of AUDIT_MUTATION_ACTIONS) {
      expect(isLikelyMutationAction(action), `${action} should require write-lock handling`).toBe(
        true
      );
    }
  });

  it('all force-write actions are recognized by write-lock mutation detection', () => {
    for (const action of FORCE_WRITE_ACTIONS) {
      expect(isLikelyMutationAction(action), `${action} should be forced through write-lock`).toBe(
        true
      );
    }
  });
});
