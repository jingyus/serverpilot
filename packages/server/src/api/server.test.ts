/**
 * Tests for packages/server/src/api/server.ts
 *
 * Tests the InstallServer class including:
 * - Server lifecycle (start, stop, isRunning)
 * - Connection management (tracking, disconnect, events)
 * - Message handling (valid messages, invalid JSON, invalid schema)
 * - Send and broadcast (specific client, all clients)
 * - Session management (create, get, update, counts)
 * - Heartbeat mechanism (terminate dead, keep alive)
 * - Constructor options and defaults
 * - Edge cases (rapid connect/disconnect, multiple messages, etc.)
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import WebSocket from 'ws';
import type { Message } from '@aiinstaller/shared';
import { MessageType, SessionStatus } from '@aiinstaller/shared';

import { InstallServer } from './server.js';
import type { InstallServerOptions, InstallServerEvents } from './server.js';

// ============================================================================
// Test Helpers
// ============================================================================

let testPort = 18500;
function nextPort(): number {
  return testPort++;
}

/**
 * Poll a condition until it becomes true or timeout expires.
 */
function waitFor(condition: () => boolean, timeoutMs = 2000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const interval = setInterval(() => {
      if (condition()) {
        clearInterval(interval);
        resolve();
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(interval);
        reject(new Error('waitFor timed out'));
      }
    }, 20);
  });
}

/**
 * Connect a WebSocket client to the given port and wait for it to open.
 */
function connectClient(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.on('open', () => resolve(ws));
    ws.on('error', (err) => reject(err));
  });
}

/**
 * Wait for the next message on a WebSocket connection.
 */
function waitForMessage(ws: WebSocket, timeoutMs = 2000): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('waitForMessage timed out'));
    }, timeoutMs);
    ws.once('message', (data) => {
      clearTimeout(timer);
      resolve(typeof data === 'string' ? data : data.toString());
    });
  });
}

/**
 * A valid session.create message for testing.
 */
function makeSessionCreateMessage(software = 'node', version?: string): Message {
  const msg: any = {
    type: MessageType.SESSION_CREATE,
    payload: { software },
    timestamp: Date.now(),
  };
  if (version !== undefined) {
    msg.payload.version = version;
  }
  return msg as Message;
}

/**
 * A valid session.complete message for testing.
 */
function makeSessionCompleteMessage(success = true): Message {
  return {
    type: MessageType.SESSION_COMPLETE,
    payload: { success, summary: 'Done' },
    timestamp: Date.now(),
  } as Message;
}

// ============================================================================
// Tests
// ============================================================================

describe('src/api/server.ts', () => {
  let servers: InstallServer[] = [];
  let clients: WebSocket[] = [];

  /**
   * Track servers and clients for cleanup.
   */
  function trackServer(server: InstallServer): InstallServer {
    servers.push(server);
    return server;
  }

  function trackClient(ws: WebSocket): WebSocket {
    clients.push(ws);
    return ws;
  }

  afterEach(async () => {
    // Close all client connections first
    for (const ws of clients) {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
    }
    clients = [];

    // Stop all servers
    for (const server of servers) {
      if (server.isRunning()) {
        await server.stop();
      }
    }
    servers = [];
  });

  // --------------------------------------------------------------------------
  // Server lifecycle
  // --------------------------------------------------------------------------

  describe('Server lifecycle', () => {
    it('should start and set isRunning to true', async () => {
      const port = nextPort();
      const server = trackServer(new InstallServer({ port }));
      expect(server.isRunning()).toBe(false);

      await server.start();
      expect(server.isRunning()).toBe(true);
    });

    it('should stop and set isRunning to false', async () => {
      const port = nextPort();
      const server = trackServer(new InstallServer({ port }));
      await server.start();
      expect(server.isRunning()).toBe(true);

      await server.stop();
      expect(server.isRunning()).toBe(false);
    });

    it('should reject starting when already running', async () => {
      const port = nextPort();
      const server = trackServer(new InstallServer({ port }));
      await server.start();

      await expect(server.start()).rejects.toThrow('Server is already running');
    });

    it('should handle stop when not running without error', async () => {
      const port = nextPort();
      const server = trackServer(new InstallServer({ port }));

      // Should not throw
      await server.stop();
      expect(server.isRunning()).toBe(false);
    });

    it('should allow restart after stop', async () => {
      const port = nextPort();
      const server = trackServer(new InstallServer({ port }));

      await server.start();
      expect(server.isRunning()).toBe(true);

      await server.stop();
      expect(server.isRunning()).toBe(false);

      await server.start();
      expect(server.isRunning()).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // Connection management
  // --------------------------------------------------------------------------

  describe('Connection management', () => {
    it('should track connected clients and increment count', async () => {
      const port = nextPort();
      const server = trackServer(new InstallServer({ port }));
      await server.start();

      expect(server.getClientCount()).toBe(0);

      const ws1 = trackClient(await connectClient(port));
      await waitFor(() => server.getClientCount() === 1);
      expect(server.getClientCount()).toBe(1);

      const ws2 = trackClient(await connectClient(port));
      await waitFor(() => server.getClientCount() === 2);
      expect(server.getClientCount()).toBe(2);
    });

    it('should remove client on disconnect and decrement count', async () => {
      const port = nextPort();
      const server = trackServer(new InstallServer({ port }));
      await server.start();

      const ws = trackClient(await connectClient(port));
      await waitFor(() => server.getClientCount() === 1);

      ws.close();
      await waitFor(() => server.getClientCount() === 0);
      expect(server.getClientCount()).toBe(0);
    });

    it('should emit connection event with clientId when client connects', async () => {
      const port = nextPort();
      const server = trackServer(new InstallServer({ port }));
      const connectionIds: string[] = [];
      server.on('connection', (clientId) => {
        connectionIds.push(clientId);
      });

      await server.start();
      const ws = trackClient(await connectClient(port));
      await waitFor(() => connectionIds.length === 1);

      expect(connectionIds).toHaveLength(1);
      expect(typeof connectionIds[0]).toBe('string');
      expect(connectionIds[0].length).toBeGreaterThan(0);
    });

    it('should emit disconnect event with clientId when client disconnects', async () => {
      const port = nextPort();
      const server = trackServer(new InstallServer({ port }));
      const disconnectIds: string[] = [];
      server.on('disconnect', (clientId) => {
        disconnectIds.push(clientId);
      });

      await server.start();
      const ws = trackClient(await connectClient(port));
      await waitFor(() => server.getClientCount() === 1);

      ws.close();
      await waitFor(() => disconnectIds.length === 1);

      expect(disconnectIds).toHaveLength(1);
      expect(typeof disconnectIds[0]).toBe('string');
    });

    it('should emit matching clientId for connection and disconnect events', async () => {
      const port = nextPort();
      const server = trackServer(new InstallServer({ port }));
      const connectionIds: string[] = [];
      const disconnectIds: string[] = [];
      server.on('connection', (id) => connectionIds.push(id));
      server.on('disconnect', (id) => disconnectIds.push(id));

      await server.start();
      const ws = trackClient(await connectClient(port));
      await waitFor(() => connectionIds.length === 1);

      ws.close();
      await waitFor(() => disconnectIds.length === 1);

      expect(connectionIds[0]).toBe(disconnectIds[0]);
    });

    it('should close all connections when server stops', async () => {
      const port = nextPort();
      const server = trackServer(new InstallServer({ port }));
      await server.start();

      const ws1 = trackClient(await connectClient(port));
      const ws2 = trackClient(await connectClient(port));
      await waitFor(() => server.getClientCount() === 2);

      await server.stop();

      // Wait for the close events to propagate
      await waitFor(
        () =>
          ws1.readyState === WebSocket.CLOSED &&
          ws2.readyState === WebSocket.CLOSED,
      );

      expect(server.getClientCount()).toBe(0);
    });
  });

  // --------------------------------------------------------------------------
  // Message handling
  // --------------------------------------------------------------------------

  describe('Message handling', () => {
    it('should emit message event for a valid protocol message', async () => {
      const port = nextPort();
      const server = trackServer(new InstallServer({ port }));
      const received: { clientId: string; message: Message }[] = [];
      server.on('message', (clientId, message) => {
        received.push({ clientId, message });
      });

      await server.start();
      const ws = trackClient(await connectClient(port));
      await waitFor(() => server.getClientCount() === 1);

      const msg = makeSessionCreateMessage('python', '3.11');
      ws.send(JSON.stringify(msg));

      await waitFor(() => received.length === 1);
      expect(received[0].message.type).toBe(MessageType.SESSION_CREATE);
      expect((received[0].message as any).payload.software).toBe('python');
      expect((received[0].message as any).payload.version).toBe('3.11');
    });

    it('should emit error event for invalid JSON', async () => {
      const port = nextPort();
      const server = trackServer(new InstallServer({ port }));
      const errors: { clientId: string; error: Error }[] = [];
      server.on('error', (clientId, error) => {
        errors.push({ clientId, error });
      });

      await server.start();
      const ws = trackClient(await connectClient(port));
      await waitFor(() => server.getClientCount() === 1);

      ws.send('this is not valid JSON {{{');

      await waitFor(() => errors.length === 1);
      expect(errors[0].error).toBeInstanceOf(Error);
    });

    it('should emit error event for valid JSON but invalid message schema', async () => {
      const port = nextPort();
      const server = trackServer(new InstallServer({ port }));
      const errors: { clientId: string; error: Error }[] = [];
      server.on('error', (clientId, error) => {
        errors.push({ clientId, error });
      });

      await server.start();
      const ws = trackClient(await connectClient(port));
      await waitFor(() => server.getClientCount() === 1);

      // Valid JSON, but does not match any message schema
      ws.send(JSON.stringify({ type: 'unknown.type', payload: {}, timestamp: 1 }));

      await waitFor(() => errors.length === 1);
      expect(errors[0].error).toBeInstanceOf(Error);
      expect(errors[0].error.message).toContain('Invalid message');
    });

    it('should emit error with correct clientId for the sending client', async () => {
      const port = nextPort();
      const server = trackServer(new InstallServer({ port }));
      const connectionIds: string[] = [];
      const errorClientIds: string[] = [];
      server.on('connection', (id) => connectionIds.push(id));
      server.on('error', (clientId) => errorClientIds.push(clientId));

      await server.start();
      const ws = trackClient(await connectClient(port));
      await waitFor(() => connectionIds.length === 1);

      ws.send('bad json');
      await waitFor(() => errorClientIds.length === 1);

      expect(errorClientIds[0]).toBe(connectionIds[0]);
    });
  });

  // --------------------------------------------------------------------------
  // Send and broadcast
  // --------------------------------------------------------------------------

  describe('Send and broadcast', () => {
    it('should send a message to a specific client', async () => {
      const port = nextPort();
      const server = trackServer(new InstallServer({ port }));
      const connectionIds: string[] = [];
      server.on('connection', (id) => connectionIds.push(id));

      await server.start();
      const ws = trackClient(await connectClient(port));
      await waitFor(() => connectionIds.length === 1);

      const msgPromise = waitForMessage(ws);
      const msg = makeSessionCompleteMessage(true);
      server.send(connectionIds[0], msg);

      const received = JSON.parse(await msgPromise);
      expect(received.type).toBe(MessageType.SESSION_COMPLETE);
      expect(received.payload.success).toBe(true);
    });

    it('should throw when sending to a non-existent client', async () => {
      const port = nextPort();
      const server = trackServer(new InstallServer({ port }));
      await server.start();

      const msg = makeSessionCompleteMessage();
      expect(() => server.send('non-existent-id', msg)).toThrow('Client non-existent-id not found');
    });

    it('should broadcast a message to all connected clients', async () => {
      const port = nextPort();
      const server = trackServer(new InstallServer({ port }));
      await server.start();

      const ws1 = trackClient(await connectClient(port));
      const ws2 = trackClient(await connectClient(port));
      const ws3 = trackClient(await connectClient(port));
      await waitFor(() => server.getClientCount() === 3);

      const msg1Promise = waitForMessage(ws1);
      const msg2Promise = waitForMessage(ws2);
      const msg3Promise = waitForMessage(ws3);

      const msg = makeSessionCompleteMessage(false);
      server.broadcast(msg);

      const [r1, r2, r3] = await Promise.all([msg1Promise, msg2Promise, msg3Promise]);
      expect(JSON.parse(r1).type).toBe(MessageType.SESSION_COMPLETE);
      expect(JSON.parse(r2).type).toBe(MessageType.SESSION_COMPLETE);
      expect(JSON.parse(r3).type).toBe(MessageType.SESSION_COMPLETE);
    });

    it('should only send to the targeted client, not others', async () => {
      const port = nextPort();
      const server = trackServer(new InstallServer({ port }));
      const connectionIds: string[] = [];
      server.on('connection', (id) => connectionIds.push(id));

      await server.start();
      const ws1 = trackClient(await connectClient(port));
      const ws2 = trackClient(await connectClient(port));
      await waitFor(() => connectionIds.length === 2);

      const msg1Promise = waitForMessage(ws1);

      // Send to the first client only
      const msg = makeSessionCompleteMessage();
      server.send(connectionIds[0], msg);

      const received = JSON.parse(await msg1Promise);
      expect(received.type).toBe(MessageType.SESSION_COMPLETE);

      // ws2 should not get a message (wait a bit to confirm)
      let ws2Received = false;
      ws2.once('message', () => { ws2Received = true; });
      await new Promise((r) => setTimeout(r, 200));
      expect(ws2Received).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // Session management
  // --------------------------------------------------------------------------

  describe('Session management', () => {
    it('should create a session and return session info', async () => {
      const port = nextPort();
      const server = trackServer(new InstallServer({ port }));
      const connectionIds: string[] = [];
      server.on('connection', (id) => connectionIds.push(id));

      await server.start();
      trackClient(await connectClient(port));
      await waitFor(() => connectionIds.length === 1);

      const session = server.createSession(connectionIds[0], {
        software: 'node',
        version: '20.0.0',
      });

      expect(session).toBeDefined();
      expect(session.id).toBeDefined();
      expect(typeof session.id).toBe('string');
      expect(session.software).toBe('node');
      expect(session.version).toBe('20.0.0');
      expect(session.status).toBe(SessionStatus.CREATED);
      expect(session.createdAt).toBeGreaterThan(0);
      expect(session.updatedAt).toBeGreaterThan(0);
    });

    it('should increment session count when sessions are created', async () => {
      const port = nextPort();
      const server = trackServer(new InstallServer({ port }));
      const connectionIds: string[] = [];
      server.on('connection', (id) => connectionIds.push(id));

      await server.start();
      trackClient(await connectClient(port));
      trackClient(await connectClient(port));
      await waitFor(() => connectionIds.length === 2);

      expect(server.getSessionCount()).toBe(0);

      server.createSession(connectionIds[0], { software: 'node' });
      expect(server.getSessionCount()).toBe(1);

      server.createSession(connectionIds[1], { software: 'python' });
      expect(server.getSessionCount()).toBe(2);
    });

    it('should retrieve a session by ID', async () => {
      const port = nextPort();
      const server = trackServer(new InstallServer({ port }));
      const connectionIds: string[] = [];
      server.on('connection', (id) => connectionIds.push(id));

      await server.start();
      trackClient(await connectClient(port));
      await waitFor(() => connectionIds.length === 1);

      const created = server.createSession(connectionIds[0], {
        software: 'docker',
        version: '24.0',
      });

      const retrieved = server.getSession(created.id);
      expect(retrieved).toBeDefined();
      expect(retrieved!.id).toBe(created.id);
      expect(retrieved!.software).toBe('docker');
      expect(retrieved!.version).toBe('24.0');
    });

    it('should return undefined for a non-existent session', async () => {
      const port = nextPort();
      const server = trackServer(new InstallServer({ port }));
      await server.start();

      expect(server.getSession('non-existent-session-id')).toBeUndefined();
    });

    it('should associate session with client via getClientSessionId', async () => {
      const port = nextPort();
      const server = trackServer(new InstallServer({ port }));
      const connectionIds: string[] = [];
      server.on('connection', (id) => connectionIds.push(id));

      await server.start();
      trackClient(await connectClient(port));
      await waitFor(() => connectionIds.length === 1);

      expect(server.getClientSessionId(connectionIds[0])).toBeUndefined();

      const session = server.createSession(connectionIds[0], { software: 'rust' });
      expect(server.getClientSessionId(connectionIds[0])).toBe(session.id);
    });

    it('should return undefined for getClientSessionId with non-existent client', async () => {
      const port = nextPort();
      const server = trackServer(new InstallServer({ port }));
      await server.start();

      expect(server.getClientSessionId('no-such-client')).toBeUndefined();
    });

    it('should update session status', async () => {
      const port = nextPort();
      const server = trackServer(new InstallServer({ port }));
      const connectionIds: string[] = [];
      server.on('connection', (id) => connectionIds.push(id));

      await server.start();
      trackClient(await connectClient(port));
      await waitFor(() => connectionIds.length === 1);

      const session = server.createSession(connectionIds[0], { software: 'go' });
      expect(session.status).toBe(SessionStatus.CREATED);

      server.updateSessionStatus(session.id, SessionStatus.DETECTING);
      const updated = server.getSession(session.id);
      expect(updated!.status).toBe(SessionStatus.DETECTING);
      expect(updated!.updatedAt).toBeGreaterThanOrEqual(session.updatedAt);
    });

    it('should update session status through multiple transitions', async () => {
      const port = nextPort();
      const server = trackServer(new InstallServer({ port }));
      const connectionIds: string[] = [];
      server.on('connection', (id) => connectionIds.push(id));

      await server.start();
      trackClient(await connectClient(port));
      await waitFor(() => connectionIds.length === 1);

      const session = server.createSession(connectionIds[0], { software: 'java' });

      server.updateSessionStatus(session.id, SessionStatus.DETECTING);
      expect(server.getSession(session.id)!.status).toBe(SessionStatus.DETECTING);

      server.updateSessionStatus(session.id, SessionStatus.PLANNING);
      expect(server.getSession(session.id)!.status).toBe(SessionStatus.PLANNING);

      server.updateSessionStatus(session.id, SessionStatus.EXECUTING);
      expect(server.getSession(session.id)!.status).toBe(SessionStatus.EXECUTING);

      server.updateSessionStatus(session.id, SessionStatus.COMPLETED);
      expect(server.getSession(session.id)!.status).toBe(SessionStatus.COMPLETED);
    });

    it('should throw when updating status of a non-existent session', async () => {
      const port = nextPort();
      const server = trackServer(new InstallServer({ port }));
      await server.start();

      expect(() =>
        server.updateSessionStatus('no-such-session', SessionStatus.EXECUTING),
      ).toThrow('Session no-such-session not found');
    });

    it('should throw when creating a session for a non-existent client', async () => {
      const port = nextPort();
      const server = trackServer(new InstallServer({ port }));
      await server.start();

      expect(() =>
        server.createSession('no-such-client', { software: 'node' }),
      ).toThrow('Client no-such-client not found');
    });

    it('should handle session creation with optional version (undefined)', async () => {
      const port = nextPort();
      const server = trackServer(new InstallServer({ port }));
      const connectionIds: string[] = [];
      server.on('connection', (id) => connectionIds.push(id));

      await server.start();
      trackClient(await connectClient(port));
      await waitFor(() => connectionIds.length === 1);

      const session = server.createSession(connectionIds[0], { software: 'node' });
      expect(session.software).toBe('node');
      expect(session.version).toBeUndefined();
    });

    it('should handle session creation with explicit version', async () => {
      const port = nextPort();
      const server = trackServer(new InstallServer({ port }));
      const connectionIds: string[] = [];
      server.on('connection', (id) => connectionIds.push(id));

      await server.start();
      trackClient(await connectClient(port));
      await waitFor(() => connectionIds.length === 1);

      const session = server.createSession(connectionIds[0], {
        software: 'python',
        version: '3.12.1',
      });
      expect(session.version).toBe('3.12.1');
    });

    it('should generate unique session IDs for each session', async () => {
      const port = nextPort();
      const server = trackServer(new InstallServer({ port }));
      const connectionIds: string[] = [];
      server.on('connection', (id) => connectionIds.push(id));

      await server.start();
      trackClient(await connectClient(port));
      trackClient(await connectClient(port));
      await waitFor(() => connectionIds.length === 2);

      const s1 = server.createSession(connectionIds[0], { software: 'a' });
      const s2 = server.createSession(connectionIds[1], { software: 'b' });
      expect(s1.id).not.toBe(s2.id);
    });
  });

  // --------------------------------------------------------------------------
  // Heartbeat mechanism
  // --------------------------------------------------------------------------

  describe('Heartbeat mechanism', () => {
    it('should terminate clients that do not respond to pings', async () => {
      const port = nextPort();
      const server = trackServer(
        new InstallServer({
          port,
          heartbeatIntervalMs: 100,
          connectionTimeoutMs: 50,
        }),
      );
      const disconnectIds: string[] = [];
      server.on('disconnect', (id) => disconnectIds.push(id));

      await server.start();

      // Create a client that does NOT respond to pongs.
      // The ws library sends automatic pong at the protocol level.
      // To suppress it, we must override the underlying socket's pong behavior
      // by intercepting frames before they are auto-responded.
      const ws = new WebSocket(`ws://127.0.0.1:${port}`, {
        // Disable auto-pong by intercepting at the socket level
      });
      trackClient(ws);

      await new Promise<void>((resolve) => ws.on('open', resolve));
      await waitFor(() => server.getClientCount() === 1);

      // Access internal socket and prevent automatic pong by overriding the
      // receiver's pong handling. The ws library auto-pongs at the Receiver level.
      // We can disable it by replacing the pong method on the socket.
      const rawSocket = (ws as any)._socket;
      if (rawSocket) {
        // Monkey-patch: intercept all writes to suppress automatic pong frames.
        // The ws library auto-responds with a pong at the C++ level of the Receiver,
        // so instead we close the underlying socket's write path for pong.
        const originalWrite = rawSocket.write.bind(rawSocket);
        rawSocket.write = (data: any, ...args: any[]) => {
          // Pong frame starts with 0x8A in WebSocket protocol
          if (Buffer.isBuffer(data) && data.length >= 1 && (data[0] & 0x0F) === 0x0A) {
            return true; // swallow pong frames
          }
          return originalWrite(data, ...args);
        };
      }

      // First heartbeat: sets isAlive=false and pings
      // Second heartbeat: sees isAlive still false, terminates
      await waitFor(() => server.getClientCount() === 0, 5000);
      expect(disconnectIds.length).toBeGreaterThanOrEqual(1);
    });

    it('should keep alive clients that respond to pings', async () => {
      const port = nextPort();
      const server = trackServer(
        new InstallServer({
          port,
          heartbeatIntervalMs: 100,
          connectionTimeoutMs: 50,
        }),
      );

      await server.start();

      // Default WebSocket client automatically responds to pings with pongs
      const ws = trackClient(await connectClient(port));
      await waitFor(() => server.getClientCount() === 1);

      // Wait long enough for multiple heartbeat cycles
      await new Promise((r) => setTimeout(r, 500));

      // Client should still be connected
      expect(server.getClientCount()).toBe(1);
      expect(ws.readyState).toBe(WebSocket.OPEN);
    });
  });

  // --------------------------------------------------------------------------
  // Constructor options
  // --------------------------------------------------------------------------

  describe('Constructor options', () => {
    it('should accept all options', async () => {
      const port = nextPort();
      const server = trackServer(
        new InstallServer({
          port,
          host: '127.0.0.1',
          heartbeatIntervalMs: 5000,
          connectionTimeoutMs: 3000,
        }),
      );

      await server.start();
      expect(server.isRunning()).toBe(true);

      // Verify the server is reachable on the specified port
      const ws = trackClient(await connectClient(port));
      await waitFor(() => server.getClientCount() === 1);
      expect(server.getClientCount()).toBe(1);
    });

    it('should apply default values when optional options are omitted', async () => {
      const port = nextPort();
      const server = trackServer(new InstallServer({ port }));
      await server.start();
      expect(server.isRunning()).toBe(true);

      // Verify it is reachable (default host 0.0.0.0)
      const ws = trackClient(await connectClient(port));
      await waitFor(() => server.getClientCount() === 1);
      expect(server.getClientCount()).toBe(1);
    });

    it('should use provided port', async () => {
      const port = nextPort();
      const server = trackServer(new InstallServer({ port }));
      await server.start();

      // Connect on the specified port
      const ws = trackClient(await connectClient(port));
      await waitFor(() => server.getClientCount() === 1);
      expect(server.getClientCount()).toBe(1);
    });
  });

  // --------------------------------------------------------------------------
  // Edge cases
  // --------------------------------------------------------------------------

  describe('Edge cases', () => {
    it('should handle rapid connect and disconnect', async () => {
      const port = nextPort();
      const server = trackServer(new InstallServer({ port }));
      await server.start();

      const connectPromises: Promise<WebSocket>[] = [];
      for (let i = 0; i < 5; i++) {
        connectPromises.push(connectClient(port));
      }

      const allWs = await Promise.all(connectPromises);
      for (const ws of allWs) {
        trackClient(ws);
      }
      await waitFor(() => server.getClientCount() === 5);

      // Close them all rapidly
      for (const ws of allWs) {
        ws.close();
      }

      await waitFor(() => server.getClientCount() === 0, 5000);
      expect(server.getClientCount()).toBe(0);
    });

    it('should handle multiple messages from the same client', async () => {
      const port = nextPort();
      const server = trackServer(new InstallServer({ port }));
      const received: Message[] = [];
      server.on('message', (_clientId, message) => {
        received.push(message);
      });

      await server.start();
      const ws = trackClient(await connectClient(port));
      await waitFor(() => server.getClientCount() === 1);

      const msg1 = makeSessionCreateMessage('node', '20');
      const msg2 = makeSessionCompleteMessage(true);

      ws.send(JSON.stringify(msg1));
      ws.send(JSON.stringify(msg2));

      await waitFor(() => received.length === 2);
      expect(received[0].type).toBe(MessageType.SESSION_CREATE);
      expect(received[1].type).toBe(MessageType.SESSION_COMPLETE);
    });

    it('should handle broadcast with no connected clients without error', async () => {
      const port = nextPort();
      const server = trackServer(new InstallServer({ port }));
      await server.start();

      expect(server.getClientCount()).toBe(0);
      // Should not throw
      server.broadcast(makeSessionCompleteMessage());
    });

    it('should support multiple event listeners for the same event', async () => {
      const port = nextPort();
      const server = trackServer(new InstallServer({ port }));
      const ids1: string[] = [];
      const ids2: string[] = [];
      const ids3: string[] = [];

      server.on('connection', (id) => ids1.push(id));
      server.on('connection', (id) => ids2.push(id));
      server.on('connection', (id) => ids3.push(id));

      await server.start();
      trackClient(await connectClient(port));
      await waitFor(() => ids1.length === 1);

      expect(ids1).toHaveLength(1);
      expect(ids2).toHaveLength(1);
      expect(ids3).toHaveLength(1);
      expect(ids1[0]).toBe(ids2[0]);
      expect(ids2[0]).toBe(ids3[0]);
    });

    it('should handle connect, send, disconnect in rapid succession', async () => {
      const port = nextPort();
      const server = trackServer(new InstallServer({ port }));
      const received: Message[] = [];
      server.on('message', (_clientId, msg) => received.push(msg));

      await server.start();
      const ws = trackClient(await connectClient(port));
      await waitFor(() => server.getClientCount() === 1);

      const msg = makeSessionCreateMessage('redis');
      ws.send(JSON.stringify(msg));
      ws.close();

      // Message may or may not arrive depending on timing, but server should not crash
      await waitFor(() => server.getClientCount() === 0);
      expect(server.getClientCount()).toBe(0);
    });

    it('should have zero client count initially', async () => {
      const port = nextPort();
      const server = trackServer(new InstallServer({ port }));
      await server.start();

      expect(server.getClientCount()).toBe(0);
    });

    it('should have zero session count initially', async () => {
      const port = nextPort();
      const server = trackServer(new InstallServer({ port }));
      await server.start();

      expect(server.getSessionCount()).toBe(0);
    });

    it('should handle multiple clients connecting and creating sessions', async () => {
      const port = nextPort();
      const server = trackServer(new InstallServer({ port }));
      const connectionIds: string[] = [];
      server.on('connection', (id) => connectionIds.push(id));

      await server.start();
      trackClient(await connectClient(port));
      trackClient(await connectClient(port));
      trackClient(await connectClient(port));
      await waitFor(() => connectionIds.length === 3);

      const s1 = server.createSession(connectionIds[0], { software: 'node' });
      const s2 = server.createSession(connectionIds[1], { software: 'python' });
      const s3 = server.createSession(connectionIds[2], { software: 'go' });

      expect(server.getSessionCount()).toBe(3);
      expect(server.getClientSessionId(connectionIds[0])).toBe(s1.id);
      expect(server.getClientSessionId(connectionIds[1])).toBe(s2.id);
      expect(server.getClientSessionId(connectionIds[2])).toBe(s3.id);
    });

    it('should generate unique client IDs for each connection', async () => {
      const port = nextPort();
      const server = trackServer(new InstallServer({ port }));
      const connectionIds: string[] = [];
      server.on('connection', (id) => connectionIds.push(id));

      await server.start();
      trackClient(await connectClient(port));
      trackClient(await connectClient(port));
      trackClient(await connectClient(port));
      await waitFor(() => connectionIds.length === 3);

      const uniqueIds = new Set(connectionIds);
      expect(uniqueIds.size).toBe(3);
    });

    it('should handle sending to a client that just disconnected', async () => {
      const port = nextPort();
      const server = trackServer(new InstallServer({ port }));
      const connectionIds: string[] = [];
      server.on('connection', (id) => connectionIds.push(id));

      await server.start();
      const ws = trackClient(await connectClient(port));
      await waitFor(() => connectionIds.length === 1);

      ws.close();
      await waitFor(() => server.getClientCount() === 0);

      // Now the client is gone, sending should throw
      expect(() =>
        server.send(connectionIds[0], makeSessionCompleteMessage()),
      ).toThrow(`Client ${connectionIds[0]} not found`);
    });
  });
});
