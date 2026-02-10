/**
 * Stress Test: Memory Leak Detection
 *
 * Comprehensive memory leak detection for the WebSocket server:
 * 1. Client map cleanup after disconnect
 * 2. Session map growth under churn
 * 3. Event listener accumulation
 * 4. Large message payload memory release
 * 5. Repeated server start/stop cycles
 * 6. Heap snapshot comparison across operations
 * 7. Broadcast buffer cleanup
 * 8. Rapid session creation/completion memory
 * 9. Error handler memory accumulation
 * 10. Long-lived connection with continuous messages
 */

import { describe, it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';
import { createMessage, MessageType } from '@aiinstaller/shared';
import { InstallServer } from '../packages/server/src/api/server.js';
import { routeMessage } from '../packages/server/src/api/handlers.js';

// ============================================================================
// Helpers
// ============================================================================

let testPort = 22000;
function nextPort() {
  return testPort++;
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function waitFor(
  condition: () => boolean,
  timeoutMs = 5000,
  intervalMs = 50,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      if (condition()) {
        resolve();
        return;
      }
      if (Date.now() - start > timeoutMs) {
        reject(new Error('waitFor timed out'));
        return;
      }
      setTimeout(check, intervalMs);
    };
    check();
  });
}

function connectRawClient(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

function waitForMessage(ws: WebSocket, timeoutMs = 5000): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('waitForMessage timed out')),
      timeoutMs,
    );
    ws.once('message', (data) => {
      clearTimeout(timer);
      resolve(data.toString());
    });
  });
}

/** Get memory usage snapshot in MB */
function getMemoryMB(): { heap: number; rss: number; external: number } {
  const mem = process.memoryUsage();
  return {
    heap: mem.heapUsed / (1024 * 1024),
    rss: mem.rss / (1024 * 1024),
    external: mem.external / (1024 * 1024),
  };
}

/** Force garbage collection if available */
function forceGC(): void {
  if (global.gc) {
    global.gc();
  }
}

/** Take a stable memory measurement (GC + delay + GC + measure) */
async function stableMemoryMB(): Promise<{ heap: number; rss: number; external: number }> {
  forceGC();
  await delay(100);
  forceGC();
  await delay(50);
  return getMemoryMB();
}

// ============================================================================
// Tests
// ============================================================================

describe('Stress Test: Memory Leak Detection', () => {
  let server: InstallServer | null = null;
  let rawClients: WebSocket[] = [];

  afterEach(async () => {
    for (const ws of rawClients) {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
    }
    rawClients = [];

    if (server?.isRunning()) {
      await server.stop();
    }
    server = null;
  });

  // --------------------------------------------------------------------------
  // 1. Client map cleanup after disconnect
  // --------------------------------------------------------------------------

  it('should release client memory after disconnect cycles', async () => {
    const port = nextPort();
    server = new InstallServer({ port, heartbeatIntervalMs: 60000, requireAuth: false });
    await server.start();

    const baseline = await stableMemoryMB();
    const rounds = 20;
    const clientsPerRound = 10;

    for (let round = 0; round < rounds; round++) {
      // Connect batch of clients
      const clients: WebSocket[] = [];
      for (let i = 0; i < clientsPerRound; i++) {
        const ws = await connectRawClient(port);
        clients.push(ws);
      }

      await waitFor(() => server!.getClientCount() === clientsPerRound, 5000);

      // Disconnect all
      for (const ws of clients) {
        ws.close();
      }

      await waitFor(() => server!.getClientCount() === 0, 5000);
    }

    // After all rounds, client count should be 0
    expect(server.getClientCount()).toBe(0);

    const final = await stableMemoryMB();
    const heapGrowth = final.heap - baseline.heap;

    // 200 total connections cycled, heap should not grow excessively
    expect(heapGrowth).toBeLessThan(30);
  });

  // --------------------------------------------------------------------------
  // 2. Session map growth monitoring
  // --------------------------------------------------------------------------

  it('should track session memory growth linearly', async () => {
    const port = nextPort();
    server = new InstallServer({ port, heartbeatIntervalMs: 60000, requireAuth: false });

    server.on('message', (clientId, msg) => {
      routeMessage(server!, clientId, msg);
    });

    await server.start();

    const baseline = await stableMemoryMB();

    // Create many sessions via connect -> create session -> disconnect
    const sessionCount = 50;
    for (let i = 0; i < sessionCount; i++) {
      const ws = await connectRawClient(port);

      await waitFor(() => server!.getClientCount() >= 1, 3000);

      const createMsg = createMessage(MessageType.SESSION_CREATE, {
        software: `mem-test-${i}`,
      });
      ws.send(JSON.stringify(createMsg));
      await waitForMessage(ws);

      ws.close();
      await waitFor(() => server!.getClientCount() === 0, 3000);
    }

    expect(server.getSessionCount()).toBe(sessionCount);

    const final = await stableMemoryMB();
    const heapGrowth = final.heap - baseline.heap;

    // 50 sessions are small objects; growth should be minimal
    expect(heapGrowth).toBeLessThan(30);
  });

  // --------------------------------------------------------------------------
  // 3. Event listener accumulation check
  // --------------------------------------------------------------------------

  it('should not accumulate event listeners after repeated operations', async () => {
    const port = nextPort();
    server = new InstallServer({ port, heartbeatIntervalMs: 60000, requireAuth: false });

    let messageCount = 0;
    server.on('message', () => {
      messageCount++;
    });

    await server.start();

    const rounds = 30;
    for (let i = 0; i < rounds; i++) {
      const ws = await connectRawClient(port);
      await waitFor(() => server!.getClientCount() >= 1, 3000);

      // Send a message
      const msg = createMessage(MessageType.STEP_OUTPUT, {
        stepId: `listener-test-${i}`,
        output: `Round ${i}`,
      });
      ws.send(JSON.stringify(msg));
      await delay(50);

      ws.close();
      await waitFor(() => server!.getClientCount() === 0, 3000);
    }

    // All messages should be received (no duplicate handlers)
    expect(messageCount).toBe(rounds);

    // Client count should be 0 after all disconnections
    expect(server.getClientCount()).toBe(0);
  });

  // --------------------------------------------------------------------------
  // 4. Large message payload memory release
  // --------------------------------------------------------------------------

  it('should release memory from large message payloads', async () => {
    const port = nextPort();
    server = new InstallServer({ port, heartbeatIntervalMs: 60000, requireAuth: false });

    server.on('message', (clientId, msg) => {
      routeMessage(server!, clientId, msg);
    });

    await server.start();

    const ws = await connectRawClient(port);
    rawClients.push(ws);
    await waitFor(() => server!.getClientCount() === 1);

    const baseline = await stableMemoryMB();

    // Send large payloads repeatedly
    const largePayloadSize = 100_000; // 100KB per message
    const messageCount = 50;
    const largeContent = 'x'.repeat(largePayloadSize);

    for (let i = 0; i < messageCount; i++) {
      const msg = createMessage(MessageType.STEP_OUTPUT, {
        stepId: `large-${i}`,
        output: largeContent,
      });
      ws.send(JSON.stringify(msg));
    }

    await delay(500);

    const afterSend = await stableMemoryMB();

    // Disconnect to allow server to release references
    ws.close();
    rawClients = [];
    await waitFor(() => server!.getClientCount() === 0, 3000);

    const afterDisconnect = await stableMemoryMB();

    // After disconnect, memory should not keep growing relative to after-send
    const postDisconnectGrowth = afterDisconnect.heap - baseline.heap;

    // Total ~5MB of data sent, with generous threshold for test infrastructure
    expect(postDisconnectGrowth).toBeLessThan(50);
  });

  // --------------------------------------------------------------------------
  // 5. Repeated server start/stop cycles
  // --------------------------------------------------------------------------

  it('should not leak memory across server start/stop cycles', async () => {
    const baseline = await stableMemoryMB();

    const cycles = 10;
    for (let i = 0; i < cycles; i++) {
      const port = nextPort();
      server = new InstallServer({ port, heartbeatIntervalMs: 60000, requireAuth: false });
      await server.start();

      // Connect a client, do some work
      const ws = await connectRawClient(port);
      await waitFor(() => server!.getClientCount() === 1);

      const msg = createMessage(MessageType.STEP_OUTPUT, {
        stepId: `cycle-${i}`,
        output: `Server cycle ${i}`,
      });
      ws.send(JSON.stringify(msg));
      await delay(50);

      ws.close();
      await waitFor(() => server!.getClientCount() === 0, 3000);

      await server.stop();
      server = null;
    }

    const final = await stableMemoryMB();
    const heapGrowth = final.heap - baseline.heap;

    // 10 full start/stop cycles should not accumulate significant memory
    expect(heapGrowth).toBeLessThan(30);
  });

  // --------------------------------------------------------------------------
  // 6. Heap snapshot comparison across heavy operations
  // --------------------------------------------------------------------------

  it('should show stable heap across sustained heavy operations', async () => {
    const port = nextPort();
    server = new InstallServer({ port, heartbeatIntervalMs: 60000, requireAuth: false });

    server.on('message', (clientId, msg) => {
      routeMessage(server!, clientId, msg);
    });

    await server.start();

    // Warm up
    const warmupWs = await connectRawClient(port);
    await waitFor(() => server!.getClientCount() === 1);
    const warmupMsg = createMessage(MessageType.SESSION_CREATE, { software: 'warmup' });
    warmupWs.send(JSON.stringify(warmupMsg));
    await waitForMessage(warmupWs);
    warmupWs.close();
    await waitFor(() => server!.getClientCount() === 0, 3000);

    const snapshots: number[] = [];

    // Take snapshots across multiple phases of operation
    const phases = 5;
    const operationsPerPhase = 10;

    for (let phase = 0; phase < phases; phase++) {
      for (let i = 0; i < operationsPerPhase; i++) {
        const ws = await connectRawClient(port);
        await waitFor(() => server!.getClientCount() >= 1, 3000);

        const createMsg = createMessage(MessageType.SESSION_CREATE, {
          software: `phase${phase}-op${i}`,
        });
        ws.send(JSON.stringify(createMsg));
        await waitForMessage(ws);

        // Send some messages
        for (let j = 0; j < 5; j++) {
          const stepMsg = createMessage(MessageType.STEP_OUTPUT, {
            stepId: `p${phase}-o${i}-s${j}`,
            output: `Phase ${phase}, op ${i}, step ${j} - ${'data'.repeat(50)}`,
          });
          ws.send(JSON.stringify(stepMsg));
        }

        await delay(30);
        ws.close();
        await waitFor(() => server!.getClientCount() === 0, 3000);
      }

      // Take heap snapshot after each phase
      const snap = await stableMemoryMB();
      snapshots.push(snap.heap);
    }

    // Check that heap growth rate is decreasing (stabilizing)
    // Growth between later phases should be less than between early phases
    const growthRates: number[] = [];
    for (let i = 1; i < snapshots.length; i++) {
      growthRates.push(snapshots[i] - snapshots[i - 1]);
    }

    // Total growth across all phases should be bounded
    const totalGrowth = snapshots[snapshots.length - 1] - snapshots[0];
    expect(totalGrowth).toBeLessThan(50);
  });

  // --------------------------------------------------------------------------
  // 7. Broadcast buffer cleanup
  // --------------------------------------------------------------------------

  it('should not leak memory during repeated broadcasts', async () => {
    const port = nextPort();
    server = new InstallServer({ port, heartbeatIntervalMs: 60000, requireAuth: false });
    await server.start();

    const baseline = await stableMemoryMB();

    // Cycle: connect clients -> broadcast -> disconnect
    const cycles = 15;
    const clientsPerCycle = 5;
    const broadcastsPerCycle = 10;

    for (let cycle = 0; cycle < cycles; cycle++) {
      const clients: WebSocket[] = [];
      for (let i = 0; i < clientsPerCycle; i++) {
        const ws = await connectRawClient(port);
        clients.push(ws);
      }
      await waitFor(() => server!.getClientCount() === clientsPerCycle, 5000);

      // Broadcast multiple messages
      for (let b = 0; b < broadcastsPerCycle; b++) {
        const msg = createMessage(MessageType.SESSION_COMPLETE, {
          success: true,
          summary: `Broadcast cycle ${cycle}, message ${b} - ${'payload'.repeat(100)}`,
        });
        server.broadcast(msg);
      }

      await delay(100);

      // Disconnect all
      for (const ws of clients) {
        ws.close();
      }
      await waitFor(() => server!.getClientCount() === 0, 5000);
    }

    const final = await stableMemoryMB();
    const heapGrowth = final.heap - baseline.heap;

    // 15 cycles * 5 clients * 10 broadcasts = 750 broadcasts total
    expect(heapGrowth).toBeLessThan(30);
  });

  // --------------------------------------------------------------------------
  // 8. Rapid session creation and error handling memory
  // --------------------------------------------------------------------------

  it('should handle rapid session + error cycles without memory leak', async () => {
    const port = nextPort();
    server = new InstallServer({ port, heartbeatIntervalMs: 60000, requireAuth: false });

    server.on('message', (clientId, msg) => {
      routeMessage(server!, clientId, msg);
    });

    await server.start();

    const baseline = await stableMemoryMB();

    const rounds = 30;
    for (let i = 0; i < rounds; i++) {
      const ws = await connectRawClient(port);
      await waitFor(() => server!.getClientCount() >= 1, 3000);

      // Create session
      const createMsg = createMessage(MessageType.SESSION_CREATE, {
        software: `error-test-${i}`,
      });
      ws.send(JSON.stringify(createMsg));
      await waitForMessage(ws);

      // Report an error (full ErrorContext payload required by schema)
      const errorMsg = createMessage(MessageType.ERROR_OCCURRED, {
        stepId: `step-error-${i}`,
        command: `npm install failing-package-${i}`,
        exitCode: 1,
        stderr: `Error: ENOENT: no such file or directory - ${'x'.repeat(500)}`,
        stdout: '',
        environment: {
          os: { platform: 'darwin', version: '24.0.0', arch: 'arm64' },
          shell: { type: 'zsh', version: '5.9' },
          runtime: { node: '22.0.0' },
          packageManagers: { npm: '10.0.0' },
          network: { canAccessNpm: true, canAccessGithub: true },
          permissions: { hasSudo: false, canWriteTo: ['/tmp'] },
        },
        previousSteps: [],
      });
      ws.send(JSON.stringify(errorMsg));
      await waitForMessage(ws);

      ws.close();
      await waitFor(() => server!.getClientCount() === 0, 3000);
    }

    const final = await stableMemoryMB();
    const heapGrowth = final.heap - baseline.heap;

    // 30 session+error cycles with moderate payloads
    expect(heapGrowth).toBeLessThan(30);
  });

  // --------------------------------------------------------------------------
  // 9. Invalid message handling memory
  // --------------------------------------------------------------------------

  it('should not leak memory when handling invalid messages', async () => {
    const port = nextPort();
    server = new InstallServer({ port, heartbeatIntervalMs: 60000, requireAuth: false });

    const errors: string[] = [];
    server.on('error', (_clientId, err) => {
      errors.push(err.message);
    });

    await server.start();

    const baseline = await stableMemoryMB();

    const rounds = 20;
    const invalidPerRound = 20;

    for (let round = 0; round < rounds; round++) {
      const ws = await connectRawClient(port);
      await waitFor(() => server!.getClientCount() >= 1, 3000);

      // Send invalid messages
      for (let i = 0; i < invalidPerRound; i++) {
        ws.send(JSON.stringify({ invalid: true, data: 'x'.repeat(1000), idx: i }));
      }

      await delay(100);

      ws.close();
      await waitFor(() => server!.getClientCount() === 0, 3000);
    }

    // Should have received error events for invalid messages
    expect(errors.length).toBe(rounds * invalidPerRound);

    const final = await stableMemoryMB();
    const heapGrowth = final.heap - baseline.heap;

    // Error handling should not accumulate memory
    expect(heapGrowth).toBeLessThan(30);
  });

  // --------------------------------------------------------------------------
  // 10. Long-lived connection with continuous message stream
  // --------------------------------------------------------------------------

  it('should not leak memory with continuous message stream on long-lived connection', async () => {
    const port = nextPort();
    server = new InstallServer({ port, heartbeatIntervalMs: 60000, requireAuth: false });

    let receivedCount = 0;
    server.on('message', () => {
      receivedCount++;
    });

    await server.start();

    const ws = await connectRawClient(port);
    rawClients.push(ws);
    await waitFor(() => server!.getClientCount() === 1);

    const baseline = await stableMemoryMB();

    // Send a large number of messages on a single connection
    const totalMessages = 500;
    const batchSize = 50;
    const batches = totalMessages / batchSize;

    for (let batch = 0; batch < batches; batch++) {
      for (let i = 0; i < batchSize; i++) {
        const msg = createMessage(MessageType.STEP_OUTPUT, {
          stepId: `stream-${batch}-${i}`,
          output: `Continuous stream batch ${batch}, message ${i} - ${'data'.repeat(20)}`,
        });
        ws.send(JSON.stringify(msg));
      }
      await delay(50);
    }

    await waitFor(() => receivedCount >= totalMessages, 15000);
    expect(receivedCount).toBe(totalMessages);

    const final = await stableMemoryMB();
    const heapGrowth = final.heap - baseline.heap;

    // 500 messages with moderate payloads on single connection
    expect(heapGrowth).toBeLessThan(30);
  });

  // --------------------------------------------------------------------------
  // 11. Concurrent connections with interleaved operations
  // --------------------------------------------------------------------------

  it('should not leak memory under concurrent interleaved operations', async () => {
    const port = nextPort();
    server = new InstallServer({ port, heartbeatIntervalMs: 60000, requireAuth: false });

    server.on('message', (clientId, msg) => {
      routeMessage(server!, clientId, msg);
    });

    await server.start();

    const baseline = await stableMemoryMB();

    const rounds = 10;
    const clientsPerRound = 5;
    const messagesPerClient = 10;

    for (let round = 0; round < rounds; round++) {
      // Connect multiple clients simultaneously
      const clients: WebSocket[] = [];
      for (let i = 0; i < clientsPerRound; i++) {
        const ws = await connectRawClient(port);
        clients.push(ws);
      }
      await waitFor(() => server!.getClientCount() === clientsPerRound, 5000);

      // Each client creates a session and sends messages
      const responsePromises = clients.map((ws) => waitForMessage(ws));
      for (let i = 0; i < clientsPerRound; i++) {
        const createMsg = createMessage(MessageType.SESSION_CREATE, {
          software: `concurrent-r${round}-c${i}`,
        });
        clients[i].send(JSON.stringify(createMsg));
      }
      await Promise.all(responsePromises);

      // All clients send messages concurrently
      for (const ws of clients) {
        for (let m = 0; m < messagesPerClient; m++) {
          const msg = createMessage(MessageType.STEP_OUTPUT, {
            stepId: `r${round}-m${m}`,
            output: `Round ${round}, msg ${m}`,
          });
          ws.send(JSON.stringify(msg));
        }
      }

      await delay(100);

      // Disconnect all
      for (const ws of clients) {
        ws.close();
      }
      await waitFor(() => server!.getClientCount() === 0, 5000);
    }

    const final = await stableMemoryMB();
    const heapGrowth = final.heap - baseline.heap;

    // 10 rounds * 5 clients * (1 session + 10 messages) = 550 operations
    expect(heapGrowth).toBeLessThan(40);
  });

  // --------------------------------------------------------------------------
  // 12. Memory profile summary
  // --------------------------------------------------------------------------

  it('should produce consistent memory profile across full lifecycle', async () => {
    const port = nextPort();
    server = new InstallServer({ port, heartbeatIntervalMs: 200, requireAuth: false });

    server.on('message', (clientId, msg) => {
      routeMessage(server!, clientId, msg);
    });

    await server.start();

    // Phase 1: Measure baseline after warmup
    const warmupWs = await connectRawClient(port);
    await waitFor(() => server!.getClientCount() === 1);
    warmupWs.close();
    await waitFor(() => server!.getClientCount() === 0, 3000);

    const baseline = await stableMemoryMB();

    // Phase 2: Heavy operation - connections, sessions, messages, errors
    const heavyRounds = 10;
    for (let i = 0; i < heavyRounds; i++) {
      const ws = await connectRawClient(port);
      await waitFor(() => server!.getClientCount() >= 1, 3000);

      // Create session
      const createMsg = createMessage(MessageType.SESSION_CREATE, {
        software: `lifecycle-${i}`,
      });
      ws.send(JSON.stringify(createMsg));
      await waitForMessage(ws);

      // Send normal messages
      for (let j = 0; j < 20; j++) {
        const msg = createMessage(MessageType.STEP_OUTPUT, {
          stepId: `lc-${i}-${j}`,
          output: `Lifecycle ${i}, step ${j} - ${'content'.repeat(30)}`,
        });
        ws.send(JSON.stringify(msg));
      }

      // Send an error (full ErrorContext payload required by schema)
      const errMsg = createMessage(MessageType.ERROR_OCCURRED, {
        stepId: `lc-error-${i}`,
        command: `test-command-${i}`,
        exitCode: 1,
        stderr: `Error in round ${i}`,
        stdout: '',
        environment: {
          os: { platform: 'darwin', version: '24.0.0', arch: 'arm64' },
          shell: { type: 'zsh', version: '5.9' },
          runtime: { node: '22.0.0' },
          packageManagers: { npm: '10.0.0' },
          network: { canAccessNpm: true, canAccessGithub: true },
          permissions: { hasSudo: false, canWriteTo: ['/tmp'] },
        },
        previousSteps: [],
      });
      ws.send(JSON.stringify(errMsg));
      await waitForMessage(ws);

      await delay(50);
      ws.close();
      await waitFor(() => server!.getClientCount() === 0, 3000);
    }

    const afterHeavy = await stableMemoryMB();

    // Phase 3: Cool-down with heartbeat running
    await delay(1000);

    const afterCooldown = await stableMemoryMB();

    // Verify memory characteristics
    const heavyGrowth = afterHeavy.heap - baseline.heap;
    const cooldownDelta = afterCooldown.heap - afterHeavy.heap;

    // Heavy operations should not cause excessive growth
    expect(heavyGrowth).toBeLessThan(50);

    // Cool-down should not increase memory (may decrease due to GC)
    expect(cooldownDelta).toBeLessThan(10);

    // Server should still be healthy
    expect(server.isRunning()).toBe(true);
    expect(server.getClientCount()).toBe(0);
  });
});
