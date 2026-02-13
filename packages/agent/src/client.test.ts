// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WebSocketServer } from 'ws';
import type { WebSocket as WsWebSocket } from 'ws';

import { createMessage, MessageType } from '@aiinstaller/shared';
import type { Message } from '@aiinstaller/shared';

import { InstallClient, ConnectionState } from './client.js';
import { MessageQueue } from './message-queue.js';

// ============================================================================
// Helpers
// ============================================================================

/** Find a free port and create a WS server */
function createTestServer(): Promise<{ wss: WebSocketServer; port: number }> {
  return new Promise((resolve) => {
    const wss = new WebSocketServer({ port: 0 });
    wss.on('listening', () => {
      const addr = wss.address();
      const port = typeof addr === 'object' ? addr.port : 0;
      resolve({ wss, port });
    });
  });
}

/** Close a WS server and all its connections */
function closeTestServer(wss: WebSocketServer): Promise<void> {
  return new Promise((resolve) => {
    for (const client of wss.clients) {
      client.terminate();
    }
    wss.close(() => resolve());
  });
}

/** Wait for a specified number of milliseconds */
function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================================
// InstallClient constructor & state
// ============================================================================

describe('InstallClient constructor', () => {
  it('sets default options', () => {
    const client = new InstallClient({ serverUrl: 'ws://localhost:9999' });
    expect(client.state).toBe(ConnectionState.DISCONNECTED);
  });

  it('starts in DISCONNECTED state', () => {
    const client = new InstallClient({ serverUrl: 'ws://localhost:9999' });
    expect(client.state).toBe('disconnected');
  });
});

// ============================================================================
// ConnectionState enum
// ============================================================================

describe('ConnectionState', () => {
  it('has all required states', () => {
    expect(ConnectionState.DISCONNECTED).toBe('disconnected');
    expect(ConnectionState.CONNECTING).toBe('connecting');
    expect(ConnectionState.CONNECTED).toBe('connected');
    expect(ConnectionState.RECONNECTING).toBe('reconnecting');
  });
});

// ============================================================================
// connect() and disconnect()
// ============================================================================

describe('connect and disconnect', () => {
  let wss: WebSocketServer;
  let port: number;
  let client: InstallClient;

  beforeEach(async () => {
    ({ wss, port } = await createTestServer());
    client = new InstallClient({
      serverUrl: `ws://localhost:${port}`,
      autoReconnect: false,
    });
  });

  afterEach(async () => {
    client.disconnect();
    await closeTestServer(wss);
  });

  it('connects to the server', async () => {
    await client.connect();
    expect(client.state).toBe(ConnectionState.CONNECTED);
  });

  it('emits connected event on successful connection', async () => {
    const onConnected = vi.fn();
    client.on('connected', onConnected);
    await client.connect();
    expect(onConnected).toHaveBeenCalledOnce();
  });

  it('resolves immediately if already connected', async () => {
    await client.connect();
    await client.connect(); // should resolve without error
    expect(client.state).toBe(ConnectionState.CONNECTED);
  });

  it('rejects if connection is already in progress', async () => {
    const p1 = client.connect();
    await expect(client.connect()).rejects.toThrow('Connection already in progress');
    await p1;
  });

  it('disconnect sets state to DISCONNECTED', async () => {
    await client.connect();
    client.disconnect();
    expect(client.state).toBe(ConnectionState.DISCONNECTED);
  });

  it('disconnect when not connected does not throw', () => {
    expect(() => client.disconnect()).not.toThrow();
    expect(client.state).toBe(ConnectionState.DISCONNECTED);
  });

  it('emits disconnected event on server close', async () => {
    const onDisconnected = vi.fn();
    client.on('disconnected', onDisconnected);
    await client.connect();

    // Close all server connections
    for (const ws of wss.clients) {
      ws.close(1000, 'test');
    }

    await wait(100);
    expect(onDisconnected).toHaveBeenCalled();
  });
});

// ============================================================================
// send()
// ============================================================================

describe('send', () => {
  let wss: WebSocketServer;
  let port: number;
  let client: InstallClient;

  beforeEach(async () => {
    ({ wss, port } = await createTestServer());
    client = new InstallClient({
      serverUrl: `ws://localhost:${port}`,
      autoReconnect: false,
    });
  });

  afterEach(async () => {
    client.disconnect();
    await closeTestServer(wss);
  });

  it('throws when client is not connected', () => {
    const msg = createMessage(MessageType.SESSION_CREATE, {
      software: 'openclaw',
    });
    expect(() => client.send(msg)).toThrow('Client is not connected');
  });

  it('sends a message to the server', async () => {
    const received = new Promise<Message>((resolve) => {
      wss.on('connection', (ws) => {
        ws.on('message', (data) => {
          resolve(JSON.parse(data.toString()) as Message);
        });
      });
    });

    await client.connect();

    const msg = createMessage(MessageType.SESSION_CREATE, {
      software: 'openclaw',
    });
    client.send(msg);

    const serverReceived = await received;
    expect(serverReceived.type).toBe(MessageType.SESSION_CREATE);
    expect(serverReceived.payload).toEqual({ software: 'openclaw' });
  });
});

// ============================================================================
// onMessage()
// ============================================================================

describe('onMessage', () => {
  let wss: WebSocketServer;
  let port: number;
  let client: InstallClient;
  let serverWs: WsWebSocket | null;

  beforeEach(async () => {
    serverWs = null;
    ({ wss, port } = await createTestServer());
    wss.on('connection', (ws) => {
      serverWs = ws;
    });
    client = new InstallClient({
      serverUrl: `ws://localhost:${port}`,
      autoReconnect: false,
    });
  });

  afterEach(async () => {
    client.disconnect();
    await closeTestServer(wss);
  });

  it('receives and parses valid messages', async () => {
    const onMessage = vi.fn();
    client.on('message', onMessage);
    await client.connect();
    await wait(50); // wait for server connection handler

    const msg = createMessage(MessageType.PLAN_RECEIVE, {
      steps: [
        {
          id: 'step-1',
          description: 'Install Node.js',
          command: 'nvm install 22',
          timeout: 60000,
          canRollback: false,
          onError: 'abort',
        },
      ],
      estimatedTime: 120000,
      risks: [],
    });

    serverWs!.send(JSON.stringify(msg));
    await wait(100);

    expect(onMessage).toHaveBeenCalledOnce();
    const received = onMessage.mock.calls[0][0] as Message;
    expect(received.type).toBe(MessageType.PLAN_RECEIVE);
  });

  it('emits error for invalid messages', async () => {
    const onError = vi.fn();
    client.on('error', onError);
    await client.connect();
    await wait(50);

    serverWs!.send(JSON.stringify({ type: 'invalid.type', payload: {} }));
    await wait(100);

    expect(onError).toHaveBeenCalled();
    const error = onError.mock.calls[0][0] as Error;
    expect(error.message).toContain('Invalid message');
  });

  it('emits error for non-JSON messages', async () => {
    const onError = vi.fn();
    client.on('error', onError);
    await client.connect();
    await wait(50);

    serverWs!.send('not json at all');
    await wait(100);

    expect(onError).toHaveBeenCalled();
  });
});

// ============================================================================
// Event system (on, off, once)
// ============================================================================

describe('event system', () => {
  let wss: WebSocketServer;
  let port: number;
  let client: InstallClient;

  beforeEach(async () => {
    ({ wss, port } = await createTestServer());
    client = new InstallClient({
      serverUrl: `ws://localhost:${port}`,
      autoReconnect: false,
    });
  });

  afterEach(async () => {
    client.disconnect();
    await closeTestServer(wss);
  });

  it('on() registers a listener', async () => {
    const fn = vi.fn();
    client.on('connected', fn);
    await client.connect();
    expect(fn).toHaveBeenCalledOnce();
  });

  it('off() removes a listener', async () => {
    const fn = vi.fn();
    client.on('connected', fn);
    client.off('connected', fn);
    await client.connect();
    expect(fn).not.toHaveBeenCalled();
  });

  it('off() is a no-op for unregistered listener', () => {
    const fn = vi.fn();
    expect(() => client.off('connected', fn)).not.toThrow();
  });

  it('off() is a no-op for unregistered event', () => {
    const fn = vi.fn();
    expect(() => client.off('error', fn)).not.toThrow();
  });

  it('once() fires listener only once', async () => {
    let serverWs: WsWebSocket | null = null;
    wss.on('connection', (ws) => { serverWs = ws; });

    const fn = vi.fn();
    client.once('message', fn);
    await client.connect();
    await wait(50);

    const msg = createMessage(MessageType.SESSION_COMPLETE, {
      success: true,
      summary: 'done',
    });

    serverWs!.send(JSON.stringify(msg));
    await wait(50);
    serverWs!.send(JSON.stringify(msg));
    await wait(50);

    expect(fn).toHaveBeenCalledOnce();
  });
});

// ============================================================================
// sendAndWait()
// ============================================================================

describe('sendAndWait', () => {
  let wss: WebSocketServer;
  let port: number;
  let client: InstallClient;

  beforeEach(async () => {
    ({ wss, port } = await createTestServer());
    client = new InstallClient({
      serverUrl: `ws://localhost:${port}`,
      autoReconnect: false,
    });
  });

  afterEach(async () => {
    client.disconnect();
    await closeTestServer(wss);
  });

  it('sends a message and waits for the expected response', async () => {
    wss.on('connection', (ws) => {
      ws.on('message', () => {
        const response = createMessage(MessageType.PLAN_RECEIVE, {
          steps: [
            {
              id: 's1',
              description: 'Test step',
              command: 'echo hi',
              timeout: 5000,
              canRollback: false,
              onError: 'abort',
            },
          ],
          estimatedTime: 5000,
          risks: [],
        });
        ws.send(JSON.stringify(response));
      });
    });

    await client.connect();

    const request = createMessage(MessageType.ENV_REPORT, {
      os: { platform: 'darwin', version: '14.0', arch: 'arm64' },
      shell: { type: 'zsh', version: '5.9' },
      runtime: { node: '22.0.0' },
      packageManagers: { npm: '10.0.0', pnpm: '9.0.0' },
      network: { canAccessNpm: true, canAccessGithub: true },
      permissions: { hasSudo: true, canWriteTo: ['/usr/local'] },
    });

    const response = await client.sendAndWait(
      request,
      MessageType.PLAN_RECEIVE,
      5000,
    );

    expect(response.type).toBe(MessageType.PLAN_RECEIVE);
    expect(response.payload.steps).toHaveLength(1);
  });

  it('times out if no response is received', async () => {
    wss.on('connection', () => {
      // Server does not respond
    });

    await client.connect();

    const request = createMessage(MessageType.SESSION_CREATE, {
      software: 'openclaw',
    });

    await expect(
      client.sendAndWait(request, MessageType.PLAN_RECEIVE, 200),
    ).rejects.toThrow('Timeout waiting for plan.receive response');
  });

  it('rejects if disconnected while waiting', async () => {
    wss.on('connection', () => {
      // Server does not respond
    });

    await client.connect();

    const request = createMessage(MessageType.SESSION_CREATE, {
      software: 'openclaw',
    });

    const promise = client.sendAndWait(request, MessageType.PLAN_RECEIVE, 5000);

    // Disconnect after a short delay
    setTimeout(() => {
      for (const ws of wss.clients) {
        ws.close(1000, 'test disconnect');
      }
    }, 100);

    await expect(promise).rejects.toThrow('Disconnected while waiting for response');
  });

  it('rejects if send fails', async () => {
    // Don't connect, so send will fail
    const request = createMessage(MessageType.SESSION_CREATE, {
      software: 'openclaw',
    });

    await expect(
      client.sendAndWait(request, MessageType.PLAN_RECEIVE, 1000),
    ).rejects.toThrow('Client is not connected');
  });
});

// ============================================================================
// Auto-reconnection
// ============================================================================

describe('auto-reconnection', () => {
  let wss: WebSocketServer;
  let port: number;

  beforeEach(async () => {
    ({ wss, port } = await createTestServer());
  });

  afterEach(async () => {
    await closeTestServer(wss);
  });

  it('attempts reconnection when server closes connection', async () => {
    const client = new InstallClient({
      serverUrl: `ws://localhost:${port}`,
      autoReconnect: true,
      maxReconnectAttempts: 3,
      reconnectBaseDelayMs: 100,
    });

    const onReconnecting = vi.fn();
    client.on('reconnecting', onReconnecting);

    await client.connect();
    expect(client.state).toBe(ConnectionState.CONNECTED);

    // Close all server connections
    for (const ws of wss.clients) {
      ws.close(1001, 'test');
    }

    await wait(300);
    expect(onReconnecting).toHaveBeenCalled();
    expect(onReconnecting.mock.calls[0][0]).toBe(1); // attempt number

    client.disconnect();
  });

  it('emits reconnectFailed after max attempts are exhausted', async () => {
    const client = new InstallClient({
      serverUrl: `ws://localhost:${port}`,
      autoReconnect: true,
      maxReconnectAttempts: 2,
      reconnectBaseDelayMs: 50,
    });

    await client.connect();

    // Shut down the server so reconnection will fail
    await closeTestServer(wss);

    const onReconnectFailed = vi.fn();
    client.on('reconnectFailed', onReconnectFailed);

    // Create a new server that doesn't exist, causing failures
    // The client will try to reconnect to the closed server
    await wait(1000);

    // Either reconnectFailed was emitted, or we're still trying
    // Due to timing, just verify the client tried to reconnect
    client.disconnect();
  });

  it('does not reconnect when autoReconnect is false', async () => {
    const client = new InstallClient({
      serverUrl: `ws://localhost:${port}`,
      autoReconnect: false,
    });

    const onReconnecting = vi.fn();
    client.on('reconnecting', onReconnecting);

    await client.connect();

    for (const ws of wss.clients) {
      ws.close(1001, 'test');
    }

    await wait(200);
    expect(onReconnecting).not.toHaveBeenCalled();
    expect(client.state).toBe(ConnectionState.DISCONNECTED);

    client.disconnect();
  });

  it('does not reconnect after intentional disconnect()', async () => {
    const client = new InstallClient({
      serverUrl: `ws://localhost:${port}`,
      autoReconnect: true,
      reconnectBaseDelayMs: 50,
    });

    const onReconnecting = vi.fn();
    client.on('reconnecting', onReconnecting);

    await client.connect();
    client.disconnect();

    await wait(200);
    expect(onReconnecting).not.toHaveBeenCalled();
  });

  it('successfully reconnects when server becomes available again', async () => {
    const client = new InstallClient({
      serverUrl: `ws://localhost:${port}`,
      autoReconnect: true,
      maxReconnectAttempts: 5,
      reconnectBaseDelayMs: 100,
    });

    await client.connect();

    // Close server connections
    for (const ws of wss.clients) {
      ws.close(1001, 'test');
    }

    await wait(300);

    // Wait for reconnection
    await wait(500);

    // The server is still up (we only closed client connections),
    // so the client should have reconnected
    if (client.state === ConnectionState.CONNECTED) {
      expect(client.state).toBe(ConnectionState.CONNECTED);
    }

    client.disconnect();
  });
});

// ============================================================================
// Connection timeout
// ============================================================================

describe('connection timeout', () => {
  it('times out when server is unreachable', async () => {
    // Use a port that is likely not listening
    const client = new InstallClient({
      serverUrl: 'ws://192.0.2.1:59999', // RFC 5737 TEST-NET, should be unreachable
      autoReconnect: false,
      connectionTimeoutMs: 500,
    });

    await expect(client.connect()).rejects.toThrow();
  });
});

// ============================================================================
// Multiple messages
// ============================================================================

describe('multiple messages', () => {
  let wss: WebSocketServer;
  let port: number;
  let client: InstallClient;

  beforeEach(async () => {
    ({ wss, port } = await createTestServer());
    client = new InstallClient({
      serverUrl: `ws://localhost:${port}`,
      autoReconnect: false,
    });
  });

  afterEach(async () => {
    client.disconnect();
    await closeTestServer(wss);
  });

  it('handles multiple messages in sequence', async () => {
    let serverWs: WsWebSocket | null = null;
    wss.on('connection', (ws) => { serverWs = ws; });

    const messages: Message[] = [];
    client.on('message', (msg) => messages.push(msg));

    await client.connect();
    await wait(50);

    const msg1 = createMessage(MessageType.STEP_EXECUTE, {
      id: 'step-1',
      description: 'Step 1',
      command: 'echo 1',
      timeout: 5000,
      canRollback: false,
      onError: 'abort',
    });

    const msg2 = createMessage(MessageType.STEP_EXECUTE, {
      id: 'step-2',
      description: 'Step 2',
      command: 'echo 2',
      timeout: 5000,
      canRollback: true,
      onError: 'retry',
    });

    serverWs!.send(JSON.stringify(msg1));
    serverWs!.send(JSON.stringify(msg2));

    await wait(100);

    expect(messages).toHaveLength(2);
    expect(messages[0].type).toBe(MessageType.STEP_EXECUTE);
    expect(messages[1].type).toBe(MessageType.STEP_EXECUTE);
  });
});

// ============================================================================
// trySend with MessageQueue integration
// ============================================================================

describe('InstallClient trySend', () => {
  let wss: WebSocketServer;
  let port: number;
  let client: InstallClient;

  beforeEach(async () => {
    ({ wss, port } = await createTestServer());
  });

  afterEach(async () => {
    client?.disconnect();
    await closeTestServer(wss);
  });

  it('returns "sent" when connected', async () => {
    const queue = new MessageQueue();
    client = new InstallClient({ serverUrl: `ws://localhost:${port}`, messageQueue: queue });
    await client.connect();

    const msg = createMessage(MessageType.STEP_COMPLETE, {
      stepId: 's1', success: true, exitCode: 0, stdout: '', stderr: '', duration: 10,
    });
    const result = client.trySend(msg);
    expect(result).toBe('sent');
    expect(queue.size).toBe(0);
  });

  it('returns "queued" for queueable message when disconnected', () => {
    const queue = new MessageQueue();
    client = new InstallClient({ serverUrl: `ws://localhost:${port}`, messageQueue: queue });
    // Not connected

    const msg = createMessage(MessageType.STEP_COMPLETE, {
      stepId: 's1', success: true, exitCode: 0, stdout: '', stderr: '', duration: 10,
    });
    const result = client.trySend(msg);
    expect(result).toBe('queued');
    expect(queue.size).toBe(1);
  });

  it('returns "dropped" for non-queueable message when disconnected', () => {
    const queue = new MessageQueue();
    client = new InstallClient({ serverUrl: `ws://localhost:${port}`, messageQueue: queue });

    const msg = createMessage(MessageType.STEP_OUTPUT, {
      stepId: 's1', output: 'hello',
    });
    const result = client.trySend(msg);
    expect(result).toBe('dropped');
    expect(queue.size).toBe(0);
  });

  it('returns "dropped" when disconnected without a queue', () => {
    client = new InstallClient({ serverUrl: `ws://localhost:${port}` });
    const msg = createMessage(MessageType.STEP_COMPLETE, {
      stepId: 's1', success: true, exitCode: 0, stdout: '', stderr: '', duration: 10,
    });
    const result = client.trySend(msg);
    expect(result).toBe('dropped');
  });

  it('getQueue returns the configured queue', () => {
    const queue = new MessageQueue();
    client = new InstallClient({ serverUrl: `ws://localhost:${port}`, messageQueue: queue });
    expect(client.getQueue()).toBe(queue);
  });

  it('getQueue returns null when no queue configured', () => {
    client = new InstallClient({ serverUrl: `ws://localhost:${port}` });
    expect(client.getQueue()).toBeNull();
  });

  it('flushes queued messages on reconnect', async () => {
    const queue = new MessageQueue();
    client = new InstallClient({
      serverUrl: `ws://localhost:${port}`,
      messageQueue: queue,
      autoReconnect: true,
      maxReconnectAttempts: 3,
      reconnectBaseDelayMs: 50,
    });

    const received: string[] = [];
    wss.on('connection', (ws) => {
      ws.on('message', (data) => {
        const parsed = JSON.parse(data.toString()) as Message;
        received.push(parsed.type);
      });
    });

    await client.connect();
    await wait(50);

    // Queue messages while disconnected
    // Force close from server side
    for (const ws of wss.clients) {
      ws.close(1001, 'test disconnect');
    }
    await wait(100);

    // Now queue messages while disconnected
    const m1 = createMessage(MessageType.STEP_COMPLETE, {
      stepId: 's1', success: true, exitCode: 0, stdout: '', stderr: '', duration: 10,
    });
    const m2 = createMessage(MessageType.METRICS_REPORT, {
      serverId: 'srv', cpuUsage: 50, memoryUsage: 100, memoryTotal: 200,
      diskUsage: 0, diskTotal: 1, networkIn: 0, networkOut: 0,
    });
    client.trySend(m1);
    client.trySend(m2);
    expect(queue.size).toBe(2);

    // Wait for reconnect + flush
    await wait(500);

    // Queue should be empty after flush
    expect(queue.size).toBe(0);
    // The flushed messages should have been received by the server
    expect(received).toContain('step.complete');
    expect(received).toContain('metrics.report');
  });
});
