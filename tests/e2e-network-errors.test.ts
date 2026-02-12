/**
 * E2E Test: Network Error Handling
 *
 * Tests network-related error scenarios:
 * 1. Server unreachable (connection failure)
 * 2. Server disconnects unexpectedly
 * 3. Client reconnection behavior
 * 4. Message delivery during reconnection
 * 5. Invalid message handling
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import WebSocket, { WebSocketServer } from 'ws';
import { createMessage, MessageType } from '@aiinstaller/shared';
import { InstallServer } from '../packages/server/src/api/server.js';
import { routeMessage } from '../packages/server/src/api/handlers.js';
import { InstallClient, ConnectionState } from '../packages/agent/src/client.js';

// ============================================================================
// Helpers
// ============================================================================

let testPort = 19820;
function nextPort() {
  return testPort++;
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

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ============================================================================
// Tests
// ============================================================================

describe('E2E: Network Error Handling', () => {
  let server: InstallServer | null = null;
  let installClients: InstallClient[] = [];

  afterEach(async () => {
    for (const c of installClients) {
      c.disconnect();
    }
    installClients = [];

    if (server?.isRunning()) {
      await server.stop();
    }
    server = null;
  });

  // --------------------------------------------------------------------------
  // Connection failure
  // --------------------------------------------------------------------------

  it('should handle connection to non-existent server via timeout', async () => {
    // Use a non-routable address that will trigger the connection timeout
    const client = new InstallClient({
      serverUrl: 'ws://192.0.2.1:19899', // TEST-NET-1, non-routable
      autoReconnect: false,
      connectionTimeoutMs: 500,
    });
    installClients.push(client);

    const errorFn = vi.fn();
    client.on('error', errorFn);

    // Connection should fail via timeout
    await expect(client.connect()).rejects.toThrow();

    // Client should end up disconnected
    expect(client.state).toBe(ConnectionState.DISCONNECTED);
  }, 10000);

  // --------------------------------------------------------------------------
  // Server shutdown during session
  // --------------------------------------------------------------------------

  it('should detect server shutdown during active session', async () => {
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

    const disconnectedFn = vi.fn();
    client.on('disconnected', disconnectedFn);

    await client.connect();
    expect(client.state).toBe(ConnectionState.CONNECTED);

    // Create a session first
    const createMsg = createMessage(MessageType.SESSION_CREATE, { software: 'openclaw' });
    await client.sendAndWait(createMsg, MessageType.PLAN_RECEIVE, 5000);

    // Now shut down the server
    await server.stop();
    server = null;

    // Wait for disconnect to be detected
    await waitFor(() => disconnectedFn.mock.calls.length > 0);

    expect(disconnectedFn).toHaveBeenCalled();
    expect(client.state).toBe(ConnectionState.DISCONNECTED);
  });

  // --------------------------------------------------------------------------
  // Reconnection behavior
  // --------------------------------------------------------------------------

  it('should attempt reconnection when server restarts', async () => {
    const port = nextPort();
    server = new InstallServer({ port, heartbeatIntervalMs: 60000, requireAuth: false });

    server.on('message', (clientId, msg) => {
      routeMessage(server!, clientId, msg);
    });

    await server.start();

    const client = new InstallClient({
      serverUrl: `ws://127.0.0.1:${port}`,
      autoReconnect: true,
      maxReconnectAttempts: 3,
      reconnectBaseDelayMs: 200,
      reconnectMaxDelayMs: 1000,
    });
    installClients.push(client);

    const reconnectingFn = vi.fn();
    const connectedFn = vi.fn();
    client.on('reconnecting', reconnectingFn);
    client.on('connected', connectedFn);

    await client.connect();
    expect(client.state).toBe(ConnectionState.CONNECTED);

    // Stop server
    await server.stop();

    // Wait for client to detect disconnect
    await delay(200);

    // Restart server
    server = new InstallServer({ port, heartbeatIntervalMs: 60000, requireAuth: false });
    server.on('message', (clientId, msg) => {
      routeMessage(server!, clientId, msg);
    });
    await server.start();

    // Wait for reconnection
    await waitFor(() => client.state === ConnectionState.CONNECTED, 10000);

    expect(reconnectingFn).toHaveBeenCalled();
    expect(client.state).toBe(ConnectionState.CONNECTED);
  });

  // --------------------------------------------------------------------------
  // Reconnect exhaustion
  // --------------------------------------------------------------------------

  it('should emit reconnectFailed or disconnected after server goes down', async () => {
    const port = nextPort();
    server = new InstallServer({ port, heartbeatIntervalMs: 60000, requireAuth: false });

    await server.start();

    const client = new InstallClient({
      serverUrl: `ws://127.0.0.1:${port}`,
      autoReconnect: true,
      maxReconnectAttempts: 2,
      reconnectBaseDelayMs: 100,
      reconnectMaxDelayMs: 200,
    });
    installClients.push(client);

    const reconnectFailedFn = vi.fn();
    const reconnectingFn = vi.fn();
    const disconnectedFn = vi.fn();
    client.on('reconnectFailed', reconnectFailedFn);
    client.on('reconnecting', reconnectingFn);
    client.on('disconnected', disconnectedFn);

    await client.connect();
    expect(client.state).toBe(ConnectionState.CONNECTED);

    // Stop server permanently
    await server.stop();
    server = null;

    // Wait for disconnect to be detected and reconnection attempts
    await delay(5000);

    // Client should have detected disconnection
    expect(disconnectedFn).toHaveBeenCalled();
    // Client should have attempted to reconnect
    expect(reconnectingFn).toHaveBeenCalled();
  }, 15000);

  // --------------------------------------------------------------------------
  // Send during disconnection
  // --------------------------------------------------------------------------

  it('should throw when sending message while disconnected', async () => {
    const port = nextPort();
    const client = new InstallClient({
      serverUrl: `ws://127.0.0.1:${port}`,
      autoReconnect: false,
    });
    installClients.push(client);

    const msg = createMessage(MessageType.SESSION_CREATE, { software: 'openclaw' });

    expect(() => client.send(msg)).toThrow('Client is not connected');
  });

  // --------------------------------------------------------------------------
  // Invalid messages
  // --------------------------------------------------------------------------

  it('should handle invalid JSON from server gracefully', async () => {
    const port = nextPort();

    // Create a raw WebSocket server that sends invalid data
    const wss = new WebSocketServer({ port });
    const serverCleanup = () => {
      return new Promise<void>((resolve) => {
        wss.close(() => resolve());
      });
    };

    wss.on('connection', (ws) => {
      // Send invalid JSON
      ws.send('this is not json{{{');
    });

    const client = new InstallClient({
      serverUrl: `ws://127.0.0.1:${port}`,
      autoReconnect: false,
    });
    installClients.push(client);

    const errorFn = vi.fn();
    client.on('error', errorFn);

    await client.connect();

    // Wait for error to be processed
    await waitFor(() => errorFn.mock.calls.length > 0);

    expect(errorFn).toHaveBeenCalled();
    // Client should still be connected (invalid message shouldn't disconnect)
    expect(client.state).toBe(ConnectionState.CONNECTED);

    client.disconnect();
    await serverCleanup();
  });

  it('should handle malformed protocol messages from server gracefully', async () => {
    const port = nextPort();

    const wss = new WebSocketServer({ port });
    const serverCleanup = () => {
      return new Promise<void>((resolve) => {
        wss.close(() => resolve());
      });
    };

    wss.on('connection', (ws) => {
      // Send valid JSON but invalid protocol message
      ws.send(JSON.stringify({ type: 'unknown.type', payload: { foo: 'bar' } }));
    });

    const client = new InstallClient({
      serverUrl: `ws://127.0.0.1:${port}`,
      autoReconnect: false,
    });
    installClients.push(client);

    const errorFn = vi.fn();
    const messageFn = vi.fn();
    client.on('error', errorFn);
    client.on('message', messageFn);

    await client.connect();
    await delay(200);

    // Invalid protocol message should trigger error, not message
    expect(errorFn).toHaveBeenCalled();
    expect(messageFn).not.toHaveBeenCalled();

    client.disconnect();
    await serverCleanup();
  });

  // --------------------------------------------------------------------------
  // Server handles client disconnect
  // --------------------------------------------------------------------------

  it('should handle client disconnect gracefully on server side', async () => {
    const port = nextPort();
    server = new InstallServer({ port, heartbeatIntervalMs: 60000, requireAuth: false });

    const disconnectedIds: string[] = [];
    server.on('disconnect', (clientId) => {
      disconnectedIds.push(clientId);
    });

    server.on('message', (clientId, msg) => {
      routeMessage(server!, clientId, msg);
    });

    await server.start();

    // Connect client and create session
    const client = new InstallClient({
      serverUrl: `ws://127.0.0.1:${port}`,
      autoReconnect: false,
    });
    installClients.push(client);

    await client.connect();
    expect(server.getClientCount()).toBe(1);

    const createMsg = createMessage(MessageType.SESSION_CREATE, { software: 'openclaw' });
    await client.sendAndWait(createMsg, MessageType.PLAN_RECEIVE, 5000);
    expect(server.getSessionCount()).toBe(1);

    // Disconnect client
    client.disconnect();

    await waitFor(() => server!.getClientCount() === 0);
    expect(disconnectedIds.length).toBe(1);

    // Session should still exist (not cleaned up on disconnect)
    expect(server.getSessionCount()).toBe(1);
  });

  // --------------------------------------------------------------------------
  // Timeout on sendAndWait
  // --------------------------------------------------------------------------

  it('should timeout when expected response is never received', async () => {
    const port = nextPort();
    server = new InstallServer({ port, heartbeatIntervalMs: 60000, requireAuth: false });

    // Don't wire up message routing - server won't respond
    await server.start();

    const client = new InstallClient({
      serverUrl: `ws://127.0.0.1:${port}`,
      autoReconnect: false,
    });
    installClients.push(client);

    await client.connect();

    const msg = createMessage(MessageType.SESSION_CREATE, { software: 'openclaw' });

    // Should timeout since server doesn't route messages
    await expect(
      client.sendAndWait(msg, MessageType.PLAN_RECEIVE, 1000),
    ).rejects.toThrow('Timeout');

    client.disconnect();
  });

  // --------------------------------------------------------------------------
  // Connection timeout
  // --------------------------------------------------------------------------

  it('should handle connection timeout', async () => {
    // Use a non-routable address to trigger timeout
    const client = new InstallClient({
      serverUrl: 'ws://192.0.2.1:9999', // TEST-NET-1, non-routable
      autoReconnect: false,
      connectionTimeoutMs: 1000,
    });
    installClients.push(client);

    const startTime = Date.now();
    await expect(client.connect()).rejects.toThrow();
    const elapsed = Date.now() - startTime;

    // Should timeout around 1000ms (give some tolerance)
    expect(elapsed).toBeLessThan(5000);
    expect(client.state).toBe(ConnectionState.DISCONNECTED);
  });

  // --------------------------------------------------------------------------
  // Server invalid message from client
  // --------------------------------------------------------------------------

  it('should handle invalid messages from client on server side', async () => {
    const port = nextPort();
    server = new InstallServer({ port, heartbeatIntervalMs: 60000, requireAuth: false });

    const errors: Error[] = [];
    server.on('error', (_clientId, err) => {
      errors.push(err);
    });

    await server.start();

    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise<void>((resolve) => ws.on('open', resolve));

    // Send invalid JSON
    ws.send('not json');
    await delay(100);
    expect(errors.length).toBeGreaterThan(0);

    // Send valid JSON but invalid protocol
    ws.send(JSON.stringify({ invalid: true }));
    await delay(100);
    expect(errors.length).toBeGreaterThan(1);

    ws.close();
    await waitFor(() => server!.getClientCount() === 0);
  });
});
