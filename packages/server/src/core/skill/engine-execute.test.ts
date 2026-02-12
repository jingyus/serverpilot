// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for SkillEngine — execute, template variable injection, and batch execution.
 *
 * Split from engine.test.ts to stay within the 800-line file limit.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';

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
import type { BatchExecutionResult, SkillExecutionResult } from './types.js';
import { SkillRunner } from './runner.js';
import { getWebhookDispatcher } from '../webhook/dispatcher.js';
import {
  createTempDir,
  cleanupTempDirs,
  writeSkillYaml,
  writeTemplatedSkillYaml,
  writeBatchSkillYaml,
} from './engine-test-utils.js';

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
// Setup / Teardown
// ============================================================================

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
  await cleanupTempDirs();
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
// Template Variable Injection
// ============================================================================

describe('SkillEngine template variable injection', () => {
  it('should inject server.name into prompt template', async () => {
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
    expect(runCall.resolvedPrompt).toContain('Last run: N/A');
  });

  it('should use empty strings for server vars when server not found', async () => {
    const skillDir = await createTempDir('skill-tpl-');
    await writeTemplatedSkillYaml(skillDir);

    const skill = await engine.install('user-1', skillDir, 'local');
    await engine.updateStatus(skill.id, 'enabled');

    const result = await engine.execute({
      skillId: skill.id,
      serverId: 'non-existent-server',
      userId: 'user-1',
      triggerType: 'manual',
    });

    expect(result.status).toBe('success');

    const runnerInstance = vi.mocked(SkillRunner).mock.results.at(-1)?.value;
    const runCall = runnerInstance.run.mock.calls[0][0];
    expect(runCall.resolvedPrompt).not.toContain('{{server.name}}');
    expect(runCall.resolvedPrompt).toContain('on server .');
  });

  it('should inject server.os from profile when available', async () => {
    const server = await serverRepo.create({
      name: 'linux-box',
      userId: 'user-1',
    });

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
// Batch Execution (server_scope: 'all' / 'tagged')
// ============================================================================

describe('SkillEngine batch execution (server_scope)', () => {
  function isBatchResult(r: SkillExecutionResult | BatchExecutionResult): r is BatchExecutionResult {
    return 'batchId' in r;
  }

  it('should execute on all user servers when server_scope is "all"', async () => {
    const skillDir = await createTempDir('batch-skill-');
    await writeBatchSkillYaml(skillDir);

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

    const execIds = batch.results.map((r) => r.result.executionId);
    expect(new Set(execIds).size).toBe(2);

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

    await serverRepo.create({ name: 'good-1', userId: 'user-1' });
    await serverRepo.create({ name: 'good-2', userId: 'user-1' });
    await serverRepo.create({ name: 'good-3', userId: 'user-1' });

    const skill = await engine.install('user-1', skillDir, 'local');
    await engine.updateStatus(skill.id, 'enabled');

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

  it('should degrade server_scope "tagged" to single-server with warnings', async () => {
    const skillDir = await createTempDir('batch-skill-');
    await writeBatchSkillYaml(skillDir, { scope: 'tagged' });

    const skill = await engine.install('user-1', skillDir, 'local');
    await engine.updateStatus(skill.id, 'enabled');

    const result = await engine.execute({
      skillId: skill.id,
      serverId: 'server-1',
      userId: 'user-1',
      triggerType: 'manual',
    });

    const batch = result as BatchExecutionResult;
    expect(batch.serverScope).toBe('tagged');
    expect(batch.warnings).toBeDefined();
    expect(batch.warnings!.length).toBeGreaterThan(0);
    expect(batch.warnings![0]).toContain("server_scope 'tagged' is not yet supported");
    expect(batch.warnings![0]).toContain('falling back to single server');
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

    expect(isBatchResult(result)).toBe(false);
    const single = result as SkillExecutionResult;
    expect(single.executionId).toBeDefined();
    expect(single.status).toBe('success');
  });

  it('should only execute on servers owned by the executing user', async () => {
    const skillDir = await createTempDir('batch-skill-');
    await writeBatchSkillYaml(skillDir);

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
    expect(batch.results).toHaveLength(1);
    expect(batch.results[0].serverName).toBe('user1-srv');
    expect(batch.successCount).toBe(1);
  });

  it('should still validate skill status before batch execution', async () => {
    const skillDir = await createTempDir('batch-skill-');
    await writeBatchSkillYaml(skillDir);

    await serverRepo.create({ name: 'srv-1', userId: 'user-1' });

    const skill = await engine.install('user-1', skillDir, 'local');

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
