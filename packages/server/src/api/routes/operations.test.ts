// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for operation history API routes.
 *
 * Validates listing, filtering, statistics, creation,
 * status transitions, user isolation, and validation.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';

import { createApiApp } from './index.js';
import { initJwtConfig, generateTokens, _resetJwtConfig } from '../middleware/auth.js';
import { initDatabase, closeDatabase, createTables } from '../../db/connection.js';
import { DrizzleOperationRepository } from '../../db/repositories/operation-repository.js';
import {
  setOperationRepository,
  _resetOperationRepository,
} from '../../db/repositories/operation-repository.js';
import { _resetProfileRepository } from '../../db/repositories/profile-repository.js';
import {
  _resetOperationHistoryService,
} from '../../core/operation/operation-history-service.js';
import type { Hono } from 'hono';
import type { ApiEnv } from './types.js';
import type { DrizzleDB } from '../../db/connection.js';

// ============================================================================
// Test Setup
// ============================================================================

const TEST_SECRET = 'test-secret-key-that-is-at-least-32-chars-long!!';
const USER_A = 'user-aaa-111';
const USER_B = 'user-bbb-222';

let app: Hono<ApiEnv>;
let db: DrizzleDB;
let tokenA: string;
let tokenB: string;

function exec(sql: string) {
  const sqlite = (db as unknown as { session: { client: { exec: (s: string) => void } } })
    .session.client;
  sqlite.exec(sql);
}

beforeAll(async () => {
  _resetJwtConfig();
  initJwtConfig({ secret: TEST_SECRET });

  const tokensA = await generateTokens(USER_A);
  const tokensB = await generateTokens(USER_B);
  tokenA = tokensA.accessToken;
  tokenB = tokensB.accessToken;
});

beforeEach(() => {
  db = initDatabase(':memory:');
  createTables();
  _resetOperationRepository();
  _resetProfileRepository();
  _resetOperationHistoryService();

  // Seed users and servers
  exec(`INSERT INTO users (id, email, password_hash, created_at, updated_at)
        VALUES ('${USER_A}', 'a@test.com', 'hash', ${Date.now()}, ${Date.now()})`);
  exec(`INSERT INTO users (id, email, password_hash, created_at, updated_at)
        VALUES ('${USER_B}', 'b@test.com', 'hash', ${Date.now()}, ${Date.now()})`);
  exec(`INSERT INTO servers (id, name, user_id, status, tags, created_at, updated_at)
        VALUES ('srv-a', 'Server A', '${USER_A}', 'online', '[]', ${Date.now()}, ${Date.now()})`);
  exec(`INSERT INTO servers (id, name, user_id, status, tags, created_at, updated_at)
        VALUES ('srv-b', 'Server B', '${USER_B}', 'online', '[]', ${Date.now()}, ${Date.now()})`);
  exec(`INSERT INTO profiles (id, server_id, operation_history, updated_at)
        VALUES ('prof-a', 'srv-a', '[]', ${Date.now()})`);

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

// ============================================================================
// Tests
// ============================================================================

describe('Operation History Routes', () => {
  // --------------------------------------------------------------------------
  // POST /api/v1/operations — Create operation
  // --------------------------------------------------------------------------

  describe('POST /api/v1/operations', () => {
    it('should create a new operation', async () => {
      const res = await jsonPost('/api/v1/operations', {
        serverId: 'srv-a',
        type: 'install',
        description: 'Install nginx',
        commands: ['apt install nginx'],
        riskLevel: 'yellow',
      }, tokenA);

      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.operation.id).toBeTruthy();
      expect(data.operation.type).toBe('install');
      expect(data.operation.status).toBe('pending');
    });

    it('should reject invalid body', async () => {
      const res = await jsonPost('/api/v1/operations', {
        serverId: 'srv-a',
        type: 'invalid-type',
        description: 'Test',
        commands: ['cmd'],
        riskLevel: 'green',
      }, tokenA);

      expect(res.status).toBe(400);
    });

    it('should reject empty commands', async () => {
      const res = await jsonPost('/api/v1/operations', {
        serverId: 'srv-a',
        type: 'execute',
        description: 'Test',
        commands: [],
        riskLevel: 'green',
      }, tokenA);

      expect(res.status).toBe(400);
    });

    it('should reject without auth', async () => {
      const res = await app.request('/api/v1/operations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serverId: 'srv-a',
          type: 'execute',
          description: 'Test',
          commands: ['ls'],
          riskLevel: 'green',
        }),
      });

      expect(res.status).toBe(401);
    });

    it('should reject creating operation on other users server', async () => {
      const res = await jsonPost('/api/v1/operations', {
        serverId: 'srv-b',
        type: 'execute',
        description: 'Unauthorized',
        commands: ['ls'],
        riskLevel: 'green',
      }, tokenA);

      expect(res.status).toBe(500); // verifyServerOwnership throws
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/v1/operations — List with filtering
  // --------------------------------------------------------------------------

  describe('GET /api/v1/operations', () => {
    beforeEach(async () => {
      // Seed operations
      await jsonPost('/api/v1/operations', {
        serverId: 'srv-a', type: 'install',
        description: 'Install nginx', commands: ['apt install nginx'],
        riskLevel: 'yellow',
      }, tokenA);
      await jsonPost('/api/v1/operations', {
        serverId: 'srv-a', type: 'config',
        description: 'Configure SSL', commands: ['certbot --nginx'],
        riskLevel: 'red',
      }, tokenA);
      await jsonPost('/api/v1/operations', {
        serverId: 'srv-a', type: 'restart',
        description: 'Restart nginx', commands: ['systemctl restart nginx'],
        riskLevel: 'yellow',
      }, tokenA);
    });

    it('should list all operations', async () => {
      const res = await req('/api/v1/operations', tokenA);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.total).toBe(3);
      expect(data.operations).toHaveLength(3);
    });

    it('should filter by type', async () => {
      const res = await req('/api/v1/operations?type=install', tokenA);
      const data = await res.json();
      expect(data.total).toBe(1);
      expect(data.operations[0].type).toBe('install');
    });

    it('should filter by riskLevel', async () => {
      const res = await req('/api/v1/operations?riskLevel=yellow', tokenA);
      const data = await res.json();
      expect(data.total).toBe(2);
    });

    it('should search by description', async () => {
      const res = await req('/api/v1/operations?search=nginx', tokenA);
      const data = await res.json();
      expect(data.total).toBe(2);
    });

    it('should paginate results', async () => {
      const res = await req('/api/v1/operations?limit=1&offset=0', tokenA);
      const data = await res.json();
      expect(data.total).toBe(3);
      expect(data.operations).toHaveLength(1);
    });

    it('should enforce user isolation', async () => {
      const res = await req('/api/v1/operations', tokenB);
      const data = await res.json();
      expect(data.total).toBe(0);
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/v1/operations/stats
  // --------------------------------------------------------------------------

  describe('GET /api/v1/operations/stats', () => {
    it('should return statistics', async () => {
      await jsonPost('/api/v1/operations', {
        serverId: 'srv-a', type: 'install',
        description: 'Install A', commands: ['cmd1'], riskLevel: 'yellow',
      }, tokenA);
      await jsonPost('/api/v1/operations', {
        serverId: 'srv-a', type: 'config',
        description: 'Config B', commands: ['cmd2'], riskLevel: 'red',
      }, tokenA);

      const res = await req('/api/v1/operations/stats', tokenA);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.stats.total).toBe(2);
      expect(data.stats.byType.install).toBe(1);
      expect(data.stats.byType.config).toBe(1);
      expect(data.stats.byRiskLevel.yellow).toBe(1);
      expect(data.stats.byRiskLevel.red).toBe(1);
    });

    it('should filter stats by serverId', async () => {
      const res = await req('/api/v1/operations/stats?serverId=srv-a', tokenA);
      expect(res.status).toBe(200);
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/v1/operations/:id
  // --------------------------------------------------------------------------

  describe('GET /api/v1/operations/:id', () => {
    it('should get operation by ID', async () => {
      const createRes = await jsonPost('/api/v1/operations', {
        serverId: 'srv-a', type: 'execute',
        description: 'Run diagnostic', commands: ['uptime'],
        riskLevel: 'green',
      }, tokenA);
      const { operation } = await createRes.json();

      const res = await req(`/api/v1/operations/${operation.id}`, tokenA);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.operation.id).toBe(operation.id);
      expect(data.operation.description).toBe('Run diagnostic');
    });

    it('should return 404 for non-existent operation', async () => {
      const res = await req('/api/v1/operations/nonexistent', tokenA);
      expect(res.status).toBe(404);
    });

    it('should enforce user isolation', async () => {
      const createRes = await jsonPost('/api/v1/operations', {
        serverId: 'srv-a', type: 'execute',
        description: 'Private op', commands: ['ls'],
        riskLevel: 'green',
      }, tokenA);
      const { operation } = await createRes.json();

      const res = await req(`/api/v1/operations/${operation.id}`, tokenB);
      expect(res.status).toBe(404);
    });
  });

  // --------------------------------------------------------------------------
  // PATCH /api/v1/operations/:id/status
  // --------------------------------------------------------------------------

  describe('PATCH /api/v1/operations/:id/status', () => {
    it('should mark operation as running', async () => {
      const createRes = await jsonPost('/api/v1/operations', {
        serverId: 'srv-a', type: 'install',
        description: 'Install X', commands: ['cmd'],
        riskLevel: 'green',
      }, tokenA);
      const { operation } = await createRes.json();

      const res = await jsonPatch(
        `/api/v1/operations/${operation.id}/status`,
        { status: 'running' },
        tokenA,
      );
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.operation.status).toBe('running');
    });

    it('should mark operation as success', async () => {
      const createRes = await jsonPost('/api/v1/operations', {
        serverId: 'srv-a', type: 'install',
        description: 'Install X', commands: ['cmd'],
        riskLevel: 'green',
      }, tokenA);
      const { operation } = await createRes.json();

      const res = await jsonPatch(
        `/api/v1/operations/${operation.id}/status`,
        { status: 'success', output: 'All done', duration: 1500 },
        tokenA,
      );
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.operation.status).toBe('success');
      expect(data.operation.output).toBe('All done');
      expect(data.operation.duration).toBe(1500);
    });

    it('should return 404 for non-existent operation', async () => {
      const res = await jsonPatch(
        '/api/v1/operations/nonexistent/status',
        { status: 'running' },
        tokenA,
      );
      expect(res.status).toBe(404);
    });

    it('should reject invalid status transition', async () => {
      const createRes = await jsonPost('/api/v1/operations', {
        serverId: 'srv-a', type: 'execute',
        description: 'Test', commands: ['ls'],
        riskLevel: 'green',
      }, tokenA);
      const { operation } = await createRes.json();

      // Mark as running
      await jsonPatch(
        `/api/v1/operations/${operation.id}/status`,
        { status: 'running' },
        tokenA,
      );

      // Try to mark as running again — should fail
      const res = await jsonPatch(
        `/api/v1/operations/${operation.id}/status`,
        { status: 'running' },
        tokenA,
      );
      expect(res.status).toBe(400);
    });

    it('should reject invalid status value', async () => {
      const createRes = await jsonPost('/api/v1/operations', {
        serverId: 'srv-a', type: 'execute',
        description: 'Test', commands: ['ls'],
        riskLevel: 'green',
      }, tokenA);
      const { operation } = await createRes.json();

      const res = await jsonPatch(
        `/api/v1/operations/${operation.id}/status`,
        { status: 'invalid' },
        tokenA,
      );
      expect(res.status).toBe(400);
    });
  });
});
