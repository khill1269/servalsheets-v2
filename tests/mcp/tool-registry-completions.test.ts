import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetEnvForTest } from '../../src/config/env.js';
import { completeAction, completeToolName } from '../../src/mcp/completions.js';
import {
  replaceAvailableToolNames,
  resetAvailableToolNames,
} from '../../src/mcp/tool-registry-state.js';

describe('runtime tool registry completions', () => {
  afterEach(() => {
    resetAvailableToolNames();
    resetEnvForTest();
    vi.unstubAllEnvs();
  });

  it('filters tool-name completion to currently available tools', () => {
    replaceAvailableToolNames(['sheets_auth', 'sheets_core', 'sheets_data']);

    expect(completeToolName('sheets_')).toEqual(['sheets_auth', 'sheets_core', 'sheets_data']);
    expect(completeToolName('sheets_v')).toEqual([]);
  });

  it('filters action completion when a tool is not currently available', () => {
    replaceAvailableToolNames(['sheets_auth', 'sheets_core']);

    expect(completeAction('sheets_visualize', 'chart')).toEqual([]);
    expect(completeAction('sheets_core', 'add')).toContain('add_sheet');
  });

  it('hides Apps Script trigger compatibility actions by default', () => {
    replaceAvailableToolNames(['sheets_appsscript']);

    expect(completeAction('sheets_appsscript', 'create_t')).toEqual([]);
    expect(completeAction('sheets_appsscript', 'list_t')).toEqual([]);
    expect(completeAction('sheets_appsscript', 'run')).toEqual(['run']);
  });

  it('restores Apps Script trigger compatibility completions when explicitly enabled', () => {
    vi.stubEnv('ENABLE_APPSSCRIPT_TRIGGER_COMPAT', 'true');
    resetEnvForTest();
    replaceAvailableToolNames(['sheets_appsscript']);

    expect(completeAction('sheets_appsscript', 'create_t')).toEqual(['create_trigger']);
    expect(completeAction('sheets_appsscript', 'list_t')).toEqual(['list_triggers']);
  });
});
