// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for SkillEngine — lifecycle management, execution, and queries.
 *
 * Uses InMemorySkillRepository and temp directories with valid skill.yaml files.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { join } from 'node:path';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';

import { SkillEngine, _resetSkillEngine } from './engine.js';
import {
  InMemorySkillRepository,
  setSkillRepository,
  _resetSkillRepository,
} from '../../db/repositories/skill-repository.js';
import {
  InMemoryServerRepository,
  setServerRepository,
  _resetServerRepository,
} from '../../db/repositories/server-repository.js';
import type { SkillRunParams, BatchExecutionResult, SkillExecutionResult } from './types.js';
import { SkillRunner } from './runner.js';
import { getWebhookDispatcher } from '../webhook/dispatcher.js';

// Mock SkillRunner to avoid AI provider dependency in engine tests
vi.mock('./runner.js', () => ({
  SkillRunner: vi.fn().mockImplementation(() => ({
    run: vi.fn().mockResolvedValue({
      success: true,
      status: 'success',
      stepsExecuted: 0,
      duration: 10,
      output: 'Mock execution complete',
      errors: [],
      toolResults: [],
    }),
  })),
}));

// Mock TriggerManager to isolate engine tests from trigger logic
vi.mock('./trigger-manager.js', () => {
  const mockManager = {
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn(),
    registerSkill: vi.fn().mockResolvedValue(undefined),
    unregisterSkill: vi.fn(),
    isRunning: vi.fn().mockReturnValue(false),
  };
  return {
    TriggerManager: vi.fn().mockImplementation(() => mockManager),
    setTriggerManager: vi.fn(),
    _resetTriggerManager: vi.fn(),
  };
});

// Mock WebhookDispatcher to verify dispatch calls without real HTTP delivery
vi.mock('../webhook/dispatcher.js', () => ({
  getWebhookDispatcher: vi.fn().mockReturnValue({
    dispatch: vi.fn().mockResolvedValue(undefined),
  }),
}));

// ============================================================================
// Helpers
// ============================================================================

let tempDirs: string[] = [];

async function createTempDir(prefix = 'engine-test-'): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

/** Write a minimal valid skill.yaml to a directory. */
async function writeSkillYaml(
  dir: string,
  overrides: { name?: string; prompt?: string; triggers?: string; tools?: string } = {},
): Promise<void> {
  const name = overrides.name ?? 'test-skill';
  const prompt =
    overrides.prompt ??
    'This is a test prompt that must be at least 50 characters long to pass validation rules properly.';
  const triggers = overrides.triggers ?? '  - type: manual';
  const tools = overrides.tools ?? '  - shell';

  const yaml = `kind: skill
version: "1.0"

metadata:
  name: ${name}
  displayName: "Test Skill"
  version: "1.0.0"

triggers:
${triggers}

tools:
${tools}

prompt: |
  ${prompt}
`;
  await writeFile(join(dir, 'skill.yaml'), yaml, 'utf-8');
}

/** Write a skill.yaml that uses template variables. */
async function writeTemplatedSkillYaml(dir: string): Promise<void> {
  const yaml = `kind: skill
version: "1.0"

metadata:
  name: templated-skill
  displayName: "Templated Skill"
  version: "1.0.0"

triggers:
  - type: manual

tools:
  - shell

inputs:
  - name: target_dir
    type: string
    required: false
    default: "/var/log"
    description: "Target directory to check"

prompt: |
  Analyze the directory {{input.target_dir}} on server {{server.name}}.
  Current time: {{now}}. Last run: {{skill.last_run}}.
  This prompt is long enough to meet the minimum 50-character validation requirement.
`;
  await writeFile(join(dir, 'skill.yaml'), yaml, 'utf-8');
}

let repo: InMemorySkillRepository;
let serverRepo: InMemoryServerRepository;
let engine: SkillEngine;
let projectRoot: string;

beforeEach(async () => {
  _resetSkillEngine();
  _resetSkillRepository();
  _resetServerRepository();
  vi.mocked(getWebhookDispatcher().dispatch).mockClear();

  repo = new InMemorySkillRepository();
  setSkillRepository(repo);

  serverRepo = new InMemoryServerRepository();
  setServerRepository(serverRepo);

  projectRoot = await createTempDir('engine-root-');
  engine = new SkillEngine(projectRoot, repo);
});

afterEach(async () => {
  _resetSkillEngine();
  _resetSkillRepository();
  _resetServerRepository();

  for (const dir of tempDirs) {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
  tempDirs = [];
});

// ============================================================================
// Lifecycle: start / stop
// ============================================================================

describe('SkillEngine lifecycle', () => {
  it('should start and stop without error', async () => {
    await engine.start();
    await engine.start(); // idempotent
    engine.stop();
    engine.stop(); // idempotent
  });
});

// ============================================================================
// Install
// ============================================================================

describe('SkillEngine.install', () => {
  it('should install a valid skill from disk', async () => {
    const skillDir = await createTempDir('skill-');
    await writeSkillYaml(skillDir);

    const skill = await engine.install('user-1', skillDir, 'local');

    expect(skill.id).toBeDefined();
    expect(skill.name).toBe('test-skill');
    expect(skill.displayName).toBe('Test Skill');
    expect(skill.version).toBe('1.0.0');
    expect(skill.source).toBe('local');
    expect(skill.status).toBe('installed');
    expect(skill.userId).toBe('user-1');
    expect(skill.config).toBeNull();
  });

  it('should reject duplicate installation (same user + name)', async () => {
    const skillDir = await createTempDir('skill-');
    await writeSkillYaml(skillDir);

    await engine.install('user-1', skillDir, 'local');

    await expect(engine.install('user-1', skillDir, 'local')).rejects.toThrow(
      /already installed/,
    );
  });

  it('should allow same skill name for different users', async () => {
    const skillDir = await createTempDir('skill-');
    await writeSkillYaml(skillDir);

    const s1 = await engine.install('user-1', skillDir, 'local');
    const s2 = await engine.install('user-2', skillDir, 'local');

    expect(s1.userId).toBe('user-1');
    expect(s2.userId).toBe('user-2');
    expect(s1.id).not.toBe(s2.id);
  });

  it('should reject installation from invalid directory (no skill.yaml)', async () => {
    const emptyDir = await createTempDir('empty-');

    await expect(engine.install('user-1', emptyDir, 'local')).rejects.toThrow(
      /skill\.yaml not found/,
    );
  });

  it('should reject installation with invalid YAML schema', async () => {
    const badDir = await createTempDir('bad-');
    await writeFile(join(badDir, 'skill.yaml'), 'kind: invalid\nversion: "1.0"\n', 'utf-8');

    await expect(engine.install('user-1', badDir, 'local')).rejects.toThrow(
      /validation failed/i,
    );
  });

  it('should install with official source type', async () => {
    const skillDir = await createTempDir('skill-');
    await writeSkillYaml(skillDir, { name: 'official-skill' });

    const skill = await engine.install('user-1', skillDir, 'official');

    expect(skill.source).toBe('official');
  });

  it('should install with community source type', async () => {
    const skillDir = await createTempDir('skill-');
    await writeSkillYaml(skillDir, { name: 'community-skill' });

    const skill = await engine.install('user-1', skillDir, 'community');

    expect(skill.source).toBe('community');
  });
});

// ============================================================================
// Uninstall
// ============================================================================

describe('SkillEngine.uninstall', () => {
  it('should uninstall an existing skill', async () => {
    const skillDir = await createTempDir('skill-');
    await writeSkillYaml(skillDir);

    const skill = await engine.install('user-1', skillDir, 'local');
    await engine.uninstall(skill.id);

    const found = await engine.getInstalled(skill.id);
    expect(found).toBeNull();
  });

  it('should throw when uninstalling a non-existent skill', async () => {
    await expect(engine.uninstall('non-existent-id')).rejects.toThrow(
      /Skill not found/,
    );
  });

  it('should also remove executions when skill is uninstalled', async () => {
    const skillDir = await createTempDir('skill-');
    await writeSkillYaml(skillDir);

    const skill = await engine.install('user-1', skillDir, 'local');
    // Enable it first so we can execute
    await engine.updateStatus(skill.id, 'enabled');
    await engine.execute({
      skillId: skill.id,
      serverId: 'server-1',
      userId: 'user-1',
      triggerType: 'manual',
    });

    // Verify execution exists
    const execsBefore = await engine.getExecutions(skill.id);
    expect(execsBefore).toHaveLength(1);

    // Uninstall — InMemorySkillRepository cascades execution deletion
    await engine.uninstall(skill.id);

    const execsAfter = await engine.getExecutions(skill.id);
    expect(execsAfter).toHaveLength(0);
  });
});

// ============================================================================
// Configure
// ============================================================================

describe('SkillEngine.configure', () => {
  it('should update config on an installed skill', async () => {
    const skillDir = await createTempDir('skill-');
    await writeSkillYaml(skillDir);

    const skill = await engine.install('user-1', skillDir, 'local');
    await engine.configure(skill.id, { key: 'value', count: 42 });

    const updated = await engine.getInstalled(skill.id);
    expect(updated!.config).toEqual({ key: 'value', count: 42 });
  });

  it('should auto-transition from installed → configured on first config', async () => {
    const skillDir = await createTempDir('skill-');
    await writeSkillYaml(skillDir);

    const skill = await engine.install('user-1', skillDir, 'local');
    expect(skill.status).toBe('installed');

    await engine.configure(skill.id, { key: 'value' });

    const updated = await engine.getInstalled(skill.id);
    expect(updated!.status).toBe('configured');
  });

  it('should not change status if already beyond installed', async () => {
    const skillDir = await createTempDir('skill-');
    await writeSkillYaml(skillDir);

    const skill = await engine.install('user-1', skillDir, 'local');
    await engine.updateStatus(skill.id, 'enabled');

    await engine.configure(skill.id, { key: 'new-value' });

    const updated = await engine.getInstalled(skill.id);
    expect(updated!.status).toBe('enabled');
    expect(updated!.config).toEqual({ key: 'new-value' });
  });

  it('should throw when configuring a non-existent skill', async () => {
    await expect(
      engine.configure('non-existent-id', { key: 'val' }),
    ).rejects.toThrow(/Skill not found/);
  });
});

// ============================================================================
// Status Transitions
// ============================================================================

describe('SkillEngine.updateStatus', () => {
  it('should allow installed → enabled', async () => {
    const skillDir = await createTempDir('skill-');
    await writeSkillYaml(skillDir);

    const skill = await engine.install('user-1', skillDir, 'local');
    await engine.updateStatus(skill.id, 'enabled');

    const updated = await engine.getInstalled(skill.id);
    expect(updated!.status).toBe('enabled');
  });

  it('should allow enabled → paused → enabled cycle', async () => {
    const skillDir = await createTempDir('skill-');
    await writeSkillYaml(skillDir);

    const skill = await engine.install('user-1', skillDir, 'local');
    await engine.updateStatus(skill.id, 'enabled');
    await engine.updateStatus(skill.id, 'paused');

    let updated = await engine.getInstalled(skill.id);
    expect(updated!.status).toBe('paused');

    await engine.updateStatus(skill.id, 'enabled');
    updated = await engine.getInstalled(skill.id);
    expect(updated!.status).toBe('enabled');
  });

  it('should allow error → installed recovery', async () => {
    const skillDir = await createTempDir('skill-');
    await writeSkillYaml(skillDir);

    const skill = await engine.install('user-1', skillDir, 'local');
    await engine.updateStatus(skill.id, 'error');

    let updated = await engine.getInstalled(skill.id);
    expect(updated!.status).toBe('error');

    await engine.updateStatus(skill.id, 'installed');
    updated = await engine.getInstalled(skill.id);
    expect(updated!.status).toBe('installed');
  });

  it('should reject invalid transition installed → paused', async () => {
    const skillDir = await createTempDir('skill-');
    await writeSkillYaml(skillDir);

    const skill = await engine.install('user-1', skillDir, 'local');

    await expect(engine.updateStatus(skill.id, 'paused')).rejects.toThrow(
      /Invalid status transition: installed → paused/,
    );
  });

  it('should reject transition to same status (enabled → enabled)', async () => {
    const skillDir = await createTempDir('skill-');
    await writeSkillYaml(skillDir);

    const skill = await engine.install('user-1', skillDir, 'local');
    await engine.updateStatus(skill.id, 'enabled');

    await expect(engine.updateStatus(skill.id, 'enabled')).rejects.toThrow(
      /Invalid status transition/,
    );
  });

  it('should throw when updating status of non-existent skill', async () => {
    await expect(engine.updateStatus('non-existent', 'enabled')).rejects.toThrow(
      /Skill not found/,
    );
  });
});

// ============================================================================
// Execute
// ============================================================================

describe('SkillEngine.execute', () => {
  it('should execute an enabled skill successfully via SkillRunner', async () => {
    const skillDir = await createTempDir('skill-');
    await writeSkillYaml(skillDir);

    const skill = await engine.install('user-1', skillDir, 'local');
    await engine.updateStatus(skill.id, 'enabled');

    const result = await engine.execute({
      skillId: skill.id,
      serverId: 'server-1',
      userId: 'user-1',
      triggerType: 'manual',
    });

    expect(result.executionId).toBeDefined();
    expect(result.status).toBe('success');
    expect(result.stepsExecuted).toBe(0);
    expect(result.duration).toBeGreaterThanOrEqual(0);
    expect(result.errors).toEqual([]);
    expect(result.result).toBeDefined();
    expect(result.result!['output']).toBe('Mock execution complete');
  });

  it('should pass config to SkillRunner', async () => {
    const skillDir = await createTempDir('skill-');
    await writeTemplatedSkillYaml(skillDir);

    const skill = await engine.install('user-1', skillDir, 'local');
    await engine.updateStatus(skill.id, 'enabled');

    const result = await engine.execute({
      skillId: skill.id,
      serverId: 'server-1',
      userId: 'user-1',
      triggerType: 'manual',
      config: { target_dir: '/opt/logs' },
    });

    expect(result.status).toBe('success');
    expect(result.result).toBeDefined();
  });

  it('should merge runtime config with stored config', async () => {
    const skillDir = await createTempDir('skill-');
    await writeTemplatedSkillYaml(skillDir);

    const skill = await engine.install('user-1', skillDir, 'local');
    await engine.configure(skill.id, { target_dir: '/var/log/stored' });
    await engine.updateStatus(skill.id, 'enabled');

    // Runtime config overrides stored config
    const result = await engine.execute({
      skillId: skill.id,
      serverId: 'server-1',
      userId: 'user-1',
      triggerType: 'manual',
      config: { target_dir: '/var/log/runtime' },
    });

    expect(result.status).toBe('success');
    expect(result.result).toBeDefined();
  });

  it('should use stored config when no runtime config provided', async () => {
    const skillDir = await createTempDir('skill-');
    await writeTemplatedSkillYaml(skillDir);

    const skill = await engine.install('user-1', skillDir, 'local');
    await engine.configure(skill.id, { target_dir: '/var/log/stored' });
    await engine.updateStatus(skill.id, 'enabled');

    const result = await engine.execute({
      skillId: skill.id,
      serverId: 'server-1',
      userId: 'user-1',
      triggerType: 'manual',
    });

    expect(result.status).toBe('success');
    expect(result.result).toBeDefined();
  });

  it('should reject execution of a non-enabled skill', async () => {
    const skillDir = await createTempDir('skill-');
    await writeSkillYaml(skillDir);

    const skill = await engine.install('user-1', skillDir, 'local');
    // Status is 'installed', not 'enabled'

    await expect(
      engine.execute({
        skillId: skill.id,
        serverId: 'server-1',
        userId: 'user-1',
        triggerType: 'manual',
      }),
    ).rejects.toThrow(/not enabled/);
  });

  it('should reject execution of a paused skill', async () => {
    const skillDir = await createTempDir('skill-');
    await writeSkillYaml(skillDir);

    const skill = await engine.install('user-1', skillDir, 'local');
    await engine.updateStatus(skill.id, 'enabled');
    await engine.updateStatus(skill.id, 'paused');

    await expect(
      engine.execute({
        skillId: skill.id,
        serverId: 'server-1',
        userId: 'user-1',
        triggerType: 'manual',
      }),
    ).rejects.toThrow(/not enabled/);
  });

  it('should reject execution of a non-existent skill', async () => {
    await expect(
      engine.execute({
        skillId: 'non-existent',
        serverId: 'server-1',
        userId: 'user-1',
        triggerType: 'manual',
      }),
    ).rejects.toThrow(/Skill not found/);
  });

  it('should set skill to error state if manifest fails to load', async () => {
    const skillDir = await createTempDir('skill-');
    await writeSkillYaml(skillDir);

    const skill = await engine.install('user-1', skillDir, 'local');
    await engine.updateStatus(skill.id, 'enabled');

    // Delete the skill.yaml after installation to simulate disk failure
    const { rm: rmFile } = await import('node:fs/promises');
    await rmFile(join(skillDir, 'skill.yaml'));

    await expect(
      engine.execute({
        skillId: skill.id,
        serverId: 'server-1',
        userId: 'user-1',
        triggerType: 'manual',
      }),
    ).rejects.toThrow(/Failed to load skill manifest/);

    // Skill should be set to error status
    const updated = await engine.getInstalled(skill.id);
    expect(updated!.status).toBe('error');
  });

  it('should record execution with correct metadata', async () => {
    const skillDir = await createTempDir('skill-');
    await writeSkillYaml(skillDir);

    const skill = await engine.install('user-1', skillDir, 'local');
    await engine.updateStatus(skill.id, 'enabled');

    const result = await engine.execute({
      skillId: skill.id,
      serverId: 'server-1',
      userId: 'user-1',
      triggerType: 'manual',
    });

    // Check execution record in repository
    const execs = await engine.getExecutions(skill.id);
    expect(execs).toHaveLength(1);
    expect(execs[0].id).toBe(result.executionId);
    expect(execs[0].skillId).toBe(skill.id);
    expect(execs[0].serverId).toBe('server-1');
    expect(execs[0].userId).toBe('user-1');
    expect(execs[0].triggerType).toBe('manual');
    expect(execs[0].status).toBe('success');
    expect(execs[0].completedAt).toBeDefined();
    expect(execs[0].stepsExecuted).toBe(0);
    expect(execs[0].duration).toBeGreaterThanOrEqual(0);
  });

  it('should include runner output in execution result', async () => {
    const skillDir = await createTempDir('skill-');
    await writeSkillYaml(skillDir);

    const skill = await engine.install('user-1', skillDir, 'local');
    await engine.updateStatus(skill.id, 'enabled');

    const result = await engine.execute({
      skillId: skill.id,
      serverId: 'server-1',
      userId: 'user-1',
      triggerType: 'manual',
    });

    expect(result.result).toBeDefined();
    expect(result.result!['output']).toBe('Mock execution complete');
    expect(result.result!['toolResults']).toEqual([]);
    expect(result.result!['errors']).toEqual([]);
  });
});

// ============================================================================
// Webhook Dispatch — skill.completed / skill.failed events
// ============================================================================

describe('SkillEngine webhook dispatch', () => {
  it('should dispatch skill.completed webhook on successful execution', async () => {
    const skillDir = await createTempDir('skill-');
    await writeSkillYaml(skillDir);

    const skill = await engine.install('user-1', skillDir, 'local');
    await engine.updateStatus(skill.id, 'enabled');

    const result = await engine.execute({
      skillId: skill.id,
      serverId: 'server-1',
      userId: 'user-1',
      triggerType: 'manual',
    });

    expect(result.status).toBe('success');
    expect(vi.mocked(getWebhookDispatcher().dispatch)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(getWebhookDispatcher().dispatch)).toHaveBeenCalledWith({
      type: 'skill.completed',
      userId: 'user-1',
      data: expect.objectContaining({
        serverId: 'server-1',
        skillId: skill.id,
        skillName: 'test-skill',
        executionId: result.executionId,
        status: 'success',
      }),
    });
  });

  it('should dispatch skill.failed webhook when runner returns failure', async () => {
    const skillDir = await createTempDir('skill-');
    await writeSkillYaml(skillDir);

    const skill = await engine.install('user-1', skillDir, 'local');
    await engine.updateStatus(skill.id, 'enabled');

    // Override SkillRunner mock to return failure
    vi.mocked(SkillRunner).mockImplementationOnce(() => ({
      run: vi.fn().mockResolvedValue({
        success: false,
        status: 'failed',
        stepsExecuted: 1,
        duration: 5,
        output: '',
        errors: ['Command failed'],
        toolResults: [],
      }),
    }) as unknown as SkillRunner);

    const result = await engine.execute({
      skillId: skill.id,
      serverId: 'server-1',
      userId: 'user-1',
      triggerType: 'manual',
    });

    expect(result.status).toBe('failed');
    expect(vi.mocked(getWebhookDispatcher().dispatch)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(getWebhookDispatcher().dispatch)).toHaveBeenCalledWith({
      type: 'skill.failed',
      userId: 'user-1',
      data: expect.objectContaining({
        serverId: 'server-1',
        skillId: skill.id,
        skillName: 'test-skill',
        executionId: result.executionId,
        status: 'failed',
      }),
    });
  });

  it('should dispatch skill.failed webhook when runner throws an exception', async () => {
    const skillDir = await createTempDir('skill-');
    await writeSkillYaml(skillDir);

    const skill = await engine.install('user-1', skillDir, 'local');
    await engine.updateStatus(skill.id, 'enabled');

    // Override SkillRunner mock to throw an error
    vi.mocked(SkillRunner).mockImplementationOnce(() => ({
      run: vi.fn().mockRejectedValue(new Error('AI provider unavailable')),
    }) as unknown as SkillRunner);

    const result = await engine.execute({
      skillId: skill.id,
      serverId: 'server-1',
      userId: 'user-1',
      triggerType: 'manual',
    });

    expect(result.status).toBe('failed');
    expect(result.errors).toContain('AI provider unavailable');
    expect(vi.mocked(getWebhookDispatcher().dispatch)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(getWebhookDispatcher().dispatch)).toHaveBeenCalledWith({
      type: 'skill.failed',
      userId: 'user-1',
      data: expect.objectContaining({
        serverId: 'server-1',
        skillId: skill.id,
        skillName: 'test-skill',
        status: 'failed',
        error: 'AI provider unavailable',
      }),
    });
  });
});

// ============================================================================
// Chain Context — Cycle Detection & Depth Limits
// ============================================================================

describe('SkillEngine chain context', () => {
  it('should reject execution when chain depth exceeds limit', async () => {
    const skillDir = await createTempDir('skill-');
    await writeSkillYaml(skillDir);

    const skill = await engine.install('user-1', skillDir, 'local');
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

  it('should reject execution when circular chain is detected', async () => {
    const skillDir = await createTempDir('skill-');
    await writeSkillYaml(skillDir);

    const skill = await engine.install('user-1', skillDir, 'local');
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

  it('should allow execution at chain depth below limit', async () => {
    const skillDir = await createTempDir('skill-');
    await writeSkillYaml(skillDir);

    const skill = await engine.install('user-1', skillDir, 'local');
    await engine.updateStatus(skill.id, 'enabled');

    const result = await engine.execute({
      skillId: skill.id,
      serverId: 'server-1',
      userId: 'user-1',
      triggerType: 'event',
      chainContext: {
        depth: 4,
        trail: ['a', 'b', 'c', 'd'],
      },
    });

    expect(result.status).toBe('success');
  });

  it('should execute normally without chain context (manual trigger)', async () => {
    const skillDir = await createTempDir('skill-');
    await writeSkillYaml(skillDir);

    const skill = await engine.install('user-1', skillDir, 'local');
    await engine.updateStatus(skill.id, 'enabled');

    const result = await engine.execute({
      skillId: skill.id,
      serverId: 'server-1',
      userId: 'user-1',
      triggerType: 'manual',
    });

    expect(result.status).toBe('success');
  });
});

// ============================================================================
// Template Variable Injection
// ============================================================================

describe('SkillEngine template variable injection', () => {
  it('should inject server.name into prompt template', async () => {
    // Create a server in the repository
    const server = await serverRepo.create({
      name: 'prod-web-01',
      userId: 'user-1',
    });

    const skillDir = await createTempDir('skill-tpl-');
    await writeTemplatedSkillYaml(skillDir);

    const skill = await engine.install('user-1', skillDir, 'local');
    await engine.updateStatus(skill.id, 'enabled');

    const result = await engine.execute({
      skillId: skill.id,
      serverId: server.id,
      userId: 'user-1',
      triggerType: 'manual',
    });

    expect(result.status).toBe('success');

    // Verify the SkillRunner received a resolved prompt with server.name
    const runnerInstance = vi.mocked(SkillRunner).mock.results.at(-1)?.value;
    const runCall = runnerInstance.run.mock.calls[0][0];
    expect(runCall.resolvedPrompt).toContain('prod-web-01');
    expect(runCall.resolvedPrompt).not.toContain('{{server.name}}');
  });

  it('should inject skill.last_run from previous execution', async () => {
    const server = await serverRepo.create({
      name: 'test-server',
      userId: 'user-1',
    });

    const skillDir = await createTempDir('skill-tpl-');
    await writeTemplatedSkillYaml(skillDir);

    const skill = await engine.install('user-1', skillDir, 'local');
    await engine.updateStatus(skill.id, 'enabled');

    // First execution — no previous run, should get N/A
    const resultsBeforeFirst = vi.mocked(SkillRunner).mock.results.length;
    await engine.execute({
      skillId: skill.id,
      serverId: server.id,
      userId: 'user-1',
      triggerType: 'manual',
    });

    const firstRunnerInstance = vi.mocked(SkillRunner).mock.results[resultsBeforeFirst].value;
    const firstCall = firstRunnerInstance.run.mock.calls[0][0];
    expect(firstCall.resolvedPrompt).toContain('N/A');
    expect(firstCall.resolvedPrompt).not.toContain('{{skill.last_run}}');

    // Second execution — should have last_run from first execution
    const resultsBeforeSecond = vi.mocked(SkillRunner).mock.results.length;
    await engine.execute({
      skillId: skill.id,
      serverId: server.id,
      userId: 'user-1',
      triggerType: 'manual',
    });

    const secondRunnerInstance = vi.mocked(SkillRunner).mock.results[resultsBeforeSecond].value;
    const secondCall = secondRunnerInstance.run.mock.calls[0][0];
    // last_run should be an ISO date string (not N/A)
    expect(secondCall.resolvedPrompt).not.toContain('N/A');
    expect(secondCall.resolvedPrompt).not.toContain('{{skill.last_run}}');
  });

  it('should use N/A for skill.last_run when no previous execution exists', async () => {
    const server = await serverRepo.create({
      name: 'test-server',
      userId: 'user-1',
    });

    const skillDir = await createTempDir('skill-tpl-');
    await writeTemplatedSkillYaml(skillDir);

    const skill = await engine.install('user-1', skillDir, 'local');
    await engine.updateStatus(skill.id, 'enabled');

    await engine.execute({
      skillId: skill.id,
      serverId: server.id,
      userId: 'user-1',
      triggerType: 'manual',
    });

    const runnerInstance = vi.mocked(SkillRunner).mock.results.at(-1)?.value;
    const runCall = runnerInstance.run.mock.calls[0][0];
    // Template: "Last run: {{skill.last_run}}"
    expect(runCall.resolvedPrompt).toContain('Last run: N/A');
  });

  it('should use empty strings for server vars when server not found', async () => {
    const skillDir = await createTempDir('skill-tpl-');
    await writeTemplatedSkillYaml(skillDir);

    const skill = await engine.install('user-1', skillDir, 'local');
    await engine.updateStatus(skill.id, 'enabled');

    // Use a non-existent serverId
    const result = await engine.execute({
      skillId: skill.id,
      serverId: 'non-existent-server',
      userId: 'user-1',
      triggerType: 'manual',
    });

    expect(result.status).toBe('success');

    const runnerInstance = vi.mocked(SkillRunner).mock.results.at(-1)?.value;
    const runCall = runnerInstance.run.mock.calls[0][0];
    // server.name replaced with empty string (not left as template)
    expect(runCall.resolvedPrompt).not.toContain('{{server.name}}');
    expect(runCall.resolvedPrompt).toContain('on server .');
  });

  it('should inject server.os from profile when available', async () => {
    const server = await serverRepo.create({
      name: 'linux-box',
      userId: 'user-1',
    });

    // Update profile osInfo via the in-memory reference
    const profile = await serverRepo.getProfile(server.id, 'user-1');
    if (profile) {
      profile.osInfo = {
        platform: 'Ubuntu 22.04',
        arch: 'x86_64',
        version: '22.04',
        kernel: '5.15.0',
        hostname: '192.168.1.100',
        uptime: 86400,
      };
    }

    const skillDir = await createTempDir('skill-os-');
    const yaml = `kind: skill
version: "1.0"

metadata:
  name: os-check-skill
  displayName: "OS Check"
  version: "1.0.0"

triggers:
  - type: manual

tools:
  - shell

prompt: |
  Check the system running {{server.os}} at {{server.ip}}.
  This prompt is long enough to meet the minimum 50-character validation requirement.
`;
    await writeFile(join(skillDir, 'skill.yaml'), yaml, 'utf-8');

    const skill = await engine.install('user-1', skillDir, 'local');
    await engine.updateStatus(skill.id, 'enabled');

    await engine.execute({
      skillId: skill.id,
      serverId: server.id,
      userId: 'user-1',
      triggerType: 'manual',
    });

    const runnerInstance = vi.mocked(SkillRunner).mock.results.at(-1)?.value;
    const runCall = runnerInstance.run.mock.calls[0][0];
    expect(runCall.resolvedPrompt).toContain('Ubuntu 22.04');
    expect(runCall.resolvedPrompt).toContain('192.168.1.100');
    expect(runCall.resolvedPrompt).not.toContain('{{server.os}}');
    expect(runCall.resolvedPrompt).not.toContain('{{server.ip}}');
  });
});

// ============================================================================
// Queries
// ============================================================================

describe('SkillEngine queries', () => {
  it('listInstalled should return all skills for a user', async () => {
    const dir1 = await createTempDir('skill-1-');
    await writeSkillYaml(dir1, { name: 'skill-one' });
    const dir2 = await createTempDir('skill-2-');
    await writeSkillYaml(dir2, { name: 'skill-two' });

    await engine.install('user-1', dir1, 'local');
    await engine.install('user-1', dir2, 'local');

    const skills = await engine.listInstalled('user-1');
    expect(skills).toHaveLength(2);

    const names = skills.map((s) => s.name);
    expect(names).toContain('skill-one');
    expect(names).toContain('skill-two');
  });

  it('listInstalled should return empty for user with no skills', async () => {
    const skills = await engine.listInstalled('user-no-skills');
    expect(skills).toHaveLength(0);
  });

  it('listInstalled should not leak skills between users', async () => {
    const dir1 = await createTempDir('skill-');
    await writeSkillYaml(dir1, { name: 'user1-skill' });

    await engine.install('user-1', dir1, 'local');

    const user2Skills = await engine.listInstalled('user-2');
    expect(user2Skills).toHaveLength(0);
  });

  it('getInstalled should return a single skill by ID', async () => {
    const skillDir = await createTempDir('skill-');
    await writeSkillYaml(skillDir);

    const skill = await engine.install('user-1', skillDir, 'local');
    const found = await engine.getInstalled(skill.id);

    expect(found).toBeDefined();
    expect(found!.id).toBe(skill.id);
    expect(found!.name).toBe('test-skill');
  });

  it('getInstalled should return null for non-existent ID', async () => {
    const found = await engine.getInstalled('non-existent');
    expect(found).toBeNull();
  });

  it('getExecutions should return execution history for a skill', async () => {
    const skillDir = await createTempDir('skill-');
    await writeSkillYaml(skillDir);

    const skill = await engine.install('user-1', skillDir, 'local');
    await engine.updateStatus(skill.id, 'enabled');

    // Execute twice
    await engine.execute({
      skillId: skill.id,
      serverId: 'server-1',
      userId: 'user-1',
      triggerType: 'manual',
    });
    await engine.execute({
      skillId: skill.id,
      serverId: 'server-2',
      userId: 'user-1',
      triggerType: 'manual',
    });

    const execs = await engine.getExecutions(skill.id);
    expect(execs).toHaveLength(2);
  });

  it('getExecutions should respect limit parameter', async () => {
    const skillDir = await createTempDir('skill-');
    await writeSkillYaml(skillDir);

    const skill = await engine.install('user-1', skillDir, 'local');
    await engine.updateStatus(skill.id, 'enabled');

    // Execute 5 times
    for (let i = 0; i < 5; i++) {
      await engine.execute({
        skillId: skill.id,
        serverId: `server-${i}`,
        userId: 'user-1',
        triggerType: 'manual',
      });
    }

    const execs = await engine.getExecutions(skill.id, 3);
    expect(execs).toHaveLength(3);
  });

  it('getExecution should return a single execution by ID', async () => {
    const skillDir = await createTempDir('skill-');
    await writeSkillYaml(skillDir);

    const skill = await engine.install('user-1', skillDir, 'local');
    await engine.updateStatus(skill.id, 'enabled');

    const result = await engine.execute({
      skillId: skill.id,
      serverId: 'server-1',
      userId: 'user-1',
      triggerType: 'manual',
    });

    const exec = await engine.getExecution(result.executionId);
    expect(exec).toBeDefined();
    expect(exec!.id).toBe(result.executionId);
    expect(exec!.status).toBe('success');
  });

  it('getExecution should return null for non-existent execution', async () => {
    const exec = await engine.getExecution('non-existent');
    expect(exec).toBeNull();
  });
});

// ============================================================================
// Singleton Pattern
// ============================================================================

describe('SkillEngine singleton', () => {
  it('getSkillEngine should create and return a singleton', async () => {
    const { getSkillEngine } = await import('./engine.js');

    _resetSkillEngine();
    const e1 = getSkillEngine(projectRoot);
    const e2 = getSkillEngine(); // should return same instance
    expect(e1).toBe(e2);
    _resetSkillEngine();
  });

  it('getSkillEngine should throw if called without projectRoot on first call', async () => {
    const { getSkillEngine } = await import('./engine.js');

    _resetSkillEngine();
    expect(() => getSkillEngine()).toThrow(/not initialized/);
    _resetSkillEngine();
  });

  it('setSkillEngine should override the singleton', async () => {
    const { getSkillEngine, setSkillEngine } = await import('./engine.js');

    _resetSkillEngine();
    const custom = new SkillEngine(projectRoot, repo);
    setSkillEngine(custom);
    expect(getSkillEngine()).toBe(custom);
    _resetSkillEngine();
  });

  it('_resetSkillEngine should clear the singleton', async () => {
    const { getSkillEngine } = await import('./engine.js');

    _resetSkillEngine();
    getSkillEngine(projectRoot);
    _resetSkillEngine();
    expect(() => getSkillEngine()).toThrow(/not initialized/);
  });
});

// ============================================================================
// Confirmation Flow
// ============================================================================

describe('SkillEngine confirmation flow', () => {
  /** Write a skill.yaml with requires_confirmation: true */
  async function writeConfirmationSkillYaml(dir: string, name = 'confirm-skill'): Promise<void> {
    const yaml = `kind: skill
version: "1.0"

metadata:
  name: ${name}
  displayName: "Confirmation Skill"
  version: "1.0.0"

triggers:
  - type: manual
  - type: cron
    schedule: "0 * * * *"

tools:
  - shell

constraints:
  requires_confirmation: true
  risk_level_max: red

prompt: |
  This is a confirmation-required skill prompt that exceeds the minimum 50-character validation requirement for testing.
`;
    const { writeFile: wf } = await import('node:fs/promises');
    await wf(join(dir, 'skill.yaml'), yaml, 'utf-8');
  }

  it('should return pending_confirmation when auto-triggered with requires_confirmation=true', async () => {
    const skillDir = await createTempDir('confirm-skill-');
    await writeConfirmationSkillYaml(skillDir);

    const skill = await engine.install('user-1', skillDir, 'local');
    await engine.updateStatus(skill.id, 'enabled');

    const result = await engine.execute({
      skillId: skill.id,
      serverId: 'server-1',
      userId: 'user-1',
      triggerType: 'cron',
    });

    expect(result.status).toBe('pending_confirmation');
    expect(result.executionId).toBeDefined();
    expect(result.stepsExecuted).toBe(0);
    expect(result.errors).toEqual([]);
  });

  it('should execute immediately for manual trigger even with requires_confirmation=true', async () => {
    const skillDir = await createTempDir('confirm-skill-');
    await writeConfirmationSkillYaml(skillDir);

    const skill = await engine.install('user-1', skillDir, 'local');
    await engine.updateStatus(skill.id, 'enabled');

    const result = await engine.execute({
      skillId: skill.id,
      serverId: 'server-1',
      userId: 'user-1',
      triggerType: 'manual',
    });

    expect(result.status).toBe('success');
    expect(result.stepsExecuted).toBe(0);
  });

  it('should confirm a pending execution and run it', async () => {
    const skillDir = await createTempDir('confirm-skill-');
    await writeConfirmationSkillYaml(skillDir);

    const skill = await engine.install('user-1', skillDir, 'local');
    await engine.updateStatus(skill.id, 'enabled');

    const pendingResult = await engine.execute({
      skillId: skill.id,
      serverId: 'server-1',
      userId: 'user-1',
      triggerType: 'event',
    });
    expect(pendingResult.status).toBe('pending_confirmation');

    const confirmedResult = await engine.confirmExecution(pendingResult.executionId, 'user-1');
    expect(confirmedResult.status).toBe('success');
    expect(confirmedResult.executionId).toBe(pendingResult.executionId);
  });

  it('should reject a pending execution', async () => {
    const skillDir = await createTempDir('confirm-skill-');
    await writeConfirmationSkillYaml(skillDir);

    const skill = await engine.install('user-1', skillDir, 'local');
    await engine.updateStatus(skill.id, 'enabled');

    const pendingResult = await engine.execute({
      skillId: skill.id,
      serverId: 'server-1',
      userId: 'user-1',
      triggerType: 'threshold',
    });

    await engine.rejectExecution(pendingResult.executionId, 'user-1');

    const exec = await engine.getExecution(pendingResult.executionId);
    expect(exec!.status).toBe('cancelled');
    expect(exec!.result).toEqual({ reason: 'rejected' });
  });

  it('should throw when confirming a non-existent execution', async () => {
    await expect(
      engine.confirmExecution('non-existent', 'user-1'),
    ).rejects.toThrow(/Execution not found/);
  });

  it('should throw when confirming an already-completed execution', async () => {
    const skillDir = await createTempDir('confirm-skill-');
    await writeConfirmationSkillYaml(skillDir);

    const skill = await engine.install('user-1', skillDir, 'local');
    await engine.updateStatus(skill.id, 'enabled');

    const result = await engine.execute({
      skillId: skill.id,
      serverId: 'server-1',
      userId: 'user-1',
      triggerType: 'manual',
    });

    await expect(
      engine.confirmExecution(result.executionId, 'user-1'),
    ).rejects.toThrow(/not pending confirmation/);
  });

  it('should throw when rejecting a non-pending execution', async () => {
    const skillDir = await createTempDir('confirm-skill-');
    await writeConfirmationSkillYaml(skillDir);

    const skill = await engine.install('user-1', skillDir, 'local');
    await engine.updateStatus(skill.id, 'enabled');

    const result = await engine.execute({
      skillId: skill.id,
      serverId: 'server-1',
      userId: 'user-1',
      triggerType: 'manual',
    });

    await expect(
      engine.rejectExecution(result.executionId, 'user-1'),
    ).rejects.toThrow(/not pending confirmation/);
  });

  it('should list pending confirmations for a user', async () => {
    const skillDir = await createTempDir('confirm-skill-');
    await writeConfirmationSkillYaml(skillDir);

    const skill = await engine.install('user-1', skillDir, 'local');
    await engine.updateStatus(skill.id, 'enabled');

    await engine.execute({
      skillId: skill.id, serverId: 'server-1', userId: 'user-1', triggerType: 'cron',
    });
    await engine.execute({
      skillId: skill.id, serverId: 'server-2', userId: 'user-1', triggerType: 'event',
    });

    const pending = await engine.listPendingConfirmations('user-1');
    expect(pending).toHaveLength(2);
    expect(pending.every((e) => e.status === 'pending_confirmation')).toBe(true);
  });

  it('should expire pending confirmations after TTL', async () => {
    const skillDir = await createTempDir('confirm-skill-');
    await writeConfirmationSkillYaml(skillDir);

    const skill = await engine.install('user-1', skillDir, 'local');
    await engine.updateStatus(skill.id, 'enabled');

    await engine.execute({
      skillId: skill.id, serverId: 'server-1', userId: 'user-1', triggerType: 'cron',
    });

    const pending = await engine.listPendingConfirmations('user-1');
    expect(pending).toHaveLength(1);

    const exec = pending[0];
    // Force startedAt to be 31min ago for expiry test
    const rawExec = await repo.findExecutionById(exec.id);
    (rawExec as { startedAt: string }).startedAt = new Date(Date.now() - 31 * 60 * 1000).toISOString();

    const expired = await engine.expirePendingConfirmations();
    expect(expired).toBe(1);

    const after = await engine.listPendingConfirmations('user-1');
    expect(after).toHaveLength(0);
  });

  it('should not expire recent pending confirmations', async () => {
    const skillDir = await createTempDir('confirm-skill-');
    await writeConfirmationSkillYaml(skillDir);

    const skill = await engine.install('user-1', skillDir, 'local');
    await engine.updateStatus(skill.id, 'enabled');

    await engine.execute({
      skillId: skill.id, serverId: 'server-1', userId: 'user-1', triggerType: 'cron',
    });

    const expired = await engine.expirePendingConfirmations();
    expect(expired).toBe(0);

    const pending = await engine.listPendingConfirmations('user-1');
    expect(pending).toHaveLength(1);
  });
});

// ============================================================================
// listAvailable (directory scan integration)
// ============================================================================

describe('SkillEngine.listAvailable', () => {
  it('should scan skill directories and mark installed skills', async () => {
    // Create project structure with skills/official/
    const officialDir = join(projectRoot, 'skills', 'official');
    await mkdir(officialDir, { recursive: true });

    // Create two skill subdirectories
    const skillA = join(officialDir, 'skill-a');
    const skillB = join(officialDir, 'skill-b');
    await mkdir(skillA);
    await mkdir(skillB);
    await writeSkillYaml(skillA, { name: 'skill-a' });
    await writeSkillYaml(skillB, { name: 'skill-b' });

    // Install skill-a
    await engine.install('user-1', skillA, 'official');

    const available = await engine.listAvailable('user-1');
    expect(available.length).toBeGreaterThanOrEqual(2);

    const a = available.find((s) => s.manifest.metadata.name === 'skill-a');
    const b = available.find((s) => s.manifest.metadata.name === 'skill-b');

    expect(a).toBeDefined();
    expect(a!.installed).toBe(true);
    expect(a!.source).toBe('official');

    expect(b).toBeDefined();
    expect(b!.installed).toBe(false);
  });

  it('should return empty array when no skill directories exist', async () => {
    // projectRoot has no skills/ directory
    const available = await engine.listAvailable('user-1');
    expect(available).toEqual([]);
  });
});

// ============================================================================
// Full Lifecycle Integration
// ============================================================================

describe('SkillEngine full lifecycle', () => {
  it('should support install → configure → enable → execute → pause → enable → execute → uninstall', async () => {
    const skillDir = await createTempDir('lifecycle-');
    await writeSkillYaml(skillDir, { name: 'lifecycle-skill' });

    // Install
    const skill = await engine.install('user-1', skillDir, 'local');
    expect(skill.status).toBe('installed');

    // Configure
    await engine.configure(skill.id, { key: 'val' });
    let updated = await engine.getInstalled(skill.id);
    expect(updated!.status).toBe('configured');

    // Enable
    await engine.updateStatus(skill.id, 'enabled');
    updated = await engine.getInstalled(skill.id);
    expect(updated!.status).toBe('enabled');

    // Execute #1
    const result1 = await engine.execute({
      skillId: skill.id,
      serverId: 'server-1',
      userId: 'user-1',
      triggerType: 'manual',
    });
    expect(result1.status).toBe('success');

    // Pause
    await engine.updateStatus(skill.id, 'paused');

    // Cannot execute while paused
    await expect(
      engine.execute({
        skillId: skill.id,
        serverId: 'server-1',
        userId: 'user-1',
        triggerType: 'manual',
      }),
    ).rejects.toThrow(/not enabled/);

    // Re-enable
    await engine.updateStatus(skill.id, 'enabled');

    // Execute #2
    const result2 = await engine.execute({
      skillId: skill.id,
      serverId: 'server-1',
      userId: 'user-1',
      triggerType: 'manual',
    });
    expect(result2.status).toBe('success');

    // Verify 2 executions recorded
    const execs = await engine.getExecutions(skill.id);
    expect(execs).toHaveLength(2);

    // Uninstall
    await engine.uninstall(skill.id);
    expect(await engine.getInstalled(skill.id)).toBeNull();
    expect(await engine.getExecutions(skill.id)).toHaveLength(0);
  });
});

// ============================================================================
// Batch Execution (server_scope: 'all' / 'tagged')
// ============================================================================

describe('SkillEngine batch execution (server_scope)', () => {
  /** Write a skill.yaml with server_scope: all */
  async function writeBatchSkillYaml(
    dir: string,
    opts: { name?: string; scope?: 'all' | 'tagged' } = {},
  ): Promise<void> {
    const name = opts.name ?? 'batch-skill';
    const scope = opts.scope ?? 'all';
    const yaml = `kind: skill
version: "1.0"

metadata:
  name: ${name}
  displayName: "Batch Skill"
  version: "1.0.0"

triggers:
  - type: manual

tools:
  - shell

constraints:
  server_scope: ${scope}

prompt: |
  Run a batch check across all servers. This prompt is long enough to pass the minimum 50 chars requirement.
`;
    await writeFile(join(dir, 'skill.yaml'), yaml, 'utf-8');
  }

  function isBatchResult(r: SkillExecutionResult | BatchExecutionResult): r is BatchExecutionResult {
    return 'batchId' in r;
  }

  it('should execute on all user servers when server_scope is "all"', async () => {
    const skillDir = await createTempDir('batch-skill-');
    await writeBatchSkillYaml(skillDir);

    // Create 3 servers for user-1
    await serverRepo.create({ name: 'srv-1', userId: 'user-1' });
    await serverRepo.create({ name: 'srv-2', userId: 'user-1' });
    await serverRepo.create({ name: 'srv-3', userId: 'user-1' });

    const skill = await engine.install('user-1', skillDir, 'local');
    await engine.updateStatus(skill.id, 'enabled');

    const result = await engine.execute({
      skillId: skill.id,
      serverId: 'placeholder',
      userId: 'user-1',
      triggerType: 'manual',
    });

    expect(isBatchResult(result)).toBe(true);
    const batch = result as BatchExecutionResult;
    expect(batch.serverScope).toBe('all');
    expect(batch.results).toHaveLength(3);
    expect(batch.successCount).toBe(3);
    expect(batch.failureCount).toBe(0);
    expect(batch.batchId).toBeDefined();
    expect(batch.totalDuration).toBeGreaterThanOrEqual(0);
  });

  it('should create independent execution records per server', async () => {
    const skillDir = await createTempDir('batch-skill-');
    await writeBatchSkillYaml(skillDir);

    await serverRepo.create({ name: 'srv-a', userId: 'user-1' });
    await serverRepo.create({ name: 'srv-b', userId: 'user-1' });

    const skill = await engine.install('user-1', skillDir, 'local');
    await engine.updateStatus(skill.id, 'enabled');

    const result = await engine.execute({
      skillId: skill.id,
      serverId: 'placeholder',
      userId: 'user-1',
      triggerType: 'manual',
    });

    const batch = result as BatchExecutionResult;
    expect(batch.results).toHaveLength(2);

    // Each server should have a unique execution ID
    const execIds = batch.results.map((r) => r.result.executionId);
    expect(new Set(execIds).size).toBe(2);

    // Verify execution records in DB
    const executions = await engine.getExecutions(skill.id);
    expect(executions).toHaveLength(2);
  });

  it('should include server names in batch results', async () => {
    const skillDir = await createTempDir('batch-skill-');
    await writeBatchSkillYaml(skillDir);

    const s1 = await serverRepo.create({ name: 'web-server', userId: 'user-1' });
    const s2 = await serverRepo.create({ name: 'db-server', userId: 'user-1' });

    const skill = await engine.install('user-1', skillDir, 'local');
    await engine.updateStatus(skill.id, 'enabled');

    const result = await engine.execute({
      skillId: skill.id,
      serverId: 'placeholder',
      userId: 'user-1',
      triggerType: 'manual',
    });

    const batch = result as BatchExecutionResult;
    const serverNames = batch.results.map((r) => r.serverName).sort();
    expect(serverNames).toEqual(['db-server', 'web-server']);

    const serverIds = batch.results.map((r) => r.serverId).sort();
    expect(serverIds).toEqual([s1.id, s2.id].sort());
  });

  it('should continue execution when one server fails', async () => {
    const skillDir = await createTempDir('batch-skill-');
    await writeBatchSkillYaml(skillDir);

    const s1 = await serverRepo.create({ name: 'good-1', userId: 'user-1' });
    const s2 = await serverRepo.create({ name: 'good-2', userId: 'user-1' });
    await serverRepo.create({ name: 'good-3', userId: 'user-1' });

    const skill = await engine.install('user-1', skillDir, 'local');
    await engine.updateStatus(skill.id, 'enabled');

    // Make SkillRunner fail for the second server
    let callCount = 0;
    const MockRunner = vi.mocked(SkillRunner);
    MockRunner.mockImplementation(() => ({
      run: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 2) {
          return Promise.resolve({
            success: false,
            status: 'failed',
            stepsExecuted: 1,
            duration: 5,
            output: '',
            errors: ['Connection refused'],
            toolResults: [],
          });
        }
        return Promise.resolve({
          success: true,
          status: 'success',
          stepsExecuted: 2,
          duration: 10,
          output: 'OK',
          errors: [],
          toolResults: [],
        });
      }),
    }) as unknown as SkillRunner);

    const result = await engine.execute({
      skillId: skill.id,
      serverId: 'placeholder',
      userId: 'user-1',
      triggerType: 'manual',
    });

    const batch = result as BatchExecutionResult;
    expect(batch.results).toHaveLength(3);
    expect(batch.successCount).toBe(2);
    expect(batch.failureCount).toBe(1);

    // The failed server should have 'failed' status
    const failedResult = batch.results.find((r) => r.result.status === 'failed');
    expect(failedResult).toBeDefined();
    expect(failedResult!.result.errors).toContain('Connection refused');
  });

  it('should return empty results when user has no servers (scope: all)', async () => {
    const skillDir = await createTempDir('batch-skill-');
    await writeBatchSkillYaml(skillDir);

    const skill = await engine.install('user-1', skillDir, 'local');
    await engine.updateStatus(skill.id, 'enabled');

    const result = await engine.execute({
      skillId: skill.id,
      serverId: 'placeholder',
      userId: 'user-1',
      triggerType: 'manual',
    });

    const batch = result as BatchExecutionResult;
    expect(batch.results).toHaveLength(0);
    expect(batch.successCount).toBe(0);
    expect(batch.failureCount).toBe(0);
    expect(batch.totalDuration).toBe(0);
  });

  it('should throw for server_scope "tagged" (not yet supported)', async () => {
    const skillDir = await createTempDir('batch-skill-');
    await writeBatchSkillYaml(skillDir, { scope: 'tagged' });

    const skill = await engine.install('user-1', skillDir, 'local');
    await engine.updateStatus(skill.id, 'enabled');

    await expect(
      engine.execute({
        skillId: skill.id,
        serverId: 'server-1',
        userId: 'user-1',
        triggerType: 'manual',
      }),
    ).rejects.toThrow(/server_scope 'tagged' is not yet supported/);
  });

  it('should still use single-server mode for default scope (no constraints)', async () => {
    const skillDir = await createTempDir('skill-');
    await writeSkillYaml(skillDir);

    await serverRepo.create({ name: 'srv-1', userId: 'user-1' });
    await serverRepo.create({ name: 'srv-2', userId: 'user-1' });

    const skill = await engine.install('user-1', skillDir, 'local');
    await engine.updateStatus(skill.id, 'enabled');

    const result = await engine.execute({
      skillId: skill.id,
      serverId: 'server-1',
      userId: 'user-1',
      triggerType: 'manual',
    });

    // Should be SkillExecutionResult, not BatchExecutionResult
    expect(isBatchResult(result)).toBe(false);
    const single = result as SkillExecutionResult;
    expect(single.executionId).toBeDefined();
    expect(single.status).toBe('success');
  });

  it('should only execute on servers owned by the executing user', async () => {
    const skillDir = await createTempDir('batch-skill-');
    await writeBatchSkillYaml(skillDir);

    // Create servers for different users
    await serverRepo.create({ name: 'user1-srv', userId: 'user-1' });
    await serverRepo.create({ name: 'user2-srv', userId: 'user-2' });
    await serverRepo.create({ name: 'user3-srv', userId: 'user-3' });

    const skill = await engine.install('user-1', skillDir, 'local');
    await engine.updateStatus(skill.id, 'enabled');

    const result = await engine.execute({
      skillId: skill.id,
      serverId: 'placeholder',
      userId: 'user-1',
      triggerType: 'manual',
    });

    const batch = result as BatchExecutionResult;
    // Only user-1's server should be included
    expect(batch.results).toHaveLength(1);
    expect(batch.results[0].serverName).toBe('user1-srv');
    expect(batch.successCount).toBe(1);
  });

  it('should still validate skill status before batch execution', async () => {
    const skillDir = await createTempDir('batch-skill-');
    await writeBatchSkillYaml(skillDir);

    await serverRepo.create({ name: 'srv-1', userId: 'user-1' });

    const skill = await engine.install('user-1', skillDir, 'local');
    // Don't enable — status is 'installed'

    await expect(
      engine.execute({
        skillId: skill.id,
        serverId: 'placeholder',
        userId: 'user-1',
        triggerType: 'manual',
      }),
    ).rejects.toThrow(/not enabled/);
  });

  it('should still validate chain depth for batch execution', async () => {
    const skillDir = await createTempDir('batch-skill-');
    await writeBatchSkillYaml(skillDir);

    await serverRepo.create({ name: 'srv-1', userId: 'user-1' });

    const skill = await engine.install('user-1', skillDir, 'local');
    await engine.updateStatus(skill.id, 'enabled');

    await expect(
      engine.execute({
        skillId: skill.id,
        serverId: 'placeholder',
        userId: 'user-1',
        triggerType: 'event',
        chainContext: { depth: 5, trail: ['a', 'b', 'c', 'd', 'e'] },
      }),
    ).rejects.toThrow(/Chain depth limit exceeded/);
  });
});
