// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for server management API routes.
 *
 * Validates CRUD operations, authentication, user isolation,
 * profile/metrics/operations endpoints, and validation.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { createApiApp } from './index.js';
import { initJwtConfig, generateTokens, _resetJwtConfig } from '../middleware/auth.js';
import {
  InMemoryServerRepository,
  setServerRepository,
  _resetServerRepository,
} from '../../db/repositories/server-repository.js';
import { initDatabase, closeDatabase, createTables, getDatabase } from '../../db/connection.js';
import { _resetProfileRepository } from '../../db/repositories/profile-repository.js';
import { _resetOperationRepository } from '../../db/repositories/operation-repository.js';
import { _resetMetricsRepository } from '../../db/repositories/metrics-repository.js';
import { _resetOperationHistoryService } from '../../core/operation/operation-history-service.js';
import type { ApiEnv } from './types.js';

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
  // Initialize in-memory DB for profile routes and operations
  initDatabase(':memory:');
  createTables();
  _resetProfileRepository();
  _resetOperationRepository();
  _resetMetricsRepository();
  _resetOperationHistoryService();

  // Seed users in SQLite for operations queries
  const sqlite = (getDatabase() as unknown as { session: { client: { exec: (s: string) => void } } })
    .session.client;
  sqlite.exec(
    `INSERT OR IGNORE INTO users (id, email, password_hash, created_at, updated_at)
     VALUES ('${USER_A}', 'a@test.com', 'hash', ${Date.now()}, ${Date.now()})`,
  );
  sqlite.exec(
    `INSERT OR IGNORE INTO users (id, email, password_hash, created_at, updated_at)
     VALUES ('${USER_B}', 'b@test.com', 'hash', ${Date.now()}, ${Date.now()})`,
  );

  app = createApiApp();
});

afterEach(() => {
  closeDatabase();
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

function jsonPatch(path: string, body: unknown, token: string): Promise<Response> {
  return req(path, token, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function createServer(
  name: string,
  token: string,
  tags?: string[],
): Promise<{ id: string; agentToken: string }> {
  const res = await jsonPost('/api/v1/servers', { name, tags }, token);
  const body = await res.json();
  return body.server;
}

// ============================================================================
// Authentication
// ============================================================================

describe('Authentication', () => {
  it('should reject requests without token', async () => {
    const res = await app.request('/api/v1/servers');
    expect(res.status).toBe(401);
  });

  it('should reject requests with invalid token', async () => {
    const res = await app.request('/api/v1/servers', {
      headers: { Authorization: 'Bearer invalid-token' },
    });
    expect(res.status).toBe(401);
  });

  it('should accept requests with valid token', async () => {
    const res = await req('/api/v1/servers', tokenA);
    expect(res.status).toBe(200);
  });
});

// ============================================================================
// POST /servers — Create
// ============================================================================

describe('POST /api/v1/servers', () => {
  it('should create a server and return 201', async () => {
    const res = await jsonPost('/api/v1/servers', { name: 'web-01' }, tokenA);
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.server).toBeDefined();
    expect(body.server.name).toBe('web-01');
    expect(body.server.status).toBe('offline');
    expect(body.server.tags).toEqual([]);
    expect(body.server.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it('should return token and installCommand on creation', async () => {
    const res = await jsonPost('/api/v1/servers', { name: 'web-02' }, tokenA);
    const body = await res.json();
    expect(body.token).toBeDefined();
    expect(body.token).toMatch(/^sp_[0-9a-f]{64}$/);
    expect(body.installCommand).toBeDefined();
    expect(body.installCommand).toContain(body.token);
    // agentToken should NOT be on the public server object
    expect(body.server.agentToken).toBeUndefined();
  });

  it('should create server with tags', async () => {
    const res = await jsonPost(
      '/api/v1/servers',
      { name: 'db-01', tags: ['production', 'database'] },
      tokenA,
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.server.tags).toEqual(['production', 'database']);
  });

  it('should include createdAt and updatedAt', async () => {
    const res = await jsonPost('/api/v1/servers', { name: 'test' }, tokenA);
    const body = await res.json();
    expect(body.server.createdAt).toBeDefined();
    expect(body.server.updatedAt).toBeDefined();
  });

  it('should validate name is required', async () => {
    const res = await jsonPost('/api/v1/servers', {}, tokenA);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('should validate name is not empty', async () => {
    const res = await jsonPost('/api/v1/servers', { name: '' }, tokenA);
    expect(res.status).toBe(400);
  });

  it('should validate name max length', async () => {
    const res = await jsonPost(
      '/api/v1/servers',
      { name: 'x'.repeat(101) },
      tokenA,
    );
    expect(res.status).toBe(400);
  });

  it('should validate tags max count', async () => {
    const tags = Array.from({ length: 21 }, (_, i) => `tag-${i}`);
    const res = await jsonPost('/api/v1/servers', { name: 'test', tags }, tokenA);
    expect(res.status).toBe(400);
  });

  it('should reject invalid JSON body', async () => {
    const res = await req('/api/v1/servers', tokenA, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    });
    expect(res.status).toBe(400);
  });
});

// ============================================================================
// GET /servers — List
// ============================================================================

describe('GET /api/v1/servers', () => {
  it('should return empty list initially', async () => {
    const res = await req('/api/v1/servers', tokenA);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.servers).toEqual([]);
  });

  it('should return servers for the authenticated user', async () => {
    await createServer('web-01', tokenA);
    await createServer('web-02', tokenA);

    const res = await req('/api/v1/servers', tokenA);
    const body = await res.json();
    expect(body.servers).toHaveLength(2);
    expect(body.servers[0].name).toBe('web-01');
    expect(body.servers[1].name).toBe('web-02');
  });

  it('should not return servers from other users', async () => {
    await createServer('web-01', tokenA);
    await createServer('db-01', tokenB);

    const resA = await req('/api/v1/servers', tokenA);
    const bodyA = await resA.json();
    expect(bodyA.servers).toHaveLength(1);
    expect(bodyA.servers[0].name).toBe('web-01');

    const resB = await req('/api/v1/servers', tokenB);
    const bodyB = await resB.json();
    expect(bodyB.servers).toHaveLength(1);
    expect(bodyB.servers[0].name).toBe('db-01');
  });

  it('should not expose agentToken in list response', async () => {
    await createServer('web-01', tokenA);
    const res = await req('/api/v1/servers', tokenA);
    const body = await res.json();
    expect(body.servers[0].agentToken).toBeUndefined();
  });
});

// ============================================================================
// GET /servers/:id — Get by ID
// ============================================================================

describe('GET /api/v1/servers/:id', () => {
  it('should return server details', async () => {
    const created = await createServer('web-01', tokenA, ['prod']);
    const res = await req(`/api/v1/servers/${created.id}`, tokenA);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.server.id).toBe(created.id);
    expect(body.server.name).toBe('web-01');
    expect(body.server.tags).toEqual(['prod']);
  });

  it('should not expose agentToken in GET response', async () => {
    const created = await createServer('web-01', tokenA);
    const res = await req(`/api/v1/servers/${created.id}`, tokenA);
    const body = await res.json();
    expect(body.server.agentToken).toBeUndefined();
  });

  it('should return 404 for non-existent server', async () => {
    const res = await req(
      '/api/v1/servers/550e8400-e29b-41d4-a716-446655440000',
      tokenA,
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('should return 404 for another user\'s server', async () => {
    const created = await createServer('web-01', tokenA);
    const res = await req(`/api/v1/servers/${created.id}`, tokenB);
    expect(res.status).toBe(404);
  });
});

// ============================================================================
// PATCH /servers/:id — Update
// ============================================================================

describe('PATCH /api/v1/servers/:id', () => {
  it('should update server name', async () => {
    const created = await createServer('web-01', tokenA);
    const res = await jsonPatch(
      `/api/v1/servers/${created.id}`,
      { name: 'web-prod-01' },
      tokenA,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.server.name).toBe('web-prod-01');
  });

  it('should update server tags', async () => {
    const created = await createServer('web-01', tokenA, ['dev']);
    const res = await jsonPatch(
      `/api/v1/servers/${created.id}`,
      { tags: ['prod', 'web'] },
      tokenA,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.server.tags).toEqual(['prod', 'web']);
  });

  it('should update updatedAt timestamp', async () => {
    const created = await createServer('web-01', tokenA);
    // Small delay to ensure different timestamps
    await new Promise((r) => setTimeout(r, 10));

    const res = await jsonPatch(
      `/api/v1/servers/${created.id}`,
      { name: 'updated' },
      tokenA,
    );
    const body = await res.json();
    expect(body.server.updatedAt).not.toBe(body.server.createdAt);
  });

  it('should not expose agentToken in update response', async () => {
    const created = await createServer('web-01', tokenA);
    const res = await jsonPatch(
      `/api/v1/servers/${created.id}`,
      { name: 'updated' },
      tokenA,
    );
    const body = await res.json();
    expect(body.server.agentToken).toBeUndefined();
  });

  it('should return 404 for non-existent server', async () => {
    const res = await jsonPatch(
      '/api/v1/servers/550e8400-e29b-41d4-a716-446655440000',
      { name: 'test' },
      tokenA,
    );
    expect(res.status).toBe(404);
  });

  it('should return 404 for another user\'s server', async () => {
    const created = await createServer('web-01', tokenA);
    const res = await jsonPatch(
      `/api/v1/servers/${created.id}`,
      { name: 'hijacked' },
      tokenB,
    );
    expect(res.status).toBe(404);
  });

  it('should validate empty name', async () => {
    const created = await createServer('web-01', tokenA);
    const res = await jsonPatch(
      `/api/v1/servers/${created.id}`,
      { name: '' },
      tokenA,
    );
    expect(res.status).toBe(400);
  });
});

// ============================================================================
// DELETE /servers/:id — Delete
// ============================================================================

describe('DELETE /api/v1/servers/:id', () => {
  it('should delete a server', async () => {
    const created = await createServer('web-01', tokenA);
    const res = await req(`/api/v1/servers/${created.id}`, tokenA, {
      method: 'DELETE',
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it('should remove server from list after deletion', async () => {
    const created = await createServer('web-01', tokenA);
    await req(`/api/v1/servers/${created.id}`, tokenA, { method: 'DELETE' });

    const listRes = await req('/api/v1/servers', tokenA);
    const listBody = await listRes.json();
    expect(listBody.servers).toHaveLength(0);
  });

  it('should return 404 after deleting', async () => {
    const created = await createServer('web-01', tokenA);
    await req(`/api/v1/servers/${created.id}`, tokenA, { method: 'DELETE' });

    const getRes = await req(`/api/v1/servers/${created.id}`, tokenA);
    expect(getRes.status).toBe(404);
  });

  it('should return 404 for non-existent server', async () => {
    const res = await req(
      '/api/v1/servers/550e8400-e29b-41d4-a716-446655440000',
      tokenA,
      { method: 'DELETE' },
    );
    expect(res.status).toBe(404);
  });

  it('should return 404 for another user\'s server', async () => {
    const created = await createServer('web-01', tokenA);
    const res = await req(`/api/v1/servers/${created.id}`, tokenB, {
      method: 'DELETE',
    });
    expect(res.status).toBe(404);
  });
});

// ============================================================================
// GET /servers/:id/profile — Server Profile
// ============================================================================

describe('GET /api/v1/servers/:id/profile', () => {
  it('should return profile for existing server', async () => {
    const created = await createServer('web-01', tokenA);
    const res = await req(`/api/v1/servers/${created.id}/profile`, tokenA);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.profile).toBeDefined();
    expect(body.profile.serverId).toBe(created.id);
    expect(body.profile.osInfo).toBeNull();
    expect(body.profile.software).toEqual([]);
    expect(body.profile.services).toEqual([]);
  });

  it('should return 404 for non-existent server', async () => {
    const res = await req(
      '/api/v1/servers/550e8400-e29b-41d4-a716-446655440000/profile',
      tokenA,
    );
    expect(res.status).toBe(404);
  });

  it('should return 404 for another user\'s server', async () => {
    const created = await createServer('web-01', tokenA);
    const res = await req(`/api/v1/servers/${created.id}/profile`, tokenB);
    expect(res.status).toBe(404);
  });
});

// ============================================================================
// GET /servers/:id/metrics — Monitoring Metrics
// ============================================================================

describe('GET /api/v1/servers/:id/metrics', () => {
  it('should return empty metrics for existing server', async () => {
    const created = await createServer('web-01', tokenA);
    const res = await req(`/api/v1/servers/${created.id}/metrics`, tokenA);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.metrics).toEqual([]);
    expect(body.range).toBe('1h');
  });

  it('should accept range query param', async () => {
    const created = await createServer('web-01', tokenA);
    const res = await req(
      `/api/v1/servers/${created.id}/metrics?range=24h`,
      tokenA,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.range).toBe('24h');
  });

  it('should accept 7d range', async () => {
    const created = await createServer('web-01', tokenA);
    const res = await req(
      `/api/v1/servers/${created.id}/metrics?range=7d`,
      tokenA,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.range).toBe('7d');
  });

  it('should reject invalid range', async () => {
    const created = await createServer('web-01', tokenA);
    const res = await req(
      `/api/v1/servers/${created.id}/metrics?range=invalid`,
      tokenA,
    );
    expect(res.status).toBe(400);
  });

  it('should return 404 for non-existent server', async () => {
    const res = await req(
      '/api/v1/servers/550e8400-e29b-41d4-a716-446655440000/metrics',
      tokenA,
    );
    expect(res.status).toBe(404);
  });

  it('should return 404 for another user\'s server', async () => {
    const created = await createServer('web-01', tokenA);
    const res = await req(`/api/v1/servers/${created.id}/metrics`, tokenB);
    expect(res.status).toBe(404);
  });
});

// ============================================================================
// GET /servers/:id/operations — Operation History
// ============================================================================

describe('GET /api/v1/servers/:id/operations', () => {
  it('should return empty operations for new server', async () => {
    const created = await createServer('web-01', tokenA);
    const res = await req(`/api/v1/servers/${created.id}/operations`, tokenA);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.operations).toEqual([]);
    expect(body.total).toBe(0);
  });

  it('should accept pagination params', async () => {
    const created = await createServer('web-01', tokenA);
    const res = await req(
      `/api/v1/servers/${created.id}/operations?limit=10&offset=5`,
      tokenA,
    );
    expect(res.status).toBe(200);
  });

  it('should reject invalid pagination limit', async () => {
    const created = await createServer('web-01', tokenA);
    const res = await req(
      `/api/v1/servers/${created.id}/operations?limit=0`,
      tokenA,
    );
    expect(res.status).toBe(400);
  });

  it('should reject limit over 100', async () => {
    const created = await createServer('web-01', tokenA);
    const res = await req(
      `/api/v1/servers/${created.id}/operations?limit=101`,
      tokenA,
    );
    expect(res.status).toBe(400);
  });

  it('should return empty for non-existent server (no server ownership)', async () => {
    const res = await req(
      '/api/v1/servers/550e8400-e29b-41d4-a716-446655440000/operations',
      tokenA,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.operations).toEqual([]);
    expect(body.total).toBe(0);
  });
});

// ============================================================================
// Full CRUD Lifecycle
// ============================================================================

describe('Full CRUD Lifecycle', () => {
  it('should support create → read → update → delete flow', async () => {
    // Create
    const createRes = await jsonPost(
      '/api/v1/servers',
      { name: 'lifecycle-test', tags: ['test'] },
      tokenA,
    );
    expect(createRes.status).toBe(201);
    const { server: created } = await createRes.json();
    const serverId = created.id;

    // Read
    const getRes = await req(`/api/v1/servers/${serverId}`, tokenA);
    expect(getRes.status).toBe(200);
    const { server: fetched } = await getRes.json();
    expect(fetched.name).toBe('lifecycle-test');

    // Update
    const patchRes = await jsonPatch(
      `/api/v1/servers/${serverId}`,
      { name: 'lifecycle-updated', tags: ['updated'] },
      tokenA,
    );
    expect(patchRes.status).toBe(200);
    const { server: updated } = await patchRes.json();
    expect(updated.name).toBe('lifecycle-updated');
    expect(updated.tags).toEqual(['updated']);

    // List (should contain updated server)
    const listRes = await req('/api/v1/servers', tokenA);
    const { servers: list } = await listRes.json();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('lifecycle-updated');

    // Delete
    const delRes = await req(`/api/v1/servers/${serverId}`, tokenA, {
      method: 'DELETE',
    });
    expect(delRes.status).toBe(200);

    // Verify deleted
    const afterDelRes = await req(`/api/v1/servers/${serverId}`, tokenA);
    expect(afterDelRes.status).toBe(404);

    const afterListRes = await req('/api/v1/servers', tokenA);
    const { servers: afterList } = await afterListRes.json();
    expect(afterList).toHaveLength(0);
  });
});

// ============================================================================
// Profile Management API — Notes, Preferences, History Summary
// ============================================================================

function execSQL(sql: string) {
  const db = getDatabase();
  const client = (db as unknown as { session: { client: { exec: (s: string) => void } } })
    .session.client;
  client.exec(sql);
}

function seedUserInDB(userId: string) {
  execSQL(
    `INSERT OR IGNORE INTO users (id, email, password_hash, created_at, updated_at)
     VALUES ('${userId}', '${userId}@test.com', 'hash', ${Date.now()}, ${Date.now()})`,
  );
}

function seedServerInDB(serverId: string, userId: string) {
  execSQL(
    `INSERT OR IGNORE INTO servers (id, name, user_id, status, tags, created_at, updated_at)
     VALUES ('${serverId}', 'test-server', '${userId}', 'online', '[]', ${Date.now()}, ${Date.now()})`,
  );
}

function seedProfileInDB(serverId: string) {
  execSQL(
    `INSERT OR IGNORE INTO profiles (id, server_id, os_info, software, services, preferences, notes, operation_history, history_summary, updated_at)
     VALUES ('prof-${serverId}', '${serverId}', null, '[]', '[]', null, '[]', '[]', null, ${Date.now()})`,
  );
}

function jsonPut(path: string, body: unknown, token: string): Promise<Response> {
  return req(path, token, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function jsonDelete(path: string, body: unknown, token: string): Promise<Response> {
  return req(path, token, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/v1/servers/:id/profile/notes — Add note', () => {
  const SRV_ID = 'srv-profile-notes';

  beforeEach(() => {
    seedUserInDB(USER_A);
    seedServerInDB(SRV_ID, USER_A);
    seedProfileInDB(SRV_ID);
  });

  it('should add a note to the server profile', async () => {
    const res = await jsonPost(
      `/api/v1/servers/${SRV_ID}/profile/notes`,
      { note: 'Custom config at /etc/nginx/custom.conf' },
      tokenA,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it('should reject empty note', async () => {
    const res = await jsonPost(
      `/api/v1/servers/${SRV_ID}/profile/notes`,
      { note: '' },
      tokenA,
    );
    expect(res.status).toBe(400);
  });

  it('should reject note exceeding max length', async () => {
    const res = await jsonPost(
      `/api/v1/servers/${SRV_ID}/profile/notes`,
      { note: 'x'.repeat(501) },
      tokenA,
    );
    expect(res.status).toBe(400);
  });

  it('should return 404 for non-existent server', async () => {
    const res = await jsonPost(
      '/api/v1/servers/nonexistent/profile/notes',
      { note: 'Test' },
      tokenA,
    );
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/v1/servers/:id/profile/notes — Remove note', () => {
  const SRV_ID = 'srv-profile-rm-note';

  beforeEach(async () => {
    seedUserInDB(USER_A);
    seedServerInDB(SRV_ID, USER_A);
    seedProfileInDB(SRV_ID);
    // Add a note first
    await jsonPost(
      `/api/v1/servers/${SRV_ID}/profile/notes`,
      { note: 'Note to remove' },
      tokenA,
    );
  });

  it('should remove a note by index', async () => {
    const res = await jsonDelete(
      `/api/v1/servers/${SRV_ID}/profile/notes`,
      { index: 0 },
      tokenA,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it('should return 404 for invalid index', async () => {
    const res = await jsonDelete(
      `/api/v1/servers/${SRV_ID}/profile/notes`,
      { index: 99 },
      tokenA,
    );
    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/v1/servers/:id/profile/preferences — Update preferences', () => {
  const SRV_ID = 'srv-profile-prefs';

  beforeEach(() => {
    seedUserInDB(USER_A);
    seedServerInDB(SRV_ID, USER_A);
    seedProfileInDB(SRV_ID);
  });

  it('should update preferences', async () => {
    const res = await jsonPatch(
      `/api/v1/servers/${SRV_ID}/profile/preferences`,
      { packageManager: 'apt', shell: 'zsh' },
      tokenA,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.preferences.packageManager).toBe('apt');
    expect(body.preferences.shell).toBe('zsh');
  });

  it('should merge with existing preferences', async () => {
    await jsonPatch(
      `/api/v1/servers/${SRV_ID}/profile/preferences`,
      { packageManager: 'apt' },
      tokenA,
    );
    const res = await jsonPatch(
      `/api/v1/servers/${SRV_ID}/profile/preferences`,
      { deploymentStyle: 'docker' },
      tokenA,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.preferences.packageManager).toBe('apt');
    expect(body.preferences.deploymentStyle).toBe('docker');
  });

  it('should return 404 for non-existent server', async () => {
    const res = await jsonPatch(
      '/api/v1/servers/nonexistent/profile/preferences',
      { packageManager: 'apt' },
      tokenA,
    );
    expect(res.status).toBe(404);
  });
});

describe('PUT /api/v1/servers/:id/profile/summary — Set history summary', () => {
  const SRV_ID = 'srv-profile-summary';

  beforeEach(() => {
    seedUserInDB(USER_A);
    seedServerInDB(SRV_ID, USER_A);
    seedProfileInDB(SRV_ID);
  });

  it('should set history summary', async () => {
    const res = await jsonPut(
      `/api/v1/servers/${SRV_ID}/profile/summary`,
      { summary: 'Server had 15 nginx config changes.', keepRecentCount: 10 },
      tokenA,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it('should reject empty summary', async () => {
    const res = await jsonPut(
      `/api/v1/servers/${SRV_ID}/profile/summary`,
      { summary: '' },
      tokenA,
    );
    expect(res.status).toBe(400);
  });

  it('should return 404 for non-existent server', async () => {
    const res = await jsonPut(
      '/api/v1/servers/nonexistent/profile/summary',
      { summary: 'Test summary' },
      tokenA,
    );
    expect(res.status).toBe(404);
  });
});

describe('GET /api/v1/servers/:id/profile/summary — Get history summary', () => {
  const SRV_ID = 'srv-profile-get-summary';

  beforeEach(async () => {
    seedUserInDB(USER_A);
    seedServerInDB(SRV_ID, USER_A);
    seedProfileInDB(SRV_ID);
  });

  it('should return null summary for new profile', async () => {
    const res = await req(`/api/v1/servers/${SRV_ID}/profile/summary`, tokenA);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.summary).toBeNull();
  });

  it('should return summary after setting it', async () => {
    await jsonPut(
      `/api/v1/servers/${SRV_ID}/profile/summary`,
      { summary: 'History summary content.' },
      tokenA,
    );

    const res = await req(`/api/v1/servers/${SRV_ID}/profile/summary`, tokenA);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.summary).toBe('History summary content.');
  });

  it('should return 404 for non-existent server', async () => {
    const res = await req('/api/v1/servers/nonexistent/profile/summary', tokenA);
    expect(res.status).toBe(404);
  });
});

describe('POST /api/v1/servers/:id/profile/history — Record operation', () => {
  const SRV_ID = 'srv-profile-history';

  beforeEach(() => {
    seedUserInDB(USER_A);
    seedServerInDB(SRV_ID, USER_A);
    seedProfileInDB(SRV_ID);
  });

  it('should record an operation', async () => {
    const res = await jsonPost(
      `/api/v1/servers/${SRV_ID}/profile/history`,
      { summary: 'Installed redis 7.2' },
      tokenA,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it('should reject empty summary', async () => {
    const res = await jsonPost(
      `/api/v1/servers/${SRV_ID}/profile/history`,
      { summary: '' },
      tokenA,
    );
    expect(res.status).toBe(400);
  });
});

describe('GET /api/v1/servers/:id/profile/history — Get operation history', () => {
  const SRV_ID = 'srv-profile-get-history';

  beforeEach(async () => {
    seedUserInDB(USER_A);
    seedServerInDB(SRV_ID, USER_A);
    seedProfileInDB(SRV_ID);
  });

  it('should return empty history for new profile', async () => {
    const res = await req(`/api/v1/servers/${SRV_ID}/profile/history`, tokenA);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.history).toEqual([]);
    expect(body.total).toBe(0);
  });

  it('should return history after recording operations', async () => {
    await jsonPost(
      `/api/v1/servers/${SRV_ID}/profile/history`,
      { summary: 'Installed nginx' },
      tokenA,
    );
    await jsonPost(
      `/api/v1/servers/${SRV_ID}/profile/history`,
      { summary: 'Installed redis' },
      tokenA,
    );

    const res = await req(`/api/v1/servers/${SRV_ID}/profile/history`, tokenA);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total).toBe(2);
    expect(body.history).toHaveLength(2);
  });

  it('should support pagination', async () => {
    for (let i = 0; i < 5; i++) {
      await jsonPost(
        `/api/v1/servers/${SRV_ID}/profile/history`,
        { summary: `Op ${i}` },
        tokenA,
      );
    }

    const res = await req(
      `/api/v1/servers/${SRV_ID}/profile/history?limit=2&offset=1`,
      tokenA,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total).toBe(5);
    expect(body.history).toHaveLength(2);
  });
});
