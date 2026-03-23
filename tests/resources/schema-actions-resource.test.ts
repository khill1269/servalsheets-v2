import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetEnvForTest } from '../../src/config/env.js';
import { getActionGuidance, readSchemaResource } from '../../src/resources/schemas.js';

describe('schema://actions resources', () => {
  afterEach(() => {
    resetEnvForTest();
    vi.unstubAllEnvs();
  });

  it('returns per-tool action guidance payload', () => {
    const text = getActionGuidance('sheets_data');
    expect(text).toBeTruthy();

    const parsed = JSON.parse(text!);
    expect(parsed.$id).toBe('schema://actions/sheets_data');
    expect(parsed.tool).toBe('sheets_data');
    expect(parsed.count).toBeGreaterThan(0);
    expect(parsed.actions.some((item: { action: string }) => item.action === 'read')).toBe(true);
  });

  it('serves actions index and tool guidance through readSchemaResource', async () => {
    const index = await readSchemaResource('schema://actions');
    const indexPayload = JSON.parse(index.contents[0]!.text);
    expect(indexPayload.$id).toBe('schema://actions');
    expect(indexPayload.tools.some((tool: { name: string }) => tool.name === 'sheets_data')).toBe(
      true
    );

    const details = await readSchemaResource('schema://actions/sheets_data');
    const detailPayload = JSON.parse(details.contents[0]!.text);
    expect(detailPayload.$id).toBe('schema://actions/sheets_data');
    expect(detailPayload.count).toBeGreaterThan(0);
  });

  it('hides Apps Script trigger compatibility guidance and schema actions by default', async () => {
    const text = getActionGuidance('sheets_appsscript');
    const parsed = JSON.parse(text!);

    expect(
      parsed.actions.some((item: { action: string }) => item.action === 'create_trigger')
    ).toBe(false);
    expect(parsed.actions.some((item: { action: string }) => item.action === 'list_triggers')).toBe(
      false
    );

    const details = await readSchemaResource('schema://tools/sheets_appsscript');
    const toolPayload = JSON.parse(details.contents[0]!.text);
    const request = toolPayload.inputSchema.properties.request as Record<string, unknown>;
    const variants = Array.isArray(request.oneOf)
      ? request.oneOf
      : Array.isArray(request.anyOf)
        ? request.anyOf
        : [];
    const actions = variants
      .map((variant: Record<string, any>) => variant?.properties?.action?.const)
      .filter((value: unknown): value is string => typeof value === 'string');

    expect(actions).not.toContain('create_trigger');
    expect(actions).not.toContain('list_triggers');
  });

  it('restores Apps Script trigger compatibility guidance when explicitly enabled', () => {
    vi.stubEnv('ENABLE_APPSSCRIPT_TRIGGER_COMPAT', 'true');
    resetEnvForTest();

    const text = getActionGuidance('sheets_appsscript');
    const parsed = JSON.parse(text!);

    expect(
      parsed.actions.some((item: { action: string }) => item.action === 'create_trigger')
    ).toBe(true);
    expect(parsed.actions.some((item: { action: string }) => item.action === 'list_triggers')).toBe(
      true
    );
  });
});
