// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * E2E Integration Test — Complete Chat → Plan → Execute → Result flow.
 *
 * Validates the full conversational DevOps loop with real HTTP + WebSocket
 * servers, mock AI provider, and mocked external services.
 *
 * @module tests/e2e-chat-ops-flow
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createServer as createHttpServer } from 'node:http';
import type { Server as HttpServer } from 'node:http';
import WebSocket from 'ws';
// @ts-ignore — resolved at runtime via pnpm workspace
import { getRequestListener } from '../packages/server/node_modules/@hono/node-server/dist/index.js';

import { InstallServer } from '../packages/server/src/api/server.js';
import { routeMessage } from '../packages/server/src/api/handlers.js';
import { createApiApp } from '../packages/server/src/api/routes/index.js';
import {
  initJwtConfig, generateTokens, _resetJwtConfig,
} from '../packages/server/src/api/middleware/auth.js';
import {
  initDatabase, createTables, closeDatabase, getDatabase, getRawDatabase,
} from '../packages/server/src/db/connection.js';
import {
  InMemoryServerRepository, setServerRepository, _resetServerRepository,
} from '../packages/server/src/db/repositories/server-repository.js';
import {
  InMemorySessionRepository, setSessionRepository, _resetSessionRepository,
} from '../packages/server/src/db/repositories/session-repository.js';
import { _resetSessionManager } from '../packages/server/src/core/session/manager.js';
import { _resetChatAIAgent, initChatAIAgent } from '../packages/server/src/api/routes/chat-ai.js';
import { _resetProfileRepository } from '../packages/server/src/db/repositories/profile-repository.js';
import { _resetOperationRepository } from '../packages/server/src/db/repositories/operation-repository.js';
import { _resetTaskRepository } from '../packages/server/src/db/repositories/task-repository.js';
import { _resetSnapshotRepository } from '../packages/server/src/db/repositories/snapshot-repository.js';
import { _resetTaskExecutor, getTaskExecutor } from '../packages/server/src/core/task/executor.js';
import { initAgentConnector, _resetAgentConnector } from '../packages/server/src/core/agent/agent-connector.js';
import { _resetProviderFactory } from '../packages/server/src/ai/providers/provider-factory.js';
import { InMemoryRbacRepository, setRbacRepository, _resetRbacRepository } from '../packages/server/src/db/repositories/rbac-repository.js';
import type { AIProviderInterface, StreamResponse } from '../packages/server/src/ai/providers/base.js';
import { MessageType } from '@aiinstaller/shared';
import { users, servers as serversTable } from '../packages/server/src/db/schema.js';

// --- Mock external dependencies ---

vi.mock('../packages/server/src/api/device-client.js', () => ({
  DeviceClient: {
    verify: vi.fn(async () => ({
      success: true,
      data: { valid: true, banned: false, plan: 'free', quotaLimit: 100, quotaUsed: 0 },
    })),
    register: vi.fn(async (req: { deviceId: string }) => ({
      success: true,
      data: { token: `mock-token-${req.deviceId}`, quotaLimit: 100, quotaUsed: 0, plan: 'free' },
    })),
    incrementCall: vi.fn(async () => ({
      success: true, data: { quotaUsed: 1, quotaRemaining: 99 },
    })),
    getQuota: vi.fn(async () => ({
      success: true,
      data: { quotaLimit: 100, quotaUsed: 0, quotaRemaining: 100, plan: 'free', resetDate: '2026-03-01' },
    })),
  },
}));

vi.mock('../packages/server/src/api/rate-limiter.js', () => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true })),
  incrementAICall: vi.fn(async () => {}),
  logAICall: vi.fn(async () => {}),
  createQuotaExceededMessage: vi.fn(),
}));

vi.mock('../packages/server/src/core/snapshot/snapshot-service.js', () => ({
  getSnapshotService: vi.fn(() => ({
    requiresSnapshot: () => false,
    createPreOperationSnapshot: vi.fn(async () => ({ success: false, skipped: true })),
    handleSnapshotResponse: vi.fn(async () => true),
  })),
}));

vi.mock('../packages/server/src/core/rollback/rollback-service.js', () => ({
  getRollbackService: vi.fn(() => ({
    handleRollbackResponse: vi.fn(async () => true),
  })),
}));

// --- Constants & Mock AI Provider ---

const TEST_SECRET = 'e2e-test-secret-key-that-is-at-least-32-chars-long!!';
const TEST_USER_ID = 'e2e-user-001';

function createMockProvider(): AIProviderInterface {
  const planJson = JSON.stringify({
    description: 'Install nginx web server',
    steps: [
      { id: 'step-1', description: 'Update package lists', command: 'apt-get update', timeout: 60000, canRollback: false, onError: 'abort' },
      { id: 'step-2', description: 'Install nginx', command: 'apt-get install -y nginx', timeout: 120000, canRollback: true, onError: 'abort' },
    ],
    estimatedTime: 180000,
    risks: [{ level: 'low', description: 'Standard package installation' }],
  });

  const responseText =
    "I'll install nginx for you. Here's the plan:\n\n```json-plan\n" +
    planJson + '\n```\n\nThis will update your package lists and install nginx.';

  return {
    name: 'mock',
    tier: 1,
    async chat() {
      return { content: responseText, usage: { inputTokens: 100, outputTokens: 200 } };
    },
    async stream(_options, callbacks) {
      const tokens = responseText.split(' ');
      let accumulated = '';
      callbacks?.onStart?.();
      for (const token of tokens) {
        const t = accumulated ? ` ${token}` : token;
        accumulated += t;
        callbacks?.onToken?.(t, accumulated);
      }
      callbacks?.onComplete?.(accumulated, { inputTokens: 100, outputTokens: 200 });
      return { content: accumulated, usage: { inputTokens: 100, outputTokens: 200 }, success: true } satisfies StreamResponse;
    },
    async isAvailable() { return true; },
  };
}

// --- Helpers ---

interface SSEEvent { event: string; data: string; }

function parseSSE(text: string): SSEEvent[] {
  const events: SSEEvent[] = [];
  const lines = text.split('\n');
  let currentEvent = 'message';
  for (const line of lines) {
    if (line.startsWith('event: ')) currentEvent = line.slice(7).trim();
    else if (line.startsWith('data: ')) events.push({ event: currentEvent, data: line.slice(6) });
    else if (line === '') currentEvent = 'message';
  }
  return events;
}

function waitForMessage(
  ws: WebSocket,
  predicate: (msg: Record<string, unknown>) => boolean,
  timeoutMs = 5000,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`WS message timeout (${timeoutMs}ms)`)), timeoutMs);
    const handler = (data: WebSocket.Data) => {
      const msg = JSON.parse(String(data));
      if (predicate(msg)) { clearTimeout(timer); ws.removeListener('message', handler); resolve(msg); }
    };
    ws.on('message', handler);
  });
}

// --- Test Suite ---

describe('E2E: Chat → Plan → Execute → Result Flow', () => {
  let httpServer: HttpServer;
  let wsServer: InstallServer;
  let baseUrl: string;
  let wsUrl: string;
  let accessToken: string;
  let serverId: string;

  beforeAll(async () => {
    initDatabase(':memory:');
    createTables();
    getRawDatabase().pragma('foreign_keys = OFF');

    _resetJwtConfig();
    initJwtConfig({ secret: TEST_SECRET });
    accessToken = (await generateTokens(TEST_USER_ID)).accessToken;

    setServerRepository(new InMemoryServerRepository());
    setSessionRepository(new InMemorySessionRepository());

    // Set up RBAC with owner role for test user
    const rbacRepo = new InMemoryRbacRepository();
    rbacRepo.setRole(TEST_USER_ID, 'owner');
    setRbacRepository(rbacRepo);

    _resetProviderFactory();
    _resetChatAIAgent();
    initChatAIAgent(createMockProvider());

    wsServer = new InstallServer({
      port: 0, requireAuth: true, authTimeoutMs: 10000, heartbeatIntervalMs: 60000,
    });

    _resetAgentConnector();
    initAgentConnector(wsServer);
    _resetTaskExecutor();
    getTaskExecutor(wsServer);

    wsServer.on('message', async (clientId, message) => {
      await routeMessage(wsServer, clientId, message);
    });

    // Seed SQLite with the test user before creating server (RBAC middleware needs user)
    const db = getDatabase();
    const now = new Date();
    db.insert(users).values({ id: TEST_USER_ID, email: 'e2e@test.local', passwordHash: 'n/a', createdAt: now, updatedAt: now }).run();

    const apiApp = createApiApp();
    httpServer = createHttpServer(getRequestListener(apiApp.fetch));
    await wsServer.start(httpServer);
    await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));

    const addr = httpServer.address() as { port: number };
    baseUrl = `http://127.0.0.1:${addr.port}`;
    wsUrl = `ws://127.0.0.1:${addr.port}`;

    const createRes = await fetch(`${baseUrl}/api/v1/servers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ name: 'e2e-test-server' }),
    });
    serverId = (await createRes.json()).server.id;

    // Seed SQLite so DrizzleOperationRepository.verifyServerOwnership() passes
    db.insert(serversTable).values({ id: serverId, name: 'e2e-test-server', userId: TEST_USER_ID, status: 'online', createdAt: now, updatedAt: now }).run();
  }, 15000);

  afterAll(async () => {
    [_resetTaskExecutor, _resetAgentConnector, _resetChatAIAgent, _resetSessionManager,
     _resetServerRepository, _resetSessionRepository, _resetProfileRepository, _resetOperationRepository,
     _resetTaskRepository, _resetSnapshotRepository, _resetRbacRepository].forEach((fn) => fn());
    if (wsServer) await wsServer.stop();
    if (httpServer) await new Promise<void>((r) => httpServer.close(() => r()));
    closeDatabase();
  });

  // --- Shared helpers ---

  async function connectAgent(): Promise<WebSocket> {
    const ws = new WebSocket(wsUrl);
    await new Promise<void>((resolve, reject) => { ws.on('open', resolve); ws.on('error', reject); });

    ws.send(JSON.stringify({
      type: MessageType.AUTH_REQUEST,
      payload: { deviceId: serverId, deviceToken: `agent-token-${serverId}`, platform: 'linux', osVersion: 'Ubuntu 22.04', architecture: 'x64', hostname: 'e2e-test-host' },
      timestamp: Date.now(),
    }));

    const authRes = await waitForMessage(ws, (m) => m.type === MessageType.AUTH_RESPONSE);
    expect((authRes.payload as Record<string, unknown>).success).toBe(true);

    // Create InstallServer session so handleStepComplete routes to TaskExecutor
    const clientIds = wsServer.getClientsByDeviceId(serverId);
    if (clientIds.length > 0) {
      wsServer.createSession(clientIds[clientIds.length - 1], { software: 'nginx', version: '1.0' });
    }
    return ws;
  }

  async function disconnectAgent(agent: WebSocket): Promise<void> {
    agent.close();
    await new Promise<void>((r) => agent.on('close', () => r()));
  }

  function authHeaders() {
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` };
  }

  async function chatAndGetPlan(): Promise<{ sessionId: string; planId: string; events: SSEEvent[] }> {
    const res = await fetch(`${baseUrl}/api/v1/chat/${serverId}`, {
      method: 'POST', headers: authHeaders(), body: JSON.stringify({ message: 'Install nginx' }),
    });
    const events = parseSSE(await res.text());
    const sessionId = JSON.parse(events.find((e) => e.event === 'message' && JSON.parse(e.data).sessionId)!.data).sessionId;
    const planId = JSON.parse(events.find((e) => e.event === 'plan')!.data).planId;
    return { sessionId, planId, events };
  }

  async function executePlan(sessionId: string, planId: string): Promise<SSEEvent[]> {
    const res = await fetch(`${baseUrl}/api/v1/chat/${serverId}/execute`, {
      method: 'POST', headers: authHeaders(), body: JSON.stringify({ planId, sessionId }),
    });
    return parseSSE(await res.text());
  }

  function setupAgentResponder(agent: WebSocket, opts: { fail?: boolean } = {}) {
    const messages: Record<string, unknown>[] = [];
    agent.on('message', (data) => {
      const msg = JSON.parse(String(data));
      messages.push(msg);
      if (msg.type === MessageType.STEP_EXECUTE) {
        const payload = msg.payload as { id: string; command: string };
        if (!opts.fail) {
          agent.send(JSON.stringify({
            type: MessageType.STEP_OUTPUT,
            payload: { stepId: payload.id, output: `Executing: ${payload.command}\nDone.\n` },
            timestamp: Date.now(),
          }));
        }
        setTimeout(() => {
          agent.send(JSON.stringify({
            type: MessageType.STEP_COMPLETE,
            payload: opts.fail
              ? { stepId: payload.id, success: false, exitCode: 1, stdout: '', stderr: `E: Unable to run: ${payload.command}\n`, duration: 30 }
              : { stepId: payload.id, success: true, exitCode: 0, stdout: `Successfully ran: ${payload.command}\n`, stderr: '', duration: 50 },
            timestamp: Date.now(),
          }));
        }, opts.fail ? 30 : 50);
      }
    });
    return messages;
  }

  // --- Test 1: Agent auth ---

  it('should allow agent to connect and authenticate via WebSocket', async () => {
    const agent = await connectAgent();
    expect(agent.readyState).toBe(WebSocket.OPEN);
    await disconnectAgent(agent);
  });

  // --- Test 2: Chat SSE plan generation ---

  it('should stream AI response with plan via SSE on chat message', async () => {
    const res = await fetch(`${baseUrl}/api/v1/chat/${serverId}`, {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({ message: 'Install nginx on this server' }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');

    const events = parseSSE(await res.text());

    expect(events.find((e) => e.event === 'message' && JSON.parse(e.data).sessionId)).toBeDefined();
    expect(events.filter((e) => e.event === 'message' && JSON.parse(e.data).content).length).toBeGreaterThan(0);

    const planData = JSON.parse(events.find((e) => e.event === 'plan')!.data);
    expect(planData.planId).toBeDefined();
    expect(planData.description).toBe('Install nginx web server');
    expect(planData.steps).toHaveLength(2);
    expect(planData.steps[0].command).toBe('apt-get update');
    expect(planData.steps[1].command).toBe('apt-get install -y nginx');
    expect(planData.requiresConfirmation).toBe(true);

    expect(JSON.parse(events.find((e) => e.event === 'complete')!.data).success).toBe(true);
  });

  // --- Test 3: Full Chat → Plan → Execute → Result flow ---

  it('should execute the complete chat → plan → execute → result flow', async () => {
    // Get plan FIRST (before agent connects), so auto-execute doesn't trigger
    const { sessionId, planId, events: chatEvents } = await chatAndGetPlan();
    expect(JSON.parse(chatEvents.find((e) => e.event === 'plan')!.data).steps).toHaveLength(2);

    // Now connect agent and set up responder before executing
    const agent = await connectAgent();
    const agentMessages = setupAgentResponder(agent);
    const execEvents = await executePlan(sessionId, planId);

    // Verify step_start events
    const stepStarts = execEvents.filter((e) => e.event === 'step_start');
    expect(stepStarts).toHaveLength(2);
    expect(JSON.parse(stepStarts[0].data).command).toBe('apt-get update');
    expect(JSON.parse(stepStarts[1].data).command).toBe('apt-get install -y nginx');

    expect(execEvents.filter((e) => e.event === 'output').length).toBeGreaterThanOrEqual(2);

    // Verify step_complete events
    const stepCompletes = execEvents.filter((e) => e.event === 'step_complete');
    expect(stepCompletes).toHaveLength(2);
    expect(JSON.parse(stepCompletes[0].data)).toMatchObject({ exitCode: 0, success: true });
    expect(JSON.parse(stepCompletes[1].data)).toMatchObject({ exitCode: 0, success: true });
    expect(JSON.parse(stepCompletes[0].data).duration).toBeGreaterThanOrEqual(0);

    const completeData = JSON.parse(execEvents.find((e) => e.event === 'complete')!.data);
    expect(completeData).toMatchObject({ success: true, failedAtStep: null });
    expect(completeData.operationId).toBeDefined();

    // Verify agent received correct commands
    const stepExecMsgs = agentMessages.filter((m) => m.type === MessageType.STEP_EXECUTE);
    expect(stepExecMsgs).toHaveLength(2);
    expect((stepExecMsgs[0].payload as Record<string, unknown>).command).toBe('apt-get update');
    expect((stepExecMsgs[1].payload as Record<string, unknown>).command).toBe('apt-get install -y nginx');

    await disconnectAgent(agent);
  }, 15000);

  // --- Test 4: Execution stops on agent failure ---

  it('should stop execution and report failure when agent step fails', async () => {
    // Get plan FIRST (before agent connects)
    const { sessionId, planId } = await chatAndGetPlan();

    // Now connect agent and set up failing responder
    const agent = await connectAgent();
    setupAgentResponder(agent, { fail: true });
    const execEvents = await executePlan(sessionId, planId);

    expect(execEvents.filter((e) => e.event === 'step_start')).toHaveLength(1);

    const stepCompletes = execEvents.filter((e) => e.event === 'step_complete');
    expect(stepCompletes).toHaveLength(1);
    expect(JSON.parse(stepCompletes[0].data)).toMatchObject({ success: false, exitCode: 1 });

    const completeData = JSON.parse(execEvents.find((e) => e.event === 'complete')!.data);
    expect(completeData.success).toBe(false);
    expect(completeData.failedAtStep).toBeDefined();

    await disconnectAgent(agent);
  }, 15000);

  // --- Test 5: No agent connected ---

  it('should return error SSE when no agent is connected', async () => {
    const { sessionId, planId } = await chatAndGetPlan();
    const execEvents = await executePlan(sessionId, planId);

    expect(execEvents.find((e) => e.event === 'output' && e.data.includes('No agent connected'))).toBeDefined();

    const completeData = JSON.parse(execEvents.find((e) => e.event === 'complete')!.data);
    expect(completeData).toMatchObject({ success: false, error: 'Agent not connected' });
  });

  // --- Test 6: SSE event ordering during execution ---

  it('should emit SSE events in correct order during execution', async () => {
    // Get plan FIRST (before agent connects)
    const { sessionId, planId } = await chatAndGetPlan();

    // Now connect agent and set up responder
    const agent = await connectAgent();
    agent.on('message', (data) => {
      const msg = JSON.parse(String(data));
      if (msg.type === MessageType.STEP_EXECUTE) {
        const payload = msg.payload as { id: string };
        setTimeout(() => {
          agent.send(JSON.stringify({
            type: MessageType.STEP_COMPLETE,
            payload: { stepId: payload.id, success: true, exitCode: 0, stdout: 'ok\n', stderr: '', duration: 20 },
            timestamp: Date.now(),
          }));
        }, 20);
      }
    });

    const execEvents = await executePlan(sessionId, planId);
    const eventTypes = execEvents.map((e) => e.event);

    const firstStepStart = eventTypes.indexOf('step_start');
    const firstOutput = eventTypes.indexOf('output');
    const firstStepComplete = eventTypes.indexOf('step_complete');
    const secondStepStart = eventTypes.indexOf('step_start', firstStepComplete + 1);
    const lastComplete = eventTypes.lastIndexOf('complete');

    expect(firstStepStart).toBeLessThan(firstOutput);
    expect(firstOutput).toBeLessThan(firstStepComplete);
    expect(firstStepComplete).toBeLessThan(secondStepStart);
    expect(lastComplete).toBe(eventTypes.length - 1);

    await disconnectAgent(agent);
  }, 15000);

  // --- Test 7: Chat SSE ordering ---

  it('should emit chat SSE events in correct order', async () => {
    const res = await fetch(`${baseUrl}/api/v1/chat/${serverId}`, {
      method: 'POST', headers: authHeaders(), body: JSON.stringify({ message: 'Install nginx' }),
    });

    const events = parseSSE(await res.text());

    expect(events[0].event).toBe('message');
    expect(JSON.parse(events[0].data).sessionId).toBeDefined();

    const planIdx = events.findIndex((e) => e.event === 'plan');
    const completeIdx = events.findIndex((e) => e.event === 'complete');
    expect(planIdx).toBeGreaterThan(0);
    expect(completeIdx).toBeGreaterThan(planIdx);
    expect(completeIdx).toBe(events.length - 1);
    expect(JSON.parse(events[completeIdx].data).success).toBe(true);
  });
});
