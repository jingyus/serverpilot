/**
 * Stress Test: Long-Running Operation
 *
 * Tests server stability under sustained operation over extended periods:
 * 1. Server uptime stability
 * 2. Continuous message processing
 * 3. Heartbeat over extended periods
 * 4. Memory stability (no unbounded growth)
 * 5. Session persistence over time
 * 6. Connection recovery after idle periods
 * 7. Sustained throughput
 * 8. Periodic connect/disconnect over time
 */

import { describe, it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';
import { createMessage, MessageType } from '@aiinstaller/shared';
import { InstallServer } from '../packages/server/src/api/server.js';
import { routeMessage } from '../packages/server/src/api/handlers.js';

// ============================================================================
// Helpers
// ============================================================================

let testPort = 21000;
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

function collectMessages(ws: WebSocket, count: number, timeoutMs = 10000): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const messages: string[] = [];
    const timer = setTimeout(
      () => reject(new Error(`collectMessages timed out (got ${messages.length}/${count})`)),
      timeoutMs,
    );
    ws.on('message', (data) => {
      messages.push(data.toString());
      if (messages.length >= count) {
        clearTimeout(timer);
        resolve(messages);
      }
    });
  });
}

/** Get approximate heap usage in MB */
function getHeapUsageMB(): number {
  return process.memoryUsage().heapUsed / (1024 * 1024);
}

// ============================================================================
// Tests
// ============================================================================

describe('Stress Test: Long-Running Operation', () => {
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
  // 1. Server uptime stability
  // --------------------------------------------------------------------------

  it('should remain stable after extended uptime', async () => {
    const port = nextPort();
    server = new InstallServer({ port, heartbeatIntervalMs: 200, requireAuth: false });
    await server.start();

    expect(server.isRunning()).toBe(true);

    // Keep server running for 3 seconds with periodic checks
    const checkIntervalMs = 500;
    const totalDurationMs = 3000;
    const checks = totalDurationMs / checkIntervalMs;

    for (let i = 0; i < checks; i++) {
      await delay(checkIntervalMs);
      expect(server.isRunning()).toBe(true);
    }

    // Server should still accept connections after extended uptime
    const ws = await connectRawClient(port);
    rawClients.push(ws);

    await waitFor(() => server!.getClientCount() === 1);
    expect(ws.readyState).toBe(WebSocket.OPEN);
  });

  // --------------------------------------------------------------------------
  // 2. Continuous message processing
  // --------------------------------------------------------------------------

  it('should process messages continuously over extended period', async () => {
    const port = nextPort();
    server = new InstallServer({ port, heartbeatIntervalMs: 60000, requireAuth: false });

    let totalReceived = 0;
    server.on('message', () => {
      totalReceived++;
    });

    await server.start();

    const ws = await connectRawClient(port);
    rawClients.push(ws);

    await waitFor(() => server!.getClientCount() === 1);

    // Send messages in batches over time (5 batches, 20 messages each, 200ms apart)
    const batches = 5;
    const messagesPerBatch = 20;
    const batchIntervalMs = 200;

    for (let batch = 0; batch < batches; batch++) {
      for (let i = 0; i < messagesPerBatch; i++) {
        const msg = createMessage(MessageType.STEP_OUTPUT, {
          stepId: `step-batch${batch}-${i}`,
          output: `Batch ${batch}, message ${i}`,
        });
        ws.send(JSON.stringify(msg));
      }
      await delay(batchIntervalMs);
    }

    const totalExpected = batches * messagesPerBatch;
    await waitFor(() => totalReceived >= totalExpected, 10000);

    expect(totalReceived).toBe(totalExpected);
  });

  // --------------------------------------------------------------------------
  // 3. Heartbeat stability over extended period
  // --------------------------------------------------------------------------

  it('should maintain heartbeat over many cycles', async () => {
    const port = nextPort();
    const heartbeatMs = 100;
    server = new InstallServer({ port, heartbeatIntervalMs: heartbeatMs, requireAuth: false });

    await server.start();

    const clientCount = 5;
    const clients: WebSocket[] = [];
    for (let i = 0; i < clientCount; i++) {
      const ws = await connectRawClient(port);
      clients.push(ws);
      rawClients.push(ws);
    }

    await waitFor(() => server!.getClientCount() === clientCount);

    // Let heartbeat run for multiple cycles (at least 15 cycles)
    await delay(heartbeatMs * 15);

    // All clients should still be connected (ws library auto-responds to pings)
    expect(server.getClientCount()).toBe(clientCount);
    for (const ws of clients) {
      expect(ws.readyState).toBe(WebSocket.OPEN);
    }
  });

  // --------------------------------------------------------------------------
  // 4. Memory stability - no unbounded growth
  // --------------------------------------------------------------------------

  it('should not show unbounded memory growth during sustained operation', async () => {
    const port = nextPort();
    server = new InstallServer({ port, heartbeatIntervalMs: 60000, requireAuth: false });

    server.on('message', (clientId, msg) => {
      routeMessage(server!, clientId, msg);
    });

    await server.start();

    // Force GC if available, then take baseline
    if (global.gc) global.gc();
    const baselineHeap = getHeapUsageMB();

    // Run multiple rounds of connect -> create session -> send messages -> disconnect
    const rounds = 10;
    const messagesPerRound = 50;

    for (let round = 0; round < rounds; round++) {
      const ws = await connectRawClient(port);

      await waitFor(() => server!.getClientCount() >= 1, 3000);

      // Create session
      const createMsg = createMessage(MessageType.SESSION_CREATE, { software: 'test-app' });
      ws.send(JSON.stringify(createMsg));
      await waitForMessage(ws);

      // Send messages
      for (let i = 0; i < messagesPerRound; i++) {
        const msg = createMessage(MessageType.STEP_OUTPUT, {
          stepId: `step-${round}-${i}`,
          output: `Round ${round}, message ${i} - ${'x'.repeat(100)}`,
        });
        ws.send(JSON.stringify(msg));
      }

      await delay(100);

      // Disconnect
      ws.close();
      await waitFor(() => server!.getClientCount() === 0, 3000);
    }

    // Force GC if available
    if (global.gc) global.gc();
    await delay(200);

    const finalHeap = getHeapUsageMB();
    const heapGrowth = finalHeap - baselineHeap;

    // Heap should not grow more than 50MB during the test
    // (generous threshold to account for test infrastructure)
    expect(heapGrowth).toBeLessThan(50);
  });

  // --------------------------------------------------------------------------
  // 5. Session persistence over time
  // --------------------------------------------------------------------------

  it('should maintain session data over extended periods', async () => {
    const port = nextPort();
    server = new InstallServer({ port, heartbeatIntervalMs: 200, requireAuth: false });

    server.on('message', (clientId, msg) => {
      routeMessage(server!, clientId, msg);
    });

    await server.start();

    const ws = await connectRawClient(port);
    rawClients.push(ws);

    await waitFor(() => server!.getClientCount() === 1);

    // Create session
    const createMsg = createMessage(MessageType.SESSION_CREATE, {
      software: 'openclaw',
      version: '1.0.0',
    });
    ws.send(JSON.stringify(createMsg));
    const response = await waitForMessage(ws);
    const parsed = JSON.parse(response);
    expect(parsed.type).toBe(MessageType.PLAN_RECEIVE);

    // Wait for some time to simulate extended operation
    await delay(1500);

    // Session should still exist
    expect(server.getSessionCount()).toBe(1);

    // Client should still be connected
    expect(server.getClientCount()).toBe(1);
    expect(ws.readyState).toBe(WebSocket.OPEN);

    // Should still be able to communicate
    const outputMsg = createMessage(MessageType.STEP_OUTPUT, {
      stepId: 'delayed-step',
      output: 'Output after delay',
    });
    ws.send(JSON.stringify(outputMsg));

    await delay(100);

    // Connection still healthy
    expect(ws.readyState).toBe(WebSocket.OPEN);
  });

  // --------------------------------------------------------------------------
  // 6. Connection recovery after idle periods
  // --------------------------------------------------------------------------

  it('should handle connections going idle and resuming', async () => {
    const port = nextPort();
    server = new InstallServer({ port, heartbeatIntervalMs: 300, requireAuth: false });

    let messageCount = 0;
    server.on('message', () => {
      messageCount++;
    });

    await server.start();

    const ws = await connectRawClient(port);
    rawClients.push(ws);

    await waitFor(() => server!.getClientCount() === 1);

    // Send initial messages
    for (let i = 0; i < 5; i++) {
      const msg = createMessage(MessageType.STEP_OUTPUT, {
        stepId: `pre-idle-${i}`,
        output: `Before idle ${i}`,
      });
      ws.send(JSON.stringify(msg));
    }
    await waitFor(() => messageCount >= 5, 3000);

    // Go idle (longer than heartbeat interval to test heartbeat keeping connection alive)
    await delay(1000);

    // Connection should still be alive after idle
    expect(ws.readyState).toBe(WebSocket.OPEN);
    expect(server.getClientCount()).toBe(1);

    // Resume sending messages
    for (let i = 0; i < 5; i++) {
      const msg = createMessage(MessageType.STEP_OUTPUT, {
        stepId: `post-idle-${i}`,
        output: `After idle ${i}`,
      });
      ws.send(JSON.stringify(msg));
    }
    await waitFor(() => messageCount >= 10, 3000);

    expect(messageCount).toBe(10);
  });

  // --------------------------------------------------------------------------
  // 7. Sustained throughput
  // --------------------------------------------------------------------------

  it('should maintain consistent throughput over time', async () => {
    const port = nextPort();
    server = new InstallServer({ port, heartbeatIntervalMs: 60000, requireAuth: false });

    const messageTimes: number[] = [];
    server.on('message', () => {
      messageTimes.push(Date.now());
    });

    await server.start();

    const ws = await connectRawClient(port);
    rawClients.push(ws);

    await waitFor(() => server!.getClientCount() === 1);

    // Send messages in 3 phases with gaps
    const phases = 3;
    const messagesPerPhase = 30;
    const gapMs = 300;

    for (let phase = 0; phase < phases; phase++) {
      const phaseStart = Date.now();
      for (let i = 0; i < messagesPerPhase; i++) {
        const msg = createMessage(MessageType.STEP_OUTPUT, {
          stepId: `phase${phase}-step-${i}`,
          output: `Phase ${phase}, step ${i}`,
        });
        ws.send(JSON.stringify(msg));
      }

      // Wait for all messages in this phase to be received
      const expectedTotal = (phase + 1) * messagesPerPhase;
      await waitFor(() => messageTimes.length >= expectedTotal, 10000);

      // Gap between phases
      if (phase < phases - 1) {
        await delay(gapMs);
      }
    }

    const totalExpected = phases * messagesPerPhase;
    expect(messageTimes.length).toBe(totalExpected);

    // Verify no significant processing delay:
    // last message should arrive within 5 seconds of the first
    const totalProcessingTime = messageTimes[messageTimes.length - 1] - messageTimes[0];
    expect(totalProcessingTime).toBeLessThan(5000);
  });

  // --------------------------------------------------------------------------
  // 8. Periodic connect/disconnect over time
  // --------------------------------------------------------------------------

  it('should handle periodic connect/disconnect cycles over time', async () => {
    const port = nextPort();
    server = new InstallServer({ port, heartbeatIntervalMs: 200, requireAuth: false });

    let totalConnections = 0;
    let totalDisconnections = 0;

    server.on('connection', () => totalConnections++);
    server.on('disconnect', () => totalDisconnections++);

    server.on('message', (clientId, msg) => {
      routeMessage(server!, clientId, msg);
    });

    await server.start();

    // Simulate 5 cycles of: connect -> do work -> disconnect -> wait
    const cycles = 5;
    for (let cycle = 0; cycle < cycles; cycle++) {
      const ws = await connectRawClient(port);
      await waitFor(() => server!.getClientCount() >= 1, 3000);

      // Do some work: create session + send messages
      const createMsg = createMessage(MessageType.SESSION_CREATE, {
        software: `app-cycle-${cycle}`,
      });
      ws.send(JSON.stringify(createMsg));
      await waitForMessage(ws);

      for (let i = 0; i < 10; i++) {
        const msg = createMessage(MessageType.STEP_OUTPUT, {
          stepId: `cycle${cycle}-step-${i}`,
          output: `Cycle ${cycle}, step ${i}`,
        });
        ws.send(JSON.stringify(msg));
      }

      await delay(100);

      // Disconnect
      ws.close();
      await waitFor(() => server!.getClientCount() === 0, 3000);

      // Short pause between cycles
      await delay(150);
    }

    expect(totalConnections).toBe(cycles);
    expect(totalDisconnections).toBe(cycles);
    expect(server.getClientCount()).toBe(0);
    // All sessions should have been created
    expect(server.getSessionCount()).toBe(cycles);
  });

  // --------------------------------------------------------------------------
  // 9. Multiple clients sustained operation
  // --------------------------------------------------------------------------

  it('should handle multiple clients over sustained period', async () => {
    const port = nextPort();
    server = new InstallServer({ port, heartbeatIntervalMs: 200, requireAuth: false });

    let totalMessages = 0;
    server.on('message', () => {
      totalMessages++;
    });

    await server.start();

    const clientCount = 5;
    const clients: WebSocket[] = [];
    for (let i = 0; i < clientCount; i++) {
      const ws = await connectRawClient(port);
      clients.push(ws);
      rawClients.push(ws);
    }

    await waitFor(() => server!.getClientCount() === clientCount);

    // Each client sends messages in rounds
    const rounds = 3;
    const messagesPerRound = 10;

    for (let round = 0; round < rounds; round++) {
      for (const ws of clients) {
        for (let i = 0; i < messagesPerRound; i++) {
          const msg = createMessage(MessageType.STEP_OUTPUT, {
            stepId: `round${round}-step-${i}`,
            output: `Round ${round}, message ${i}`,
          });
          ws.send(JSON.stringify(msg));
        }
      }
      await delay(200);
    }

    const expectedTotal = clientCount * rounds * messagesPerRound;
    await waitFor(() => totalMessages >= expectedTotal, 15000);

    expect(totalMessages).toBe(expectedTotal);

    // All clients should still be connected
    expect(server.getClientCount()).toBe(clientCount);
    for (const ws of clients) {
      expect(ws.readyState).toBe(WebSocket.OPEN);
    }
  });

  // --------------------------------------------------------------------------
  // 10. Broadcast reliability over time
  // --------------------------------------------------------------------------

  it('should reliably broadcast over time without message loss', async () => {
    const port = nextPort();
    server = new InstallServer({ port, heartbeatIntervalMs: 60000, requireAuth: false });
    await server.start();

    const clientCount = 5;
    const clients: WebSocket[] = [];
    for (let i = 0; i < clientCount; i++) {
      const ws = await connectRawClient(port);
      clients.push(ws);
      rawClients.push(ws);
    }

    await waitFor(() => server!.getClientCount() === clientCount);

    // Send broadcasts in phases with delays
    const phases = 3;
    const broadcastsPerPhase = 5;
    const totalBroadcasts = phases * broadcastsPerPhase;

    // Set up collectors for each client
    const collectors = clients.map((ws) => collectMessages(ws, totalBroadcasts, 15000));

    for (let phase = 0; phase < phases; phase++) {
      for (let i = 0; i < broadcastsPerPhase; i++) {
        const msg = createMessage(MessageType.SESSION_COMPLETE, {
          success: true,
          summary: `Phase ${phase}, broadcast ${i}`,
        });
        server.broadcast(msg);
      }
      // Delay between phases
      await delay(200);
    }

    const allMessages = await Promise.all(collectors);

    // Each client should have received all broadcasts
    for (const msgs of allMessages) {
      expect(msgs.length).toBe(totalBroadcasts);
    }

    // Verify message ordering is preserved per client
    for (const msgs of allMessages) {
      let expectedPhase = 0;
      let expectedIdx = 0;
      for (const raw of msgs) {
        const parsed = JSON.parse(raw);
        expect(parsed.payload.summary).toBe(`Phase ${expectedPhase}, broadcast ${expectedIdx}`);
        expectedIdx++;
        if (expectedIdx >= broadcastsPerPhase) {
          expectedIdx = 0;
          expectedPhase++;
        }
      }
    }
  });

  // --------------------------------------------------------------------------
  // 11. Server stability under continuous session churn
  // --------------------------------------------------------------------------

  it('should remain stable under continuous session churn', async () => {
    const port = nextPort();
    server = new InstallServer({ port, heartbeatIntervalMs: 60000, requireAuth: false });

    server.on('message', (clientId, msg) => {
      routeMessage(server!, clientId, msg);
    });

    await server.start();

    // Rapidly create sessions from different clients
    const sessionCount = 15;
    for (let i = 0; i < sessionCount; i++) {
      const ws = await connectRawClient(port);

      const createMsg = createMessage(MessageType.SESSION_CREATE, {
        software: `churn-app-${i}`,
      });
      ws.send(JSON.stringify(createMsg));
      const response = await waitForMessage(ws);
      const parsed = JSON.parse(response);
      expect(parsed.type).toBe(MessageType.PLAN_RECEIVE);

      ws.close();
      await delay(50);
    }

    // Server should have tracked all sessions
    expect(server.getSessionCount()).toBe(sessionCount);

    // Server should still be healthy
    expect(server.isRunning()).toBe(true);
    expect(server.getClientCount()).toBe(0);

    // New connections should still work
    const ws = await connectRawClient(port);
    rawClients.push(ws);
    await waitFor(() => server!.getClientCount() === 1);
    expect(ws.readyState).toBe(WebSocket.OPEN);
  });
});
