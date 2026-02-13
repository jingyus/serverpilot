// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for chat session export API route.
 *
 * Validates JSON and Markdown export, permission checks,
 * Content-Type/Disposition headers, and edge cases.
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
}));

vi.mock('../../core/profile/manager.js', () => ({
  getProfileManager: vi.fn(() => ({
    getProfile: vi.fn(async () => null),
  })),
}));

vi.mock('../../knowledge/rag-pipeline.js', () => ({
  getRagPipeline: () => null,
  initRagPipeline: vi.fn(),
  _resetRagPipeline: vi.fn(),
}));

vi.mock('./chat-ai.js', async () => {
  const actual = await vi.importActual('./chat-ai.js');
  return {
    ...actual as object,
    getChatAIAgent: () => null,
    initChatAIAgent: vi.fn(),
    _resetChatAIAgent: vi.fn(),
  };
});

vi.mock('../../core/agent/agent-connector.js', () => ({
  findConnectedAgent: vi.fn(() => null),
  isAgentConnected: vi.fn(() => false),
}));

vi.mock('../../core/task/executor.js', () => ({
  getTaskExecutor: vi.fn(() => ({
    executeCommand: vi.fn(),
    setProgressCallback: vi.fn(),
    addProgressListener: vi.fn(),
    removeProgressListener: vi.fn(),
  })),
}));

vi.mock('../../core/security/audit-logger.js', () => ({
  getAuditLogger: vi.fn(() => ({
    log: vi.fn(),
    updateExecutionResult: vi.fn(),
    query: vi.fn(async () => ({ logs: [], total: 0 })),
  })),
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
import { buildExportMarkdown, buildExportFilename } from './chat-export.js';
import type { ApiEnv } from './types.js';

// ============================================================================
// Test Setup
// ============================================================================

const TEST_SECRET = 'test-secret-key-that-is-at-least-32-chars-long!!';
const USER_A = 'user-export-aaa';
const USER_B = 'user-export-bbb';

let app: Hono<ApiEnv>;
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
  setServerRepository(new InMemoryServerRepository());
  _resetSessionManager();
  _resetSessionRepository();
  setSessionRepository(new InMemorySessionRepository());
  app = createApiApp();
});

// ============================================================================
// Helpers
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

async function createServer(name: string, token: string): Promise<{ id: string }> {
  const res = await jsonPost('/api/v1/servers', { name }, token);
  const body = await res.json();
  return body.server;
}

async function createSessionWithMessages(
  serverId: string,
  userId: string,
  sessionName?: string,
): Promise<string> {
  const mgr = getSessionManager();
  const session = await mgr.getOrCreate(serverId, userId);
  if (sessionName) {
    await mgr.renameSession(session.id, serverId, userId, sessionName);
  }
  await mgr.addMessage(session.id, userId, 'user', 'Hello, how do I install nginx?');
  await mgr.addMessage(session.id, userId, 'assistant', 'Run `sudo apt install nginx`');
  await mgr.addMessage(session.id, userId, 'user', 'Thanks!');
  return session.id;
}

// ============================================================================
// GET /chat/:serverId/sessions/:sessionId/export
// ============================================================================

describe('GET /api/v1/chat/:serverId/sessions/:sessionId/export', () => {
  it('should export session as JSON by default', async () => {
    const server = await createServer('web-01', tokenA);
    const sessionId = await createSessionWithMessages(server.id, USER_A);

    const res = await req(
      `/api/v1/chat/${server.id}/sessions/${sessionId}/export`,
      tokenA,
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(res.headers.get('content-disposition')).toContain('attachment');
    expect(res.headers.get('content-disposition')).toContain('.json');
    expect(res.headers.get('cache-control')).toBe('no-cache');

    const data = await res.json();
    expect(data.id).toBe(sessionId);
    expect(data.serverId).toBe(server.id);
    expect(data.format).toBe('json');
    expect(data.messages).toHaveLength(3);
    expect(data.messages[0].role).toBe('user');
    expect(data.messages[0].content).toBe('Hello, how do I install nginx?');
    expect(data.exportedAt).toBeDefined();
    expect(data.createdAt).toBeDefined();
  });

  it('should export session as JSON with explicit format parameter', async () => {
    const server = await createServer('web-02', tokenA);
    const sessionId = await createSessionWithMessages(server.id, USER_A);

    const res = await req(
      `/api/v1/chat/${server.id}/sessions/${sessionId}/export?format=json`,
      tokenA,
    );

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.format).toBe('json');
    expect(data.messages).toHaveLength(3);
  });

  it('should export session as Markdown', async () => {
    const server = await createServer('web-03', tokenA);
    const sessionId = await createSessionWithMessages(server.id, USER_A, 'Nginx Setup');

    const res = await req(
      `/api/v1/chat/${server.id}/sessions/${sessionId}/export?format=markdown`,
      tokenA,
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/markdown');
    expect(res.headers.get('content-disposition')).toContain('.md');
    expect(res.headers.get('content-disposition')).toContain('Nginx_Setup');

    const text = await res.text();
    expect(text).toContain('# Nginx Setup');
    expect(text).toContain('**Server:** web-03');
    expect(text).toContain('**Exported:**');
    expect(text).toContain('### User');
    expect(text).toContain('> Hello, how do I install nginx?');
    expect(text).toContain('### Assistant');
    expect(text).toContain('Run `sudo apt install nginx`');
  });

  it('should return 404 for non-existent server', async () => {
    const res = await req(
      '/api/v1/chat/550e8400-e29b-41d4-a716-446655440000/sessions/some-id/export',
      tokenA,
    );
    expect(res.status).toBe(404);
  });

  it('should return 404 for non-existent session', async () => {
    const server = await createServer('web-04', tokenA);
    const res = await req(
      `/api/v1/chat/${server.id}/sessions/non-existent-session/export`,
      tokenA,
    );
    expect(res.status).toBe(404);
  });

  it('should return 404 when exporting another user\'s session', async () => {
    const server = await createServer('web-05', tokenA);
    const sessionId = await createSessionWithMessages(server.id, USER_A);

    // User B tries to export User A's session
    const res = await req(
      `/api/v1/chat/${server.id}/sessions/${sessionId}/export`,
      tokenB,
    );
    expect(res.status).toBe(404);
  });

  it('should reject unauthenticated requests', async () => {
    const res = await app.request(
      '/api/v1/chat/some-id/sessions/some-id/export',
    );
    expect(res.status).toBe(401);
  });

  it('should use default title when session has no name', async () => {
    const server = await createServer('web-06', tokenA);
    const sessionId = await createSessionWithMessages(server.id, USER_A);

    const res = await req(
      `/api/v1/chat/${server.id}/sessions/${sessionId}/export`,
      tokenA,
    );

    const data = await res.json();
    expect(data.title).toBe('Chat Session');
    expect(res.headers.get('content-disposition')).toContain('chat-');
  });

  it('should use session name in title and filename', async () => {
    const server = await createServer('web-07', tokenA);
    const sessionId = await createSessionWithMessages(server.id, USER_A, 'Deploy Config');

    const res = await req(
      `/api/v1/chat/${server.id}/sessions/${sessionId}/export`,
      tokenA,
    );

    const data = await res.json();
    expect(data.title).toBe('Deploy Config');
    expect(res.headers.get('content-disposition')).toContain('Deploy_Config');
  });

  it('should export empty session (no messages)', async () => {
    const server = await createServer('web-08', tokenA);
    const mgr = getSessionManager();
    const session = await mgr.getOrCreate(server.id, USER_A);

    const res = await req(
      `/api/v1/chat/${server.id}/sessions/${session.id}/export`,
      tokenA,
    );

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.messages).toHaveLength(0);
  });

  it('should sanitize special characters in filename', async () => {
    const server = await createServer('web-09', tokenA);
    const sessionId = await createSessionWithMessages(
      server.id,
      USER_A,
      'How to fix "error" on /var/log?',
    );

    const res = await req(
      `/api/v1/chat/${server.id}/sessions/${sessionId}/export`,
      tokenA,
    );

    const disposition = res.headers.get('content-disposition') ?? '';
    // Special chars should be replaced with underscores
    expect(disposition).not.toContain('"error"');
    expect(disposition).toContain('How_to_fix');
  });

  it('should return 400 for invalid format parameter', async () => {
    const server = await createServer('web-10', tokenA);
    const sessionId = await createSessionWithMessages(server.id, USER_A);

    const res = await req(
      `/api/v1/chat/${server.id}/sessions/${sessionId}/export?format=csv`,
      tokenA,
    );
    // Zod parse error triggers error handler
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

// ============================================================================
// Helper function unit tests
// ============================================================================

describe('buildExportMarkdown', () => {
  it('should render user messages as blockquotes', () => {
    const md = buildExportMarkdown('Test', 'srv-01', '2026-01-01T00:00:00.000Z', [
      { role: 'user', content: 'Hello\nworld', timestamp: '2026-01-01T00:00:00.000Z' },
    ]);
    expect(md).toContain('> Hello');
    expect(md).toContain('> world');
  });

  it('should render system messages in italics', () => {
    const md = buildExportMarkdown('Test', 'srv-01', '2026-01-01T00:00:00.000Z', [
      { role: 'system', content: 'System info', timestamp: '2026-01-01T00:00:00.000Z' },
    ]);
    expect(md).toContain('*System info*');
  });

  it('should include title and server name', () => {
    const md = buildExportMarkdown('My Chat', 'prod-server', '2026-01-01T00:00:00.000Z', []);
    expect(md).toContain('# My Chat');
    expect(md).toContain('**Server:** prod-server');
    expect(md).toContain('**Exported:** 2026-01-01');
  });
});

describe('buildExportFilename', () => {
  it('should use session name and json extension', () => {
    const name = buildExportFilename('json', 'Deploy Config', '2026-01-15');
    expect(name).toBe('Deploy_Config-2026-01-15.json');
  });

  it('should use md extension for markdown', () => {
    const name = buildExportFilename('markdown', 'Test', '2026-01-15');
    expect(name).toBe('Test-2026-01-15.md');
  });

  it('should default to "chat" when no session name', () => {
    const name = buildExportFilename('json', null, '2026-01-15');
    expect(name).toBe('chat-2026-01-15.json');
  });

  it('should sanitize special characters', () => {
    const name = buildExportFilename('json', 'Fix "error" /path', '2026-01-15');
    expect(name).toBe('Fix__error___path-2026-01-15.json');
  });

  it('should truncate long names to 50 chars', () => {
    const longName = 'A'.repeat(100);
    const name = buildExportFilename('json', longName, '2026-01-15');
    expect(name.length).toBeLessThan(100);
    expect(name).toContain('A'.repeat(50));
  });
});
