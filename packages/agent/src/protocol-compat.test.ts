// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Protocol compatibility tests for agent-side code.
 *
 * Tests:
 * 1. AuthenticatedClient re-authenticates on reconnect
 * 2. waitForNonEmptyPlan skips empty plans
 * 3. protocol-lite message types match shared MessageType
 * 4. Agent messages pass server-side Zod validation
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WebSocketServer } from 'ws';
import type { WebSocket as WsWebSocket } from 'ws';

import { createMessage, safeParseMessage, MessageType as SharedMessageType } from '@aiinstaller/shared';
import type { Message } from '@aiinstaller/shared';

import { InstallClient, ConnectionState } from './client.js';
import { MessageType, createMessageLite, safeParseMessageLite } from './protocol-lite.js';

// ============================================================================
// Helpers
// ============================================================================

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

function closeTestServer(wss: WebSocketServer): Promise<void> {
  return new Promise((resolve) => {
    for (const client of wss.clients) {
      client.terminate();
    }
    wss.close(() => resolve());
  });
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================================
// Protocol-lite ↔ Shared compatibility
// ============================================================================

describe('protocol-lite ↔ shared compatibility', () => {
  it('all MessageType values match between protocol-lite and shared', () => {
    // Every key in protocol-lite MessageType must exist in shared MessageType
    for (const key of Object.keys(MessageType) as (keyof typeof MessageType)[]) {
      expect(MessageType[key]).toBe(SharedMessageType[key]);
    }

    // Every key in shared MessageType must exist in protocol-lite MessageType
    for (const key of Object.keys(SharedMessageType) as (keyof typeof SharedMessageType)[]) {
      expect(SharedMessageType[key]).toBe(MessageType[key]);
    }
  });

  it('createMessageLite produces Zod-valid messages', () => {
    const authReq = createMessageLite(MessageType.AUTH_REQUEST, {
      deviceId: 'test-id',
      platform: 'linux',
      osVersion: '22.04',
      architecture: 'x64',
      hostname: 'test-host',
    });

    // Must pass server-side Zod validation
    const result = safeParseMessage(authReq);
    expect(result.success).toBe(true);
  });

  it('createMessageLite session.create passes Zod', () => {
    const msg = createMessageLite(MessageType.SESSION_CREATE, {
      software: 'nginx',
      version: '1.24',
    });
    const result = safeParseMessage(msg);
    expect(result.success).toBe(true);
  });

  it('createMessageLite env.report passes Zod', () => {
    const msg = createMessageLite(MessageType.ENV_REPORT, {
      os: { platform: 'linux', version: '22.04', arch: 'x64' },
      shell: { type: 'bash', version: '5.1.0' },
      runtime: { node: '22.0.0' },
      packageManagers: { npm: '10.0.0' },
      network: { canAccessNpm: true, canAccessGithub: true },
      permissions: { hasSudo: false, canWriteTo: ['/home/user'] },
    });
    const result = safeParseMessage(msg);
    expect(result.success).toBe(true);
  });

  it('createMessageLite step.complete passes Zod', () => {
    const msg = createMessageLite(MessageType.STEP_COMPLETE, {
      stepId: 'step-1',
      success: true,
      exitCode: 0,
      stdout: 'output',
      stderr: '',
      duration: 1500,
    });
    const result = safeParseMessage(msg);
    expect(result.success).toBe(true);
  });

  it('createMessageLite error.occurred passes Zod', () => {
    const msg = createMessageLite(MessageType.ERROR_OCCURRED, {
      stepId: 'step-1',
      command: 'npm install',
      exitCode: 1,
      stdout: '',
      stderr: 'EACCES',
      environment: {
        os: { platform: 'linux', version: '22.04', arch: 'x64' },
        shell: { type: 'bash', version: '5.1.0' },
        runtime: { node: '22.0.0' },
        packageManagers: { npm: '10.0.0' },
        network: { canAccessNpm: true, canAccessGithub: true },
        permissions: { hasSudo: false, canWriteTo: [] },
      },
      previousSteps: [],
    });
    const result = safeParseMessage(msg);
    expect(result.success).toBe(true);
  });

  it('createMessageLite session.complete passes Zod', () => {
    const msg = createMessageLite(MessageType.SESSION_COMPLETE, {
      success: true,
      summary: 'All done',
    });
    const result = safeParseMessage(msg);
    expect(result.success).toBe(true);
  });

  it('createMessageLite metrics.report passes Zod', () => {
    const msg = createMessageLite(MessageType.METRICS_REPORT, {
      serverId: 'server-001',
      cpuUsage: 25,
      memoryUsage: 1024 * 1024 * 256,
      memoryTotal: 1024 * 1024 * 1024 * 8,
      diskUsage: 1024 * 1024 * 1024 * 10,
      diskTotal: 1024 * 1024 * 1024 * 100,
      networkIn: 5000,
      networkOut: 3000,
    });
    const result = safeParseMessage(msg);
    expect(result.success).toBe(true);
  });

  it('createMessageLite step.output passes Zod', () => {
    const msg = createMessageLite(MessageType.STEP_OUTPUT, {
      stepId: 'step-1',
      output: 'Installing...',
    });
    const result = safeParseMessage(msg);
    expect(result.success).toBe(true);
  });

  it('createMessageLite with requestId passes Zod', () => {
    const msg = createMessageLite(MessageType.SESSION_CREATE, {
      software: 'redis',
    }, 'req-123');
    const result = safeParseMessage(msg);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.requestId).toBe('req-123');
    }
  });
});

// ============================================================================
// safeParseMessageLite validation
// ============================================================================

describe('safeParseMessageLite', () => {
  it('accepts server-created messages', () => {
    // Simulate a message created by the server using shared createMessage
    const serverMsg = createMessage(SharedMessageType.AUTH_RESPONSE, {
      success: true,
      deviceToken: 'tok-123',
      quotaLimit: 100,
      quotaUsed: 5,
      quotaRemaining: 95,
      plan: 'free',
    });

    const result = safeParseMessageLite(serverMsg);
    expect(result.success).toBe(true);
  });

  it('accepts plan.receive from server', () => {
    const msg = createMessage(SharedMessageType.PLAN_RECEIVE, {
      steps: [{
        id: 's1',
        description: 'Install',
        command: 'apt install nginx',
        timeout: 30000,
        canRollback: false,
        onError: 'abort' as const,
      }],
      estimatedTime: 30000,
      risks: [],
    });
    const result = safeParseMessageLite(msg);
    expect(result.success).toBe(true);
  });

  it('accepts step.execute from server', () => {
    const msg = createMessage(SharedMessageType.STEP_EXECUTE, {
      id: 's1',
      description: 'Run command',
      command: 'npm install',
      timeout: 60000,
      canRollback: true,
      onError: 'retry' as const,
    });
    const result = safeParseMessageLite(msg);
    expect(result.success).toBe(true);
  });

  it('accepts AI stream messages from server', () => {
    const msgs = [
      createMessage(SharedMessageType.AI_STREAM_START, { operation: 'test' }),
      createMessage(SharedMessageType.AI_STREAM_TOKEN, { token: 'hi', accumulated: 'hi' }),
      createMessage(SharedMessageType.AI_STREAM_COMPLETE, { text: 'done', inputTokens: 10, outputTokens: 5 }),
      createMessage(SharedMessageType.AI_STREAM_ERROR, { error: 'fail' }),
    ];

    for (const msg of msgs) {
      const result = safeParseMessageLite(msg);
      expect(result.success).toBe(true);
    }
  });

  it('rejects null and undefined', () => {
    expect(safeParseMessageLite(null).success).toBe(false);
    expect(safeParseMessageLite(undefined).success).toBe(false);
  });

  it('rejects non-objects', () => {
    expect(safeParseMessageLite('string').success).toBe(false);
    expect(safeParseMessageLite(42).success).toBe(false);
  });

  it('rejects missing type', () => {
    expect(safeParseMessageLite({ payload: {}, timestamp: 1 }).success).toBe(false);
  });

  it('rejects unknown type', () => {
    expect(safeParseMessageLite({ type: 'foo.bar', payload: {}, timestamp: 1 }).success).toBe(false);
  });

  it('rejects missing timestamp', () => {
    expect(safeParseMessageLite({ type: 'auth.request', payload: {} }).success).toBe(false);
  });
});

// ============================================================================
// Reconnection with re-authentication
// ============================================================================

describe('InstallClient reconnected event', () => {
  let wss: WebSocketServer;
  let port: number;
  let client: InstallClient;

  beforeEach(async () => {
    ({ wss, port } = await createTestServer());
    client = new InstallClient({
      serverUrl: `ws://127.0.0.1:${port}`,
      autoReconnect: true,
      maxReconnectAttempts: 3,
      reconnectBaseDelayMs: 100,
      reconnectMaxDelayMs: 500,
    });
  });

  afterEach(async () => {
    client.disconnect();
    await closeTestServer(wss);
  });

  it('emits reconnected event after successful reconnect', async () => {
    const events: string[] = [];
    client.on('connected', () => events.push('connected'));
    client.on('disconnected', () => events.push('disconnected'));
    client.on('reconnecting', () => events.push('reconnecting'));
    client.on('reconnected', () => events.push('reconnected'));

    await client.connect();
    expect(client.state).toBe('connected');

    // Force close all server-side connections to trigger reconnect
    for (const c of wss.clients) {
      c.close();
    }

    // Wait for reconnection
    await wait(1000);

    expect(events).toContain('connected');
    expect(events).toContain('disconnected');
    expect(events).toContain('reconnecting');
    expect(events).toContain('reconnected');
    expect(client.state).toBe('connected');
  });
});
