// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for SkillEngine — requirements checking integration.
 *
 * Verifies that checkRequirements() is invoked during skill execution
 * and that unsatisfied requirements block execution.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

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
import type { SkillExecutionResult } from './types.js';
import {
  createTempDir,
  cleanupTempDirs,
  writeSkillYaml,
  writeRequiresSkillYaml,
} from './engine-test-utils.js';

// Mock SkillRunner to avoid AI provider dependency
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

// Mock TriggerManager to isolate engine tests
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

// Mock WebhookDispatcher
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

  repo = new InMemorySkillRepository();
  setSkillRepository(repo);

  serverRepo = new InMemoryServerRepository();
  setServerRepository(serverRepo);

  projectRoot = await createTempDir('engine-req-');
  engine = new SkillEngine(projectRoot, repo);
});

afterEach(async () => {
  _resetSkillEngine();
  _resetSkillRepository();
  _resetServerRepository();
  await cleanupTempDirs();
});

// ============================================================================
// Requirements Checking Integration Tests
// ============================================================================

describe('SkillEngine requirements checking', () => {
  it('should execute skill with no requirements successfully', async () => {
    const skillDir = await createTempDir('skill-');
    await writeSkillYaml(skillDir);

    const skill = await engine.install('user-1', skillDir, 'local');
    await engine.updateStatus(skill.id, 'enabled');

    const result = await engine.execute({
      skillId: skill.id,
      serverId: 'server-1',
      userId: 'user-1',
      triggerType: 'manual',
    }) as SkillExecutionResult;

    expect(result.status).toBe('success');
  });

  it('should reject execution when OS requirement is not met', async () => {
    const server = await serverRepo.create({ name: 'win-server', userId: 'user-1' });
    const profile = await serverRepo.getProfile(server.id, 'user-1');
    if (profile) {
      profile.osInfo = {
        platform: 'windows',
        arch: 'x86_64',
        version: 'Windows 11',
        kernel: '10.0',
        hostname: 'win-host',
        uptime: 100,
      };
    }

    const skillDir = await createTempDir('skill-os-');
    await writeRequiresSkillYaml(skillDir, { os: ['linux'] });

    const skill = await engine.install('user-1', skillDir, 'local');
    await engine.updateStatus(skill.id, 'enabled');

    await expect(
      engine.execute({
        skillId: skill.id,
        serverId: server.id,
        userId: 'user-1',
        triggerType: 'manual',
      }),
    ).rejects.toThrow(/requirements not met/);
  });

  it('should execute when OS requirement is satisfied', async () => {
    const server = await serverRepo.create({ name: 'linux-srv', userId: 'user-1' });
    const profile = await serverRepo.getProfile(server.id, 'user-1');
    if (profile) {
      profile.osInfo = {
        platform: 'linux',
        arch: 'x86_64',
        version: 'Ubuntu 22.04',
        kernel: '5.15.0',
        hostname: 'linux-host',
        uptime: 86400,
      };
    }

    const skillDir = await createTempDir('skill-os-ok-');
    await writeRequiresSkillYaml(skillDir, { os: ['linux', 'darwin'] });

    const skill = await engine.install('user-1', skillDir, 'local');
    await engine.updateStatus(skill.id, 'enabled');

    const result = await engine.execute({
      skillId: skill.id,
      serverId: server.id,
      userId: 'user-1',
      triggerType: 'manual',
    }) as SkillExecutionResult;

    expect(result.status).toBe('success');
  });

  it('should reject execution when required command is missing', async () => {
    const server = await serverRepo.create({ name: 'srv-cmd', userId: 'user-1' });
    const profile = await serverRepo.getProfile(server.id, 'user-1');
    if (profile) {
      profile.software = [{ name: 'tar', version: '1.34', ports: [] }];
    }

    const skillDir = await createTempDir('skill-cmd-');
    await writeRequiresSkillYaml(skillDir, { commands: ['tar', 'zstd'] });

    const skill = await engine.install('user-1', skillDir, 'local');
    await engine.updateStatus(skill.id, 'enabled');

    await expect(
      engine.execute({
        skillId: skill.id,
        serverId: server.id,
        userId: 'user-1',
        triggerType: 'manual',
      }),
    ).rejects.toThrow(/requirements not met.*zstd/);
  });

  it('should execute with agent version requirement when agent version unavailable (degrade to warning)', async () => {
    const skillDir = await createTempDir('skill-agent-');
    await writeRequiresSkillYaml(skillDir, { agent: '>=1.0.0' });

    const skill = await engine.install('user-1', skillDir, 'local');
    await engine.updateStatus(skill.id, 'enabled');

    // Should succeed with a warning (not block) because agent version is null
    const result = await engine.execute({
      skillId: skill.id,
      serverId: 'server-1',
      userId: 'user-1',
      triggerType: 'manual',
    }) as SkillExecutionResult;

    expect(result.status).toBe('success');
  });

  it('should reject when server profile unavailable and OS is required', async () => {
    // Use a non-existent server ID — no profile available
    const skillDir = await createTempDir('skill-no-profile-');
    await writeRequiresSkillYaml(skillDir, { os: ['linux'] });

    const skill = await engine.install('user-1', skillDir, 'local');
    await engine.updateStatus(skill.id, 'enabled');

    await expect(
      engine.execute({
        skillId: skill.id,
        serverId: 'non-existent-server',
        userId: 'user-1',
        triggerType: 'manual',
      }),
    ).rejects.toThrow(/requirements not met.*server profile unavailable/);
  });

  it('should include all missing requirements in error message', async () => {
    const server = await serverRepo.create({ name: 'bad-srv', userId: 'user-1' });
    const profile = await serverRepo.getProfile(server.id, 'user-1');
    if (profile) {
      profile.osInfo = {
        platform: 'windows',
        arch: 'x86_64',
        version: 'Win 11',
        kernel: '10.0',
        hostname: 'w',
        uptime: 100,
      };
      profile.software = [];
    }

    const skillDir = await createTempDir('skill-multi-');
    await writeRequiresSkillYaml(skillDir, {
      os: ['linux'],
      commands: ['tar', 'ss'],
    });

    const skill = await engine.install('user-1', skillDir, 'local');
    await engine.updateStatus(skill.id, 'enabled');

    try {
      await engine.execute({
        skillId: skill.id,
        serverId: server.id,
        userId: 'user-1',
        triggerType: 'manual',
      });
      expect.fail('Expected execution to throw');
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg).toContain('requirements not met');
      expect(msg).toContain('not in supported list');
      expect(msg).toContain('tar');
      expect(msg).toContain('ss');
    }
  });

  it('should pass all requirements and proceed to execution', async () => {
    const server = await serverRepo.create({ name: 'good-srv', userId: 'user-1' });
    const profile = await serverRepo.getProfile(server.id, 'user-1');
    if (profile) {
      profile.osInfo = {
        platform: 'linux',
        arch: 'x86_64',
        version: 'Ubuntu 22.04',
        kernel: '5.15.0',
        hostname: 'good-host',
        uptime: 86400,
      };
      profile.software = [
        { name: 'tar', version: '1.34', ports: [] },
        { name: 'ss', version: '5.0', ports: [] },
      ];
    }

    const skillDir = await createTempDir('skill-all-ok-');
    await writeRequiresSkillYaml(skillDir, {
      os: ['linux', 'darwin'],
      commands: ['tar', 'ss'],
      agent: '>=1.0.0',
    });

    const skill = await engine.install('user-1', skillDir, 'local');
    await engine.updateStatus(skill.id, 'enabled');

    // Should succeed — OS matches, commands present, agent version degrades to warning
    const result = await engine.execute({
      skillId: skill.id,
      serverId: server.id,
      userId: 'user-1',
      triggerType: 'manual',
    }) as SkillExecutionResult;

    expect(result.status).toBe('success');
  });
});
