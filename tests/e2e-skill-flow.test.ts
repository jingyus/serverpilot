/**
 * E2E Test: Skill Lifecycle — install → configure → execute → result
 *
 * Tests the complete skill management flow through real HTTP API routes
 * with a real SkillEngine backed by InMemorySkillRepository. AI/agent
 * execution is mocked at the engine boundary to avoid external deps.
 *
 * Covers:
 * 1. POST /api/v1/skills/install — install from local skill.yaml
 * 2. PUT  /api/v1/skills/:id/config — configure inputs
 * 3. PUT  /api/v1/skills/:id/status — enable skill
 * 4. POST /api/v1/skills/:id/execute — manual execution (mocked)
 * 5. GET  /api/v1/skills/:id/executions — execution history
 * 6. GET  /api/v1/skills — list installed skills
 * 7. DELETE /api/v1/skills/:id — uninstall
 * 8. RBAC: member can view/execute but cannot manage
 */

import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { Hono } from '../packages/server/node_modules/hono/dist/index.js';
import { join } from 'node:path';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { InMemorySkillRepository } from '../packages/server/src/db/repositories/skill-repository-memory.js';
import { SkillEngine, setSkillEngine, _resetSkillEngine } from '../packages/server/src/core/skill/engine.js';
import type { SkillExecutionResult } from '../packages/server/src/core/skill/types.js';
import { onError } from '../packages/server/src/api/middleware/error-handler.js';
import type { ApiEnv } from '../packages/server/src/api/routes/types.js';

// ============================================================================
// Module Mocks — auth, rbac, logger, execution deps
// ============================================================================

let mockUserId = 'user-e2e';
let mockUserRole = 'owner';

vi.mock('../packages/server/src/api/middleware/auth.js', () => ({
  requireAuth: vi.fn(
    async (c: { set: (k: string, v: string) => void }, next: () => Promise<void>) => {
      c.set('userId', mockUserId);
      await next();
    },
  ),
  optionalAuth: vi.fn(
    async (_c: unknown, next: () => Promise<void>) => { await next(); },
  ),
}));

vi.mock('../packages/server/src/api/middleware/rbac.js', () => ({
  resolveRole: vi.fn(
    async (c: { set: (k: string, v: string) => void }, next: () => Promise<void>) => {
      c.set('userRole', mockUserRole);
      await next();
    },
  ),
  requirePermission: vi.fn((permission: string) => {
    return async (c: { get: (k: string) => string }, next: () => Promise<void>) => {
      const role = c.get('userRole');
      const memberPerms = ['skill:view', 'skill:execute'];
      const adminPerms = ['skill:view', 'skill:execute', 'skill:manage'];
      const allowed = role === 'member' ? memberPerms : adminPerms;
      if (!allowed.includes(permission)) {
        const { ApiError } = await import(
          '../packages/server/src/api/middleware/error-handler.js'
        );
        throw ApiError.forbidden(`Missing permission: ${permission}`);
      }
      await next();
    };
  }),
}));

vi.mock('../packages/server/src/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  createContextLogger: () => ({
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  }),
}));

vi.mock('../packages/server/src/core/skill/git-installer.js', () => ({
  installFromGitUrl: vi.fn(),
}));

vi.mock('../packages/server/src/core/skill/skill-archive.js', () => ({
  exportSkill: vi.fn(),
  importSkill: vi.fn(),
}));

const mockSkillEventBus = {
  subscribe: vi.fn(() => vi.fn()),
  publish: vi.fn(),
  listenerCount: vi.fn(() => 0),
  removeAll: vi.fn(),
};

vi.mock('../packages/server/src/core/skill/skill-event-bus.js', () => ({
  getSkillEventBus: () => mockSkillEventBus,
}));

// Mock rate limiting (E2E tests should not be rate limited)
vi.mock('../packages/server/src/api/middleware/rate-limit.js', () => ({
  createRateLimitMiddleware: () =>
    async (_c: unknown, next: () => Promise<void>) => { await next(); },
  getRateLimitStore: vi.fn(),
  _resetRateLimitStore: vi.fn(),
}));

vi.mock('../packages/server/src/api/middleware/security-headers.js', () => ({
  createSecurityHeadersMiddleware: () =>
    async (_c: unknown, next: () => Promise<void>) => { await next(); },
}));

// Import after mocks
const { skillsRoute } = await import('../packages/server/src/api/routes/skills.js');

// ============================================================================
// Helpers
// ============================================================================

let tempDirs: string[] = [];

async function createTempSkillDir(
  overrides: { name?: string; prompt?: string; inputs?: string } = {},
): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'e2e-skill-'));
  tempDirs.push(dir);

  const name = overrides.name ?? 'e2e-test-skill';
  const prompt =
    overrides.prompt ??
    'This is an E2E test prompt. It must be at least 50 characters long to pass validation rules properly.';
  const inputsBlock = overrides.inputs ?? '';

  const yaml = `kind: skill
version: "1.0"

metadata:
  name: ${name}
  displayName: "E2E Test Skill"
  version: "1.0.0"

triggers:
  - type: manual

tools:
  - shell
${inputsBlock}
prompt: |
  ${prompt}
`;
  await writeFile(join(dir, 'skill.yaml'), yaml, 'utf-8');
  return dir;
}

function createTestApp() {
  const app = new Hono<ApiEnv>();
  app.route('/api/v1/skills', skillsRoute);
  app.onError(onError);
  return app;
}

function req(
  app: ReturnType<typeof createTestApp>,
  method: string,
  path: string,
  body?: unknown,
): Promise<Response> {
  const init: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }
  return app.request(`/api/v1/skills${path}`, init);
}

// ============================================================================
// Setup / Teardown
// ============================================================================

let app: ReturnType<typeof createTestApp>;
let repo: InMemorySkillRepository;

beforeEach(() => {
  repo = new InMemorySkillRepository();
  const engine = new SkillEngine(tmpdir(), repo);
  setSkillEngine(engine);

  app = createTestApp();
  mockUserId = 'user-e2e';
  mockUserRole = 'owner';
  vi.clearAllMocks();
});

afterEach(async () => {
  _resetSkillEngine();
  for (const dir of tempDirs) {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
  tempDirs = [];
});

// ============================================================================
// E2E: Full Skill Lifecycle
// ============================================================================

describe('E2E: Skill Lifecycle', () => {
  it('should install a skill from a local directory', async () => {
    const skillDir = await createTempSkillDir();

    const res = await req(app, 'POST', '/install', {
      skillDir,
      source: 'local',
    });
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.skill.name).toBe('e2e-test-skill');
    expect(body.skill.displayName).toBe('E2E Test Skill');
    expect(body.skill.version).toBe('1.0.0');
    expect(body.skill.status).toBe('installed');
    expect(body.skill.source).toBe('local');
    expect(body.warnings).toEqual([]);
  });

  it('should reject duplicate skill installation', async () => {
    const skillDir = await createTempSkillDir();

    // First install succeeds
    const res1 = await req(app, 'POST', '/install', { skillDir, source: 'local' });
    expect(res1.status).toBe(201);

    // Second install with same name fails
    const res2 = await req(app, 'POST', '/install', { skillDir, source: 'local' });
    expect(res2.status).toBe(400);

    const body = await res2.json();
    expect(body.error.message).toContain('already installed');
  });

  it('should configure skill inputs', async () => {
    const skillDir = await createTempSkillDir({
      inputs: `
inputs:
  - name: target_dir
    type: string
    required: false
    default: "/var/log"
    description: "Target directory"`,
    });

    // Install
    const installRes = await req(app, 'POST', '/install', { skillDir, source: 'local' });
    const { skill } = await installRes.json();

    // Configure
    const configRes = await req(app, 'PUT', `/${skill.id}/config`, {
      config: { target_dir: '/opt/data' },
    });
    expect(configRes.status).toBe(200);

    const configBody = await configRes.json();
    expect(configBody.success).toBe(true);

    // Verify status auto-transitioned to 'configured'
    const listRes = await req(app, 'GET', '');
    const listBody = await listRes.json();
    const updated = listBody.skills.find(
      (s: { id: string }) => s.id === skill.id,
    );
    expect(updated.status).toBe('configured');
  });

  it('should enable and pause a skill', async () => {
    const skillDir = await createTempSkillDir();

    // Install
    const installRes = await req(app, 'POST', '/install', { skillDir, source: 'local' });
    const { skill } = await installRes.json();

    // Enable directly from 'installed'
    const enableRes = await req(app, 'PUT', `/${skill.id}/status`, {
      status: 'enabled',
    });
    expect(enableRes.status).toBe(200);

    // Pause
    const pauseRes = await req(app, 'PUT', `/${skill.id}/status`, {
      status: 'paused',
    });
    expect(pauseRes.status).toBe(200);

    // Re-enable from paused
    const reEnableRes = await req(app, 'PUT', `/${skill.id}/status`, {
      status: 'enabled',
    });
    expect(reEnableRes.status).toBe(200);
  });

  it('should reject invalid status transitions', async () => {
    const skillDir = await createTempSkillDir();

    // Install + enable
    const installRes = await req(app, 'POST', '/install', { skillDir, source: 'local' });
    const { skill } = await installRes.json();
    await req(app, 'PUT', `/${skill.id}/status`, { status: 'enabled' });

    // 'enabled' → 'enabled' is not a valid transition (not in STATUS_TRANSITIONS)
    // The schema only allows 'enabled' | 'paused', so try paused → installed (invalid)
    await req(app, 'PUT', `/${skill.id}/status`, { status: 'paused' });

    // 'paused' → only 'enabled' or 'error' valid; schema limits to 'enabled'|'paused'
    // so paused → paused doesn't work since it's not in the transition map
    // Actually, let me test a true invalid case: enabled → trying an invalid transition
    // First re-enable:
    await req(app, 'PUT', `/${skill.id}/status`, { status: 'enabled' });

    // Now enable → enabled is impossible (not in transition table)
    // But schema only allows 'enabled' | 'paused', so this would be 'enabled' → 'enabled'
    // which the engine rejects as invalid
    const res = await req(app, 'PUT', `/${skill.id}/status`, { status: 'enabled' });
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error.message).toContain('Invalid status transition');
  });

  it('should execute a skill and retrieve execution history (mocked)', async () => {
    const skillDir = await createTempSkillDir();

    // Install + enable
    const installRes = await req(app, 'POST', '/install', { skillDir, source: 'local' });
    const { skill } = await installRes.json();
    await req(app, 'PUT', `/${skill.id}/status`, { status: 'enabled' });

    // Spy on engine.execute to return a mocked result (avoids AI/agent deps)
    const engine = (await import(
      '../packages/server/src/core/skill/engine.js'
    )).getSkillEngine();

    const mockResult: SkillExecutionResult = {
      executionId: 'exec-e2e-1',
      status: 'success',
      stepsExecuted: 2,
      duration: 1500,
      result: { output: 'Commands executed successfully' },
      errors: [],
    };
    const executeSpy = vi.spyOn(engine, 'execute').mockResolvedValueOnce(mockResult);

    // Execute
    const execRes = await req(app, 'POST', `/${skill.id}/execute`, {
      serverId: 'server-1',
    });
    expect(execRes.status).toBe(200);

    const execBody = await execRes.json();
    expect(execBody.execution.executionId).toBe('exec-e2e-1');
    expect(execBody.execution.status).toBe('success');
    expect(execBody.execution.stepsExecuted).toBe(2);
    expect(execBody.execution.duration).toBe(1500);

    // Verify execute was called with correct params
    expect(executeSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        skillId: skill.id,
        serverId: 'server-1',
        userId: 'user-e2e',
        triggerType: 'manual',
      }),
    );

    executeSpy.mockRestore();
  });

  it('should list execution history for a skill', async () => {
    const skillDir = await createTempSkillDir();

    // Install skill
    const installRes = await req(app, 'POST', '/install', { skillDir, source: 'local' });
    const { skill } = await installRes.json();

    // Seed execution records directly via repo
    await repo.createExecution({
      skillId: skill.id,
      serverId: 'server-1',
      userId: 'user-e2e',
      triggerType: 'manual',
    });
    await repo.createExecution({
      skillId: skill.id,
      serverId: 'server-2',
      userId: 'user-e2e',
      triggerType: 'manual',
    });

    // Query executions
    const res = await req(app, 'GET', `/${skill.id}/executions`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.executions).toHaveLength(2);
    expect(body.executions[0].skillId).toBe(skill.id);
    expect(body.executions[0].status).toBe('running');
  });

  it('should list installed skills', async () => {
    const dir1 = await createTempSkillDir({ name: 'skill-alpha' });
    const dir2 = await createTempSkillDir({ name: 'skill-beta' });

    await req(app, 'POST', '/install', { skillDir: dir1, source: 'local' });
    await req(app, 'POST', '/install', { skillDir: dir2, source: 'local' });

    const res = await req(app, 'GET', '');
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.skills).toHaveLength(2);
    const names = body.skills.map((s: { name: string }) => s.name).sort();
    expect(names).toEqual(['skill-alpha', 'skill-beta']);
  });

  it('should uninstall a skill', async () => {
    const skillDir = await createTempSkillDir();

    // Install
    const installRes = await req(app, 'POST', '/install', { skillDir, source: 'local' });
    const { skill } = await installRes.json();

    // Uninstall
    const delRes = await req(app, 'DELETE', `/${skill.id}`);
    expect(delRes.status).toBe(200);

    const delBody = await delRes.json();
    expect(delBody.success).toBe(true);

    // Verify skill is gone
    const listRes = await req(app, 'GET', '');
    const listBody = await listRes.json();
    expect(listBody.skills).toHaveLength(0);
  });

  it('should return 404 when uninstalling nonexistent skill', async () => {
    const res = await req(app, 'DELETE', '/nonexistent-id');
    expect(res.status).toBe(404);
  });

  it('should return 404 when configuring nonexistent skill', async () => {
    const res = await req(app, 'PUT', '/nonexistent-id/config', {
      config: { key: 'value' },
    });
    expect(res.status).toBe(404);
  });
});

// ============================================================================
// E2E: RBAC — member vs admin/owner permissions
// ============================================================================

describe('E2E: Skill RBAC', () => {
  it('should allow member to list installed skills (skill:view)', async () => {
    const skillDir = await createTempSkillDir();
    await req(app, 'POST', '/install', { skillDir, source: 'local' });

    // Switch to member role
    mockUserRole = 'member';

    const res = await req(app, 'GET', '');
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.skills).toHaveLength(1);
  });

  it('should forbid member from installing a skill (skill:manage)', async () => {
    const skillDir = await createTempSkillDir();

    mockUserRole = 'member';

    const res = await req(app, 'POST', '/install', { skillDir, source: 'local' });
    expect(res.status).toBe(403);

    const body = await res.json();
    expect(body.error.message).toContain('Missing permission');
  });

  it('should forbid member from configuring a skill (skill:manage)', async () => {
    // Install as owner
    const skillDir = await createTempSkillDir();
    const installRes = await req(app, 'POST', '/install', { skillDir, source: 'local' });
    const { skill } = await installRes.json();

    // Switch to member
    mockUserRole = 'member';

    const res = await req(app, 'PUT', `/${skill.id}/config`, {
      config: { key: 'value' },
    });
    expect(res.status).toBe(403);
  });

  it('should forbid member from changing skill status (skill:manage)', async () => {
    const skillDir = await createTempSkillDir();
    const installRes = await req(app, 'POST', '/install', { skillDir, source: 'local' });
    const { skill } = await installRes.json();

    mockUserRole = 'member';

    const res = await req(app, 'PUT', `/${skill.id}/status`, { status: 'enabled' });
    expect(res.status).toBe(403);
  });

  it('should forbid member from uninstalling a skill (skill:manage)', async () => {
    const skillDir = await createTempSkillDir();
    const installRes = await req(app, 'POST', '/install', { skillDir, source: 'local' });
    const { skill } = await installRes.json();

    mockUserRole = 'member';

    const res = await req(app, 'DELETE', `/${skill.id}`);
    expect(res.status).toBe(403);
  });

  it('should allow member to execute a skill (skill:execute)', async () => {
    // Install + enable as owner
    const skillDir = await createTempSkillDir();
    const installRes = await req(app, 'POST', '/install', { skillDir, source: 'local' });
    const { skill } = await installRes.json();
    await req(app, 'PUT', `/${skill.id}/status`, { status: 'enabled' });

    // Spy engine.execute
    const engine = (await import(
      '../packages/server/src/core/skill/engine.js'
    )).getSkillEngine();

    const mockResult: SkillExecutionResult = {
      executionId: 'exec-member',
      status: 'success',
      stepsExecuted: 1,
      duration: 500,
      result: null,
      errors: [],
    };
    const executeSpy = vi.spyOn(engine, 'execute').mockResolvedValueOnce(mockResult);

    // Switch to member
    mockUserRole = 'member';

    const res = await req(app, 'POST', `/${skill.id}/execute`, {
      serverId: 'server-1',
    });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.execution.status).toBe('success');

    executeSpy.mockRestore();
  });
});

// ============================================================================
// E2E: Complete user journey — install → configure → enable → execute → history → uninstall
// ============================================================================

describe('E2E: Full User Journey', () => {
  it('should complete the entire skill lifecycle end-to-end', async () => {
    // 1. Install
    const skillDir = await createTempSkillDir({
      name: 'log-analyzer',
      inputs: `
inputs:
  - name: log_path
    type: string
    required: true
    description: "Path to analyze"
  - name: max_lines
    type: number
    required: false
    default: 1000
    description: "Max lines to scan"`,
    });

    const installRes = await req(app, 'POST', '/install', {
      skillDir,
      source: 'local',
    });
    expect(installRes.status).toBe(201);
    const { skill } = await installRes.json();
    expect(skill.status).toBe('installed');

    // 2. Configure
    const configRes = await req(app, 'PUT', `/${skill.id}/config`, {
      config: { log_path: '/var/log/syslog', max_lines: 500 },
    });
    expect(configRes.status).toBe(200);

    // 3. Enable
    const enableRes = await req(app, 'PUT', `/${skill.id}/status`, {
      status: 'enabled',
    });
    expect(enableRes.status).toBe(200);

    // 4. Execute (mocked)
    const engine = (await import(
      '../packages/server/src/core/skill/engine.js'
    )).getSkillEngine();

    const mockResult: SkillExecutionResult = {
      executionId: 'exec-journey-1',
      status: 'success',
      stepsExecuted: 3,
      duration: 2500,
      result: {
        output: 'Found 12 errors in syslog',
        toolResults: [
          {
            toolName: 'shell',
            input: { command: 'tail -500 /var/log/syslog | grep ERROR' },
            result: 'Exit code: 0\nstdout:\n12 error lines found',
            success: true,
          },
        ],
      },
      errors: [],
    };
    const executeSpy = vi.spyOn(engine, 'execute').mockResolvedValueOnce(mockResult);

    const execRes = await req(app, 'POST', `/${skill.id}/execute`, {
      serverId: 'server-prod-1',
      config: { log_path: '/var/log/auth.log' },
    });
    expect(execRes.status).toBe(200);
    const execBody = await execRes.json();
    expect(execBody.execution.status).toBe('success');
    expect(execBody.execution.stepsExecuted).toBe(3);

    executeSpy.mockRestore();

    // 5. Verify the skill is still listed
    const listRes = await req(app, 'GET', '');
    expect(listRes.status).toBe(200);
    const listBody = await listRes.json();
    expect(listBody.skills).toHaveLength(1);
    expect(listBody.skills[0].name).toBe('log-analyzer');

    // 6. Uninstall
    const delRes = await req(app, 'DELETE', `/${skill.id}`);
    expect(delRes.status).toBe(200);

    // 7. Confirm it's gone
    const finalList = await req(app, 'GET', '');
    const finalBody = await finalList.json();
    expect(finalBody.skills).toHaveLength(0);
  });
});
