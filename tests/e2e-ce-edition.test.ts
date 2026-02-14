// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * E2E Integration Test — CE (Community Edition) user journey.
 *
 * Validates the complete CE user experience: registration → login →
 * chat messaging → EE feature blocking. Uses a real HTTP server with
 * in-memory SQLite and actual feature-gate middleware (NOT mocked).
 *
 * @module tests/e2e-ce-edition
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createServer as createHttpServer } from 'node:http';
import type { Server as HttpServer } from 'node:http';
// @ts-ignore — resolved at runtime via pnpm workspace
import { getRequestListener } from '../packages/server/node_modules/@hono/node-server/dist/index.js';

// ============================================================================
// Mock edition to CE mode — MUST be before all server imports.
// All values are inlined because vi.mock factories are hoisted.
// ============================================================================

vi.mock('../packages/server/src/config/edition.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../packages/server/src/config/edition.js')>();

  const ceEdition = {
    edition: 'ce' as const,
    isCE: true,
    isEE: false,
    isCloud: false,
  };

  const ceFeatures = original.resolveFeatures(ceEdition);

  return {
    ...original,
    EDITION: ceEdition,
    FEATURES: ceFeatures,
    isFeatureEnabled: (key: string) => ceFeatures[key as keyof typeof ceFeatures],
  };
});

// Mock external services that are not relevant to this test
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

// ============================================================================
// Imports (after mocks)
// ============================================================================

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
import { _resetProviderFactory } from '../packages/server/src/ai/providers/provider-factory.js';
import {
  InMemoryRbacRepository, setRbacRepository, _resetRbacRepository,
} from '../packages/server/src/db/repositories/rbac-repository.js';
import type { AIProviderInterface, StreamResponse } from '../packages/server/src/ai/providers/base.js';
import { users, servers as serversTable } from '../packages/server/src/db/schema.js';

// ============================================================================
// Constants & Mock AI Provider
// ============================================================================

const TEST_SECRET = 'e2e-ce-test-secret-key-that-is-at-least-32-chars-long!!';
const TEST_USER_ID = 'ce-e2e-user-001';

function createMockProvider(): AIProviderInterface {
  const responseText = 'Hello! I can help you manage your server. What would you like to do?';

  return {
    name: 'mock',
    tier: 1,
    async chat() {
      return { content: responseText, usage: { inputTokens: 50, outputTokens: 30 } };
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
      callbacks?.onComplete?.(accumulated, { inputTokens: 50, outputTokens: 30 });
      return { content: accumulated, usage: { inputTokens: 50, outputTokens: 30 }, success: true } satisfies StreamResponse;
    },
    async isAvailable() { return true; },
  };
}

// ============================================================================
// SSE helpers
// ============================================================================

interface SSEEvent { event: string; data: string }

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

// ============================================================================
// Test Suite
// ============================================================================

describe('E2E: CE Edition — Complete User Journey', () => {
  let httpServer: HttpServer;
  let baseUrl: string;
  let accessToken: string;
  let serverId: string;

  beforeAll(async () => {
    // 1. In-memory SQLite
    initDatabase(':memory:');
    createTables();
    getRawDatabase().pragma('foreign_keys = OFF');

    // 2. JWT
    _resetJwtConfig();
    initJwtConfig({ secret: TEST_SECRET });
    accessToken = (await generateTokens(TEST_USER_ID)).accessToken;

    // 3. Repositories
    setServerRepository(new InMemoryServerRepository());
    setSessionRepository(new InMemorySessionRepository());
    const rbacRepo = new InMemoryRbacRepository();
    rbacRepo.setRole(TEST_USER_ID, 'owner');
    setRbacRepository(rbacRepo);

    // 4. AI provider
    _resetProviderFactory();
    _resetChatAIAgent();
    initChatAIAgent(createMockProvider());

    // 5. Seed SQLite with test user
    const db = getDatabase();
    const now = new Date();
    db.insert(users).values({
      id: TEST_USER_ID,
      email: 'ce-e2e@test.local',
      passwordHash: 'n/a',
      createdAt: now,
      updatedAt: now,
    }).run();

    // 6. Create HTTP server with CE-mode app
    const apiApp = createApiApp();
    httpServer = createHttpServer(getRequestListener(apiApp.fetch));
    await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));

    const addr = httpServer.address() as { port: number };
    baseUrl = `http://127.0.0.1:${addr.port}`;

    // 7. Create a server for chat (in-memory repo doesn't need requireFeature)
    const serverRepo = new InMemoryServerRepository();
    const created = await serverRepo.create({
      name: 'ce-e2e-server',
      userId: TEST_USER_ID,
    });
    serverId = created.id;

    // Also seed into the global in-memory repo used by routes
    const globalRepo = (await import(
      '../packages/server/src/db/repositories/server-repository.js'
    )).getServerRepository();
    await globalRepo.create({ name: 'ce-e2e-server', userId: TEST_USER_ID });
    // Get the actual ID that was created in the global repo
    const allServers = await globalRepo.findAllByUserId(TEST_USER_ID);
    serverId = allServers[0].id;

    // Seed SQLite so Drizzle-based queries pass
    db.insert(serversTable).values({
      id: serverId,
      name: 'ce-e2e-server',
      userId: TEST_USER_ID,
      status: 'online',
      createdAt: now,
      updatedAt: now,
    }).run();
  }, 15000);

  afterAll(async () => {
    [
      _resetTaskRepository, _resetChatAIAgent, _resetSessionManager,
      _resetServerRepository, _resetSessionRepository, _resetProfileRepository,
      _resetOperationRepository, _resetSnapshotRepository, _resetRbacRepository,
    ].forEach((fn) => fn());
    if (httpServer) await new Promise<void>((r) => httpServer.close(() => r()));
    closeDatabase();
  });

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------

  function authHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    };
  }

  // --------------------------------------------------------------------------
  // 1. /system/edition returns CE features
  // --------------------------------------------------------------------------

  it('GET /system/edition returns CE edition with correct features', async () => {
    const res = await fetch(`${baseUrl}/api/v1/system/edition`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.edition).toBe('ce');
    expect(body.version).toBeDefined();

    // CE core features — always enabled
    expect(body.features.chat).toBe(true);
    expect(body.features.commandExecution).toBe(true);
    expect(body.features.knowledgeBase).toBe(true);

    // EE features — all disabled in CE
    expect(body.features.multiServer).toBe(false);
    expect(body.features.multiSession).toBe(false);
    expect(body.features.teamCollaboration).toBe(false);
    expect(body.features.webhooks).toBe(false);
    expect(body.features.alerts).toBe(false);
    expect(body.features.metricsMonitoring).toBe(false);
    expect(body.features.auditExport).toBe(false);
    expect(body.features.oauthLogin).toBe(false);
    expect(body.features.rateLimiting).toBe(false);

    // Cloud features — disabled in CE
    expect(body.features.multiTenant).toBe(false);
    expect(body.features.billing).toBe(false);
  });

  // --------------------------------------------------------------------------
  // 2. CE registration is blocked (single-user mode)
  // --------------------------------------------------------------------------

  describe('CE authentication restrictions', () => {
    it('POST /auth/register returns 403 in CE mode', async () => {
      const res = await fetch(`${baseUrl}/api/v1/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'newuser@test.local',
          password: 'securePass123!',
          name: 'New User',
        }),
      });
      expect(res.status).toBe(403);

      const body = await res.json();
      expect(body.error.code).toBe('FEATURE_DISABLED');
      expect(body.error.message).toContain('Community Edition');
    });

    it('POST /auth/login endpoint is accessible in CE mode', async () => {
      // Login should be available (even if credentials are wrong, the route is not blocked)
      const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'ce-e2e@test.local',
          password: 'wrong-password',
        }),
      });
      // 401 means the route is accessible (auth logic ran), NOT 403 FEATURE_DISABLED
      expect(res.status).toBe(401);
    });

    it('POST /auth/logout is accessible in CE mode', async () => {
      const res = await fetch(`${baseUrl}/api/v1/auth/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.message).toContain('Logged out');
    });
  });

  // --------------------------------------------------------------------------
  // 3. EE-only routes return 403 FEATURE_DISABLED
  // --------------------------------------------------------------------------

  describe('EE-only routes return 403 FEATURE_DISABLED', () => {
    it('GET /servers returns 403 (multiServer disabled)', async () => {
      const res = await fetch(`${baseUrl}/api/v1/servers`, {
        headers: authHeaders(),
      });
      expect(res.status).toBe(403);

      const body = await res.json();
      expect(body.error.code).toBe('FEATURE_DISABLED');
      expect(body.error.message).toContain('Enterprise Edition');
      expect(body.error.feature).toBe('multiServer');
    });

    it('POST /servers returns 403 (multiServer disabled)', async () => {
      const res = await fetch(`${baseUrl}/api/v1/servers`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ name: 'new-server' }),
      });
      expect(res.status).toBe(403);

      const body = await res.json();
      expect(body.error.code).toBe('FEATURE_DISABLED');
      expect(body.error.feature).toBe('multiServer');
    });

    it('DELETE /servers/:id returns 403 (multiServer disabled)', async () => {
      const res = await fetch(`${baseUrl}/api/v1/servers/${serverId}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      expect(res.status).toBe(403);

      const body = await res.json();
      expect(body.error.code).toBe('FEATURE_DISABLED');
      expect(body.error.feature).toBe('multiServer');
    });

    it('GET /team/members returns 403 (teamCollaboration disabled)', async () => {
      const res = await fetch(`${baseUrl}/api/v1/team/members`, {
        headers: authHeaders(),
      });
      expect(res.status).toBe(403);

      const body = await res.json();
      expect(body.error.code).toBe('FEATURE_DISABLED');
      expect(body.error.feature).toBe('teamCollaboration');
    });

    it('POST /team/invite returns 403 (teamCollaboration disabled)', async () => {
      const res = await fetch(`${baseUrl}/api/v1/team/invite`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ email: 'invite@test.local', role: 'member' }),
      });
      expect(res.status).toBe(403);

      const body = await res.json();
      expect(body.error.code).toBe('FEATURE_DISABLED');
      expect(body.error.feature).toBe('teamCollaboration');
    });

    it('GET /webhooks returns 403 (webhooks disabled)', async () => {
      const res = await fetch(`${baseUrl}/api/v1/webhooks`, {
        headers: authHeaders(),
      });
      expect(res.status).toBe(403);

      const body = await res.json();
      expect(body.error.code).toBe('FEATURE_DISABLED');
      expect(body.error.feature).toBe('webhooks');
    });

    it('GET /alerts returns 403 (alerts disabled)', async () => {
      const res = await fetch(`${baseUrl}/api/v1/alerts`, {
        headers: authHeaders(),
      });
      expect(res.status).toBe(403);

      const body = await res.json();
      expect(body.error.code).toBe('FEATURE_DISABLED');
      expect(body.error.feature).toBe('alerts');
    });

    it('GET /alert-rules returns 403 (alerts disabled)', async () => {
      const res = await fetch(`${baseUrl}/api/v1/alert-rules`, {
        headers: authHeaders(),
      });
      expect(res.status).toBe(403);

      const body = await res.json();
      expect(body.error.code).toBe('FEATURE_DISABLED');
      expect(body.error.feature).toBe('alerts');
    });

    it('GET /metrics returns 403 (metricsMonitoring disabled)', async () => {
      const res = await fetch(`${baseUrl}/api/v1/metrics/latest?serverId=any`, {
        headers: authHeaders(),
      });
      expect(res.status).toBe(403);

      const body = await res.json();
      expect(body.error.code).toBe('FEATURE_DISABLED');
      expect(body.error.feature).toBe('metricsMonitoring');
    });

    it('GET /members returns 403 (teamCollaboration disabled)', async () => {
      const res = await fetch(`${baseUrl}/api/v1/members`, {
        headers: authHeaders(),
      });
      expect(res.status).toBe(403);

      const body = await res.json();
      expect(body.error.code).toBe('FEATURE_DISABLED');
      expect(body.error.feature).toBe('teamCollaboration');
    });

    it('GET /auth/github returns 403 (oauthLogin disabled)', async () => {
      const res = await fetch(`${baseUrl}/api/v1/auth/github`);
      expect(res.status).toBe(403);

      const body = await res.json();
      expect(body.error.code).toBe('FEATURE_DISABLED');
      expect(body.error.feature).toBe('oauthLogin');
    });

    it('GET /audit-log/export returns 403 (auditExport disabled)', async () => {
      const res = await fetch(`${baseUrl}/api/v1/audit-log/export?format=csv`, {
        headers: authHeaders(),
      });
      expect(res.status).toBe(403);

      const body = await res.json();
      expect(body.error.code).toBe('FEATURE_DISABLED');
      expect(body.error.feature).toBe('auditExport');
    });
  });

  // --------------------------------------------------------------------------
  // 3. CE core features work normally
  // --------------------------------------------------------------------------

  describe('CE core features work normally', () => {
    it('POST /chat/:serverId sends message and receives SSE response', async () => {
      const res = await fetch(`${baseUrl}/api/v1/chat/${serverId}`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ message: 'Hello, what can you do?' }),
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/event-stream');

      const events = parseSSE(await res.text());

      // First event should contain sessionId
      const sessionEvent = events.find(
        (e) => e.event === 'message' && JSON.parse(e.data).sessionId,
      );
      expect(sessionEvent).toBeDefined();

      // Should have content events
      const contentEvents = events.filter(
        (e) => e.event === 'message' && JSON.parse(e.data).content,
      );
      expect(contentEvents.length).toBeGreaterThan(0);

      // Should end with complete event
      const completeEvent = events.find((e) => e.event === 'complete');
      expect(completeEvent).toBeDefined();
      expect(JSON.parse(completeEvent!.data).success).toBe(true);
    });

    it('CE mode reuses the same session for subsequent messages', async () => {
      // First message — creates a session
      const res1 = await fetch(`${baseUrl}/api/v1/chat/${serverId}`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ message: 'First message' }),
      });
      const events1 = parseSSE(await res1.text());
      const sessionId1 = JSON.parse(
        events1.find((e) => e.event === 'message' && JSON.parse(e.data).sessionId)!.data,
      ).sessionId;

      // Second message — should reuse the same session (CE single-session)
      const res2 = await fetch(`${baseUrl}/api/v1/chat/${serverId}`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ message: 'Second message' }),
      });
      const events2 = parseSSE(await res2.text());
      const sessionId2 = JSON.parse(
        events2.find((e) => e.event === 'message' && JSON.parse(e.data).sessionId)!.data,
      ).sessionId;

      expect(sessionId1).toBe(sessionId2);
    });

    it('GET /chat/:serverId/sessions lists sessions', async () => {
      const res = await fetch(`${baseUrl}/api/v1/chat/${serverId}/sessions`, {
        headers: authHeaders(),
      });
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.sessions).toBeDefined();
      expect(Array.isArray(body.sessions)).toBe(true);
      expect(body.total).toBeGreaterThanOrEqual(1);
    });

    it('health check endpoint works', async () => {
      const res = await fetch(`${baseUrl}/health`);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.status).toBe('ok');
    });
  });

  // --------------------------------------------------------------------------
  // 5. CE single-session enforcement
  // --------------------------------------------------------------------------

  describe('CE single-session enforcement', () => {
    it('session list ignores limit/offset query params in CE mode', async () => {
      const res = await fetch(
        `${baseUrl}/api/v1/chat/${serverId}/sessions?limit=50&offset=10`,
        { headers: authHeaders() },
      );
      expect(res.status).toBe(200);

      const body = await res.json();
      // CE mode hardcodes limit=1, offset=0 regardless of query params
      expect(body.sessions.length).toBeLessThanOrEqual(1);
    });

    it('DELETE only session returns 403 in CE mode', async () => {
      // First, get the current session ID
      const listRes = await fetch(
        `${baseUrl}/api/v1/chat/${serverId}/sessions`,
        { headers: authHeaders() },
      );
      const { sessions } = await listRes.json();
      expect(sessions.length).toBeGreaterThanOrEqual(1);

      const sessionId = sessions[0].id;

      // Attempt to delete the only session — should be blocked in CE
      const deleteRes = await fetch(
        `${baseUrl}/api/v1/chat/${serverId}/sessions/${sessionId}`,
        { method: 'DELETE', headers: authHeaders() },
      );
      expect(deleteRes.status).toBe(403);

      const body = await deleteRes.json();
      expect(body.error).toContain('Community Edition');
    });
  });

  // --------------------------------------------------------------------------
  // 6. CE single-server: detail routes remain accessible
  // --------------------------------------------------------------------------

  describe('CE single-server detail routes remain accessible', () => {
    it('GET /servers/:id returns the server detail', async () => {
      const res = await fetch(`${baseUrl}/api/v1/servers/${serverId}`, {
        headers: authHeaders(),
      });
      // Should succeed (single-server detail is not blocked)
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.server).toBeDefined();
      expect(body.server.id).toBe(serverId);
      expect(body.server.name).toBe('ce-e2e-server');
    });

    it('GET /servers/:id/operations lists operation history', async () => {
      const res = await fetch(
        `${baseUrl}/api/v1/servers/${serverId}/operations`,
        { headers: authHeaders() },
      );
      // Route exists and is accessible (even if no operations yet)
      expect(res.status).toBe(200);
    });
  });

  // --------------------------------------------------------------------------
  // 7. CE-accessible features: settings, knowledge, admin
  // --------------------------------------------------------------------------

  describe('CE-accessible routes (no feature gate)', () => {
    it('GET /settings returns user settings', async () => {
      const res = await fetch(`${baseUrl}/api/v1/settings`, {
        headers: authHeaders(),
      });
      // Settings route has no feature gate — accessible in CE
      expect(res.status).toBe(200);
    });

    it('GET /admin/db/status returns maintenance info', async () => {
      const res = await fetch(`${baseUrl}/api/v1/admin/db/status`, {
        headers: authHeaders(),
      });
      // Admin DB routes are CE-accessible (owner-only RBAC, not edition-gated)
      expect(res.status).toBe(200);
    });

    it('GET /knowledge/docs lists documentation sources', async () => {
      const res = await fetch(`${baseUrl}/api/v1/knowledge/docs`, {
        headers: authHeaders(),
      });
      // Knowledge base is a CE core feature
      expect(res.status).toBe(200);
    });
  });

  // --------------------------------------------------------------------------
  // 8. Rate limiting is NOT applied in CE mode
  // --------------------------------------------------------------------------

  it('CE mode does not apply rate limiting (many requests succeed)', async () => {
    // In CE mode, FEATURES.rateLimiting is false, so the rate limit middleware
    // is never mounted. We should be able to make many requests freely.
    const requests = Array.from({ length: 25 }, () =>
      fetch(`${baseUrl}/api/v1/system/edition`),
    );
    const responses = await Promise.all(requests);

    // All should succeed — no 429 Too Many Requests
    for (const res of responses) {
      expect(res.status).toBe(200);
    }

    // Rate limit headers should NOT be present (middleware not mounted)
    const firstRes = responses[0];
    expect(firstRes.headers.get('X-RateLimit-Limit')).toBeNull();
  });

  // --------------------------------------------------------------------------
  // 9. Error response consistency across all CE-blocked endpoints
  // --------------------------------------------------------------------------

  it('all FEATURE_DISABLED responses share consistent error shape', async () => {
    const eeRoutes = [
      { method: 'GET', path: '/servers' },
      { method: 'GET', path: '/webhooks' },
      { method: 'GET', path: '/alerts' },
      { method: 'GET', path: '/alert-rules' },
      { method: 'GET', path: `/metrics/latest?serverId=${serverId}` },
      { method: 'GET', path: '/members' },
      { method: 'GET', path: '/team/members' },
    ];

    for (const route of eeRoutes) {
      const res = await fetch(`${baseUrl}/api/v1${route.path}`, {
        method: route.method,
        headers: authHeaders(),
      });
      expect(res.status).toBe(403);

      const body = await res.json();
      // All should have the same error shape
      expect(body.error).toBeDefined();
      expect(body.error.code).toBe('FEATURE_DISABLED');
      expect(typeof body.error.message).toBe('string');
      expect(typeof body.error.feature).toBe('string');
      expect(body.error.message).toContain('Enterprise Edition');
    }
  });
});
