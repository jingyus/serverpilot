/**
 * Performance Validation Tests
 *
 * Validates MVP performance requirements:
 * 1. AI response time < 10s
 * 2. Concurrent connections > 10 without crash
 * 3. Memory usage < 500MB
 *
 * Authentication is disabled (requireAuth: false) to focus on performance testing.
 */

import { describe, it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';
import { createMessage, MessageType } from '@aiinstaller/shared';
import { InstallServer } from '../packages/server/src/api/server.js';
import { routeMessage } from '../packages/server/src/api/handlers.js';
import { ResponseTimeTracker, percentile } from '../packages/server/src/utils/response-time-tracker.js';

// ============================================================================
// Helpers
// ============================================================================

let testPort = 23000;
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

function waitForMessage(ws: WebSocket, timeoutMs = 10000): Promise<string> {
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

async function connectManyClients(port: number, count: number): Promise<WebSocket[]> {
  const promises = Array.from({ length: count }, () => connectRawClient(port));
  return Promise.all(promises);
}

function getMemoryMB(): { heap: number; rss: number } {
  const mem = process.memoryUsage();
  return {
    heap: mem.heapUsed / (1024 * 1024),
    rss: mem.rss / (1024 * 1024),
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('Performance Validation', () => {
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
  // 1. AI response time < 10 seconds
  // --------------------------------------------------------------------------

  describe('AI Response Time', () => {
    it('should respond to session creation within 10 seconds', async () => {
      const port = nextPort();
      server = new InstallServer({ port, heartbeatIntervalMs: 60000, requireAuth: false });

      server.on('message', (clientId, msg) => {
        routeMessage(server!, clientId, msg);
      });

      await server.start();

      const ws = await connectRawClient(port);
      rawClients.push(ws);

      await waitFor(() => server!.getClientCount() === 1);

      // Measure response time for session creation
      const startTime = Date.now();
      const responsePromise = waitForMessage(ws, 10000);

      const msg = createMessage(MessageType.SESSION_CREATE, {
        software: 'openclaw',
      });
      ws.send(JSON.stringify(msg));

      const response = await responsePromise;
      const responseTime = Date.now() - startTime;

      const parsed = JSON.parse(response);
      expect(parsed.type).toBe(MessageType.PLAN_RECEIVE);
      expect(responseTime).toBeLessThan(10000);
    });

    it('should handle error diagnosis within 10 seconds (without AI agent)', async () => {
      const port = nextPort();
      server = new InstallServer({ port, heartbeatIntervalMs: 60000, requireAuth: false });

      server.on('message', (clientId, msg) => {
        routeMessage(server!, clientId, msg);
      });

      await server.start();

      const ws = await connectRawClient(port);
      rawClients.push(ws);

      await waitFor(() => server!.getClientCount() === 1);

      // First create a session
      const createMsg = createMessage(MessageType.SESSION_CREATE, {
        software: 'openclaw',
      });
      ws.send(JSON.stringify(createMsg));
      await waitForMessage(ws);

      // Measure response time for error diagnosis
      const startTime = Date.now();
      const responsePromise = waitForMessage(ws, 10000);

      const errorMsg = createMessage(MessageType.ERROR_OCCURRED, {
        stepId: 'step-1',
        command: 'npm install',
        exitCode: 1,
        stderr: 'command not found: npm',
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

      const response = await responsePromise;
      const responseTime = Date.now() - startTime;

      const parsed = JSON.parse(response);
      expect(parsed.type).toBe(MessageType.FIX_SUGGEST);
      expect(responseTime).toBeLessThan(10000);
    });

    it('should respond to multiple sequential requests each within 10 seconds', async () => {
      const port = nextPort();
      server = new InstallServer({ port, heartbeatIntervalMs: 60000, requireAuth: false });

      server.on('message', (clientId, msg) => {
        routeMessage(server!, clientId, msg);
      });

      await server.start();

      const requestCount = 5;
      const responseTimes: number[] = [];

      for (let i = 0; i < requestCount; i++) {
        const ws = await connectRawClient(port);
        rawClients.push(ws);
        await waitFor(() => server!.getClientCount() >= 1, 3000);

        const startTime = Date.now();
        const responsePromise = waitForMessage(ws, 10000);

        const msg = createMessage(MessageType.SESSION_CREATE, {
          software: `test-app-${i}`,
        });
        ws.send(JSON.stringify(msg));

        await responsePromise;
        responseTimes.push(Date.now() - startTime);

        ws.close();
        await waitFor(() => server!.getClientCount() === 0, 3000);
      }

      // All responses should be under 10 seconds
      for (const time of responseTimes) {
        expect(time).toBeLessThan(10000);
      }

      // Average response time should be reasonable (under 5s)
      const avgTime = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;
      expect(avgTime).toBeLessThan(5000);
    });

    it('should achieve P90 response time < 10 seconds across 20 sequential requests', async () => {
      const port = nextPort();
      server = new InstallServer({ port, heartbeatIntervalMs: 60000, requireAuth: false });

      server.on('message', (clientId, msg) => {
        routeMessage(server!, clientId, msg);
      });

      await server.start();

      const requestCount = 20;
      const responseTimes: number[] = [];

      for (let i = 0; i < requestCount; i++) {
        const ws = await connectRawClient(port);
        rawClients.push(ws);
        await waitFor(() => server!.getClientCount() >= 1, 3000);

        const startTime = Date.now();
        const responsePromise = waitForMessage(ws, 10000);

        const msg = createMessage(MessageType.SESSION_CREATE, {
          software: `p90-test-${i}`,
        });
        ws.send(JSON.stringify(msg));

        await responsePromise;
        responseTimes.push(Date.now() - startTime);

        ws.close();
        await waitFor(() => server!.getClientCount() === 0, 3000);
      }

      // Sort and compute P90
      const sorted = [...responseTimes].sort((a, b) => a - b);
      const p90 = percentile(sorted, 90);

      // P90 must be < 10 seconds
      expect(p90).toBeLessThan(10000);

      // At least 90% of responses must be under 10s
      const under10s = responseTimes.filter((t) => t < 10000).length;
      expect(under10s / requestCount).toBeGreaterThanOrEqual(0.9);
    });

    it('should achieve P90 < 10s for concurrent error diagnosis requests', async () => {
      const port = nextPort();
      server = new InstallServer({ port, heartbeatIntervalMs: 60000, requireAuth: false });

      server.on('message', (clientId, msg) => {
        routeMessage(server!, clientId, msg);
      });

      await server.start();

      const clientCount = 10;
      const responseTimes: number[] = [];

      // First, create sessions for all clients
      const clients: WebSocket[] = [];
      for (let i = 0; i < clientCount; i++) {
        const ws = await connectRawClient(port);
        rawClients.push(ws);
        clients.push(ws);
      }

      await waitFor(() => server!.getClientCount() === clientCount, 5000);

      // Create sessions
      const sessionPromises = clients.map((ws) => waitForMessage(ws, 10000));
      for (let i = 0; i < clientCount; i++) {
        const msg = createMessage(MessageType.SESSION_CREATE, {
          software: `p90-error-${i}`,
        });
        clients[i].send(JSON.stringify(msg));
      }
      await Promise.all(sessionPromises);

      // Now send error diagnosis requests concurrently and measure times
      const errorPromises = clients.map((ws, i) => {
        const startTime = Date.now();
        const responsePromise = waitForMessage(ws, 10000);

        const errorMsg = createMessage(MessageType.ERROR_OCCURRED, {
          stepId: `step-${i}`,
          command: 'npm install',
          exitCode: 1,
          stderr: 'command not found: npm',
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

        return responsePromise.then(() => {
          responseTimes.push(Date.now() - startTime);
        });
      });

      await Promise.all(errorPromises);

      // Compute P90
      const sorted = [...responseTimes].sort((a, b) => a - b);
      const p90 = percentile(sorted, 90);

      // P90 must be < 10 seconds
      expect(p90).toBeLessThan(10000);
      expect(responseTimes.length).toBe(clientCount);
    });

    it('should track response times using ResponseTimeTracker', async () => {
      const tracker = new ResponseTimeTracker();
      const port = nextPort();
      server = new InstallServer({ port, heartbeatIntervalMs: 60000, requireAuth: false });

      server.on('message', (clientId, msg) => {
        routeMessage(server!, clientId, msg);
      });

      await server.start();

      const requestCount = 10;

      for (let i = 0; i < requestCount; i++) {
        const ws = await connectRawClient(port);
        rawClients.push(ws);
        await waitFor(() => server!.getClientCount() >= 1, 3000);

        const endTimer = tracker.startTimer('sessionCreate');
        const responsePromise = waitForMessage(ws, 10000);

        const msg = createMessage(MessageType.SESSION_CREATE, {
          software: `tracker-test-${i}`,
        });
        ws.send(JSON.stringify(msg));

        await responsePromise;
        endTimer();

        ws.close();
        await waitFor(() => server!.getClientCount() === 0, 3000);
      }

      const stats = tracker.getStats();

      expect(stats.count).toBe(requestCount);
      expect(stats.p90).toBeLessThan(10000);
      expect(stats.meetsP90SLA).toBe(true);
      expect(stats.min).toBeGreaterThanOrEqual(0);
      expect(stats.max).toBeGreaterThanOrEqual(0);
    });
  });

  // --------------------------------------------------------------------------
  // 2. Concurrent connections > 10 without crash
  // --------------------------------------------------------------------------

  describe('Concurrent Connections', () => {
    it('should handle 10+ concurrent connections without crashing', async () => {
      const port = nextPort();
      server = new InstallServer({ port, heartbeatIntervalMs: 60000, requireAuth: false });
      await server.start();

      const clientCount = 15;
      const clients = await connectManyClients(port, clientCount);
      rawClients.push(...clients);

      await waitFor(() => server!.getClientCount() === clientCount, 10000);

      // Server should be running with all clients connected
      expect(server.isRunning()).toBe(true);
      expect(server.getClientCount()).toBe(clientCount);

      // All clients should be in OPEN state
      for (const ws of clients) {
        expect(ws.readyState).toBe(WebSocket.OPEN);
      }
    });

    it('should handle concurrent session creation from 10+ clients', async () => {
      const port = nextPort();
      server = new InstallServer({ port, heartbeatIntervalMs: 60000, requireAuth: false });

      server.on('message', (clientId, msg) => {
        routeMessage(server!, clientId, msg);
      });

      await server.start();

      const clientCount = 15;
      const clients = await connectManyClients(port, clientCount);
      rawClients.push(...clients);

      await waitFor(() => server!.getClientCount() === clientCount, 10000);

      // All clients create sessions simultaneously
      const responsePromises = clients.map((ws) => waitForMessage(ws, 10000));
      for (let i = 0; i < clientCount; i++) {
        const msg = createMessage(MessageType.SESSION_CREATE, {
          software: `concurrent-app-${i}`,
        });
        clients[i].send(JSON.stringify(msg));
      }

      const responses = await Promise.all(responsePromises);

      // All responses should be valid
      expect(responses.length).toBe(clientCount);
      for (const r of responses) {
        const parsed = JSON.parse(r);
        expect(parsed.type).toBe(MessageType.PLAN_RECEIVE);
      }

      // Server should still be stable
      expect(server.isRunning()).toBe(true);
      expect(server.getSessionCount()).toBe(clientCount);
    });

    it('should handle concurrent message sending from 10+ clients', async () => {
      const port = nextPort();
      server = new InstallServer({ port, heartbeatIntervalMs: 60000, requireAuth: false });

      let totalReceived = 0;
      server.on('message', () => {
        totalReceived++;
      });

      await server.start();

      const clientCount = 15;
      const messagesPerClient = 10;
      const clients = await connectManyClients(port, clientCount);
      rawClients.push(...clients);

      await waitFor(() => server!.getClientCount() === clientCount, 10000);

      // All clients send messages concurrently
      for (const ws of clients) {
        for (let i = 0; i < messagesPerClient; i++) {
          const msg = createMessage(MessageType.STEP_OUTPUT, {
            stepId: `step-${i}`,
            output: `Test output ${i}`,
          });
          ws.send(JSON.stringify(msg));
        }
      }

      const totalExpected = clientCount * messagesPerClient;
      await waitFor(() => totalReceived >= totalExpected, 15000);

      expect(totalReceived).toBe(totalExpected);
      expect(server.isRunning()).toBe(true);
    });

    it('should handle 20 concurrent connections with session lifecycle', async () => {
      const port = nextPort();
      server = new InstallServer({ port, heartbeatIntervalMs: 60000, requireAuth: false });

      server.on('message', (clientId, msg) => {
        routeMessage(server!, clientId, msg);
      });

      await server.start();

      const clientCount = 20;
      const clients = await connectManyClients(port, clientCount);
      rawClients.push(...clients);

      await waitFor(() => server!.getClientCount() === clientCount, 10000);

      // Create sessions for all clients
      const responsePromises = clients.map((ws) => waitForMessage(ws, 10000));
      for (let i = 0; i < clientCount; i++) {
        const msg = createMessage(MessageType.SESSION_CREATE, {
          software: `app-${i}`,
        });
        clients[i].send(JSON.stringify(msg));
      }

      const responses = await Promise.all(responsePromises);
      expect(responses.length).toBe(clientCount);

      // Disconnect half the clients
      for (let i = 0; i < 10; i++) {
        clients[i].close();
      }

      await waitFor(() => server!.getClientCount() === 10, 5000);

      // Remaining clients should still work
      expect(server.isRunning()).toBe(true);
      expect(server.getClientCount()).toBe(10);

      // Remaining clients can still send messages
      for (let i = 10; i < clientCount; i++) {
        expect(clients[i].readyState).toBe(WebSocket.OPEN);
      }
    });
  });

  // --------------------------------------------------------------------------
  // 3. Memory usage < 500MB
  // --------------------------------------------------------------------------

  describe('Memory Usage', () => {
    it('should keep memory below 500MB during normal operations', async () => {
      const port = nextPort();
      server = new InstallServer({ port, heartbeatIntervalMs: 60000, requireAuth: false });

      server.on('message', (clientId, msg) => {
        routeMessage(server!, clientId, msg);
      });

      await server.start();

      // Perform various operations and track memory
      const memorySnapshots: number[] = [];

      // Initial snapshot
      memorySnapshots.push(getMemoryMB().rss);

      // Connect 10 clients, create sessions, send messages
      const clientCount = 10;
      for (let round = 0; round < 3; round++) {
        const clients: WebSocket[] = [];
        for (let i = 0; i < clientCount; i++) {
          const ws = await connectRawClient(port);
          clients.push(ws);
        }
        await waitFor(() => server!.getClientCount() === clientCount, 5000);

        // Create sessions
        const responsePromises = clients.map((ws) => waitForMessage(ws, 10000));
        for (let i = 0; i < clientCount; i++) {
          const msg = createMessage(MessageType.SESSION_CREATE, {
            software: `mem-test-r${round}-c${i}`,
          });
          clients[i].send(JSON.stringify(msg));
        }
        await Promise.all(responsePromises);

        // Send messages
        for (const ws of clients) {
          for (let m = 0; m < 20; m++) {
            const msg = createMessage(MessageType.STEP_OUTPUT, {
              stepId: `step-${m}`,
              output: `Output data ${m} - ${'x'.repeat(200)}`,
            });
            ws.send(JSON.stringify(msg));
          }
        }

        await delay(200);

        // Disconnect all
        for (const ws of clients) {
          ws.close();
        }
        await waitFor(() => server!.getClientCount() === 0, 5000);

        // Take memory snapshot after each round
        memorySnapshots.push(getMemoryMB().rss);
      }

      // All memory snapshots should be well under 500MB
      for (const mem of memorySnapshots) {
        expect(mem).toBeLessThan(500);
      }
    });

    it('should keep memory below 500MB under sustained concurrent load', async () => {
      const port = nextPort();
      server = new InstallServer({ port, heartbeatIntervalMs: 60000, requireAuth: false });

      let totalMessages = 0;
      server.on('message', () => {
        totalMessages++;
      });

      await server.start();

      // Connect 15 clients and keep them sending for a while
      const clientCount = 15;
      const clients = await connectManyClients(port, clientCount);
      rawClients.push(...clients);

      await waitFor(() => server!.getClientCount() === clientCount, 10000);

      // Send many messages from all clients
      const batchCount = 5;
      const messagesPerBatch = 20;

      for (let batch = 0; batch < batchCount; batch++) {
        for (const ws of clients) {
          for (let m = 0; m < messagesPerBatch; m++) {
            const msg = createMessage(MessageType.STEP_OUTPUT, {
              stepId: `batch-${batch}-step-${m}`,
              output: `Sustained load test - ${'data'.repeat(50)}`,
            });
            ws.send(JSON.stringify(msg));
          }
        }
        await delay(100);
      }

      const expectedTotal = clientCount * batchCount * messagesPerBatch;
      await waitFor(() => totalMessages >= expectedTotal, 15000);

      // Check memory
      const mem = getMemoryMB();
      expect(mem.rss).toBeLessThan(500);
      expect(totalMessages).toBe(expectedTotal);
    });

    it('should keep heap growth bounded after many operations', async () => {
      const port = nextPort();
      server = new InstallServer({ port, heartbeatIntervalMs: 60000, requireAuth: false });

      server.on('message', (clientId, msg) => {
        routeMessage(server!, clientId, msg);
      });

      await server.start();

      const baselineMem = getMemoryMB();

      // Run 50 connect/session/disconnect cycles
      for (let i = 0; i < 50; i++) {
        const ws = await connectRawClient(port);
        await waitFor(() => server!.getClientCount() >= 1, 3000);

        const msg = createMessage(MessageType.SESSION_CREATE, {
          software: `heap-test-${i}`,
        });
        ws.send(JSON.stringify(msg));
        await waitForMessage(ws);

        // Send some step output
        for (let j = 0; j < 5; j++) {
          const stepMsg = createMessage(MessageType.STEP_OUTPUT, {
            stepId: `step-${j}`,
            output: `Heap test iteration ${i}, step ${j}`,
          });
          ws.send(JSON.stringify(stepMsg));
        }

        await delay(20);
        ws.close();
        await waitFor(() => server!.getClientCount() === 0, 3000);
      }

      const finalMem = getMemoryMB();

      // RSS should stay under 500MB
      expect(finalMem.rss).toBeLessThan(500);

      // Heap growth should be reasonable (< 100MB for 50 cycles)
      const heapGrowth = finalMem.heap - baselineMem.heap;
      expect(heapGrowth).toBeLessThan(100);
    });
  });

  // --------------------------------------------------------------------------
  // 4. Combined performance scenario
  // --------------------------------------------------------------------------

  describe('Combined Performance', () => {
    it('should meet all performance criteria in a realistic scenario', async () => {
      const port = nextPort();
      server = new InstallServer({ port, heartbeatIntervalMs: 60000, requireAuth: false });

      server.on('message', (clientId, msg) => {
        routeMessage(server!, clientId, msg);
      });

      await server.start();

      // Track metrics
      const responseTimes: number[] = [];
      const memorySnapshots: number[] = [];

      // Phase 1: Connect 15 clients simultaneously
      const clientCount = 15;
      const clients = await connectManyClients(port, clientCount);
      rawClients.push(...clients);

      await waitFor(() => server!.getClientCount() === clientCount, 10000);
      expect(server.getClientCount()).toBe(clientCount);

      memorySnapshots.push(getMemoryMB().rss);

      // Phase 2: All clients create sessions and measure response time
      for (let i = 0; i < clientCount; i++) {
        const startTime = Date.now();
        const responsePromise = waitForMessage(clients[i], 10000);

        const msg = createMessage(MessageType.SESSION_CREATE, {
          software: `combined-app-${i}`,
        });
        clients[i].send(JSON.stringify(msg));

        await responsePromise;
        responseTimes.push(Date.now() - startTime);
      }

      memorySnapshots.push(getMemoryMB().rss);

      // Phase 3: Concurrent message sending
      for (const ws of clients) {
        for (let m = 0; m < 10; m++) {
          const msg = createMessage(MessageType.STEP_OUTPUT, {
            stepId: `combined-step-${m}`,
            output: `Combined test output ${m}`,
          });
          ws.send(JSON.stringify(msg));
        }
      }

      await delay(500);
      memorySnapshots.push(getMemoryMB().rss);

      // Validate all performance criteria
      // 1. All response times < 10s
      for (const time of responseTimes) {
        expect(time).toBeLessThan(10000);
      }

      // 2. Server handles 10+ concurrent connections
      expect(server.getClientCount()).toBe(clientCount);
      expect(server.isRunning()).toBe(true);

      // 3. Memory < 500MB
      for (const mem of memorySnapshots) {
        expect(mem).toBeLessThan(500);
      }
    });
  });
});
