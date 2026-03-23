import { describe, expect, it, vi } from 'vitest';
import { createToolHandlerMap } from '../../src/mcp/registration/tool-handlers.js';
import {
  createRequestContext,
  getRequestContext,
  runWithRequestContext,
} from '../../src/utils/request-context.js';

function createNoopHandler() {
  return {
    handle: vi.fn().mockResolvedValue({ success: true, action: 'noop' }),
  };
}

describe('createToolHandlerMap metadata cache wiring', () => {
  it('injects request-scoped metadata cache for handler execution and cleans it up', async () => {
    const observedMetadataCachePresence: boolean[] = [];
    const dataHandler = {
      handle: vi.fn().mockImplementation(async () => {
        observedMetadataCachePresence.push(Boolean(getRequestContext()?.metadataCache));
        return { success: true, action: 'read' };
      }),
    };

    const handlers = {
      core: createNoopHandler(),
      data: dataHandler,
      format: createNoopHandler(),
      dimensions: createNoopHandler(),
      visualize: createNoopHandler(),
      collaborate: createNoopHandler(),
      advanced: createNoopHandler(),
      transaction: createNoopHandler(),
      quality: createNoopHandler(),
      history: createNoopHandler(),
      confirm: createNoopHandler(),
      analyze: createNoopHandler(),
      fix: createNoopHandler(),
      composite: createNoopHandler(),
      session: createNoopHandler(),
      templates: createNoopHandler(),
      bigquery: createNoopHandler(),
      appsscript: createNoopHandler(),
      webhooks: createNoopHandler(),
      dependencies: createNoopHandler(),
      federation: createNoopHandler(),
      compute: createNoopHandler(),
      agent: createNoopHandler(),
      connectors: createNoopHandler(),
    };

    const googleClient = {
      sheets: {
        spreadsheets: {
          get: vi.fn(),
        },
      },
    };

    const map = createToolHandlerMap(handlers as never, undefined, googleClient as never);
    const requestContext = createRequestContext({});

    await runWithRequestContext(requestContext, () =>
      map['sheets_data']({
        request: {
          action: 'read',
          spreadsheetId: 'sheet-123',
          range: 'Sheet1!A1',
        },
      })
    );

    expect(dataHandler.handle).toHaveBeenCalledTimes(1);
    expect(observedMetadataCachePresence).toEqual([true]);
    expect(requestContext.metadataCache).toBeUndefined();
  });
});
