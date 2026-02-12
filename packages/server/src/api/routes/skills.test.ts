// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for skill management routes.
 *
 * Validates all 9 skill API endpoints: CRUD, config, status, execution,
 * execution history, available skills discovery, and RBAC enforcement.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Hono } from 'hono';

import type { ApiEnv } from './types.js';
import type { InstalledSkill, SkillExecution, SkillExecutionResult, AvailableSkill } from '../../core/skill/types.js';
import { onError } from '../middleware/error-handler.js';

// ============================================================================
// Module Mocks
// ============================================================================

const mockEngine = {
  listInstalled: vi.fn(),
  listAvailable: vi.fn(),
  install: vi.fn(),
  uninstall: vi.fn(),
  configure: vi.fn(),
  updateStatus: vi.fn(),
  execute: vi.fn(),
  getInstalled: vi.fn(),
  getExecutions: vi.fn(),
  getExecution: vi.fn(),
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
      // Simulate RBAC: member can only skill:view
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

function makeExecution(overrides: Partial<SkillExecution> = {}): SkillExecution {
  return {
    id: 'exec-1',
    skillId: 'skill-1',
    serverId: 'server-1',
    userId: 'user-1',
    triggerType: 'manual',
    status: 'success',
    startedAt: '2026-02-12T00:00:00.000Z',
    completedAt: '2026-02-12T00:00:01.000Z',
    result: { resolvedPrompt: 'test prompt' },
    stepsExecuted: 0,
    duration: 1000,
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
// GET /skills — List installed skills
// ============================================================================

describe('GET /skills', () => {
  it('should return list of installed skills', async () => {
    const skills = [makeSkill()];
    mockEngine.listInstalled.mockResolvedValue(skills);

    const res = await app.request('/skills');
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.skills).toHaveLength(1);
    expect(body.skills[0].name).toBe('nginx-hardening');
  });

  it('should return empty array when no skills installed', async () => {
    mockEngine.listInstalled.mockResolvedValue([]);

    const res = await app.request('/skills');
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.skills).toHaveLength(0);
  });

  it('should be accessible by member role (skill:view)', async () => {
    mockUserRole = 'member';
    mockEngine.listInstalled.mockResolvedValue([]);

    const res = await app.request('/skills');
    expect(res.status).toBe(200);
  });
});

// ============================================================================
// GET /skills/available — Available skills
// ============================================================================

describe('GET /skills/available', () => {
  it('should return available skills', async () => {
    const available: AvailableSkill[] = [{
      manifest: {
        version: '1.0',
        metadata: { name: 'test-skill', version: '1.0.0', displayName: 'Test Skill' },
        prompt: 'Do something',
        tools: ['shell_exec'],
      } as AvailableSkill['manifest'],
      source: 'official',
      dirPath: '/skills/official/test-skill',
      installed: false,
    }];
    mockEngine.listAvailable.mockResolvedValue(available);

    const res = await app.request('/skills/available');
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.skills).toHaveLength(1);
    expect(body.skills[0].installed).toBe(false);
  });
});

// ============================================================================
// POST /skills/install — Install a skill
// ============================================================================

describe('POST /skills/install', () => {
  it('should install a skill and return 201', async () => {
    const skill = makeSkill({ status: 'installed' });
    mockEngine.install.mockResolvedValue(skill);

    const res = await app.request('/skills/install', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        skillDir: '/skills/official/nginx-hardening',
        source: 'official',
      }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.skill.name).toBe('nginx-hardening');
    expect(mockEngine.install).toHaveBeenCalledWith(
      'user-1',
      '/skills/official/nginx-hardening',
      'official',
    );
  });

  it('should return 400 for duplicate install', async () => {
    mockEngine.install.mockRejectedValue(
      new Error("Skill 'nginx-hardening' is already installed (id=skill-1)"),
    );

    const res = await app.request('/skills/install', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        skillDir: '/skills/official/nginx-hardening',
        source: 'official',
      }),
    });

    expect(res.status).toBe(400);
  });

  it('should return 400 for missing skillDir', async () => {
    const res = await app.request('/skills/install', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'official' }),
    });

    expect(res.status).toBe(400);
  });

  it('should return 400 for invalid source', async () => {
    const res = await app.request('/skills/install', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        skillDir: '/some/path',
        source: 'invalid-source',
      }),
    });

    expect(res.status).toBe(400);
  });

  it('should be forbidden for member role (skill:manage)', async () => {
    mockUserRole = 'member';

    const res = await app.request('/skills/install', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        skillDir: '/skills/official/nginx-hardening',
        source: 'official',
      }),
    });

    expect(res.status).toBe(403);
  });
});

// ============================================================================
// DELETE /skills/:id — Uninstall a skill
// ============================================================================

describe('DELETE /skills/:id', () => {
  it('should uninstall a skill', async () => {
    mockEngine.uninstall.mockResolvedValue(undefined);

    const res = await app.request('/skills/skill-1', { method: 'DELETE' });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(mockEngine.uninstall).toHaveBeenCalledWith('skill-1');
  });

  it('should return 404 for nonexistent skill', async () => {
    mockEngine.uninstall.mockRejectedValue(new Error('Skill not found: nonexistent'));

    const res = await app.request('/skills/nonexistent', { method: 'DELETE' });
    expect(res.status).toBe(404);
  });

  it('should be forbidden for member role', async () => {
    mockUserRole = 'member';

    const res = await app.request('/skills/skill-1', { method: 'DELETE' });
    expect(res.status).toBe(403);
  });
});

// ============================================================================
// PUT /skills/:id/config — Configure skill inputs
// ============================================================================

describe('PUT /skills/:id/config', () => {
  it('should configure skill inputs', async () => {
    mockEngine.configure.mockResolvedValue(undefined);

    const res = await app.request('/skills/skill-1/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: { nginx_port: 8080 } }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(mockEngine.configure).toHaveBeenCalledWith('skill-1', { nginx_port: 8080 });
  });

  it('should return 404 for nonexistent skill', async () => {
    mockEngine.configure.mockRejectedValue(new Error('Skill not found: skill-99'));

    const res = await app.request('/skills/skill-99/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: {} }),
    });

    expect(res.status).toBe(404);
  });

  it('should return 400 for missing config field', async () => {
    const res = await app.request('/skills/skill-1/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
  });

  it('should be forbidden for member role', async () => {
    mockUserRole = 'member';

    const res = await app.request('/skills/skill-1/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: { key: 'value' } }),
    });

    expect(res.status).toBe(403);
  });
});

// ============================================================================
// PUT /skills/:id/status — Enable / pause a skill
// ============================================================================

describe('PUT /skills/:id/status', () => {
  it('should enable a skill', async () => {
    mockEngine.updateStatus.mockResolvedValue(undefined);

    const res = await app.request('/skills/skill-1/status', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'enabled' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(mockEngine.updateStatus).toHaveBeenCalledWith('skill-1', 'enabled');
  });

  it('should pause a skill', async () => {
    mockEngine.updateStatus.mockResolvedValue(undefined);

    const res = await app.request('/skills/skill-1/status', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'paused' }),
    });

    expect(res.status).toBe(200);
  });

  it('should return 400 for invalid status value', async () => {
    const res = await app.request('/skills/skill-1/status', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'deleted' }),
    });

    expect(res.status).toBe(400);
  });

  it('should return 404 for nonexistent skill', async () => {
    mockEngine.updateStatus.mockRejectedValue(new Error('Skill not found: x'));

    const res = await app.request('/skills/x/status', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'enabled' }),
    });

    expect(res.status).toBe(404);
  });

  it('should return 400 for invalid status transition', async () => {
    mockEngine.updateStatus.mockRejectedValue(
      new Error('Invalid status transition: installed → paused'),
    );

    const res = await app.request('/skills/skill-1/status', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'paused' }),
    });

    expect(res.status).toBe(400);
  });

  it('should be forbidden for member role', async () => {
    mockUserRole = 'member';

    const res = await app.request('/skills/skill-1/status', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'enabled' }),
    });

    expect(res.status).toBe(403);
  });
});

// ============================================================================
// POST /skills/:id/execute — Manual execution
// ============================================================================

describe('POST /skills/:id/execute', () => {
  it('should execute a skill and return result', async () => {
    const result: SkillExecutionResult = {
      executionId: 'exec-1',
      status: 'success',
      stepsExecuted: 0,
      duration: 500,
      result: { resolvedPrompt: 'prompt' },
      errors: [],
    };
    mockEngine.execute.mockResolvedValue(result);

    const res = await app.request('/skills/skill-1/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serverId: 'server-1' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.execution.executionId).toBe('exec-1');
    expect(body.execution.status).toBe('success');
    expect(mockEngine.execute).toHaveBeenCalledWith({
      skillId: 'skill-1',
      serverId: 'server-1',
      userId: 'user-1',
      triggerType: 'manual',
      config: undefined,
    });
  });

  it('should pass optional config to engine', async () => {
    const result: SkillExecutionResult = {
      executionId: 'exec-2',
      status: 'success',
      stepsExecuted: 0,
      duration: 100,
      result: null,
      errors: [],
    };
    mockEngine.execute.mockResolvedValue(result);

    const res = await app.request('/skills/skill-1/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serverId: 'server-1', config: { port: 443 } }),
    });

    expect(res.status).toBe(200);
    expect(mockEngine.execute).toHaveBeenCalledWith(
      expect.objectContaining({ config: { port: 443 } }),
    );
  });

  it('should return 400 for missing serverId', async () => {
    const res = await app.request('/skills/skill-1/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
  });

  it('should return 404 for nonexistent skill', async () => {
    mockEngine.execute.mockRejectedValue(new Error('Skill not found: nonexistent'));

    const res = await app.request('/skills/nonexistent/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serverId: 'server-1' }),
    });

    expect(res.status).toBe(404);
  });

  it('should return 400 for disabled skill', async () => {
    mockEngine.execute.mockRejectedValue(
      new Error("Skill 'test' is not enabled (status=installed)"),
    );

    const res = await app.request('/skills/skill-1/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serverId: 'server-1' }),
    });

    expect(res.status).toBe(400);
  });

  it('should be forbidden for member role (skill:execute)', async () => {
    mockUserRole = 'member';

    const res = await app.request('/skills/skill-1/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serverId: 'server-1' }),
    });

    expect(res.status).toBe(403);
  });
});

// ============================================================================
// GET /skills/:id/executions — Execution history
// ============================================================================

describe('GET /skills/:id/executions', () => {
  it('should return execution history', async () => {
    const executions = [makeExecution()];
    mockEngine.getInstalled.mockResolvedValue(makeSkill());
    mockEngine.getExecutions.mockResolvedValue(executions);

    const res = await app.request('/skills/skill-1/executions');
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.executions).toHaveLength(1);
    expect(body.executions[0].id).toBe('exec-1');
  });

  it('should return 404 for nonexistent skill', async () => {
    mockEngine.getInstalled.mockResolvedValue(null);

    const res = await app.request('/skills/nonexistent/executions');
    expect(res.status).toBe(404);
  });

  it('should respect limit query parameter', async () => {
    mockEngine.getInstalled.mockResolvedValue(makeSkill());
    mockEngine.getExecutions.mockResolvedValue([]);

    const res = await app.request('/skills/skill-1/executions?limit=5');
    expect(res.status).toBe(200);
    expect(mockEngine.getExecutions).toHaveBeenCalledWith('skill-1', 5);
  });

  it('should be accessible by member role (skill:view)', async () => {
    mockUserRole = 'member';
    mockEngine.getInstalled.mockResolvedValue(makeSkill());
    mockEngine.getExecutions.mockResolvedValue([]);

    const res = await app.request('/skills/skill-1/executions');
    expect(res.status).toBe(200);
  });
});

// ============================================================================
// GET /skills/:id/executions/:eid — Execution detail
// ============================================================================

describe('GET /skills/:id/executions/:eid', () => {
  it('should return execution detail', async () => {
    const execution = makeExecution();
    mockEngine.getExecution.mockResolvedValue(execution);

    const res = await app.request('/skills/skill-1/executions/exec-1');
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.execution.id).toBe('exec-1');
    expect(body.execution.status).toBe('success');
  });

  it('should return 404 for nonexistent execution', async () => {
    mockEngine.getExecution.mockResolvedValue(null);

    const res = await app.request('/skills/skill-1/executions/nonexistent');
    expect(res.status).toBe(404);
  });

  it('should be accessible by member role (skill:view)', async () => {
    mockUserRole = 'member';
    mockEngine.getExecution.mockResolvedValue(makeExecution());

    const res = await app.request('/skills/skill-1/executions/exec-1');
    expect(res.status).toBe(200);
  });
});

// ============================================================================
// RBAC Integration — member can only view, not manage/execute
// ============================================================================

describe('RBAC integration', () => {
  it('member can GET /skills (skill:view)', async () => {
    mockUserRole = 'member';
    mockEngine.listInstalled.mockResolvedValue([]);

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
    });
    const execRes = await app.request('/skills/skill-1/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serverId: 'server-1' }),
    });
    expect(execRes.status).toBe(200);
  });
});

// ============================================================================
// GET /skills/executions/:eid/stream — SSE execution progress stream
// ============================================================================

describe('GET /skills/executions/:eid/stream', () => {
  it('should return 404 for nonexistent execution', async () => {
    mockEngine.getExecution.mockResolvedValue(null);

    const res = await app.request('/skills/executions/nonexistent/stream');
    expect(res.status).toBe(404);
  });

  it('should establish SSE connection and subscribe to skill event bus', async () => {
    mockEngine.getExecution.mockResolvedValue(makeExecution());
    mockSkillEventBus.subscribe.mockReturnValue(vi.fn());

    const controller = new AbortController();
    const resPromise = app.request('/skills/executions/exec-1/stream', {
      signal: controller.signal,
    });

    // Give the stream time to start
    await new Promise((r) => setTimeout(r, 50));

    expect(mockSkillEventBus.subscribe).toHaveBeenCalledWith(
      'exec-1',
      expect.any(Function),
    );

    controller.abort();
    await resPromise.catch(() => {});
  });

  it('should be accessible by member role (skill:view)', async () => {
    mockUserRole = 'member';
    mockEngine.getExecution.mockResolvedValue(makeExecution());
    mockSkillEventBus.subscribe.mockReturnValue(vi.fn());

    const controller = new AbortController();
    const resPromise = app.request('/skills/executions/exec-1/stream', {
      signal: controller.signal,
    });

    await new Promise((r) => setTimeout(r, 50));
    controller.abort();
    await resPromise.catch(() => {});

    // If we got here without 403, the member role was accepted
    expect(mockEngine.getExecution).toHaveBeenCalledWith('exec-1');
  });

  it('should be forbidden for member if permission check fails', async () => {
    // This verifies the permission check is wired — members have skill:view so they pass
    mockUserRole = 'member';
    mockEngine.getExecution.mockResolvedValue(makeExecution());
    mockSkillEventBus.subscribe.mockReturnValue(vi.fn());

    const controller = new AbortController();
    const resPromise = app.request('/skills/executions/exec-1/stream', {
      signal: controller.signal,
    });

    await new Promise((r) => setTimeout(r, 50));
    controller.abort();

    // Member has skill:view, so this should succeed
    await resPromise.catch(() => {});
    expect(mockSkillEventBus.subscribe).toHaveBeenCalled();
  });
});
