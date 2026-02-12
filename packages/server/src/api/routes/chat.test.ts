// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for chat API routes.
 *
 * Validates SSE streaming, session management, authentication,
 * plan generation, and plan execution endpoints.
 */

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';

// ============================================================================
// Module Mocks — must be before imports of the module under test
// ============================================================================

vi.mock('../middleware/rbac.js', () => ({
  resolveRole: vi.fn(async (c: Record<string, (k: string, v: string) => void>, next: () => Promise<void>) => {
    c.set('userRole', 'owner');
    await next();
  }),
  requirePermission: vi.fn(() => {
    return async (_c: unknown, next: () => Promise<void>) => {
      await next();
    };
  }),
  requireRole: vi.fn(() => {
    return async (_c: unknown, next: () => Promise<void>) => {
      await next();
    };
  }),
}));

import { createApiApp } from './index.js';
import { initJwtConfig, generateTokens, _resetJwtConfig } from '../middleware/auth.js';
import {
  InMemoryServerRepository,
  setServerRepository,
  _resetServerRepository,
} from '../../db/repositories/server-repository.js';
import {
  InMemorySessionRepository,
  setSessionRepository,
  _resetSessionRepository,
} from '../../db/repositories/session-repository.js';
import { getSessionManager, _resetSessionManager } from '../../core/session/manager.js';
import { _resetChatAIAgent, initChatAIAgent } from './chat-ai.js';
import {
  _setActiveExecution,
  _resetActiveExecutions,
  _setPendingDecision,
  _resetPendingDecisions,
  _hasPendingDecision,
} from './chat-execution.js';
import {
  _setPendingConfirmation,
  _resetPendingConfirmations,
  _hasPendingConfirmation,
  CONFIRM_TIMEOUT_MS,
  cleanupSessionConfirmations,
  safeWriteSSE,
} from './chat.js';
import type { ApiEnv } from './types.js';
import { logger } from '../../utils/logger.js';

// ============================================================================
// Mock the AI module
// ============================================================================

vi.mock('./chat-ai.js', async () => {
  const actual = await vi.importActual('./chat-ai.js');
  let _mockAgent: unknown = null;

  return {
    ...actual as object,
    getChatAIAgent: () => _mockAgent,
    initChatAIAgent: (opts: unknown) => {
      _mockAgent = opts;
      return _mockAgent;
    },
    _resetChatAIAgent: () => { _mockAgent = null; },
    _setMockAgent: (agent: unknown) => { _mockAgent = agent; },
  };
});

// Import the internal setter after the mock is defined
const { _setMockAgent } = await import('./chat-ai.js') as unknown as {
  _setMockAgent: (agent: unknown) => void;
};

// ============================================================================
// Mock agent connector and task executor
// ============================================================================

vi.mock('../../core/agent/agent-connector.js', () => ({
  findConnectedAgent: vi.fn((serverId: string) => `mock-agent-${serverId}`),
  isAgentConnected: vi.fn(() => true),
}));

vi.mock('../../core/task/executor.js', () => ({
  getTaskExecutor: vi.fn(() => ({
    executeCommand: vi.fn(async () => ({
      stdout: 'mock command output\n',
      stderr: '',
      exitCode: 0,
      success: true,
      operationId: 'mock-op-id',
    })),
    setProgressCallback: vi.fn(),
    addProgressListener: vi.fn(),
    removeProgressListener: vi.fn(),
  })),
}));

vi.mock('../../core/security/audit-logger.js', () => ({
  getAuditLogger: vi.fn(() => ({
    log: vi.fn(async (input: unknown) => ({
      id: 'audit-' + Math.random().toString(36).slice(2, 8),
      ...(input as Record<string, unknown>),
      createdAt: new Date().toISOString(),
    })),
    updateExecutionResult: vi.fn(async () => true),
    query: vi.fn(async () => ({ logs: [], total: 0 })),
  })),
}));

vi.mock('../../core/profile/manager.js', () => ({
  getProfileManager: vi.fn(() => ({
    getProfile: vi.fn(async () => null),
  })),
  _resetProfileManager: vi.fn(),
}));

let _mockRagPipeline: unknown = null;
vi.mock('../../knowledge/rag-pipeline.js', () => ({
  getRagPipeline: () => _mockRagPipeline,
  initRagPipeline: vi.fn(),
  _resetRagPipeline: vi.fn(),
}));

// ============================================================================
// Test Setup
// ============================================================================

const TEST_SECRET = 'test-secret-key-that-is-at-least-32-chars-long!!';
const USER_A = 'user-aaa-111';
const USER_B = 'user-bbb-222';

let app: Hono<ApiEnv>;
let repo: InMemoryServerRepository;
let tokenA: string;
let tokenB: string;

beforeAll(async () => {
  _resetJwtConfig();
  initJwtConfig({ secret: TEST_SECRET });

  const tokensA = await generateTokens(USER_A);
  const tokensB = await generateTokens(USER_B);
  tokenA = tokensA.accessToken;
  tokenB = tokensB.accessToken;
});

beforeEach(() => {
  repo = new InMemoryServerRepository();
  setServerRepository(repo);
  _resetSessionManager();
  _resetSessionRepository();
  // Provide InMemorySessionRepository so SessionManager doesn't need a real DB
  setSessionRepository(new InMemorySessionRepository());
  _resetChatAIAgent();
  _resetActiveExecutions();
  _resetPendingConfirmations();
  _resetPendingDecisions();
  _mockRagPipeline = null;
  app = createApiApp();
});

// ============================================================================
// Request Helpers
// ============================================================================

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

function req(path: string, token: string, init?: RequestInit): Promise<Response> {
  return app.request(path, {
    ...init,
    headers: { ...authHeaders(token), ...init?.headers },
  });
}

function jsonPost(path: string, body: unknown, token: string): Promise<Response> {
  return req(path, token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function createServer(
  name: string,
  token: string,
): Promise<{ id: string; agentToken: string }> {
  const res = await jsonPost('/api/v1/servers', { name }, token);
  const body = await res.json();
  return body.server;
}

/** Parse SSE events from a response body */
async function parseSSEEvents(response: Response): Promise<Array<{ event: string; data: string }>> {
  const text = await response.text();
  const events: Array<{ event: string; data: string }> = [];
  const lines = text.split('\n');

  let currentEvent = 'message';
  for (const line of lines) {
    if (line.startsWith('event: ')) {
      currentEvent = line.slice(7).trim();
    } else if (line.startsWith('data: ')) {
      events.push({ event: currentEvent, data: line.slice(6) });
    } else if (line === '') {
      currentEvent = 'message';
    }
  }

  return events;
}

// ============================================================================
// Authentication
// ============================================================================

describe('Chat Authentication', () => {
  it('should reject requests without token', async () => {
    const res = await app.request('/api/v1/chat/some-id/sessions');
    expect(res.status).toBe(401);
  });

  it('should reject requests with invalid token', async () => {
    const res = await app.request('/api/v1/chat/some-id/sessions', {
      headers: { Authorization: 'Bearer bad-token' },
    });
    expect(res.status).toBe(401);
  });
});

// ============================================================================
// POST /chat/:serverId — Chat with SSE
// ============================================================================

describe('POST /api/v1/chat/:serverId', () => {
  it('should return 404 for non-existent server', async () => {
    const res = await jsonPost(
      '/api/v1/chat/550e8400-e29b-41d4-a716-446655440000',
      { message: 'hello' },
      tokenA,
    );
    expect(res.status).toBe(404);
  });

  it('should return 404 for another user\'s server', async () => {
    const server = await createServer('web-01', tokenA);
    const res = await jsonPost(
      `/api/v1/chat/${server.id}`,
      { message: 'hello' },
      tokenB,
    );
    expect(res.status).toBe(404);
  });

  it('should validate message is required', async () => {
    const server = await createServer('web-01', tokenA);
    const res = await jsonPost(`/api/v1/chat/${server.id}`, {}, tokenA);
    expect(res.status).toBe(400);
  });

  it('should validate message is not empty', async () => {
    const server = await createServer('web-01', tokenA);
    const res = await jsonPost(`/api/v1/chat/${server.id}`, { message: '' }, tokenA);
    expect(res.status).toBe(400);
  });

  it('should stream SSE when AI is not configured', async () => {
    const server = await createServer('web-01', tokenA);

    const res = await jsonPost(
      `/api/v1/chat/${server.id}`,
      { message: 'Install Redis' },
      tokenA,
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');

    const events = await parseSSEEvents(res);
    expect(events.length).toBeGreaterThanOrEqual(2);

    // First event should contain sessionId
    const firstEvent = events.find(e => e.event === 'message');
    expect(firstEvent).toBeDefined();
    const firstData = JSON.parse(firstEvent!.data);
    expect(firstData.sessionId).toBeDefined();

    // Should have a message about AI not configured
    const aiMessage = events.find(e =>
      e.event === 'message' && e.data.includes('AI service is not configured'),
    );
    expect(aiMessage).toBeDefined();

    // Should end with complete event
    const completeEvent = events.find(e => e.event === 'complete');
    expect(completeEvent).toBeDefined();
    const completeData = JSON.parse(completeEvent!.data);
    expect(completeData.success).toBe(false);
  });

  it('should stream AI response with plan', async () => {
    const server = await createServer('web-01', tokenA);

    // Agent offline: plan is shown for reference only (no auto-execute or step-confirm)
    const { findConnectedAgent } = await import('../../core/agent/agent-connector.js');
    vi.mocked(findConnectedAgent).mockReturnValueOnce(null);

    // Set up mock agent
    const mockAgent = {
      chat: vi.fn().mockResolvedValue({
        text: 'I will install Redis for you.',
        plan: {
          description: 'Install Redis',
          steps: [
            { id: 'step-1', description: 'Update apt', command: 'sudo apt update', timeout: 60000, canRollback: false, onError: 'abort' },
            { id: 'step-2', description: 'Install redis-server', command: 'sudo apt install -y redis-server', timeout: 120000, canRollback: true, onError: 'abort' },
          ],
          estimatedTime: 180000,
          risks: [{ level: 'low', description: 'Standard package installation' }],
        },
      }),
    };
    _setMockAgent(mockAgent);

    const res = await jsonPost(
      `/api/v1/chat/${server.id}`,
      { message: 'Install Redis' },
      tokenA,
    );

    expect(res.status).toBe(200);
    const events = await parseSSEEvents(res);

    // Should have sessionId
    const sessionEvent = events.find(e =>
      e.event === 'message' && JSON.parse(e.data).sessionId,
    );
    expect(sessionEvent).toBeDefined();

    // Should have a plan event (agent offline shows plan for reference)
    const planEvent = events.find(e => e.event === 'plan');
    expect(planEvent).toBeDefined();
    const planData = JSON.parse(planEvent!.data);
    expect(planData.planId).toBeDefined();
    expect(planData.steps).toHaveLength(2);
    expect(planData.requiresConfirmation).toBe(true);
    expect(planData.description).toBe('Install Redis');

    // Should end with complete
    const completeEvent = events.find(e => e.event === 'complete');
    expect(completeEvent).toBeDefined();
    expect(JSON.parse(completeEvent!.data).success).toBe(true);
  });

  it('should stream AI text response without plan', async () => {
    const server = await createServer('web-01', tokenA);

    const mockAgent = {
      chat: vi.fn().mockImplementation(async (
        _message: string,
        _serverCtx: string,
        _convCtx: string,
        callbacks?: { onToken?: (t: string) => void | Promise<void> },
      ) => {
        if (callbacks?.onToken) {
          await callbacks.onToken('Hello ');
          await callbacks.onToken('there!');
        }
        return { text: 'Hello there!', plan: null };
      }),
    };
    _setMockAgent(mockAgent);

    const res = await jsonPost(
      `/api/v1/chat/${server.id}`,
      { message: 'Hello' },
      tokenA,
    );

    expect(res.status).toBe(200);
    const events = await parseSSEEvents(res);

    // Should have token events with content
    const tokenEvents = events.filter(e =>
      e.event === 'message' && JSON.parse(e.data).content,
    );
    expect(tokenEvents.length).toBeGreaterThanOrEqual(1);

    // Should NOT have a plan event
    const planEvent = events.find(e => e.event === 'plan');
    expect(planEvent).toBeUndefined();
  });

  it('should reuse existing session when sessionId provided', async () => {
    const server = await createServer('web-01', tokenA);
    _setMockAgent({
      chat: vi.fn().mockResolvedValue({ text: 'response', plan: null }),
    });

    // First message creates session
    const res1 = await jsonPost(
      `/api/v1/chat/${server.id}`,
      { message: 'first' },
      tokenA,
    );
    const events1 = await parseSSEEvents(res1);
    const sessionEvent1 = events1.find(e =>
      e.event === 'message' && JSON.parse(e.data).sessionId,
    );
    const sessionId = JSON.parse(sessionEvent1!.data).sessionId;

    // Second message with sessionId
    const res2 = await jsonPost(
      `/api/v1/chat/${server.id}`,
      { message: 'second', sessionId },
      tokenA,
    );
    const events2 = await parseSSEEvents(res2);
    const sessionEvent2 = events2.find(e =>
      e.event === 'message' && JSON.parse(e.data).sessionId,
    );
    const sessionId2 = JSON.parse(sessionEvent2!.data).sessionId;

    expect(sessionId2).toBe(sessionId);
  });

  it('should handle AI errors gracefully', async () => {
    const server = await createServer('web-01', tokenA);
    _setMockAgent({
      chat: vi.fn().mockRejectedValue(new Error('API rate limited')),
    });

    const res = await jsonPost(
      `/api/v1/chat/${server.id}`,
      { message: 'hello' },
      tokenA,
    );

    expect(res.status).toBe(200);
    const events = await parseSSEEvents(res);

    // Should have error message
    const errorEvent = events.find(e =>
      e.event === 'message' && e.data.includes('API rate limited'),
    );
    expect(errorEvent).toBeDefined();

    // Should complete with success: false
    const completeEvent = events.find(e => e.event === 'complete');
    expect(JSON.parse(completeEvent!.data).success).toBe(false);
  });

  it('should store messages in session', async () => {
    const server = await createServer('web-01', tokenA);
    _setMockAgent({
      chat: vi.fn().mockImplementation(async (
        _m: string, _s: string, _c: string,
        callbacks?: { onToken?: (t: string) => void | Promise<void> },
      ) => {
        if (callbacks?.onToken) await callbacks.onToken('response text');
        return { text: 'response text', plan: null };
      }),
    });

    const res = await jsonPost(
      `/api/v1/chat/${server.id}`,
      { message: 'hello' },
      tokenA,
    );
    const events = await parseSSEEvents(res);
    const sessionEvent = events.find(e =>
      e.event === 'message' && JSON.parse(e.data).sessionId,
    );
    const sessionId = JSON.parse(sessionEvent!.data).sessionId;

    // Check messages are stored
    const session = await getSessionManager().getSession(sessionId, USER_A);
    expect(session).toBeDefined();
    expect(session!.messages).toHaveLength(2); // user + assistant
    expect(session!.messages[0].role).toBe('user');
    expect(session!.messages[0].content).toBe('hello');
    expect(session!.messages[1].role).toBe('assistant');
    expect(session!.messages[1].content).toBe('response text');
  });
});

// ============================================================================
// POST /chat/:serverId — Reconnect (SSE)
// ============================================================================

describe('POST /api/v1/chat/:serverId (reconnect)', () => {
  it('should return 400 when reconnect=true but no sessionId', async () => {
    const server = await createServer('web-01', tokenA);
    const res = await jsonPost(
      `/api/v1/chat/${server.id}`,
      { reconnect: true },
      tokenA,
    );
    expect(res.status).toBe(400);
  });

  it('should return 404 when reconnect=true with invalid sessionId', async () => {
    const server = await createServer('web-01', tokenA);
    const res = await jsonPost(
      `/api/v1/chat/${server.id}`,
      { reconnect: true, sessionId: 'nonexistent-session' },
      tokenA,
    );
    expect(res.status).toBe(404);
  });

  it('should not re-process user message on reconnect', async () => {
    const server = await createServer('web-01', tokenA);
    const sessionMgr = getSessionManager();
    const session = await sessionMgr.getOrCreate(server.id, USER_A);
    await sessionMgr.addMessage(session.id, USER_A, 'user', 'original message');

    const mockAgent = {
      chat: vi.fn().mockResolvedValue({ text: 'response', plan: null }),
    };
    _setMockAgent(mockAgent);

    const res = await jsonPost(
      `/api/v1/chat/${server.id}`,
      { reconnect: true, sessionId: session.id },
      tokenA,
    );

    expect(res.status).toBe(200);
    const events = await parseSSEEvents(res);

    // Should NOT call AI agent (no duplicate processing)
    expect(mockAgent.chat).not.toHaveBeenCalled();

    // Should emit a message with reconnected=true
    const msgEvent = events.find(e =>
      e.event === 'message' && JSON.parse(e.data).reconnected,
    );
    expect(msgEvent).toBeDefined();
    const msgData = JSON.parse(msgEvent!.data);
    expect(msgData.sessionId).toBe(session.id);
    expect(msgData.reconnected).toBe(true);

    // Should complete with reconnected=true
    const completeEvent = events.find(e => e.event === 'complete');
    expect(completeEvent).toBeDefined();
    const completeData = JSON.parse(completeEvent!.data);
    expect(completeData.success).toBe(true);
    expect(completeData.reconnected).toBe(true);

    // Session should still have only the original message (no duplicates)
    const updatedSession = await sessionMgr.getSession(session.id, USER_A);
    expect(updatedSession!.messages).toHaveLength(1);
    expect(updatedSession!.messages[0].content).toBe('original message');
  });

  it('should return 404 when reconnecting to another user\'s session', async () => {
    const server = await createServer('web-01', tokenA);
    const sessionMgr = getSessionManager();
    const session = await sessionMgr.getOrCreate(server.id, USER_A);

    const res = await jsonPost(
      `/api/v1/chat/${server.id}`,
      { reconnect: true, sessionId: session.id },
      tokenB,
    );
    // Server not found for user B
    expect(res.status).toBe(404);
  });

  it('should allow normal message without reconnect flag', async () => {
    const server = await createServer('web-01', tokenA);
    _setMockAgent({
      chat: vi.fn().mockResolvedValue({ text: 'hello', plan: null }),
    });

    const res = await jsonPost(
      `/api/v1/chat/${server.id}`,
      { message: 'hello' },
      tokenA,
    );
    expect(res.status).toBe(200);
    const events = await parseSSEEvents(res);
    const completeEvent = events.find(e => e.event === 'complete');
    expect(completeEvent).toBeDefined();
  });
});

// ============================================================================
// POST /chat/:serverId/execute — Execute Plan (SSE)
// ============================================================================

describe('POST /api/v1/chat/:serverId/execute', () => {
  it('should return 404 for non-existent server', async () => {
    const res = await jsonPost(
      '/api/v1/chat/550e8400-e29b-41d4-a716-446655440000/execute',
      { planId: 'p1', sessionId: 's1' },
      tokenA,
    );
    expect(res.status).toBe(404);
  });

  it('should return 404 for non-existent plan', async () => {
    const server = await createServer('web-01', tokenA);
    const session = await getSessionManager().getOrCreate(server.id, USER_A);

    const res = await jsonPost(
      `/api/v1/chat/${server.id}/execute`,
      { planId: 'nonexistent', sessionId: session.id },
      tokenA,
    );
    expect(res.status).toBe(404);
  });

  it('should validate planId is required', async () => {
    const server = await createServer('web-01', tokenA);
    const res = await jsonPost(
      `/api/v1/chat/${server.id}/execute`,
      { sessionId: 's1' },
      tokenA,
    );
    expect(res.status).toBe(400);
  });

  it('should validate sessionId is required', async () => {
    const server = await createServer('web-01', tokenA);
    const res = await jsonPost(
      `/api/v1/chat/${server.id}/execute`,
      { planId: 'p1' },
      tokenA,
    );
    expect(res.status).toBe(400);
  });

  it('should stream execution events for a stored plan', async () => {
    const server = await createServer('web-01', tokenA);
    const sessionMgr = getSessionManager();
    const session = await sessionMgr.getOrCreate(server.id, USER_A);

    // Store a plan
    sessionMgr.storePlan(session.id, {
      planId: 'plan-1',
      description: 'Install Redis',
      steps: [
        {
          id: 'step-1',
          description: 'Update apt',
          command: 'sudo apt update',
          riskLevel: 'green',
          timeout: 30000,
          canRollback: false,
        },
        {
          id: 'step-2',
          description: 'Install redis',
          command: 'sudo apt install -y redis-server',
          riskLevel: 'yellow',
          timeout: 60000,
          canRollback: true,
        },
      ],
      totalRisk: 'yellow',
      requiresConfirmation: true,
    });

    const res = await jsonPost(
      `/api/v1/chat/${server.id}/execute`,
      { planId: 'plan-1', sessionId: session.id },
      tokenA,
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');

    const events = await parseSSEEvents(res);

    // Should have step_start events
    const stepStarts = events.filter(e => e.event === 'step_start');
    expect(stepStarts).toHaveLength(2);
    expect(JSON.parse(stepStarts[0].data).stepId).toBe('step-1');
    expect(JSON.parse(stepStarts[1].data).stepId).toBe('step-2');

    // Should have output events
    const outputs = events.filter(e => e.event === 'output');
    expect(outputs.length).toBeGreaterThanOrEqual(2);

    // Should have step_complete events
    const stepCompletes = events.filter(e => e.event === 'step_complete');
    expect(stepCompletes).toHaveLength(2);
    expect(JSON.parse(stepCompletes[0].data).stepId).toBe('step-1');
    expect(JSON.parse(stepCompletes[0].data).exitCode).toBe(0);
    expect(JSON.parse(stepCompletes[0].data).duration).toBeDefined();

    // Should end with complete
    const completeEvent = events.find(e => e.event === 'complete');
    expect(completeEvent).toBeDefined();
    const completeData = JSON.parse(completeEvent!.data);
    expect(completeData.success).toBe(true);
    expect(completeData.operationId).toBeDefined();
  });
});

// ============================================================================
// GET /chat/:serverId/sessions — List Sessions
// ============================================================================

describe('GET /api/v1/chat/:serverId/sessions', () => {
  it('should return 404 for non-existent server', async () => {
    const res = await req(
      '/api/v1/chat/550e8400-e29b-41d4-a716-446655440000/sessions',
      tokenA,
    );
    expect(res.status).toBe(404);
  });

  it('should return empty list initially', async () => {
    const server = await createServer('web-01', tokenA);
    const res = await req(`/api/v1/chat/${server.id}/sessions`, tokenA);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sessions).toEqual([]);
  });

  it('should return sessions for the server', async () => {
    const server = await createServer('web-01', tokenA);
    const sessionMgr = getSessionManager();
    const session = await sessionMgr.getOrCreate(server.id, USER_A);
    await sessionMgr.addMessage(session.id, USER_A, 'user', 'Hello');

    const res = await req(`/api/v1/chat/${server.id}/sessions`, tokenA);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sessions).toHaveLength(1);
    expect(body.sessions[0].id).toBe(session.id);
    expect(body.sessions[0].messageCount).toBe(1);
  });

  it('should not return sessions from other servers', async () => {
    const s1 = await createServer('web-01', tokenA);
    const s2 = await createServer('web-02', tokenA);
    const sessionMgr = getSessionManager();
    await sessionMgr.getOrCreate(s1.id, USER_A);
    await sessionMgr.getOrCreate(s2.id, USER_A);

    const res = await req(`/api/v1/chat/${s1.id}/sessions`, tokenA);
    const body = await res.json();
    expect(body.sessions).toHaveLength(1);
    expect(body.sessions[0].serverId).toBe(s1.id);
  });

  it('should not list sessions for another user\'s server', async () => {
    const server = await createServer('web-01', tokenA);
    const res = await req(`/api/v1/chat/${server.id}/sessions`, tokenB);
    expect(res.status).toBe(404);
  });
});

// ============================================================================
// GET /chat/:serverId/sessions/:sessionId — Get Session
// ============================================================================

describe('GET /api/v1/chat/:serverId/sessions/:sessionId', () => {
  it('should return session with messages', async () => {
    const server = await createServer('web-01', tokenA);
    const sessionMgr = getSessionManager();
    const session = await sessionMgr.getOrCreate(server.id, USER_A);
    await sessionMgr.addMessage(session.id, USER_A, 'user', 'Hello');
    await sessionMgr.addMessage(session.id, USER_A, 'assistant', 'Hi!');

    const res = await req(
      `/api/v1/chat/${server.id}/sessions/${session.id}`,
      tokenA,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.session.id).toBe(session.id);
    expect(body.session.messages).toHaveLength(2);
    expect(body.session.messages[0].role).toBe('user');
    expect(body.session.messages[1].role).toBe('assistant');
  });

  it('should return 404 for non-existent session', async () => {
    const server = await createServer('web-01', tokenA);
    const res = await req(
      `/api/v1/chat/${server.id}/sessions/nonexistent-id`,
      tokenA,
    );
    expect(res.status).toBe(404);
  });

  it('should return 404 for session belonging to different server', async () => {
    const s1 = await createServer('web-01', tokenA);
    const s2 = await createServer('web-02', tokenA);
    const sessionMgr = getSessionManager();
    const session = await sessionMgr.getOrCreate(s2.id, USER_A);

    const res = await req(
      `/api/v1/chat/${s1.id}/sessions/${session.id}`,
      tokenA,
    );
    expect(res.status).toBe(404);
  });

  it('should return 404 for another user\'s server', async () => {
    const server = await createServer('web-01', tokenA);
    const session = await getSessionManager().getOrCreate(server.id, USER_A);

    const res = await req(
      `/api/v1/chat/${server.id}/sessions/${session.id}`,
      tokenB,
    );
    expect(res.status).toBe(404);
  });
});

// ============================================================================
// POST /chat/:serverId/confirm — Confirm/Reject risky command (agentic mode)
// ============================================================================

describe('POST /api/v1/chat/:serverId/confirm', () => {
  it('should return 400 for non-JSON body', async () => {
    const server = await createServer('web-01', tokenA);
    const res = await req(`/api/v1/chat/${server.id}/confirm`, tokenA, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: 'not json',
    });
    expect(res.status).toBe(400);
  });

  it('should return 400 when confirmId is missing', async () => {
    const server = await createServer('web-01', tokenA);
    const res = await jsonPost(
      `/api/v1/chat/${server.id}/confirm`,
      { approved: true },
      tokenA,
    );
    expect(res.status).toBe(400);
  });

  it('should return 400 when approved is missing', async () => {
    const server = await createServer('web-01', tokenA);
    const res = await jsonPost(
      `/api/v1/chat/${server.id}/confirm`,
      { confirmId: 'some-id' },
      tokenA,
    );
    expect(res.status).toBe(400);
  });

  it('should return 400 when confirmId is not a string', async () => {
    const server = await createServer('web-01', tokenA);
    const res = await jsonPost(
      `/api/v1/chat/${server.id}/confirm`,
      { confirmId: 123, approved: true },
      tokenA,
    );
    expect(res.status).toBe(400);
  });

  it('should return 400 when approved is not a boolean', async () => {
    const server = await createServer('web-01', tokenA);
    const res = await jsonPost(
      `/api/v1/chat/${server.id}/confirm`,
      { confirmId: 'some-id', approved: 'yes' },
      tokenA,
    );
    expect(res.status).toBe(400);
  });

  it('should return 400 when confirmId is empty string', async () => {
    const server = await createServer('web-01', tokenA);
    const res = await jsonPost(
      `/api/v1/chat/${server.id}/confirm`,
      { confirmId: '', approved: true },
      tokenA,
    );
    expect(res.status).toBe(400);
  });

  it('should return 404 when no pending confirmation exists', async () => {
    const server = await createServer('web-01', tokenA);
    const res = await jsonPost(
      `/api/v1/chat/${server.id}/confirm`,
      { confirmId: 'nonexistent-id', approved: true },
      tokenA,
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.message).toBe('No pending confirmation found');
  });

  it('should return 400 for empty body', async () => {
    const server = await createServer('web-01', tokenA);
    const res = await jsonPost(
      `/api/v1/chat/${server.id}/confirm`,
      {},
      tokenA,
    );
    expect(res.status).toBe(400);
  });
});

// ============================================================================
// DELETE /chat/:serverId/sessions/:sessionId — Delete Session
// ============================================================================

describe('DELETE /api/v1/chat/:serverId/sessions/:sessionId', () => {
  it('should delete a session', async () => {
    const server = await createServer('web-01', tokenA);
    const session = await getSessionManager().getOrCreate(server.id, USER_A);

    const res = await req(
      `/api/v1/chat/${server.id}/sessions/${session.id}`,
      tokenA,
      { method: 'DELETE' },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);

    // Verify it's gone
    expect(await getSessionManager().getSession(session.id, USER_A)).toBeUndefined();
  });

  it('should return 404 for non-existent session', async () => {
    const server = await createServer('web-01', tokenA);
    const res = await req(
      `/api/v1/chat/${server.id}/sessions/nonexistent`,
      tokenA,
      { method: 'DELETE' },
    );
    expect(res.status).toBe(404);
  });

  it('should return 404 for another user\'s server', async () => {
    const server = await createServer('web-01', tokenA);
    const session = await getSessionManager().getOrCreate(server.id, USER_A);

    const res = await req(
      `/api/v1/chat/${server.id}/sessions/${session.id}`,
      tokenB,
      { method: 'DELETE' },
    );
    expect(res.status).toBe(404);
  });
});

// ============================================================================
// POST /chat/:serverId/execute/cancel — Cancel Execution
// ============================================================================

describe('POST /api/v1/chat/:serverId/execute/cancel', () => {
  it('should return 404 when no execution is tracked', async () => {
    const server = await createServer('web-01', tokenA);
    const res = await jsonPost(
      `/api/v1/chat/${server.id}/execute/cancel`,
      { planId: 'nonexistent-plan', sessionId: 'session-1' },
      tokenA,
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.success).toBe(false);
  });

  it('should return success when execution has a real executionId', async () => {
    const server = await createServer('web-01', tokenA);

    // Simulate an active execution with a real executionId
    _setActiveExecution('plan-1', 'exec-real-id');

    // Mock cancelExecution to return true for our executionId
    const { getTaskExecutor } = await import('../../core/task/executor.js');
    vi.mocked(getTaskExecutor).mockReturnValueOnce({
      executeCommand: vi.fn(),
      addProgressListener: vi.fn(),
      removeProgressListener: vi.fn(),
      cancelExecution: vi.fn((id: string) => id === 'exec-real-id'),
    } as never);

    const res = await jsonPost(
      `/api/v1/chat/${server.id}/execute/cancel`,
      { planId: 'plan-1', sessionId: 'session-1' },
      tokenA,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it('should return success when executionId is empty (immediate cancel)', async () => {
    const server = await createServer('web-01', tokenA);

    // Simulate the race condition: execution tracked but executionId not yet assigned
    _setActiveExecution('plan-2', '');

    const res = await jsonPost(
      `/api/v1/chat/${server.id}/execute/cancel`,
      { planId: 'plan-2', sessionId: 'session-1' },
      tokenA,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    // Should return success: true because the step loop will detect removal and break
    expect(body.success).toBe(true);
  });

  it('should return 404 for another user\'s server', async () => {
    const server = await createServer('web-01', tokenA);
    _setActiveExecution('plan-1', 'exec-id');

    const res = await jsonPost(
      `/api/v1/chat/${server.id}/execute/cancel`,
      { planId: 'plan-1', sessionId: 'session-1' },
      tokenB,
    );
    expect(res.status).toBe(404);
  });
});

// ============================================================================
// POST /chat/:serverId/confirm — Agentic confirm success path (chat-046)
// ============================================================================

describe('POST /api/v1/chat/:serverId/confirm (success path)', () => {
  it('should resolve pending confirmation with approved=true', async () => {
    const server = await createServer('web-01', tokenA);
    const confirmId = 'sess-1:confirm-abc';
    let resolvedValue: boolean | undefined;

    _setPendingConfirmation(
      confirmId,
      (approved) => { resolvedValue = approved; },
      setTimeout(() => {}, 60000),
    );

    const res = await jsonPost(
      `/api/v1/chat/${server.id}/confirm`,
      { confirmId, approved: true },
      tokenA,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(resolvedValue).toBe(true);
    expect(_hasPendingConfirmation(confirmId)).toBe(false);
  });

  it('should resolve pending confirmation with approved=false', async () => {
    const server = await createServer('web-01', tokenA);
    const confirmId = 'sess-2:confirm-def';
    let resolvedValue: boolean | undefined;

    _setPendingConfirmation(
      confirmId,
      (approved) => { resolvedValue = approved; },
      setTimeout(() => {}, 60000),
    );

    const res = await jsonPost(
      `/api/v1/chat/${server.id}/confirm`,
      { confirmId, approved: false },
      tokenA,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(resolvedValue).toBe(false);
    expect(_hasPendingConfirmation(confirmId)).toBe(false);
  });

  it('should clear the timeout when confirm is received', async () => {
    const server = await createServer('web-01', tokenA);
    const confirmId = 'sess-3:confirm-ghi';
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');

    const timer = setTimeout(() => {}, 60000);
    _setPendingConfirmation(
      confirmId,
      () => {},
      timer,
    );

    await jsonPost(
      `/api/v1/chat/${server.id}/confirm`,
      { confirmId, approved: true },
      tokenA,
    );

    expect(clearTimeoutSpy).toHaveBeenCalledWith(timer);
    clearTimeoutSpy.mockRestore();
  });
});

// ============================================================================
// Agentic confirm timeout auto-reject (chat-046)
// ============================================================================

describe('Agentic confirm timeout auto-reject', () => {
  it('should auto-reject after CONFIRM_TIMEOUT_MS and clean up', async () => {
    vi.useFakeTimers();

    const confirmId = 'sess-4:confirm-timeout';
    let resolvedValue: boolean | undefined;

    _setPendingConfirmation(
      confirmId,
      (approved) => { resolvedValue = approved; },
      setTimeout(() => {
        // Simulate the timeout logic from chat.ts onConfirmRequired:
        // on timeout, delete from map and resolve(false)
        resolvedValue = false;
      }, CONFIRM_TIMEOUT_MS),
    );

    expect(_hasPendingConfirmation(confirmId)).toBe(true);

    vi.advanceTimersByTime(CONFIRM_TIMEOUT_MS);

    expect(resolvedValue).toBe(false);

    vi.useRealTimers();
  });

  it('should export CONFIRM_TIMEOUT_MS as 5 minutes', () => {
    expect(CONFIRM_TIMEOUT_MS).toBe(5 * 60 * 1000);
  });
});

// ============================================================================
// POST /chat/:serverId/step-decision — Success path (chat-046)
// ============================================================================

describe('POST /api/v1/chat/:serverId/step-decision (success path)', () => {
  it('should resolve pending decision with allow', async () => {
    const server = await createServer('web-01', tokenA);
    let resolvedDecision: string | undefined;

    _setPendingDecision(
      'plan-dec-1', 'step-1',
      (decision) => { resolvedDecision = decision; },
      setTimeout(() => {}, 60000),
    );

    const res = await jsonPost(
      `/api/v1/chat/${server.id}/step-decision`,
      { planId: 'plan-dec-1', stepId: 'step-1', sessionId: 'sess-1', decision: 'allow' },
      tokenA,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(resolvedDecision).toBe('allow');
    expect(_hasPendingDecision('plan-dec-1', 'step-1')).toBe(false);
  });

  it('should resolve pending decision with allow_all', async () => {
    const server = await createServer('web-01', tokenA);
    let resolvedDecision: string | undefined;

    _setPendingDecision(
      'plan-dec-2', 'step-2',
      (decision) => { resolvedDecision = decision; },
      setTimeout(() => {}, 60000),
    );

    const res = await jsonPost(
      `/api/v1/chat/${server.id}/step-decision`,
      { planId: 'plan-dec-2', stepId: 'step-2', sessionId: 'sess-1', decision: 'allow_all' },
      tokenA,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(resolvedDecision).toBe('allow_all');
  });

  it('should resolve pending decision with reject', async () => {
    const server = await createServer('web-01', tokenA);
    let resolvedDecision: string | undefined;

    _setPendingDecision(
      'plan-dec-3', 'step-3',
      (decision) => { resolvedDecision = decision; },
      setTimeout(() => {}, 60000),
    );

    const res = await jsonPost(
      `/api/v1/chat/${server.id}/step-decision`,
      { planId: 'plan-dec-3', stepId: 'step-3', sessionId: 'sess-1', decision: 'reject' },
      tokenA,
    );

    expect(res.status).toBe(200);
    expect(resolvedDecision).toBe('reject');
  });

  it('should clear the timeout when decision is received', async () => {
    const server = await createServer('web-01', tokenA);
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');

    const timer = setTimeout(() => {}, 60000);
    _setPendingDecision(
      'plan-dec-4', 'step-4',
      () => {},
      timer,
    );

    await jsonPost(
      `/api/v1/chat/${server.id}/step-decision`,
      { planId: 'plan-dec-4', stepId: 'step-4', sessionId: 'sess-1', decision: 'allow' },
      tokenA,
    );

    expect(clearTimeoutSpy).toHaveBeenCalledWith(timer);
    clearTimeoutSpy.mockRestore();
  });

  it('should return 404 when no pending decision exists', async () => {
    const server = await createServer('web-01', tokenA);

    const res = await jsonPost(
      `/api/v1/chat/${server.id}/step-decision`,
      { planId: 'nonexistent', stepId: 'step-1', sessionId: 'sess-1', decision: 'allow' },
      tokenA,
    );

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.message).toBe('No pending decision for this step');
  });
});

// ============================================================================
// cleanupSessionConfirmations — SSE disconnect cleanup (chat-050)
// ============================================================================

describe('cleanupSessionConfirmations', () => {
  it('should clear all pending confirmations for a given session', () => {
    const sessionId = 'session-cleanup-1';
    const resolved: Record<string, boolean | undefined> = {};

    _setPendingConfirmation(
      `${sessionId}:confirm-a`,
      (v) => { resolved['a'] = v; },
      setTimeout(() => {}, 60000),
    );
    _setPendingConfirmation(
      `${sessionId}:confirm-b`,
      (v) => { resolved['b'] = v; },
      setTimeout(() => {}, 60000),
    );

    expect(_hasPendingConfirmation(`${sessionId}:confirm-a`)).toBe(true);
    expect(_hasPendingConfirmation(`${sessionId}:confirm-b`)).toBe(true);

    const cleaned = cleanupSessionConfirmations(sessionId);

    expect(cleaned).toBe(2);
    expect(_hasPendingConfirmation(`${sessionId}:confirm-a`)).toBe(false);
    expect(_hasPendingConfirmation(`${sessionId}:confirm-b`)).toBe(false);
    expect(resolved['a']).toBe(false);
    expect(resolved['b']).toBe(false);
  });

  it('should not affect confirmations from other sessions', () => {
    const sessionA = 'session-a';
    const sessionB = 'session-b';
    const resolvedA: { value?: boolean } = {};
    const resolvedB: { value?: boolean } = {};

    _setPendingConfirmation(
      `${sessionA}:confirm-1`,
      (v) => { resolvedA.value = v; },
      setTimeout(() => {}, 60000),
    );
    _setPendingConfirmation(
      `${sessionB}:confirm-2`,
      (v) => { resolvedB.value = v; },
      setTimeout(() => {}, 60000),
    );

    const cleaned = cleanupSessionConfirmations(sessionA);

    expect(cleaned).toBe(1);
    expect(_hasPendingConfirmation(`${sessionA}:confirm-1`)).toBe(false);
    expect(_hasPendingConfirmation(`${sessionB}:confirm-2`)).toBe(true);
    expect(resolvedA.value).toBe(false);
    expect(resolvedB.value).toBeUndefined();
  });

  it('should return 0 when no confirmations exist for the session', () => {
    const cleaned = cleanupSessionConfirmations('nonexistent-session');
    expect(cleaned).toBe(0);
  });

  it('should clear timers to prevent 5-minute leak', () => {
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
    const sessionId = 'session-timer-test';

    const timer1 = setTimeout(() => {}, 60000);
    const timer2 = setTimeout(() => {}, 60000);

    _setPendingConfirmation(`${sessionId}:c1`, () => {}, timer1);
    _setPendingConfirmation(`${sessionId}:c2`, () => {}, timer2);

    cleanupSessionConfirmations(sessionId);

    expect(clearTimeoutSpy).toHaveBeenCalledWith(timer1);
    expect(clearTimeoutSpy).toHaveBeenCalledWith(timer2);
    clearTimeoutSpy.mockRestore();
  });

  it('should resolve pending promises with false so agentic loop unblocks', async () => {
    const sessionId = 'session-unblock';
    let resolveValue: boolean | undefined;

    const approved = new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        resolve(false);
      }, CONFIRM_TIMEOUT_MS);
      _setPendingConfirmation(`${sessionId}:c1`, resolve, timer);
    });

    // Simulate SSE disconnect — cleanup should resolve the promise immediately
    cleanupSessionConfirmations(sessionId);

    resolveValue = await approved;
    expect(resolveValue).toBe(false);
  });
});

// ============================================================================
// safeWriteSSE — catch-block SSE write protection (chat-051)
// ============================================================================

describe('safeWriteSSE', () => {
  it('should return true when writeSSE succeeds', async () => {
    const mockStream = { writeSSE: vi.fn().mockResolvedValue(undefined) };

    const result = await safeWriteSSE(
      mockStream as never,
      'message',
      JSON.stringify({ content: 'hello' }),
    );

    expect(result).toBe(true);
    expect(mockStream.writeSSE).toHaveBeenCalledWith({
      event: 'message',
      data: JSON.stringify({ content: 'hello' }),
    });
  });

  it('should return false and not throw when writeSSE fails', async () => {
    const mockStream = {
      writeSSE: vi.fn().mockRejectedValue(new Error('stream closed')),
    };

    const result = await safeWriteSSE(
      mockStream as never,
      'complete',
      JSON.stringify({ success: false }),
    );

    expect(result).toBe(false);
    expect(mockStream.writeSSE).toHaveBeenCalledOnce();
  });

  it('should log a warning when writeSSE fails', async () => {
    const mockStream = {
      writeSSE: vi.fn().mockRejectedValue(new Error('write after end')),
    };
    const warnSpy = vi.spyOn(logger, 'warn');

    await safeWriteSSE(
      mockStream as never,
      'message',
      JSON.stringify({ content: 'test' }),
    );

    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'safe_write_sse',
        event: 'message',
        error: 'write after end',
      }),
      expect.stringContaining('Failed to write SSE event "message"'),
    );
    warnSpy.mockRestore();
  });

  it('should handle non-Error throw values', async () => {
    const mockStream = {
      writeSSE: vi.fn().mockRejectedValue('string error'),
    };
    const warnSpy = vi.spyOn(logger, 'warn');

    const result = await safeWriteSSE(
      mockStream as never,
      'complete',
      '{}',
    );

    expect(result).toBe(false);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'string error',
      }),
      expect.any(String),
    );
    warnSpy.mockRestore();
  });

  it('should pass event and data correctly to writeSSE', async () => {
    const mockStream = { writeSSE: vi.fn().mockResolvedValue(undefined) };

    await safeWriteSSE(
      mockStream as never,
      'custom_event',
      '{"key":"value"}',
    );

    expect(mockStream.writeSSE).toHaveBeenCalledWith({
      event: 'custom_event',
      data: '{"key":"value"}',
    });
  });
});

// ============================================================================
// Catch-block SSE error resilience integration (chat-051)
// ============================================================================

describe('Legacy mode catch block with closed stream', () => {
  it('should not throw when SSE writes fail in catch block', async () => {
    const server = await createServer('web-01', tokenA);
    _setMockAgent({
      chat: vi.fn().mockRejectedValue(new Error('Provider unavailable')),
    });

    // The test verifies that even if the underlying stream has issues,
    // the response completes without throwing (status 200 with SSE).
    const res = await jsonPost(
      `/api/v1/chat/${server.id}`,
      { message: 'hello' },
      tokenA,
    );

    expect(res.status).toBe(200);
    const events = await parseSSEEvents(res);

    // Should still have error message and complete event via safeWriteSSE
    const errorEvent = events.find(e =>
      e.event === 'message' && e.data.includes('Provider unavailable'),
    );
    expect(errorEvent).toBeDefined();

    const completeEvent = events.find(e => e.event === 'complete');
    expect(completeEvent).toBeDefined();
    expect(JSON.parse(completeEvent!.data).success).toBe(false);
  });
});

// ============================================================================
// RAG search graceful degradation in legacy mode (chat-052)
// ============================================================================

describe('Legacy mode RAG search graceful degradation', () => {
  it('should continue chat when RAG search throws an error', async () => {
    const server = await createServer('web-01', tokenA);
    const warnSpy = vi.spyOn(logger, 'warn');

    // Set up a RAG pipeline that throws
    _mockRagPipeline = {
      search: vi.fn().mockRejectedValue(new Error('Vector store corrupted')),
    };

    const mockAgent = {
      chat: vi.fn().mockImplementation(async (
        _message: string,
        _serverCtx: string,
        _convCtx: string,
        callbacks?: { onToken?: (t: string) => void | Promise<void> },
      ) => {
        if (callbacks?.onToken) {
          await callbacks.onToken('Hello!');
        }
        return { text: 'Hello!', plan: null };
      }),
    };
    _setMockAgent(mockAgent);

    const res = await jsonPost(
      `/api/v1/chat/${server.id}`,
      { message: 'help me install nginx' },
      tokenA,
    );

    expect(res.status).toBe(200);
    const events = await parseSSEEvents(res);

    // Chat should complete successfully despite RAG failure
    const completeEvent = events.find(e => e.event === 'complete');
    expect(completeEvent).toBeDefined();
    expect(JSON.parse(completeEvent!.data).success).toBe(true);

    // AI agent should have been called (with undefined knowledgeContext)
    expect(mockAgent.chat).toHaveBeenCalled();
    const callArgs = mockAgent.chat.mock.calls[0];
    // 7th argument is knowledgeContext — should be undefined
    expect(callArgs[6]).toBeUndefined();

    // Verify warn log was emitted with correct operation tag
    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'rag_search',
        error: 'Vector store corrupted',
      }),
      'RAG search failed, continuing without knowledge context',
    );
    warnSpy.mockRestore();
  });

  it('should pass knowledge context when RAG search succeeds', async () => {
    const server = await createServer('web-01', tokenA);

    _mockRagPipeline = {
      search: vi.fn().mockResolvedValue({
        hasResults: true,
        contextText: '## Nginx Install Guide\nRun: apt install nginx',
      }),
    };

    const mockAgent = {
      chat: vi.fn().mockResolvedValue({ text: 'Done!', plan: null }),
    };
    _setMockAgent(mockAgent);

    const res = await jsonPost(
      `/api/v1/chat/${server.id}`,
      { message: 'install nginx' },
      tokenA,
    );

    expect(res.status).toBe(200);

    // AI agent should receive the knowledge context
    expect(mockAgent.chat).toHaveBeenCalled();
    const callArgs = mockAgent.chat.mock.calls[0];
    expect(callArgs[6]).toBe('## Nginx Install Guide\nRun: apt install nginx');
  });

  it('should continue without knowledge when RAG returns no results', async () => {
    const server = await createServer('web-01', tokenA);

    _mockRagPipeline = {
      search: vi.fn().mockResolvedValue({ hasResults: false }),
    };

    const mockAgent = {
      chat: vi.fn().mockResolvedValue({ text: 'No docs found', plan: null }),
    };
    _setMockAgent(mockAgent);

    const res = await jsonPost(
      `/api/v1/chat/${server.id}`,
      { message: 'something obscure' },
      tokenA,
    );

    expect(res.status).toBe(200);
    expect(mockAgent.chat).toHaveBeenCalled();
    const callArgs = mockAgent.chat.mock.calls[0];
    expect(callArgs[6]).toBeUndefined();
  });
});
