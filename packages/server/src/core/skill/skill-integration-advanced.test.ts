// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Skill system advanced integration tests (split from skill-integration.test.ts).
 *
 * Covers:
 * - RBAC permission enforcement on skill routes
 * - Error recovery (corrupt manifest → error status, AI provider failure)
 * - Multi-step tool execution with step tracking
 * - Chain depth & cycle detection
 * - Status transition validation
 *
 * @module core/skill/skill-integration-advanced.test
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { join } from 'node:path';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { Hono } from 'hono';

import type {
  AIProviderInterface,
  ChatOptions,
  ChatResponse,
  ToolUseBlock,
} from '../../ai/providers/base.js';
import type { ApiEnv } from '../../api/routes/types.js';

// ============================================================================
// Module Mocks — external dependencies only
// ============================================================================

vi.mock('../../ai/providers/provider-factory.js', () => ({
  getActiveProvider: vi.fn(() => null),
}));

vi.mock('../task/executor.js', () => {
  const mockExecutor = {
    executeCommand: vi.fn().mockResolvedValue({
      success: true,
      exitCode: 0,
      stdout: 'command output',
      stderr: '',
    }),
  };
  return {
    getTaskExecutor: vi.fn(() => mockExecutor),
    _mockExecutor: mockExecutor,
  };
});

vi.mock('../agent/agent-connector.js', () => ({
  findConnectedAgent: vi.fn(() => 'client-123'),
}));

vi.mock('../security/audit-logger.js', () => {
  const mockAuditLogger = {
    log: vi.fn().mockResolvedValue({ id: 'audit-1' }),
    updateExecutionResult: vi.fn().mockResolvedValue(true),
  };
  return {
    getAuditLogger: vi.fn(() => mockAuditLogger),
    _mockAuditLogger: mockAuditLogger,
  };
});

vi.mock('../webhook/dispatcher.js', () => {
  const mockDispatcher = {
    dispatch: vi.fn().mockResolvedValue(undefined),
  };
  return {
    getWebhookDispatcher: vi.fn(() => mockDispatcher),
    _mockDispatcher: mockDispatcher,
  };
});

vi.mock('./store.js', () => {
  const mockStore = {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    deleteAll: vi.fn().mockResolvedValue(0),
    list: vi.fn().mockResolvedValue({}),
  };
  return {
    getSkillKVStore: vi.fn(() => mockStore),
    _mockStore: mockStore,
  };
});

vi.mock('../metrics/metrics-bus.js', () => ({
  getMetricsBus: vi.fn(() => ({
    subscribeAll: vi.fn(() => vi.fn()),
    publish: vi.fn(),
  })),
  _resetMetricsBus: vi.fn(),
}));

vi.mock('../../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  createContextLogger: () => ({
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  }),
}));

// ============================================================================
// Real imports (not mocked — these are the integration targets)
// ============================================================================

import { SkillEngine, _resetSkillEngine } from './engine.js';
import {
  InMemorySkillRepository,
  setSkillRepository,
  _resetSkillRepository,
} from '../../db/repositories/skill-repository.js';
import { getSkillEventBus, _resetSkillEventBus } from './skill-event-bus.js';
import { _resetTriggerManager } from './trigger-manager.js';

// ============================================================================
// Helpers
// ============================================================================

let tempDirs: string[] = [];

async function createTempDir(prefix = 'integ-adv-'): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

/** Write a valid skill.yaml to the given directory. */
async function writeSkillYaml(
  dir: string,
  overrides: {
    name?: string;
    triggers?: string;
    tools?: string;
    prompt?: string;
    timeout?: string;
    maxSteps?: number;
    riskLevelMax?: string;
  } = {},
): Promise<void> {
  const name = overrides.name ?? 'integ-test-skill';
  const triggers = overrides.triggers ?? '  - type: manual';
  const tools = overrides.tools ?? '  - shell';
  const timeout = overrides.timeout ?? '30s';
  const maxSteps = overrides.maxSteps ?? 20;
  const riskLevelMax = overrides.riskLevelMax ?? 'yellow';
  const prompt =
    overrides.prompt ??
    'Execute a diagnostic check on the server. List running services and check disk usage.';

  const yaml = `kind: skill
version: "1.0"

metadata:
  name: ${name}
  displayName: "${name} Display"
  version: "1.0.0"

triggers:
${triggers}

tools:
${tools}

constraints:
  risk_level_max: ${riskLevelMax}
  timeout: "${timeout}"
  max_steps: ${maxSteps}
  requires_confirmation: false
  server_scope: single

prompt: |
  ${prompt}
`;
  await writeFile(join(dir, 'skill.yaml'), yaml, 'utf-8');
}

/** Create a mock AI provider returning a pre-programmed response sequence. */
function createMockProvider(responses: ChatResponse[]): AIProviderInterface {
  let callIndex = 0;
  return {
    name: 'test-provider',
    tier: 1,
    contextWindowSize: 200_000,
    chat: vi.fn(async (_options: ChatOptions): Promise<ChatResponse> => {
      if (callIndex >= responses.length) {
        return {
          content: 'Done',
          usage: { inputTokens: 0, outputTokens: 0 },
          stopReason: 'end_turn',
        };
      }
      return responses[callIndex++];
    }),
    stream: vi.fn(),
    isAvailable: vi.fn(async () => true),
  };
}

/** Helper to create a tool_use block. */
function toolUse(
  name: string,
  input: Record<string, unknown>,
  id = 'tc-1',
): ToolUseBlock {
  return { type: 'tool_use', id, name, input };
}

// ============================================================================
// Test State
// ============================================================================

let repo: InMemorySkillRepository;
let engine: SkillEngine;
let projectRoot: string;

beforeEach(async () => {
  _resetSkillEngine();
  _resetSkillRepository();
  _resetSkillEventBus();
  _resetTriggerManager();

  repo = new InMemorySkillRepository();
  setSkillRepository(repo);

  projectRoot = await createTempDir('integ-adv-root-');
  engine = new SkillEngine(projectRoot, repo);
});

afterEach(async () => {
  _resetSkillEngine();
  _resetSkillRepository();
  _resetSkillEventBus();
  _resetTriggerManager();

  for (const dir of tempDirs) {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
  tempDirs = [];
  vi.clearAllMocks();
});

// ============================================================================
// RBAC Permission Enforcement
// ============================================================================

describe('RBAC skill permission enforcement', () => {
  let mockUserRole: string;

  async function buildApp(): Promise<Hono<ApiEnv>> {
    vi.doMock('../../api/middleware/auth.js', () => ({
      requireAuth: vi.fn(
        async (
          c: { set: (k: string, v: string) => void },
          next: () => Promise<void>,
        ) => {
          c.set('userId', 'user-1');
          await next();
        },
      ),
    }));

    vi.doMock('../../api/middleware/rbac.js', () => ({
      resolveRole: vi.fn(
        async (
          c: { set: (k: string, v: string) => void },
          next: () => Promise<void>,
        ) => {
          c.set('userRole', mockUserRole);
          await next();
        },
      ),
      requirePermission: vi.fn((permission: string) => {
        return async (
          c: { get: (k: string) => string },
          next: () => Promise<void>,
        ) => {
          const role = c.get('userRole');
          const memberPerms = ['skill:view'];
          const adminPerms = ['skill:view', 'skill:execute', 'skill:manage'];
          const allowed = role === 'member' ? memberPerms : adminPerms;
          if (!allowed.includes(permission)) {
            return new Response(
              JSON.stringify({ error: `Missing permission: ${permission}` }),
              { status: 403, headers: { 'Content-Type': 'application/json' } },
            );
          }
          await next();
        };
      }),
    }));

    vi.doMock('../../core/skill/engine.js', () => ({
      getSkillEngine: () => engine,
    }));

    vi.doMock('../../core/skill/skill-event-bus.js', () => ({
      getSkillEventBus: () => getSkillEventBus(),
    }));

    const { skillsRoute } = await import('../../api/routes/skills.js');
    const app = new Hono<ApiEnv>();
    app.route('/api/v1/skills', skillsRoute);
    return app;
  }

  it('member role can list skills (skill:view)', async () => {
    mockUserRole = 'member';
    const app = await buildApp();

    const res = await app.request('/api/v1/skills', {
      method: 'GET',
      headers: { Authorization: 'Bearer test-token' },
    });

    expect(res.status).toBe(200);
  });

  it('member role cannot install skills (skill:manage)', async () => {
    mockUserRole = 'member';
    const app = await buildApp();

    const res = await app.request('/api/v1/skills/install', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ skillDir: '/tmp/skill', source: 'local' }),
    });

    expect(res.status).toBe(403);
  });

  it('admin role can install skills (skill:manage)', async () => {
    mockUserRole = 'admin';

    const skillDir = await createTempDir('skill-');
    await writeSkillYaml(skillDir);

    const app = await buildApp();

    const res = await app.request('/api/v1/skills/install', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ skillDir, source: 'local' }),
    });

    expect(res.status).toBeLessThan(400);
  });

  it('member role cannot execute skills (skill:execute)', async () => {
    mockUserRole = 'member';

    const skillDir = await createTempDir('skill-');
    await writeSkillYaml(skillDir);
    const skill = await engine.install('user-1', skillDir, 'local');
    await engine.configure(skill.id, {});
    await engine.updateStatus(skill.id, 'enabled');

    const app = await buildApp();

    const res = await app.request(`/api/v1/skills/${skill.id}/execute`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ serverId: 'server-1' }),
    });

    expect(res.status).toBe(403);
  });
});

// ============================================================================
// Error Recovery
// ============================================================================

describe('Error recovery integration', () => {
  it('should set skill to error status when manifest is corrupt during execution', async () => {
    const skillDir = await createTempDir('skill-');
    await writeSkillYaml(skillDir);

    const skill = await engine.install('user-1', skillDir, 'local');
    await engine.configure(skill.id, {});
    await engine.updateStatus(skill.id, 'enabled');

    // Corrupt the manifest after installation
    await writeFile(
      join(skillDir, 'skill.yaml'),
      'kind: invalid\nversion: "1.0"\n',
      'utf-8',
    );

    const { getActiveProvider } = await import(
      '../../ai/providers/provider-factory.js'
    );
    (getActiveProvider as ReturnType<typeof vi.fn>).mockReturnValue(
      createMockProvider([]),
    );

    // Execution should fail and set status to error
    await expect(
      engine.execute({
        skillId: skill.id,
        serverId: 'server-1',
        userId: 'user-1',
        triggerType: 'manual',
      }),
    ).rejects.toThrow(/Failed to load skill manifest/);

    const errorSkill = await repo.findById(skill.id);
    expect(errorSkill!.status).toBe('error');
  });

  it('should record failed execution when AI provider throws', async () => {
    const skillDir = await createTempDir('skill-');
    await writeSkillYaml(skillDir);

    const skill = await engine.install('user-1', skillDir, 'local');
    await engine.configure(skill.id, {});
    await engine.updateStatus(skill.id, 'enabled');

    const failingProvider: AIProviderInterface = {
      name: 'failing-provider',
      tier: 1,
      contextWindowSize: 200_000,
      chat: vi.fn(async () => {
        throw new Error('AI provider unavailable');
      }),
      stream: vi.fn(),
      isAvailable: vi.fn(async () => true),
    };

    const { getActiveProvider } = await import(
      '../../ai/providers/provider-factory.js'
    );
    (getActiveProvider as ReturnType<typeof vi.fn>).mockReturnValue(
      failingProvider,
    );

    const result = await engine.execute({
      skillId: skill.id,
      serverId: 'server-1',
      userId: 'user-1',
      triggerType: 'manual',
    });

    expect(result.status).toBe('failed');
    expect(result.errors.length).toBeGreaterThan(0);

    // Execution should be persisted as failed
    const executions = await repo.listExecutions(skill.id, 10);
    expect(executions).toHaveLength(1);
    expect(executions[0].status).toBe('failed');
  });

  it('should handle non-existent skill gracefully', async () => {
    await expect(
      engine.execute({
        skillId: 'non-existent',
        serverId: 'server-1',
        userId: 'user-1',
        triggerType: 'manual',
      }),
    ).rejects.toThrow(/Skill not found/);
  });
});

// ============================================================================
// Multi-Step Tool Execution
// ============================================================================

describe('Multi-step execution integration', () => {
  it('should execute multiple tool calls in sequence and track all steps', async () => {
    const skillDir = await createTempDir('skill-');
    await writeSkillYaml(skillDir, { tools: '  - shell\n  - read_file' });

    const skill = await engine.install('user-1', skillDir, 'local');
    await engine.configure(skill.id, {});
    await engine.updateStatus(skill.id, 'enabled');

    const provider = createMockProvider([
      {
        content: 'Step 1: Check services',
        usage: { inputTokens: 50, outputTokens: 20 },
        toolCalls: [
          toolUse('shell', { command: 'systemctl list-units' }, 'tc-1'),
        ],
        stopReason: 'tool_use',
      },
      {
        content: 'Step 2: Read config',
        usage: { inputTokens: 100, outputTokens: 50 },
        toolCalls: [
          toolUse('read_file', { path: '/etc/nginx/nginx.conf' }, 'tc-2'),
        ],
        stopReason: 'tool_use',
      },
      {
        content: 'Analysis complete. Services OK, config valid.',
        usage: { inputTokens: 150, outputTokens: 80 },
        stopReason: 'end_turn',
      },
    ]);

    const { getActiveProvider } = await import(
      '../../ai/providers/provider-factory.js'
    );
    (getActiveProvider as ReturnType<typeof vi.fn>).mockReturnValue(provider);

    const result = await engine.execute({
      skillId: skill.id,
      serverId: 'server-1',
      userId: 'user-1',
      triggerType: 'manual',
    });

    expect(result.status).toBe('success');
    expect(result.stepsExecuted).toBe(2);
  });

  it('should respect max_steps constraint', async () => {
    const skillDir = await createTempDir('skill-');
    await writeSkillYaml(skillDir, { maxSteps: 2 });

    const skill = await engine.install('user-1', skillDir, 'local');
    await engine.configure(skill.id, {});
    await engine.updateStatus(skill.id, 'enabled');

    // Provider returns tool_use indefinitely
    const infiniteProvider: AIProviderInterface = {
      name: 'infinite-provider',
      tier: 1,
      contextWindowSize: 200_000,
      chat: vi.fn(async (): Promise<ChatResponse> => ({
        content: 'Running...',
        usage: { inputTokens: 10, outputTokens: 5 },
        toolCalls: [
          toolUse('shell', { command: 'echo step' }, `tc-${Date.now()}`),
        ],
        stopReason: 'tool_use',
      })),
      stream: vi.fn(),
      isAvailable: vi.fn(async () => true),
    };

    const { getActiveProvider } = await import(
      '../../ai/providers/provider-factory.js'
    );
    (getActiveProvider as ReturnType<typeof vi.fn>).mockReturnValue(
      infiniteProvider,
    );

    const result = await engine.execute({
      skillId: skill.id,
      serverId: 'server-1',
      userId: 'user-1',
      triggerType: 'manual',
    });

    // Should stop at max_steps (2)
    expect(result.stepsExecuted).toBeLessThanOrEqual(2);
  });
});

// ============================================================================
// Chain Depth & Cycle Detection
// ============================================================================

describe('Chain depth and cycle detection', () => {
  it('should reject execution when chain depth exceeds limit', async () => {
    const skillDir = await createTempDir('skill-');
    await writeSkillYaml(skillDir);

    const skill = await engine.install('user-1', skillDir, 'local');
    await engine.configure(skill.id, {});
    await engine.updateStatus(skill.id, 'enabled');

    await expect(
      engine.execute({
        skillId: skill.id,
        serverId: 'server-1',
        userId: 'user-1',
        triggerType: 'event',
        chainContext: {
          depth: 5,
          trail: ['a', 'b', 'c', 'd', 'e'],
        },
      }),
    ).rejects.toThrow(/Chain depth limit exceeded/);
  });

  it('should reject execution when circular chain detected', async () => {
    const skillDir = await createTempDir('skill-');
    await writeSkillYaml(skillDir);

    const skill = await engine.install('user-1', skillDir, 'local');
    await engine.configure(skill.id, {});
    await engine.updateStatus(skill.id, 'enabled');

    await expect(
      engine.execute({
        skillId: skill.id,
        serverId: 'server-1',
        userId: 'user-1',
        triggerType: 'event',
        chainContext: {
          depth: 2,
          trail: ['other-skill', skill.id],
        },
      }),
    ).rejects.toThrow(/Circular chain detected/);
  });
});

// ============================================================================
// Status Transition Validation
// ============================================================================

describe('Status transition validation', () => {
  it('should reject invalid status transitions', async () => {
    const skillDir = await createTempDir('skill-');
    await writeSkillYaml(skillDir);

    const skill = await engine.install('user-1', skillDir, 'local');
    // installed → paused is invalid (must go through configured or enabled first)
    await expect(engine.updateStatus(skill.id, 'paused')).rejects.toThrow(
      /Invalid status transition/,
    );
  });

  it('should allow error recovery: error → enabled', async () => {
    const skillDir = await createTempDir('skill-');
    await writeSkillYaml(skillDir);

    const skill = await engine.install('user-1', skillDir, 'local');

    // Force error status
    await engine.updateStatus(skill.id, 'error');
    const errorSkill = await repo.findById(skill.id);
    expect(errorSkill!.status).toBe('error');

    // Recover: error → enabled
    await engine.updateStatus(skill.id, 'enabled');
    const recovered = await repo.findById(skill.id);
    expect(recovered!.status).toBe('enabled');
  });
});
