import { afterEach, describe, expect, it, vi } from 'vitest';
import { ensureServerResourcesRegistered } from '../../src/server-runtime/resource-registration.js';

describe('ensureServerResourcesRegistered', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('coalesces concurrent lazy registration into a single in-flight promise', async () => {
    const setResourcesRegistered = vi.fn();
    const setResourceRegistrationPromise = vi.fn();
    const setResourceRegistrationFailed = vi.fn();

    let resolveRegistration: (() => void) | undefined;
    const registerResources = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveRegistration = resolve;
        })
    );

    const firstCall = ensureServerResourcesRegistered({
      resourcesRegistered: false,
      resourceRegistrationPromise: null,
      resourceRegistrationFailed: false,
      registerResources,
      setResourcesRegistered,
      setResourceRegistrationPromise,
      setResourceRegistrationFailed,
    });

    const inFlightPromise = setResourceRegistrationPromise.mock.calls[0]?.[0] as Promise<void>;
    expect(inFlightPromise).toBeInstanceOf(Promise);

    const secondCall = ensureServerResourcesRegistered({
      resourcesRegistered: false,
      resourceRegistrationPromise: inFlightPromise,
      resourceRegistrationFailed: false,
      registerResources,
      setResourcesRegistered,
      setResourceRegistrationPromise,
      setResourceRegistrationFailed,
    });

    resolveRegistration?.();
    await Promise.all([firstCall, secondCall]);

    expect(registerResources).toHaveBeenCalledTimes(1);
    expect(setResourcesRegistered).toHaveBeenCalledWith(true);
    expect(setResourceRegistrationPromise).toHaveBeenLastCalledWith(null);
  });

  it('poisons the retry guard on failure to prevent cascading "already registered" errors', async () => {
    const setResourcesRegistered = vi.fn();
    const setResourceRegistrationPromise = vi.fn();
    const setResourceRegistrationFailed = vi.fn();

    const registerResources = vi.fn(async () => {
      throw new Error('registration failed');
    });

    await expect(
      ensureServerResourcesRegistered({
        resourcesRegistered: false,
        resourceRegistrationPromise: null,
        resourceRegistrationFailed: false,
        registerResources,
        setResourcesRegistered,
        setResourceRegistrationPromise,
        setResourceRegistrationFailed,
      })
    ).rejects.toThrow('registration failed');

    expect(setResourcesRegistered).not.toHaveBeenCalled();
    expect(setResourceRegistrationFailed).toHaveBeenCalledWith(true);
    expect(setResourceRegistrationPromise).toHaveBeenLastCalledWith(null);
  });

  it('short-circuits on the poison flag without calling registerResources again', async () => {
    const setResourcesRegistered = vi.fn();
    const setResourceRegistrationPromise = vi.fn();
    const setResourceRegistrationFailed = vi.fn();
    const registerResources = vi.fn();

    await expect(
      ensureServerResourcesRegistered({
        resourcesRegistered: false,
        resourceRegistrationPromise: null,
        resourceRegistrationFailed: true, // poisoned
        registerResources,
        setResourcesRegistered,
        setResourceRegistrationPromise,
        setResourceRegistrationFailed,
      })
    ).resolves.toBeUndefined();

    expect(registerResources).not.toHaveBeenCalled();
  });
});
