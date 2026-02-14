// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * E2E Integration Test — CE → EE Upgrade Path.
 *
 * Validates that changing `EDITION=ee` seamlessly upgrades a CE instance:
 * - Phase 1: Start in CE mode, create user data (sessions, audit logs, operations)
 * - Phase 2: Switch to EE mode at runtime, verify:
 *   - All original CE data is preserved and readable
 *   - EE-only database tables are auto-created
 *   - EE features (multi-server, webhooks, team, etc.) are now unlocked
 *   - CE core features continue to work
 *
 * Uses a real HTTP server with in-memory SQLite. The database is shared
 * across both phases (no file I/O needed). The edition mock uses mutable
 * objects so we can flip CE → EE without module re-imports.
 *
 * @module tests/e2e-ce-to-ee-upgrade
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createServer as createHttpServer } from 'node:http';
import type { Server as HttpServer } from 'node:http';
// @ts-ignore — resolved at runtime via pnpm workspace
import { getRequestListener } from '../packages/server/node_modules/@hono/node-server/dist/index.js';

// ============================================================================
// Mutable edition mock — starts as CE, flipped to EE mid-test.
// vi.hoisted() ensures variables exist before the hoisted vi.mock factory runs.
// ============================================================================

const { mutableEdition, mutableFeatures } = vi.hoisted(() => ({
  mutableEdition: {
    edition: 'ce' as 'ce' | 'ee',
    isCE: true,
    isEE: false,
    isCloud: false,
  },
  mutableFeatures: {
    chat: true,
    commandExecution: true,
    knowledgeBase: true,
    multiServer: false,
    multiSession: false,
    teamCollaboration: false,
    webhooks: false,
    alerts: false,
    metricsMonitoring: false,
    auditExport: false,
    oauthLogin: false,
    rateLimiting: false,
    multiTenant: false,
    billing: false,
  } as Record<string, boolean>,
}));

vi.mock('../packages/server/src/config/edition.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../packages/server/src/config/edition.js')>();

  return {
    ...original,
    EDITION: mutableEdition,
    FEATURES: mutableFeatures,
    isFeatureEnabled: (key: string) => mutableFeatures[key] ?? false,
  };
});

// Mock external services not relevant to this test
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
  initDatabase, createTables, ensureEETables, closeDatabase,
  getDatabase, getRawDatabase, listTables,
} from '../packages/server/src/db/connection.js';
import { resolveFeatures } from '../packages/server/src/config/edition.js';
import type { EditionInfo } from '../packages/server/src/config/edition.js';
import {
  InMemoryServerRepository, setServerRepository, _resetServerRepository,
  getServerRepository,
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
import { users, servers as serversTable, operations, auditLogs } from '../packages/server/src/db/schema.js';

// ============================================================================
// Constants & Helpers
// ============================================================================

const TEST_SECRET = 'e2e-upgrade-test-secret-key-that-is-at-least-32-chars!!';
const TEST_USER_ID = 'upgrade-e2e-user-001';

const CE_INFO: EditionInfo = { edition: 'ce', isCE: true, isEE: false, isCloud: false };
const EE_INFO: EditionInfo = { edition: 'ee', isCE: false, isEE: true, isCloud: false };

function createMockProvider(): AIProviderInterface {
  const responseText = 'Hello! I can help you manage your server.';
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

/** Switch the mutable edition/features objects to EE mode. */
function switchToEE(): void {
  mutableEdition.edition = 'ee';
  mutableEdition.isCE = false;
  mutableEdition.isEE = true;
  mutableEdition.isCloud = false;

  const eeFlags = resolveFeatures(EE_INFO);
  for (const [key, value] of Object.entries(eeFlags)) {
    mutableFeatures[key] = value;
  }
}

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

describe('E2E: CE → EE Upgrade — Data Preservation & Feature Unlock', () => {
  let httpServer: HttpServer;
  let baseUrl: string;
  let accessToken: string;
  let serverId: string;
  let ceSessionId: string;

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------

  function authHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    };
  }

  async function startHttpServer(): Promise<void> {
    const apiApp = createApiApp();
    httpServer = createHttpServer(getRequestListener(apiApp.fetch));
    await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
    const addr = httpServer.address() as { port: number };
    baseUrl = `http://127.0.0.1:${addr.port}`;
  }

  async function stopHttpServer(): Promise<void> {
    if (httpServer) {
      await new Promise<void>((r) => httpServer.close(() => r()));
    }
  }

  // ==========================================================================
  // Phase 1 Setup — CE Mode
  // ==========================================================================

  beforeAll(async () => {
    // 1. In-memory SQLite with CE tables only
    initDatabase(':memory:');
    const ceFeatures = resolveFeatures(CE_INFO);
    createTables(undefined, { features: ceFeatures });
    getRawDatabase().pragma('foreign_keys = OFF');

    // 2. JWT
    _resetJwtConfig();
    initJwtConfig({ secret: TEST_SECRET });
    accessToken = (await generateTokens(TEST_USER_ID)).accessToken;

    // 3. Repositories (in-memory)
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
      email: 'upgrade-e2e@test.local',
      passwordHash: 'n/a',
      createdAt: now,
      updatedAt: now,
    }).run();

    // 6. Create server in in-memory repo + SQLite
    const globalRepo = getServerRepository();
    await globalRepo.create({ name: 'upgrade-test-server', userId: TEST_USER_ID });
    const allServers = await globalRepo.findAllByUserId(TEST_USER_ID);
    serverId = allServers[0].id;

    db.insert(serversTable).values({
      id: serverId,
      name: 'upgrade-test-server',
      userId: TEST_USER_ID,
      status: 'online',
      createdAt: now,
      updatedAt: now,
    }).run();

    // 7. Seed an audit log entry (CE core feature)
    db.insert(auditLogs).values({
      id: 'audit-ce-001',
      userId: TEST_USER_ID,
      serverId,
      command: 'ls -la',
      riskLevel: 'green',
      reason: 'Standard file listing command',
      action: 'allowed',
      createdAt: now,
    }).run();

    // 8. Seed an operation record (CE core feature)
    db.insert(operations).values({
      id: 'op-ce-001',
      serverId,
      userId: TEST_USER_ID,
      type: 'execute',
      description: 'System update',
      status: 'success',
      createdAt: now,
      updatedAt: now,
    }).run();

    // 9. Start HTTP server in CE mode
    await startHttpServer();
  }, 15000);

  afterAll(async () => {
    [
      _resetTaskRepository, _resetChatAIAgent, _resetSessionManager,
      _resetServerRepository, _resetSessionRepository, _resetProfileRepository,
      _resetOperationRepository, _resetSnapshotRepository, _resetRbacRepository,
    ].forEach((fn) => fn());
    await stopHttpServer();
    closeDatabase();
  });

  // ==========================================================================
  // Phase 1: Verify CE mode is active and create data
  // ==========================================================================

  describe('Phase 1: CE mode — create data and verify restrictions', () => {
    it('GET /system/edition confirms CE mode', async () => {
      const res = await fetch(`${baseUrl}/api/v1/system/edition`);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.edition).toBe('ce');
      expect(body.features.multiServer).toBe(false);
      expect(body.features.teamCollaboration).toBe(false);
      expect(body.features.webhooks).toBe(false);
      expect(body.features.chat).toBe(true);
    });

    it('EE routes are blocked in CE mode', async () => {
      const eeRoutes = [
        { method: 'GET', path: '/servers' },
        { method: 'GET', path: '/webhooks' },
        { method: 'GET', path: '/team/members' },
        { method: 'GET', path: '/alerts' },
        { method: 'GET', path: '/members' },
      ];

      for (const route of eeRoutes) {
        const res = await fetch(`${baseUrl}/api/v1${route.path}`, {
          method: route.method,
          headers: authHeaders(),
        });
        expect(res.status).toBe(403);
        const body = await res.json();
        expect(body.error.code).toBe('FEATURE_DISABLED');
      }
    });

    it('registration is blocked in CE mode', async () => {
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
    });

    it('chat works in CE mode and creates a session', async () => {
      const res = await fetch(`${baseUrl}/api/v1/chat/${serverId}`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ message: 'CE phase message' }),
      });
      expect(res.status).toBe(200);

      const events = parseSSE(await res.text());
      const sessionEvent = events.find(
        (e) => e.event === 'message' && JSON.parse(e.data).sessionId,
      );
      expect(sessionEvent).toBeDefined();
      ceSessionId = JSON.parse(sessionEvent!.data).sessionId;
      expect(ceSessionId).toBeDefined();
    });

    it('server detail is accessible in CE mode', async () => {
      const res = await fetch(`${baseUrl}/api/v1/servers/${serverId}`, {
        headers: authHeaders(),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.server.name).toBe('upgrade-test-server');
    });

    it('audit log is accessible in CE mode', async () => {
      const res = await fetch(`${baseUrl}/api/v1/audit-log`, {
        headers: authHeaders(),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.logs).toBeDefined();
      expect(body.logs.length).toBeGreaterThanOrEqual(1);
    });

    it('operation history is accessible in CE mode', async () => {
      const res = await fetch(`${baseUrl}/api/v1/servers/${serverId}/operations`, {
        headers: authHeaders(),
      });
      expect(res.status).toBe(200);
    });
  });

  // ==========================================================================
  // Phase 2: Switch to EE mode and verify upgrade
  // ==========================================================================

  describe('Phase 2: Switch to EE — verify data preservation & feature unlock', () => {
    beforeAll(async () => {
      // Stop the CE-mode server
      await stopHttpServer();

      // Flip edition to EE (mutate the mocked singletons)
      switchToEE();

      // Create EE-only tables (simulates what startServer() does on EE boot)
      ensureEETables();

      // Restart the HTTP server (routes read FEATURES on each request)
      await startHttpServer();
    }, 10000);

    // ------------------------------------------------------------------------
    // 2a. Edition endpoint confirms EE mode
    // ------------------------------------------------------------------------

    it('GET /system/edition now returns EE', async () => {
      const res = await fetch(`${baseUrl}/api/v1/system/edition`);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.edition).toBe('ee');
      expect(body.features.multiServer).toBe(true);
      expect(body.features.teamCollaboration).toBe(true);
      expect(body.features.webhooks).toBe(true);
      expect(body.features.alerts).toBe(true);
      expect(body.features.metricsMonitoring).toBe(true);
      expect(body.features.auditExport).toBe(true);
      expect(body.features.oauthLogin).toBe(true);
      expect(body.features.rateLimiting).toBe(true);
      expect(body.features.multiSession).toBe(true);

      // CE core features still enabled
      expect(body.features.chat).toBe(true);
      expect(body.features.commandExecution).toBe(true);
      expect(body.features.knowledgeBase).toBe(true);
    });

    it('EE limits are returned after upgrade', async () => {
      const res = await fetch(`${baseUrl}/api/v1/system/edition`);
      const body = await res.json();
      // EE limits: -1 means Infinity (serialized)
      expect(body.limits.maxServers).toBe(-1);
      expect(body.limits.maxSessions).toBe(-1);
      expect(body.limits.maxUsers).toBe(-1);
    });

    // ------------------------------------------------------------------------
    // 2b. EE-only database tables were auto-created
    // ------------------------------------------------------------------------

    it('EE-only tables exist after upgrade', () => {
      const tables = listTables();
      const eeTables = [
        'alert_rules', 'alerts', 'metrics', 'metrics_hourly', 'metrics_daily',
        'oauth_accounts', 'webhooks', 'webhook_deliveries', 'invitations',
      ];
      for (const t of eeTables) {
        expect(tables, `missing EE table: ${t}`).toContain(t);
      }
    });

    // ------------------------------------------------------------------------
    // 2c. Original CE data is preserved
    // ------------------------------------------------------------------------

    it('original user data is preserved after upgrade', async () => {
      const db = getDatabase();
      const rows = db.select().from(users).all();
      const user = rows.find((r: { id: string }) => r.id === TEST_USER_ID);
      expect(user).toBeDefined();
      expect(user!.email).toBe('upgrade-e2e@test.local');
    });

    it('original server is still accessible via API', async () => {
      const res = await fetch(`${baseUrl}/api/v1/servers/${serverId}`, {
        headers: authHeaders(),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.server.id).toBe(serverId);
      expect(body.server.name).toBe('upgrade-test-server');
    });

    it('CE chat session is preserved and readable', async () => {
      const res = await fetch(`${baseUrl}/api/v1/chat/${serverId}/sessions`, {
        headers: authHeaders(),
      });
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.sessions.length).toBeGreaterThanOrEqual(1);

      // The session created in CE phase should still exist
      const ceSession = body.sessions.find(
        (s: { id: string }) => s.id === ceSessionId,
      );
      expect(ceSession).toBeDefined();
    });

    it('CE audit log entries are preserved', async () => {
      const res = await fetch(`${baseUrl}/api/v1/audit-log`, {
        headers: authHeaders(),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.logs.length).toBeGreaterThanOrEqual(1);

      const ceEntry = body.logs.find(
        (e: { id: string }) => e.id === 'audit-ce-001',
      );
      expect(ceEntry).toBeDefined();
      expect(ceEntry.command).toBe('ls -la');
    });

    it('CE operation records are preserved', async () => {
      const res = await fetch(`${baseUrl}/api/v1/servers/${serverId}/operations`, {
        headers: authHeaders(),
      });
      expect(res.status).toBe(200);
    });

    // ------------------------------------------------------------------------
    // 2d. EE features are now unlocked
    // ------------------------------------------------------------------------

    it('GET /servers is now accessible (multiServer unlocked)', async () => {
      const res = await fetch(`${baseUrl}/api/v1/servers`, {
        headers: authHeaders(),
      });
      // Should NOT return 403 FEATURE_DISABLED
      expect(res.status).not.toBe(403);
      // May return 200 with servers list
      expect([200]).toContain(res.status);
    });

    it('POST /servers can create a new server (EE feature)', async () => {
      const res = await fetch(`${baseUrl}/api/v1/servers`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ name: 'ee-new-server' }),
      });
      // Should NOT return 403 — the feature is now enabled
      expect(res.status).not.toBe(403);
    });

    it('GET /webhooks is now accessible (webhooks unlocked)', async () => {
      const res = await fetch(`${baseUrl}/api/v1/webhooks`, {
        headers: authHeaders(),
      });
      expect(res.status).not.toBe(403);
      // Should return 200 with empty list
      expect(res.status).toBe(200);
    });

    it('GET /alerts is now accessible (alerts unlocked)', async () => {
      const res = await fetch(`${baseUrl}/api/v1/alerts`, {
        headers: authHeaders(),
      });
      expect(res.status).not.toBe(403);
      expect(res.status).toBe(200);
    });

    it('GET /alert-rules is now accessible (alerts unlocked)', async () => {
      const res = await fetch(`${baseUrl}/api/v1/alert-rules`, {
        headers: authHeaders(),
      });
      expect(res.status).not.toBe(403);
      expect(res.status).toBe(200);
    });

    it('GET /team/members is now accessible (teamCollaboration unlocked)', async () => {
      const res = await fetch(`${baseUrl}/api/v1/team/members`, {
        headers: authHeaders(),
      });
      expect(res.status).not.toBe(403);
    });

    it('GET /members is now accessible (teamCollaboration unlocked)', async () => {
      const res = await fetch(`${baseUrl}/api/v1/members`, {
        headers: authHeaders(),
      });
      expect(res.status).not.toBe(403);
    });

    it('registration is now allowed in EE mode', async () => {
      const res = await fetch(`${baseUrl}/api/v1/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'newuser-ee@test.local',
          password: 'securePass123!',
          name: 'New EE User',
        }),
      });
      // Should NOT return 403 FEATURE_DISABLED
      expect(res.status).not.toBe(403);
      // May succeed (201) or fail with validation — but not feature-blocked
      expect([200, 201]).toContain(res.status);
    });

    // ------------------------------------------------------------------------
    // 2e. CE core features still work after EE upgrade
    // ------------------------------------------------------------------------

    it('chat still works after upgrade', async () => {
      const res = await fetch(`${baseUrl}/api/v1/chat/${serverId}`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ message: 'EE phase message' }),
      });
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/event-stream');

      const events = parseSSE(await res.text());
      const completeEvent = events.find((e) => e.event === 'complete');
      expect(completeEvent).toBeDefined();
    });

    it('settings still accessible after upgrade', async () => {
      const res = await fetch(`${baseUrl}/api/v1/settings`, {
        headers: authHeaders(),
      });
      expect(res.status).toBe(200);
    });

    it('knowledge docs still accessible after upgrade', async () => {
      const res = await fetch(`${baseUrl}/api/v1/knowledge/docs`, {
        headers: authHeaders(),
      });
      expect(res.status).toBe(200);
    });

    it('health check still works after upgrade', async () => {
      const res = await fetch(`${baseUrl}/health`);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.status).toBe('ok');
    });

    // ------------------------------------------------------------------------
    // 2f. Multi-session is unlocked (was single-session in CE)
    // ------------------------------------------------------------------------

    it('session list now supports pagination (multiSession unlocked)', async () => {
      const res = await fetch(
        `${baseUrl}/api/v1/chat/${serverId}/sessions?limit=50&offset=0`,
        { headers: authHeaders() },
      );
      expect(res.status).toBe(200);

      const body = await res.json();
      // In EE mode, limit/offset is respected
      expect(body.sessions).toBeDefined();
      expect(Array.isArray(body.sessions)).toBe(true);
    });
  });
});
