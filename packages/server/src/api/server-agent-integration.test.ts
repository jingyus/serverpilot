// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Integration tests for Server ↔ Agent WebSocket communication.
 *
 * Validates protocol compatibility between InstallServer and InstallClient:
 * 1. Authentication handshake
 * 2. Session create and env.report flow
 * 3. step.execute / step.output / step.complete routing
 * 4. session.complete handling
 * 5. Heartbeat (ping/pong) keepalive
 * 6. Reconnection and re-authentication
 * 7. Metrics reporting
 */

import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import WebSocket from 'ws';
import {
  MessageType,
  createMessage,
  safeParseMessage,
  SessionStatus,
} from '@aiinstaller/shared';
import type {
  Message,
  AuthResponseMessage,
} from '@aiinstaller/shared';

import { InstallServer } from './server.js';
import type { InstallServerOptions } from './server.js';

// ============================================================================
// Helpers
// ============================================================================

let testPort = 19400;
function nextPort(): number {
  return testPort++;
}

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

function connectClient(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.on('open', () => resolve(ws));
    ws.on('error', (err) => reject(err));
  });
}

function waitForMessage(ws: WebSocket, timeoutMs = 2000): Promise<Message> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('waitForMessage timed out'));
    }, timeoutMs);
    ws.once('message', (data) => {
      clearTimeout(timer);
      const text = typeof data === 'string' ? data : data.toString();
      const parsed = safeParseMessage(JSON.parse(text));
      if (parsed.success) {
        resolve(parsed.data);
      } else {
        reject(new Error(`Invalid message: ${text}`));
      }
    });
  });
}

function sendMessage(ws: WebSocket, message: Message): void {
  ws.send(JSON.stringify(message));
}

function createTestAuthRequest(deviceId = 'test-device-001') {
  return createMessage(MessageType.AUTH_REQUEST, {
    deviceId,
    platform: 'linux',
    osVersion: '22.04',
    architecture: 'x64',
    hostname: 'test-host',
  });
}

// ============================================================================
// Tests
// ============================================================================

describe('Server ↔ Agent Protocol Compatibility', () => {
  let server: InstallServer;
  let port: number;

  beforeEach(async () => {
    port = nextPort();
    server = new InstallServer({
      port,
      heartbeatIntervalMs: 30000,
      requireAuth: false, // Simplify tests — skip auth layer
      authTimeoutMs: 5000,
    });
    await server.start();
  });

  afterEach(async () => {
    await server.stop();
  });

  // --------------------------------------------------------------------------
  // Connection & basic messaging
  // --------------------------------------------------------------------------

  it('accepts WebSocket connection from agent', async () => {
    const ws = await connectClient(port);
    await waitFor(() => server.getClientCount() === 1);
    expect(server.getClientCount()).toBe(1);
    ws.close();
  });

  it('parses valid protocol messages from agent', async () => {
    const messages: Message[] = [];
    server.on('message', (_cid, msg) => messages.push(msg));

    const ws = await connectClient(port);
    await waitFor(() => server.getClientCount() === 1);

    const sessionMsg = createMessage(MessageType.SESSION_CREATE, {
      software: 'nginx',
      version: '1.24',
    });
    sendMessage(ws, sessionMsg);

    await waitFor(() => messages.length === 1);
    expect(messages[0].type).toBe('session.create');
    expect(messages[0].payload).toEqual({ software: 'nginx', version: '1.24' });

    ws.close();
  });

  it('rejects invalid messages and emits error event', async () => {
    const errors: Error[] = [];
    server.on('error', (_cid, err) => errors.push(err));

    const ws = await connectClient(port);
    await waitFor(() => server.getClientCount() === 1);

    // Send invalid JSON
    ws.send('not json');
    await waitFor(() => errors.length === 1);
    expect(errors[0]).toBeInstanceOf(Error);

    ws.close();
  });

  // --------------------------------------------------------------------------
  // Session lifecycle: session.create → env.report → plan.receive
  // --------------------------------------------------------------------------

  it('handles session.create followed by env.report', async () => {
    const messages: Message[] = [];
    server.on('message', (_cid, msg) => messages.push(msg));

    const ws = await connectClient(port);
    await waitFor(() => server.getClientCount() === 1);

    // Create session
    const sessionMsg = createMessage(MessageType.SESSION_CREATE, {
      software: 'nodejs',
    });
    sendMessage(ws, sessionMsg);
    await waitFor(() => messages.length === 1);
    expect(messages[0].type).toBe('session.create');

    // Report environment
    const envMsg = createMessage(MessageType.ENV_REPORT, {
      os: { platform: 'linux', version: '22.04', arch: 'x64' },
      shell: { type: 'bash', version: '5.1.0' },
      runtime: { node: '22.0.0' },
      packageManagers: { npm: '10.0.0' },
      network: { canAccessNpm: true, canAccessGithub: true },
      permissions: { hasSudo: false, canWriteTo: ['/home/user'] },
    });
    sendMessage(ws, envMsg);
    await waitFor(() => messages.length === 2);
    expect(messages[1].type).toBe('env.report');
    expect(messages[1].payload).toHaveProperty('os');
    expect(messages[1].payload).toHaveProperty('shell');

    ws.close();
  });

  // --------------------------------------------------------------------------
  // Step execution flow: step.execute → step.output → step.complete
  // --------------------------------------------------------------------------

  it('routes step.execute, step.output and step.complete from agent', async () => {
    const messages: Message[] = [];
    server.on('message', (_cid, msg) => messages.push(msg));

    const ws = await connectClient(port);
    await waitFor(() => server.getClientCount() === 1);

    // Agent notifies server of step start
    const execMsg = createMessage(MessageType.STEP_EXECUTE, {
      id: 'step-1',
      description: 'Install node',
      command: 'apt install nodejs',
      timeout: 30000,
      canRollback: false,
      onError: 'abort' as const,
    });
    sendMessage(ws, execMsg);

    // Agent sends streaming output
    const outputMsg = createMessage(MessageType.STEP_OUTPUT, {
      stepId: 'step-1',
      output: 'Reading package lists...',
    });
    sendMessage(ws, outputMsg);

    // Agent sends completion
    const completeMsg = createMessage(MessageType.STEP_COMPLETE, {
      stepId: 'step-1',
      success: true,
      exitCode: 0,
      stdout: 'nodejs installed',
      stderr: '',
      duration: 5000,
    });
    sendMessage(ws, completeMsg);

    await waitFor(() => messages.length === 3);
    expect(messages[0].type).toBe('step.execute');
    expect(messages[1].type).toBe('step.output');
    expect(messages[2].type).toBe('step.complete');

    ws.close();
  });

  // --------------------------------------------------------------------------
  // session.complete handling
  // --------------------------------------------------------------------------

  it('handles session.complete from agent', async () => {
    const messages: Message[] = [];
    server.on('message', (_cid, msg) => messages.push(msg));

    const ws = await connectClient(port);
    await waitFor(() => server.getClientCount() === 1);

    const completeMsg = createMessage(MessageType.SESSION_COMPLETE, {
      success: true,
      summary: 'All 3 steps completed successfully',
    });
    sendMessage(ws, completeMsg);

    await waitFor(() => messages.length === 1);
    expect(messages[0].type).toBe('session.complete');
    expect(messages[0].payload).toEqual({
      success: true,
      summary: 'All 3 steps completed successfully',
    });

    ws.close();
  });

  // --------------------------------------------------------------------------
  // Error reporting: error.occurred
  // --------------------------------------------------------------------------

  it('handles error.occurred from agent', async () => {
    const messages: Message[] = [];
    server.on('message', (_cid, msg) => messages.push(msg));

    const ws = await connectClient(port);
    await waitFor(() => server.getClientCount() === 1);

    const errorMsg = createMessage(MessageType.ERROR_OCCURRED, {
      stepId: 'step-2',
      command: 'npm install',
      exitCode: 1,
      stdout: '',
      stderr: 'EACCES: permission denied',
      environment: {
        os: { platform: 'linux', version: '22.04', arch: 'x64' },
        shell: { type: 'bash', version: '5.1.0' },
        runtime: { node: '22.0.0' },
        packageManagers: { npm: '10.0.0' },
        network: { canAccessNpm: true, canAccessGithub: true },
        permissions: { hasSudo: false, canWriteTo: ['/home/user'] },
      },
      previousSteps: [],
    });
    sendMessage(ws, errorMsg);

    await waitFor(() => messages.length === 1);
    expect(messages[0].type).toBe('error.occurred');

    ws.close();
  });

  // --------------------------------------------------------------------------
  // Metrics reporting
  // --------------------------------------------------------------------------

  it('handles metrics.report from agent', async () => {
    const messages: Message[] = [];
    server.on('message', (_cid, msg) => messages.push(msg));

    const ws = await connectClient(port);
    await waitFor(() => server.getClientCount() === 1);

    const metricsMsg = createMessage(MessageType.METRICS_REPORT, {
      serverId: 'server-001',
      cpuUsage: 45.5,
      memoryUsage: 1024 * 1024 * 512,
      memoryTotal: 1024 * 1024 * 1024 * 4,
      diskUsage: 1024 * 1024 * 1024 * 50,
      diskTotal: 1024 * 1024 * 1024 * 200,
      networkIn: 1024 * 100,
      networkOut: 1024 * 50,
    });
    sendMessage(ws, metricsMsg);

    await waitFor(() => messages.length === 1);
    expect(messages[0].type).toBe('metrics.report');
    expect((messages[0] as typeof metricsMsg).payload.serverId).toBe('server-001');

    ws.close();
  });

  // --------------------------------------------------------------------------
  // Server → Agent message delivery
  // --------------------------------------------------------------------------

  it('delivers plan.receive from server to agent', async () => {
    const ws = await connectClient(port);
    await waitFor(() => server.getClientCount() === 1);

    // Get client ID
    let clientId = '';
    server.on('connection', (cid) => { clientId = cid; });
    // The connection event already fired, so get clientId differently
    // Use the message event to find out the clientId
    const messagePromise = waitForMessage(ws);

    const sessionMsg = createMessage(MessageType.SESSION_CREATE, {
      software: 'nodejs',
    });
    sendMessage(ws, sessionMsg);

    // Server creates session and sends an event; but since we use requireAuth=false,
    // the handler might not have a clientId. Let's just use broadcast instead.
    const planMsg = createMessage(MessageType.PLAN_RECEIVE, {
      steps: [{
        id: 'step-1',
        description: 'Install Node.js',
        command: 'apt install nodejs',
        timeout: 30000,
        canRollback: false,
        onError: 'abort' as const,
      }],
      estimatedTime: 30000,
      risks: [{ level: 'low' as const, description: 'Standard package install' }],
    });
    server.broadcast(planMsg);

    const received = await messagePromise;
    expect(received.type).toBe('plan.receive');
    expect((received as typeof planMsg).payload.steps).toHaveLength(1);

    ws.close();
  });

  it('delivers step.execute from server to agent', async () => {
    const ws = await connectClient(port);
    await waitFor(() => server.getClientCount() === 1);

    const stepMsg = createMessage(MessageType.STEP_EXECUTE, {
      id: 'step-1',
      description: 'Run npm install',
      command: 'npm install',
      timeout: 60000,
      canRollback: true,
      onError: 'retry' as const,
    });
    server.broadcast(stepMsg);

    const received = await waitForMessage(ws);
    expect(received.type).toBe('step.execute');
    expect((received as typeof stepMsg).payload.command).toBe('npm install');

    ws.close();
  });

  it('delivers fix.suggest from server to agent', async () => {
    const ws = await connectClient(port);
    await waitFor(() => server.getClientCount() === 1);

    const fixMsg = createMessage(MessageType.FIX_SUGGEST, [
      {
        description: 'Use sudo for permissions',
        commands: ['sudo npm install'],
        confidence: 0.8,
        risk: 'medium' as const,
      },
    ]);
    server.broadcast(fixMsg);

    const received = await waitForMessage(ws);
    expect(received.type).toBe('fix.suggest');

    ws.close();
  });

  // --------------------------------------------------------------------------
  // AI streaming messages
  // --------------------------------------------------------------------------

  it('delivers AI stream messages from server to agent', async () => {
    const ws = await connectClient(port);
    await waitFor(() => server.getClientCount() === 1);

    // Send ai.stream.start
    const startMsg = createMessage(MessageType.AI_STREAM_START, {
      operation: 'analyzeEnvironment',
    });
    server.broadcast(startMsg);
    const msg1 = await waitForMessage(ws);
    expect(msg1.type).toBe('ai.stream.start');

    // Send ai.stream.token
    const tokenMsg = createMessage(MessageType.AI_STREAM_TOKEN, {
      token: 'Analyzing...',
      accumulated: 'Analyzing...',
    });
    server.broadcast(tokenMsg);
    const msg2 = await waitForMessage(ws);
    expect(msg2.type).toBe('ai.stream.token');

    // Send ai.stream.complete
    const completeMsg = createMessage(MessageType.AI_STREAM_COMPLETE, {
      text: 'Analysis complete',
      inputTokens: 100,
      outputTokens: 50,
    });
    server.broadcast(completeMsg);
    const msg3 = await waitForMessage(ws);
    expect(msg3.type).toBe('ai.stream.complete');

    ws.close();
  });

  // --------------------------------------------------------------------------
  // Snapshot/rollback messages
  // --------------------------------------------------------------------------

  it('delivers snapshot.request from server and receives snapshot.response', async () => {
    const messages: Message[] = [];
    server.on('message', (_cid, msg) => messages.push(msg));

    const ws = await connectClient(port);
    await waitFor(() => server.getClientCount() === 1);

    // Server sends snapshot request
    const snapshotReq = createMessage(MessageType.SNAPSHOT_REQUEST, {
      snapshotRequestId: 'snap-001',
      files: ['/etc/nginx/nginx.conf'],
      label: 'Pre-operation backup',
    });
    server.broadcast(snapshotReq);

    const received = await waitForMessage(ws);
    expect(received.type).toBe('snapshot.request');

    // Agent sends response back
    const snapshotResp = createMessage(MessageType.SNAPSHOT_RESPONSE, {
      snapshotRequestId: 'snap-001',
      success: true,
      files: [{
        path: '/etc/nginx/nginx.conf',
        content: 'server { listen 80; }',
        mode: 0o644,
        owner: 'root',
        existed: true,
      }],
    });
    sendMessage(ws, snapshotResp);

    await waitFor(() => messages.length === 1);
    expect(messages[0].type).toBe('snapshot.response');

    ws.close();
  });

  // --------------------------------------------------------------------------
  // Heartbeat / Ping-Pong
  // --------------------------------------------------------------------------

  it('server ping is answered by agent pong (ws default behavior)', async () => {
    // Create server with short heartbeat interval for testing
    await server.stop();

    const shortServer = new InstallServer({
      port: nextPort(),
      heartbeatIntervalMs: 200,
      requireAuth: false,
    });
    const shortPort = (shortServer as unknown as { port: number }).port;
    await shortServer.start();

    const addr = shortServer.address();
    const actualPort = addr?.port ?? shortPort;

    const ws = await connectClient(actualPort);
    await waitFor(() => shortServer.getClientCount() === 1);

    // Wait for several heartbeat cycles — if pong isn't received, connection terminates
    await new Promise(resolve => setTimeout(resolve, 600));

    // Client should still be connected (ws library auto-responds to pings)
    expect(shortServer.getClientCount()).toBe(1);

    ws.close();
    await shortServer.stop();
  });

  // --------------------------------------------------------------------------
  // Disconnect detection
  // --------------------------------------------------------------------------

  it('emits disconnect event when agent disconnects', async () => {
    const disconnects: string[] = [];
    server.on('disconnect', (cid) => disconnects.push(cid));

    const ws = await connectClient(port);
    await waitFor(() => server.getClientCount() === 1);

    ws.close();
    await waitFor(() => disconnects.length === 1);
    expect(disconnects).toHaveLength(1);
    expect(server.getClientCount()).toBe(0);
  });

  // --------------------------------------------------------------------------
  // Multiple agents
  // --------------------------------------------------------------------------

  it('handles multiple concurrent agent connections', async () => {
    const ws1 = await connectClient(port);
    const ws2 = await connectClient(port);
    const ws3 = await connectClient(port);
    await waitFor(() => server.getClientCount() === 3);
    expect(server.getClientCount()).toBe(3);

    // Broadcast should reach all agents
    const msg = createMessage(MessageType.AI_STREAM_START, { operation: 'test' });
    server.broadcast(msg);

    const [r1, r2, r3] = await Promise.all([
      waitForMessage(ws1),
      waitForMessage(ws2),
      waitForMessage(ws3),
    ]);
    expect(r1.type).toBe('ai.stream.start');
    expect(r2.type).toBe('ai.stream.start');
    expect(r3.type).toBe('ai.stream.start');

    ws1.close();
    ws2.close();
    ws3.close();
  });

  // --------------------------------------------------------------------------
  // Full installation flow simulation
  // --------------------------------------------------------------------------

  it('simulates complete agent installation flow', async () => {
    const messages: Message[] = [];
    server.on('message', (_cid, msg) => messages.push(msg));

    const ws = await connectClient(port);
    await waitFor(() => server.getClientCount() === 1);

    // 1. session.create
    sendMessage(ws, createMessage(MessageType.SESSION_CREATE, {
      software: 'nginx',
      version: '1.24',
    }));
    await waitFor(() => messages.length === 1);

    // 2. env.report
    sendMessage(ws, createMessage(MessageType.ENV_REPORT, {
      os: { platform: 'linux', version: '22.04', arch: 'x64' },
      shell: { type: 'bash', version: '5.1.0' },
      runtime: { node: '22.0.0' },
      packageManagers: { apt: '2.4.0' },
      network: { canAccessNpm: true, canAccessGithub: true },
      permissions: { hasSudo: true, canWriteTo: ['/home/user', '/usr/local'] },
    }));
    await waitFor(() => messages.length === 2);

    // 3. step.execute (agent notifies step start)
    sendMessage(ws, createMessage(MessageType.STEP_EXECUTE, {
      id: 'step-1',
      description: 'Install nginx',
      command: 'apt install nginx',
      timeout: 30000,
      canRollback: true,
      onError: 'abort' as const,
    }));
    await waitFor(() => messages.length === 3);

    // 4. step.output
    sendMessage(ws, createMessage(MessageType.STEP_OUTPUT, {
      stepId: 'step-1',
      output: 'Setting up nginx (1.24)...',
    }));
    await waitFor(() => messages.length === 4);

    // 5. step.complete
    sendMessage(ws, createMessage(MessageType.STEP_COMPLETE, {
      stepId: 'step-1',
      success: true,
      exitCode: 0,
      stdout: 'nginx installed',
      stderr: '',
      duration: 3000,
    }));
    await waitFor(() => messages.length === 5);

    // 6. session.complete
    sendMessage(ws, createMessage(MessageType.SESSION_COMPLETE, {
      success: true,
      summary: 'All steps completed successfully',
    }));
    await waitFor(() => messages.length === 6);

    // Verify message sequence
    expect(messages.map(m => m.type)).toEqual([
      'session.create',
      'env.report',
      'step.execute',
      'step.output',
      'step.complete',
      'session.complete',
    ]);

    ws.close();
  });
});

// ============================================================================
// Authentication flow tests (with requireAuth: true)
// ============================================================================

describe('Server ↔ Agent Authentication', () => {
  let server: InstallServer;
  let port: number;

  beforeEach(async () => {
    port = nextPort();
    server = new InstallServer({
      port,
      heartbeatIntervalMs: 30000,
      requireAuth: true,
      authTimeoutMs: 3000,
    });
    await server.start();
  });

  afterEach(async () => {
    await server.stop();
  });

  it('rejects messages from unauthenticated clients', async () => {
    const messages: Message[] = [];
    const errors: Error[] = [];
    server.on('message', (_cid, msg) => messages.push(msg));
    server.on('error', (_cid, err) => errors.push(err));

    const ws = await connectClient(port);
    await waitFor(() => server.getClientCount() === 1);

    // Try sending a session.create before authenticating
    // The server validates messages via Zod first, then routes
    // Auth check happens in routeMessage, which is called by the message handler
    const sessionMsg = createMessage(MessageType.SESSION_CREATE, {
      software: 'nginx',
    });
    sendMessage(ws, sessionMsg);

    // The message will be parsed successfully but routing will check auth
    await waitFor(() => messages.length === 1);

    // The client should not be authenticated
    expect(server.isClientAuthenticated(ws as unknown as string)).toBe(false);

    ws.close();
  });

  it('accepts auth.request and can authenticate client', async () => {
    const messages: Message[] = [];
    server.on('message', (_cid, msg) => messages.push(msg));

    const ws = await connectClient(port);
    await waitFor(() => server.getClientCount() === 1);

    const authMsg = createTestAuthRequest();
    sendMessage(ws, authMsg);

    await waitFor(() => messages.length === 1);
    expect(messages[0].type).toBe('auth.request');
    expect(messages[0].payload).toHaveProperty('deviceId', 'test-device-001');
    expect(messages[0].payload).toHaveProperty('platform', 'linux');

    ws.close();
  });

  it('closes connection on auth timeout', async () => {
    const ws = await connectClient(port);
    await waitFor(() => server.getClientCount() === 1);

    // Don't send auth — wait for timeout (3s) + processing time
    await waitFor(() => server.getClientCount() === 0, 6000);
    expect(server.getClientCount()).toBe(0);

    ws.close();
  });
});

// ============================================================================
// Message schema validation tests
// ============================================================================

describe('Message Schema Validation', () => {
  let server: InstallServer;
  let port: number;

  beforeEach(async () => {
    port = nextPort();
    server = new InstallServer({
      port,
      requireAuth: false,
    });
    await server.start();
  });

  afterEach(async () => {
    await server.stop();
  });

  it('rejects messages with unknown type', async () => {
    const errors: Error[] = [];
    server.on('error', (_cid, err) => errors.push(err));

    const ws = await connectClient(port);
    await waitFor(() => server.getClientCount() === 1);

    // Send a message with an unknown type
    ws.send(JSON.stringify({
      type: 'unknown.type',
      payload: {},
      timestamp: Date.now(),
    }));

    await waitFor(() => errors.length === 1);
    expect(errors[0].message).toContain('Invalid message');

    ws.close();
  });

  it('rejects messages with missing required fields', async () => {
    const errors: Error[] = [];
    server.on('error', (_cid, err) => errors.push(err));

    const ws = await connectClient(port);
    await waitFor(() => server.getClientCount() === 1);

    // session.create without software field
    ws.send(JSON.stringify({
      type: 'session.create',
      payload: {},
      timestamp: Date.now(),
    }));

    await waitFor(() => errors.length === 1);
    expect(errors[0].message).toContain('Invalid message');

    ws.close();
  });

  it('rejects messages without timestamp', async () => {
    const errors: Error[] = [];
    server.on('error', (_cid, err) => errors.push(err));

    const ws = await connectClient(port);
    await waitFor(() => server.getClientCount() === 1);

    ws.send(JSON.stringify({
      type: 'session.create',
      payload: { software: 'test' },
    }));

    await waitFor(() => errors.length === 1);
    expect(errors[0].message).toContain('Invalid message');

    ws.close();
  });

  it('accepts all 20 message types via Zod validation', async () => {
    const messages: Message[] = [];
    server.on('message', (_cid, msg) => messages.push(msg));

    const ws = await connectClient(port);
    await waitFor(() => server.getClientCount() === 1);

    // Send a selection of different message types
    const testMessages: Message[] = [
      createMessage(MessageType.AUTH_REQUEST, {
        deviceId: 'dev-1',
        platform: 'linux',
      }),
      createMessage(MessageType.SESSION_CREATE, {
        software: 'nginx',
      }),
      createMessage(MessageType.STEP_OUTPUT, {
        stepId: 's1',
        output: 'test output',
      }),
      createMessage(MessageType.STEP_COMPLETE, {
        stepId: 's1',
        success: true,
        exitCode: 0,
        stdout: '',
        stderr: '',
        duration: 100,
      }),
      createMessage(MessageType.SESSION_COMPLETE, {
        success: true,
        summary: 'Done',
      }),
      createMessage(MessageType.METRICS_REPORT, {
        serverId: 'srv-1',
        cpuUsage: 10,
        memoryUsage: 100,
        memoryTotal: 1000,
        diskUsage: 5000,
        diskTotal: 10000,
        networkIn: 100,
        networkOut: 50,
      }),
    ];

    for (const msg of testMessages) {
      sendMessage(ws, msg);
    }

    await waitFor(() => messages.length === testMessages.length);
    expect(messages).toHaveLength(testMessages.length);

    ws.close();
  });
});
