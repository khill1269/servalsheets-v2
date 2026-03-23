/**
 * Unit Tests for Feature 2: Natural Language Queries Annotations
 *
 * Tests the action-level annotations for the query_natural_language action.
 * Verifies that:
 * - Annotations are properly defined
 * - All required fields are present
 * - Values are appropriate for the action
 */

import { describe, it, expect } from 'vitest';
import { ACTION_ANNOTATIONS } from '../../src/schemas/annotations.js';

describe('Feature 2: Natural Language Queries Annotations', () => {
  const annotationKey = 'sheets_analyze.query_natural_language';

  describe('Annotation Existence', () => {
    it('should have annotations defined for query_natural_language action', () => {
      expect(ACTION_ANNOTATIONS).toHaveProperty(annotationKey);
    });

    it('should not be undefined or null', () => {
      const annotation = ACTION_ANNOTATIONS[annotationKey];
      expect(annotation).toBeDefined();
      expect(annotation).not.toBeNull();
    });
  });

  describe('Annotation Structure', () => {
    const annotation = ACTION_ANNOTATIONS[annotationKey];

    it('should specify API call count', () => {
      expect(annotation).toHaveProperty('apiCalls');
      expect(typeof annotation.apiCalls).toBe('number');
    });

    it('should specify idempotency', () => {
      expect(annotation).toHaveProperty('idempotent');
      expect(typeof annotation.idempotent).toBe('boolean');
    });

    it('should have batch alternative guidance', () => {
      expect(annotation).toHaveProperty('batchAlternative');
      expect(typeof annotation.batchAlternative).toBe('string');
    });

    it('should have prerequisites defined', () => {
      expect(annotation).toHaveProperty('prerequisites');
      expect(Array.isArray(annotation.prerequisites)).toBe(true);
    });

    it('should have common mistakes documented', () => {
      expect(annotation).toHaveProperty('commonMistakes');
      expect(Array.isArray(annotation.commonMistakes)).toBe(true);
    });

    it('should have whenToUse guidance', () => {
      expect(annotation).toHaveProperty('whenToUse');
      expect(typeof annotation.whenToUse).toBe('string');
    });

    it('should have whenNotToUse guidance', () => {
      expect(annotation).toHaveProperty('whenNotToUse');
      expect(typeof annotation.whenNotToUse).toBe('string');
    });
  });

  describe('Annotation Values', () => {
    const annotation = ACTION_ANNOTATIONS[annotationKey]!;

    it('should indicate 3 API calls (metadata + sample + LLM)', () => {
      expect(annotation.apiCalls).toBe(3);
    });

    it('should be marked as non-idempotent (AI responses vary)', () => {
      expect(annotation.idempotent).toBe(false);
    });

    it('should have at least 2 prerequisites', () => {
      expect(annotation.prerequisites?.length).toBeGreaterThanOrEqual(2);
    });

    it('should include sheets_auth.login as prerequisite', () => {
      expect(annotation.prerequisites).toContain('sheets_auth.login');
    });

    it('should mention schema understanding in prerequisites', () => {
      const prereqString = annotation.prerequisites?.join(' ');
      expect(prereqString).toContain('scout');
    });

    it('should have at least 3 common mistakes documented', () => {
      expect(annotation.commonMistakes?.length).toBeGreaterThanOrEqual(3);
    });

    it('should warn about read-only nature in common mistakes', () => {
      const mistakes = annotation.commonMistakes?.join(' ').toLowerCase();
      expect(mistakes).toContain('read-only');
    });

    it('should warn about large datasets in common mistakes', () => {
      const mistakes = annotation.commonMistakes?.join(' ').toLowerCase();
      expect(mistakes).toContain('large');
    });

    it('should recommend batch alternative for multiple sheets', () => {
      expect(annotation.batchAlternative).toContain('multi_sheet');
    });

    it('should mention natural language in whenToUse', () => {
      expect(annotation.whenToUse?.toLowerCase()).toContain('natural language');
    });

    it('should mention schema knowledge in whenNotToUse', () => {
      const whenNotToUse = annotation.whenNotToUse?.toLowerCase();
      expect(whenNotToUse).toContain('schema');
    });
  });

  describe('AI Guidance Quality', () => {
    const annotation = ACTION_ANNOTATIONS[annotationKey]!;

    it('should have clear and concise whenToUse guidance', () => {
      expect(annotation.whenToUse).toBeDefined();
      expect(annotation.whenToUse!.length).toBeGreaterThan(20);
      expect(annotation.whenToUse!.length).toBeLessThan(200);
    });

    it('should have actionable common mistakes', () => {
      annotation.commonMistakes?.forEach((mistake) => {
        expect(mistake.length).toBeGreaterThan(10);
        expect(mistake).not.toContain('TODO');
        expect(mistake).not.toContain('FIXME');
      });
    });

    it('should provide clear prerequisites', () => {
      annotation.prerequisites?.forEach((prereq) => {
        expect(prereq.length).toBeGreaterThan(5);
        expect(prereq).toContain('sheets_');
      });
    });

    it('should have meaningful batch alternative', () => {
      expect(annotation.batchAlternative).toBeDefined();
      expect(annotation.batchAlternative!.length).toBeGreaterThan(10);
      expect(annotation.batchAlternative).toContain('sheets_');
    });
  });

  describe('Integration with Related Actions', () => {
    it('should have related action annotations defined', () => {
      // sheets_analyze.comprehensive should exist
      expect(ACTION_ANNOTATIONS).toHaveProperty('sheets_analyze.comprehensive');

      // sheets_data.read should exist as alternative
      expect(ACTION_ANNOTATIONS).toHaveProperty('sheets_data.read');
    });

    it('should be part of sheets_analyze tool', () => {
      const key = annotationKey.split('.')[0];
      expect(key).toBe('sheets_analyze');
    });

    it('should complement other analyze actions', () => {
      // Should have other analyze actions
      const analyzeActions = Object.keys(ACTION_ANNOTATIONS).filter((key) =>
        key.startsWith('sheets_analyze.')
      );

      expect(analyzeActions.length).toBeGreaterThan(1);
      expect(analyzeActions).toContain(annotationKey);
    });
  });

  describe('Completeness Check', () => {
    const annotation = ACTION_ANNOTATIONS[annotationKey]!;

    it('should have all recommended annotation fields', () => {
      const requiredFields = [
        'apiCalls',
        'idempotent',
        'batchAlternative',
        'prerequisites',
        'commonMistakes',
        'whenToUse',
        'whenNotToUse',
      ];

      requiredFields.forEach((field) => {
        expect(annotation).toHaveProperty(field);
      });
    });

    it('should not have empty string values', () => {
      if (annotation.whenToUse) {
        expect(annotation.whenToUse.trim()).not.toBe('');
      }
      if (annotation.whenNotToUse) {
        expect(annotation.whenNotToUse.trim()).not.toBe('');
      }
      if (annotation.batchAlternative) {
        expect(annotation.batchAlternative.trim()).not.toBe('');
      }
    });

    it('should not have empty arrays', () => {
      if (annotation.prerequisites) {
        expect(annotation.prerequisites.length).toBeGreaterThan(0);
      }
      if (annotation.commonMistakes) {
        expect(annotation.commonMistakes.length).toBeGreaterThan(0);
      }
    });
  });

  describe('Documentation Quality', () => {
    const annotation = ACTION_ANNOTATIONS[annotationKey]!;

    it('should use clear language in guidance', () => {
      const guidance = [annotation.whenToUse, annotation.whenNotToUse, annotation.batchAlternative]
        .filter(Boolean)
        .join(' ');

      // Should not contain placeholder text
      expect(guidance.toLowerCase()).not.toContain('todo');
      expect(guidance.toLowerCase()).not.toContain('fixme');
      expect(guidance.toLowerCase()).not.toContain('xxx');
    });

    it('should provide specific examples in mistakes', () => {
      const mistakes = annotation.commonMistakes?.join(' ').toLowerCase();

      // Should mention specific scenarios
      expect(mistakes).toContain('data');
    });

    it('should guide toward correct action selection', () => {
      const whenNotToUse = annotation.whenNotToUse?.toLowerCase();

      // Should mention alternative tools/actions
      expect(whenNotToUse).toContain('sheets_');
    });
  });

  describe('Consistency with Implementation', () => {
    it('should match the actual API call count', () => {
      // query_natural_language makes:
      // 1. Metadata read (getSpreadsheet)
      // 2. Sample read (values.get)
      // 3. LLM call (via sampling)
      expect(ACTION_ANNOTATIONS[annotationKey]?.apiCalls).toBe(3);
    });

    it('should correctly identify non-idempotent behavior', () => {
      // LLM responses can vary, so it's not idempotent
      expect(ACTION_ANNOTATIONS[annotationKey]?.idempotent).toBe(false);
    });

    it('should reference existing batch operation', () => {
      const batchAlt = ACTION_ANNOTATIONS[annotationKey]?.batchAlternative;

      // Should reference a real action
      expect(batchAlt).toContain('sheets_composite');
    });
  });
});
