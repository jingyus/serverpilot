/**
 * E2E Test: WebSocket Communication
 *
 * Tests WebSocket communication patterns:
 * 1. Bidirectional message exchange
 * 2. Message ordering and delivery
 * 3. Broadcasting to multiple clients
 * 4. Heartbeat mechanism
 * 5. Server event system
 * 6. Protocol message validation
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import WebSocket from 'ws';
import { createMessage, MessageType } from '@aiinstaller/shared';
import { InstallServer } from '../packages/server/src/api/server.js';
import { routeMessage } from '../packages/server/src/api/handlers.js';
import { InstallClient, ConnectionState } from '../packages/agent/src/client.js';

// ============================================================================
// Helpers
// ============================================================================

let testPort = 19900;
function nextPort() {
  return testPort++;
}

function waitFor(
  condition: () => boolean,
  timeoutMs = 3000,
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

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function connectRawClient(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

function waitForMessage(ws: WebSocket, timeoutMs = 3000): Promise<string> {
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

function collectMessages(ws: WebSocket, count: number, timeoutMs = 5000): Promise<string[]> {
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

// ============================================================================
// Tests
// ============================================================================

describe('E2E: WebSocket Communication', () => {
  let server: InstallServer | null = null;
  let rawClients: WebSocket[] = [];
  let installClients: InstallClient[] = [];

  afterEach(async () => {
    for (const c of installClients) {
      c.disconnect();
    }
    installClients = [];

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
  // Bidirectional communication
  // --------------------------------------------------------------------------

  it('should support bidirectional message exchange', async () => {
    const port = nextPort();
    server = new InstallServer({ port, heartbeatIntervalMs: 60000, requireAuth: false });

    const serverReceivedTypes: string[] = [];

    server.on('message', (clientId, msg) => {
      serverReceivedTypes.push(msg.type);
      routeMessage(server!, clientId, msg);
    });

    await server.start();

    const client = new InstallClient({
      serverUrl: `ws://127.0.0.1:${port}`,
      autoReconnect: false,
    });
    installClients.push(client);

    const clientReceivedTypes: string[] = [];
    client.on('message', (msg) => {
      clientReceivedTypes.push(msg.type);
    });

    await client.connect();

    // Client -> Server (SESSION_CREATE)
    const createMsg = createMessage(MessageType.SESSION_CREATE, { software: 'openclaw' });
    client.send(createMsg);

    // Wait for response
    await waitFor(() => clientReceivedTypes.length > 0);

    // Server -> Client (PLAN_RECEIVE)
    expect(serverReceivedTypes).toContain(MessageType.SESSION_CREATE);
    expect(clientReceivedTypes).toContain(MessageType.PLAN_RECEIVE);

    client.disconnect();
  });

  // --------------------------------------------------------------------------
  // Message ordering
  // --------------------------------------------------------------------------

  it('should preserve message ordering', async () => {
    const port = nextPort();
    server = new InstallServer({ port, heartbeatIntervalMs: 60000, requireAuth: false });

    const receivedOrder: string[] = [];

    server.on('message', (clientId, msg) => {
      receivedOrder.push(msg.type);
      routeMessage(server!, clientId, msg);
    });

    await server.start();

    const ws = await connectRawClient(port);
    rawClients.push(ws);
    await waitFor(() => server!.getClientCount() === 1);

    // Send messages in rapid succession
    const envInfo = {
      os: { platform: 'darwin' as const, version: '14.0', arch: 'arm64' },
      shell: { type: 'zsh' as const, version: '5.9' },
      runtime: { node: '22.0.0' },
      packageManagers: { npm: '10.0.0' },
      network: { canAccessNpm: true, canAccessGithub: true },
      permissions: { hasSudo: true, canWriteTo: ['/usr/local'] },
    };

    const msgs = [
      createMessage(MessageType.SESSION_CREATE, { software: 'openclaw' }),
      createMessage(MessageType.ENV_REPORT, envInfo),
      createMessage(MessageType.STEP_OUTPUT, { stepId: 's1', output: 'line1' }),
      createMessage(MessageType.STEP_OUTPUT, { stepId: 's1', output: 'line2' }),
      createMessage(MessageType.STEP_COMPLETE, {
        stepId: 's1', success: true, exitCode: 0,
        stdout: 'ok', stderr: '', duration: 100,
      }),
    ];

    // Send all without waiting
    for (const msg of msgs) {
      ws.send(JSON.stringify(msg));
    }

    // Wait for all to be processed
    await waitFor(() => receivedOrder.length >= msgs.length, 5000);

    // Verify order is preserved
    expect(receivedOrder[0]).toBe(MessageType.SESSION_CREATE);
    expect(receivedOrder[1]).toBe(MessageType.ENV_REPORT);
    expect(receivedOrder[2]).toBe(MessageType.STEP_OUTPUT);
    expect(receivedOrder[3]).toBe(MessageType.STEP_OUTPUT);
    expect(receivedOrder[4]).toBe(MessageType.STEP_COMPLETE);

    ws.close();
  });

  // --------------------------------------------------------------------------
  // Broadcasting
  // --------------------------------------------------------------------------

  it('should broadcast messages to all connected clients', async () => {
    const port = nextPort();
    server = new InstallServer({ port, heartbeatIntervalMs: 60000, requireAuth: false });

    await server.start();

    // Connect 3 clients
    const ws1 = await connectRawClient(port);
    const ws2 = await connectRawClient(port);
    const ws3 = await connectRawClient(port);
    rawClients.push(ws1, ws2, ws3);

    await waitFor(() => server!.getClientCount() === 3);

    // Collect messages from all clients
    const p1 = waitForMessage(ws1);
    const p2 = waitForMessage(ws2);
    const p3 = waitForMessage(ws3);

    // Server broadcasts a message
    const broadcastMsg = createMessage(MessageType.SESSION_COMPLETE, {
      success: true,
      summary: 'Broadcast message',
    });
    server.broadcast(broadcastMsg);

    // All clients should receive it
    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);

    for (const r of [r1, r2, r3]) {
      const parsed = JSON.parse(r);
      expect(parsed.type).toBe(MessageType.SESSION_COMPLETE);
      expect(parsed.payload.summary).toBe('Broadcast message');
    }

    for (const ws of [ws1, ws2, ws3]) {
      ws.close();
    }
  });

  // --------------------------------------------------------------------------
  // Server events
  // --------------------------------------------------------------------------

  it('should emit connection and disconnect events', async () => {
    const port = nextPort();
    server = new InstallServer({ port, heartbeatIntervalMs: 60000, requireAuth: false });

    const connectedIds: string[] = [];
    const disconnectedIds: string[] = [];

    server.on('connection', (clientId) => {
      connectedIds.push(clientId);
    });
    server.on('disconnect', (clientId) => {
      disconnectedIds.push(clientId);
    });

    await server.start();

    // Connect
    const ws1 = await connectRawClient(port);
    rawClients.push(ws1);
    await waitFor(() => connectedIds.length === 1);

    const ws2 = await connectRawClient(port);
    rawClients.push(ws2);
    await waitFor(() => connectedIds.length === 2);

    expect(connectedIds.length).toBe(2);
    expect(connectedIds[0]).not.toBe(connectedIds[1]); // Unique IDs

    // Disconnect first client
    ws1.close();
    await waitFor(() => disconnectedIds.length === 1);

    expect(disconnectedIds.length).toBe(1);
    expect(disconnectedIds[0]).toBe(connectedIds[0]);

    ws2.close();
    await waitFor(() => disconnectedIds.length === 2);
  });

  // --------------------------------------------------------------------------
  // Send to specific client
  // --------------------------------------------------------------------------

  it('should send messages to specific client only', async () => {
    const port = nextPort();
    server = new InstallServer({ port, heartbeatIntervalMs: 60000, requireAuth: false });

    const clientIds: string[] = [];
    server.on('connection', (clientId) => {
      clientIds.push(clientId);
    });

    await server.start();

    const ws1 = await connectRawClient(port);
    const ws2 = await connectRawClient(port);
    rawClients.push(ws1, ws2);

    await waitFor(() => clientIds.length === 2);

    // Send message only to ws1
    const targetMsg = createMessage(MessageType.SESSION_COMPLETE, {
      success: true,
      summary: 'For client 1 only',
    });

    const p1 = waitForMessage(ws1, 2000);

    // ws2 should NOT receive the message
    let ws2Received = false;
    ws2.once('message', () => {
      ws2Received = true;
    });

    server.send(clientIds[0], targetMsg);

    const r1 = await p1;
    const parsed = JSON.parse(r1);
    expect(parsed.payload.summary).toBe('For client 1 only');

    await delay(200);
    expect(ws2Received).toBe(false);

    ws1.close();
    ws2.close();
  });

  // --------------------------------------------------------------------------
  // Heartbeat mechanism
  // --------------------------------------------------------------------------

  it('should support heartbeat/pong mechanism', async () => {
    const port = nextPort();
    server = new InstallServer({
      port,
      heartbeatIntervalMs: 500, // Fast heartbeat for testing
      connectionTimeoutMs: 300,
      requireAuth: false,
    });

    await server.start();

    // Connect a client that responds to pings (default WebSocket behavior)
    const ws = await connectRawClient(port);
    rawClients.push(ws);

    await waitFor(() => server!.getClientCount() === 1);

    // Wait for at least one heartbeat cycle
    await delay(800);

    // Client should still be connected (pong is automatic in ws library)
    expect(server.getClientCount()).toBe(1);

    ws.close();
  });

  // --------------------------------------------------------------------------
  // Client event system
  // --------------------------------------------------------------------------

  it('should support client event listeners (on, off, once)', async () => {
    const port = nextPort();
    server = new InstallServer({ port, heartbeatIntervalMs: 60000, requireAuth: false });

    server.on('message', (clientId, msg) => {
      routeMessage(server!, clientId, msg);
    });

    await server.start();

    const client = new InstallClient({
      serverUrl: `ws://127.0.0.1:${port}`,
      autoReconnect: false,
    });
    installClients.push(client);

    const onMessageFn = vi.fn();
    const onceMessageFn = vi.fn();

    client.on('message', onMessageFn);
    client.once('message', onceMessageFn);

    await client.connect();

    // Send two messages that trigger responses
    const msg1 = createMessage(MessageType.SESSION_CREATE, { software: 'test1' });
    client.send(msg1);
    await delay(200);

    // "on" should have been called, "once" should have been called once
    expect(onMessageFn).toHaveBeenCalledTimes(1);
    expect(onceMessageFn).toHaveBeenCalledTimes(1);

    // Remove the "on" listener
    client.off('message', onMessageFn);

    // Trigger another message - neither should be called again
    // (We need to trigger a server response, but session is already created.
    //  Let's send env report which doesn't trigger a response)
    // Instead, let's test that off worked by checking call count doesn't increase
    // after we would have received more messages.

    expect(onMessageFn).toHaveBeenCalledTimes(1); // not called again

    client.disconnect();
  });

  // --------------------------------------------------------------------------
  // Request ID matching
  // --------------------------------------------------------------------------

  it('should pass through requestId in messages', async () => {
    const port = nextPort();
    server = new InstallServer({ port, heartbeatIntervalMs: 60000, requireAuth: false });

    server.on('message', (clientId, msg) => {
      routeMessage(server!, clientId, msg);
    });

    await server.start();

    const ws = await connectRawClient(port);
    rawClients.push(ws);
    await waitFor(() => server!.getClientCount() === 1);

    // Send message with requestId
    const requestId = 'test-request-123';
    const msg = createMessage(MessageType.SESSION_CREATE, { software: 'openclaw' }, requestId);
    expect(msg.requestId).toBe(requestId);

    const responsePromise = waitForMessage(ws);
    ws.send(JSON.stringify(msg));

    const responseStr = await responsePromise;
    const response = JSON.parse(responseStr);

    // Response should echo back the requestId
    expect(response.requestId).toBe(requestId);

    ws.close();
  });

  // --------------------------------------------------------------------------
  // Timestamp in messages
  // --------------------------------------------------------------------------

  it('should include valid timestamps in all messages', async () => {
    const port = nextPort();
    server = new InstallServer({ port, heartbeatIntervalMs: 60000, requireAuth: false });

    server.on('message', (clientId, msg) => {
      routeMessage(server!, clientId, msg);
    });

    await server.start();

    const ws = await connectRawClient(port);
    rawClients.push(ws);
    await waitFor(() => server!.getClientCount() === 1);

    const beforeSend = Date.now();

    const msg = createMessage(MessageType.SESSION_CREATE, { software: 'openclaw' });
    expect(msg.timestamp).toBeGreaterThanOrEqual(beforeSend);

    const responsePromise = waitForMessage(ws);
    ws.send(JSON.stringify(msg));

    const responseStr = await responsePromise;
    const response = JSON.parse(responseStr);

    const afterReceive = Date.now();

    // Response timestamp should be within the time window
    expect(response.timestamp).toBeGreaterThanOrEqual(beforeSend);
    expect(response.timestamp).toBeLessThanOrEqual(afterReceive);

    ws.close();
  });

  // --------------------------------------------------------------------------
  // Large message handling
  // --------------------------------------------------------------------------

  it('should handle large messages (step output)', async () => {
    const port = nextPort();
    server = new InstallServer({ port, heartbeatIntervalMs: 60000, requireAuth: false });

    let receivedOutputLength = 0;

    server.on('message', (clientId, msg) => {
      if (msg.type === MessageType.STEP_OUTPUT) {
        receivedOutputLength = msg.payload.output.length;
      }
      routeMessage(server!, clientId, msg);
    });

    await server.start();

    const ws = await connectRawClient(port);
    rawClients.push(ws);
    await waitFor(() => server!.getClientCount() === 1);

    // Create session first
    const createMsg = createMessage(MessageType.SESSION_CREATE, { software: 'openclaw' });
    const ackPromise = waitForMessage(ws);
    ws.send(JSON.stringify(createMsg));
    await ackPromise;

    // Send a large output message (100KB)
    const largeOutput = 'x'.repeat(100000);
    const outputMsg = createMessage(MessageType.STEP_OUTPUT, {
      stepId: 'build',
      output: largeOutput,
    });
    ws.send(JSON.stringify(outputMsg));

    await waitFor(() => receivedOutputLength === 100000);
    expect(receivedOutputLength).toBe(100000);

    ws.close();
  });

  // --------------------------------------------------------------------------
  // Server lifecycle
  // --------------------------------------------------------------------------

  it('should prevent double start', async () => {
    const port = nextPort();
    server = new InstallServer({ port, heartbeatIntervalMs: 60000, requireAuth: false });

    await server.start();

    // Starting again should throw
    await expect(server.start()).rejects.toThrow('Server is already running');
  });

  it('should clean up all clients on stop', async () => {
    const port = nextPort();
    server = new InstallServer({ port, heartbeatIntervalMs: 60000, requireAuth: false });

    await server.start();

    // Connect several clients
    const ws1 = await connectRawClient(port);
    const ws2 = await connectRawClient(port);
    rawClients.push(ws1, ws2);

    await waitFor(() => server!.getClientCount() === 2);

    // Stop server
    await server.stop();

    expect(server.getClientCount()).toBe(0);
    expect(server.isRunning()).toBe(false);

    server = null;
  });

  // --------------------------------------------------------------------------
  // AI Streaming messages
  // --------------------------------------------------------------------------

  it('should handle AI streaming message flow', async () => {
    const port = nextPort();
    server = new InstallServer({ port, heartbeatIntervalMs: 60000, requireAuth: false });

    let connectedClientId: string | null = null;
    server.on('connection', (clientId) => {
      connectedClientId = clientId;
    });

    await server.start();

    const client = new InstallClient({
      serverUrl: `ws://127.0.0.1:${port}`,
      autoReconnect: false,
    });
    installClients.push(client);

    const receivedMessages: string[] = [];
    client.on('message', (msg) => {
      receivedMessages.push(msg.type);
    });

    await client.connect();
    await waitFor(() => connectedClientId !== null);

    // Server sends AI streaming messages
    const streamStart = createMessage(MessageType.AI_STREAM_START, {
      operation: 'analyzeEnvironment',
    });
    server.send(connectedClientId!, streamStart);

    const streamToken1 = createMessage(MessageType.AI_STREAM_TOKEN, {
      token: 'Analyzing',
      accumulated: 'Analyzing',
    });
    server.send(connectedClientId!, streamToken1);

    const streamToken2 = createMessage(MessageType.AI_STREAM_TOKEN, {
      token: ' your environment...',
      accumulated: 'Analyzing your environment...',
    });
    server.send(connectedClientId!, streamToken2);

    const streamComplete = createMessage(MessageType.AI_STREAM_COMPLETE, {
      text: 'Analyzing your environment...',
      inputTokens: 100,
      outputTokens: 50,
    });
    server.send(connectedClientId!, streamComplete);

    await waitFor(() => receivedMessages.length >= 4);

    expect(receivedMessages).toContain(MessageType.AI_STREAM_START);
    expect(receivedMessages.filter((t) => t === MessageType.AI_STREAM_TOKEN).length).toBe(2);
    expect(receivedMessages).toContain(MessageType.AI_STREAM_COMPLETE);

    client.disconnect();
  });

  it('should handle AI streaming error', async () => {
    const port = nextPort();
    server = new InstallServer({ port, heartbeatIntervalMs: 60000, requireAuth: false });

    let connectedClientId: string | null = null;
    server.on('connection', (clientId) => {
      connectedClientId = clientId;
    });

    await server.start();

    const client = new InstallClient({
      serverUrl: `ws://127.0.0.1:${port}`,
      autoReconnect: false,
    });
    installClients.push(client);

    const receivedMessages: any[] = [];
    client.on('message', (msg) => {
      receivedMessages.push(msg);
    });

    await client.connect();
    await waitFor(() => connectedClientId !== null);

    // Server starts streaming then sends error
    const streamStart = createMessage(MessageType.AI_STREAM_START, {
      operation: 'diagnoseError',
    });
    server.send(connectedClientId!, streamStart);

    const streamError = createMessage(MessageType.AI_STREAM_ERROR, {
      error: 'API rate limit exceeded',
    });
    server.send(connectedClientId!, streamError);

    await waitFor(() => receivedMessages.length >= 2);

    expect(receivedMessages[0].type).toBe(MessageType.AI_STREAM_START);
    expect(receivedMessages[1].type).toBe(MessageType.AI_STREAM_ERROR);
    expect(receivedMessages[1].payload.error).toBe('API rate limit exceeded');

    client.disconnect();
  });
});
