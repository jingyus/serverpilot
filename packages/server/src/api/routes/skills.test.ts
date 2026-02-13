// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for skill management routes — CRUD, config, status, execute, executions.
 *
 * RBAC integration tests → skills-rbac.test.ts
 * Confirmation & SSE stream tests → skills-confirmation.test.ts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Hono } from 'hono';

import type { ApiEnv } from './types.js';
import type { InstalledSkill, InstalledSkillWithInputs, SkillExecution, SkillExecutionResult, AvailableSkill } from '../../core/skill/types.js';
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
  upgrade: vi.fn(),
  healthCheck: vi.fn(),
  confirmExecution: vi.fn(),
  rejectExecution: vi.fn(),
  listPendingConfirmations: vi.fn(),
  cancel: vi.fn(),
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

const mockSkillRepo = {
  getStats: vi.fn(),
  getLogs: vi.fn().mockResolvedValue([]),
};

vi.mock('../../db/repositories/skill-repository.js', () => ({
  getSkillRepository: () => mockSkillRepo,
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
  it('should return list of installed skills with inputs', async () => {
    const skills: InstalledSkillWithInputs[] = [
      { ...makeSkill(), inputs: [{ name: 'port', type: 'number', required: true, description: 'Port number', default: 80 }] },
    ];
    mockEngine.listInstalledWithInputs.mockResolvedValue(skills);

    const res = await app.request('/skills');
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.skills).toHaveLength(1);
    expect(body.skills[0].name).toBe('nginx-hardening');
    expect(body.skills[0].inputs).toHaveLength(1);
    expect(body.skills[0].inputs[0].name).toBe('port');
    expect(body.skills[0].inputs[0].type).toBe('number');
    expect(body.skills[0].inputs[0].required).toBe(true);
  });

  it('should return empty inputs array when skill has no manifest inputs', async () => {
    const skills: InstalledSkillWithInputs[] = [{ ...makeSkill(), inputs: [] }];
    mockEngine.listInstalledWithInputs.mockResolvedValue(skills);

    const res = await app.request('/skills');
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.skills[0].inputs).toEqual([]);
  });

  it('should return enum inputs with options', async () => {
    const skills: InstalledSkillWithInputs[] = [{
      ...makeSkill(),
      inputs: [{
        name: 'log_level',
        type: 'enum',
        required: false,
        description: 'Logging level',
        options: ['debug', 'info', 'warn', 'error'],
      }],
    }];
    mockEngine.listInstalledWithInputs.mockResolvedValue(skills);

    const res = await app.request('/skills');
    const body = await res.json();
    expect(body.skills[0].inputs[0].options).toEqual(['debug', 'info', 'warn', 'error']);
  });

  it('should return empty array when no skills installed', async () => {
    mockEngine.listInstalledWithInputs.mockResolvedValue([]);

    const res = await app.request('/skills');
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.skills).toHaveLength(0);
  });

  it('should be accessible by member role (skill:view)', async () => {
    mockUserRole = 'member';
    mockEngine.listInstalledWithInputs.mockResolvedValue([]);

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
// PUT /skills/:id/upgrade — Upgrade a skill
// ============================================================================

describe('PUT /skills/:id/upgrade', () => {
  it('should upgrade a skill and return updated record', async () => {
    const upgraded = makeSkill({ version: '2.0.0', displayName: 'Nginx Hardening v2' });
    mockEngine.upgrade.mockResolvedValue(upgraded);

    const res = await app.request('/skills/skill-1/upgrade', { method: 'PUT' });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.skill.version).toBe('2.0.0');
    expect(body.skill.displayName).toBe('Nginx Hardening v2');
    expect(mockEngine.upgrade).toHaveBeenCalledWith('skill-1', 'user-1');
  });

  it('should return 404 when skill does not exist', async () => {
    mockEngine.upgrade.mockRejectedValue(new Error('Skill not found: nonexistent'));

    const res = await app.request('/skills/nonexistent/upgrade', { method: 'PUT' });
    expect(res.status).toBe(404);
  });

  it('should return 403 when user is not authorized to upgrade', async () => {
    mockEngine.upgrade.mockRejectedValue(new Error('Not authorized to upgrade skill: skill-1'));

    const res = await app.request('/skills/skill-1/upgrade', { method: 'PUT' });
    expect(res.status).toBe(403);
  });

  it('should return 400 when git clone fails during upgrade', async () => {
    mockEngine.upgrade.mockRejectedValue(
      new Error('Git clone failed during upgrade for "https://github.com/user/skill.git": timeout'),
    );

    const res = await app.request('/skills/skill-1/upgrade', { method: 'PUT' });
    expect(res.status).toBe(400);
  });

  it('should return 400 when manifest validation failed after upgrade', async () => {
    mockEngine.upgrade.mockRejectedValue(
      new Error('Skill manifest validation failed: missing prompt field'),
    );

    const res = await app.request('/skills/skill-1/upgrade', { method: 'PUT' });
    expect(res.status).toBe(400);
  });

  it('should return 400 when git remote URL cannot determine', async () => {
    mockEngine.upgrade.mockRejectedValue(
      new Error('Cannot determine git remote URL for skill at /skills/community/test'),
    );

    const res = await app.request('/skills/skill-1/upgrade', { method: 'PUT' });
    expect(res.status).toBe(400);
  });

  it('should be forbidden for member role (skill:manage)', async () => {
    mockUserRole = 'member';

    const res = await app.request('/skills/skill-1/upgrade', { method: 'PUT' });
    expect(res.status).toBe(403);
  });

  it('should propagate unexpected errors as 500', async () => {
    mockEngine.upgrade.mockRejectedValue(new Error('Unexpected internal error'));

    const res = await app.request('/skills/skill-1/upgrade', { method: 'PUT' });
    expect(res.status).toBe(500);
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
      dryRun: undefined,
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

  it('should pass dryRun=true to engine and include dryRun in response', async () => {
    const result: SkillExecutionResult = {
      executionId: 'exec-dry-1',
      status: 'success',
      stepsExecuted: 0,
      duration: 200,
      result: { output: 'Step 1: shell — apt update\nStep 2: shell — apt upgrade' },
      errors: [],
    };
    mockEngine.execute.mockResolvedValue(result);

    const res = await app.request('/skills/skill-1/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serverId: 'server-1', dryRun: true }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.dryRun).toBe(true);
    expect(body.execution.executionId).toBe('exec-dry-1');
    expect(body.execution.stepsExecuted).toBe(0);
    expect(mockEngine.execute).toHaveBeenCalledWith({
      skillId: 'skill-1',
      serverId: 'server-1',
      userId: 'user-1',
      triggerType: 'manual',
      config: undefined,
      dryRun: true,
    });
  });

  it('should not include dryRun flag in response when dryRun is false', async () => {
    const result: SkillExecutionResult = {
      executionId: 'exec-3',
      status: 'success',
      stepsExecuted: 3,
      duration: 1000,
      result: null,
      errors: [],
    };
    mockEngine.execute.mockResolvedValue(result);

    const res = await app.request('/skills/skill-1/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serverId: 'server-1', dryRun: false }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.dryRun).toBeUndefined();
    expect(body.execution.executionId).toBe('exec-3');
  });

  it('should not include dryRun flag when dryRun is omitted', async () => {
    const result: SkillExecutionResult = {
      executionId: 'exec-4',
      status: 'success',
      stepsExecuted: 1,
      duration: 500,
      result: null,
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
    expect(body.dryRun).toBeUndefined();
  });

  it('should pass dryRun along with config to engine', async () => {
    const result: SkillExecutionResult = {
      executionId: 'exec-dry-cfg',
      status: 'success',
      stepsExecuted: 0,
      duration: 150,
      result: { output: 'Step 1: shell — nginx -t' },
      errors: [],
    };
    mockEngine.execute.mockResolvedValue(result);

    const res = await app.request('/skills/skill-1/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serverId: 'server-1', config: { port: 8080 }, dryRun: true }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.dryRun).toBe(true);
    expect(mockEngine.execute).toHaveBeenCalledWith({
      skillId: 'skill-1',
      serverId: 'server-1',
      userId: 'user-1',
      triggerType: 'manual',
      config: { port: 8080 },
      dryRun: true,
    });
  });

  it('should return 400 for non-boolean dryRun', async () => {
    const res = await app.request('/skills/skill-1/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serverId: 'server-1', dryRun: 'yes' }),
    });

    expect(res.status).toBe(400);
  });
});

// ============================================================================
// POST /skills/:id/dry-run — Dedicated dry-run endpoint
// ============================================================================

describe('POST /skills/:id/dry-run', () => {
  it('should execute a dry-run and return preview with dryRun flag', async () => {
    const result: SkillExecutionResult = {
      executionId: 'exec-dry-1',
      status: 'success',
      stepsExecuted: 0,
      duration: 200,
      result: { output: 'Step 1: shell — apt update\nStep 2: shell — apt upgrade' },
      errors: [],
    };
    mockEngine.execute.mockResolvedValue(result);

    const res = await app.request('/skills/skill-1/dry-run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serverId: 'server-1' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.dryRun).toBe(true);
    expect(body.execution.executionId).toBe('exec-dry-1');
    expect(body.execution.stepsExecuted).toBe(0);
    expect(mockEngine.execute).toHaveBeenCalledWith({
      skillId: 'skill-1',
      serverId: 'server-1',
      userId: 'user-1',
      triggerType: 'manual',
      config: undefined,
      dryRun: true,
    });
  });

  it('should pass optional config to engine in dry-run', async () => {
    const result: SkillExecutionResult = {
      executionId: 'exec-dry-cfg',
      status: 'success',
      stepsExecuted: 0,
      duration: 150,
      result: { output: 'Step 1: shell — nginx -t' },
      errors: [],
    };
    mockEngine.execute.mockResolvedValue(result);

    const res = await app.request('/skills/skill-1/dry-run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serverId: 'server-1', config: { port: 8080 } }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.dryRun).toBe(true);
    expect(mockEngine.execute).toHaveBeenCalledWith({
      skillId: 'skill-1',
      serverId: 'server-1',
      userId: 'user-1',
      triggerType: 'manual',
      config: { port: 8080 },
      dryRun: true,
    });
  });

  it('should return 400 for missing serverId', async () => {
    const res = await app.request('/skills/skill-1/dry-run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
  });

  it('should return 404 for nonexistent skill', async () => {
    mockEngine.execute.mockRejectedValue(new Error('Skill not found: nonexistent'));

    const res = await app.request('/skills/nonexistent/dry-run', {
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

    const res = await app.request('/skills/skill-1/dry-run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serverId: 'server-1' }),
    });

    expect(res.status).toBe(400);
  });

  it('should be forbidden for member role (skill:execute)', async () => {
    mockUserRole = 'member';

    const res = await app.request('/skills/skill-1/dry-run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serverId: 'server-1' }),
    });

    expect(res.status).toBe(403);
  });

  it('should always set dryRun=true regardless of body content', async () => {
    const result: SkillExecutionResult = {
      executionId: 'exec-dry-2',
      status: 'success',
      stepsExecuted: 0,
      duration: 100,
      result: null,
      errors: [],
    };
    mockEngine.execute.mockResolvedValue(result);

    const res = await app.request('/skills/skill-1/dry-run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serverId: 'server-1' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.dryRun).toBe(true);
    expect(mockEngine.execute).toHaveBeenCalledWith(
      expect.objectContaining({ dryRun: true }),
    );
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

  it('should include logs array in execution detail', async () => {
    const execution = makeExecution();
    mockEngine.getExecution.mockResolvedValue(execution);
    mockSkillRepo.getLogs.mockResolvedValue([
      { id: 'log-1', executionId: 'exec-1', eventType: 'log', data: { text: 'Starting...' }, createdAt: '2026-02-13T00:00:00.000Z' },
      { id: 'log-2', executionId: 'exec-1', eventType: 'step', data: { tool: 'shell', phase: 'complete', success: true }, createdAt: '2026-02-13T00:00:01.000Z' },
    ]);

    const res = await app.request('/skills/skill-1/executions/exec-1');
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.logs).toHaveLength(2);
    expect(body.logs[0].eventType).toBe('log');
    expect(body.logs[1].eventType).toBe('step');
    expect(mockSkillRepo.getLogs).toHaveBeenCalledWith('exec-1');
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
// GET /skills/stats — Aggregated execution analytics
// ============================================================================

describe('GET /skills/stats', () => {
  const sampleStats = {
    totalExecutions: 10,
    successRate: 0.8,
    avgDuration: 1500,
    topSkills: [{ skillId: 'skill-1', skillName: 'Nginx Hardening', executionCount: 7, successCount: 6 }],
    dailyTrend: [{ date: '2026-02-12', total: 5, success: 4, failed: 1 }],
    triggerDistribution: [{ triggerType: 'manual', count: 8 }, { triggerType: 'cron', count: 2 }],
  };

  it('should return aggregated stats', async () => {
    mockSkillRepo.getStats.mockResolvedValue(sampleStats);

    const res = await app.request('/skills/stats');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.stats).toEqual(sampleStats);
    expect(mockSkillRepo.getStats).toHaveBeenCalledWith('user-1', undefined, undefined);
  });

  it('should pass date range query params', async () => {
    mockSkillRepo.getStats.mockResolvedValue(sampleStats);

    const res = await app.request('/skills/stats?from=2026-01-01&to=2026-02-01');
    expect(res.status).toBe(200);
    expect(mockSkillRepo.getStats).toHaveBeenCalledWith(
      'user-1',
      new Date('2026-01-01'),
      new Date('2026-02-01'),
    );
  });

  it('should be accessible by member role (skill:view)', async () => {
    mockUserRole = 'member';
    mockSkillRepo.getStats.mockResolvedValue(sampleStats);

    const res = await app.request('/skills/stats');
    expect(res.status).toBe(200);
  });
});

// ============================================================================
// POST /skills/executions/:eid/cancel — Cancel a running execution
// ============================================================================

describe('POST /skills/executions/:eid/cancel', () => {
  it('should cancel a running execution', async () => {
    mockEngine.cancel.mockResolvedValue(undefined);

    const res = await app.request('/skills/executions/exec-1/cancel', {
      method: 'POST',
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(mockEngine.cancel).toHaveBeenCalledWith('exec-1');
  });

  it('should return 400 for non-existent execution', async () => {
    mockEngine.cancel.mockRejectedValue(
      new Error('Execution not found or not running: nonexistent'),
    );

    const res = await app.request('/skills/executions/nonexistent/cancel', {
      method: 'POST',
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.message).toContain('not found or not running');
  });

  it('should return 400 for already completed execution', async () => {
    mockEngine.cancel.mockRejectedValue(
      new Error('Execution not found or not running: exec-done'),
    );

    const res = await app.request('/skills/executions/exec-done/cancel', {
      method: 'POST',
    });

    expect(res.status).toBe(400);
  });

  it('should propagate unexpected errors as 500', async () => {
    mockEngine.cancel.mockRejectedValue(new Error('Unexpected internal error'));

    const res = await app.request('/skills/executions/exec-1/cancel', {
      method: 'POST',
    });

    expect(res.status).toBe(500);
  });

  it('should be forbidden for member role (skill:execute)', async () => {
    mockUserRole = 'member';

    const res = await app.request('/skills/executions/exec-1/cancel', {
      method: 'POST',
    });

    expect(res.status).toBe(403);
  });

  it('should be allowed for admin role', async () => {
    mockUserRole = 'admin';
    mockEngine.cancel.mockResolvedValue(undefined);

    const res = await app.request('/skills/executions/exec-1/cancel', {
      method: 'POST',
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });
});

