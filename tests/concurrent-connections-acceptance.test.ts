/**
 * Acceptance Test: Support 10+ Concurrent Connections
 *
 * Validates that the server can handle 10+ concurrent WebSocket connections:
 * 1. 10+ clients connect simultaneously and remain stable
 * 2. All connected clients can create sessions concurrently
 * 3. All connected clients can exchange messages concurrently
 * 4. Server enforces maxConnections limit
 * 5. Server remains stable after partial disconnect and reconnect
 * 6. Connection lifecycle works correctly under concurrent load
 */

import { describe, it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';
import { createMessage, MessageType } from '@aiinstaller/shared';
import { InstallServer } from '../packages/server/src/api/server.js';
import { routeMessage } from '../packages/server/src/api/handlers.js';

// ============================================================================
// Helpers
// ============================================================================

let testPort = 24000;
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

async function connectManyClients(port: number, count: number): Promise<WebSocket[]> {
  const promises = Array.from({ length: count }, () => connectRawClient(port));
  return Promise.all(promises);
}

// ============================================================================
// Tests
// ============================================================================

describe('Acceptance: Support 10+ Concurrent Connections', () => {
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
  // 1. Basic: 10+ concurrent connections
  // --------------------------------------------------------------------------

  it('should accept and maintain 10 simultaneous connections', async () => {
    const port = nextPort();
    server = new InstallServer({ port, heartbeatIntervalMs: 60000, requireAuth: false });
    await server.start();

    const clientCount = 10;
    const clients = await connectManyClients(port, clientCount);
    rawClients.push(...clients);

    await waitFor(() => server!.getClientCount() === clientCount);

    expect(server.isRunning()).toBe(true);
    expect(server.getClientCount()).toBe(clientCount);

    for (const ws of clients) {
      expect(ws.readyState).toBe(WebSocket.OPEN);
    }
  });

  it('should accept and maintain 15 simultaneous connections', async () => {
    const port = nextPort();
    server = new InstallServer({ port, heartbeatIntervalMs: 60000, requireAuth: false });
    await server.start();

    const clientCount = 15;
    const clients = await connectManyClients(port, clientCount);
    rawClients.push(...clients);

    await waitFor(() => server!.getClientCount() === clientCount, 10000);

    expect(server.isRunning()).toBe(true);
    expect(server.getClientCount()).toBe(clientCount);

    for (const ws of clients) {
      expect(ws.readyState).toBe(WebSocket.OPEN);
    }
  });

  it('should accept and maintain 25 simultaneous connections', async () => {
    const port = nextPort();
    server = new InstallServer({ port, heartbeatIntervalMs: 60000, requireAuth: false });
    await server.start();

    const clientCount = 25;
    const clients = await connectManyClients(port, clientCount);
    rawClients.push(...clients);

    await waitFor(() => server!.getClientCount() === clientCount, 10000);

    expect(server.isRunning()).toBe(true);
    expect(server.getClientCount()).toBe(clientCount);
  });

  // --------------------------------------------------------------------------
  // 2. Concurrent session creation from 10+ clients
  // --------------------------------------------------------------------------

  it('should handle concurrent session creation from 12 clients', async () => {
    const port = nextPort();
    server = new InstallServer({ port, heartbeatIntervalMs: 60000, requireAuth: false });

    server.on('message', (clientId, msg) => {
      routeMessage(server!, clientId, msg);
    });

    await server.start();

    const clientCount = 12;
    const clients = await connectManyClients(port, clientCount);
    rawClients.push(...clients);

    await waitFor(() => server!.getClientCount() === clientCount);

    // All clients create sessions simultaneously
    const responsePromises = clients.map((ws) => waitForMessage(ws, 10000));
    for (let i = 0; i < clientCount; i++) {
      const msg = createMessage(MessageType.SESSION_CREATE, {
        software: `app-${i}`,
      });
      clients[i].send(JSON.stringify(msg));
    }

    const responses = await Promise.all(responsePromises);

    expect(responses.length).toBe(clientCount);
    for (const r of responses) {
      const parsed = JSON.parse(r);
      expect(parsed.type).toBe(MessageType.PLAN_RECEIVE);
    }

    expect(server.getSessionCount()).toBe(clientCount);
    expect(server.isRunning()).toBe(true);
  });

  // --------------------------------------------------------------------------
  // 3. Concurrent messaging from 10+ clients
  // --------------------------------------------------------------------------

  it('should handle concurrent messaging from 12 clients', async () => {
    const port = nextPort();
    server = new InstallServer({ port, heartbeatIntervalMs: 60000, requireAuth: false });

    let totalReceived = 0;
    server.on('message', () => {
      totalReceived++;
    });

    await server.start();

    const clientCount = 12;
    const messagesPerClient = 10;
    const clients = await connectManyClients(port, clientCount);
    rawClients.push(...clients);

    await waitFor(() => server!.getClientCount() === clientCount);

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

  // --------------------------------------------------------------------------
  // 4. maxConnections enforcement
  // --------------------------------------------------------------------------

  it('should enforce maxConnections limit', async () => {
    const port = nextPort();
    const maxConnections = 5;
    server = new InstallServer({
      port,
      heartbeatIntervalMs: 60000,
      requireAuth: false,
      maxConnections,
    });
    await server.start();

    expect(server.getMaxConnections()).toBe(maxConnections);

    // Connect up to the limit
    const clients = await connectManyClients(port, maxConnections);
    rawClients.push(...clients);

    await waitFor(() => server!.getClientCount() === maxConnections);
    expect(server.getClientCount()).toBe(maxConnections);

    // Try to connect one more - should be rejected
    const extraWs = new WebSocket(`ws://127.0.0.1:${port}`);
    rawClients.push(extraWs);

    const closePromise = new Promise<number>((resolve) => {
      extraWs.on('close', (code) => resolve(code));
    });

    const closeCode = await closePromise;
    expect(closeCode).toBe(1013); // "Try Again Later"

    // Server should still have exactly maxConnections
    expect(server.getClientCount()).toBe(maxConnections);
  });

  it('should accept new connections after others disconnect (within maxConnections)', async () => {
    const port = nextPort();
    const maxConnections = 5;
    server = new InstallServer({
      port,
      heartbeatIntervalMs: 60000,
      requireAuth: false,
      maxConnections,
    });
    await server.start();

    // Fill up connections
    const clients = await connectManyClients(port, maxConnections);
    rawClients.push(...clients);

    await waitFor(() => server!.getClientCount() === maxConnections);

    // Disconnect 2 clients
    clients[0].close();
    clients[1].close();

    await waitFor(() => server!.getClientCount() === maxConnections - 2);

    // Should now be able to connect 2 more
    const newClients = await connectManyClients(port, 2);
    rawClients.push(...newClients);

    await waitFor(() => server!.getClientCount() === maxConnections);
    expect(server.getClientCount()).toBe(maxConnections);

    for (const ws of newClients) {
      expect(ws.readyState).toBe(WebSocket.OPEN);
    }
  });

  it('should default maxConnections to 100', async () => {
    const port = nextPort();
    server = new InstallServer({ port, heartbeatIntervalMs: 60000, requireAuth: false });
    await server.start();

    expect(server.getMaxConnections()).toBe(100);
  });

  // --------------------------------------------------------------------------
  // 5. Stability after partial disconnect and reconnect
  // --------------------------------------------------------------------------

  it('should remain stable after disconnect/reconnect cycles with 10+ clients', async () => {
    const port = nextPort();
    server = new InstallServer({ port, heartbeatIntervalMs: 60000, requireAuth: false });

    server.on('message', (clientId, msg) => {
      routeMessage(server!, clientId, msg);
    });

    await server.start();

    // Phase 1: Connect 15 clients
    const clients = await connectManyClients(port, 15);
    rawClients.push(...clients);
    await waitFor(() => server!.getClientCount() === 15, 10000);

    // Phase 2: Disconnect first 5
    for (let i = 0; i < 5; i++) {
      clients[i].close();
    }
    await waitFor(() => server!.getClientCount() === 10, 5000);

    // Phase 3: Remaining 10 should still be functional - create sessions
    const activeClients = clients.slice(5);
    const responsePromises = activeClients.map((ws) => waitForMessage(ws, 10000));
    for (let i = 0; i < activeClients.length; i++) {
      const msg = createMessage(MessageType.SESSION_CREATE, {
        software: `stable-app-${i}`,
      });
      activeClients[i].send(JSON.stringify(msg));
    }

    const responses = await Promise.all(responsePromises);
    expect(responses.length).toBe(10);

    for (const r of responses) {
      const parsed = JSON.parse(r);
      expect(parsed.type).toBe(MessageType.PLAN_RECEIVE);
    }

    // Phase 4: Connect 5 more
    const newClients = await connectManyClients(port, 5);
    rawClients.push(...newClients);
    await waitFor(() => server!.getClientCount() === 15, 5000);

    expect(server.isRunning()).toBe(true);
    expect(server.getClientCount()).toBe(15);
  });

  // --------------------------------------------------------------------------
  // 6. Error diagnosis with 10+ concurrent clients
  // --------------------------------------------------------------------------

  it('should handle concurrent error diagnosis from 10+ clients', async () => {
    const port = nextPort();
    server = new InstallServer({ port, heartbeatIntervalMs: 60000, requireAuth: false });

    server.on('message', (clientId, msg) => {
      routeMessage(server!, clientId, msg);
    });

    await server.start();

    const clientCount = 12;
    const clients = await connectManyClients(port, clientCount);
    rawClients.push(...clients);

    await waitFor(() => server!.getClientCount() === clientCount);

    // Create sessions first
    const sessionPromises = clients.map((ws) => waitForMessage(ws, 10000));
    for (let i = 0; i < clientCount; i++) {
      const msg = createMessage(MessageType.SESSION_CREATE, {
        software: `error-test-${i}`,
      });
      clients[i].send(JSON.stringify(msg));
    }
    await Promise.all(sessionPromises);

    // All clients send error reports concurrently
    const errorPromises = clients.map((ws) => waitForMessage(ws, 10000));
    for (let i = 0; i < clientCount; i++) {
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
      clients[i].send(JSON.stringify(errorMsg));
    }

    const errorResponses = await Promise.all(errorPromises);

    expect(errorResponses.length).toBe(clientCount);
    for (const r of errorResponses) {
      const parsed = JSON.parse(r);
      expect(parsed.type).toBe(MessageType.FIX_SUGGEST);
    }

    expect(server.isRunning()).toBe(true);
  });

  // --------------------------------------------------------------------------
  // 7. Connection timing and performance
  // --------------------------------------------------------------------------

  it('should connect 10+ clients within 2 seconds', async () => {
    const port = nextPort();
    server = new InstallServer({ port, heartbeatIntervalMs: 60000, requireAuth: false });
    await server.start();

    const clientCount = 15;
    const startTime = Date.now();
    const clients = await connectManyClients(port, clientCount);
    const connectDuration = Date.now() - startTime;
    rawClients.push(...clients);

    await waitFor(() => server!.getClientCount() === clientCount, 10000);

    expect(connectDuration).toBeLessThan(2000);
    expect(server.getClientCount()).toBe(clientCount);
  });
});
