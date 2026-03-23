import { afterAll, describe, expect, it, vi } from 'vitest';
import { registerDeferredKnowledgeResources } from '../../src/resources/knowledge-deferred.js';
import { cleanupAllResources } from '../../src/utils/resource-cleanup.js';

afterAll(async () => {
  await cleanupAllResources();
});

describe('registerDeferredKnowledgeResources', () => {
  it('does not register the deferred knowledge template twice for the same server', () => {
    const server = {
      registerResource: vi.fn(),
    } as any;

    registerDeferredKnowledgeResources(server);
    registerDeferredKnowledgeResources(server);

    expect(server.registerResource).toHaveBeenCalledTimes(1);
  });
});
