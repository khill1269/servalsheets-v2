import { executeWithRetry, type RetryOptions } from './retry.js';

const GOOGLE_API_WRAPPED = Symbol.for('servalsheets.googleApi.wrapped');

/**
 * Ensure injected Google API clients get retry behavior even when callers pass
 * bare googleapis instances instead of the wrapped GoogleApiClient versions.
 */
export function ensureRetriableGoogleApi<T extends object | null | undefined>(
  api: T,
  options?: RetryOptions
): T {
  if (!api || typeof api !== 'object') {
    return api;
  }

  if ((api as Record<PropertyKey, unknown>)[GOOGLE_API_WRAPPED] === true) {
    return api;
  }

  const cache = new WeakMap<object, unknown>();

  const wrapObject = (obj: object): unknown => {
    if (cache.has(obj)) {
      return cache.get(obj);
    }

    const proxy = new Proxy(obj, {
      get(target, prop, receiver) {
        if (prop === GOOGLE_API_WRAPPED) {
          return true;
        }

        const descriptor = Object.getOwnPropertyDescriptor(target, prop);
        if (
          descriptor &&
          !descriptor.configurable &&
          !descriptor.writable &&
          'value' in descriptor
        ) {
          return descriptor.value;
        }

        const value = Reflect.get(target, prop, receiver);

        if (typeof value === 'function') {
          return async (...args: unknown[]) =>
            executeWithRetry(() => Promise.resolve(value.apply(target, args) as Promise<unknown>), {
              ...options,
            });
        }

        if (value && typeof value === 'object') {
          return wrapObject(value as object);
        }

        return value;
      },
    });

    cache.set(obj, proxy);
    return proxy;
  };

  return wrapObject(api) as T;
}
