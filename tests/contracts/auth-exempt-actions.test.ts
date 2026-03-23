/**
 * Contract test: AUTH_EXEMPT_ACTIONS (L-7)
 *
 * Verifies that:
 * 1. Tools with requiresAuth:false have no exemptActions (whole tool is exempt)
 * 2. Tools with exemptActions only contain action names that exist in their schema
 * 3. isToolCallAuthExempt() correctly reflects the per-tool authPolicy
 */
import { describe, expect, it } from 'vitest';
import {
  TOOL_DEFINITIONS,
  isToolCallAuthExempt,
  getToolAuthPolicy,
} from '../../src/mcp/registration/tool-definitions.js';

describe('AUTH_EXEMPT_ACTIONS contract', () => {
  it('tools with requiresAuth:false are fully exempt', () => {
    const noAuthTools = TOOL_DEFINITIONS.filter((t) => t.authPolicy?.requiresAuth === false);
    expect(noAuthTools.length).toBeGreaterThan(0);

    for (const tool of noAuthTools) {
      expect(
        isToolCallAuthExempt(tool.name),
        `${tool.name} (requiresAuth:false) should be auth-exempt with no action specified`
      ).toBe(true);

      expect(
        isToolCallAuthExempt(tool.name, 'any_action'),
        `${tool.name} (requiresAuth:false) should be auth-exempt for any action`
      ).toBe(true);
    }
  });

  it('tools with exemptActions only list actions that exist in their schema', () => {
    const toolsWithExemptions = TOOL_DEFINITIONS.filter(
      (t) => (t.authPolicy?.exemptActions?.length ?? 0) > 0
    );
    expect(toolsWithExemptions.length).toBeGreaterThan(0);

    for (const tool of toolsWithExemptions) {
      const exemptActions = tool.authPolicy?.exemptActions ?? [];

      // Extract the set of valid action names from the Zod discriminated union
      let knownActions: string[] | null = null;
      const schema = tool.inputSchema as { shape?: Record<string, unknown> };
      const requestSchema = schema?.shape?.['request'] as {
        _def?: { options?: Array<{ shape?: { action?: { _def?: { values?: unknown[] } } } }>; discriminator?: string };
      } | undefined;
      if (
        requestSchema?._def?.discriminator === 'action' &&
        Array.isArray(requestSchema._def.options)
      ) {
        knownActions = requestSchema._def.options
          .map((o) => String(o.shape?.['action']?._def?.['values']?.[0] ?? ''))
          .filter(Boolean);
      }

      if (knownActions !== null) {
        for (const action of exemptActions) {
          expect(
            knownActions.includes(action),
            `${tool.name}: exemptAction "${action}" not found in schema actions [${knownActions.join(', ')}]`
          ).toBe(true);
        }
      }
    }
  });

  it('isToolCallAuthExempt correctly reflects exemptActions per tool', () => {
    const toolsWithExemptions = TOOL_DEFINITIONS.filter(
      (t) => (t.authPolicy?.exemptActions?.length ?? 0) > 0 && t.authPolicy?.requiresAuth !== false
    );

    for (const tool of toolsWithExemptions) {
      const exemptActions = tool.authPolicy?.exemptActions ?? [];
      const policy = getToolAuthPolicy(tool.name);

      for (const action of exemptActions) {
        expect(
          isToolCallAuthExempt(tool.name, action),
          `${tool.name}.${action} should be auth-exempt`
        ).toBe(true);
      }

      // A non-exempt action on a requiresAuth:true tool should not be exempt
      expect(
        isToolCallAuthExempt(tool.name, '__non_existent_action__'),
        `${tool.name}.__non_existent_action__ should NOT be auth-exempt`
      ).toBe(false);

      expect(policy.requiresAuth).toBe(true);
    }
  });

  it('auth-required tools without exemptions are not exempt', () => {
    const authRequiredTools = TOOL_DEFINITIONS.filter(
      (t) =>
        t.authPolicy?.requiresAuth !== false &&
        (t.authPolicy?.exemptActions?.length ?? 0) === 0
    );
    expect(authRequiredTools.length).toBeGreaterThan(0);

    for (const tool of authRequiredTools) {
      expect(
        isToolCallAuthExempt(tool.name, 'read'),
        `${tool.name} (auth required, no exemptions) should NOT be exempt`
      ).toBe(false);
    }
  });
});
