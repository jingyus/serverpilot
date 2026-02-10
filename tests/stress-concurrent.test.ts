/**
 * Stress Test: Concurrent Connections
 *
 * Tests server behavior under concurrent connection load:
 * 1. Multiple simultaneous connections
 * 2. Concurrent message sending from many clients
 * 3. Broadcast under load
 * 4. Concurrent session creation
 * 5. Rapid connect/disconnect cycles
 * 6. Heartbeat with many clients
 * 7. Connection surge handling
 */

import { describe, it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';
import { createMessage, MessageType } from '@aiinstaller/shared';
import { InstallServer } from '../packages/server/src/api/server.js';
import { routeMessage } from '../packages/server/src/api/handlers.js';

// ============================================================================
// Helpers
// ============================================================================

// Use random ports in a high range to avoid collisions with other tests
let testPort = 20000 + Math.floor(Math.random() * 10000);
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

/**
 * Connect N raw WebSocket clients concurrently.
 */
async function connectManyClients(port: number, count: number): Promise<WebSocket[]> {
  const promises = Array.from({ length: count }, () => connectRawClient(port));
  return Promise.all(promises);
}

// ============================================================================
// Tests
// ============================================================================

describe('Stress Test: Concurrent Connections', () => {
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
  // 1. Multiple simultaneous connections
  // --------------------------------------------------------------------------

  it('should handle 20 simultaneous connections', async () => {
    const port = nextPort();
    server = new InstallServer({ port, heartbeatIntervalMs: 60000 });
    await server.start();

    const clientCount = 20;
    const clients = await connectManyClients(port, clientCount);
    rawClients.push(...clients);

    await waitFor(() => server!.getClientCount() === clientCount);

    expect(server.getClientCount()).toBe(clientCount);

    // All clients should be in OPEN state
    for (const ws of clients) {
      expect(ws.readyState).toBe(WebSocket.OPEN);
    }
  });

  it('should handle 50 simultaneous connections', async () => {
    const port = nextPort();
    server = new InstallServer({ port, heartbeatIntervalMs: 60000 });
    await server.start();

    const clientCount = 50;
    const clients = await connectManyClients(port, clientCount);
    rawClients.push(...clients);

    await waitFor(() => server!.getClientCount() === clientCount, 10000);

    expect(server.getClientCount()).toBe(clientCount);
  });

  // --------------------------------------------------------------------------
  // 2. Concurrent message sending from many clients
  // --------------------------------------------------------------------------

  it('should handle concurrent messages from multiple clients', async () => {
    const port = nextPort();
    server = new InstallServer({ port, heartbeatIntervalMs: 60000, requireAuth: false });

    const receivedMessages: { clientId: string; type: string }[] = [];

    server.on('message', (clientId, msg) => {
      receivedMessages.push({ clientId, type: msg.type });
      routeMessage(server!, clientId, msg);
    });

    await server.start();

    const clientCount = 10;
    const clients = await connectManyClients(port, clientCount);
    rawClients.push(...clients);

    await waitFor(() => server!.getClientCount() === clientCount);

    // Each client sends a SESSION_CREATE message simultaneously
    const responsePromises = clients.map((ws) => waitForMessage(ws));
    for (const ws of clients) {
      const msg = createMessage(MessageType.SESSION_CREATE, { software: 'openclaw' });
      ws.send(JSON.stringify(msg));
    }

    // All clients should receive responses
    const responses = await Promise.all(responsePromises);
    expect(responses.length).toBe(clientCount);

    // All responses should be PLAN_RECEIVE
    for (const r of responses) {
      const parsed = JSON.parse(r);
      expect(parsed.type).toBe(MessageType.PLAN_RECEIVE);
    }

    // Server should have received all messages
    await waitFor(() => receivedMessages.length >= clientCount);
    expect(receivedMessages.length).toBe(clientCount);
  });

  it('should handle rapid fire messages from a single client', async () => {
    const port = nextPort();
    server = new InstallServer({ port, heartbeatIntervalMs: 60000 });

    const receivedMessages: string[] = [];

    server.on('message', (_clientId, msg) => {
      receivedMessages.push(msg.type);
    });

    await server.start();

    const ws = await connectRawClient(port);
    rawClients.push(ws);

    await waitFor(() => server!.getClientCount() === 1);

    // Send 100 messages rapidly
    const messageCount = 100;
    for (let i = 0; i < messageCount; i++) {
      const msg = createMessage(MessageType.STEP_OUTPUT, {
        stepId: `step-${i}`,
        output: `Output line ${i}`,
      });
      ws.send(JSON.stringify(msg));
    }

    await waitFor(() => receivedMessages.length >= messageCount, 10000);

    expect(receivedMessages.length).toBe(messageCount);
    // All should be STEP_OUTPUT type
    expect(receivedMessages.every((t) => t === MessageType.STEP_OUTPUT)).toBe(true);
  });

  // --------------------------------------------------------------------------
  // 3. Broadcast under load
  // --------------------------------------------------------------------------

  it('should broadcast to all clients under load', async () => {
    const port = nextPort();
    server = new InstallServer({ port, heartbeatIntervalMs: 60000 });
    await server.start();

    const clientCount = 15;
    const clients = await connectManyClients(port, clientCount);
    rawClients.push(...clients);

    await waitFor(() => server!.getClientCount() === clientCount);

    // Set up message collectors for each client
    const messagePromises = clients.map((ws) => waitForMessage(ws));

    // Broadcast a message
    const broadcastMsg = createMessage(MessageType.SESSION_COMPLETE, {
      success: true,
      summary: 'Broadcast under load test',
    });
    server.broadcast(broadcastMsg);

    // All clients should receive the broadcast
    const messages = await Promise.all(messagePromises);

    expect(messages.length).toBe(clientCount);
    for (const raw of messages) {
      const parsed = JSON.parse(raw);
      expect(parsed.type).toBe(MessageType.SESSION_COMPLETE);
      expect(parsed.payload.summary).toBe('Broadcast under load test');
    }
  });

  it('should handle multiple rapid broadcasts', async () => {
    const port = nextPort();
    server = new InstallServer({ port, heartbeatIntervalMs: 60000 });
    await server.start();

    const clientCount = 5;
    const broadcastCount = 10;

    const clients = await connectManyClients(port, clientCount);
    rawClients.push(...clients);

    await waitFor(() => server!.getClientCount() === clientCount);

    // Collect messages from each client
    const collectors = clients.map((ws) => collectMessages(ws, broadcastCount));

    // Send multiple broadcasts rapidly
    for (let i = 0; i < broadcastCount; i++) {
      const msg = createMessage(MessageType.SESSION_COMPLETE, {
        success: true,
        summary: `Broadcast #${i}`,
      });
      server.broadcast(msg);
    }

    const allMessages = await Promise.all(collectors);

    // Each client should have received all broadcasts
    for (const msgs of allMessages) {
      expect(msgs.length).toBe(broadcastCount);
      for (let i = 0; i < broadcastCount; i++) {
        const parsed = JSON.parse(msgs[i]);
        expect(parsed.type).toBe(MessageType.SESSION_COMPLETE);
        expect(parsed.payload.summary).toBe(`Broadcast #${i}`);
      }
    }
  });

  // --------------------------------------------------------------------------
  // 4. Concurrent session creation
  // --------------------------------------------------------------------------

  it('should handle concurrent session creation', async () => {
    const port = nextPort();
    server = new InstallServer({ port, heartbeatIntervalMs: 60000, requireAuth: false });

    server.on('message', (clientId, msg) => {
      routeMessage(server!, clientId, msg);
    });

    await server.start();

    const clientCount = 10;
    const clients = await connectManyClients(port, clientCount);
    rawClients.push(...clients);

    await waitFor(() => server!.getClientCount() === clientCount);

    // All clients create sessions simultaneously
    const responsePromises = clients.map((ws) => waitForMessage(ws));
    for (let i = 0; i < clientCount; i++) {
      const msg = createMessage(MessageType.SESSION_CREATE, {
        software: `test-app-${i}`,
      });
      clients[i].send(JSON.stringify(msg));
    }

    const responses = await Promise.all(responsePromises);

    // All sessions should be created
    expect(server.getSessionCount()).toBe(clientCount);

    // All responses should be valid
    for (const r of responses) {
      const parsed = JSON.parse(r);
      expect(parsed.type).toBe(MessageType.PLAN_RECEIVE);
    }
  });

  // --------------------------------------------------------------------------
  // 5. Rapid connect/disconnect cycles
  // --------------------------------------------------------------------------

  it('should handle rapid connect/disconnect cycles', async () => {
    const port = nextPort();
    server = new InstallServer({ port, heartbeatIntervalMs: 60000 });

    let totalConnections = 0;
    let totalDisconnections = 0;

    server.on('connection', () => {
      totalConnections++;
    });
    server.on('disconnect', () => {
      totalDisconnections++;
    });

    await server.start();

    const cycles = 10;
    for (let i = 0; i < cycles; i++) {
      const ws = await connectRawClient(port);
      await waitFor(() => server!.getClientCount() >= 1, 2000);
      ws.close();
      await waitFor(() => server!.getClientCount() === 0, 2000);
    }

    expect(totalConnections).toBe(cycles);
    expect(totalDisconnections).toBe(cycles);
    expect(server.getClientCount()).toBe(0);
  });

  it('should handle overlapping connect/disconnect', async () => {
    const port = nextPort();
    server = new InstallServer({ port, heartbeatIntervalMs: 60000 });

    const connectedIds: string[] = [];
    const disconnectedIds: string[] = [];

    server.on('connection', (id) => connectedIds.push(id));
    server.on('disconnect', (id) => disconnectedIds.push(id));

    await server.start();

    // Connect 5 clients
    const clients = await connectManyClients(port, 5);
    rawClients.push(...clients);

    await waitFor(() => server!.getClientCount() === 5);

    // Disconnect 3, connect 3 more simultaneously
    const disconnectPromises = clients.slice(0, 3).map((ws) => {
      return new Promise<void>((resolve) => {
        ws.on('close', () => resolve());
        ws.close();
      });
    });

    const newClients = connectManyClients(port, 3);

    const [, newConnected] = await Promise.all([
      Promise.all(disconnectPromises),
      newClients,
    ]);

    rawClients.push(...newConnected);

    // Wait for server to stabilize: 5 - 3 + 3 = 5
    await waitFor(() => server!.getClientCount() === 5, 5000);

    expect(connectedIds.length).toBe(8); // 5 + 3
    expect(disconnectedIds.length).toBe(3);
    expect(server.getClientCount()).toBe(5);
  });

  // --------------------------------------------------------------------------
  // 6. Heartbeat with many clients
  // --------------------------------------------------------------------------

  it('should maintain heartbeat with many concurrent clients', async () => {
    const port = nextPort();
    server = new InstallServer({
      port,
      heartbeatIntervalMs: 300, // Fast heartbeat for testing
    });

    await server.start();

    const clientCount = 10;
    const clients = await connectManyClients(port, clientCount);
    rawClients.push(...clients);

    await waitFor(() => server!.getClientCount() === clientCount);

    // Wait for multiple heartbeat cycles
    await delay(1000);

    // All clients should still be alive (ws library auto-responds to pings)
    expect(server.getClientCount()).toBe(clientCount);

    for (const ws of clients) {
      expect(ws.readyState).toBe(WebSocket.OPEN);
    }
  });

  // --------------------------------------------------------------------------
  // 7. Connection surge handling
  // --------------------------------------------------------------------------

  it('should handle a sudden surge of connections', async () => {
    const port = nextPort();
    server = new InstallServer({ port, heartbeatIntervalMs: 60000 });
    await server.start();

    // Connect 30 clients as fast as possible
    const surgeCount = 30;
    const startTime = Date.now();
    const clients = await connectManyClients(port, surgeCount);
    const connectDuration = Date.now() - startTime;
    rawClients.push(...clients);

    await waitFor(() => server!.getClientCount() === surgeCount, 10000);

    expect(server.getClientCount()).toBe(surgeCount);

    // All connections should complete in a reasonable time (< 5s)
    expect(connectDuration).toBeLessThan(5000);
  });

  // --------------------------------------------------------------------------
  // 8. Message throughput under concurrent load
  // --------------------------------------------------------------------------

  it('should handle high message throughput from concurrent clients', async () => {
    const port = nextPort();
    server = new InstallServer({ port, heartbeatIntervalMs: 60000 });

    let totalReceived = 0;

    server.on('message', () => {
      totalReceived++;
    });

    await server.start();

    const clientCount = 5;
    const messagesPerClient = 20;
    const totalExpected = clientCount * messagesPerClient;

    const clients = await connectManyClients(port, clientCount);
    rawClients.push(...clients);

    await waitFor(() => server!.getClientCount() === clientCount);

    // Each client sends messages concurrently
    for (const ws of clients) {
      for (let i = 0; i < messagesPerClient; i++) {
        const msg = createMessage(MessageType.STEP_OUTPUT, {
          stepId: `step-${i}`,
          output: `Output ${i}`,
        });
        ws.send(JSON.stringify(msg));
      }
    }

    await waitFor(() => totalReceived >= totalExpected, 10000);

    expect(totalReceived).toBe(totalExpected);
  });

  // --------------------------------------------------------------------------
  // 9. Client disconnection during active communication
  // --------------------------------------------------------------------------

  it('should handle client disconnection during message exchange', async () => {
    const port = nextPort();
    server = new InstallServer({ port, heartbeatIntervalMs: 60000, requireAuth: false });

    const receivedMessages: string[] = [];
    const errors: string[] = [];

    server.on('message', (clientId, msg) => {
      receivedMessages.push(msg.type);
      routeMessage(server!, clientId, msg);
    });

    server.on('error', (_clientId, err) => {
      errors.push(err.message);
    });

    await server.start();

    const clientCount = 5;
    const clients = await connectManyClients(port, clientCount);
    rawClients.push(...clients);

    await waitFor(() => server!.getClientCount() === clientCount);

    // Create sessions for all
    for (const ws of clients) {
      const msg = createMessage(MessageType.SESSION_CREATE, { software: 'openclaw' });
      ws.send(JSON.stringify(msg));
    }

    await waitFor(() => receivedMessages.length >= clientCount);

    // Now disconnect half the clients while others continue sending
    for (let i = 0; i < 3; i++) {
      clients[i].close();
    }

    // Remaining clients keep sending
    for (let i = 3; i < clientCount; i++) {
      const msg = createMessage(MessageType.STEP_OUTPUT, {
        stepId: 'active-step',
        output: 'Still sending',
      });
      clients[i].send(JSON.stringify(msg));
    }

    await waitFor(() => server!.getClientCount() === 2, 5000);
    await waitFor(() => receivedMessages.length >= clientCount + 2, 5000);

    // Server should handle this gracefully
    expect(server.getClientCount()).toBe(2);
    // Remaining clients' messages should have been received
    expect(receivedMessages.filter((t) => t === MessageType.STEP_OUTPUT).length).toBe(2);
  });

  // --------------------------------------------------------------------------
  // 10. Server stop with many active clients
  // --------------------------------------------------------------------------

  it('should cleanly stop server with many active clients', async () => {
    const port = nextPort();
    server = new InstallServer({ port, heartbeatIntervalMs: 60000, requireAuth: false });

    server.on('message', (clientId, msg) => {
      routeMessage(server!, clientId, msg);
    });

    await server.start();

    const clientCount = 15;
    const clients = await connectManyClients(port, clientCount);
    rawClients.push(...clients);

    await waitFor(() => server!.getClientCount() === clientCount);

    // Create sessions for all
    const responsePromises = clients.map((ws) => waitForMessage(ws));
    for (const ws of clients) {
      const msg = createMessage(MessageType.SESSION_CREATE, { software: 'test' });
      ws.send(JSON.stringify(msg));
    }
    await Promise.all(responsePromises);

    expect(server.getSessionCount()).toBe(clientCount);

    // Stop server - should close all connections cleanly
    await server.stop();

    expect(server.getClientCount()).toBe(0);
    expect(server.isRunning()).toBe(false);

    server = null;
  });

  // --------------------------------------------------------------------------
  // 11. Unique client IDs under concurrent connections
  // --------------------------------------------------------------------------

  it('should assign unique client IDs to all concurrent connections', async () => {
    const port = nextPort();
    server = new InstallServer({ port, heartbeatIntervalMs: 60000 });

    const clientIds: string[] = [];

    server.on('connection', (id) => {
      clientIds.push(id);
    });

    await server.start();

    const clientCount = 20;
    const clients = await connectManyClients(port, clientCount);
    rawClients.push(...clients);

    await waitFor(() => clientIds.length === clientCount);

    // All IDs should be unique
    const uniqueIds = new Set(clientIds);
    expect(uniqueIds.size).toBe(clientCount);
  });
});
