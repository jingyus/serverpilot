// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for protocol version negotiation in handleAuthRequest.
 *
 * Validates that the server correctly:
 * - Accepts agents with compatible protocol versions
 * - Rejects agents with incompatible major versions
 * - Warns for legacy agents without version
 * - Includes protocolVersion and versionCheck in auth responses
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import WebSocket from 'ws';
import { createMessage, MessageType, PROTOCOL_VERSION } from '@aiinstaller/shared';
import type { AuthRequestMessage, AuthResponseMessage } from '@aiinstaller/shared';
import { InstallServer } from './server.js';
import { handleAuthRequest } from './handlers.js';

// Mock authenticateDevice to always succeed (we're testing version logic, not auth)
vi.mock('./auth-handler.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('./auth-handler.js')>();
  return {
    ...original,
    authenticateDevice: vi.fn().mockResolvedValue({
      success: true,
      deviceToken: 'test-token',
      quota: { limit: 100, used: 0, remaining: 100 },
      plan: 'self-hosted',
    }),
  };
});

// ============================================================================
// Helpers
// ============================================================================

let testPort = 18800;
function nextPort() {
  return testPort++;
}

function connectClient(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.on('open', () => resolve(ws));
    ws.on('error', (err) => reject(err));
  });
}

function waitForMessage(ws: WebSocket, timeoutMs = 2000): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('waitForMessage timed out'));
    }, timeoutMs);
    ws.once('message', (data) => {
      clearTimeout(timer);
      resolve(data.toString());
    });
  });
}

function makeAuthRequest(protocolVersion?: string): AuthRequestMessage {
  return createMessage(MessageType.AUTH_REQUEST, {
    deviceId: 'test-device',
    deviceToken: 'test-token',
    ...(protocolVersion !== undefined ? { protocolVersion } : {}),
    platform: 'linux',
    osVersion: 'Ubuntu 22.04',
    architecture: 'x64',
    hostname: 'test-host',
  }) as AuthRequestMessage;
}

// ============================================================================
// Tests
// ============================================================================

describe('version-negotiation in handleAuthRequest', () => {
  let server: InstallServer;
  let ws: WebSocket;
  let clientId: string;

  afterEach(async () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.close();
    }
    if (server && server.isRunning()) {
      await server.stop();
    }
  });

  async function setup(): Promise<void> {
    const port = nextPort();
    server = new InstallServer({ port, heartbeatIntervalMs: 60000 });
    const clientIdPromise = new Promise<string>((resolve) => {
      server.on('connection', (id) => resolve(id));
    });
    await server.start();
    ws = await connectClient(port);
    clientId = await clientIdPromise;
  }

  it('accepts agent with matching protocol version', async () => {
    await setup();

    const msgPromise = waitForMessage(ws);
    const result = await handleAuthRequest(server, clientId, makeAuthRequest('1.0.0'));

    expect(result.success).toBe(true);

    const response: AuthResponseMessage = JSON.parse(await msgPromise);
    expect(response.payload.success).toBe(true);
    expect(response.payload.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(response.payload.versionCheck).toBeDefined();
    expect(response.payload.versionCheck!.compatible).toBe(true);
    expect(response.payload.versionCheck!.severity).toBe('ok');
  });

  it('accepts legacy agent without protocolVersion (warns)', async () => {
    await setup();

    const msgPromise = waitForMessage(ws);
    const result = await handleAuthRequest(server, clientId, makeAuthRequest());

    expect(result.success).toBe(true);

    const response: AuthResponseMessage = JSON.parse(await msgPromise);
    expect(response.payload.success).toBe(true);
    expect(response.payload.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(response.payload.versionCheck).toBeDefined();
    expect(response.payload.versionCheck!.compatible).toBe(true);
    expect(response.payload.versionCheck!.severity).toBe('warn');
    expect(response.payload.versionCheck!.message).toContain('legacy');
  });

  it('rejects agent with incompatible major version (agent newer)', async () => {
    await setup();

    const msgPromise = waitForMessage(ws);
    const result = await handleAuthRequest(server, clientId, makeAuthRequest('2.0.0'));

    expect(result.success).toBe(true); // handler itself succeeds

    const response: AuthResponseMessage = JSON.parse(await msgPromise);
    expect(response.payload.success).toBe(false);
    expect(response.payload.error).toContain('newer');
    expect(response.payload.versionCheck).toBeDefined();
    expect(response.payload.versionCheck!.compatible).toBe(false);
    expect(response.payload.versionCheck!.severity).toBe('error');
  });

  it('rejects agent with incompatible major version (agent older)', async () => {
    await setup();

    const msgPromise = waitForMessage(ws);
    const result = await handleAuthRequest(server, clientId, makeAuthRequest('0.9.0'));

    expect(result.success).toBe(true);

    const response: AuthResponseMessage = JSON.parse(await msgPromise);
    expect(response.payload.success).toBe(false);
    expect(response.payload.error).toContain('older');
    expect(response.payload.versionCheck!.compatible).toBe(false);
  });

  it('rejects agent with minor version exceeding server', async () => {
    await setup();

    const msgPromise = waitForMessage(ws);
    const result = await handleAuthRequest(server, clientId, makeAuthRequest('1.5.0'));

    expect(result.success).toBe(true);

    const response: AuthResponseMessage = JSON.parse(await msgPromise);
    expect(response.payload.success).toBe(false);
    expect(response.payload.error).toContain('not supported');
    expect(response.payload.versionCheck!.compatible).toBe(false);
  });

  it('warns for invalid protocol version format but still authenticates', async () => {
    await setup();

    const msgPromise = waitForMessage(ws);
    const result = await handleAuthRequest(server, clientId, makeAuthRequest('not-valid'));

    expect(result.success).toBe(true);

    const response: AuthResponseMessage = JSON.parse(await msgPromise);
    expect(response.payload.success).toBe(true);
    expect(response.payload.versionCheck).toBeDefined();
    expect(response.payload.versionCheck!.compatible).toBe(true);
    expect(response.payload.versionCheck!.severity).toBe('warn');
    expect(response.payload.versionCheck!.message).toContain('invalid');
  });

  it('includes server protocolVersion even on rejection', async () => {
    await setup();

    const msgPromise = waitForMessage(ws);
    await handleAuthRequest(server, clientId, makeAuthRequest('2.0.0'));

    const response: AuthResponseMessage = JSON.parse(await msgPromise);
    expect(response.payload.protocolVersion).toBe(PROTOCOL_VERSION);
  });
});
