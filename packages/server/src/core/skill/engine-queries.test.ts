// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for SkillEngine — queries, singleton, listAvailable, and full lifecycle.
 *
 * Split from engine.test.ts to stay within the 800-line file limit.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';

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
import { getWebhookDispatcher } from '../webhook/dispatcher.js';
import {
  createTempDir,
  cleanupTempDirs,
  writeSkillYaml,
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
let engine: SkillEngine;
let projectRoot: string;

beforeEach(async () => {
  _resetSkillEngine();
  _resetSkillRepository();
  _resetServerRepository();
  vi.mocked(getWebhookDispatcher().dispatch).mockClear();

  repo = new InMemorySkillRepository();
  setSkillRepository(repo);

  const serverRepo = new InMemoryServerRepository();
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
