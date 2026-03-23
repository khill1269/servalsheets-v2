import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const startupMocks = vi.hoisted(() => ({
  registerServerResources: vi.fn(),
  validateEnv: vi.fn(),
  verifyToolIntegrity: vi.fn(),
}));

vi.mock('../../src/server/resource-registration.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/server/resource-registration.js')>();
  return {
    ...actual,
    registerServerResources: startupMocks.registerServerResources,
  };
});

vi.mock('../../src/config/env.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/config/env.js')>();
  return {
    ...actual,
    validateEnv: startupMocks.validateEnv,
  };
});

vi.mock('../../src/security/tool-hash-registry.js', () => ({
  verifyToolIntegrity: startupMocks.verifyToolIntegrity,
}));

import { ServalSheetsServer } from '../../src/server.js';

describe('server resource registration safeguards', () => {
  beforeEach(() => {
    startupMocks.validateEnv.mockImplementation(() => undefined);
    startupMocks.registerServerResources.mockReset();
    startupMocks.verifyToolIntegrity.mockReset();
    startupMocks.verifyToolIntegrity.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('swallows duplicate registration errors from the SDK', async () => {
    startupMocks.registerServerResources.mockRejectedValueOnce(
      new Error('Resource already registered')
    );

    const server = new ServalSheetsServer();

    await expect(
      (
        server as unknown as {
          registerResources: () => Promise<void>;
        }
      ).registerResources()
    ).resolves.toBeUndefined();
  });

  it('rethrows non-duplicate registration errors', async () => {
    startupMocks.registerServerResources.mockClear();
    startupMocks.registerServerResources.mockRejectedValueOnce(new Error('network failed'));

    const server = new ServalSheetsServer();
    // Reset the flag so registerResources() actually calls the mocked function
    (server as unknown as { resourcesRegistered: boolean }).resourcesRegistered = false;

    await expect(
      (
        server as unknown as {
          registerResources: () => Promise<void>;
        }
      ).registerResources()
    ).rejects.toThrow('network failed');

    // Verify the mock was called
    expect(startupMocks.registerServerResources).toHaveBeenCalled();
  });

  it('registers resources before connect when startup left discovery deferred', async () => {
    const server = new ServalSheetsServer();

    vi.spyOn(server, 'initialize').mockResolvedValue(undefined);
    const registerResourcesSpy = vi
      .spyOn(
        server as unknown as {
          registerResources: () => Promise<void>;
        },
        'registerResources'
      )
      .mockResolvedValue(undefined);
    const connectSpy = vi.spyOn(server.server, 'connect').mockImplementation(async () => undefined);
    vi.spyOn(process, 'on').mockReturnValue(process);

    await server.start();

    expect(registerResourcesSpy).toHaveBeenCalledTimes(1);
    expect(registerResourcesSpy.mock.invocationCallOrder[0]).toBeLessThan(
      connectSpy.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY
    );
    expect(
      (
        server as unknown as {
          resourcesRegistered: boolean;
        }
      ).resourcesRegistered
    ).toBe(true);

    await server.shutdown();
  });

  it('verifies tool integrity before startup initialization', async () => {
    const server = new ServalSheetsServer();

    const initializeSpy = vi.spyOn(server, 'initialize').mockResolvedValue(undefined);
    const registerResourcesSpy = vi
      .spyOn(
        server as unknown as {
          registerResources: () => Promise<void>;
        },
        'registerResources'
      )
      .mockResolvedValue(undefined);
    const connectSpy = vi.spyOn(server.server, 'connect').mockImplementation(async () => undefined);
    vi.spyOn(process, 'on').mockReturnValue(process);

    await server.start();

    expect(startupMocks.verifyToolIntegrity).toHaveBeenCalledTimes(1);
    expect(startupMocks.verifyToolIntegrity.mock.invocationCallOrder[0]).toBeLessThan(
      initializeSpy.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY
    );
    expect(registerResourcesSpy).toHaveBeenCalledTimes(1);
    expect(connectSpy).toHaveBeenCalledTimes(1);

    await server.shutdown();
  });
});
