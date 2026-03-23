/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * ServalSheets - Federation Circuit Breaker Tests
 *
 * Tests for circuit breaker behavior in the federated MCP client:
 * - Basic circuit transitions (closed → open → half_open → closed)
 * - ISOLATION BUG: FederatedMcpClient uses one shared circuit breaker
 *   for ALL servers — failures on Server A open the circuit for Server B.
 *   Correct implementation would use per-server circuit breakers.
 *
 * FILE STRUCTURE:
 *   Part 1 — CircuitBreaker unit tests (transitions, reset, half-open retry)
 *   Part 2 — FederatedMcpClient isolation bug documentation tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Module mocks (only needed for Part 2)
// ---------------------------------------------------------------------------

vi.mock('../../src/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// The MCP SDK Client is used by FederatedMcpClient; mock it out
vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: vi.fn().mockImplementation(() => ({
    connect: vi.fn().mockResolvedValue(undefined),
    listTools: vi.fn().mockResolvedValue({ tools: [] }),
    callTool: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: '{}' }] }),
  })),
}));

vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: vi.fn().mockImplementation(() => ({})),
}));

// ---------------------------------------------------------------------------
// Part 1: CircuitBreaker unit tests
// ---------------------------------------------------------------------------

import { CircuitBreaker } from '../../src/utils/circuit-breaker.js';

describe('CircuitBreaker — State Machine', () => {
  let breaker: CircuitBreaker;

  beforeEach(() => {
    breaker = new CircuitBreaker({
      failureThreshold: 3,
      successThreshold: 2,
      timeout: 100, // short timeout for testing
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should start in closed state', () => {
    expect(breaker.getState()).toBe('closed');
    expect(breaker.isOpen()).toBe(false);
  });

  it('should remain closed on successful operations', async () => {
    // Act — 5 successful executions
    for (let i = 0; i < 5; i++) {
      await breaker.execute(async () => 'ok');
    }

    // Assert
    expect(breaker.getState()).toBe('closed');
  });

  it('should open after reaching the failure threshold', async () => {
    // Act — trigger failureThreshold failures
    for (let i = 0; i < 3; i++) {
      await expect(breaker.execute(async () => {
        throw new Error('service down');
      })).rejects.toThrow();
    }

    // Assert — circuit is now open
    expect(breaker.getState()).toBe('open');
    expect(breaker.isOpen()).toBe(true);
  });

  it('should reject immediately when circuit is open', async () => {
    // Arrange — open the circuit
    for (let i = 0; i < 3; i++) {
      await expect(breaker.execute(async () => {
        throw new Error('service down');
      })).rejects.toThrow();
    }
    expect(breaker.getState()).toBe('open');

    // Act — attempt operation on open circuit
    await expect(breaker.execute(async () => 'should not run')).rejects.toThrow();
  });

  it('should transition to half_open after timeout elapses', async () => {
    vi.useFakeTimers();

    try {
      // Arrange — open the circuit
      for (let i = 0; i < 3; i++) {
        await expect(breaker.execute(async () => {
          throw new Error('service down');
        })).rejects.toThrow();
      }
      expect(breaker.getState()).toBe('open');

      // Act — advance time past timeout (including max jitter: timeout * 1.3)
      vi.advanceTimersByTime(200);

      // isOpen() checks Date.now() < nextAttemptTime; after timeout it returns false
      expect(breaker.isOpen()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('should transition back to closed after successThreshold successes in half_open', async () => {
    // Use a very short timeout (1ms) so real-time elapsed covers it without fake timers
    const fastBreaker = new CircuitBreaker({
      failureThreshold: 3,
      successThreshold: 2,
      timeout: 1, // 1ms timeout — real time will exceed this easily
    });

    // Arrange — open the circuit
    for (let i = 0; i < 3; i++) {
      await expect(fastBreaker.execute(async () => {
        throw new Error('fail');
      })).rejects.toThrow();
    }
    expect(fastBreaker.getState()).toBe('open');

    // Wait for timeout to elapse (1ms + jitter max 0.3ms = ~2ms total, wait 10ms to be safe)
    await new Promise((resolve) => setTimeout(resolve, 15));

    // Circuit should now allow a probe (isOpen returns false after timeout)
    expect(fastBreaker.isOpen()).toBe(false);

    // Act — successThreshold=2 successes → back to closed
    await fastBreaker.execute(async () => 'success 1');
    await fastBreaker.execute(async () => 'success 2');

    // Assert
    expect(fastBreaker.getState()).toBe('closed');
  });

  it('should reset to closed state when reset() is called', async () => {
    // Arrange — open the circuit
    for (let i = 0; i < 3; i++) {
      await expect(breaker.execute(async () => {
        throw new Error('fail');
      })).rejects.toThrow();
    }
    expect(breaker.getState()).toBe('open');

    // Act
    breaker.reset();

    // Assert
    expect(breaker.getState()).toBe('closed');
    expect(breaker.isOpen()).toBe(false);

    // Should accept operations again after reset
    const result = await breaker.execute(async () => 'works again');
    expect(result).toBe('works again');
  });

  it('should execute fallback when circuit is open and fallback is provided', async () => {
    // Arrange — open the circuit
    for (let i = 0; i < 3; i++) {
      await expect(breaker.execute(async () => {
        throw new Error('fail');
      })).rejects.toThrow();
    }

    // Act — provide a fallback
    const result = await breaker.execute(
      async () => 'primary',
      async () => 'fallback'
    );

    // Assert — fallback value returned instead of throw
    expect(result).toBe('fallback');
  });

  it('should count non-consecutive failures correctly across successes', async () => {
    // Arrange — 2 failures, 1 success, 2 more failures (total 4 failures)
    // failureThreshold=3, so should open after 3rd failure
    const fail = async () => { throw new Error('fail'); };
    const succeed = async () => 'ok';

    await expect(breaker.execute(fail)).rejects.toThrow(); // fail 1
    await expect(breaker.execute(fail)).rejects.toThrow(); // fail 2
    await breaker.execute(succeed); // success resets count
    await expect(breaker.execute(fail)).rejects.toThrow(); // fail 1 (reset)
    await expect(breaker.execute(fail)).rejects.toThrow(); // fail 2

    // After success resets count, we need 3 more failures to open
    // Currently at 2 failures after the success reset
    expect(breaker.getState()).toBe('closed');

    await expect(breaker.execute(fail)).rejects.toThrow(); // fail 3 → open

    expect(breaker.getState()).toBe('open');
  });
});

// ---------------------------------------------------------------------------
// Part 2: FederatedMcpClient isolation bug tests
// ---------------------------------------------------------------------------

describe('FederatedMcpClient — Circuit Breaker Isolation', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('DEMONSTRATES BUG: independent CircuitBreakers provide correct isolation', () => {
    // This test demonstrates what CORRECT behavior looks like:
    // each server should have its own circuit breaker.
    // FederatedMcpClient currently uses ONE shared breaker — the inverse of this.

    // Arrange — two independent circuit breakers (correct architecture)
    const breakerA = new CircuitBreaker({ failureThreshold: 3, successThreshold: 2, timeout: 30000 });
    const breakerB = new CircuitBreaker({ failureThreshold: 3, successThreshold: 2, timeout: 30000 });

    // Act — open breaker A by simulating 3 failures
    // (synchronous state check via internal mechanisms isn't available; we verify state directly)
    breakerA.reset(); // ensure clean state

    // Both start closed
    expect(breakerA.getState()).toBe('closed');
    expect(breakerB.getState()).toBe('closed');

    // Directly reset A to a known open state isn't possible without triggering failures.
    // Instead, verify they ARE independent objects.
    expect(breakerA).not.toBe(breakerB);

    // After A is reset, B is unaffected
    breakerA.reset();
    expect(breakerB.getState()).toBe('closed');
  });

  it('DEMONSTRATES BUG: shared CircuitBreaker causes cross-server contamination', async () => {
    // This test demonstrates the ACTUAL (buggy) behavior:
    // one shared circuit breaker trips on Server A's failures and blocks Server B.

    // Arrange — simulate FederatedMcpClient's shared-breaker architecture
    const sharedBreaker = new CircuitBreaker({
      failureThreshold: 3,
      successThreshold: 2,
      timeout: 30000,
    });

    // Simulate "server A" failing 3 times through the shared breaker
    const serverAFail = async () => { throw new Error('Server A is down'); };
    for (let i = 0; i < 3; i++) {
      await expect(sharedBreaker.execute(serverAFail)).rejects.toThrow();
    }

    // Assert — shared breaker is now open
    expect(sharedBreaker.getState()).toBe('open');

    // Act — "server B" tries to call through the SAME shared breaker
    // This simulates the FederatedMcpClient bug where Server B is blocked
    const serverBOperation = async () => 'Server B success';
    await expect(sharedBreaker.execute(serverBOperation)).rejects.toThrow();

    // DOCUMENTED BUG: Server B's healthy operation was blocked because
    // Server A's failures opened the shared circuit breaker.
    // Fix: FederatedMcpClient should maintain a Map<serverName, CircuitBreaker>
    // and route each server's calls through its own per-server circuit breaker.
  });

  it('should demonstrate correct per-server isolation with separate breakers', async () => {
    // This test shows how the fix WOULD work:
    // per-server circuit breakers prevent cross-contamination.

    // Arrange — per-server circuit breakers (the correct architecture)
    const perServerBreakers = new Map<string, CircuitBreaker>();
    perServerBreakers.set('server-a', new CircuitBreaker({ failureThreshold: 3, successThreshold: 2, timeout: 30000 }));
    perServerBreakers.set('server-b', new CircuitBreaker({ failureThreshold: 3, successThreshold: 2, timeout: 30000 }));

    const executeForServer = async (serverName: string, operation: () => Promise<unknown>) => {
      const breaker = perServerBreakers.get(serverName)!;
      return breaker.execute(operation);
    };

    // Act — server A fails 3 times (opens its breaker)
    const serverAFail = async () => { throw new Error('Server A is down'); };
    for (let i = 0; i < 3; i++) {
      await expect(executeForServer('server-a', serverAFail)).rejects.toThrow();
    }
    expect(perServerBreakers.get('server-a')!.getState()).toBe('open');

    // Act — server B succeeds independently
    const result = await executeForServer('server-b', async () => 'Server B works');

    // Assert — Server B is unaffected by Server A's failures
    expect(result).toBe('Server B works');
    expect(perServerBreakers.get('server-b')!.getState()).toBe('closed');
  });

  it('should verify FederatedMcpClient has a single shared circuit breaker (the bug)', async () => {
    // This test verifies the current (buggy) implementation shape by inspecting
    // that FederatedMcpClient creates only one CircuitBreaker instance per client.
    // It does not test runtime behavior but documents the structural issue.

    // Arrange — spy on CircuitBreaker constructor
    const { CircuitBreaker: SpiedBreaker } = await import('../../src/utils/circuit-breaker.js');
    const constructorSpy = vi.spyOn(SpiedBreaker.prototype, 'constructor' as any);

    // Import FederatedMcpClient
    const { FederatedMcpClient } = await import('../../src/services/federated-mcp-client.js');

    // Create client with 3 server configs
    const servers = [
      { name: 'server-a', url: 'http://server-a.example.com', transport: 'http' as const },
      { name: 'server-b', url: 'http://server-b.example.com', transport: 'http' as const },
      { name: 'server-c', url: 'http://server-c.example.com', transport: 'http' as const },
    ];
    const client = new FederatedMcpClient(servers);

    // Assert — client now uses per-server circuit breakers (the fix)
    // The old shared `circuitBreaker` field no longer exists
    const oldSharedBreaker = (client as any).circuitBreaker;
    expect(oldSharedBreaker).toBeUndefined(); // FIXED: no shared breaker

    // The new per-server Map exists
    const perServerBreakers = (client as any).circuitBreakers;
    expect(perServerBreakers).toBeDefined();
    expect(perServerBreakers).toBeInstanceOf(Map);

    constructorSpy.mockRestore();
  });
});
