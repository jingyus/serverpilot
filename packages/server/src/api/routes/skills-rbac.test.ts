// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for skill RBAC integration.
 *
 * Validates role-based access control across all skill API endpoints:
 * - member: can only perform skill:view actions
 * - admin/owner: can perform skill:view, skill:execute, skill:manage
 *
 * Split from skills.test.ts to stay within the 800-line file limit.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Hono } from 'hono';

import type { ApiEnv } from './types.js';
import type { InstalledSkill, SkillExecutionResult } from '../../core/skill/types.js';
import { onError } from '../middleware/error-handler.js';

// ============================================================================
// Module Mocks
// ============================================================================

const mockEngine = {
  listInstalled: vi.fn(),
  listInstalledWithInputs: vi.fn(),
  listAvailable: vi.fn(),
  install: vi.fn(),
  uninstall: vi.fn(),
  configure: vi.fn(),
  updateStatus: vi.fn(),
  execute: vi.fn(),
  getInstalled: vi.fn(),
  getInstalledWithInputs: vi.fn(),
  getExecutions: vi.fn(),
  getExecution: vi.fn(),
  confirmExecution: vi.fn(),
  rejectExecution: vi.fn(),
  listPendingConfirmations: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
};

vi.mock('../../core/skill/engine.js', () => ({
  getSkillEngine: () => mockEngine,
}));

const mockSkillEventBus = {
  subscribe: vi.fn(() => vi.fn()),
  publish: vi.fn(),
  listenerCount: vi.fn(() => 0),
  removeAll: vi.fn(),
};

vi.mock('../../core/skill/skill-event-bus.js', () => ({
  getSkillEventBus: () => mockSkillEventBus,
}));

let mockUserRole = 'owner';

vi.mock('../middleware/auth.js', () => ({
  requireAuth: vi.fn(async (c: { set: (k: string, v: string) => void }, next: () => Promise<void>) => {
    c.set('userId', 'user-1');
    await next();
  }),
}));

vi.mock('../middleware/rbac.js', () => ({
  resolveRole: vi.fn(async (c: { set: (k: string, v: string) => void }, next: () => Promise<void>) => {
    c.set('userRole', mockUserRole);
    await next();
  }),
  requirePermission: vi.fn((permission: string) => {
    return async (c: { get: (k: string) => string }, next: () => Promise<void>) => {
      const role = c.get('userRole');
      const memberPerms = ['skill:view'];
      const adminPerms = ['skill:view', 'skill:execute', 'skill:manage'];
      const allowed = role === 'member' ? memberPerms : adminPerms;
      if (!allowed.includes(permission)) {
        const { ApiError } = await import('../middleware/error-handler.js');
        throw ApiError.forbidden(`Missing permission: ${permission}`);
      }
      await next();
    };
  }),
}));

vi.mock('../../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
  createContextLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Import after mocks
import { skillsRoute } from './skills.js';

// ============================================================================
// Test App Setup
// ============================================================================

function createTestApp() {
  const app = new Hono<ApiEnv>();
  app.route('/skills', skillsRoute);
  app.onError(onError);
  return app;
}

function makeSkill(overrides: Partial<InstalledSkill> = {}): InstalledSkill {
  return {
    id: 'skill-1',
    userId: 'user-1',
    tenantId: null,
    name: 'nginx-hardening',
    displayName: 'Nginx Hardening',
    version: '1.0.0',
    source: 'official',
    skillPath: '/skills/official/nginx-hardening',
    status: 'enabled',
    config: null,
    createdAt: '2026-02-12T00:00:00.000Z',
    updatedAt: '2026-02-12T00:00:00.000Z',
    ...overrides,
  };
}

// ============================================================================
// Setup
// ============================================================================

let app: ReturnType<typeof createTestApp>;

beforeEach(() => {
  app = createTestApp();
  mockUserRole = 'owner';
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ============================================================================
// RBAC Integration — member can only view, not manage/execute
// ============================================================================

describe('RBAC integration', () => {
  it('member can GET /skills (skill:view)', async () => {
    mockUserRole = 'member';
    mockEngine.listInstalledWithInputs.mockResolvedValue([]);

    const res = await app.request('/skills');
    expect(res.status).toBe(200);
  });

  it('member can GET /skills/available (skill:view)', async () => {
    mockUserRole = 'member';
    mockEngine.listAvailable.mockResolvedValue([]);

    const res = await app.request('/skills/available');
    expect(res.status).toBe(200);
  });

  it('member CANNOT POST /skills/install (skill:manage)', async () => {
    mockUserRole = 'member';

    const res = await app.request('/skills/install', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ skillDir: '/x', source: 'official' }),
    });
    expect(res.status).toBe(403);
  });

  it('member CANNOT DELETE /skills/:id (skill:manage)', async () => {
    mockUserRole = 'member';

    const res = await app.request('/skills/skill-1', { method: 'DELETE' });
    expect(res.status).toBe(403);
  });

  it('member CANNOT PUT /skills/:id/config (skill:manage)', async () => {
    mockUserRole = 'member';

    const res = await app.request('/skills/skill-1/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: {} }),
    });
    expect(res.status).toBe(403);
  });

  it('member CANNOT PUT /skills/:id/status (skill:manage)', async () => {
    mockUserRole = 'member';

    const res = await app.request('/skills/skill-1/status', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'enabled' }),
    });
    expect(res.status).toBe(403);
  });

  it('member CANNOT POST /skills/:id/execute (skill:execute)', async () => {
    mockUserRole = 'member';

    const res = await app.request('/skills/skill-1/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serverId: 'server-1' }),
    });
    expect(res.status).toBe(403);
  });

  it('admin CAN perform all skill operations', async () => {
    mockUserRole = 'admin';

    // manage
    mockEngine.install.mockResolvedValue(makeSkill({ status: 'installed' }));
    const installRes = await app.request('/skills/install', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ skillDir: '/x', source: 'official' }),
    });
    expect(installRes.status).toBe(201);

    // execute
    mockEngine.execute.mockResolvedValue({
      executionId: 'exec-1',
      status: 'success',
      stepsExecuted: 0,
      duration: 100,
      result: null,
      errors: [],
    } as SkillExecutionResult);
    const execRes = await app.request('/skills/skill-1/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serverId: 'server-1' }),
    });
    expect(execRes.status).toBe(200);
  });
});
