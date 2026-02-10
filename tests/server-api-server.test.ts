/**
 * Tests for packages/server/src/api/server.ts
 *
 * Tests the InstallServer class including:
 * - Server lifecycle (start/stop)
 * - WebSocket connection management
 * - Session management
 * - Heartbeat mechanism
 * - Message handling and validation
 * - Broadcasting
 * - Event system
 */

import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import WebSocket from 'ws';
import { createMessage, MessageType } from '@aiinstaller/shared';
import { InstallServer } from '../packages/server/src/api/server.js';

const SERVER_FILE = path.resolve('packages/server/src/api/server.ts');

// Helper: wait for a condition with timeout
function waitFor(
  condition: () => boolean,
  timeoutMs = 2000,
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

// Helper: create a connected WebSocket client
function connectClient(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

// Helper: wait for a WebSocket message
function waitForMessage(ws: WebSocket, timeoutMs = 2000): Promise<string> {
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

// Use a dynamic port to avoid conflicts
let testPort = 19200;
function nextPort() {
  return testPort++;
}

// ============================================================================
// Tests
// ============================================================================

describe('src/api/server.ts', () => {
  // --------------------------------------------------------------------------
  // File existence and structure
  // --------------------------------------------------------------------------

  describe('File existence', () => {
    it('should exist at packages/server/src/api/server.ts', () => {
      expect(existsSync(SERVER_FILE)).toBe(true);
    });

    it('should be a non-empty TypeScript file', () => {
      const content = readFileSync(SERVER_FILE, 'utf-8');
      expect(content.length).toBeGreaterThan(0);
    });
  });

  describe('Exports', () => {
    it('should export InstallServer class', () => {
      expect(InstallServer).toBeDefined();
      expect(typeof InstallServer).toBe('function');
    });

    it('should be instantiable with options', () => {
      const server = new InstallServer({ port: nextPort() });
      expect(server).toBeDefined();
      expect(server).toBeInstanceOf(InstallServer);
    });
  });

  // --------------------------------------------------------------------------
  // Server lifecycle
  // --------------------------------------------------------------------------

  describe('Server lifecycle', () => {
    let server: InstallServer;

    afterEach(async () => {
      if (server?.isRunning()) {
        await server.stop();
      }
    });

    it('should start and report isRunning as true', async () => {
      server = new InstallServer({ port: nextPort() });
      expect(server.isRunning()).toBe(false);
      await server.start();
      expect(server.isRunning()).toBe(true);
    });

    it('should stop and report isRunning as false', async () => {
      server = new InstallServer({ port: nextPort() });
      await server.start();
      expect(server.isRunning()).toBe(true);
      await server.stop();
      expect(server.isRunning()).toBe(false);
    });

    it('should reject starting a server that is already running', async () => {
      server = new InstallServer({ port: nextPort() });
      await server.start();
      await expect(server.start()).rejects.toThrow('already running');
    });

    it('should handle stop when server is not running', async () => {
      server = new InstallServer({ port: nextPort() });
      await server.stop();
      expect(server.isRunning()).toBe(false);
    });

    it('should accept connections after starting', async () => {
      const port = nextPort();
      server = new InstallServer({ port });
      await server.start();
      const ws = await connectClient(port);
      expect(ws.readyState).toBe(WebSocket.OPEN);
      ws.close();
    });
  });

  // --------------------------------------------------------------------------
  // Connection management
  // --------------------------------------------------------------------------

  describe('Connection management', () => {
    let server: InstallServer;
    let port: number;

    afterEach(async () => {
      if (server?.isRunning()) {
        await server.stop();
      }
    });

    it('should track connected clients', async () => {
      port = nextPort();
      server = new InstallServer({ port });
      await server.start();

      expect(server.getClientCount()).toBe(0);

      const ws1 = await connectClient(port);
      await waitFor(() => server.getClientCount() === 1);
      expect(server.getClientCount()).toBe(1);

      const ws2 = await connectClient(port);
      await waitFor(() => server.getClientCount() === 2);
      expect(server.getClientCount()).toBe(2);

      ws1.close();
      ws2.close();
    });

    it('should remove client on disconnect', async () => {
      port = nextPort();
      server = new InstallServer({ port });
      await server.start();

      const ws = await connectClient(port);
      await waitFor(() => server.getClientCount() === 1);

      ws.close();
      await waitFor(() => server.getClientCount() === 0);
      expect(server.getClientCount()).toBe(0);
    });

    it('should emit connection event when client connects', async () => {
      port = nextPort();
      server = new InstallServer({ port });
      await server.start();

      const connectionIds: string[] = [];
      server.on('connection', (clientId: string) => {
        connectionIds.push(clientId);
      });

      const ws = await connectClient(port);
      await waitFor(() => connectionIds.length === 1);

      expect(connectionIds).toHaveLength(1);
      expect(typeof connectionIds[0]).toBe('string');
      expect(connectionIds[0].length).toBeGreaterThan(0);

      ws.close();
    });

    it('should emit disconnect event when client disconnects', async () => {
      port = nextPort();
      server = new InstallServer({ port });
      await server.start();

      const disconnectIds: string[] = [];
      server.on('disconnect', (clientId: string) => {
        disconnectIds.push(clientId);
      });

      const ws = await connectClient(port);
      await waitFor(() => server.getClientCount() === 1);

      ws.close();
      await waitFor(() => disconnectIds.length === 1);

      expect(disconnectIds).toHaveLength(1);
    });

    it('should close all clients on server stop', async () => {
      port = nextPort();
      server = new InstallServer({ port });
      await server.start();

      const ws1 = await connectClient(port);
      const ws2 = await connectClient(port);
      await waitFor(() => server.getClientCount() === 2);

      await server.stop();
      await new Promise((r) => setTimeout(r, 200));

      expect(ws1.readyState).not.toBe(WebSocket.OPEN);
      expect(ws2.readyState).not.toBe(WebSocket.OPEN);
    });
  });

  // --------------------------------------------------------------------------
  // Message handling
  // --------------------------------------------------------------------------

  describe('Message handling', () => {
    let server: InstallServer;
    let port: number;

    afterEach(async () => {
      if (server?.isRunning()) {
        await server.stop();
      }
    });

    it('should emit message event for valid protocol messages', async () => {
      port = nextPort();
      server = new InstallServer({ port });
      await server.start();

      const receivedMessages: { clientId: string; message: unknown }[] = [];
      server.on('message', (clientId: string, message: unknown) => {
        receivedMessages.push({ clientId, message });
      });

      const ws = await connectClient(port);
      await waitFor(() => server.getClientCount() === 1);

      const msg = createMessage(MessageType.SESSION_CREATE, {
        software: 'openclaw',
      });
      ws.send(JSON.stringify(msg));

      await waitFor(() => receivedMessages.length === 1);

      expect(receivedMessages[0].message).toBeDefined();
      expect((receivedMessages[0].message as { type: string }).type).toBe(
        'session.create',
      );

      ws.close();
    });

    it('should emit error event for invalid JSON', async () => {
      port = nextPort();
      server = new InstallServer({ port });
      await server.start();

      const errors: { clientId: string; error: Error }[] = [];
      server.on('error', (clientId: string, error: Error) => {
        errors.push({ clientId, error });
      });

      const ws = await connectClient(port);
      await waitFor(() => server.getClientCount() === 1);

      ws.send('not valid json {{{');

      await waitFor(() => errors.length === 1);
      expect(errors[0].error).toBeInstanceOf(Error);

      ws.close();
    });

    it('should emit error event for invalid message schema', async () => {
      port = nextPort();
      server = new InstallServer({ port });
      await server.start();

      const errors: { clientId: string; error: Error }[] = [];
      server.on('error', (clientId: string, error: Error) => {
        errors.push({ clientId, error });
      });

      const ws = await connectClient(port);
      await waitFor(() => server.getClientCount() === 1);

      ws.send(JSON.stringify({ type: 'invalid.type', payload: {} }));

      await waitFor(() => errors.length === 1);
      expect(errors[0].error).toBeInstanceOf(Error);
      expect(errors[0].error.message).toContain('Invalid message');

      ws.close();
    });
  });

  // --------------------------------------------------------------------------
  // Send and Broadcast
  // --------------------------------------------------------------------------

  describe('Send and Broadcast', () => {
    let server: InstallServer;
    let port: number;

    afterEach(async () => {
      if (server?.isRunning()) {
        await server.stop();
      }
    });

    it('should send a message to a specific client', async () => {
      port = nextPort();
      server = new InstallServer({ port });
      await server.start();

      let targetClientId = '';
      server.on('connection', (clientId: string) => {
        targetClientId = clientId;
      });

      const ws = await connectClient(port);
      await waitFor(() => targetClientId !== '');

      const messagePromise = waitForMessage(ws);

      const msg = createMessage(MessageType.PLAN_RECEIVE, {
        steps: [],
        estimatedTime: 0,
        risks: [],
      });
      server.send(targetClientId, msg);

      const received = await messagePromise;
      const parsed = JSON.parse(received);
      expect(parsed.type).toBe('plan.receive');

      ws.close();
    });

    it('should throw when sending to non-existent client', async () => {
      port = nextPort();
      server = new InstallServer({ port });
      await server.start();

      const msg = createMessage(MessageType.PLAN_RECEIVE, {
        steps: [],
        estimatedTime: 0,
        risks: [],
      });

      expect(() => server.send('nonexistent-id', msg)).toThrow('not found');
    });

    it('should broadcast a message to all connected clients', async () => {
      port = nextPort();
      server = new InstallServer({ port });
      await server.start();

      const ws1 = await connectClient(port);
      const ws2 = await connectClient(port);
      await waitFor(() => server.getClientCount() === 2);

      const msg1Promise = waitForMessage(ws1);
      const msg2Promise = waitForMessage(ws2);

      const msg = createMessage(MessageType.SESSION_COMPLETE, {
        success: true,
        summary: 'All done',
      });
      server.broadcast(msg);

      const [received1, received2] = await Promise.all([
        msg1Promise,
        msg2Promise,
      ]);
      expect(JSON.parse(received1).type).toBe('session.complete');
      expect(JSON.parse(received2).type).toBe('session.complete');

      ws1.close();
      ws2.close();
    });
  });

  // --------------------------------------------------------------------------
  // Session management
  // --------------------------------------------------------------------------

  describe('Session management', () => {
    let server: InstallServer;
    let port: number;

    afterEach(async () => {
      if (server?.isRunning()) {
        await server.stop();
      }
    });

    it('should create a session for a client', async () => {
      port = nextPort();
      server = new InstallServer({ port });
      await server.start();

      let clientId = '';
      server.on('connection', (id: string) => {
        clientId = id;
      });

      const ws = await connectClient(port);
      await waitFor(() => clientId !== '');

      const session = server.createSession(clientId, {
        software: 'openclaw',
        version: '1.0.0',
      });

      expect(session).toBeDefined();
      expect(session.id).toBeDefined();
      expect(typeof session.id).toBe('string');
      expect(session.software).toBe('openclaw');
      expect(session.version).toBe('1.0.0');
      expect(session.status).toBe('created');
      expect(session.createdAt).toBeGreaterThan(0);
      expect(session.updatedAt).toBeGreaterThan(0);

      ws.close();
    });

    it('should track session count', async () => {
      port = nextPort();
      server = new InstallServer({ port });
      await server.start();

      let clientId = '';
      server.on('connection', (id: string) => {
        clientId = id;
      });

      const ws = await connectClient(port);
      await waitFor(() => clientId !== '');

      expect(server.getSessionCount()).toBe(0);

      server.createSession(clientId, { software: 'openclaw' });
      expect(server.getSessionCount()).toBe(1);

      ws.close();
    });

    it('should retrieve a session by ID', async () => {
      port = nextPort();
      server = new InstallServer({ port });
      await server.start();

      let clientId = '';
      server.on('connection', (id: string) => {
        clientId = id;
      });

      const ws = await connectClient(port);
      await waitFor(() => clientId !== '');

      const created = server.createSession(clientId, {
        software: 'openclaw',
      });
      const retrieved = server.getSession(created.id);

      expect(retrieved).toBeDefined();
      expect(retrieved!.id).toBe(created.id);
      expect(retrieved!.software).toBe('openclaw');

      ws.close();
    });

    it('should return undefined for non-existent session', async () => {
      port = nextPort();
      server = new InstallServer({ port });
      await server.start();

      expect(server.getSession('nonexistent')).toBeUndefined();
    });

    it('should associate session with client', async () => {
      port = nextPort();
      server = new InstallServer({ port });
      await server.start();

      let clientId = '';
      server.on('connection', (id: string) => {
        clientId = id;
      });

      const ws = await connectClient(port);
      await waitFor(() => clientId !== '');

      const session = server.createSession(clientId, {
        software: 'openclaw',
      });

      expect(server.getClientSessionId(clientId)).toBe(session.id);

      ws.close();
    });

    it('should update session status', async () => {
      port = nextPort();
      server = new InstallServer({ port });
      await server.start();

      let clientId = '';
      server.on('connection', (id: string) => {
        clientId = id;
      });

      const ws = await connectClient(port);
      await waitFor(() => clientId !== '');

      const session = server.createSession(clientId, {
        software: 'openclaw',
      });
      expect(session.status).toBe('created');

      server.updateSessionStatus(session.id, 'detecting');
      const updated = server.getSession(session.id);
      expect(updated!.status).toBe('detecting');
      expect(updated!.updatedAt).toBeGreaterThanOrEqual(session.createdAt);

      ws.close();
    });

    it('should throw when updating non-existent session', async () => {
      port = nextPort();
      server = new InstallServer({ port });
      await server.start();

      expect(() =>
        server.updateSessionStatus('nonexistent', 'detecting'),
      ).toThrow('not found');
    });

    it('should throw when creating session for non-existent client', async () => {
      port = nextPort();
      server = new InstallServer({ port });
      await server.start();

      expect(() =>
        server.createSession('nonexistent', { software: 'openclaw' }),
      ).toThrow('not found');
    });

    it('should create session without version', async () => {
      port = nextPort();
      server = new InstallServer({ port });
      await server.start();

      let clientId = '';
      server.on('connection', (id: string) => {
        clientId = id;
      });

      const ws = await connectClient(port);
      await waitFor(() => clientId !== '');

      const session = server.createSession(clientId, {
        software: 'openclaw',
      });
      expect(session.version).toBeUndefined();

      ws.close();
    });
  });

  // --------------------------------------------------------------------------
  // Heartbeat mechanism
  // --------------------------------------------------------------------------

  describe('Heartbeat mechanism', () => {
    let server: InstallServer;

    afterEach(async () => {
      if (server?.isRunning()) {
        await server.stop();
      }
    });

    it('should start heartbeat when server starts', async () => {
      const port = nextPort();
      server = new InstallServer({
        port,
        heartbeatIntervalMs: 100,
      });

      await server.start();
      const ws = await connectClient(port);
      expect(ws.readyState).toBe(WebSocket.OPEN);

      ws.close();
    });

    it('should terminate clients that do not respond to ping', async () => {
      const port = nextPort();
      server = new InstallServer({
        port,
        heartbeatIntervalMs: 100,
      });

      await server.start();

      // Connect a client, then immediately close the underlying socket
      // without sending a proper close frame. This simulates a dead connection
      // that the heartbeat should detect and clean up.
      const ws = new WebSocket(`ws://127.0.0.1:${port}`);
      await new Promise<void>((resolve) => ws.on('open', resolve));

      await waitFor(() => server.getClientCount() === 1);

      // Destroy the underlying socket to simulate a dead connection.
      // The server won't get a close event, so it must rely on heartbeat.
      (ws as unknown as { _socket: { destroy: () => void } })._socket.destroy();

      // Wait for heartbeat to detect the dead connection:
      // 1st interval: sets isAlive=false, sends ping (which will fail)
      // 2nd interval: sees isAlive still false, terminates
      await new Promise((r) => setTimeout(r, 350));

      expect(server.getClientCount()).toBe(0);
    });

    it('should keep alive clients that respond to ping', async () => {
      const port = nextPort();
      server = new InstallServer({
        port,
        heartbeatIntervalMs: 100,
      });

      await server.start();

      const ws = await connectClient(port);
      await waitFor(() => server.getClientCount() === 1);

      // Wait for a few heartbeat intervals
      await new Promise((r) => setTimeout(r, 350));

      // Client should still be connected because it responds to pings
      expect(server.getClientCount()).toBe(1);

      ws.close();
    });
  });

  // --------------------------------------------------------------------------
  // Constructor options
  // --------------------------------------------------------------------------

  describe('Constructor options', () => {
    it('should accept all configuration options', () => {
      const server = new InstallServer({
        port: nextPort(),
        host: '127.0.0.1',
        heartbeatIntervalMs: 5000,
        connectionTimeoutMs: 3000,
      });

      expect(server).toBeDefined();
      expect(server.isRunning()).toBe(false);
    });

    it('should use default values when options are not provided', async () => {
      const server = new InstallServer({ port: nextPort() });

      await server.start();
      expect(server.isRunning()).toBe(true);
      await server.stop();
    });
  });

  // --------------------------------------------------------------------------
  // Edge cases
  // --------------------------------------------------------------------------

  describe('Edge cases', () => {
    let server: InstallServer;
    let port: number;

    afterEach(async () => {
      if (server?.isRunning()) {
        await server.stop();
      }
    });

    it('should handle rapid connect/disconnect', async () => {
      port = nextPort();
      server = new InstallServer({ port });
      await server.start();

      const connections: WebSocket[] = [];
      for (let i = 0; i < 5; i++) {
        connections.push(await connectClient(port));
      }
      await waitFor(() => server.getClientCount() === 5);

      for (const ws of connections) {
        ws.close();
      }
      await waitFor(() => server.getClientCount() === 0);
    });

    it('should handle multiple messages from same client', async () => {
      port = nextPort();
      server = new InstallServer({ port });
      await server.start();

      const messages: unknown[] = [];
      server.on('message', (_clientId: string, message: unknown) => {
        messages.push(message);
      });

      const ws = await connectClient(port);
      await waitFor(() => server.getClientCount() === 1);

      for (let i = 0; i < 3; i++) {
        const msg = createMessage(MessageType.SESSION_CREATE, {
          software: `test-${i}`,
        });
        ws.send(JSON.stringify(msg));
      }

      await waitFor(() => messages.length === 3);
      expect(messages).toHaveLength(3);

      ws.close();
    });

    it('should return undefined for non-existent client session', async () => {
      port = nextPort();
      server = new InstallServer({ port });
      await server.start();

      expect(server.getClientSessionId('nonexistent')).toBeUndefined();
    });

    it('should handle empty broadcast (no clients)', async () => {
      port = nextPort();
      server = new InstallServer({ port });
      await server.start();

      const msg = createMessage(MessageType.SESSION_COMPLETE, {
        success: true,
      });
      expect(() => server.broadcast(msg)).not.toThrow();
    });

    it('should support multiple event listeners for the same event', async () => {
      port = nextPort();
      server = new InstallServer({ port });
      await server.start();

      const ids1: string[] = [];
      const ids2: string[] = [];
      server.on('connection', (id: string) => ids1.push(id));
      server.on('connection', (id: string) => ids2.push(id));

      const ws = await connectClient(port);
      await waitFor(() => ids1.length === 1 && ids2.length === 1);

      expect(ids1).toHaveLength(1);
      expect(ids2).toHaveLength(1);
      expect(ids1[0]).toBe(ids2[0]);

      ws.close();
    });
  });

  // --------------------------------------------------------------------------
  // Code quality
  // --------------------------------------------------------------------------

  describe('Code quality', () => {
    it('should use proper imports from @aiinstaller/shared', () => {
      const content = readFileSync(SERVER_FILE, 'utf-8');
      expect(content).toContain("from '@aiinstaller/shared'");
    });

    it('should import WebSocketServer from ws', () => {
      const content = readFileSync(SERVER_FILE, 'utf-8');
      expect(content).toContain("from 'ws'");
      expect(content).toContain('WebSocketServer');
    });

    it('should have JSDoc comments on public methods', () => {
      const content = readFileSync(SERVER_FILE, 'utf-8');
      expect(content).toContain('* Start the WebSocket server');
      expect(content).toContain('* Stop the WebSocket server');
      expect(content).toContain('* Send a message to a specific client');
      expect(content).toContain('* Broadcast a message');
      expect(content).toContain('* Create a new installation session');
    });

    it('should use randomUUID for ID generation', () => {
      const content = readFileSync(SERVER_FILE, 'utf-8');
      expect(content).toContain('randomUUID');
    });

    it('should implement heartbeat with ping/pong', () => {
      const content = readFileSync(SERVER_FILE, 'utf-8');
      expect(content).toContain('.ping()');
      expect(content).toContain("'pong'");
    });
  });
});
